"""
Kollab Backend API
===================
Lightweight auth + user management service.
Runs on port 8001. The ML service runs separately on port 8000.
"""

import asyncio
import json
import os
import time as _time
import uuid
from pathlib import Path

_start_time = _time.time()

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

import database
import matcher
import storage
from enrichment_provider import ProviderNotConfiguredError
import enrichment_providers
import nlp
from nlp import euphemism_expansion as _euphemism_expansion
from nlp import models as _nlp_models

ML_URL = os.getenv("ML_API_URL", "http://127.0.0.1:8000")

# Backward-compatible alias — storage.LOCAL_DIR owns the actual on-disk root.
# Other modules that imported STORAGE_DIR from this file keep working unchanged.
STORAGE_DIR = storage.LOCAL_DIR

app = FastAPI(title="Kollab Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

database.init_db()


@app.on_event("startup")
async def _nlp_startup() -> None:
    """Seed the euphemism dictionary on first boot, warm up NLP models, and
    rebuild the semantic search index — all in the background so uvicorn
    comes up immediately."""
    try:
        _euphemism_expansion.ensure_seeds_loaded()
    except Exception:
        # Non-fatal: NLP deps may not be installed yet on a stripped backend.
        import logging
        logging.exception("[nlp] seed load failed")
    def _startup_bg():
        _nlp_models.warm_up()
        try:
            from nlp.semantic_search import rebuild_index
            n = rebuild_index()
            import logging
            logging.getLogger(__name__).info("[startup] semantic index: %d segments", n)
        except Exception:
            import logging
            logging.getLogger(__name__).exception("[startup] semantic index rebuild failed")

    asyncio.get_event_loop().run_in_executor(None, _startup_bg)


# In-memory step tracker: audio_id → {pct, label}
_audio_progress: dict[int, dict] = {}


# ─── Models ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class VerifyAdminRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    username: str
    new_password: str

class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str
    firstName: str
    lastName: str
    idNumber: str

class UpdateUserRequest(BaseModel):
    firstName: str
    lastName: str
    idNumber: str
    role: str
    password: Optional[str] = ""

class DeleteUserRequest(BaseModel):
    admin_username: str
    admin_password: str

class UpdateProfileRequest(BaseModel):
    user_id: int
    firstName: str
    lastName: str
    password: Optional[str] = ""


class DangerousWordIn(BaseModel):
    word: str
    severity: str = "high"
    created_by: Optional[int] = None


class EuphemismIn(BaseModel):
    phrase: str
    severity: str = "high"
    created_by: Optional[int] = None


class CreateGroupRequest(BaseModel):
    name: str
    color: str = "#6366f1"
    parentGroupId: Optional[int] = None
    description: Optional[str] = None

class UpdateGroupRequest(BaseModel):
    name: str
    color: str = "#6366f1"
    parentGroupId: Optional[int] = None
    description: Optional[str] = None

class AddGroupMemberRequest(BaseModel):
    speaker_id: int


class BatchMembersRequest(BaseModel):
    speaker_ids: list[int]


class BatchDeleteRequest(BaseModel):
    ids: list[int]


class AssignmentIn(BaseModel):
    analystUserId: int
    groupId: int


def _resolve_caller(user_id: Optional[int]) -> tuple[Optional[int], bool]:
    """Returns (user_id, is_admin). Missing user_id is treated as admin for
    backwards-compat with screens that haven't yet been wired to setApiUser."""
    if user_id is None:
        return None, True
    role = database.get_user_role(user_id)
    return user_id, (role == "Admin")


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "Kollab backend running", "version": "1.0.0"}


# ─── System Stats ─────────────────────────────────────────────────────────────

@app.get("/stats")
def get_stats():
    stats = database.get_system_stats()
    secs = int(_time.time() - _start_time)
    h, rem = divmod(secs, 3600)
    m = rem // 60
    stats["uptime"] = f"{h // 24}d {h % 24}h" if h >= 24 else f"{h}h {m}m"
    return stats


# ─── Processing progress ──────────────────────────────────────────────────────

@app.get("/audios/{audio_id}/progress")
def get_audio_progress(audio_id: int):
    return _audio_progress.get(audio_id, {"pct": 0, "label": ""})


# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/auth/login")
def login(body: LoginRequest):
    user = database.validate_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    return user


@app.post("/auth/verify-admin")
def verify_admin(body: VerifyAdminRequest):
    user = database.validate_user(body.username, body.password)
    if not user or user["role"] != "Admin":
        return {"valid": False}
    return {"valid": True}


@app.put("/auth/password")
def change_password(body: ChangePasswordRequest):
    ok = database.update_password(body.username, body.new_password)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"success": True}


# ─── Users ────────────────────────────────────────────────────────────────────

@app.get("/users")
def list_users():
    return database.get_all_users()


@app.post("/users", status_code=201)
def create_user(body: CreateUserRequest):
    ok, msg = database.register_user(
        body.username, body.password, body.role,
        body.firstName, body.lastName, body.idNumber,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True}


@app.put("/users/{user_id}")
def update_user(user_id: int, body: UpdateUserRequest):
    ok, msg = database.update_user(
        user_id, body.firstName, body.lastName,
        body.idNumber, body.role, body.password or "",
    )
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True}


@app.delete("/users/{user_id}")
def delete_user(user_id: int, body: DeleteUserRequest):
    admin = database.validate_user(body.admin_username, body.admin_password)
    if not admin or admin["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Wrong admin password.")
    ok = database.delete_user(user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"success": True}


# ─── Profile (self-update) ────────────────────────────────────────────────────

@app.put("/profile/me")
def update_profile(body: UpdateProfileRequest):
    ok, msg = database.update_self_profile(
        body.user_id, body.firstName, body.lastName, body.password or ""
    )
    if not ok:
        raise HTTPException(status_code=500, detail=msg)
    return {"success": True, "firstName": body.firstName, "lastName": body.lastName}


# ─── Audios ───────────────────────────────────────────────────────────────────

async def _poll_ml_progress(audio_id: int, stop: asyncio.Event) -> None:
    """Polls ML /status every 3 s and mirrors it into _audio_progress."""
    while not stop.is_set():
        try:
            async with httpx.AsyncClient(timeout=4.0) as c:
                r = await c.get(f"{ML_URL}/status")
                _audio_progress[audio_id] = r.json()
        except Exception:
            pass
        await asyncio.sleep(3)


def _scan_for_dangerous_words(audio_id: int) -> int:
    """Check all segments of audio_id against flagged keywords and create
    `dangerous_word`-category alerts. Returns count created. Tag the category
    so the frontend's `?category=dangerous_word` filter (and any rescan-all
    cleanup) can find them."""
    words = database.get_dangerous_words()
    if not words:
        return 0
    segments = database.get_segments_by_audio(audio_id)
    created = 0
    seen: set[int] = set()
    for word_row in words:
        if word_row["id"] in seen:
            continue
        needle = word_row["word"].lower()
        for seg in segments:
            if needle in (seg["text"] or "").lower():
                database.create_alert(
                    word_row["severity"],
                    # The audio name is joined into the response separately —
                    # embedding an ID in the text made rows read "detected in
                    # audio 13" which is meaningless once the audio is renamed
                    # or deleted.
                    f'Flagged keyword "{word_row["word"]}" detected',
                    related_audio_id=audio_id,
                    category="dangerous_word",
                )
                seen.add(word_row["id"])
                created += 1
                break
    return created


