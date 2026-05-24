"""Restore the AudioIntel state captured by ``snapshot.py``.

What this does:
  1. Wipe every table that the snapshot covers (Users are untouched).
  2. INSERT every snapshotted row, decoding base64 BLOBs back to bytes.
  3. Copy snapshot audio files from ``Backend/snapshot/audios/`` into the
     local audio storage folder, and rewrite ``Audios.FilePath`` to the new
     absolute path so the backend can serve them.

Run with the backend STOPPED so we have an exclusive lock on the SQLite DB.

Usage (after ``git pull``)::

    python -m Backend.scripts.restore

Optional flags::

    --snapshot path/to/dir   # alternate snapshot location
    --db       path/to.db    # alternate DB path
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any

# Mirrors snapshot.py — works on host and inside the Docker container.
BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SNAPSHOT = BACKEND_DIR / "snapshot"

# Must match the order in snapshot.py and the schema's FK direction.
TABLES_IN_ORDER: list[str] = [
    "Speakers",
    "Audios",
    "Segments",
    "Relations",
    "SpeakerEmbeddings",
    "SpeakerSuggestions",
    "SpeakerGroups",
    "SpeakerGroupMembers",
    # ProjectAssignments intentionally not snapshot-shared (per-user FK).
    # Teammates re-assign analysts on the /projects/<id> page after restore.
    "DangerousWords",
    "Alerts",
]


def db_path_from_env() -> Path:
    p = os.getenv("AUDIO_INTEL_DB")
    if p:
        return Path(p)
    try:
        from platformdirs import user_data_dir
        return Path(user_data_dir("AudioIntel")) / "AudioIntelDB.db"
    except ImportError:
        return Path.home() / ".audio-intel" / "AudioIntelDB.db"


def storage_dir_from_env() -> Path:
    p = os.getenv("AUDIO_STORAGE_DIR")
    if p:
        return Path(p)
    try:
        from platformdirs import user_data_dir
        return Path(user_data_dir("AudioIntel")) / "uploads"
    except ImportError:
        return Path.home() / ".audio-intel" / "uploads"


def log(msg: str) -> None:
    print(f"[restore] {msg}", flush=True)


def fail(msg: str) -> "NoReturn":
    print(f"[restore] ERROR: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def decode_value(val: Any) -> Any:
    """Reverse of snapshot.encode_row — turn {'__b64__': '…'} dicts back into bytes."""
    if isinstance(val, dict) and "__b64__" in val:
        return base64.b64decode(val["__b64__"])
    return val


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone() is not None


def table_columns(conn: sqlite3.Connection, name: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({name})").fetchall()]


def wipe(conn: sqlite3.Connection) -> None:
    """Delete from all snapshot-covered tables. FK CASCADE handles dependents,
    but we still delete each table to leave nothing stale (e.g. SpeakerEmbeddings
    when a Speaker isn't actually present in the snapshot)."""
    # Disable FKs for the wipe so deletion order doesn't matter.
    conn.execute("PRAGMA foreign_keys = OFF")
    for t in reversed(TABLES_IN_ORDER):
        if table_exists(conn, t):
            conn.execute(f"DELETE FROM {t}")
            # Reset autoincrement so the new IDs match the snapshot exactly.
            conn.execute("DELETE FROM sqlite_sequence WHERE name = ?", (t,))
    conn.execute("PRAGMA foreign_keys = ON")


def insert_rows(conn: sqlite3.Connection, table: str, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    db_cols = set(table_columns(conn, table))
    inserted = 0
    for r in rows:
        # Only keep columns the live DB actually has (gracefully ignores stale snapshot fields).
        usable = {k: decode_value(v) for k, v in r.items() if k in db_cols}
        if not usable:
            continue
        cols = list(usable.keys())
        placeholders = ",".join("?" for _ in cols)
        sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})"
        conn.execute(sql, [usable[c] for c in cols])
        inserted += 1
    return inserted


def restore_audio_files(audios_rows: list[dict[str, Any]], snapshot_dir: Path, storage_dir: Path) -> None:
    """Copy the snapshot's audio files into the local storage dir and rewrite
    each row's FilePath to the resulting absolute path."""
    storage_dir.mkdir(parents=True, exist_ok=True)
    for r in audios_rows:
        rel = r.get("FilePath")
        if not rel:
            continue
        # snapshot.py wrote FilePath as 'snapshot/audios/audio_<id><ext>' relative
        # to BACKEND_DIR. Resolve it deterministically regardless of cwd.
        src = Path(rel) if Path(rel).is_absolute() else (BACKEND_DIR / rel)
        if not src.exists():
            log(f"  WARN: snapshot audio missing: {src}")
            r["FilePath"] = None
            continue
        dest = storage_dir / src.name
        if dest.resolve() != src.resolve():
            shutil.copy2(src, dest)
        r["FilePath"] = str(dest)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", default=str(DEFAULT_SNAPSHOT), help="Snapshot folder")
    parser.add_argument("--db", default=None, help="DB path override")
    args = parser.parse_args()

    snapshot_dir = Path(args.snapshot).resolve()
    state_path = snapshot_dir / "state.json"
    if not state_path.exists():
        fail(f"snapshot state.json not found at {state_path}")
    log(f"reading snapshot: {state_path}")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    tables: dict[str, list[dict[str, Any]]] = state.get("tables", {})

    db = Path(args.db) if args.db else db_path_from_env()
    db.parent.mkdir(parents=True, exist_ok=True)
    log(f"target DB: {db}")
    if not db.exists():
        # Initialize the schema by importing Backend.database. Importing only
        # database.py is safer than api.py since the latter pulls in heavy NLP
        # models that may not be installed yet on a fresh clone.
        sys.path.insert(0, str(BACKEND_DIR))
        import database  # type: ignore
        database.init_db()

    storage_dir = storage_dir_from_env()
    log(f"target audio storage: {storage_dir}")

    # Rewrite FilePaths before insert.
    if "Audios" in tables:
        restore_audio_files(tables["Audios"], snapshot_dir, storage_dir)

    conn = sqlite3.connect(str(db))
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        wipe(conn)
        total = 0
        for table in TABLES_IN_ORDER:
            rows = tables.get(table, [])
            if not table_exists(conn, table):
                if rows:
                    log(f"  WARN: target DB has no {table}; skipping {len(rows)} row(s)")
                continue
            n = insert_rows(conn, table, rows)
            total += n
            log(f"  {table}: {n} row(s) inserted")
        conn.commit()
        log(f"done — {total} row(s) restored total")
    finally:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
