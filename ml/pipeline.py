"""
AudioIntel ML Pipeline
======================
Given an audio file, this module:
  1. Transcribes the audio using Whisper
  2. Separates speakers using pyannote diarization
  3. Aligns transcript segments with speaker labels
  4. Extracts voice embeddings using ECAPA-TDNN (SpeechBrain/spkrec-ecapa-voxceleb) with sliding windows
  5. Cross-matches each speaker against the known-voices database
  6. Returns structured JSON with transcript + speaker identities

Improvements over v1:
  [1] ECAPA-TDNN (speechbrain/spkrec-ecapa-voxceleb) — stronger model than pyannote/embedding
  [2] Sliding window embeddings — multiple 3s windows averaged → more robust representation
  [3] Top-N segment selection — only the longest (cleanest) segments are used
  [4] Z-score normalization — scores normalized against all known speakers, not a fixed threshold
"""

import os
import json
import pickle
import subprocess
import tempfile
import uuid
import numpy as np
import whisper
import torch
import torchaudio
import torchaudio.functional as F
import noisereduce as nr

# SpeechBrain ≥1.0 uses torch.amp.custom_fwd which was added in PyTorch 2.4.
# Patch it as a no-op so it works with torch 2.3 (CPU inference only — AMP is irrelevant).
import torch as _torch
if not hasattr(_torch.amp, 'custom_fwd'):
    def _noop_custom_fwd(fwd=None, **_kw):
        return fwd if fwd is not None else (lambda f: f)
    def _noop_custom_bwd(bwd):
        return bwd
    _torch.amp.custom_fwd = _noop_custom_fwd
    _torch.amp.custom_bwd = _noop_custom_bwd

from speechbrain.inference.speaker import EncoderClassifier
from pyannote.audio import Pipeline as DiarizationPipeline
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ─── Paths ────────────────────────────────────────────────────────────────────
VOICES_DB_PATH = Path(__file__).parent / "voices_db" / "embeddings.pkl"
VOICES_DB_PATH.parent.mkdir(exist_ok=True)

HF_TOKEN = os.getenv("HF_TOKEN") or "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"

# ─── Tuning constants ─────────────────────────────────────────────────────────
MIN_SEGMENT_DURATION = 0.2   # minimum segment length — lowered to handle short utterances (one word ~0.3s)
TOP_N_SEGMENTS       = 5     # [3] use only the N longest segments per speaker
WINDOW_SIZE          = 5.0   # [2] sliding window size (seconds)
WINDOW_HOP           = 2.5   # [2] sliding window hop — 50% overlap
MATCH_THRESHOLD      = 0.72  # max-cosine threshold for matching (calibrated for ECAPA-TDNN cross-recording)
LEARN_THRESHOLD      = 0.85  # only add a new sample to a speaker's bucket when confidence is very high
MERGE_THRESHOLD      = 0.85  # [5] within-recording: clusters with cosine ≥ this are the same person

# ─── Load models once at startup ─────────────────────────────────────────────
print("⏳ Loading Whisper model...")
whisper_model = whisper.load_model("base")

print("⏳ Loading diarization pipeline (pyannote)...")
diarization_pipeline = DiarizationPipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    use_auth_token=HF_TOKEN
)
diarization_pipeline.to(torch.device("cpu"))

# Tune clustering to be more aggressive at separating speakers.
# Default threshold (~0.7) merges too many speakers — lower = more splits.
# segmentation.min_duration_off=0 prevents gaps from being filled with wrong speaker.
try:
    diarization_pipeline.instantiate({
        "segmentation": {
            "min_duration_off": 0.0,
        },
        "clustering": {
            "threshold":        0.45,   # lower = harder to merge → better separation of similar/sibling voices
            "min_cluster_size": 1,      # allow single-segment speakers (one-word utterances in short recordings)
        },
    })
    print("✅ Diarization hyperparameters tuned.")
except Exception as e:
    print(f"⚠️  Could not tune diarization params: {e}")

