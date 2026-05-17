import os
import re
import shutil
from typing import BinaryIO, Optional

from fastapi import HTTPException, UploadFile


MAX_UPLOAD_BYTES = 500 * 1024 * 1024
MAX_ZIP_MEMBERS = 500
MAX_ZIP_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9@._\-\u4e00-\u9fff]+")


def sanitize_filename(filename: Optional[str], fallback: str = "upload") -> str:
    """Return a basename safe to place under UPLOAD_DIR."""
    name = os.path.basename(filename or fallback).strip()
    name = _SAFE_NAME_RE.sub("_", name)
    name = name.strip("._ ")
    if not name:
        name = fallback
    return name[:180]


def unique_path(directory: str, filename: str) -> str:
    """Return a non-existing path under directory, preserving extension."""
    os.makedirs(directory, exist_ok=True)
    filename = sanitize_filename(filename)
    stem, ext = os.path.splitext(filename)
    candidate = os.path.join(directory, filename)
    index = 1
    while os.path.exists(candidate):
        candidate = os.path.join(directory, f"{stem}_{index}{ext}")
        index += 1
    return candidate


def ensure_under_directory(path: str, root: str) -> str:
    """Resolve path and ensure it is still inside root."""
    root_real = os.path.realpath(root)
    path_real = os.path.realpath(path)
    if os.path.commonpath([root_real, path_real]) != root_real:
        raise HTTPException(status_code=400, detail="Unsafe file path")
    return path_real


async def save_upload_to_temp(upload: UploadFile) -> str:
    """Stream an UploadFile to a temporary file with a size limit."""
    import tempfile

    total = 0
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp_path = tmp.name
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                try:
                    os.unlink(tmp_path)
                finally:
                    raise HTTPException(status_code=413, detail="Upload too large")
            tmp.write(chunk)
    return tmp_path


def copy_stream_to_temp(src: BinaryIO, suffix: str = "") -> str:
    """Copy a binary stream to a temporary file."""
    import tempfile

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(src, tmp, length=1024 * 1024)
        return tmp.name
