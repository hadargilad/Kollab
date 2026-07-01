"""Shared fixtures. Backend has no package layout (flat scripts importing
each other as top-level modules, e.g. `import database`), so we put Backend/
on sys.path the same way running `python api.py` from that directory would."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

import database
import storage


@pytest.fixture
def db(tmp_path, monkeypatch):
    """A fresh, empty SQLite DB per test, isolated from any real local/Turso DB.
    Also redirects `storage` to a per-test tmp directory with R2 disabled — so
    tests that hit `POST /audios/upload` write files to `tmp_path/uploads`,
    never to `/data/uploads` or the shared R2 bucket."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(database, "_USE_TURSO", False)

    uploads = tmp_path / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(storage, "USE_R2", False)
    monkeypatch.setattr(storage, "LOCAL_DIR", uploads)
    monkeypatch.setattr(storage, "_s3", None)

    database.init_db()
    return database


@pytest.fixture
def client(db):
    """TestClient against the real FastAPI app, sharing the same isolated temp
    DB as the `db` fixture. `api` is imported lazily, inside the fixture, so
    the very first import (which calls database.init_db() at module load —
    see Backend/api.py) sees the already-patched DB_PATH instead of the real
    local one. We never enter TestClient as a context manager, so the
    on_event("startup") hook (NLP model warm-up, semantic index rebuild)
    never fires — nothing under test here depends on it."""
    import api as _api
    return TestClient(_api.app)


@pytest.fixture
def mock_ml(httpx_mock):
    """Route every outgoing httpx call to canned ML responses so Backend
    endpoints that background-task through `_run_ml_and_save` or synchronously
    call `/speakers/embed-from-ranges` never touch a real ML container.

    Usage:
        def test_something(client, mock_ml):
            mock_ml.analyze(speakers=[...])         # queue an /analyze response
            mock_ml.embed(n_windows=3)              # queue an /embed response
            r = client.post("/audios/upload", ...)  # Backend calls the mock
    """
    import re
    from fixtures import mock_ml_responses

    class _Registry:
        def analyze(self, **kwargs):
            httpx_mock.add_response(
                url=re.compile(r".*/analyze$"),
                json=mock_ml_responses.analyze_response(**kwargs),
                is_optional=True,
            )

        def embed(self, **kwargs):
            httpx_mock.add_response(
                url=re.compile(r".*/speakers/embed$"),
                json=mock_ml_responses.embed_response(**kwargs),
                is_optional=True,
            )

        def embed_from_ranges(self, **kwargs):
            httpx_mock.add_response(
                url=re.compile(r".*/speakers/embed-from-ranges$"),
                json=mock_ml_responses.embed_response(**kwargs),
                is_optional=True,
            )

        def status(self, pct: int = 0, label: str = ""):
            httpx_mock.add_response(
                url=re.compile(r".*/status$"),
                json={"pct": pct, "label": label},
                is_reusable=True,
                is_optional=True,
            )

    reg = _Registry()
    # Always answer /status polling silently, even if the test forgets — the
    # background `_poll_ml_progress` loop hammers it every 3s and would
    # otherwise flood the test with "no response queued" errors.
    reg.status()
    return reg


@pytest.fixture(autouse=True)
def stub_nlp(monkeypatch):
    """Backend/api.py's _run_ml_and_save calls the NLP pipeline (embed segments,
    NER, coded-language scoring) after ML returns. Those calls load
    sentence-transformers / bert models, which is both slow (minutes) and
    can fail on transformers-version mismatches inside the container. Unit
    tests don't care — they only exercise Backend logic — so we stub them.
    Real NLP behavior gets its own dedicated tests in test_nlp_*.py."""
    import nlp
    monkeypatch.setattr(nlp, "embed_segments", lambda audio_id: None, raising=False)
    monkeypatch.setattr(nlp, "extract_and_resolve_entities", lambda audio_id: None, raising=False)
    monkeypatch.setattr(nlp, "score_coded_language", lambda audio_id: None, raising=False)


@pytest.fixture
def mock_r2(monkeypatch):
    """Flip storage into R2 mode with `moto`'s in-memory S3 mock behind it. On
    fixture exit, the mock is torn down and nothing survives to the real bucket."""
    from moto import mock_aws
    import boto3

    ctx = mock_aws()
    ctx.start()
    try:
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket="test-bucket")
        monkeypatch.setattr(storage, "USE_R2", True)
        monkeypatch.setattr(storage, "R2_BUCKET", "test-bucket")
        monkeypatch.setattr(storage, "_s3", s3)
        yield s3
    finally:
        ctx.stop()


@pytest.fixture(autouse=True, scope="session")
def assert_no_cloud_writes():
    """Session-scoped guardrail. If the process happens to have real Turso /
    R2 credentials in the environment, snapshot their state before the session
    and re-check at teardown — any drift means a test wrote past its tmp
    isolation into shared cloud state, which we refuse to let ship silently.

    In the common case (dev machine without cloud env), this is a no-op."""
    turso_url = os.getenv("TURSO_URL")
    r2_bucket = os.getenv("R2_BUCKET")
    baseline_turso: int | None = None
    baseline_r2: int | None = None

    if turso_url:
        try:
            import libsql_experimental as libsql
            conn = libsql.connect(
                "cloud_baseline.db",
                sync_url=turso_url,
                auth_token=os.getenv("TURSO_AUTH_TOKEN") or "",
            )
            conn.sync()
            baseline_turso = conn.execute("SELECT COUNT(*) FROM Audios").fetchone()[0]
        except Exception:
            # Can't snapshot → skip the guardrail rather than fail the run.
            baseline_turso = None

    if r2_bucket and os.getenv("R2_ENDPOINT_URL"):
        try:
            import boto3
            from botocore.config import Config
            client = boto3.client(
                "s3",
                endpoint_url=os.getenv("R2_ENDPOINT_URL"),
                aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
                aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
                region_name="auto",
                config=Config(signature_version="s3v4"),
            )
            listed = client.list_objects_v2(Bucket=r2_bucket)
            baseline_r2 = listed.get("KeyCount", 0)
        except Exception:
            baseline_r2 = None

    yield

    if baseline_turso is not None:
        try:
            import libsql_experimental as libsql
            conn = libsql.connect(
                "cloud_baseline.db",
                sync_url=turso_url,
                auth_token=os.getenv("TURSO_AUTH_TOKEN") or "",
            )
            conn.sync()
            after = conn.execute("SELECT COUNT(*) FROM Audios").fetchone()[0]
            assert after == baseline_turso, (
                f"Test session wrote to shared Turso Audios table "
                f"(was {baseline_turso}, now {after}). "
                "Some test bypassed the tmp_path fixture."
            )
        except AssertionError:
            raise
        except Exception:
            pass

    if baseline_r2 is not None:
        try:
            import boto3
            from botocore.config import Config
            client = boto3.client(
                "s3",
                endpoint_url=os.getenv("R2_ENDPOINT_URL"),
                aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
                aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
                region_name="auto",
                config=Config(signature_version="s3v4"),
            )
            listed = client.list_objects_v2(Bucket=r2_bucket)
            after = listed.get("KeyCount", 0)
            assert after == baseline_r2, (
                f"Test session wrote to shared R2 bucket "
                f"(was {baseline_r2}, now {after}). "
                "Some test bypassed the tmp_path fixture."
            )
        except AssertionError:
            raise
        except Exception:
            pass
