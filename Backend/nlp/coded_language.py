"""Coded-language / euphemism detection — 4-signal scoring pipeline.

Entry point: `score_coded_language(audio_id)` — called from
`_run_ml_and_save` after segments are inserted. Pulls segments, embeds them
(temporary infra — see TODO(hadar) on `_embed_segments`), computes four
sub-scores, combines them with weights, writes back per-segment scores, and
emits an `Alerts(Category='coded_language')` for any segment above 0.65.

Math conventions (DO NOT change without updating the tests):
  - Signal A — topic incoherence:
        0.5 * (1 - cos(s, audio_mean_weighted))
      + 0.5 * (1 - cos(s, local_4_mean))   ; local = 2 before + 2 after.
  - Signal B — lexical anomaly: combines mean IDF of content words with the
    *most negative* PMI(w, this_audio). High positive PMI = topical word, NOT
    anomalous. We want the worst (lowest) PMI per segment and use
    -clip(min_pmi, -5, 0) as the contribution.
  - Signal C — distilgpt2 perplexity, z-scored vs audio corpus then blended
    with the speaker's own mean-perplexity ratio (only if speaker has enough
    history). Clipped to ±3σ and mapped to [0,1].
  - Signal D — max cosine similarity to euphemism embeddings.

Combined: 0.30 A + 0.20 B + 0.25 C + 0.25 D. If any signal is skipped, its
weight is redistributed proportionally across the others.
Alert threshold: 0.65.
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from typing import Dict, List, Optional

import numpy as np

from . import models

log = logging.getLogger(__name__)

ALERT_THRESHOLD = 0.65
WEIGHTS = {"a": 0.30, "b": 0.20, "c": 0.25, "d": 0.25}

PERPLEXITY_MIN_TOKENS = 4   # below this, distilgpt2 is too noisy
SPEAKER_PPL_MIN_SEGS = 5    # below this, skip speaker-mean normalization

EMBED_BATCH = 32


# ───────────────────────── public entry ───────────────────────────────────────


def score_coded_language(audio_id: int) -> None:
    """Run the full coded-language pipeline for one audio.

    Safe to call multiple times — `_embed_segments` only embeds segments that
    are still missing an embedding, and `_persist_and_alert` overwrites the
    per-segment score columns.
    """
    # local import to avoid a circular import (database is imported by api.py
    # which imports this package). Backend/ is on sys.path so this resolves.
    import database

    _embed_segments(audio_id, database)

    segments = database.get_segments_with_embeddings(audio_id)
    if not segments:
        return

    a = _signal_a_topic_incoherence(segments)
    b = _signal_b_lexical_anomaly(segments, database)
    c = _signal_c_perplexity(segments, database)
    d = _signal_d_euphemism_match(segments, database)

    combined: Dict[int, dict] = {}
    for seg in segments:
        sid = seg["id"]
        scores = {
            "a": a.get(sid),
            "b": b.get(sid),
            "c": c.get(sid),
            "d": d.get(sid),
        }
        combined[sid] = {
            "subScores": scores,
            "score": _combine(scores),
        }

    _persist_and_alert(audio_id, segments, combined, database)


# ───────────────────────── embeddings (Hadar will own this) ──────────────────


def _embed_segments(audio_id: int, database) -> None:
    """Encode and persist embeddings for any segment of this audio that lacks one.

    TODO(hadar): relocate to semantic_search.embed_segments. Keep the same
    Segments.Embedding / Segments.EmbeddingModel storage shape so Signal D
    doesn't have to migrate.
    """
    rows = database.get_segments_with_embeddings(audio_id)
    needs = [(r["id"], r["text"] or "") for r in rows if r["embedding"] is None]
    if not needs:
        return
    embed = models.get_embed_model()
    for i in range(0, len(needs), EMBED_BATCH):
        chunk = needs[i:i + EMBED_BATCH]
        texts = [t if t.strip() else " " for _, t in chunk]
        vecs = embed.encode(texts, batch_size=len(texts), show_progress_bar=False,
                            normalize_embeddings=True)
        vecs = np.asarray(vecs, dtype=np.float32)
        for (seg_id, _), v in zip(chunk, vecs):
            database.set_segment_embedding(seg_id, v, models.EMBED_MODEL_NAME)


# ───────────────────────── signals (pure: input → dict) ──────────────────────


def _signal_a_topic_incoherence(segments: List[dict]) -> Dict[int, float]:
    """Returns {seg_id: 0..1}. Skips segments without embeddings (None entry)."""
    out: Dict[int, float] = {}
    embs = [(s["id"], s.get("embedding"), max(0.0, (s["endTime"] or 0) - (s["startTime"] or 0)))
            for s in segments]
    valid = [(sid, e, w) for sid, e, w in embs if e is not None]
    if not valid:
        return out

    # Duration-weighted audio mean
    stacked = np.stack([e for _, e, _ in valid]).astype(np.float32)
    weights = np.array([w for _, _, w in valid], dtype=np.float32)
    if weights.sum() <= 0:
        weights = np.ones_like(weights)
    audio_mean = (stacked * weights[:, None]).sum(axis=0) / weights.sum()
    audio_mean = _normalize(audio_mean)

    # Index of each valid segment for local window
    by_idx = {i: (sid, e) for i, (sid, e, _) in enumerate(valid)}
    n = len(valid)
    for i in range(n):
        sid, e = by_idx[i]
        global_dist = 1.0 - _cos(e, audio_mean)
        # Local: 2 before + 2 after (whichever exist), excluding self
        neighbors = []
        for j in range(max(0, i - 2), min(n, i + 3)):
            if j == i:
                continue
            neighbors.append(by_idx[j][1])
        if neighbors:
            local_mean = _normalize(np.mean(np.stack(neighbors), axis=0))
            local_dist = 1.0 - _cos(e, local_mean)
        else:
            local_dist = global_dist  # single-segment audio: no extra info
        out[sid] = float(np.clip(0.5 * global_dist + 0.5 * local_dist, 0.0, 1.0))
    return out


def _signal_b_lexical_anomaly(segments: List[dict], database) -> Dict[int, float]:
    """Mean IDF of content words + worst-PMI(word, this_audio) contribution.

    Returns {} if the global corpus is too small for TF-IDF (Signal B is
    floored to skip — caller will reweight A/C/D).
    """
    vec = models.get_tfidf(lambda: database.get_all_segment_texts())
    if vec is None:
        return {}

    out: Dict[int, float] = {}
    analyzer = vec.build_analyzer()
    idf_lookup = dict(zip(vec.get_feature_names_out(), vec.idf_))

    # Build per-audio token frequencies for PMI.
    audio_tokens: Counter = Counter()
    per_seg_tokens: Dict[int, List[str]] = {}
    for s in segments:
        toks = [t for t in analyzer(s["text"] or "") if t in idf_lookup]
        per_seg_tokens[s["id"]] = toks
        audio_tokens.update(toks)
    audio_total = sum(audio_tokens.values()) or 1

    # Global counts — approximate via the vocabulary's document frequency (1/idf
    # is a proxy; we just need a stable P(w) for relative PMI).
    # idf = ln((1+N)/(1+df)) + 1 -> df = (1+N)/exp(idf-1) - 1
    # but we don't need exact df; use log-normalized rank from idf.
    # Pragmatic choice: P(w) ∝ exp(-idf). Higher idf → rarer global.
    # Avoids a second pass over the corpus.
    def log_p_global(tok: str) -> float:
        idf = idf_lookup.get(tok)
        if idf is None:
            return -10.0
        # convert idf to a proxy log-probability (more negative = rarer)
        return -float(idf)

    for s in segments:
        toks = per_seg_tokens[s["id"]]
        if not toks:
            out[s["id"]] = 0.0
            continue
        # Mean IDF of content words, scaled to roughly [0,1] via 1 - exp(-mean/6)
        mean_idf = float(np.mean([idf_lookup[t] for t in toks]))
        idf_part = 1.0 - math.exp(-max(0.0, mean_idf) / 6.0)

        # Worst PMI: PMI(w, audio) = log(P(w|audio) / P(w))
        # P(w|audio) = audio_tokens[w] / audio_total
        # P(w)       = exp(log_p_global(w))
        worst = 0.0  # default if all tokens are equally topical
        for t in toks:
            count = audio_tokens.get(t, 0)
            if count == 0:
                continue
            log_p_audio = math.log(count / audio_total)
            pmi = log_p_audio - log_p_global(t)
            # Low PMI = anomalous. We want the most-negative across the segment.
            if pmi < worst:
                worst = pmi
        pmi_clipped = max(-5.0, min(0.0, worst))
        pmi_part = -pmi_clipped / 5.0  # 0..1

        out[s["id"]] = float(np.clip(0.6 * idf_part + 0.4 * pmi_part, 0.0, 1.0))
    return out


def _signal_c_perplexity(segments: List[dict], database) -> Dict[int, float]:
    """distilgpt2 perplexity, z-scored vs this audio's mean, blended with speaker
    history (when available). Returns {} on import failure (graceful skip)."""
    try:
        import torch  # noqa: F401
        tok, lm = models.get_lm()
    except Exception:
        log.exception("[coded_language] perplexity unavailable — skipping Signal C")
        return {}

    raw: Dict[int, Optional[float]] = {}
    by_speaker: Dict[Optional[int], List[float]] = {}
    for s in segments:
        text = (s["text"] or "").strip()
        if len(text.split()) < PERPLEXITY_MIN_TOKENS:
            raw[s["id"]] = None
            continue
        ppl = _calc_perplexity(text, tok, lm)
        raw[s["id"]] = ppl
        if ppl is not None:
            by_speaker.setdefault(s["speakerId"], []).append(ppl)

    valid_vals = [v for v in raw.values() if v is not None and math.isfinite(v)]
    if not valid_vals:
        return {}
    log_vals = np.log(np.clip(valid_vals, 1e-6, 1e9))
    mu = float(log_vals.mean())
    sd = float(log_vals.std()) or 1.0

    speaker_mean: Dict[Optional[int], float] = {}
    for sp, vals in by_speaker.items():
        if len(vals) >= SPEAKER_PPL_MIN_SEGS:
            speaker_mean[sp] = float(np.log(np.clip(vals, 1e-6, 1e9)).mean())

    out: Dict[int, float] = {}
    for s in segments:
        ppl = raw.get(s["id"])
        if ppl is None or not math.isfinite(ppl):
            continue
        z = (math.log(max(ppl, 1e-6)) - mu) / sd
        z_clipped = max(-3.0, min(3.0, z))
        zscore01 = (z_clipped + 3.0) / 6.0  # map [-3,3] → [0,1]

        sp_mu = speaker_mean.get(s["speakerId"])
        if sp_mu is not None:
            ratio_z = (math.log(max(ppl, 1e-6)) - sp_mu) / sd
            ratio_z_clipped = max(-3.0, min(3.0, ratio_z))
            ratio01 = (ratio_z_clipped + 3.0) / 6.0
            out[s["id"]] = float(0.5 * zscore01 + 0.5 * ratio01)
        else:
            out[s["id"]] = float(zscore01)
    return out


def _calc_perplexity(text: str, tok, lm) -> Optional[float]:
    import torch
    enc = tok(text, return_tensors="pt", truncation=True, max_length=256)
    input_ids = enc["input_ids"]
    if input_ids.numel() < 2:
        return None
    with torch.no_grad():
        out = lm(input_ids, labels=input_ids)
    loss = float(out.loss.item())
    if not math.isfinite(loss):
        return None
    return math.exp(loss)


def _signal_d_euphemism_match(segments: List[dict], database) -> Dict[int, float]:
    """Max cosine similarity vs euphemism phrase embeddings. Embeds any
    euphemism row that doesn't have a cached vector yet and persists it."""
    euphs = database.get_euphemisms_with_embeddings()
    if not euphs:
        return {sid: 0.0 for sid in (s["id"] for s in segments)}

    # Embed any missing euphemisms on the fly
    missing = [e for e in euphs if e["embedding"] is None]
    if missing:
        embed = models.get_embed_model()
        phrases = [e["phrase"] for e in missing]
        vecs = embed.encode(phrases, show_progress_bar=False, normalize_embeddings=True)
        vecs = np.asarray(vecs, dtype=np.float32)
        for e, v in zip(missing, vecs):
            database.set_euphemism_embedding(e["id"], v, models.EMBED_MODEL_NAME)
            e["embedding"] = v

    # Stack into (K, D)
    euph_mat = np.stack([e["embedding"] for e in euphs]).astype(np.float32)
    # Normalize defensively in case cached vectors aren't unit-norm
    euph_mat = _row_normalize(euph_mat)

    out: Dict[int, float] = {}
    for s in segments:
        e = s.get("embedding")
        if e is None:
            continue
        e_norm = _normalize(np.asarray(e, dtype=np.float32))
        sims = euph_mat @ e_norm
        out[s["id"]] = float(np.clip(sims.max(), 0.0, 1.0))
    return out


