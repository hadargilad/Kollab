"""Covers Wikidata-QID bookkeeping, name-collision lookup, the
get_or_create_speaker name-match fallback, and the delete_speaker FK
cascade behavior the schema promises (Segments/Alerts -> NULL,
Relations -> CASCADE-deleted)."""

import pytest


def _named(db, name: str) -> int:
    speaker_id, _created = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return speaker_id


# ─── Wikidata QID ───────────────────────────────────────────────────────────

def test_set_wikidata_id_normalizes_and_is_lookupable(db):
    speaker_id = _named(db, "Alice")

    db.set_wikidata_id(speaker_id, "q9682")

    assert db.get_speaker(speaker_id)["wikidataId"] == "Q9682"
    found = db.get_speaker_by_wikidata_id("q9682")
    assert found["id"] == speaker_id


def test_set_wikidata_id_rejects_invalid_format(db):
    speaker_id = _named(db, "Bob")

    with pytest.raises(ValueError):
        db.set_wikidata_id(speaker_id, "NotAQid")


def test_set_wikidata_id_rejects_collision_with_another_speaker(db):
    speaker1 = _named(db, "Carol")
    speaker2 = _named(db, "Dave")
    db.set_wikidata_id(speaker1, "Q100")

    with pytest.raises(ValueError):
        db.set_wikidata_id(speaker2, "Q100")


def test_set_wikidata_id_empty_string_clears(db):
    speaker_id = _named(db, "Eve")
    db.set_wikidata_id(speaker_id, "Q100")

    db.set_wikidata_id(speaker_id, "")

    assert db.get_speaker(speaker_id)["wikidataId"] is None


# ─── Name lookup ────────────────────────────────────────────────────────────

def test_find_speaker_by_name_is_case_insensitive_and_trimmed(db):
    speaker_id = _named(db, "Charlie")

    found = db.find_speaker_by_name("  charlie  ")

    assert found["id"] == speaker_id


def test_find_speaker_by_name_excludes_given_id(db):
    speaker_id = _named(db, "Dana")

    assert db.find_speaker_by_name("Dana", exclude_id=speaker_id) is None
    assert db.find_speaker_by_name("Dana") is not None


# ─── get_or_create_speaker fallback ─────────────────────────────────────────

def test_get_or_create_speaker_reuses_existing_voice_identifier(db):
    id1, created1 = db.get_or_create_speaker("voice_x", "X")
    assert created1 is True

    id2, created2 = db.get_or_create_speaker("voice_x", "X")
    assert created2 is False
    assert id2 == id1


def test_get_or_create_speaker_falls_back_to_name_match(db):
    # A speaker already exists (e.g. renamed by a user) under a different
    # voice key. A fresh voice key sharing that name must reuse it, not
    # create a duplicate speaker.
    id1, _ = db.get_or_create_speaker("voice_original", "Ofir")

    id2, created2 = db.get_or_create_speaker("voice_brandnew", "Ofir")

    assert created2 is False
    assert id2 == id1


def test_get_or_create_speaker_creates_new_when_neither_matches(db):
    id1, created1 = db.get_or_create_speaker("voice_unique", "Unique Person")
    assert created1 is True

    id2, created2 = db.get_or_create_speaker("voice_other", "Other Person")

    assert created2 is True
    assert id2 != id1


# ─── delete_speaker FK cascade ──────────────────────────────────────────────

def test_delete_speaker_nulls_segments_and_alerts_but_cascades_relations(db):
    a_id = _named(db, "Frank")
    b_id = _named(db, "Gina")

    audio_id = db.create_audio("audio", "", "/tmp/audio.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": a_id, "text": "hi", "start_time": 0, "end_time": 1},
    ])
    segment_id = db.get_segments_by_audio(audio_id)[0]["id"]
    alert_id = db.create_alert("low", "test alert", related_speaker_id=a_id)
    db.upsert_relation(a_id, b_id)

    assert db.delete_speaker(a_id) is True

    segments = db.get_segments_by_audio(audio_id)
    assert segments[0]["id"] == segment_id
    assert segments[0]["speakerId"] is None  # FK ON DELETE SET NULL

    alerts = {al["id"]: al for al in db.get_all_alerts()}
    assert alerts[alert_id]["speakerId"] is None  # FK ON DELETE SET NULL

    assert db.get_all_relations() == []  # FK ON DELETE CASCADE
