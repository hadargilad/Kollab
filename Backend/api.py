"""
AudioIntel Backend API
======================
Lightweight auth + user management service.
Runs on port 8001. The ML service runs separately on port 8000.
"""

import asyncio
import json
import os
import shutil
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
from enrichment_provider import ProviderNotConfiguredError
import enrichment_providers
import nlp
from nlp import euphemism_expansion as _euphemism_expansion
from nlp import models as _nlp_models

ML_URL = os.getenv("ML_API_URL", "http://127.0.0.1:8000")

if os.getenv("AUDIO_STORAGE_DIR"):
    STORAGE_DIR = Path(os.environ["AUDIO_STORAGE_DIR"])
else:
    try:
        from platformdirs import user_data_dir
        STORAGE_DIR = Path(user_data_dir("AudioIntel")) / "uploads"
    except ImportError:
        STORAGE_DIR = Path.home() / ".audio-intel" / "uploads"

STORAGE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="AudioIntel Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
    return {"status": "AudioIntel backend running", "version": "1.0.0"}


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


def _scan_for_dangerous_words(audio_id: int) -> None:
    """Check all segments of audio_id against flagged keywords and create alerts."""
    words = database.get_dangerous_words()
    if not words:
        return
    segments = database.get_segments_by_audio(audio_id)
    seen: set[int] = set()
    for word_row in words:
        if word_row["id"] in seen:
            continue
        needle = word_row["word"].lower()
        for seg in segments:
            if needle in (seg["text"] or "").lower():
                database.create_alert(
                    word_row["severity"],
                    f'Flagged keyword "{word_row["word"]}" detected in audio {audio_id}',
                    related_audio_id=audio_id,
                )
                seen.add(word_row["id"])
                break


