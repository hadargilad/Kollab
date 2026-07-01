"""Covers two database.py functions that CLAUDE.md and post-cloud commits
call out as easy to regress:

1. `_pick_unused_color()` — after deletes, the naive `_SPEAKER_COLORS[count %
   len]` cycle can hand a new speaker a colour that's already in use (BUG
   we fixed). This asserts the "used" set is respected before the cycle.
2. `prune_all_orphan_unknown_speakers()` — the one-shot cleanup that AUD-72
   introduced. Auto-named 'Speaker N' rows with zero segments must go;
   named speakers with zero segments must stay (they're real identities in
   the voice DB, possibly awaiting enrollment)."""

import database


def _named(db, name: str) -> int:
    sid, _ = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return sid


# ─── _pick_unused_color ──────────────────────────────────────────────────────

def test_pick_unused_color_prefers_unused_palette_entry(db):
    # Two speakers exist; the third pick must land on one of the other 8 colours,
    # not double up on the first two.
    _named(db, "Alice")
    _named(db, "Bob")

    with database._get_conn() as conn:
        used_so_far = {row[0] for row in conn.execute(
            "SELECT DISTINCT Color FROM Speakers").fetchall()}
        pick = database._pick_unused_color(conn)

    assert pick not in used_so_far


def test_pick_unused_color_still_returns_a_valid_color_after_deletes(db):
    # Regression: after deletes, `count % len` can point at an in-use colour.
    # _pick_unused_color must fall through to any still-free palette entry.
    ids = [_named(db, name) for name in ["A", "B", "C"]]
    assert db.delete_speaker(ids[1]) is True  # leaves A + C, with a gap in count

    with database._get_conn() as conn:
        used = {row[0] for row in conn.execute(
            "SELECT DISTINCT Color FROM Speakers").fetchall()}
        pick = database._pick_unused_color(conn)

    # Only unavoidable case: all 10 palette entries taken. Still 2 free here.
    assert pick in database._SPEAKER_COLORS
    assert pick not in used


# ─── prune_all_orphan_unknown_speakers ───────────────────────────────────────

def test_prune_removes_auto_named_speakers_with_no_segments(db):
    orphan_id, orphan_name = db.create_unknown_speaker()
    assert orphan_name.startswith("Speaker ")

    pruned = db.prune_all_orphan_unknown_speakers()

    assert pruned == 1
    assert db.get_speaker(orphan_id) is None


def test_prune_keeps_named_speakers_even_without_segments(db):
    """Named speakers (e.g. "Charles Leclerc" enrolled without any audio yet)
    must survive the cleanup — their name means somebody registered them
    intentionally, not that the diarizer auto-created them."""
    named_id = _named(db, "Charles Leclerc")

    pruned = db.prune_all_orphan_unknown_speakers()

    assert pruned == 0
    assert db.get_speaker(named_id) is not None


def test_prune_keeps_auto_named_speakers_that_still_have_segments(db):
    speaker_id, _ = db.create_unknown_speaker()
    audio_id = db.create_audio("clip", "", "/tmp/clip.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": speaker_id,
         "text": "hi", "start_time": 0, "end_time": 1},
    ])

    pruned = db.prune_all_orphan_unknown_speakers()

    assert pruned == 0
    assert db.get_speaker(speaker_id) is not None
