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
        if "ImagePath" not in existing_cols:
            conn.execute("ALTER TABLE Speakers ADD COLUMN ImagePath TEXT")
        if "IsUntracked" not in existing_cols:
            # Untracked = interviewer / one-shot guest / anyone you don't want
            # cluttering the connection graph. They still appear in transcripts
            # but no Relations rows are inserted for them and the network view
            # filters them out.
            conn.execute("ALTER TABLE Speakers ADD COLUMN IsUntracked INTEGER NOT NULL DEFAULT 0")
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
            CREATE TABLE IF NOT EXISTS DangerousWords (
                Id        INTEGER PRIMARY KEY AUTOINCREMENT,
                Word      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                Severity  TEXT    NOT NULL DEFAULT 'high' CHECK(Severity IN ('low','medium','high')),
                CreatedBy INTEGER REFERENCES Users(Id) ON DELETE SET NULL,
                CreatedAt TEXT    NOT NULL DEFAULT (datetime('now'))
            )
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

        # ─── NLP migrations (Ofir — coded-language detection) ──────────────
        # SQLite cannot drop CHECK constraints via ALTER, and cannot add FK refs
        # via ALTER ADD COLUMN. We probe table_info() and ADD COLUMN only if
        # missing — same pattern as the WikidataId migration above.
        seg_cols = {row[1] for row in conn.execute("PRAGMA table_info(Segments)").fetchall()}
        if "Embedding" not in seg_cols:
            conn.execute("ALTER TABLE Segments ADD COLUMN Embedding BLOB")
        if "EmbeddingModel" not in seg_cols:
            conn.execute("ALTER TABLE Segments ADD COLUMN EmbeddingModel TEXT")
        if "SuspicionScore" not in seg_cols:
            conn.execute("ALTER TABLE Segments ADD COLUMN SuspicionScore REAL")
        if "SubScores" not in seg_cols:
            conn.execute("ALTER TABLE Segments ADD COLUMN SubScores TEXT")

        alert_cols = {row[1] for row in conn.execute("PRAGMA table_info(Alerts)").fetchall()}
        if "Category" not in alert_cols:
            conn.execute("ALTER TABLE Alerts ADD COLUMN Category TEXT")
        if "SegmentId" not in alert_cols:
            # NOTE: FK ref cannot be added via ALTER; column is a plain INTEGER.
            # Join manually with ON Alerts.SegmentId = Segments.Id.
            conn.execute("ALTER TABLE Alerts ADD COLUMN SegmentId INTEGER")
        if "SubScores" not in alert_cols:
            conn.execute("ALTER TABLE Alerts ADD COLUMN SubScores TEXT")
        if "LlmExplanation" not in alert_cols:
            conn.execute("ALTER TABLE Alerts ADD COLUMN LlmExplanation TEXT")

        dw_cols = {row[1] for row in conn.execute("PRAGMA table_info(DangerousWords)").fetchall()}
        if "IsEuphemism" not in dw_cols:
            conn.execute("ALTER TABLE DangerousWords ADD COLUMN IsEuphemism INTEGER NOT NULL DEFAULT 0")
        if "AutoLearned" not in dw_cols:
            conn.execute("ALTER TABLE DangerousWords ADD COLUMN AutoLearned INTEGER NOT NULL DEFAULT 0")
        if "Confidence" not in dw_cols:
            conn.execute("ALTER TABLE DangerousWords ADD COLUMN Confidence REAL")
        if "Embedding" not in dw_cols:
            conn.execute("ALTER TABLE DangerousWords ADD COLUMN Embedding BLOB")
        if "EmbeddingModel" not in dw_cols:
            conn.execute("ALTER TABLE DangerousWords ADD COLUMN EmbeddingModel TEXT")
        # ─── NLP migrations: Ofek — NER / Ghost Nodes / Entity Resolution ───
        spk_cols = {row[1] for row in conn.execute("PRAGMA table_info(Speakers)").fetchall()}
        if "IsGhost" not in spk_cols:
            conn.execute("ALTER TABLE Speakers ADD COLUMN IsGhost INTEGER NOT NULL DEFAULT 0")
        if "PromotedFromEntityId" not in spk_cols:
            conn.execute("ALTER TABLE Speakers ADD COLUMN PromotedFromEntityId INTEGER")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS Entities (
                Id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                Type                TEXT NOT NULL,
                RawText             TEXT NOT NULL,
                NormalizedText      TEXT NOT NULL,
                PhoneticKey         TEXT,
                WikidataId          TEXT,
                GhostSpeakerId      INTEGER REFERENCES Speakers(Id) ON DELETE SET NULL,
                MentionCount        INTEGER NOT NULL DEFAULT 0,
                DistinctSpeakerCount INTEGER NOT NULL DEFAULT 0,
                DistinctAudioCount  INTEGER NOT NULL DEFAULT 0,
                FirstSeen           DATETIME DEFAULT CURRENT_TIMESTAMP,
                LastSeen            DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS IX_Entities_NormalizedText
                ON Entities(NormalizedText)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS IX_Entities_PhoneticKey
                ON Entities(PhoneticKey)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS EntityMentions (
                Id                INTEGER PRIMARY KEY AUTOINCREMENT,
                EntityId          INTEGER NOT NULL REFERENCES Entities(Id) ON DELETE CASCADE,
                SegmentId         INTEGER NOT NULL REFERENCES Segments(Id) ON DELETE CASCADE,
                Offset            INTEGER NOT NULL,
                Length            INTEGER NOT NULL,
                Confidence        REAL NOT NULL DEFAULT 1.0,
                ResolvedSpeakerId INTEGER REFERENCES Speakers(Id) ON DELETE SET NULL,
                ResolutionMethod  TEXT
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS IX_EntityMentions_EntityId
                ON EntityMentions(EntityId)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS IX_EntityMentions_SegmentId
                ON EntityMentions(SegmentId)
        """)
        # ─────────────────────────────────────────────────────────────────────

        # ─── Groups / Projects migrations ──────────────────────────────────
        # Top-level group (ParentGroupId IS NULL) IS the "project".
        # Subgroups have ParentGroupId set to a top-level row. Two levels max —
        # enforced in CRUD (SQLite can't express it as a constraint).
        sg_cols = {row[1] for row in conn.execute("PRAGMA table_info(SpeakerGroups)").fetchall()}
        if "ParentGroupId" not in sg_cols:
            conn.execute("ALTER TABLE SpeakerGroups ADD COLUMN ParentGroupId INTEGER")
        if "Description" not in sg_cols:
            conn.execute("ALTER TABLE SpeakerGroups ADD COLUMN Description TEXT")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ProjectAssignments (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                AnalystUserId INTEGER NOT NULL REFERENCES Users(Id) ON DELETE CASCADE,
                GroupId INTEGER NOT NULL REFERENCES SpeakerGroups(Id) ON DELETE CASCADE,
                CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(AnalystUserId, GroupId)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS IX_ProjectAssignments_User  ON ProjectAssignments(AnalystUserId)")
        conn.execute("CREATE INDEX IF NOT EXISTS IX_ProjectAssignments_Group ON ProjectAssignments(GroupId)")
        # ───────────────────────────────────────────────────────────────────

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
    "#f43f5e", "#f97316", "#facc15", "#4ade80", "#34d399",
    "#22d3ee", "#60a5fa", "#a78bfa", "#e879f9", "#fb7185",
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
            """SELECT s.Id, s.VoiceIdentifier, s.Name, s.Color, s.RiskLevel, s.FirstDetected,
                      s.WikidataId, s.ImagePath, s.IsUntracked, s.IsGhost,
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
        "imagePath": row["ImagePath"],
        "isUntracked": bool(row["IsUntracked"]),
        "isGhost": bool(row["IsGhost"]),
        "recordingCount": row["RecordingCount"],
        "sampleCount": row["SampleCount"],
    }


def set_speaker_image_path(speaker_id: int, image_path: Optional[str]) -> bool:
    """Set or clear the ImagePath for a speaker. Returns True if a row updated."""
    with _get_conn() as conn:
        result = conn.execute(
            "UPDATE Speakers SET ImagePath = ? WHERE Id = ?",
            (image_path, speaker_id),
        )
        conn.commit()
    return result.rowcount > 0


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
            """SELECT s.Id, s.VoiceIdentifier, s.Name, s.Color, s.RiskLevel, s.FirstDetected,
                      s.WikidataId, s.ImagePath, s.IsUntracked, s.IsGhost,
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
            "imagePath": r["ImagePath"],
            "isUntracked": bool(r["IsUntracked"]),
            "isGhost": bool(r["IsGhost"]),
            "recordingCount": r["RecordingCount"],
            "sampleCount": r["SampleCount"],
        }
        for r in rows
    ]


def set_speaker_untracked(speaker_id: int, untracked: bool) -> bool:
    with _get_conn() as conn:
        result = conn.execute(
            "UPDATE Speakers SET IsUntracked = ? WHERE Id = ?",
            (1 if untracked else 0, speaker_id),
        )
        # If we're marking as untracked, prune their relations so the graph
        # cleans up immediately. Re-tracking won't recreate them — they'll
        # rebuild when the next audio with that speaker is processed.
        if untracked:
            conn.execute(
                "DELETE FROM Relations WHERE SpeakerAId = ? OR SpeakerBId = ?",
                (speaker_id, speaker_id),
            )
        conn.commit()
    return result.rowcount > 0


def get_cooccurring_named_speaker_ids(speaker_id: int) -> list[int]:
    """Distinct speakers sharing at least one audio with `speaker_id`, excluding
    the speaker itself and any auto-generated 'Speaker N' rows. SQLite's GLOB
    `'Speaker [0-9]*'` is loose (matches 'Speaker 5x' too) — fine for filtering
    out auto-names, which always have the strict suffix."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT s2.SpeakerId
               FROM Segments s1
               JOIN Segments s2 ON s2.AudioId = s1.AudioId
               JOIN Speakers sp ON sp.Id = s2.SpeakerId
               WHERE s1.SpeakerId = ?
                 AND s2.SpeakerId != ?
                 AND s2.SpeakerId IS NOT NULL
                 AND sp.Name NOT GLOB 'Speaker [0-9]*'""",
            (speaker_id, speaker_id),
        ).fetchall()
    return [r["SpeakerId"] for r in rows]


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
    import json
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT sg.Id, sg.SpeakerId, sg.Text, sg.StartTime, sg.EndTime,
                      sg.SuspicionScore, sg.SubScores, sg.Embedding,
                      sp.Name AS SpeakerName, sp.Color AS SpeakerColor,
                      sp.ImagePath AS SpeakerImagePath
               FROM Segments sg
               LEFT JOIN Speakers sp ON sp.Id = sg.SpeakerId
               WHERE sg.AudioId = ?
               ORDER BY sg.StartTime""",
            (audio_id,),
        ).fetchall()
    out = []
    for r in rows:
        sub = None
        if r["SubScores"]:
            try:
                sub = json.loads(r["SubScores"])
            except Exception:
                sub = None
        out.append({
            "id": r["Id"],
            "speakerId": r["SpeakerId"],
            "speakerName": r["SpeakerName"] or "Unknown",
            "speakerColor": r["SpeakerColor"] or "#6366f1",
            "speakerImagePath": r["SpeakerImagePath"],
            "text": r["Text"],
            "startTime": r["StartTime"],
            "endTime": r["EndTime"],
            "suspicionScore": r["SuspicionScore"],
            "subScores": sub,
        })
    return out


