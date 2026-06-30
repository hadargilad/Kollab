"""Covers get_bridges: finding speakers connected to at least one member of
each of two groups (powers GET /groups/bridges, the "who connects these two
networks" analyst feature). Pure graph logic over Relations + SpeakerGroups,
no ML involved."""


def _named(db, name: str) -> int:
    speaker_id, _created = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return speaker_id


def test_get_bridges_finds_speaker_connected_to_both_groups(db):
    group_a = db.create_group("Project A")
    group_b = db.create_group("Project B")
    a_member = _named(db, "Alice")
    b_member = _named(db, "Bob")
    db.add_group_member(group_a, a_member)
    db.add_group_member(group_b, b_member)

    bridge = _named(db, "Connector")
    db.upsert_relation(bridge, a_member)
    db.upsert_relation(bridge, b_member)

    result = db.get_bridges(group_a, group_b)

    assert [r["id"] for r in result] == [bridge]
    assert result[0]["name"] == "Connector"


def test_get_bridges_excludes_speaker_connected_to_only_one_group(db):
    group_a = db.create_group("Project A")
    group_b = db.create_group("Project B")
    a_member = _named(db, "Alice")
    b_member = _named(db, "Bob")
    db.add_group_member(group_a, a_member)
    db.add_group_member(group_b, b_member)

    one_sided = _named(db, "OnlyKnowsAlice")
    db.upsert_relation(one_sided, a_member)

    assert db.get_bridges(group_a, group_b) == []


def test_get_bridges_returns_empty_for_nonexistent_group(db):
    group_a = db.create_group("Project A")

    assert db.get_bridges(group_a, 999999) == []
    assert db.get_bridges(999999, 999999) == []


def test_get_bridges_requires_an_actual_relation_not_just_group_membership(db):
    # Being a member of group A doesn't itself create a bridge to group B --
    # the speaker needs a Relations edge reaching into each side.
    group_a = db.create_group("Project A")
    group_b = db.create_group("Project B")
    a_member = _named(db, "Alice")
    b_member = _named(db, "Bob")
    db.add_group_member(group_a, a_member)
    db.add_group_member(group_b, b_member)

    assert db.get_bridges(group_a, group_b) == []