async def _run_ml_and_save(audio_id: int, audio_handle: str, original_name: str) -> None:
    """Background task: call ML service, persist results, update audio status."""
    _audio_progress[audio_id] = {"pct": 0, "label": "Queued…"}
    stop_event = asyncio.Event()
    poll_task = asyncio.create_task(_poll_ml_progress(audio_id, stop_event))

    try:
        audio_bytes = storage.read_bytes(audio_handle)
        if audio_bytes is None:
            raise RuntimeError(f"audio not found at {audio_handle}")
        async with httpx.AsyncClient(timeout=600.0) as client:
            ml_response = await client.post(
                f"{ML_URL}/analyze",
                files={"file": (original_name, audio_bytes, "audio/mpeg")},
            )
        ml_response.raise_for_status()
        result = ml_response.json()
    except Exception:
        database.update_audio_result(audio_id, "failed")
        stop_event.set()
        poll_task.cancel()
        _audio_progress.pop(audio_id, None)
        return
    finally:
        stop_event.set()
        poll_task.cancel()
        _audio_progress.pop(audio_id, None)

    all_ends = [
        seg["end"]
        for spk in result.get("speakers", [])
        for seg in spk.get("segments", [])
    ]
    duration = max(all_ends) if all_ends else 0.0

    model_version = result.get("model_version", "ecapa-tdnn-v1")

    speaker_id_map: dict[str, int] = {}
    pending_suggestions: list[tuple[int, int, float]] = []
    taken: set[int] = set()
    for spk in result.get("speakers", []):
        windows_raw = spk.get("embeddings") or []
        query_windows = np.asarray(windows_raw, dtype=np.float32)
        if query_windows.size == 0:
            # Speaker had segments but no embeddable audio (very short fragments).
            # Attribute segments to a fresh unknown so they're still visible in the UI.
            sid, _name = database.create_unknown_speaker()
            speaker_id_map[spk["speaker_label"]] = sid
            taken.add(sid)
            continue

        match = matcher.match_or_register(
            query_windows,
            taken_speaker_ids=taken,
            model_version=model_version,
            source_audio_id=audio_id,
        )
        speaker_id_map[spk["speaker_label"]] = match.speaker_id
        taken.add(match.speaker_id)
        if match.status == "auto_matched":
            # Record the score so the UI can badge un-learned matches (0.60-0.85)
            # and offer the analyst a Confirm button that appends embeddings.
            # ≥ LEARN_THRESHOLD is auto-confirmed since the matcher already
            # sharpened the bucket.
            database.upsert_attribution(
                audio_id, match.speaker_id, match.confidence,
                confirmed=match.confidence >= matcher.LEARN_THRESHOLD,
            )
        if match.status == "suggested" and match.suggested_speaker_id is not None:
            pending_suggestions.append(
                (match.speaker_id, match.suggested_speaker_id, match.confidence)
            )

    segments_to_insert = [
        {
            "audio_id": audio_id,
            "speaker_id": speaker_id_map[spk["speaker_label"]],
            "text": seg.get("text", ""),
            "start_time": seg["start"],
            "end_time": seg["end"],
        }
        for spk in result.get("speakers", [])
        for seg in spk.get("segments", [])
    ]
    database.clear_segments(audio_id)
    if segments_to_insert:
        database.insert_segments(segments_to_insert)
        # NLP pipeline. Order matters: embed first (Hadar), then NER (Ofek),
        # then coded-language scoring (Ofir — depends on embeddings).
        # Each stage is wrapped individually so one failure doesn't abort the rest.
        try:
            await asyncio.to_thread(nlp.embed_segments, audio_id)
        except Exception:
            import logging
            logging.exception("embed_segments failed for audio %s", audio_id)
        try:
            await asyncio.to_thread(nlp.extract_and_resolve_entities, audio_id)
        except Exception:
            import logging
            logging.exception("extract_and_resolve_entities failed for audio %s", audio_id)
        try:
            await asyncio.to_thread(nlp.score_coded_language, audio_id)
        except Exception:
            import logging
            logging.exception("score_coded_language failed for audio %s", audio_id)
        _scan_for_dangerous_words(audio_id)

    for unknown_id, suggested_id, conf in pending_suggestions:
        database.insert_speaker_suggestion(audio_id, unknown_id, suggested_id, conf)

    speaker_db_ids = list(speaker_id_map.values())
    for i in range(len(speaker_db_ids)):
        for j in range(i + 1, len(speaker_db_ids)):
            database.upsert_relation(speaker_db_ids[i], speaker_db_ids[j])

    database.update_audio_result(audio_id, "processed", duration)


@app.post("/audios/upload", status_code=201)
async def upload_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    name: str = Form(""),
    description: str = Form(""),
    uploaded_by: int = Form(...),
    recorded_at: str = Form(...),
):
    if not recorded_at.strip():
        raise HTTPException(status_code=400, detail="recorded_at is required (when the audio was recorded).")

    original_name = file.filename or "audio"
    display_name = name.strip() or Path(original_name).stem
    suffix = Path(original_name).suffix or ".wav"
    file_id = uuid.uuid4().hex
    key = f"audios/{file_id}{suffix}"

    handle, file_size = storage.put_upload(file, key)

    audio_id = database.create_audio(
        display_name, description, handle, file_size, uploaded_by, recorded_at.strip()
    )

    background_tasks.add_task(_run_ml_and_save, audio_id, handle, original_name)

    return {"id": audio_id, "name": display_name, "status": "processing"}


@app.get("/audios")
def list_audios(user_id: Optional[int] = None):
    uid, is_admin = _resolve_caller(user_id)
    return database.get_audios_for_user(uid, is_admin)


