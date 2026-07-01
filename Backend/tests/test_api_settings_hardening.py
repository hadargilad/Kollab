"""Guards for the flagged-word / euphemism settings endpoints against a
stale `created_by` from the client. The DangerousWords.CreatedBy column has
a FK to Users(Id) with `PRAGMA foreign_keys = ON`, so a client sending a
deleted-user id used to blow up with 500 (SQLITE_CONSTRAINT). We now
preflight and drop it to NULL — the phrase itself is still what the analyst
asked to add."""


def _make_user(db, username="ofir") -> int:
    ok, _ = db.register_user(username, "Secret123", "analyst", "Ofir", "Menda", "123456789")
    assert ok
    user = db.validate_user(username, "Secret123")
    return user["id"]


# ─── /euphemisms ─────────────────────────────────────────────────────────────

def test_add_euphemism_with_valid_created_by_persists_the_owner(client, db):
    uid = _make_user(db)
    r = client.post("/euphemisms", json={"phrase": "chill vibes", "severity": "high", "created_by": uid})
    assert r.status_code == 201
    # Round-trip through the list endpoint — that one includes CreatedBy.
    listed = client.get("/euphemisms").json()
    row = next(e for e in listed if e["phrase"] == "chill vibes")
    assert row["createdBy"] == uid


def test_add_euphemism_with_unknown_created_by_nulls_it_out_instead_of_500(client, db):
    # Nobody exists yet; user_id=99 obviously fails the FK.
    r = client.post("/euphemisms", json={"phrase": "phantom entry", "severity": "high", "created_by": 99})
    assert r.status_code == 201, f"expected clean 201 with created_by nulled, got {r.status_code}: {r.text}"
    listed = client.get("/euphemisms").json()
    row = next(e for e in listed if e["phrase"] == "phantom entry")
    assert row["createdBy"] is None


def test_add_euphemism_with_null_created_by_is_still_ok(client, db):
    r = client.post("/euphemisms", json={"phrase": "no owner", "severity": "high", "created_by": None})
    assert r.status_code == 201


# ─── /dangerous-words ────────────────────────────────────────────────────────

def test_add_dangerous_word_with_unknown_created_by_nulls_it_out(client, db):
    r = client.post("/dangerous-words", json={"word": "spoof", "severity": "high", "created_by": 99})
    assert r.status_code == 201, f"expected clean 201, got {r.status_code}: {r.text}"
    listed = client.get("/dangerous-words").json()
    row = next(w for w in listed if w["word"] == "spoof")
    # DangerousWords list doesn't expose createdBy — good enough that we didn't 500.
    assert row["severity"] == "high"


# ─── UNIQUE-constraint 409 (both work on Turso, not just plain sqlite3) ──────

def test_add_euphemism_duplicate_returns_409_not_500(client, db):
    # First add succeeds — no matter which backend we're on.
    r1 = client.post("/euphemisms", json={"phrase": "car", "severity": "high", "created_by": None})
    assert r1.status_code == 201
    # Second add of the same word must land on the 409 branch — the reason we
    # normalise Turso's ValueError-wrapped UNIQUE violation to the same signal
    # as sqlite3.IntegrityError. Regression from real prod: this used to 500.
    r2 = client.post("/euphemisms", json={"phrase": "car", "severity": "high", "created_by": None})
    assert r2.status_code == 409, f"expected 409, got {r2.status_code}: {r2.text}"


def test_add_dangerous_word_duplicate_returns_409_not_500(client, db):
    r1 = client.post("/dangerous-words", json={"word": "grenade", "severity": "high", "created_by": None})
    assert r1.status_code == 201
    r2 = client.post("/dangerous-words", json={"word": "grenade", "severity": "high", "created_by": None})
    assert r2.status_code == 409, f"expected 409, got {r2.status_code}: {r2.text}"


# ─── Flagged Keywords ↔ Coded-Language independence ─────────────────────────

def test_same_word_can_live_in_both_categories(client, db):
    """After the composite-UNIQUE migration, the two settings sections are
    conceptually independent lists that just happen to share storage. Same
    word in both is legitimate (e.g. "car" as a flagged term AND as a coded
    reference to something else)."""
    r1 = client.post("/dangerous-words", json={"word": "car", "severity": "high", "created_by": None})
    assert r1.status_code == 201
    r2 = client.post("/euphemisms", json={"phrase": "car", "severity": "high", "created_by": None})
    assert r2.status_code == 201, f"expected the two lists to be independent, got {r2.status_code}: {r2.text}"
    # And still enforce uniqueness *within* each category.
    r3 = client.post("/euphemisms", json={"phrase": "car", "severity": "high", "created_by": None})
    assert r3.status_code == 409
