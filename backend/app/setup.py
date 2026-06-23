"""
First-run setup routes.
When .yuki-ready is missing, main.py mounts ONLY this module — no heavy imports.
"""
import os
import sys
import json
import asyncio
import urllib.request
import sqlite3
import threading
import time
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
from app import config

router = APIRouter()

# ---------------------------------------------------------------------------
# Config — resolved from the same config.py base paths
# ---------------------------------------------------------------------------
if getattr(sys, 'frozen', False):
    _APP_DIR = Path(sys.executable).parent
    _INTERNAL = Path(sys.executable).parent / "_internal"
else:
    _APP_DIR = Path(__file__).resolve().parent.parent
    _INTERNAL = _APP_DIR

from dotenv import load_dotenv
load_dotenv(_APP_DIR / ".env")

BASE_DIR = _APP_DIR
PROFILE_PATH = BASE_DIR / "profile.json"
YUKI_READY = BASE_DIR / ".yuki-ready"
VOICE_DIR = _INTERNAL / "app" / "voice"
MODEL_PATH = VOICE_DIR / "kokoro-v1.0.onnx"
VOICES_PATH = VOICE_DIR / "voices-v1.0.bin"
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
LMSTUDIO_URL = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")

# ---------------------------------------------------------------------------
# Progress state (in-memory, single setup at a time)
# ---------------------------------------------------------------------------
_progress = {"step": "", "percent": 0, "done": False, "error": None, "details": []}


def _set_progress(step: str, percent: float, detail: str = ""):
    _progress["step"] = step
    _progress["percent"] = percent
    if detail:
        _progress["details"].append(detail)
        if len(_progress["details"]) > 50:
            _progress["details"] = _progress["details"][-30:]


# ---------------------------------------------------------------------------
# Setup tasks
# ---------------------------------------------------------------------------

def _download_file(url: str, dest: Path, step_name: str, base_percent: float, weight: float):
    """Download a file with progress tracking via Content-Length."""
    if dest.exists():
        _set_progress(step_name, base_percent + weight, f"{dest.name} already present")
        return

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "YukiSetup/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            total = int(resp.headers.get("Content-Length", 0)) or None
            downloaded = 0
            chunk_size = 256 * 1024

            with open(tmp, "wb") as f:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        frac = downloaded / total
                        pct = base_percent + weight * frac
                        mb = downloaded / (1024 * 1024)
                        total_mb = total / (1024 * 1024)
                        _set_progress(step_name, pct, f"{dest.name} — {mb:.1f}/{total_mb:.1f} MB")

        os.replace(tmp, dest)
        _set_progress(step_name, base_percent + weight, f"{dest.name} downloaded")
    except Exception as e:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Failed to download {dest.name}: {e}")


def _setup_tts():
    """Download TTS model files (~250MB total)."""
    _set_progress("Downloading voice model", 0.05)
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    _download_file(MODEL_URL, MODEL_PATH, "Downloading voice model", 0.05, 0.50)
    _download_file(VOICES_URL, VOICES_PATH, "Downloading voice model", 0.55, 0.05)


def _setup_profile(selected_model: str = "", llm_backend: str = "", llm_base_url: str = "", llm_api_key: str = ""):
    """Create profile.json with defaults if missing, or update model if existing."""
    _set_progress("Creating profile", 0.62)

    if PROFILE_PATH.exists():
        # Update model on existing profile if user selected one
        if selected_model:
            try:
                data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
                data.setdefault("settings", {})["llm_model"] = selected_model
                data["settings"]["no_llm_mode"] = False
                if llm_backend:
                    data["settings"]["llm_backend"] = llm_backend
                if llm_base_url:
                    data["settings"]["llm_base_url"] = llm_base_url
                if llm_api_key:
                    data["settings"]["llm_api_key"] = llm_api_key
                PROFILE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
                _set_progress("Creating profile", 0.65, f"Model set to {selected_model}")
            except Exception:
                _set_progress("Creating profile", 0.65, "Profile already exists")
        else:
            # No model selected — update no_llm_mode on existing profile
            try:
                data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
                data.setdefault("settings", {})["no_llm_mode"] = True
                if llm_backend:
                    data["settings"]["llm_backend"] = llm_backend
                if llm_base_url:
                    data["settings"]["llm_base_url"] = llm_base_url
                PROFILE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
                _set_progress("Creating profile", 0.65, "LLM mode disabled")
            except Exception:
                _set_progress("Creating profile", 0.65, "Profile already exists")
        return

    llm = selected_model if selected_model else "llama-3.2-3b-instruct"
    default = {
        "user_name": "Master",
        "user_interests": [],
        "custom_facts": {},
        "interaction_count": 0,
        "settings": {
            "llm_model": llm,
            "llm_backend": llm_backend or "lmstudio",
            "llm_base_url": llm_base_url or "",
            "llm_api_key": llm_api_key or "",
            "tts_voice": "af_sarah",
            "tts_rate": "1.0",
            "tts_device": "auto",
            "stt_device": "auto",
            "character_name": "Yuki",
            "crawler_paused": False,
            "tagger_paused": True,
            "active_vrm_model": "default.vrm",
            "whisper_model": "small",
            "whisper_compute_type": "int8_float16",
            "use_local_whisper": True,
            "stt_language": "en",
            "no_llm_mode": False if selected_model else True,
        }
    }
    PROFILE_PATH.write_text(json.dumps(default, indent=2), encoding="utf-8")
    _set_progress("Creating profile", 0.65, "Profile created")