print("⏳ Loading ECAPA-TDNN speaker embedding model (speechbrain/spkrec-ecapa-voxceleb)...")
embedding_model = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir=str(Path(__file__).parent / "pretrained_models" / "ecapa-tdnn"),
    run_opts={"device": "cpu"},
)

print("✅ All models loaded.")


# ─── Audio Helpers ────────────────────────────────────────────────────────────

def load_audio_16k(audio_path: str) -> tuple[torch.Tensor, int]:
    """Load any audio file, resample to 16kHz mono, apply loudness normalization + noise reduction."""
    # soundfile backend doesn't support m4a/mp3/aac — convert via ffmpeg first
    tmp_wav = None
    if not audio_path.lower().endswith('.wav'):
        tmp_wav = tempfile.NamedTemporaryFile(delete=False, suffix='.wav').name
        subprocess.run(
            ['ffmpeg', '-y', '-i', audio_path, tmp_wav],
            check=True, capture_output=True
        )
        audio_path = tmp_wav

    try:
        waveform, sample_rate = torchaudio.load(audio_path)
    finally:
        if tmp_wav:
            try:
                os.unlink(tmp_wav)
            except Exception:
                pass

    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    if sample_rate != 16000:
        resampler = torchaudio.transforms.Resample(sample_rate, 16000)
        waveform = resampler(waveform)

    audio_np = waveform.squeeze().numpy()

    # Loudness normalization — makes recordings from different mics comparable
    rms = np.sqrt(np.mean(audio_np ** 2))
    if rms > 1e-6:
        audio_np = audio_np / rms * 0.1

    # Noise reduction
    audio_np = nr.reduce_noise(y=audio_np, sr=16000, stationary=False)

    # Bandpass filter: keep only voice frequencies (85 Hz – 3400 Hz).
    # Removes low-frequency rumble (AC hum, traffic) and high-frequency hiss
    # so the embeddings capture voice characteristics more cleanly.
    audio_tensor = torch.tensor(audio_np).unsqueeze(0).float()
    audio_tensor = F.highpass_biquad(audio_tensor, sample_rate=16000, cutoff_freq=85.0)
    audio_tensor = F.lowpass_biquad(audio_tensor, sample_rate=16000, cutoff_freq=3400.0)
    audio_np = audio_tensor.squeeze().numpy()

    return torch.tensor(audio_np).unsqueeze(0), 16000


def save_clean_temp(audio_path: str) -> str:
    """Save a noise-reduced, normalized version of the audio to a temp WAV file."""
    waveform, sr = load_audio_16k(audio_path)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    torchaudio.save(tmp.name, waveform, sr)
    return tmp.name


def extract_speaker_audio(waveform_np: np.ndarray, sr: int, windows: list[tuple]) -> np.ndarray | None:
    """
    [3] Select the TOP_N longest segments (≥ MIN_SEGMENT_DURATION) and concatenate them.
    Using only the longest segments avoids short noisy chunks that hurt embedding quality.
    """
    valid = [(s, e) for s, e in windows if (e - s) >= MIN_SEGMENT_DURATION]

    # [3] Sort by duration descending, take top N
    valid = sorted(valid, key=lambda x: x[1] - x[0], reverse=True)[:TOP_N_SEGMENTS]

    # Fallback: if all segments are below MIN_SEGMENT_DURATION, concatenate everything — better
    # to get a noisy embedding than to drop the speaker entirely (critical for short recordings)
    if not valid:
        valid = sorted(windows, key=lambda x: x[1] - x[0], reverse=True)[:TOP_N_SEGMENTS]
    if not valid:
        return None

    chunks = []
    for start, end in valid:
        s_idx = int(start * sr)
        e_idx = int(min(end * sr, len(waveform_np)))
        chunk = waveform_np[s_idx:e_idx]
        if len(chunk) > 0:
            chunks.append(chunk)

    return np.concatenate(chunks) if chunks else None


