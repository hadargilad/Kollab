# AudioIntel — Secure Intelligence Platform

Upload audio recordings → get a transcript, diarized speaker timeline, voice-fingerprint
matching against known speakers, and a relationship graph of who speaks with whom.
Built for analysts working with intercepted / recorded audio.

---

## Run it

**Docker Desktop must be running before any of these commands.** The frontend
can run two ways — pick one.

### Web mode (everything in Docker, fastest to start)

Use this for day-to-day work and verification. No host-side toolchain needed
beyond Docker.

```bash
docker compose up frontend backend ml -d
```

Then open <http://localhost:5173>. To stop:

```bash
docker compose down
```

### Desktop mode (native Tauri window)

Use this when you want the packaged desktop app. Requires a one-time host-side
install of [Node.js 20+](https://nodejs.org/) and [Rust](https://rustup.rs/),
plus on Windows the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
(pre-installed on Win 10/11) and the MSVC C++ Build Tools.

```bash
# one-time
cd audio-intel-ui && npm install && cd ..

# every run
npm run dev:ml
```

`dev:ml` brings up Backend + ML in Docker and launches the Tauri window
locally. Use `npm run dev` instead if you don't need the ML service yet.

### What to expect on first run

- ML container downloads **Whisper-medium (~1.4 GB)**, pyannote (~30 MB),
  and ECAPA-TDNN (~80 MB). Cached on the `ml_models` Docker volume afterwards.
  Watch progress with `docker logs -f audiointel-ml-1` — the service is fully
  ready when you see `✅ All models loaded.`
- First Tauri launch compiles the Rust shell (~2–5 min). Cached afterwards.
- Audio analysis on CPU runs **~3× real-time** (Whisper-medium is the bottleneck) —
  expect ~5–8 min per 2-minute clip.

### Default credentials

| Role    | Username   | Password   | Notes                               |
|---------|------------|------------|-------------------------------------|
| Admin   | `admin`    | `Aa!12345` | Full access                         |
| Analyst | `analyst`  | `1234`     | Must change password on first login |

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
