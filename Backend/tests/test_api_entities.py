"""Covers the /entities endpoints — list, get, mentions, related-speakers,
and link-wikidata. Post-cloud regression: the frontend used to hide entities
whose `distinctAudioCount < 2`, so a single-audio entity was invisible; that
filter was removed. This file also asserts single-audio entities remain
visible via the API contract."""


def _named(db, name):
    sid, _ = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return sid


def _seed_entity_with_mention(db, entity_text="Ofir", entity_type="PERSON"):
    speaker_id = _named(db, "Alice")
    audio_id = db.create_audio("clip", "", "/tmp/clip.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": speaker_id,
         "text": f"We saw {entity_text} yesterday.",
         "start_time": 0, "end_time": 3},
    ])
    seg_id = db.get_segments_by_audio(audio_id)[0]["id"]
    entity_id = db.upsert_entity(entity_type, entity_text, entity_text.lower())
    db.insert_entity_mention(
        entity_id=entity_id, segment_id=seg_id,
        offset=8, length=len(entity_text), confidence=0.9,
        resolved_speaker_id=None, resolution_method=None,
    )
    return audio_id, speaker_id, entity_id, seg_id


def test_list_entities_includes_single_audio_entities(client, db):
    # Regression guard: `distinctAudioCount == 1` used to be hidden by the UI.
    # The API layer must return them; filtering (if any) belongs on the client.
    _seed_entity_with_mention(db)
    r = client.get("/entities")
    assert r.status_code == 200
    entities = r.json()
    assert len(entities) == 1
    assert entities[0]["distinctAudioCount"] == 1


def test_get_entity_404_for_missing(client):
    r = client.get("/entities/99999")
    assert r.status_code == 404


def test_get_entity_mentions_returns_segment_context(client, db):
    audio_id, _sid, entity_id, seg_id = _seed_entity_with_mention(db, entity_text="Elad")
    r = client.get(f"/entities/{entity_id}/mentions")
    assert r.status_code == 200
    mentions = r.json()
    assert len(mentions) == 1
    m = mentions[0]
    assert m["segmentId"] == seg_id
    assert m["audioId"] == audio_id
    assert "Elad" in m["segmentText"]


def test_link_entity_wikidata_requires_wikidata_id(client, db):
    _, _, entity_id, _ = _seed_entity_with_mention(db)
    r = client.post(f"/entities/{entity_id}/link-wikidata", json={"wikidataId": ""})
    assert r.status_code == 422


def test_link_entity_wikidata_persists(client, db):
    _, _, entity_id, _ = _seed_entity_with_mention(db)
    r = client.post(f"/entities/{entity_id}/link-wikidata", json={"wikidataId": "Q42"})
    assert r.status_code == 200
    assert r.json()["wikidataId"] == "Q42"
    assert db.get_entity(entity_id)["wikidataId"] == "Q42"