def get_all_segment_embeddings() -> list[dict]:
    """Return (id, speaker_id, embedding blob) for every segment that has an embedding."""
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT Id, SpeakerId, Embedding FROM Segments WHERE Embedding IS NOT NULL"
        ).fetchall()
    return [{"id": r["Id"], "speaker_id": r["SpeakerId"], "embedding": r["Embedding"]} for r in rows]


# ─── Entities ─────────────────────────────────────────────────────────────────

def _row_to_entity(r) -> dict:
    return {
        "id": r["Id"],
        "type": r["Type"],
        "rawText": r["RawText"],
        "normalizedText": r["NormalizedText"],
        "phoneticKey": r["PhoneticKey"],
        "wikidataId": r["WikidataId"],
        "ghostSpeakerId": r["GhostSpeakerId"],
        "mentionCount": r["MentionCount"],
        "distinctSpeakerCount": r["DistinctSpeakerCount"],
        "distinctAudioCount": r["DistinctAudioCount"],
        "firstSeen": r["FirstSeen"],
        "lastSeen": r["LastSeen"],
    }


def get_all_entities() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM Entities ORDER BY MentionCount DESC"
        ).fetchall()
    return [_row_to_entity(r) for r in rows]


def get_entity(entity_id: int) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM Entities WHERE Id = ?", (entity_id,)).fetchone()
    return _row_to_entity(row) if row else None


