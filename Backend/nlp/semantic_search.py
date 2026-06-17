"""Hybrid semantic search: BM25 + Dense (FAISS) + RRF + Cross-encoder + MMR.

Pipeline (per query):
  BM25 top-200  ─┐
                  ├─ RRF fusion → top-100 → Cross-encoder rerank → top-30 → MMR → top-20
  FAISS top-200 ─┘

Public API used by api.py:
  embed_segments(audio_id)   embed & store all segments for one audio, update index.
                              Call this FIRST in _run_ml_and_save — Ofir's coded-language
                              pipeline and Ofek's entity resolution both depend on the
                              stored Segments.Embedding vectors.
  search(query, ...)         full retrieval pipeline, returns up to top_k result dicts.
  rebuild_index()            reload the complete index from DB (for POST /search/reindex).
"""
from __future__ import annotations

import logging
import re
import threading
from typing import Optional

import numpy as np

from . import models as _models
from .reranker import rerank

log = logging.getLogger(__name__)

# ── Index state ───────────────────────────────────────────────────────────────
# Position i in _seg_ids / _seg_texts / _seg_vecs corresponds to position i in
# both the FAISS index and the BM25 corpus.
#
# Thread-safety: _index_lock guards all writes. Searches snapshot the index
# objects under the lock and then read outside it. _add_to_index builds a
# brand-new FAISS index object (copy-on-write) so an in-flight search holding
# a reference to the old object is never affected by a concurrent add.
_seg_ids: list[int] = []
_seg_texts: list[str] = []
_seg_vecs: list[np.ndarray] = []          # normalized float32 vectors, parallel to above
_faiss_index = None                        # faiss.IndexFlatIP
_bm25 = None                               # rank_bm25.BM25Okapi
_index_lock = threading.Lock()

_RRF_K = 60         # Cormack et al. 2009 constant
_RANKER_TOP = 200   # candidates from each ranker
_RERANK_TOP = 30    # cross-encoder input size
_MMR_TOP = 20       # final output size
_MMR_LAMBDA = 0.7   # relevance vs diversity weight
_RELEVANCE_MARGIN = 4.0  # semantic-only matches must score within this of the
                          # pool's best cross-encoder score (absolute scores
                          # aren't comparable across queries of different length)
_ABSOLUTE_FLOOR = -9.0   # ...and never below this, even if "best" is itself weak
_MIN_SEMANTIC_WORDS = 3     # below this, fragments like "Yeah." are dropped
                            # unless they literally contain the query
_RELATED_TERM_MIN_SIM = 0.35  # min bi-encoder similarity to surface a "related via" word

_WORD_RE = re.compile(r"[A-Za-z']{3,}")
_STOPWORDS = frozenset({
    "the", "a", "an", "and", "or", "but", "if", "so", "to", "of", "in", "on",
    "at", "for", "with", "from", "by", "as", "is", "are", "was", "were", "be",
    "been", "being", "this", "that", "these", "those", "it", "its", "i", "you",
    "he", "she", "we", "they", "me", "him", "her", "us", "them", "my", "your",
    "his", "our", "their", "do", "does", "did", "doing", "done", "have", "has",
    "had", "having", "not", "no", "yes", "yeah", "nope", "ok", "okay", "um",
    "uh", "huh", "well", "just", "really", "very", "too", "also", "actually",
    "basically", "literally", "like", "gonna", "wanna", "gotta", "get", "got",
    "going", "go", "goes", "want", "wants", "wanted", "know", "knows", "knew",
    "think", "thinks", "thought", "say", "says", "said", "see", "sees", "saw",
    "there", "here", "what", "when", "where", "who", "which", "how", "why",
    "all", "some", "any", "more", "most", "other", "such", "only", "own",
    "same", "than", "then", "now", "out", "up", "down", "into", "about",
    "would", "could", "should", "will", "shall", "can", "may", "might", "must",
    "one", "two", "thing", "things", "something", "someone", "anything",
    "nothing", "everything", "right", "sure", "maybe", "probably", "kind",
    "lot", "bit", "way",
})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    return text.lower().split()


