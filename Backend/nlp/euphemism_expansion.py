"""Bootstrap euphemism dictionary expansion.

Seeds = `seed_euphemisms.json` + anything already in `DangerousWords` with
`IsEuphemism=1`. Expansion mines n-gram phrases from the segment corpus and
accepts those whose "context vector" (mean embedding of the segments that
contain them) is sufficiently close to a seed's context AND that have a
positive PMI when comparing in-domain (segments touching any current
euphemism) to out-of-domain segments.

Public entry: `expand_euphemisms()` → summary dict.
Also: `ensure_seeds_loaded()` — idempotent loader so the very first call to
the API has something in the dictionary.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from . import models

log = logging.getLogger(__name__)

SEED_FILE = Path(__file__).with_name("seed_euphemisms.json")

# Expansion thresholds
COSINE_THRESHOLD = 0.80
PMI_THRESHOLD = 2.0
MAX_CANDIDATES = 200          # cap for performance
MIN_PHRASE_OCCURRENCES = 2    # candidate must appear in ≥ this many segments
NGRAM_RANGE = (1, 3)


def ensure_seeds_loaded() -> int:
    """Insert any seed phrases that aren't yet in the DB. Returns count inserted.
    Safe to call repeatedly — UNIQUE COLLATE NOCASE dedupes."""
    import database
    inserted = 0
    try:
        data = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        log.warning("[euphemism_expansion] seed file missing at %s", SEED_FILE)
        return 0
    phrases = [p for category in data.values() for p in category]
    for phrase in phrases:
        result = database.add_euphemism(phrase, severity="high", auto_learned=False)
        if result is not None:
            inserted += 1
    if inserted:
        log.info("[euphemism_expansion] seeded %d new euphemisms", inserted)
    return inserted


def expand_euphemisms() -> dict:
    import database

    seeds = database.list_euphemisms()
    if not seeds:
        ensure_seeds_loaded()
        seeds = database.list_euphemisms()
    if not seeds:
        return {"added": 0, "candidates_considered": 0, "samples": []}

    segments = database.get_all_segments_with_embeddings()
    segments = [s for s in segments if s["embedding"] is not None and s["text"].strip()]
    if len(segments) < 10:
        return {"added": 0, "candidates_considered": 0,
                "samples": [], "note": "corpus too small"}

    seed_phrases = [s["phrase"].lower() for s in seeds]
    seed_set = set(seed_phrases)

    # Mean embedding across all segments containing any current seed = "seed context".
    in_domain_segs: List[dict] = []
    out_domain_segs: List[dict] = []
    for s in segments:
        text_l = s["text"].lower()
        if any(p in text_l for p in seed_phrases):
            in_domain_segs.append(s)
        else:
            out_domain_segs.append(s)
    if not in_domain_segs:
        return {"added": 0, "candidates_considered": 0,
                "samples": [], "note": "no seed phrases occur in corpus"}

    seed_context = _row_normalize(
        np.mean(np.stack([s["embedding"] for s in in_domain_segs]).astype(np.float32),
                axis=0, keepdims=True)
    )[0]

    # Mine candidate n-grams
    try:
        from sklearn.feature_extraction.text import CountVectorizer
    except ImportError:
        log.exception("sklearn not available — cannot expand euphemisms")
        return {"added": 0, "candidates_considered": 0, "samples": []}

    cv = CountVectorizer(ngram_range=NGRAM_RANGE, stop_words="english",
                         lowercase=True, min_df=MIN_PHRASE_OCCURRENCES)
    try:
        cv.fit([s["text"] for s in segments])
    except ValueError:
        return {"added": 0, "candidates_considered": 0, "samples": []}
    vocab = cv.get_feature_names_out()

    # Pre-tokenize segment texts once
    text_lc = [s["text"].lower() for s in segments]
    in_domain_idx = {id(s) for s in in_domain_segs}
    in_total = max(1, len(in_domain_segs))
    out_total = max(1, len(out_domain_segs))

    # Score candidates by (cosine to seed context) * (PMI gating)
    candidates: List[Tuple[str, float, float]] = []
    for phrase in vocab:
        if phrase in seed_set:
            continue
        # Count occurrences across in- vs out-of-domain segments
        in_count = 0
        out_count = 0
        contexts: List[np.ndarray] = []
        for s, lc in zip(segments, text_lc):
            if phrase not in lc:
                continue
            contexts.append(s["embedding"])
            if id(s) in in_domain_idx:
                in_count += 1
            else:
                out_count += 1
        if in_count + out_count < MIN_PHRASE_OCCURRENCES:
            continue
        if in_count == 0:
            continue
        # PMI(phrase, domain) = log( P(phrase|in) / P(phrase|out) )
        p_in = in_count / in_total
        p_out = max(out_count / out_total, 1e-6)
        pmi = math.log(p_in / p_out)
        if pmi < PMI_THRESHOLD:
            continue
        ctx_mean = _row_normalize(np.mean(np.stack(contexts), axis=0, keepdims=True))[0]
        cos = float(np.dot(ctx_mean, seed_context))
        if cos < COSINE_THRESHOLD:
            continue
        candidates.append((phrase, cos, pmi))
        if len(candidates) >= MAX_CANDIDATES:
            break

    # Sort by cosine desc, insert
    candidates.sort(key=lambda x: x[1], reverse=True)
    added: List[dict] = []
    embed = None
    for phrase, cos, _pmi in candidates:
        if embed is None:
            embed = models.get_embed_model()
        vec = np.asarray(
            embed.encode([phrase], show_progress_bar=False, normalize_embeddings=True),
            dtype=np.float32,
        )[0]
        row = database.add_euphemism(
            phrase=phrase,
            severity="medium",
            auto_learned=True,
            confidence=float(cos),
            embedding=vec,
            embedding_model=models.EMBED_MODEL_NAME,
        )
        if row is not None:
            added.append(row)

    return {
        "added": len(added),
        "candidates_considered": len(candidates),
        "samples": added[:10],
    }


def _row_normalize(m: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return m / norms
