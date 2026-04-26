"""
AudioIntel ML API
=================
Pure analysis service — does NOT store any files or data.
The C# Backend is responsible for all storage.

Endpoints:
  POST /analyze           — analyze audio → transcript + speaker IDs (temp file, deleted after)
  POST /speakers/add      — add a known speaker from a raw audio sample
  PATCH /speakers/rename  — rename a speaker in the voice DB
  GET  /speakers          — list all known speakers
  DELETE /speakers/{name} — remove a speaker from the voice DB
"""

import os
import shutil
import tempfile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pipeline import process_audio, add_known_speaker, load_voices_db, save_voices_db

app = FastAPI(title="AudioIntel ML API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/")
def health_check():
    return {"status": "AudioIntel ML service is running", "version": "2.0.0"}


# ─── Audio Analysis ───────────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    """
    Analyze an audio file and return the results.
    The file is processed in memory and deleted immediately — nothing is stored here.
    The C# Backend is responsible for saving the file and the results.

    Returns:
    {
      "original_filename": "rec.mp3",
      "num_speakers": 2,
      "speakers": [
        {
          "speaker_label": "SPEAKER_00",
          "matched_identity": "Lewis Hamilton",
          "confidence": 0.87,
          "is_known": true,
          "total_duration": 45.3,
          "segments": [
            {"start": 0.0, "end": 4.5, "text": "We need to discuss..."}
          ]
        }
      ]
    }
    """
    suffix = os.path.splitext(file.filename or "audio")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        result = process_audio(tmp_path)

        # Add total speaking duration per speaker
        for speaker in result.get("speakers", []):
            total = sum(s["end"] - s["start"] for s in speaker.get("segments", []))
            speaker["total_duration"] = round(total, 2)

        result["original_filename"] = file.filename or "unknown"
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ─── Speaker Voice DB ─────────────────────────────────────────────────────────

@app.post("/speakers/add")
async def add_speaker(name: str = Form(...), file: UploadFile = File(...)):
    """
    Register a known speaker in the voice database from a raw audio sample.
    Best with a clean, single-speaker recording (10–30 seconds).
    """
    suffix = os.path.splitext(file.filename or "audio")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        add_known_speaker(name, tmp_path)
        db = load_voices_db()
        return {
            "status": "ok",
            "message": f"Speaker '{name}' added successfully.",
            "sample_count": len(db.get(name, []))
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


class RenameRequest(BaseModel):
    old_name: str
    new_name: str


@app.patch("/speakers/rename")
def rename_speaker(body: RenameRequest):
    """
    Rename a speaker in the voice database.
    Called by the Backend when a user manually corrects a name in the UI.
    """
    db = load_voices_db()
    if body.old_name not in db:
        raise HTTPException(status_code=404, detail=f"Speaker '{body.old_name}' not found.")

    if body.new_name in db:
        # Merge embeddings if the new name already exists
        db[body.new_name] = db[body.new_name] + db[body.old_name]
    else:
        db[body.new_name] = db[body.old_name]

    del db[body.old_name]
    save_voices_db(db)
    return {"status": "ok", "message": f"Renamed '{body.old_name}' → '{body.new_name}'."}


@app.get("/speakers")
def list_speakers():
    """List all known speakers in the voice database."""
    db = load_voices_db()
    return {
        "count": len(db),
        "speakers": [
            {"name": name, "sample_count": len(embeddings)}
            for name, embeddings in db.items()
        ]
    }


@app.delete("/speakers/{name}")
def delete_speaker(name: str):
    """Remove a speaker from the voice database."""
    db = load_voices_db()
    if name not in db:
        raise HTTPException(status_code=404, detail=f"Speaker '{name}' not found.")
    del db[name]
    save_voices_db(db)
    return {"status": "ok", "message": f"Speaker '{name}' removed."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=False)
