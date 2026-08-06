import base64
import json
import time
import urllib.parse
import asyncio
import re
import sys
import logging
from pathlib import Path
import requests as http_requests
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response, UploadFile, File, HTTPException, Body, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from typing import List, Dict, Optional, Any
from app.memory.optimizer import own_process_busy_guard

# Silence periodic telemetry polling logs from clogging the terminal console
class TelemetryLogFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return (
            "/api/reminders/active" not in msg and
            "/api/scheduled-tasks" not in msg and
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
whisper_warmed_up_event = asyncio.Event()

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
    from app.memory.crawler import start_watchdog_services
    try:
        start_watchdog_services()
    except Exception as e:
        print(f"[Startup] Failed to start watchdog services: {e}")

    await asyncio.sleep(120)  # 2-min grace period after startup (crawler only)
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
    # Wait for startup warmups (incl. Whisper) to complete before starting the periodic loop
    try:
        await asyncio.gather(
            llm_loaded_event.wait(),
            tts_warmed_up_event.wait(),
            whisper_warmed_up_event.wait(),
            return_exceptions=True
        )
    except Exception:
        pass
    await asyncio.sleep(30)
    while True:
        try:
            # Only unload Whisper under real memory pressure, and only when running on the GPU.
            # Never unload while listening mode is active (mic is on, whisper in active use).
            try:
                from app.voice.stt import is_whisper_on_gpu, is_listening_mode_active, unload_whisper_if_idle
                if not is_listening_mode_active() and config.WHISPER_AUTO_UNLOAD and is_whisper_on_gpu():
                    from app.gpu_monitor import get_dedicated_gpu_vram_percent
                    vram_pct = get_dedicated_gpu_vram_percent()
                    if vram_pct is not None and vram_pct > config.WHISPER_VRAM_THRESHOLD:
                        print(f"[Memory] GPU VRAM at {vram_pct:.1f}% > {config.WHISPER_VRAM_THRESHOLD}% - unloading Whisper to free VRAM.")
                        unload_whisper_if_idle(force=True)
            except Exception:
                pass

            from app.memory.optimizer import optimize_all_processes
            optimize_all_processes()
        except Exception as e:
            print(f"[Memory] Error in background memory optimizer: {e}")
        await asyncio.sleep(300)


async def _warmup_whisper():
    """Background: preload the faster-whisper model so the first STT use is instant."""
    try:
        saved_model = memory_manager.profile.get("settings", {}).get("whisper_model")
        active_model = saved_model or getattr(config, "WHISPER_MODEL", None) or "base"
        active_compute = memory_manager.profile.get("settings", {}).get("whisper_compute_type", "int8_float16")
        print(f"[Startup] Preloading faster-whisper model '{active_model}' ({active_compute})...")
        from app.voice.stt import get_whisper_model, set_whisper_loading
        set_whisper_loading(True)
        try:
            await asyncio.to_thread(get_whisper_model, active_model, active_compute)
            print(f"[Startup] Whisper model '{active_model}' warm-started.")
        finally:
            set_whisper_loading(False)
    except Exception as e:
        print(f"[Startup] Whisper warm-up failed (non-fatal): {e}")
    finally:
        whisper_warmed_up_event.set()


async def _coordinate_startup_optimization():
    """Wait for all warmups to finish, then run a single memory cleanup sweep."""
    try:
        await asyncio.gather(
            llm_loaded_event.wait(),
            tts_warmed_up_event.wait(),
            whisper_warmed_up_event.wait(),
            return_exceptions=True
        )
        await asyncio.sleep(5)
        print("[Startup] Model warmups complete. Performing initial memory sweep...")
        from app.memory.optimizer import optimize_all_processes
        # skip_own_process: don't page out the models we JUST preloaded — the
        # periodic loop (which waits for warmups + 30s) will trim the own process
        # once pages have settled. Electron/Node still get trimmed here.
        optimize_all_processes(skip_own_process=True)
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

    tts_preload = memory_manager.profile.get("settings", {}).get("tts_preload", getattr(config, 'TTS_PRELOAD', True))
    stt_preload = memory_manager.profile.get("settings", {}).get("stt_preload", getattr(config, 'STT_PRELOAD', True))
    if tts_preload:
        asyncio.create_task(_warmup_tts())
    if stt_preload:
        asyncio.create_task(_warmup_whisper())
    asyncio.create_task(_coordinate_startup_optimization())
    asyncio.create_task(_start_crawler_bg())
    asyncio.create_task(_run_memory_optimizer_bg())

    from app.tools import time_manager
    time_manager.set_due_callback(broadcast_due_reminders)
    time_manager.set_stopwatch_callback(broadcast_ws)
    time_manager.init_exact_timer_scheduler()
    time_manager.init_time_manager()
    asyncio.create_task(reminder_heartbeat_loop())

    from app.tools import scheduled_tasks as _scheduled_tasks
    _scheduled_tasks.set_main_loop(asyncio.get_running_loop())
    _scheduled_tasks.init_scheduled_task_scheduler()

    from app.tools import canvas as _canvas_tools
    _canvas_tools.set_broadcast_callback(broadcast_ws)
    _canvas_tools.set_main_loop(asyncio.get_running_loop())

    from app.tools import ask_user
    ask_user.set_ask_callback(broadcast_ask_event)

    # ── Mood Engine v2 wires ─────────────────────────────────────────────
    # 1. Connect the WS broadcast so _notify() pushes live mood_update events.
    memory_manager.set_mood_broadcast(broadcast_ws)

    # 2. Offline catch-up + daily shake-up + hourly jitter on every boot.
    try:
        memory_manager.on_mood_startup()
        print("[MoodEngine] Startup catch-up complete.")
    except Exception as _me:
        print(f"[MoodEngine] Startup error: {_me}")

    # 3. Background idle drift — step every 60 s so mood moves between messages.
    async def _mood_idle_loop():
        while True:
            await asyncio.sleep(60)
            try:
                memory_manager.step_mood()
            except Exception as _e:
                print(f"[MoodEngine] idle step error: {_e}")

    asyncio.create_task(_mood_idle_loop())

    # ── Restore cloud STT / TTS provider settings from saved profile ─────
    try:
        _saved_settings = memory_manager.profile.get("settings", {})
        from app.utils.security import decrypt_api_key as _decrypt
        _stt_prov = _saved_settings.get("stt_provider", "local")
        if _stt_prov:
            config.STT_PROVIDER = _stt_prov
        _stt_key = _saved_settings.get("stt_cloud_api_key", "")
        if _stt_key:
            config.STT_CLOUD_API_KEY = _decrypt(_stt_key)
        config.STT_CLOUD_ENDPOINT = _saved_settings.get("stt_cloud_endpoint", "")

        _tts_prov = _saved_settings.get("tts_provider", "local")
        if _tts_prov:
            config.TTS_PROVIDER = _tts_prov
        _tts_key = _saved_settings.get("tts_cloud_api_key", "")
        if _tts_key:
            config.TTS_CLOUD_API_KEY = _decrypt(_tts_key)
        config.TTS_CLOUD_ENDPOINT = _saved_settings.get("tts_cloud_endpoint", "")
        config.TTS_CLOUD_VOICE = _saved_settings.get("tts_cloud_voice", "")
        print(f"[Startup] STT provider: {config.STT_PROVIDER} | TTS provider: {config.TTS_PROVIDER}")
    except Exception as _cp_err:
        print(f"[Startup] Cloud provider settings restore error: {_cp_err}")


    yield

    # ── Shutdown ─────────────────────────────────────────────────────────
    if agent_executor:
        await agent_executor.mcp_tools.aclose()


app = FastAPI(title="Yuki Desktop Assistant Backend", version="0.3.2-beta", lifespan=lifespan)

# Setup CORS — restrict to localhost and LAN origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

import traceback
from fastapi.responses import JSONResponse
from fastapi import Request

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"[API Error] Unhandled Exception on {request.method} {request.url.path}: {exc}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "error": type(exc).__name__},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        }
    )

# Initialize singletons for the session
memory_manager = MemoryManager()
agent_executor = None  # Initialized in lifespan to defer heavy imports

import uuid
def generate_new_session_id() -> str:
    now_str = time.strftime("%Y%m%d_%H%M%S")
    short_uid = str(uuid.uuid4())[:6]
    return f"session_{now_str}_{short_uid}"

active_session_id = generate_new_session_id()
print(f"[Session] Initialized new app session: {active_session_id}")

