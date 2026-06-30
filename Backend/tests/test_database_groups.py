"""Covers the two-level group hierarchy invariant in database.py
(_validate_parent / GroupHierarchyError). SQLite can't express "max two
levels deep" as a constraint, so this is enforced entirely in application
code — exactly the kind of rule that silently breaks under refactors."""

import pytest

from database import GroupHierarchyError


def test_create_group_with_top_level_parent_succeeds(db):
    parent_id = db.create_group("Org")
    child_id = db.create_group("Team", parent_group_id=parent_id)

    group = db.get_group(child_id)
    assert group["parentGroupId"] == parent_id


def test_create_group_under_a_subgroup_is_rejected(db):
    parent_id = db.create_group("Org")
    child_id = db.create_group("Team", parent_group_id=parent_id)

    with pytest.raises(GroupHierarchyError):
        db.create_group("Grandchild", parent_group_id=child_id)


def test_create_group_with_nonexistent_parent_is_rejected(db):
    with pytest.raises(GroupHierarchyError):
        db.create_group("Orphan", parent_group_id=99999)


def test_update_group_cannot_set_itself_as_parent(db):
    group_id = db.create_group("Solo")

    with pytest.raises(GroupHierarchyError):
        db.update_group(group_id, "Solo", "#000000", parent_group_id=group_id)


def test_update_group_cannot_demote_group_with_children(db):
    parent_id = db.create_group("Org")
    db.create_group("Team", parent_group_id=parent_id)
    other_top_id = db.create_group("Other")

    with pytest.raises(GroupHierarchyError):
        db.update_group(parent_id, "Org", "#000000", parent_group_id=other_top_id)
