# AudioIntel — Database Schema

SQLite database. Path is controlled by the `AUDIO_INTEL_DB` environment variable
(default: `~/.audio-intel/AudioIntelDB.db`, or `/data/AudioIntelDB.db` inside Docker).

---

## Tables

### `Users`

Stores system users. Passwords are salted SHA-256 hashes — plaintext is never persisted.

| Column               | Type     | Notes                                         |
|----------------------|----------|-----------------------------------------------|
| `Id`                 | INTEGER  | Primary key, auto-increment                   |
| `Username`           | TEXT     | Unique login name                             |
| `PasswordHash`       | TEXT     | Base64-encoded SHA-256(password + salt)       |
| `Salt`               | TEXT     | Base64-encoded 32-byte random salt            |
| `Role`               | TEXT     | `"Admin"` or `"Analyst"`                      |
| `FirstName`          | TEXT     | —                                             |
| `LastName`           | TEXT     | —                                             |
| `IDNumber`           | TEXT     | Unique 9-digit national ID                    |
| `ForceChangePassword`| INTEGER  | `1` = user must change password on next login |
| `CreatedAt`          | DATETIME | Auto-set on insert                            |

Default seed users (created on first run):

| Username  | Password  | Role     | ForceChangePassword |
|-----------|-----------|----------|---------------------|
| `admin`   | `Aa!12345`| Admin    | No                  |
| `analyst` | `1234`    | Analyst  | Yes                 |

---

### `Speakers`

One row per unique voice identity, whether a known person or an auto-registered unknown.
Unknown speakers get `VoiceIdentifier = "speaker_<8-hex-chars>"` assigned by the ML pipeline.

| Column            | Type     | Notes                                                          |
|-------------------|----------|----------------------------------------------------------------|
| `Id`              | INTEGER  | Primary key, auto-increment                                    |
| `VoiceIdentifier` | TEXT     | Unique key matching the ML voices DB (`speaker_XXXXXXXX` or a real name) |
| `Name`            | TEXT     | Display name shown in the UI (editable by analysts)            |
| `Color`           | TEXT     | Hex colour assigned from a rotating palette for the timeline   |
| `RiskLevel`       | TEXT     | `"low"` / `"medium"` / `"high"` (default `"low"`)             |
| `FirstDetected`   | DATETIME | Auto-set on insert                                             |

---

### `Audios`

One row per uploaded audio file.

| Column        | Type     | Notes                                                           |
|---------------|----------|-----------------------------------------------------------------|
| `Id`          | INTEGER  | Primary key, auto-increment                                     |
| `Name`        | TEXT     | Display name entered by the user at upload time                 |
| `Description` | TEXT     | Optional free-text description                                  |
| `FilePath`    | TEXT     | Absolute path to the saved audio file on disk                   |
| `Duration`    | REAL     | Total duration in seconds (filled in after ML processing)       |
| `FileSize`    | INTEGER  | File size in bytes                                              |
| `Status`      | TEXT     | `"processing"` → `"processed"` or `"failed"`                   |
| `UploadedBy`  | INTEGER  | FK → `Users(Id)`, `SET NULL` on user deletion                  |
| `UploadedAt`  | DATETIME | Auto-set on insert                                              |

---

### `Segments`

One row per spoken segment produced by Whisper + pyannote diarization.
Each segment belongs to one audio file and one speaker.

| Column      | Type    | Notes                                          |
|-------------|---------|------------------------------------------------|
| `Id`        | INTEGER | Primary key, auto-increment                    |
| `AudioId`   | INTEGER | FK → `Audios(Id)`, `CASCADE DELETE`            |
| `SpeakerId` | INTEGER | FK → `Speakers(Id)`, `SET NULL` on deletion    |
| `Text`      | TEXT    | Transcribed speech text from Whisper           |
| `StartTime` | REAL    | Segment start in seconds                       |
| `EndTime`   | REAL    | Segment end in seconds                         |

---

### `Relations`

Tracks which pairs of speakers have appeared in the same recording.
`SpeakerAId < SpeakerBId` is enforced so each pair is stored only once.

| Column            | Type     | Notes                                                  |
|-------------------|----------|--------------------------------------------------------|
| `Id`              | INTEGER  | Primary key, auto-increment                            |
| `SpeakerAId`      | INTEGER  | FK → `Speakers(Id)`, `CASCADE DELETE`; always the lower Id |
| `SpeakerBId`      | INTEGER  | FK → `Speakers(Id)`, `CASCADE DELETE`; always the higher Id |
| `InteractionCount`| INTEGER  | Incremented each time the pair appears together        |
| `Topic`           | TEXT     | Optional topic tag                                     |
| `LastContact`     | DATETIME | Updated on every new co-appearance                     |

---

### `Alerts`

System-generated alerts (e.g. keyword detection, high-risk speaker match).
Currently populated manually or by future pipeline extensions.

| Column              | Type     | Notes                                       |
|---------------------|----------|---------------------------------------------|
| `Id`                | INTEGER  | Primary key, auto-increment                 |
| `Type`              | TEXT     | `"low"` / `"medium"` / `"high"`             |
| `Message`           | TEXT     | Human-readable alert description            |
| `RelatedSpeakerId`  | INTEGER  | FK → `Speakers(Id)`, `SET NULL` on deletion |
| `RelatedAudioId`    | INTEGER  | FK → `Audios(Id)`, `SET NULL` on deletion   |
| `CreatedAt`         | DATETIME | Auto-set on insert                          |

---

## Key Relationships

```
Users ──< Audios          (one user uploads many audios)
Audios ──< Segments       (one audio has many segments)
Speakers ──< Segments     (one speaker has many segments)
Speakers ──< Relations    (many-to-many, stored as ordered pairs)
Speakers ──< Alerts
Audios ──< Alerts
```

## Speaker Identity Flow

```
Upload audio
    │
    ▼
ML pipeline (pyannote + WavLM)
    │  matches embedding against voices_db/embeddings.pkl
    │
    ├─ Match found  → voice_db_key = existing key  → is_known = true/false
    └─ No match     → new key "speaker_XXXXXXXX" saved to voices DB
    │
    ▼
Backend (api.py)
    │  uses voice_db_key as VoiceIdentifier
    │
    ├─ VoiceIdentifier exists in Speakers table → reuse row (same person across recordings)
    └─ Not found → INSERT new Speakers row
```