def upsert_entity(
    entity_type: str,
    raw_text: str,
    normalized_text: str,
    phonetic_key: Optional[str] = None,
    existing_id: Optional[int] = None,
) -> int:
    """Insert a new entity or update counts on an existing one. Returns the entity id."""
    with _get_conn() as conn:
        if existing_id is not None:
            conn.execute(
                """UPDATE Entities
                   SET MentionCount = MentionCount + 1,
                       LastSeen = CURRENT_TIMESTAMP
                   WHERE Id = ?""",
                (existing_id,),
            )
            conn.commit()
            return existing_id
        cursor = conn.execute(
            """INSERT INTO Entities
               (Type, RawText, NormalizedText, PhoneticKey, MentionCount,
                DistinctSpeakerCount, DistinctAudioCount)
               VALUES (?, ?, ?, ?, 1, 0, 0)""",
            (entity_type, raw_text, normalized_text, phonetic_key),
        )
        conn.commit()
        return cursor.lastrowid


def insert_entity_mention(
    entity_id: int,
    segment_id: int,
    offset: int,
    length: int,
    confidence: float,
    resolved_speaker_id: Optional[int],
    resolution_method: Optional[str],
) -> int:
    with _get_conn() as conn:
        cursor = conn.execute(
            """INSERT OR IGNORE INTO EntityMentions
               (EntityId, SegmentId, Offset, Length, Confidence,
                ResolvedSpeakerId, ResolutionMethod)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (entity_id, segment_id, offset, length, confidence,
             resolved_speaker_id, resolution_method),
        )
        conn.commit()
        # Keep aggregate counts fresh on the entity row
        conn.execute(
            """UPDATE Entities SET
               DistinctSpeakerCount = (
                   SELECT COUNT(DISTINCT ResolvedSpeakerId)
                   FROM EntityMentions
                   WHERE EntityId = ? AND ResolvedSpeakerId IS NOT NULL
               ),
               DistinctAudioCount = (
                   SELECT COUNT(DISTINCT sg.AudioId)
                   FROM EntityMentions em
                   JOIN Segments sg ON sg.Id = em.SegmentId
                   WHERE em.EntityId = ?
               )
               WHERE Id = ?""",
            (entity_id, entity_id, entity_id),
        )
        conn.commit()
    return cursor.lastrowid or 0


def get_entity_mentions(entity_id: int) -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT em.Id, em.EntityId, em.SegmentId, em.Offset, em.Length,
                      em.Confidence, em.ResolvedSpeakerId, em.ResolutionMethod,
                      sg.Text AS SegmentText, sg.AudioId,
                      sg.StartTime, sg.EndTime,
                      sp.Name AS SpeakerName,
                      au.Name AS AudioName
               FROM EntityMentions em
               JOIN Segments sg ON sg.Id = em.SegmentId
               LEFT JOIN Speakers sp ON sp.Id = em.ResolvedSpeakerId
               LEFT JOIN Audios au ON au.Id = sg.AudioId
               WHERE em.EntityId = ?
               ORDER BY sg.AudioId, sg.StartTime""",
            (entity_id,),
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "entityId": r["EntityId"],
            "segmentId": r["SegmentId"],
            "offset": r["Offset"],
            "length": r["Length"],
            "confidence": r["Confidence"],
            "resolvedSpeakerId": r["ResolvedSpeakerId"],
            "resolutionMethod": r["ResolutionMethod"],
            "segmentText": r["SegmentText"],
            "audioId": r["AudioId"],
            "startTime": r["StartTime"],
            "endTime": r["EndTime"],
            "speakerName": r["SpeakerName"],
            "audioName": r["AudioName"],
        }
        for r in rows
    ]


def get_mentions_for_segments(segment_ids: list[int]) -> list[dict]:
    """Return all EntityMentions for a list of segment ids (used by TranscriptView)."""
    if not segment_ids:
        return []
    placeholders = ",".join("?" for _ in segment_ids)
    with _get_conn() as conn:
        rows = conn.execute(
            f"""SELECT em.Id, em.EntityId, em.SegmentId, em.Offset, em.Length,
                       em.Confidence, em.ResolutionMethod,
                       e.Type AS EntityType, e.RawText, e.NormalizedText
                FROM EntityMentions em
                JOIN Entities e ON e.Id = em.EntityId
                WHERE em.SegmentId IN ({placeholders})""",
            segment_ids,
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "entityId": r["EntityId"],
            "segmentId": r["SegmentId"],
            "offset": r["Offset"],
            "length": r["Length"],
            "confidence": r["Confidence"],
            "resolutionMethod": r["ResolutionMethod"],
            "entityType": r["EntityType"],
            "rawText": r["RawText"],
            "normalizedText": r["NormalizedText"],
        }
        for r in rows
    ]


def get_entity_related_speakers(entity_id: int) -> list[dict]:
    """Return distinct speakers that have mentioned this entity."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT sp.Id, sp.Name, sp.Color, sp.RiskLevel,
                      COUNT(*) AS MentionCount
               FROM EntityMentions em
               JOIN Speakers sp ON sp.Id = em.ResolvedSpeakerId
               WHERE em.EntityId = ?
               GROUP BY sp.Id
               ORDER BY MentionCount DESC""",
            (entity_id,),
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "name": r["Name"],
            "color": r["Color"],
            "riskLevel": r["RiskLevel"],
            "mentionCount": r["MentionCount"],
        }
        for r in rows
    ]