@app.get("/audios/{audio_id}")
def get_audio(audio_id: int, user_id: Optional[int] = None):
    audio = database.get_audio(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found.")
    uid, is_admin = _resolve_caller(user_id)
    if not is_admin and uid is not None and not database.user_can_see_audio(uid, False, audio_id):
        raise HTTPException(status_code=403, detail="This audio is outside your assigned projects.")
    return audio


@app.delete("/audios/{audio_id}")
def delete_audio(audio_id: int):
    audio = database.get_audio(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found.")
    ok = database.delete_audio(audio_id)
    storage.delete(audio["filePath"])
    return {"success": ok}


class UpdateAudioRequest(BaseModel):
    name: str
    description: str = ""
    recorded_at: Optional[str] = None


@app.put("/audios/{audio_id}")
def update_audio(audio_id: int, body: UpdateAudioRequest):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Name is required.")
    ok = database.update_audio_metadata(audio_id, body.name.strip(), body.description, body.recorded_at)
    if not ok:
        raise HTTPException(status_code=404, detail="Audio not found.")
    return database.get_audio(audio_id)


@app.post("/audios/batch-delete")
def batch_delete_audios(body: BatchDeleteRequest):
    deleted: list[int] = []
    failed: list[dict] = []
    for aid in body.ids:
        audio = database.get_audio(aid)
        if not audio:
            failed.append({"id": aid, "reason": "not found"})
            continue
        if database.delete_audio(aid):
            storage.delete(audio["filePath"])
            deleted.append(aid)
        else:
            failed.append({"id": aid, "reason": "delete failed"})
    return {"deleted": deleted, "failed": failed}


@app.get("/audios/{audio_id}/file")
def get_audio_file(audio_id: int):
    audio = database.get_audio(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found.")
    handle = audio["filePath"]

    suffix = Path(handle).suffix.lower()
    media_type = {
        ".mp3": "audio/mpeg", ".wav": "audio/wav",
        ".m4a": "audio/mp4", ".ogg": "audio/ogg",
    }.get(suffix, "audio/mpeg")

    # In R2 mode we stream the bytes through Backend rather than redirecting
    # to a presigned URL. Why: the waveform pipeline does fetch().arrayBuffer()
    # to read PCM, which the browser rejects under cross-origin without R2
    # bucket-level CORS. Streaming via Backend (already on the same origin) is
    # CORS-free and avoids needing extra bucket-admin permissions. The cost is
    # one Backend-RAM-resident copy per request, fine for a 3-user team.
    if storage.USE_R2 and not storage._looks_like_local_path(handle):
        from fastapi.responses import Response
        body = storage.read_bytes(handle)
        if body is None:
            raise HTTPException(status_code=404, detail="File not found in R2.")
        return Response(content=body, media_type=media_type)

    # Local fallback: serve from disk.
    path = Path(handle)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk.")
    return FileResponse(str(path), media_type=media_type)


@app.post("/audios/{audio_id}/retry", status_code=202)
async def retry_audio(audio_id: int, background_tasks: BackgroundTasks):
    audio = database.get_audio(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found.")
    if audio["status"] == "processing":
        raise HTTPException(status_code=409, detail="Already processing.")
    handle = audio["filePath"]
    if not storage.exists(handle):
        raise HTTPException(status_code=404, detail="Audio file no longer in storage.")
    database.update_audio_result(audio_id, "processing")
    background_tasks.add_task(_run_ml_and_save, audio_id, handle, Path(handle).name)
    return {"success": True}


@app.get("/audios/{audio_id}/segments")
def get_segments(audio_id: int, user_id: Optional[int] = None):
    uid, is_admin = _resolve_caller(user_id)
    if not is_admin and uid is not None and not database.user_can_see_audio(uid, False, audio_id):
        raise HTTPException(status_code=403, detail="This audio is outside your assigned projects.")
    return database.get_segments_by_audio(audio_id)


@app.get("/audios/{audio_id}/alerts")
def get_audio_alerts(audio_id: int):
    return database.get_alerts_for_audio(audio_id)


# ─── Speakers ─────────────────────────────────────────────────────────────────

@app.get("/speakers")
def list_speakers(user_id: Optional[int] = None):
    uid, is_admin = _resolve_caller(user_id)
    return database.get_speakers_for_user(uid, is_admin)


@app.get("/speakers/{speaker_id}")
def get_speaker(speaker_id: int):
    spk = database.get_speaker(speaker_id)
    if not spk:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    return spk


@app.get("/speakers/{speaker_id}/audios")
def get_speaker_audios(speaker_id: int):
    spk = database.get_speaker(speaker_id)
    if not spk:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    return database.get_audios_for_speaker(speaker_id)


# Speaker pictures share the storage backend with audio uploads — local disk or
# R2 depending on env. ImagePath in the DB stores the full handle (R2 key or
# absolute local path) so the storage module can route correctly on read.
_SPEAKER_IMG_DIR = STORAGE_DIR / "speaker_images"
_SPEAKER_IMG_DIR.mkdir(parents=True, exist_ok=True)
_ALLOWED_IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def _speaker_image_key(speaker_id: int, ext: str) -> str:
    """Build the storage key for a fresh speaker image upload."""
    fname = f"speaker_{speaker_id}_{uuid.uuid4().hex[:8]}{ext}"
    # In R2 mode we just want "speakers/<fname>"; in local mode put_bytes/put_upload
    # will route to LOCAL_DIR. Either way the returned handle goes into ImagePath
    # as-is and reads route correctly via storage.{presigned_url,read_bytes}.
    if storage.USE_R2:
        return f"speakers/{fname}"
    return str(_SPEAKER_IMG_DIR / fname)


def _resolve_legacy_image_path(stored: str) -> str:
    """Older rows stored just the filename ('speaker_5_abc.jpg'). Promote to a
    full handle so storage.* can find it on disk."""
    if not stored:
        return stored
    if storage.USE_R2 and "/" in stored:
        return stored  # already a key
    if "/" in stored or "\\" in stored:
        return stored  # already a full path
    return str(_SPEAKER_IMG_DIR / stored)


def _attach_wikidata_image_if_needed(speaker_id: int) -> None:
    """Best-effort: if this speaker has a Wikidata QID, no profile picture
    yet, and the entity carries an image on Commons — download it and set it
    as the speaker's avatar. Called after merges / confirmations so a freshly
    identified person automatically gets the public-domain picture without
    the analyst having to upload it manually.

    Silent no-op on any of: speaker missing, image already set, no Wikidata id,
    no image on the entity, or HTTP failure. We never block the user action
    on this — it's pure enrichment.
    """
    import logging as _logging
    try:
        spk = database.get_speaker(speaker_id)
        if not spk or spk.get("imagePath") or not spk.get("wikidataId"):
            return
        try:
            provider = _provider_or_503()
        except HTTPException:
            return  # provider not configured — fine, skip
        try:
            cand = provider.lookup(spk["wikidataId"])
        except ProviderNotConfiguredError:
            return
        if not cand or not cand.image_url:
            return
        url = cand.image_url
        ext = Path(url.split("?", 1)[0]).suffix.lower()
        if ext not in _ALLOWED_IMG_EXT:
            # Wikidata Commons URLs usually end in .jpg/.png; fall back if the
            # extension is weird (e.g. .svg, .tif) to keep the file servable.
            ext = ".jpg"
        try:
            with httpx.Client(
                timeout=15.0,
                follow_redirects=True,
                headers={"User-Agent": "Kollab/1.0 (profile image fetch)"},
            ) as c:
                r = c.get(url)
        except httpx.HTTPError:
            return
        if r.status_code != 200 or not r.content:
            return
        key = _speaker_image_key(speaker_id, ext)
        handle = storage.put_bytes(r.content, key)
        database.set_speaker_image_path(speaker_id, handle)
    except Exception:
        _logging.exception("[wikidata image] failed for speaker %d", speaker_id)


@app.post("/speakers/{speaker_id}/image", status_code=201)
async def upload_speaker_image(speaker_id: int, file: UploadFile = File(...)):
    spk = database.get_speaker(speaker_id)
    if not spk:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _ALLOWED_IMG_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported file type {ext or '(none)'}.")
    # Remove the previous image so we don't leak stale objects when ext changes.
    if spk.get("imagePath"):
        storage.delete(_resolve_legacy_image_path(spk["imagePath"]))
    key = _speaker_image_key(speaker_id, ext)
    handle, _size = storage.put_upload(file, key)
    database.set_speaker_image_path(speaker_id, handle)
    return {"success": True, "imagePath": handle}


@app.delete("/speakers/{speaker_id}/image")
def delete_speaker_image(speaker_id: int):
    spk = database.get_speaker(speaker_id)
    if not spk:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    if spk.get("imagePath"):
        storage.delete(_resolve_legacy_image_path(spk["imagePath"]))
    database.set_speaker_image_path(speaker_id, None)
    return {"success": True}


@app.get("/speakers/{speaker_id}/image")
def get_speaker_image(speaker_id: int):
    spk = database.get_speaker(speaker_id)
    if not spk or not spk.get("imagePath"):
        raise HTTPException(status_code=404, detail="No image for speaker.")
    handle = _resolve_legacy_image_path(spk["imagePath"])

    # Stream from R2 through Backend rather than 307-redirecting to a presigned
    # URL — same reason as audio: avoids cross-origin and redirect-quirk issues
    # in <img> tags and network-graph SVGs.
    if storage.USE_R2 and not storage._looks_like_local_path(handle):
        from fastapi.responses import Response
        body = storage.read_bytes(handle)
        if body is None:
            raise HTTPException(status_code=404, detail="Image not found in R2.")
        ext = Path(handle).suffix.lower()
        media_type = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
        }.get(ext, "application/octet-stream")
        return Response(content=body, media_type=media_type)

    p = Path(handle)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Image file missing on disk.")
    return FileResponse(str(p))


class SpeakerTrackedRequest(BaseModel):
    untracked: bool


@app.put("/speakers/{speaker_id}/tracked")
def set_speaker_tracked(speaker_id: int, body: SpeakerTrackedRequest):
    spk = database.get_speaker(speaker_id)
    if not spk:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    database.set_speaker_untracked(speaker_id, body.untracked)
    return database.get_speaker(speaker_id)


class UpdateSpeakerRequest(BaseModel):
    name: str
    riskLevel: str = "low"
    forceSeparate: bool = False  # if True, skip name-collision merge


class ReassignSpeakerRequest(BaseModel):
    new_name: str
    force_separate: bool = False  # if True, always create a new speaker


class SplitSpeakerRequest(BaseModel):
    segment_ids: list[int]
    new_name: str = ""          # name for the NEW speaker (selected segments). Empty → "Speaker N"
    source_new_name: str = ""   # optional rename for the SOURCE speaker (remaining segments). Empty → keep current name


@app.post("/audios/{audio_id}/speakers/{speaker_id}/reassign", status_code=201)
def reassign_speaker(audio_id: int, speaker_id: int, body: ReassignSpeakerRequest):
    new_name = body.new_name.strip() or "Unknown"

    # If a speaker with that name already exists, repoint segments in this audio
    # to them rather than creating yet another duplicate — unless the caller
    # explicitly said this is a different person who happens to share the name.
    existing = None if body.force_separate else database.find_speaker_by_name(new_name, exclude_id=speaker_id)
    if existing:
        ok = database.reassign_segments_in_audio_to_existing(audio_id, speaker_id, existing["id"])
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to reassign segments.")
        result = database.get_speaker(existing["id"])
        if not result:
            raise HTTPException(status_code=500, detail="Speaker lookup failed after reassign.")
        # If the source speaker now has zero segments anywhere, fold them into the target.
        if database.speaker_has_segments(speaker_id):
            return result
        # move_embeddings before merge — merge deletes the source which would
        # otherwise cascade-delete its SpeakerEmbeddings rows.
        database.move_embeddings(speaker_id, existing["id"])
        database.merge_speakers(speaker_id, existing["id"])
        # Wikidata-linked target may not have an avatar yet — pull one if so.
        _attach_wikidata_image_if_needed(existing["id"])
        return database.get_speaker(existing["id"]) or result

    new_speaker = database.reassign_speaker_in_audio(audio_id, speaker_id, new_name)
    if not new_speaker:
        raise HTTPException(status_code=500, detail="Failed to create new speaker.")
    return new_speaker


async def _embeddings_for_ranges(audio_bytes: bytes, audio_name: str, ranges: list[tuple[float, float]]) -> tuple[np.ndarray, str]:
    """POST the audio + ranges to ML's /speakers/embed-from-ranges and return
    (embeddings, model_version). Raises HTTPException on ML failure."""
    if not ranges:
        return np.zeros((0, 192), dtype=np.float32), "ecapa-tdnn-v1"
    ranges_json = json.dumps([[float(s), float(e)] for s, e in ranges])
    async with httpx.AsyncClient(timeout=300.0) as client:
        ml_response = await client.post(
            f"{ML_URL}/speakers/embed-from-ranges",
            files={"file": (audio_name, audio_bytes, "audio/mpeg")},
            data={"ranges": ranges_json},
        )
    if ml_response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"ML re-extract failed: {ml_response.text[:200]}")
    payload = ml_response.json()
    arr = np.asarray(payload.get("embeddings") or [], dtype=np.float32)
    return arr, payload.get("model_version", "ecapa-tdnn-v1")


@app.post("/audios/{audio_id}/speakers/{speaker_id}/split", status_code=201)
async def split_speaker(audio_id: int, speaker_id: int, body: SplitSpeakerRequest):
    """Split selected segments off the source speaker into a new speaker.
    Re-extracts embeddings for both sides from the on-disk audio so the new
    speaker gets clean fingerprints and the source loses the misattributed ones.
    """
    if not body.segment_ids:
        raise HTTPException(status_code=400, detail="segment_ids cannot be empty.")

    audio = database.get_audio(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found.")
    audio_bytes = storage.read_bytes(audio["filePath"])
    if audio_bytes is None:
        raise HTTPException(status_code=404, detail="Audio file no longer in storage.")
    audio_name = Path(audio["filePath"]).name

    source = database.get_speaker(speaker_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source speaker not found.")

    # Validate every requested segment belongs to this audio + this speaker
    moved_segs = database.get_segments_by_ids(body.segment_ids)
    bad = [s for s in moved_segs if s["audioId"] != audio_id or s["speakerId"] != speaker_id]
    if bad or len(moved_segs) != len(body.segment_ids):
        raise HTTPException(
            status_code=400,
            detail="All segment_ids must belong to this audio AND the given source speaker.",
        )

    moved_ranges = [(s["startTime"], s["endTime"]) for s in moved_segs]

    # Compute remaining segments (this audio's segments for the source, minus the moved ones)
    all_for_source = [
        s for s in database.get_segments_by_audio(audio_id)
        if s["speakerId"] == speaker_id
    ]
    moved_id_set = set(body.segment_ids)
    remaining = [s for s in all_for_source if s["id"] not in moved_id_set]
    remaining_ranges = [(s["startTime"], s["endTime"]) for s in remaining]

    # Re-extract embeddings via ML — does the heavy lifting (load audio, slice, ECAPA windows)
    new_embeddings, model_version = await _embeddings_for_ranges(audio_bytes, audio_name, moved_ranges)
    if new_embeddings.size == 0:
        raise HTTPException(
            status_code=400,
            detail="Selected segments produced no usable embeddings (probably too short).",
        )
    remaining_embeddings, _ = await _embeddings_for_ranges(audio_bytes, audio_name, remaining_ranges) if remaining_ranges else (np.zeros((0, 192), dtype=np.float32), model_version)

    # Snapshot speaker set before any repointing so we can diff relations afterward.
    before_speakers = database.get_audio_speaker_ids(audio_id)

    # Create the new speaker (auto-named "Speaker N" unless caller gave a name)
    if body.new_name.strip():
        import uuid as _uuid
        new_voice_id = f"speaker_{_uuid.uuid4().hex[:8]}"
        new_id, _ = database.get_or_create_speaker(new_voice_id, body.new_name.strip())
    else:
        new_id, _ = database.create_unknown_speaker()

    # Repoint the chosen segments
    database.repoint_segments(body.segment_ids, new_id)

    # Replace this audio's contribution to the source's bucket with the cleaner remaining-only one,
    # and seed the new speaker with embeddings from just the moved segments.
    database.delete_embeddings_for_speaker_and_audio(speaker_id, audio_id)
    if remaining_embeddings.size > 0:
        database.insert_embeddings(speaker_id, remaining_embeddings, model_version, audio_id)
    database.insert_embeddings(new_id, new_embeddings, model_version, audio_id)

    # If after the split the source has no segments anywhere, fold it in (it's empty).
    if not database.speaker_has_segments(speaker_id):
        database.move_embeddings(speaker_id, new_id)
        database.merge_speakers(speaker_id, new_id)
        return database.get_speaker(new_id)

    # Optional: rename the source (the one keeping the *remaining* segments).
    # We do this AFTER the split so the rename can't collide with the new
    # speaker that was just created.
    src_new = body.source_new_name.strip()
    if src_new:
        source = database.get_speaker(speaker_id)
        database.update_speaker(speaker_id, src_new, source["riskLevel"] if source else "low")

    database.adjust_relations_for_audio(audio_id, before_speakers)
    return database.get_speaker(new_id)


@app.delete("/speakers/{speaker_id}")
def delete_speaker_endpoint(speaker_id: int):
    speaker = database.get_speaker(speaker_id)
    if not speaker:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    ok = database.delete_speaker(speaker_id)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to delete speaker.")
    return {"success": True}


class ResolveGhostRequest(BaseModel):
    real_speaker_id: int


@app.post("/speakers/{ghost_id}/resolve-ghost", status_code=200)
def resolve_ghost(ghost_id: int, body: ResolveGhostRequest):
    ghost = database.get_speaker(ghost_id)
    if not ghost:
        raise HTTPException(status_code=404, detail="Ghost speaker not found.")
    if not ghost.get("isGhost"):
        raise HTTPException(status_code=422, detail="Speaker is not a ghost node.")
    real = database.get_speaker(body.real_speaker_id)
    if not real:
        raise HTTPException(status_code=404, detail="Real speaker not found.")
    if real.get("isGhost"):
        raise HTTPException(status_code=422, detail="Target speaker is also a ghost.")
    ok = database.merge_ghost_into_speaker(ghost_id, body.real_speaker_id)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to resolve ghost.")
    return {"success": True, "mergedIntoId": body.real_speaker_id}


class PromoteGhostRequest(BaseModel):
    name: Optional[str] = None  # optional rename; default keeps the ghost's name


@app.post("/speakers/{ghost_id}/promote-to-real", status_code=200)
def promote_ghost_to_real(ghost_id: int, body: PromoteGhostRequest):
    """Turn a ghost node into a full speaker awaiting voice enrollment.
    Unlike resolve-ghost (which merges into an existing speaker), this keeps
    the ghost as its own identity — just flips `IsGhost` to 0 so it stops
    being rendered as a triangle placeholder. Analysts can enroll a voice
    sample from the speaker profile page afterwards."""
    ghost = database.get_speaker(ghost_id)
    if not ghost:
        raise HTTPException(status_code=404, detail="Ghost speaker not found.")
    if not ghost.get("isGhost"):
        raise HTTPException(status_code=422, detail="Speaker is not a ghost node.")

    new_name = (body.name or ghost["name"]).strip() or ghost["name"]
    # Detect a rename-collision with an existing named speaker and merge into
    # them instead — same principle as PUT /speakers/{id}. Prevents duplicate
    # identities under the same name.
    existing = database.find_speaker_by_name(new_name, exclude_id=ghost_id)
    if existing and not existing.get("isGhost"):
        database.move_embeddings(ghost_id, existing["id"])
        database.merge_speakers(ghost_id, existing["id"])
        return {"success": True, "mergedIntoId": existing["id"], "promoted": False}

    # A ghost's VoiceIdentifier looks like "ghost_entity_24" — that string is
    # rendered on the speaker profile, which reads like leftover plumbing
    # after the promotion. Regenerate a fresh `speaker_<8hex>` identifier so
    # the profile looks the same as any hand-enrolled speaker. Do the same
    # for Color (grab an unused palette entry) since the original ghost was
    # picked from the palette based on its early-life state.
    new_voice_id = f"speaker_{uuid.uuid4().hex[:8]}"
    with database._get_conn() as conn:
        new_color = database._pick_unused_color(conn)
        conn.execute(
            """UPDATE Speakers
               SET IsGhost = 0, Name = ?, VoiceIdentifier = ?, Color = ?
               WHERE Id = ?""",
            (new_name, new_voice_id, new_color, ghost_id),
        )
        # Also clear the entity's ghostSpeakerId link so future promotes of
        # the same entity create a fresh ghost rather than reusing the row
        # we just converted into a real speaker.
        conn.execute(
            "UPDATE Entities SET GhostSpeakerId = NULL WHERE GhostSpeakerId = ?",
            (ghost_id,),
        )
        # The ghost's incoming edges were tagged Topic='mentioned', which the
        # graph renders as dashed violet — semantically "somebody mentioned
        # this person we haven't heard". Now that the person is a real
        # speaker, those edges should read like any other conversation edge,
        # so clear the topic tag on relations that touch this speaker.
        conn.execute(
            """UPDATE Relations SET Topic = ''
               WHERE (SpeakerAId = ? OR SpeakerBId = ?) AND Topic = 'mentioned'""",
            (ghost_id, ghost_id),
        )
        conn.commit()
    return {"success": True, "promoted": True, "speakerId": ghost_id}


@app.post("/speakers/batch-delete")
def batch_delete_speakers(body: BatchDeleteRequest):
    deleted: list[int] = []
    failed: list[dict] = []
    for sid in body.ids:
        if database.delete_speaker(sid):
            deleted.append(sid)
        else:
            failed.append({"id": sid, "reason": "not found or delete failed"})
    return {"deleted": deleted, "failed": failed}


@app.get("/speakers/{speaker_id}/match-suggestions")
def speaker_match_suggestions(speaker_id: int, limit: int = 5):
    """Co-occurring named speakers ranked by voice-embedding similarity to the
    queried (usually unknown) speaker. Used to power the auto-suggest panel
    in the rename / reassign flows."""
    if not database.get_speaker(speaker_id):
        raise HTTPException(status_code=404, detail="Speaker not found.")
    candidate_ids = database.get_cooccurring_named_speaker_ids(speaker_id)
    if not candidate_ids:
        return []
    ranked = matcher.rank_candidates(speaker_id, candidate_ids)[: max(0, limit)]
    out = []
    for sid, conf in ranked:
        spk = database.get_speaker(sid)
        if not spk:
            continue
        out.append({
            "id": spk["id"],
            "name": spk["name"],
            "color": spk["color"],
            "imagePath": spk.get("imagePath"),
            "riskLevel": spk["riskLevel"],
            "confidence": conf,
        })
    return out


@app.put("/speakers/{speaker_id}")
def update_speaker(speaker_id: int, body: UpdateSpeakerRequest):
    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty.")

    # If another speaker already has this name, merge this one INTO that one —
    # unless the caller explicitly said it's a different person who shares the name.
    existing = None if body.forceSeparate else database.find_speaker_by_name(new_name, exclude_id=speaker_id)
    if existing:
        source = database.get_speaker(speaker_id)
        target = database.get_speaker(existing["id"])
        if not source or not target:
            raise HTTPException(status_code=404, detail="Speaker not found.")
        # Carry over the higher of the two risk levels — only if the user is bumping it up.
        risk_rank = {"low": 0, "medium": 1, "high": 2}
        if risk_rank.get(body.riskLevel, 0) > risk_rank.get(target["riskLevel"], 0):
            database.update_speaker(target["id"], target["name"], body.riskLevel)

        # move_embeddings before merge — see reassign_speaker.
        database.move_embeddings(speaker_id, target["id"])
        if not database.merge_speakers(speaker_id, target["id"]):
            raise HTTPException(status_code=500, detail="Speaker merge failed.")
        # Best-effort: if the target is Wikidata-linked without a photo yet, pull one.
        _attach_wikidata_image_if_needed(target["id"])
        return {"success": True, "merged": True, "mergedIntoId": target["id"], "mergedIntoName": target["name"]}

    ok = database.update_speaker(speaker_id, new_name, body.riskLevel)
    if not ok:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    database.delete_suggestions_for_unknown(speaker_id)
    return {"success": True, "merged": False}


# ─── Speaker Enrollment + Suggestions ─────────────────────────────────────────

async def _enroll_from_bytes(name: str, original_name: str, file_bytes: bytes,
                              content_type: str = "audio/mpeg") -> tuple[int, int]:
    """Same as _enroll_from_audio but caller already has the bytes (avoids
    double-reading the UploadFile when we also need to persist it)."""
    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty.")

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            ml_response = await client.post(
                f"{ML_URL}/speakers/embed",
                files={"file": (original_name, file_bytes, content_type)},
            )
        ml_response.raise_for_status()
        payload = ml_response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"ML service unavailable: {e}")

    embeddings = np.asarray(payload.get("embeddings") or [], dtype=np.float32)
    if embeddings.size == 0:
        raise HTTPException(status_code=400, detail="No usable embedding could be extracted from this audio.")

    speaker_id, _created = database.get_or_create_speaker(clean_name, clean_name)
    inserted = database.insert_embeddings(
        speaker_id,
        embeddings,
        model_version=payload.get("model_version", "ecapa-tdnn-v1"),
    )
    return speaker_id, inserted


async def _enroll_from_audio(name: str, file: UploadFile) -> tuple[int, int]:
    """UploadFile wrapper around _enroll_from_bytes — used by /speakers/enroll."""
    original_name = file.filename or "audio"
    file_bytes = await file.read()
    return await _enroll_from_bytes(name, original_name, file_bytes,
                                     file.content_type or "audio/mpeg")


@app.post("/speakers/enroll", status_code=201)
async def enroll_speaker(name: str = Form(...), file: UploadFile = File(...)):
    """Register a known speaker in the voice database from a clean audio sample.
    Calls ML's stateless /speakers/embed and persists the returned vectors."""
    speaker_id, inserted = await _enroll_from_audio(name, file)
    return {
        "status": "ok",
        "message": f"Speaker '{name.strip()}' enrolled successfully.",
        "speakerId": speaker_id,
        "sampleCount": database.count_embeddings(speaker_id),
        "addedThisCall": inserted,
    }


# ─── Speaker ↔ Public Intelligence Enrichment (Wikidata) ──────────────────────
#
# These endpoints power the "Related Speakers" wizard. They surface entities
# from a public-knowledge graph (Wikidata by default) so an analyst can see
# *suggested* connections and choose to enroll them as new speakers. Results
# are explicitly framed as suggestions — the UI labels them as such, and the
# relation rows we write are tagged Topic='wikidata' so the network graph can
# render them differently from audio-derived edges.

class ConfirmEntityRequest(BaseModel):
    entityId: str


def _provider_or_503():
    """Surface a missing-config provider as a clean 503 to the UI."""
    return enrichment_providers.provider


# ─── Semantic Search (Hadar) ──────────────────────────────────────────────────

@app.get("/search/semantic")
def search_semantic(
    q: str,
    audio_id: Optional[int] = None,
    speaker_id: Optional[int] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    top: int = 20,
    exact_only: bool = False,
):
    """Hybrid BM25 + dense retrieval + cross-encoder rerank + MMR.
    When `exact_only` is true, bypasses the semantic pipeline and returns only
    segments whose text contains the query substring (case-insensitive),
    sorted newest-first."""
    if not q.strip():
        return {"results": []}
    try:
        from nlp.semantic_search import search as _search
        results = _search(
            q,
            audio_id=audio_id,
            speaker_id=speaker_id,
            from_date=from_date,
            to_date=to_date,
            top_k=min(top, 50),
            exact_only=exact_only,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"results": results}


@app.post("/search/reindex")
def search_reindex():
    """Rebuild the in-memory FAISS + BM25 index from all stored segment embeddings.
    Call after bulk imports or if search results seem stale."""
    try:
        from nlp.semantic_search import rebuild_index
        n = rebuild_index()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"indexed": n}


@app.get("/speakers/{speaker_id}/enrichment/search")
def enrichment_search(speaker_id: int, query: str, limit: int = 5):
    """Search the public-knowledge graph by name. Returns top-N candidates so
    the analyst can disambiguate (multiple John Smiths, etc.). Does NOT
    persist anything."""
    speaker = database.get_speaker(speaker_id)
    if not speaker:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    if not query.strip():
        raise HTTPException(status_code=400, detail="query is required.")
    try:
        candidates = _provider_or_503().search(query, limit=limit)
    except ProviderNotConfiguredError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return [
        {
            "entityId": c.entity_id,
            "label": c.label,
            "description": c.description,
            "imageUrl": c.image_url,
        }
        for c in candidates
    ]


@app.post("/speakers/{speaker_id}/enrichment/confirm")
def enrichment_confirm(speaker_id: int, body: ConfirmEntityRequest):
    """Persist the chosen Wikidata entity ID on the speaker. Idempotent."""
    speaker = database.get_speaker(speaker_id)
    if not speaker:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    try:
        database.set_wikidata_id(speaker_id, body.entityId)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    # Best-effort: pull the Wikidata image onto the profile if there isn't one.
    _attach_wikidata_image_if_needed(speaker_id)
    return {
        "success": True,
        "speakerId": speaker_id,
        "wikidataId": body.entityId.strip().upper(),
    }


@app.get("/speakers/{speaker_id}/enrichment/related")
def enrichment_related(speaker_id: int, limit: int = 25):
    """Suggested related entities with reasons. Requires the speaker to have
    a confirmed entity ID (Step 2)."""
    speaker = database.get_speaker(speaker_id)
    if not speaker:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    if not speaker.get("wikidataId"):
        raise HTTPException(
            status_code=400,
            detail="Confirm a public-graph entity for this speaker first (Step 2).",
        )
    try:
        candidates = _provider_or_503().related(speaker["wikidataId"], limit=limit)
    except ProviderNotConfiguredError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return [
        {
            "entityId": c.entity_id,
            "label": c.label,
            "description": c.description,
            "imageUrl": c.image_url,
            "reason": c.reason,
        }
        for c in candidates
    ]


@app.post("/speakers/{speaker_id}/enrichment/link", status_code=201)
async def enrichment_link(
    background_tasks: BackgroundTasks,
    speaker_id: int,
    entityId: str = Form(...),
    name: str = Form(...),
    audio_name: str = Form(""),
    file: Optional[UploadFile] = File(None),
):
    """Enroll a suggested related entity as a new speaker, linked to the
    source.

    If a speaker with this Wikidata entity already exists, reuse them — audio
    is not required (and is ignored if provided). Otherwise we enroll a
    brand-new speaker, which requires an audio clip per the project's
    "speakers always have voice embeddings" invariant.

    Either way we upsert a Relations row with Topic='wikidata' so the new
    edge can be rendered as a suggested (dashed) connection in the network
    graph, distinct from audio-derived edges.
    """
    source = database.get_speaker(speaker_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source speaker not found.")
    if not entityId.strip():
        raise HTTPException(status_code=400, detail="entityId is required.")

    existing = database.get_speaker_by_wikidata_id(entityId)
    reused = bool(existing and existing["id"] != speaker_id)
    if existing and existing["id"] == speaker_id:
        raise HTTPException(status_code=400, detail="Cannot link a speaker to themselves.")

    # Read bytes once if an audio file was provided — used for ML embed,
    # R2 upload, and the background analyse task.
    audio_bytes: Optional[bytes] = None
    original_name = ""
    if file is not None and getattr(file, "filename", ""):
        original_name = file.filename or "audio"
        audio_bytes = await file.read()
        if not audio_bytes:
            audio_bytes = None  # treat empty upload as no file

    if reused:
        new_speaker_id = existing["id"]
    else:
        if not audio_bytes:
            raise HTTPException(
                status_code=400,
                detail="Audio file is required when adding a new speaker.",
            )
        new_speaker_id, _ = await _enroll_from_bytes(
            name, original_name, audio_bytes,
            file.content_type if file else "audio/mpeg",
        )
        try:
            database.set_wikidata_id(new_speaker_id, entityId)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))

    # Persist + queue full analysis for the recording — same flow for both
    # paths: new speaker (audio_bytes definitely present) and reused speaker
    # (audio_bytes only if the analyst attached one). The recording lands in
    # "All Uploads" with status=processing, transitions to processed when
    # the Whisper+diarize+NLP pass finishes.
    if audio_bytes:
        try:
            from datetime import datetime as _dt
            import uuid as _uuid
            suffix = Path(original_name).suffix or ".wav"
            file_id = _uuid.uuid4().hex
            key = f"audios/{file_id}{suffix}"
            handle = storage.put_bytes(audio_bytes, key)
            display_name = audio_name.strip() or f"Enrollment — {name.strip()}"
            new_audio_id = database.create_audio(
                display_name,
                f"Voice enrollment for {name.strip()} (linked from {source['name']}).",
                handle,
                len(audio_bytes),
                None,
                _dt.utcnow().isoformat(),
            )
            background_tasks.add_task(_run_ml_and_save, new_audio_id, handle, original_name)
        except Exception:
            import logging
            logging.exception("[enrichment_link] failed to persist enrollment audio (speaker %s)", new_speaker_id)

    database.upsert_relation(speaker_id, new_speaker_id, topic="wikidata")
    # Whether reused or freshly enrolled, the speaker now carries a Wikidata id.
    # Pull the avatar from Commons if one isn't set yet.
    _attach_wikidata_image_if_needed(new_speaker_id)
    return {"newSpeakerId": new_speaker_id, "reused": reused}


@app.get("/audios/{audio_id}/suggestions")
def list_audio_suggestions(audio_id: int):
    if not database.get_audio(audio_id):
        raise HTTPException(status_code=404, detail="Audio not found.")
    return database.get_suggestions_for_audio(audio_id)


@app.post("/audios/{audio_id}/suggestions/{suggestion_id}/accept", status_code=200)
def accept_suggestion(audio_id: int, suggestion_id: int):
    suggestion = database.get_suggestion(suggestion_id)
    if not suggestion or suggestion["audioId"] != audio_id:
        raise HTTPException(status_code=404, detail="Suggestion not found.")

    unknown_id = suggestion["unknownSpeakerId"]
    target_id = suggestion["suggestedSpeakerId"]

    # "Speaker N is Ofir" is a statement about identity, not just this recording —
    # it should hold globally. Move embeddings, then merge the unknown into the
    # target (segments from every audio repoint, source row is deleted).
    database.move_embeddings(unknown_id, target_id)
    if not database.merge_speakers(unknown_id, target_id):
        raise HTTPException(status_code=500, detail="Failed to merge speakers.")
    database.delete_suggestion(suggestion_id)
    # If the target is already linked to Wikidata, pull the picture if missing.
    _attach_wikidata_image_if_needed(target_id)
    return {"success": True, "mergedIntoId": target_id}


@app.delete("/audios/{audio_id}/suggestions/{suggestion_id}", status_code=200)
def reject_suggestion(audio_id: int, suggestion_id: int):
    suggestion = database.get_suggestion(suggestion_id)
    if not suggestion or suggestion["audioId"] != audio_id:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    database.delete_suggestion(suggestion_id)
    return {"success": True}


# ─── Speaker attribution confidence (auto-match audit) ────────────────────────

@app.get("/audios/{audio_id}/attributions")
def get_audio_attributions(audio_id: int):
    """Per-speaker match scores from the diarization pass. Powers the "% match"
    badge + Confirm button on the AudioAnalysis speaker cards."""
    if not database.get_audio(audio_id):
        raise HTTPException(status_code=404, detail="Audio not found.")
    return database.get_attributions_for_audio(audio_id)


@app.post("/audios/{audio_id}/speakers/{speaker_id}/confirm-attribution", status_code=200)
async def confirm_attribution(audio_id: int, speaker_id: int):
    """Analyst confirms an auto-match in the 0.60-0.85 band. Re-extracts
    embeddings for the speaker's segments in this audio and appends them —
    end result identical to what would have happened if the original match
    had scored ≥ LEARN_THRESHOLD."""
    audio = database.get_audio(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found.")
    speaker = database.get_speaker(speaker_id)
    if not speaker:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    audio_bytes = storage.read_bytes(audio["filePath"])
    if audio_bytes is None:
        raise HTTPException(status_code=404, detail="Audio file no longer in storage.")

    ranges = [
        (s["startTime"], s["endTime"])
        for s in database.get_segments_by_audio(audio_id)
        if s["speakerId"] == speaker_id
    ]
    if not ranges:
        raise HTTPException(status_code=400, detail="Speaker has no segments in this audio.")

    embeddings, model_version = await _embeddings_for_ranges(
        audio_bytes, Path(audio["filePath"]).name, ranges,
    )
    if embeddings.size == 0:
        raise HTTPException(status_code=400, detail="No usable embeddings could be extracted.")

    added = database.insert_embeddings(speaker_id, embeddings, model_version, audio_id)
    database.set_attribution_confirmed(audio_id, speaker_id)
    return {"success": True, "added": int(added)}


# ─── Relations ────────────────────────────────────────────────────────────────

@app.get("/relations")
def list_relations():
    return database.get_all_relations()


# ─── Groups ───────────────────────────────────────────────────────────────────

@app.get("/groups")
def list_groups():
    return database.get_all_groups()

@app.post("/groups", status_code=201)
def create_group(body: CreateGroupRequest):
    try:
        group_id = database.create_group(
            body.name, body.color, body.parentGroupId, body.description
        )
    except database.GroupHierarchyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    groups = {g["id"]: g for g in database.get_all_groups()}
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=500, detail="Group creation failed.")
    return group

@app.put("/groups/{group_id}")
def update_group(group_id: int, body: UpdateGroupRequest):
    try:
        ok = database.update_group(
            group_id, body.name, body.color, body.parentGroupId, body.description
        )
    except database.GroupHierarchyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="Group not found.")
    groups = {g["id"]: g for g in database.get_all_groups()}
    return groups[group_id]

