import hashlib
import base64
import os
import re
import sqlite3
from pathlib import Path
from typing import Optional

import numpy as np

EMBEDDING_DIM = 192
CAP_SAMPLES_PER_SPEAKER = 50

if os.getenv("AUDIO_INTEL_DB"):
    DB_PATH = Path(os.environ["AUDIO_INTEL_DB"])
else:
    try:
        from platformdirs import user_data_dir
        DB_PATH = Path(user_data_dir("AudioIntel")) / "AudioIntelDB.db"
    except ImportError:
        DB_PATH = Path.home() / ".audio-intel" / "AudioIntelDB.db"


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _create_salt() -> str:
    return base64.b64encode(os.urandom(32)).decode()


def _hash_password(password: str, salt: str) -> str:
    combined = (password + salt).encode("utf-8")
    return base64.b64encode(hashlib.sha256(combined).digest()).decode()


def init_db():
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS Users (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Username TEXT NOT NULL UNIQUE,
                PasswordHash TEXT NOT NULL,
                Salt TEXT NOT NULL,
                Role TEXT NOT NULL,
                FirstName TEXT DEFAULT '',
                LastName TEXT DEFAULT '',
                IDNumber TEXT UNIQUE,
                ForceChangePassword INTEGER DEFAULT 1,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS Speakers (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                VoiceIdentifier TEXT NOT NULL UNIQUE,
                Name TEXT NOT NULL,
                Color TEXT NOT NULL DEFAULT '#6366f1',
                RiskLevel TEXT NOT NULL DEFAULT 'low' CHECK(RiskLevel IN ('low', 'medium', 'high')),
                FirstDetected DATETIME DEFAULT CURRENT_TIMESTAMP,
                WikidataId TEXT
            )
        """)
        # Migration for DBs created before WikidataId was added.
        # ALTER TABLE ... ADD COLUMN can't be IF NOT EXISTS in sqlite, so probe pragma first.
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(Speakers)").fetchall()}
        if "WikidataId" not in existing_cols:
            conn.execute("ALTER TABLE Speakers ADD COLUMN WikidataId TEXT")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS Audios (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                Description TEXT DEFAULT '',
                FilePath TEXT NOT NULL,
                Duration REAL DEFAULT 0,
                FileSize INTEGER DEFAULT 0,
                Status TEXT NOT NULL DEFAULT 'processing' CHECK(Status IN ('processing', 'processed', 'failed')),
                UploadedBy INTEGER REFERENCES Users(Id) ON DELETE SET NULL,
                UploadedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                RecordedAt DATETIME
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS Segments (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                AudioId INTEGER NOT NULL REFERENCES Audios(Id) ON DELETE CASCADE,
                SpeakerId INTEGER REFERENCES Speakers(Id) ON DELETE SET NULL,
                Text TEXT NOT NULL DEFAULT '',
                StartTime REAL NOT NULL,
                EndTime REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS Relations (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                SpeakerAId INTEGER NOT NULL REFERENCES Speakers(Id) ON DELETE CASCADE,
                SpeakerBId INTEGER NOT NULL REFERENCES Speakers(Id) ON DELETE CASCADE,
                InteractionCount INTEGER NOT NULL DEFAULT 1,
                Topic TEXT DEFAULT '',
                LastContact DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(SpeakerAId, SpeakerBId),
                CHECK(SpeakerAId < SpeakerBId)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS Alerts (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Type TEXT NOT NULL DEFAULT 'low' CHECK(Type IN ('low', 'medium', 'high')),
                Message TEXT NOT NULL,
                RelatedSpeakerId INTEGER REFERENCES Speakers(Id) ON DELETE SET NULL,
                RelatedAudioId INTEGER REFERENCES Audios(Id) ON DELETE SET NULL,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS SpeakerEmbeddings (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                SpeakerId INTEGER NOT NULL REFERENCES Speakers(Id) ON DELETE CASCADE,
                Vector BLOB NOT NULL,
                Dim INTEGER NOT NULL,
                ModelVersion TEXT NOT NULL,
                SourceAudioId INTEGER REFERENCES Audios(Id) ON DELETE SET NULL,
                EnrolledAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS IX_SpeakerEmbeddings_SpeakerId
                ON SpeakerEmbeddings(SpeakerId)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS SpeakerSuggestions (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                AudioId INTEGER NOT NULL REFERENCES Audios(Id) ON DELETE CASCADE,
                UnknownSpeakerId INTEGER NOT NULL REFERENCES Speakers(Id) ON DELETE CASCADE,
                SuggestedSpeakerId INTEGER NOT NULL REFERENCES Speakers(Id) ON DELETE CASCADE,
                Confidence REAL NOT NULL,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS SpeakerGroups (
                Id        INTEGER PRIMARY KEY AUTOINCREMENT,
                Name      TEXT NOT NULL UNIQUE,
                Color     TEXT NOT NULL DEFAULT '#6366f1',
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS SpeakerGroupMembers (
                GroupId   INTEGER NOT NULL REFERENCES SpeakerGroups(Id) ON DELETE CASCADE,
                SpeakerId INTEGER NOT NULL REFERENCES Speakers(Id) ON DELETE CASCADE,
                PRIMARY KEY (GroupId, SpeakerId)
            )
        """)
        conn.execute("PRAGMA foreign_keys = ON")
        # Mark any records left in 'processing' from a previous crashed/restarted run.
        # Runs after CREATE TABLE so it works on a fresh DB too.
        conn.execute(
            "UPDATE Audios SET Status='failed' WHERE Status='processing'"
        )
        conn.commit()
    _seed_default_users()


