"""Covers the two guards that keep the Alerts page from displaying stale
detection alerts whose audio no longer exists (they'd have no working
'Open transcript' link and read as 'detected in audio 13' where 13 is a
long-deleted recording):
1. delete_audio wipes the audio's detection-derived alerts up front.
2. init_db sweeps orphaned rows one-time (for DBs that have accumulated
   them before this fix landed)."""


def _make_processed(db, name="clip"):
    audio_id = db.create_audio(name, "", f"/tmp/{name}.wav", 100, None)
    db.update_audio_result(audio_id, "processed", 5.0)
    return audio_id


def test_delete_audio_also_deletes_its_detection_alerts(db):
    audio_id = _make_processed(db)
    a_id = db.create_alert("high", 'Flagged keyword "grenade" detected',
                           related_audio_id=audio_id, category="dangerous_word")

    assert db.delete_audio(audio_id) is True

    # No alert row should reference the deleted audio.
    assert not any(a["id"] == a_id for a in db.get_all_alerts())


def test_delete_audio_keeps_manual_alerts(db):
    """Manual/curated alerts (no category tag) aren't detection-derived and
    survive the audio deletion — they may reference the audio for historical
    context but shouldn't be swept just because the audio went away."""
    audio_id = _make_processed(db)
    a_id = db.create_alert("high", "analyst flagged suspicious speaker",
                           related_audio_id=audio_id, category=None)

    db.delete_audio(audio_id)

    assert any(a["id"] == a_id for a in db.get_all_alerts())


def test_init_db_sweeps_orphaned_detection_alerts(db):
    """One-time backfill for DBs where earlier deletes left rows behind."""
    audio_id = _make_processed(db)
    orphan_id = db.create_alert("high", 'Flagged keyword "car" detected in audio 13',
                                related_audio_id=None, category="dangerous_word")
    keep_id = db.create_alert("high", 'Flagged keyword "car" detected',
                              related_audio_id=audio_id, category="dangerous_word")

    # Rerun init — the sweep is inside it, idempotent.
    db.init_db()

    ids = {a["id"] for a in db.get_all_alerts()}
    assert orphan_id not in ids
    assert keep_id in ids