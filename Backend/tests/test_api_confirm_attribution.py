"""Covers the confirm-attribution flow — the UX gap-closer for the 0.60-0.85
match band. Auto-matches in that range don't feed the voice model until an
analyst explicitly confirms via this endpoint."""

import numpy as np


def _named(db, name: str) -> int:
    sid, _ = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return sid


def _write_audio(db, tmp_path, name="clip"):
    """Backing bytes must exist — confirm_attribution reads them before
    handing off to ML for re-extraction."""
    uploads = tmp_path / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    handle = str(uploads / f"{name}.wav")
    with open(handle, "wb") as f:
        f.write(b"fake audio bytes")
    audio_id = db.create_audio(name, "", handle, 100, None)
    return audio_id, handle


# ─── database-level ──────────────────────────────────────────────────────────

def test_upsert_attribution_stores_confidence_and_unconfirmed_by_default(db):
    speaker_id = _named(db, "Lewis")
    audio_id = db.create_audio("clip", "", "/tmp/x.wav", 100, None)

    db.upsert_attribution(audio_id, speaker_id, 0.72)

    rows = db.get_attributions_for_audio(audio_id)
    assert rows == [{"speakerId": speaker_id, "confidence": 0.72, "confirmed": False}]


def test_upsert_attribution_replaces_previous_on_reanalysis(db):
    speaker_id = _named(db, "Lewis")
    audio_id = db.create_audio("clip", "", "/tmp/x.wav", 100, None)

    db.upsert_attribution(audio_id, speaker_id, 0.72)
    db.upsert_attribution(audio_id, speaker_id, 0.88)

    rows = db.get_attributions_for_audio(audio_id)
    assert len(rows) == 1
    assert rows[0]["confidence"] == 0.88


def test_set_attribution_confirmed_flips_the_flag(db):
    speaker_id = _named(db, "Lewis")
    audio_id = db.create_audio("clip", "", "/tmp/x.wav", 100, None)
    db.upsert_attribution(audio_id, speaker_id, 0.72)

    assert db.set_attribution_confirmed(audio_id, speaker_id) is True

    rows = db.get_attributions_for_audio(audio_id)
    assert rows[0]["confirmed"] is True


# ─── API-level ───────────────────────────────────────────────────────────────

def test_get_audio_attributions_returns_populated_rows(client, db, tmp_path):
    audio_id, _ = _write_audio(db, tmp_path)
    speaker_id = _named(db, "Lewis")
    db.upsert_attribution(audio_id, speaker_id, 0.72)

    r = client.get(f"/audios/{audio_id}/attributions")

    assert r.status_code == 200
    body = r.json()
    assert body == [{"speakerId": speaker_id, "confidence": 0.72, "confirmed": False}]


def test_get_audio_attributions_404_when_audio_missing(client):
    r = client.get("/audios/9999/attributions")
    assert r.status_code == 404


def test_confirm_attribution_appends_embeddings_and_flips_flag(client, db, tmp_path, mock_ml):
    audio_id, _ = _write_audio(db, tmp_path)
    speaker_id = _named(db, "Lewis")
    # Speaker starts with one embedding vector from the original enrollment.
    db.insert_embeddings(speaker_id, np.ones((1, 192), dtype=np.float32), "v1")
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": speaker_id,
         "text": "hi", "start_time": 0, "end_time": 3},
    ])
    db.upsert_attribution(audio_id, speaker_id, 0.72)

    # ML returns 3 fresh windows for the confirmation re-extract.
    mock_ml.embed_from_ranges(n_windows=3)

    r = client.post(f"/audios/{audio_id}/speakers/{speaker_id}/confirm-attribution")

    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["added"] == 3
    # Bucket now has original 1 + newly appended 3 = 4.
    assert db.count_embeddings(speaker_id) == 4
    # Attribution row is marked confirmed.
    rows = db.get_attributions_for_audio(audio_id)
    assert rows[0]["confirmed"] is True


def test_confirm_attribution_404_when_speaker_has_no_segments_in_audio(client, db, tmp_path):
    audio_id, _ = _write_audio(db, tmp_path)
    speaker_id = _named(db, "Lewis")
    db.upsert_attribution(audio_id, speaker_id, 0.72)

    r = client.post(f"/audios/{audio_id}/speakers/{speaker_id}/confirm-attribution")

    # No segments → no ranges to re-extract → 400 with a clear reason.
    assert r.status_code == 400
