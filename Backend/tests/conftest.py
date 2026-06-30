"""Shared fixtures. Backend has no package layout (flat scripts importing
each other as top-level modules, e.g. `import database`), so we put Backend/
on sys.path the same way running `python api.py` from that directory would."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import database


@pytest.fixture
def db(tmp_path, monkeypatch):
    """A fresh, empty SQLite DB per test, isolated from any real local/Turso DB."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(database, "_USE_TURSO", False)
    database.init_db()
    return database
