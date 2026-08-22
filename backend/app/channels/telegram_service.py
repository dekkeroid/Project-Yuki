"""
Telegram Bot Service for Project Yuki.
Pure async HTTP implementation using httpx (zero external library dependency).
Provides bidirectional mobile access, two-way voice notes, photos/vision,
live tool execution visibility, file/folder transfers, interactive tool approvals,
and proactive alarm/reminder push notifications.
"""

import os
import sys
import io
import time
import re
import uuid
import shutil
import zipfile
import json
import asyncio
import logging
from typing import Optional, List, Dict, Any, Tuple
from pathlib import Path

import httpx

from app import config
from app.utils.attachment_manager import (
    get_attachment_directory,
    is_image_file,
    is_text_file,
    encode_image_to_base64_url,
    extract_file_text_content,
    sanitize_filename
)

logger = logging.getLogger("yuki.telegram")

# Global Service State
_running_polling_task: Optional[asyncio.Task] = None
_stop_event: asyncio.Event = asyncio.Event()
_agent_executor_ref = None
_memory_manager_ref = None
_active_confirmations: Dict[str, asyncio.Future] = {}
_chat_histories: Dict[int, List[Dict[str, str]]] = {}
_chat_text_only: Dict[int, bool] = {}
_known_chat_ids: set = set()
_current_active_chat_id: Optional[int] = None

_SESSIONS_FILE = os.path.join(config.BASE_DIR, "telegram_sessions.json")


