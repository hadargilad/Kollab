"""
Speaker matcher for Kollab.

The matcher decides, given a fresh speaker's window embeddings, whether they
correspond to a speaker we already know — and at what confidence tier:

  cosine ≥ AUTO_MATCH_THRESHOLD (0.60) → auto-attribute
  cosine in [SUGGEST_THRESHOLD, AUTO)  → flag a suggestion (UI confirms)
  cosine <  SUGGEST_THRESHOLD          → register as a brand-new unknown

Score per candidate speaker is symmetric max-pool: max cosine over every
(query_window × stored_sample) pair. Both sides keep their windows, so the
single closest matching moment between the new recording and the stored bucket
sets the score.

This module is the single owner of the speaker-recognition decision logic.
The ML service only extracts vectors; storage and identity decisions live here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal, Optional

import numpy as np

import database


AUTO_MATCH_THRESHOLD = 0.60
SUGGEST_THRESHOLD = 0.40
LEARN_THRESHOLD = 0.85


MatchStatus = Literal["auto_matched", "suggested", "new_unknown"]


@dataclass
class MatchResult:
    speaker_id: int
    confidence: float
    status: MatchStatus
    suggested_speaker_id: Optional[int] = None
    suggested_speaker_name: Optional[str] = None


def max_cosine(query: np.ndarray, corpus: np.ndarray) -> float:
    """Symmetric max-pool: largest cosine across every (q_row, c_row) pair.
    Inputs are L2-normalized at the source (ECAPA output is normalized in
    pipeline.get_window_embeddings), so cosine reduces to a dot product."""
    sims = query @ corpus.T
    return float(sims.max())


# Back-compat: existing callers (and tests) used the underscored name.
_max_cosine = max_cosine


def rank_candidates(query_speaker_id: int, candidate_ids: Iterable[int]) -> list[tuple[int, float]]:
    """Score each candidate against the query speaker's stored windows using
    symmetric max-pool. Returns [(speaker_id, confidence), ...] sorted desc.
    Speakers without embeddings are skipped (confidence=0)."""
    corpus = database.get_all_embeddings()
    query = corpus.get(query_speaker_id)
    if query is None or query.size == 0:
        return []
    results: list[tuple[int, float]] = []
    for sid in candidate_ids:
        if sid == query_speaker_id:
            continue
        vecs = corpus.get(sid)
        if vecs is None or vecs.size == 0:
            continue
        results.append((sid, round(max_cosine(query, vecs), 3)))
    results.sort(key=lambda x: x[1], reverse=True)
    return results


def match_or_register(
    query_windows: np.ndarray,
    taken_speaker_ids: set[int],
    model_version: str,
    source_audio_id: Optional[int] = None,
) -> MatchResult:
    """Score `query_windows` (shape (N, 192)) against every speaker in the DB.

    Excludes any speaker already claimed by another diarized speaker in this
    same recording (per-recording de-collision via taken_speaker_ids).

    Branches on the best score:
      - ≥ AUTO_MATCH_THRESHOLD → return that speaker. If also ≥ LEARN, append
        the query windows so they sharpen future matches.
      - in [SUGGEST, AUTO)     → register a fresh unknown to hold the segments,
        AND record the suggested match for the UI. The suggested speaker is
        not modified.
      - else                   → register a fresh unknown silently.
    """
    arr = np.asarray(query_windows, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)

    corpus = database.get_all_embeddings()
    named_ids = database.get_named_speaker_ids()
    available = {
        sid: vecs for sid, vecs in corpus.items()
        if sid not in taken_speaker_ids and sid in named_ids
    }

    best_id: Optional[int] = None
    best_score = 0.0
    if available and arr.size > 0:
        for sid, vecs in available.items():
            score = _max_cosine(arr, vecs)
            if score > best_score:
                best_score, best_id = score, sid

    if best_id is not None and best_score >= AUTO_MATCH_THRESHOLD:
        if best_score >= LEARN_THRESHOLD:
            database.insert_embeddings(best_id, arr, model_version, source_audio_id)
        return MatchResult(
            speaker_id=best_id,
            confidence=round(best_score, 3),
            status="auto_matched",
        )

    new_speaker_id, _new_name = database.create_unknown_speaker()
    database.insert_embeddings(new_speaker_id, arr, model_version, source_audio_id)

    if best_id is not None and best_score >= SUGGEST_THRESHOLD:
        suggested = database.get_speaker(best_id)
        return MatchResult(
            speaker_id=new_speaker_id,
            confidence=round(best_score, 3),
            status="suggested",
            suggested_speaker_id=best_id,
            suggested_speaker_name=suggested["name"] if suggested else None,
        )

    return MatchResult(
        speaker_id=new_speaker_id,
        confidence=round(best_score, 3),
        status="new_unknown",
    )
