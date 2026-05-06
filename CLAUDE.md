# CLAUDE.md

Read this before changing anything. It's invariants and gotchas — for the
"what is this project" overview see [README.md](README.md), and for running
instructions see the same.

## Three services, one rule

- **Frontend** ([audio-intel-ui/](audio-intel-ui/)) — React 19 + Vite + Tailwind 4 + shadcn (Radix). Runs as web (Docker, port 5173) or as a Tauri desktop app.
- **Backend** ([Backend/](Backend/)) — Python + FastAPI + SQLite. **Owns all persistent state** — users, audios, segments, speakers, voice vectors, suggestions, relations, alerts.
- **ML** ([ml/](ml/)) — Python + FastAPI + PyTorch. **Stateless.** Whisper + pyannote + ECAPA-TDNN. Returns analysis results, never reads or writes its own DB.

**The rule:** the Frontend talks only to Backend (port 8001). The Backend
talks to ML over HTTP (`ML_API_URL`). ML never holds state. If you find
yourself adding storage to ML, you're going the wrong direction.

## Speaker recognition (read this before touching matching code)

Voice vectors live in Backend SQLite (`SpeakerEmbeddings` BLOB column).
**NOT** in a pickle, **NOT** in Qdrant — earlier branches tried both, neither
shipped to `main`. ML's `/analyze` returns
`speakers: [{ embeddings: [[…192…], …], segments: [...] }]`. Backend's
`Backend/matcher.py` decides identities.

Three-tier match (`AUTO_MATCH_THRESHOLD = 0.60`, `SUGGEST_THRESHOLD = 0.40`,
`LEARN_THRESHOLD = 0.85` — all in `Backend/matcher.py`):

| Cosine | What happens |
|---|---|
| ≥ 0.60 | Auto-attribute the segments. If ≥ 0.85, also append the query windows so the bucket sharpens. |
| 0.40 – 0.60 | Create a fresh "Speaker N" unknown to hold the segments + write a `SpeakerSuggestions` row. UI shows a Confirm / Different-person banner. |
| < 0.40 | Silent new unknown. |

Per-recording de-collision via the `taken_speaker_ids` set in
`match_or_register` — once a speaker has been matched in this recording, no
other speaker in the same recording can match them.

Cap of **50 windows per speaker**, oldest-evicted (`CAP_SAMPLES_PER_SPEAKER`
in `Backend/database.py`). Auto-trim runs inside `insert_embeddings`, so just
calling that function keeps the bucket bounded.

New unknowns are auto-named **"Speaker 1", "Speaker 2", …** by
`database.create_unknown_speaker()` — `MAX(numeric part of "Speaker N") + 1`.
Renames don't recycle live numbers; deleting the highest one frees its
number for reuse (rare and acceptable).

## Mergers and FK cascades — gotcha

`merge_speakers(source, target)` deletes the source row, which cascades-out
its `SpeakerEmbeddings` rows via the FK. **Always call
`database.move_embeddings(source, target)` first** to repoint embeddings
before the source is deleted. Both rename-collision and accept-suggestion
paths in `Backend/api.py` already do this — preserve the order if you touch
those flows.

## Pipeline tuning ([ml/pipeline.py](ml/pipeline.py)) — don't change casually

| Constant | Value | Why |
|---|---:|---|
| Pyannote `clustering.threshold` | `0.35` | Aggressive over-split — relies on Step 4.5 to merge same-speaker clusters back. Lowering further can split single people; raising tends to merge same-family voices. |
| `MERGE_THRESHOLD` (Step 4.5) | `0.85` | Within-recording mean-pool merge. Different from cross-recording matching, which is symmetric max-pool. |
| `MIN_SEGMENT_DURATION` | `1.5s` | Below this, ECAPA quality degrades. Fallback path takes top-5 of anything if nothing passes. |
| `MAX_AUDIO_BUDGET` | `60.0s` | Stop adding speech to the embedding stage once we have enough. |
| Whisper model | `medium` | Real ASR-quality lever vs `base`. Adds ~1.5 GB RAM at startup. |
| `WINDOW_SIZE` / `WINDOW_HOP` | `5.0s` / `2.5s` | ECAPA window sliding params. |

## Schema reference

See [Backend/DATABASE.md](Backend/DATABASE.md) for the full SQLite schema.
Two tables you'll touch most:

- `SpeakerEmbeddings` — `(SpeakerId FK CASCADE, Vector BLOB, Dim, ModelVersion, SourceAudioId FK SET NULL, EnrolledAt)`. `SourceAudioId` is what lets the split flow re-extract embeddings per audio without nuking the speaker's bucket from other recordings.
- `SpeakerSuggestions` — `(AudioId FK CASCADE, UnknownSpeakerId FK CASCADE, SuggestedSpeakerId FK CASCADE, Confidence, CreatedAt)`. CASCADE on all three FKs handles every possible "underlying row went away" case without orphans.

## Key endpoints

**ML (8000)** — see [ml/README.md](ml/README.md) for the full pipeline stages.
- `POST /analyze` — segments + per-speaker `embeddings: [[…192…], …]`
- `POST /speakers/embed` — stateless embedding for an enrollment clip
- `POST /speakers/embed-from-ranges` — slice audio to time ranges (used by Backend's split flow)

**Backend (8001)** — auth + state owner.
- `POST /audios/upload` — `recorded_at` (datetime) is **required**
- `POST /speakers/enroll` — calls ML's `/speakers/embed`, persists vectors
- `POST /audios/{id}/speakers/{sid}/split` — manual split, re-extracts via ML
- `GET /audios/{id}/suggestions` + `POST .../accept` + `DELETE .../{sid}` — suggestion CRUD. **Accept always merges globally** (deletes the unknown row).

## Repo conventions

- **Commit message style** — `JIRA-CODES: short summary` (e.g. `AUD-31 AUD-32: …`). Multi-line body as bullets.
- **NEVER add `Co-Authored-By: Claude …`** to commit messages. User preference, applies to every commit in this repo.
- **Branch naming** — `<user>/feat/<short-description>` (e.g. `ofirmenda/feat/aud-31-32-vectors-matching`).
- **Don't `git add -A` or `git add .`** — list files explicitly to avoid sucking in large binaries, secrets, or stray dev artifacts.
- **`samples/`** is real audio test recordings (committed intentionally; not gitignored).

## Running

See [README.md](README.md). TL;DR:
- **All-Docker (web):** `docker compose up frontend backend ml -d` → http://localhost:5173
- **Desktop (Tauri):** `npm run dev:ml` from project root (one-time `cd audio-intel-ui && npm install && cd ..` first)

## Where deeper docs live

- [README.md](README.md) — what this is + running instructions + arch table
- [Backend/DATABASE.md](Backend/DATABASE.md) — SQLite schema + speaker identity flow
- [ml/README.md](ml/README.md) — ML pipeline stages, endpoints, response shapes
- [audio-intel-ui/README.md](audio-intel-ui/README.md) — frontend stack, scripts, where things live
