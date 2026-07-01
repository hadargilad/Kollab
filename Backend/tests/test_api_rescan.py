"""Covers the rescan-all endpoints added so analysts can retroactively apply
newly-added flagged keywords / coded-language phrases to already-processed
recordings without re-uploading."""


def _make_processed_audio_with_segment(db, text: str, name: str = "clip") -> tuple[int, int]:
    audio_id = db.create_audio(name, "", f"/tmp/{name}.wav", 100, None)
    db.update_audio_result(audio_id, "processed", 5.0)
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": None,
         "text": text, "start_time": 0, "end_time": 5},
    ])
    return audio_id, db.get_segments_by_audio(audio_id)[0]["id"]


# ─── flagged-word rescan ────────────────────────────────────────────────────

def test_rescan_flagged_words_creates_alerts_for_newly_added_words(client, db):
    """The exact workflow the button exists for: an old recording, then add
    a word, then rescan → alerts show up for that word."""
    audio_id, _ = _make_processed_audio_with_segment(db, "we found a grenade near the fence")
    # Word added AFTER the audio was processed — no alert exists yet.
    client.post("/dangerous-words", json={"word": "grenade", "severity": "high", "created_by": None})
    assert db.get_alerts_for_audio(audio_id) == []

    r = client.post("/dangerous-words/rescan-all")

    assert r.status_code == 200
    body = r.json()
    assert body["audiosScanned"] == 1
    assert body["alertsCreated"] == 1
    alerts = db.get_alerts_for_audio(audio_id)
    assert len(alerts) == 1
    assert "grenade" in alerts[0]["message"]
    assert alerts[0]["category"] == "dangerous_word"


def test_rescan_flagged_words_wipes_stale_alerts_first(client, db):
    """Rescan must be idempotent — a re-run doesn't accumulate duplicates,
    and a deleted keyword's old alert doesn't linger after the rescan."""
    audio_id, _ = _make_processed_audio_with_segment(db, "we found a grenade near the fence")
    client.post("/dangerous-words", json={"word": "grenade", "severity": "high", "created_by": None})

    client.post("/dangerous-words/rescan-all")  # creates 1
    client.post("/dangerous-words/rescan-all")  # should replace, not duplicate

    alerts = db.get_alerts_for_audio(audio_id)
    assert len(alerts) == 1, f"rescan-all must be idempotent, got {len(alerts)} alerts"


def test_rescan_flagged_words_replaces_legacy_untagged_alerts(client, db):
    """Regression: alerts created before we started tagging Category on
    dangerous-word hits (Category=NULL) used to linger past rescan-all's
    category-scoped cleanup, appearing as duplicates. init_db() now backfills
    the missing category so the cleanup can find them."""
    audio_id, _ = _make_processed_audio_with_segment(db, "grenade sighted")
    # Simulate an old-format alert that the pre-fix scanner would have written.
    db.create_alert("high", f'Flagged keyword "grenade" detected in audio {audio_id}',
                    related_audio_id=audio_id, category=None)
    # Re-run init_db so the backfill fires (idempotent).
    db.init_db()
    client.post("/dangerous-words", json={"word": "grenade", "severity": "high", "created_by": None})

    client.post("/dangerous-words/rescan-all")

    alerts = db.get_alerts_for_audio(audio_id)
    assert len(alerts) == 1, f"legacy alert should be wiped and replaced, got {len(alerts)}"
    assert alerts[0]["category"] == "dangerous_word"


def test_rescan_flagged_words_skips_unprocessed_audios(client, db):
    # Not-yet-processed uploads shouldn't be scanned — they'll get their own
    # first-pass scan when analysis finishes.
    _make_processed_audio_with_segment(db, "grenade", "done")
    pending = db.create_audio("pending", "", "/tmp/pending.wav", 100, None)  # status defaults to processing
    db.insert_segments([
        {"audio_id": pending, "speaker_id": None, "text": "grenade", "start_time": 0, "end_time": 1},
    ])
    client.post("/dangerous-words", json={"word": "grenade", "severity": "high", "created_by": None})

    r = client.post("/dangerous-words/rescan-all")

    assert r.json()["audiosScanned"] == 1  # only the processed one


# ─── euphemism rescan ───────────────────────────────────────────────────────

def test_rescan_euphemisms_iterates_processed_audios(client, db, monkeypatch):
    """The scorer itself is unit-tested elsewhere; here we confirm the
    orchestration hits every processed audio exactly once and no others."""
    a1, _ = _make_processed_audio_with_segment(db, "some transcript", "a1")
    a2, _ = _make_processed_audio_with_segment(db, "another transcript", "a2")
    db.create_audio("pending", "", "/tmp/p.wav", 100, None)  # still processing → skipped

    called_with: list[int] = []
    import nlp
    monkeypatch.setattr(nlp, "score_coded_language",
                        lambda audio_id: called_with.append(audio_id), raising=False)

    r = client.post("/euphemisms/rescan-all")

    assert r.status_code == 200
    assert r.json()["audiosScanned"] == 2
    assert sorted(called_with) == sorted([a1, a2])