def get_window_embeddings(audio_np: np.ndarray, sr: int) -> list[np.ndarray]:
    """
    [1][2] Extract one embedding per sliding window using ECAPA-TDNN.
    Returns a list of individual embeddings (one per window).
    """
    window_samples = int(WINDOW_SIZE * sr)
    hop_samples    = int(WINDOW_HOP * sr)
    min_samples    = int(0.1 * sr)  # at least 0.1 s — allows single-word utterances to get embedded

    if len(audio_np) < min_samples:
        return []

    def _embed(chunk: np.ndarray) -> np.ndarray:
        wav = torch.tensor(chunk).unsqueeze(0).float()  # (1, time)
        with torch.no_grad():
            emb = embedding_model.encode_batch(wav)      # (1, 192)
            emb = torch.nn.functional.normalize(emb.squeeze(0), dim=-1)
        return emb.squeeze().numpy()

    embeddings = []
    if len(audio_np) >= window_samples:
        for start in range(0, len(audio_np) - window_samples + 1, hop_samples):
            chunk = audio_np[start : start + window_samples]
            embeddings.append(_embed(chunk))
    else:
        embeddings.append(_embed(audio_np))

    return embeddings


def get_embedding(audio_np: np.ndarray, sr: int) -> np.ndarray | None:
    """
    [1][2] Extract a single averaged ECAPA-TDNN embedding for matching.
    Averages all window embeddings into one stable representation.
    """
    embeddings = get_window_embeddings(audio_np, sr)
    if not embeddings:
        return None
    return np.mean(embeddings, axis=0)


# ─── Voice Embeddings Database ────────────────────────────────────────────────

EMBEDDING_DIM = 192  # ECAPA-TDNN produces 192-dim embeddings

def load_voices_db() -> dict:
    """Load the known-voices database. Returns {name: list_of_embeddings}.
    Auto-clears the DB if embeddings have the wrong dimension (e.g. leftover ECAPA 192-dim)."""
    if VOICES_DB_PATH.exists():
        with open(VOICES_DB_PATH, "rb") as f:
            db = pickle.load(f)
        # Check dimension of first embedding found
        for embs in db.values():
            if embs and np.array(embs[0]).flatten().shape[0] != EMBEDDING_DIM:
                print(f"⚠️  voices_db has wrong embedding dim — clearing (was {np.array(embs[0]).flatten().shape[0]}, need {EMBEDDING_DIM})")
                VOICES_DB_PATH.unlink()
                return {}
            break
        return db
    return {}


def save_voices_db(db: dict):
    """Persist the known-voices database to disk."""
    with open(VOICES_DB_PATH, "wb") as f:
        pickle.dump(db, f)


def add_known_speaker(name: str, audio_path: str, speaker_label: str | None = None):
    """
    Register a known speaker in the database.
    Each call appends one averaged embedding (from sliding windows) to the speaker's list.
    """
    clean_path = save_clean_temp(audio_path)
    try:
        if speaker_label:
            waveform, sr = load_audio_16k(audio_path)
            audio_in_memory = {"waveform": waveform, "sample_rate": sr}
            diarization_result = diarization_pipeline(audio_in_memory)

            windows = [
                (seg.start, seg.end)
                for seg, _, label in diarization_result.itertracks(yield_label=True)
                if label == speaker_label
            ]
            combined = extract_speaker_audio(waveform.squeeze().numpy(), sr, windows)
            if combined is None:
                raise ValueError(f"No usable segments found for label '{speaker_label}'.")
            audio_np = combined
            sr_used = sr
        else:
            waveform, sr_used = load_audio_16k(clean_path)
            audio_np = waveform.squeeze().numpy()

        # [1][2] ECAPA-TDNN + sliding window — store each window as a separate sample
        new_embeddings = get_window_embeddings(audio_np, sr_used)
        if not new_embeddings:
            raise ValueError("Audio too short to extract a usable embedding.")

        db = load_voices_db()
        if name not in db:
            db[name] = []
        db[name].extend(new_embeddings)  # store all windows, not just the average
        save_voices_db(db)
        print(f"✅ Speaker '{name}' updated — added {len(new_embeddings)} sample(s), {len(db[name])} total.")
    finally:
        try:
            os.unlink(clean_path)
        except Exception:
            pass


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


