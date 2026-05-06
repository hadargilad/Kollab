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
Unknown speakers get `VoiceIdentifier = "speaker_<8-hex-chars>"` assigned by the matcher
when no candidate clears the auto-match threshold.

| Column            | Type     | Notes                                                          |
|-------------------|----------|----------------------------------------------------------------|
| `Id`              | INTEGER  | Primary key, auto-increment                                    |
| `VoiceIdentifier` | TEXT     | Unique key (`speaker_XXXXXXXX` for unknowns, the user-given name for enrolled speakers) |
| `Name`            | TEXT     | Display name shown in the UI (editable by analysts)            |
| `Color`           | TEXT     | Hex colour assigned from a rotating palette for the timeline   |
| `RiskLevel`       | TEXT     | `"low"` / `"medium"` / `"high"` (default `"low"`)             |
| `FirstDetected`   | DATETIME | Auto-set on insert                                             |
| `WikidataId`      | TEXT     | Optional Wikidata QID (e.g. `Q9682`). Set by the "Related Speakers" wizard once the user confirms an entity match. App-level uniqueness check in `set_wikidata_id()`. Drives the Public Intelligence Enrichment feature. |

---

### `SpeakerEmbeddings`

Voice fingerprints. One row per ECAPA-TDNN sliding-window embedding (5s window, 2.5s hop).
Each speaker accumulates rows over time; a per-speaker cap keeps the most recent
50 windows so storage and matching cost stay bounded.

| Column          | Type     | Notes                                                          |
|-----------------|----------|----------------------------------------------------------------|
| `Id`            | INTEGER  | Primary key, auto-increment                                    |
| `SpeakerId`     | INTEGER  | FK → `Speakers(Id)`, **`CASCADE DELETE`** — vectors die with the speaker |
| `Vector`        | BLOB     | `np.float32` array, `Dim` floats serialized via `.tobytes()`   |
| `Dim`           | INTEGER  | Vector dimension (currently 192). Mismatched rows are skipped at load time, defending against future model swaps. |
| `ModelVersion`  | TEXT     | e.g. `"ecapa-tdnn-v1"` — lets you flush vectors from an old model later |
| `SourceAudioId` | INTEGER  | FK → `Audios(Id)`, `SET NULL`. Provenance only — which recording the vector came from |
| `EnrolledAt`    | DATETIME | Auto-set on insert; used by the cap-eviction sort              |

Indexed by `SpeakerId` for fast per-speaker lookups during the cap-trim step
and during matcher corpus loads.

---

### `SpeakerSuggestions`

Pending "you might want to confirm this" hints surfaced in the UI. Created by the
matcher when a query speaker scored 0.40–0.60 against an existing speaker — high
enough to suggest, not high enough to auto-attribute. Resolved via the
`POST /audios/{id}/suggestions/{sid}/accept` or `DELETE` endpoints.

| Column                | Type     | Notes                                                |
|-----------------------|----------|------------------------------------------------------|
| `Id`                  | INTEGER  | Primary key, auto-increment                          |
| `AudioId`             | INTEGER  | FK → `Audios(Id)`, `CASCADE DELETE`                  |
| `UnknownSpeakerId`    | INTEGER  | FK → `Speakers(Id)`, `CASCADE DELETE`. The fresh unknown holding the segments |
| `SuggestedSpeakerId`  | INTEGER  | FK → `Speakers(Id)`, `CASCADE DELETE`. The known speaker the system thinks it might be |
| `Confidence`          | REAL     | The cosine score that triggered the suggestion (0.40 ≤ x < 0.60) |
| `CreatedAt`           | DATETIME | Auto-set on insert                                   |

CASCADE on all three FKs means the row evaporates cleanly if any of the
referenced rows go away — no orphan suggestions.

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
Users ──< Audios                 (one user uploads many audios)
Audios ──< Segments              (one audio has many segments)
Audios ──< SpeakerSuggestions    (per-audio confirmation prompts)
Speakers ──< Segments            (one speaker has many segments)
Speakers ──< SpeakerEmbeddings   (one speaker has many voice fingerprints)
Speakers ──< SpeakerSuggestions  (referenced as both unknown AND suggested target)
Speakers ──< Relations           (many-to-many, stored as ordered pairs)
Speakers ──< Alerts
Audios ──< Alerts
```

## Speaker Identity Flow

The ML service is stateless — it only extracts vectors. All identity decisions
and storage live in the Backend (`Backend/matcher.py` + `SpeakerEmbeddings`).

```
Upload audio
    │
    ▼
ML /analyze        (Whisper-medium + pyannote + ECAPA-TDNN)
    │  returns per-speaker N×192 sliding-window embeddings (no matching, no storage)
    │
    ▼
Backend matcher    (per detected speaker, symmetric max-pool against the corpus)
    │
    │  best_score = max cosine across every (query_window × stored_sample) pair,
    │  excluding speakers already claimed by another diarized speaker in this recording
    │
    ├─ ≥ 0.60 (AUTO_MATCH)  → attribute segments to that speaker
    │                         if also ≥ 0.85 (LEARN) → append windows + trim to 50
    │
    ├─ 0.40 – 0.60 (SUGGEST) → create fresh "speaker_XXXXXXXX" to hold segments
    │                         + insert all windows for it
    │                         + write a SpeakerSuggestions row pointing the unknown
    │                           at the suggested known speaker (UI confirms / rejects)
    │
    └─ < 0.40 (NEW)         → create fresh "speaker_XXXXXXXX" + insert all windows
```

### Lifecycle helpers worth noting

- **Speaker delete** — `SpeakerEmbeddings` and `SpeakerSuggestions` rows
  cascade out automatically. No ML round-trip needed.
- **Speaker merge / rename collision** — `move_embeddings(source, target)` is
  called *before* `merge_speakers(source, target)` so the FK cascade on the
  source delete doesn't take the vectors with it.
- **Suggestion accept** — segments in this audio repoint from unknown → suggested
  speaker; the unknown's embeddings move to the suggested speaker (so it
  auto-matches next time); if the unknown has no segments left anywhere, the
  unknown row is folded into the suggested speaker.
