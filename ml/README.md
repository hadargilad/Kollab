# AudioIntel ML Service

Python-based ML pipeline for audio transcription, speaker diarization, voice fingerprinting, and cross-matching.

## Setup

```bash
cd ml
/opt/homebrew/bin/python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Run the API server

```bash
source venv/bin/activate
python api.py
# Server runs on http://localhost:8000
```

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/analyze` | Upload audio → get transcript + speaker IDs |
| POST | `/speakers/add` | Register a new known speaker |
| GET | `/speakers` | List all known speakers |
| DELETE | `/speakers/{name}` | Remove a speaker |

## How it works

1. **Whisper** transcribes the audio with timestamps
2. **pyannote** separates who spoke when (diarization)
3. Transcript segments are aligned with speaker labels
4. **resemblyzer** extracts a 256-dim voice embedding per speaker
5. Each embedding is compared (cosine similarity) against the known-speakers DB
6. Match threshold: 0.82 (82% similarity = same person)