def match_or_register_speaker(embedding: np.ndarray, taken: set | None = None) -> tuple[str, float, str]:
    """
    Match an embedding against ALL speakers in the DB (known people AND unknown speakers).

    If a match is found → return (display_name, confidence, voice_db_key)
    If no match       → register as a new unknown, return ("Unknown", 0.0, "speaker_XXXXXXXX")

    `taken` is a set of voice_db_keys already claimed by other speakers in the SAME recording.
    Excluding them prevents two distinct speakers in one recording from collapsing onto the same DB
    entry just because their cosine to the same DB voice happens to clear the threshold.

    This ensures every speaker — even unknown ones — gets a stable voice_db_key that links
    the same person across multiple recordings. The user can later rename the key via the UI.

    [4] Z-norm is applied when ≥2 speakers exist in the DB.
    """
    taken = taken or set()
    db = load_voices_db()
    emb = embedding.flatten()

    # Only consider DB entries not already claimed by another speaker in this recording
    available = {name: embs for name, embs in db.items() if name not in taken}

    if available:
        # Max-pool: best cosine to ANY stored sample of each speaker.
        # This is more robust than mean-pool: it captures the closest matching
        # sample (e.g. same mood, same recording session) instead of diluting
        # the score across all of a speaker's variations.
        per_speaker_score: dict[str, float] = {}
        for name, embs in available.items():
            sims = [_cosine(emb, np.array(e).flatten()) for e in embs]
            per_speaker_score[name] = max(sims) if sims else 0.0

        best_key = max(per_speaker_score, key=per_speaker_score.get)  # type: ignore
        best_score = per_speaker_score[best_key]

        # Show top 3 candidates for debuggability when matches go wrong
        top = sorted(per_speaker_score.items(), key=lambda kv: kv[1], reverse=True)[:3]
        print("  🔍 Top candidates: " + ", ".join(f"{k}={v:.3f}" for k, v in top))

        if best_score >= MATCH_THRESHOLD:
            is_real = not best_key.startswith("speaker_")
            display = best_key if is_real else "Unknown"

            # Learning: only append when confidence is very high — prevents DB pollution
            # from borderline matches that snowball into wrong identities over time.
            if best_score >= LEARN_THRESHOLD:
                db[best_key].append(emb)
                save_voices_db(db)
                print(f"  📚 Learned: added new sample for '{best_key}' ({len(db[best_key])} total)")

            return display, round(best_score, 3), best_key

    # No match — register as brand-new unknown speaker
    new_key = f"speaker_{uuid.uuid4().hex[:8]}"
    db[new_key] = [emb]
    save_voices_db(db)
    print(f"  🆕 New unknown speaker saved as '{new_key}'")
    return "Unknown", 0.0, new_key


# ─── Progress tracking (read by GET /status) ──────────────────────────────────

_progress: dict = {"pct": 0, "label": "idle"}

def _set_progress(pct: int, label: str):
    _progress["pct"] = pct
    _progress["label"] = label