@app.delete("/groups/{group_id}")
def delete_group(group_id: int):
    ok = database.delete_group(group_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Group not found.")
    return {"success": True}

@app.post("/groups/{group_id}/members/batch", status_code=201)
def add_group_members_batch(group_id: int, body: BatchMembersRequest):
    added: list[int] = []
    skipped: list[int] = []
    for sid in body.speaker_ids:
        try:
            database.add_group_member(group_id, sid)
            added.append(sid)
        except Exception:
            skipped.append(sid)
    groups = {g["id"]: g for g in database.get_all_groups()}
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
    return {"group": group, "added": added, "skipped": skipped}


@app.post("/groups/{group_id}/members", status_code=201)
def add_group_member(group_id: int, body: AddGroupMemberRequest):
    database.add_group_member(group_id, body.speaker_id)
    groups = {g["id"]: g for g in database.get_all_groups()}
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
    return group

@app.delete("/groups/{group_id}/members/{speaker_id}")
def remove_group_member(group_id: int, speaker_id: int):
    database.remove_group_member(group_id, speaker_id)
    groups = {g["id"]: g for g in database.get_all_groups()}
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
    return group

@app.get("/groups/bridges")
def get_bridges(groupA: int, groupB: int):
    all_groups = {g["id"]: g for g in database.get_all_groups()}
    group_a = all_groups.get(groupA)
    group_b = all_groups.get(groupB)
    if not group_a or not group_b:
        raise HTTPException(status_code=404, detail="One or both groups not found.")
    bridges = database.get_bridges(groupA, groupB)
    return {"groupA": group_a, "groupB": group_b, "bridges": bridges}


# ─── Projects (top-level groups) ──────────────────────────────────────────────

@app.get("/projects")
def list_projects(user_id: Optional[int] = None):
    uid, is_admin = _resolve_caller(user_id)
    return database.list_projects(user_id=uid, is_admin=is_admin)


@app.get("/projects/{project_id}")
def get_project(project_id: int, user_id: Optional[int] = None):
    detail = database.get_project_detail(project_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Project not found.")
    uid, is_admin = _resolve_caller(user_id)
    if not is_admin and uid is not None:
        visible = database.get_visible_group_ids(uid)
        # Project visible iff caller is assigned to it or any of its subgroups.
        sub_ids = {sg["id"] for sg in detail["subgroups"]}
        if project_id not in visible and not (sub_ids & visible):
            raise HTTPException(status_code=403, detail="Project outside your assignments.")
    return detail


# ─── Project Assignments ──────────────────────────────────────────────────────

@app.get("/assignments")
def list_assignments(
    project_id: Optional[int] = None,
    user_id: Optional[int] = None,
    group_id: Optional[int] = None,
):
    return database.list_assignments(group_id=group_id, user_id=user_id, project_id=project_id)


@app.post("/assignments", status_code=201)
def create_assignment(body: AssignmentIn):
    try:
        row = database.add_assignment(body.analystUserId, body.groupId)
    except database.AssignmentError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if row is None:
        raise HTTPException(status_code=409, detail="Assignment already exists.")
    return row


@app.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: int):
    ok = database.remove_assignment(assignment_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    return {"success": True}


# ─── User helpers (analyst list) ──────────────────────────────────────────────

@app.get("/users")
def list_users(role: Optional[str] = None):
    return database.list_users_by_role(role=role)


# ─── Alerts ───────────────────────────────────────────────────────────────────

@app.get("/alerts")
def list_alerts(category: Optional[str] = None, user_id: Optional[int] = None):
    """Unified alerts list. `category` optional filter:
    'coded_language' or 'dangerous_word' (or omitted for all)."""
    if category and category not in ("coded_language", "dangerous_word"):
        raise HTTPException(status_code=400, detail="Unknown category.")
    uid, is_admin = _resolve_caller(user_id)
    return database.get_alerts_for_user(uid, is_admin, category=category)


# ─── Dangerous Words ──────────────────────────────────────────────────────────

@app.get("/dangerous-words")
def list_dangerous_words():
    return database.get_dangerous_words()


@app.post("/dangerous-words", status_code=201)
def add_dangerous_word(body: DangerousWordIn):
    word = body.word.strip()
    if not word:
        raise HTTPException(status_code=400, detail="word cannot be empty.")
    if body.severity not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="severity must be low, medium, or high.")
    # A stale/deleted client-side user id shouldn't turn a save into a 500 via
    # FK constraint failure. Preflight and drop it to NULL if unknown; the
    # entry itself is still what the user asked to add.
    created_by = body.created_by if database.user_exists(body.created_by) else None
    row = database.add_dangerous_word(word, body.severity, created_by)
    if row is None:
        raise HTTPException(status_code=409, detail="Word already exists.")
    return row


@app.delete("/dangerous-words/{word_id}")
def delete_dangerous_word(word_id: int):
    ok = database.delete_dangerous_word(word_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Word not found.")
    return {"success": True}


@app.post("/dangerous-words/rescan-all")
def rescan_all_dangerous_words():
    """Re-scan every processed audio's segments against the CURRENT flagged
    keyword list. Wipes each audio's dangerous_word-category alerts first so
    a re-run doesn't double-up rows. Use after adding new keywords so old
    recordings surface matches they never got scanned for."""
    audios = database.get_all_audios()
    total_created = 0
    scanned = 0
    for audio in audios:
        if audio.get("status") != "processed":
            continue
        database.delete_alerts_by_audio_and_category(audio["id"], "dangerous_word")
        total_created += _scan_for_dangerous_words(audio["id"])
        scanned += 1
    return {"audiosScanned": scanned, "alertsCreated": total_created}


# ─── Euphemisms (Ofir — coded-language dictionary) ────────────────────────────

@app.get("/euphemisms")
def list_euphemisms():
    return database.list_euphemisms()


@app.post("/euphemisms", status_code=201)
def add_euphemism(body: EuphemismIn):
    phrase = body.phrase.strip()
    if not phrase:
        raise HTTPException(status_code=400, detail="phrase cannot be empty.")
    if body.severity not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="severity must be low, medium, or high.")
    # Pre-embed so Signal D doesn't pay the cost on its first scoring run
    embedding = None
    embedding_model = None
    try:
        embed = _nlp_models.get_embed_model()
        vec = embed.encode([phrase], show_progress_bar=False, normalize_embeddings=True)
        embedding = np.asarray(vec, dtype=np.float32)[0]
        embedding_model = _nlp_models.EMBED_MODEL_NAME
    except Exception:
        import logging
        logging.exception("euphemism pre-embed failed; storing without vector")
    # See add_dangerous_word — clean-null a stale user id instead of 500-ing on FK.
    created_by = body.created_by if database.user_exists(body.created_by) else None
    row = database.add_euphemism(
        phrase=phrase,
        severity=body.severity,
        auto_learned=False,
        confidence=None,
        embedding=embedding,
        embedding_model=embedding_model,
        created_by=created_by,
    )
    if row is None:
        raise HTTPException(status_code=409, detail="Phrase already exists.")
    return row


@app.delete("/euphemisms/{euph_id}")
def delete_euphemism(euph_id: int):
    ok = database.delete_euphemism(euph_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Euphemism not found.")
    return {"success": True}


@app.post("/euphemisms/expand")
async def expand_euphemisms():
    """Run the bootstrap expansion algorithm on the current corpus + seeds.
    Sync from the caller's perspective but uses a thread so the event loop
    isn't blocked while sklearn fits and embeds candidates."""
    return await asyncio.to_thread(_euphemism_expansion.expand_euphemisms)


@app.post("/euphemisms/rescan-all")
async def rescan_all_euphemisms():
    """Re-run the coded-language scorer on every processed audio using the
    CURRENT euphemism list AND alert threshold. Nukes each audio's existing
    coded_language alerts first so a threshold bump (e.g. 0.50 → 0.60) can't
    leave the stale sub-threshold rows floating around. Slower than the
    flagged-word rescan — the embedding model runs per segment."""
    audios = database.get_all_audios()
    scanned = 0
    for audio in audios:
        if audio.get("status") != "processed":
            continue
        try:
            database.delete_alerts_by_audio_and_category(audio["id"], "coded_language")
            await asyncio.to_thread(nlp.score_coded_language, audio["id"])
            scanned += 1
        except Exception:
            import logging
            logging.exception("euphemism rescan failed for audio %s", audio["id"])
    return {"audiosScanned": scanned}


@app.post("/audios/{audio_id}/rescore-coded-language")
async def rescore_coded_language(audio_id: int):
    """Dev/debug: re-run coded-language scoring on existing segments without
    re-uploading. Handy when iterating on signal weights."""
    if database.get_audio(audio_id) is None:
        raise HTTPException(status_code=404, detail="Audio not found.")
    try:
        await asyncio.to_thread(nlp.score_coded_language, audio_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rescoring failed: {e}")
    return {"success": True, "audioId": audio_id}


# ─── Entities (Ofek — NER + Ghost Nodes) ─────────────────────────────────────

@app.get("/entities")
def list_entities(entity_type: Optional[str] = None):
    entities = database.get_all_entities()
    if entity_type:
        entities = [e for e in entities if e["type"] == entity_type]
    return entities


@app.get("/entities/{entity_id}")
def get_entity(entity_id: int):
    ent = database.get_entity(entity_id)
    if ent is None:
        raise HTTPException(status_code=404, detail="Entity not found.")
    return ent


@app.get("/entities/{entity_id}/mentions")
def get_entity_mentions(entity_id: int):
    if database.get_entity(entity_id) is None:
        raise HTTPException(status_code=404, detail="Entity not found.")
    return database.get_entity_mentions(entity_id)


@app.get("/entities/{entity_id}/related-speakers")
def get_entity_related_speakers(entity_id: int):
    if database.get_entity(entity_id) is None:
        raise HTTPException(status_code=404, detail="Entity not found.")
    return database.get_entity_related_speakers(entity_id)


def _utterers_of_entity(entity_id: int) -> list[int]:
    """Distinct speaker IDs who UTTERED a segment containing this entity —
    who was talking when the name/word was mentioned. Used by both promotion
    paths."""
    mentions = database.get_entity_mentions(entity_id)
    seg_ids = list({m["segmentId"] for m in mentions if m.get("segmentId")})
    utterers: set[int] = set()
    for seg in database.get_segments_by_ids(seg_ids):
        sid = seg.get("speakerId")
        if sid:
            utterers.add(sid)
    return sorted(utterers)


@app.post("/entities/{entity_id}/promote-to-ghost", status_code=201)
def promote_entity_to_ghost(entity_id: int):
    """Analyst-triggered escalation of a mentioned entity onto the network
    graph. Behaviour depends on entity type:

    - PERSON: create a ghost Speaker row + draw 'mentioned' edges from every
      utterer to it. A ghost person is still an identity, just one we don't
      have voice for yet.

    - ORG / LOC / MISC (items): items are NOT speakers, so they don't get
      their own node. Instead, we tag each pair of utterers with the entity
      via EdgeEntityBadges (rendered as edge labels), or attach a solo badge
      to the sole utterer if only one person mentioned it.

    Idempotent in both cases.
    """
    ent = database.get_entity(entity_id)
    if ent is None:
        raise HTTPException(status_code=404, detail="Entity not found.")

    utterers = _utterers_of_entity(entity_id)
    if not utterers:
        raise HTTPException(
            status_code=400,
            detail="Entity has no live mentions — nothing on the graph to attach it to.",
        )

    if ent.get("type") == "PERSON":
        # ─── Ghost speaker path (unchanged) ─────────────────────────────────
        if ent.get("ghostSpeakerId"):
            return {
                "success": True, "kind": "ghost_person",
                "ghostSpeakerId": ent["ghostSpeakerId"], "alreadyPromoted": True,
            }
        ghost_id = database.create_ghost_speaker(entity_id, ent["rawText"])
        if not ghost_id:
            raise HTTPException(status_code=500, detail="Failed to promote entity.")
        edges = 0
        for utterer_id in utterers:
            if utterer_id != ghost_id:
                database.upsert_mention_relation(utterer_id, ghost_id)
                edges += 1
        return {
            "success": True, "kind": "ghost_person",
            "ghostSpeakerId": ghost_id, "alreadyPromoted": False,
            "edgesCreated": edges,
        }

    # ─── Item badge path ────────────────────────────────────────────────────
    # Multi-speaker: pin the item name onto every pair of utterers' edge.
    # Solo: attach the badge to just that speaker's node (SpeakerBId=NULL).
    badges = 0
    if len(utterers) == 1:
        database.upsert_edge_entity_badge(utterers[0], None, entity_id)
        badges = 1
    else:
        for i in range(len(utterers)):
            for j in range(i + 1, len(utterers)):
                database.upsert_edge_entity_badge(utterers[i], utterers[j], entity_id)
                badges += 1
    return {
        "success": True, "kind": "edge_badge",
        "badgesCreated": badges,
        "utterers": utterers,
    }


@app.get("/relations/edge-badges")
def list_edge_entity_badges():
    """Every currently-visible non-person entity attached to an edge or a
    lone speaker. Powers the network graph's item-label rendering."""
    return database.get_all_edge_entity_badges()


@app.delete("/entities/{entity_id}/promote-to-ghost", status_code=200)
def remove_entity_from_graph(entity_id: int):
    """Undo a manual promotion. For PERSON entities: delete the ghost
    Speaker row (its Relations cascade out) and unlink the entity. For
    ORG/LOC/MISC items: wipe every EdgeEntityBadge row that referenced
    this entity. Idempotent — a no-op if the entity was never promoted."""
    ent = database.get_entity(entity_id)
    if ent is None:
        raise HTTPException(status_code=404, detail="Entity not found.")
    removed = 0
    if ent.get("ghostSpeakerId"):
        # PERSON path: drop the ghost Speaker (cascade removes its edges).
        if database.delete_speaker(ent["ghostSpeakerId"]):
            removed += 1
        # Unlink so a future promote creates a fresh ghost.
        with database._get_conn() as conn:
            conn.execute(
                "UPDATE Entities SET GhostSpeakerId = NULL WHERE Id = ?",
                (entity_id,),
            )
            conn.commit()
    # ITEM path: wipe every badge for this entity (works even when this is
    # also a PERSON — no-op if there are none).
    removed += database.delete_edge_entity_badges_for_entity(entity_id)
    return {"success": True, "removed": removed}


@app.post("/entities/{entity_id}/link-wikidata")
def link_entity_wikidata(entity_id: int, body: dict):
    wikidata_id = body.get("wikidataId", "").strip()
    if not wikidata_id:
        raise HTTPException(status_code=422, detail="wikidataId is required.")
    if database.get_entity(entity_id) is None:
        raise HTTPException(status_code=404, detail="Entity not found.")
    database.link_entity_wikidata(entity_id, wikidata_id)
    return {"success": True, "entityId": entity_id, "wikidataId": wikidata_id}


@app.get("/audios/{audio_id}/segment-mentions")
def get_segment_mentions(audio_id: int):
    """Return all EntityMentions for every segment in a given audio (used by TranscriptView)."""
    if database.get_audio(audio_id) is None:
        raise HTTPException(status_code=404, detail="Audio not found.")
    segments = database.get_segments_by_audio(audio_id)
    seg_ids = [s["id"] for s in segments]
    return database.get_mentions_for_segments(seg_ids)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=8001, reload=False)