# ───────────────────────── combine + persist ─────────────────────────────────


def _combine(scores: Dict[str, Optional[float]]) -> float:
    """Weighted combine with proportional reweighting when a signal is None."""
    available = {k: v for k, v in scores.items() if v is not None}
    if not available:
        return 0.0
    w_sum = sum(WEIGHTS[k] for k in available)
    if w_sum <= 0:
        return 0.0
    return float(sum(available[k] * WEIGHTS[k] for k in available) / w_sum)


def _persist_and_alert(audio_id: int, segments: List[dict],
                       combined: Dict[int, dict], database) -> None:
    for seg in segments:
        sid = seg["id"]
        info = combined.get(sid)
        if info is None:
            continue
        score = info["score"]
        # Replace None with NaN-sentinel 0 so the JSON is stable on the wire
        sub = {k: (None if v is None else float(round(v, 4)))
               for k, v in info["subScores"].items()}
        database.set_segment_suspicion(sid, score, sub)
        if score > ALERT_THRESHOLD:
            snippet = (seg["text"] or "").strip()
            if len(snippet) > 140:
                snippet = snippet[:137] + "…"
            severity = "high" if score > 0.80 else "medium"
            database.create_coded_language_alert(
                severity=severity,
                message=f'Possible coded language: "{snippet}"',
                audio_id=audio_id,
                segment_id=sid,
                sub_scores=sub,
            )


# ───────────────────────── small math helpers ────────────────────────────────


def _cos(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _normalize(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v if n == 0.0 else (v / n)


def _row_normalize(m: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return m / norms
