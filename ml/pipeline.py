"""
Kollab ML Pipeline
===================
Stateless audio analysis. Given an audio file, this module:
  1. Transcribes the audio using Whisper (medium)
  2. Separates speakers using pyannote diarization
  3. Aligns transcript segments with speaker labels
  4. Extracts voice embeddings using ECAPA-TDNN (SpeechBrain/spkrec-ecapa-voxceleb)
     with sliding windows — returns the FULL list of windows per speaker so the
     Backend can do symmetric max-pool matching against the corpus.
  5. Returns structured JSON with transcript + per-speaker window embeddings

Identity matching, learning, and storage live entirely in the Backend
(Backend/matcher.py + SpeakerEmbeddings table). The ML service has no DB
of its own.
"""

import os
import subprocess
import tempfile
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

HF_TOKEN = os.getenv("HF_TOKEN") or "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"

# ─── Tuning constants ─────────────────────────────────────────────────────────
MIN_SEGMENT_DURATION   = 1.5   # ECAPA-TDNN was trained on ~3s; below ~1.5s embeddings degrade
MAX_AUDIO_BUDGET       = 60.0  # cap total seconds of audio per speaker fed to ECAPA
FALLBACK_MIN_DURATION  = 0.2   # only used when no segment passes MIN_SEGMENT_DURATION (very short clips)
FALLBACK_TOP_N         = 5     # in that fallback case, take the N longest of whatever's there
WINDOW_SIZE            = 5.0   # sliding window size (seconds)
WINDOW_HOP             = 2.5   # sliding window hop — 50% overlap
MERGE_THRESHOLD        = 0.85  # within-recording: clusters with cosine ≥ this are the same person

EMBEDDING_MODEL_VERSION = "ecapa-tdnn-v1"
WHISPER_MODEL           = os.getenv("WHISPER_MODEL", "base")
WHISPER_MODEL_DIR       = os.getenv("WHISPER_MODEL_DIR", "/app/pretrained_models/whisper")