def _seed_default_users():
    defaults = [
        ("admin",   "Aa!12345", "Admin",   "Admin",   "User", "000000000", 0),
        ("analyst", "1234",     "Analyst", "Analyst", "User", "000000001", 1),
    ]
    with _get_conn() as conn:
        for username, password, role, first, last, id_num, force in defaults:
            exists = conn.execute(
                "SELECT Id FROM Users WHERE Username = ?", (username,)
            ).fetchone()
            if not exists:
                salt = _create_salt()
                pw_hash = _hash_password(password, salt)
                conn.execute(
                    """INSERT INTO Users
                       (Username, PasswordHash, Salt, Role, FirstName, LastName, IDNumber, ForceChangePassword)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (username, pw_hash, salt, role, first, last, id_num, force),
                )
        conn.commit()


def validate_user(username: str, password: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT Id, PasswordHash, Salt, Role, ForceChangePassword,
                      FirstName, LastName, IDNumber, CreatedAt
               FROM Users WHERE Username = ?""",
            (username,),
        ).fetchone()
    if not row:
        return None
    computed = _hash_password(password, row["Salt"])
    if computed != row["PasswordHash"]:
        return None
    return {
        "id": row["Id"],
        "username": username,
        "role": row["Role"],
        "mustChangePassword": bool(row["ForceChangePassword"]),
        "firstName": row["FirstName"] or "",
        "lastName": row["LastName"] or "",
        "idNumber": row["IDNumber"] or "",
        "createdAt": row["CreatedAt"] or "",
    }


def register_user(username: str, password: str, role: str,
                  first_name: str, last_name: str, id_number: str) -> tuple[bool, str]:
    if not re.fullmatch(r"\d{9}", id_number):
        return False, "Invalid Identification Number. Must be 9 digits."
    with _get_conn() as conn:
        clash = conn.execute(
            "SELECT COUNT(*) FROM Users WHERE Username = ? OR IDNumber = ?",
            (username, id_number),
        ).fetchone()[0]
        if clash:
            return False, "Identification Number or Username already exists."
        salt = _create_salt()
        pw_hash = _hash_password(password, salt)
        conn.execute(
            """INSERT INTO Users
               (Username, PasswordHash, Salt, Role, FirstName, LastName, IDNumber, ForceChangePassword)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
            (username, pw_hash, salt, role, first_name, last_name, id_number),
        )
        conn.commit()
    return True, "Success"


def get_all_users() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT Id, Username, Role, FirstName, LastName, IDNumber, CreatedAt FROM Users"
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "username": r["Username"],
            "role": r["Role"],
            "firstName": r["FirstName"] or "",
            "lastName": r["LastName"] or "",
            "idNumber": r["IDNumber"] or "",
            "createdAt": r["CreatedAt"] or "",
        }
        for r in rows
    ]


def delete_user(user_id: int) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM Users WHERE Id = ?", (user_id,))
        conn.commit()
    return result.rowcount > 0


def update_user(user_id: int, first_name: str, last_name: str,
                id_number: str, role: str, password: str = "") -> tuple[bool, str]:
    with _get_conn() as conn:
        clash = conn.execute(
            "SELECT COUNT(*) FROM Users WHERE IDNumber = ? AND Id != ?",
            (id_number, user_id),
        ).fetchone()[0]
        if clash:
            return False, "Identification Number already exists for another user."

        if password:
            salt = _create_salt()
            pw_hash = _hash_password(password, salt)
            conn.execute(
                """UPDATE Users
                   SET FirstName=?, LastName=?, IDNumber=?, Role=?, PasswordHash=?, Salt=?
                   WHERE Id=?""",
                (first_name, last_name, id_number, role, pw_hash, salt, user_id),
            )
        else:
            conn.execute(
                "UPDATE Users SET FirstName=?, LastName=?, IDNumber=?, Role=? WHERE Id=?",
                (first_name, last_name, id_number, role, user_id),
            )
        conn.commit()
    return True, "Update successful"


def update_self_profile(user_id: int, first_name: str,
                        last_name: str, new_password: str = "") -> tuple[bool, str]:
    with _get_conn() as conn:
        if new_password:
            salt = _create_salt()
            pw_hash = _hash_password(new_password, salt)
            conn.execute(
                "UPDATE Users SET FirstName=?, LastName=?, PasswordHash=?, Salt=? WHERE Id=?",
                (first_name, last_name, pw_hash, salt, user_id),
            )
        else:
            conn.execute(
                "UPDATE Users SET FirstName=?, LastName=? WHERE Id=?",
                (first_name, last_name, user_id),
            )
        conn.commit()
    return True, "Profile updated successfully"


def update_password(username: str, new_password: str) -> bool:
    salt = _create_salt()
    pw_hash = _hash_password(new_password, salt)
    with _get_conn() as conn:
        result = conn.execute(
            "UPDATE Users SET PasswordHash=?, Salt=?, ForceChangePassword=0 WHERE Username=?",
            (pw_hash, salt, username),
        )
        conn.commit()
    return result.rowcount > 0


# ─── Audios ───────────────────────────────────────────────────────────────────

_SPEAKER_COLORS = [
    "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
    "#8b5cf6", "#f97316", "#14b8a6", "#ec4899", "#84cc16",
]


def create_audio(name: str, description: str, file_path: str,
                 file_size: int, uploaded_by: int,
                 recorded_at: Optional[str] = None) -> int:
    with _get_conn() as conn:
        cursor = conn.execute(
            """INSERT INTO Audios (Name, Description, FilePath, FileSize, UploadedBy, RecordedAt)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (name, description, file_path, file_size, uploaded_by, recorded_at),
        )
        conn.commit()
    return cursor.lastrowid


def update_audio_result(audio_id: int, status: str, duration: float = 0.0) -> None:
    with _get_conn() as conn:
        conn.execute(
            "UPDATE Audios SET Status=?, Duration=? WHERE Id=?",
            (status, duration, audio_id),
        )
        conn.commit()


