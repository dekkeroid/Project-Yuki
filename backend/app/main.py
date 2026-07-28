import base64
import time
import urllib.parse
import asyncio
import re
import sys
import logging
from pathlib import Path
import requests as http_requests
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from typing import List, Dict, Optional, Any

# Silence periodic telemetry polling logs from clogging the terminal console
class TelemetryLogFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return (
            "/api/reminders/active" not in msg and
            "/api/system/pcstat" not in msg and 
            "/api/crawler/status" not in msg and 
            "/api/speech/status" not in msg and 
            "/api/speech/transcribe" not in msg and
            "/api/mood" not in msg and
            "/api/profile" not in msg and
            "/health" not in msg and
            "/api/time" not in msg
        )

logging.getLogger("uvicorn.access").addFilter(TelemetryLogFilter())


if sys.stdout:
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr:
    sys.stderr.reconfigure(encoding='utf-8')

import builtins
_original_print = builtins.print
def unbuffered_print(*args, **kwargs):
    kwargs['flush'] = True
    _original_print(*args, **kwargs)
builtins.print = unbuffered_print

from app import config
from app.memory.local_mem import MemoryManager
from app.agent.executor import AgentExecutor

# Synchronization events for coordinated startup optimization
llm_loaded_event = asyncio.Event()
tts_warmed_up_event = asyncio.Event()

# ---------------------------------------------------------------------------
# Lifespan context manager (replaces deprecated @app.on_event)
# ---------------------------------------------------------------------------
async def _warmup_tts():
    """Background: preload or lazy-init local Kokoro TTS engine based on config."""
    global tts_online_status
    tts_preload = memory_manager.profile["settings"].get("tts_preload", getattr(config, 'TTS_PRELOAD', True))
    if not tts_preload:
        tts_online_status = True
        tts_warmed_up_event.set()
        print("[Startup] Local Kokoro neural voice engine ready (lazy — will load on first speech request).")
        return
    print("[Startup] TTS preload enabled — initializing local Kokoro-ONNX neural TTS engine...")
    try:
        from app.voice.tts import generate_speech_bytes
        audio_bytes = await asyncio.wait_for(generate_speech_bytes("hi"), timeout=60.0)
        if audio_bytes:
            print("[Startup] Local Kokoro neural voice engine preloaded successfully and active.")
            tts_online_status = True
    except asyncio.TimeoutError:
        print("[Startup] Local Kokoro neural voice engine preload timed out after 60 seconds.")
    except Exception as e:
        print(f"[Startup] Local Kokoro neural voice engine preload failed: {e}")
        tts_online_status = False
    finally:
        tts_warmed_up_event.set()


async def _connect_mcp_bridge():
    """Background: connect MCP stdio tool bridge after server is live."""
    print("[Startup] Connecting stdio MCP tool bridge...")
    # Wait for agent executor to be initialized
    for _ in range(50):
        if agent_executor is not None:
            break
        await asyncio.sleep(0.1)
    if agent_executor is None:
        print("[Startup] Agent executor not ready — skipping MCP bridge.")
        return
    mcp_ready = await agent_executor.mcp_tools.ensure_connected()
    if not mcp_ready:
        message = f"Stdio MCP tool bridge failed to start: {agent_executor.mcp_tools.last_error}"
        if config.MCP_FALLBACK_TO_LOCAL:
            print(f"[Startup] {message}. Falling back to local tool dispatcher.")
        else:
            print(f"[Startup] {message}")


async def _validate_cloud_key():
    """Background: validate cloud API key after server is live."""
    backend_type = config.get_backend_type()
    if backend_type in ("openai", "custom") and not config.LLM_API_KEY:
        print(f"[Startup] WARNING: {backend_type.title()} backend selected but no API key configured.")
    elif backend_type in ("openai", "custom") and config.LLM_API_KEY:
        try:
            from app.agent.llm_backend import get_backend
            backend = get_backend()
            models = await asyncio.wait_for(backend.list_models(), timeout=10.0)
            print(f"[Startup] API key validated. Found {len(models)} model(s) on {backend.name}.")
        except asyncio.TimeoutError:
            print(f"[Startup] WARNING: Timed out validating API key against {backend.name}.")
        except Exception as e:
            print(f"[Startup] WARNING: API key validation failed for {backend.name}: {e}.")


async def _start_crawler_bg():
    """Background: init DB and start file crawler after server is live."""
    await asyncio.sleep(120)  # 2-min grace period after startup
    print("[Startup] Initializing file crawler and indexing database...")
    try:
        from app.memory import crawler
        initial_paused = memory_manager.profile["settings"].get("crawler_paused", False)
        if initial_paused:
            crawler.pause_crawler()
        else:
            crawler.resume_crawler()

        initial_tagger_paused = memory_manager.profile["settings"].get("tagger_paused", False)
        if initial_tagger_paused:
            crawler.pause_tagger()
        else:
            crawler.resume_tagger()

        from app.memory.crawler import start_crawler_services
        start_crawler_services()
    except Exception as e:
        print(f"[Startup] Failed to start crawler services: {e}")


async def _swap_model(new_model: str, old_model: str = None, old_backend=None):
    """Unload old model and preload new model in background."""
    from app.agent.llm_backend import get_backend
    prev_model = old_model or getattr(config, "_previous_llm_model", None) or config.LLM_MODEL
    config._previous_llm_model = new_model
    if old_backend:
        print(f"[ModelSwap] Backend switched — unloading '{prev_model}' from old backend, preloading '{new_model}' on new")
        if prev_model:
            try:
                await asyncio.wait_for(old_backend.unload_model(prev_model), timeout=15)
            except Exception as e:
                print(f"[ModelSwap] Old backend unload failed (non-blocking): {e}")
        if new_model:
            try:
                backend = get_backend()
                if backend:
                    await asyncio.wait_for(backend.ensure_model_loaded(new_model), timeout=300)
            except Exception as e:
                print(f"[ModelSwap] New backend preload failed: {e}")
        return

    print(f"[ModelSwap] Swapping '{prev_model}' → '{new_model}'")
    try:
        backend = get_backend()
        if backend:
            asyncio.create_task(_do_model_swap(backend, prev_model, new_model))
    except Exception as e:
        print(f"[ModelSwap] Swap dispatch failed: {e}")


async def _do_model_swap(backend, old_model: str, new_model: str):
    """Background task: unload old + preload new."""
    import time as _time
    if backend and backend.__class__.__name__ == "OpenAICompatibleBackend":
        return
    try:
        t0 = _time.time()
        await asyncio.wait_for(backend.unload_model(old_model), timeout=15)
        elapsed = _time.time() - t0
        print(f"[ModelSwap] Unload '{old_model}' done ({elapsed:.1f}s)")
    except Exception as e:
        print(f"[ModelSwap] Unload '{old_model}' failed (non-blocking): {e}")
    try:
        t0 = _time.time()
        await asyncio.wait_for(backend.ensure_model_loaded(new_model), timeout=300)
        elapsed = _time.time() - t0
        print(f"[ModelSwap] Preload '{new_model}' done ({elapsed:.1f}s)")
    except Exception as e:
        print(f"[ModelSwap] Preload '{new_model}' failed: {e}")


async def _run_memory_optimizer_bg():
    """Background task to periodically run garbage collection and optimize process memory."""
    print("[Startup] Memory optimizer background task started.")
    # Wait for startup warmups to complete before starting the periodic loop
    try:
        await asyncio.gather(
            llm_loaded_event.wait(),
            tts_warmed_up_event.wait(),
            return_exceptions=True
        )
    except Exception:
        pass
    await asyncio.sleep(30)
    while True:
        try:
            from app.voice.stt import unload_whisper_if_idle
            unload_whisper_if_idle()
            
            from app.memory.optimizer import optimize_all_processes
            optimize_all_processes()
        except Exception as e:
            print(f"[Memory] Error in background memory optimizer: {e}")
        await asyncio.sleep(60)


