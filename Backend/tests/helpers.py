"""Test-only helpers for constructing embedding vectors with a known cosine
similarity, so matcher tests can target exact threshold boundaries instead of
hoping random vectors land in the right tier."""

import numpy as np

from database import EMBEDDING_DIM


def vec_with_cosine(cosine: float, dim: int = EMBEDDING_DIM) -> tuple[np.ndarray, np.ndarray]:
    """Return two unit row-vectors (1, dim) whose cosine similarity is exactly
    `cosine`. v1 is the first basis vector; v2 is built in the plane spanned by
    the first two basis vectors so the result is exact regardless of dim."""
    v1 = np.zeros((1, dim), dtype=np.float32)
    v1[0, 0] = 1.0
    v2 = np.zeros((1, dim), dtype=np.float32)
    v2[0, 0] = cosine
    v2[0, 1] = np.sqrt(max(0.0, 1.0 - cosine * cosine))
    return v1, v2