def _normalize_rows(mat: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


def _build_faiss(mat: np.ndarray):
    import faiss  # type: ignore
    index = faiss.IndexFlatIP(mat.shape[1])
    index.add(mat)
    return index


def _build_bm25(texts: list[str]):
    from rank_bm25 import BM25Okapi  # type: ignore
    corpus = [_tokenize(t) for t in texts]
    return BM25Okapi(corpus) if corpus else None


# ── Public: (re)build full index from DB ─────────────────────────────────────

def rebuild_index() -> int:
    """Reload the full FAISS + BM25 index from all stored segment embeddings.
    Blocks until done. Returns the number of indexed segments."""
    global _seg_ids, _seg_texts, _seg_vecs, _faiss_index, _bm25
    import database  # late import — avoids circular dep at module load time

    rows = database.get_all_segments_with_embeddings()

    ids, texts, vecs = [], [], []
    for r in rows:
        emb = r["embedding"]
        if emb is None or len(emb) != _models.EMBED_DIM:
            continue
        ids.append(r["id"])
        texts.append(r["text"] or "")
        vecs.append(np.asarray(emb, dtype=np.float32))

    # Build new index objects outside the lock — heavy work, no shared state yet.
    new_faiss = None
    new_bm25 = None
    norm_vecs: list[np.ndarray] = []
    if vecs:
        mat = _normalize_rows(np.stack(vecs))
        norm_vecs = [mat[i] for i in range(len(mat))]
        new_faiss = _build_faiss(mat)
        new_bm25 = _build_bm25(texts)

    with _index_lock:
        _seg_ids = ids
        _seg_texts = texts
        _seg_vecs = norm_vecs
        _faiss_index = new_faiss
        _bm25 = new_bm25

    log.info("[semantic_search] index built: %d segments", len(ids))
    return len(ids)


# ── Internal: extend index after a new audio is embedded ─────────────────────

def _add_to_index(new_ids: list[int], new_texts: list[str], new_vecs: list[np.ndarray]) -> None:
    """Extend the index with newly embedded segments.

    Builds brand-new FAISS and BM25 objects outside the lock (copy-on-write),
    then swaps them in atomically. In-flight searches holding references to the
    old objects are unaffected.
    """
    global _seg_ids, _seg_texts, _seg_vecs, _faiss_index, _bm25
    if not new_ids:
        return

    new_mat = _normalize_rows(np.stack(new_vecs).astype(np.float32))
    new_norm_vecs = [new_mat[i] for i in range(len(new_mat))]

    # Snapshot current state under the lock, then build outside it.
    with _index_lock:
        combined_ids = _seg_ids + new_ids
        combined_texts = _seg_texts + new_texts
        combined_vecs = _seg_vecs + new_norm_vecs

    # Heavy work outside the lock
    if combined_vecs:
        full_mat = np.stack(combined_vecs)
        new_faiss = _build_faiss(full_mat)
    else:
        new_faiss = None
    new_bm25 = _build_bm25(combined_texts)

    # Atomic swap
    with _index_lock:
        _seg_ids = combined_ids
        _seg_texts = combined_texts
        _seg_vecs = combined_vecs
        _faiss_index = new_faiss
        _bm25 = new_bm25


# ── Public: embed one audio's segments and update the index ──────────────────

def embed_segments(audio_id: int) -> int:
    """Encode every segment of audio_id with BAAI/bge-small-en-v1.5, persist
    the vectors in Segments.Embedding, and add them to the in-memory search index.

    Ofir's score_coded_language() calls its own _embed_segments() as a fallback,
    but since this runs first in _run_ml_and_save the embeddings will already be
    present and that fallback becomes a no-op.

    Returns the number of segments embedded.
    """
    import database  # late import

    segments = database.get_segments_by_audio(audio_id)
    if not segments:
        return 0

    model = _models.get_embed_model()
    texts = [s["text"] or "" for s in segments]

    vecs = model.encode(
        texts,
        batch_size=32,
        normalize_embeddings=True,
        show_progress_bar=False,
    )

    new_ids, new_texts, new_vecs = [], [], []
    for seg, vec in zip(segments, vecs):
        arr = np.asarray(vec, dtype=np.float32)
        database.set_segment_embedding(seg["id"], arr, _models.EMBED_MODEL_NAME)
        new_ids.append(seg["id"])
        new_texts.append(seg["text"] or "")
        new_vecs.append(arr)

    _add_to_index(new_ids, new_texts, new_vecs)
    log.info("[semantic_search] embedded %d segments for audio %s", len(new_ids), audio_id)
    return len(new_ids)


# ── Public: search ────────────────────────────────────────────────────────────

def search(
    query: str,
    audio_id: Optional[int] = None,
    speaker_id: Optional[int] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    top_k: int = _MMR_TOP,
) -> list[dict]:
    """Full hybrid retrieval pipeline.

    Args:
        query:      free-text search string.
        audio_id:   if set, restrict to segments from this recording.
        speaker_id: if set, restrict to segments from this speaker.
        from_date:  ISO date string lower bound on Audios.RecordedAt.
        to_date:    ISO date string upper bound on Audios.RecordedAt.
        top_k:      final result count (capped at _MMR_TOP).

    Returns a list of result dicts (see database.get_segment_details_bulk for shape),
    each with an extra "score" float from the cross-encoder, an "exactMatch"
    bool, and a "relatedTerm" — the single word in the text most semantically
    similar to the query (None for exact matches, or if nothing clears
    _RELATED_TERM_MIN_SIM). Results with a literal (case-insensitive) match of
    `query` in their text are sorted ahead of semantic-only matches and always
    kept regardless of cross-encoder score. Semantic-only matches are dropped
    if they score more than _RELEVANCE_MARGIN below the best semantic score (or
    below _ABSOLUTE_FLOOR outright), and low-content fragments shorter than
    _MIN_SEMANTIC_WORDS are dropped unless they're a literal match — so this can
    return fewer than top_k results, or none, if nothing in the corpus is a
    real match.
    """
    import database  # late import

    if not query.strip():
        return []

    q_lower = query.strip().lower()
    model = _models.get_embed_model()

    # 1. Embed query
    q_vec = np.asarray(
        model.encode([query], normalize_embeddings=True, show_progress_bar=False)[0],
        dtype=np.float32,
    )

    with _index_lock:
        n = len(_seg_ids)
        faiss_idx = _faiss_index
        bm25 = _bm25
        seg_ids_snap = list(_seg_ids)

    if n == 0 or faiss_idx is None:
        return []

    # 2. BM25 lexical search → top-200 positions
    bm25_top: list[int] = []
    if bm25 is not None:
        scores = bm25.get_scores(_tokenize(query))
        bm25_top = sorted(range(len(scores)), key=lambda i: -scores[i])[:_RANKER_TOP]

    # 3. FAISS dense search → top-200 positions
    k = min(_RANKER_TOP, n)
    _, faiss_positions = faiss_idx.search(q_vec.reshape(1, -1), k)
    faiss_top = [int(p) for p in faiss_positions[0] if p >= 0]

    # 4. RRF fusion
    rrf: dict[int, float] = {}
    for rank, pos in enumerate(bm25_top):
        sid = seg_ids_snap[pos]
        rrf[sid] = rrf.get(sid, 0.0) + 1.0 / (_RRF_K + rank)
    for rank, pos in enumerate(faiss_top):
        sid = seg_ids_snap[pos]
        rrf[sid] = rrf.get(sid, 0.0) + 1.0 / (_RRF_K + rank)

    top100_ids = sorted(rrf, key=rrf.__getitem__, reverse=True)[:100]
    if not top100_ids:
        return []

    # 5. Fetch metadata + apply optional filters
    candidates = database.get_segment_details_bulk(
        top100_ids,
        audio_id=audio_id,
        speaker_id=speaker_id,
        from_date=from_date,
        to_date=to_date,
    )
    if not candidates:
        return []

    # 5b. Drop low-content fragments ("Yeah.", "So.", "No problem.") from
    #     semantic consideration — short filler crowds out real matches and
    #     the cross-encoder is unreliable on near-empty passages. Literal
    #     matches of the query are kept regardless of length.
    candidates = [
        c for c in candidates
        if q_lower in c["text"].lower() or len(_tokenize(c["text"])) >= _MIN_SEMANTIC_WORDS
    ]
    if not candidates:
        return []

    # 6. Cross-encoder score everything. Literal matches of the query are
    #    always kept — the user typed that exact text, it doesn't need the
    #    cross-encoder's blessing. Semantic-only matches are kept only if
    #    they're within _RELEVANCE_MARGIN of the best semantic score: the
    #    cross-encoder's *absolute* scores swing wildly with query length
    #    (a single-word query like "drive" scores every candidate negative,
    #    even ones literally about driving), but its *relative* ranking
    #    within one query's pool is still meaningful.
    exact_candidates = [c for c in candidates if q_lower in c["text"].lower()]
    semantic_candidates = [c for c in candidates if q_lower not in c["text"].lower()]

    pairs = [(query, c["text"]) for c in exact_candidates + semantic_candidates]
    cross_scores = rerank(pairs)
    exact_scored = list(zip(exact_candidates, cross_scores[:len(exact_candidates)]))
    semantic_scored = list(zip(semantic_candidates, cross_scores[len(exact_candidates):]))

    semantic_scored.sort(key=lambda x: x[1], reverse=True)
    if semantic_scored:
        cutoff = max(semantic_scored[0][1] - _RELEVANCE_MARGIN, _ABSOLUTE_FLOOR)
        semantic_scored = [(c, s) for c, s in semantic_scored if s > cutoff]

    exact_scored.sort(key=lambda x: x[1], reverse=True)
    ranked = (exact_scored + semantic_scored)[:_RERANK_TOP]

    if not ranked:
        return []

    # 7. MMR diversification → top_k
    #    Relevance = normalized cross-encoder score (keeps the cross-encoder's
    #    judgment authoritative); redundancy = bi-encoder cosine similarity
    #    between candidate texts (diversity only — bi-encoder similarity is too
    #    weak a signal to drive relevance, which is why we rerank in step 6).
    texts_for_mmr = [c["text"] for c, _ in ranked]
    mmr_vecs = np.asarray(
        model.encode(texts_for_mmr, normalize_embeddings=True, show_progress_bar=False),
        dtype=np.float32,
    )

    scores_arr = np.asarray([s for _, s in ranked], dtype=np.float32)
    lo, hi = float(scores_arr.min()), float(scores_arr.max())
    norm_scores = (scores_arr - lo) / (hi - lo) if hi > lo else np.ones_like(scores_arr)

    selected = _mmr(norm_scores, mmr_vecs, min(top_k, _MMR_TOP))
    results = [{**ranked[i][0], "score": float(ranked[i][1])} for i in selected]

    # 8. Literal matches of the query surface before semantic-only matches.
    #    For semantic-only matches, flag the content word most similar to the
    #    query so the UI can explain *why* it was surfaced.
    exact = [r for r in results if q_lower in r["text"].lower()]
    related = [r for r in results if q_lower not in r["text"].lower()]
    for r in exact:
        r["exactMatch"] = True
        r["relatedTerm"] = None
    for r in related:
        r["exactMatch"] = False
    _attach_related_terms(related, query, q_vec, model)
    return exact + related


def _attach_related_terms(results: list[dict], query: str, q_vec: np.ndarray, model) -> None:
    """Set result["relatedTerm"] to the single content word in its text most
    similar to the query (e.g. query "drive" → "car"), or None if nothing
    clears _RELATED_TERM_MIN_SIM. Mutates `results` in place."""
    q_words = {w.lower() for w in _WORD_RE.findall(query)}

    per_result_words: list[list[str]] = []
    all_words: set[str] = set()
    for r in results:
        seen: set[str] = set()
        words: list[str] = []
        for w in _WORD_RE.findall(r["text"]):
            if w.lower().endswith("'s"):
                w = w[:-2]
                if not w:
                    continue
            lw = w.lower()
            if lw in _STOPWORDS or lw in q_words or lw in seen:
                continue
            seen.add(lw)
            words.append(w)
        per_result_words.append(words)
        all_words.update(w.lower() for w in words)

    if not all_words:
        for r in results:
            r["relatedTerm"] = None
        return

    word_list = sorted(all_words)
    word_vecs = np.asarray(
        model.encode(word_list, normalize_embeddings=True, show_progress_bar=False),
        dtype=np.float32,
    )
    sim_by_word = dict(zip(word_list, word_vecs @ q_vec))

    for r, words in zip(results, per_result_words):
        best_word, best_sim = None, _RELATED_TERM_MIN_SIM
        for w in words:
            sim = float(sim_by_word[w.lower()])
            if sim > best_sim:
                best_sim, best_word = sim, w
        r["relatedTerm"] = best_word


def _mmr(relevance: np.ndarray, candidate_vecs: np.ndarray, k: int) -> list[int]:
    """Maximal Marginal Relevance — iterative greedy selection.

    `relevance[i]` is the (pre-normalized) relevance score for candidate i;
    `candidate_vecs` (bi-encoder embeddings) drive the redundancy/diversity term.
    Returns a list of indices into candidate_vecs."""
    n = len(candidate_vecs)
    k = min(k, n)
    selected: list[int] = []
    remaining = list(range(n))

    for _ in range(k):
        best_idx, best_score = -1, float("-inf")
        for i in remaining:
            redundancy = (
                max(float(np.dot(candidate_vecs[i], candidate_vecs[j])) for j in selected)
                if selected else 0.0
            )
            score = _MMR_LAMBDA * float(relevance[i]) - (1.0 - _MMR_LAMBDA) * redundancy
            if score > best_score:
                best_score, best_idx = score, i
        if best_idx == -1:
            break
        selected.append(best_idx)
        remaining.remove(best_idx)

    return selected