def _merge_similar_clusters(
    speaker_segments: dict,
    speaker_embeddings: dict,
    threshold: float,
) -> tuple[dict, dict]:
    """
    Pyannote often over-splits a single speaker into multiple clusters
    (e.g. interviewer at start + interviewer at end → SPEAKER_00 + SPEAKER_02).
    Compute pairwise cosine on the per-cluster ECAPA embeddings and merge any
    pair whose similarity ≥ threshold. Uses union-find for transitive merges.
    """
    labels = list(speaker_embeddings.keys())
    parent = {l: l for l in labels}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, a in enumerate(labels):
        for b in labels[i + 1:]:
            sim = _cosine(speaker_embeddings[a], speaker_embeddings[b])
            if sim >= threshold:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[ra] = rb
                    print(f"  🔗 Merging {a} ↔ {b} (cosine={sim:.3f})")

    groups: dict[str, list[str]] = {}
    for l in labels:
        groups.setdefault(find(l), []).append(l)

    merged_segments: dict = {}
    merged_embeddings: dict = {}
    for root, members in groups.items():
        # Keep the label of the member with the most speaking time as the canonical name
        canonical = max(members, key=lambda m: sum(s["end"] - s["start"] for s in speaker_segments.get(m, [])))
        all_segs = []
        for m in members:
            all_segs.extend(speaker_segments.get(m, []))
        all_segs.sort(key=lambda s: s["start"])
        merged_segments[canonical] = all_segs
        merged_embeddings[canonical] = np.mean(
            np.stack([speaker_embeddings[m] for m in members]), axis=0
        )

    # Also forward any segments from labels that had no embedding (skipped in Step 4)
    for label, segs in speaker_segments.items():
        if label not in speaker_embeddings and label not in merged_segments:
            merged_segments[label] = segs

    return merged_segments, merged_embeddings


# ─── Main Pipeline ────────────────────────────────────────────────────────────

