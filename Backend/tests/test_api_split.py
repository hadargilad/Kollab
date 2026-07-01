"""Covers POST /audios/{id}/speakers/{sid}/split — validation, ML re-extract
call, and the post-split invariant that misattributed segments now belong to
the new speaker while the source keeps a clean bucket. The ML call is mocked
so we don't need real audio to exercise the flow."""

import io
import numpy as np


def _named(db, name: str) -> int:
    sid, _ = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return sid


def _write_audio_row(db, storage_dir):
    """Backing bytes actually need to exist on disk — split_speaker calls
    storage.read_bytes() before hitting ML, and 404s if the file is gone."""
    handle = str(storage_dir / "clip.wav")
    with open(handle, "wb") as f:
        f.write(b"fake audio bytes")
    audio_id = db.create_audio("clip", "", handle, 100, None)
    return audio_id, handle


def _seed_segments(db, audio_id, speaker_id, ranges):
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": speaker_id, "text": "",
         "start_time": s, "end_time": e}
        for s, e in ranges
    ])
    return [s["id"] for s in db.get_segments_by_audio(audio_id)]


def test_split_rejects_empty_segment_ids(client, db, tmp_path, mock_ml):
    audio_id, _ = _write_audio_row(db, tmp_path / "uploads")
    speaker_id = _named(db, "Ofir")

    r = client.post(
        f"/audios/{audio_id}/speakers/{speaker_id}/split",
        json={"segment_ids": [], "new_name": ""},
    )
    assert r.status_code == 400


def test_split_rejects_segment_from_different_audio(client, db, tmp_path, mock_ml):
    aid1, _ = _write_audio_row(db, tmp_path / "uploads")
    aid2 = db.create_audio("other", "", str(tmp_path / "other.wav"), 100, None)
    (tmp_path / "other.wav").write_bytes(b"x")
    speaker_id = _named(db, "Ofir")
    seg_ids_1 = _seed_segments(db, aid1, speaker_id, [(0, 2)])
    seg_ids_2 = _seed_segments(db, aid2, speaker_id, [(0, 2)])

    r = client.post(
        f"/audios/{aid1}/speakers/{speaker_id}/split",
        json={"segment_ids": [seg_ids_2[0]], "new_name": ""},
    )
    assert r.status_code == 400


def test_split_moves_selected_segments_to_new_unknown_speaker(client, db, tmp_path, mock_ml):
    audio_id, _ = _write_audio_row(db, tmp_path / "uploads")
    source_id = _named(db, "Ofir")
    db.insert_embeddings(source_id, np.ones((1, 192), dtype=np.float32), "v1")
    seg_ids = _seed_segments(db, audio_id, source_id, [(0, 3), (3, 6), (6, 9)])

    # Two ML re-extract calls: one for moved ranges, one for remaining ranges.
    mock_ml.embed_from_ranges(n_windows=2)
    mock_ml.embed_from_ranges(n_windows=2)

    r = client.post(
        f"/audios/{audio_id}/speakers/{source_id}/split",
        json={"segment_ids": [seg_ids[0], seg_ids[1]], "new_name": ""},
    )

    assert r.status_code == 201
    new_speaker = r.json()
    assert new_speaker["id"] != source_id
    assert new_speaker["name"].startswith("Speaker ")
    # Segments repointed: the moved two belong to the new speaker, the third
    # stays with Ofir.
    segments = {s["id"]: s["speakerId"] for s in db.get_segments_by_audio(audio_id)}
    assert segments[seg_ids[0]] == new_speaker["id"]
    assert segments[seg_ids[1]] == new_speaker["id"]
    assert segments[seg_ids[2]] == source_id


def test_split_folds_source_when_all_segments_moved(client, db, tmp_path, mock_ml):
    """If every segment gets moved off the source, the source has no segments
    anywhere and is folded into the new speaker via the standard move-then-merge."""
    audio_id, _ = _write_audio_row(db, tmp_path / "uploads")
    source_id, _ = db.create_unknown_speaker()
    db.insert_embeddings(source_id, np.ones((1, 192), dtype=np.float32), "v1")
    seg_ids = _seed_segments(db, audio_id, source_id, [(0, 3), (3, 6)])

    # Only one ML call this time — remaining_ranges is empty, so the code
    # skips that fetch (see _embeddings_for_ranges early return).
    mock_ml.embed_from_ranges(n_windows=2)

    r = client.post(
        f"/audios/{audio_id}/speakers/{source_id}/split",
        json={"segment_ids": seg_ids, "new_name": "Ofir"},
    )

    assert r.status_code == 201
    new_speaker = r.json()
    assert new_speaker["name"] == "Ofir"
    assert db.get_speaker(source_id) is None  # folded away
