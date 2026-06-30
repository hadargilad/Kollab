"""Covers two relations gotchas in database.py:

1. merge_ghost_into_speaker's own docstring warns that a plain merge_speakers
   loses 'mentioned' relations for ghosts, since ghosts have no segments and
   the per-audio diff never sees them — this function copies those relations
   first. We guard that copy.
2. _adjust_relations_for_audio_diff aggregates InteractionCount globally
   across audios, not per-audio — reassigning a speaker within ONE audio
   must only undo that audio's contribution, leaving any contribution from
   other audios intact.
"""


def _named(db, name: str) -> int:
    speaker_id, _created = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return speaker_id


def _relation(db, a_id: int, b_id: int):
    for r in db.get_all_relations():
        ids = {r["speakerA"]["id"], r["speakerB"]["id"]}
        if ids == {a_id, b_id}:
            return r
    return None


def test_ghost_merge_preserves_mentioned_relations(db):
    ghost_id = db.create_ghost_speaker(entity_id=1, name="Ghost X")
    other_id = _named(db, "Frank")
    db.upsert_mention_relation(other_id, ghost_id)
    assert _relation(db, other_id, ghost_id)["interactionCount"] == 1

    real_id = _named(db, "Grace")
    assert db.merge_ghost_into_speaker(ghost_id, real_id) is True

    assert db.get_speaker(ghost_id) is None
    moved = _relation(db, other_id, real_id)
    assert moved is not None
    assert moved["interactionCount"] == 1
    assert moved["topic"] == "mentioned"


def test_ghost_merge_refuses_a_non_ghost_source(db):
    a_id = _named(db, "Henry")
    b_id = _named(db, "Ivy")

    assert db.merge_ghost_into_speaker(a_id, b_id) is False
    assert db.get_speaker(a_id) is not None  # nothing was merged/deleted


def test_relations_diff_only_undoes_the_reassigned_audios_contribution(db):
    a_id, b_id, c_id = _named(db, "A"), _named(db, "B"), _named(db, "C")

    audio1 = db.create_audio("audio1", "", "/tmp/audio1.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio1, "speaker_id": a_id, "text": "", "start_time": 0, "end_time": 1},
        {"audio_id": audio1, "speaker_id": b_id, "text": "", "start_time": 1, "end_time": 2},
        {"audio_id": audio1, "speaker_id": c_id, "text": "", "start_time": 2, "end_time": 3},
    ])
    db.adjust_relations_for_audio(audio1, before_speakers=set())

    audio2 = db.create_audio("audio2", "", "/tmp/audio2.wav", 100, None)
    db.insert_segments([
        {"audio_id": audio2, "speaker_id": b_id, "text": "", "start_time": 0, "end_time": 1},
        {"audio_id": audio2, "speaker_id": c_id, "text": "", "start_time": 1, "end_time": 2},
    ])
    db.adjust_relations_for_audio(audio2, before_speakers=set())

    # (A,B)=1 and (A,C)=1 from audio1 only; (B,C)=2, once from each audio.
    assert _relation(db, a_id, b_id)["interactionCount"] == 1
    assert _relation(db, a_id, c_id)["interactionCount"] == 1
    assert _relation(db, b_id, c_id)["interactionCount"] == 2

    # Reassign C -> A within audio1 only. audio1's {A,B,C} becomes {A,B}.
    db.reassign_segments_in_audio_to_existing(audio1, old_speaker_id=c_id, target_speaker_id=a_id)

    # (A,C)'s only contribution (audio1) is gone -> relation deleted.
    assert _relation(db, a_id, c_id) is None
    # (A,B) was present before and after audio1's diff -> left alone.
    assert _relation(db, a_id, b_id)["interactionCount"] == 1
    # (B,C) loses audio1's contribution but keeps audio2's -> 2 -> 1, not deleted.
    assert _relation(db, b_id, c_id)["interactionCount"] == 1