def _setup_database():
    """Initialize SQLite schema."""
    _set_progress("Initializing database", 0.66)
    db_path = BASE_DIR / "yuki_files.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS directories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dir_path TEXT UNIQUE NOT NULL,
            last_modified REAL,
            change_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT UNIQUE NOT NULL,
            file_name TEXT NOT NULL,
            parent_folder TEXT,
            extension TEXT,
            size INTEGER,
            last_modified REAL,
            category TEXT,
            indexed_at REAL,
            transliterated_name TEXT,
            transliterated_parent_folder TEXT
        );
        CREATE TABLE IF NOT EXISTS file_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            title TEXT,
            artist_or_creator TEXT,
            genre_or_tags TEXT,
            release_year INTEGER,
            alternate_titles TEXT,
            enriched INTEGER DEFAULT 0,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS crawler_state (
            key TEXT PRIMARY KEY,
            val TEXT
        );
    """)

    # FTS5
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            file_name, parent_folder, transliterated_name,
            transliterated_parent_folder,
            title, artist_or_creator, genre_or_tags,
            content='file_metadata',
            content_rowid='id'
        )
    """)

    conn.commit()
    conn.close()
    _set_progress("Initializing database", 0.72, "Database ready")


def _verify_lmstudio():
    """Check LLM backend is reachable."""
    from app.agent.llm_backend import get_backend
    backend = get_backend()
    _set_progress(f"Verifying {backend.name}", 0.73)
    try:
        req = urllib.request.Request(
            backend.get_models_url(),
            headers={"User-Agent": "YukiSetup/1.0"}
        )
        if config.LLM_API_KEY:
            req.add_header("Authorization", f"Bearer {config.LLM_API_KEY}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            models_key = "data" if "data" in data else "models"
            models = [m.get("id", "") for m in data.get(models_key, [])]
            _set_progress(f"Verifying {backend.name}", 0.80, f"Found {len(models)} model(s): {', '.join(models[:3])}")
    except Exception as e:
        _set_progress(f"Verifying {backend.name}", 0.80, f"Warning: {backend.name} not reachable ({e}). You can start it later.")


def _create_marker():
    """Create .yuki-ready marker file."""
    _set_progress("Finalizing", 0.95)
    YUKI_READY.write_text(json.dumps({
        "version": "0.1.1-alpha",
        "setup_at": time.time(),
    }, indent=2), encoding="utf-8")
    _set_progress("Setup complete", 1.0)
    _progress["done"] = True


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class SetupStartRequest(BaseModel):
    model: Optional[str] = None
    llm_backend: Optional[str] = None
    llm_base_url: Optional[str] = None
    llm_api_key: Optional[str] = None


@router.get("/setup", response_class=HTMLResponse)
async def serve_setup_page():
    html_path = Path(__file__).parent / "setup.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


@router.get("/health")
async def health():
    return JSONResponse({"status": "ok", "setup": not YUKI_READY.exists()})


@router.get("/setup/status")
async def setup_status():
    return JSONResponse(_progress)


@router.get("/setup/models")
async def list_lmstudio_models():
    """Fetch available models from the active LLM backend."""
    from app.agent.llm_backend import get_backend
    backend = get_backend()
    try:
        models = await backend.list_models()
        return JSONResponse({
            "available": True,
            "models": [{"id": m["id"], "loaded": m.get("loaded", True)} for m in models],
            "recommended": "llama-3.2-3b-instruct",
            "backend": config.get_backend_type(),
        })
    except Exception as e:
        return JSONResponse({
            "available": False,
            "models": [],
            "recommended": "llama-3.2-3b-instruct",
            "backend": config.get_backend_type(),
            "error": str(e),
        })


@router.post("/setup/start")
async def start_setup(req: SetupStartRequest = None):
    if YUKI_READY.exists():
        _progress["done"] = True
        _progress["step"] = "Setup already complete"
        _progress["percent"] = 1.0
        return JSONResponse(_progress)

    if _progress["done"] or (_progress["step"] and _progress["percent"] < 1.0 and not _progress["error"]):
        return JSONResponse({"status": "already_running", **_progress})

    selected_model = req.model if req else ""
    llm_backend = req.llm_backend if req else ""
    llm_base_url = req.llm_base_url if req else ""
    llm_api_key = req.llm_api_key if req else ""

    # Apply backend config for the verification step
    if llm_backend:
        config.LLM_BACKEND = llm_backend
    if llm_base_url:
        config.LLM_BASE_URL = llm_base_url
    if llm_api_key:
        config.LLM_API_KEY = llm_api_key

    # Reset progress
    _progress.update({"step": "Starting...", "percent": 0, "done": False, "error": None, "details": []})

    def run():
        try:
            _setup_tts()
            _setup_profile(selected_model, llm_backend, llm_base_url, llm_api_key)
            _setup_database()
            _verify_lmstudio()
            _create_marker()
        except Exception as e:
            _progress["error"] = str(e)
            _progress["step"] = f"Error: {e}"
            _progress["done"] = True

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return JSONResponse({"status": "started", **_progress})

