"""Covers the alerts endpoints. Alerts are created by the dangerous-word
scanner and the coded-language detector during audio processing; here we
seed them directly via database.create_alert to exercise the read paths in
isolation from the ML pipeline."""


def _make_audio(db, name="clip"):
    return db.create_audio(name, "", f"/tmp/{name}.wav", 100, None)


def test_list_alerts_returns_all_categories_when_unfiltered(client, db):
    audio_id = _make_audio(db)
    db.create_alert("high", "dangerous word found", related_audio_id=audio_id)
    db.create_alert("medium", "another", related_audio_id=audio_id)

    r = client.get("/alerts")

    assert r.status_code == 200
    body = r.json()
    assert len(body) == 2


def test_list_alerts_filters_by_category(client, db):
    audio_id = _make_audio(db)
    seg_id = 1
    # First seed a real segment so the coded_language alert has a valid FK.
    db.insert_segments([
        {"audio_id": audio_id, "speaker_id": None, "text": "hi",
         "start_time": 0, "end_time": 1},
    ])
    real_seg_id = db.get_segments_by_audio(audio_id)[0]["id"]
    db.create_alert("high", "plain flagged word", related_audio_id=audio_id)
    db.create_coded_language_alert(
        "medium", "coded phrase detected",
        audio_id=audio_id, segment_id=real_seg_id,
        sub_scores={"a": 0.5, "b": 0.3, "c": 0.2},
    )

    r = client.get("/alerts?category=coded_language")

    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["message"] == "coded phrase detected"


def test_get_alerts_for_audio_scopes_to_that_audio(client, db):
    a1 = _make_audio(db, "one")
    a2 = _make_audio(db, "two")
    db.create_alert("high", "belongs to a1", related_audio_id=a1)
    db.create_alert("high", "belongs to a2", related_audio_id=a2)

    r = client.get(f"/audios/{a1}/alerts")

    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["message"] == "belongs to a1"