def get_ghost_promotion_candidates(min_audios: int, min_speakers: int) -> list[dict]:
    """Return PERSON entities that haven't been promoted yet and cross the ghost threshold."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM Entities
               WHERE Type = 'PERSON'
                 AND GhostSpeakerId IS NULL
                 AND (DistinctAudioCount >= ? OR DistinctSpeakerCount >= ?)""",
            (min_audios, min_speakers),
        ).fetchall()
    return [_row_to_entity(r) for r in rows]


def create_ghost_speaker(entity_id: int, name: str) -> Optional[int]:
    """Create a ghost Speaker row and link it back to the Entity. Returns new speaker id."""
    voice_id = f"ghost_entity_{entity_id}"
    with _get_conn() as conn:
        existing = conn.execute(
            "SELECT Id FROM Speakers WHERE VoiceIdentifier = ?", (voice_id,)
        ).fetchone()
        if existing:
            ghost_id = existing["Id"]
        else:
            cursor = conn.execute(
                """INSERT INTO Speakers
                   (VoiceIdentifier, Name, RiskLevel, IsGhost, PromotedFromEntityId)
                   VALUES (?, ?, 'low', 1, ?)""",
                (voice_id, name, entity_id),
            )
            ghost_id = cursor.lastrowid
        conn.execute(
            "UPDATE Entities SET GhostSpeakerId = ? WHERE Id = ?",
            (ghost_id, entity_id),
        )
        conn.commit()
    return ghost_id


def upsert_mention_relation(speaker_id: int, ghost_speaker_id: int) -> None:
    """Upsert a 'mentioned' relation between a real speaker and a ghost speaker."""
    upsert_relation(speaker_id, ghost_speaker_id, topic="mentioned")


def link_entity_wikidata(entity_id: int, wikidata_id: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute(
            "UPDATE Entities SET WikidataId = ? WHERE Id = ?",
            (wikidata_id, entity_id),
        )
        conn.commit()
    return result.rowcount > 0


# ─── Relations ────────────────────────────────────────────────────────────────

def upsert_relation(speaker_a_id: int, speaker_b_id: int, topic: str = "") -> None:
    """Increment interaction count if pair exists, insert otherwise. Enforces a < b.
    Untracked speakers are silently skipped — the relation row never gets created,
    so the connection graph stays clean."""
    a, b = (speaker_a_id, speaker_b_id) if speaker_a_id < speaker_b_id else (speaker_b_id, speaker_a_id)
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT Id FROM Speakers WHERE Id IN (?, ?) AND IsUntracked = 1 LIMIT 1",
            (a, b),
        ).fetchone()
        if row is not None:
            return
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
               WHERE sa.IsUntracked = 0 AND sb.IsUntracked = 0
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

class GroupHierarchyError(ValueError):
    """Raised when a group create/update would break the 2-level invariant."""


def _validate_parent(conn: sqlite3.Connection, parent_group_id: Optional[int],
                     self_group_id: Optional[int] = None) -> None:
    """parent_group_id must point to a top-level group (its own ParentGroupId IS NULL).
    A group can't be its own parent."""
    if parent_group_id is None:
        return
    if self_group_id is not None and parent_group_id == self_group_id:
        raise GroupHierarchyError("A group cannot be its own parent.")
    row = conn.execute(
        "SELECT ParentGroupId FROM SpeakerGroups WHERE Id = ?", (parent_group_id,)
    ).fetchone()
    if not row:
        raise GroupHierarchyError(f"Parent group {parent_group_id} does not exist.")
    if row["ParentGroupId"] is not None:
        raise GroupHierarchyError(
            "Selected parent is itself a subgroup — only two levels of hierarchy are supported."
        )


def get_all_groups() -> list[dict]:
    with _get_conn() as conn:
        groups = conn.execute(
            """SELECT g.Id, g.Name, g.Color, g.CreatedAt, g.ParentGroupId, g.Description,
                      p.Name AS ParentGroupName
               FROM SpeakerGroups g
               LEFT JOIN SpeakerGroups p ON p.Id = g.ParentGroupId
               ORDER BY g.ParentGroupId IS NOT NULL, g.CreatedAt ASC"""
        ).fetchall()
        members = conn.execute(
            """SELECT sgm.GroupId, s.Id, s.Name, s.Color, s.ImagePath
               FROM SpeakerGroupMembers sgm
               JOIN Speakers s ON s.Id = sgm.SpeakerId"""
        ).fetchall()
    by_group: dict[int, list[dict]] = {}
    for m in members:
        by_group.setdefault(m["GroupId"], []).append(
            {"id": m["Id"], "name": m["Name"], "color": m["Color"], "imagePath": m["ImagePath"]}
        )
    return [
        {
            "id": g["Id"],
            "name": g["Name"],
            "color": g["Color"],
            "createdAt": g["CreatedAt"],
            "parentGroupId": g["ParentGroupId"],
            "parentGroupName": g["ParentGroupName"],
            "description": g["Description"],
            "members": by_group.get(g["Id"], []),
        }
        for g in groups
    ]


def get_group(group_id: int) -> Optional[dict]:
    for g in get_all_groups():
        if g["id"] == group_id:
            return g
    return None


def create_group(name: str, color: str = "#6366f1",
                 parent_group_id: Optional[int] = None,
                 description: Optional[str] = None) -> int:
    with _get_conn() as conn:
        _validate_parent(conn, parent_group_id)
        cursor = conn.execute(
            "INSERT INTO SpeakerGroups (Name, Color, ParentGroupId, Description) VALUES (?, ?, ?, ?)",
            (name, color, parent_group_id, description),
        )
        conn.commit()
    return cursor.lastrowid