def get_audio(audio_id: int) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT a.Id, a.Name, a.Description, a.FilePath, a.Duration,
                      a.FileSize, a.Status, a.UploadedAt, a.RecordedAt,
                      u.Username AS UploadedBy
               FROM Audios a
               LEFT JOIN Users u ON u.Id = a.UploadedBy
               WHERE a.Id = ?""",
            (audio_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["Id"],
        "name": row["Name"],
        "description": row["Description"],
        "filePath": row["FilePath"],
        "duration": row["Duration"],
        "fileSize": row["FileSize"],
        "status": row["Status"],
        "uploadedAt": row["UploadedAt"],
        "recordedAt": row["RecordedAt"],
        "uploadedBy": row["UploadedBy"] or "",
    }


def get_all_audios() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT a.Id, a.Name, a.Description, a.Duration, a.FileSize,
                      a.Status, a.UploadedAt, a.RecordedAt,
                      u.Username AS UploadedBy,
                      COUNT(DISTINCT s.SpeakerId) AS SpeakerCount
               FROM Audios a
               LEFT JOIN Users u ON u.Id = a.UploadedBy
               LEFT JOIN Segments s ON s.AudioId = a.Id
               GROUP BY a.Id
               ORDER BY a.UploadedAt DESC"""
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "name": r["Name"],
            "description": r["Description"],
            "duration": r["Duration"],
            "fileSize": r["FileSize"],
            "status": r["Status"],
            "uploadedAt": r["UploadedAt"],
            "recordedAt": r["RecordedAt"],
            "uploadedBy": r["UploadedBy"] or "",
            "speakerCount": r["SpeakerCount"],
        }
        for r in rows
    ]


def delete_audio(audio_id: int) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM Audios WHERE Id = ?", (audio_id,))
        conn.commit()
    return result.rowcount > 0


# ─── Speakers ─────────────────────────────────────────────────────────────────

def create_unknown_speaker() -> tuple[int, str]:
    """Create a new auto-generated unknown speaker with a sequential 'Speaker N'
    display name. The numeric N is one higher than the largest existing 'Speaker N'
    in the table — so renamed/deleted ones leave gaps, but no two live speakers
    ever share a name. VoiceIdentifier stays as the stable speaker_<8hex> key.
    Returns (speaker_id, display_name)."""
    import uuid as _uuid
    voice_id = f"speaker_{_uuid.uuid4().hex[:8]}"
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT MAX(CAST(SUBSTR(Name, 9) AS INTEGER))
               FROM Speakers
               WHERE Name GLOB 'Speaker [0-9]*'"""
        ).fetchone()
        next_num = (row[0] or 0) + 1
        display_name = f"Speaker {next_num}"
        count = conn.execute("SELECT COUNT(*) FROM Speakers").fetchone()[0]
        color = _SPEAKER_COLORS[count % len(_SPEAKER_COLORS)]
        cursor = conn.execute(
            "INSERT INTO Speakers (VoiceIdentifier, Name, Color) VALUES (?, ?, ?)",
            (voice_id, display_name, color),
        )
        conn.commit()
    return cursor.lastrowid, display_name


def get_or_create_speaker(voice_identifier: str, name: str) -> tuple[int, bool]:
    """Return (speaker_id, created). Assigns a color from the palette automatically."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT Id FROM Speakers WHERE VoiceIdentifier = ?", (voice_identifier,)
        ).fetchone()
        if row:
            return row["Id"], False

        # Fall back to a name match — catches the case where the user previously
        # renamed a speaker to "Ofir" so a backend record already exists, even
        # though the ML voice DB may have just registered a fresh "Ofir" key.
        if name and name != voice_identifier:
            name_match = conn.execute(
                "SELECT Id FROM Speakers WHERE LOWER(TRIM(Name)) = LOWER(?)",
                (name.strip(),),
            ).fetchone()
            if name_match:
                return name_match["Id"], False

        count = conn.execute("SELECT COUNT(*) FROM Speakers").fetchone()[0]
        color = _SPEAKER_COLORS[count % len(_SPEAKER_COLORS)]
        cursor = conn.execute(
            "INSERT INTO Speakers (VoiceIdentifier, Name, Color) VALUES (?, ?, ?)",
            (voice_identifier, name, color),
        )
        conn.commit()
    return cursor.lastrowid, True


