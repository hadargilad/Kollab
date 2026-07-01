"""Covers user CRUD + admin-only delete + self-profile update in api.py.
Registration flow already has database-level coverage in test_database_auth.py;
this file focuses on the HTTP contract (status codes, admin gating, validation)."""


def _reg(client, username="alice", pw="Secret123", role="analyst", id_number="123456789"):
    return client.post("/users", json={
        "username": username, "password": pw, "role": role,
        "firstName": "First", "lastName": "Last", "idNumber": id_number,
    })


def test_create_user_returns_201_and_persists(client, db):
    r = _reg(client)
    assert r.status_code == 201
    assert r.json() == {"success": True}
    assert db.validate_user("alice", "Secret123") is not None


def test_create_user_400_on_short_id(client):
    r = _reg(client, id_number="1234")
    assert r.status_code == 400
    assert "9 digits" in r.json()["detail"]


def test_create_user_400_on_duplicate_username(client):
    _reg(client)
    r = _reg(client, id_number="987654321")  # different id, same username
    assert r.status_code == 400


def test_delete_user_requires_admin_credentials(client, db):
    _reg(client)
    user = db.validate_user("alice", "Secret123")
    r = client.request(
        "DELETE", f"/users/{user['id']}",
        json={"admin_username": "alice", "admin_password": "Secret123"},
    )
    # alice is an "analyst", not "Admin" — must be rejected.
    assert r.status_code == 403


def test_delete_user_succeeds_with_admin(client, db):
    _reg(client, username="admin_user", pw="AdminPass1", role="Admin", id_number="111111111")
    _reg(client, username="victim",     pw="VictimPass", role="analyst", id_number="222222222")
    victim = db.validate_user("victim", "VictimPass")

    r = client.request(
        "DELETE", f"/users/{victim['id']}",
        json={"admin_username": "admin_user", "admin_password": "AdminPass1"},
    )

    assert r.status_code == 200
    assert db.validate_user("victim", "VictimPass") is None