def update_group(group_id: int, name: str, color: str,
                 parent_group_id: Optional[int] = None,
                 description: Optional[str] = None) -> bool:
    with _get_conn() as conn:
        _validate_parent(conn, parent_group_id, self_group_id=group_id)
        # If this group has children, refuse to make it a subgroup.
        if parent_group_id is not None:
            kid_count = conn.execute(
                "SELECT COUNT(*) FROM SpeakerGroups WHERE ParentGroupId = ?", (group_id,)
            ).fetchone()[0]
            if kid_count:
                raise GroupHierarchyError(
                    "Cannot demote a group with children to a subgroup. Move its children first."
                )
        result = conn.execute(
            "UPDATE SpeakerGroups SET Name = ?, Color = ?, ParentGroupId = ?, Description = ? WHERE Id = ?",
            (name, color, parent_group_id, description, group_id),
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
                       s.VoiceIdentifier, s.WikidataId, s.ImagePath,
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
            "imagePath": r["ImagePath"],
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

def _row_to_alert(r) -> dict:
    """Common alert-row → dict converter. Parses SubScores JSON defensively."""
    import json
    sub = None
    raw_sub = r["SubScores"] if "SubScores" in r.keys() else None
    if raw_sub:
        try:
            sub = json.loads(raw_sub)
        except Exception:
            sub = None
    return {
        "id": r["Id"],
        "type": r["Type"],
        "category": r["Category"] if "Category" in r.keys() else None,
        "message": r["Message"],
        "createdAt": r["CreatedAt"],
        "speakerName": r["SpeakerName"] if "SpeakerName" in r.keys() else None,
        "audioName": r["AudioName"] if "AudioName" in r.keys() else None,
        "audioId": r["RelatedAudioId"] if "RelatedAudioId" in r.keys() else None,
        "segmentId": r["SegmentId"] if "SegmentId" in r.keys() else None,
        "subScores": sub,
        "llmExplanation": r["LlmExplanation"] if "LlmExplanation" in r.keys() else None,
    }


def create_alert(alert_type: str, message: str,
                 related_speaker_id: Optional[int] = None,
                 related_audio_id: Optional[int] = None,
                 category: Optional[str] = None) -> int:
    with _get_conn() as conn:
        cursor = conn.execute(
            """INSERT INTO Alerts (Type, Message, RelatedSpeakerId, RelatedAudioId, Category)
               VALUES (?, ?, ?, ?, ?)""",
            (alert_type, message, related_speaker_id, related_audio_id, category),
        )
        conn.commit()
    return cursor.lastrowid


def create_coded_language_alert(
    severity: str,
    message: str,
    audio_id: int,
    segment_id: int,
    sub_scores: dict,
    llm_explanation: Optional[str] = None,
) -> int:
    """Insert a coded_language alert with sub-score breakdown JSON.

    Type is the standard severity ('low'|'medium'|'high') so the CHECK constraint
    is satisfied. Category='coded_language' is the discriminator.
    """
    import json
    with _get_conn() as conn:
        cursor = conn.execute(
            """INSERT INTO Alerts
               (Type, Message, RelatedAudioId, SegmentId, Category, SubScores, LlmExplanation)
               VALUES (?, ?, ?, ?, 'coded_language', ?, ?)""",
            (severity, message, audio_id, segment_id,
             json.dumps(sub_scores), llm_explanation),
        )
        conn.commit()
    return cursor.lastrowid


def get_all_alerts(category: Optional[str] = None) -> list[dict]:
    """Return every alert, newest first. Optional category filter
    ('coded_language' | 'dangerous_word' | None for all)."""
    sql = """SELECT a.Id, a.Type, a.Category, a.Message, a.CreatedAt,
                    a.RelatedAudioId, a.SegmentId, a.SubScores, a.LlmExplanation,
                    sp.Name AS SpeakerName, au.Name AS AudioName
             FROM Alerts a
             LEFT JOIN Speakers sp ON sp.Id = a.RelatedSpeakerId
             LEFT JOIN Audios au ON au.Id = a.RelatedAudioId"""
    params: tuple = ()
    if category:
        sql += " WHERE a.Category = ?"
        params = (category,)
    sql += " ORDER BY a.CreatedAt DESC"
    with _get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_alert(r) for r in rows]


def get_alerts_for_audio(audio_id: int) -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT a.Id, a.Type, a.Category, a.Message, a.CreatedAt,
                      a.RelatedAudioId, a.SegmentId, a.SubScores, a.LlmExplanation,
                      sp.Name AS SpeakerName, NULL AS AudioName
               FROM Alerts a
               LEFT JOIN Speakers sp ON sp.Id = a.RelatedSpeakerId
               WHERE a.RelatedAudioId = ?
               ORDER BY a.CreatedAt DESC""",
            (audio_id,),
        ).fetchall()
    return [_row_to_alert(r) for r in rows]


# ─── Dangerous Words ──────────────────────────────────────────────────────────

def get_dangerous_words(include_euphemisms: bool = False) -> list[dict]:
    """Default returns only plain dangerous words (IsEuphemism=0). Ofir's
    substring scanner uses this — we don't want euphemism phrases triggering
    literal substring alerts on top of the coded-language detector.

    NOTE for Ofek: if you ever need to scan over euphemisms too, pass
    include_euphemisms=True. The list_euphemisms() function below returns the
    other side of the split.
    """
    sql = "SELECT Id, Word, Severity, CreatedAt FROM DangerousWords"
    if not include_euphemisms:
        sql += " WHERE IsEuphemism = 0"
    sql += " ORDER BY CreatedAt DESC"
    with _get_conn() as conn:
        rows = conn.execute(sql).fetchall()
    return [{"id": r["Id"], "word": r["Word"], "severity": r["Severity"], "createdAt": r["CreatedAt"]} for r in rows]


def add_dangerous_word(word: str, severity: str, created_by: Optional[int] = None) -> dict:
    with _get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO DangerousWords (Word, Severity, CreatedBy) VALUES (?, ?, ?)",
            (word.strip(), severity, created_by or None),
        )
        conn.commit()
        row = conn.execute(
            "SELECT Id, Word, Severity, CreatedAt FROM DangerousWords WHERE Id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return {"id": row["Id"], "word": row["Word"], "severity": row["Severity"], "createdAt": row["CreatedAt"]}


def delete_dangerous_word(word_id: int) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM DangerousWords WHERE Id = ?", (word_id,))
        conn.commit()
    return result.rowcount > 0


# ─── NLP: Segments & Euphemisms (Ofir) ────────────────────────────────────────

EMBED_DIM_DEFAULT = 384  # BAAI/bge-small-en-v1.5


def set_segment_embedding(segment_id: int, vec: "np.ndarray", model_name: str) -> None:
    arr = np.asarray(vec, dtype=np.float32).reshape(-1)
    with _get_conn() as conn:
        conn.execute(
            "UPDATE Segments SET Embedding = ?, EmbeddingModel = ? WHERE Id = ?",
            (arr.tobytes(), model_name, segment_id),
        )
        conn.commit()


def set_segment_suspicion(segment_id: int, score: float, sub_scores: dict) -> None:
    import json
    with _get_conn() as conn:
        conn.execute(
            "UPDATE Segments SET SuspicionScore = ?, SubScores = ? WHERE Id = ?",
            (float(score), json.dumps(sub_scores), segment_id),
        )
        conn.commit()


def _decode_emb(blob: Optional[bytes]) -> Optional["np.ndarray"]:
    if not blob:
        return None
    try:
        return np.frombuffer(blob, dtype=np.float32).copy()
    except Exception:
        return None


def get_segments_with_embeddings(audio_id: int) -> list[dict]:
    """Returns rows ordered by StartTime, with embedding decoded (or None)."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT Id, SpeakerId, Text, StartTime, EndTime, Embedding, EmbeddingModel
               FROM Segments
               WHERE AudioId = ?
               ORDER BY StartTime""",
            (audio_id,),
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "speakerId": r["SpeakerId"],
            "text": r["Text"] or "",
            "startTime": r["StartTime"],
            "endTime": r["EndTime"],
            "embedding": _decode_emb(r["Embedding"]),
            "embeddingModel": r["EmbeddingModel"],
        }
        for r in rows
    ]


def get_all_segments_with_embeddings() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT Id, AudioId, SpeakerId, Text, Embedding, EmbeddingModel
               FROM Segments"""
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "audioId": r["AudioId"],
            "speakerId": r["SpeakerId"],
            "text": r["Text"] or "",
            "embedding": _decode_emb(r["Embedding"]),
            "embeddingModel": r["EmbeddingModel"],
        }
        for r in rows
    ]


