"""Covers the database.py behaviors CLAUDE.md calls out as easy to get wrong:
unknown-speaker numbering, the 50-window cap with oldest-first eviction, and
the move_embeddings-before-merge_speakers ordering required by the FK cascade."""

import numpy as np

from database import CAP_SAMPLES_PER_SPEAKER, EMBEDDING_DIM


def _unit_vector(index: int, dim: int = EMBEDDING_DIM) -> np.ndarray:
    """A distinct, identifiable one-hot row so we can tell which rows survived
    a trim by comparing raw bytes."""
    v = np.zeros(dim, dtype=np.float32)
    v[index % dim] = 1.0
    return v


def test_unknown_speaker_numbering_increments(db):
    _id1, name1 = db.create_unknown_speaker()
    _id2, name2 = db.create_unknown_speaker()
    assert name1 == "Speaker 1"
    assert name2 == "Speaker 2"


def test_deleting_the_highest_numbered_speaker_frees_its_number(db):
    _id1, _ = db.create_unknown_speaker()
    id2, _ = db.create_unknown_speaker()
    assert db.delete_speaker(id2) is True

    _id3, name3 = db.create_unknown_speaker()
    assert name3 == "Speaker 2"  # reused, since 2 was the highest live number


def test_deleting_a_non_highest_speaker_does_not_free_its_number(db):
    id1, _ = db.create_unknown_speaker()
    _id2, _ = db.create_unknown_speaker()
    assert db.delete_speaker(id1) is True

    _id3, name3 = db.create_unknown_speaker()
    assert name3 == "Speaker 3"  # not reused — 2 is still the live max


def test_insert_embeddings_trims_to_cap_keeping_newest(db):
    speaker_id, _ = db.create_unknown_speaker()
    total = CAP_SAMPLES_PER_SPEAKER + 10
    vectors = np.stack([_unit_vector(i) for i in range(total)])

    inserted = db.insert_embeddings(speaker_id, vectors, "v1")

    assert inserted == total
    assert db.count_embeddings(speaker_id) == CAP_SAMPLES_PER_SPEAKER

    corpus = db.get_all_embeddings()[speaker_id]
    surviving = {bytes(row) for row in corpus}
    # The oldest 10 (indices 0..9) must have been evicted; the newest
    # CAP_SAMPLES_PER_SPEAKER (indices 10..total-1) must remain.
    for i in range(10):
        assert _unit_vector(i).tobytes() not in surviving
    for i in range(10, total):
        assert _unit_vector(i).tobytes() in surviving


def test_merge_preserves_embeddings_when_moved_before_delete(db):
    """The documented gotcha: merge_speakers deletes the source row, which
    cascades out its SpeakerEmbeddings via the FK — so move_embeddings must
    run first. This guards that ordering keeps working."""
    source_id, _ = db.create_unknown_speaker()
    target_id, _ = db.create_unknown_speaker()
    db.insert_embeddings(source_id, np.stack([_unit_vector(0), _unit_vector(1)]), "v1")
    db.insert_embeddings(target_id, np.stack([_unit_vector(2)]), "v1")

    db.move_embeddings(source_id, target_id)
    assert db.merge_speakers(source_id, target_id) is True

    assert db.get_speaker(source_id) is None
    assert db.count_embeddings(target_id) == 3
