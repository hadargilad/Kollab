"""Covers the three-tier match decision in matcher.py (CLAUDE.md's "Speaker
recognition" section) and the per-recording de-collision rule. These are the
parts most likely to silently regress, since the thresholds and the
de-collision set are easy to touch by accident while changing nearby code."""

import numpy as np

import database
import matcher
from helpers import vec_with_cosine


def _make_named_speaker(db, name: str) -> int:
    speaker_id, _created = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return speaker_id


def test_max_cosine_is_symmetric_max_pool():
    # Query has two windows; corpus has two windows. The true match is the
    # (query[1], corpus[0]) pair — max_cosine must find it even though it's
    # not the first pair checked.
    query = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float32)
    corpus = np.array([[0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], dtype=np.float32)
    assert matcher.max_cosine(query, corpus) == 1.0


def test_score_at_or_above_auto_threshold_auto_attributes(db):
    target_id = _make_named_speaker(db, "Alice")
    enrolled, query = vec_with_cosine(matcher.AUTO_MATCH_THRESHOLD)
    db.insert_embeddings(target_id, enrolled, "v1")

    result = matcher.match_or_register(query, taken_speaker_ids=set(), model_version="v1")

    assert result.status == "auto_matched"
    assert result.speaker_id == target_id
    # Below LEARN_THRESHOLD, the query windows must NOT be appended.
    assert database.count_embeddings(target_id) == 1


def test_score_at_or_above_learn_threshold_also_appends_windows(db):
    target_id = _make_named_speaker(db, "Bob")
    enrolled, query = vec_with_cosine(matcher.LEARN_THRESHOLD)
    db.insert_embeddings(target_id, enrolled, "v1")

    result = matcher.match_or_register(query, taken_speaker_ids=set(), model_version="v1")

    assert result.status == "auto_matched"
    assert result.speaker_id == target_id
    assert database.count_embeddings(target_id) == 2


def test_score_in_suggest_band_creates_unknown_and_suggestion(db):
    target_id = _make_named_speaker(db, "Carol")
    enrolled, query = vec_with_cosine(
        (matcher.SUGGEST_THRESHOLD + matcher.AUTO_MATCH_THRESHOLD) / 2
    )
    db.insert_embeddings(target_id, enrolled, "v1")

    result = matcher.match_or_register(query, taken_speaker_ids=set(), model_version="v1")

    assert result.status == "suggested"
    assert result.speaker_id != target_id
    assert result.suggested_speaker_id == target_id
    assert result.suggested_speaker_name == "Carol"
    # The candidate's own bucket is untouched by a mere suggestion.
    assert database.count_embeddings(target_id) == 1


def test_score_below_suggest_threshold_is_silent_new_unknown(db):
    target_id = _make_named_speaker(db, "Dave")
    enrolled, query = vec_with_cosine(matcher.SUGGEST_THRESHOLD - 0.05)
    db.insert_embeddings(target_id, enrolled, "v1")

    result = matcher.match_or_register(query, taken_speaker_ids=set(), model_version="v1")

    assert result.status == "new_unknown"
    assert result.suggested_speaker_id is None
    assert result.speaker_id != target_id


def test_unnamed_speaker_is_not_a_match_candidate(db):
    # "Speaker N" auto-names are excluded from matching entirely (AUD-52:
    # named-only speaker matching) — even a perfect score must not match them.
    unnamed_id, _name = db.create_unknown_speaker()
    enrolled, query = vec_with_cosine(1.0)
    db.insert_embeddings(unnamed_id, enrolled, "v1")

    result = matcher.match_or_register(query, taken_speaker_ids=set(), model_version="v1")

    assert result.status == "new_unknown"
    assert result.speaker_id != unnamed_id


def test_taken_speaker_is_excluded_even_with_a_perfect_score(db):
    # Per-recording de-collision: a speaker already claimed elsewhere in this
    # recording can't be matched again, regardless of how strong the score is.
    target_id = _make_named_speaker(db, "Eve")
    enrolled, query = vec_with_cosine(1.0)
    db.insert_embeddings(target_id, enrolled, "v1")

    result = matcher.match_or_register(
        query, taken_speaker_ids={target_id}, model_version="v1"
    )

    assert result.status == "new_unknown"
    assert result.speaker_id != target_id