async def _coordinate_startup_optimization():
    """Wait for all warmups to finish, then run a single memory cleanup sweep."""
    try:
        await asyncio.gather(
            llm_loaded_event.wait(),
            tts_warmed_up_event.wait(),
            return_exceptions=True
        )
        await asyncio.sleep(5)
        print("[Startup] Model warmups complete. Performing initial memory sweep...")
        from app.memory.optimizer import optimize_all_processes
        optimize_all_processes()
    except Exception as e:
        print(f"[Startup] Coordinated memory sweep failed: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic for the FastAPI application."""
    global tts_online_status, agent_executor

    # Set custom event loop exception handler to silence Windows Proactor connection resets
    try:
        loop = asyncio.get_running_loop()
        _original_handler = loop.get_exception_handler()
        def custom_exception_handler(loop, context):
            exception = context.get('exception')
            if isinstance(exception, ConnectionResetError) or (exception and "WinError 10054" in str(exception)):
                return
            if _original_handler:
                _original_handler(loop, context)
            else:
                loop.default_exception_handler(context)
        loop.set_exception_handler(custom_exception_handler)
    except Exception as e:
        print(f"[Startup] Failed to set custom event loop exception handler: {e}")

    # ── Startup — lightweight tasks only (server starts accepting ASAP) ──
    print("[Startup] Server is live — deferring heavy initialization to background...")

    # Ensure database schema (tables/indexes/migrations) is initialized before any tools query it
    try:
        from app.memory.db import init_db
        init_db()
        print("[Startup] SQLite database schema initialized.")
    except Exception as e:
        print(f"[Startup] Error initializing database schema: {e}")

    # Initialize agent executor in background (heavy imports: aiohttp, mcp, tools)
    async def _init_executor():
        global agent_executor
        agent_executor = AgentExecutor(memory_manager)
        print("[Startup] Agent executor initialized.")

    asyncio.create_task(_init_executor())

    # Fire-and-forget: all heavy init runs after yield (server already accepting)
    if config.TOOL_TRANSPORT == "mcp-stdio":
        asyncio.create_task(_connect_mcp_bridge())

    if not getattr(config, 'NO_LLM_MODE', False):
        backend_type = config.get_backend_type()
        print(f"[Startup] Backend: {backend_type}, model: '{config.LLM_MODEL}'")
        asyncio.create_task(_validate_cloud_key())

        async def _load_model_when_ready():
            try:
                for _ in range(100):
                    if agent_executor is not None:
                        break
                    await asyncio.sleep(0.1)
                if agent_executor is not None:
                    await agent_executor.ensure_model_loaded(config.LLM_MODEL)
            finally:
                llm_loaded_event.set()

        asyncio.create_task(_load_model_when_ready())
    else:
        print("[Startup] NO_LLM_MODE enabled — skipping LLM auto-load.")
        llm_loaded_event.set()

    asyncio.create_task(_warmup_tts())
    asyncio.create_task(_coordinate_startup_optimization())
    asyncio.create_task(_start_crawler_bg())
    asyncio.create_task(_run_memory_optimizer_bg())

    from app.tools import time_manager
    time_manager.set_due_callback(broadcast_due_reminders)
    time_manager.set_stopwatch_callback(broadcast_ws)
    time_manager.init_exact_timer_scheduler()
    time_manager.init_time_manager()
    asyncio.create_task(reminder_heartbeat_loop())

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────
    if agent_executor:
        await agent_executor.mcp_tools.aclose()


app = FastAPI(title="Yuki Desktop Assistant Backend", version="0.2.2-beta", lifespan=lifespan)

# Setup CORS — restrict to localhost and LAN origins
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize singletons for the session
memory_manager = MemoryManager()
agent_executor = None  # Initialized in lifespan to defer heavy imports

# Chat history in-memory (per session or global for a single user)
global_chat_history: List[Dict[str, str]] = []
tts_online_status = True

active_websockets: List[WebSocket] = []


def make_speech_friendly(text: str) -> str:
    if not text:
        return ""
    normalized = text.strip()
    lower = normalized.lower()

    if lower.startswith("error:") or lower.startswith("failed:"):
        if "cannot connect to host" in lower or "connect call failed" in lower:
            return "Error: Unable to connect to the backend server."
        if "timeout" in lower:
            return "Error: A timeout occurred while contacting the server."
        if "401" in lower or "unauthorized" in lower or "invalid api key" in lower:
            return "Error: Invalid API key. Please check your backend settings."
        if ":" in normalized:
            return normalized.split(":", 1)[0].strip() + "."
        return normalized

    # Replace raw IP addresses with localhost for speech clarity.
    normalized = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "localhost", normalized)
    # Strip full URLs (cloud backends like api.groq.com, api.openai.com, etc.)
    normalized = re.sub(r"https?://[^\s,;\"']+", "", normalized)
    # Remove parenthesized and bracketed details that are usually technical noise.
    normalized = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized

async def broadcast_profile_update():
    payload = {
        "type": "profile_update",
        "profile": memory_manager.profile
    }
    for ws in list(active_websockets):
        try:
            await ws.send_json(payload)
        except Exception:
            if ws in active_websockets:
                active_websockets.remove(ws)

async def broadcast_ws(payload: dict):
    for ws in list(active_websockets):
        try:
            await ws.send_json(payload)
        except Exception:
            if ws in active_websockets:
                active_websockets.remove(ws)

async def test_and_announce_voice_change(new_voice: str, new_rate: str = None):
    global tts_online_status
    try:
        from app.voice.tts import generate_speech_bytes
        test_text = f"Voice changed to {new_voice.replace('_', ' ').replace('af ', '').replace('bf ', '').replace('jf ', '').title()}."
        audio_bytes = await asyncio.wait_for(generate_speech_bytes(test_text, voice=new_voice, rate=new_rate), timeout=15.0)
        if audio_bytes:
            import base64
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
            audio_url = f"data:audio/wav;base64,{audio_base64}"
            await broadcast_ws({
                "type": "audio_chunk",
                "audio_url": audio_url,
                "index": -1,
                "text": test_text,
                "speech_text": test_text,
                "tts_backend": "kokoro",
                "tts_time_ms": 0,
                "requested_text": test_text
            })
            # Send stream_done so frontend clears speech bubble
            await broadcast_ws({
                "type": "stream_done",
                "response_time": 0
            })
            print(f"[TTS] Voice change confirmed and announced: {new_voice}")
            tts_online_status = True
        else:
            tts_online_status = False
    except Exception as e:
        print(f"[TTS] Voice change test failed for {new_voice}: {e}")
        tts_online_status = False

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "character": config.CHARACTER_NAME,
        "model": config.LLM_MODEL,
        "llm_backend": config.get_backend_type(),
        "llm_base_url": config.get_effective_base_url(),
    }

@app.get("/api/models")
async def get_available_models():
    """
    Returns the dynamically loaded list of models from the active LLM backend.
    """
    from app.agent.llm_backend import get_backend
    backend = get_backend()
    try:
        models = await backend.list_models()
        result = [{"name": m["id"], "type": config.get_backend_type()} for m in models]
        active_model = config.LLM_MODEL
        if active_model and not any(m["name"] == active_model for m in result):
            result.insert(0, {"name": active_model, "type": config.get_backend_type()})
        return {"models": result, "active": active_model}
    except Exception as e:
        print(f"[Backend] Failed to fetch models from {backend.name}: {e}. Falling back to default list.")

    fallback_models = [
        {"name": config.LLM_MODEL, "type": config.get_backend_type()},
    ]
    seen = set()
    models = []
    for m in fallback_models:
        if m["name"] not in seen:
            seen.add(m["name"])
            models.append(m)

    return {"models": models, "active": config.LLM_MODEL}

@app.get("/api/models/vrm")
def get_vrm_models():
    """
    Scans bundled (resources/models/) and custom (%APPDATA%/Yuki AI/custom_models/) VRM directories.
    """
    import os
    from app.config import BASE_DIR
    from pathlib import Path

    bundled_models = []
    custom_models = []

    # Bundled: resources/models/ (PyInstaller extraResources) or frontend/public/models/ (dev)
    for candidate in [
        BASE_DIR.parent / "models",
        BASE_DIR.parent / "frontend" / "public" / "models",
        BASE_DIR / "models",
    ]:
        if candidate.exists():
            try:
                bundled_models = sorted(
                    f for f in os.listdir(candidate) if f.lower().endswith(".vrm")
                )
            except Exception:
                pass
            if bundled_models:
                break

    # Custom: %APPDATA%/Yuki AI/custom_models/ (user uploads)
    custom_dir = Path(os.environ.get("APPDATA", "")) / "Yuki AI" / "custom_models"
    if custom_dir.exists():
        try:
            custom_models = sorted(
                f for f in os.listdir(custom_dir) if f.lower().endswith(".vrm")
            )
        except Exception:
            pass

    # Merge: default.vrm first, then bundled, then custom
    all_models = []
    for name in bundled_models + custom_models:
        if name not in all_models:
            all_models.append(name)
    if "default.vrm" in all_models:
        all_models.remove("default.vrm")
        all_models = ["default.vrm"] + all_models

    return {"models": all_models, "custom": custom_models}


@app.get("/api/models/vrm/files/{name}")
def serve_vrm_file(name: str):
    """Serve a VRM file from bundled or custom directory."""
    import os
    from app.config import BASE_DIR
    from pathlib import Path
    from fastapi.responses import FileResponse

    # Check bundled first
    for candidate in [
        BASE_DIR.parent / "models",
        BASE_DIR.parent / "frontend" / "public" / "models",
        BASE_DIR / "models",
    ]:
        fpath = candidate / name
        if fpath.exists() and fpath.suffix.lower() == ".vrm":
            return FileResponse(fpath, media_type="model/vnd+gltf.binary", filename=name)

    # Check custom uploads
    custom_dir = Path(os.environ.get("APPDATA", "")) / "Yuki AI" / "custom_models"
    fpath = custom_dir / name
    if fpath.exists() and fpath.suffix.lower() == ".vrm":
        return FileResponse(fpath, media_type="model/vnd+gltf.binary", filename=name)

    return Response(status_code=404, content="Model not found")


@app.post("/api/models/vrm/upload")
async def upload_vrm_model(file: UploadFile = File(...)):
    """Upload a custom VRM model to %APPDATA%/Yuki AI/custom_models/."""
    from pathlib import Path
    import os

    if not file.filename or not file.filename.lower().endswith(".vrm"):
        return Response(status_code=400, content="Only .vrm files are supported")

    custom_dir = Path(os.environ.get("APPDATA", "")) / "Yuki AI" / "custom_models"
    custom_dir.mkdir(parents=True, exist_ok=True)

    return {"status": "ok", "filename": file.filename}


@app.post("/api/settings/alarm-tone/upload")
async def upload_alarm_tone(file: UploadFile = File(...)):
    """Upload a custom alarm/timer audio tone file to %APPDATA%/Yuki AI/custom_tones/."""
    from pathlib import Path
    import os

    allowed_exts = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"]
    if not file.filename:
        return Response(status_code=400, content="Invalid filename")

    ext = Path(file.filename).suffix.lower()
    if ext not in allowed_exts:
        return Response(status_code=400, content=f"Unsupported format. Allowed: {', '.join(allowed_exts)}")

    tones_dir = Path(os.environ.get("APPDATA", "")) / "Yuki AI" / "custom_tones"
    tones_dir.mkdir(parents=True, exist_ok=True)

    safe_filename = file.filename.replace(" ", "_")
    dest = tones_dir / safe_filename
    content = await file.read()
    dest.write_bytes(content)

    memory_manager.update_setting("alarm_tone", "custom")
    memory_manager.update_setting("custom_alarm_tone_file", safe_filename)
    await broadcast_profile_update()

    return {"status": "ok", "filename": safe_filename}


