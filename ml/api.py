"""
AudioIntel ML API
=================
Pure stateless analysis service. Holds no DB and persists nothing.

Endpoints:
  POST /analyze         — analyze audio → transcript + per-speaker window embeddings
  POST /speakers/embed  — extract per-window embeddings for an enrollment clip
"""

import json
import os
import shutil
import tempfile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from pipeline import (
    process_audio,
    extract_embeddings_only,
    extract_embeddings_for_ranges,
    EMBEDDING_MODEL_VERSION,
)

app = FastAPI(title="AudioIntel ML API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/")
def health_check():
    return {"status": "AudioIntel ML service is running", "version": "3.0.0"}


@app.get("/status")
def ml_status():
    """Returns current processing step so the backend can relay it to the UI."""
    import pipeline as p
    return {"pct": p._progress["pct"], "label": p._progress["label"]}


# ─── Audio Analysis ───────────────────────────────────────────────────────────

@app.post("/analyze")
def analyze_audio(file: UploadFile = File(...)):
    """
    Analyze an audio file and return per-speaker window embeddings + segments.
    The file is processed in memory and deleted immediately — nothing is stored here.
    The Backend is responsible for matching, persistence, and identity decisions.

    Response shape:
    {
      "file": "rec.mp3",
      "original_filename": "rec.mp3",
      "num_speakers": 2,
      "model_version": "ecapa-tdnn-v1",
      "speakers": [
        {
          "speaker_label": "SPEAKER_00",
          "embeddings":    [[...192 floats...], [...192 floats...], ...],
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


# ─── Speaker Enrollment (stateless) ───────────────────────────────────────────

@app.post("/speakers/embed")
def embed_speaker(file: UploadFile = File(...)):
    """Stateless: returns ECAPA-TDNN sliding-window embeddings for the audio.
    Best with a clean, single-speaker recording (10–30 seconds).
    The Backend stores the result in SpeakerEmbeddings — no persistence here.

    Response: {"embeddings": [[...192...], ...], "model_version": "ecapa-tdnn-v1"}
    """
    suffix = os.path.splitext(file.filename or "audio")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        windows = extract_embeddings_only(tmp_path)
        return {
            "embeddings":    windows.tolist(),
            "model_version": EMBEDDING_MODEL_VERSION,
            "sample_count":  int(windows.shape[0]),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


@app.post("/speakers/embed-from-ranges")
def embed_from_ranges(
    file: UploadFile = File(...),
    ranges: str = Form(...),
):
    """Extract embeddings for the audio sliced to the given time ranges.

    `ranges` is a JSON array like `[[0.5, 4.2], [10.0, 13.7]]` (seconds).
    Used by Backend's split-speaker flow to re-extract clean embeddings
    after a manual segment reassignment.
    """
    try:
        parsed = json.loads(ranges)
        windows: list[tuple[float, float]] = [(float(s), float(e)) for s, e in parsed]
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="`ranges` must be JSON like [[start, end], ...]")
    if not windows:
        raise HTTPException(status_code=400, detail="`ranges` cannot be empty")

    suffix = os.path.splitext(file.filename or "audio")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        embeddings = extract_embeddings_for_ranges(tmp_path, windows)
        return {
            "embeddings":    embeddings.tolist(),
            "model_version": EMBEDDING_MODEL_VERSION,
            "sample_count":  int(embeddings.shape[0]),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=False)