def get_speaker(speaker_id: int) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT s.Id, s.VoiceIdentifier, s.Name, s.Color, s.RiskLevel, s.FirstDetected, s.WikidataId,
                      COUNT(DISTINCT sg.AudioId) AS RecordingCount,
                      (SELECT COUNT(*) FROM SpeakerEmbeddings WHERE SpeakerId = s.Id) AS SampleCount
               FROM Speakers s
               LEFT JOIN Segments sg ON sg.SpeakerId = s.Id
               WHERE s.Id = ?
               GROUP BY s.Id""",
            (speaker_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["Id"],
        "voiceIdentifier": row["VoiceIdentifier"],
        "name": row["Name"],
        "color": row["Color"],
        "riskLevel": row["RiskLevel"],
        "firstDetected": row["FirstDetected"],
        "wikidataId": row["WikidataId"],
        "recordingCount": row["RecordingCount"],
        "sampleCount": row["SampleCount"],
    }


def get_audios_for_speaker(speaker_id: int) -> list[dict]:
    """Audios this speaker appears in, plus per-audio speaking time and segment count."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT a.Id, a.Name, a.Description, a.Duration, a.FileSize,
                      a.Status, a.UploadedAt, a.RecordedAt,
                      u.Username AS UploadedBy,
                      COUNT(sg.Id) AS SegmentCount,
                      COALESCE(SUM(sg.EndTime - sg.StartTime), 0) AS SpeakingTime
               FROM Audios a
               JOIN Segments sg ON sg.AudioId = a.Id
               LEFT JOIN Users u ON u.Id = a.UploadedBy
               WHERE sg.SpeakerId = ?
               GROUP BY a.Id
               ORDER BY a.UploadedAt DESC""",
            (speaker_id,),
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "name": r["Name"],
            "description": r["Description"],
            "duration": r["Duration"],
            "fileSize": r["FileSize"],
            "status": r["Status"],
            "uploadedAt": r["UploadedAt"],
            "recordedAt": r["RecordedAt"],
            "uploadedBy": r["UploadedBy"] or "",
            "segmentCount": r["SegmentCount"],
            "speakingTime": r["SpeakingTime"],
        }
        for r in rows
    ]


def get_all_speakers() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT s.Id, s.VoiceIdentifier, s.Name, s.Color, s.RiskLevel, s.FirstDetected, s.WikidataId,
                      COUNT(DISTINCT sg.AudioId) AS RecordingCount,
                      (SELECT COUNT(*) FROM SpeakerEmbeddings WHERE SpeakerId = s.Id) AS SampleCount
               FROM Speakers s
               LEFT JOIN Segments sg ON sg.SpeakerId = s.Id
               GROUP BY s.Id
               ORDER BY s.FirstDetected DESC"""
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "voiceIdentifier": r["VoiceIdentifier"],
            "name": r["Name"],
            "color": r["Color"],
            "riskLevel": r["RiskLevel"],
            "firstDetected": r["FirstDetected"],
            "wikidataId": r["WikidataId"],
            "recordingCount": r["RecordingCount"],
            "sampleCount": r["SampleCount"],
        }
        for r in rows
    ]


def _distinct_audio_speakers(conn: sqlite3.Connection, audio_id: int) -> set[int]:
    rows = conn.execute(
        "SELECT DISTINCT SpeakerId FROM Segments WHERE AudioId = ? AND SpeakerId IS NOT NULL",
        (audio_id,),
    ).fetchall()
    return {r["SpeakerId"] for r in rows}


def _adjust_relations_for_audio_diff(
    conn: sqlite3.Connection,
    before_speakers: set[int],
    after_speakers: set[int],
) -> None:
    """
    Apply the diff between the two sets to the global Relations table:
    every pair that disappeared loses 1 interaction (deleted at 0), every new
    pair gains 1. Pairs unchanged on both sides are left alone.
    """
    def pairs(s: set[int]) -> set[tuple[int, int]]:
        ordered = sorted(s)
        return {(ordered[i], ordered[j]) for i in range(len(ordered)) for j in range(i + 1, len(ordered))}

    before, after = pairs(before_speakers), pairs(after_speakers)
    for a, b in (before - after):
        conn.execute(
            "UPDATE Relations SET InteractionCount = InteractionCount - 1 WHERE SpeakerAId = ? AND SpeakerBId = ?",
            (a, b),
        )
        conn.execute(
            "DELETE FROM Relations WHERE SpeakerAId = ? AND SpeakerBId = ? AND InteractionCount <= 0",
            (a, b),
        )
    for a, b in (after - before):
        conn.execute(
            """INSERT INTO Relations (SpeakerAId, SpeakerBId, InteractionCount, LastContact)
               VALUES (?, ?, 1, CURRENT_TIMESTAMP)
               ON CONFLICT(SpeakerAId, SpeakerBId)
               DO UPDATE SET InteractionCount = InteractionCount + 1,
                             LastContact = CURRENT_TIMESTAMP""",
            (a, b),
        )


def reassign_segments_in_audio_to_existing(audio_id: int, old_speaker_id: int, target_speaker_id: int) -> bool:
    """
    Repoint every segment of `audio_id` from old_speaker_id to target_speaker_id and
    fold the per-audio relations contribution from old_speaker_id into target_speaker_id.
    Other audios that include old_speaker_id are untouched.
    """
    if old_speaker_id == target_speaker_id:
        return True
    with _get_conn() as conn:
        before = _distinct_audio_speakers(conn, audio_id)
        conn.execute(
            "UPDATE Segments SET SpeakerId = ? WHERE AudioId = ? AND SpeakerId = ?",
            (target_speaker_id, audio_id, old_speaker_id),
        )
        after = _distinct_audio_speakers(conn, audio_id)
        _adjust_relations_for_audio_diff(conn, before, after)
        conn.commit()
    return True


def speaker_has_segments(speaker_id: int) -> bool:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM Segments WHERE SpeakerId = ? LIMIT 1", (speaker_id,)
        ).fetchone()
    return row is not None


def get_audio_speaker_ids(audio_id: int) -> set[int]:
    with _get_conn() as conn:
        return _distinct_audio_speakers(conn, audio_id)


def adjust_relations_for_audio(audio_id: int, before_speakers: set[int]) -> None:
    """Update Relations to reflect the current speaker set in `audio_id` vs a before snapshot."""
    with _get_conn() as conn:
        after_speakers = _distinct_audio_speakers(conn, audio_id)
        _adjust_relations_for_audio_diff(conn, before_speakers, after_speakers)
        conn.commit()