@app.get("/api/settings/alarm-tone/file/{filename}")
def get_alarm_tone_file(filename: str):
    """Serve a custom alarm audio tone file."""
    from pathlib import Path
    from fastapi.responses import FileResponse
    import os

    tones_dir = Path(os.environ.get("APPDATA", "")) / "Yuki AI" / "custom_tones"
    target = tones_dir / filename
    if not target.exists():
        return Response(status_code=404, content="Custom tone file not found")

    return FileResponse(target)



@app.delete("/api/models/vrm/{name}")
def delete_vrm_model(name: str):
    """Delete a custom VRM model. Cannot delete bundled models."""
    from pathlib import Path
    import os

    # Prevent deleting bundled models
    from app.config import BASE_DIR
    for candidate in [
        BASE_DIR.parent / "models",
        BASE_DIR.parent / "frontend" / "public" / "models",
        BASE_DIR / "models",
    ]:
        if (candidate / name).exists():
            return Response(status_code=403, content="Cannot delete bundled model")

    custom_dir = Path(os.environ.get("APPDATA", "")) / "Yuki AI" / "custom_models"
    fpath = custom_dir / name
    if fpath.exists():
        fpath.unlink()
        return {"status": "ok", "deleted": name}

    return Response(status_code=404, content="Model not found")

class ModelSwitchRequest(BaseModel):
    model: str

@app.post("/api/model/set")
def set_active_model(req: ModelSwitchRequest):
    """
    Switches the active LLM model at runtime without restarting the server.
    """
    if not req.model or not req.model.strip():
        return Response(status_code=400, content="Model name must not be empty.")
    config.LLM_MODEL = req.model.strip()
    memory_manager.update_setting("llm_model", config.LLM_MODEL)
    return {"message": f"Active model switched to '{config.LLM_MODEL}'.", "model": config.LLM_MODEL}

@app.get("/api/settings")
def get_settings():
    """
    Returns the current configuration settings.
    """
    import copy
    from app.memory.crawler import is_crawler_paused, is_tagger_paused
    settings_dict = copy.deepcopy(memory_manager.profile.get("settings", {}))
    settings_dict.update({
        "llm_model": config.LLM_MODEL,
        "character_name": config.CHARACTER_NAME,
        "character_persona": config.CHARACTER_PERSONA,
        "crawler_paused": is_crawler_paused(),
        "tagger_paused": is_tagger_paused(),
    })
    return settings_dict

class SettingsUpdateRequest(BaseModel):
    llm_model: Optional[str] = None
    llm_backend: Optional[str] = None
    llm_base_url: Optional[str] = None
    llm_api_key: Optional[str] = None
    tts_voice: Optional[str] = None
    tts_rate: Optional[str] = None
    tts_device: Optional[str] = None
    stt_device: Optional[str] = None
    character_name: Optional[str] = None
    character_persona: Optional[str] = None
    crawler_paused: Optional[bool] = None
    tagger_paused: Optional[bool] = None
    active_vrm_model: Optional[str] = None
    whisper_model: Optional[str] = None
    whisper_compute_type: Optional[str] = None
    use_local_whisper: Optional[bool] = None
    stt_language: Optional[str] = None
    no_llm_mode: Optional[bool] = None
    dynamic_tool_calling: Optional[bool] = None
    enable_rotation: Optional[bool] = None
    auto_reset_rotation: Optional[bool] = None
    tts_preload: Optional[bool] = None
    vrm_dpr: Optional[float] = None
    vrm_fps: Optional[int] = None
    chat_mode: Optional[bool] = None
    keep_memory_saving: Optional[bool] = None
    os_native_alarms: Optional[bool] = None
    launch_on_startup: Optional[bool] = None
    always_on_top: Optional[bool] = None
    close_to_tray: Optional[bool] = None
    default_dashboard_tab: Optional[str] = None
    mute_alarm_chimes: Optional[bool] = None
    alarm_tone: Optional[str] = None
    custom_alarm_tone_file: Optional[str] = None
    llm_mode: Optional[int] = None
    enable_intent_check: Optional[bool] = None
    whisper_compute_type: Optional[str] = None
    vad_threshold: Optional[float] = None
    silence_timeout_ms: Optional[int] = None

@app.post("/api/settings/update")
async def update_settings(req: SettingsUpdateRequest):
    """
    Updates the configuration settings at runtime and saves them persistently.
    """
    global tts_online_status
    from app.memory import crawler
    from app.agent.llm_backend import get_backend

    backend_switched = False
    captured_old_backend = None
    if req.llm_backend is not None:
        old_backend_type = memory_manager.profile["settings"].get("llm_backend")
        new_backend = req.llm_backend.strip()
        if old_backend_type and old_backend_type != new_backend:
            backend_switched = True
            captured_old_backend = get_backend()
            config._previous_llm_model = None
            config._pending_old_backend = captured_old_backend
            print(f"[ModelSwap] Backend switch detected: '{old_backend_type}' → '{new_backend}'")
    if req.llm_model is not None:
        new_model = req.llm_model.strip()
        old_model = config.LLM_MODEL
        pending_old = getattr(config, "_pending_old_backend", None)
        if new_model and new_model != old_model:
            asyncio.create_task(_swap_model(new_model, old_model=old_model, old_backend=pending_old or captured_old_backend))
        config.LLM_MODEL = new_model
        memory_manager.update_setting("llm_model", new_model)
        if pending_old:
            config._pending_old_backend = None
    if req.llm_backend is not None:
        new_backend = req.llm_backend.strip()
        memory_manager.update_setting("llm_backend", new_backend)
        config.LLM_BACKEND = new_backend
        if backend_switched:
            config.LLM_MODEL = ""
            memory_manager.update_setting("llm_model", "")
            _default_urls = {
                "lmstudio": config.LMSTUDIO_URL,
                "ollama": "http://127.0.0.1:11434",
                "vllm": config.VLLM_URL,
            }
            if new_backend in _default_urls:
                config.LLM_BASE_URL = _default_urls[new_backend]
                memory_manager.update_setting("llm_base_url", _default_urls[new_backend])
            elif new_backend in ("openai", "custom"):
                config.LLM_BASE_URL = ""
                memory_manager.update_setting("llm_base_url", "")
    if req.llm_base_url is not None:
        config.LLM_BASE_URL = req.llm_base_url.strip()
        memory_manager.update_setting("llm_base_url", req.llm_base_url.strip())
    if req.llm_api_key is not None:
        memory_manager.update_setting("llm_api_key", req.llm_api_key.strip())
    if req.tts_voice is not None:
        config.TTS_VOICE = req.tts_voice.strip()
        memory_manager.update_setting("tts_voice", req.tts_voice.strip())
    if req.tts_rate is not None:
        config.TTS_RATE = req.tts_rate.strip()
        memory_manager.update_setting("tts_rate", req.tts_rate.strip())
    if req.tts_device is not None:
        device_val = req.tts_device.strip().lower()
        if device_val in ("auto", "gpu", "cpu"):
            config.TTS_DEVICE = device_val
            memory_manager.update_setting("tts_device", device_val)
            from app.voice.tts import reset_kokoro
            reset_kokoro()
    if req.stt_device is not None:
        device_val = req.stt_device.strip().lower()
        if device_val in ("auto", "gpu", "cpu"):
            config.STT_DEVICE = device_val
            memory_manager.update_setting("stt_device", device_val)
            from app.voice.stt import reset_whisper
            reset_whisper()
    if req.character_name is not None:
        config.CHARACTER_NAME = req.character_name.strip()
        memory_manager.update_setting("character_name", req.character_name.strip())
    if req.character_persona is not None:
        config.CHARACTER_PERSONA = req.character_persona.strip()
        memory_manager.update_setting("character_persona", req.character_persona.strip())
    if req.crawler_paused is not None:
        memory_manager.update_setting("crawler_paused", req.crawler_paused)
        if req.crawler_paused:
            crawler.pause_crawler()
        else:
            crawler.resume_crawler()
    if req.tagger_paused is not None:
        memory_manager.update_setting("tagger_paused", req.tagger_paused)
        if req.tagger_paused:
            crawler.pause_tagger()
        else:
            crawler.resume_tagger()
    if req.active_vrm_model is not None:
        memory_manager.update_setting("active_vrm_model", req.active_vrm_model.strip())
    if req.whisper_model is not None:
        config.WHISPER_MODEL = req.whisper_model.strip()
        memory_manager.update_setting("whisper_model", req.whisper_model.strip())
    if req.whisper_compute_type is not None:
        config.WHISPER_COMPUTE_TYPE = req.whisper_compute_type.strip()
        memory_manager.update_setting("whisper_compute_type", req.whisper_compute_type.strip())
    if req.vad_threshold is not None:
        config.SILERO_VAD_THRESHOLD = float(req.vad_threshold)
        memory_manager.update_setting("vad_threshold", float(req.vad_threshold))
    if req.silence_timeout_ms is not None:
        config.SILENCE_TIMEOUT_MS = int(req.silence_timeout_ms)
        memory_manager.update_setting("silence_timeout_ms", int(req.silence_timeout_ms))
    if req.use_local_whisper is not None:
        memory_manager.update_setting("use_local_whisper", req.use_local_whisper)
    if req.stt_language is not None:
        memory_manager.update_setting("stt_language", req.stt_language.strip())
    if req.no_llm_mode is not None:
        was_no_llm = memory_manager.profile["settings"].get("no_llm_mode", False)
        memory_manager.update_setting("no_llm_mode", req.no_llm_mode)
        if was_no_llm and not req.no_llm_mode:
            print(f"Loading LLM model '{config.LLM_MODEL}' as no_llm_mode was unchecked...")
            if agent_executor is not None:
                asyncio.create_task(agent_executor.ensure_model_loaded(config.LLM_MODEL))
    if req.dynamic_tool_calling is not None:
        memory_manager.update_setting("dynamic_tool_calling", req.dynamic_tool_calling)
    if req.llm_mode is not None:
        config.LLM_MODE = int(req.llm_mode)
        memory_manager.update_setting("llm_mode", int(req.llm_mode))
    if req.enable_intent_check is not None:
        memory_manager.update_setting("enable_intent_check", req.enable_intent_check)
    if req.enable_rotation is not None:
        memory_manager.update_setting("enable_rotation", req.enable_rotation)
    if req.auto_reset_rotation is not None:
        memory_manager.update_setting("auto_reset_rotation", req.auto_reset_rotation)
        
    if req.tts_preload is not None:
        memory_manager.update_setting("tts_preload", req.tts_preload)
    if req.vrm_dpr is not None:
        memory_manager.update_setting("vrm_dpr", req.vrm_dpr)
    if req.vrm_fps is not None:
        memory_manager.update_setting("vrm_fps", req.vrm_fps)
    if req.chat_mode is not None:
        memory_manager.update_setting("chat_mode", req.chat_mode)
    if req.keep_memory_saving is not None:
        memory_manager.update_setting("keep_memory_saving", req.keep_memory_saving)
    if req.os_native_alarms is not None:
        memory_manager.update_setting("os_native_alarms", req.os_native_alarms)
    if req.launch_on_startup is not None:
        memory_manager.update_setting("launch_on_startup", req.launch_on_startup)
    if req.always_on_top is not None:
        memory_manager.update_setting("always_on_top", req.always_on_top)
    if req.close_to_tray is not None:
        memory_manager.update_setting("close_to_tray", req.close_to_tray)
    if req.default_dashboard_tab is not None:
        memory_manager.update_setting("default_dashboard_tab", req.default_dashboard_tab.strip())
    if req.mute_alarm_chimes is not None:
        memory_manager.update_setting("mute_alarm_chimes", req.mute_alarm_chimes)
    if req.alarm_tone is not None:
        memory_manager.update_setting("alarm_tone", req.alarm_tone.strip())
    if req.custom_alarm_tone_file is not None:
        memory_manager.update_setting("custom_alarm_tone_file", req.custom_alarm_tone_file.strip())

    if req.tts_voice is not None or req.tts_rate is not None:
        tts_online_status = True
        new_voice = req.tts_voice.strip() if req.tts_voice is not None else config.TTS_VOICE
        new_rate = req.tts_rate.strip() if req.tts_rate is not None else config.TTS_RATE
        asyncio.create_task(test_and_announce_voice_change(new_voice, new_rate))
    
    await broadcast_profile_update()
    
    import copy
    current_settings = copy.deepcopy(memory_manager.profile.get("settings", {}))
    current_settings.update({
        "llm_model": config.LLM_MODEL,
        "character_name": config.CHARACTER_NAME,
        "character_persona": config.CHARACTER_PERSONA,
        "crawler_paused": crawler.is_crawler_paused(),
        "tagger_paused": crawler.is_tagger_paused(),
    })
    
    return {
        "message": "Settings updated successfully.",
        "settings": current_settings
    }


