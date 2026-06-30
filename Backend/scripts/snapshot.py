"""Export the live Kollab DB + on-disk audio files into a repo-committable snapshot.

The snapshot is two pieces:

1. ``Backend/snapshot/state.json`` — a JSON dump of every relevant table,
   with BLOB columns base64-encoded.
2. ``Backend/snapshot/audios/<file_id><ext>`` — every audio file referenced
   by the Audios table. ``Audios.FilePath`` in the JSON is rewritten to the
   relative repo path so the restore script can find it on a teammate's
   machine without needing your AppData layout.

Users are deliberately *not* snapshotted — each contributor keeps their own
admin/analyst accounts. Everything else (Speakers, Audios, Segments,
embeddings, Relations, Groups, ProjectAssignments, Alerts, DangerousWords,
SpeakerSuggestions, SpeakerGroupMembers) is captured.

Run with the backend stopped (SQLite locks otherwise can be flaky on Windows).

Usage::

    python -m Backend.scripts.snapshot                     # default destination
    python -m Backend.scripts.snapshot --out path/to/dir   # custom destination
"""

from __future__ import annotations

import argparse
import base64
import json
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable

# Resolve "Backend/" via the script's own location. parents[1] is "Backend/" on
# the host AND "/app/" inside the Docker container (because docker-compose mounts
# ./Backend → /app). That makes the script work in both environments without
# any extra flags.
BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUT = BACKEND_DIR / "snapshot"

# Tables to capture. Order matters for the restore step (FK references resolve
# parents-first). Users are intentionally excluded.
TABLES_IN_ORDER: list[str] = [
    "Speakers",
    "Audios",
    "Segments",
    "Relations",
    "SpeakerEmbeddings",
    "SpeakerSuggestions",
    "SpeakerGroups",
    "SpeakerGroupMembers",
    # NOTE: ProjectAssignments is intentionally excluded. Its AnalystUserId is
    # a NOT NULL FK to Users, and Users aren't shared via the snapshot — each
    # teammate keeps their own accounts. They'll re-assign analysts on their
    # side via the /projects/<id> page.
    "DangerousWords",
    "Alerts",
]

# Columns that hold binary data (will be base64-encoded in JSON).
BLOB_COLUMNS = {
    "SpeakerEmbeddings": {"Vector"},
    "Segments": {"Embedding"},
    "DangerousWords": {"Embedding"},
}

# Columns referencing a User row that we don't want to break post-restore. We
# null them on snapshot so teammates' own user IDs aren't trampled by the
# original creator's numbering. Both target columns are ON DELETE SET NULL in
# the schema, so NULL is a legal value.
USER_REFS = {
    "Audios": {"UploadedBy"},
    "DangerousWords": {"CreatedBy"},
}

SNAPSHOT_SCHEMA_VERSION = 1


def db_path_from_env() -> Path:
    import os
    p = os.getenv("AUDIO_INTEL_DB")
    if p:
        return Path(p)
    try:
        from platformdirs import user_data_dir
        return Path(user_data_dir("AudioIntel")) / "AudioIntelDB.db"
    except ImportError:
        return Path.home() / ".audio-intel" / "AudioIntelDB.db"


def log(msg: str) -> None:
    print(f"[snapshot] {msg}", flush=True)


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def encode_row(table: str, row: sqlite3.Row) -> dict[str, Any]:
    cols = row.keys()
    out: dict[str, Any] = {}
    blob_cols = BLOB_COLUMNS.get(table, set())
    user_cols = USER_REFS.get(table, set())
    for col in cols:
        val = row[col]
        if col in blob_cols and val is not None:
            out[col] = {"__b64__": base64.b64encode(val).decode("ascii")}
        elif col in user_cols:
            # Snapshot doesn't include Users; null out the FK.
            out[col] = None
        else:
            out[col] = val
    return out


def snapshot_audio_files(rows: list[dict[str, Any]], audios_out: Path) -> int:
    """Copy each Audios.FilePath into the snapshot folder and rewrite the path
    in-place to a repo-relative form. Returns count copied."""
    audios_out.mkdir(parents=True, exist_ok=True)
    copied = 0
    for r in rows:
        src = r.get("FilePath")
        if not src:
            continue
        src_path = Path(src)
        if not src_path.exists():
            log(f"  WARN: audio file missing on disk: {src_path}")
            r["FilePath"] = None
            continue
        # Preserve a hint of the original filename for humans + uniqueness via Id.
        stem = f"audio_{r['Id']}{src_path.suffix.lower()}"
        dest = audios_out / stem
        if dest.resolve() != src_path.resolve():
            shutil.copy2(src_path, dest)
        r["FilePath"] = f"snapshot/audios/{stem}"  # repo-relative, restore.py will resolve
        copied += 1
    return copied


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Snapshot destination folder")
    parser.add_argument("--db", default=None, help="DB path override (defaults to platformdirs/$AUDIO_INTEL_DB)")
    args = parser.parse_args()

    db = Path(args.db) if args.db else db_path_from_env()
    out = Path(args.out).resolve()
    if not db.exists():
        log(f"DB not found at {db}")
        return 1
    log(f"reading DB: {db}")
    log(f"writing snapshot to: {out}")

    out.mkdir(parents=True, exist_ok=True)
    audios_out = out / "audios"

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        state: dict[str, Any] = {
            "schemaVersion": SNAPSHOT_SCHEMA_VERSION,
            "tables": {},
        }
        for table in TABLES_IN_ORDER:
            if not table_exists(conn, table):
                log(f"  skip {table}: table does not exist on this DB")
                continue
            rows = [encode_row(table, r) for r in conn.execute(f"SELECT * FROM {table}").fetchall()]
            state["tables"][table] = rows
            log(f"  {table}: {len(rows)} row(s)")

        # Copy audio files referenced by Audios.FilePath
        if "Audios" in state["tables"]:
            copied = snapshot_audio_files(state["tables"]["Audios"], audios_out)
            log(f"copied {copied} audio file(s) into {audios_out}")
    finally:
        conn.close()

    state_path = out / "state.json"
    state_path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"wrote {state_path}")
    log("commit Backend/snapshot/ and formula_1/ to share with teammates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
