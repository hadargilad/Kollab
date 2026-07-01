"""Covers manual entity → ghost-node promotion. The auto-promoter only fires
for PERSON entities that cross the mention thresholds; this endpoint is the
analyst-driven escape hatch that also unlocks non-person entities (ORG /
LOC / MISC) as nodes on the relation graph."""


def _named(db, name: str) -> int:
    sid, _ = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return sid


def _seed_entity_with_mention(db, entity_text: str, entity_type: str,
                              utterer_name: str = "Alice"):
    """Simulates 'Alice said X mentioning Charlie'. Returns entity_id and
    utterer_id so tests can assert edges land on the right node."""
    utterer_id = _named(db, utterer_name)
    audio_id = db.create_audio("clip", "", "/tmp/clip.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": utterer_id,
         "text": f"I saw {entity_text} yesterday.",
         "start_time": 0, "end_time": 3},
    ])
    seg_id = db.get_segments_by_audio(audio_id)[0]["id"]
    entity_id = db.upsert_entity(entity_type, entity_text, entity_text.lower())
    db.insert_entity_mention(
        entity_id=entity_id, segment_id=seg_id,
        offset=6, length=len(entity_text), confidence=0.9,
        resolved_speaker_id=None,  # Charlie has never been recorded
        resolution_method=None,
    )
    return entity_id, utterer_id


def test_promote_person_entity_creates_ghost_and_edge_from_utterer(client, db):
    entity_id, alice_id = _seed_entity_with_mention(db, "Charlie", "PERSON")

    r = client.post(f"/entities/{entity_id}/promote-to-ghost")

    assert r.status_code == 201
    body = r.json()
    assert body["alreadyPromoted"] is False
    ghost_id = body["ghostSpeakerId"]

    # Ghost speaker row exists and is marked as such.
    ghost = db.get_speaker(ghost_id)
    assert ghost is not None
    assert ghost["isGhost"] is True
    assert ghost["name"] == "Charlie"
    # Alice → Charlie edge with topic='mentioned' — that's what makes Charlie
    # actually show up connected on the Network page.
    relations = db.get_all_relations()
    edge = next((r for r in relations
                 if {r["speakerA"]["id"], r["speakerB"]["id"]} == {alice_id, ghost_id}), None)
    assert edge is not None
    assert edge["topic"] == "mentioned"


def test_promote_item_entity_creates_solo_badge_when_one_utterer(client, db):
    """A single-utterer ITEM doesn't get its own ghost speaker — it hangs
    as a badge off the sole utterer's node. This is what the frontend
    renders next to the speaker on the network graph."""
    entity_id, alice_id = _seed_entity_with_mention(db, "Ferrari", "ORG")

    r = client.post(f"/entities/{entity_id}/promote-to-ghost")

    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "edge_badge"
    assert body["badgesCreated"] == 1
    assert body["utterers"] == [alice_id]
    badges = db.get_all_edge_entity_badges()
    assert len(badges) == 1
    assert badges[0]["speakerAId"] == alice_id
    assert badges[0]["speakerBId"] is None  # solo attachment
    assert badges[0]["entityText"] == "Ferrari"
    # ORG entity must NOT create a ghost speaker — items aren't talkers.
    assert db.get_entity(entity_id).get("ghostSpeakerId") is None


def test_promote_item_entity_creates_edge_badge_per_pair_when_multi_utterer(client, db):
    """Two speakers both mentioned the item → the item name rides the
    single edge between them (badgesCreated=1). Three speakers → three
    edges — pairwise coverage."""
    utterer_a = _named(db, "Alice")
    utterer_b = _named(db, "Bob")
    utterer_c = _named(db, "Carol")
    audio_id = db.create_audio("mtg", "", "/tmp/m.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": utterer_a, "text": "Ferrari news",
         "start_time": 0, "end_time": 2},
        {"audio_id": audio_id, "speaker_id": utterer_b, "text": "Ferrari again",
         "start_time": 2, "end_time": 4},
        {"audio_id": audio_id, "speaker_id": utterer_c, "text": "Ferrari once more",
         "start_time": 4, "end_time": 6},
    ])
    entity_id = db.upsert_entity("ORG", "Ferrari", "ferrari")
    for seg in db.get_segments_by_audio(audio_id):
        db.insert_entity_mention(entity_id=entity_id, segment_id=seg["id"],
                                 offset=0, length=7, confidence=0.9,
                                 resolved_speaker_id=None, resolution_method=None)

    r = client.post(f"/entities/{entity_id}/promote-to-ghost")

    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "edge_badge"
    # 3 pairs = A-B, A-C, B-C
    assert body["badgesCreated"] == 3
    assert set(body["utterers"]) == {utterer_a, utterer_b, utterer_c}


def test_promote_refuses_entity_with_no_live_mentions(client, db):
    """Stale entity (its underlying segments got deleted). We used to succeed
    silently, creating a disconnected ghost. Refuse cleanly instead."""
    entity_id = db.upsert_entity("PERSON", "Ghost McGhost", "ghost mcghost")
    # No EntityMentions rows at all.

    r = client.post(f"/entities/{entity_id}/promote-to-ghost")

    assert r.status_code == 400


def test_promote_is_idempotent(client, db):
    entity_id, _ = _seed_entity_with_mention(db, "Charlie", "PERSON")

    r1 = client.post(f"/entities/{entity_id}/promote-to-ghost")
    r2 = client.post(f"/entities/{entity_id}/promote-to-ghost")

    assert r1.status_code == 201
    assert r2.status_code == 201  # not an error to double-click
    assert r1.json()["ghostSpeakerId"] == r2.json()["ghostSpeakerId"]
    assert r2.json()["alreadyPromoted"] is True


def test_promote_404_for_missing_entity(client):
    r = client.post("/entities/9999/promote-to-ghost")
    assert r.status_code == 404