class CustomEndpointRequest(BaseModel):
    id: Optional[str] = None
    label: str
    base_url: str
    api_key: Optional[str] = ""
    llm_backend: Optional[str] = "openai"
    model: Optional[str] = ""


class DeleteCustomEndpointRequest(BaseModel):
    id: Optional[str] = None
    label: Optional[str] = None


@app.get("/api/settings/custom-endpoints")
def get_custom_endpoints():
    """Returns saved custom LLM endpoint configurations with masked API keys."""
    from app.utils.security import mask_api_key
    raw_endpoints = memory_manager.profile["settings"].get("saved_custom_endpoints", [])
    masked_list = []
    for ep in raw_endpoints:
        masked_list.append({
            "id": ep.get("id", ""),
            "label": ep.get("label", ""),
            "base_url": ep.get("base_url", ""),
            "api_key_masked": mask_api_key(ep.get("api_key", "")),
            "has_key": bool(ep.get("api_key")),
            "llm_backend": ep.get("llm_backend", "openai"),
            "model": ep.get("model", "")
        })
    return {"endpoints": masked_list}


@app.post("/api/settings/custom-endpoints/save")
async def save_custom_endpoint(req: CustomEndpointRequest):
    """Saves or updates a custom LLM endpoint configuration with encrypted API key."""
    from app.utils.security import encrypt_api_key, mask_api_key
    import uuid

    label = req.label.strip()
    base_url = req.base_url.strip()
    if not label or not base_url:
        raise HTTPException(status_code=400, detail="Label and Endpoint URL are required.")

    raw_endpoints = memory_manager.profile["settings"].get("saved_custom_endpoints", [])
    ep_id = req.id.strip() if req.id else f"ep_{uuid.uuid4().hex[:8]}"

    # Process API key with encryption
    api_key_enc = ""
    if req.api_key:
        k = req.api_key.strip()
        if "..." in k: # Masked key passed back from UI
            existing = next((e for e in raw_endpoints if e.get("id") == ep_id or e.get("label") == label), None)
            api_key_enc = existing.get("api_key", "") if existing else ""
        else:
            api_key_enc = encrypt_api_key(k)

    new_ep = {
        "id": ep_id,
        "label": label,
        "base_url": base_url,
        "api_key": api_key_enc,
        "llm_backend": req.llm_backend or "openai",
        "model": req.model.strip() if req.model else ""
    }

    updated_endpoints = []
    found = False
    for ep in raw_endpoints:
        if ep.get("id") == ep_id or ep.get("label") == label:
            updated_endpoints.append(new_ep)
            found = True
        else:
            updated_endpoints.append(ep)
    if not found:
        updated_endpoints.append(new_ep)

    memory_manager.update_setting("saved_custom_endpoints", updated_endpoints)
    await broadcast_profile_update()

    masked_list = []
    for ep in updated_endpoints:
        masked_list.append({
            "id": ep.get("id", ""),
            "label": ep.get("label", ""),
            "base_url": ep.get("base_url", ""),
            "api_key_masked": mask_api_key(ep.get("api_key", "")),
            "has_key": bool(ep.get("api_key")),
            "llm_backend": ep.get("llm_backend", "openai"),
            "model": ep.get("model", "")
        })

    return {"message": f"Saved endpoint '{label}' successfully.", "endpoints": masked_list, "saved": new_ep}


@app.post("/api/settings/custom-endpoints/delete")
async def delete_custom_endpoint(req: DeleteCustomEndpointRequest):
    """Deletes a saved custom LLM endpoint."""
    from app.utils.security import mask_api_key
    raw_endpoints = memory_manager.profile["settings"].get("saved_custom_endpoints", [])
    target_id = req.id.strip() if req.id else ""
    target_label = req.label.strip() if req.label else ""

    filtered = [ep for ep in raw_endpoints if ep.get("id") != target_id and ep.get("label") != target_label]
    memory_manager.update_setting("saved_custom_endpoints", filtered)
    await broadcast_profile_update()

    masked_list = []
    for ep in filtered:
        masked_list.append({
            "id": ep.get("id", ""),
            "label": ep.get("label", ""),
            "base_url": ep.get("base_url", ""),
            "api_key_masked": mask_api_key(ep.get("api_key", "")),
            "has_key": bool(ep.get("api_key")),
            "llm_backend": ep.get("llm_backend", "openai"),
            "model": ep.get("model", "")
        })

    return {"message": "Endpoint deleted.", "endpoints": masked_list}


@app.post("/api/settings/custom-endpoints/select")
async def select_custom_endpoint(req: DeleteCustomEndpointRequest):
    """Selects and activates a saved custom endpoint."""
    from app.utils.security import decrypt_api_key, mask_api_key
    from app.agent.llm_backend import reset_backend

    raw_endpoints = memory_manager.profile["settings"].get("saved_custom_endpoints", [])
    target_id = req.id.strip() if req.id else ""
    target_label = req.label.strip() if req.label else ""

    ep = next((e for e in raw_endpoints if e.get("id") == target_id or e.get("label") == target_label), None)
    if not ep:
        raise HTTPException(status_code=404, detail="Saved endpoint not found.")

    decrypted_key = decrypt_api_key(ep.get("api_key", ""))
    config.LLM_BACKEND = ep.get("llm_backend", "openai")
    config.LLM_BASE_URL = ep.get("base_url", "")
    config.LLM_API_KEY = decrypted_key
    if ep.get("model"):
        config.LLM_MODEL = ep.get("model")
        memory_manager.update_setting("llm_model", ep.get("model"))

    memory_manager.update_setting("llm_backend", config.LLM_BACKEND)
    memory_manager.update_setting("llm_base_url", config.LLM_BASE_URL)
    memory_manager.update_setting("llm_api_key", ep.get("api_key", ""))
    reset_backend()

    await broadcast_profile_update()
    return {
        "message": f"Activated custom endpoint '{ep.get('label')}'",
        "active_endpoint": ep,
        "backend": config.LLM_BACKEND,
        "base_url": config.LLM_BASE_URL,
        "model": config.LLM_MODEL
    }

@app.get("/api/tts")
async def tts_endpoint(text: str, voice: Optional[str] = None, rate: Optional[str] = None):
    """
    Generates WAV audio for the given text and streams it back.
    The frontend can play this directly by setting an Audio src.
    """
    if not text:
        return Response(status_code=400, content="Text query parameter is required.")
    
    if not tts_online_status:
        return Response(status_code=500, content="TTS service is currently offline.")
        
    decoded_text = urllib.parse.unquote(text)
    from app.voice.tts import generate_speech_bytes
    audio_bytes = await generate_speech_bytes(decoded_text, voice=voice, rate=rate)
    
    if not audio_bytes:
        return Response(status_code=500, content="Failed to generate speech audio.")
        
    return Response(content=audio_bytes, media_type="audio/wav")

