import base64
import time
import urllib.parse
import asyncio
import re
import sys
import logging
import requests as http_requests
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional

# Silence periodic telemetry polling logs from clogging the terminal console
class TelemetryLogFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return "/api/system/pcstat" not in msg and "/api/crawler/status" not in msg

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
    Returns the curated list of available models.
    """
    models = [
        {"name": "ministra-3", "type": "lmstudio"},
        {"name": "nvidia/nemotron-3-nano-4b", "type": "lmstudio"}
    ]
    return {"models": models, "active": config.LLM_MODEL}

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
        "tagger_paused": is_tagger_paused()
    }

class SettingsUpdateRequest(BaseModel):
    llm_model: Optional[str] = None
    tts_voice: Optional[str] = None
    tts_rate: Optional[str] = None
    character_name: Optional[str] = None
    character_persona: Optional[str] = None
    crawler_paused: Optional[bool] = None
    tagger_paused: Optional[bool] = None

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
        
    if req.tts_voice is not None or req.tts_rate is not None:
        tts_online_status = True
        asyncio.create_task(check_tts_connectivity())
    
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
            "tagger_paused": crawler.is_tagger_paused()
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
            "llm_model": "ministra-3",
            "tts_voice": "af_sarah",
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
            "tagger_paused": True
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
    
    try:
        while True:
            # Wait for text data from frontend
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            if msg_type == "chat":
                user_msg = data.get("message", "").strip()
                if not user_msg:
                    continue
                    
                # 1. Send status indicating Yuki is thinking
                await websocket.send_json({"type": "status", "status": "thinking"})
                
                start_time = time.time()
                
                # Parallel TTS Queue
                tts_tasks = []
                tts_tasks_event = asyncio.Event()
                stream_done_flag = False
                
                def queue_sentence(sentence_text, idx):
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
                        async for event_type, value, label in agent_executor.execute_chat_turn_stream(user_msg, global_chat_history):
                            backend_used = label
                            if event_type == "token":
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
                                # Notify frontend about tool call execution
                                await websocket.send_json({
                                    "type": "status",
                                    "status": "thinking",
                                    "message": f"Running tool '{value}'..."
                                })
                            elif event_type == "tool_result":
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
        if websocket in active_websockets:
            active_websockets.remove(websocket)