async def _run_ml_and_save(audio_id: int, save_path: Path, original_name: str) -> None:
    """Background task: call ML service, persist results, update audio status."""
    _audio_progress[audio_id] = {"pct": 0, "label": "Queued…"}
    stop_event = asyncio.Event()
    poll_task = asyncio.create_task(_poll_ml_progress(audio_id, stop_event))

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            with save_path.open("rb") as f:
                ml_response = await client.post(
                    f"{ML_URL}/analyze",
                    files={"file": (original_name, f, "audio/mpeg")},
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
    save_path = STORAGE_DIR / f"{file_id}{suffix}"

    with save_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    file_size = save_path.stat().st_size
    audio_id = database.create_audio(
        display_name, description, str(save_path), file_size, uploaded_by, recorded_at.strip()
    )

    background_tasks.add_task(_run_ml_and_save, audio_id, save_path, original_name)

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
    # Remove file from disk if it exists
    try:
        Path(audio["filePath"]).unlink(missing_ok=True)
    except Exception:
        pass
    return {"success": ok}


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
            try:
                Path(audio["filePath"]).unlink(missing_ok=True)
            except Exception:
                pass
            deleted.append(aid)
        else:
            failed.append({"id": aid, "reason": "delete failed"})
    return {"deleted": deleted, "failed": failed}


@app.get("/audios/{audio_id}/file")
def get_audio_file(audio_id: int):
    audio = database.get_audio(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found.")
    path = Path(audio["filePath"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk.")
    suffix = path.suffix.lower()
    media_type = {
        ".mp3": "audio/mpeg", ".wav": "audio/wav",
        ".m4a": "audio/mp4", ".ogg": "audio/ogg",
    }.get(suffix, "audio/mpeg")
    return FileResponse(str(path), media_type=media_type)


@app.post("/audios/{audio_id}/retry", status_code=202)
async def retry_audio(audio_id: int, background_tasks: BackgroundTasks):
    audio = database.get_audio(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found.")
    if audio["status"] == "processing":
        raise HTTPException(status_code=409, detail="Already processing.")
    save_path = Path(audio["filePath"])
    if not save_path.exists():
        raise HTTPException(status_code=404, detail="Audio file no longer on disk.")
    database.update_audio_result(audio_id, "processing")
    background_tasks.add_task(_run_ml_and_save, audio_id, save_path, save_path.name)
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


# Speaker pictures live inside STORAGE_DIR/speaker_images/ so they share the
# same on-disk root as audio uploads. We accept jpg/png/webp.
_SPEAKER_IMG_DIR = STORAGE_DIR / "speaker_images"
_SPEAKER_IMG_DIR.mkdir(parents=True, exist_ok=True)
_ALLOWED_IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


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
                headers={"User-Agent": "AudioIntel/1.0 (profile image fetch)"},
            ) as c:
                r = c.get(url)
        except httpx.HTTPError:
            return
        if r.status_code != 200 or not r.content:
            return
        fname = f"speaker_{speaker_id}_{uuid.uuid4().hex[:8]}{ext}"
        dest = _SPEAKER_IMG_DIR / fname
        dest.write_bytes(r.content)
        database.set_speaker_image_path(speaker_id, fname)
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
    # Remove an existing image so we don't leak stale files when ext changes.
    if spk.get("imagePath"):
        old = _SPEAKER_IMG_DIR / spk["imagePath"]
        if old.exists():
            try:
                old.unlink()
            except OSError:
                pass
    fname = f"speaker_{speaker_id}_{uuid.uuid4().hex[:8]}{ext}"
    dest = _SPEAKER_IMG_DIR / fname
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    database.set_speaker_image_path(speaker_id, fname)
    return {"success": True, "imagePath": fname}


@app.delete("/speakers/{speaker_id}/image")
def delete_speaker_image(speaker_id: int):
    spk = database.get_speaker(speaker_id)
    if not spk:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    if spk.get("imagePath"):
        f = _SPEAKER_IMG_DIR / spk["imagePath"]
        if f.exists():
            try:
                f.unlink()
            except OSError:
                pass
    database.set_speaker_image_path(speaker_id, None)
    return {"success": True}


@app.get("/speakers/{speaker_id}/image")
def get_speaker_image(speaker_id: int):
    spk = database.get_speaker(speaker_id)
    if not spk or not spk.get("imagePath"):
        raise HTTPException(status_code=404, detail="No image for speaker.")
    f = _SPEAKER_IMG_DIR / spk["imagePath"]
    if not f.exists():
        raise HTTPException(status_code=404, detail="Image file missing on disk.")
    return FileResponse(str(f))


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
    new_name: str = ""  # empty → auto-generate "Speaker N"


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


async def _embeddings_for_ranges(audio_path: Path, ranges: list[tuple[float, float]]) -> tuple[np.ndarray, str]:
    """POST the audio + ranges to ML's /speakers/embed-from-ranges and return
    (embeddings, model_version). Raises HTTPException on ML failure."""
    if not ranges:
        return np.zeros((0, 192), dtype=np.float32), "ecapa-tdnn-v1"
    ranges_json = json.dumps([[float(s), float(e)] for s, e in ranges])
    with audio_path.open("rb") as f:
        async with httpx.AsyncClient(timeout=300.0) as client:
            ml_response = await client.post(
                f"{ML_URL}/speakers/embed-from-ranges",
                files={"file": (audio_path.name, f, "audio/mpeg")},
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
    audio_path = Path(audio["filePath"])
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file no longer on disk.")

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
    new_embeddings, model_version = await _embeddings_for_ranges(audio_path, moved_ranges)
    if new_embeddings.size == 0:
        raise HTTPException(
            status_code=400,
            detail="Selected segments produced no usable embeddings (probably too short).",
        )
    remaining_embeddings, _ = await _embeddings_for_ranges(audio_path, remaining_ranges) if remaining_ranges else (np.zeros((0, 192), dtype=np.float32), model_version)

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
    return {"success": True, "merged": False}


# ─── Speaker Enrollment + Suggestions ─────────────────────────────────────────

async def _enroll_from_audio(name: str, file: UploadFile) -> tuple[int, int]:
    """Shared enrollment plumbing: ML embed + persist + cap-trim.
    Returns (speaker_id, rows_inserted). Raises HTTPException on failure."""
    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty.")

    original_name = file.filename or "audio"
    file_bytes = await file.read()

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            ml_response = await client.post(
                f"{ML_URL}/speakers/embed",
                files={"file": (original_name, file_bytes, file.content_type or "audio/mpeg")},
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
    speaker_id: int,
    entityId: str = Form(...),
    name: str = Form(...),
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
    reused = False
    if existing:
        if existing["id"] == speaker_id:
            raise HTTPException(status_code=400, detail="Cannot link a speaker to themselves.")
        new_speaker_id = existing["id"]
        reused = True
    else:
        if file is None or not getattr(file, "filename", ""):
            raise HTTPException(
                status_code=400,
                detail="Audio file is required when adding a new speaker.",
            )
        new_speaker_id, _ = await _enroll_from_audio(name, file)
        try:
            database.set_wikidata_id(new_speaker_id, entityId)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))

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
    try:
        return database.add_dangerous_word(word, body.severity, body.created_by)
    except Exception:
        raise HTTPException(status_code=409, detail="Word already exists.")


@app.delete("/dangerous-words/{word_id}")
def delete_dangerous_word(word_id: int):
    ok = database.delete_dangerous_word(word_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Word not found.")
    return {"success": True}


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
    row = database.add_euphemism(
        phrase=phrase,
        severity=body.severity,
        auto_learned=False,
        confidence=None,
        embedding=embedding,
        embedding_model=embedding_model,
        created_by=body.created_by,
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