# Chat history helper functions
def save_persistent_chat_history(history: list):
    try:
        if memory_manager.profile.get("settings", {}).get("persistent_chat_history", False):
            import json
            h_path = config.BASE_DIR / "chat_history.json"
            with open(h_path, "w", encoding="utf-8") as f:
                json.dump(history, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[History] Could not save chat_history.json: {e}")
        
    try:
        from app.memory.db import save_chat_session_if_eligible
        save_chat_session_if_eligible(active_session_id, history)
    except Exception as e:
        print(f"[History] Could not save SQLite chat session: {e}")

def load_persistent_chat_history() -> list:
    try:
        if memory_manager.profile.get("settings", {}).get("persistent_chat_history", False):
            h_path = config.BASE_DIR / "chat_history.json"
            if h_path.exists():
                import json
                with open(h_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        print(f"[Startup] Loaded {len(data)} persistent chat messages from chat_history.json")
                        return data
    except Exception as e:
        print(f"[Startup] Could not load chat_history.json: {e}")
    return []

# Chat history in-memory or loaded from disk if persistent setting enabled
global_chat_history: List[Dict[str, str]] = load_persistent_chat_history()
tts_online_status = True

active_websockets: List[WebSocket] = []


def make_speech_friendly(text: str) -> str:
    if not text:
        return ""
    # Strip thought/think/reasoning blocks
    text = re.sub(r'<(thought|think|reasoning)>[\s\S]*?</\1>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<(thought|think|reasoning)>[\s\S]*$', '', text, flags=re.IGNORECASE)
    # Strip unique animation and emotion tags (<yuki_anim:.../>, <yuki_emotion:.../>, [anim:...], [emotion:...])
    text = re.sub(r'<(?:yuki_)?(?:anim|emotion):[a-zA-Z0-9_\-]+\/?>|\[(?:anim|emotion):\s*[a-zA-Z0-9_\-]+\]', '', text, flags=re.IGNORECASE)
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

async def broadcast_ask_event(ask_id: str, questions: list):
    """Broadcast an ask_user event to all connected WebSocket clients.

    Mirrors the callback-broadcast pattern used by time_manager.set_due_callback
    and canvas.set_broadcast_callback.
    """
    payload = {
        "type": "ask_user",
        "ask_id": ask_id,
        "questions": questions
    }
    await broadcast_ws(payload)

def _handle_terminal_stream_event(payload: dict):
    try:
        loop = asyncio.get_running_loop()
        if loop.is_running():
            loop.create_task(broadcast_ws(payload))
    except Exception:
        pass

try:
    from app.tools.system import register_terminal_stream_listener
    register_terminal_stream_listener(_handle_terminal_stream_event)
except Exception as e:
    print(f"[Startup] Error registering terminal stream listener: {e}")

def _resolve_tts_rate(rate: str = None) -> str:
    """Return the effective TTS rate string, resolving 'auto' against Yuki's live mood."""
    if rate is None:
        rate = memory_manager.profile.get("settings", {}).get("tts_rate", getattr(config, "TTS_RATE", "auto"))
    if str(rate).strip().lower() == "auto":
        try:
            return str(memory_manager.get_mood_meta()["voice"]["rate"])
        except Exception:
            return "1.0"
    return rate


async def test_and_announce_voice_change(new_voice: str, new_rate: str = None):
    global tts_online_status
    try:
        from app.voice.tts import generate_speech_bytes
        test_text = f"Voice changed to {new_voice.replace('_', ' ').replace('af ', '').replace('bf ', '').replace('jf ', '').title()}."
        audio_bytes = await asyncio.wait_for(generate_speech_bytes(test_text, voice=new_voice, rate=_resolve_tts_rate(new_rate)), timeout=15.0)
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

_models_cache = {}
_models_in_flight = {}
MODELS_CACHE_TTL_SECONDS = 15.0

def invalidate_models_cache():
    global _models_cache
    _models_cache.clear()

@app.get("/api/models")
async def get_available_models(target: str = "complex"):
    """
    Returns the dynamically loaded list of models from the active LLM backend.
    Includes 15-second TTL caching and in-flight request deduplication to prevent
    spamming outbound provider API calls.
    """
    from app.agent.llm_backend import get_backend
    from app.utils.security import decrypt_api_key

    # Extract backend config details for cache key
    if target == "simple":
        simple_backend_type = getattr(config, "LLM_SIMPLE_BACKEND", "lmstudio")
        simple_base_url = getattr(config, "LLM_SIMPLE_BASE_URL", "")
        simple_api_key = getattr(config, "LLM_SIMPLE_API_KEY", "")
        if simple_api_key and (simple_api_key.startswith("enc_v1:") or simple_api_key.startswith("gAAAA")):
            simple_api_key = decrypt_api_key(simple_api_key)
        b_type = simple_backend_type
        b_url = simple_base_url
        b_key = simple_api_key
        active_model = getattr(config, "LLM_SIMPLE_MODEL", "")
    elif target == "coder":
        coder_backend_type = getattr(config, "LLM_CODER_BACKEND", "").strip().lower()
        coder_base_url = getattr(config, "LLM_CODER_BASE_URL", "")
        coder_api_key = getattr(config, "LLM_CODER_API_KEY", "")
        if coder_api_key and (coder_api_key.startswith("enc_v1:") or coder_api_key.startswith("gAAAA")):
            coder_api_key = decrypt_api_key(coder_api_key)
        b_type = coder_backend_type or config.get_backend_type()
        b_url = coder_base_url or config.get_effective_base_url()
        b_key = coder_api_key or config.LLM_API_KEY
        active_model = getattr(config, "LLM_CODER_MODEL", "") or config.LLM_MODEL
    else:
        if config.LLM_API_KEY and (config.LLM_API_KEY.startswith("enc_v1:") or config.LLM_API_KEY.startswith("gAAAA")):
            config.LLM_API_KEY = decrypt_api_key(config.LLM_API_KEY)
        b_type = config.get_backend_type()
        b_url = config.get_effective_base_url()
        b_key = config.LLM_API_KEY
        active_model = config.LLM_MODEL

    cache_key = (target, b_type, b_url, hash(b_key or ""))

    # 1. Check TTL cache
    now = time.time()
    if cache_key in _models_cache:
        cached = _models_cache[cache_key]
        if now - cached["timestamp"] < MODELS_CACHE_TTL_SECONDS:
            print(f"[ModelFetch][{target}] Serving {len(cached['models'])} models from cache (TTL left: {round(MODELS_CACHE_TTL_SECONDS - (now - cached['timestamp']), 1)}s)")
            return {"models": cached["models"], "active": active_model}

    # 2. Check in-flight requests (request coalescing)
    if cache_key in _models_in_flight:
        print(f"[ModelFetch][{target}] Request already in-flight — waiting for shared result...")
        models = await _models_in_flight[cache_key]
        return {"models": models, "active": active_model}

    # 3. Create in-flight task
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    _models_in_flight[cache_key] = fut

    print(f"\n[ModelFetch] === /api/models called with target='{target}' ===")

    try:
        if target == "simple":
            masked_key = (simple_api_key[:4] + "...") if simple_api_key and len(simple_api_key) > 8 else ("(set)" if simple_api_key else "(empty)")
            print(f"[ModelFetch][Simple] backend_type='{simple_backend_type}', base_url='{simple_base_url}', api_key={masked_key}")
            from app.agent.llm_backend import OllamaBackend, OpenAICompatibleBackend, LMStudioBackend
            if simple_backend_type == "ollama":
                backend = OllamaBackend(base_url_override=simple_base_url)
            elif simple_backend_type in ("openai", "groq", "together", "deepseek", "custom", "vllm"):
                backend = OpenAICompatibleBackend(base_url_override=simple_base_url, api_key_override=simple_api_key)
            elif simple_backend_type == "none":
                print(f"[ModelFetch][Simple] Backend type is 'none', returning empty")
                fut.set_result([])
                _models_in_flight.pop(cache_key, None)
                return {"models": [], "active": active_model}
            else:
                backend = LMStudioBackend(base_url_override=simple_base_url)
        elif target == "coder":
            masked_key = (coder_api_key[:4] + "...") if coder_api_key and len(coder_api_key) > 8 else ("(set)" if coder_api_key else "(empty)")
            print(f"[ModelFetch][Coder] backend_type='{coder_backend_type}', base_url='{coder_base_url}', api_key={masked_key}")
            from app.agent.llm_backend import OllamaBackend, OpenAICompatibleBackend, LMStudioBackend
            if coder_backend_type and coder_backend_type != "none":
                if coder_backend_type == "ollama":
                    backend = OllamaBackend(base_url_override=coder_base_url)
                elif coder_backend_type in ("openai", "groq", "together", "deepseek", "custom", "vllm"):
                    backend = OpenAICompatibleBackend(base_url_override=coder_base_url, api_key_override=coder_api_key)
                else:
                    backend = LMStudioBackend(base_url_override=coder_base_url)
            else:
                backend = get_backend()
        else:
            backend = get_backend()
            print(f"[ModelFetch][Complex] backend '{backend.name}', base_url='{backend.base_url}', models_url='{backend.get_models_url()}'")

        print(f"[ModelFetch] Calling backend.list_models() ...")
        raw_models = await backend.list_models()
        print(f"[ModelFetch] list_models() returned {len(raw_models)} models")
        result_models = [{"name": m["id"], "type": b_type} for m in raw_models]
        
        # Save to cache
        _models_cache[cache_key] = {"models": result_models, "timestamp": time.time()}
        fut.set_result(result_models)
        return {"models": result_models, "active": active_model}

    except Exception as e:
        print(f"[ModelFetch][{target}] Could not reach backend — {e}. Returning empty.")
        fut.set_result([])
        return {"models": [], "active": active_model}
    finally:
        _models_in_flight.pop(cache_key, None)


def parse_vrm_version(file_path) -> int:
    """Read GLTF header from VRM file to detect if VRM version is 1 or 0."""
    import json
    try:
        if not file_path.exists():
            return 0
        with open(file_path, "rb") as f:
            header = f.read(20)
            if len(header) < 20 or header[0:4] != b"glTF":
                return 0
            chunk_len = int.from_bytes(header[12:16], byteorder="little")
            chunk_type = header[16:20]
            if chunk_type != b"JSON":
                return 0
            chunk_data = f.read(chunk_len)
            gltf = json.loads(chunk_data.decode("utf-8", errors="ignore"))
            exts = gltf.get("extensionsUsed", []) + list(gltf.get("extensions", {}).keys())
            if any("VRMC_vrm" in str(e) for e in exts):
                return 1
            return 0
    except Exception:
        return 0


@app.get("/api/models/vrm")
def get_vrm_models():
    """
    Scans bundled (resources/models/) and custom (%APPDATA%/Yuki AI/custom_models/) VRM directories.
    """
    import os
    import json
    from app.config import BASE_DIR
    from pathlib import Path

    bundled_dir = None
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
                bundled_dir = candidate
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

    versions = {}
    for name in all_models:
        file_path = None
        if custom_dir.exists() and (custom_dir / name).exists():
            file_path = custom_dir / name
        elif bundled_dir and (bundled_dir / name).exists():
            file_path = bundled_dir / name

        if file_path:
            versions[name] = parse_vrm_version(file_path)
        else:
            versions[name] = 0

    return {"models": all_models, "custom": custom_models, "versions": versions}


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

    try:
        from app.memory.optimizer import optimize_all_processes
        optimize_all_processes(force=True)
    except Exception:
        pass

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


@app.get("/api/system/file_content")
def get_file_content(path: str):
    """
    Returns file contents for UI File Inspector (supports text/code, markdown, and base64 images).
    """
    import base64
    from pathlib import Path
    import urllib.parse
    
    if not path:
        return Response(status_code=400, content="Missing path parameter")
        
    clean_path = urllib.parse.unquote(path.strip().replace("file:///", "").replace("file://", ""))
    p = Path(clean_path)
    if not p.exists():
        return Response(status_code=404, content=f"Path not found: {clean_path}")
        
    if p.is_dir():
        items = []
        try:
            for child in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                items.append({
                    "name": child.name,
                    "path": str(child),
                    "is_dir": child.is_dir(),
                    "size": child.stat().st_size if child.is_file() else 0
                })
        except Exception as e:
            print(f"[FileInspector] Directory list error: {e}")
        return {
            "path": str(p),
            "name": p.name or str(p),
            "is_directory": True,
            "items": items,
            "content": f"📁 Directory: {p}\nTotal items: {len(items)}\n\n" + "\n".join(f"{'📁' if item['is_dir'] else '📄'} {item['name']}" for item in items)
        }
        
    ext = p.suffix.lower()
    image_exts = {".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".ico", ".bmp"}
    
    try:
        if ext in image_exts:
            content_bytes = p.read_bytes()
            b64 = base64.b64encode(content_bytes).decode("utf-8")
            mime = f"image/{ext.replace('.', '')}" if ext != ".svg" else "image/svg+xml"
            data_url = f"data:{mime};base64,{b64}"
            return {
                "path": str(p),
                "name": p.name,
                "ext": ext,
                "is_image": True,
                "data_url": data_url
            }
        else:
            text_content = p.read_text(encoding="utf-8", errors="replace")
            return {
                "path": str(p),
                "name": p.name,
                "ext": ext,
                "is_image": False,
                "content": text_content
            }
    except Exception as e:
        return Response(status_code=500, content=f"Failed to read file: {e}")

@app.get("/api/todo/list")
def get_todo_list(session_id: Optional[str] = Query(None)):
    """
    Returns the current persistent TODO list for display in the Live Output panel.
    When session_id is provided, returns only todos belonging to that session
    (adopting any legacy global todos into that session).
    """
    try:
        from app.tools.todo_list import get_todos, format_todo_tree
        todos = get_todos(session_id=session_id or None)
        return {
            "todos": todos,
            "text": format_todo_tree(todos)
        }
    except Exception as e:
        print(f"[TodoList] Failed to load todo list: {e}")
        return {"todos": [], "text": ""}


@app.post("/api/ask_user/{ask_id}/answer")
async def answer_ask_user(ask_id: str, body: dict = Body(...)):
    """Resolve a pending ask_user call with the user's answers.

    The frontend dialog POSTs ``{answers: {<question_id>: <label or [labels]>}}``
    when the user submits, which completes the Future the agent is awaiting.
    """
    from app.tools.ask_user import resolve_ask
    ok = resolve_ask(ask_id, body.get("answers", {}))
    return {"status": "ok" if ok else "not_found"}


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
    from app.utils.security import mask_api_key, decrypt_api_key
    for k_name in ["llm_api_key", "llm_simple_api_key", "llm_coder_api_key",
                   "stt_cloud_api_key", "tts_cloud_api_key"]:
        if k_name in settings_dict and settings_dict[k_name]:
            settings_dict[k_name] = mask_api_key(settings_dict[k_name])
    settings_dict.update({
        "llm_model": config.LLM_MODEL,
        "character_name": config.CHARACTER_NAME,
        "character_persona": config.CHARACTER_PERSONA,
        "crawler_paused": is_crawler_paused(),
        "tagger_paused": is_tagger_paused(),
    })
    if "always_included_tools" not in settings_dict:
        from app.tools.selector import _ALWAYS_INCLUDED_JARVIS_TOOLS
        settings_dict["always_included_tools"] = sorted(_ALWAYS_INCLUDED_JARVIS_TOOLS)
    if "blocked_tools" not in settings_dict:
        settings_dict["blocked_tools"] = sorted(config.TOOL_BLACKLIST or [])
    if "included_coder_tools" not in settings_dict:
        from app.tools.selector import _DEFAULT_CODING_TOOLS
        settings_dict["included_coder_tools"] = sorted(_DEFAULT_CODING_TOOLS)
    print(f"[SETTINGS-GET-BE] GET /api/settings → llm_base_url='{settings_dict.get('llm_base_url', '')}' llm_backend='{settings_dict.get('llm_backend', '')}'")
    return settings_dict

@app.post("/api/settings/decrypt-key")
def decrypt_key_endpoint(payload: dict = Body(...)):
    key = payload.get("key", "")
    from app.utils.security import decrypt_api_key
    if key and isinstance(key, str) and key.startswith("enc_v1:"):
        return {"decrypted": decrypt_api_key(key)}
    return {"decrypted": key}

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
    tool_mode: Optional[str] = None
    send_tools_in_simple: Optional[bool] = None
    endpoint_strategy: Optional[str] = None
    llm_simple_backend: Optional[str] = None
    llm_simple_base_url: Optional[str] = None
    llm_simple_api_key: Optional[str] = None
    llm_simple_model: Optional[str] = None
    llm_coder_backend: Optional[str] = None
    llm_coder_base_url: Optional[str] = None
    llm_coder_api_key: Optional[str] = None
    llm_coder_model: Optional[str] = None
    llm_reviewer_enabled: Optional[bool] = None
    llm_reviewer_model: Optional[str] = None
    llm_summary_model: Optional[str] = None
    llm_vision_model: Optional[str] = None
    always_included_tools: Optional[List[str]] = None
    blocked_tools: Optional[List[str]] = None
    included_coder_tools: Optional[List[str]] = None
    codegraph_coder_enabled: Optional[bool] = None
    codegraph_advanced_enabled: Optional[bool] = None
    persistent_chat_history: Optional[bool] = None
    manage_todo_enabled: Optional[bool] = None
    basic_history_token_limit: Optional[int] = None
    basic_history_keep_turns: Optional[int] = None
    advanced_history_token_limit: Optional[int] = None
    advanced_history_keep_turns: Optional[int] = None
    history_summary_percent: Optional[int] = None
    history_summary_position: Optional[str] = None
    whisper_idle_timeout: Optional[int] = None
    whisper_vram_threshold: Optional[float] = None
    whisper_auto_unload: Optional[bool] = None
    # Cloud STT provider
    stt_provider: Optional[str] = None          # "local"|"google"|"azure"|"assemblyai"|"deepgram"|"custom"
    stt_cloud_api_key: Optional[str] = None     # Encrypted in profile
    stt_cloud_endpoint: Optional[str] = None    # Custom provider endpoint URL
    stt_cloud_region: Optional[str] = None      # Azure region, etc.
    # Cloud TTS provider
    tts_provider: Optional[str] = None          # "local"|"google"|"azure"|"elevenlabs"|"openai"|"custom"
    tts_cloud_api_key: Optional[str] = None     # Encrypted in profile
    tts_cloud_endpoint: Optional[str] = None    # Custom provider endpoint URL
    tts_cloud_region: Optional[str] = None      # Azure region, etc.
    tts_cloud_voice: Optional[str] = None       # Voice/model name for cloud TTS
    mood_source: Optional[str] = None           # "script"|"llm" — mood driver mode
    persona_preset: Optional[str] = None        # Preset key
    character_persona: Optional[str] = None     # Section 1 prompt override
    execution_rules: Optional[str] = None       # Section 2 guardrail rules



@app.post("/api/settings/update")
async def update_settings(req: SettingsUpdateRequest):
    """
    Updates the configuration settings at runtime and saves them persistently.
    """
    global tts_online_status
    from app.memory import crawler
    from app.agent.llm_backend import get_backend

    # DEBUG: Log what fields are being updated
    update_fields = {k: v for k, v in req.dict().items() if v is not None}
    print(f"[SETTINGS-UPDATE-BE] ⚡ Received update with {len(update_fields)} fields: {list(update_fields.keys())}")
    if 'llm_api_key' in update_fields:
        print(f"[SETTINGS-UPDATE-BE]   llm_api_key = '{str(update_fields['llm_api_key'])[:20]}...'")
    if 'llm_base_url' in update_fields:
        print(f"[SETTINGS-UPDATE-BE]   llm_base_url = '{update_fields['llm_base_url']}'")
    if 'llm_backend' in update_fields:
        print(f"[SETTINGS-UPDATE-BE]   llm_backend = '{update_fields['llm_backend']}'")
    print(f"[SETTINGS-UPDATE-BE]   BEFORE: llm_base_url='{config.LLM_BASE_URL}' llm_backend='{config.LLM_BACKEND}'")

    backend_switched = False
    captured_old_backend = None
    if req.persistent_chat_history is not None:
        val = bool(req.persistent_chat_history)
        memory_manager.update_setting("persistent_chat_history", val)
        if val:
            await asyncio.to_thread(save_persistent_chat_history, global_chat_history)
    if req.manage_todo_enabled is not None:
        memory_manager.update_setting("manage_todo_enabled", bool(req.manage_todo_enabled))
    if req.persona_preset is not None:
        memory_manager.update_setting("persona_preset", req.persona_preset.strip())
    if req.character_persona is not None:
        memory_manager.update_setting("character_persona", req.character_persona.strip())
    if req.execution_rules is not None:
        memory_manager.update_setting("execution_rules", req.execution_rules.strip())

    if req.basic_history_token_limit is not None:
        memory_manager.update_setting("basic_history_token_limit", int(req.basic_history_token_limit))
    if req.basic_history_keep_turns is not None:
        memory_manager.update_setting("basic_history_keep_turns", int(req.basic_history_keep_turns))
    if req.advanced_history_token_limit is not None:
        memory_manager.update_setting("advanced_history_token_limit", int(req.advanced_history_token_limit))
    if req.advanced_history_keep_turns is not None:
        memory_manager.update_setting("advanced_history_keep_turns", int(req.advanced_history_keep_turns))
    if req.history_summary_percent is not None:
        memory_manager.update_setting("history_summary_percent", max(0, min(100, int(req.history_summary_percent))))
    if req.history_summary_position is not None:
        pos = req.history_summary_position.strip().lower()
        if pos in ("oldest", "middle"):
            memory_manager.update_setting("history_summary_position", pos)
    if req.send_tools_in_simple is not None:
        config.SEND_TOOLS_IN_SIMPLE = bool(req.send_tools_in_simple)
        memory_manager.update_setting("send_tools_in_simple", bool(req.send_tools_in_simple))
    if req.endpoint_strategy is not None:
        strat = req.endpoint_strategy.strip().lower()
        if strat in ("single", "dual"):
            config.ENDPOINT_STRATEGY = strat
            memory_manager.update_setting("endpoint_strategy", strat)
    if req.llm_simple_backend is not None:
        config.LLM_SIMPLE_BACKEND = req.llm_simple_backend.strip()
        memory_manager.update_setting("llm_simple_backend", req.llm_simple_backend.strip())
    if req.llm_simple_base_url is not None:
        config.LLM_SIMPLE_BASE_URL = req.llm_simple_base_url.strip()
        memory_manager.update_setting("llm_simple_base_url", req.llm_simple_base_url.strip())
    if req.llm_simple_model is not None:
        config.LLM_SIMPLE_MODEL = req.llm_simple_model.strip()
        memory_manager.update_setting("llm_simple_model", req.llm_simple_model.strip())
    if req.llm_simple_api_key is not None:
        from app.utils.security import encrypt_api_key, decrypt_api_key
        key_val = req.llm_simple_api_key.strip()
        if key_val:
            if key_val.startswith("enc_v1:") or key_val.startswith("gAAAA"):
                config.LLM_SIMPLE_API_KEY = decrypt_api_key(key_val)
                memory_manager.update_setting("llm_simple_api_key", key_val)
            elif "..." in key_val:
                pass
            else:
                config.LLM_SIMPLE_API_KEY = key_val
                memory_manager.update_setting("llm_simple_api_key", encrypt_api_key(key_val))
        else:
            memory_manager.update_setting("llm_simple_api_key", "")
    if req.llm_coder_backend is not None:
        config.LLM_CODER_BACKEND = req.llm_coder_backend.strip()
        memory_manager.update_setting("llm_coder_backend", req.llm_coder_backend.strip())


# ------------------------------------------------------------------ #
#  Relationship Engine & Persona API Endpoints                      #
# ------------------------------------------------------------------ #

@app.get("/api/personas/presets")
async def get_persona_presets():
    """Returns available persona presets registry."""
    from app.agent.personas import PERSONA_PRESETS, DEFAULT_EXECUTION_RULES
    return {
        "presets": PERSONA_PRESETS,
        "default_execution_rules": DEFAULT_EXECUTION_RULES
    }


@app.get("/api/relationship/status")
async def get_relationship_status_api():
    """Returns current relationship status, level, vectors, inventory, and currency."""
    from app.memory.db import get_relationship_status, get_user_inventory
    from app.memory.mood_engine import calculate_stage_from_xp
    status = get_relationship_status()
    inventory = get_user_inventory()
    status["calculated_stage"] = calculate_stage_from_xp(status.get("affinity_xp", 0))
    status["inventory"] = inventory
    return status


class GiftPurchaseRequest(BaseModel):
    item_id: str
    name: str
    category: str
    cost: int


@app.post("/api/relationship/gift")
async def purchase_gift_api(req: GiftPurchaseRequest):
    """Purchase a gift or item using Star Hearts currency."""
    from app.memory.db import get_relationship_status, update_relationship_status, add_inventory_item
    status = get_relationship_status()
    current_hearts = status.get("star_hearts", 0)
    if current_hearts < req.cost:
        raise HTTPException(status_code=400, detail="Not enough Star Hearts currency")
    
    new_hearts = current_hearts - req.cost
    new_xp = status.get("affinity_xp", 0) + 15
    update_relationship_status({"star_hearts": new_hearts, "affinity_xp": new_xp})
    inv = add_inventory_item(req.item_id, req.name, req.category, quantity=1)
    
    # Direct mood engine affection boost
    mood_engine.adjust({"affection": 15, "happiness": 10})
    return {
        "success": True,
        "star_hearts": new_hearts,
        "affinity_xp": new_xp,
        "inventory": inv
    }

    if req.llm_coder_base_url is not None:
        config.LLM_CODER_BASE_URL = req.llm_coder_base_url.strip()
        memory_manager.update_setting("llm_coder_base_url", req.llm_coder_base_url.strip())
    if req.llm_coder_model is not None:
        config.LLM_CODER_MODEL = req.llm_coder_model.strip()
        memory_manager.update_setting("llm_coder_model", req.llm_coder_model.strip())
    if req.llm_coder_api_key is not None:
        from app.utils.security import encrypt_api_key, decrypt_api_key
        key_val = req.llm_coder_api_key.strip()
        if key_val:
            if "..." in key_val and not ("enc_v1:" in key_val or "gAAAA" in key_val):
                pass
            else:
                decrypted = decrypt_api_key(key_val) if ("enc_v1:" in key_val or "gAAAA" in key_val) else key_val
                config.LLM_CODER_API_KEY = decrypted
                memory_manager.update_setting("llm_coder_api_key", encrypt_api_key(decrypted))
        else:
            config.LLM_CODER_API_KEY = ""
            memory_manager.update_setting("llm_coder_api_key", "")
    if req.llm_reviewer_enabled is not None:
        memory_manager.update_setting("llm_reviewer_enabled", req.llm_reviewer_enabled)
    if req.llm_reviewer_model is not None:
        memory_manager.update_setting("llm_reviewer_model", req.llm_reviewer_model.strip())
    if req.llm_summary_model is not None:
        memory_manager.update_setting("llm_summary_model", req.llm_summary_model.strip())
    if req.tool_mode is not None:
        mode_val = req.tool_mode.strip().lower()
        if mode_val in ("basic", "advanced"):
            config.TOOL_MODE = mode_val
            memory_manager.update_setting("tool_mode", mode_val)
            print(f"[Settings] Tool Operating Mode updated to '{mode_val}'")
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
    if any(k is not None for k in [req.llm_backend, req.llm_base_url, req.llm_api_key, req.llm_simple_backend, req.llm_simple_base_url, req.llm_simple_api_key]):
        invalidate_models_cache()

    if req.llm_base_url is not None:
        config.LLM_BASE_URL = req.llm_base_url.strip()
        memory_manager.update_setting("llm_base_url", req.llm_base_url.strip())
    if req.llm_api_key is not None:
        from app.utils.security import encrypt_api_key, decrypt_api_key
        from app.agent.llm_backend import reset_backend
        key_val = req.llm_api_key.strip()
        if key_val:
            if key_val.startswith("enc_v1:") or key_val.startswith("gAAAA"):
                decrypted = decrypt_api_key(key_val)
                config.LLM_API_KEY = decrypted
                memory_manager.update_setting("llm_api_key", key_val)
            elif "..." in key_val:
                pass
            else:
                config.LLM_API_KEY = key_val
                encrypted = encrypt_api_key(key_val)
                memory_manager.update_setting("llm_api_key", encrypted)
            reset_backend()
        else:
            config.LLM_API_KEY = ""
            memory_manager.update_setting("llm_api_key", "")
            reset_backend()
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
        try:
            from app.memory.optimizer import optimize_all_processes
            optimize_all_processes(force=True)
        except Exception:
            pass
    if req.whisper_model is not None:
        config.WHISPER_MODEL = req.whisper_model.strip()
        memory_manager.update_setting("whisper_model", req.whisper_model.strip())
        from app.voice.stt import reset_whisper
        reset_whisper()
    if req.whisper_compute_type is not None:
        config.WHISPER_COMPUTE_TYPE = req.whisper_compute_type.strip()
        memory_manager.update_setting("whisper_compute_type", req.whisper_compute_type.strip())
        from app.voice.stt import reset_whisper
        reset_whisper()
    if req.whisper_idle_timeout is not None:
        val = max(60, int(req.whisper_idle_timeout))  # minimum 60s
        config.WHISPER_IDLE_TIMEOUT = val
        memory_manager.update_setting("whisper_idle_timeout", val)
    if req.whisper_vram_threshold is not None:
        val = max(50, min(100, float(req.whisper_vram_threshold)))  # clamp 50-100%
        config.WHISPER_VRAM_THRESHOLD = val
        memory_manager.update_setting("whisper_vram_threshold", val)
    if req.whisper_auto_unload is not None:
        config.WHISPER_AUTO_UNLOAD = req.whisper_auto_unload
        memory_manager.update_setting("whisper_auto_unload", req.whisper_auto_unload)
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

    if req.mood_source is not None:
        val = req.mood_source.strip().lower()
        if val in ("script", "llm"):
            memory_manager.update_setting("mood_source", val)

    # ── Cloud STT provider settings ───────────────────────────────────────────
    _VALID_STT_PROVIDERS = {"local", "google", "azure", "assemblyai", "deepgram", "custom"}
    if req.stt_provider is not None:
        prov = req.stt_provider.strip().lower()
        if prov in _VALID_STT_PROVIDERS:
            config.STT_PROVIDER = prov
            memory_manager.update_setting("stt_provider", prov)
    if req.stt_cloud_api_key is not None:
        from app.utils.security import encrypt_api_key, decrypt_api_key
        key_val = req.stt_cloud_api_key.strip()
        if key_val:
            if "..." in key_val and not key_val.startswith("enc_v1:"):
                pass  # masked value — ignore
            else:
                decrypted = decrypt_api_key(key_val) if key_val.startswith("enc_v1:") else key_val
                config.STT_CLOUD_API_KEY = decrypted
                memory_manager.update_setting("stt_cloud_api_key", encrypt_api_key(decrypted))
        else:
            config.STT_CLOUD_API_KEY = ""
            memory_manager.update_setting("stt_cloud_api_key", "")
    if req.stt_cloud_endpoint is not None:
        config.STT_CLOUD_ENDPOINT = req.stt_cloud_endpoint.strip()
        memory_manager.update_setting("stt_cloud_endpoint", req.stt_cloud_endpoint.strip())
    if req.stt_cloud_region is not None:
        memory_manager.update_setting("stt_cloud_region", req.stt_cloud_region.strip())

    # ── Cloud TTS provider settings ───────────────────────────────────────────
    _VALID_TTS_PROVIDERS = {"local", "google", "azure", "elevenlabs", "openai", "custom"}
    if req.tts_provider is not None:
        prov = req.tts_provider.strip().lower()
        if prov in _VALID_TTS_PROVIDERS:
            config.TTS_PROVIDER = prov
            memory_manager.update_setting("tts_provider", prov)
    if req.tts_cloud_api_key is not None:
        from app.utils.security import encrypt_api_key, decrypt_api_key
        key_val = req.tts_cloud_api_key.strip()
        if key_val:
            if "..." in key_val and not key_val.startswith("enc_v1:"):
                pass  # masked value — ignore
            else:
                decrypted = decrypt_api_key(key_val) if key_val.startswith("enc_v1:") else key_val
                config.TTS_CLOUD_API_KEY = decrypted
                memory_manager.update_setting("tts_cloud_api_key", encrypt_api_key(decrypted))
        else:
            config.TTS_CLOUD_API_KEY = ""
            memory_manager.update_setting("tts_cloud_api_key", "")
    if req.tts_cloud_endpoint is not None:
        config.TTS_CLOUD_ENDPOINT = req.tts_cloud_endpoint.strip()
        memory_manager.update_setting("tts_cloud_endpoint", req.tts_cloud_endpoint.strip())
    if req.tts_cloud_region is not None:
        memory_manager.update_setting("tts_cloud_region", req.tts_cloud_region.strip())
    if req.tts_cloud_voice is not None:
        config.TTS_CLOUD_VOICE = req.tts_cloud_voice.strip()
        memory_manager.update_setting("tts_cloud_voice", req.tts_cloud_voice.strip())

    if req.tts_voice is not None or req.tts_rate is not None:
        tts_online_status = True
        new_voice = req.tts_voice.strip() if req.tts_voice is not None else config.TTS_VOICE
        new_rate = req.tts_rate.strip() if req.tts_rate is not None else config.TTS_RATE
        asyncio.create_task(test_and_announce_voice_change(new_voice, new_rate))
    
    await broadcast_profile_update()
    
    if req.llm_vision_model is not None:
        memory_manager.update_setting("llm_vision_model", req.llm_vision_model.strip())

    if req.always_included_tools is not None:
        seen = set()
        clean_tools = []
        for t in req.always_included_tools:
            if not t:
                continue
            name = str(t).strip()
            if name and name not in seen:
                seen.add(name)
                clean_tools.append(name)
        config.ALWAYS_INCLUDED_JARVIS_TOOLS = clean_tools
        memory_manager.update_setting("always_included_tools", clean_tools)
        print(f"[SETTINGS-UPDATE-BE] always_included_tools = {clean_tools}")

    if req.blocked_tools is not None:
        seen = set()
        clean_blocked = []
        for t in req.blocked_tools:
            if not t:
                continue
            name = str(t).strip()
            if name and name not in seen:
                seen.add(name)
                clean_blocked.append(name)
        config.TOOL_BLACKLIST = set(clean_blocked)
        memory_manager.update_setting("blocked_tools", clean_blocked)
        print(f"[SETTINGS-UPDATE-BE] blocked_tools = {clean_blocked}")

    if req.included_coder_tools is not None:
        seen = set()
        clean_coder = []
        for t in req.included_coder_tools:
            if not t:
                continue
            name = str(t).strip()
            if name and name not in seen:
                seen.add(name)
                clean_coder.append(name)
        config.INCLUDED_CODER_TOOLS = clean_coder
        memory_manager.update_setting("included_coder_tools", clean_coder)
        print(f"[SETTINGS-UPDATE-BE] included_coder_tools = {clean_coder}")

    if req.codegraph_coder_enabled is not None:
        memory_manager.update_setting("codegraph_coder_enabled", bool(req.codegraph_coder_enabled))
        print(f"[SETTINGS-UPDATE-BE] codegraph_coder_enabled = {bool(req.codegraph_coder_enabled)}")
    if req.codegraph_advanced_enabled is not None:
        memory_manager.update_setting("codegraph_advanced_enabled", bool(req.codegraph_advanced_enabled))
        print(f"[SETTINGS-UPDATE-BE] codegraph_advanced_enabled = {bool(req.codegraph_advanced_enabled)}")

    import copy
    current_settings = copy.deepcopy(memory_manager.profile.get("settings", {}))
    current_settings.update({
        "llm_model": config.LLM_MODEL,
        "character_name": config.CHARACTER_NAME,
        "character_persona": config.CHARACTER_PERSONA,
        "crawler_paused": crawler.is_crawler_paused(),
        "tagger_paused": crawler.is_tagger_paused(),
    })

    print(f"[SETTINGS-UPDATE-BE]   AFTER:  llm_base_url='{current_settings.get('llm_base_url', '')}' llm_backend='{current_settings.get('llm_backend', '')}'")
    print(f"[SETTINGS-UPDATE-BE] ✅ Returning {len(current_settings)} settings keys")
    return {
        "status": "success",
        "message": "Settings updated successfully.",
        "settings": current_settings
    }


@app.post("/api/chat/attachments/upload")
async def upload_attachment_endpoint(file: UploadFile = File(...)):
    """
    Receives uploaded image or document file, saves it to workspace yuki_attachment/,
    and returns attachment metadata (save_path, data_url for images, text_content for docs).
    """
    try:
        from app.utils.attachment_manager import process_uploaded_attachment
        file_bytes = await file.read()
        res = process_uploaded_attachment(file.filename, file_bytes)
        return {"status": "success", "attachment": res}
    except Exception as e:
        return {"status": "error", "message": f"Upload failed: {str(e)}"}


@app.get("/api/chat/attachments/file")
def get_attachment_file(path: str = ""):
    """
    Serves a previously uploaded attachment file (images/docs) from a yuki_attachment directory.
    Path is validated to only allow files inside such directories for security.
    """
    import os
    from pathlib import Path as PPath
    from fastapi.responses import FileResponse

    if not path:
        return Response(status_code=400, content="Missing path parameter")

    clean_path = os.path.abspath(path.strip().strip('"\''))
    p = PPath(clean_path)
    if not p.exists() or not p.is_file():
        return Response(status_code=404, content="Attachment file not found")

    # Security: only allow serving files that live inside a yuki_attachment directory
    parts = list(p.parts)
    if "yuki_attachment" not in parts:
        return Response(status_code=403, content="Access denied: attachment must be inside a yuki_attachment directory")

    return FileResponse(clean_path, filename=p.name)


@app.post("/api/chat/vision/analyze")
async def analyze_vision_endpoint(payload: dict = Body(...)):
    """
    Analyzes an image file on disk using vision models or fallback vision API.
    """
    image_path = payload.get("image_path", "")
    prompt = payload.get("prompt", "Analyze and describe this image in detail.")
    if not image_path or not os.path.exists(image_path):
        return {"status": "error", "message": f"Image path '{image_path}' not found."}
    
    from app.tools.jarvis import jarvis_analyze_image
    description = jarvis_analyze_image(image_path, prompt=prompt)
    return {"status": "success", "description": description}


class CustomEndpointRequest(BaseModel):
    id: Optional[str] = None
    label: str
    base_url: str
    api_key: Optional[str] = ""
    llm_backend: Optional[str] = "openai"
    coder_model: Optional[str] = None
    reviewer_model: Optional[str] = None
    summary_model: Optional[str] = None


class DeleteCustomEndpointRequest(BaseModel):
    id: Optional[str] = None
    label: Optional[str] = None
    target_type: Optional[str] = "complex"


@app.get("/api/settings/custom-endpoints")
def get_custom_endpoints(decrypt: bool = False):
    """Returns saved custom LLM endpoint configurations."""
    from app.utils.security import mask_api_key, decrypt_api_key
    raw_endpoints = memory_manager.profile["settings"].get("saved_custom_endpoints", [])
    masked_list = []
    for ep in raw_endpoints:
        raw_k = ep.get("api_key", "")
        dec_k = decrypt_api_key(raw_k)
        keys_arr = [k.strip() for k in re.split(r'[,;\s]+', str(dec_k)) if k.strip()]
        masked_list.append({
            "id": ep.get("id", ""),
            "label": ep.get("label", ""),
            "base_url": ep.get("base_url", ""),
            "api_key_masked": mask_api_key(raw_k),
            "api_key_decrypted": dec_k if decrypt else "",
            "keys_array": keys_arr if decrypt else [],
            "has_key": bool(raw_k),
            "llm_backend": ep.get("llm_backend", "openai"),
            "coder_model": ep.get("coder_model", ""),
            "reviewer_model": ep.get("reviewer_model", ""),
            "summary_model": ep.get("summary_model", "")
        })
    return {"endpoints": masked_list}


@app.post("/api/settings/custom-endpoints/save")
async def save_custom_endpoint(req: CustomEndpointRequest):
    """Saves or updates a custom LLM endpoint configuration with encrypted API keys."""
    from app.utils.security import encrypt_api_key, mask_api_key, decrypt_api_key
    import uuid

    label = req.label.strip()
    base_url = req.base_url.strip()
    if not label or not base_url:
        raise HTTPException(status_code=400, detail="Label and Endpoint URL are required.")

    raw_endpoints = memory_manager.profile["settings"].get("saved_custom_endpoints", [])
    ep_id = req.id.strip() if req.id else f"ep_{uuid.uuid4().hex[:8]}"

    # Process API key pool with encryption
    api_key_enc = ""
    if req.api_key:
        k = req.api_key.strip()
        if "..." in k or "•••" in k:
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
        "coder_model": req.coder_model or "",
        "reviewer_model": req.reviewer_model or "",
        "summary_model": req.summary_model or "",
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

    dec_k = decrypt_api_key(api_key_enc)
    keys_arr = [k.strip() for k in re.split(r'[,;\s]+', str(dec_k)) if k.strip()]

    masked_list = []
    for ep in updated_endpoints:
        masked_list.append({
            "id": ep.get("id", ""),
            "label": ep.get("label", ""),
            "base_url": ep.get("base_url", ""),
            "api_key_masked": mask_api_key(ep.get("api_key", "")),
            "has_key": bool(ep.get("api_key")),
            "llm_backend": ep.get("llm_backend", "openai"),
            "coder_model": ep.get("coder_model", ""),
            "reviewer_model": ep.get("reviewer_model", ""),
            "summary_model": ep.get("summary_model", "")
        })

    return {
        "message": f"Saved preset '{label}' successfully.",
        "endpoints": masked_list,
        "saved": new_ep,
        "keys_array": keys_arr,
        "api_key_decrypted": dec_k
    }


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
            "coder_model": ep.get("coder_model", ""),
            "reviewer_model": ep.get("reviewer_model", ""),
            "summary_model": ep.get("summary_model", "")
        })

    return {"message": "Endpoint deleted.", "endpoints": masked_list}


@app.post("/api/settings/custom-endpoints/select")
async def select_custom_endpoint(req: DeleteCustomEndpointRequest):
    """Selects and activates a saved custom endpoint for simple or coder endpoint."""
    from app.utils.security import decrypt_api_key, mask_api_key
    from app.agent.llm_backend import reset_backend

    print(f"[VAULT-SELECT-BE] ⚡ select_custom_endpoint called: id={req.id} label={req.label} target_type={req.target_type}")
    
    raw_endpoints = memory_manager.profile["settings"].get("saved_custom_endpoints", [])
    target_id = req.id.strip() if req.id else ""
    target_label = req.label.strip() if req.label else ""

    ep = next((e for e in raw_endpoints if e.get("id") == target_id or e.get("label") == target_label), None)
    if not ep:
        print(f"[VAULT-SELECT-BE] ❌ Endpoint not found: id={target_id} label={target_label}")
        raise HTTPException(status_code=404, detail="Saved endpoint not found.")

    decrypted_key = decrypt_api_key(ep.get("api_key", ""))
    keys_arr = [k.strip() for k in re.split(r'[,;\s]+', str(decrypted_key)) if k.strip()]
    target_type = req.target_type or "coder"
    
    print(f"[VAULT-SELECT-BE] Found endpoint: label={ep.get('label')} base_url={ep.get('base_url')} llm_backend={ep.get('llm_backend')}")
    print(f"[VAULT-SELECT-BE] Resolved target_type={target_type} (req.target_type={req.target_type})")
    print(f"[VAULT-SELECT-BE] Decrypted key count: {len(keys_arr)} keys")

    if target_type == "simple":
        print(f"[VAULT-SELECT-BE] Saving to SIMPLE config: LLM_SIMPLE_BASE_URL={ep.get('base_url')}")
        config.LLM_SIMPLE_BACKEND = ep.get("llm_backend", "openai")
        config.LLM_SIMPLE_BASE_URL = ep.get("base_url", "")
        config.LLM_SIMPLE_API_KEY = decrypted_key

        memory_manager.update_setting("llm_simple_backend", config.LLM_SIMPLE_BACKEND)
        memory_manager.update_setting("llm_simple_base_url", config.LLM_SIMPLE_BASE_URL)
        memory_manager.update_setting("llm_simple_api_key", ep.get("api_key", ""))
    elif target_type == "coder":
        print(f"[VAULT-SELECT-BE] Saving to CODER config: LLM_CODER_BASE_URL={ep.get('base_url')}")
        config.LLM_CODER_BACKEND = ep.get("llm_backend", "custom")
        config.LLM_CODER_BASE_URL = ep.get("base_url", "")
        config.LLM_CODER_API_KEY = decrypted_key
        if ep.get("coder_model"):
            config.LLM_CODER_MODEL = ep.get("coder_model")
            memory_manager.update_setting("llm_coder_model", ep.get("coder_model"))

        memory_manager.update_setting("llm_coder_backend", config.LLM_CODER_BACKEND)
        memory_manager.update_setting("llm_coder_base_url", config.LLM_CODER_BASE_URL)
        memory_manager.update_setting("llm_coder_api_key", ep.get("api_key", ""))
        if ep.get("reviewer_model"):
            memory_manager.update_setting("llm_reviewer_model", ep.get("reviewer_model"))
        if ep.get("summary_model"):
            memory_manager.update_setting("llm_summary_model", ep.get("summary_model"))

        reset_backend()
    else:
        # "complex" or any other value → save to MAIN LLM config (AI Brain vault)
        print(f"[VAULT-SELECT-BE] Saving to MAIN config: LLM_BASE_URL={ep.get('base_url')}")
        config.LLM_BACKEND = ep.get("llm_backend", "custom")
        config.LLM_BASE_URL = ep.get("base_url", "")
        config.LLM_API_KEY = decrypted_key

        memory_manager.update_setting("llm_backend", config.LLM_BACKEND)
        memory_manager.update_setting("llm_base_url", config.LLM_BASE_URL)
        memory_manager.update_setting("llm_api_key", ep.get("api_key", ""))

        reset_backend()

    invalidate_models_cache()
    await broadcast_profile_update()
    
    print(f"[VAULT-SELECT-BE] ✅ Response: base_url={ep.get('base_url')} backend={ep.get('llm_backend')}")
    return {
        "message": f"Activated preset '{ep.get('label')}' for {target_type}",
        "active_endpoint": ep,
        "masked_key": mask_api_key(ep.get("api_key", "")),
        "api_key_decrypted": decrypted_key,
        "keys_array": keys_arr,
        "target_type": target_type,
        "backend": ep.get("llm_backend", "openai"),
        "base_url": ep.get("base_url", ""),
        "coder_model": ep.get("coder_model", ""),
        "reviewer_model": ep.get("reviewer_model", ""),
        "summary_model": ep.get("summary_model", "")
    }

@app.get("/api/tts")
async def tts_endpoint(text: str, voice: Optional[str] = None, rate: Optional[str] = None):
    """
    Generates audio for the given text.
    Routes to cloud/custom TTS when tts_provider != 'local'.
    On cloud failure, returns 202 + X-TTS-Fallback: web so the frontend
    can use browser speechSynthesis as a fallback.
    """
    if not text:
        return Response(status_code=400, content="Text query parameter is required.")

    decoded_text = urllib.parse.unquote(text)
    settings = memory_manager.profile.get("settings", {})
    tts_provider = settings.get("tts_provider", "local")

    # ── Cloud / Custom provider path ──────────────────────────────────────────
    if tts_provider and tts_provider != "local":
        from app.voice.cloud_tts import synthesize_via_cloud_provider, TTSProviderError
        from app.utils.security import decrypt_api_key
        import re as _re

        raw_key  = settings.get("tts_cloud_api_key", "")
        api_key  = decrypt_api_key(raw_key) if raw_key else getattr(config, "TTS_CLOUD_API_KEY", "")
        endpoint = settings.get("tts_cloud_endpoint", "") or getattr(config, "TTS_CLOUD_ENDPOINT", "")
        region   = settings.get("tts_cloud_region", "eastus")
        cvoice   = settings.get("tts_cloud_voice", "") or getattr(config, "TTS_CLOUD_VOICE", "")
        # Parse rate to float ('auto' resolves against live mood)
        rate_str = _resolve_tts_rate(rate)
        try:
            speed = float(_re.sub(r"[^\d.+\-]", "", str(rate_str)) or "1.0")
        except Exception:
            speed = 1.0

        try:
            audio_bytes = await asyncio.wait_for(
                synthesize_via_cloud_provider(
                    decoded_text,
                    provider=tts_provider,
                    api_key=api_key,
                    endpoint=endpoint,
                    region=region,
                    voice=cvoice,
                    speaking_rate=speed,
                ),
                timeout=30.0
            )
            media = "audio/wav" if audio_bytes[:4] == b"RIFF" else "audio/mpeg"
            return Response(content=audio_bytes, media_type=media)
        except TTSProviderError as e:
            print(f"[TTS] Cloud provider '{tts_provider}' failed, signalling web fallback: {e}")
            # 202 signals the frontend to use browser speechSynthesis
            return Response(
                status_code=202,
                content=decoded_text,
                media_type="text/plain",
                headers={"X-TTS-Fallback": "web", "X-TTS-Error": str(e)[:200]},
            )

    # ── Local Kokoro path ─────────────────────────────────────────────────────
    if not tts_online_status:
        return Response(status_code=500, content="TTS service is currently offline.")

    from app.voice.tts import generate_speech_bytes
    audio_bytes = await generate_speech_bytes(decoded_text, voice=voice, rate=_resolve_tts_rate(rate))

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
    Receives an audio blob and transcribes it.
    Routes to cloud/custom STT provider when stt_provider != 'local',
    otherwise uses local faster-whisper. On cloud failure, returns a 503
    with a user-friendly error message (no silent fallback for STT).
    """
    import tempfile
    import os
    import uuid

    settings = memory_manager.profile.get("settings", {})
    active_lang = settings.get("stt_language", "en")
    stt_provider = settings.get("stt_provider", "local")

    try:
        content = await file.read()
        if not content or len(content) < 1000:
            return {"text": ""}

        # ── Cloud / Custom provider path ──────────────────────────────────────
        if stt_provider and stt_provider != "local":
            from app.voice.cloud_stt import transcribe_via_cloud_provider, STTProviderError
            from app.utils.security import decrypt_api_key

            raw_key = settings.get("stt_cloud_api_key", "")
            api_key = decrypt_api_key(raw_key) if raw_key else getattr(config, "STT_CLOUD_API_KEY", "")
            endpoint = settings.get("stt_cloud_endpoint", "") or getattr(config, "STT_CLOUD_ENDPOINT", "")
            region   = settings.get("stt_cloud_region", "eastus")

            try:
                transcript = await asyncio.wait_for(
                    transcribe_via_cloud_provider(
                        content,
                        provider=stt_provider,
                        api_key=api_key,
                        endpoint=endpoint,
                        region=region,
                        language=active_lang,
                    ),
                    timeout=35.0
                )
                print(f"[STT] Transcribed via '{stt_provider}' ({len(content)} bytes) → '{transcript}'")
                return {"text": transcript or ""}
            except STTProviderError as e:
                print(f"[STT] Cloud provider '{stt_provider}' failed: {e}")
                return Response(
                    status_code=503,
                    content=str(e),
                    media_type="text/plain"
                )

        # ── Local Whisper path ────────────────────────────────────────────────
        from app.voice.stt import transcribe_audio_file

        saved_model  = settings.get("whisper_model")
        active_model = saved_model or getattr(config, "WHISPER_MODEL", None) or model or "base"
        active_compute = settings.get("whisper_compute_type", "int8_float16")

        temp_dir  = tempfile.gettempdir()
        temp_path = os.path.join(temp_dir, f"yuki_voice_{uuid.uuid4().hex}.webm")
        try:
            with open(temp_path, "wb") as f:
                f.write(content)
            transcript = await transcribe_audio_file(
                temp_path,
                model_size=active_model,
                compute_type=active_compute,
                language=active_lang
            )
            if transcript and transcript.strip():
                print(f"[STT] Transcribed ({len(content)} bytes) using model '{active_model}' ({active_compute}) → '{transcript}'")
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

    except Exception as e:
        print(f"[STT] Unexpected error in transcribe endpoint: {e}")
        return {"text": ""}


@app.post("/api/speech/status")
async def speech_status(req: dict):
    msg = req.get("message", "")
    if msg == "listening_mode_on":
        from app.voice.stt import set_listening_mode
        set_listening_mode(True)
    elif msg == "listening_mode_off":
        from app.voice.stt import set_listening_mode
        set_listening_mode(False)
    print(f"[STT Frontend] {msg}")
    return {"status": "ok"}

@app.get("/api/tools")
async def get_tools_list(mode: Optional[str] = None):
    """
    Returns registered tool definitions based on mode ('basic', 'advanced', 'all', or default active TOOL_MODE),
    including name, description, parameters schema, and category.
    """
    from app.tools.definitions import get_basic_tools_definition, get_advanced_jarvis_tools_definition, get_tools_definition
    
    if mode == "basic":
        tools = get_basic_tools_definition()
    elif mode == "advanced":
        tools = get_advanced_jarvis_tools_definition()
    elif mode == "all":
        basic = get_basic_tools_definition()
        adv = get_advanced_jarvis_tools_definition()
        existing = {t.get("function", {}).get("name") for t in basic if isinstance(t, dict)}
        tools = list(basic) + [t for t in adv if t.get("function", {}).get("name") not in existing]
    else:
        tools = get_tools_definition()
    
    # Also merge any active MCP tools if available
    if agent_executor and hasattr(agent_executor, "mcp_tools"):
        try:
            mcp_defs = await agent_executor.mcp_tools.get_tool_definitions("", dynamic=False)
            existing_names = {t.get("function", {}).get("name") for t in tools if isinstance(t, dict)}
            for m_tool in mcp_defs:
                m_name = m_tool.get("function", {}).get("name")
                if m_name and m_name not in existing_names:
                    tools.append(m_tool)
        except Exception:
            pass

    # In 'all' mode, also surface legacy tools that are registered directly on the
    # executor (self.tools) but have no formal LLM schema (e.g. get_current_datetime,
    # take_screenshot, control_window, list_directory). Keeps the tester comprehensive.
    if mode == "all" and agent_executor is not None:
        try:
            known = {t.get("function", {}).get("name") for t in tools if isinstance(t, dict)}
            exec_tools = getattr(agent_executor, "tools", {}) or {}
            for legacy_name in sorted(exec_tools):
                if legacy_name not in known:
                    tools.append({
                        "type": "function",
                        "function": {
                            "name": legacy_name,
                            "description": "Legacy in-process tool registered directly in AgentExecutor.tools (no formal LLM schema). Arguments are free-form keyword arguments — use the JSON editor or check the Code tab.",
                            "parameters": {"type": "object", "properties": {}}
                        }
                    })
        except Exception:
            pass
    
    formatted = []
    for t in tools:
        fn = t.get("function", {})
        name = fn.get("name", "")
        desc = fn.get("description", "")
        params = fn.get("parameters", {})
        
        # Categorize tools cleanly
        category = "System & OS"
        if name in ("update_user_fact", "jarvis_remember_user_fact"):
            category = "Memory & User Facts"
        elif name in ("web_search", "read_file_content", "search_files", "list_directory", "jarvis_query_file_db", "jarvis_web_search", "jarvis_web_scrape"):
            category = "Information & Search"
        elif name in ("launch_app", "open_or_play_file", "media_playback_control", "set_system_volume", "jarvis_launch_app", "jarvis_open_or_play_file", "jarvis_system_volume", "jarvis_media_playback_control", "jarvis_take_screenshot", "keyboard_mouse_input"):
            category = "Media & Control"
        elif name in ("jarvis_analyze_image", "jarvis_see_screen", "take_screenshot"):
            category = "Vision & Media"
        elif name in ("run_terminal_command", "run_python_script", "create_file", "edit_file", "delete_file", "jarvis_read_file", "jarvis_create_or_edit_file", "jarvis_list_dir_tree", "jarvis_git_status", "jarvis_run_terminal", "jarvis_run_python"):
            category = "Code & Filesystem"
        elif name in ("jarvis_system_diagnostics", "jarvis_network_status", "jarvis_window_control", "jarvis_system_power", "system_power_control", "manage_process", "jarvis_manage_timer_stopwatch_alarms", "manage_timer_stopwatch_alarms", "jarvis_close_app", "get_current_datetime", "control_window"):
            category = "Diagnostics & Automation"
            
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


@app.post("/api/tools/run")
async def run_tool_direct(payload: dict = Body(...)):
    """
    Directly executes a registered tool by name with the provided arguments.

    Testing/diagnostic endpoint used by the tool tester page (testing/tool_tester.html).
    Routes through the exact same pipeline the agent uses: `_run_tool_async` →
    safety preflight (`authorize_tool_call`) → MCP stdio bridge (if enabled) →
    local in-process dispatcher. Returns the raw tool output string.
    """
    global agent_executor
    if agent_executor is None:
        return {
            "ok": False,
            "error": "Agent executor is not initialized yet. Try again in a few seconds.",
        }

    tool_name = str(
        payload.get("name") or payload.get("tool_name") or payload.get("tool") or ""
    ).strip()

    raw_args = payload.get("arguments")
    if raw_args is None:
        raw_args = payload.get("args")
    if isinstance(raw_args, str):
        try:
            raw_args = json.loads(raw_args)
        except Exception:
            return {"ok": False, "tool": tool_name, "error": "arguments must be a JSON object."}
    if not isinstance(raw_args, dict):
        raw_args = {}

    if not tool_name:
        return {"ok": False, "error": "Missing required field: tool name ('name')."}

    mode = str(payload.get("mode") or "assistant").strip().lower()
    if mode not in ("assistant", "advanced", "coder"):
        mode = "assistant"

    t0 = time.time()
    try:
        result = await agent_executor._run_tool_async(tool_name, raw_args, mode=mode)
        elapsed_ms = int((time.time() - t0) * 1000)
        lowered = str(result or "").strip().lower()
        is_error = lowered.startswith(("error:", "error executing", "failed:"))
        return {
            "ok": not is_error,
            "tool": tool_name,
            "arguments": raw_args,
            "result": result or "",
            "duration_ms": elapsed_ms,
            "mode": mode,
        }
    except Exception as e:
        elapsed_ms = int((time.time() - t0) * 1000)
        return {
            "ok": False,
            "tool": tool_name,
            "arguments": raw_args,
            "result": f"Error: {e}",
            "error": str(e),
            "duration_ms": elapsed_ms,
            "mode": mode,
        }


@app.get("/api/tools/source")
def get_tools_source():
    """
    Returns the Python source of the tool implementation modules so the
    tool tester page can show the actual code behind every tool.
    """
    modules = [
        "app/agent/executor.py",
        "app/tools/definitions.py",
        "app/tools/system.py",
        "app/tools/files.py",
        "app/tools/jarvis.py",
        "app/tools/web.py",
        "app/tools/todo_list.py",
        "app/tools/selector.py",
        "app/tools/safety.py",
    ]
    out = {}
    for rel in modules:
        p = config.BASE_DIR / rel
        if p.exists():
            try:
                out[rel] = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                out[rel] = ""
    return {"modules": out}


@app.get("/tool-tester")
def serve_tool_tester():
    """
    Serves the testing/tool_tester.html page straight from the repository so it
    can be opened at http://localhost:58392/tool-tester without any CORS issues.
    """
    from fastapi.responses import FileResponse
    tester_path = config.BASE_DIR.parent / "testing" / "tool_tester.html"
    if tester_path.exists():
        return FileResponse(str(tester_path))
    return Response(status_code=404, content="tool_tester.html not found in testing/ folder")


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
    Background heartbeat running every 60 seconds.
    Kept for future use if needed, but time_manager now handles timer triggers natively via asyncio.
    """
    while True:
        await asyncio.sleep(60)

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


@app.post("/api/reminders/stopwatch/reset")
def reset_stopwatch(req: StopwatchRequest):
    """
    Resets a stopwatch's elapsed time to zero directly from the Tasks UI.
    """
    from app.tools import time_manager
    res = time_manager.reset_stopwatch(req.label or "default")
    return {"status": "ok", "stopwatch": res}

# ── Scheduled Tasks API (autonomous delayed / interval / watcher tasks) ──────────

_SCHEDULED_POWER_ACTIONS = {"shutdown", "restart", "reboot", "lock", "sleep", "hibernate", "logoff", "signout"}
_SCHEDULED_MONITOR_TYPES = {"process", "window", "file", "command"}
_SCHEDULED_CONDITIONS_BY_MONITOR = {
    "process": ["gone", "present"],
    "window": ["closed", "open"],
    "file": ["changed", "exists", "deleted"],
    "command": ["exit0", "exit_nonzero"],
}


def _validate_scheduled_action(action_type, action_command, action_tool, action_args, confirm_destructive):
    """Returns an error string when the fired action is invalid, else None.

    Mirrors the LLM-path safety gate: destructive fired actions (power, power
    tools, destructive shell commands) require explicit ``confirm_destructive``
    confirmation once at creation.
    """
    action_type = (action_type or "shell").lower().strip()
    action_args = dict(action_args or {})
    if action_type == "power":
        power_action = str(action_args.get("action") or "").lower().strip()
        if power_action not in _SCHEDULED_POWER_ACTIONS:
            return (
                f"Invalid power action '{power_action}'. Allowed: "
                f"{', '.join(sorted(_SCHEDULED_POWER_ACTIONS))}."
            )
        if not confirm_destructive:
            return f"This will {power_action} the PC when triggered. Confirm to proceed."
        return None
    if action_type == "tool":
        if not action_tool:
            return "Missing 'action_tool' for a tool action."
        if agent_executor is not None:
            resolved = agent_executor._resolve_tool_name(action_tool)
            if action_tool not in agent_executor.tools and resolved not in agent_executor.tools:
                return f"Unknown scheduled action tool '{action_tool}'."
    elif action_type == "shell":
        if not action_command:
            return "Missing 'action_command' for a shell action."
    elif action_type not in ("shell", "tool", "power"):
        return f"Unknown action_type '{action_type}' (use shell, tool, or power)."
    if not confirm_destructive:
        from app.tools.safety import _scheduled_task_needs_confirmation
        if _scheduled_task_needs_confirmation({
            "action": "set_delayed",
            "action_type": action_type,
            "action_command": action_command,
            "action_tool": action_tool,
            "action_args": action_args,
        }):
            return "This action is destructive. Confirm to proceed."
    return None


class ScheduledTaskBaseRequest(BaseModel):
    action_type: Optional[str] = "shell"
    action_command: Optional[str] = None
    action_tool: Optional[str] = None
    action_args: Optional[Dict[str, Any]] = None
    confirm_destructive: Optional[bool] = False


class ScheduledDelayedRequest(ScheduledTaskBaseRequest):
    seconds: Optional[float] = None


class ScheduledIntervalRequest(ScheduledTaskBaseRequest):
    interval_seconds: Optional[float] = None
    count: Optional[int] = None


class ScheduledWatcherRequest(ScheduledTaskBaseRequest):
    monitor_type: str = ""
    target: str = ""
    interval_seconds: Optional[float] = 30
    fire_condition: Optional[str] = None
    count: Optional[int] = None


class ScheduledCancelRequest(BaseModel):
    item_id: int


@app.get("/api/scheduled-tasks")
def list_scheduled_tasks(active_only: bool = True):
    """
    Lists active (or all, with active_only=false) scheduled tasks.
    """
    from app.tools import scheduled_tasks
    return scheduled_tasks.list_tasks(active_only=active_only)


@app.post("/api/scheduled-tasks/delayed")
def create_scheduled_delayed(req: ScheduledDelayedRequest):
    """
    Creates a one-shot task that fires its action after `seconds`.
    """
    if agent_executor is None:
        return {"ok": False, "error": "Agent executor is not initialized yet."}
    from app.tools import scheduled_tasks
    try:
        seconds = float(req.seconds or 0)
    except (ValueError, TypeError):
        seconds = 0.0
    if seconds <= 0:
        return {"ok": False, "error": "'seconds' must be a positive number."}
    err = _validate_scheduled_action(req.action_type, req.action_command, req.action_tool, req.action_args, bool(req.confirm_destructive))
    if err:
        return {"ok": False, "error": err}
    res = scheduled_tasks.add_delayed(
        seconds,
        action_type=req.action_type,
        action_command=req.action_command,
        action_tool=req.action_tool,
        action_args=req.action_args or {},
    )
    return {"ok": True, "task": res}


@app.post("/api/scheduled-tasks/interval")
def create_scheduled_interval(req: ScheduledIntervalRequest):
    """
    Creates a recurring task that fires its action every `interval_seconds`.
    `count` is optional; when omitted the task repeats forever.
    """
    if agent_executor is None:
        return {"ok": False, "error": "Agent executor is not initialized yet."}
    from app.tools import scheduled_tasks
    try:
        interval_seconds = float(req.interval_seconds or 0)
    except (ValueError, TypeError):
        interval_seconds = 0.0
    if interval_seconds <= 0:
        return {"ok": False, "error": "'interval_seconds' must be a positive number."}
    err = _validate_scheduled_action(req.action_type, req.action_command, req.action_tool, req.action_args, bool(req.confirm_destructive))
    if err:
        return {"ok": False, "error": err}
    res = scheduled_tasks.add_interval(
        interval_seconds,
        count=req.count,
        action_type=req.action_type,
        action_command=req.action_command,
        action_tool=req.action_tool,
        action_args=req.action_args or {},
    )
    return {"ok": True, "task": res}


@app.post("/api/scheduled-tasks/watcher")
def create_scheduled_watcher(req: ScheduledWatcherRequest):
    """
    Creates a watcher that polls `monitor_type` every `interval_seconds` and
    fires its action when `fire_condition` holds.
    """
    if agent_executor is None:
        return {"ok": False, "error": "Agent executor is not initialized yet."}
    from app.tools import scheduled_tasks
    monitor = (req.monitor_type or "").lower().strip()
    target = str(req.target or "").strip()
    if monitor not in _SCHEDULED_MONITOR_TYPES:
        return {"ok": False, "error": f"Invalid monitor_type '{monitor}'. Allowed: {', '.join(sorted(_SCHEDULED_MONITOR_TYPES))}."}
    if not target:
        return {"ok": False, "error": "'target' is required for a watcher."}
    allowed_conditions = _SCHEDULED_CONDITIONS_BY_MONITOR[monitor]
    condition = (req.fire_condition or allowed_conditions[0]).lower().strip()
    if condition not in allowed_conditions:
        return {"ok": False, "error": f"Invalid fire_condition '{condition}' for {monitor}. Allowed: {', '.join(allowed_conditions)}."}
    try:
        interval_seconds = float(req.interval_seconds or 30)
    except (ValueError, TypeError):
        interval_seconds = 30.0
    if interval_seconds <= 0:
        return {"ok": False, "error": "'interval_seconds' must be a positive number."}
    err = _validate_scheduled_action(req.action_type, req.action_command, req.action_tool, req.action_args, bool(req.confirm_destructive))
    if err:
        return {"ok": False, "error": err}
    res = scheduled_tasks.add_watcher(
        monitor_type=monitor,
        target=target,
        interval_seconds=interval_seconds,
        fire_condition=condition,
        count=req.count,
        action_type=req.action_type,
        action_command=req.action_command,
        action_tool=req.action_tool,
        action_args=req.action_args or {},
    )
    return {"ok": True, "task": res}


@app.post("/api/scheduled-tasks/cancel")
def cancel_scheduled_task(req: ScheduledCancelRequest):
    """
    Cancels/deactivates a scheduled task by item_id.
    """
    from app.tools import scheduled_tasks
    try:
        res = scheduled_tasks.cancel_task(int(req.item_id))
        return {"ok": True, "task": res}
    except Exception as e:
        return {"ok": False, "error": str(e)}

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
def get_profile(decrypt_keys: bool = False):
    """
    Returns the current user profile state.
    If decrypt_keys is True, returns decrypted API keys so the UI eye toggle can reveal the actual key.
    Otherwise returns masked keys (e.g. sk-p...7890).
    """
    import copy, platform
    from app.utils.security import decrypt_api_key, mask_api_key

    profile = copy.deepcopy(memory_manager.profile)
    settings = profile.get("settings", {})

    for key_name in ["llm_api_key", "llm_coder_api_key", "llm_simple_api_key", "llm_complex_api_key"]:
        raw = settings.get(key_name, "")
        if raw:
            if decrypt_keys:
                settings[key_name] = decrypt_api_key(raw)
            else:
                settings[key_name] = mask_api_key(raw)
        else:
            settings[key_name] = ""

    profile["platform"] = f"{platform.system()} {platform.release()}"
    return profile

# ── Export & Import Endpoints (Persona, App Settings & Crawler Data) ─

@app.get("/api/persona/export")
def export_persona():
    """
    Exports persona specifications and profile facts as a downloadable JSON file.
    """
    data = memory_manager.export_persona_data()
    char_name = data.get("persona", {}).get("character_name", "Yuki")
    filename = f"{char_name}_persona.json"
    return Response(
        content=json.dumps(data, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.post("/api/persona/import")
async def import_persona(payload: dict = Body(...)):
    """
    Imports persona specifications, facts, and mood spectrum.
    """
    try:
        updated_profile = memory_manager.import_persona_data(payload)
        await broadcast_profile_update()
        return {"status": "ok", "message": "Persona imported successfully.", "profile": updated_profile}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/settings/export")
def export_settings():
    """
    Exports all application settings (with decrypted keys for portability) as JSON.
    """
    data = memory_manager.export_settings_data()
    return Response(
        content=json.dumps(data, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="yuki_settings.json"'}
    )

@app.post("/api/settings/import")
async def import_settings(payload: dict = Body(...)):
    """
    Imports application settings JSON and updates system configuration.
    """
    try:
        updated_settings = memory_manager.import_settings_data(payload)
        await broadcast_profile_update()
        return {"status": "ok", "message": "Settings imported successfully.", "settings": updated_settings}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/crawler/export")
def export_crawler_data():
    """
    Exports indexed file database records, metadata tags, and crawler state as JSON.
    """
    from app.memory.db import export_crawler_database_json
    try:
        data = export_crawler_database_json()
        return Response(
            content=json.dumps(data, indent=2, ensure_ascii=False),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="yuki_crawler_data.json"'}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/crawler/import")
async def import_crawler_data(payload: dict = Body(...)):
    """
    Imports crawler file index and metadata JSON into SQLite database.
    """
    from app.memory.db import import_crawler_database_json
    try:
        result = import_crawler_database_json(payload)
        return {"status": "ok", "message": "Crawler database imported successfully.", "stats": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


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
            "tts_rate": "auto",
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
            "whisper_idle_timeout": 300,
            "whisper_vram_threshold": 90,
            "whisper_auto_unload": True,
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
    config.WHISPER_IDLE_TIMEOUT = default_profile["settings"]["whisper_idle_timeout"]
    config.WHISPER_VRAM_THRESHOLD = default_profile["settings"]["whisper_vram_threshold"]
    config.WHISPER_AUTO_UNLOAD = default_profile["settings"]["whisper_auto_unload"]
    
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
    (Whisper model is intentionally NOT unloaded here to avoid cold-load delays on next STT use.)
    """
    try:
        from app.memory.optimizer import optimize_all_processes
        optimize_all_processes(force=True)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


class PowerStateRequest(BaseModel):
    state: str  # "suspend", "lock", "resume", "unlock"


@app.post("/api/system/power_state")
async def handle_power_state_endpoint(req: PowerStateRequest):
    """
    Handles OS system power events (lock, unlock, suspend, resume).
    Unloads AI/voice models to free VRAM & RAM on lock/suspend, and reloads them on unlock/resume.
    """
    st = req.state.strip().lower()
    print(f"[PowerManager] OS Power Event received: '{st}'")

    if st in ("suspend", "lock"):
        # 1. Unload Whisper STT model from VRAM/RAM
        try:
            from app.voice.stt import unload_whisper_if_idle
            unload_whisper_if_idle(force=True)
        except Exception as e:
            print(f"[PowerManager] Whisper unload failed: {e}")

        # 2. Reset Kokoro TTS engine session
        try:
            from app.voice.tts import reset_kokoro
            reset_kokoro()
        except Exception as e:
            print(f"[PowerManager] Kokoro reset failed: {e}")

        # 3. Force Python GC and CUDA VRAM cache clear
        import gc
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

        # 4. Trim Windows Working Set RAM
        try:
            from app.memory.optimizer import optimize_all_processes
            optimize_all_processes(force=True)
        except Exception:
            pass

        print(f"[PowerManager] Unloaded STT & TTS models and purged VRAM/RAM for state '{st}'.")
        return {"status": "unloaded", "state": st}

    elif st in ("resume", "unlock"):
        # Re-warm models if preloading is configured
        stt_preload = memory_manager.profile.get("settings", {}).get("stt_preload", getattr(config, 'STT_PRELOAD', True))
        tts_preload = memory_manager.profile.get("settings", {}).get("tts_preload", getattr(config, 'TTS_PRELOAD', True))

        if stt_preload:
            asyncio.create_task(_warmup_whisper())
        if tts_preload:
            asyncio.create_task(_warmup_tts())

        print(f"[PowerManager] Re-initiated STT/TTS model warm-up for state '{st}'.")
        return {"status": "reloading", "state": st}

    return {"status": "ignored", "state": st}


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
        # Search only database files of category song or video
        try:
            raw_candidates = query_database_union(parsed, limit_raw=500, categories=["song", "video"], silent=True)
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
                print("[WebSocket] Interrupt request received. Killing active supervisor subprocesses & cancelling chat task.")
                try:
                    from app.tools.system import kill_active_supervisor_processes
                    killed_count = kill_active_supervisor_processes()
                    print(f"[WebSocket] Terminated {killed_count} active supervisor subprocess(es).")
                except Exception as e:
                    print(f"[WebSocket] Error killing active supervisor processes: {e}")

                if chat_task and not chat_task.done():
                    chat_task.cancel()
                    try:
                        await chat_task
                    except asyncio.CancelledError:
                        pass
                    chat_task = None
                await websocket.send_json({
                    "type": "turn_interrupted",
                    "status": "idle",
                    "message": "Turn terminated by user!"
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
                    # Hold the optimizer's own-process trim for the whole turn:
                    # LLM streaming + all TTS synthesis must not have model pages
                    # paged out mid-turn (the guard clears on cancel/interrupt too).
                    with own_process_busy_guard():
                        try:
                            user_msg = payload_data.get("message", "").strip()
                            is_startup_greeting = bool(payload_data.get("is_startup_greeting") or "[SYSTEM EVENT:" in user_msg)
                            stt_time_ms = payload_data.get("stt_time_ms")
                            if not user_msg:
                                return
                            turn_id = None
                            print(f"[WebSocket] Received chat message: '{user_msg}' (startup={is_startup_greeting})")
                            
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

                            is_coding_mode = bool(payload_data.get("overrides", {}).get("coding_mode", False))

                            def queue_sentence(sentence_text, idx):
                                nonlocal tts_tasks_event, stream_done_flag
                                if not tts_online_status or is_coding_mode:
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
                                            audio_bytes = await asyncio.wait_for(generate_speech_bytes(speech_text, rate=_resolve_tts_rate()), timeout=30.0)
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
                                        await broadcast_ws_event(result)
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
                                            await broadcast_ws_event({"type": "error", "content": "Agent is still initializing, please try again in a moment."})
                                            return
                                        overrides = payload_data.get("overrides") or {}
                                        overrides = dict(overrides)
                                        import uuid
                                        turn_id = uuid.uuid4().hex[:12]
                                        overrides["turn_id"] = turn_id
                                        if not overrides.get("session_id"):
                                            overrides["session_id"] = active_session_id
                                        # Tag voice-originated turns so the executor can require
                                        # confirmation for destructive operations (listening mode safety)
                                        if stt_time_ms is not None:
                                            overrides["from_voice"] = True
                                        attachments = payload_data.get("attachments") or []
                                        gen = agent_executor.execute_chat_turn_stream(user_msg, global_chat_history, overrides=overrides, attachments=attachments)
                                        # First crash-recovery checkpoint: prior history + the new user message (unless startup prompt).
                                        if not is_startup_greeting:
                                            try:
                                                from app.memory import db as memory_db
                                                await asyncio.to_thread(memory_db.save_incomplete_turn, turn_id, list(global_chat_history) + [{"role": "user", "content": user_msg}])
                                            except Exception as _cp_err:
                                                print(f"[Recovery] Initial checkpoint failed: {_cp_err}")
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
                                                    await broadcast_ws_event({
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
                                                    await broadcast_ws_event({
                                                        "type": "text_stream",
                                                        "text": value,
                                                        "backend_used": backend_used,
                                                        "final": True
                                                    })

                                                    # Batch into sentences for TTS (skipping <thought>/<think>/<reasoning> blocks)
                                                    sentence_buffer += value
                                                    while True:
                                                        sentence_buffer = re.sub(r'<(thought|think|reasoning)>[\s\S]*?</\1>', '', sentence_buffer, flags=re.IGNORECASE)
                                                        if re.search(r'<(thought|think|reasoning)>(?![\s\S]*?</\1>)', sentence_buffer, flags=re.IGNORECASE):
                                                            break
                                                        boundary = find_sentence_boundary(sentence_buffer)
                                                        if boundary == -1:
                                                            break
                                                        sentence = sentence_buffer[:boundary + 1].strip()
                                                        sentence_buffer = sentence_buffer[boundary + 1:]
                                                        clean_s = re.sub(r'<(thought|think|reasoning)>[\s\S]*?(?:<\/\1>|$)', '', sentence, flags=re.IGNORECASE).strip()
                                                        if clean_s:
                                                            queue_sentence(clean_s, audio_idx)
                                                            audio_idx += 1

                                                elif event_type == "thinking":
                                                    # Intermediate thinking/narration text (e.g. before a tool call).
                                                    # Broadcast for display-only UIs (Agentic Workspace) but never
                                                    # sent to TTS so only the final reply is spoken.
                                                    await broadcast_ws_event({
                                                        "type": "text_stream",
                                                        "text": value,
                                                        "backend_used": backend_used,
                                                        "final": False
                                                    })

                                                elif event_type == "tool_start":
                                                    tool_start_time = time.time()
                                                    tool_name = value.get("name") if isinstance(value, dict) else str(value)
                                                    tool_args = value.get("args") if isinstance(value, dict) else {}
                                                    args_str = ""
                                                    if tool_args and isinstance(tool_args, dict):
                                                        parts = [f"{k}={repr(v)}" for k, v in tool_args.items() if k != "confirmation_grant_id"]
                                                        args_str = f" ({', '.join(parts)})" if parts else ""

                                                    await broadcast_ws_event({
                                                        "type": "tool_start",
                                                        "tool_name": tool_name,
                                                        "tool_args": tool_args
                                                    })
                                                    await broadcast_ws_event({
                                                        "type": "status",
                                                        "status": "thinking",
                                                        "message": f"Running tool '{tool_name}'{args_str}...",
                                                        "tool_name": tool_name,
                                                        "tool_args": tool_args
                                                    })
                                                elif event_type == "tool_result":
                                                    if tool_start_time is not None:
                                                        tool_duration += time.time() - tool_start_time
                                                        tool_start_time = None
                                                    # Notify frontend tool finished
                                                    await broadcast_ws_event({
                                                        "type": "tool_result",
                                                        "result": value
                                                    })
                                                    await broadcast_ws_event({
                                                        "type": "status",
                                                        "status": "thinking"
                                                    })
                                                elif event_type == "checkpoint":
                                                    if turn_id:
                                                        try:
                                                            from app.memory import db as memory_db
                                                            await asyncio.to_thread(memory_db.save_incomplete_turn, turn_id, value)
                                                        except Exception as _cp_err:
                                                            print(f"[Recovery] Checkpoint persist failed: {_cp_err}")
                                                elif event_type == "final_history":
                                                    if is_startup_greeting:
                                                        # Filter out system event prompt from persistent history
                                                        global_chat_history = [m for m in value if not (m.get("role") == "user" and "[SYSTEM EVENT:" in m.get("content", ""))]
                                                    else:
                                                        global_chat_history = value
                                                    await asyncio.to_thread(save_persistent_chat_history, global_chat_history)
                                                    await broadcast_ws_event({
                                                        "type": "chat_update",
                                                        "messages": global_chat_history,
                                                        "session_id": active_session_id
                                                    })
                                                    # Turn completed normally — remove the temp recovery session.
                                                    if turn_id:
                                                        try:
                                                            from app.memory import db as memory_db
                                                            await asyncio.to_thread(memory_db.delete_incomplete_turn, turn_id)
                                                        except Exception as _del_err:
                                                            print(f"[Recovery] Cleanup of temp turn failed: {_del_err}")

                                                event = await gen.__anext__()
                                    except StopAsyncIteration:
                                        pass
                                except Exception as e:
                                    import traceback
                                    print(f"Error during stream generation: {e}")
                                    traceback.print_exc()
                                    friendly_error = await agent_executor.get_friendly_error_explanation(str(e))
                                    await websocket.send_json({"type": "error", "message": friendly_error})

                                # Feed any remaining text in sentence buffer
                                clean_remaining = re.sub(r'<(thought|think|reasoning)>[\s\S]*?(?:<\/\1>|$)', '', sentence_buffer, flags=re.IGNORECASE).strip()
                                if clean_remaining:
                                    queue_sentence(clean_remaining, audio_idx)
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

                            # Send final stream done message containing total time to all connected clients
                            await broadcast_ws_event({
                                "type": "stream_done",
                                "backend_used": backend_used,
                                "response_time": round(elapsed_time, 2),
                                "is_coding_mode": is_coding_mode
                            })

                            # Push profile update to all connected clients
                            await broadcast_ws_event({
                                "type": "profile_update",
                                "profile": memory_manager.profile
                            })
                        except asyncio.CancelledError:
                            print("[WebSocket] Chat turn was cancelled/interrupted.")
                            # Send status to frontend that we are idle now
                            try:
                                await broadcast_ws_event({"type": "status", "status": "idle"})
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

                        # Hold the optimizer's own-process trim while synthesizing so
                        # the Kokoro model pages stay resident across all sentences.
                        with own_process_busy_guard():
                            # Now synthesize and send each sentence sequentially
                            from app.voice.tts import generate_speech_bytes
                            audio_idx = 0
                            for sentence in sentences:
                                speech_text = make_speech_friendly(sentence)
                                if not re.sub(r'[^\w\s]', '', speech_text).strip():
                                    continue
                                try:
                                    audio_bytes = await asyncio.wait_for(generate_speech_bytes(speech_text, rate=_resolve_tts_rate()), timeout=40.0)
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

# ---------------------------------------------------------------------------
# Chat Session History REST APIs
# ---------------------------------------------------------------------------
@app.get("/api/chat/sessions")
async def get_chat_sessions():
    """Returns hierarchical tree of past chat sessions (Year -> Month -> Date)."""
    try:
        from app.memory.db import get_hierarchical_chat_sessions
        data = get_hierarchical_chat_sessions()
        return {"status": "success", "active_session_id": active_session_id, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/chat/sessions/{session_id}")
async def get_chat_session_history(session_id: str):
    """Returns full message history for a specific past session."""
    try:
        from app.memory.db import get_session_messages
        messages = get_session_messages(session_id)
        return {"status": "success", "session_id": session_id, "messages": messages}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

async def broadcast_ws_event(payload: dict):
    for ws in list(active_websockets):
        try:
            await ws.send_json(payload)
        except Exception as e:
            pass

class ActivateSessionRequest(BaseModel):
    session_id: str

@app.post("/api/chat/sessions/activate")
async def activate_chat_session_api(req: ActivateSessionRequest):
    """
    Promotes a past session to be the Global Active Session in backend.
    Loads its message history into memory and broadcasts session_switched event over WebSockets.
    """
    global active_session_id, global_chat_history
    if not req.session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")
    
    from app.memory.db import get_session_messages
    msgs = await asyncio.to_thread(get_session_messages, req.session_id)
    active_session_id = req.session_id
    global_chat_history = msgs
    await asyncio.to_thread(save_persistent_chat_history, global_chat_history)
    
    # Broadcast session switch event to all connected WebSocket clients
    await broadcast_ws_event({
        "type": "session_switched",
        "session_id": active_session_id,
        "messages": global_chat_history
    })
    
    print(f"[Session] Activated session: {active_session_id} ({len(global_chat_history)} messages)")
    return {"status": "success", "session_id": active_session_id, "messages": global_chat_history}

@app.post("/api/chat/sessions/new")
async def create_new_chat_session():
    """Starts a new chat session."""
    global active_session_id, global_chat_history
    active_session_id = generate_new_session_id()
    global_chat_history = []
    await asyncio.to_thread(save_persistent_chat_history, global_chat_history)
    print(f"[Session] Started new user session: {active_session_id}")
    
    await broadcast_ws_event({
        "type": "session_switched",
        "session_id": active_session_id,
        "messages": []
    })
    return {"status": "success", "session_id": active_session_id, "messages": []}

@app.delete("/api/chat/sessions/{session_id}")
async def delete_chat_session_by_id(session_id: str):
    """Deletes a past session."""
    try:
        from app.memory.db import delete_chat_session
        await asyncio.to_thread(delete_chat_session, session_id)
        return {"status": "success", "deleted": session_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/chat/sessions/{session_id}/meta")
async def get_session_metadata_api(session_id: str):
    """Fetches custom facts and workspace directories for a specific session."""
    from app.memory.db import get_session_meta
    return await asyncio.to_thread(get_session_meta, session_id)

@app.post("/api/chat/sessions/{session_id}/meta")
async def save_session_metadata_api(session_id: str, payload: dict = Body(...)):
    """Saves or updates a custom fact or workspace directory for a specific session."""
    from app.memory.db import save_session_meta
    meta_type = payload.get("type", "fact")
    meta_key = payload.get("key", "").strip()
    meta_value = payload.get("value", "").strip()
    if not meta_key or not meta_value:
        raise HTTPException(status_code=400, detail="key and value are required")
    await asyncio.to_thread(save_session_meta, session_id, meta_type, meta_key, meta_value)
    return {"status": "success", "session_id": session_id, "meta_type": meta_type, "meta_key": meta_key, "meta_value": meta_value}

@app.delete("/api/chat/sessions/{session_id}/meta")
async def delete_session_metadata_api(session_id: str, meta_type: str, meta_key: str):
    """Deletes a custom fact or workspace directory entry for a specific session."""
    from app.memory.db import delete_session_meta
    await asyncio.to_thread(delete_session_meta, session_id, meta_type, meta_key)
    return {"status": "success", "session_id": session_id, "meta_type": meta_type, "meta_key": meta_key}

@app.get("/api/debug/threads")
def debug_threads():
    import traceback
    result = {}
    for thread_id, frame in sys._current_frames().items():
        result[str(thread_id)] = [f"{f.filename}:{f.lineno} ({f.name})" for f in traceback.extract_stack(frame)]
    return result

@app.get("/api/canvas/serve-file")
async def serve_html_file(path: str = ""):
    """Serve an HTML file from an absolute path (keeps relative deps working)."""
    import os
    from starlette.responses import FileResponse
    if not path:
        raise HTTPException(status_code=400, detail="Missing path parameter")
    clean = os.path.normpath(path.strip().strip('"\''))
    if not os.path.isfile(clean):
        raise HTTPException(status_code=404, detail=f"File not found: {clean}")
    if not clean.lower().endswith((".html", ".htm")):
        raise HTTPException(status_code=403, detail="Only .html/.htm files are allowed")
    print(f"[Canvas] Serving external HTML: {clean}")
    return FileResponse(clean, media_type="text/html")

@app.get("/api/canvas/{filename:path}")
async def serve_canvas_file(filename: str):
    """Serve canvas HTML files and relative static assets from yuki_attachment/canvas/."""
    import os
    import mimetypes
    from starlette.responses import FileResponse
    from app.config import BASE_DIR
    file_path = os.path.normpath(os.path.join(str(BASE_DIR), "yuki_attachment", "canvas", filename))
    print(f"[Canvas] Serving {filename} (exists={os.path.isfile(file_path)})")
    if os.path.isfile(file_path):
        media_type, _ = mimetypes.guess_type(file_path)
        return FileResponse(file_path, media_type=media_type or "text/html")
    raise HTTPException(status_code=404, detail="Canvas file not found")



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
