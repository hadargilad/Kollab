# Kollab — Secure Intelligence Platform

Upload audio recordings → get a transcript, diarized speaker timeline, voice-fingerprint
matching against known speakers, and a relationship graph of who speaks with whom.
Built for analysts working with intercepted / recorded audio.

## What it does

- **Transcription + diarization** — Whisper for ASR, pyannote for "who spoke when".
- **Voice-fingerprint identity matching** — ECAPA-TDNN embeddings, three-tier match
  (auto / suggest / silent) with per-recording de-collision so the same speaker
  can't be matched twice in one audio.
- **Semantic search** — hybrid BM25 + dense (FAISS) + cross-encoder rerank across
  every transcript; toggle for exact-word match.
- **Entity extraction** — NER for PERSON / ORG / LOC / PHONE / EMAIL / MONEY,
  with ghost-node creation for unknown referenced entities. Analysts can also
  manually promote any entity to the network graph: PERSON entities become
  ghost speaker nodes; ORG/LOC/MISC items render as small badge nodes attached
  to the edges between the speakers who mentioned them.
- **Ghost node resolution** — click any ghost on the graph to either link it
  to an existing speaker (merges with their voice bucket) or create a fresh
  real speaker awaiting voice enrollment.
- **Attribution confirmation** — auto-matches in the 0.60–0.85 confidence
  band get an amber "% match" badge and a ✓ button on the speaker card, so
  analysts can approve the identity and feed the samples back into the voice
  model without needing a perfect match.
- **Coded-language detection** — multi-signal scoring (topic incoherence,
  lexical anomaly, perplexity, coded-phrase similarity to a euphemism
  dictionary) flags suspicious segments.
- **Retroactive rescans** — one-click "Re-scan all" buttons on both settings
  sections apply newly-added flagged keywords and coded-language phrases
  to every previously-processed recording, so historical audio picks up new
  detections without re-uploading.
- **Projects / subgroups** — admins scope analysts to specific speaker
  subgroups so each analyst only sees the data assigned to them. Speakers
  can belong to multiple subgroups; the network graph shows this as a
  ring split into arc segments, one per group.
- **Alerts** — flagged-keyword hits and coded-language detections surface in a
  dedicated tab; click any row to jump to the segment.

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
locally. Use `npm run dev` from the root if you don't need ML running
(useful when browsing existing recordings without re-analysing); use
`cd audio-intel-ui && npm run dev` if you want only Vite (browser) without
Tauri.

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
| **Frontend** | [audio-intel-ui/](audio-intel-ui/) | React 19 + Vite + Tailwind 4 + Tauri (Rust desktop shell) | 5173 | Hand-built UI (no shadcn). Uploads, dashboards, transcript viewer, search, alerts, speaker / project management. |
| **Backend** | [Backend/](Backend/) | Python + FastAPI + SQLite + PyTorch | 8001 | Owns every persistent table. Speaker matching, audio storage, semantic search index (FAISS), NLP detectors (coded-language, NER, entity resolution), projects/subgroups, suggestions, alerts. |
| **ML** | [ml/](ml/) | Python + FastAPI + PyTorch | 8000 | **Stateless** audio analysis only. Whisper transcription, pyannote diarization, ECAPA-TDNN voice fingerprints. Holds no state. |

The rule: Frontend ↔ Backend (8001) only. Backend ↔ ML over HTTP for
analysis. ML never reads/writes its own state.

### Data flow

1. Frontend uploads an audio file to Backend.
2. Backend stores the raw file, calls ML's `/analyze`.
3. ML returns transcript segments + per-speaker 192-dim sliding-window embeddings.
4. Backend matches each speaker against its `SpeakerEmbeddings` table
   (auto-attribute if cosine ≥ 0.60, suggest if ≥ 0.40, silent otherwise).
5. Backend embeds every segment with `bge-small`, indexes in FAISS for search.
6. Backend runs the NLP pipeline (NER → entity resolution → coded-language scoring)
   and writes any Alerts.

### NLP layer (lives entirely in Backend)

| Module | What it does |
|---|---|
| [nlp/semantic_search.py](Backend/nlp/semantic_search.py) | Hybrid BM25 + FAISS + cross-encoder rerank + MMR. Powers `/search/semantic` with `exact_only` flag. |
| [nlp/ner.py](Backend/nlp/ner.py) | Named-entity recognition via HF Transformers. |
| [nlp/entity_resolution.py](Backend/nlp/entity_resolution.py) | Phonetic + string-similarity matching to merge surface forms; promotes unknown entities to ghost-nodes. |
| [nlp/coded_language.py](Backend/nlp/coded_language.py) | Four-signal coded-language detector (perplexity / lexical anomaly / context vector / euphemism similarity). |
| [nlp/euphemism_expansion.py](Backend/nlp/euphemism_expansion.py) | Mines new euphemism candidates from the corpus (bootstrap on `seed_euphemisms.json`). |
| [nlp/reranker.py](Backend/nlp/reranker.py) | Cross-encoder used by semantic search step 6. |

See [Backend/DATABASE.md](Backend/DATABASE.md) for the schema and
[ml/README.md](ml/README.md) for the ML pipeline stages.

---

## Testing

The backend ships with a pytest suite (107 tests) that covers:
- `matcher.py` thresholds and the per-recording de-collision rule
- Speaker identity: unknown-numbering, embedding CAP-trim, FK cascades,
  merge / move-embeddings ordering
- Auth (ID validation, duplicates, password change, force-change lifecycle)
- Group hierarchy invariants and speaker-group bridges
- API-level rename / reassign / suggestion-accept / split flows
- Entity → graph promotion (ghost speakers for PERSON, edge badges for items)
- Confirm-attribution flow for the 0.60–0.85 auto-match band
- Retroactive rescan endpoints for flagged keywords and coded language
- Idempotent init-time migrations (composite UNIQUE on `DangerousWords`,
  category backfill on legacy alerts, entity count refresh, `EdgeEntityBadges`)

Run the whole suite inside the backend container:

```bash
docker compose exec backend python -m pytest tests/ -q
```

Individual files run the same way with `pytest tests/test_foo.py`.
Slow / opt-in tests are marked `@pytest.mark.slow` and skipped by default;
run them with `pytest -m slow`. See [`Backend/tests/conftest.py`](Backend/tests/conftest.py)
for the isolated `db` / `client` fixtures — every test runs against a
throwaway SQLite file with `_USE_TURSO=False` and a tmp `storage.LOCAL_DIR`,
so nothing touches shared cloud state.
