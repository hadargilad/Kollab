"""Covers the suggestion accept/reject endpoints in api.py — specifically the
"Accept always merges globally" invariant CLAUDE.md documents, and the call
order (move_embeddings before merge_speakers) that the database.py unit
tests verify works correctly, but don't verify the endpoint actually uses."""

import numpy as np


def _named(db, name: str) -> int:
    speaker_id, _created = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return speaker_id


def _make_suggestion(db, confidence: float = 0.5):
    target_id = _named(db, "Ofir")
    unknown_id, _name = db.create_unknown_speaker()
    db.insert_embeddings(target_id, np.ones((1, 192), dtype=np.float32), "v1")
    db.insert_embeddings(unknown_id, np.ones((1, 192), dtype=np.float32), "v1")
    audio_id = db.create_audio("audio", "", "/tmp/audio.wav", 100, None)
    suggestion_id = db.insert_speaker_suggestion(audio_id, unknown_id, target_id, confidence)
    return audio_id, suggestion_id, unknown_id, target_id


def test_accept_suggestion_merges_globally_and_deletes_suggestion(client, db):
    audio_id, suggestion_id, unknown_id, target_id = _make_suggestion(db)

    r = client.post(f"/audios/{audio_id}/suggestions/{suggestion_id}/accept")

    assert r.status_code == 200
    assert r.json() == {"success": True, "mergedIntoId": target_id}
    assert db.get_speaker(unknown_id) is None  # source merged away
    assert db.count_embeddings(target_id) == 2  # embeddings moved before delete, not lost
    assert db.get_suggestions_for_audio(audio_id) == []


def test_accept_suggestion_404_for_unknown_suggestion_id(client):
    r = client.post("/audios/1/suggestions/9999/accept")
    assert r.status_code == 404


def test_accept_suggestion_404_when_audio_id_mismatches(client, db):
    audio_id, suggestion_id, _unknown_id, _target_id = _make_suggestion(db)
    other_audio_id = db.create_audio("other", "", "/tmp/other.wav", 100, None)

    r = client.post(f"/audios/{other_audio_id}/suggestions/{suggestion_id}/accept")

    assert r.status_code == 404


def test_reject_suggestion_deletes_without_merging(client, db):
    audio_id, suggestion_id, unknown_id, target_id = _make_suggestion(db)

    r = client.delete(f"/audios/{audio_id}/suggestions/{suggestion_id}")

    assert r.status_code == 200
    assert r.json() == {"success": True}
    assert db.get_speaker(unknown_id) is not None  # untouched, not merged
    assert db.count_embeddings(target_id) == 1  # untouched
    assert db.get_suggestions_for_audio(audio_id) == []