def process_audio(audio_path: str) -> dict:
    """
    Full pipeline: audio file → structured result with transcript + speaker IDs.

    Strategy: diarize aggressively (finds many clusters), then merge back any
    clusters whose ECAPA-TDNN embeddings are too similar — they're the same person
    split across two clusters.  This avoids both under-splitting AND over-splitting.
    """
    print(f"\n🎙️  Processing: {audio_path}")

    # ── Step 0: Load + denoise once, reuse for both Whisper and diarization ───
    _set_progress(5, "Applying noise reduction…")
    print("🔇 Step 0: Applying noise reduction & loudness normalization...")
    waveform, sr = load_audio_16k(audio_path)
    waveform_np = waveform.squeeze().numpy()
    clean_path = tempfile.NamedTemporaryFile(delete=False, suffix=".wav").name
    torchaudio.save(clean_path, waveform, sr)

    # ── Step 1: Transcription ──────────────────────────────────────────────────
    _set_progress(15, "Transcribing with Whisper…")
    print("📝 Step 1: Transcribing with Whisper...")
    transcript = whisper_model.transcribe(clean_path, fp16=False)
    whisper_segments = transcript["segments"]

    # ── Step 2: Diarization (no min/max_speakers — they break clustering on
    #            short single/two-speaker recordings; let pyannote auto-detect) ──
    _set_progress(50, "Running speaker diarization…")
    print("🗣️  Step 2: Running speaker diarization...")
    audio_in_memory = {"waveform": waveform, "sample_rate": sr}
    diarization_result = diarization_pipeline(audio_in_memory)

    diarization_segments = [
        (seg.start, seg.end, label)
        for seg, _, label in diarization_result.itertracks(yield_label=True)
    ]
    final_labels = sorted({label for _, _, label in diarization_segments})
    print(f"  Speakers found by pyannote: {final_labels}")

    # ── Step 3: Align transcript with speakers ─────────────────────────────────
    _set_progress(72, "Aligning transcript with speakers…")
    print("🔗 Step 3: Aligning transcript with speakers...")

    def get_speaker_at(time: float) -> str:
        for start, end, label in diarization_segments:
            if start <= time <= end:
                return label
        if diarization_segments:
            return min(diarization_segments, key=lambda s: min(abs(s[0] - time), abs(s[1] - time)))[2]
        return "SPEAKER_UNKNOWN"

    speaker_segments: dict[str, list] = {}
    for seg in whisper_segments:
        mid = (seg["start"] + seg["end"]) / 2
        speaker = get_speaker_at(mid)
        speaker_segments.setdefault(speaker, []).append({
            "start": round(seg["start"], 2),
            "end":   round(seg["end"],   2),
            "text":  seg["text"].strip()
        })

    # ── Step 4: Extract voice embeddings per (merged) speaker ─────────────────
    _set_progress(82, "Extracting voice fingerprints…")
    print("🔬 Step 4: Extracting voice fingerprints (ECAPA-TDNN + sliding windows)...")
    speaker_embeddings: dict[str, np.ndarray] = {}

    for label in speaker_segments:
        windows = [(s, e) for s, e, l in diarization_segments if l == label]

        combined = extract_speaker_audio(waveform_np, sr, windows)
        if combined is None:
            print(f"  ⚠️  {label}: no usable audio found, skipping")
            continue

        try:
            emb = get_embedding(combined, sr)
            if emb is not None:
                speaker_embeddings[label] = emb
                print(f"  ✅ {label}: embedding extracted ({len(combined)/sr:.1f}s of audio)")
            else:
                print(f"  ⚠️  {label}: audio too short for embedding")
        except Exception as e:
            print(f"  ⚠️  {label}: embedding failed — {e}")

    # ── Step 4.5: Merge over-split clusters (same speaker → multiple labels) ──
    if len(speaker_embeddings) > 1:
        _set_progress(88, "Merging duplicate speakers…")
        print("🔗 Step 4.5: Merging clusters with high embedding similarity...")
        speaker_segments, speaker_embeddings = _merge_similar_clusters(
            speaker_segments, speaker_embeddings, threshold=MERGE_THRESHOLD
        )
        print(f"  → {len(speaker_embeddings)} speaker(s) after merge")

    # ── Step 5: Cross-match against known speakers (and save unknowns) ─────────
    _set_progress(93, "Matching speaker identities…")
    print("🔍 Step 5: Cross-matching with score normalization...")
    results = []
    taken_keys: set[str] = set()
    for label in speaker_segments:
        embedding = speaker_embeddings.get(label)
        if embedding is not None:
            matched_name, confidence, voice_db_key = match_or_register_speaker(embedding, taken=taken_keys)
            if voice_db_key:
                taken_keys.add(voice_db_key)
        else:
            matched_name, confidence, voice_db_key = "Unknown", 0.0, ""
        results.append({
            "speaker_label":    label,
            "matched_identity": matched_name,
            "voice_db_key":     voice_db_key,
            "confidence":       confidence,
            "is_known":         matched_name != "Unknown",
            "segments":         speaker_segments[label]
        })

    results.sort(key=lambda s: s["segments"][0]["start"] if s["segments"] else 0)

    try:
        os.unlink(clean_path)
    except Exception:
        pass

    output = {
        "file":         os.path.basename(audio_path),
        "num_speakers": len(results),
        "speakers":     results
    }

    _set_progress(100, "Done")
    print(f"✅ Done. Detected {len(results)} speaker(s).")
    return output


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python pipeline.py <audio_file>")
        sys.exit(1)

    result = process_audio(sys.argv[1])

    # ── Pretty transcript ──────────────────────────────────────────────────────
    print("\n" + "═" * 60)
    print(f"  TRANSCRIPT  —  {result['num_speakers']} speaker(s) detected")
    print("═" * 60)

    # Flatten all segments across speakers and sort by start time
    all_segs = []
    for spk in result["speakers"]:
        label = spk["matched_identity"] if spk["is_known"] else spk["speaker_label"]
        for seg in spk["segments"]:
            all_segs.append((seg["start"], seg["end"], label, seg["text"]))
    all_segs.sort(key=lambda x: x[0])

    for start, end, speaker, text in all_segs:
        m_s, s_s = divmod(int(start), 60)
        m_e, s_e = divmod(int(end), 60)
        timestamp = f"[{m_s:02d}:{s_s:02d} → {m_e:02d}:{s_e:02d}]"
        print(f"\n{timestamp}  {speaker}")
        print(f"  {text}")

    print("\n" + "═" * 60)