@app.post("/api/tts/test")
async def tts_test_endpoint(req: SettingsUpdateRequest):
    """
    Tests TTS with a specific voice/rate without saving settings.
    """
    global tts_online_status
    if not tts_online_status:
        return Response(status_code=500, content="TTS service is currently offline.")
    
    test_voice = req.tts_voice or config.TTS_VOICE
    test_rate = req.tts_rate or config.TTS_RATE
    test_text = f"Testing voice {test_voice.replace('_', ' ').replace('af ', '').replace('bf ', '').replace('jf ', '').title()}."
    
    try:
        from app.voice.tts import generate_speech_bytes
        audio_bytes = await asyncio.wait_for(generate_speech_bytes(test_text, voice=test_voice, rate=test_rate), timeout=15.0)
        if not audio_bytes:
            return Response(status_code=500, content="Failed to generate speech audio.")
        return Response(content=audio_bytes, media_type="audio/wav")
    except Exception as e:
        return Response(status_code=500, content=f"TTS test failed: {e}")

@app.post("/api/speech/transcribe")
async def transcribe_endpoint(file: UploadFile = File(...), model: Optional[str] = None):
    """
    Receives an audio blob, writes it to a temp file, transcribes it using local faster-whisper, 
    and returns the transcribed text.
    """
    import tempfile
    import os
    import uuid
    from app.voice.stt import transcribe_audio_file
    
    saved_model = memory_manager.profile["settings"].get("whisper_model")
    active_model = saved_model or getattr(config, "WHISPER_MODEL", None) or model or "base"
    active_lang = memory_manager.profile["settings"].get("stt_language", "en")
    active_compute = memory_manager.profile["settings"].get("whisper_compute_type", "int8_float16")
    
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, f"yuki_voice_{uuid.uuid4().hex}.webm")
    
    try:
        content = await file.read()
        if not content or len(content) < 4000:
            return {"text": ""}

        with open(temp_path, "wb") as f:
            f.write(content)
            
        transcript = await transcribe_audio_file(
            temp_path, 
            model_size=active_model, 
            compute_type=active_compute, 
            language=active_lang
        )
        if transcript and transcript.strip():
            print(f"[STT] Transcribed ({len(content)} bytes) using model '{active_model}' ({active_compute}) -> '{transcript}'")
        return {"text": transcript or ""}
    except Exception as e:
        print(f"[STT] Audio file transcription skipped: {e}")
        return {"text": ""}
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
        return Response(status_code=500, content=f"Transcription failed: {e}")
    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

@app.post("/api/speech/status")
async def speech_status(req: dict):
    msg = req.get("message", "")
    print(f"[STT Frontend] {msg}")
    return {"status": "ok"}

@app.get("/api/tools")
async def get_tools_list():
    """
    Returns all dynamically registered local and MCP tool definitions for Yuki,
    including name, description, parameters schema, and category.
    """
    if agent_executor is None:
        return {"tools": [], "count": 0}
    
    tools = await agent_executor.mcp_tools.get_tool_definitions("", dynamic=False)
    
    formatted = []
    for t in tools:
        fn = t.get("function", {})
        name = fn.get("name", "")
        desc = fn.get("description", "")
        params = fn.get("parameters", {})
        
        # Categorize tools cleanly
        category = "System & OS"
        if name in ("update_user_fact",):
            category = "Memory & User Facts"
        elif name in ("web_search", "read_file_content", "search_files", "list_directory"):
            category = "Information & Search"
        elif name in ("launch_app", "open_or_play_file", "media_playback_control", "set_system_volume"):
            category = "Media & Applications"
        elif name in ("run_terminal_command", "run_python_script", "create_file", "edit_file", "delete_file"):
            category = "Terminal & Filesystem"
            
        formatted.append({
            "name": name,
            "description": desc,
            "parameters": params.get("properties", {}),
            "required_parameters": params.get("required", []),
            "category": category
        })
        
    return {
        "tools": formatted,
        "count": len(formatted)
    }

async def broadcast_due_reminders(due: List[Dict[str, Any]]):
    """
    Broadcasts speech announcements and alarm_triggered WebSocket events
    for active alarm ringing overlays.
    """
    if due and active_websockets:
        for item in due:
            msg = item.get("message") or "Your scheduled reminder is due!"
            announcement = f"Attention: {msg}"
            for ws in list(active_websockets):
                try:
                    await ws.send_json({
                        "type": "speech",
                        "text": announcement
                    })
                    await ws.send_json({
                        "type": "alarm_triggered",
                        "id": item["id"],
                        "category": item.get("category", "timer"),
                        "message": msg
                    })
                    print(f"[WebSocket] Broadcasted alarm_triggered for timer #{item['id']}: '{msg}'")
                except Exception as e:
                    print(f"[WebSocket] Error broadcasting due reminder: {e}")

async def reminder_heartbeat_loop():
    """
    Background heartbeat running every 1 second.
    Kept for future use if needed, but time_manager now handles timer triggers natively via asyncio.
    """
    while True:
        await asyncio.sleep(1)

@app.get("/api/reminders/active")
def get_active_reminders():
    """
    Returns active timers, scheduled reminders, and stopwatches.
    """
    from app.tools import time_manager
    return time_manager.get_active_time_items()

class ReminderCancelRequest(BaseModel):
    id: int

@app.post("/api/reminders/cancel")
def cancel_reminder(req: ReminderCancelRequest):
    """
    Cancels a reminder or timer by ID.
    """
    from app.tools import time_manager
    time_manager.delete_reminder(req.id)
    return {"status": "ok", "message": f"Cancelled reminder #{req.id}"}

class ReminderEditRequest(BaseModel):
    id: int
    message: str

@app.post("/api/reminders/edit")
def edit_reminder(req: ReminderEditRequest):
    """
    Edits the message of a reminder or timer by ID.
    """
    from app.tools import time_manager
    time_manager.edit_reminder(req.id, req.message)
    return {"status": "ok", "message": f"Updated reminder #{req.id}"}

class SnoozeRequest(BaseModel):
    id: int
    minutes: Optional[int] = 5

@app.post("/api/reminders/snooze")
def snooze_reminder(req: SnoozeRequest):
    """
    Snoozes an active alarm or timer for 5 minutes.
    """
    from app.tools import time_manager
    res = time_manager.snooze_reminder(req.id, req.minutes or 5)
    return {"status": "ok", "snooze": res}

class CreateTimerRequest(BaseModel):
    message: str
    duration_str: str

@app.post("/api/reminders/create_timer")
def create_timer(req: CreateTimerRequest):
    """
    Creates a new timer directly from the Tasks UI.
    """
    from app.tools import time_manager
    dur = time_manager.parse_duration_seconds(req.duration_str)
    res = time_manager.add_timer(dur, req.message or "Timer Up!")
    return {"status": "ok", "timer": res}

class CreateDatetimeAlarmRequest(BaseModel):
    date_str: str
    time_str: str
    message: Optional[str] = "Alarm!"

@app.post("/api/reminders/create_datetime_alarm")
def create_datetime_alarm(req: CreateDatetimeAlarmRequest):
    """
    Creates a new alarm for a specific date and time from the Tasks UI.
    """
    from app.tools import time_manager
    res = time_manager.add_datetime_alarm(req.date_str, req.time_str, req.message or "Alarm!")
    return {"status": "ok", "alarm": res}

class StopwatchRequest(BaseModel):
    label: str

@app.post("/api/reminders/stopwatch/start")
def start_stopwatch(req: StopwatchRequest):
    """
    Starts or resumes a stopwatch directly from the Tasks UI.
    """
    from app.tools import time_manager
    res = time_manager.start_stopwatch(req.label or "default")
    return {"status": "ok", "stopwatch": res}

@app.post("/api/reminders/stopwatch/stop")
def stop_stopwatch(req: StopwatchRequest):
    """
    Stops/pauses a stopwatch directly from the Tasks UI.
    """
    from app.tools import time_manager
    res = time_manager.stop_stopwatch(req.label or "default")
    return {"status": "ok", "stopwatch": res}

@app.post("/api/reminders/stopwatch/delete")
def delete_stopwatch(req: StopwatchRequest):
    """
    Deletes a stopwatch directly from the Tasks UI.
    """
    from app.tools import time_manager
    time_manager.delete_stopwatch(req.label or "default")
    return {"status": "ok", "message": f"Deleted stopwatch '{req.label}'"}

@app.get("/api/mood")
def get_mood_spectrum():
    """
    Returns current internal mood spectrum.
    """
    return memory_manager.get_mood_spectrum()

class MoodUpdateRequest(BaseModel):
    updates: Dict[str, int]

@app.post("/api/mood/update")
def update_mood_spectrum(req: MoodUpdateRequest):
    """
    Updates mood spectrum values from UI sliders.
    """
    updated = memory_manager.update_mood_spectrum(req.updates)
    return {"status": "ok", "mood": updated}

@app.post("/api/mood/reset")
def reset_mood_spectrum():
    """
    Resets mood spectrum to baseline values.
    """
    reset_vals = memory_manager.reset_mood_spectrum()
    return {"status": "ok", "mood": reset_vals}

@app.get("/api/profile")
def get_profile():
    """
    Returns the current user profile state (API key redacted).
    """
    import copy
    profile = copy.deepcopy(memory_manager.profile)
    if "settings" in profile and "llm_api_key" in profile["settings"]:
        key = profile["settings"]["llm_api_key"]
        if key:
            profile["settings"]["llm_api_key"] = key[:4] + "..." + key[-4:] if len(key) > 8 else "****"
        else:
            profile["settings"]["llm_api_key"] = ""
    return profile

class ProfileUpdateRequest(BaseModel):
    user_name: Optional[str] = None
    user_interests: Optional[List[str]] = None
    user_hobbies: Optional[List[str]] = None
    user_likes: Optional[List[str]] = None
    user_dislikes: Optional[List[str]] = None
    custom_facts: Optional[Dict[str, str]] = None

