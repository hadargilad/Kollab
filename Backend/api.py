"""
AudioIntel Backend API
======================
Lightweight auth + user management service.
Runs on port 8001. The ML service runs separately on port 8000.
"""

import asyncio
import os
import shutil
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

import database

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


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "AudioIntel backend running", "version": "1.0.0"}


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

    speaker_id_map: dict[str, int] = {}
    for spk in result.get("speakers", []):
        is_known = spk.get("is_known", False)
        voice_id = spk["matched_identity"] if is_known else (spk.get("voice_db_key") or spk["speaker_label"])
        spk_display = spk["matched_identity"] if is_known else spk["speaker_label"]
        db_id, _ = database.get_or_create_speaker(voice_id, spk_display)
        speaker_id_map[spk["speaker_label"]] = db_id

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
):
    original_name = file.filename or "audio"
    display_name = name.strip() or Path(original_name).stem
    suffix = Path(original_name).suffix or ".wav"
    file_id = uuid.uuid4().hex
    save_path = STORAGE_DIR / f"{file_id}{suffix}"

    with save_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    file_size = save_path.stat().st_size
    audio_id = database.create_audio(display_name, description, str(save_path), file_size, uploaded_by)

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


class UpdateSpeakerRequest(BaseModel):
    name: str
    riskLevel: str = "low"


class ReassignSpeakerRequest(BaseModel):
    new_name: str


@app.post("/audios/{audio_id}/speakers/{speaker_id}/reassign", status_code=201)
def reassign_speaker(audio_id: int, speaker_id: int, body: ReassignSpeakerRequest):
    new_speaker = database.reassign_speaker_in_audio(audio_id, speaker_id, body.new_name.strip() or "Unknown")
    if not new_speaker:
        raise HTTPException(status_code=500, detail="Failed to create new speaker.")
    return new_speaker


@app.put("/speakers/{speaker_id}")
def update_speaker(speaker_id: int, body: UpdateSpeakerRequest):
    ok = database.update_speaker(speaker_id, body.name, body.riskLevel)
    if not ok:
        raise HTTPException(status_code=404, detail="Speaker not found.")
    return {"success": True}


# ─── Relations ────────────────────────────────────────────────────────────────

@app.get("/relations")
def list_relations():
    return database.get_all_relations()


# ─── Alerts ───────────────────────────────────────────────────────────────────

@app.get("/alerts")
def list_alerts():
    return database.get_all_alerts()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=8001, reload=False)
