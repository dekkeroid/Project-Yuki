import base64
import time
import urllib.parse
import asyncio
import re
import sys
import logging
import requests as http_requests
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from typing import List, Dict, Optional

# Silence periodic telemetry polling logs from clogging the terminal console
class TelemetryLogFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return (
            "/api/system/pcstat" not in msg and 
            "/api/crawler/status" not in msg and 
            "/api/speech/status" not in msg and 
            "/api/speech/transcribe" not in msg
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
from app.voice.tts import generate_speech_bytes
from app.memory.crawler import start_crawler_services
from app.tools.system import get_detailed_stats
from app.tools.safety import approve_pending_confirmation, authorize_tool_call, issue_pending_confirmation

app = FastAPI(title="Yuki Desktop Assistant Backend", version="1.0.0")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permits frontend dev server to connect
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize singletons for the session
memory_manager = MemoryManager()
agent_executor = AgentExecutor(memory_manager)

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
            return "Error: Unable to connect to the local backend server."
        if "timeout" in lower:
            return "Error: A timeout occurred while contacting the server."
        if ":" in normalized:
            return normalized.split(":", 1)[0].strip() + "."
        return normalized

    # Replace raw IP addresses with localhost for speech clarity.
    normalized = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "localhost", normalized)
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

@app.on_event("startup")
async def check_tts_connectivity():
    global tts_online_status
    print("Initializing background crawler and file indexing database...")
    try:
        # Sync crawler state on startup from settings profile
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

        start_crawler_services()
    except Exception as e:
        print(f"Failed to start crawler services: {e}")

    # ---- NEW: DYNAMIC LM STUDIO AUTO-LOAD CALL ----
    if not getattr(config, 'NO_LLM_MODE', False):
        print(f"Verifying brain state. Checking if model '{config.LLM_MODEL}' is loaded in LM Studio...")
        # Trigger our newly created helper function asynchronously
        await agent_executor.ensure_model_loaded(config.LLM_MODEL)
    else:
        print("NO_LLM_MODE is enabled. Skipping LLM auto-load on startup.")
    # -----------------------------------------------

    if config.TOOL_TRANSPORT == "mcp-stdio":
        print("Verifying stdio MCP tool bridge...")
        mcp_ready = await agent_executor.mcp_tools.ensure_connected()
        if not mcp_ready:
            message = f"Stdio MCP tool bridge failed to start: {agent_executor.mcp_tools.last_error}"
            if config.MCP_FALLBACK_TO_LOCAL:
                print(f"{message}. Falling back to local tool dispatcher.")
            else:
                raise RuntimeError(message)

    print("Initializing local Kokoro-ONNX neural TTS engine...")
    try:
        # Verify local model initialization and speech generation (large timeout for initial load/download)
        audio_bytes = await asyncio.wait_for(generate_speech_bytes("hi"), timeout=25.0)
        if audio_bytes:
            print("Local Kokoro neural voice engine loaded successfully and active.")
            tts_online_status = True
            return
    except Exception as e:
        print(f"Local Kokoro neural voice engine failed to load: {e}")
    
    print("Offline local neural TTS service is unavailable. Enabling offline browser fallback by default.")
    tts_online_status = False


@app.on_event("shutdown")
async def shutdown_mcp_tool_bridge():
    await agent_executor.mcp_tools.aclose()


async def test_and_announce_voice_change(new_voice: str, new_rate: str = None):
    global tts_online_status
    try:
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
        "lmstudio_url": config.LMSTUDIO_URL
    }

