import json
import re
import traceback
import requests
import aiohttp
import asyncio
import concurrent.futures
import inspect
import os
import time
import uuid
from datetime import datetime
from typing import Dict, Any, List, Tuple, Optional
from app import config
from app.agent.prompts import get_system_prompt, get_simple_system_prompt, get_advanced_jarvis_system_prompt, get_coding_agent_system_prompt, log_triggered_backend_tags
from app.agent.llm_backend import get_backend, reset_backend, persistent_session_context, get_shared_backend_session
from app.memory.local_mem import MemoryManager
from app.memory.mood_engine import MoodTagScrubber
from app.tools.definitions import get_tools_definition, get_filtered_tools


_SHORT_CIRCUIT_TOOLS = {
    "open_or_play_file",
    "media_playback_control",
    "launch_app",
    "system_power_control",
    "keyboard_mouse_input",
    "set_system_volume",
    "control_window",
    "manage_process",
    "create_file",
    "edit_file",
    "delete_file",
    "run_python_script",
    "run_terminal_command",
    "take_screenshot",
    "jarvis_close_app",
    "jarvis_take_screenshot",
    "jarvis_keyboard_mouse_input",
    "jarvis_media_playback_control",
}

_shared_sync_session: Optional[requests.Session] = None

def _get_shared_sync_session() -> requests.Session:
    global _shared_sync_session
    if _shared_sync_session is None:
        _shared_sync_session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20)
        _shared_sync_session.mount("http://", adapter)
        _shared_sync_session.mount("https://", adapter)
    return _shared_sync_session


def _is_local_url(url: str) -> bool:
    """True if the URL points to a local/loopback endpoint (no API key required)."""
    try:
        host = url.split("//", 1)[1].split("/", 1)[0].lower()
    except Exception:
        return False
    host = host.split(":", 1)[0]
    return (
        host in ("localhost", "127.0.0.1", "0.0.0.0", "::1")
        or host.startswith("192.168.")
        or host.startswith("10.")
    )


_TIMESTAMP_PREFIX_REGEX = re.compile(r'^\[(?:[A-Za-z]{3}\s+\d{1,2},\s*)?\d{1,2}:\d{2}\s*(?:AM|PM)\]\s*', re.IGNORECASE)

def _format_msg_timestamp(ts: Any) -> str:
    """
    Formats a message timestamp (epoch float or ISO string) into a concise local time badge.
    e.g. '[2:52 AM]' for today, or '[Sep 02, 11:45 PM]' for earlier days.
    """
    if not ts:
        return ""
    try:
        if isinstance(ts, (int, float)):
            dt = datetime.fromtimestamp(float(ts))
        elif isinstance(ts, str):
            ts_str = ts.strip()
            if not ts_str:
                return ""
            try:
                dt = datetime.fromtimestamp(float(ts_str))
            except ValueError:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if dt.tzinfo is not None:
                    dt = dt.astimezone()
        else:
            return ""

        now = datetime.now()
        hour_12 = dt.strftime("%I").lstrip("0") or "12"
        min_str = dt.strftime("%M")
        ampm = dt.strftime("%p")
        if dt.date() == now.date():
            return f"[{hour_12}:{min_str} {ampm}]"
        else:
            mon_day = dt.strftime("%b %d")
            return f"[{mon_day}, {hour_12}:{min_str} {ampm}]"
    except Exception:
        return ""


def _log_payload_stats(payload: dict, model: str, tag: str = ""):
    """
    Prints the total character count and estimated token count of the exact
    JSON payload about to be sent to the LLM ("the whole stuff we send").
    Token count is an estimate at ~3.5 chars/token, matching the codebase's
    existing approximation (no local tokenizer is installed).
    """
    try:
        serialized = json.dumps(payload, ensure_ascii=False)
    except Exception as e:
        print(f"[LLM Send] Could not serialize payload for sizing ({e})")
        return
    total_chars = len(serialized)
    est_tokens = int(total_chars / 3.5)
    messages = payload.get("messages") or []
    msg_chars = sum(len(str(m.get("content") or "")) for m in messages)
    prefix = f"[LLM Send {tag}]" if tag else "[LLM Send]"
    print(
        f"{prefix} model='{model}' | {len(messages)} messages | "
        f"{total_chars:,} total chars | ~{est_tokens:,} est tokens "
        f"(payload JSON, chars/3.5) | {msg_chars:,} chars in message contents"
    )


_TIKTOKEN_ENCODING = None


def _count_tokens(text: str) -> int:
    """
    Counts tokens for a string using tiktoken (o200k_base) when available,
    otherwise falls back to the codebase's ~3.5 chars/token estimate.
    """
    if not text:
        return 0
    global _TIKTOKEN_ENCODING
    try:
        if _TIKTOKEN_ENCODING is None:
            import tiktoken
            _TIKTOKEN_ENCODING = tiktoken.get_encoding("o200k_base")
        return len(_TIKTOKEN_ENCODING.encode(str(text)))
    except Exception:
        return int(len(str(text)) / 3.5)


def _count_messages_tokens(messages: List[Dict]) -> int:
    """Summed token count across a list of message dicts (content only)."""
    return sum(_count_tokens(m.get("content") or "") for m in messages)


def _grep_tool_candidates(mcp_tools) -> list:
    """Best-effort sources for the jarvis_grep_files schema so coder mode can force-ship it."""
    candidates = []
    all_local = getattr(mcp_tools, "_all_local_definitions", None)
    if callable(all_local):
        try:
            candidates.extend(all_local())
        except Exception:
            pass
    if not any(t.get("function", {}).get("name") == "jarvis_grep_files" for t in candidates):
        try:
            from app.tools.definitions import get_advanced_jarvis_tools_definition
            candidates.extend(get_advanced_jarvis_tools_definition())
        except Exception:
            pass
    return candidates


def _extract_confirmation_target(result: str) -> str:
    """Pull the human-readable target out of a `CONFIRM_REQUIRED: ...` tool result."""
    match = re.search(r"CONFIRM_REQUIRED:\s*(.+)", str(result or ""))
    if not match:
        return ""
    target = match.group(1).strip()
    return re.sub(r"\s+\([^)]*\)$", "", target)



def is_vision_model(model_name: str) -> bool:
    """Helper function to dynamically detect if a resolved model supports native vision API payloads."""
    from app import config
    if getattr(config, "ACTIVE_LLM_SUPPORTS_VISION", False):
        return True
    if not model_name:
        return False
    name_low = str(model_name).lower().strip()
    vision_keywords = (
        "gemini", "gpt-4o", "gpt-4-turbo", "claude", "qwen", "pixtral",
        "grok-vision", "deepseek-vl", "internvl", "minicpm", "llava", "vision"
    )
    return any(kw in name_low for kw in vision_keywords)


def _sanitize_attachments_for_history(attachments) -> list:
    """Strip heavy payloads (base64 data_url, text_content) and keep only metadata for persistence."""
    if not attachments:
        return []
    out = []
    for att in attachments:
        if not isinstance(att, dict):
            continue
        out.append({
            "filename": att.get("filename", ""),
            "save_path": att.get("save_path", ""),
            "is_image": bool(att.get("is_image", False)),
            "is_text": bool(att.get("is_text", False)),
            "file_size": att.get("file_size", 0)
        })
    return out


