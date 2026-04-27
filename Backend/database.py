import hashlib
import base64
import os
import re
import sqlite3
from pathlib import Path
from typing import Optional

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
    return conn


def _create_salt() -> str:
    return base64.b64encode(os.urandom(32)).decode()


def _hash_password(password: str, salt: str) -> str:
    combined = (password + salt).encode("utf-8")
    return base64.b64encode(hashlib.sha256(combined).digest()).decode()


def init_db():
    with _get_conn() as conn:
        # Mark any records left in 'processing' from a previous crashed/restarted run
        conn.execute(
            "UPDATE Audios SET Status='failed' WHERE Status='processing'"
        )
        conn.commit()
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
                FirstDetected DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
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
                UploadedAt DATETIME DEFAULT CURRENT_TIMESTAMP
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
        conn.execute("PRAGMA foreign_keys = ON")
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
                 file_size: int, uploaded_by: int) -> int:
    with _get_conn() as conn:
        cursor = conn.execute(
            """INSERT INTO Audios (Name, Description, FilePath, FileSize, UploadedBy)
               VALUES (?, ?, ?, ?, ?)""",
            (name, description, file_path, file_size, uploaded_by),
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
                      a.FileSize, a.Status, a.UploadedAt,
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
        "uploadedBy": row["UploadedBy"] or "",
    }


def get_all_audios() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT a.Id, a.Name, a.Description, a.Duration, a.FileSize,
                      a.Status, a.UploadedAt,
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

def get_or_create_speaker(voice_identifier: str, name: str) -> tuple[int, bool]:
    """Return (speaker_id, created). Assigns a color from the palette automatically."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT Id FROM Speakers WHERE VoiceIdentifier = ?", (voice_identifier,)
        ).fetchone()
        if row:
            return row["Id"], False
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
            "SELECT Id, VoiceIdentifier, Name, Color, RiskLevel, FirstDetected FROM Speakers WHERE Id = ?",
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
    }


def get_all_speakers() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT s.Id, s.VoiceIdentifier, s.Name, s.Color, s.RiskLevel, s.FirstDetected,
                      COUNT(DISTINCT sg.AudioId) AS RecordingCount
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
            "recordingCount": r["RecordingCount"],
        }
        for r in rows
    ]


def reassign_speaker_in_audio(audio_id: int, old_speaker_id: int, new_name: str) -> dict | None:
    """
    Create a new speaker and re-point all segments in `audio_id` from `old_speaker_id`
    to the new one. Other recordings are untouched.
    """
    import uuid as _uuid
    new_voice_id = f"speaker_{_uuid.uuid4().hex[:8]}"
    with _get_conn() as conn:
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
