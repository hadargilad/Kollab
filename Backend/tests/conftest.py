"""Shared fixtures. Backend has no package layout (flat scripts importing
each other as top-level modules, e.g. `import database`), so we put Backend/
on sys.path the same way running `python api.py` from that directory would."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

import database


@pytest.fixture
def db(tmp_path, monkeypatch):
    """A fresh, empty SQLite DB per test, isolated from any real local/Turso DB."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(database, "_USE_TURSO", False)
    database.init_db()
    return database


@pytest.fixture
def client(db):
    """TestClient against the real FastAPI app, sharing the same isolated temp
    DB as the `db` fixture. `api` is imported lazily, inside the fixture, so
    the very first import (which calls database.init_db() at module load —
    see Backend/api.py) sees the already-patched DB_PATH instead of the real
    local one. We never enter TestClient as a context manager, so the
    on_event("startup") hook (NLP model warm-up, semantic index rebuild)
    never fires — nothing under test here depends on it."""
    import api as _api
    return TestClient(_api.app)
