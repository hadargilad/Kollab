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


class CreateGroupRequest(BaseModel):
    name: str
    color: str = "#6366f1"

class UpdateGroupRequest(BaseModel):
    name: str
    color: str = "#6366f1"

class AddGroupMemberRequest(BaseModel):
    speaker_id: int


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
def list_audios():
    return database.get_all_audios()


@app.get("/audios/{audio_id}")
def get_audio(audio_id: int):
    audio = database.get_audio(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found.")
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
def get_segments(audio_id: int):
    return database.get_segments_by_audio(audio_id)


# ─── Speakers ─────────────────────────────────────────────────────────────────

@app.get("/speakers")
def list_speakers():
    return database.get_all_speakers()


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
        return result

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
    group_id = database.create_group(body.name, body.color)
    groups = {g["id"]: g for g in database.get_all_groups()}
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=500, detail="Group creation failed.")
    return group

@app.put("/groups/{group_id}")
def update_group(group_id: int, body: UpdateGroupRequest):
    ok = database.update_group(group_id, body.name, body.color)
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


# ─── Alerts ───────────────────────────────────────────────────────────────────

@app.get("/alerts")
def list_alerts():
    return database.get_all_alerts()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=8001, reload=False)