@app.get("/api/models")
def get_available_models():
    """
    Returns the dynamically loaded list of models from LM Studio,
    falling back to a curated list if LM Studio is offline.
    """
    try:
        response = http_requests.get(f"{config.LMSTUDIO_URL}/v1/models", timeout=3.0)
        if response.status_code == 200:
            data = response.json()
            models_data = data.get("data", [])
            models = [{"name": m["id"], "type": "lmstudio"} for m in models_data if "id" in m]
            
            # Ensure the currently active model is in the list
            active_model = config.LLM_MODEL
            if active_model and not any(m["name"] == active_model for m in models):
                models.insert(0, {"name": active_model, "type": "lmstudio"})
                
            return {"models": models, "active": active_model}
    except Exception as e:
        print(f"[Backend] Failed to fetch models from LM Studio: {e}. Falling back to default list.")
        
    fallback_models = [
        {"name": config.LLM_MODEL, "type": "lmstudio"},
        {"name": "llama-3.2-3b-instruct", "type": "lmstudio"},
        {"name": "nvidia/nemotron-3-nano-4b", "type": "lmstudio"}
    ]
    # Deduplicate
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
    Dynamically scans the frontend models folder and returns all available .vrm files.
    """
    import os
    from app.config import BASE_DIR
    
    # Try typical development path
    models_dir = BASE_DIR.parent / "frontend" / "public" / "models"
    
    if not models_dir.exists():
        # Fallback to current directory models folder if packaged differently
        models_dir = BASE_DIR / "models"
        
    if not models_dir.exists():
        return {"models": ["default.vrm"]}
        
    try:
        files = [f for f in os.listdir(models_dir) if f.lower().endswith(".vrm")]
        # Sort alphabetically, but make sure "default.vrm" is first
        if "default.vrm" in files:
            files.remove("default.vrm")
            files = ["default.vrm"] + sorted(files)
        else:
            files = sorted(files)
        return {"models": files}
    except Exception as e:
        print(f"Error listing VRM models: {e}")
        return {"models": ["default.vrm"]}

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
    from app.memory.crawler import is_crawler_paused, is_tagger_paused
    return {
        "llm_model": config.LLM_MODEL,
        "tts_voice": config.TTS_VOICE,
        "tts_rate": config.TTS_RATE,
        "character_name": config.CHARACTER_NAME,
        "character_persona": config.CHARACTER_PERSONA,
        "crawler_paused": is_crawler_paused(),
        "tagger_paused": is_tagger_paused(),
        "active_vrm_model": memory_manager.profile["settings"].get("active_vrm_model", "default.vrm"),
        "whisper_model": memory_manager.profile["settings"].get("whisper_model", "base"),
        "whisper_compute_type": memory_manager.profile["settings"].get("whisper_compute_type", "int8_float16"),
        "use_local_whisper": memory_manager.profile["settings"].get("use_local_whisper", True),
        "stt_language": memory_manager.profile["settings"].get("stt_language", "en"),
        "no_llm_mode": memory_manager.profile["settings"].get("no_llm_mode", False)
    }

class SettingsUpdateRequest(BaseModel):
    llm_model: Optional[str] = None
    tts_voice: Optional[str] = None
    tts_rate: Optional[str] = None
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

@app.post("/api/settings/update")
async def update_settings(req: SettingsUpdateRequest):
    """
    Updates the configuration settings at runtime and saves them persistently.
    """
    global tts_online_status
    from app.memory import crawler
    if req.llm_model is not None:
        memory_manager.update_setting("llm_model", req.llm_model.strip())
    if req.tts_voice is not None:
        memory_manager.update_setting("tts_voice", req.tts_voice.strip())
    if req.tts_rate is not None:
        memory_manager.update_setting("tts_rate", req.tts_rate.strip())
    if req.character_name is not None:
        memory_manager.update_setting("character_name", req.character_name.strip())
    if req.character_persona is not None:
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
        memory_manager.update_setting("whisper_model", req.whisper_model.strip())
    if req.whisper_compute_type is not None:
        memory_manager.update_setting("whisper_compute_type", req.whisper_compute_type.strip())
    if req.use_local_whisper is not None:
        memory_manager.update_setting("use_local_whisper", req.use_local_whisper)
    if req.stt_language is not None:
        memory_manager.update_setting("stt_language", req.stt_language.strip())
    if req.no_llm_mode is not None:
        was_no_llm = memory_manager.profile["settings"].get("no_llm_mode", False)
        memory_manager.update_setting("no_llm_mode", req.no_llm_mode)
        if was_no_llm and not req.no_llm_mode:
            print(f"Loading LLM model '{config.LLM_MODEL}' as no_llm_mode was unchecked...")
            asyncio.create_task(agent_executor.ensure_model_loaded(config.LLM_MODEL))
    if req.dynamic_tool_calling is not None:
        memory_manager.update_setting("dynamic_tool_calling", req.dynamic_tool_calling)
        
    if req.tts_voice is not None or req.tts_rate is not None:
        tts_online_status = True
        new_voice = req.tts_voice.strip() if req.tts_voice is not None else config.TTS_VOICE
        new_rate = req.tts_rate.strip() if req.tts_rate is not None else config.TTS_RATE
        asyncio.create_task(test_and_announce_voice_change(new_voice, new_rate))
    
    await broadcast_profile_update()
    
    return {
        "message": "Settings updated successfully.",
        "settings": {
            "llm_model": config.LLM_MODEL,
            "tts_voice": config.TTS_VOICE,
            "tts_rate": config.TTS_RATE,
            "character_name": config.CHARACTER_NAME,
            "character_persona": config.CHARACTER_PERSONA,
            "crawler_paused": crawler.is_crawler_paused(),
            "tagger_paused": crawler.is_tagger_paused(),
            "active_vrm_model": memory_manager.profile["settings"].get("active_vrm_model", "default.vrm"),
            "whisper_model": memory_manager.profile["settings"].get("whisper_model", "base"),
            "whisper_compute_type": memory_manager.profile["settings"].get("whisper_compute_type", "int8_float16"),
            "use_local_whisper": memory_manager.profile["settings"].get("use_local_whisper", True),
            "stt_language": memory_manager.profile["settings"].get("stt_language", "en"),
            "no_llm_mode": memory_manager.profile["settings"].get("no_llm_mode", False),
            "dynamic_tool_calling": memory_manager.profile["settings"].get("dynamic_tool_calling", True)
        }
    }

@app.get("/api/tts")
async def tts_endpoint(text: str, voice: Optional[str] = None):
    """
    Generates WAV audio for the given text and streams it back.
    The frontend can play this directly by setting an Audio src.
    """
    if not text:
        return Response(status_code=400, content="Text query parameter is required.")
    
    if not tts_online_status:
        return Response(status_code=500, content="TTS service is currently offline.")
        
    decoded_text = urllib.parse.unquote(text)
    audio_bytes = await generate_speech_bytes(decoded_text, voice=voice)
    
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
        audio_bytes = await asyncio.wait_for(generate_speech_bytes(test_text, voice=test_voice, rate=test_rate), timeout=15.0)
        if not audio_bytes:
            return Response(status_code=500, content="Failed to generate speech audio.")
        return Response(content=audio_bytes, media_type="audio/wav")
    except Exception as e:
        return Response(status_code=500, content=f"TTS test failed: {e}")

@app.post("/api/speech/transcribe")
async def transcribe_endpoint(file: UploadFile = File(...), model: Optional[str] = None):
    """
    Receives an audio blob, writes it to a temp file, transcribes it using local Whisper, 
    and returns the transcribed text.
    """
    import tempfile
    import os
    import uuid
    from app.voice.stt import transcribe_audio_file
    
    active_model = model or memory_manager.profile["settings"].get("whisper_model", "base")
    active_lang = memory_manager.profile["settings"].get("stt_language", "en")
    active_compute = memory_manager.profile["settings"].get("whisper_compute_type", "int8_float16")
    
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, f"yuki_voice_{uuid.uuid4().hex}.webm")
    
    try:
        # Write uploaded bytes to temp file
        with open(temp_path, "wb") as f:
            f.write(await file.read())
            
        transcript = await transcribe_audio_file(
            temp_path, 
            model_size=active_model, 
            compute_type=active_compute, 
            language=active_lang
        )
        if transcript.strip():
            print(f"[STT] Transcribed ({file.size or 0} bytes) using model '{active_model}' ({active_compute}) -> '{transcript}'")
        return {"text": transcript}
    except Exception as e:
        print(f"[STT] Endpoint Error: {e}")
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

@app.get("/api/profile")
def get_profile():
    """
    Returns the current user profile state.
    """
    return memory_manager.profile

class ProfileUpdateRequest(BaseModel):
    user_name: Optional[str] = None
    user_interests: Optional[List[str]] = None
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
            "tts_voice": "bf_isabella",
            "tts_rate": "1.0",
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
            "stt_language": "en"
        }
    }
    # Reset config variables to defaults as well
    config.LLM_MODEL = default_profile["settings"]["llm_model"]
    config.TTS_VOICE = default_profile["settings"]["tts_voice"]
    config.TTS_RATE = default_profile["settings"]["tts_rate"]
    config.CHARACTER_NAME = default_profile["settings"]["character_name"]
    config.CHARACTER_PERSONA = default_profile["settings"]["character_persona"]
    
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
        return get_detailed_stats()
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/system/suggestions")
def get_search_suggestions(query: str, type: str):
    """
    Returns search suggestions for `/open` or `/play` commands.
    """
    import os
    from app.tools.system import _get_uwp_apps
    from app.tools.files import query_database_union, _density_score, _is_safe_path

    clean_query = query.strip()
    if not clean_query:
        return {"suggestions": []}

    words = [w.lower() for w in clean_query.split() if w.strip()]
    parsed = {
        "title": words,
        "path": [],
        "genre": [],
        "episode": None
    }

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
            if len(unique_results) >= 20:
                break
                
    return {"suggestions": unique_results}


class OpenPlayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    play_mode: bool = False
    force: bool = False
    pending_confirmation_id: Optional[str] = None


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
        app_path = _find_app_path(clean) if not req.play_mode else None
        if app_path:
            resolved_path = app_path
        else:
            resolved_path = resolve_best_file_no_llm(clean, play_mode=req.play_mode)

    target = resolved_path if resolved_path else req.query
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
                        
                        def queue_sentence(sentence_text, idx):
                            nonlocal tts_tasks_event, stream_done_flag
                            if not tts_online_status:
                                return
                                
                            async def synth():
                                global tts_online_status
                                if not tts_online_status:
                                    return None
                                try:
                                    speech_text = make_speech_friendly(sentence_text)
                                    # Use a timeout of 10.0 seconds for local Kokoro call (longer for first call)
                                    t_start = time.time()
                                    print(f"[TTS][QUEUE] Queued TTS idx={idx} text='{sentence_text[:80]}' speech_text='{speech_text[:80]}'")
                                    # Mark which backend we expect to use at the time of synthesis
                                    expected_backend = 'kokoro' if tts_online_status else 'backend-disabled'
                                    audio_bytes = await asyncio.wait_for(generate_speech_bytes(speech_text), timeout=10.0)
                                    t_elapsed = time.time() - t_start
                                    if audio_bytes:
                                        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                                        audio_url = f"data:audio/wav;base64,{audio_base64}"
                                        print(f"[TTS][DONE] idx={idx} backend={expected_backend} time_ms={int(t_elapsed*1000)} text='{speech_text[:80]}'")
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
                                    print(f"TTS Synthesis timeout/error for '{sentence_text}': {e}. Disabling backend TTS.")
                                    tts_online_status = False
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
                                if getattr(config, 'NO_LLM_MODE', False):
                                    async def no_llm_gen():
                                        yield "token", "sorry, LLM is currently turned off", "local"
                                        updated_history = global_chat_history + [
                                            {"role": "user", "content": user_msg},
                                            {"role": "assistant", "content": "sorry, LLM is currently turned off"}
                                        ]
                                        yield "final_history", updated_history, "local"
                                    gen = no_llm_gen()
                                else:
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
                # Synthesise a short system message via Kokoro TTS without calling the LLM
                tts_text = data.get("text", "").strip()
                expression = data.get("expression", None)
                if tts_text and tts_online_status:
                    try:
                        speech_text = make_speech_friendly(tts_text)
                        audio_bytes = await asyncio.wait_for(generate_speech_bytes(speech_text), timeout=8.0)
                        if audio_bytes:
                            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                            audio_url = f"data:audio/wav;base64,{audio_base64}"
                            await websocket.send_json({
                                "type": "audio_chunk",
                                "audio_url": audio_url,
                                "index": 0,
                                "text": tts_text,
                                "speech_text": speech_text,
                                "tts_backend": "kokoro",
                                "tts_time_ms": 0,
                                "expression": expression
                            })
                    except Exception as e:
                        print(f"[TTS-Only] Synthesis error: {e}")
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
        try:
            friendly_error = await agent_executor.get_friendly_error_explanation(str(e))
            await websocket.send_json({"type": "error", "message": friendly_error})
        except Exception:
            pass
    finally:
        if chat_task and not chat_task.done():
            chat_task.cancel()
        if websocket in active_websockets:
            active_websockets.remove(websocket)