# ─── Load models once at startup ─────────────────────────────────────────────
print(f"⏳ Loading Whisper model ({WHISPER_MODEL})...")
whisper_model = whisper.load_model(WHISPER_MODEL, download_root=WHISPER_MODEL_DIR)

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
            "threshold":        0.35,   # aggressively split — Step 4.5 (MERGE_THRESHOLD=0.85) heals over-splits within recording
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
    Pick the best speech audio for a speaker, capped at MAX_AUDIO_BUDGET seconds.
    Greedy fill: take segments ≥ MIN_SEGMENT_DURATION sorted longest-first, stopping
    once the budget is hit. This adapts to the recording — short audios use whatever's
    available, long audios stop when they have enough.

    Fallback (very short clips where nothing passes MIN_SEGMENT_DURATION):
    take the N longest segments unconditionally so the speaker still gets an embedding.
    """
    sorted_by_len = sorted(windows, key=lambda x: x[1] - x[0], reverse=True)
    valid: list[tuple] = []
    total = 0.0
    for s, e in sorted_by_len:
        dur = e - s
        if dur < MIN_SEGMENT_DURATION:
            break  # remaining are all shorter (sorted desc)
        valid.append((s, e))
        total += dur
        if total >= MAX_AUDIO_BUDGET:
            break

    if not valid:
        valid = [(s, e) for s, e in sorted_by_len if (e - s) >= FALLBACK_MIN_DURATION][:FALLBACK_TOP_N]
    if not valid:
        valid = sorted_by_len[:FALLBACK_TOP_N]
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
    """Single averaged embedding — used only by within-recording cluster merging
    in Step 4.5, where mean-pool is fine because the candidates are very similar."""
    embeddings = get_window_embeddings(audio_np, sr)
    if not embeddings:
        return None
    return np.mean(embeddings, axis=0)


def get_window_embeddings_array(audio_np: np.ndarray, sr: int) -> np.ndarray:
    """Like get_window_embeddings but returns a stacked (N, 192) array.
    Empty input → shape (0, 192)."""
    embeddings = get_window_embeddings(audio_np, sr)
    if not embeddings:
        return np.zeros((0, 192), dtype=np.float32)
    return np.stack(embeddings).astype(np.float32)


def extract_embeddings_only(audio_path: str) -> np.ndarray:
    """Extract every sliding-window ECAPA-TDNN embedding for the audio.
    Used by /speakers/embed — pure analysis, no storage. Returns (N, 192)."""
    clean_path = save_clean_temp(audio_path)
    try:
        waveform, sr_used = load_audio_16k(clean_path)
        audio_np = waveform.squeeze().numpy()
        windows = get_window_embeddings_array(audio_np, sr_used)
        if windows.shape[0] == 0:
            raise ValueError("Audio too short to extract a usable embedding.")
        return windows
    finally:
        try:
            os.unlink(clean_path)
        except Exception:
            pass


def extract_embeddings_for_ranges(audio_path: str, ranges: list[tuple[float, float]]) -> np.ndarray:
    """Slice the audio to the given (start, end) time ranges, concatenate them,
    and run ECAPA-TDNN sliding-window embedding. Used by Backend split-speaker
    flow to get clean embeddings for a subset of segments."""
    clean_path = save_clean_temp(audio_path)
    try:
        waveform, sr_used = load_audio_16k(clean_path)
        audio_np = waveform.squeeze().numpy()
        sliced = extract_speaker_audio(audio_np, sr_used, ranges)
        if sliced is None:
            raise ValueError("No usable audio in the requested ranges.")
        windows = get_window_embeddings_array(sliced, sr_used)
        if windows.shape[0] == 0:
            raise ValueError("Sliced audio too short to extract a usable embedding.")
        return windows
    finally:
        try:
            os.unlink(clean_path)
        except Exception:
            pass


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


# ─── Progress tracking (read by GET /status) ──────────────────────────────────

_progress: dict = {"pct": 0, "label": "idle"}

def _set_progress(pct: int, label: str):
    _progress["pct"] = pct
    _progress["label"] = label


def _merge_similar_clusters(
    speaker_segments: dict,
    speaker_embeddings: dict,
    speaker_window_embeddings: dict,
    threshold: float,
) -> tuple[dict, dict, dict]:
    """
    Pyannote often over-splits a single speaker into multiple clusters
    (e.g. interviewer at start + interviewer at end → SPEAKER_00 + SPEAKER_02).
    Pairwise cosine on the averaged ECAPA embeddings; merge any pair ≥ threshold.
    Mean-pool is fine here — within one recording the over-split clusters are
    very similar voices.

    On merge, both the averaged embedding AND the per-window stack are unioned
    so cross-recording matching downstream still has every window.
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
    merged_windows: dict = {}
    for root, members in groups.items():
        canonical = max(members, key=lambda m: sum(s["end"] - s["start"] for s in speaker_segments.get(m, [])))
        all_segs = []
        for m in members:
            all_segs.extend(speaker_segments.get(m, []))
        all_segs.sort(key=lambda s: s["start"])
        merged_segments[canonical] = all_segs
        merged_embeddings[canonical] = np.mean(
            np.stack([speaker_embeddings[m] for m in members]), axis=0
        )
        merged_windows[canonical] = np.concatenate(
            [speaker_window_embeddings[m] for m in members], axis=0
        )

    for label, segs in speaker_segments.items():
        if label not in speaker_embeddings and label not in merged_segments:
            merged_segments[label] = segs

    return merged_segments, merged_embeddings, merged_windows


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

    # ── Step 4: Extract voice embeddings per speaker ──────────────────────────
    # We carry BOTH the averaged embedding (used by Step 4.5 cluster merging)
    # AND the full window stack (returned to Backend for symmetric max-pool
    # matching against the corpus).
    _set_progress(82, "Extracting voice fingerprints…")
    print("🔬 Step 4: Extracting voice fingerprints (ECAPA-TDNN + sliding windows)...")
    speaker_embeddings: dict[str, np.ndarray] = {}
    speaker_window_embeddings: dict[str, np.ndarray] = {}

    for label in speaker_segments:
        windows = [(s, e) for s, e, l in diarization_segments if l == label]

        combined = extract_speaker_audio(waveform_np, sr, windows)
        if combined is None:
            print(f"  ⚠️  {label}: no usable audio found, skipping")
            continue

        try:
            window_arr = get_window_embeddings_array(combined, sr)
            if window_arr.shape[0] == 0:
                print(f"  ⚠️  {label}: audio too short for embedding")
                continue
            speaker_window_embeddings[label] = window_arr
            speaker_embeddings[label] = window_arr.mean(axis=0)
            print(f"  ✅ {label}: {window_arr.shape[0]} window(s) extracted ({len(combined)/sr:.1f}s of audio)")
        except Exception as e:
            print(f"  ⚠️  {label}: embedding failed — {e}")

    # ── Step 4.5: Merge over-split clusters (same speaker → multiple labels) ──
    if len(speaker_embeddings) > 1:
        _set_progress(88, "Merging duplicate speakers…")
        print("🔗 Step 4.5: Merging clusters with high embedding similarity...")
        speaker_segments, speaker_embeddings, speaker_window_embeddings = _merge_similar_clusters(
            speaker_segments, speaker_embeddings, speaker_window_embeddings, threshold=MERGE_THRESHOLD
        )
        print(f"  → {len(speaker_embeddings)} speaker(s) after merge")

    # ── Step 5: Build the response — Backend does the matching ────────────────
    _set_progress(93, "Packaging speaker fingerprints…")
    print("📦 Step 5: Packaging per-speaker window embeddings for Backend matching...")
    results = []
    for label in speaker_segments:
        windows = speaker_window_embeddings.get(label)
        results.append({
            "speaker_label": label,
            "embeddings":    windows.tolist() if windows is not None else [],
            "segments":      speaker_segments[label],
        })

    results.sort(key=lambda s: s["segments"][0]["start"] if s["segments"] else 0)

    try:
        os.unlink(clean_path)
    except Exception:
        pass

    output = {
        "file":          os.path.basename(audio_path),
        "num_speakers":  len(results),
        "model_version": EMBEDDING_MODEL_VERSION,
        "speakers":      results,
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
        label = spk["speaker_label"]
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
