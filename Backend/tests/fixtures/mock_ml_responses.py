"""Canned JSON payloads that mimic the shapes the real ML service returns.

These are what the Backend expects to see coming back from `/analyze`,
`/speakers/embed`, and `/speakers/embed-from-ranges`. Tests can drop them into
pytest-httpx's response queue instead of standing up a real ML container."""

from database import EMBEDDING_DIM


def _stub_vector(seed: float = 1.0) -> list[float]:
    """A deterministic unit-length-ish vector. Content is not physically
    meaningful — the tests only care about shape and downstream persistence,
    not similarity math (matcher.py has its own dedicated tests)."""
    return [seed] * EMBEDDING_DIM


def analyze_response(
    original_filename: str = "test.mp3",
    speakers: list[dict] | None = None,
    model_version: str = "ecapa-tdnn-v1",
) -> dict:
    """Shape of `POST /analyze`. Defaults to one speaker with one segment and
    one embedding window — the minimum a Backend can actually persist."""
    if speakers is None:
        speakers = [
            {
                "speaker_label": "SPEAKER_00",
                "embeddings": [_stub_vector(0.5)],
                "total_duration": 5.0,
                "segments": [
                    {"start": 0.0, "end": 5.0, "text": "Hello from the test fixture."},
                ],
            }
        ]
    return {
        "file": original_filename,
        "original_filename": original_filename,
        "num_speakers": len(speakers),
        "model_version": model_version,
        "speakers": speakers,
    }


def embed_response(n_windows: int = 3, model_version: str = "ecapa-tdnn-v1") -> dict:
    """Shape of `POST /speakers/embed` and `POST /speakers/embed-from-ranges`."""
    return {
        "embeddings": [_stub_vector(0.1 * (i + 1)) for i in range(n_windows)],
        "model_version": model_version,
        "sample_count": n_windows,
    }


def two_speaker_analyze() -> dict:
    """Two-speaker convo with two segments each. Handy for entities/segments tests."""
    return analyze_response(
        original_filename="two_speakers.mp3",
        speakers=[
            {
                "speaker_label": "SPEAKER_00",
                "embeddings": [_stub_vector(0.5), _stub_vector(0.6)],
                "total_duration": 8.0,
                "segments": [
                    {"start": 0.0, "end": 4.0, "text": "Ofir was here yesterday."},
                    {"start": 8.0, "end": 12.0, "text": "We saw Elad at the meeting."},
                ],
            },
            {
                "speaker_label": "SPEAKER_01",
                "embeddings": [_stub_vector(0.7), _stub_vector(0.8)],
                "total_duration": 6.0,
                "segments": [
                    {"start": 4.0, "end": 8.0, "text": "That's correct, I was there."},
                    {"start": 12.0, "end": 14.0, "text": "Yeah."},
                ],
            },
        ],
    )