def reassign_speaker_in_audio(audio_id: int, old_speaker_id: int, new_name: str) -> dict | None:
    """
    Create a new speaker and re-point all segments in `audio_id` from `old_speaker_id`
    to the new one. Other recordings are untouched.
    """
    import uuid as _uuid
    new_voice_id = f"speaker_{_uuid.uuid4().hex[:8]}"
    with _get_conn() as conn:
        before = _distinct_audio_speakers(conn, audio_id)
        count = conn.execute("SELECT COUNT(*) FROM Speakers").fetchone()[0]
        color = _SPEAKER_COLORS[count % len(_SPEAKER_COLORS)]
        cursor = conn.execute(
            "INSERT INTO Speakers (VoiceIdentifier, Name, Color) VALUES (?, ?, ?)",
            (new_voice_id, new_name, color),
        )
        new_id = cursor.lastrowid
        conn.execute(
            "UPDATE Segments SET SpeakerId = ? WHERE AudioId = ? AND SpeakerId = ?",
            (new_id, audio_id, old_speaker_id),
        )
        after = _distinct_audio_speakers(conn, audio_id)
        _adjust_relations_for_audio_diff(conn, before, after)
        conn.commit()
        row = conn.execute(
            "SELECT Id, VoiceIdentifier, Name, Color, RiskLevel, FirstDetected FROM Speakers WHERE Id = ?",
            (new_id,)
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["Id"],
        "voiceIdentifier": row["VoiceIdentifier"],
        "name": row["Name"],
        "color": row["Color"],
        "riskLevel": row["RiskLevel"],
        "firstDetected": row["FirstDetected"],
    }


def update_speaker(speaker_id: int, name: str, risk_level: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute(
            "UPDATE Speakers SET Name=?, RiskLevel=? WHERE Id=?",
            (name, risk_level, speaker_id),
        )
        conn.commit()
    return result.rowcount > 0


def delete_speaker(speaker_id: int) -> bool:
    """
    Drop a speaker. Segments and Alerts that referenced them have their FK set
    to NULL (the audios stay, just labelled "Unknown"); Relations that touched
    them are cascaded out by the schema's ON DELETE CASCADE.
    """
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM Speakers WHERE Id = ?", (speaker_id,))
        conn.commit()
    return result.rowcount > 0


def find_speaker_by_name(name: str, exclude_id: Optional[int] = None) -> Optional[dict]:
    """Case-insensitive, trimmed lookup. Used to detect name collisions before a merge."""
    needle = name.strip()
    if not needle:
        return None
    with _get_conn() as conn:
        if exclude_id is not None:
            row = conn.execute(
                "SELECT Id, VoiceIdentifier, Name FROM Speakers WHERE LOWER(TRIM(Name)) = LOWER(?) AND Id != ?",
                (needle, exclude_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT Id, VoiceIdentifier, Name FROM Speakers WHERE LOWER(TRIM(Name)) = LOWER(?)",
                (needle,),
            ).fetchone()
    if not row:
        return None
    return {"id": row["Id"], "voiceIdentifier": row["VoiceIdentifier"], "name": row["Name"]}


def _normalize_wikidata_id(entity_id: str) -> str:
    """Wikidata IDs are 'Q' + digits. Uppercase the Q so lookups are stable."""
    cleaned = entity_id.strip()
    return cleaned[:1].upper() + cleaned[1:] if cleaned else ""


def set_wikidata_id(speaker_id: int, entity_id: str) -> None:
    """Persist a Wikidata QID on a speaker. Raises ValueError if another
    speaker already claims the same entity. Pass an empty string to clear."""
    normalized = _normalize_wikidata_id(entity_id)
    if normalized and not (normalized.startswith("Q") and normalized[1:].isdigit()):
        raise ValueError(f"'{entity_id}' is not a valid Wikidata QID (expected like 'Q9682').")
    with _get_conn() as conn:
        if normalized:
            clash = conn.execute(
                "SELECT Id FROM Speakers WHERE WikidataId = ? AND Id != ?",
                (normalized, speaker_id),
            ).fetchone()
            if clash:
                raise ValueError(f"Wikidata entity {normalized} is already linked to another speaker.")
            conn.execute(
                "UPDATE Speakers SET WikidataId = ? WHERE Id = ?", (normalized, speaker_id)
            )
        else:
            conn.execute("UPDATE Speakers SET WikidataId = NULL WHERE Id = ?", (speaker_id,))
        conn.commit()


def get_speaker_by_wikidata_id(entity_id: str) -> Optional[dict]:
    """Look up a speaker by Wikidata QID. Returns the same shape as
    get_speaker(), or None."""
    normalized = _normalize_wikidata_id(entity_id)
    if not normalized:
        return None
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT Id FROM Speakers WHERE WikidataId = ?", (normalized,)
        ).fetchone()
    if not row:
        return None
    return get_speaker(row["Id"])


def merge_speakers(source_id: int, target_id: int) -> bool:
    """
    Fold source_id into target_id: move every segment and the relations it
    implies, then delete source. Relations are recomputed per-audio using a
    before/after diff so audios that contained BOTH speakers don't end up
    double-counted.
    """
    if source_id == target_id:
        return False
    with _get_conn() as conn:
        a = conn.execute("SELECT Id FROM Speakers WHERE Id = ?", (source_id,)).fetchone()
        b = conn.execute("SELECT Id FROM Speakers WHERE Id = ?", (target_id,)).fetchone()
        if not a or not b:
            return False

        affected_audios = [
            r["AudioId"] for r in conn.execute(
                "SELECT DISTINCT AudioId FROM Segments WHERE SpeakerId = ?",
                (source_id,),
            ).fetchall()
        ]

        for audio_id in affected_audios:
            before = _distinct_audio_speakers(conn, audio_id)
            conn.execute(
                "UPDATE Segments SET SpeakerId = ? WHERE AudioId = ? AND SpeakerId = ?",
                (target_id, audio_id, source_id),
            )
            after = _distinct_audio_speakers(conn, audio_id)
            _adjust_relations_for_audio_diff(conn, before, after)

        # Any leftover relations that still reference the source (e.g. orphan rows
        # from earlier bugs) — drop them; the per-audio diffs above are the truth.
        conn.execute(
            "DELETE FROM Relations WHERE SpeakerAId = ? OR SpeakerBId = ?",
            (source_id, source_id),
        )

        conn.execute(
            "UPDATE Alerts SET RelatedSpeakerId = ? WHERE RelatedSpeakerId = ?",
            (target_id, source_id),
        )
        conn.execute("DELETE FROM Speakers WHERE Id = ?", (source_id,))
        conn.commit()
    return True


# ─── Segments ─────────────────────────────────────────────────────────────────

def clear_segments(audio_id: int) -> None:
    with _get_conn() as conn:
        conn.execute("DELETE FROM Segments WHERE AudioId = ?", (audio_id,))
        conn.commit()


def insert_segments(segments: list[dict]) -> None:
    """Each dict: {audio_id, speaker_id, text, start_time, end_time}"""
    with _get_conn() as conn:
        conn.executemany(
            """INSERT INTO Segments (AudioId, SpeakerId, Text, StartTime, EndTime)
               VALUES (:audio_id, :speaker_id, :text, :start_time, :end_time)""",
            segments,
        )
        conn.commit()


def get_segments_by_ids(segment_ids: list[int]) -> list[dict]:
    """Look up specific segments by Id. Used by the split-speaker flow to find
    the time ranges the user wants moved."""
    if not segment_ids:
        return []
    placeholders = ",".join("?" for _ in segment_ids)
    with _get_conn() as conn:
        rows = conn.execute(
            f"""SELECT Id, AudioId, SpeakerId, StartTime, EndTime
                FROM Segments WHERE Id IN ({placeholders})""",
            segment_ids,
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "audioId": r["AudioId"],
            "speakerId": r["SpeakerId"],
            "startTime": r["StartTime"],
            "endTime": r["EndTime"],
        }
        for r in rows
    ]


