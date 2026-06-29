"""
Object storage abstraction for audio files + speaker images.

Picks one of two backends at import time:
- **R2** when R2_BUCKET / R2_ENDPOINT_URL / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
  are all set. Shared across machines. Required for cross-developer state sharing.
- **Local disk** otherwise. Files land in AUDIO_STORAGE_DIR (env) or a platformdirs
  fallback. Single-machine only.

A "handle" is the string we persist on the Audios.FilePath / Speakers.ImagePath row.
For R2 it's the key ("audios/abc.wav"); for local it's the absolute path. Callers
should treat it as opaque and round-trip through this module.
"""
import os
import shutil
from pathlib import Path
from typing import Optional

R2_BUCKET = os.getenv("R2_BUCKET")
R2_ENDPOINT_URL = os.getenv("R2_ENDPOINT_URL")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")

USE_R2 = all([R2_BUCKET, R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY])

_s3 = None
if USE_R2:
    try:
        import boto3
        from botocore.config import Config
        _s3 = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT_URL,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(signature_version="s3v4"),
        )
    except Exception:
        import logging
        logging.exception("[storage] boto3 init failed; falling back to local disk")
        USE_R2 = False
        _s3 = None

if os.getenv("AUDIO_STORAGE_DIR"):
    LOCAL_DIR = Path(os.environ["AUDIO_STORAGE_DIR"])
else:
    try:
        from platformdirs import user_data_dir
        LOCAL_DIR = Path(user_data_dir("AudioIntel")) / "uploads"
    except ImportError:
        LOCAL_DIR = Path.home() / ".audio-intel" / "uploads"

LOCAL_DIR.mkdir(parents=True, exist_ok=True)


def put_upload(upload_file, key: str) -> tuple[str, int]:
    """Stream a starlette UploadFile to storage. Returns (handle, size_bytes)."""
    if USE_R2:
        upload_file.file.seek(0)
        data = upload_file.file.read()
        size = len(data)
        _s3.put_object(Bucket=R2_BUCKET, Key=key, Body=data, ContentType=_guess_ct(key))
        return key, size
    dest = LOCAL_DIR / Path(key).name
    with dest.open("wb") as out:
        shutil.copyfileobj(upload_file.file, out)
    return str(dest), dest.stat().st_size


def put_bytes(data: bytes, key: str) -> str:
    """Write raw bytes (used for downloaded speaker images). Returns the handle."""
    if USE_R2:
        _s3.put_object(Bucket=R2_BUCKET, Key=key, Body=data, ContentType=_guess_ct(key))
        return key
    dest = LOCAL_DIR / Path(key).name
    dest.write_bytes(data)
    return str(dest)


def read_bytes(handle: str) -> Optional[bytes]:
    """Pull the full object as bytes. Used when shipping audio to the ML service."""
    if not handle:
        return None
    if USE_R2 and not _looks_like_local_path(handle):
        try:
            obj = _s3.get_object(Bucket=R2_BUCKET, Key=handle)
            return obj["Body"].read()
        except Exception:
            return None
    p = Path(handle)
    if not p.exists():
        return None
    return p.read_bytes()


def presigned_url(handle: str, expires: int = 3600) -> Optional[str]:
    """A URL the browser can hit directly. R2 only; None for local."""
    if not handle:
        return None
    if USE_R2 and not _looks_like_local_path(handle):
        try:
            return _s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": R2_BUCKET, "Key": handle},
                ExpiresIn=expires,
            )
        except Exception:
            return None
    return None


def delete(handle: str) -> bool:
    if not handle:
        return False
    if USE_R2 and not _looks_like_local_path(handle):
        try:
            _s3.delete_object(Bucket=R2_BUCKET, Key=handle)
            return True
        except Exception:
            return False
    try:
        Path(handle).unlink(missing_ok=True)
        return True
    except Exception:
        return False


def exists(handle: str) -> bool:
    if not handle:
        return False
    if USE_R2 and not _looks_like_local_path(handle):
        try:
            _s3.head_object(Bucket=R2_BUCKET, Key=handle)
            return True
        except Exception:
            return False
    return Path(handle).exists()


def _looks_like_local_path(handle: str) -> bool:
    """Legacy rows created before R2 was enabled stored an absolute path. Treat
    those as local even if R2 is now on."""
    return handle.startswith("/") or (len(handle) > 2 and handle[1:3] == ":\\")


def _guess_ct(key: str) -> str:
    ext = Path(key).suffix.lower()
    return {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")
