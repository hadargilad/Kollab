# AudioIntel ML Service

Stateless audio analysis. Given an audio file the service returns a transcript,
diarized speaker turns, and per-speaker voice fingerprints. It does **not**
match identities or store anything — that's the Backend's job.

Runs in Docker as part of the project stack — see the [root README](../README.md).
First container start pulls Whisper-medium (~1.5 GB) and ECAPA-TDNN (~80 MB);
both are cached on the `ml_models` volume afterwards.

## Endpoints

| Method | Endpoint          | Description |
|--------|-------------------|-------------|
| GET    | `/`               | Health check |
| GET    | `/status`         | Current pipeline progress (`{ pct, label }`) — Backend polls this during `/analyze` |
| POST   | `/analyze`        | Audio file → transcript + per-speaker N×192 sliding-window embeddings + segments |
| POST   | `/speakers/embed` | Audio file → list of 192-dim embeddings (no storage). Used by Backend's `/speakers/enroll`. |

## Pipeline — what each stage does

The pipeline runs end-to-end inside `process_audio` in
[pipeline.py](pipeline.py). Stages execute sequentially; the same denoised
audio is reused so models load cheaply.

| Stage | What it does | Model / library | Output | Tunable |
|-------|--------------|-----------------|--------|---------|
| **0. Preprocess** | Resample to 16 kHz mono → loudness-normalize → spectral-gate noise reduction → 85/3400 Hz biquad bandpass | `torchaudio` + `noisereduce` | One denoised waveform reused by all later stages | — |
| **1. Transcribe** | Detect speech, transcribe with timestamps | OpenAI Whisper, `medium` (~769 M params) | List of `{start, end, text}` segments | Model size at [pipeline.py L67](pipeline.py#L67) |
| **2. Diarize** | "Who spoke when" — split audio into labeled speaker turns. Tuned to over-split slightly so distinct people aren't collapsed; over-splits are healed in stage 4.5. | pyannote `speaker-diarization-3.1` | List of `(start, end, SPEAKER_NN)` triples | `clustering.threshold = 0.45`, `min_cluster_size = 1` at [pipeline.py L80-88](pipeline.py#L80-L88) |
| **3. Align** | Tag each Whisper segment with the diarization label that owns its midpoint | pure Python | `dict[label → list of segments]` | — |
| **4. Embed** | For each speaker label: greedy-fill segments ≥ 1.5s sorted longest-first up to a 60 s audio budget, concatenate them, slide a 5 s / 2.5 s-hop window over the result, run ECAPA-TDNN per window. Carry both the **window stack** (returned to Backend) and a **mean-pooled vector** (used by stage 4.5). Very short clips (no segment ≥ 1.5s) fall back to the 5 longest of whatever's there. | SpeechBrain `spkrec-ecapa-voxceleb` (ECAPA-TDNN, 192-dim) | `dict[label → ndarray (N, 192)]` + `dict[label → ndarray (192,)]` | `MIN_SEGMENT_DURATION`, `MAX_AUDIO_BUDGET`, `WINDOW_SIZE`, `WINDOW_HOP` at [pipeline.py L57-62](pipeline.py#L57-L62) |
| **4.5. Heal over-splits** | Pairwise cosine on the mean embeddings; union-find merge any pair ≥ 0.85. The label with the most speaking time wins as the canonical name; window stacks are concatenated. Catches "interviewer at start + interviewer at end → SPEAKER_00 + SPEAKER_02". | pure Python (`_merge_similar_clusters`) | Same dicts, fewer keys | `MERGE_THRESHOLD` at [pipeline.py L61](pipeline.py#L61) |
| **5. Package** | Build the `/analyze` response: per speaker, the diarization label + segments + the full N×192 window stack. Backend does the matching from here. | — | JSON with `model_version: "ecapa-tdnn-v1"` | — |

### Identity matching is NOT here

In v3 the ML service is stateless — `process_audio` returns raw window
embeddings and the Backend's `matcher.py` decides who matches whom. Pickle DB,
`/speakers/add`, `/speakers/rename`, `/speakers/{name}` are gone.

See [Backend/DATABASE.md](../Backend/DATABASE.md) → "Speaker Identity Flow" for
the matching tiers (auto-match ≥ 0.60, suggest 0.40–0.60, new < 0.40) and
`SpeakerEmbeddings` storage details.

## Response shape — `/analyze`

```json
{
  "file": "rec.mp3",
  "original_filename": "rec.mp3",
  "num_speakers": 2,
  "model_version": "ecapa-tdnn-v1",
  "speakers": [
    {
      "speaker_label": "SPEAKER_00",
      "embeddings":    [[ /* 192 floats */ ], [ /* 192 floats */ ], ...],
      "total_duration": 45.3,
      "segments": [
        { "start": 0.0, "end": 4.5, "text": "We need to discuss..." }
      ]
    }
  ]
}
```

## Response shape — `/speakers/embed`

```json
{
  "embeddings":    [[ /* 192 floats */ ], ...],
  "model_version": "ecapa-tdnn-v1",
  "sample_count":  11
}
```

## Environment

| Variable    | Default | Purpose |
|-------------|---------|---------|
| `HF_TOKEN`  | hard-coded fallback in `pipeline.py` | HuggingFace access token; required to download `pyannote/speaker-diarization-3.1` (gated license — accept on hf.co first) |
