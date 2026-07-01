"""Covers POST /audios/upload — validation, file persistence via `storage`,
DB row creation, and the background task that hits ML `/analyze`. The ML
call is mocked so tests run offline in <2s each."""

import io


def _upload(client, filename="clip.mp3", uploaded_by=1, recorded_at="2026-01-01T10:00:00"):
    return client.post(
        "/audios/upload",
        files={"file": (filename, io.BytesIO(b"fake audio bytes"), "audio/mpeg")},
        data={
            "name": "My Clip",
            "description": "just a test",
            "uploaded_by": str(uploaded_by),
            "recorded_at": recorded_at,
        },
    )


def test_upload_rejects_blank_recorded_at(client):
    r = _upload(client, recorded_at="   ")
    assert r.status_code == 400
    assert "recorded_at" in r.json()["detail"]


def test_upload_persists_audio_row_and_stores_bytes(client, db, mock_ml):
    mock_ml.analyze()  # background task will get a canned response

    r = _upload(client, filename="hello.mp3")

    assert r.status_code == 201
    audio_id = r.json()["id"]
    row = db.get_audio(audio_id)
    assert row is not None
    assert row["name"] == "My Clip"
    # storage was pointed at tmp_path by the `db` fixture → file must exist there.
    from pathlib import Path
    assert Path(row["filePath"]).exists()
    assert Path(row["filePath"]).read_bytes() == b"fake audio bytes"


def test_upload_runs_background_analysis_and_creates_segments(client, db, mock_ml):
    mock_ml.analyze()  # default single-speaker single-segment payload

    r = _upload(client)
    audio_id = r.json()["id"]

    # TestClient runs background tasks synchronously after the response, so by
    # now the ML "call" should have persisted segments.
    segments = db.get_segments_by_audio(audio_id)
    assert len(segments) >= 1
    assert db.get_audio(audio_id)["status"] == "processed"


def test_upload_defaults_display_name_from_filename_when_name_blank(client, db, mock_ml):
    mock_ml.analyze()

    r = client.post(
        "/audios/upload",
        files={"file": ("interview_ofir.mp3", io.BytesIO(b"x"), "audio/mpeg")},
        data={
            "name": "",
            "description": "",
            "uploaded_by": "1",
            "recorded_at": "2026-01-01T10:00:00",
        },
    )

    assert r.status_code == 201
    assert db.get_audio(r.json()["id"])["name"] == "interview_ofir"