def repoint_segments(segment_ids: list[int], new_speaker_id: int) -> int:
    """Repoint each given segment to a new speaker. Returns the row count updated."""
    if not segment_ids:
        return 0
    placeholders = ",".join("?" for _ in segment_ids)
    with _get_conn() as conn:
        result = conn.execute(
            f"UPDATE Segments SET SpeakerId = ? WHERE Id IN ({placeholders})",
            (new_speaker_id, *segment_ids),
        )
        conn.commit()
    return result.rowcount


def delete_embeddings_for_speaker_and_audio(speaker_id: int, audio_id: int) -> int:
    """Delete embeddings of a speaker that came from a specific audio. Used by
    split-speaker so we can re-extract clean per-audio embeddings."""
    with _get_conn() as conn:
        result = conn.execute(
            "DELETE FROM SpeakerEmbeddings WHERE SpeakerId = ? AND SourceAudioId = ?",
            (speaker_id, audio_id),
        )
        conn.commit()
    return result.rowcount


def get_segments_by_audio(audio_id: int) -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT sg.Id, sg.SpeakerId, sg.Text, sg.StartTime, sg.EndTime,
                      sp.Name AS SpeakerName, sp.Color AS SpeakerColor
               FROM Segments sg
               LEFT JOIN Speakers sp ON sp.Id = sg.SpeakerId
               WHERE sg.AudioId = ?
               ORDER BY sg.StartTime""",
            (audio_id,),
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "speakerId": r["SpeakerId"],
            "speakerName": r["SpeakerName"] or "Unknown",
            "speakerColor": r["SpeakerColor"] or "#6366f1",
            "text": r["Text"],
            "startTime": r["StartTime"],
            "endTime": r["EndTime"],
        }
        for r in rows
    ]


# ─── Relations ────────────────────────────────────────────────────────────────

def upsert_relation(speaker_a_id: int, speaker_b_id: int, topic: str = "") -> None:
    """Increment interaction count if pair exists, insert otherwise. Enforces a < b."""
    a, b = (speaker_a_id, speaker_b_id) if speaker_a_id < speaker_b_id else (speaker_b_id, speaker_a_id)
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO Relations (SpeakerAId, SpeakerBId, Topic, InteractionCount, LastContact)
               VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
               ON CONFLICT(SpeakerAId, SpeakerBId)
               DO UPDATE SET InteractionCount = InteractionCount + 1,
                             LastContact = CURRENT_TIMESTAMP,
                             Topic = CASE WHEN excluded.Topic != '' THEN excluded.Topic ELSE Topic END""",
            (a, b, topic),
        )
        conn.commit()