def get_all_segment_texts() -> list[str]:
    with _get_conn() as conn:
        rows = conn.execute("SELECT Text FROM Segments").fetchall()
    return [(r["Text"] or "") for r in rows]


def count_segments_global() -> int:
    with _get_conn() as conn:
        row = conn.execute("SELECT COUNT(*) FROM Segments").fetchone()
    return int(row[0]) if row else 0


# Euphemism CRUD — sits on top of DangerousWords with IsEuphemism=1

def list_euphemisms() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT Id, Word, Severity, IsEuphemism, AutoLearned, Confidence, CreatedAt
               FROM DangerousWords
               WHERE IsEuphemism = 1
               ORDER BY AutoLearned ASC, CreatedAt DESC"""
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "phrase": r["Word"],
            "severity": r["Severity"],
            "isEuphemism": bool(r["IsEuphemism"]),
            "autoLearned": bool(r["AutoLearned"]),
            "confidence": r["Confidence"],
            "createdAt": r["CreatedAt"],
        }
        for r in rows
    ]


def add_euphemism(
    phrase: str,
    severity: str = "high",
    auto_learned: bool = False,
    confidence: Optional[float] = None,
    embedding: Optional["np.ndarray"] = None,
    embedding_model: Optional[str] = None,
    created_by: Optional[int] = None,
) -> Optional[dict]:
    """Insert a euphemism (IsEuphemism=1). Returns the new row, or None if the
    phrase already exists (UNIQUE COLLATE NOCASE on Word)."""
    blob = None
    if embedding is not None:
        blob = np.asarray(embedding, dtype=np.float32).reshape(-1).tobytes()
    try:
        with _get_conn() as conn:
            cursor = conn.execute(
                """INSERT INTO DangerousWords
                   (Word, Severity, CreatedBy, IsEuphemism, AutoLearned, Confidence,
                    Embedding, EmbeddingModel)
                   VALUES (?, ?, ?, 1, ?, ?, ?, ?)""",
                (phrase.strip(), severity, created_by, 1 if auto_learned else 0,
                 confidence, blob, embedding_model),
            )
            new_id = cursor.lastrowid
            conn.commit()
            row = conn.execute(
                """SELECT Id, Word, Severity, IsEuphemism, AutoLearned, Confidence, CreatedAt
                   FROM DangerousWords WHERE Id = ?""",
                (new_id,),
            ).fetchone()
    except sqlite3.IntegrityError:
        return None
    return {
        "id": row["Id"],
        "phrase": row["Word"],
        "severity": row["Severity"],
        "isEuphemism": bool(row["IsEuphemism"]),
        "autoLearned": bool(row["AutoLearned"]),
        "confidence": row["Confidence"],
        "createdAt": row["CreatedAt"],
    }


def delete_euphemism(euph_id: int) -> bool:
    """Defensive delete — only removes if IsEuphemism=1 so a stray DELETE here
    cannot wipe a plain dangerous word."""
    with _get_conn() as conn:
        result = conn.execute(
            "DELETE FROM DangerousWords WHERE Id = ? AND IsEuphemism = 1",
            (euph_id,),
        )
        conn.commit()
    return result.rowcount > 0


def get_euphemisms_with_embeddings() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT Id, Word, Severity, Confidence, Embedding, EmbeddingModel
               FROM DangerousWords
               WHERE IsEuphemism = 1"""
        ).fetchall()
    return [
        {
            "id": r["Id"],
            "phrase": r["Word"],
            "severity": r["Severity"],
            "confidence": r["Confidence"],
            "embedding": _decode_emb(r["Embedding"]),
            "embeddingModel": r["EmbeddingModel"],
        }
        for r in rows
    ]


def set_euphemism_embedding(euph_id: int, vec: "np.ndarray", model_name: str) -> None:
    arr = np.asarray(vec, dtype=np.float32).reshape(-1)
    with _get_conn() as conn:
        conn.execute(
            "UPDATE DangerousWords SET Embedding = ?, EmbeddingModel = ? WHERE Id = ?",
            (arr.tobytes(), model_name, euph_id),
        )
        conn.commit()


# ─── NLP: Semantic Search (Hadar) ─────────────────────────────────────────────