@app.post("/api/profile/update")
async def update_profile(req: ProfileUpdateRequest):
    """
    Updates user profile details at runtime.
    """
    if req.user_name is not None:
        memory_manager.set_user_name(req.user_name.strip())
    if req.user_interests is not None:
        memory_manager.set_user_interests(req.user_interests)
    if req.user_hobbies is not None:
        memory_manager.profile["user_hobbies"] = req.user_hobbies
        memory_manager._save_profile()
    if req.user_likes is not None:
        memory_manager.profile["user_likes"] = req.user_likes
        memory_manager._save_profile()
    if req.user_dislikes is not None:
        memory_manager.profile["user_dislikes"] = req.user_dislikes
        memory_manager._save_profile()
    if req.custom_facts is not None:
        memory_manager.set_custom_facts(req.custom_facts)
        
    await broadcast_profile_update()
    
    return {
        "message": "Profile updated successfully.",
        "profile": memory_manager.profile
    }

@app.post("/api/profile/reset")
async def reset_profile():
    """
    Resets the user profile.
    """
    global global_chat_history
    global_chat_history.clear()
    
    default_profile = {
        "user_name": "Master",
        "user_interests": [],
        "custom_facts": {},
        "interaction_count": 0,
        "settings": {
            # [SEARCH FOR MODEL CHANGE] Old: "llm_model": "ministra-3",
            "llm_model": "llama-3.2-3b-instruct",
            "llm_backend": "lmstudio",
            "llm_base_url": "",
            "llm_api_key": "",
            "tts_voice": "bf_isabella",
            "tts_rate": "1.0",
            "tts_device": "auto",
            "stt_device": "auto",
            "character_name": "Yuki",
            "character_persona": """You are Yuki, a brilliant, highly intelligent agentic 3D companion. 
You live on the user's desktop, and you have the ability to run tools to help them control their system, look up information, and remember their preferences.

Personality characteristics:
- Modest, gentle, intelligent, and slightly introverted.
- Speaks calmly, politely, and warmly like a real human.
- Speaks minimally and directly. Avoids verbose explanations.
- Avoids overly energetic or exaggerated anime expressions, preferring quiet, helpful companionship.

Strict constraints:
1. Speak like a real human: respond ONLY with what is asked or the direct tool output results.
2. Absolutely NEVER end responses with generic AI assistant fluff like "Is there anything else I can do?", "Let me know if you need help with anything else", or suggest other tasks. Answer directly and stop.
3. Keep spoken responses extremely concise (usually 1-2 short sentences maximum). Avoid preambles, postambles, and chat filler.
4. Avoid using markdown lists or complex formatting.
5. You can execute tools autonomously to find answers or perform actions.
""",
            "crawler_paused": False,
            "tagger_paused": True,
            "active_vrm_model": "default.vrm",
            "whisper_model": "small",
            "whisper_compute_type": "int8_float16",
            "use_local_whisper": True,
            "stt_language": "en",
            "no_llm_mode": False,
            "dynamic_tool_calling": True,
            "enable_rotation": True,
            "auto_reset_rotation": False
        }
    }
    # Reset config variables to defaults as well
    config.LLM_MODEL = default_profile["settings"]["llm_model"]
    config.LLM_BACKEND = default_profile["settings"]["llm_backend"]
    config.LLM_BASE_URL = default_profile["settings"]["llm_base_url"]
    config.LLM_API_KEY = default_profile["settings"]["llm_api_key"]
    config.TTS_VOICE = default_profile["settings"]["tts_voice"]
    config.TTS_RATE = default_profile["settings"]["tts_rate"]
    config.TTS_DEVICE = default_profile["settings"]["tts_device"]
    config.STT_DEVICE = default_profile["settings"]["stt_device"]
    config.CHARACTER_NAME = default_profile["settings"]["character_name"]
    config.CHARACTER_PERSONA = default_profile["settings"]["character_persona"]
    
    # Reset TTS/STT engines with new device settings
    from app.voice.tts import reset_kokoro
    from app.voice.stt import reset_whisper
    reset_kokoro()
    reset_whisper()
    
    memory_manager.profile = default_profile
    memory_manager._save_profile()
    
    await broadcast_profile_update()
    
    return {"message": "Memory profile and chat history reset successfully."}

@app.get("/api/system/pcstat")
def get_pc_stats():
    """
    Returns comprehensive system performance statistics.
    """
    try:
        from app.tools.system import get_detailed_stats
        return get_detailed_stats()
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/system/gpumem")
def get_gpu_memory():
    """
    Returns per-process VRAM usage for all GPUs (iGPU + dGPU).
    Top 5 processes by dedicated VRAM per GPU.
    """
    from app.gpu_monitor import get_gpu_memory_usage
    try:
        return get_gpu_memory_usage()
    except Exception as e:
        return {"gpus": [], "top5": {}, "error": str(e)}


@app.post("/api/system/optimize_memory")
def optimize_memory_endpoint():
    """
    Manually triggers process memory optimization.
    Called when the app is hidden or minimized to reclaim RAM immediately.
    """
    try:
        from app.voice.stt import unload_whisper_if_idle
        unload_whisper_if_idle()
    except Exception:
        pass
        
    try:
        from app.memory.optimizer import optimize_all_processes
        optimize_all_processes(force=True)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/system/suggestions")
def get_search_suggestions(query: str, type: str):
    """
    Returns search suggestions for `/open` or `/play` commands.
    """
    import os
    from app.tools.system import _get_uwp_apps
    from app.tools.files import query_database_union, _density_score, _is_safe_path, parse_query_with_llm

    clean_query = query.strip()
    if not clean_query:
        return {"suggestions": []}

    parsed = parse_query_with_llm(clean_query)

    results = []

    if type == "play":
        # Search only database files of category song or movie
        try:
            raw_candidates = query_database_union(parsed, limit_raw=500, categories=["song", "movie"], silent=True)
        except Exception as e:
            print(f"[Suggestions API] DB search error: {e}")
            raw_candidates = []

        for c in raw_candidates:
            file_path = c.get("file_path")
            if not file_path or not os.path.exists(file_path) or not _is_safe_path(file_path):
                continue
            
            # Score
            score, title_hits, tie_breaker = _density_score(c, parsed)
            
            # Play mode boost
            boost = 0.0
            _, ext = os.path.splitext(file_path.lower())
            if ext in ('.mp4', '.mkv', '.webm'):
                boost = 100.0
            elif ext == '.mp3':
                boost = 50.0
                
            final_score = score + boost
            if final_score <= 0:
                continue
                
            results.append({
                "name": c["file_name"],
                "path": file_path,
                "type": "file",
                "score": final_score,
                "tie_breaker": tie_breaker
            })
            
    elif type in ("read", "sum"):
        # Search only database files of category document
        try:
            raw_candidates = query_database_union(parsed, limit_raw=500, categories=["document"], silent=True)
        except Exception as e:
            print(f"[Suggestions API] DB search error: {e}")
            raw_candidates = []

        for c in raw_candidates:
            file_path = c.get("file_path")
            if not file_path or not os.path.exists(file_path) or not _is_safe_path(file_path):
                continue
            
            score, title_hits, tie_breaker = _density_score(c, parsed)
            if score <= 0:
                continue
                
            results.append({
                "name": c["file_name"],
                "path": file_path,
                "type": "file",
                "score": score,
                "tie_breaker": tie_breaker
            })
            
    else:  # "open"
        # 1. Search UWP/Start Menu Apps
        try:
            apps = _get_uwp_apps()
        except Exception as e:
            print(f"[Suggestions API] Start apps error: {e}")
            apps = []
            
        for app in apps:
            name = app.get("Name", "")
            if not name:
                continue
            
            # Create a fake candidate for the app to score it using the same density scoring
            app_id = app.get("AppID")
            app_path = f"shell:AppsFolder\\{app_id}" if app_id else name
            app_candidate = {
                "file_name": name,
                "file_path": app_path,
                "parent_folder": "",
                "title": name,
                "alternate_titles": "",
                "genre_or_tags": ""
            }
            score, title_hits, tie_breaker = _density_score(app_candidate, parsed)
            if score > 0:
                results.append({
                    "name": name,
                    "path": app_path,
                    "type": "app",
                    "score": score,
                    "tie_breaker": tie_breaker
                })
                
        # 2. Search Database Files
        try:
            raw_candidates = query_database_union(parsed, limit_raw=500, silent=True)
        except Exception as e:
            print(f"[Suggestions API] DB search error: {e}")
            raw_candidates = []

        for c in raw_candidates:
            file_path = c.get("file_path")
            if not file_path or not os.path.exists(file_path) or not _is_safe_path(file_path):
                continue
                
            score, title_hits, tie_breaker = _density_score(c, parsed)
            if score <= 0:
                continue
                
            results.append({
                "name": c["file_name"],
                "path": file_path,
                "type": "file",
                "score": score,
                "tie_breaker": tie_breaker
            })
            
    # Sort by score descending, then by tie_breaker descending (larger is shorter path)
    results.sort(key=lambda x: (x["score"], x["tie_breaker"]), reverse=True)
    
    # Return top 20 unique suggestions (de-duplicate by path to avoid duplicates)
    seen_paths = set()
    unique_results = []
    for r in results:
        p = r["path"].lower()
        if p not in seen_paths:
            seen_paths.add(p)
            unique_results.append({
                "name": r["name"],
                "path": r["path"],
                "type": r["type"],
                "score": r["score"]
            })
            if len(unique_results) >= 50:
                break
                
    return {"suggestions": unique_results}


class OpenPlayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    play_mode: bool = False
    force: bool = False
    pending_confirmation_id: Optional[str] = None
    from_suggestion: Optional[bool] = False


