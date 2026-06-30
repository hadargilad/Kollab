"""Covers the auth functions in database.py: ID-number validation, duplicate
rejection, password verification, and the force-change-password lifecycle."""


def test_register_user_rejects_non_9_digit_id(db):
    ok, message = db.register_user("newuser", "pw", "analyst", "First", "Last", "12345")
    assert ok is False
    assert "9 digits" in message


def test_register_user_rejects_duplicate_username_or_id(db):
    ok1, _ = db.register_user("dupuser", "pw", "analyst", "A", "B", "123456789")
    assert ok1 is True

    ok2, _ = db.register_user("dupuser", "pw2", "analyst", "C", "D", "987654321")
    assert ok2 is False  # same username

    ok3, _ = db.register_user("otheruser", "pw3", "analyst", "E", "F", "123456789")
    assert ok3 is False  # same ID number


def test_validate_user_round_trip(db):
    db.register_user("alice", "Secret123", "analyst", "Alice", "A", "111111111")

    result = db.validate_user("alice", "Secret123")
    assert result is not None
    assert result["username"] == "alice"
    assert result["role"] == "analyst"
    assert result["mustChangePassword"] is True  # registration always forces a change

    assert db.validate_user("alice", "WrongPassword") is None
    assert db.validate_user("nosuchuser", "whatever") is None


def test_update_password_changes_hash_and_clears_force_flag(db):
    db.register_user("bob", "OldPass1", "analyst", "Bob", "B", "222222222")
    assert db.validate_user("bob", "OldPass1") is not None

    assert db.update_password("bob", "NewPass2") is True

    assert db.validate_user("bob", "OldPass1") is None
    result = db.validate_user("bob", "NewPass2")
    assert result is not None
    assert result["mustChangePassword"] is False