def get_segment_details_bulk(
    segment_ids: list[int],
    audio_id: Optional[int] = None,
    speaker_id: Optional[int] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> list[dict]:
    """Fetch full segment metadata for a list of IDs (already ranked by the caller).
    Joins Audios and Speakers. Optional filters narrow the result set.
    Output preserves the input ordering so the caller's RRF rank is maintained."""
    if not segment_ids:
        return []
    placeholders = ",".join("?" for _ in segment_ids)
    params: list = list(segment_ids)

    where = [f"sg.Id IN ({placeholders})"]
    if audio_id is not None:
        where.append("sg.AudioId = ?")
        params.append(audio_id)
    if speaker_id is not None:
        where.append("sg.SpeakerId = ?")
        params.append(speaker_id)
    if from_date:
        where.append("a.RecordedAt >= ?")
        params.append(from_date)
    if to_date:
        where.append("a.RecordedAt <= ?")
        params.append(to_date)

    with _get_conn() as conn:
        rows = conn.execute(
            f"""SELECT sg.Id, sg.AudioId, sg.SpeakerId, sg.Text, sg.StartTime, sg.EndTime,
                       a.Name AS AudioName, a.RecordedAt,
                       sp.Name AS SpeakerName, sp.Color AS SpeakerColor
                FROM Segments sg
                JOIN Audios a ON a.Id = sg.AudioId
                LEFT JOIN Speakers sp ON sp.Id = sg.SpeakerId
                WHERE {" AND ".join(where)}""",
            params,
        ).fetchall()

    row_map = {r["Id"]: r for r in rows}
    out = []
    for sid in segment_ids:
        r = row_map.get(sid)
        if r is None:
            continue
        out.append({
            "segmentId": r["Id"],
            "audioId": r["AudioId"],
            "audioName": r["AudioName"],
            "recordedAt": r["RecordedAt"],
            "speakerId": r["SpeakerId"],
            "speakerName": r["SpeakerName"] or "Unknown",
            "speakerColor": r["SpeakerColor"] or "#6366f1",
            "text": r["Text"] or "",
            "startTime": r["StartTime"],
            "endTime": r["EndTime"],
        })
    return out


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


# ─── Projects (top-level groups) ──────────────────────────────────────────────

def list_projects(user_id: Optional[int] = None, is_admin: bool = True) -> list[dict]:
    """Top-level groups. For analysts (is_admin=False, user_id given), only
    projects whose subgroup tree they have at least one assignment in."""
    visible: Optional[set[int]] = None
    if not is_admin and user_id is not None:
        visible = get_visible_group_ids(user_id)
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT g.Id, g.Name, g.Color, g.Description, g.CreatedAt,
                      (SELECT COUNT(*) FROM SpeakerGroups c WHERE c.ParentGroupId = g.Id) AS SubgroupCount,
                      (SELECT COUNT(DISTINCT sgm.SpeakerId)
                         FROM SpeakerGroupMembers sgm
                         JOIN SpeakerGroups c ON c.Id = sgm.GroupId
                         WHERE c.Id = g.Id OR c.ParentGroupId = g.Id) AS MemberCount,
                      (SELECT COUNT(DISTINCT pa.AnalystUserId)
                         FROM ProjectAssignments pa
                         JOIN SpeakerGroups c ON c.Id = pa.GroupId
                         WHERE c.Id = g.Id OR c.ParentGroupId = g.Id) AS AssignedAnalystCount
               FROM SpeakerGroups g
               WHERE g.ParentGroupId IS NULL
               ORDER BY g.CreatedAt ASC"""
        ).fetchall()
    out = []
    for r in rows:
        if visible is not None and r["Id"] not in visible:
            # Top-level group itself isn't assigned — include only if a child is.
            subgroup_ids = [c["Id"] for c in _children_of(r["Id"])]
            if not any(s in visible for s in subgroup_ids):
                continue
        out.append({
            "id": r["Id"],
            "name": r["Name"],
            "color": r["Color"],
            "description": r["Description"],
            "createdAt": r["CreatedAt"],
            "subgroupCount": r["SubgroupCount"],
            "memberCount": r["MemberCount"],
            "assignedAnalystCount": r["AssignedAnalystCount"],
        })
    return out


def _children_of(parent_group_id: int) -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT Id, Name, Color, Description, CreatedAt, ParentGroupId FROM SpeakerGroups WHERE ParentGroupId = ?",
            (parent_group_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_project_detail(project_id: int) -> Optional[dict]:
    project = get_group(project_id)
    if not project or project["parentGroupId"] is not None:
        return None
    children = [g for g in get_all_groups() if g["parentGroupId"] == project_id]
    # Attach assigned analysts per subgroup
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT pa.GroupId, u.Id AS UserId, u.Username, u.FirstName, u.LastName
               FROM ProjectAssignments pa
               JOIN Users u ON u.Id = pa.AnalystUserId
               WHERE pa.GroupId = ? OR pa.GroupId IN (
                   SELECT Id FROM SpeakerGroups WHERE ParentGroupId = ?
               )""",
            (project_id, project_id),
        ).fetchall()
    by_group: dict[int, list[dict]] = {}
    for r in rows:
        by_group.setdefault(r["GroupId"], []).append({
            "id": r["UserId"], "username": r["Username"],
            "firstName": r["FirstName"], "lastName": r["LastName"],
        })
    return {
        **project,
        "assignedAnalysts": by_group.get(project_id, []),
        "subgroups": [
            {**c, "assignedAnalysts": by_group.get(c["id"], [])} for c in children
        ],
    }


# ─── Project Assignments ──────────────────────────────────────────────────────

def list_assignments(group_id: Optional[int] = None,
                     user_id: Optional[int] = None,
                     project_id: Optional[int] = None) -> list[dict]:
    sql = """SELECT pa.Id, pa.AnalystUserId, pa.GroupId, pa.CreatedAt,
                    u.Username AS AnalystUsername, u.FirstName AS AnalystFirstName, u.LastName AS AnalystLastName,
                    g.Name AS GroupName, g.ParentGroupId,
                    p.Name AS ParentGroupName
             FROM ProjectAssignments pa
             JOIN Users u ON u.Id = pa.AnalystUserId
             JOIN SpeakerGroups g ON g.Id = pa.GroupId
             LEFT JOIN SpeakerGroups p ON p.Id = g.ParentGroupId"""
    clauses: list[str] = []
    params: list = []
    if group_id is not None:
        clauses.append("pa.GroupId = ?")
        params.append(group_id)
    if user_id is not None:
        clauses.append("pa.AnalystUserId = ?")
        params.append(user_id)
    if project_id is not None:
        clauses.append("(g.Id = ? OR g.ParentGroupId = ?)")
        params.extend([project_id, project_id])
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY pa.CreatedAt DESC"
    with _get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [
        {
            "id": r["Id"],
            "analystUserId": r["AnalystUserId"],
            "analystUsername": r["AnalystUsername"],
            "analystFirstName": r["AnalystFirstName"] or "",
            "analystLastName": r["AnalystLastName"] or "",
            "groupId": r["GroupId"],
            "groupName": r["GroupName"],
            "parentGroupId": r["ParentGroupId"],
            "parentGroupName": r["ParentGroupName"],
            "createdAt": r["CreatedAt"],
        }
        for r in rows
    ]