@app.post("/api/system/open_or_play")
def post_open_or_play(req: OpenPlayRequest):
    """
    Directly resolves and opens/plays a file or application without LLM intervention.
    Program/file execution is protected by backend-issued confirmation grants.
    """
    from app.tools.files import resolve_best_file_no_llm, open_or_play_file_no_llm
    from app.tools.system import _find_app_path
    import os

    clean = req.query.strip().strip('"\'')

    resolved_path = None
    if clean.lower().startswith("shell:"):
        resolved_path = clean
    elif os.path.exists(clean):
        resolved_path = clean
    else:
        # 1. Use the density-scored search suggestions to find the best match (matches dropdown suggestion list)
        sugg_type = "play" if req.play_mode else "open"
        res = get_search_suggestions(clean, type=sugg_type)
        suggs = res.get("suggestions", [])
        if suggs:
            resolved_path = suggs[0]["path"]
        else:
            # 2. Fallback to legacy resolution (DB/LLM search or direct start menu path)
            app_path = _find_app_path(clean) if not req.play_mode else None
            if app_path:
                resolved_path = app_path
            else:
                resolved_path = resolve_best_file_no_llm(clean, play_mode=req.play_mode)

    target = resolved_path if resolved_path else req.query
    from app.tools.safety import approve_pending_confirmation, authorize_tool_call, issue_pending_confirmation
    safety_args = {
        "file_path_or_query": target,
        "play_mode": req.play_mode,
    }
    if req.pending_confirmation_id:
        ok, grant_or_reason = approve_pending_confirmation(
            req.pending_confirmation_id,
            "open_or_play_file",
            safety_args,
        )
        if not ok:
            return {"error": f"Confirmation approval failed: {grant_or_reason}"}
        safety_args["confirmation_grant_id"] = grant_or_reason

    decision = authorize_tool_call("open_or_play_file", safety_args, consume_grant=True)
    if not decision.allowed:
        if decision.requires_confirmation:
            # Bypass confirmation for "/open" and "/o" commands (not req.play_mode) OR if selected from search suggestions
            if not req.play_mode or req.from_suggestion:
                pass
            else:
                grant_args = decision.arguments or {
                    "file_path_or_query": target,
                    "play_mode": req.play_mode,
                }
                pending_id = issue_pending_confirmation(
                    "open_or_play_file",
                    grant_args,
                    target=decision.target or target,
                )
                return {
                    "status": "confirm_required",
                    "name": decision.target or target,
                    "path": target,
                    "pending_confirmation_id": pending_id,
                }
        else:
            return {"error": decision.message}

    try:
        result = open_or_play_file_no_llm(target, play_mode=req.play_mode)
        return {"result": result}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/crawler/status")
def get_crawler_status():
    """
    Returns the real-time background crawler state and statistics.
    """
    from app.memory import db, crawler
    try:
        conn = db.get_connection()
        total_files = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        # Query correct table 'file_metadata'
        pending_enrichment = conn.execute("SELECT COUNT(*) FROM file_metadata WHERE enriched = 0").fetchone()[0]
        conn.close()
    except Exception as e:
        total_files = 0
        pending_enrichment = 0
        print(f"Error querying database for crawler status: {e}")

    metrics = crawler.get_crawler_status_metrics()

    return {
        "paused": crawler.is_crawler_paused(),
        "tagger_paused": crawler.is_tagger_paused(),
        "current_path": crawler.get_current_crawl_path(),
        "current_tagger_path": crawler.get_current_tagger_path(),
        "total_files": total_files,
        "pending_enrichment": pending_enrichment,
        "initial_crawl_completed": metrics["initial_crawl_completed"],
        "first_time_priority_done": metrics.get("first_time_priority_done", False),
        "first_cycle_done": metrics.get("first_cycle_done", False),
        "completed_roots": metrics.get("completed_roots", []),
        "remaining_roots": metrics.get("remaining_roots", []),
        "roots_total": metrics["roots_total"],
        "roots_current": metrics["roots_current"],
        "current_root_path": metrics["current_root_path"],
        "watchdog_active": metrics["watchdog_active"]
    }

@app.post("/api/crawler/recrawl")
def trigger_force_recrawl():
    from app.memory import crawler
    crawler.force_recrawl()
    return {"message": "Full recrawl started successfully."}

