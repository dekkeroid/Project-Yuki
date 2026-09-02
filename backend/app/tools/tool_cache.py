"""
Dedicated tool artifact cache manager for Project Yuki.
Saves heavy tool payloads (HTML canvas graphics, python scripts, large terminal logs)
into an isolated `.tool_cache` directory so that multi-turn conversation history remains
token-light (~15-token pointer) while preserving 100% exact verbatim code on disk.
"""

import os
import time
import uuid
from pathlib import Path
from typing import Optional, Tuple

from app import config

def get_tool_cache_dir() -> Path:
    """Returns the isolated .tool_cache directory under BASE_DIR."""
    base = getattr(config, "BASE_DIR", None) or Path.cwd()
    cache_dir = Path(base) / ".tool_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir

def _clean_session_id(session_id: Optional[str]) -> str:
    """Sanitize session_id for filesystem use."""
    if not session_id or session_id in ("default", "main", "active"):
        return "sess"
    # Keep alphanumeric and dashes
    import re
    cleaned = re.sub(r'[^a-zA-Z0-9_-]', '', str(session_id))
    return cleaned[:32] if cleaned else "sess"

def save_python_artifact(script_content: str) -> str:
    """
    Saves python script content to a single unique file in .tool_cache/.
    Returns the saved file path.
    """
    cache_dir = get_tool_cache_dir()
    ts = int(time.time())
    uid = uuid.uuid4().hex[:6]
    archive_name = f"python_{ts}_{uid}.py"
    archive_path = cache_dir / archive_name
    archive_path.write_text(script_content, encoding="utf-8")
    return str(archive_path.as_posix())

def save_terminal_artifact(log_content: str) -> str:
    """
    Saves large terminal logs to a single unique file in .tool_cache/.
    Returns the saved file path.
    """
    cache_dir = get_tool_cache_dir()
    ts = int(time.time())
    uid = uuid.uuid4().hex[:6]
    archive_name = f"terminal_{ts}_{uid}.log"
    archive_path = cache_dir / archive_name
    archive_path.write_text(log_content, encoding="utf-8")
    return str(archive_path.as_posix())