class AssignmentError(ValueError):
    """Raised when an assignment can't be created (admin user, missing rows, etc.)."""


def add_assignment(analyst_user_id: int, group_id: int) -> Optional[dict]:
    with _get_conn() as conn:
        user = conn.execute("SELECT Role FROM Users WHERE Id = ?", (analyst_user_id,)).fetchone()
        if not user:
            raise AssignmentError("User not found.")
        if user["Role"] != "Analyst":
            raise AssignmentError("Only Analyst users can be assigned to a project.")
        group = conn.execute("SELECT Id FROM SpeakerGroups WHERE Id = ?", (group_id,)).fetchone()
        if not group:
            raise AssignmentError("Group not found.")
        # Idempotent: respect the UNIQUE(AnalystUserId, GroupId)
        conn.execute(
            "INSERT OR IGNORE INTO ProjectAssignments (AnalystUserId, GroupId) VALUES (?, ?)",
            (analyst_user_id, group_id),
        )
        conn.commit()
    rows = list_assignments(user_id=analyst_user_id, group_id=group_id)
    return rows[0] if rows else None


def remove_assignment(assignment_id: int) -> bool:
    with _get_conn() as conn:
        result = conn.execute(
            "DELETE FROM ProjectAssignments WHERE Id = ?", (assignment_id,)
        )
        conn.commit()
    return result.rowcount > 0


def get_assignments_for_user(user_id: int) -> list[dict]:
    return list_assignments(user_id=user_id)


# ─── Visibility (project scoping) ─────────────────────────────────────────────

def get_visible_group_ids(user_id: int) -> set[int]:
    """Set of GroupIds the analyst has access to: directly-assigned groups + any
    children of assigned top-level groups."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT pa.GroupId, g.ParentGroupId
               FROM ProjectAssignments pa
               JOIN SpeakerGroups g ON g.Id = pa.GroupId
               WHERE pa.AnalystUserId = ?""",
            (user_id,),
        ).fetchall()
        assigned_ids = {r["GroupId"] for r in rows}
        top_level_assigned = {r["GroupId"] for r in rows if r["ParentGroupId"] is None}
        if not top_level_assigned:
            return assigned_ids
        placeholders = ",".join("?" * len(top_level_assigned))
        children = conn.execute(
            f"SELECT Id FROM SpeakerGroups WHERE ParentGroupId IN ({placeholders})",
            tuple(top_level_assigned),
        ).fetchall()
    return assigned_ids | {r["Id"] for r in children}


def get_visible_speaker_ids(user_id: int) -> set[int]:
    visible_groups = get_visible_group_ids(user_id)
    if not visible_groups:
        return set()
    placeholders = ",".join("?" * len(visible_groups))
    with _get_conn() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT SpeakerId FROM SpeakerGroupMembers WHERE GroupId IN ({placeholders})",
            tuple(visible_groups),
        ).fetchall()
    return {r["SpeakerId"] for r in rows}


def get_visible_audio_ids(user_id: int) -> set[int]:
    visible_speakers = get_visible_speaker_ids(user_id)
    if not visible_speakers:
        return set()
    placeholders = ",".join("?" * len(visible_speakers))
    with _get_conn() as conn:
        rows = conn.execute(
            f"""SELECT DISTINCT AudioId FROM Segments
                WHERE SpeakerId IN ({placeholders}) AND AudioId IS NOT NULL""",
            tuple(visible_speakers),
        ).fetchall()
    return {r["AudioId"] for r in rows}


def user_can_see_audio(user_id: int, is_admin: bool, audio_id: int) -> bool:
    if is_admin:
        return True
    return audio_id in get_visible_audio_ids(user_id)


def get_audios_for_user(user_id: Optional[int], is_admin: bool) -> list[dict]:
    if is_admin or user_id is None:
        return get_all_audios()
    visible = get_visible_audio_ids(user_id)
    return [a for a in get_all_audios() if a["id"] in visible]


def get_speakers_for_user(user_id: Optional[int], is_admin: bool) -> list[dict]:
    if is_admin or user_id is None:
        return get_all_speakers()
    visible = get_visible_speaker_ids(user_id)
    return [s for s in get_all_speakers() if s["id"] in visible]


def get_alerts_for_user(user_id: Optional[int], is_admin: bool,
                        category: Optional[str] = None) -> list[dict]:
    base = get_all_alerts(category=category)
    if is_admin or user_id is None:
        return base
    visible = get_visible_audio_ids(user_id)
    return [a for a in base if a.get("audioId") in visible]


# ─── User helpers (analyst list, role lookup) ─────────────────────────────────

def list_users_by_role(role: Optional[str] = None) -> list[dict]:
    sql = "SELECT Id, Username, Role, FirstName, LastName, IDNumber, CreatedAt FROM Users"
    params: tuple = ()
    if role is not None:
        sql += " WHERE Role = ?"
        params = (role,)
    sql += " ORDER BY Username"
    with _get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [
        {
            "id": r["Id"],
            "username": r["Username"],
            "role": r["Role"],
            "firstName": r["FirstName"] or "",
            "lastName": r["LastName"] or "",
            "idNumber": r["IDNumber"] or "",
            "createdAt": r["CreatedAt"],
        }
        for r in rows
    ]


def get_user_role(user_id: int) -> Optional[str]:
    with _get_conn() as conn:
        row = conn.execute("SELECT Role FROM Users WHERE Id = ?", (user_id,)).fetchone()
    return row["Role"] if row else None
