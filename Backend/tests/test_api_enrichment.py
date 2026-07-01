"""Covers the enrichment flow endpoints — search / confirm / link. The provider
is monkeypatched to a small in-memory stub so we exercise Backend logic
without hitting Wikidata. The `link` endpoint also triggers audio persistence
for both new AND reused speakers (the BUG we fixed post-cloud); this file
asserts that invariant."""

import io

import pytest

from enrichment_provider import EntityCandidate, RelatedEntity
import enrichment_providers


class _StubProvider:
    name = "stub"

    def __init__(self):
        self.candidates = {
            "Q9682": EntityCandidate("Q9682", "Charles Leclerc", "F1 driver", ""),
            "Q49946": EntityCandidate("Q49946", "Lewis Hamilton", "British racing driver", ""),
        }
        self.related_map: dict[str, list[RelatedEntity]] = {}

    def search(self, query, limit=5):
        q = query.lower()
        return [c for c in self.candidates.values() if q in c.label.lower()][:limit]

    def lookup(self, entity_id):
        return self.candidates.get(entity_id)

    def related(self, entity_id, limit=25):
        return self.related_map.get(entity_id, [])[:limit]


@pytest.fixture
def stub_provider(monkeypatch):
    stub = _StubProvider()
    monkeypatch.setattr(enrichment_providers, "provider", stub)
    return stub


def _named(db, name: str) -> int:
    sid, _ = db.get_or_create_speaker(f"voice_{name.lower()}", name)
    return sid


# ─── /enrichment/search ─────────────────────────────────────────────────────

def test_enrichment_search_returns_candidates(client, db, stub_provider):
    speaker_id = _named(db, "Ofir")
    r = client.get(f"/speakers/{speaker_id}/enrichment/search?query=Lewis")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["entityId"] == "Q49946"


def test_enrichment_search_404_for_missing_speaker(client, stub_provider):
    r = client.get("/speakers/9999/enrichment/search?query=X")
    assert r.status_code == 404


# ─── /enrichment/link ───────────────────────────────────────────────────────

def _link(client, speaker_id, entity_id="Q9682", name="Charles Leclerc",
          audio_name="", audio_bytes=b"fake"):
    files = {"file": ("clip.mp3", io.BytesIO(audio_bytes), "audio/mpeg")}
    return client.post(
        f"/speakers/{speaker_id}/enrichment/link",
        files=files if audio_bytes else None,
        data={"entityId": entity_id, "name": name, "audio_name": audio_name},
    )


def test_link_new_speaker_persists_audio_row_and_creates_relation(
    client, db, stub_provider, mock_ml
):
    source_id = _named(db, "Ofir")
    mock_ml.embed()   # for the enrollment path
    mock_ml.analyze() # for the background _run_ml_and_save

    r = _link(client, source_id, audio_name="Charles enrollment")

    assert r.status_code == 201
    body = r.json()
    assert body["reused"] is False
    new_id = body["newSpeakerId"]

    # Speaker got the wikidata id.
    assert db.get_speaker(new_id)["wikidataId"] == "Q9682"
    # A recording row was created with the analyst-provided name.
    audios = db.get_all_audios()
    matching = [a for a in audios if a["name"] == "Charles enrollment"]
    assert len(matching) == 1
    # Relation between source and new speaker with topic='wikidata'.
    relations = db.get_all_relations()
    assert any(
        {r["speakerA"]["id"], r["speakerB"]["id"]} == {source_id, new_id}
        and r["topic"] == "wikidata"
        for r in relations
    )


def test_link_reused_speaker_still_persists_audio_when_provided(
    client, db, stub_provider, mock_ml
):
    """Regression guard for the post-cloud BUG: on the "reuse existing Wikidata
    speaker" branch, the audio-persistence block was inside the else and
    silently skipped. Analysts pointed out their enrollment clip vanished.
    Both paths must persist the audio if one was supplied."""
    source_id = _named(db, "Ofir")
    existing_id = _named(db, "Charles Leclerc")
    db.set_wikidata_id(existing_id, "Q9682")
    mock_ml.analyze()

    r = _link(client, source_id, audio_name="Reused enrollment")

    assert r.status_code == 201
    body = r.json()
    assert body["reused"] is True
    assert body["newSpeakerId"] == existing_id

    audios = db.get_all_audios()
    assert any(a["name"] == "Reused enrollment" for a in audios), (
        "reused-path must still persist the enrollment audio if one is attached"
    )


def test_link_new_speaker_rejects_when_no_audio_supplied(client, db, stub_provider):
    """A new speaker without any voice embedding would break the "speakers
    always have embeddings" invariant. The endpoint must 400."""
    source_id = _named(db, "Ofir")
    r = client.post(
        f"/speakers/{source_id}/enrichment/link",
        data={"entityId": "Q9682", "name": "Charles", "audio_name": ""},
    )
    assert r.status_code == 400