def _load_persisted_sessions():
    """Load Telegram chat histories and text-only modes from disk on startup."""
    global _chat_histories, _chat_text_only, _known_chat_ids
    if not os.path.exists(_SESSIONS_FILE) or os.path.getsize(_SESSIONS_FILE) == 0:
        return
    try:
        with open(_SESSIONS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                histories = data.get("histories", {})
                for k, v in histories.items():
                    try:
                        cid = int(k)
                        _chat_histories[cid] = list(v)
                        _known_chat_ids.add(cid)
                    except Exception:
                        pass
                text_only = data.get("text_only", {})
                for k, v in text_only.items():
                    try:
                        _chat_text_only[int(k)] = bool(v)
                    except Exception:
                        pass
                print(f"[Telegram] Restored chat history for {len(_chat_histories)} session(s).")
    except Exception as e:
        print(f"[Telegram] Warning: Could not restore persisted sessions: {e}")


def _save_persisted_sessions():
    """Save Telegram chat histories and settings to disk."""
    try:
        data = {
            "histories": {str(k): v[-30:] for k, v in _chat_histories.items()},
            "text_only": {str(k): v for k, v in _chat_text_only.items()}
        }
        with open(_SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Telegram] Warning: Could not persist sessions to disk: {e}")


# Initialize persisted sessions on load
_load_persisted_sessions()

_bot_status_cache: Dict[str, Any] = {
    "status": "offline",
    "username": "",
    "first_name": "",
    "error": "",
    "last_started": 0
}


def set_service_dependencies(executor, memory_manager):
    """Binds the active AgentExecutor and MemoryManager instances."""
    global _agent_executor_ref, _memory_manager_ref
    _agent_executor_ref = executor
    _memory_manager_ref = memory_manager


def _get_executor():
    global _agent_executor_ref
    if _agent_executor_ref is not None:
        return _agent_executor_ref
    try:
        from app import main
        if getattr(main, "agent_executor", None) is not None:
            _agent_executor_ref = main.agent_executor
            return _agent_executor_ref
    except Exception:
        pass
    return None


def _get_memory_manager():
    global _memory_manager_ref
    if _memory_manager_ref is not None:
        return _memory_manager_ref
    try:
        from app import main
        if getattr(main, "memory_manager", None) is not None:
            _memory_manager_ref = main.memory_manager
            return _memory_manager_ref
    except Exception:
        pass
    return None


def get_telegram_status() -> Dict[str, Any]:
    """Returns current status of the Telegram bot service."""
    global _running_polling_task, _bot_status_cache
    is_running = (_running_polling_task is not None and not _running_polling_task.done())
    return {
        "enabled": getattr(config, "TELEGRAM_ENABLED", False),
        "running": is_running,
        "username": _bot_status_cache.get("username", ""),
        "first_name": _bot_status_cache.get("first_name", ""),
        "status": "online" if is_running else ("error" if _bot_status_cache.get("error") else "offline"),
        "error": _bot_status_cache.get("error", ""),
        "allowed_users": getattr(config, "TELEGRAM_ALLOWED_USERS", "")
    }


async def test_bot_token(token: str) -> Dict[str, Any]:
    """Validates a bot token with Telegram getMe API using httpx."""
    if not token or not token.strip():
        return {"status": "error", "message": "No Bot Token provided to test."}
    
    clean_token = token.strip()
    url = f"https://api.telegram.org/bot{clean_token}/getMe"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            data = resp.json()
            if data.get("ok"):
                result = data.get("result", {})
                username = result.get("username", "")
                first_name = result.get("first_name", "")
                return {
                    "status": "success",
                    "username": username,
                    "first_name": first_name,
                    "id": result.get("id"),
                    "message": f"Successfully connected as @{username} ({first_name})"
                }
            else:
                return {
                    "status": "error",
                    "message": f"Telegram API error: {data.get('description', 'Invalid token')}"
                }
    except Exception as e:
        return {"status": "error", "message": f"Connection test failed: {str(e)}"}


def is_user_authorized(user_dict: dict) -> bool:
    """Verifies whether the sender matches the configured whitelist."""
    if not user_dict:
        return False
    allowed_str = getattr(config, "TELEGRAM_ALLOWED_USERS", "").strip()
    if not allowed_str:
        return False
    
    allowed_tokens = [t.strip().lower().lstrip("@") for t in allowed_str.split(",") if t.strip()]
    user_id_str = str(user_dict.get("id", "")).lower()
    user_name_str = (user_dict.get("username") or "").lower().lstrip("@")
    
    return (user_id_str in allowed_tokens) or (user_name_str in allowed_tokens)


# ── Telegram HTTP API Client Helpers ──────────────────────────────────────────

class TelegramClient:
    def __init__(self, token: str):
        self.token = token
        self.base_url = f"https://api.telegram.org/bot{token}"
        self.file_base_url = f"https://api.telegram.org/file/bot{token}"

    async def get_me(self, client: httpx.AsyncClient) -> dict:
        r = await client.get(f"{self.base_url}/getMe")
        return r.json()

    async def get_updates(self, client: httpx.AsyncClient, offset: int, timeout: int = 25) -> dict:
        r = await client.post(
            f"{self.base_url}/getUpdates",
            json={"offset": offset, "timeout": timeout, "allowed_updates": ["message", "callback_query"]},
            timeout=timeout + 10.0
        )
        return r.json()

    async def send_chat_action(self, client: httpx.AsyncClient, chat_id: int, action: str = "typing"):
        try:
            await client.post(f"{self.base_url}/sendChatAction", json={"chat_id": chat_id, "action": action})
        except Exception:
            pass

    async def send_message(
        self,
        client: httpx.AsyncClient,
        chat_id: int,
        text: str,
        parse_mode: Optional[str] = "HTML",
        reply_markup: Optional[dict] = None
    ) -> dict:
        payload = {"chat_id": chat_id, "text": text}
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup:
            payload["reply_markup"] = reply_markup
        r = await client.post(f"{self.base_url}/sendMessage", json=payload)
        return r.json()

    async def send_voice(
        self,
        client: httpx.AsyncClient,
        chat_id: int,
        voice_bytes: bytes,
        caption: str = "",
        filename: str = "voice.wav"
    ) -> dict:
        data = {"chat_id": str(chat_id), "caption": caption, "parse_mode": "HTML"}
        files = {"voice": (filename, voice_bytes, "audio/wav")}
        r = await client.post(f"{self.base_url}/sendVoice", data=data, files=files, timeout=40.0)
        return r.json()

    async def send_photo(
        self,
        client: httpx.AsyncClient,
        chat_id: int,
        photo_bytes: bytes,
        caption: str = "",
        filename: str = "photo.jpg"
    ) -> dict:
        data = {"chat_id": str(chat_id), "caption": caption, "parse_mode": "HTML"}
        files = {"photo": (filename, photo_bytes, "image/jpeg")}
        r = await client.post(f"{self.base_url}/sendPhoto", data=data, files=files, timeout=40.0)
        return r.json()

    async def send_document(
        self,
        client: httpx.AsyncClient,
        chat_id: int,
        doc_bytes: bytes,
        filename: str,
        caption: str = ""
    ) -> dict:
        data = {"chat_id": str(chat_id), "caption": caption, "parse_mode": "HTML"}
        files = {"document": (filename, doc_bytes, "application/octet-stream")}
        r = await client.post(f"{self.base_url}/sendDocument", data=data, files=files, timeout=60.0)
        return r.json()

    async def send_audio(
        self,
        client: httpx.AsyncClient,
        chat_id: int,
        audio_bytes: bytes,
        filename: str = "audio.mp3",
        caption: str = "",
        title: str = "",
        performer: str = ""
    ) -> dict:
        data = {"chat_id": str(chat_id), "caption": caption, "parse_mode": "HTML"}
        if title:
            data["title"] = title
        if performer:
            data["performer"] = performer
        files = {"audio": (filename, audio_bytes, "audio/mpeg")}
        r = await client.post(f"{self.base_url}/sendAudio", data=data, files=files, timeout=90.0)
        return r.json()

    async def send_video(
        self,
        client: httpx.AsyncClient,
        chat_id: int,
        video_bytes: bytes,
        filename: str = "video.mp4",
        caption: str = "",
        supports_streaming: bool = True
    ) -> dict:
        data = {"chat_id": str(chat_id), "caption": caption, "parse_mode": "HTML", "supports_streaming": str(supports_streaming).lower()}
        files = {"video": (filename, video_bytes, "video/mp4")}
        r = await client.post(f"{self.base_url}/sendVideo", data=data, files=files, timeout=120.0)
        return r.json()

    async def answer_callback_query(self, client: httpx.AsyncClient, callback_query_id: str, text: str = ""):
        try:
            await client.post(
                f"{self.base_url}/answerCallbackQuery",
                json={"callback_query_id": callback_query_id, "text": text}
            )
        except Exception:
            pass

    async def set_my_commands(self, client: httpx.AsyncClient, commands: list) -> dict:
        try:
            r = await client.post(f"{self.base_url}/setMyCommands", json={"commands": commands})
            return r.json()
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def edit_message_text(
        self,
        client: httpx.AsyncClient,
        chat_id: int,
        message_id: int,
        text: str,
        parse_mode: Optional[str] = "HTML"
    ):
        try:
            payload = {"chat_id": chat_id, "message_id": message_id, "text": text}
            if parse_mode:
                payload["parse_mode"] = parse_mode
            await client.post(f"{self.base_url}/editMessageText", json=payload)
        except Exception:
            pass

    async def download_file_bytes(self, client: httpx.AsyncClient, file_id: str) -> Optional[bytes]:
        r = await client.post(f"{self.base_url}/getFile", json={"file_id": file_id})
        data = r.json()
        if data.get("ok"):
            file_path = data.get("result", {}).get("file_path")
            if file_path:
                dl_url = f"{self.file_base_url}/{file_path}"
                dl_resp = await client.get(dl_url, timeout=60.0)
                if dl_resp.status_code == 200:
                    return dl_resp.content
        return None


def _clean_markdown_for_telegram(text: str) -> str:
    """Formats standard text safely for Telegram."""
    if not text:
        return ""
    clean = re.sub(r'\[ANIM:[^\]]+\]', '', text)
    clean = re.sub(r'\[FACIAL:[^\]]+\]', '', clean)
    clean = re.sub(r'\[ACTION:[^\]]+\]', '', clean)
    return clean.strip()


def _make_speech_friendly(text: str) -> str:
    """Strips markdown code blocks, URLs, and complex syntax for clean TTS."""
    if not text:
        return ""
    clean = re.sub(r'```[\s\S]*?```', ' [code snippet omitted] ', text)
    clean = re.sub(r'`[^`]+`', '', clean)
    clean = re.sub(r'https?://\S+', '', clean)
    clean = re.sub(r'[*_~#\[\]<>]', '', clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean


async def send_unauthorized_reply(tg: TelegramClient, client: httpx.AsyncClient, user_dict: dict, chat_id: int):
    """Sends a clear instructions card with the user's Telegram ID for whitelisting."""
    user_id = user_dict.get("id", "Unknown")
    user_name = f"@{user_dict.get('username')}" if user_dict.get('username') else user_dict.get('first_name', 'Friend')
    character_name = getattr(config, "CHARACTER_NAME", "Yuki")
    
    msg = (
        f"🔒 <b>Access Restricted</b>\n\n"
        f"Hi {user_name}! I'm <b>{character_name}</b>, currently running on my master's PC.\n\n"
        f"For security, only authorized users can chat with me or run system commands.\n\n"
        f"📋 <b>Your Telegram User ID:</b>\n"
        f"<code>{user_id}</code>\n\n"
        f"<i>💡 To authorize yourself, open Yuki's Control Dashboard -> Settings -> Remote & Telegram, "
        f"and add <code>{user_id}</code> to 'Allowed User IDs'.</i>"
    )
    try:
        await tg.send_message(client, chat_id, msg)
    except Exception as e:
        print(f"[Telegram] Failed to send unauthorized reply: {e}")


def _compress_video_ffmpeg(video_path: str) -> Optional[str]:
    """Compresses large video using ffmpeg so it fits within Telegram's 50MB limit."""
    import subprocess
    ffmpeg_bin = shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"
    if not os.path.exists(ffmpeg_bin) and not shutil.which("ffmpeg"):
        return None
    
    file_name = os.path.basename(video_path)
    base_name, _ = os.path.splitext(file_name)
    temp_dest = os.path.join(get_attachment_directory(), f"compressed_{base_name}_{int(time.time())}.mp4")
    
    try:
        cmd = [
            ffmpeg_bin, "-y", "-i", video_path,
            "-vf", "scale=trunc(min(1280,iw)/2)*2:-2",
            "-c:v", "libx264", "-crf", "28", "-preset", "veryfast",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            temp_dest
        ]
        res = subprocess.run(cmd, capture_output=True, timeout=120)
        if res.returncode == 0 and os.path.exists(temp_dest):
            csize = os.path.getsize(temp_dest)
            if csize <= 49 * 1024 * 1024:
                return temp_dest
            else:
                try:
                    os.remove(temp_dest)
                except Exception:
                    pass
    except Exception as e:
        print(f"[Telegram] Video compression failed: {e}")
        if os.path.exists(temp_dest):
            try:
                os.remove(temp_dest)
            except Exception:
                pass
    return None


def _extract_audio_from_video(video_path: str) -> Optional[bytes]:
    """Extracts MP3 audio bytes from video in-memory using PyAV (no temp files on disk)."""
    try:
        import av
        input_container = av.open(video_path)
        audio_stream = next((s for s in input_container.streams if s.type == 'audio'), None)
        if not audio_stream:
            return None
        
        out_buffer = io.BytesIO()
        output_container = av.open(out_buffer, mode='w', format='mp3')
        out_stream = output_container.add_stream('mp3', rate=audio_stream.rate)
        
        for packet in input_container.demux(audio_stream):
            for frame in packet.decode():
                for out_packet in out_stream.encode(frame):
                    output_container.mux(out_packet)
                    
        for out_packet in out_stream.encode():
            output_container.mux(out_packet)
            
        output_container.close()
        input_container.close()
        return out_buffer.getvalue()
    except Exception as e:
        print(f"[Telegram] Audio extraction error: {e}")
        return None


async def _send_file_or_folder(tg: TelegramClient, client: httpx.AsyncClient, chat_id: int, file_path: str, caption: str = "") -> Tuple[bool, str]:
    """Uploads a file, image, audio, video, or zipped folder to Telegram with auto-handling for large files."""
    if not os.path.exists(file_path):
        return False, f"File not found: '{file_path}'"
    
    clean_path = os.path.abspath(file_path)
    file_name = os.path.basename(clean_path)
    ext = os.path.splitext(clean_path)[1].lower()
    
    try:
        if os.path.isdir(clean_path):
            dir_name = os.path.basename(clean_path.rstrip(r"\/")) or "folder"
            zip_dest = os.path.join(get_attachment_directory(), f"{dir_name}_{int(time.time())}.zip")
            
            with zipfile.ZipFile(zip_dest, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, _, files in os.walk(clean_path):
                    for file in files:
                        full_f = os.path.join(root, file)
                        rel_f = os.path.relpath(full_f, clean_path)
                        zipf.write(full_f, rel_f)
            
            zip_size = os.path.getsize(zip_dest)
            if zip_size > 50 * 1024 * 1024:
                try:
                    os.remove(zip_dest)
                except Exception:
                    pass
                return False, f"Zipped archive is {zip_size / (1024*1024):.1f}MB, which exceeds Telegram's 50MB bot upload limit."

            try:
                with open(zip_dest, "rb") as doc_file:
                    doc_bytes = doc_file.read()
                    res = await tg.send_document(
                        client,
                        chat_id,
                        doc_bytes,
                        filename=f"{dir_name}.zip",
                        caption=caption or f"📁 <b>Archive of folder:</b> <code>{clean_path}</code>"
                    )
                if res.get("ok"):
                    return True, f"Successfully uploaded folder archive '{dir_name}.zip' to Telegram."
                return False, f"Telegram API error: {res.get('description', 'Upload failed')}"
            finally:
                try:
                    os.remove(zip_dest)
                except Exception:
                    pass
            
        file_size = os.path.getsize(clean_path)
        file_size_mb = file_size / (1024 * 1024)

        if is_image_file(clean_path):
            if file_size_mb > 10.0:
                with open(clean_path, "rb") as doc_file:
                    res = await tg.send_document(
                        client,
                        chat_id,
                        doc_file.read(),
                        filename=file_name,
                        caption=caption or f"🖼️ <code>{file_name}</code>"
                    )
            else:
                with open(clean_path, "rb") as photo_file:
                    res = await tg.send_photo(
                        client,
                        chat_id,
                        photo_file.read(),
                        filename=file_name,
                        caption=caption or f"🖼️ <code>{file_name}</code>"
                    )
            if res.get("ok"):
                return True, f"Successfully sent image '{file_name}' to Telegram."
            return False, f"Telegram API error: {res.get('description', 'Upload failed')}"

        elif ext in (".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma", ".opus"):
            if file_size_mb > 50.0:
                return False, f"Audio file is {file_size_mb:.1f}MB, which exceeds Telegram's 50MB bot upload limit."
            with open(clean_path, "rb") as audio_file:
                res = await tg.send_audio(
                    client,
                    chat_id,
                    audio_file.read(),
                    filename=file_name,
                    title=os.path.splitext(file_name)[0],
                    caption=caption or f"🎵 <code>{file_name}</code>"
                )
            if res.get("ok"):
                return True, f"Successfully uploaded song/audio '{file_name}' to Telegram."
            return False, f"Telegram API error: {res.get('description', 'Upload failed')}"

        elif ext in (".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v"):
            if file_size_mb <= 49.0:
                with open(clean_path, "rb") as vid_file:
                    res = await tg.send_video(
                        client,
                        chat_id,
                        vid_file.read(),
                        filename=file_name,
                        caption=caption or f"🎬 <code>{file_name}</code>"
                    )
                if res.get("ok"):
                    return True, f"Successfully uploaded video '{file_name}' to Telegram."
                return False, f"Telegram API error: {res.get('description', 'Upload failed')}"
            else:
                # Video exceeds Telegram 50MB limit -> Attempt fast video compression first!
                print(f"[Telegram] Video '{file_name}' is {file_size_mb:.1f}MB (> 50MB limit). Attempting fast video compression...")
                comp_path = _compress_video_ffmpeg(clean_path)
                if comp_path and os.path.exists(comp_path):
                    try:
                        c_mb = os.path.getsize(comp_path) / (1024 * 1024)
                        with open(comp_path, "rb") as cvid:
                            res = await tg.send_video(
                                client,
                                chat_id,
                                cvid.read(),
                                filename=f"{os.path.splitext(file_name)[0]}_720p.mp4",
                                caption=caption or f"🎬 <b>Compressed Video</b> ({c_mb:.1f}MB, original was {file_size_mb:.1f}MB)"
                            )
                        if res.get("ok"):
                            return True, f"Successfully compressed and sent video '{file_name}' ({c_mb:.1f}MB) to Telegram."
                    finally:
                        try:
                            os.remove(comp_path)
                        except Exception:
                            pass

                # If video compression couldn't reduce under 50MB, fall back to in-memory MP3 audio track
                print(f"[Telegram] Falling back to high-quality audio extraction for '{file_name}'...")
                audio_bytes = _extract_audio_from_video(clean_path)
                if audio_bytes and len(audio_bytes) < 50 * 1024 * 1024:
                    mp3_name = f"{os.path.splitext(file_name)[0]}.mp3"
                    res = await tg.send_audio(
                        client,
                        chat_id,
                        audio_bytes,
                        filename=mp3_name,
                        title=os.path.splitext(file_name)[0],
                        caption=caption or f"🎵 <b>Audio Track</b> ({file_size_mb:.1f}MB original video exceeds 50MB limit — extracted high-quality MP3)"
                    )
                    if res.get("ok"):
                        return True, f"Sent high-quality audio track '{mp3_name}' ({len(audio_bytes)/(1024*1024):.1f}MB) to Telegram (extracted because original video is {file_size_mb:.1f}MB, which exceeds Telegram's 50MB bot limit)."
                return False, f"Video file is {file_size_mb:.1f}MB, which exceeds Telegram's 50MB bot upload limit."

        else:
            if file_size_mb > 50.0:
                return False, f"File is {file_size_mb:.1f}MB, which exceeds Telegram's 50MB bot upload limit."
            with open(clean_path, "rb") as doc_file:
                res = await tg.send_document(
                    client,
                    chat_id,
                    doc_file.read(),
                    filename=file_name,
                    caption=caption or f"📄 <code>{file_name}</code>"
                )
            if res.get("ok"):
                return True, f"Successfully uploaded file '{file_name}' to Telegram."
            return False, f"Telegram API error: {res.get('description', 'Upload failed')}"
    except Exception as e:
        print(f"[Telegram] Error uploading file '{file_path}': {e}")
        return False, str(e)


async def send_file_to_active_chat(file_path: str, caption: str = "", chat_id: Optional[int] = None) -> Tuple[bool, str]:
    """Sends a file, screenshot, or folder directly to the active Telegram chat."""
    global _current_active_chat_id, _known_chat_ids
    target_chat = chat_id or _current_active_chat_id or (next(iter(_known_chat_ids)) if _known_chat_ids else None)
    if not target_chat:
        print("[Telegram] send_file_to_active_chat failed: No active chat ID found.")
        return False, "No active Telegram chat session found."
    
    token = getattr(config, "TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return False, "Telegram Bot Token is not configured in settings."
        
    tg = TelegramClient(token)
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            return await _send_file_or_folder(tg, client, target_chat, file_path, caption=caption)
    except Exception as e:
        print(f"[Telegram] Error sending file to chat #{target_chat}: {e}")
        return False, str(e)


# ── Core Agent Turn Dispatcher ────────────────────────────────────────────────

async def _process_agent_turn(
    tg: TelegramClient,
    client: httpx.AsyncClient,
    chat_id: int,
    user_text: str,
    attachments: Optional[List[Dict[str, Any]]] = None,
    stt_duration: Optional[float] = None
):
    """Executes a chat turn through the core AgentExecutor."""
    global _current_active_chat_id
    _current_active_chat_id = chat_id
    executor = _get_executor()
    if executor is None:
        await tg.send_message(
            client,
            chat_id,
            "⏳ <i>Yuki's backend is still initializing... please try again in a moment.</i>"
        )
        return
    
    turn_start_time = time.time()
    first_token_time = None
    tool_total_time = 0.0
    active_tool_start = None
    tts_duration = 0.0
    
    history = _chat_histories.get(chat_id, [])
    await tg.send_chat_action(client, chat_id, "typing")
    
    verbose_tools = getattr(config, "TELEGRAM_VERBOSE_TOOLS", True)
    voice_replies = getattr(config, "TELEGRAM_VOICE_REPLIES", True)
    
    overrides = {
        "from_telegram": True,
        "turn_id": uuid.uuid4().hex[:12]
    }
    
    gen = executor.execute_chat_turn_stream(
        user_text,
        history,
        overrides=overrides,
        attachments=attachments or []
    )
    
    final_text_accum = []
    generated_files_to_send = []
    
    try:
        event = await gen.__anext__()
        while True:
            event_type, value, label = event
            
            if event_type == "tool_start":
                active_tool_start = time.time()
                await tg.send_chat_action(client, chat_id, "typing")
                if verbose_tools:
                    tool_name = value.get("name", "tool") if isinstance(value, dict) else str(value)
                    tool_args = value.get("args", {}) if isinstance(value, dict) else {}
                    args_str = str(tool_args)
                    if len(args_str) > 100:
                        args_str = args_str[:97] + "..."
                    try:
                        await tg.send_message(
                            client,
                            chat_id,
                            f"⚙️ <b>Executing Tool:</b> <code>{tool_name}</code>\n<code>{args_str}</code>"
                        )
                    except Exception:
                        pass
                        
            elif event_type == "tool_end":
                if active_tool_start is not None:
                    tool_total_time += (time.time() - active_tool_start)
                    active_tool_start = None
                res_str = str(value.get("result", "")) if isinstance(value, dict) else str(value)
                
                # Check for screenshot captures
                if "captured screenshot:" in res_str:
                    sp = res_str.split("captured screenshot:", 1)[1].strip()
                    if os.path.exists(sp):
                        generated_files_to_send.append(sp)
                
                # Check for explicit file paths in result
                path_match = re.search(r'(?:Saved|Created|Wrote|Downloaded to|Output file):\s*([a-zA-Z]:[\\/][^\n\r]+|\/[^\n\r]+)', res_str, re.IGNORECASE)
                if path_match:
                    fpath = path_match.group(1).strip().strip('"').strip("'")
                    if os.path.exists(fpath) and os.path.isfile(fpath):
                        generated_files_to_send.append(fpath)
                
                if verbose_tools:
                    tool_name = value.get("name", "tool") if isinstance(value, dict) else "tool"
                    summary = res_str.strip()
                    if len(summary) > 180:
                        summary = summary[:177] + "..."
                    try:
                        await tg.send_message(
                            client,
                            chat_id,
                            f"📋 <b>Result ({tool_name}):</b>\n<pre>{summary}</pre>"
                        )
                    except Exception:
                        pass
                        
            elif event_type == "tool_confirm_required":
                target_desc = str(value)
                conf_id = uuid.uuid4().hex[:8]
                loop = asyncio.get_running_loop()
                fut = loop.create_future()
                _active_confirmations[conf_id] = fut
                
                reply_markup = {
                    "inline_keyboard": [
                        [
                            {"text": "✅ Approve", "callback_data": f"conf:{conf_id}:allow"},
                            {"text": "❌ Deny", "callback_data": f"conf:{conf_id}:deny"}
                        ]
                    ]
                }
                
                await tg.send_message(
                    client,
                    chat_id,
                    f"⚠️ <b>Authorization Required</b>\n\nYuki wants to execute:\n<code>{target_desc}</code>\n\nDo you permit this action on your PC?",
                    reply_markup=reply_markup
                )
                
                try:
                    confirmed = await asyncio.wait_for(fut, timeout=90.0)
                except asyncio.TimeoutError:
                    confirmed = False
                    await tg.send_message(client, chat_id, "⏱️ <i>Confirmation timed out. Action denied.</i>")
                finally:
                    _active_confirmations.pop(conf_id, None)
                    
                event = await gen.asend(confirmed)
                continue
                
            elif event_type == "token":
                if first_token_time is None:
                    first_token_time = time.time() - turn_start_time
                final_text_accum.append(str(value))
                
            elif event_type == "final_history":
                if isinstance(value, list):
                    _chat_histories[chat_id] = value[-30:]
                    _save_persisted_sessions()
                    
            event = await gen.__anext__()
            
    except StopAsyncIteration:
        pass
    except Exception as e:
        print(f"[Telegram] Error during agent execution: {e}")
        await tg.send_message(client, chat_id, f"⚠️ <i>Error executing request: {e}</i>")
        return
        
    full_response = "".join(final_text_accum).strip()
    clean_text = _clean_markdown_for_telegram(full_response)
    
    if clean_text:
        preview = clean_text.replace('\n', ' ')
        if len(preview) > 90:
            preview = preview[:87] + "..."
        print(f"[Telegram] Response to chat #{chat_id}: \"{preview}\"")
        
        chunks = [clean_text[i:i+4000] for i in range(0, len(clean_text), 4000)]
        for ch in chunks:
            try:
                await tg.send_message(client, chat_id, ch, parse_mode=None)
            except Exception as send_err:
                print(f"[Telegram] Failed to send message text: {send_err}")
    
    # Upload any produced files/screenshots
    for fpath in set(generated_files_to_send):
        print(f"[Telegram] Sending file to chat #{chat_id}: {fpath}")
        await _send_file_or_folder(tg, client, chat_id, fpath)
        
    # Generate Voice Note reply via Kokoro TTS (unless user enabled /textonly)
    is_text_only = _chat_text_only.get(chat_id, False)
    if voice_replies and (not is_text_only) and clean_text:
        try:
            speech_text = _make_speech_friendly(clean_text)
            if speech_text and len(speech_text) <= 600:
                await tg.send_chat_action(client, chat_id, "record_voice")
                from app.voice.tts import generate_speech_bytes
                tts_start = time.time()
                audio_bytes = await generate_speech_bytes(speech_text)
                tts_duration = time.time() - tts_start
                if audio_bytes:
                    print(f"[Telegram] Sent Kokoro voice reply ({len(audio_bytes)} bytes in {tts_duration:.2f}s) to chat #{chat_id}")
                    await tg.send_voice(
                        client,
                        chat_id,
                        audio_bytes,
                        caption=f"🎙️ <b>{getattr(config, 'CHARACTER_NAME', 'Yuki')}</b>"
                    )
        except Exception as tts_err:
            print(f"[Telegram] Error synthesizing Kokoro voice reply: {tts_err}")

    # Print Timing Breakdown in Backend Terminal
    total_elapsed = time.time() - turn_start_time
    ttft_str = f"{first_token_time:.2f}s" if first_token_time is not None else "N/A"
    llm_gen_str = f"{max(0.0, total_elapsed - tool_total_time - tts_duration):.2f}s"
    tool_str = f"{tool_total_time:.2f}s"

    print(f"\n================ CHAT TURN TIMING BREAKDOWN [Telegram] ================")
    if stt_duration is not None and stt_duration > 0:
        print(f"Overall End-to-End Latency: {total_elapsed + stt_duration:.2f}s")
        print(f"  - Speech-to-Text (Whisper STT): {stt_duration:.2f}s")
        print(f"  - Processing (LLM + Tools + TTS): {total_elapsed:.2f}s")
    else:
        print(f"Total Turn Time: {total_elapsed:.2f}s")
    print(f"  - Time to First Token (TTFT): {ttft_str}")
    print(f"  - LLM Token Generation:       {llm_gen_str}")
    print(f"  - Tool Executions:            {tool_str}")
    if tts_duration > 0:
        print(f"  - Kokoro TTS Voice Synthesis: {tts_duration:.2f}s")
    print(f"======================================================================\n")


# ── Update Processing Loop ───────────────────────────────────────────────────

async def _process_single_update(tg: TelegramClient, client: httpx.AsyncClient, update: dict):
    """Processes an individual Telegram update dictionary."""
    # 1. Handle Inline Callback Query (Approval button tap)
    if "callback_query" in update:
        cq = update["callback_query"]
        cq_id = cq.get("id")
        user = cq.get("from", {})
        data = cq.get("data", "")
        message = cq.get("message", {})
        chat = message.get("chat", {})
        chat_id = chat.get("id")
        
        if not is_user_authorized(user):
            await tg.answer_callback_query(client, cq_id, "Access Denied: You are not authorized.")
            return
            
        if data.startswith("conf:"):
            parts = data.split(":")
            if len(parts) >= 3:
                conf_id = parts[1]
                action = parts[2]
                confirmed = (action == "allow")
                
                if conf_id in _active_confirmations:
                    fut = _active_confirmations[conf_id]
                    if not fut.done():
                        fut.set_result(confirmed)
                
                await tg.answer_callback_query(client, cq_id, f"Action {'Approved' if confirmed else 'Denied'}")
                status_text = "✅ <b>Action Approved by user</b>" if confirmed else "❌ <b>Action Denied by user</b>"
                old_text = message.get("text", "")
                if chat_id and message.get("message_id"):
                    await tg.edit_message_text(
                        client,
                        chat_id,
                        message["message_id"],
                        f"{old_text}\n\n{status_text}"
                    )
        return

    # 2. Handle Message
    if "message" not in update:
        return
        
    msg = update["message"]
    user = msg.get("from", {})
    chat = msg.get("chat", {})
    chat_id = chat.get("id")
    if not chat_id or not user:
        return
        
    if not is_user_authorized(user):
        print(f"[Telegram] 🔒 Unauthorized access attempt from User ID: {user.get('id')} (@{user.get('username')})")
        await send_unauthorized_reply(tg, client, user, chat_id)
        return
        
    _known_chat_ids.add(chat_id)
    character_name = getattr(config, "CHARACTER_NAME", "Yuki")
    user_label = f"@{user.get('username')}" if user.get('username') else f"{user.get('first_name', 'User')}"
    
    # 2A. Text & Commands
    text = (msg.get("text") or "").strip()
    if text:
        print(f"[Telegram] Received text from {user_label} ({user.get('id')}): \"{text}\"")
        if text.startswith("/start") or text.startswith("/help"):
            welcome_msg = (
                f"✨ <b>Hello! I'm {character_name}!</b> ✨\n\n"
                f"I'm connected live to your PC. Here are all available <b>Slash Commands</b>:\n\n"
                f"📊 <b>System & Diagnostics:</b>\n"
                f"• <code>/status</code> — Check PC CPU, RAM & AI Model stats\n"
                f"• <code>/boost</code> — Deep RAM boost (optimizes system memory)\n"
                f"• <code>/selfoptimize</code> — Yuki memory cleanup & garbage collection\n"
                f"• <code>/screenshot</code> — Capture & send desktop screenshot\n"
                f"• <code>/lock</code> — Lock the Windows PC workstation\n"
                f"• <code>/volume &lt;0-100|mute&gt;</code> — Set PC speaker volume\n\n"
                f"📂 <b>Files & Media:</b>\n"
                f"• <code>/open &lt;name&gt;</code> — Search and open file or app on PC\n"
                f"• <code>/play &lt;name&gt;</code> — Search and play video/music on PC\n"
                f"• <code>/sendfile &lt;path&gt;</code> — Send PC file or folder (.zip) to phone\n\n"
                f"📋 <b>Tasks & Reminders:</b>\n"
                f"• <code>/todo</code> — Show active TODO task list\n"
                f"• <code>/alarms</code> — View active alarms and timers\n\n"
                f"⚙️ <b>Settings & Session:</b>\n"
                f"• <code>/textonly</code> — Toggle fast text-only mode (mutes voice notes)\n"
                f"• <code>/textonlyoff</code> — Re-enable spoken Kokoro voice replies\n"
                f"• <code>/clear</code> — Reset conversation memory context\n"
                f"• <code>/help</code> — Show this guide"
            )
            await tg.send_message(client, chat_id, welcome_msg)
            return

        elif text.lower().startswith("/textonlyoff") or text.lower() in ("text only off", "voice on", "enable voice"):
            _chat_text_only[chat_id] = False
            _save_persisted_sessions()
            await tg.send_message(
                client,
                chat_id,
                "🎙️ <b>Voice Replies Enabled:</b> Yuki will now synthesize and send spoken Kokoro voice notes with her answers."
            )
            return

        elif text.lower().startswith("/textonly") or text.lower() in ("text only", "toggle text only"):
            curr = _chat_text_only.get(chat_id, False)
            new_state = not curr
            _chat_text_only[chat_id] = new_state
            _save_persisted_sessions()
            if new_state:
                await tg.send_message(
                    client,
                    chat_id,
                    "🔇 <b>Text-Only Mode Enabled:</b> Yuki will reply with fast text messages only (no audio synthesis).\n\n<i>Send <code>/textonly</code> or <code>/textonlyoff</code> anytime to re-enable voice notes!</i>"
                )
            else:
                await tg.send_message(
                    client,
                    chat_id,
                    "🎙️ <b>Voice Replies Enabled:</b> Yuki will now synthesize and send spoken Kokoro voice notes with her answers."
                )
            return

        elif text.startswith("/status") or text.startswith("/pcstat"):
            try:
                import psutil
                cpu_pct = psutil.cpu_percent(interval=0.2)
                mem = psutil.virtual_memory()
                mem_pct = mem.percent
                mem_used_gb = round(mem.used / (1024**3), 1)
                mem_total_gb = round(mem.total / (1024**3), 1)
                
                backend_name = getattr(config, "LLM_BACKEND", "Unknown")
                model_name = getattr(config, "LLM_MODEL", "Unknown")
                tool_mode = getattr(config, "TOOL_MODE", "basic")
                
                status_text = (
                    f"🖥️ <b>PC & Assistant Status</b>\n\n"
                    f"• <b>CPU Usage:</b> {cpu_pct}%\n"
                    f"• <b>RAM Usage:</b> {mem_pct}% ({mem_used_gb} GB / {mem_total_gb} GB)\n"
                    f"• <b>LLM Backend:</b> <code>{backend_name}</code>\n"
                    f"• <b>Active Model:</b> <code>{model_name}</code>\n"
                    f"• <b>Tool Mode:</b> <code>{tool_mode}</code>\n"
                    f"• <b>Voice Replies:</b> {'Enabled 🎙️' if not _chat_text_only.get(chat_id, False) else 'Text-Only 🔇'}\n"
                    f"• <b>Push Reminders:</b> {'Enabled ⏰' if getattr(config, 'TELEGRAM_NOTIFY_REMINDERS', True) else 'Disabled'}"
                )
            except Exception as e:
                status_text = f"⚠️ Error fetching system stats: {e}"
            await tg.send_message(client, chat_id, status_text)
            return

        elif text.lower().startswith("/boost"):
            await tg.send_chat_action(client, chat_id, "typing")
            try:
                from app.memory.optimizer import optimize_all_processes
                res = optimize_all_processes(force=True, trim_system_procs=True)
                freed = res.get("freed_mb", 0)
                after = res.get("after_pct", 0)
                await tg.send_message(
                    client,
                    chat_id,
                    f"🚀 <b>Deep RAM Boost Complete!</b>\n\n"
                    f"• <b>Freed Memory:</b> <code>{freed} MB</code>\n"
                    f"• <b>Current RAM Usage:</b> <code>{after}%</code>\n"
                    f"• <b>Processes Trimmed:</b> {res.get('system_procs_trimmed', 0)} system apps"
                )
            except Exception as e:
                await tg.send_message(client, chat_id, f"⚠️ Boost error: {e}")
            return

        elif text.lower().startswith("/selfoptimize") or text.lower().startswith("/self-optimize"):
            await tg.send_chat_action(client, chat_id, "typing")
            try:
                from app.memory.optimizer import optimize_all_processes
                res = optimize_all_processes(force=True, only_self=True)
                freed = res.get("freed_mb", 0)
                await tg.send_message(
                    client,
                    chat_id,
                    f"🧹 <b>Yuki Self-Optimization Complete!</b>\n\n"
                    f"• <b>Freed Memory:</b> <code>{freed} MB</code>\n"
                    f"• <b>Working Set Trimmed:</b> {res.get('yuki_procs_trimmed', 0)} Yuki processes"
                )
            except Exception as e:
                await tg.send_message(client, chat_id, f"⚠️ Self-optimize error: {e}")
            return

        elif text.lower().startswith("/lock"):
            try:
                import ctypes
                ctypes.windll.user32.LockWorkStation()
                await tg.send_message(client, chat_id, "🔒 <b>Windows Workstation Locked.</b>")
            except Exception as e:
                await tg.send_message(client, chat_id, f"⚠️ Lock error: {e}")
            return

        elif text.lower().startswith("/volume"):
            parts = text.split(maxsplit=1)
            if len(parts) < 2:
                await tg.send_message(client, chat_id, "🔊 <b>Usage:</b> <code>/volume &lt;0-100&gt;</code> or <code>/volume mute</code>")
                return
            arg = parts[1].strip().lower()
            try:
                from app.tools.system import set_system_volume
                if arg == "mute":
                    res = set_system_volume(0)
                elif arg == "unmute":
                    res = set_system_volume(50)
                else:
                    level = int(re.sub(r'[^0-9]', '', arg))
                    res = set_system_volume(level)
                await tg.send_message(client, chat_id, f"🔊 {res}")
            except Exception as e:
                await tg.send_message(client, chat_id, f"⚠️ Volume error: {e}")
            return

        elif text.lower().startswith("/open ") or text.lower().startswith("/o "):
            query = text.split(maxsplit=1)[1].strip()
            await tg.send_chat_action(client, chat_id, "typing")
            try:
                from app.tools.files import open_or_play_file
                from app.tools.system import launch_app
                # Try opening file first, then fall back to app launcher
                res = open_or_play_file(query, play_mode=False, confirmed=True)
                if "No files found" in res or "Error" in res:
                    res = launch_app(query)
                await tg.send_message(client, chat_id, f"📂 {res}")
            except Exception as e:
                await tg.send_message(client, chat_id, f"⚠️ Open error: {e}")
            return

        elif text.lower().startswith("/play ") or text.lower().startswith("/p "):
            query = text.split(maxsplit=1)[1].strip()
            await tg.send_chat_action(client, chat_id, "typing")
            try:
                from app.tools.files import open_or_play_file
                res = open_or_play_file(query, play_mode=True, confirmed=True)
                await tg.send_message(client, chat_id, f"🎵 {res}")
            except Exception as e:
                await tg.send_message(client, chat_id, f"⚠️ Play error: {e}")
            return

        elif text.lower() in ("/todo", "/todos", "todo", "todos", "task list"):
            try:
                from app.tools.todo_list import manage_todo
                res = manage_todo(action="list")
                clean_res = _clean_markdown_for_telegram(str(res))
                await tg.send_message(client, chat_id, f"📋 <b>Active Tasks & TODOs:</b>\n\n{clean_res[:3800]}")
            except Exception as e:
                await tg.send_message(client, chat_id, f"⚠️ Todo list error: {e}")
            return

        elif text.lower() in ("/alarms", "/timers", "/reminders", "alarms", "timers"):
            try:
                from app.tools.time_manager import get_active_time_items
                data = get_active_time_items()
                reminders = data.get("reminders", [])
                stopwatches = data.get("stopwatches", [])
                lines = []
                if reminders:
                    lines.append("⏰ <b>Alarms & Reminders:</b>")
                    for r in reminders:
                        t_str = time.strftime('%H:%M:%S', time.localtime(r.get('target_timestamp', 0)))
                        lines.append(f"• <b>[{t_str}]</b> {r.get('message', 'Alarm')} (ID: #{r.get('id')})")
                if stopwatches:
                    lines.append("\n⏱️ <b>Active Stopwatches:</b>")
                    for s in stopwatches:
                        lines.append(f"• {s.get('label')}: running ({s.get('elapsed', 0):.1f}s)")
                if not lines:
                    lines.append("<i>No active alarms, timers, or stopwatches running.</i>")
                await tg.send_message(client, chat_id, "\n".join(lines))
            except Exception as e:
                await tg.send_message(client, chat_id, f"⚠️ Alarms error: {e}")
            return

        elif text.startswith("/screenshot"):
            await tg.send_chat_action(client, chat_id, "upload_photo")
            try:
                from app.tools.scheduled_tasks import capture_screenshot
                result = capture_screenshot()
                if "captured screenshot:" in result:
                    img_path = result.split("captured screenshot:", 1)[1].strip()
                    if os.path.exists(img_path):
                        with open(img_path, "rb") as pf:
                            await tg.send_photo(
                                client,
                                chat_id,
                                pf.read(),
                                caption=f"📸 <b>Desktop Screenshot</b> ({time.strftime('%Y-%m-%d %H:%M:%S')})"
                            )
                        return
                await tg.send_message(client, chat_id, f"⚠️ Failed to capture screenshot: {result}")
            except Exception as e:
                await tg.send_message(client, chat_id, f"⚠️ Screenshot error: {e}")
            return

        elif text.lower() in ("/clear", "/reset", "/new", "/newchat", "clear chat", "clear context", "reset context", "new chat"):
            _chat_histories[chat_id] = []
            _save_persisted_sessions()
            await tg.send_message(client, chat_id, "🧹 <i>Conversation memory for Telegram has been cleared. Starting a fresh session!</i>")
            return

        # Direct file send command check
        file_send_match = re.match(r'^(?:/sendfile|send\s+file|send\s+folder)\s+(.+)$', text, re.IGNORECASE)
        if file_send_match:
            target_path = file_send_match.group(1).strip().strip('"').strip("'")
            if os.path.exists(target_path):
                await tg.send_chat_action(client, chat_id, "upload_document")
                success = await _send_file_or_folder(tg, client, chat_id, target_path)
                if success:
                    return

        # Regular Chat Turn
        await _process_agent_turn(tg, client, chat_id, text)
        return

    # 2B. Voice Note
    if "voice" in msg or "audio" in msg:
        v_obj = msg.get("voice") or msg.get("audio")
        file_id = v_obj.get("file_id")
        if file_id:
            await tg.send_chat_action(client, chat_id, "typing")
            try:
                voice_bytes = await tg.download_file_bytes(client, file_id)
                if voice_bytes:
                    from app.voice.stt import transcribe_audio_file
                    stt_t0 = time.time()
                    transcribed_text = await transcribe_audio_file(voice_bytes)
                    stt_duration = time.time() - stt_t0
                    transcribed_text = (transcribed_text or "").strip()
                    
                    if not transcribed_text:
                        print(f"[Telegram] Voice note from {user_label} ({user.get('id')}): [Inaudible / No speech detected]")
                        await tg.send_message(
                            client,
                            chat_id,
                            "🎙️ <i>I heard your voice note, but couldn't make out any clear speech. Could you try saying that again?</i>"
                        )
                        return
                        
                    print(f"[Telegram] Voice note from {user_label} ({user.get('id')}) → Transcribed: \"{transcribed_text}\" (took {stt_duration:.2f}s)")
                    await tg.send_message(client, chat_id, f"🎙️ <i>\"{transcribed_text}\"</i>")
                    await _process_agent_turn(tg, client, chat_id, transcribed_text, stt_duration=stt_duration)
            except Exception as e:
                print(f"[Telegram] Error processing voice note: {e}")
                await tg.send_message(client, chat_id, f"⚠️ <i>Error processing voice note: {e}</i>")
        return

    # 2C. Photo Upload
    if "photo" in msg:
        photos = msg["photo"]
        if photos:
            highest_res = photos[-1]
            file_id = highest_res.get("file_id")
            if file_id:
                await tg.send_chat_action(client, chat_id, "typing")
                try:
                    photo_bytes = await tg.download_file_bytes(client, file_id)
                    if photo_bytes:
                        stamp = int(time.time())
                        save_path = os.path.join(get_attachment_directory(), f"tg_photo_{stamp}.jpg")
                        with open(save_path, "wb") as f:
                            f.write(photo_bytes)
                            
                        base64_url = encode_image_to_base64_url(save_path)
                        attachments = [{
                            "filename": os.path.basename(save_path),
                            "save_path": save_path,
                            "is_image": True,
                            "is_text": False,
                            "data_url": base64_url,
                            "file_size": len(photo_bytes),
                            "type": "image",
                            "file_name": os.path.basename(save_path),
                            "file_path": save_path,
                            "base64_url": base64_url
                        }]
                        caption = (msg.get("caption") or "").strip() or "Please examine and describe this image."
                        print(f"[Telegram] Photo received from {user_label} ({user.get('id')}) -> Caption: \"{caption}\" (saved to {save_path})")
                        await _process_agent_turn(tg, client, chat_id, caption, attachments=attachments)
                except Exception as e:
                    print(f"[Telegram] Error processing photo: {e}")
                    await tg.send_message(client, chat_id, f"⚠️ <i>Error analyzing photo: {e}</i>")
        return

    # 2D. Document Upload
    if "document" in msg:
        doc = msg["document"]
        file_id = doc.get("file_id")
        if file_id:
            await tg.send_chat_action(client, chat_id, "typing")
            try:
                doc_bytes = await tg.download_file_bytes(client, file_id)
                if doc_bytes:
                    raw_name = doc.get("file_name", "document")
                    clean_name = sanitize_filename(raw_name)
                    save_path = os.path.join(get_attachment_directory(), f"tg_{int(time.time())}_{clean_name}")
                    with open(save_path, "wb") as f:
                        f.write(doc_bytes)
                        
                    attachments = []
                    user_msg = (msg.get("caption") or "").strip()
                    
                    if is_image_file(save_path):
                        base64_url = encode_image_to_base64_url(save_path)
                        attachments.append({
                            "filename": clean_name,
                            "save_path": save_path,
                            "is_image": True,
                            "is_text": False,
                            "data_url": base64_url,
                            "file_size": len(doc_bytes),
                            "type": "image",
                            "file_name": clean_name,
                            "file_path": save_path,
                            "base64_url": base64_url
                        })
                        if not user_msg:
                            user_msg = "Please analyze this image document."
                    elif is_text_file(save_path):
                        text_content = extract_file_text_content(save_path)
                        doc_context = f"\n\n[Attached File Content: '{clean_name}']\n```\n{text_content}\n```"
                        user_msg = (user_msg + doc_context).strip()
                        attachments.append({
                            "filename": clean_name,
                            "save_path": save_path,
                            "is_image": False,
                            "is_text": True,
                            "text_content": text_content,
                            "file_size": len(doc_bytes),
                            "type": "text",
                            "file_name": clean_name,
                            "file_path": save_path
                        })
                    else:
                        attachments.append({
                            "filename": clean_name,
                            "save_path": save_path,
                            "is_image": False,
                            "is_text": False,
                            "file_size": len(doc_bytes),
                            "type": "binary",
                            "file_name": clean_name,
                            "file_path": save_path
                        })
                        if not user_msg:
                            user_msg = f"I have uploaded a file saved at '{save_path}'."
                            
                    print(f"[Telegram] Document '{clean_name}' received from {user_label} ({user.get('id')}) ({len(doc_bytes)} bytes)")
                    await _process_agent_turn(tg, client, chat_id, user_msg, attachments=attachments)
            except Exception as e:
                print(f"[Telegram] Error processing document: {e}")
                await tg.send_message(client, chat_id, f"⚠️ <i>Error processing document: {e}</i>")
        return


# ── Proactive Reminder / Alarm Dispatcher ─────────────────────────────────────

async def dispatch_telegram_reminder(reminder_item: Dict[str, Any]):
    """Sends active alarm or reminder push notifications to all authorized chats."""
    token = getattr(config, "TELEGRAM_BOT_TOKEN", "").strip()
    if not token or not getattr(config, "TELEGRAM_NOTIFY_REMINDERS", True):
        return
    if not _known_chat_ids:
        return
        
    msg = reminder_item.get("message") or "Your scheduled reminder is due!"
    category = reminder_item.get("category", "timer").upper()
    
    alert_text = (
        f"⏰ <b>{category} ALERT!</b>\n\n"
        f"🔔 <b>{msg}</b>\n\n"
        f"<i>Triggered by {getattr(config, 'CHARACTER_NAME', 'Yuki')} on your PC.</i>"
    )
    
    tg = TelegramClient(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            for chat_id in list(_known_chat_ids):
                try:
                    await tg.send_message(client, chat_id, alert_text)
                    print(f"[Telegram] Dispatched alarm notification to chat #{chat_id}")
                except Exception as e:
                    print(f"[Telegram] Error dispatching reminder to chat #{chat_id}: {e}")
    except Exception:
        pass


# ── Background Polling Loop & Lifecycle ───────────────────────────────────────

async def _polling_loop(token: str):
    """Continuous async long-polling loop using httpx."""
    global _bot_status_cache, _stop_event
    tg = TelegramClient(token)
    offset = 0
    
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            # Check bot identity
            me_data = await tg.get_me(client)
            if not me_data.get("ok"):
                err = me_data.get("description", "Failed to connect")
                _bot_status_cache["status"] = "error"
                _bot_status_cache["error"] = err
                print(f"[Telegram] Authentication failed: {err}")
                return
                
            me = me_data.get("result", {})
            _bot_status_cache["username"] = me.get("username", "")
            _bot_status_cache["first_name"] = me.get("first_name", "")
            _bot_status_cache["status"] = "online"
            _bot_status_cache["error"] = ""
            _bot_status_cache["last_started"] = time.time()
            print(f"[Telegram] Bot service online: @{me.get('username')} ({me.get('first_name')})")
            
            # Register native Telegram Slash Commands menu with Telegram
            bot_cmds = [
                {"command": "status", "description": "Check PC CPU, RAM & AI Model stats"},
                {"command": "boost", "description": "Deep RAM boost (trim system background apps)"},
                {"command": "selfoptimize", "description": "Yuki memory cleanup & garbage collection"},
                {"command": "screenshot", "description": "Capture & send desktop screenshot"},
                {"command": "lock", "description": "Lock Windows PC workstation"},
                {"command": "volume", "description": "Set PC volume (/volume 50 or /volume mute)"},
                {"command": "open", "description": "Search and open file or app on PC"},
                {"command": "play", "description": "Search and play video/music on PC"},
                {"command": "todo", "description": "Show active TODO task list"},
                {"command": "alarms", "description": "View active alarms and timers"},
                {"command": "textonly", "description": "Toggle voice notes vs fast text replies"},
                {"command": "textonlyoff", "description": "Re-enable voice note replies"},
                {"command": "clear", "description": "Reset conversation memory context"},
                {"command": "help", "description": "Show commands and features guide"}
            ]
            await tg.set_my_commands(client, bot_cmds)
            
            while not _stop_event.is_set():
                try:
                    updates_data = await tg.get_updates(client, offset=offset, timeout=20)
                    if updates_data.get("ok"):
                        results = updates_data.get("result", [])
                        for upd in results:
                            upd_id = upd.get("update_id", 0)
                            if upd_id >= offset:
                                offset = upd_id + 1
                            asyncio.create_task(_process_single_update(tg, client, upd))
                    else:
                        await asyncio.sleep(2.0)
                except asyncio.CancelledError:
                    break
                except httpx.TimeoutException:
                    continue
                except Exception as poll_err:
                    print(f"[Telegram] Polling error: {poll_err}")
                    await asyncio.sleep(3.0)
                    
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[Telegram] Service stopped due to error: {e}")
        _bot_status_cache["status"] = "error"
        _bot_status_cache["error"] = str(e)
    finally:
        _bot_status_cache["status"] = "offline"


async def start_telegram_bot(token: Optional[str] = None) -> Tuple[bool, str]:
    """Initializes and starts the Telegram long-polling bot asynchronously."""
    global _running_polling_task, _stop_event, _bot_status_cache
    
    active_token = (token or getattr(config, "TELEGRAM_BOT_TOKEN", "")).strip()
    if not active_token:
        _bot_status_cache["status"] = "offline"
        _bot_status_cache["error"] = "No Telegram Bot Token provided."
        return False, "No Telegram Bot Token provided."
    
    await stop_telegram_bot()
    _stop_event.clear()
    
    _running_polling_task = asyncio.create_task(_polling_loop(active_token))
    return True, "Telegram service starting..."


async def stop_telegram_bot():
    """Gracefully shuts down the running Telegram bot."""
    global _running_polling_task, _stop_event, _bot_status_cache
    _stop_event.set()
    if _running_polling_task and not _running_polling_task.done():
        _running_polling_task.cancel()
        try:
            await _running_polling_task
        except asyncio.CancelledError:
            pass
        _running_polling_task = None
    _bot_status_cache["status"] = "offline"


async def restart_telegram_bot(token: Optional[str] = None) -> Tuple[bool, str]:
    """Restarts the Telegram Bot with new credentials or configuration."""
    await stop_telegram_bot()
    return await start_telegram_bot(token)
