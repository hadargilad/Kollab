"""Cross-encoder re-ranker singleton.

Scores (query, passage) pairs much more accurately than bi-encoder cosine
similarity because the model sees both texts together. Used as the second-pass
filter after BM25+FAISS RRF fusion. Only called on the top-100 candidates so
the latency cost is acceptable.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Optional

log = logging.getLogger(__name__)

_lock = threading.Lock()
_cross_encoder: Optional[Any] = None
_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"


def get_cross_encoder() -> Any:
    global _cross_encoder
    if _cross_encoder is not None:
        return _cross_encoder
    with _lock:
        if _cross_encoder is None:
            from sentence_transformers import CrossEncoder  # type: ignore
            log.info("[reranker] loading %s", _MODEL_NAME)
            _cross_encoder = CrossEncoder(_MODEL_NAME)
    return _cross_encoder


def rerank(pairs: list[tuple[str, str]]) -> list[float]:
    """Score (query, passage) pairs. Returns one float per pair (higher = more relevant)."""
    if not pairs:
        return []
    return [float(s) for s in get_cross_encoder().predict(pairs)]