def get_all_relations() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT r.Id, r.InteractionCount, r.Topic, r.LastContact,
                      sa.Id AS AId, sa.Name AS AName, sa.Color AS AColor,
                      sb.Id AS BId, sb.Name AS BName, sb.Color AS BColor
               FROM Relations r
               JOIN Speakers sa ON sa.Id = r.SpeakerAId
               JOIN Speakers sb ON sb.Id = r.SpeakerBId
               ORDER BY r.InteractionCount DESC"""
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "speakerA": {"id": r["AId"], "name": r["AName"], "color": r["AColor"]},
            "speakerB": {"id": r["BId"], "name": r["BName"], "color": r["BColor"]},
            "interactionCount": r["InteractionCount"],
            "topic": r["Topic"],
            "lastContact": r["LastContact"],
        }
        for r in rows
    ]


# ─── Speaker Groups ───────────────────────────────────────────────────────────

def get_all_groups() -> list[dict]:
    with _get_conn() as conn:
        groups = conn.execute(
            "SELECT Id, Name, Color, CreatedAt FROM SpeakerGroups ORDER BY CreatedAt ASC"
        ).fetchall()
        members = conn.execute(
            """SELECT sgm.GroupId, s.Id, s.Name, s.Color
               FROM SpeakerGroupMembers sgm
               JOIN Speakers s ON s.Id = sgm.SpeakerId"""
        ).fetchall()
    by_group: dict[int, list[dict]] = {}
    for m in members:
        by_group.setdefault(m["GroupId"], []).append(
            {"id": m["Id"], "name": m["Name"], "color": m["Color"]}
        )
    return [
        {
            "id": g["Id"],
            "name": g["Name"],
            "color": g["Color"],
            "createdAt": g["CreatedAt"],
            "members": by_group.get(g["Id"], []),
        }
        for g in groups
    ]


def create_group(name: str, color: str = "#6366f1") -> int:
    with _get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO SpeakerGroups (Name, Color) VALUES (?, ?)", (name, color)
        )
        conn.commit()
    return cursor.lastrowid


def update_group(group_id: int, name: str, color: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute(
            "UPDATE SpeakerGroups SET Name = ?, Color = ? WHERE Id = ?",
            (name, color, group_id),
        )
        conn.commit()
    return result.rowcount > 0


def delete_group(group_id: int) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM SpeakerGroups WHERE Id = ?", (group_id,))
        conn.commit()
    return result.rowcount > 0


def add_group_member(group_id: int, speaker_id: int) -> bool:
    with _get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO SpeakerGroupMembers (GroupId, SpeakerId) VALUES (?, ?)",
            (group_id, speaker_id),
        )
        conn.commit()
    return True


def remove_group_member(group_id: int, speaker_id: int) -> bool:
    with _get_conn() as conn:
        result = conn.execute(
            "DELETE FROM SpeakerGroupMembers WHERE GroupId = ? AND SpeakerId = ?",
            (group_id, speaker_id),
        )
        conn.commit()
    return result.rowcount > 0


def get_bridges(group_a_id: int, group_b_id: int) -> list[dict]:
    """Return speakers connected to at least one member of each group."""
    groups = {g["id"]: g for g in get_all_groups()}
    group_a = groups.get(group_a_id)
    group_b = groups.get(group_b_id)
    if not group_a or not group_b:
        return []

    members_a = {m["id"] for m in group_a["members"]}
    members_b = {m["id"] for m in group_b["members"]}

    relations = get_all_relations()
    adjacency: dict[int, set[int]] = {}
    for r in relations:
        a_id, b_id = r["speakerA"]["id"], r["speakerB"]["id"]
        adjacency.setdefault(a_id, set()).add(b_id)
        adjacency.setdefault(b_id, set()).add(a_id)

    bridges = []
    seen = set()
    for speaker_id, neighbors in adjacency.items():
        if speaker_id in seen:
            continue
        if neighbors & members_a and neighbors & members_b:
            seen.add(speaker_id)
            bridges.append(speaker_id)

    if not bridges:
        return []

    with _get_conn() as conn:
        placeholders = ",".join("?" * len(bridges))
        rows = conn.execute(
            f"""SELECT s.Id, s.Name, s.Color, s.RiskLevel, s.FirstDetected,
                       s.VoiceIdentifier, s.WikidataId,
                       COUNT(DISTINCT seg.AudioId) AS RecordingCount,
                       COUNT(se.Id) AS SampleCount
                FROM Speakers s
                LEFT JOIN Segments seg ON seg.SpeakerId = s.Id
                LEFT JOIN SpeakerEmbeddings se ON se.SpeakerId = s.Id
                WHERE s.Id IN ({placeholders})
                GROUP BY s.Id""",
            bridges,
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "name": r["Name"],
            "color": r["Color"],
            "riskLevel": r["RiskLevel"],
            "firstDetected": r["FirstDetected"],
            "voiceIdentifier": r["VoiceIdentifier"],
            "wikidataId": r["WikidataId"],
            "recordingCount": r["RecordingCount"],
            "sampleCount": r["SampleCount"],
        }
        for r in rows
    ]


# ─── System Stats ─────────────────────────────────────────────────────────────

def get_system_stats() -> dict:
    try:
        with _get_conn() as conn:
            total_users    = conn.execute("SELECT COUNT(*) FROM Users").fetchone()[0]
            total_files    = conn.execute("SELECT COUNT(*) FROM Audios").fetchone()[0]
            storage_bytes  = conn.execute("SELECT COALESCE(SUM(FileSize), 0) FROM Audios").fetchone()[0]
        db_status = True
    except Exception:
        total_users = total_files = storage_bytes = 0
        db_status = False
    return {
        "totalUsers":       total_users,
        "totalFiles":       total_files,
        "storageUsedBytes": storage_bytes,
        "dbStatus":         db_status,
    }


# ─── Alerts ───────────────────────────────────────────────────────────────────

def create_alert(alert_type: str, message: str,
                 related_speaker_id: Optional[int] = None,
                 related_audio_id: Optional[int] = None) -> int:
    with _get_conn() as conn:
        cursor = conn.execute(
            """INSERT INTO Alerts (Type, Message, RelatedSpeakerId, RelatedAudioId)
               VALUES (?, ?, ?, ?)""",
            (alert_type, message, related_speaker_id, related_audio_id),
        )
        conn.commit()
    return cursor.lastrowid


def get_all_alerts() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT a.Id, a.Type, a.Message, a.CreatedAt,
                      sp.Name AS SpeakerName, au.Name AS AudioName
               FROM Alerts a
               LEFT JOIN Speakers sp ON sp.Id = a.RelatedSpeakerId
               LEFT JOIN Audios au ON au.Id = a.RelatedAudioId
               ORDER BY a.CreatedAt DESC"""
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "type": r["Type"],
            "message": r["Message"],
            "createdAt": r["CreatedAt"],
            "speakerName": r["SpeakerName"],
            "audioName": r["AudioName"],
        }
        for r in rows
    ]


# ─── Speaker Embeddings ───────────────────────────────────────────────────────