active_confirmations = {}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global global_chat_history
    await websocket.accept()
    active_websockets.append(websocket)
    print("Frontend connected via WebSocket.")
    
    # Send initial profile card to frontend
    await websocket.send_json({
        "type": "profile_update",
        "profile": memory_manager.profile
    })
    
    chat_task = None
    try:
        while True:
            # Wait for text data from frontend
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            if msg_type == "confirm_response":
                conf_id = data.get("conf_id")
                confirmed = data.get("confirmed", False)
                if conf_id in active_confirmations:
                    try:
                        active_confirmations[conf_id].set_result(confirmed)
                    except Exception as e:
                        print(f"[WebSocket] Error setting confirmation result: {e}")
                continue

            if msg_type == "interrupt":
                if chat_task and not chat_task.done():
                    print("[WebSocket] Interrupt request received. Cancelling active chat task.")
                    chat_task.cancel()
                    try:
                        await chat_task
                    except asyncio.CancelledError:
                        pass
                    chat_task = None
                await websocket.send_json({
                    "type": "status",
                    "status": "idle",
                    "message": "Turn terminated!"
                })
                continue
            
            if msg_type == "chat":
                if chat_task and not chat_task.done():
                    chat_task.cancel()
                    try:
                        await chat_task
                    except asyncio.CancelledError:
                        pass
                
                async def run_chat(payload_data):
                    global global_chat_history
                    try:
                        user_msg = payload_data.get("message", "").strip()
                        stt_time_ms = payload_data.get("stt_time_ms")
                        if not user_msg:
                            return
                        print(f"[WebSocket] Received chat message: '{user_msg}'")
                            
                        # 1. Send status indicating Yuki is thinking
                        await websocket.send_json({"type": "status", "status": "thinking"})
                        
                        start_time = time.time()
                        ttft_duration = 0.0
                        llm_start_time = None
                        llm_generation_duration = 0.0
                        tool_duration = 0.0
                        tool_start_time = None
                        
                        # Parallel TTS Queue
                        tts_tasks = []
                        tts_tasks_event = asyncio.Event()
                        stream_done_flag = False
                        tts_semaphore = asyncio.Semaphore(1)
                        
                        def queue_sentence(sentence_text, idx):
                            nonlocal tts_tasks_event, stream_done_flag
                            if not tts_online_status:
                                return
                                
                            async def synth():
                                global tts_online_status
                                if not tts_online_status:
                                    return None
                                async with tts_semaphore:
                                    try:
                                        from app.voice.tts import generate_speech_bytes
                                        speech_text = make_speech_friendly(sentence_text)
                                        # Use a timeout of 30.0 seconds for local Kokoro call
                                        t_start = time.time()
                                        # Mark which backend we expect to use at the time of synthesis
                                        expected_backend = 'kokoro' if tts_online_status else 'backend-disabled'
                                        audio_bytes = await asyncio.wait_for(generate_speech_bytes(speech_text), timeout=30.0)
                                        t_elapsed = time.time() - t_start
                                        if audio_bytes:
                                            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                                            audio_url = f"data:audio/wav;base64,{audio_base64}"
                                            print(f"[TTS] Chunk {idx} ready ({int(t_elapsed*1000)}ms): '{speech_text[:50]}'")
                                            return {
                                                "type": "audio_chunk",
                                                "audio_url": audio_url,
                                                "index": idx,
                                                "text": sentence_text,
                                                "speech_text": speech_text,
                                                "tts_backend": expected_backend,
                                                "tts_time_ms": int(t_elapsed*1000),
                                                "requested_text": sentence_text
                                            }
                                    except Exception as e:
                                        print(f"TTS Synthesis timeout/error for '{sentence_text}': {e}.")
                                    return None
                            
                            task = asyncio.create_task(synth())
                            tts_tasks.append(task)
                            tts_tasks_event.set()
                        
                        async def tts_sender():
                            idx = 0
                            while True:
                                while idx >= len(tts_tasks):
                                    if stream_done_flag and idx >= len(tts_tasks):
                                        return
                                    tts_tasks_event.clear()
                                    await tts_tasks_event.wait()
                                
                                task = tts_tasks[idx]
                                result = await task
                                if result:
                                    await websocket.send_json(result)
                                idx += 1
                        
                        sender_task = asyncio.create_task(tts_sender())
                        
                        try:
                            # 2. Call the executor's streaming generator
                            sentence_buffer = ""
                            backend_used = "local"
                            audio_idx = 0
                            
                            def find_sentence_boundary(text: str) -> int:
                                min_idx = -1
                                terminators = [('? ', 1), ('! ', 1), ('. ', 1), ('\n', 0), ('? \n', 2), ('! \n', 2), ('. \n', 2)]
                                for term, offset in terminators:
                                    idx = text.find(term)
                                    if idx != -1:
                                        if min_idx == -1 or idx < min_idx:
                                            min_idx = idx + len(term) - offset - 1
                                return min_idx

                            try:
                                if user_msg.startswith("/read "):
                                    parts = user_msg.split(maxsplit=1)
                                    file_path = parts[1].strip().strip('"').strip("'") if len(parts) > 1 else ""
                                    
                                    async def read_gen():
                                        if not file_path:
                                            yield "token", "Hmph! Please provide a file path to read.", "local"
                                            yield "final_history", global_chat_history + [
                                                {"role": "user", "content": user_msg},
                                                {"role": "assistant", "content": "Hmph! Please provide a file path to read."}
                                            ], "local"
                                            return
                                        
                                        from app.tools.files import read_file_content
                                        print(f"[Direct Read] Reading file content directly: '{file_path}'")
                                        try:
                                            content = await asyncio.to_thread(read_file_content, file_path)
                                            if content.startswith("Success: "):
                                                content = content[len("Success: "):].strip()
                                            yield "token", content, "local"
                                            yield "final_history", global_chat_history + [
                                                {"role": "user", "content": user_msg},
                                                {"role": "assistant", "content": content}
                                            ], "local"
                                        except Exception as e:
                                            err_msg = f"Failed to read file: {str(e)}"
                                            yield "token", err_msg, "local"
                                            yield "final_history", global_chat_history + [
                                                {"role": "user", "content": user_msg},
                                                {"role": "assistant", "content": err_msg}
                                            ], "local"
                                    gen = read_gen()
                                elif getattr(config, 'NO_LLM_MODE', False):
                                    async def no_llm_gen():
                                        yield "token", "sorry, LLM is currently turned off", "local"
                                        updated_history = global_chat_history + [
                                            {"role": "user", "content": user_msg},
                                            {"role": "assistant", "content": "sorry, LLM is currently turned off"}
                                        ]
                                        yield "final_history", updated_history, "local"
                                    gen = no_llm_gen()
                                else:
                                    if agent_executor is None:
                                        await websocket.send_json({"type": "error", "content": "Agent is still initializing, please try again in a moment."})
                                        return
                                    gen = agent_executor.execute_chat_turn_stream(user_msg, global_chat_history)
                                try:
                                    event = await gen.__anext__()
                                    while True:
                                        event_type, value, label = event
                                        backend_used = label
                                        
                                        if event_type == "tool_confirm_required":
                                            import uuid
                                            conf_id = str(uuid.uuid4())
                                            future = asyncio.Future()
                                            active_confirmations[conf_id] = future
                                            try:
                                                await websocket.send_json({
                                                    "type": "confirm_request",
                                                    "conf_id": conf_id,
                                                    "name": value
                                                })
                                                confirmed = await future
                                            finally:
                                                active_confirmations.pop(conf_id, None)
                                            
                                            event = await gen.asend(confirmed)
                                        else:
                                            if event_type == "token":
                                                if llm_start_time is None:
                                                    llm_start_time = time.time()
                                                    ttft_duration = llm_start_time - start_time
                                                # Send token to frontend
                                                await websocket.send_json({
                                                    "type": "text_stream",
                                                    "text": value,
                                                    "backend_used": backend_used
                                                })
                                                
                                                # Batch into sentences for TTS
                                                sentence_buffer += value
                                                while True:
                                                    boundary = find_sentence_boundary(sentence_buffer)
                                                    if boundary == -1:
                                                        break
                                                    sentence = sentence_buffer[:boundary + 1].strip()
                                                    sentence_buffer = sentence_buffer[boundary + 1:]
                                                    if sentence:
                                                        queue_sentence(sentence, audio_idx)
                                                        audio_idx += 1
                                                        
                                            elif event_type == "tool_start":
                                                tool_start_time = time.time()
                                                # Notify frontend about tool call execution
                                                await websocket.send_json({
                                                    "type": "status",
                                                    "status": "thinking",
                                                    "message": f"Running tool '{value}'..."
                                                })
                                            elif event_type == "tool_result":
                                                if tool_start_time is not None:
                                                    tool_duration += time.time() - tool_start_time
                                                    tool_start_time = None
                                                # Notify frontend tool finished
                                                await websocket.send_json({
                                                    "type": "tool_result",
                                                    "result": value
                                                })
                                                await websocket.send_json({
                                                    "type": "status",
                                                    "status": "thinking"
                                                })
                                            elif event_type == "final_history":
                                                global_chat_history = value
                                                
                                            event = await gen.__anext__()
                                except StopAsyncIteration:
                                    pass
                            except Exception as e:
                                print(f"Error during stream generation: {e}")
                                friendly_error = await agent_executor.get_friendly_error_explanation(str(e))
                                await websocket.send_json({"type": "error", "message": friendly_error})
                            
                            # Feed any remaining text in sentence buffer
                            if sentence_buffer.strip():
                                queue_sentence(sentence_buffer.strip(), audio_idx)
                                audio_idx += 1
                                
                            # Signal the worker to finish and wait for it
                            stream_done_flag = True
                            tts_tasks_event.set()
                            await sender_task
                        finally:
                            # Clean up the background task to prevent event loop task leaks
                            stream_done_flag = True
                            tts_tasks_event.set()
                            if not sender_task.done():
                                sender_task.cancel()
                                try:
                                    await sender_task
                                except asyncio.CancelledError:
                                    pass
                        
                        elapsed_time = time.time() - start_time
                        llm_generation_duration = time.time() - (llm_start_time or start_time)
                        
                        # Print Timing Breakdown in Backend Terminal
                        ttft_str = f"{ttft_duration:.2f}s" if llm_start_time is not None else "N/A (No tokens generated)"
                        llm_gen_str = f"{llm_generation_duration:.2f}s"
                        tool_str = f"{tool_duration:.2f}s"
                        
                        print(f"\n================ CHAT TURN TIMING BREAKDOWN ================")
                        if stt_time_ms is not None:
                            print(f"Overall End-to-End Latency: {elapsed_time + (stt_time_ms / 1000.0):.2f}s")
                            print(f"  - Speech-to-Text (STT):       {stt_time_ms / 1000.0:.2f}s")
                            print(f"  - Processing (LLM + TTS):     {elapsed_time:.2f}s")
                        else:
                            print(f"Total Turn Time: {elapsed_time:.2f}s")
                        print(f"  - Time to First Token (TTFT): {ttft_str}")
                        print(f"  - LLM Token Generation:       {llm_gen_str}")
                        print(f"  - Tool Executions:            {tool_str}")
                        print(f"============================================================\n")
                        
                        # Send final stream done message containing total time
                        await websocket.send_json({
                            "type": "stream_done",
                            "backend_used": backend_used,
                            "response_time": round(elapsed_time, 2)
                        })
                        
                        # Push profile update
                        await websocket.send_json({
                            "type": "profile_update",
                            "profile": memory_manager.profile
                        })
                    except asyncio.CancelledError:
                        print("[WebSocket] Chat turn was cancelled/interrupted.")
                        # Send status to frontend that we are idle now
                        try:
                            await websocket.send_json({"type": "status", "status": "idle"})
                        except:
                            pass
                        raise
                
                chat_task = asyncio.create_task(run_chat(data))
                
            elif msg_type == "tts_only":
                # Synthesise system message via Kokoro TTS without calling the LLM, chunking to avoid timeouts
                tts_text = data.get("text", "").strip()
                expression = data.get("expression", None)
                if tts_text and tts_online_status:
                    try:
                        import re
                        # Split text into sentences
                        sentences = []
                        remaining_text = tts_text
                        
                        def find_boundary(txt: str) -> int:
                            min_idx = -1
                            terminators = [('? ', 1), ('! ', 1), ('. ', 1), ('\n', 0), ('? \n', 2), ('! \n', 2), ('. \n', 2)]
                            for term, offset in terminators:
                                idx = txt.find(term)
                                if idx != -1:
                                    if min_idx == -1 or idx < min_idx:
                                        min_idx = idx + len(term) - offset - 1
                            return min_idx

                        while True:
                            boundary = find_boundary(remaining_text)
                            if boundary == -1:
                                if remaining_text.strip():
                                    sentences.append(remaining_text.strip())
                                break
                            sentence = remaining_text[:boundary + 1].strip()
                            remaining_text = remaining_text[boundary + 1:]
                            if sentence:
                                sentences.append(sentence)

                        # Now synthesize and send each sentence sequentially
                        from app.voice.tts import generate_speech_bytes
                        audio_idx = 0
                        for sentence in sentences:
                            speech_text = make_speech_friendly(sentence)
                            if not re.sub(r'[^\w\s]', '', speech_text).strip():
                                continue
                            try:
                                audio_bytes = await asyncio.wait_for(generate_speech_bytes(speech_text), timeout=40.0)
                                if audio_bytes:
                                    audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                                    audio_url = f"data:audio/wav;base64,{audio_base64}"
                                    await websocket.send_json({
                                        "type": "audio_chunk",
                                        "audio_url": audio_url,
                                        "index": audio_idx,
                                        "text": sentence,
                                        "speech_text": speech_text,
                                        "tts_backend": "kokoro",
                                        "tts_time_ms": 0,
                                        "expression": expression
                                    })
                                    audio_idx += 1
                            except Exception as e:
                                print(f"[TTS-Only] Sentence synthesis error for '{sentence}': {e}")
                    except Exception as e:
                        print(f"[TTS-Only] Segment synthesis error: {e}")
                await websocket.send_json({"type": "stream_done", "backend_used": "tts_only", "response_time": 0})


            elif msg_type == "log":
                log_msg = data.get("message", "")
                print(f"[Frontend Log] {log_msg}")
                
            elif msg_type == "reset":
                global_chat_history.clear()
                await websocket.send_json({
                    "type": "status",
                    "status": "idle",
                    "message": "Chat history cleared!"
                })
                
    except WebSocketDisconnect:
        print("Frontend disconnected.")
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        if chat_task and not chat_task.done():
            chat_task.cancel()
        if websocket in active_websockets:
            active_websockets.remove(websocket)


# ---------------------------------------------------------------------------
# Serve the React frontend (dist/) so the app is accessible via HTTP
# on port 58392 from any browser (localhost or LAN).
# ---------------------------------------------------------------------------

def _resolve_frontend_dir():
    """Resolve the path to the built frontend dist/ directory."""
    if getattr(sys, 'frozen', False):
        # Packaged: resources/frontend/dist/ next to the exe
        return Path(sys.executable).parent / "resources" / "frontend" / "dist"
    # Dev: frontend/dist/ relative to project root
    return Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

_frontend_dir = _resolve_frontend_dir()

if _frontend_dir.exists():
    from starlette.staticfiles import StaticFiles
    from starlette.responses import FileResponse

    _assets_dir = _frontend_dir / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """SPA catch-all: serve static files or fall back to index.html."""
        # Try to serve the exact file (CSS, JS, fonts, images, etc.)
        file_path = _frontend_dir / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))
        # SPA fallback: serve index.html for client-side routing
        index = _frontend_dir / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"error": "Frontend not built. Run 'npm run build' in frontend/."}
