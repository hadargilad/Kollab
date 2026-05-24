# AudioIntel — Secure Intelligence Platform

Upload audio recordings → get a transcript, diarized speaker timeline, voice-fingerprint
matching against known speakers, and a relationship graph of who speaks with whom.
Built for analysts working with intercepted / recorded audio.

---

## Run it

**Docker Desktop must be running before any of these commands.** Pick web mode
(everything in Docker) or desktop mode (Tauri window) — both share the same
backend + ML services.

### First-time setup after a fresh clone

```bash
# Build + start backend & ML in one go (~5 min on first build, cached after).
docker compose up backend ml -d --build
```

To replay the shared demo dataset (same Formula 1 audios, speakers, groups,
and alerts everyone else has) — one chained line:

```bash
docker compose stop backend && docker compose run --rm backend python -m scripts.restore && docker compose start backend
```

The restore needs the backend stopped so SQLite is unlocked; the `&&` chain
restarts it for you. Skip it if you'd rather start with an empty DB.

### Day-to-day — web mode (everything in Docker)

```bash
docker compose up frontend backend ml -d
```

Open <http://localhost:5173>. Stop everything with `docker compose down`.

### Day-to-day — desktop mode (native Tauri window)

Requires a one-time host-side install of [Node.js 20+](https://nodejs.org/) and
[Rust](https://rustup.rs/), plus on Windows the
[WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
(pre-installed on Win 10/11) and the MSVC C++ Build Tools.

```bash
# one-time
cd audio-intel-ui
npm install
cd ..

# every run
npm run dev:ml
```

`dev:ml` brings up Backend + ML in Docker and launches the Tauri window
locally. Use `npm run dev` if you only want the frontend.

### What to expect on first run

- **ML container** downloads Whisper-medium (~1.4 GB), pyannote (~30 MB),
  and ECAPA-TDNN (~80 MB). Cached on the `ml_models` Docker volume.
  Watch progress with `docker compose logs -f ml` — service is ready when
  you see `✅ All models loaded.`
- **Backend** downloads the NLP models on first warm-up: `bge-small-en-v1.5`
  (~130 MB) + `distilgpt2` (~330 MB). Cached on the backend's data volume.
  Watch with `docker compose logs -f backend` — ready when you see
  `[nlp.models] warm-up complete`.
- **Tauri** compiles the Rust shell on first launch (~2–5 min). Cached after.
- Audio analysis on CPU runs **~3× real-time** (Whisper-medium is the bottleneck)
  — expect ~5–8 min per 2-minute clip.

### Default credentials

The DB seeds two accounts the first time it boots. After `restore` your seeded
users still exist (the snapshot deliberately omits user accounts), so these
credentials always work:

| Role    | Username   | Password   | Notes                               |
|---------|------------|------------|-------------------------------------|
| Admin   | `admin`    | `Aa!12345` | Full access                         |
| Analyst | `analyst`  | `1234`     | Must change password on first login |

Create more analysts in **User Management** (admin only). Assign them to a
subgroup via **/projects/&lt;id&gt;** → click an analyst row next to the
subgroup you want them to see.

### Sharing your local state with teammates — snapshot

Your local uploads, speakers, groups, dictionary, and alerts live in the
backend's Docker volume — they're not committed by default. To publish them:

```bash
# Backend running:
docker compose exec backend python -m scripts.snapshot

git add Backend/snapshot/
git commit -m "snapshot: <what changed>"
git push
```

`snapshot.py` exports every Speaker / Audio / Segment / SpeakerEmbedding /
Relation / SpeakerGroup / SpeakerGroupMembers / DangerousWord / Alert into
`Backend/snapshot/state.json`, and copies the actual audio files into
`Backend/snapshot/audios/audio_<id>.<ext>`. Two things are deliberately
excluded:

- **User accounts** — each contributor keeps their own login.
- **ProjectAssignments** — analyst↔subgroup links reference user IDs that
  don't exist on a teammate's machine. Reassign analysts on `/projects/<id>`
  after restoring.

Teammates pull and restore exactly as in step 3 of *First-time setup*. Restore
wipes only the snapshot-covered tables, then replays your captured state.

---

## Architecture

Three services, each in its own folder:

| Service | Folder | Stack | Port | Role |
|---------|--------|-------|------|------|
| **Frontend** | [audio-intel-ui/](audio-intel-ui/) | React 19 + Vite + Tailwind + Tauri (Rust desktop shell) | 5173 | UI — uploads, dashboards, transcript viewer, speaker management |
| **Backend** | [Backend/](Backend/) | Python + FastAPI + SQLite | 8001 | Auth, user management, audio storage, **speaker identity matching**, segments, relations, alerts |
| **ML** | [ml/](ml/) | Python + FastAPI + PyTorch | 8000 | **Stateless** audio analysis — Whisper transcription, pyannote diarization, ECAPA-TDNN voice fingerprints. Holds no state. |

The Backend owns all persistent state. The ML service is pure analysis: it
returns transcripts and embeddings, and the Backend decides identities and
stores everything in SQLite.

See [Backend/DATABASE.md](Backend/DATABASE.md) for the schema and
[ml/README.md](ml/README.md) for the ML pipeline stages.
