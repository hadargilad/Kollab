"""Covers the two rename-collision merge flows in api.py (PUT /speakers/{id}
and POST /audios/{id}/speakers/{id}/reassign) — both documented in CLAUDE.md
as needing move_embeddings called before merge_speakers, and both able to
skip the merge entirely via a force-separate flag."""

import numpy as np


def _named(db, name: str) -> int:
    speaker_id, _created = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return speaker_id


# ─── PUT /speakers/{id} ──────────────────────────────────────────────────────

def test_update_speaker_merges_into_existing_name_collision(client, db):
    target_id = _named(db, "Ofir")
    db.insert_embeddings(target_id, np.ones((1, 192), dtype=np.float32), "v1")
    source_id, _name = db.create_unknown_speaker()
    db.insert_embeddings(source_id, np.ones((1, 192), dtype=np.float32), "v1")

    r = client.put(f"/speakers/{source_id}", json={"name": "Ofir", "riskLevel": "low"})

    assert r.status_code == 200
    body = r.json()
    assert body == {
        "success": True, "merged": True,
        "mergedIntoId": target_id, "mergedIntoName": "Ofir",
    }
    assert db.get_speaker(source_id) is None
    assert db.count_embeddings(target_id) == 2


def test_update_speaker_force_separate_skips_merge(client, db):
    target_id = _named(db, "Ofir")
    source_id, _name = db.create_unknown_speaker()

    r = client.put(
        f"/speakers/{source_id}",
        json={"name": "Ofir", "riskLevel": "low", "forceSeparate": True},
    )

    assert r.status_code == 200
    assert r.json() == {"success": True, "merged": False}
    assert db.get_speaker(source_id) is not None
    assert db.get_speaker(source_id)["name"] == "Ofir"
    assert db.get_speaker(target_id) is not None  # both still exist, same name


def test_update_speaker_rejects_empty_name(client, db):
    speaker_id, _name = db.create_unknown_speaker()

    r = client.put(f"/speakers/{speaker_id}", json={"name": "   ", "riskLevel": "low"})

    assert r.status_code == 400


# ─── POST /audios/{audio_id}/speakers/{speaker_id}/reassign ─────────────────

def test_reassign_merges_source_when_it_has_no_other_segments(client, db):
    target_id = _named(db, "Ofir")
    db.insert_embeddings(target_id, np.ones((1, 192), dtype=np.float32), "v1")
    source_id, _name = db.create_unknown_speaker()
    db.insert_embeddings(source_id, np.ones((1, 192), dtype=np.float32), "v1")
    audio_id = db.create_audio("audio", "", "/tmp/audio.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": source_id, "text": "hi", "start_time": 0, "end_time": 1},
    ])

    r = client.post(
        f"/audios/{audio_id}/speakers/{source_id}/reassign",
        json={"new_name": "Ofir"},
    )

    assert r.status_code == 201
    assert r.json()["id"] == target_id
    assert db.get_speaker(source_id) is None  # fully merged away, no segments left anywhere
    assert db.count_embeddings(target_id) == 2


def test_reassign_keeps_source_alive_when_it_has_segments_elsewhere(client, db):
    target_id = _named(db, "Ofir")
    source_id, _name = db.create_unknown_speaker()
    audio1 = db.create_audio("audio1", "", "/tmp/a1.wav", 100, None)
    audio2 = db.create_audio("audio2", "", "/tmp/a2.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio1, "speaker_id": source_id, "text": "hi", "start_time": 0, "end_time": 1},
        {"audio_id": audio2, "speaker_id": source_id, "text": "yo", "start_time": 0, "end_time": 1},
    ])

    r = client.post(
        f"/audios/{audio1}/speakers/{source_id}/reassign",
        json={"new_name": "Ofir"},
    )

    assert r.status_code == 201
    assert r.json()["id"] == target_id
    # Source still has its audio2 segment, so it must survive (only audio1's
    # segment moved) — a global merge here would silently destroy an identity
    # that's still in use elsewhere.
    assert db.get_speaker(source_id) is not None
    segments_audio1 = [s for s in db.get_segments_by_audio(audio1) if s["speakerId"] == target_id]
    assert len(segments_audio1) == 1
    segments_audio2 = [s for s in db.get_segments_by_audio(audio2) if s["speakerId"] == source_id]
    assert len(segments_audio2) == 1


def test_reassign_creates_new_speaker_when_no_name_collision(client, db):
    source_id, _name = db.create_unknown_speaker()
    audio_id = db.create_audio("audio", "", "/tmp/audio.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": source_id, "text": "hi", "start_time": 0, "end_time": 1},
    ])

    r = client.post(
        f"/audios/{audio_id}/speakers/{source_id}/reassign",
        json={"new_name": "Totally New Name"},
    )

    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Totally New Name"
    assert body["id"] != source_id
    assert db.get_speaker(source_id) is not None  # original left untouched
