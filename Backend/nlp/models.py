"""Singleton model loaders shared across the nlp/ subpackage.

Ofir is the first caller (coded-language detection). Hadar's semantic_search.py
and Ofek's ner.py / entity_resolution.py should add their own getters here and
reuse the same threading.Lock pattern so concurrent first-uploads don't trigger
duplicate HF downloads.

TODO(hadar): get_cross_encoder() for ms-marco-MiniLM reranker.
TODO(ofek):  get_ner_model()      for dslim/bert-base-NER.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Optional, Tuple

log = logging.getLogger(__name__)

# Model identifiers — exposed so callers can persist them alongside cached vectors
EMBED_MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384  # bge-small-en-v1.5

LM_MODEL_NAME = "distilgpt2"

NER_MODEL_NAME = "dslim/bert-base-NER"

_lock = threading.Lock()

_embed_model: Optional[Any] = None
_lm_tokenizer: Optional[Any] = None
_lm_model: Optional[Any] = None
_ner_pipeline: Optional[Any] = None

# TF-IDF state: vectorizer + the segment count we last fitted on. We refit when
# the corpus has grown by >= TFIDF_REFIT_THRESHOLD segments.
_tfidf_vectorizer: Optional[Any] = None
_tfidf_last_fit_count: int = 0
TFIDF_REFIT_THRESHOLD = 100
TFIDF_MIN_CORPUS = 50  # below this, IDFs are noise — caller should skip Signal B


def get_embed_model() -> Any:
    """SentenceTransformer for segment embeddings.

    TODO(hadar): when semantic_search.py lands, keep using *this* singleton —
    don't load a second SentenceTransformer.
    """
    global _embed_model
    if _embed_model is not None:
        return _embed_model
    with _lock:
        if _embed_model is None:
            from sentence_transformers import SentenceTransformer
            log.info("[nlp.models] loading embed model %s", EMBED_MODEL_NAME)
            _embed_model = SentenceTransformer(EMBED_MODEL_NAME)
    return _embed_model


def get_lm() -> Tuple[Any, Any]:
    """distilgpt2 (tokenizer, model) on CPU in eval mode. Used by Signal C."""
    global _lm_tokenizer, _lm_model
    if _lm_tokenizer is not None and _lm_model is not None:
        return _lm_tokenizer, _lm_model
    with _lock:
        if _lm_tokenizer is None or _lm_model is None:
            from transformers import AutoModelForCausalLM, AutoTokenizer
            log.info("[nlp.models] loading LM %s", LM_MODEL_NAME)
            tok = AutoTokenizer.from_pretrained(LM_MODEL_NAME)
            # distilgpt2 has no pad token by default; alias EOS for safety
            if tok.pad_token is None:
                tok.pad_token = tok.eos_token
            mdl = AutoModelForCausalLM.from_pretrained(LM_MODEL_NAME)
            mdl.eval()
            _lm_tokenizer = tok
            _lm_model = mdl
    return _lm_tokenizer, _lm_model


def get_ner_model() -> Any:
    """HuggingFace token-classification pipeline for dslim/bert-base-NER."""
    global _ner_pipeline
    if _ner_pipeline is not None:
        return _ner_pipeline
    with _lock:
        if _ner_pipeline is None:
            from transformers import pipeline
            log.info("[nlp.models] loading NER model %s", NER_MODEL_NAME)
            _ner_pipeline = pipeline(
                "ner",
                model=NER_MODEL_NAME,
                aggregation_strategy="simple",
            )
    return _ner_pipeline


def get_tfidf(corpus_texts_provider) -> Optional[Any]:
    """Returns a fitted sklearn TfidfVectorizer, refitting if the corpus has grown.

    `corpus_texts_provider` is a callable that returns the current `list[str]` of
    all segment texts in the DB. We accept a callable (not the list itself) so we
    avoid the DB hit when the cache is still hot.

    Returns None if the global corpus is below TFIDF_MIN_CORPUS — in that case
    IDF values are too noisy to be meaningful and Signal B should return 0.
    """
    global _tfidf_vectorizer, _tfidf_last_fit_count
    from sklearn.feature_extraction.text import TfidfVectorizer  # local — heavy import

    # Peek at corpus size first; if too small, bail without fitting.
    texts = corpus_texts_provider()
    n = len(texts)
    if n < TFIDF_MIN_CORPUS:
        return None
    needs_fit = (
        _tfidf_vectorizer is None
        or n >= _tfidf_last_fit_count + TFIDF_REFIT_THRESHOLD
    )
    if not needs_fit:
        return _tfidf_vectorizer
    with _lock:
        # Re-check inside the lock
        if (
            _tfidf_vectorizer is not None
            and n < _tfidf_last_fit_count + TFIDF_REFIT_THRESHOLD
        ):
            return _tfidf_vectorizer
        log.info("[nlp.models] fitting TF-IDF on %d segments", n)
        vec = TfidfVectorizer(stop_words="english", lowercase=True, min_df=1)
        try:
            vec.fit(texts)
        except ValueError:
            # All-stopword corpus or similar — degrade gracefully.
            return None
        _tfidf_vectorizer = vec
        _tfidf_last_fit_count = n
    return _tfidf_vectorizer


def warm_up() -> None:
    """Best-effort eager load. Called from FastAPI startup in a background
    thread so uvicorn boots immediately. Safe to call multiple times."""
    try:
        get_embed_model()
        get_lm()
        get_ner_model()
        log.info("[nlp.models] warm-up complete")
    except Exception:
        log.exception("[nlp.models] warm-up failed")