def _message_text(content) -> str:
    """Convert message content (possibly a multimodal list) into plain text for intent/tool logic."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    parts.append(str(part.get("text", "")))
                elif isinstance(part.get("content"), str):
                    parts.append(part["content"])
            elif isinstance(part, str):
                parts.append(part)
        return " ".join(p for p in parts if p).strip()
    return str(content or "")


def _format_short_circuit_result(tool_name: str, tool_result: str, tool_args: dict) -> str:
    if not isinstance(tool_result, str):
        return str(tool_result)
    
    clean_res = tool_result.strip()
    if tool_name == "open_or_play_file":
        if "started playing" in clean_res:
            parts = clean_res.split("'")
            if len(parts) >= 2:
                filename = os.path.basename(parts[1])
                name, _ = os.path.splitext(filename)
                return f"Playing '{name}'..."
            return "Playing media..."
        elif "opened" in clean_res or "launched" in clean_res.lower():
            parts = clean_res.split("'")
            if len(parts) >= 2:
                path_val = parts[1]
                if "shell:AppsFolder" in path_val:
                    query = tool_args.get("file_path_or_query") or tool_args.get("query") or "application"
                    if "shell:" in query or "\\" in query or "/" in query:
                        app_part = path_val.split("\\")[-1].split("!")[0]
                        if "_" in app_part:
                            app_part = app_part.split("_")[0]
                        if "." in app_part:
                            app_part = app_part.split(".")[1] if len(app_part.split(".")) > 1 else app_part.split(".")[0]
                        if "_" in app_part:
                            app_part = app_part.split("_")[0]
                        query = app_part
                    return f"Launched '{query.title()}'!"
                
                filename = os.path.basename(path_val)
                return f"Opened '{filename}'."
            return "Opened file."
            
    elif tool_name == "launch_app":
        parts = clean_res.split("'")
        if len(parts) >= 2:
            app_name = parts[1]
            if "shell:AppsFolder" in app_name:
                query = tool_args.get("app_name") or tool_args.get("name") or "application"
                return f"Launched '{query.title()}'!"
            return f"Launched '{app_name.title()}'!"
            
    elif tool_name == "web_search":
        if "No direct search results found" in clean_res:
            return "Hmph, I couldn't find any search results for that."
        if clean_res.startswith("Web search failed:"):
            return "Hmph, my web search failed: " + clean_res[len("Web search failed:"):].strip()
        return f"I found this on the web:\n\n{clean_res}"


    # Strip "Success: " prefix for cleaner chat/speech
    if clean_res.startswith("Success: "):
        return clean_res[len("Success: "):].strip()
    return clean_res


class AgentExecutor:
    def __init__(self, memory_manager: MemoryManager):
        self.memory = memory_manager
        self._active_turn_id = None
        self._active_session_id = None
        self._session_summary_cache = {}
        
        async def _async_web_search(**kwargs):
            from app.tools.web import web_search
            query_val = kwargs.get("query") or kwargs.get("queries") or kwargs.get("search") or kwargs.get("text")
            if query_val is None and kwargs:
                query_val = list(kwargs.values())[0]
            s_mode = kwargs.get("search_mode") or ("image" if kwargs.get("image_search") else "text_and_snippet")
            cc = kwargs.get("country_code")
            return await web_search(query=query_val, search_mode=s_mode, country_code=cc)
        
        # Lazy-import tool modules to avoid blocking module-level imports
        from app.tools.system import (
            get_system_stats, launch_app, set_system_volume, get_current_datetime,
            control_window, run_terminal_command, run_python_script, take_screenshot,
            keyboard_mouse_input, media_playback_control, manage_process,
            system_power_control
        )
        from app.tools.files import list_directory, search_files, open_or_play_file, create_file, edit_file, delete_file, read_file_content
        from app.tools.jarvis import (
            jarvis_query_file_db, jarvis_read_file, jarvis_create_or_edit_file,
            jarvis_replace_file_content, jarvis_list_dir_tree, jarvis_git_status,
            jarvis_system_diagnostics, jarvis_network_status, jarvis_web_scrape,
            jarvis_window_control, jarvis_run_terminal, jarvis_get_image,
            jarvis_analyze_image, jarvis_generate_image, jarvis_see_screen
        )
        from app.tools.canvas import jarvis_html_graphics, jarvis_html_viewer
        from app.tools.system import send_process_stdin, find_files_by_glob, jarvis_grep_files
        from app.tools.codegraph import (
            codegraph_explore, codegraph_search, codegraph_node, codegraph_files,
            codegraph_callers, codegraph_callees, codegraph_impact, codegraph_status,
        )
        from app.tools.telegram_tools import telegram_send_screenshot, telegram_send_file
        from app.tools.ask_user import ask_user as _ask_user_async
        from app.tools.vrm_catalog import change_avatar_outfit
        from app.tools.safety import authorize_tool_call as _authorize_tool_call_fn
        self._authorize_tool_call = _authorize_tool_call_fn
        self._fallback_call_counter = 0

        # Map tool names to python functions
        self.tools = {
            "get_system_stats": get_system_stats,
            "get_current_datetime": get_current_datetime,
            "change_avatar_outfit": lambda **kwargs: change_avatar_outfit(
                outfit=kwargs.get("model_or_outfit") or kwargs.get("outfit") or kwargs.get("name") or kwargs.get("target") or "default",
                character=kwargs.get("character") or kwargs.get("model") or kwargs.get("character_name"),
                memory_manager=self.memory
            ),
            "launch_app": lambda **kwargs: launch_app(
                kwargs.get("app_name") or kwargs.get("name") or kwargs.get("app") or (list(kwargs.values())[0] if kwargs else ""),
                args=kwargs.get("args"),
                run_as_admin=bool(kwargs.get("run_as_admin", False)),
                new_window=bool(kwargs.get("new_window", False))
            ),
            "close_app": lambda **kwargs: manage_process(
                "kill",
                name=kwargs.get("app_name") or kwargs.get("name") or kwargs.get("target") or (list(kwargs.values())[0] if kwargs else ""),
                pid=kwargs.get("pid")
            ),
            "set_system_volume": lambda **kwargs: set_system_volume(
                volume_level=(
                    int(kwargs["volume_level"]) if kwargs.get("volume_level") is not None and str(kwargs.get("volume_level")).strip() != "" and str(kwargs.get("volume_level")).lower() != "none" else (
                        int(kwargs["volume"]) if kwargs.get("volume") is not None and str(kwargs.get("volume")).strip() != "" and str(kwargs.get("volume")).lower() != "none" else (
                            int(kwargs["level"]) if kwargs.get("level") is not None and str(kwargs.get("level")).strip() != "" and str(kwargs.get("level")).lower() != "none" else None
                        )
                    )
                ),
                action=str(kwargs.get("action") or ("get" if (kwargs.get("volume_level") is None and kwargs.get("volume") is None and kwargs.get("level") is None) else "set"))
            ),
            "update_user_fact": lambda **kwargs: self._execute_update_user_fact(**kwargs),
            "manage_yuki_settings": lambda **kwargs: self._execute_manage_yuki_settings(**kwargs),

            "list_directory": lambda **kwargs: list_directory(
                kwargs.get("directory_path") or kwargs.get("path") or kwargs.get("directory") or kwargs.get("folder")
            ),
            "search_files": lambda **kwargs: search_files(
                kwargs.get("query") or kwargs.get("search") or kwargs.get("name") or "",
                kwargs.get("start_directory") or kwargs.get("directory") or kwargs.get("start_dir") or kwargs.get("path") or kwargs.get("folder")
            ),
            "open_or_play_file": lambda **kwargs: open_or_play_file(
                kwargs.get("file_path_or_query") or kwargs.get("query") or kwargs.get("file_path") or kwargs.get("path") or kwargs.get("filepath") or kwargs.get("file") or "",
                play_mode=bool(kwargs.get("play_mode", False)),
                confirmed=bool(kwargs.get("confirmed", False))
            ),
            "create_file": lambda **kwargs: create_file(
                kwargs.get("file_path") or kwargs.get("path") or kwargs.get("filepath") or kwargs.get("file"),
                kwargs.get("content") or kwargs.get("text") or ""
            ),
            "edit_file": lambda **kwargs: edit_file(
                kwargs.get("file_path") or kwargs.get("path") or kwargs.get("filepath") or kwargs.get("file"),
                kwargs.get("search_text") or kwargs.get("search") or kwargs.get("find") or "",
                kwargs.get("replace_text") or kwargs.get("replace") or kwargs.get("new_text") or ""
            ),
            "delete_file": lambda **kwargs: delete_file(
                kwargs.get("file_path") or kwargs.get("path") or kwargs.get("filepath") or kwargs.get("file"),
                bool(kwargs.get("confirmed", False) or kwargs.get("confirm", False))
            ),
            "read_file_content": lambda **kwargs: read_file_content(
                kwargs.get("file_path") or kwargs.get("path") or kwargs.get("filepath") or kwargs.get("file") or ""
            ),
            "control_window": lambda **kwargs: control_window(
                kwargs.get("action") or "",
                window_title=kwargs.get("window_title"),
                x=int(kwargs.get("x")) if kwargs.get("x") is not None else None,
                y=int(kwargs.get("y")) if kwargs.get("y") is not None else None
            ),
            "run_terminal_command": lambda **kwargs: run_terminal_command(
                kwargs.get("command") or "",
                use_powershell=bool(kwargs.get("use_powershell", True))
            ),
            "run_python_script": lambda **kwargs: run_python_script(
                kwargs.get("code") or ""
            ),
            "take_screenshot": take_screenshot,
            "keyboard_mouse_input": lambda **kwargs: keyboard_mouse_input(
                kwargs.get("action") or "",
                text=kwargs.get("text"),
                keys=kwargs.get("keys"),
                x=kwargs.get("x"),
                y=kwargs.get("y"),
                amount=kwargs.get("amount")
            ),
            "media_playback_control": lambda **kwargs: media_playback_control(
                kwargs.get("action") or "",
                app_name=kwargs.get("app_name"),
                all=bool(kwargs.get("all", False))
            ),
            "manage_process": lambda **kwargs: manage_process(
                kwargs.get("action") or "",
                name=kwargs.get("name"),
                pid=kwargs.get("pid")
            ),
            "system_power_control": lambda **kwargs: system_power_control(
                kwargs.get("action") or "",
                confirmed=bool(kwargs.get("confirmed", False))
            ),
            "manage_timer_stopwatch_alarms": lambda **kwargs: self._execute_manage_timer_stopwatch_alarms(**kwargs),
            "manage_todo": lambda **kwargs: self._execute_manage_todo(**kwargs),
            "manage_personal_list": lambda **kwargs: self._execute_manage_personal_list(**kwargs),
            "jarvis_manage_personal_list": lambda **kwargs: self._execute_manage_personal_list(**kwargs),
            "manage_scheduled_task": lambda **kwargs: self._execute_manage_scheduled_task(**kwargs),
            "web_search": _async_web_search,
            "ask_user": _ask_user_async,

            # --- INDEPENDENT ADVANCED JARVIS TOOLS ---
            "jarvis_query_file_db": lambda **kwargs: jarvis_query_file_db(
                query=kwargs.get("query") or "",
                category=kwargs.get("category"),
                extension=kwargs.get("extension"),
                path_hint=kwargs.get("path_hint"),
                search_scope=kwargs.get("search_scope", "all"),
                limit=int(kwargs.get("limit", 15))
            ),
            "jarvis_read_file": lambda **kwargs: jarvis_read_file(
                kwargs.get("file_path") or kwargs.get("path") or "",
                int(kwargs.get("max_lines", 250)),
                int(kwargs.get("start_line", 1))
            ),
            "jarvis_create_or_edit_file": lambda **kwargs: jarvis_create_or_edit_file(
                file_path=kwargs.get("file_path") or kwargs.get("path") or "",
                content=kwargs.get("content") if kwargs.get("content") is not None else (kwargs.get("file_content") or kwargs.get("code") or kwargs.get("text") or kwargs.get("body") or ""),
                mode=kwargs.get("mode", "write")
            ),
            "jarvis_replace_file_content": lambda **kwargs: jarvis_replace_file_content(
                kwargs.get("file_path") or kwargs.get("path") or "",
                kwargs.get("target_content") or kwargs.get("target") or "",
                kwargs.get("replacement_content") or kwargs.get("replacement") or ""
            ),
            "jarvis_list_dir_tree": lambda **kwargs: jarvis_list_dir_tree(
                kwargs.get("dir_path") or kwargs.get("path") or "",
                int(kwargs.get("max_depth", 2))
            ),
            "jarvis_git_status": lambda **kwargs: jarvis_git_status(
                kwargs.get("repo_path")
            ),
            "jarvis_system_diagnostics": lambda **kwargs: jarvis_system_diagnostics(
                kwargs.get("filter_name"),
                int(kwargs.get("top_n", 10))
            ),
            "jarvis_web_search": _async_web_search,
            "jarvis_web_scrape": lambda **kwargs: jarvis_web_scrape(
                kwargs.get("url") or "",
                int(kwargs.get("max_chars", 4000))
            ),
            "jarvis_launch_app": lambda **kwargs: launch_app(
                kwargs.get("app_name") or kwargs.get("name") or "",
                args=kwargs.get("args"),
                new_window=bool(kwargs.get("new_window", False))
            ),
            "jarvis_open_or_play_file": lambda **kwargs: open_or_play_file(
                kwargs.get("file_path_or_query") or kwargs.get("query") or "",
                play_mode=bool(kwargs.get("play_mode", False)),
                confirmed=bool(kwargs.get("confirmed", False))
            ),
            "jarvis_window_control": lambda **kwargs: jarvis_window_control(
                kwargs.get("action", "list"),
                kwargs.get("title_query")
            ),
            "jarvis_system_volume": lambda **kwargs: set_system_volume(
                volume_level=(
                    int(kwargs["volume_level"]) if kwargs.get("volume_level") is not None and str(kwargs.get("volume_level")).strip() != "" and str(kwargs.get("volume_level")).lower() != "none" else (
                        int(kwargs["volume"]) if kwargs.get("volume") is not None and str(kwargs.get("volume")).strip() != "" and str(kwargs.get("volume")).lower() != "none" else (
                            int(kwargs["level"]) if kwargs.get("level") is not None and str(kwargs.get("level")).strip() != "" and str(kwargs.get("level")).lower() != "none" else None
                        )
                    )
                ),
                action=str(kwargs.get("action") or ("get" if (kwargs.get("volume_level") is None and kwargs.get("volume") is None and kwargs.get("level") is None) else "set"))
            ),
            "jarvis_system_power": lambda **kwargs: system_power_control(
                kwargs.get("action") or "",
                confirmed=bool(kwargs.get("confirmed", False))
            ),
            "jarvis_manage_timer_stopwatch_alarms": lambda **kwargs: self._execute_manage_timer_stopwatch_alarms(**kwargs),
            "jarvis_manage_scheduled_task": lambda **kwargs: self._execute_manage_scheduled_task(**kwargs),
            "jarvis_remember_user_fact": lambda **kwargs: self._execute_update_user_fact(**kwargs),
            "jarvis_manage_yuki_settings": lambda **kwargs: self._execute_manage_yuki_settings(**kwargs),
            "jarvis_change_avatar_outfit": lambda **kwargs: change_avatar_outfit(
                outfit=kwargs.get("model_or_outfit") or kwargs.get("outfit") or kwargs.get("name") or kwargs.get("target") or "default",
                character=kwargs.get("character") or kwargs.get("model") or kwargs.get("character_name"),
                memory_manager=self.memory
            ),
            "jarvis_close_app": lambda **kwargs: manage_process(
                "kill",
                name=kwargs.get("app_name") or kwargs.get("name") or "",
                pid=kwargs.get("pid")
            ),
            "jarvis_run_terminal": lambda **kwargs: run_terminal_command(
                kwargs.get("command") or "",
                use_powershell=bool(kwargs.get("use_powershell", True)),
                cwd=self._get_active_session_dir(kwargs),
                stdin_input=kwargs.get("stdin_input")
            ),
            "jarvis_send_stdin": lambda **kwargs: send_process_stdin(
                input_text=kwargs.get("input_text") or "",
                pid=kwargs.get("pid")
            ),
            "jarvis_get_image": lambda **kwargs: jarvis_get_image(
                kwargs.get("image_path") or kwargs.get("path") or "",
                prompt=kwargs.get("prompt") or ""
            ),
            "jarvis_analyze_image": lambda **kwargs: jarvis_analyze_image(
                kwargs.get("image_path") or kwargs.get("path") or "",
                prompt=kwargs.get("prompt") or ""
            ),
            "jarvis_generate_image": lambda **kwargs: jarvis_generate_image(
                prompt=kwargs.get("prompt") or "",
                aspect_ratio=kwargs.get("aspect_ratio") or "1:1",
                style=kwargs.get("style") or "auto"
            ),
            "generate_image": lambda **kwargs: jarvis_generate_image(
                prompt=kwargs.get("prompt") or "",
                aspect_ratio=kwargs.get("aspect_ratio") or "1:1",
                style=kwargs.get("style") or "auto"
            ),
            "jarvis_see_screen": lambda **kwargs: jarvis_see_screen(
                kwargs.get("prompt") or "",
                window_title=kwargs.get("window_title")
            ),
            "jarvis_find_files_by_glob": lambda **kwargs: find_files_by_glob(
                pattern=kwargs.get("pattern") or "*",
                search_dir=kwargs.get("search_dir") or kwargs.get("root_dir") or self._get_active_session_dir(kwargs)
            ),
            "jarvis_grep_files": lambda **kwargs: jarvis_grep_files(
                pattern=kwargs.get("pattern") or "",
                file_pattern=kwargs.get("file_pattern") or kwargs.get("glob") or "*",
                search_dir=kwargs.get("search_dir") or kwargs.get("directory") or kwargs.get("dir") or self._get_active_session_dir(kwargs),
                case_sensitive=bool(kwargs.get("case_sensitive", False)),
                max_results=int(kwargs.get("max_results") or 100)
            ),
            "jarvis_run_python": lambda **kwargs: run_python_script(
                kwargs.get("code") or "",
                cwd=self._get_active_session_dir(kwargs)
            ),
            "jarvis_keyboard_mouse_input": lambda **kwargs: keyboard_mouse_input(
                kwargs.get("action") or "",
                text=kwargs.get("text"),
                keys=kwargs.get("keys"),
                x=kwargs.get("x"),
                y=kwargs.get("y"),
                amount=kwargs.get("amount")
            ),
            "jarvis_media_playback_control": lambda **kwargs: media_playback_control(
                kwargs.get("action") or "",
                app_name=kwargs.get("app_name"),
                all=bool(kwargs.get("all", False))
            ),
            "jarvis_html_graphics": lambda **kwargs: jarvis_html_graphics(
                kwargs.get("svg_or_canvas") or ""
            ),
            "jarvis_html_viewer": lambda **kwargs: jarvis_html_viewer(
                html_content=kwargs.get("html_content") or "",
                file_path=kwargs.get("file_path") or ""
            ),

            # --- CODEGRAPH CODE INTELLIGENCE TOOLS (opt-in; read-only) ---
            "codegraph_explore": lambda **kwargs: codegraph_explore(
                kwargs.get("query") or "",
                max_files=kwargs.get("max_files"),
                project_path=kwargs.get("project_path") or kwargs.get("path")
            ),
            "codegraph_search": lambda **kwargs: codegraph_search(
                kwargs.get("query") or "",
                limit=kwargs.get("limit"),
                project_path=kwargs.get("project_path") or kwargs.get("path")
            ),
            "codegraph_node": lambda **kwargs: codegraph_node(
                kwargs.get("name") or kwargs.get("symbol") or "",
                project_path=kwargs.get("project_path") or kwargs.get("path")
            ),
            "codegraph_files": lambda **kwargs: codegraph_files(
                project_path=kwargs.get("project_path") or kwargs.get("path")
            ),
            "codegraph_callers": lambda **kwargs: codegraph_callers(
                kwargs.get("symbol") or kwargs.get("name") or "",
                limit=kwargs.get("limit"),
                project_path=kwargs.get("project_path") or kwargs.get("path")
            ),
            "codegraph_callees": lambda **kwargs: codegraph_callees(
                kwargs.get("symbol") or kwargs.get("name") or "",
                limit=kwargs.get("limit"),
                project_path=kwargs.get("project_path") or kwargs.get("path")
            ),
            "codegraph_impact": lambda **kwargs: codegraph_impact(
                kwargs.get("symbol") or kwargs.get("name") or "",
                project_path=kwargs.get("project_path") or kwargs.get("path")
),
            "codegraph_status": lambda **kwargs: codegraph_status(
                project_path=kwargs.get("project_path") or kwargs.get("path")
            ),
            "codegraph_set_workspace_directory": lambda **kwargs: self._codegraph_set_workspace_directory(**kwargs),
            "telegram_send_screenshot": lambda **kwargs: telegram_send_screenshot(caption=kwargs.get("caption") or ""),
            "telegram_send_file": lambda **kwargs: telegram_send_file(
                file_or_folder_path=kwargs.get("file_or_folder_path") or kwargs.get("path") or kwargs.get("file_path") or "",
                caption=kwargs.get("caption") or ""
            ),
        }
        from app.mcp_client import StdioMCPToolBridge
        self.mcp_tools = StdioMCPToolBridge(get_tools_definition, get_filtered_tools)

        # Let the scheduled-tasks engine fire Yuki tool / power actions in-process.
        from app.tools import scheduled_tasks as _scheduled_tasks
        self._scheduled_tasks_module = _scheduled_tasks
        _scheduled_tasks.set_action_executor(self._run_scheduled_action)

    def _normalize_tool_name(self, tool_name: str) -> str:
        """
        Normalizes and auto-heals corrupted, doubled, or hallucinated tool names.
        e.g., 'jarvis_web_searchjarvis_web_search' -> 'jarvis_web_search'
        """
        if not tool_name or not isinstance(tool_name, str):
            return ""

        cleaned = tool_name.strip()
        if hasattr(self, "tools") and cleaned in self.tools:
            return cleaned

        # 1. Check for exact repeated string concatenations (e.g. "tooltool", "tooltooltool")
        if hasattr(self, "tools"):
            for reg_tool in self.tools.keys():
                if not reg_tool:
                    continue
                if cleaned == reg_tool * 2 or cleaned == reg_tool * 3:
                    print(f"[Executor] Auto-healed doubled tool name '{tool_name}' -> '{reg_tool}'")
                    return reg_tool
                if len(cleaned) > len(reg_tool) and cleaned.replace(reg_tool, "") == "":
                    print(f"[Executor] Auto-healed repeated tool name '{tool_name}' -> '{reg_tool}'")
                    return reg_tool

            # 2. Check for punctuation / underscore variations
            for reg_tool in self.tools.keys():
                if not reg_tool:
                    continue
                clean_nopunct = cleaned.lower().replace("_", "").replace("-", "")
                reg_nopunct = reg_tool.lower().replace("_", "").replace("-", "")
                if clean_nopunct == reg_nopunct * 2 or clean_nopunct == reg_nopunct:
                    print(f"[Executor] Auto-healed normalized tool name '{tool_name}' -> '{reg_tool}'")
                    return reg_tool

        return cleaned

    # ------------------------------------------------------------------ #
    #  Tool dispatcher helper                                              #
    # ------------------------------------------------------------------ #

    async def _run_tool_async(self, tool_name: str, tool_args: Dict[str, Any], *, mode: str = "assistant", workspace_root: Optional[str] = None) -> str:
        """
        Executes a registered tool by name with the given args.
        Prefers the stdio MCP tool boundary and falls back to the legacy
        in-process dispatcher when configured or when MCP startup fails.

        Durably journals the START record (with full raw args) BEFORE any
        dispatch and the END record afterwards, so a hard crash mid-run still
        leaves the running tool's parameters on disk (tool_runs.jsonl).
        """
        tool_name = self._normalize_tool_name(tool_name)
        from app.agent.tool_journal import record_tool_start, record_tool_end
        from app.tools.selector import record_recent_tool

        raw_args = dict(tool_args or {})
        turn_id = self._active_turn_id or ""
        start_ts = time.time()
        record_tool_start(turn_id, tool_name, raw_args)
        record_recent_tool(tool_name)

        if not self.mcp_tools.enabled:
            return await self._run_in_process_tool(tool_name, raw_args, mode=mode, workspace_root=workspace_root)

        # Stdio MCP tool execution path (preferred)
        try:
            res = await self.mcp_tools.call_tool(tool_name, raw_args)
            record_tool_end(turn_id, tool_name, res, time.time() - start_ts)
            return res
        except Exception as e:
            # Fall back to in-process execution on any MCP fault
            res = await self._run_in_process_tool(tool_name, raw_args, mode=mode, workspace_root=workspace_root)
            record_tool_end(turn_id, tool_name, res, time.time() - start_ts)
            return res

    async def _run_in_process_tool(self, tool_name: str, raw_args: Dict[str, Any], *, mode: str = "assistant", workspace_root: Optional[str] = None) -> str:
        """In-process legacy tool execution path (fallback)."""
        import inspect

        if tool_name not in self.tools:
            if self.mcp_tools.last_error:
                return f"Error: Tool '{tool_name}' is not registered. MCP status: {self.mcp_tools.last_error}"
            return f"Error: Tool '{tool_name}' is not registered."

        local_decision = self._authorize_tool_call(tool_name, raw_args, consume_grant=True, mode=mode, workspace_root=workspace_root)
        if not local_decision.allowed:
            return local_decision.message

        execution_args = local_decision.arguments or {}
        tool_func = self.tools[tool_name]
        try:
            if inspect.iscoroutinefunction(tool_func):
                return await (tool_func(**execution_args) if execution_args else tool_func())
            else:
                res = tool_func(**execution_args) if execution_args else tool_func()
                if inspect.iscoroutine(res):
                    return await res
                return res
        except Exception as e:
            return f"Error executing tool: {str(e)}"

    def _get_active_session_dir(self, kwargs: dict) -> Optional[str]:
        raw = kwargs.get("cwd") or kwargs.get("dir")
        if raw:
            return raw
        try:
            profile_dirs = self.memory.profile.get("settings", {}).get("session_directories", [])
            if profile_dirs and isinstance(profile_dirs, list) and len(profile_dirs) > 0 and isinstance(profile_dirs[0], dict):
                val = profile_dirs[0].get("value")
                if val:
                    return val
        except Exception:
            pass
        return None

    def _codegraph_set_workspace_directory(self, **kwargs) -> str:
        """Register a directory as the active coder workspace (persists to
        settings.session_directories + sets the in-process active dir)."""
        raw = kwargs.get("path") or kwargs.get("dir") or kwargs.get("directory") or kwargs.get("cwd")
        if not raw or str(raw).strip() in ("", "None"):
            return "Error: Missing 'path' — pass the absolute directory to register as the active workspace."
        resolved = os.path.abspath(os.path.expanduser(os.path.expandvars(str(raw).strip('"\''))))
        if not os.path.isdir(resolved):
            return f"Error: '{resolved}' is not a directory on this PC."

        try:
            dirs = list(self.memory.profile.get("settings", {}).get("session_directories", []))
        except Exception:
            dirs = []
        if not isinstance(dirs, list):
            dirs = []
        dirs = [d for d in dirs if not (isinstance(d, dict) and os.path.abspath(os.path.expandvars(str(d.get("value", "")))) == resolved)]
        dirs.insert(0, {"key": os.path.basename(resolved), "value": resolved})
        try:
            self.memory.update_setting("session_directories", dirs)
        except Exception as e:
            return f"Error persisting workspace directory: {e}"

        try:
            from app.tools.system import set_active_workspace_directory
            set_active_workspace_directory(resolved)
        except Exception:
            pass
        return f"Workspace directory registered: '{resolved}' is now the active workspace for coder mode (codegraph will target it)."

    def _execute_update_user_fact(self, **kwargs) -> str:
        key = (kwargs.get("key") or "").strip().lower()
        val = str(kwargs.get("value") or "").strip()

        if not key or not val:
            return "Error: Missing key or value for update_user_fact."

        if key in ("name", "user_name", "username"):
            return self.memory.set_user_name(val)
        elif key in ("interest", "user_interest", "interests", "user_interests"):
            return self.memory.add_interest(val)
        elif key in ("hobby", "hobbies", "user_hobby", "user_hobbies"):
            return self.memory.add_hobby(val)
        elif key in ("like", "likes", "user_like", "user_likes"):
            return self.memory.add_like(val)
        elif key in ("dislike", "dislikes", "user_dislike", "user_dislikes", "hate", "hates"):
            return self.memory.add_dislike(val)
        else:
            return self.memory.update_fact(kwargs.get("key"), val)

    def _execute_manage_yuki_settings(self, **kwargs) -> str:
        """Programmatically view, update, or reset runtime app settings."""
        action = str(kwargs.get("action") or kwargs.get("cmd") or "").strip().lower()
        key = str(kwargs.get("key") or kwargs.get("setting") or "").strip()
        val = kwargs.get("value") if "value" in kwargs else kwargs.get("val")

        memory_mgr = getattr(self, "memory", None)
        if not memory_mgr:
            from app.memory.local_mem import MemoryManager
            memory_mgr = MemoryManager()

        settings = memory_mgr.profile.get("settings", {})

        if action in ("get_settings", "get", "view", "list", "read"):
            if key:
                if key not in settings:
                    return f"Setting '{key}' is not explicitly configured (system defaults apply)."
                v = settings[key]
                if any(sec in key.lower() for sec in ("key", "token", "secret", "password")):
                    v = "********" if v else ""
                return f"Setting '{key}': {v}"
            else:
                safe_settings = {}
                for k, v in settings.items():
                    if any(sec in k.lower() for sec in ("key", "token", "secret", "password")):
                        safe_settings[k] = "********" if v else ""
                    else:
                        safe_settings[k] = v
                return f"Current Yuki Settings:\n{json.dumps(safe_settings, indent=2)}"

        elif action in ("update_setting", "update", "set", "write"):
            if not key:
                return "Error: 'key' parameter is required for update_setting."
            if val is None:
                return f"Error: 'value' parameter is required to update setting '{key}'."
            res = memory_mgr.update_setting(key, val)
            return res

        elif action in ("reset_setting", "reset", "clear", "delete"):
            if not key:
                return "Error: 'key' parameter is required for reset_setting."
            if "settings" in memory_mgr.profile and key in memory_mgr.profile["settings"]:
                del memory_mgr.profile["settings"][key]
                memory_mgr._save_profile()
                return f"Setting '{key}' has been reset to default."
            return f"Setting '{key}' was not custom-set."

        return f"Error: Invalid setting action '{action}'. Supported actions: get_settings, update_setting, reset_setting."

    def _execute_manage_timer_stopwatch_alarms(self, **kwargs) -> str:
        from app.tools import time_manager
        action = (kwargs.get("action") or "").lower().strip()
        
        # Smart action inferring if model omitted action parameter
        duration_sec = kwargs.get("duration_seconds")
        if duration_sec is not None:
            try:
                duration_sec = int(duration_sec)
            except (ValueError, TypeError):
                duration_sec = time_manager.parse_duration_seconds(str(duration_sec))
        else:
            dur_str = str(kwargs.get("duration") or kwargs.get("time") or "")
            unit_str = str(kwargs.get("unit") or "")
            if dur_str:
                combined = f"{dur_str} {unit_str}".strip()
                duration_sec = time_manager.parse_duration_seconds(combined)

        if not action:
            if duration_sec or kwargs.get("duration"):
                action = "set_timer"
            elif kwargs.get("label"):
                action = "start_stopwatch"
            else:
                action = "set_reminder"

        # If LLM sent set_timer but target_time is a clock time (not a relative duration),
        # and duration_seconds is 0/None, it really means set_alarm/set_reminder
        target_time_raw = str(kwargs.get("target_time") or "")
        if action in ("set_timer", "timer") and (not duration_sec or duration_sec == 0) and target_time_raw:
            # It's a specific time, not a countdown — treat as alarm
            action = "set_alarm"

        if action in ("set_timer", "timer"):

            dur = int(duration_sec) if duration_sec else 300
            msg = kwargs.get("message") or kwargs.get("label") or kwargs.get("name") or "Timer Up!"
            res = time_manager.add_timer(dur, msg, kwargs.get("action_command"))
            return f"Successfully set a {res['formatted_duration']} timer for '{res['message']}'."
        elif action in ("set_alarm", "alarm", "create_alarm", "add_alarm"):
            if duration_sec and duration_sec > 0:
                dur = int(duration_sec)
                msg = kwargs.get("message") or kwargs.get("label") or kwargs.get("name") or "Alarm!"
                res = time_manager.add_timer(dur, msg, kwargs.get("action_command"), category="alarm")
                return f"Successfully set an alarm for {res['formatted_duration']} from now: '{res['message']}'."
            else:
                target_str = str(kwargs.get("target_time") or kwargs.get("time_str") or kwargs.get("time") or "5m")
                msg = kwargs.get("message") or kwargs.get("reminder") or "Alarm!"
                res = time_manager.add_reminder(target_str, msg, kwargs.get("recurrence"), kwargs.get("action_command"))
                return f"Successfully scheduled alarm for {res['target_time_formatted']}: '{res['message']}'."
        elif action == "set_reminder":
            target_str = str(kwargs.get("target_time") or kwargs.get("time_str") or kwargs.get("time") or "5m")
            msg = kwargs.get("message") or kwargs.get("reminder") or "Reminder"
            res = time_manager.add_reminder(target_str, msg, kwargs.get("recurrence"), kwargs.get("action_command"))
            return f"Successfully scheduled reminder for {res['target_time_formatted']}: '{res['message']}'."
        elif action == "start_stopwatch":
            lbl = kwargs.get("label") or "default"
            res = time_manager.start_stopwatch(lbl)
            return f"Started stopwatch '{res['label']}'."
        elif action == "check_stopwatch":
            lbl = kwargs.get("label") or "default"
            res = time_manager.check_stopwatch(lbl)
            if res.get("status") == "ok":
                return f"Stopwatch '{res['label']}' elapsed time: {res['formatted_elapsed']}."
            return res.get("message", "Stopwatch not found.")
        elif action == "stop_stopwatch":
            lbl = kwargs.get("label") or "default"
            res = time_manager.stop_stopwatch(lbl)
            if res.get("status") == "ok":
                return f"Stopped stopwatch '{res['label']}' at {res['formatted_elapsed']}."
            return res.get("message", "Stopwatch not found.")
        elif action == "list_active":
            items = time_manager.get_active_time_items()
            rems = items.get("reminders", [])
            sws = items.get("stopwatches", [])
            out = []
            if rems:
                out.append("Active Timers & Reminders:\n" + "\n".join([f"- #{r['id']} [{r['category']}]: '{r['message']}' ({r['remaining_seconds']}s remaining)" for r in rems]))
            if sws:
                out.append("Active Stopwatches:\n" + "\n".join([f"- '{s['label']}': {s['formatted_elapsed']} elapsed" for s in sws]))
            return "\n\n".join(out) if out else "No active timers, reminders, or stopwatches."
        elif action == "cancel":
            item_id = kwargs.get("item_id") or kwargs.get("id")
            if item_id:
                time_manager.delete_reminder(int(item_id))
                return f"Successfully cancelled timer/reminder #{item_id}."
            return "Missing item_id for cancellation."
        return f"Unknown action '{action}' for manage_timer_stopwatch_alarms."

    def _execute_manage_scheduled_task(self, **kwargs) -> str:
        from app.tools import scheduled_tasks
        action = (kwargs.get("action") or "").lower().strip()
        action_type = (kwargs.get("action_type") or "shell").lower().strip()
        action_command = kwargs.get("action_command")
        action_tool = kwargs.get("action_tool")
        action_args = kwargs.get("action_args") or {}
        if isinstance(action_args, str):
            try:
                action_args = json.loads(action_args)
            except Exception:
                action_args = {}

        # 1. First-class structured fields (preferred)
        run_tool = (kwargs.get("run_tool") or "").strip()
        run_builtin = (kwargs.get("run_builtin") or "").strip().lower()
        run_notify = (kwargs.get("run_notify") or "").strip()
        run_command = (kwargs.get("run_command") or "").strip()

        if run_tool:
            action_type = "tool"
            action_tool = self._resolve_tool_name(run_tool)
            raw_args = kwargs.get("run_args") or action_args or {}
            if isinstance(raw_args, str):
                try:
                    raw_args = json.loads(raw_args)
                except Exception:
                    raw_args = {}
            action_args = dict(raw_args)
        elif run_builtin:
            if run_builtin in ("shutdown", "restart", "sleep", "lock"):
                action_type = "power"
                action_command = run_builtin
                action_args = {"action": run_builtin}
            elif run_builtin.startswith("sound:") or run_builtin in ("tada", "chime", "beep"):
                action_type = "sound"
                action_command = run_builtin.split(":", 1)[-1]
                action_args = {"sound": action_command}
        elif run_notify:
            action_type = "popup"
            action_command = run_notify
            action_args = {"message": run_notify}
        elif run_command:
            action_type = "shell"
            action_command = run_command
        else:
            # 2. Backwards-compatible 'do' / 'run' string parsing
            do = (kwargs.get("do") or kwargs.get("run") or "").strip()
            if do:
                if do.lower().startswith("sound:"):
                    action_type = "sound"
                    action_command = do.split(":", 1)[1].strip() or "tada"
                elif do.lower().startswith("popup:"):
                    action_type = "popup"
                    action_command = do.split(":", 1)[1].strip() or "Reminder"
                elif do.lower().startswith("notify:"):
                    action_type = "notify"
                    action_command = do.split(":", 1)[1].strip() or "Notification"
                elif do.lower().startswith("telegram:"):
                    action_type = "telegram"
                    action_command = do.split(":", 1)[1].strip() or "Alert"
                elif do.lower().startswith("power:"):
                    action_type = "power"
                    action_command = do.split(":", 1)[1].strip() or "shutdown"
                    action_args = {"action": action_command}
                elif any(do.lower().startswith(p) for p in ("launch_app:", "app_name:", "app:", "launch:", "open:", "start:")):
                    target_app = do.split(":", 1)[1].strip()
                    action_type = "tool"
                    action_tool = "launch_app"
                    action_args = {"app_name": target_app, "query": target_app}
                elif any(do.lower().startswith(p) for p in ("close_app:", "close:", "kill:", "terminate:")):
                    target_app = do.split(":", 1)[1].strip()
                    action_type = "tool"
                    action_tool = "close_app"
                    action_args = {"app_name": target_app, "name": target_app, "action": "kill"}
                elif ":" in do and (do.split(":", 1)[0].strip() in self.tools or self._resolve_tool_name(do.split(":", 1)[0].strip()) in self.tools):
                    t_cand, t_arg = do.split(":", 1)
                    action_type = "tool"
                    action_tool = self._resolve_tool_name(t_cand.strip())
                    val = t_arg.strip()
                    action_args = {
                        "app_name": val,
                        "query": val,
                        "file_path_or_query": val,
                        "path": val,
                        "message": val,
                    }
                elif do in self.tools or self._resolve_tool_name(do) in self.tools:
                    action_type = "tool"
                    action_tool = self._resolve_tool_name(do)
                else:
                    action_type = "shell"
                    action_command = do

        if action in ("set_delayed", "delayed", "schedule", "do_later"):
            seconds = kwargs.get("seconds") or kwargs.get("delay") or kwargs.get("duration") or kwargs.get("after")
            try:
                seconds = float(seconds or 0)
            except (ValueError, TypeError):
                seconds = scheduled_tasks._parse_duration_seconds(str(seconds))
            if not seconds or seconds <= 0:
                return "Error: 'seconds' is required for set_delayed."
            res = scheduled_tasks.add_delayed(
                seconds,
                action_type=action_type,
                action_command=action_command,
                action_tool=action_tool,
                action_args=action_args,
            )
            return f"Scheduled task #{res['id']} to fire in {res['seconds']:.0f} seconds."

        if action in ("set_interval", "interval", "repeat", "every"):
            seconds = kwargs.get("seconds") or kwargs.get("interval") or kwargs.get("every") or kwargs.get("duration")
            try:
                seconds = float(seconds or 0)
            except (ValueError, TypeError):
                seconds = scheduled_tasks._parse_duration_seconds(str(seconds))
            if not seconds or seconds <= 0:
                return "Error: 'seconds' (interval) is required for set_interval."
            count = kwargs.get("count")
            if count is not None:
                try:
                    count = int(count)
                except (ValueError, TypeError):
                    count = None
            res = scheduled_tasks.add_interval(
                seconds,
                count=count,
                action_type=action_type,
                action_command=action_command,
                action_tool=action_tool,
                action_args=action_args,
            )
            return f"Interval task #{res['id']} set to fire every {res['interval_seconds']:.0f}s (count={count})."

        if action in ("watch", "watcher", "monitor", "keep_an_eye"):
            condition = (kwargs.get("condition") or kwargs.get("fire_condition") or kwargs.get("if") or "closed").lower().strip()
            monitor = (kwargs.get("kind") or kwargs.get("monitor_type") or kwargs.get("monitor") or "").lower().strip()
            target = kwargs.get("target") or kwargs.get("process") or kwargs.get("pid") or kwargs.get("window") or kwargs.get("file") or ""
            
            # Normalize conditions
            if condition in ("closed", "close", "gone", "exit", "quit", "stopped", "killed", "terminated"):
                condition = "closed"
            elif condition in ("opened", "open", "present", "running", "started", "launched"):
                condition = "opened"

            # Auto-infer monitor kind if omitted
            if not monitor:
                if condition in ("battery_low", "battery_charging", "battery", "charging", "discharging", "low"):
                    monitor = "battery"
                elif condition in ("storage_low", "storage", "disk"):
                    monitor = "storage"
                elif condition in ("network_disconnected", "network_connected", "network", "disconnected", "connected"):
                    monitor = "network"
                elif condition in ("changed", "modified", "deleted", "exists", "created"):
                    monitor = "file"
                elif condition in ("exit0", "exit_nonzero"):
                    monitor = "command"
                else:
                    monitor = "app"

            if not target:
                return "Error: 'target' is required for watch."

            seconds = kwargs.get("seconds") or kwargs.get("interval") or kwargs.get("every")
            if seconds is None:
                seconds = 1.5 if monitor in ("app", "window", "process") else 30.0
            else:
                try:
                    seconds = float(seconds)
                except (ValueError, TypeError):
                    seconds = 1.5 if monitor in ("app", "window", "process") else 30.0

            count = kwargs.get("count")
            if count is None:
                count = 1
            else:
                try:
                    count = int(count)
                except (ValueError, TypeError):
                    count = 1
            res = scheduled_tasks.add_watcher(
                monitor_type=monitor,
                target=str(target),
                interval_seconds=seconds,
                fire_condition=condition,
                count=count,
                action_type=action_type,
                action_command=action_command,
                action_tool=action_tool,
                action_args=action_args,
            )
            return (
                f"Watcher #{res['id']} active: every {res['interval_seconds']:.1f}s check {res['monitor_type']} "
                f"'{res['target']}' and fire when {res['fire_condition']}."
            )

        if action in ("list", "list_active"):
            items = scheduled_tasks.list_tasks(active_only=True).get("tasks", [])
            if not items:
                return "No active scheduled tasks."
            lines = []
            for t in items:
                kind = t.get("kind")
                if kind == "watcher":
                    desc = f"{t.get('monitor_type')} '{t.get('target')}' -> {t.get('fire_condition')}"
                else:
                    desc = f"every {t.get('interval_seconds')}s" if kind == "interval" else f"in {t.get('remaining_seconds')}s"
                action_desc = t.get("action_command") or t.get("action_tool") or t.get("action_type") or "shell"
                lines.append(f"- #{t['id']} [{kind}] {desc} -> {action_desc}")
            return "Active scheduled tasks:\n" + "\n".join(lines)

        if action in ("pause", "hold"):
            item_id = kwargs.get("item_id") or kwargs.get("id")
            if item_id:
                res = scheduled_tasks.pause_task(int(item_id))
                return f"Paused scheduled task #{item_id}."
            return "Missing item_id to pause."

        if action in ("resume", "unpause"):
            item_id = kwargs.get("item_id") or kwargs.get("id")
            if item_id:
                res = scheduled_tasks.resume_task(int(item_id))
                return f"Resumed scheduled task #{item_id}."
            return "Missing item_id to resume."

        if action in ("cancel", "delete", "stop"):
            item_id = kwargs.get("item_id") or kwargs.get("id")
            if item_id:
                res = scheduled_tasks.cancel_task(int(item_id))
                return f"Cancelled scheduled task #{res['id']}."
            return "Missing item_id for cancellation."

        return f"Unknown action '{action}' for manage_scheduled_task."

    def _resolve_tool_name(self, name: str) -> str:
        """Resolve a scheduled-action tool name to a name registered in ``self.tools``."""
        name = (name or "").lower().strip()
        if name in self.tools:
            return name
        if name.startswith("jarvis_") and name[len("jarvis_"):] in self.tools:
            return name[len("jarvis_"):]
        if f"jarvis_{name}" in self.tools:
            return f"jarvis_{name}"
        return name

    def _run_scheduled_action(self, action_type, action_command, action_tool, action_args) -> str:
        """Runs a fired scheduled action in-process (tool, sound, or power), bypassing
        the interactive safety flow — the task creation was already authorized.
        """
        action_args = dict(action_args or {})
        if action_type in ("popup", "notify", "telegram"):
            from app.tools.scheduled_tasks import execute_action
            return execute_action({"action_type": action_type, "action_command": action_command, "action_args": action_args})

        if action_type == "sound":
            from app.tools.scheduled_tasks import _play_builtin_sound
            sound_target = action_command or (action_args.get("sound") if isinstance(action_args, dict) else "") or "tada"
            return _play_builtin_sound(sound_target)

        if action_type == "power":
            from app.tools.system import system_power_control
            power_action = (action_args.get("action") or "").lower().strip()
            if not power_action:
                return "Power action missing 'action' arg."
            try:
                return system_power_control(power_action, confirmed=True)
            except Exception as e:
                return f"Power action failed: {e}"

        if action_type == "tool" and action_tool:
            tool_name = action_tool.lower().strip()
            # Raw screenshot capture (not the interactive Snipping Tool overlay).
            if tool_name in ("take_screenshot", "capture_screenshot", "screenshot"):
                from app.tools.scheduled_tasks import capture_screenshot
                return capture_screenshot(
                    window_title=action_args.get("window_title") or action_args.get("window") or "",
                    save_to=action_args.get("save_to") or action_args.get("path") or "",
                )
            handler = self.tools.get(action_tool) or self.tools.get(self._resolve_tool_name(action_tool))
            if handler is None:
                return f"Unknown scheduled action tool '{action_tool}'."
            try:
                import inspect
                sig = inspect.signature(handler)
                has_var = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
                filtered_args = action_args if has_var else {k: v for k, v in action_args.items() if k in sig.parameters}
                result = handler(**filtered_args)
                return str(result)
            except Exception as e:
                return f"Scheduled tool '{action_tool}' failed: {e}"

        if action_type == "shell":
            from app.tools.scheduled_tasks import _run_shell_action
            cmd = action_command or (action_args.get("command") if isinstance(action_args, dict) else "") or (action_args.get("app_name") if isinstance(action_args, dict) else "")
            if not cmd and action_tool:
                cmd = action_tool
            return _run_shell_action(cmd)

        return f"No action configured (type={action_type})."

    def _execute_manage_todo(self, **kwargs) -> str:
        from app.tools.todo_list import manage_todo

        settings = self.memory.profile.get("settings", {}) if getattr(self, "memory", None) else {}
        enabled = bool(settings.get("manage_todo_enabled", True))
        override = kwargs.get("manage_todo_enabled")
        if override is not None:
            enabled = bool(override)
        if not enabled:
            return "Error: The todo list feature is disabled. Enable 'manage_todo' in settings before using this tool."

        action = (kwargs.get("action") or "").lower().strip()
        title = kwargs.get("title") or kwargs.get("task") or kwargs.get("name")
        todo_id = kwargs.get("todo_id") or kwargs.get("id")
        parent_id = kwargs.get("parent_id")
        status = kwargs.get("status")
        priority = kwargs.get("priority")
        position = kwargs.get("position")
        include_completed = bool(kwargs.get("include_completed", True))
        include_archived = bool(kwargs.get("include_archived", False))
        block_reason = kwargs.get("block_reason")

        if todo_id is not None:
            try:
                todo_id = int(todo_id)
            except (ValueError, TypeError):
                return "Error: todo_id must be an integer."
        if parent_id is not None:
            try:
                parent_id = int(parent_id)
            except (ValueError, TypeError):
                return "Error: parent_id must be an integer."
        if position is not None:
            try:
                position = int(position)
            except (ValueError, TypeError):
                return "Error: position must be an integer."

        # Smart action inferring if model omitted action parameter
        if not action:
            if parent_id is not None:
                action = "add_subtask"
            elif title:
                action = "create"
            elif todo_id is not None:
                action = "complete"
            else:
                action = "list"

        session_id = kwargs.get("session_id") or getattr(self, "_active_session_id", None)
        items = kwargs.get("items")
        target_dir = self._get_active_session_dir(kwargs) or kwargs.get("target_dir")
        result = manage_todo(action, title=title, todo_id=todo_id, parent_id=parent_id,
                             status=status, priority=priority, position=position,
                             session_id=session_id, include_completed=include_completed,
                             include_archived=include_archived, block_reason=block_reason,
                             target_dir=target_dir, items=items)

        mutation_actions = {"create", "add", "add_task", "new", "update", "edit", "change", "modify",
                            "reorder", "move", "complete", "done", "finish", "mark_complete",
                            "reopen", "uncomplete", "undo", "add_subtask", "subtask", "child",
                            "delete", "remove", "rm", "clear_completed", "clear", "cleanup",
                            "sync", "apply", "set", "batch"}
        if result.startswith("Success:") and action in mutation_actions and target_dir:
            try:
                from app.tools.todo_list import render_md_file, get_todos
                render_md_file(get_todos(session_id=session_id), target_dir=target_dir)
            except Exception as e:
                print(f"[ManageTodo] Auto-render TODO.md failed: {e}")
        return result

    def _execute_manage_personal_list(self, **kwargs) -> str:
        from app.tools.personal_lists import manage_personal_list

        action = (kwargs.get("action") or "").lower().strip()
        date = kwargs.get("date") or kwargs.get("target_date")
        list_name = kwargs.get("list_name") or kwargs.get("name")
        if not list_name and not date and action not in ("rollover", "carryover", "lists"):
            list_name = "shopping"

        items = kwargs.get("items") or kwargs.get("item") or kwargs.get("title")
        include_completed = bool(kwargs.get("include_completed", False))
        clear_old = bool(kwargs.get("clear_old", False))
        quantity = kwargs.get("quantity")
        target_path = kwargs.get("target_path") or kwargs.get("path")

        # Smart action inferring if model omitted action parameter
        if not action:
            if items:
                action = "add"
            else:
                action = "show"

        return manage_personal_list(
            action=action,
            list_name=list_name,
            items=items,
            include_completed=include_completed,
            quantity=quantity,
            target_path=target_path,
            clear_old=clear_old,
            date=date,
        )

    async def ensure_model_loaded(self, model_name: str) -> bool:
        """
        Ensures the selected model is available in the active LLM backend.
        """
        backend = get_backend()
        return await backend.ensure_model_loaded(model_name)

    async def get_friendly_error_explanation(self, exception_msg: str) -> str:
        """
        Asks the LLM to explain a Python exception in a friendly way for the user.
        """
        backend = get_backend()
        prompt = f"Explain this Python exception to a desktop user in 1-2 friendly sentences and tell them how to fix it: {exception_msg}"
        messages = [
            {"role": "system", "content": f"You are {config.CHARACTER_NAME}, a helpful assistant. Keep your response minimal, friendly, and direct. Explain the error simply in 1-2 sentences. Do not use generic AI fluff."},
            {"role": "user", "content": prompt}
        ]
        try:
            url = backend.get_chat_url()
            payload = backend.build_payload(
                model=config.LLM_MODEL,
                messages=messages,
                temperature=0.5,
            )
            async with persistent_session_context() as session:
                async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    resp.raise_for_status()
                    data = await resp.json()
                    choices = data.get("choices", [])
                    if choices:
                        explanation = choices[0].get("message", {}).get("content", "").strip()
                        if explanation:
                            return explanation
                    raise Exception("Empty response from LLM")
        except Exception as e:
            return (
                f"Hmph! Something went wrong in my system. It looks like my brain server ({backend.name}) "
                f"might be offline or unreachable on {backend.base_url}. "
                f"Please ensure your LLM backend is running, and that the model '{config.LLM_MODEL}' is active."
            )

    # ------------------------------------------------------------------ #
    #  Message builder (history cap + prompt selection)                    #
    # ------------------------------------------------------------------ #

    def _finalize_llm_mood(self, scrubber: MoodTagScrubber, user_message: str) -> bool:
        """Apply LLM <mood_update> deltas. In LLM mode, only script fallback is physical axes.
        No script fallback for emotional axes — the LLM is solely responsible for those when mood_source=llm."""
        try:
            if scrubber.deltas:
                deltas = scrubber.parsed_deltas()
                if deltas:
                    self.memory.apply_llm_mood(deltas)
                    return "energy" in deltas
            # NOTE: No emotion-scope fallback in LLM mode — that was causing the "revert to script" bug.
            # Physical hunger is already handled by react_mood(scope="physical")
            # at the START of the turn, before the LLM responds.
        except Exception as e:
            print(f"[MoodEngine] finalize error: {e}")
        return False

    def _build_messages(
        self,
        user_message: str,
        chat_history: List[Dict[str, str]],
        backend: str,
        overrides: Optional[Dict[str, Any]] = None,
        active_model: str = "",
        attachments: Optional[List[Dict[str, Any]]] = None,
        input_audio: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, str]]:
        """
        Builds the message list to send to the LLM.
        Applies a character-based history limit rather than a message count limit,
        preventing cache invalidations on every single turn.
        """
        overrides = overrides or {}
        if overrides.get("is_startup_greeting"):
            profile_obj = getattr(self.memory, "profile", None) if hasattr(self, "memory") else None
            settings = profile_obj.get("settings", {}) if isinstance(profile_obj, dict) else {}
            char_name = settings.get("character_name") or getattr(config, "CHARACTER_NAME", "Yuki")
            print(f"[Executor] Standalone startup greeting prompt active: bypassing full system prompt, tool guides, and prior history")
            return [
                {"role": "system", "content": user_message},
                {"role": "user", "content": f"[User booted up the PC and just sat down at the desk. Greet them aloud naturally as {char_name}.]"}
            ]

        if overrides.get("manage_todo_enabled") is None:
            overrides["manage_todo_enabled"] = bool(self.memory.profile.get("settings", {}).get("manage_todo_enabled", True))
        memory_summary = self.memory.get_profile_summary()
        mood = self.memory.get_mood_spectrum()
        mood_meta = self.memory.get_mood_meta()
        try:
            # Only instruct the LLM to emit a <mood_update> tag on backends where
            # a MoodTagScrubber will actually strip it (coder/complex_coder have
            # no scrubber — without this the raw tag leaks into chat).
            mood_meta["llm_mood"] = bool(
                self.memory.profile.get("settings", {}).get("mood_source", "script") == "llm"
                and backend not in ("coder", "complex_coder")
            )
        except Exception:
            pass

        effective_tool_mode = overrides.get("tool_mode") or getattr(config, "TOOL_MODE", "basic")

        profile_obj = getattr(self.memory, "profile", None) if hasattr(self, "memory") else None
        if overrides.get("coding_mode"):
            system_content = get_coding_agent_system_prompt(memory_summary, mood, overrides=overrides, profile=profile_obj)
        elif backend == "simple" and not getattr(config, "SEND_TOOLS_IN_SIMPLE", False):
            system_content = get_simple_system_prompt(memory_summary, mood, mood_meta=mood_meta, profile=profile_obj, overrides=overrides)
        else:
            if effective_tool_mode == "advanced":
                system_content = get_advanced_jarvis_system_prompt(memory_summary, mood, overrides=overrides, mood_meta=mood_meta, profile=profile_obj)
            else:
                system_content = get_system_prompt(memory_summary, mood, overrides=overrides, mood_meta=mood_meta, profile=profile_obj)

        system_msg = {"role": "system", "content": system_content}

        # ── Whole-prompt token budget + rolling summarization ─────────────
        # The configured token limit now applies to the WHOLE prompt (system +
        # summary/recap + history + user + tool schemas), measured with
        # tiktoken when available (chars/3.5 fallback). When over budget, the
        # oldest/middle x% of the conversation is compressed into an LLM summary
        # (llm_summary_model); on failure it falls back to a snippet recap +
        # hard trim so the prompt still fits (min_keep_turns floor).
        settings = self.memory.profile.get("settings", {}) if hasattr(self, "memory") and hasattr(self.memory, "profile") else {}

        is_advanced = effective_tool_mode == "advanced"
        is_coder_mode = bool(overrides.get("coding_mode") or overrides.get("is_coder_mode") or backend in ("coder", "complex_coder"))
        if is_advanced:
            user_token_limit = int(settings.get("advanced_history_token_limit", 40000))
            min_keep_turns = int(settings.get("advanced_history_keep_turns", 16))
        else:
            user_token_limit = int(settings.get("basic_history_token_limit", 2500))
            min_keep_turns = int(settings.get("basic_history_keep_turns", 6))

        summary_percent = int(settings.get("history_summary_percent", 50))
        summary_position = str(settings.get("history_summary_position", "oldest")).strip().lower()
        summary_model = str(settings.get("llm_summary_model", "")).strip()

        # "Keep turns" is treated as turn PAIRS (a user+assistant exchange).
        min_keep_msgs = max(2, int(min_keep_turns) * 2)

        # Whole-prompt overhead: system prompt + tool schemas + current query.
        overhead = _count_tokens(system_content) + _count_tokens(user_message)
        sends_tools = backend != "simple" or getattr(config, "SEND_TOOLS_IN_SIMPLE", False)
        if sends_tools:
            try:
                if settings.get("dynamic_tool_calling", True):
                    tool_list = get_filtered_tools(user_message)
                else:
                    tool_list = get_tools_definition()
                overhead += _count_tokens(json.dumps(tool_list, ensure_ascii=False))
            except Exception:
                pass

        pruned_history = list(chat_history)
        history_tokens = _count_messages_tokens(pruned_history)

        recap_msg = None
        session_id = overrides.get("session_id") or getattr(self, "_active_session_id", None) or "active"

        # Check if we can reuse or incrementally extend an active rolling summary cache
        cache_entry = getattr(self, "_session_summary_cache", {}).get(session_id)
        cached_count = cache_entry.get("summarized_count", 0) if cache_entry else 0
        cached_text = cache_entry.get("summary_text", "") if cache_entry else ""

        if cache_entry and summary_percent > 0 and cached_text and 0 < cached_count <= len(chat_history) - min_keep_msgs:
            candidate_history = list(chat_history[cached_count:])
            candidate_tokens = _count_messages_tokens(candidate_history)
            cached_recap = {"role": "system", "content": f"[CONVERSATION SUMMARY]\n{cached_text}"}
            recap_tokens = _count_tokens(cached_recap["content"])

            # Fast Path: If cached summary + remaining messages fit within budget, reuse it instantly (0ms latency)!
            if candidate_tokens + overhead + recap_tokens <= user_token_limit:
                pruned_history = candidate_history
                recap_msg = cached_recap
                history_tokens = candidate_tokens
                print(f"[History] Reusing rolling summary cache for oldest {cached_count} messages (0ms latency, saved ~{recap_tokens} tokens).")
            else:
                # Incremental Consolidation Path: Remaining messages grew beyond token limit.
                # Take next older chunk from candidate_history and merge it with the existing summary!
                chunk, rest = self._select_summary_chunk(candidate_history, summary_percent, summary_position, min_keep_msgs)
                if chunk:
                    print(f"[History] Incremental summary trigger: consolidating previous summary + {len(chunk)} new turns...")
                    new_summary_text = self._summarize_history_chunk(
                        chunk, existing_summary=cached_text, is_coder_mode=is_coder_mode, overrides=overrides
                    )
                    if new_summary_text:
                        recap_msg = {"role": "system", "content": f"[CONVERSATION SUMMARY]\n{new_summary_text}"}
                        pruned_history = rest
                        history_tokens = _count_messages_tokens(pruned_history)
                        new_count = cached_count + len(chunk)
                        self._session_summary_cache[session_id] = {
                            "summary_text": new_summary_text,
                            "summarized_count": new_count,
                            "timestamp": time.time(),
                        }
                        print(f"[History] Consolidated rolling summary updated (now covering {new_count} total messages).")

        # Initial summarization path (when no valid cache exists and full history exceeds budget)
        if recap_msg is None and history_tokens + overhead > user_token_limit:
            print(f"[History] Chat history ({history_tokens} tokens) + prompt overhead ({overhead} tokens) exceeds budget ({user_token_limit} tokens). Condensing older turns...")

            if summary_percent > 0:
                chunk, rest = self._select_summary_chunk(pruned_history, summary_percent, summary_position, min_keep_msgs)
                if chunk:
                    summary_text = self._summarize_history_chunk(chunk, is_coder_mode=is_coder_mode, overrides=overrides)
                    if summary_text:
                        summary_msg = {"role": "system", "content": f"[CONVERSATION SUMMARY]\n{summary_text}"}
                        pruned_history = rest
                        recap_msg = summary_msg
                        history_tokens = _count_messages_tokens(pruned_history)

                        # Update session summary cache
                        if not hasattr(self, "_session_summary_cache"):
                            self._session_summary_cache = {}
                        self._session_summary_cache[session_id] = {
                            "summary_text": summary_text,
                            "summarized_count": len(chunk),
                            "timestamp": time.time(),
                        }
                        print(f"[History] Summarized {len(chunk)} messages ({summary_position} {summary_percent}%) into a compact recap (cached for session).")
                    else:
                        print("[History] Summary unavailable - falling back to snippet recap + trim.")

            # Guarantee fit: include the recap's own tokens in the budget and
            # re-trim until the whole prompt (system + recap + history + user)
            # fits. Each pass rebuilds the snippet recap from the messages
            # removed on that pass; the loop is bounded so we always terminate.
            for _pass in range(3):
                recap_tokens = _count_tokens(recap_msg["content"]) if recap_msg else 0
                budget_for_history = max(0, user_token_limit - overhead - recap_tokens)
                if _count_messages_tokens(pruned_history) <= budget_for_history:
                    break
                pruned_history, removed = self._trim_to_budget(pruned_history, budget_for_history, min_keep_msgs)
                if _pass == 0:
                    snippet_recap = self._build_snippet_recap(removed)
                    if snippet_recap:
                        if recap_msg is None:
                            recap_msg = snippet_recap
                        else:
                            # Keep the LLM summary AND append the detail recap of what was trimmed off.
                            recap_msg["content"] += "\n\n" + snippet_recap["content"]

                # Synchronize the session cache with the total messages absorbed/trimmed so far
                if removed and recap_msg:
                    total_absorbed = len(chat_history) - len(pruned_history)
                    clean_cached_summary = recap_msg.get("content", "")
                    if clean_cached_summary.startswith("[CONVERSATION SUMMARY]\n"):
                        clean_cached_summary = clean_cached_summary[len("[CONVERSATION SUMMARY]\n"):].strip()
                    if not hasattr(self, "_session_summary_cache"):
                        self._session_summary_cache = {}
                    self._session_summary_cache[session_id] = {
                        "summary_text": clean_cached_summary,
                        "summarized_count": total_absorbed,
                        "timestamp": time.time(),
                    }

            history_tokens = _count_messages_tokens(pruned_history)
            recap_tokens = _count_tokens(recap_msg["content"]) if recap_msg else 0
            if history_tokens + overhead + recap_tokens > user_token_limit:
                print(f"[History] WARNING: prompt overhead ({overhead} tokens) alone exceeds budget ({user_token_limit} tokens). Sending best-effort prompt.")
            print(f"[History] Final prompt ~{history_tokens + overhead + recap_tokens} tokens ({len(pruned_history)} history messages).")

        sanitized_history = []
        for m in pruned_history:
            role = m.get("role")
            content = str(m.get("content") or "").strip()
            ts_badge = _format_msg_timestamp(m.get("timestamp"))
            
            if role == "tool":
                # Convert orphaned tool messages (loaded from DB) to clean text context so API schema validates
                tool_name = m.get("name", "Tool")
                tool_text = f"[Past Result ({tool_name})]: {content}"
                if ts_badge and not _TIMESTAMP_PREFIX_REGEX.match(tool_text):
                    tool_text = f"{ts_badge} {tool_text}"
                sanitized_history.append({
                    "role": "user",
                    "content": tool_text
                })
            elif role == "assistant":
                # Parse visual UI tool badges from LLM prompt context to preserve a structured,
                # token-conscious record of tool names, input arguments, and results across turns.
                tool_badge_pattern = re.compile(
                    r'🛠️\s*\*\*\s*\[([^\]]+?)(?:\s*—\s*(?:✓ Done|❌ Error|[^\]]+))?\]\s*\*\*(?:\n```tool_args\n([\s\S]*?)```)?(?:\n```tool_output\n([\s\S]*?)```)?'
                )
                matches = list(tool_badge_pattern.finditer(content))
                clean_speech = tool_badge_pattern.sub('', content).strip()

                # Dynamic budget per tool badge: generous in Coder/Jarvis mode, solid in basic chat
                max_args_chars = 3500 if (is_coder_mode or getattr(config, "TOOL_MODE", "basic") == "advanced") else 1500
                max_out_chars = 2500 if (is_coder_mode or getattr(config, "TOOL_MODE", "basic") == "advanced") else 1000

                preserved_actions = []
                for b_match in matches:
                    raw_name = b_match.group(1).strip()
                    clean_name = raw_name.split()[0].split('(')[0].strip()
                    raw_args = (b_match.group(2) or "").strip()
                    raw_out = (b_match.group(3) or "").strip()

                    args_repr = ""
                    if raw_args:
                        try:
                            parsed_args = json.loads(raw_args)
                            # For canvas graphics, preserve metadata pointer instead of dumping 3,000 tokens of raw HTML
                            if clean_name in ("jarvis_html_graphics", "jarvis_html_viewer") and isinstance(parsed_args, dict):
                                title = parsed_args.get("title") or "Canvas"
                                html_prev = str(parsed_args.get("svg_or_canvas") or parsed_args.get("html_content") or "")[:120]
                                args_repr = f'{{"title": "{title}", "preview": "{html_prev}...", "source_directory": "yuki_attachment/canvas/"}}'
                            # For Python scripts, preserve the complete code JSON so the LLM can inspect and debug past executions
                            elif clean_name in ("run_python_script", "jarvis_run_python") and isinstance(parsed_args, dict):
                                args_repr = json.dumps(parsed_args, ensure_ascii=False)
                            else:
                                args_repr = json.dumps(parsed_args, ensure_ascii=False)
                        except Exception:
                            args_repr = raw_args

                    if len(args_repr) > max_args_chars:
                        args_repr = args_repr[:max_args_chars] + "... [truncated]"

                    if len(raw_out) > max_out_chars:
                        raw_out = raw_out[:max_out_chars] + "... [truncated]"

                    action_line = f"[Past Tool Action ({clean_name})]: args={args_repr} -> result={raw_out}"
                    preserved_actions.append(action_line)

                # Keep up to the last 6 tool actions per assistant message to stay well within token bounds
                if preserved_actions:
                    preserved_actions = preserved_actions[-6:]

                final_text_parts = []
                if preserved_actions:
                    final_text_parts.extend(preserved_actions)
                if clean_speech:
                    # Strip any legacy timestamp prefix from past turns so it doesn't train the model to mimic it
                    clean_speech = _TIMESTAMP_PREFIX_REGEX.sub('', clean_speech).strip()
                    final_text_parts.append(clean_speech)

                clean_content = "\n\n".join(final_text_parts).strip()
                if not clean_content:
                    clean_content = "Task step executed."

                # DO NOT prepend ts_badge to assistant's dialogue: prepending [HH:MM] to assistant
                # turns causes LLMs to copy the prefix pattern into their own spoken responses!

                msg_obj = {"role": "assistant", "content": clean_content}
                if m.get("tool_calls"):
                    # DB-loaded history stores tool responses as plain text (converted
                    # to 'user' above), so carrying raw tool_calls here would orphan them
                    # and invalidate the assistant/tool message-order protocol.
                    # Strip them; the tool results are still preserved as text context.
                    print("[Executor] Stripping orphaned tool_calls from loaded-history assistant message.")
                sanitized_history.append(msg_obj)
            elif role in ("user", "system"):
                if content:
                    hist_content = content
                    hist_atts = m.get("attachments")
                    if hist_atts and isinstance(hist_atts, list):
                        att_lines = []
                        for att_idx, att in enumerate(hist_atts, start=1):
                            if not isinstance(att, dict):
                                continue
                            att_label = "image" if att.get("is_image") else "file"
                            att_fname = att.get("filename", "file")
                            att_spath = att.get("save_path", "")
                            if att_fname or att_spath:
                                att_lines.append(f"[Attached {att_label} #{att_idx}: {att_fname} at '{att_spath}']")
                        if att_lines:
                            hist_content = content + "\n" + "\n".join(att_lines)
                    if ts_badge and not _TIMESTAMP_PREFIX_REGEX.match(hist_content):
                        hist_content = f"{ts_badge} {hist_content}"
                    sanitized_history.append({
                        "role": role,
                        "content": hist_content
                    })

        # Current time is already clearly declared in system prompt context header;
        # do not prepend timestamps to user message text to avoid inducing pattern mimicry
        user_content = user_message
        is_native_vision = is_vision_model(active_model)

        if attachments:
            text_attach_snippets = []
            image_attach_snippets = []
            image_content_parts = []

            for att in attachments:
                fname = att.get("filename", "file")
                spath = att.get("save_path", "")
                if att.get("is_text") and att.get("text_content"):
                    text_attach_snippets.append(f"\n[Attached Document/Code File: {fname} ({spath})]\n```\n{att['text_content']}\n```")
                elif att.get("is_image"):
                    if is_native_vision and att.get("data_url"):
                        image_content_parts.append({"type": "image_url", "image_url": {"url": att["data_url"]}})
                        text_attach_snippets.append(
                            f"\n[Attached image #{len(image_content_parts)}: {fname} saved at '{spath}'. "
                            f"This image is shown inline. If the user asks about it in a future turn, re-inspect it "
                            f"on demand via tool 'jarvis_get_image' with image_path='{spath}' instead of relying on memory.]"
                        )
                    else:
                        image_attach_snippets.append(f"\n[Attached Image File: {fname} ({spath}). Call tool 'jarvis_get_image' with image_path='{spath}' to inspect visual content if needed.]")

            if text_attach_snippets:
                user_content += "\n".join(text_attach_snippets)
            if image_attach_snippets:
                user_content += "\n".join(image_attach_snippets)

            if is_native_vision and image_content_parts:
                user_msg_obj = {
                    "role": "user",
                    "content": [{"type": "text", "text": user_content}] + image_content_parts
                }
            else:
                user_msg_obj = {"role": "user", "content": user_content}
        else:
            user_msg_obj = {"role": "user", "content": user_content}

        # Inject direct multimodal voice audio if present for this turn
        if input_audio and input_audio.get("data"):
            audio_directive = (
                "[Direct user voice audio attached. Listen to the user's spoken audio carefully and respond naturally as Yuki. "
                "CRITICAL: Start your response with a brief bracketed transcript tag of what the user said: "
                "[Transcribed: \"<exact user words>\"] so the user sees their words in the chat log, then continue your reply.]"
            )
            base_text = user_content.strip() if user_content else ""
            prompt_text = f"{base_text}\n\n{audio_directive}".strip() if base_text else audio_directive
            content_parts = [{"type": "text", "text": prompt_text}]
            if attachments and is_native_vision and image_content_parts:
                content_parts.extend(image_content_parts)
            content_parts.append({
                "type": "input_audio",
                "input_audio": {
                    "data": input_audio["data"],
                    "format": input_audio.get("format", "wav")
                }
            })
            user_msg_obj = {"role": "user", "content": content_parts}

        final_messages = [system_msg]
        if recap_msg:
            final_messages.append(recap_msg)
        final_messages.extend(sanitized_history)
        final_messages.append(user_msg_obj)

        return final_messages

    # ------------------------------------------------------------------ #
    #  History summarization / pruning helpers                             #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _select_summary_chunk(history: List[Dict], percent: int, position: str, min_keep_msgs: int) -> Tuple[List[Dict], List[Dict]]:
        """
        Selects the slice of `history` to compress into a summary.
        percent: % of the conversation (by message count) to compress.
        position: 'oldest' (front of the conversation) or 'middle' (centered window).
        The newest `min_keep_msgs` messages are always left verbatim.
        Boundaries are nudged so a tool result is never orphaned.
        Returns (chunk, rest).
        """
        n = len(history)
        if n <= 1 or percent <= 0:
            return [], list(history)
        pct = max(5, min(95, int(percent)))
        size = max(1, int(n * pct / 100))
        if n > min_keep_msgs:
            size = min(size, n - min_keep_msgs)
        if size <= 0:
            return [], list(history)

        if position == "middle":
            start = max(0, (n - size) // 2)
        else:
            start = 0
        end = min(n, start + size)

        chunk = history[start:end]
        rest = history[:start] + history[end:]

        # Never orphan a tool result across the cut boundary
        if rest and rest[0].get("role") == "tool":
            chunk = chunk + [rest[0]]
            rest = rest[1:]
        if chunk and chunk[0].get("role") == "tool":
            rest = [chunk[0]] + rest
            chunk = chunk[1:]
        return chunk, rest

    def _summarize_history_chunk(
        self,
        chunk: List[Dict],
        existing_summary: str = "",
        is_coder_mode: bool = False,
        overrides: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Compresses `chunk` into a short factual summary using the context-aware
        routed summary model (Coder Synthesizer in Coder Mode, Simple Suite in Dual Mode,
        or Main/Complex Suite in Single Mode).
        If `existing_summary` is provided, merges and consolidates it with the new chunk.
        Returns "" on any failure so callers can fall back to truncation.
        """
        if not chunk and not existing_summary:
            return ""
        text_parts = []
        for m in chunk:
            role = m.get("role", "")
            content = (m.get("content") or "").strip()
            content = re.sub(r'<(thought|think|reasoning)>[\s\S]*?(?:<\/\1>|$)', '', content, flags=re.IGNORECASE).strip()
            if not content:
                continue
            speaker = "User" if role == "user" else ("Yuki" if role == "assistant" else "Tool result")
            text_parts.append(f"{speaker}: {content}")
        if not text_parts and not existing_summary:
            return ""
        transcript = "\n".join(text_parts)
        system_guide = (
            "You are a conversation condensing engine. Compress earlier chat history into "
            "a concise, factual, coherent rolling summary. Preserve important names, preferences, "
            "facts, decisions, file paths, actions, and any pending tasks. "
            "Output ONLY the plain summary text with no preamble, under 180 words."
        )
        if existing_summary and transcript:
            user_prompt = (
                f"Existing Conversation Summary (from earlier in the session):\n{existing_summary}\n\n"
                f"New Conversation Turns to Integrate:\n{transcript[-16000:]}\n\n"
                "Please update and combine the existing summary with these new turns into a single unified summary under 180 words."
            )
        elif existing_summary and not transcript:
            return existing_summary
        else:
            user_prompt = "Summarize this earlier conversation:\n\n" + transcript[-16000:]

        summary_messages = [
            {"role": "system", "content": system_guide},
            {"role": "user", "content": user_prompt},
        ]
        try:
            task_overrides = dict(overrides or {})
            task_overrides["is_coder_mode"] = is_coder_mode
            summary_backend, summary_model_name = self._get_backend_and_model_for_task(
                "synthesizer", overrides=task_overrides
            )
            content, _, _ = self._query_lmstudio_model(
                summary_messages, summary_model_name, temperature=0.2, backend=summary_backend, max_tokens=400
            )
            content = (content or "").strip()
            if not content or "error from brain server" in content.lower():
                return ""
            return content
        except Exception as e:
            print(f"[History] Summarization call failed, falling back to truncation: {e}")
            return ""

    def _build_snippet_recap(self, removed: List[Dict]) -> Optional[Dict]:
        """Builds the compact [EARLIER CONVERSATION RECAP] message from removed messages."""
        if not removed:
            return None
        recap_snippets = []
        for m in removed:
            role = m.get("role", "")
            content = (m.get("content") or "").strip()
            content = re.sub(r'<(thought|think|reasoning)>[\s\S]*?(?:<\/\1>|$)', '', content, flags=re.IGNORECASE).strip()
            if not content:
                continue
            speaker = "User" if role == "user" else ("Yuki" if role == "assistant" else "Tool")
            snippet = content[:160] + ("..." if len(content) > 160 else "")
            recap_snippets.append(f"- {speaker}: {snippet}")
        if not recap_snippets:
            return None
        recap_text = "[EARLIER CONVERSATION RECAP]\nKey details from archived earlier context:\n" + "\n".join(recap_snippets[-12:])
        return {"role": "system", "content": recap_text}

    def _trim_to_budget(self, history: List[Dict], budget_tokens: int, min_keep_msgs: int) -> Tuple[List[Dict], List[Dict]]:
        """
        Pops the oldest messages until the remaining tokens fit `budget_tokens`
        (or only `min_keep_msgs` messages remain). Returns (kept, removed).
        """
        kept = list(history)
        removed = []
        while len(kept) > min_keep_msgs and _count_messages_tokens(kept) > budget_tokens:
            removed.append(kept.pop(0))
            # Never orphan a tool result
            if kept and kept[0].get("role") == "tool" and len(kept) > min_keep_msgs:
                removed.append(kept.pop(0))
        return kept, removed

    # ------------------------------------------------------------------ #
    #  Task router                                                          #
    # ------------------------------------------------------------------ #

    # Keywords that indicate the user wants a tool-enabled (complex) response.
    _COMPLEX_KEYWORDS = {
        "open", "close", "minimize", "maximize", "show", "hide",
        "find", "finding", "search", "searching", "locate", "locating",
        "where is", "where are", "directory", "directories", "folder", "folders",
        "file", "files", "play", "list my", "list drives", "delete", "create",
        "screenshot", "terminal", "powershell", "cmd", "run", "execute",
        "mouse", "keyboard", "launch", "start", "open app", "open file",
        "volume", "vol", "sound", "audio", "mute", "shutdown", "restart","shut down", "reboot", "lock", "sleep",
        "process", "task manager", "kill", "settings", "install",
        "take a", "take screenshot", "type", "click", "press",
        "clean", "clear", "screen", "desktop", "pc", "window", "windows", "media", "track",
        "seach", "google", "internet", "web", "online", "lookup", "look up", "browse",
        "remember", "save interest", "save an interest", "save my", "my interest", "favorite", "preference", "save fact",
        "hobby", "hobbies", "like", "likes", "dislike", "dislikes", "save hobby", "save like", "save dislike",
        "value of", "make it", "change it", "set it", "update it", "change my", "set my", "update my",
        "timer", "remind", "reminder", "alarm", "stopwatch", "schedule", "countdown",
        "i love", "i like", "i hate", "i dislike", "i dont like", "i don't like", "i enjoy", "my favorite",
        "im a fan of", "i am a fan of", "cant live without", "can't live without", "i cant stand", "i can't stand",
        "i despise", "not a fan of", "im not a fan of", "i'm not a fan of",
        "wear", "wearing", "put on", "take off", "outfit", "outfits", "clothes", "dress", "costume",
        "hat", "avatar", "vrm", "model", "bikini", "swimsuit", "veer", "glasses", "accessory",
        "accessories", "uniform", "cosplay", "switch outfit", "change outfit", "change clothes",
        "switch clothes", "change model", "switch model", "change avatar", "switch avatar",
        "change into", "wear your", "put your", "take off your"
    }

    _COMPLEX_PATTERN = re.compile(
        r'\b(' + '|'.join(re.escape(kw) for kw in _COMPLEX_KEYWORDS) + r')\b',
        re.IGNORECASE
    )

    # Phrases that look like tool/action requests even when using simple words like 'open'
    _ACTION_PATTERN = re.compile(
        r'\b(open|close|minimize|maximize|show|hide|wear|put on|take off|change|switch)\b.{1,40}\b(app|application|window|program|browser|settings|notepad|calc|explorer|discord|spotify|steam|chrome|firefox|edge|vscode|folder|file|drive|outfit|clothes|hat|dress|avatar|model|costume|bikini|swimsuit)\b',
        re.IGNORECASE
    )

    def _classify_task(self, user_message: str) -> str:
        """Classifies a user message as 'complex' (tool-enabled) or 'simple' (chat-only)."""
        if self._COMPLEX_PATTERN.search(user_message):
            return "complex"
        if self._ACTION_PATTERN.search(user_message):
            return "complex"
        return "simple"

    async def _check_tool_intent(
        self,
        user_message: str,
        chat_history: List[Dict[str, str]],
        timeout: float = 6.0,
    ) -> tuple:
        """
        LLM-based intent double-check called when the regex classifier says 'complex'.
        Sends a tiny non-streaming request to the same model with the last 2 conversation
        exchanges as context so the model can disambiguate figurative vs literal tool requests
        (e.g. 'play a game with me' vs 'play that towa song').

        Uses a plain Yes/No question — no tool names or examples in the prompt to avoid
        keyword anchoring that caused false positives (e.g. 'open an anime shop' → launch_app).

        Returns (intent, tool_name):
          intent    — 'chat' if no tool needed, 'tool' if a tool is required
          tool_name — always '' now (caller uses intent_tool_hint only for logging)

        Falls back to ('tool', '') on timeout/error — never misses a real tool call.
        """
        intent_system = (
            "You are an intent detector for a desktop AI assistant named Yuki. "
            "Yuki can control the user's computer: change her 3D avatar/outfit/clothes, "
            "open files, search the web, adjust volume, launch apps, run commands, "
            "save user facts/interests, and more.\n\n"
            "Given the conversation so far, does the user's LATEST message require "
            "Yuki to perform a computer action, change avatar/clothing, search the web, or save a personal fact/interest/preference?\n\n"
            "'No' means the user is just having a normal conversation and does not want "
            "any computer operation, avatar change, or memory update performed.\n\n"
            "Reply with ONLY 'Yes' or 'No'. Nothing else."
        )

        # Fast short-circuit: if user is asking Yuki questions about herself, route to CHAT
        msg_lower = _message_text(user_message).strip().lower()
        yuki_q_patterns = [
            "what do you", "what do u", "what u", "what you", "do you", "do u",
            "what is your", "what's your", "who are you", "who r u", "tell me about yourself", "about you"
        ]
        if any(p in msg_lower for p in yuki_q_patterns) and not any(k in msg_lower for k in ("search", "open", "launch", "run", "play", "find", "file", "folder", "wear", "put on", "change", "outfit", "clothes", "dress", "hat", "veer")):
            print(f"[IntentCheck] Short-circuited to CHAT (asking Yuki about herself): '{user_message}'")
            return "chat", "", "python short-circuit"

        # Fast deterministic check: avatar / outfit / clothes / accessories requests
        avatar_regex = re.compile(
            r'\b('
            r'wear|wearing|put on|take off|change into|change outfit|change your outfit|switch outfit|'
            r'change clothes|switch clothes|change model|switch model|change avatar|switch avatar|'
            r'outfit|outfits|costume|clothes|dress|bikini|swimsuit|uniform|hat|glasses|accessory|accessories|'
            r'veer|put your hat|take off your hat|wear your hat'
            r')\b',
            re.IGNORECASE
        )
        avatar_tool_name = "jarvis_change_avatar_outfit" if getattr(config, "TOOL_MODE", "basic") == "advanced" else "change_avatar_outfit"
        if avatar_regex.search(msg_lower):
            print(f"[IntentCheck] Deterministically confirmed TOOL (avatar/outfit change request): '{user_message}'")
            return "tool", avatar_tool_name, "python deterministic"

        # Fast deterministic check: referential outfit change commands (e.g. "change it", "try another one", "something new")
        referential_outfit_regex = re.compile(
            r'\b(change it|change to something new|change it to something new|wear something else|try another|try another one|switch it|something new|something cute|something else)\b',
            re.IGNORECASE
        )
        if referential_outfit_regex.search(msg_lower):
            history_text = " ".join(str(m.get("content", "")) for m in (chat_history or [])[-4:]).lower()
            if any(w in history_text for w in ("outfit", "clothes", "dress", "bikini", "swimsuit", "hat", "wear", "avatar", "costume", "change")):
                print(f"[IntentCheck] Deterministically confirmed TOOL (referential outfit change): '{user_message}'")
                return "tool", avatar_tool_name, "python deterministic"

        # Fast deterministic check: time management requests
        timer_regex = re.compile(
            r'\b('
            r'set timer|set a timer|timer for|start timer|remind me|set reminder|schedule reminder|'
            r'set alarm|set an alarm|start stopwatch|check stopwatch|stop stopwatch|stopwatch'
            r')\b',
            re.IGNORECASE
        )
        if timer_regex.search(msg_lower):
            print(f"[IntentCheck] Deterministically confirmed TOOL (time management request): '{user_message}'")
            return "tool", "manage_timer_stopwatch_alarms", "python deterministic"

        # Fast deterministic check: explicit user personal preference / fact statements anywhere in prompt
        pref_regex = re.compile(
            r'\b('
            r'i like|i love|i enjoy|my favorite|i am a fan of|im a fan of|i\'m a fan of|my hobby is|my name is|'
            r'i hate|i dislike|i dont like|i don\'t like|i cant stand|i can\'t stand|i despise|i detest|'
            r'not a fan of|im not a fan of|i\'m not a fan of'
            r')\b',
            re.IGNORECASE
        )
        if pref_regex.search(msg_lower) and not any(p in msg_lower for p in yuki_q_patterns):
            print(f"[IntentCheck] Deterministically confirmed TOOL (user personal preference statement): '{user_message}'")
            return "tool", "update_user_fact", "python deterministic"

        # Extract last 2 user+assistant exchanges (up to 4 messages) from chat history.
        # Gives the model context for ambiguous references like 'play that' or 'open it'.
        history_msgs = [m for m in chat_history if m.get("role") in ("user", "assistant")]
        last_exchanges = history_msgs[-4:]  # Last 2 pairs

        history_str = ""
        if last_exchanges:
            history_lines = []
            for m in last_exchanges:
                t_badge = _format_msg_timestamp(m.get("timestamp"))
                prefix = f"{t_badge} " if t_badge else ""
                history_lines.append(f"{m['role'].capitalize()}: {prefix}{str(m.get('content', ''))[:200]}")
            history_str = "Recent Conversation:\n" + "\n".join(history_lines) + "\n\n"

        user_turn_content = (
            f"{history_str}"
            f"Latest User Input: \"{user_message}\"\n\n"
            "CLASSIFICATION TASK:\n"
            "Does the latest user input request a computer action, search the web, OR state a personal preference/fact about THEMSELVES (e.g. 'i like coffee', 'i love anime', 'my name is Alex')?\n"
            "- Answer 'Yes' if the user states a personal preference/like/dislike/interest/hobby about THEMSELVES or requests a PC operation.\n"
            "- Answer 'No' if the user is asking Yuki a question, asking what Yuki likes/thinks (e.g. 'what do you like', 'what about you'), chatting, or asking general questions.\n\n"
            "Reply with ONLY 'Yes' or 'No'. Do NOT answer or converse with the user."
        )

        messages = [
            {"role": "system", "content": intent_system},
            {"role": "user", "content": user_turn_content},
        ]

        backend = get_backend()
        payload = backend.build_payload(
            model=config.LLM_MODEL,
            messages=messages,
            temperature=0.0,   # Fully deterministic — this is a classifier, not a generator
            use_tools=False,   # No tool schemas — pure text output
        )
        payload["max_tokens"] = 5  # "Yes" or "No" — single token

        try:
            async with persistent_session_context() as check_session:
                async with check_session.post(
                    backend.get_chat_url(),
                    headers=backend.build_headers(),
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                ) as resp:
                    if resp.status != 200:
                        print(f"[IntentCheck] Non-200 response ({resp.status}) — defaulting to tool")
                        return "tool", "", "LLM intent check"
                    data = await resp.json()
                    choices = data.get("choices", [])
                    if not choices:
                        return "tool", "", "LLM intent check"
                    raw = (choices[0].get("message", {}).get("content") or "").strip().lower()
                    # Strip punctuation that might trail the answer (e.g. "No.", "Yes!")
                    raw_clean = raw.strip(".,!?;: ")
                    print(f"[IntentCheck] Raw output: '{raw_clean}'")

                    # Accept clear negative signals → downgrade to chat.
                    # Handles: 'no', 'no.', 'nope', 'chat' (old format fallback)
                    _CHAT_SIGNALS = {"no", "nope", "chat", "false", "n"}
                    if raw_clean in _CHAT_SIGNALS or raw_clean.startswith("no"):
                        return "chat", "", "LLM intent check"

                    # Accept clear positive signals → proceed as tool.
                    # Handles: 'yes', 'yes.', 'yep', 'true' (and old 'tool:...' format)
                    _TOOL_SIGNALS = {"yes", "yep", "yeah", "true", "y"}
                    if raw_clean in _TOOL_SIGNALS or raw_clean.startswith("yes") or raw_clean.startswith("tool:"):
                        return "tool", "", "LLM intent check"

                    # Unrecognized output → safe default (never miss a real tool call)
                    print(f"[IntentCheck] Unrecognized output '{raw_clean}' — defaulting to tool")
                    return "tool", "", "LLM intent check"

        except asyncio.TimeoutError:
            print(f"[IntentCheck] Timed out after {timeout}s — defaulting to tool")
            return "tool", "", "LLM intent check"
        except Exception as e:
            print(f"[IntentCheck] Error ({e}) — defaulting to tool")
            return "tool", ""


    def _get_model_label(self, model_name: str) -> str:
        name_lower = model_name.lower()
        if "llama" in name_lower:
            return "Llama 3"
        elif "nemotron" in name_lower:
            return "Nemotron"
        elif "qwen" in name_lower:
            return "Qwen"
        elif "ministral" in name_lower:
            return "Ministral"
        return "local"

    def _get_backend_and_model_for_task(self, task: str, overrides: Optional[Dict[str, Any]] = None):
        """Returns (backend, model_name) based on task type, overrides, and endpoint strategy."""
        overrides = overrides or {}

        if task in ("coder", "complex_coder") or (isinstance(task, str) and "coder" in task.lower()):
            coder_model = overrides.get("llm_coder_model") or getattr(config, "LLM_CODER_MODEL", "") or config.LLM_MODEL
            coder_key = overrides.get("llm_coder_api_key") or getattr(config, "LLM_CODER_API_KEY", "") or config.LLM_API_KEY
            coder_base_url = overrides.get("llm_coder_base_url") or getattr(config, "LLM_CODER_BASE_URL", "")
            coder_backend_type = overrides.get("llm_coder_backend") or getattr(config, "LLM_CODER_BACKEND", "").strip().lower() or "custom"

            from app.agent.llm_backend import OllamaBackend, OpenAICompatibleBackend, LMStudioBackend
            if coder_backend_type in ("openai", "groq", "together", "deepseek", "custom", "vllm"):
                backend = OpenAICompatibleBackend(base_url_override=coder_base_url, api_key_override=coder_key)
            elif coder_backend_type == "ollama":
                backend = OllamaBackend(base_url_override=coder_base_url)
            else:
                backend = LMStudioBackend(base_url_override=coder_base_url)
            print(f"[Router] Dedicated Coder Mode Engine -> {backend.name} @ {coder_model}")
            return backend, coder_model

        if task == "reviewer":
            reviewer_model = overrides.get("llm_reviewer_model") or overrides.get("llm_coder_model") or config.LLM_MODEL
            api_key = overrides.get("llm_coder_api_key") or config.LLM_API_KEY
            coder_base_url = overrides.get("llm_coder_base_url") or getattr(config, "LLM_CODER_BASE_URL", "")
            from app.agent.llm_backend import OpenAICompatibleBackend
            backend = OpenAICompatibleBackend(base_url_override=coder_base_url, api_key_override=api_key)
            print(f"[Router] Specialized Code Reviewer Engine -> {backend.name} @ {reviewer_model}")
            return backend, reviewer_model

        if task == "synthesizer":
            is_coder = bool(overrides.get("is_coder_mode")) or (isinstance(task, str) and "coder" in task.lower())
            
            # 1. Coder Mode: Use Role 3 Synthesizer model preference or fallback to Primary Coder model
            if is_coder:
                summary_model = overrides.get("llm_summary_model") or overrides.get("llm_coder_model") or getattr(config, "LLM_CODER_MODEL", "") or config.LLM_MODEL
                coder_key = overrides.get("llm_coder_api_key") or getattr(config, "LLM_CODER_API_KEY", "") or config.LLM_API_KEY
                coder_base_url = overrides.get("llm_coder_base_url") or getattr(config, "LLM_CODER_BASE_URL", "")
                coder_backend_type = overrides.get("llm_coder_backend") or getattr(config, "LLM_CODER_BACKEND", "").strip().lower() or "custom"

                from app.agent.llm_backend import OllamaBackend, OpenAICompatibleBackend, LMStudioBackend
                if coder_backend_type in ("openai", "groq", "together", "deepseek", "custom", "vllm"):
                    backend = OpenAICompatibleBackend(base_url_override=coder_base_url, api_key_override=coder_key)
                elif coder_backend_type == "ollama":
                    backend = OllamaBackend(base_url_override=coder_base_url)
                else:
                    backend = LMStudioBackend(base_url_override=coder_base_url)
                print(f"[Router] Coder Mode Synthesizer Engine -> {backend.name} @ {summary_model}")
                return backend, summary_model

            # 2. Non-Coder Mode:
            # If Dual Strategy is ON and Simple Backend is active -> Use Simple Section
            if getattr(config, "ENDPOINT_STRATEGY", "single") == "dual":
                backend_type = getattr(config, "LLM_SIMPLE_BACKEND", "").strip().lower()
                simple_model = getattr(config, "LLM_SIMPLE_MODEL", "")
                if backend_type and backend_type != "none" and simple_model:
                    base_url = getattr(config, "LLM_SIMPLE_BASE_URL", "")
                    api_key = getattr(config, "LLM_SIMPLE_API_KEY", "")
                    from app.agent.llm_backend import OllamaBackend, OpenAICompatibleBackend, LMStudioBackend
                    if backend_type in ("openai", "groq", "together", "deepseek", "custom", "vllm"):
                        backend = OpenAICompatibleBackend(base_url_override=base_url, api_key_override=api_key)
                    elif backend_type == "ollama":
                        backend = OllamaBackend(base_url_override=base_url)
                    else:
                        backend = LMStudioBackend(base_url_override=base_url)
                    print(f"[Router] Context Summarizer (Dual Mode Simple Suite) -> {backend.name} @ {simple_model}")
                    return backend, simple_model

            # 3. Non-Coder Default / Single Strategy -> Use Main/Complex Section
            main_backend = get_backend()
            main_model = config.LLM_MODEL
            print(f"[Router] Context Summarizer (Default/Main Suite) -> {main_backend.name} @ {main_model}")
            return main_backend, main_model

        if task == "simple" and getattr(config, "ENDPOINT_STRATEGY", "single") == "dual":
            backend_type = getattr(config, "LLM_SIMPLE_BACKEND", "lmstudio").lower()
            if backend_type == "none":
                print(f"[Router] Dual strategy but simple backend is 'none', falling back to complex")
                return get_backend(), config.LLM_MODEL
            base_url = getattr(config, "LLM_SIMPLE_BASE_URL", "")
            api_key = getattr(config, "LLM_SIMPLE_API_KEY", "")
            model = getattr(config, "LLM_SIMPLE_MODEL", "") or config.LLM_MODEL
            from app.agent.llm_backend import OllamaBackend, OpenAICompatibleBackend, LMStudioBackend
            if backend_type in ("openai", "groq", "together", "deepseek", "custom", "vllm"):
                backend = OpenAICompatibleBackend(base_url_override=base_url, api_key_override=api_key)
            elif backend_type == "ollama":
                backend = OllamaBackend(base_url_override=base_url)
            else:
                backend = LMStudioBackend(base_url_override=base_url)
            print(f"[Router] Dual strategy: simple task -> {backend.name} @ {model}")
            return backend, model
        return get_backend(), config.LLM_MODEL

    def _query_lmstudio_model(self, messages: List[Dict[str, str]], model_name: str, temperature: float = 0.7, use_tools: bool = False, backend=None, max_tokens: Optional[int] = None) -> Tuple[str, List[Dict[str, Any]], str]:
        """
        Sends a request to the active LLM backend for the specified model.
        Returns (response_text, tool_calls, model_label).
        """
        if backend is None:
            backend = get_backend()
        url = backend.get_chat_url()
        tools = None
        if use_tools:
            use_dynamic = self.memory.profile.get("settings", {}).get("dynamic_tool_calling", True)
            if use_dynamic:
                user_message = ""
                for msg in reversed(messages):
                    if msg.get("role") == "user":
                        user_message = msg.get("content", "")
                        break
                tools = get_filtered_tools(user_message)
            else:
                tools = get_tools_definition()
            tools = self._drop_disabled_tools(tools)
            tools = self._drop_blocked_tools(tools)
            tool_names = [t["function"]["name"] for t in tools]
            print(f"[Tools] Sending {len(tools)} tools to LLM: {', '.join(tool_names)}")

        payload = backend.build_payload(
            model=model_name,
            messages=messages,
            temperature=temperature,
            use_tools=use_tools,
            tools=tools,
        )
        if max_tokens:
            payload["max_tokens"] = int(max_tokens)
        _log_payload_stats(payload, model_name, tag="query")
        headers = backend.build_headers()
        if "Authorization" not in headers and not _is_local_url(url):
            return f"Missing API key for {url}. Add a valid API key for this endpoint, then try again.", None, self._get_model_label(model_name)
        session = _get_shared_sync_session()
        response = session.post(
            url,
            headers=headers,
            json=payload,
            timeout=120,
        )
        if response.status_code == 429 or "RESOURCE_EXHAUSTED" in response.text or "quota" in response.text.lower():
            print(f"[KeyPool] ⚠️ 429 Rate Limit/Quota Exceeded (non-coder mode, no key rotation).")

        response.raise_for_status()
        res_json = response.json()
        if "error" in res_json:
            err_msg = str(res_json.get("error", {}).get("message", ""))
            return f"Error from brain server: {err_msg}", None, self._get_model_label(model_name)

        choices = res_json.get("choices", [])
        if not choices:
            return "Hmph! Empty response received.", None, self._get_model_label(model_name)

        message = choices[0].get("message", {})
        content = message.get("content") or ""
        tool_calls = message.get("tool_calls")

        return content, tool_calls, self._get_model_label(model_name)

    def _query_llm(self, messages: List[Dict[str, str]], user_message: str = "", use_tools: bool = False) -> Tuple[str, List[Dict[str, Any]], str]:
        if config.LLM_MODE == 1:
            backend = "simple"
        elif config.LLM_MODE == 2:
            backend = "complex"
        elif config.LLM_MODE == 3:
            task = self._classify_task(user_message) if user_message else "simple"
            backend = task
        else:
            backend = self._classify_task(user_message) if user_message else "simple"

        if config.LLM_MODE == 3:
            try:
                label = "complex" if backend == "complex" else "simple"
                temp = 0.2 if label == "complex" else 0.6
                tb, tm = self._get_backend_and_model_for_task(label)
                print(f"[Router][Mode 3] Task={label} -> using {tm} via {tb.name} with {'full' if label == 'complex' else 'lean'} prompt (temp={temp})")
                return self._query_lmstudio_model(messages, tm, temperature=temp, use_tools=use_tools, backend=tb)
            except Exception as e:
                tb_e, tm_e = self._get_backend_and_model_for_task(label)
                return (
                    tb_e.get_error_message(e),
                    None,
                    self._get_model_label(tm_e)
                )
        elif backend == "complex":
            try:
                print(f"[Router][Mode 2] Task=complex -> using {config.LLM_MODEL} with full prompt (temp=0.2)")
                return self._query_lmstudio_model(messages, config.LLM_MODEL, temperature=0.2, use_tools=use_tools)
            except Exception as complex_err:
                llm_backend = get_backend()
                return (
                    llm_backend.get_error_message(complex_err),
                    None,
                    self._get_model_label(config.LLM_MODEL)
                )
        else:
            try:
                tb, tm = self._get_backend_and_model_for_task("simple")
                print(f"[Router][Mode 1] Task=simple -> using {tm} via {tb.name} with simple prompt (temp=0.6)")
                return self._query_lmstudio_model(messages, tm, temperature=0.6, use_tools=use_tools, backend=tb)
            except Exception as e:
                tb_e, tm_e = self._get_backend_and_model_for_task("simple")
                return (
                    tb_e.get_error_message(e),
                    None,
                    self._get_model_label(tm_e)
                )

    def execute_chat_turn(self, user_message: str, chat_history: List[Dict[str, str]]) -> Tuple[str, List[Dict[str, str]], str]:
        """
        Executes a chat turn in a ReAct loop. Supports multiple sequential tool calls.
        """
        self.memory.increment_interactions()

        # ── Layer 0: Fast Acoustic Reflex (Sub-second Non-Verbal Voice Reaction) ──
        if getattr(config, "AED_FAST_REFLEX", True):
            try:
                from app.voice.aed import is_pure_acoustic_event, get_reflex_response
                pure_tag = is_pure_acoustic_event(user_message)
                if pure_tag:
                    reflex_text = get_reflex_response(pure_tag)
                    if reflex_text:
                        print(f"[Reflex] Fast acoustic reflex triggered for {pure_tag} -- LLM skipped")
                        final_history = list(chat_history) + [
                            {"role": "user", "content": user_message},
                            {"role": "assistant", "content": reflex_text},
                        ]
                        return reflex_text, final_history, "reflex"
            except Exception as _reflex_err:
                print(f"[Reflex] Fast reflex check error: {_reflex_err}")

        if config.LLM_MODE == 1:
            resolved_backend = "simple"
        elif config.LLM_MODE == 2:
            resolved_backend = "complex"
        elif config.LLM_MODE == 3:
            resolved_backend = self._classify_task(user_message) if user_message else "simple"
        else:
            resolved_backend = self._classify_task(user_message) if user_message else "simple"

        current_messages = self._build_messages(user_message, chat_history, resolved_backend)

        is_coder_mode = resolved_backend in ("coder", "complex_coder")
        max_iterations = 30 if is_coder_mode else 10
        iteration = 0
        troubleshoot_attempts = 0
        accumulated_response_total = []
        final_history = list(chat_history) + [{"role": "user", "content": user_message}]
        backend_used = "local"
        
        while iteration < max_iterations:
            iteration += 1
            
            use_tools = (resolved_backend != "simple") or (resolved_backend == "simple" and getattr(config, "SEND_TOOLS_IN_SIMPLE", False))
            current_messages = self._repair_transcript(current_messages)
            llm_response, tool_calls, backend_used = self._query_llm(current_messages, user_message=user_message, use_tools=use_tools)
            print(f"\n[LLM Response (Iteration {iteration}, Backend: {backend_used})]:\n{llm_response}\n")
            log_triggered_backend_tags(llm_response)
            
            if tool_calls:
                # Normalize missing tool_call ids BEFORE appending the assistant message
                # so every assistant tool_call matches its subsequent tool response.
                for tc in tool_calls:
                    if not tc.get("id"):
                        tc["id"] = f"call_{uuid.uuid4().hex[:8]}"
                current_messages.append({
                    "role": "assistant",
                    "content": llm_response or None,
                    "tool_calls": tool_calls
                })
                
                if llm_response.strip():
                    accumulated_response_total.append(llm_response.strip())

                loop = asyncio.get_event_loop()
                for tc in tool_calls:
                    tool_name = tc["function"]["name"]
                    try:
                        tool_args = json.loads(tc["function"]["arguments"])
                    except Exception:
                        tool_args = {}
                        
                    print(f"Agent triggered tool '{tool_name}' with args {tool_args} (iteration {iteration})")
                    tool_result = loop.run_until_complete(self._run_tool_async(tool_name, tool_args))
                    print(f"Tool execution result: {tool_result}")

                    tc_id = tc["id"]
                    current_messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "name": tool_name,
                        "content": str(tool_result)
                    })
            else:
                if llm_response.strip():
                    accumulated_response_total.append(llm_response.strip())
                
                assistant_final_speech = "\n".join(accumulated_response_total)
                final_history.append({"role": "assistant", "content": assistant_final_speech})
                return assistant_final_speech, final_history, backend_used
                
        # ── Iteration cap reached with tool calls still pending ──────────────────────
        # Force one final tool-free turn so the user gets a real closing summary
        # instead of a badge-only message that forces them to type "continue".
        current_messages.append({
            "role": "user",
            "content": (
                "[SYSTEM] Iteration limit reached. Do NOT call more tools. "
                "Write your final summary of everything completed, the current state now, and what's left to do."
            )
        })
        wrap_response, _, _ = self._query_llm(current_messages, user_message=user_message, use_tools=False)
        if wrap_response.strip():
            accumulated_response_total.append(wrap_response.strip())
        assistant_final_speech = "\n".join(accumulated_response_total)
        final_history.append({"role": "assistant", "content": assistant_final_speech})
        return assistant_final_speech, final_history, backend_used

    # ------------------------------------------------------------------ #
    #  Streaming methods                                                 #
    # ------------------------------------------------------------------ #

    def _drop_disabled_tools(self, tools: list, overrides: Optional[Dict[str, Any]] = None) -> list:
        """Remove tools whose feature toggle is disabled (e.g. manage_todo, ask_user)."""
        overrides = overrides or {}
        is_coder_mode = bool(overrides.get("coding_mode") or overrides.get("is_coder_mode") or overrides.get("backend") in ("coder", "complex_coder"))

        # manage_todo is strictly restricted to Coder Mode
        if not is_coder_mode:
            tools = [t for t in tools if t.get("function", {}).get("name") != "manage_todo"]
        else:
            override = overrides.get("manage_todo_enabled")
            if override is not None:
                enabled = bool(override)
            else:
                enabled = bool(self.memory.profile.get("settings", {}).get("manage_todo_enabled", True))
            if not enabled:
                tools = [t for t in tools if t.get("function", {}).get("name") != "manage_todo"]

        ask_override = overrides.get("ask_user_enabled")
        if ask_override is not None:
            ask_enabled = bool(ask_override)
        else:
            ask_enabled = bool(self.memory.profile.get("settings", {}).get("ask_user_enabled", True))
        if not ask_enabled:
            tools = [t for t in tools if t.get("function", {}).get("name") != "ask_user"]

        # Scope Telegram tools EXCLUSIVELY to remote Telegram sessions
        is_from_telegram = bool(overrides.get("from_telegram", False))
        if is_from_telegram:
            from app.tools.definitions import get_tools_definition
            all_defs = get_tools_definition()
            telegram_defs = [t for t in all_defs if t.get("function", {}).get("name", "").startswith("telegram_")]
            existing_names = {t.get("function", {}).get("name") for t in tools}
            for tdef in telegram_defs:
                tname = tdef.get("function", {}).get("name")
                if tname and tname not in existing_names:
                    tools.append(tdef)
                    existing_names.add(tname)
        else:
            # Desktop mode: NEVER include telegram tools!
            tools = [t for t in tools if not t.get("function", {}).get("name", "").startswith("telegram_")]

        return tools

    def _drop_blocked_tools(self, tools: list) -> list:
        """Remove tool schemas the user blacklisted (never sent in non-coder modes)."""
        blocked = set(getattr(config, "TOOL_BLACKLIST", None) or ())
        if not blocked:
            return tools
        return [t for t in tools if t.get("function", {}).get("name") not in blocked]

    async def _get_tool_definitions_for_messages(self, messages: List[Dict[str, str]], intent_tool_hint: str = "", overrides: Optional[Dict[str, Any]] = None, active_model: str = "") -> list:
        """Return tool schemas from MCP discovery, with local-schema fallback."""
        overrides = overrides or {}
        if overrides.get("no_tools") or overrides.get("tool_mode") == "none" or overrides.get("is_startup_greeting"):
            print("[Tools] No-tools override active (startup greeting or conversational turn): 0 tools sent to LLM")
            return []

        effective_tool_mode = overrides.get("tool_mode") or getattr(config, "TOOL_MODE", "basic")
        use_dynamic = overrides.get("dynamic_tool_calling") if overrides.get("dynamic_tool_calling") is not None else self.memory.profile.get("settings", {}).get("dynamic_tool_calling", True)
        user_message = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                content = _message_text(msg.get("content", ""))
                if not content.strip().startswith("[SYSTEM]"):
                    user_message = content
                    break

        filtered_tools = await self.mcp_tools.get_tool_definitions(user_message, use_dynamic)

        # Note: jarvis_get_image stays available for native vision models so the agent can
        # re-inspect previously attached images on demand by path in later turns.

        # Filter tool definition list based on per-turn coding_mode or effective_tool_mode override
        if overrides.get("coding_mode"):
            # User-configurable coder allowlist. None = default coder set; a list
            # (even empty) is authoritative — deselected tools are never shipped.
            from app.tools.selector import _DEFAULT_CODING_TOOLS
            _configured_coding = getattr(config, "INCLUDED_CODER_TOOLS", None)
            coding_allowed = set(_configured_coding) if _configured_coding is not None else set(_DEFAULT_CODING_TOOLS)
            codegraph_coder_enabled = bool(getattr(config, "CODEGRAPH_CODER_ENABLED", False))
            codegraph_defs = []
            if codegraph_coder_enabled:
                from app.tools.definitions import get_codegraph_tool_definitions
                codegraph_defs = get_codegraph_tool_definitions()
                coding_allowed.update(t["function"]["name"] for t in codegraph_defs)
            filtered_tools = [t for t in filtered_tools if t.get("function", {}).get("name") in coding_allowed]
            # Ensure every INCLUDED tool is actually shipped even when dynamic tool
            # selection dropped it (e.g. custom always_included_tools). Deselected
            # tools are never re-added — full user control.
            _present = {t["function"]["name"] for t in filtered_tools}
            for _def in _grep_tool_candidates(self.mcp_tools) + codegraph_defs:
                _name = _def.get("function", {}).get("name")
                if _name and _name in coding_allowed and _name not in _present:
                    filtered_tools.append(_def)
                    _present.add(_name)
        elif effective_tool_mode == "basic":
            basic_allowed = {
                "web_search", "read_file_content", "search_files", "list_directory",
                "launch_app", "open_or_play_file", "set_system_volume", "manage_timer_stopwatch_alarms",
                "get_system_stats", "update_user_fact", "take_screenshot", "run_terminal_command", "run_python_script",
                "jarvis_query_file_db", "jarvis_open_or_play_file",
                "jarvis_get_image", "jarvis_analyze_image", "jarvis_see_screen", "ask_user", "change_avatar_outfit"
            }
            filtered_tools = [t for t in filtered_tools if t.get("function", {}).get("name") in basic_allowed]

        filtered_tools = self._drop_disabled_tools(filtered_tools, overrides)

        # User tool blacklist applies to every non-coder mode (basic/advanced,
        # simple/complex, dynamic on/off). Coder mode keeps its full allowlist.
        if not overrides.get("coding_mode"):
            filtered_tools = self._drop_blocked_tools(filtered_tools)

        if intent_tool_hint:
            if intent_tool_hint in ("change_avatar_outfit", "jarvis_change_avatar_outfit"):
                target_name = "jarvis_change_avatar_outfit" if effective_tool_mode == "advanced" else "change_avatar_outfit"
                targeted = [t for t in filtered_tools if t.get("function", {}).get("name") == target_name]
                if not targeted:
                    targeted = [t for t in filtered_tools if t.get("function", {}).get("name") in ("change_avatar_outfit", "jarvis_change_avatar_outfit")]
            else:
                targeted = [t for t in filtered_tools if t.get("function", {}).get("name") == intent_tool_hint]
            if targeted:
                tool_names = [t["function"]["name"] for t in targeted]
                print(f"[Tools] Intent-targeted filter ({effective_tool_mode}): sending ONLY [{', '.join(tool_names)}] to LLM")
                return targeted

        tool_names = [t["function"]["name"] for t in filtered_tools]
        source = "MCP stdio" if self.mcp_tools.enabled and not self.mcp_tools.last_error else "local"
        print(f"[Tools] Sending {len(filtered_tools)} {source} tools to LLM (mode: {effective_tool_mode}): {', '.join(tool_names)}")
        return filtered_tools

    async def _stream_request(self, session: aiohttp.ClientSession, url: str, model: str, messages: List[Dict[str, str]], temperature: float = 0.7, use_tools: bool = False, intent_tool_hint: str = "", overrides: Optional[Dict[str, Any]] = None, backend=None, allow_key_rotation: bool = False):
        llm_backend = backend or get_backend()
        tools = None
        if use_tools:
            tools = await self._get_tool_definitions_for_messages(messages, intent_tool_hint=intent_tool_hint, overrides=overrides, active_model=model)

        payload = llm_backend.build_payload(
            model=model,
            messages=messages,
            temperature=temperature,
            use_tools=use_tools,
            tools=tools,
            stream=True,
        )

        _log_payload_stats(payload, model, tag="stream")
        max_attempts = len(llm_backend.get_api_key_pool()) if allow_key_rotation and hasattr(llm_backend, "get_api_key_pool") and llm_backend.get_api_key_pool() else 1
        for attempt in range(max(1, max_attempts)):
            headers = llm_backend.build_headers()
            if "Authorization" not in headers and not _is_local_url(url):
                yield {"content": f"Missing API key for {url}. Add a valid API key for this endpoint in the workspace's Coder Endpoint settings (e.g. your OpenRouter key), then try again."}
                return
            async with session.post(url, json=payload, headers=headers, timeout=120) as resp:
                if resp.status != 200:
                    try:
                        err_text = await resp.text()
                        err_json = json.loads(err_text)
                        err_msg = err_json.get("error", {}).get("message", err_text)
                    except Exception:
                        err_text_preview = err_text[:500] if err_text else "(empty body)"
                        err_msg = f"HTTP {resp.status}: {err_text_preview}"
                    
                    if allow_key_rotation and (resp.status == 429 or "RESOURCE_EXHAUSTED" in err_msg or "quota" in err_msg.lower()) and hasattr(llm_backend, "rotate_on_rate_limit") and attempt < max_attempts - 1:
                        llm_backend.rotate_on_rate_limit()
                        print(f"[KeyPool][Stream] ⚠️ 429 Rate Limit/Quota Exceeded! Rotating key and retrying (attempt {attempt+2}/{max_attempts})...")
                        continue

                    print(f"[Stream] Error from {url}: {err_msg}")
                    yield {"content": f"Error from brain server: {err_msg}"}
                    return

                async for line_bytes in resp.content:
                    line = line_bytes.decode("utf-8").strip()
                    if not line:
                        continue
                    if line.startswith("event: error"):
                        continue
                    if line.startswith("data: "):
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break
                        try:
                            data = json.loads(data_str)
                            if "error" in data:
                                yield {"content": f"Error from brain server: {data['error'].get('message')}"}
                                break
                            choices = data.get("choices", [])
                            if choices:
                                delta = choices[0].get("delta", {})
                                yield delta
                        except Exception:
                            pass
                break


    async def _stream_lmstudio_model(self, session: aiohttp.ClientSession, model_name: str, messages: List[Dict[str, str]], temperature: float = 0.7, use_tools: bool = False, intent_tool_hint: str = "", backend=None, overrides: Optional[Dict[str, Any]] = None, allow_key_rotation: bool = False):
        if backend is None:
            llm_backend = get_backend()
        else:
            llm_backend = backend
        url = llm_backend.get_chat_url()
        async for chunk in self._stream_request(session, url, model_name, messages, temperature=temperature, use_tools=use_tools, intent_tool_hint=intent_tool_hint, overrides=overrides, backend=llm_backend, allow_key_rotation=allow_key_rotation):
            yield chunk, self._get_model_label(model_name)

    async def _query_llm_stream(
        self,
        session: aiohttp.ClientSession,
        messages: List[Dict[str, str]],
        user_message: str = "",
        use_tools: bool = False,
        resolved_backend: str = "",   # Pass in the classification result so we don't re-classify
        intent_tool_hint: str = "",
        intent_source: str = "regex",
        overrides: Optional[Dict[str, Any]] = None,
    ):
        """
        Streams tokens from the LLM.
        resolved_backend: 'simple' or 'complex' — determined by _classify_task + intent check.
        If not provided, falls back to re-classifying (legacy behaviour).
        """
        # Coder Mode Override: if Coder Mode is active, enforce dedicated Coder engine regardless of LLM_MODE setting
        is_coder = bool(overrides and overrides.get("coding_mode")) or resolved_backend in ("coder", "complex_coder")
        
        if is_coder:
            try:
                task = "coder"
                tb, tm = self._get_backend_and_model_for_task("coder", overrides=overrides)
                print(f"[Router][Coder Mode] Task=coder -> streaming {tm} via {tb.name} (temp=0.1)")
                async for chunk, label in self._stream_lmstudio_model(session, tm, messages, temperature=0.1, use_tools=use_tools, intent_tool_hint=intent_tool_hint, backend=tb, overrides=overrides, allow_key_rotation=True):
                    yield chunk, label
                return
            except Exception as e:
                tb_e, tm_e = self._get_backend_and_model_for_task("coder", overrides=overrides)
                err_msg = {"content": tb_e.get_error_message(e)}
                yield err_msg, self._get_model_label(tm_e)
                return

        if config.LLM_MODE == 1:
            backend = "simple"
        elif config.LLM_MODE == 2:
            backend = "complex"
        elif config.LLM_MODE == 3:
            backend = "mode3"
        else:
            backend = self._classify_task(user_message) if user_message else "simple"

        if backend == "mode3":
            try:
                # Use the intent-check/regex result if provided; only re-classify as last resort
                if resolved_backend in ("simple", "complex", "coder", "complex_coder"):
                    task = resolved_backend
                    source = intent_source or "coding_mode"
                else:
                    task = self._classify_task(user_message) if user_message else "simple"
                    source = "regex"
                temp = 0.75 if overrides.get("is_startup_greeting") else (0.1 if task in ("coder", "complex_coder") else (0.2 if task == "complex" else 0.6))
                tb, tm = self._get_backend_and_model_for_task(task)
                print(f"[Router][Mode 3] Task={task} (via {source}) -> streaming {tm} via {tb.name} with {'full' if task in ('complex', 'coder', 'complex_coder') else 'lean'} prompt (temp={temp})")
                async for chunk, label in self._stream_lmstudio_model(session, tm, messages, temperature=temp, use_tools=use_tools, intent_tool_hint=intent_tool_hint, backend=tb, overrides=overrides):
                    yield chunk, label
            except Exception as e:
                tb_e, tm_e = self._get_backend_and_model_for_task(task)
                err_msg = {"content": tb_e.get_error_message(e)}
                yield err_msg, self._get_model_label(tm_e)
        elif backend == "complex":
            try:
                temp = 0.75 if overrides.get("is_startup_greeting") else 0.2
                print(f"[Router][Mode 2] Task=complex -> streaming {config.LLM_MODEL} with full prompt (temp={temp})")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL, messages, temperature=temp, use_tools=use_tools, intent_tool_hint=intent_tool_hint, overrides=overrides):
                    yield chunk, label
            except Exception as e:
                llm_backend = get_backend()
                err_msg = {"content": llm_backend.get_error_message(e)}
                yield err_msg, self._get_model_label(config.LLM_MODEL)
        else:
            try:
                tb, tm = self._get_backend_and_model_for_task("simple")
                temp = 0.75 if overrides.get("is_startup_greeting") else 0.6
                print(f"[Router] Task=simple -> streaming {tm} via {tb.name} (temp={temp})")
                async for chunk, label in self._stream_lmstudio_model(session, tm, messages, temperature=temp, use_tools=use_tools, backend=tb, overrides=overrides):
                    yield chunk, label
            except Exception as e:
                tb_e, tm_e = self._get_backend_and_model_for_task("simple")
                err_msg = {"content": tb_e.get_error_message(e)}
                yield err_msg, self._get_model_label(tm_e)

    def _extract_inline_tool_calls(self, text: str) -> Tuple[List[Dict[str, Any]], str]:
        """
        Extracts tool calls embedded directly in LLM text (e.g. <tool_call>...</tool_call>,
        <function_call>...</function_call>, [TOOL_CALL]...[/TOOL_CALL], or markdown code blocks)
        and returns (extracted_tool_calls, cleaned_narration_before_tool).
        """
        if not text:
            return [], ""

        extracted = []
        first_match_start = None

        # Pattern 1: XML/tag-based tool calls: <tool_call>...</tool_call>, <function_call>...</function_call>, [TOOL_CALL]...[/TOOL_CALL]
        tag_pattern = re.compile(
            r'(?:<tool_call>|<function_call>|\[TOOL_CALL\])\s*([\s\S]*?)\s*(?:</tool_call>|</function_call>|\[/TOOL_CALL\])',
            re.IGNORECASE
        )
        for m in tag_pattern.finditer(text):
            if first_match_start is None or m.start() < first_match_start:
                first_match_start = m.start()
            raw_payload = m.group(1).strip()
            parsed_calls = self._try_parse_json_tool_call(raw_payload)
            if parsed_calls:
                extracted.extend(parsed_calls)
            else:
                try:
                    data = json.loads(raw_payload)
                    parsed = self._parse_single_tool_json(data)
                    if parsed:
                        extracted.append(parsed)
                except Exception:
                    pass

        # Pattern 2: Markdown blocks ```tool_args or ```json if no tag calls found
        if not extracted:
            md_pattern = re.compile(
                r'```(?:tool_args|json)?\s*(\{\s*"name"[\s\S]*?\})\s*```',
                re.IGNORECASE
            )
            for m in md_pattern.finditer(text):
                if first_match_start is None or m.start() < first_match_start:
                    first_match_start = m.start()
                raw_payload = m.group(1).strip()
                try:
                    data = json.loads(raw_payload)
                    parsed = self._parse_single_tool_json(data)
                    if parsed:
                        extracted.append(parsed)
                except Exception:
                    pass

        # Pattern 3: Standalone unified JSON or tool_calls block
        if not extracted and ("\"name\"" in text and "\"arguments\"" in text):
            parsed_calls = self._try_parse_json_tool_call(text)
            if parsed_calls:
                return parsed_calls, ""

        if extracted:
            cleaned_narration = text[:first_match_start].strip() if first_match_start is not None else ""
            return extracted, cleaned_narration

        return [], text

    def _try_parse_json_tool_call(self, text: str) -> list:
        cleaned = text.strip()

        # Handle XML/tag-based tool calls if wrapped
        tag_match = re.search(r'(?:<tool_call>|<function_call>|\[TOOL_CALL\])\s*([\s\S]*?)\s*(?:</tool_call>|</function_call>|\[/TOOL_CALL\])', cleaned, re.IGNORECASE)
        if tag_match:
            cleaned = tag_match.group(1).strip()
        
        # Handle markdown code blocks
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if len(lines) > 2 and lines[-1].startswith("```"):
                cleaned = "\n".join(lines[1:-1]).strip()
            elif len(lines) > 1:
                cleaned = "\n".join(lines[1:]).strip()
        
        # Try unified format first: {"tool_calls": [{"name": "...", "arguments": {...}}]}
        try:
            data = json.loads(cleaned)
            if isinstance(data, dict) and "tool_calls" in data:
                calls = []
                for item in data["tool_calls"]:
                    parsed = self._parse_single_tool_json(item)
                    if parsed:
                        calls.append(parsed)
                if calls:
                    return calls
        except Exception:
            pass
        
        # Try to find multiple JSON objects separated by ; or newlines
        # Split by semicolon or newline, then try each part
        parts = []
        if ";" in cleaned:
            parts = [p.strip() for p in cleaned.split(";") if p.strip()]
        elif "\n" in cleaned:
            parts = [p.strip() for p in cleaned.split("\n") if p.strip()]
        else:
            parts = [cleaned]
        
        all_calls = []
        for part in parts:
            # Try to extract JSON from each part
            start_idx = part.find("{")
            end_idx = part.rfind("}")
            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                json_str = part[start_idx:end_idx+1]
                try:
                    data = json.loads(json_str)
                    # Handle unified format with tool_calls array
                    if isinstance(data, dict) and "tool_calls" in data:
                        for item in data["tool_calls"]:
                            parsed = self._parse_single_tool_json(item)
                            if parsed:
                                all_calls.append(parsed)
                    elif isinstance(data, list):
                        for item in data:
                            parsed = self._parse_single_tool_json(item)
                            if parsed:
                                all_calls.append(parsed)
                    elif isinstance(data, dict):
                        parsed = self._parse_single_tool_json(data)
                        if parsed:
                            all_calls.append(parsed)
                except Exception:
                    continue
        
        if all_calls:
            return all_calls
        
        # Fallback: try single JSON object/array (original logic)
        start_idx = cleaned.find("{")
        end_idx = cleaned.rfind("}")
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            json_str = cleaned[start_idx:end_idx+1]
            try:
                data = json.loads(json_str)
                if isinstance(data, list):
                    calls = []
                    for item in data:
                        parsed = self._parse_single_tool_json(item)
                        if parsed:
                            calls.append(parsed)
                    if calls:
                        return calls
                elif isinstance(data, dict):
                    parsed = self._parse_single_tool_json(data)
                    if parsed:
                        return [parsed]
            except Exception:
                pass
        
        # Try pseudo-code format: Action: tool_name(args) or tool_name(args)
        pseudo_match = re.match(r'(?:Action:\s*)?(\w+)\((.*)\)\s*$', cleaned, re.DOTALL)
        if pseudo_match:
            tool_name = pseudo_match.group(1)
            args_str = pseudo_match.group(2)
            try:
                # Parse key=value pairs from args string
                args_dict = {}
                # Handle simple key="value" or key=value patterns
                for arg_match in re.finditer(r'(\w+)\s*=\s*("[^"]*"|\'[^\']*\'|[^,\)]+)', args_str):
                    key = arg_match.group(1)
                    value = arg_match.group(2).strip('"\'')
                    # Try to convert to appropriate type
                    if value.lower() == 'true':
                        args_dict[key] = True
                    elif value.lower() == 'false':
                        args_dict[key] = False
                    else:
                        try:
                            args_dict[key] = int(value)
                        except ValueError:
                            try:
                                args_dict[key] = float(value)
                            except ValueError:
                                args_dict[key] = value
                return [{
                    "id": self._unique_tool_call_id(f"fallback_{tool_name}"),
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": json.dumps(args_dict)
                    }
                }]
            except Exception:
                pass

        # Robust Markdown Tool Call Extractor for text-simulated tool calls
        # Pattern 1: 🛠️ **[tool_name ...]** followed by ```tool_args ... ```
        md_matches = list(re.finditer(r'(?:🛠️\s*\*\*)?\[(\w+)[^\]]*\](?:\*\*)?[\s\S]*?```(?:tool_args|json)?\s*(\{[\s\S]*?\})\s*```', text, re.IGNORECASE))
        if md_matches:
            calls = []
            for m in md_matches:
                tname = m.group(1)
                jstr = m.group(2)
                try:
                    adict = json.loads(jstr)
                    calls.append({
                        "id": self._unique_tool_call_id(f"markdown_{tname}"),
                        "type": "function",
                        "function": {"name": tname, "arguments": json.dumps(adict)}
                    })
                except Exception:
                    pass
            if calls:
                return calls

        # Pattern 2: standalone ```tool_args { ... } ``` code blocks
        tool_args_blocks = list(re.finditer(r'```(?:tool_args|json)\s*(\{.*?\})\s*```', text, re.DOTALL))
        if tool_args_blocks:
            calls = []
            for m in tool_args_blocks:
                jstr = m.group(1)
                try:
                    adict = json.loads(jstr)
                    inferred_name = None
                    if "command" in adict:
                        inferred_name = "jarvis_run_terminal"
                    elif "file_path" in adict or "content" in adict:
                        inferred_name = "jarvis_create_or_edit_file"
                    elif "code" in adict:
                        inferred_name = "jarvis_run_python"
                    elif "input_text" in adict:
                        inferred_name = "jarvis_send_stdin"

                    if inferred_name:
                        calls.append({
                            "id": self._unique_tool_call_id(f"inferred_{inferred_name}"),
                            "type": "function",
                            "function": {"name": inferred_name, "arguments": json.dumps(adict)}
                        })
                except Exception:
                    pass
            if calls:
                return calls
        
        return None

    def _parse_single_tool_json(self, data: dict) -> dict:
        name = None
        arguments = None
        
        # Unified format: {"name": "...", "arguments": {...}}
        if "name" in data and "arguments" in data:
            name = data["name"]
            arguments = data["arguments"]
        
        # OpenAI wrapper with function object: {"type": "function", "function": {"name": "...", "arguments": "..."}}
        elif "function" in data and isinstance(data["function"], dict):
            fn_data = data["function"]
            name = fn_data.get("name")
            arguments = fn_data.get("arguments") or fn_data.get("parameters")
        
        # OpenAI wrapper with function string: {"type": "function", "function": "tool_name", "parameters": {...}}
        elif "function" in data and isinstance(data["function"], str):
            name = data["function"]
            arguments = data.get("parameters") or data.get("arguments")
        
        # Direct format: {"name": "...", "parameters": {...}}
        elif "name" in data:
            name = data["name"]
            arguments = data.get("parameters") or data.get("arguments")
        
        if arguments is None:
            arguments = data.get("arguments") or data.get("parameters") or data.get("properties") or {}
            
        if name and isinstance(name, str):
            if not isinstance(arguments, str):
                arguments = json.dumps(arguments)
            return {
                "id": self._unique_tool_call_id(f"fallback_{name}"),
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": arguments
                }
            }
        return None

    def _unique_tool_call_id(self, prefix: str) -> str:
        """Generate a turn-unique tool_call id for text-fallback parsed calls."""
        cnt = getattr(self, "_fallback_call_counter", 0) + 1
        self._fallback_call_counter = cnt
        return f"call_{prefix}_{cnt}"

    def _repair_transcript(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Self-heal an invalid assistant/tool transcript before sending it to the API.

        The OpenAI-compatible protocol requires every assistant message carrying
        tool_calls to be immediately followed by exactly one role:'tool' message per
        call before any other message type. If a mismatch slipped in (e.g. a
        loop-detected duplicate call that never produced a tool response), the server
        rejects the whole request with HTTP 400 code 3230. This strips unmatched
        tool_calls and converts orphaned tool messages to text context so the request
        always validates.
        """
        repaired = []
        i = 0
        n = len(messages)
        changed = False
        while i < n:
            msg = messages[i]
            if msg.get("role") == "assistant" and msg.get("tool_calls"):
                calls = list(msg["tool_calls"])
                j = i + 1
                tool_msgs = []
                while j < n and messages[j].get("role") == "tool":
                    tool_msgs.append(messages[j])
                    j += 1
                if len(tool_msgs) != len(calls):
                    changed = True
                    keep_count = min(len(calls), len(tool_msgs))
                    print(f"[Executor] Repaired transcript: assistant tool_calls {len(calls)} with {len(tool_msgs)} tool responses.")
                    msg = dict(msg)
                    msg["tool_calls"] = calls[:keep_count]
                    if not msg["tool_calls"]:
                        msg.pop("tool_calls", None)
                        if not msg.get("content"):
                            msg["content"] = "Task step executed."
                    repaired.append(msg)
                    repaired.extend(tool_msgs[:keep_count])
                    for extra in tool_msgs[keep_count:]:
                        repaired.append({
                            "role": "user",
                            "content": f"[Past Result ({extra.get('name', 'Tool')})]: {str(extra.get('content') or '').strip()}"
                        })
                    i = j
                    continue
                repaired.append(msg)
                repaired.extend(tool_msgs)
                i = j
            elif msg.get("role") == "tool":
                changed = True
                print(f"[Executor] Repairing orphaned tool response for '{msg.get('name', 'Tool')}' -> text context.")
                repaired.append({
                    "role": "user",
                    "content": f"[Past Result ({msg.get('name', 'Tool')})]: {str(msg.get('content') or '').strip()}"
                })
                i += 1
            else:
                repaired.append(msg)
                i += 1
        if changed:
            print("[Executor] Transcript repair applied before LLM request.")
        return repaired

    # Matches "tool in progress" announcements the model emits before a tool call
    # (e.g. "Running tool...", "I'll use a tool."). These carry no information and
    # pile up in the UI/transcript, so they are suppressed during streaming and
    # replaced with a synthesized step line when building the assistant message.
    _TOOL_FILLER_RE = re.compile(
        r"^\s*((running|executing|using|calling|starting|performing)\s+(a\s+)?tool)|"
        r"^\s*((let me|i'?ll|i will|let's|i'?m going to|i'?m)\s+(use|run|call|execute|invoke|start|fire)\s+(up\s+)?(a\s+)?tool)|"
        r"^\s*(running|executing|working|loading|one moment|just a moment|please wait|hold on|give me a moment)[.!]*\s*$|"
        r"^\s*\.{3,}\s*$",
        re.IGNORECASE,
    )
    _FILLER_BUFFER_CAP = 500

    def _is_pure_filler(self, text: str) -> bool:
        """True if the given text is only a 'tool in progress' announcement with no real content."""
        return bool(self._TOOL_FILLER_RE.match(text or ""))

    async def _parse_native_stream(self, token_stream):
        """
        Accumulates tool calls from delta chunks and yields normal tokens.
        At the end of the stream, yields "tool_calls" events.
        Supports fallback parsing of text-based JSON tool calls and markdown tool blocks.
        """
        accumulated_tool_calls = {}
        last_label = "local"
        
        text_buffer = ""
        pending_text = ""  # text held back until it is confirmed to be real narration, not filler
        is_json_candidate = None  # None = undecided, True = buffering as JSON, False = streaming normally
        
        async for delta, label in token_stream:
            last_label = label
            
            # 1. Yield text content or buffer it
            content = delta.get("content")
            if content:
                if is_json_candidate is None:
                    text_buffer += content
                    stripped = text_buffer.lstrip()
                    if stripped:
                        # Check if response starts with JSON/code block markup
                        if stripped.startswith("{") or stripped.startswith("```") or stripped.startswith("["):
                            is_json_candidate = True
                        else:
                            # Plain text response — buffer briefly until it is confirmed
                            # to be real narration (not "Running tool..." filler).
                            is_json_candidate = False
                            pending_text += text_buffer
                            text_buffer = ""
                            if not self._is_pure_filler(pending_text) or len(pending_text) > self._FILLER_BUFFER_CAP:
                                yield "token", pending_text, label
                                pending_text = ""
                elif is_json_candidate:
                    text_buffer += content
                else:
                    pending_text += content
                    if not self._is_pure_filler(pending_text) or len(pending_text) > self._FILLER_BUFFER_CAP:
                        yield "token", pending_text, label
                        pending_text = ""
                    
            # 2. Accumulate tool calls
            tool_calls = delta.get("tool_calls")
            if tool_calls:
                is_json_candidate = False
                # A tool call follows: release real narration, drop filler announcements.
                if pending_text and not self._is_pure_filler(pending_text):
                    yield "token", pending_text, label
                pending_text = ""
                for tc_delta in tool_calls:
                    index = tc_delta.get("index")
                    if index is None:
                        tc_id = tc_delta.get("id")
                        index = tc_id if tc_id else len(accumulated_tool_calls)
                    
                    if index not in accumulated_tool_calls:
                        accumulated_tool_calls[index] = {
                            "id": tc_delta.get("id"),
                            "type": "function",
                            "function": {"name": "", "arguments": ""}
                        }
                    
                    if tc_delta.get("id") and not accumulated_tool_calls[index].get("id"):
                        accumulated_tool_calls[index]["id"] = tc_delta["id"]

                    fn_delta = tc_delta.get("function", {})
                    if fn_delta.get("name"):
                        new_name = fn_delta["name"]
                        curr_name = accumulated_tool_calls[index]["function"]["name"]
                        if not curr_name:
                            accumulated_tool_calls[index]["function"]["name"] = new_name
                        elif curr_name == new_name:
                            pass
                        elif new_name.startswith(curr_name):
                            accumulated_tool_calls[index]["function"]["name"] = new_name
                        elif curr_name.endswith(new_name):
                            pass
                        else:
                            accumulated_tool_calls[index]["function"]["name"] += new_name

                    if fn_delta.get("arguments"):
                        accumulated_tool_calls[index]["function"]["arguments"] += fn_delta["arguments"]
                        
        if is_json_candidate and text_buffer:
            fallback_calls = self._try_parse_json_tool_call(text_buffer)
            if fallback_calls:
                print(f"[Fallback Parser] Successfully parsed text JSON into tool calls: {fallback_calls}")
                yield "tool_calls", fallback_calls, last_label
            else:
                # Not a valid tool call JSON, flush the buffer to the user
                yield "token", text_buffer, last_label
        elif not accumulated_tool_calls and text_buffer:
            # Check for hallucinated markdown tool call blocks inside full text buffer
            fallback_calls = self._try_parse_json_tool_call(text_buffer)
            if fallback_calls:
                print(f"[Fallback Parser] Intercepted markdown simulated tool call in text: {fallback_calls}")
                yield "tool_calls", fallback_calls, last_label

        if pending_text:
            # Never lose real text: anything still buffered (e.g. a response that
            # started filler-like but was never followed by a tool call) is flushed.
            yield "token", pending_text, last_label
                
        # Stream complete, yield any accumulated tool calls
        if accumulated_tool_calls:
            sorted_indices = sorted(accumulated_tool_calls.keys(), key=lambda x: str(x))
            compiled_calls = []
            for idx in sorted_indices:
                call_obj = accumulated_tool_calls[idx]
                raw_name = call_obj["function"]["name"]
                call_obj["function"]["name"] = self._normalize_tool_name(raw_name)
                compiled_calls.append(call_obj)
            yield "tool_calls", compiled_calls, last_label

    async def execute_chat_turn_stream(
        self,
        user_message: str,
        chat_history: List[Dict[str, str]],
        overrides: Optional[Dict[str, Any]] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        input_audio: Optional[Dict[str, Any]] = None
    ):
        """
        Executes a chat turn in a streaming ReAct loop. Supports per-turn overrides from Chat Window.
        """
        overrides = overrides or {}
        effective_tool_mode = overrides.get("tool_mode") or getattr(config, "TOOL_MODE", "basic")

        self._active_turn_id = overrides.get("turn_id") or ""
        self._active_session_id = overrides.get("session_id")

        self.memory.increment_interactions()

        # Time-based mood drift: she keeps "living" between messages.
        try:
            self.memory.step_mood()
        except Exception as e:
            print(f"[MoodEngine] step error: {e}")

        from app.agent.resolver import resolve_command
        from app.tools.safety import strip_internal_auth_fields, issue_confirmation_grant, describe_tool_target

        # ── Layer 0: Fast Acoustic Reflex (Sub-second Non-Verbal Voice Reaction) ──
        if getattr(config, "AED_FAST_REFLEX", True):
            try:
                from app.voice.aed import is_pure_acoustic_event, get_reflex_response
                pure_tag = is_pure_acoustic_event(user_message)
                if pure_tag:
                    reflex_text = get_reflex_response(pure_tag)
                    if reflex_text:
                        print(f"[Reflex] Fast acoustic reflex triggered for {pure_tag} -- LLM skipped")
                        yield "token", reflex_text, "reflex"
                        updated_history = list(chat_history) + [
                            {"role": "user",      "content": user_message, "attachments": _sanitize_attachments_for_history(attachments)},
                            {"role": "assistant", "content": reflex_text},
                        ]
                        yield "final_history", updated_history, "reflex"
                        yield "done", {"text": reflex_text, "tools_used": []}, "reflex"
                        return
            except Exception as _reflex_err:
                print(f"[Reflex] Fast reflex check error: {_reflex_err}")

        # ── Layer 1: Zero-LLM Instant Resolver ───────────────────────────────
        # Skip in advanced/autonomous Jarvis mode or when tools are disabled
        resolved = resolve_command(user_message) if (effective_tool_mode == "basic" and not overrides.get("no_tools") and not overrides.get("is_startup_greeting")) else None
        if resolved:
            tool_name, tool_args = resolved
            print(f"[Resolver] '{user_message}' -> {tool_name}({tool_args}) - LLM skipped")
            
            # Speak an announcement first for tools that steal focus or block the screen
            announcements = {
                "take_screenshot": "Taking a screenshot. \n",
                "system_power_control": "Executing power command. \n",
                "launch_app": "Opening application. \n",
                "run_terminal_command": "Running terminal command. \n",
                "run_python_script": "Running Python script. \n",
            }
            
            announcement = announcements.get(tool_name)
            if announcement:
                yield "thinking", announcement, "resolver"
                # Give the backend/frontend a moment to stream, generate TTS, and start playback
                await asyncio.sleep(1.0)
                
            yield "tool_start", {"name": tool_name, "args": tool_args}, "resolver"
            tool_result = str(await self._run_tool_async(tool_name, tool_args))

            target_path = _extract_confirmation_target(tool_result)
            if target_path:
                print(f"[Resolver] Tool '{tool_name}' returned CONFIRM_REQUIRED for path: {target_path}")

                confirmed_args = strip_internal_auth_fields(tool_args if isinstance(tool_args, dict) else {})
                if tool_name == "open_or_play_file":
                    confirmed_args = {
                        "file_path_or_query": target_path,
                        "play_mode": bool((tool_args or {}).get("play_mode", False)),
                    }
                confirmed_status = yield "tool_confirm_required", target_path, "resolver"
                if confirmed_status:
                    grant_id = issue_confirmation_grant(
                        tool_name,
                        confirmed_args,
                        target=target_path or describe_tool_target(tool_name, confirmed_args),
                    )
                    confirmed_args["confirmation_grant_id"] = grant_id
                    print(f"[Resolver] Re-running '{tool_name}' with backend confirmation grant for path: {target_path}")
                    tool_result = str(await self._run_tool_async(tool_name, confirmed_args))
                else:
                    print(f"[Resolver] Tool execution cancelled by user.")
                    tool_result = "Action cancelled by security confirmation check."
                    yield "tool_result", tool_result, "resolver"
                    yield "token", tool_result, "resolver"
                    updated_history = list(chat_history) + [
                        {"role": "user",      "content": user_message, "attachments": _sanitize_attachments_for_history(attachments)},
                        {"role": "assistant", "content": tool_result},
                    ]
                    yield "final_history", updated_history, "resolver"
                    return

            yield "tool_result", tool_result, "resolver"
            
            # Apply short-circuit formatting if applicable for a cleaner response
            display_result = tool_result
            if tool_name in _SHORT_CIRCUIT_TOOLS:
                display_result = _format_short_circuit_result(tool_name, tool_result, tool_args)
                
            yield "token", display_result, "resolver"
            
            final_response = display_result
            if announcement:
                final_response = announcement.strip() + " " + display_result
                
            updated_history = list(chat_history) + [
                {"role": "user",      "content": user_message, "attachments": _sanitize_attachments_for_history(attachments)},
                {"role": "assistant", "content": final_response},
            ]
            yield "final_history", updated_history, "resolver"
            return
        # ─────────────────────────────────────────────────────────────────────

        # ── Chat Mode Setting Check ──────────────────────────────────────────
        settings = self.memory.profile.get("settings", {})
        chat_mode = settings.get("chat_mode", False)
        keep_memory_saving = settings.get("keep_memory_saving", True)

        intent_tool_hint = ""
        intent_source = "chat_mode"

        if chat_mode:
            if keep_memory_saving and user_message:
                intent, intent_tool_hint, intent_source = await self._check_tool_intent(user_message, chat_history)
                if intent == "tool" and intent_tool_hint == "update_user_fact":
                    resolved_backend = "complex"
                    print(f"[ChatMode] Memory saving active — proceeding with update_user_fact ({intent_source})")
                else:
                    resolved_backend = "simple"
                    intent_tool_hint = ""
                    print(f"[ChatMode] Chat mode active — tools disabled ({intent_source})")
            else:
                resolved_backend = "simple"
                intent_tool_hint = ""
                print("[ChatMode] Pure chat mode active — all tools disabled")
        else:
            if overrides.get("coding_mode"):
                resolved_backend = "coder"
                intent_tool_hint = ""
                intent_source = "coding_mode"
                print("[CodingMode] Autonomous Coder Mode active — forcing dedicated Coder Mode engine with full ReAct loop")
            else:
                effective_llm_mode = overrides.get("llm_mode") if overrides.get("llm_mode") is not None else getattr(config, "LLM_MODE", 3)
                effective_enable_intent = overrides.get("enable_intent_check") if overrides.get("enable_intent_check") is not None else settings.get("enable_intent_check", True)

                if effective_llm_mode == 1:
                    resolved_backend = "simple"
                elif effective_llm_mode == 2:
                    resolved_backend = "complex"
                elif effective_llm_mode == 3:
                    resolved_backend = self._classify_task(user_message) if user_message else "simple"
                else:
                    resolved_backend = self._classify_task(user_message) if user_message else "simple"

                intent_source = "regex"
                if effective_llm_mode != 1 and effective_enable_intent and resolved_backend == "complex" and user_message:
                    intent, intent_tool_hint, intent_source = await self._check_tool_intent(user_message, chat_history)
                    if intent == "chat":
                        resolved_backend = "simple"
                        print(f"[IntentCheck] Downgraded to CHAT ({intent_source}): '{user_message[:70]}'")
                    else:
                        print(f"[IntentCheck] Confirmed TOOL:{intent_tool_hint or '?'} ({intent_source}) — proceeding as complex")
        # ── Mood reactivity (script path always runs; LLM deltas ride on top) ──
        active_ws_dir = self._get_active_session_dir(overrides or {})
        if active_ws_dir:
            from app.tools.system import set_active_workspace_directory
            set_active_workspace_directory(active_ws_dir)

        mood_source = settings.get("mood_source", "script")
        mood_llm_mode = mood_source == "llm" and resolved_backend not in ("coder", "complex_coder")
        # Always strip stray tags when LLM mood is enabled, even on coder/complex
        # backends, so a misbehaving model can never leak the tag into chat.
        mood_scrubber = MoodTagScrubber() if mood_source == "llm" else None
        if user_message:
            try:
                self.memory.react_mood(user_message, scope="physical" if mood_llm_mode else "full")
            except Exception as e:
                print(f"[MoodEngine] react error: {e}")

        is_coder_mode = bool(overrides.get("coding_mode")) or resolved_backend in ("coder", "complex_coder")
        self.last_vector_timing = {"duration_ms": 0.0, "count": 0, "status": "disabled_coder_mode" if is_coder_mode else "disabled"}
        if getattr(config, "ENABLE_VECTOR_MEMORY", False) and getattr(config, "EMBEDDING_MODEL", "").strip() and user_message and not is_coder_mode and not overrides.get("is_startup_greeting"):
            _vm_t0 = time.time()
            try:
                from app.memory.vector_memory import search_relevant_memories
                _sid = (overrides or {}).get("session_id")
                rel_mem = await search_relevant_memories(user_message, top_k=5, min_similarity=0.60, exclude_session_id=_sid)
                _vm_dur = (time.time() - _vm_t0) * 1000.0
                recalled_count = len(rel_mem) if rel_mem else 0
                self.last_vector_timing = {
                    "duration_ms": _vm_dur,
                    "count": recalled_count,
                    "status": "success"
                }
                if rel_mem:
                    overrides["relevant_memories"] = rel_mem
                    print(f"[VectorMemory] Recalled {len(rel_mem)} relevant memory item(s) in {_vm_dur:.1f}ms")
                elif _vm_dur < 5.0:
                    print(f"[VectorMemory] Skipped memory lookup for conversational banter/filler or referential command ({_vm_dur:.1f}ms)")
                else:
                    print(f"[VectorMemory] Searched in {_vm_dur:.1f}ms (0 matches >= 60%)")
            except Exception as _ve:
                _vm_dur = (time.time() - _vm_t0) * 1000.0
                self.last_vector_timing = {"duration_ms": _vm_dur, "count": 0, "status": "error"}
                print(f"[VectorMemory] Search error ({_vm_dur:.1f}ms): {_ve}")

        active_input_audio = input_audio
        try:
            tb, tm = self._get_backend_and_model_for_task(resolved_backend, overrides=overrides)
            # _build_messages may block on the LLM summarizer when condensing history,
            # so run it off the event loop to keep the stream responsive.
            current_messages = await asyncio.to_thread(
                self._build_messages, user_message, chat_history, resolved_backend, overrides, tm, attachments, active_input_audio
            )
        except Exception as e:
            traceback.print_exc()
            # Preserve history even on fallback so the LLM doesn't lose conversation context!
            fallback_msgs = []
            for m in (chat_history or []):
                if m.get("role") in ("user", "assistant") and m.get("content"):
                    fallback_msgs.append({"role": m["role"], "content": m["content"]})
            fallback_msgs.append({"role": "user", "content": user_message})
            current_messages = fallback_msgs

        async with persistent_session_context() as session:
            is_coder_mode = bool(overrides.get("coding_mode")) or resolved_backend in ("coder", "complex_coder")
            max_iterations = 50 if is_coder_mode else 10
            iteration = 0
            troubleshoot_attempts = 0

            final_history = list(chat_history)
            final_history.append({
                "role": "user",
                "content": user_message,
                "attachments": _sanitize_attachments_for_history(attachments),
                "timestamp": overrides.get("timestamp") or time.time()
            })

            accumulated_response_total = []
            turn_tool_energy_drained = 0.0
            backend_used = "local"
            executed_calls = set()
            consecutive_signature = None
            consecutive_count = 0
            last_tool_result = ""
            pending_visual_tool_indices = []
            pending_visual_badge_indices = []
            
            while iteration < max_iterations:
                iteration += 1
                
                # Self-heal any invalid assistant/tool pairing from the previous iteration
                # before it reaches the API (prevents HTTP 400 code 3230).
                current_messages = self._repair_transcript(current_messages)

                effective_send_tools = overrides.get("send_tools_in_simple") if overrides.get("send_tools_in_simple") is not None else getattr(config, "SEND_TOOLS_IN_SIMPLE", False)
                use_tools = (resolved_backend != "simple") or (resolved_backend == "simple" and effective_send_tools)
                
                # Debug: Show what's being sent to LLM
                msg_roles = [m.get('role') for m in current_messages]
                print(f"[Executor] Sending {len(current_messages)} messages to LLM. Roles: {msg_roles}")
                if len(current_messages) > 0:
                    last_msg = current_messages[-1]
                    print(f"[Executor] Last message: role={last_msg.get('role')}, content preview={str(last_msg.get('content', ''))[:150]}...")
                
                # Log total prompt size for debugging
                total_chars = sum(len(str(m.get("content") or "")) for m in current_messages)
                est_tokens = int(total_chars / 3.5)
                print(f"[LLM Prompt] Sending {len(current_messages)} messages | {total_chars} chars | ~{est_tokens} tokens")

                stream = self._query_llm_stream(session, current_messages, user_message=user_message, use_tools=use_tools, resolved_backend=resolved_backend, intent_tool_hint=intent_tool_hint, intent_source=intent_source, overrides=overrides)
                
                tool_calls_to_execute = []
                accumulated_response = ""
                first_token = True
                
                iteration_tokens = []
                parsed_stream = self._parse_native_stream(stream)
                if mood_scrubber is not None:
                    parsed_stream = mood_scrubber.wrap(parsed_stream)
                async for event_type, value, label in parsed_stream:
                    backend_used = label
                    if event_type == "token":
                        if first_token:
                            print(f"\n[LLM Response (Iteration {iteration}, Backend: {backend_used})]: ", end="", flush=True)
                            first_token = False
                        accumulated_response += value
                        print(value, end="", flush=True)
                        iteration_tokens.append((value, label))
                    elif event_type == "tool_calls":
                        tool_calls_to_execute = value
                
                if not first_token:
                    print()

                # Fallback: Extract inline simulated tool calls (e.g. <tool_call>...</tool_call>, ```tool_args, etc.)
                if not tool_calls_to_execute and accumulated_response:
                    extracted_calls, cleaned_narration = self._extract_inline_tool_calls(accumulated_response)
                    if extracted_calls:
                        print(f"[InlineToolParser] Successfully extracted {len(extracted_calls)} inline tool call(s) from text: {[c['function']['name'] for c in extracted_calls]}")
                        tool_calls_to_execute = extracted_calls
                        accumulated_response = cleaned_narration
                        iteration_tokens = [(cleaned_narration, backend_used)] if cleaned_narration else []

                full_llm_response = accumulated_response.strip()
                log_triggered_backend_tags(full_llm_response)

                # Check for audio unsupported error to perform automatic Whisper fallback
                if active_input_audio and active_input_audio.get("raw_bytes") and iteration == 1:
                    err_indicator = any("error from brain server:" in str(_v).lower() for _v, _ in iteration_tokens)
                    err_str = " ".join(str(_v) for _v, _ in iteration_tokens).lower()
                    if err_indicator and any(k in err_str for k in ("400", "input_audio", "audio", "unsupported", "unknown field", "unrecognized")):
                        print(f"[DirectAudio] Current model rejected direct audio ({err_str[:120]}). Triggering Whisper fallback...")
                        yield "thinking", "Current model doesn't support direct speech input. Transcribing with Whisper...", backend_used
                        try:
                            from app.voice.stt import transcribe_audio_file
                            stt_res = await transcribe_audio_file(active_input_audio["raw_bytes"])
                            fallback_text = (stt_res.get("text") if isinstance(stt_res, dict) else str(stt_res or "")).strip()
                            print(f"[DirectAudio] Whisper fallback transcript: '{fallback_text}'")
                            if fallback_text:
                                user_message = fallback_text
                                active_input_audio = None
                                yield "voice_transcript_resolved", fallback_text, backend_used
                                if final_history and final_history[-1].get("role") == "user":
                                    final_history[-1]["content"] = fallback_text
                                current_messages = await asyncio.to_thread(
                                    self._build_messages, user_message, chat_history, resolved_backend, overrides, tm, attachments, None
                                )
                                iteration = 0
                                continue
                        except Exception as fallback_err:
                            print(f"[DirectAudio] Whisper fallback failed: {fallback_err}")

                # If direct speech input was used, extract [Transcribed: "..."] and clean response
                if active_input_audio:
                    m = re.search(r'\[Transcribed:\s*["\']?(.*?)["\']?\]\s*', accumulated_response, flags=re.IGNORECASE)
                    if m:
                        resolved_transcript = m.group(1).strip()
                        print(f"[DirectAudio] Resolved speech transcript from LLM: '{resolved_transcript}'")
                        yield "voice_transcript_resolved", resolved_transcript, backend_used
                        if final_history and final_history[-1].get("role") == "user":
                            final_history[-1]["content"] = resolved_transcript

                        # Clean exact character span from streamed tokens
                        m_start, m_end = m.start(), m.end()
                        cleaned_tokens = []
                        curr_idx = 0
                        for _val, _label in iteration_tokens:
                            token_len = len(_val)
                            token_end = curr_idx + token_len
                            if token_end <= m_start or curr_idx >= m_end:
                                cleaned_tokens.append((_val, _label))
                            else:
                                # Overlap with the tag to strip
                                keep_parts = []
                                if curr_idx < m_start:
                                    keep_parts.append(_val[:m_start - curr_idx])
                                if token_end > m_end:
                                    keep_parts.append(_val[m_end - curr_idx:])
                                keep_str = "".join(keep_parts)
                                if keep_str:
                                    cleaned_tokens.append((keep_str, _label))
                            curr_idx = token_end
                        iteration_tokens = cleaned_tokens

                        # Clean accumulated_response for history saving
                        accumulated_response = accumulated_response[:m_start] + accumulated_response[m_end:]
                        full_llm_response = accumulated_response.strip()

                # Emit the buffered narration, tagged so consumers can separate
                # intermediate thinking text (before tool calls) from the final reply.
                if iteration_tokens:
                    emit_type = "thinking" if tool_calls_to_execute else "token"
                    for _val, _label in iteration_tokens:
                        yield emit_type, _val, _label

                if tool_calls_to_execute:
                    # Pre-filter already-executed duplicate calls and normalize missing
                    # tool_call ids BEFORE appending the assistant message, so every
                    # assistant tool_call has exactly one matching 'tool' response and
                    # the transcript stays valid for the API (prevents code 3230).
                    pending_calls = []
                    for tool_call in tool_calls_to_execute:
                        tool_name = self._normalize_tool_name(tool_call["function"]["name"])
                        tool_call["function"]["name"] = tool_name
                        try:
                            tool_args = json.loads(tool_call["function"]["arguments"])
                            if isinstance(tool_args, dict) and tool_args.get("type") == "function" and "function" in tool_args:
                                inner = tool_args.get("parameters") or tool_args.get("arguments") or {}
                                if isinstance(inner, dict) and inner:
                                    tool_args = inner
                        except Exception:
                            tool_args = {}

                        tool_args_str = tool_call["function"]["arguments"]
                        call_signature = (tool_name, tool_args_str)
                        if is_coder_mode:
                            # Coder mode: never block duplicate calls — frontier models
                            # legitimately re-run commands (e.g. re-verify a build after
                            # an edit). Track consecutive identical calls only to emit a
                            # transparent soft nudge (see reminder below) if the model
                            # looks stuck repeating the exact same call.
                            if call_signature == consecutive_signature:
                                consecutive_count += 1
                            else:
                                consecutive_signature = call_signature
                                consecutive_count = 1
                        else:
                            if call_signature in executed_calls:
                                print(f"[Executor] Loop detected for tool '{tool_name}'. Skipping duplicate call.")
                                continue
                            executed_calls.add(call_signature)

                        if not tool_call.get("id"):
                            tool_call["id"] = f"call_{uuid.uuid4().hex[:8]}"
                        pending_calls.append((tool_call, tool_name, tool_args))

                    if pending_calls:
                        assistant_content = accumulated_response.strip()
                        if not assistant_content or self._is_pure_filler(assistant_content):
                            _call_name = pending_calls[0][1]
                            _call_args = pending_calls[0][2] or {}
                            _desc = _call_args.get("description")
                            if _desc:
                                assistant_content = f"Running '{_call_name}': {_desc}"
                            else:
                                _target = (_call_args.get("file_path") or _call_args.get("path") or _call_args.get("command") or _call_args.get("url") or _call_args.get("query") or "")
                                if _target and len(str(_target)) > 60:
                                    _target = "..." + str(_target)[-57:]
                                assistant_content = f"Running '{_call_name}'" + (f" on `{_target}`" if _target else "") + "..."
                        current_messages.append({
                            "role": "assistant",
                            "content": assistant_content,
                            "tool_calls": [pc[0] for pc in pending_calls]
                        })
                    elif accumulated_response.strip():
                        current_messages.append({
                            "role": "assistant",
                            "content": accumulated_response.strip()
                        })

                    if not pending_calls and tool_calls_to_execute and not is_coder_mode:
                        # Every tool call this iteration was filtered as a duplicate. Tell the
                        # model its calls were already executed (results are in the transcript)
                        # so it doesn't re-emit the same call silently until the iteration cap.
                        current_messages.append({
                            "role": "user",
                            "content": (
                                "[SYSTEM] The tool call(s) you just requested have already been executed earlier "
                                "this turn with identical arguments; their results are in the transcript above. "
                                "Do NOT re-issue identical tool calls. Read the earlier result and either take a "
                                "NEW distinct step toward the user's goal, or write your final summary now."
                            )
                        })

                    for tool_call, tool_name, tool_args in pending_calls:
                        print(f"Agent triggered tool '{tool_name}' with args {tool_args} (iteration {iteration})")
                        yield "tool_start", {"name": tool_name, "args": tool_args}, backend_used

                        # ── Voice-mode safety: require confirmation for destructive/write tools ──
                        # When the turn came from STT (listening mode is on), any tool that modifies
                        # files, runs code, or executes terminal commands must be explicitly approved.
                        _VOICE_CONFIRM_TOOLS = {
                            "delete_file", "write_file_content", "run_terminal_command",
                            "run_python_script", "create_file", "rename_file", "move_file",
                            "write_to_file", "patch_file", "overwrite_file",
                        }
                        from_voice = bool(overrides.get("from_voice")) if overrides else False
                        if from_voice and tool_name in _VOICE_CONFIRM_TOOLS:
                            voice_confirm_target = f"[Voice Safety] Run '{tool_name}' via voice command?"
                            print(f"[VoiceSafety] Requiring confirmation for voice-triggered '{tool_name}'")
                            confirmed_status = yield "tool_confirm_required", voice_confirm_target, backend_used
                            if not confirmed_status:
                                tool_result = f"Action '{tool_name}' was cancelled — voice safety confirmation declined."
                                last_tool_result = tool_result
                                current_messages.append({
                                    "role": "tool",
                                    "tool_call_id": tool_call.get("id", ""),
                                    "name": tool_name,
                                    "content": tool_result,
                                })
                                continue

                        # Coder/Advanced modes run autonomously (no confirmation prompts);
                        # only basic/assistant mode falls back to the confirmation flow.
                        tool_mode = "coder" if is_coder_mode else ("advanced" if effective_tool_mode == "advanced" else "assistant")
                        tool_workspace = self._get_active_session_dir(tool_args)
                        tool_result = await self._run_tool_async(tool_name, tool_args, mode=tool_mode, workspace_root=tool_workspace)

                        # ── Confirmation flow ─────────────────────────────────────────────
                        # A sensitive tool returned CONFIRM_REQUIRED. Surface the dialog to
                        # the user (main.py consumes this event) and re-dispatch with a
                        # backend-issued grant on approval.
                        if isinstance(tool_result, str) and tool_result.startswith("CONFIRM_REQUIRED:"):
                            confirm_target = _extract_confirmation_target(tool_result)
                            print(f"[Agent] Tool '{tool_name}' returned CONFIRM_REQUIRED for: {confirm_target}")
                            confirmed_status = yield "tool_confirm_required", confirm_target, backend_used
                            if confirmed_status:
                                from app.tools.safety import issue_confirmation_grant, strip_internal_auth_fields
                                confirmed_args = strip_internal_auth_fields(dict(tool_args or {}))
                                from app.tools.safety import describe_tool_target
                                grant_id = issue_confirmation_grant(
                                    tool_name,
                                    confirmed_args,
                                    target=confirm_target or describe_tool_target(tool_name, confirmed_args),
                                )
                                confirmed_args["confirmation_grant_id"] = grant_id
                                print(f"[Agent] Re-running '{tool_name}' with backend confirmation grant for: {confirm_target}")
                                tool_result = await self._run_tool_async(tool_name, confirmed_args, mode=tool_mode, workspace_root=tool_workspace)
                            else:
                                print(f"[Agent] Tool '{tool_name}' execution cancelled by user.")
                                tool_result = "Action cancelled by security confirmation check."
                        last_tool_result = tool_result

                        tool_failed = False
                        if isinstance(tool_result, str):
                            lower_res = tool_result.lower().strip()
                            if (
                                lower_res.startswith("error:") or
                                lower_res.startswith("error ") or
                                lower_res.startswith("failed:") or
                                lower_res.startswith("failed to ") or
                                lower_res.startswith("action failed") or
                                lower_res.startswith("access denied") or
                                "traceback (most recent call last)" in lower_res or
                                bool(re.search(r'\b(syntaxerror|nameerror|typeerror|valueerror|indexerror|keyerror|filenotfounderror|permissionerror|runtimeerror|zerodivisionerror):\b', lower_res)) or
                                bool(re.search(r'^[a-zA-Z0-9_ ]+error:\s', lower_res))
                            ):
                                tool_failed = True

                        # Her own work affects her mood — done well is satisfying, failing stresses.
                        # Energy drain is capped at 2.0 pts per turn so multi-tool agent loops don't instantly exhaust her.
                        can_drain_energy = turn_tool_energy_drained < 2.0
                        try:
                            self.memory.react_mood_outcome(tool_name, success=not tool_failed, drain_energy=can_drain_energy)
                            if can_drain_energy:
                                turn_tool_energy_drained += 1.2 if tool_failed else 0.6
                        except Exception:
                            pass

                        is_multimodal_payload = False
                        multimodal_data_url = None
                        multimodal_prompt = ""
                        multimodal_summary = ""

                        if isinstance(tool_result, str) and '"__multimodal_tool_result__": true' in tool_result.lower():
                            try:
                                parsed_payload = json.loads(tool_result)
                                if parsed_payload.get("__multimodal_tool_result__"):
                                    is_multimodal_payload = True
                                    multimodal_data_url = parsed_payload.get("data_url")
                                    multimodal_prompt = parsed_payload.get("prompt", "")
                                    multimodal_summary = parsed_payload.get("summary", "Image acquired for direct inspection.")
                                    tool_result = multimodal_summary
                            except Exception:
                                pass

                        output_snippet = str(tool_result).strip()
                        if len(output_snippet) > 15000:
                            output_snippet = output_snippet[:15000] + "\n... [truncated for display]"

                        try:
                            args_json = json.dumps(tool_args, indent=2, ensure_ascii=False) if tool_args else ""
                        except Exception:
                            args_json = str(tool_args)
                        safe_args_json = args_json.replace("```", "'''")
                        args_block = f"\n```tool_args\n{safe_args_json}\n```" if safe_args_json else ""

                        tool_target = tool_args.get("file_path") or tool_args.get("path") or tool_args.get("command") or tool_args.get("url") or ""
                        if tool_target and len(str(tool_target)) > 60:
                            tool_target = "..." + str(tool_target)[-57:]
                        target_info = f" (`{tool_target}`)" if tool_target else ""
                        status_symbol = "❌ Error" if tool_failed else ("✓ Done (Native Vision)" if is_multimodal_payload else "✓ Done")

                        safe_output_snippet = output_snippet.replace("```", "'''")
                        tool_badge = f"🛠️ **[{tool_name}{target_info} — {status_symbol}]**{args_block}\n```tool_output\n{safe_output_snippet}\n```"
                        accumulated_response_total.append(tool_badge)

                        tc_id = tool_call["id"]
                        current_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "name": tool_name,
                            "content": str(tool_result)
                        })

                        if is_multimodal_payload:
                            pending_visual_tool_indices.append(len(current_messages) - 1)
                            pending_visual_badge_indices.append(len(accumulated_response_total) - 1)

                        if is_multimodal_payload and multimodal_data_url:
                            current_messages.append({
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": (
                                            f"[Visual Inspection Context for {tool_name}]\n"
                                            f"{multimodal_prompt}\n\n"
                                            "Please inspect the attached image directly using your native vision capabilities.\n"
                                            "IMPORTANT SELF-AWARENESS: Any 3D anime character/figure floating on Master's desktop screen is YOU (Yuki herself). Do NOT describe, identify, or mention yourself in your response or visual breakdown unless Master explicitly asked about your avatar.\n"
                                            "Structure your response in two parts:\n"
                                            "1. Conversational Reply: Your lively, natural, spoken answer first, answering Master's request directly.\n"
                                            "2. Visual Transcript (at the end of your response, separated by a blank line):\n"
                                            "[Visual Transcript]\n"
                                            "• Characters & People: <Identified anime, game, VTuber, or real persons with franchise title, or 'None'>\n"
                                            "• Visible Apps & Games: <Open applications, game titles, active browser windows, IDE, terminal>\n"
                                            "• Visible Text & Subtitles: <Key titles, code snippets, error traces, dialogue, or subtitles verbatim>\n"
                                            "• Scene & Layout: <Desktop layout, active focused area, media playing, or setting>"
                                        )
                                    },
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": multimodal_data_url}
                                    }
                                ]
                            })
                        yield "tool_result", tool_result, backend_used

                    # Emit a crash-recovery checkpoint: the running display transcript
                    # (prior history + user msg + assistant text/tool badges so far).
                    _checkpoint_history = list(final_history) + [
                        {"role": "assistant", "content": "\n".join(accumulated_response_total)}
                    ]
                    yield "checkpoint", _checkpoint_history, backend_used

                    # ── Post-tool guidance injection ─────────────────────────────────────────
                    # Inject a structured guidance message after every tool result so the
                    # model knows whether to stop, summarize, or chain the next step.
                    #
                    # Tool categories:
                    #  • INFO  — web_search, read_file_content
                    #            Hard-stop: content is for summarization, never chain further.
                    #  • DATA  — search_files, list_directory, get_system_stats
                    #            Conditional: if original request needs another step (e.g.
                    #            "find and open"), allow one more tool call; otherwise stop.
                    #  • MEMORY — update_user_fact / jarvis_remember_user_fact
                    #            Hard-stop: confirm what was saved and stop.
                    #  • ACTION — all other tools (launch, volume, power, terminal, etc.)
                    #            Hard-stop: confirm the action briefly and stop.
                    # ─────────────────────────────────────────────────────────────────────────
                    if not tool_failed:
                        _INFO_TOOLS   = {"web_search", "read_file_content"}
                        _DATA_TOOLS   = {"search_files", "list_directory", "get_system_stats", "jarvis_query_file_db", "jarvis_web_search", "jarvis_web_scrape", "jarvis_system_diagnostics", "jarvis_network_status", "jarvis_list_dir_tree", "jarvis_git_status"}
                        _MEMORY_TOOLS = {"update_user_fact", "jarvis_remember_user_fact"}

                        _orig = user_message.strip()
                        _iter_note = f"(tool call {iteration} of {max_iterations} allowed this turn)"

                        is_advanced_mode = effective_tool_mode == "advanced"
                        is_coder_mode = bool(overrides.get("coding_mode")) or resolved_backend in ("coder", "complex_coder")

                        if is_coder_mode or is_advanced_mode:
                            mode_name = "Autonomous Coder Mode" if is_coder_mode else "Autonomous Jarvis Mode"
                            # Keep backend active & encourage continuous tool execution until goal is complete!
                            if is_coder_mode:
                                resolved_backend = "coder"
                            
                            loop_nudge = ""
                            if consecutive_count >= 5:
                                loop_nudge = (
                                    " ⚠️ NOTE: You have executed the exact same tool call 5 or more times in a row. "
                                    "If you are re-verifying, that's fine — but if the result has not "
                                    "changed, stop repeating this identical call, read the existing output above, and either "
                                    "take a NEW distinct step or write your final response."
                                )
                            reminder = (
                                f"[SYSTEM] {_iter_note} Tool '{tool_name}' completed with result above. "
                                f"User's overall goal: \"{_orig}\". "
                                f"You are in {mode_name}. If additional steps, commands, or tool calls are needed to fully achieve the user's goal, execute the next tool call immediately. "
                                "Only write your final natural language response when the entire task is fully complete."
                                f"{loop_nudge}"
                            )
                        elif tool_name in _INFO_TOOLS:
                            # Hard-stop: full content returned, model must summarize now without tools.
                            resolved_backend = "simple"
                            reminder = (
                                f"[SYSTEM] {_iter_note} Tool '{tool_name}' returned results above. "
                                f"The user's original request was: \"{_orig}\". "
                                "Write a spoken, natural language answer using these results — under 3 sentences. "
                                "Respond now."
                            )

                        elif tool_name in _DATA_TOOLS:
                            # Conditional: allow one more tool call only if original request needs it.
                            reminder = (
                                f"[SYSTEM] {_iter_note} Tool '{tool_name}' returned results above. "
                                f"The user's original request was: \"{_orig}\". "
                                "If this result fully satisfies the request, respond to the user now in 1-2 sentences. "
                                "If the original request explicitly requires another action on this result "
                                "(e.g. the user asked to open a found file, or do something with the data), "
                                "call exactly one more appropriate tool and then respond. "
                                "Do NOT call update_user_fact, jarvis_remember_user_fact, or web_search as a follow-up."
                            )

                        elif tool_name in _MEMORY_TOOLS:
                            # Hard-stop: memory saved silently in background, disable tools for final text turn.
                            resolved_backend = "simple"
                            reminder = (
                                f"[SYSTEM] {_iter_note} Fact saved silently in background. "
                                f"The user's original message was: \"{_orig}\". "
                                "CRITICAL INSTRUCTION: Do NOT mention saving, remembering, profile, memory, or database updates. "
                                "Act as if no memory operation took place and respond directly, naturally, and warmly to what the user said."
                            )

                        else:
                            # Action/terminal tool: confirm the action and stop.
                            resolved_backend = "simple"
                            reminder = (
                                f"[SYSTEM] {_iter_note} Tool '{tool_name}' completed. "
                                f"The user's original request was: \"{_orig}\". "
                                "Confirm the action to the user in 1 short sentence and stop."
                            )

                        current_messages.append({
                            "role": "user",
                            "content": reminder
                        })
                    
                    # Debug: Show what's being added to context
                    print(f"[Executor] Tool '{tool_name}' result added to context. Messages count: {len(current_messages)}")
                    print(f"[Executor] Tool result preview: {str(tool_result)[:200]}...")
                    
                    if tool_failed and troubleshoot_attempts < 4:
                        troubleshoot_attempts += 1
                        if tool_name in ("run_python_script", "jarvis_run_python"):
                            system_message_content = (
                                f"[SYSTEM] Tool '{tool_name}' failed with:\n{tool_result}\n\n"
                                f"DIAGNOSTIC & SELF-CORRECTION PROTOCOL (Follow strictly):\n"
                                "1. Inspect the traceback and the exact failing line. Do NOT repeat the exact same call.\n"
                                "2. If an AttributeError, TypeError, or NoSuchMethod occurred: DO NOT guess alternative method names, invent APIs, or rewrite complex low-level architectures from scratch. "
                                "Instead, write a quick 1-2 line probe to inspect the object's real runtime members: `print([m for m in dir(target_obj) if not m.startswith('_')])` or `print(type(target_obj))`.\n"
                                "3. If an ImportError occurred: check if the package is installed or can be imported under an alternative module name.\n"
                                "4. If a subprocess or command failed: inspect stderr and return code rather than ignoring output.\n"
                                "5. Apply the discovered fix cleanly."
                            )
                        else:
                            system_message_content = (
                                f"[SYSTEM] Tool '{tool_name}' failed with:\n{tool_result}\n\n"
                                f"The user's original request was: \"{user_message.strip()}\". "
                                "Carefully analyze the failure reason above. Adjust the arguments, fulfill prerequisites, or try a valid alternative tool. "
                                "Do NOT retry the exact same tool call with identical arguments."
                            )
                        current_messages.append({
                            "role": "user",
                            "content": system_message_content
                        })
                else:
                    if accumulated_response.strip():
                        accumulated_response_total.append(accumulated_response.strip())
                    
                    llm_handled_energy = False
                    if mood_scrubber is not None and mood_llm_mode:
                        llm_handled_energy = bool(self._finalize_llm_mood(mood_scrubber, user_message))
                    # React to Yuki's own words — her speech also affects her mood
                    assistant_speech = accumulated_response.strip()
                    if pending_visual_tool_indices and assistant_speech:
                        transcript_match = re.search(r'(?i)\[(?:visual\s+transcript|screen\s+transcript|visual\s+breakdown)\][\s\S]*', assistant_speech)
                        extracted_transcript = transcript_match.group(0).strip() if transcript_match else assistant_speech.strip()
                        for _v_idx in pending_visual_tool_indices:
                            if 0 <= _v_idx < len(current_messages):
                                _curr_c = str(current_messages[_v_idx].get("content", ""))
                                if "[Visual Transcript]" not in _curr_c and "[visual transcript]" not in _curr_c.lower():
                                    current_messages[_v_idx]["content"] = f"{_curr_c}\n\n{extracted_transcript}"
                        if pending_visual_badge_indices:
                            for _b_idx in pending_visual_badge_indices:
                                if 0 <= _b_idx < len(accumulated_response_total):
                                    orig_badge = accumulated_response_total[_b_idx]
                                    accumulated_response_total[_b_idx] = re.sub(
                                        r'```tool_output\n[\s\S]*?```',
                                        f'```tool_output\n{extracted_transcript}\n```',
                                        orig_badge
                                    )
                            pending_visual_badge_indices.clear()
                        pending_visual_tool_indices.clear()

                    if assistant_speech:
                        try:
                            react_scope = "physical" if mood_llm_mode else "full"
                            self.memory.react_mood_self(assistant_speech, scope=react_scope)
                        except Exception:
                            pass
                    # mood_effecter — per-turn couplings of her own state
                    try:
                        self.memory.apply_turn_effects(llm_handled_energy=llm_handled_energy)
                    except Exception:
                        pass
                    # Relationship Engine turn evolution
                    try:
                        from app.memory.db import process_relationship_turn_evolution
                        preset = self.memory.profile.get("settings", {}).get("persona_preset")
                        process_relationship_turn_evolution(user_message, assistant_speech, persona_preset=preset)
                    except Exception as e:
                        print(f"[RelationshipEngine] Evolution error: {e}")
                    assistant_final_speech = "\n".join(accumulated_response_total)
                    final_history.append({
                        "role": "assistant",
                        "content": assistant_final_speech,
                        "timestamp": time.time(),
                        "backend": backend_used
                    })
                    if getattr(config, "ENABLE_VECTOR_MEMORY", False) and getattr(config, "EMBEDDING_MODEL", "").strip() and user_message and not is_coder_mode:
                        try:
                            from app.memory.vector_memory import extract_and_index_turn
                            _sid = (overrides or {}).get("session_id")
                            asyncio.create_task(extract_and_index_turn(user_message, assistant_final_speech, session_id=_sid))
                        except Exception:
                            pass
                    yield "final_history", final_history, backend_used
                    return
            
            # ── Iteration cap reached with tool calls still pending ──────────────────
            # Force one final tool-free turn so the user gets a real closing summary
            # instead of a badge-only message that forces them to type "continue".
            current_messages.append({
                "role": "user",
                "content": (
                    "[SYSTEM] Iteration limit reached. Do NOT call more tools. "
                    "Write your final summary of everything completed, the current state now, and what's left to do."
                )
            })
            wrap_stream = self._query_llm_stream(
                session, current_messages, user_message=user_message, use_tools=False,
                resolved_backend="simple", intent_tool_hint="", intent_source=intent_source, overrides=overrides
            )
            wrap_response = ""
            wrap_parsed = self._parse_native_stream(wrap_stream)
            if mood_scrubber is not None:
                wrap_parsed = mood_scrubber.wrap(wrap_parsed)
            async for event_type, value, label in wrap_parsed:
                if event_type == "token":
                    wrap_response += value
                    yield "token", value, label
            llm_handled_energy = False
            if mood_scrubber is not None and mood_llm_mode:
                llm_handled_energy = bool(self._finalize_llm_mood(mood_scrubber, user_message))
            if wrap_response.strip():
                accumulated_response_total.append(wrap_response.strip())
            wrap_speech = wrap_response.strip()
            if pending_visual_tool_indices and wrap_speech:
                transcript_match = re.search(r'(?i)\[(?:visual\s+transcript|screen\s+transcript|visual\s+breakdown)\][\s\S]*', wrap_speech)
                extracted_transcript = transcript_match.group(0).strip() if transcript_match else wrap_speech.strip()
                for _v_idx in pending_visual_tool_indices:
                    if 0 <= _v_idx < len(current_messages):
                        _curr_c = str(current_messages[_v_idx].get("content", ""))
                        if "[Visual Transcript]" not in _curr_c and "[visual transcript]" not in _curr_c.lower():
                            current_messages[_v_idx]["content"] = f"{_curr_c}\n\n{extracted_transcript}"
                if pending_visual_badge_indices:
                    for _b_idx in pending_visual_badge_indices:
                        if 0 <= _b_idx < len(accumulated_response_total):
                            orig_badge = accumulated_response_total[_b_idx]
                            accumulated_response_total[_b_idx] = re.sub(
                                r'```tool_output\n[\s\S]*?```',
                                f'```tool_output\n{extracted_transcript}\n```',
                                orig_badge
                            )
                    pending_visual_badge_indices.clear()
                pending_visual_tool_indices.clear()

            if wrap_speech:
                try:
                    react_scope = "physical" if mood_llm_mode else "full"
                    self.memory.react_mood_self(wrap_speech, scope=react_scope)
                except Exception:
                    pass
            # mood_effecter — per-turn couplings of her own state
            try:
                self.memory.apply_turn_effects(llm_handled_energy=llm_handled_energy)
            except Exception:
                pass
            # Relationship Engine turn evolution
            try:
                from app.memory.db import process_relationship_turn_evolution
                preset = self.memory.profile.get("settings", {}).get("persona_preset")
                process_relationship_turn_evolution(user_message, wrap_speech, persona_preset=preset)
            except Exception as e:
                print(f"[RelationshipEngine] Evolution error: {e}")
            assistant_final_speech = "\n".join(accumulated_response_total)
            final_history.append({
                "role": "assistant",
                "content": assistant_final_speech,
                "timestamp": time.time(),
                "backend": backend_used
            })
            if getattr(config, "ENABLE_VECTOR_MEMORY", False) and getattr(config, "EMBEDDING_MODEL", "").strip() and user_message and not is_coder_mode:
                try:
                    from app.memory.vector_memory import extract_and_index_turn
                    _sid = (overrides or {}).get("session_id")
                    asyncio.create_task(extract_and_index_turn(user_message, assistant_final_speech, session_id=_sid))
                except Exception:
                    pass
            yield "final_history", final_history, backend_used