def insert_embeddings(
    speaker_id: int,
    vectors: np.ndarray,
    model_version: str,
    source_audio_id: Optional[int] = None,
) -> int:
    """Append every row of `vectors` (shape (N, dim)) to SpeakerEmbeddings, then
    trim oldest-first so the speaker keeps at most CAP_SAMPLES_PER_SPEAKER rows.
    Returns the number of rows actually inserted."""
    arr = np.asarray(vectors, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    if arr.size == 0:
        return 0
    dim = arr.shape[1]
    rows = [
        (speaker_id, arr[i].tobytes(), dim, model_version, source_audio_id)
        for i in range(arr.shape[0])
    ]
    with _get_conn() as conn:
        conn.executemany(
            """INSERT INTO SpeakerEmbeddings
               (SpeakerId, Vector, Dim, ModelVersion, SourceAudioId)
               VALUES (?, ?, ?, ?, ?)""",
            rows,
        )
        conn.execute(
            f"""DELETE FROM SpeakerEmbeddings
                 WHERE SpeakerId = ?
                   AND Id NOT IN (
                     SELECT Id FROM SpeakerEmbeddings
                      WHERE SpeakerId = ?
                      ORDER BY EnrolledAt DESC, Id DESC
                      LIMIT {CAP_SAMPLES_PER_SPEAKER}
                   )""",
            (speaker_id, speaker_id),
        )
        conn.commit()
    return len(rows)


def get_all_embeddings() -> dict[int, np.ndarray]:
    """Return {speaker_id: ndarray of shape (M, dim)} for every speaker that has at
    least one embedding. Decodes BLOB → float32 vectors. Skips rows whose Dim does
    not match EMBEDDING_DIM (defensive against future model swaps)."""
    out: dict[int, list[np.ndarray]] = {}
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT SpeakerId, Vector, Dim FROM SpeakerEmbeddings"
        ).fetchall()
    for r in rows:
        if r["Dim"] != EMBEDDING_DIM:
            continue
        vec = np.frombuffer(r["Vector"], dtype=np.float32)
        if vec.shape[0] != EMBEDDING_DIM:
            continue
        out.setdefault(r["SpeakerId"], []).append(vec)
    return {sid: np.stack(v) for sid, v in out.items()}


def count_embeddings(speaker_id: int) -> int:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM SpeakerEmbeddings WHERE SpeakerId = ?",
            (speaker_id,),
        ).fetchone()
    return row[0] if row else 0


def clear_embeddings_for_speaker(speaker_id: int) -> None:
    with _get_conn() as conn:
        conn.execute(
            "DELETE FROM SpeakerEmbeddings WHERE SpeakerId = ?", (speaker_id,)
        )
        conn.commit()


def move_embeddings(source_speaker_id: int, target_speaker_id: int) -> None:
    """Repoint every embedding from source → target, then trim target to the cap.
    Used by accept-suggestion and merge flows."""
    if source_speaker_id == target_speaker_id:
        return
    with _get_conn() as conn:
        conn.execute(
            "UPDATE SpeakerEmbeddings SET SpeakerId = ? WHERE SpeakerId = ?",
            (target_speaker_id, source_speaker_id),
        )
        conn.execute(
            f"""DELETE FROM SpeakerEmbeddings
                 WHERE SpeakerId = ?
                   AND Id NOT IN (
                     SELECT Id FROM SpeakerEmbeddings
                      WHERE SpeakerId = ?
                      ORDER BY EnrolledAt DESC, Id DESC
                      LIMIT {CAP_SAMPLES_PER_SPEAKER}
                   )""",
            (target_speaker_id, target_speaker_id),
        )
        conn.commit()


# ─── Speaker Suggestions ──────────────────────────────────────────────────────

def insert_speaker_suggestion(
    audio_id: int,
    unknown_speaker_id: int,
    suggested_speaker_id: int,
    confidence: float,
) -> int:
    with _get_conn() as conn:
        cursor = conn.execute(
            """INSERT INTO SpeakerSuggestions
               (AudioId, UnknownSpeakerId, SuggestedSpeakerId, Confidence)
               VALUES (?, ?, ?, ?)""",
            (audio_id, unknown_speaker_id, suggested_speaker_id, confidence),
        )
        conn.commit()
    return cursor.lastrowid


def get_suggestions_for_audio(audio_id: int) -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT s.Id, s.Confidence, s.CreatedAt,
                      u.Id AS UnknownId, u.Name AS UnknownName, u.Color AS UnknownColor,
                      t.Id AS TargetId, t.Name AS TargetName, t.Color AS TargetColor
               FROM SpeakerSuggestions s
               JOIN Speakers u ON u.Id = s.UnknownSpeakerId
               JOIN Speakers t ON t.Id = s.SuggestedSpeakerId
               WHERE s.AudioId = ?
               ORDER BY s.Confidence DESC""",
            (audio_id,),
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "confidence": r["Confidence"],
            "createdAt": r["CreatedAt"],
            "unknownSpeaker": {
                "id": r["UnknownId"], "name": r["UnknownName"], "color": r["UnknownColor"],
            },
            "suggestedSpeaker": {
                "id": r["TargetId"], "name": r["TargetName"], "color": r["TargetColor"],
            },
        }
        for r in rows
    ]


def get_suggestion(suggestion_id: int) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT Id, AudioId, UnknownSpeakerId, SuggestedSpeakerId, Confidence
               FROM SpeakerSuggestions WHERE Id = ?""",
            (suggestion_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["Id"],
        "audioId": row["AudioId"],
        "unknownSpeakerId": row["UnknownSpeakerId"],
        "suggestedSpeakerId": row["SuggestedSpeakerId"],
        "confidence": row["Confidence"],
    }


def delete_suggestion(suggestion_id: int) -> bool:
    with _get_conn() as conn:
        result = conn.execute(
            "DELETE FROM SpeakerSuggestions WHERE Id = ?", (suggestion_id,)
        )
        conn.commit()
    return result.rowcount > 0
