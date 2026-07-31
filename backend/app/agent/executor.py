import json
import re
import requests
import aiohttp
import asyncio
import concurrent.futures
import inspect
import os
import uuid
from typing import Dict, Any, List, Tuple, Optional
from app import config
from app.agent.prompts import get_system_prompt, get_simple_system_prompt, get_advanced_jarvis_system_prompt, get_coding_agent_system_prompt
from app.agent.llm_backend import get_backend, reset_backend
from app.memory.local_mem import MemoryManager
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



def is_vision_model(model_name: str) -> bool:
    """Helper function to dynamically detect if a resolved model supports native vision API payloads."""
    if not model_name:
        return False
    name_low = str(model_name).lower().strip()
    vision_keywords = ("gemini", "gpt-4o", "gpt-4-turbo", "claude-3", "qwen-vl", "llava", "vision")
    return any(kw in name_low for kw in vision_keywords)


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
        
        async def _async_web_search(**kwargs):
            from app.tools.web import web_search
            return await web_search(
                query=kwargs.get("query") or kwargs.get("search") or kwargs.get("text") or (list(kwargs.values())[0] if kwargs else "")
            )
        
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
            jarvis_window_control, jarvis_run_terminal
        )
        from app.tools.system import send_process_stdin, find_files_by_glob
        from app.tools.safety import authorize_tool_call as _authorize_tool_call_fn
        self._authorize_tool_call = _authorize_tool_call_fn
        self._fallback_call_counter = 0

        # Map tool names to python functions
        self.tools = {
            "get_system_stats": get_system_stats,
            "get_current_datetime": get_current_datetime,
            "launch_app": lambda **kwargs: launch_app(
                kwargs.get("app_name") or kwargs.get("name") or kwargs.get("app") or (list(kwargs.values())[0] if kwargs else ""),
                args=kwargs.get("args"),
                run_as_admin=bool(kwargs.get("run_as_admin", False))
            ),
            "set_system_volume": lambda **kwargs: set_system_volume(
                int(kwargs.get("volume_level") or kwargs.get("volume") or kwargs.get("level") or (list(kwargs.values())[0] if kwargs else 0))
            ),
            "update_user_fact": lambda **kwargs: self._execute_update_user_fact(**kwargs),

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
            "manage_time": lambda **kwargs: self._execute_manage_time(**kwargs),
            "web_search": _async_web_search,

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
                args=kwargs.get("args")
            ),
            "jarvis_open_or_play_file": lambda **kwargs: open_or_play_file(
                kwargs.get("file_path_or_query") or kwargs.get("query") or ""
            ),
            "jarvis_window_control": lambda **kwargs: jarvis_window_control(
                kwargs.get("action", "list"),
                kwargs.get("title_query")
            ),
            "jarvis_system_volume": lambda **kwargs: set_system_volume(
                int(kwargs.get("volume_level") or 0)
            ),
            "jarvis_system_power": lambda **kwargs: system_power_control(
                kwargs.get("action") or ""
            ),
            "jarvis_manage_time": lambda **kwargs: self._execute_manage_time(**kwargs),
            "jarvis_remember_user_fact": lambda **kwargs: self._execute_update_user_fact(**kwargs),
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
            "find_files_by_glob": lambda **kwargs: find_files_by_glob(
                pattern=kwargs.get("pattern") or "*",
                search_dir=kwargs.get("search_dir") or kwargs.get("root_dir") or self._get_active_session_dir(kwargs)
            ),
            "jarvis_run_python": lambda **kwargs: run_python_script(
                kwargs.get("code") or "",
                cwd=self._get_active_session_dir(kwargs)
            ),
            "jarvis_keyboard_input": lambda **kwargs: keyboard_mouse_input(
                kwargs.get("action") or "",
                text=kwargs.get("text"),
                keys=kwargs.get("keys")
            ),
            "jarvis_keyboard_mouse_input": lambda **kwargs: keyboard_mouse_input(
                kwargs.get("action") or "",
                text=kwargs.get("text"),
                keys=kwargs.get("keys")
            ),
            "jarvis_media_playback_control": lambda **kwargs: media_playback_control(
                kwargs.get("action") or "",
                app_name=kwargs.get("app_name"),
                all=bool(kwargs.get("all", False))
            ),
        }
        from app.mcp_client import StdioMCPToolBridge
        self.mcp_tools = StdioMCPToolBridge(get_tools_definition, get_filtered_tools)

    # ------------------------------------------------------------------ #
    #  Tool dispatcher helper                                              #
    # ------------------------------------------------------------------ #

    async def _run_tool_async(self, tool_name: str, tool_args: Dict[str, Any]) -> str:
        """
        Executes a registered tool by name with the given args.
        Prefers the stdio MCP tool boundary and falls back to the legacy
        in-process dispatcher when configured or when MCP startup fails.
        """
        raw_args = dict(tool_args or {})

        # Gate before dispatching to either MCP or the legacy local dispatcher.
        # Do not consume a valid grant here while MCP is enabled: the stdio MCP
        # subprocess is the final execution boundary and consumes the grant.
        preflight = self._authorize_tool_call(tool_name, raw_args, consume_grant=False)
        if not preflight.allowed:
            return preflight.message

        mcp_args = dict(preflight.arguments or {})
        grant_id = raw_args.get("confirmation_grant_id") or raw_args.get("_host_confirmation_grant_id")
        if grant_id:
            mcp_args["confirmation_grant_id"] = grant_id

        mcp_result = await self.mcp_tools.call_tool(tool_name, mcp_args)
        if mcp_result.handled:
            return mcp_result.result

        if tool_name not in self.tools:
            if self.mcp_tools.last_error:
                return f"Error: Tool '{tool_name}' is not registered. MCP status: {self.mcp_tools.last_error}"
            return f"Error: Tool '{tool_name}' is not registered."
        local_decision = self._authorize_tool_call(tool_name, raw_args, consume_grant=True)
        if not local_decision.allowed:
            return local_decision.message

        execution_args = local_decision.arguments or {}
        tool_func = self.tools[tool_name]
        try:
            if inspect.iscoroutinefunction(tool_func):
                return await (tool_func(**execution_args) if execution_args else tool_func())
            else:
                return await (asyncio.to_thread(tool_func, **execution_args) if execution_args else asyncio.to_thread(tool_func))
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

    def _execute_manage_time(self, **kwargs) -> str:
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
        return f"Unknown action '{action}' for manage_time."

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
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload) as resp:
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

    def _process_mood_drift(self, user_message: str):
        if not user_message:
            return
            
        msg_lower = user_message.lower()
        mood = self.memory.get_mood_spectrum()
        updates = {}
        
        # 1. Intimacy / Horniness check
        intimate_keywords = [
            "kiss", "kissing", "kisses", "cuddle", "cuddling", "embrace",
            "intimate", "make out", "holding hands", "touch me", "lips",
            "hug me tight", "snuggle", "sexy", "flirt", "muah", "xoxo"
        ]
        
        if any(kw in msg_lower for kw in intimate_keywords):
            updates["horniness"] = min(100, mood.get("horniness", 50) + 15)
            updates["affection"] = min(100, mood.get("affection", 70) + 5)
            updates["happiness"] = min(100, mood.get("happiness", 75) + 5)
            print(f"[MoodEngine] Intimacy detected! Horniness increased to {updates['horniness']}")
        else:
            curr_h = mood.get("horniness", 50)
            if curr_h > 50:
                updates["horniness"] = max(50, curr_h - 5)
            elif curr_h < 50:
                updates["horniness"] = min(50, curr_h + 2)

        # 2. Hunger ticks up per turn (+1 up to 100)
        food_keywords = ["eat", "food", "dinner", "lunch", "snack", "pizza", "burger", "cookie", "breakfast", "ramen"]
        if any(kw in msg_lower for kw in food_keywords):
            updates["hunger"] = max(0, mood.get("hunger", 30) - 25)
            updates["happiness"] = min(100, mood.get("happiness", 75) + 5)
        else:
            updates["hunger"] = min(100, mood.get("hunger", 30) + 1)
            
        # 3. Energy & Happiness smooth decay towards baselines
        curr_energy = mood.get("energy", 65)
        if curr_energy > 65:
            updates["energy"] = curr_energy - 1
            
        if updates:
            self.memory.update_mood_spectrum(updates)

    def _build_messages(
        self,
        user_message: str,
        chat_history: List[Dict[str, str]],
        backend: str,
        overrides: Optional[Dict[str, Any]] = None,
        active_model: str = "",
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, str]]:
        """
        Builds the message list to send to the LLM.
        Applies a character-based history limit rather than a message count limit,
        preventing cache invalidations on every single turn.
        """
        overrides = overrides or {}
        memory_summary = self.memory.get_profile_summary()
        mood = self.memory.get_mood_spectrum()

        effective_tool_mode = overrides.get("tool_mode") or getattr(config, "TOOL_MODE", "basic")

        if overrides.get("coding_mode"):
            system_content = get_coding_agent_system_prompt(memory_summary, mood, overrides=overrides)
        elif backend == "simple" and not getattr(config, "SEND_TOOLS_IN_SIMPLE", False):
            system_content = get_simple_system_prompt(memory_summary, mood)
        else:
            if effective_tool_mode == "advanced":
                system_content = get_advanced_jarvis_system_prompt(memory_summary, mood, overrides=overrides)
            else:
                system_content = get_system_prompt(memory_summary, mood, overrides=overrides)

        system_msg = {"role": "system", "content": system_content}

        # Dual-Tier Rolling Summarization Pruning Strategy:
        # Dynamically uses user-configured token limits and intact turn settings
        APPROX_CHARS_PER_TOKEN = 3.5
        is_advanced = getattr(config, "TOOL_MODE", "basic") == "advanced"
        settings = self.memory.profile.get("settings", {}) if hasattr(self, "memory") and hasattr(self.memory, "profile") else {}

        if is_advanced:
            user_token_limit = int(settings.get("advanced_history_token_limit", 40000))
            min_keep_turns = int(settings.get("advanced_history_keep_turns", 16))
        else:
            user_token_limit = int(settings.get("basic_history_token_limit", 2500))
            min_keep_turns = int(settings.get("basic_history_keep_turns", 6))

        history_limit = int(user_token_limit * APPROX_CHARS_PER_TOKEN)
        pruned_target = int((user_token_limit / 2) * APPROX_CHARS_PER_TOKEN)

        pruned_history = list(chat_history)
        total_chars = sum(len(m.get("content") or "") for m in pruned_history)

        removed_turns = []
        if total_chars > history_limit:
            est_tokens = int(total_chars / APPROX_CHARS_PER_TOKEN)
            print(f"[History] {total_chars} chars (~{est_tokens} tokens) exceeds budget limit ({int(history_limit/APPROX_CHARS_PER_TOKEN)} tokens). Summarizing oldest turns...")
            while total_chars > pruned_target and len(pruned_history) > min_keep_turns:
                removed_1 = pruned_history.pop(0)
                total_chars -= len(removed_1.get("content") or "")
                removed_turns.append(removed_1)

                if pruned_history and len(pruned_history) > min_keep_turns:
                    removed_2 = pruned_history.pop(0)
                    total_chars -= len(removed_2.get("content") or "")
                    removed_turns.append(removed_2)

                # Never orphan a tool result
                if pruned_history and pruned_history[0].get("role") == "tool":
                    orphan = pruned_history.pop(0)
                    total_chars -= len(orphan.get("content") or "")
                    removed_turns.append(orphan)

            print(f"[History] Retained {len(pruned_history)} active turns (~{int(total_chars / APPROX_CHARS_PER_TOKEN)} tokens). Summarized {len(removed_turns)} older messages into conversation recap.")

        # Build rolling conversation summary from removed_turns
        recap_msg = None
        if removed_turns:
            recap_snippets = []
            for m in removed_turns:
                role = m.get("role", "")
                content = (m.get("content") or "").strip()
                # Clean thought blocks from recap
                content = re.sub(r'<(thought|think|reasoning)>[\s\S]*?(?:<\/\1>|$)', '', content, flags=re.IGNORECASE).strip()
                if not content:
                    continue
                speaker = "User" if role == "user" else ("Yuki" if role == "assistant" else "Tool")
                snippet = content[:160] + ("..." if len(content) > 160 else "")
                recap_snippets.append(f"- {speaker}: {snippet}")

            if recap_snippets:
                recap_text = "[EARLIER CONVERSATION RECAP]\nKey details from archived earlier context:\n" + "\n".join(recap_snippets[-12:])
                recap_msg = {"role": "system", "content": recap_text}

        sanitized_history = []
        for m in pruned_history:
            role = m.get("role")
            content = str(m.get("content") or "").strip()
            
            if role == "tool":
                # Convert orphaned tool messages (loaded from DB) to clean text context so API schema validates
                tool_name = m.get("name", "Tool")
                sanitized_history.append({
                    "role": "user",
                    "content": f"[Previous Tool Result ({tool_name})]: {content}"
                })
            elif role == "assistant":
                # Strip visual UI tool badges from LLM prompt context to prevent prompt pollution
                clean_content = re.sub(r'🛠️\s*\*\*\s*\[.*?\]\s*\*\*(?:\n```tool_args[\s\S]*?```)?(?:\n```tool_output[\s\S]*?```)?', '', content).strip()
                if not clean_content:
                    clean_content = "Task step executed."
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
                    sanitized_history.append({
                        "role": role,
                        "content": content
                    })

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
                    else:
                        image_attach_snippets.append(f"\n[Attached Image File: {fname} ({spath}). Call tool 'jarvis_analyze_image' with image_path='{spath}' to inspect visual content if needed.]")

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

        final_messages = [system_msg]
        if recap_msg:
            final_messages.append(recap_msg)
        final_messages.extend(sanitized_history)
        final_messages.append(user_msg_obj)

        return final_messages

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
        "i despise", "not a fan of", "im not a fan of", "i'm not a fan of"
    }

    _COMPLEX_PATTERN = re.compile(
        r'\b(' + '|'.join(re.escape(kw) for kw in _COMPLEX_KEYWORDS) + r')\b',
        re.IGNORECASE
    )

    # Phrases that look like tool/action requests even when using simple words like 'open'
    _ACTION_PATTERN = re.compile(
        r'\b(open|close|minimize|maximize|show|hide)\b.{1,40}\b(app|application|window|program|browser|settings|notepad|calc|explorer|discord|spotify|steam|chrome|firefox|edge|vscode|folder|file|drive)\b',
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
            "Yuki can control the user's computer: open files, search the web, "
            "adjust volume, launch apps, run commands, save user facts/interests, and more.\n\n"
            "Given the conversation so far, does the user's LATEST message require "
            "Yuki to perform a computer action, search the web, or save a personal fact/interest/preference?\n\n"
            "'No' means the user is just having a normal conversation and does not want "
            "any computer operation or memory update performed.\n\n"
            "Reply with ONLY 'Yes' or 'No'. Nothing else."
        )

        # Fast short-circuit: if user is asking Yuki questions about herself, route to CHAT
        msg_lower = user_message.lower().strip()
        yuki_q_patterns = [
            "what do you", "what do u", "what u", "what you", "do you", "do u",
            "what is your", "what's your", "who are you", "who r u", "tell me about yourself", "about you"
        ]
        if any(p in msg_lower for p in yuki_q_patterns) and not any(k in msg_lower for k in ("search", "open", "launch", "run", "play", "find", "file", "folder")):
            print(f"[IntentCheck] Short-circuited to CHAT (asking Yuki about herself): '{user_message}'")
            return "chat", "", "python short-circuit"

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
            return "tool", "manage_time", "python deterministic"

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
            history_lines = [f"{m['role'].capitalize()}: {str(m.get('content', ''))[:200]}" for m in last_exchanges]
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
            async with aiohttp.ClientSession() as check_session:
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
            summary_model = overrides.get("llm_summary_model") or overrides.get("llm_coder_model") or config.LLM_MODEL
            api_key = overrides.get("llm_coder_api_key") or config.LLM_API_KEY
            coder_base_url = overrides.get("llm_coder_base_url") or getattr(config, "LLM_CODER_BASE_URL", "")
            from app.agent.llm_backend import OpenAICompatibleBackend
            backend = OpenAICompatibleBackend(base_url_override=coder_base_url, api_key_override=api_key)
            print(f"[Router] Specialized Response Synthesizer Engine -> {backend.name} @ {summary_model}")
            return backend, summary_model

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

    def _query_lmstudio_model(self, messages: List[Dict[str, str]], model_name: str, temperature: float = 0.7, use_tools: bool = False, backend=None) -> Tuple[str, List[Dict[str, Any]], str]:
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
            tool_names = [t["function"]["name"] for t in tools]
            print(f"[Tools] Sending {len(tools)} tools to LLM: {', '.join(tool_names)}")

        payload = backend.build_payload(
            model=model_name,
            messages=messages,
            temperature=temperature,
            use_tools=use_tools,
            tools=tools,
        )
        max_attempts = len(backend.get_api_key_pool()) if hasattr(backend, "get_api_key_pool") and backend.get_api_key_pool() else 1
        for attempt in range(max(1, max_attempts)):
            response = requests.post(
                url,
                headers=backend.build_headers(),
                json=payload,
                timeout=120,
            )
            if response.status_code == 429 or "RESOURCE_EXHAUSTED" in response.text or "quota" in response.text.lower():
                if hasattr(backend, "rotate_on_rate_limit"):
                    backend.rotate_on_rate_limit()
                    print(f"[KeyPool] Retrying request with backup key (attempt {attempt+2}/{max_attempts})...")
                    continue
            break

        response.raise_for_status()
        res_json = response.json()
        if "error" in res_json:
            err_msg = str(res_json.get("error", {}).get("message", ""))
            if ("429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg) and hasattr(backend, "rotate_on_rate_limit"):
                backend.rotate_on_rate_limit()
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
                temp = 0.2 if label == "complex" else 0.7
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
                print(f"[Router][Mode 1] Task=simple -> using {tm} via {tb.name} with simple prompt (temp=0.7)")
                return self._query_lmstudio_model(messages, tm, temperature=0.7, use_tools=use_tools, backend=tb)
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
                
        assistant_final_speech = "\n".join(accumulated_response_total)
        final_history.append({"role": "assistant", "content": assistant_final_speech})
        return assistant_final_speech, final_history, backend_used

    # ------------------------------------------------------------------ #
    #  Streaming methods                                                 #
    # ------------------------------------------------------------------ #

    async def _get_tool_definitions_for_messages(self, messages: List[Dict[str, str]], intent_tool_hint: str = "", overrides: Optional[Dict[str, Any]] = None, active_model: str = "") -> list:
        """Return tool schemas from MCP discovery, with local-schema fallback."""
        overrides = overrides or {}
        effective_tool_mode = overrides.get("tool_mode") or getattr(config, "TOOL_MODE", "basic")
        use_dynamic = overrides.get("dynamic_tool_calling") if overrides.get("dynamic_tool_calling") is not None else self.memory.profile.get("settings", {}).get("dynamic_tool_calling", True)
        user_message = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                user_message = msg.get("content", "")
                break

        filtered_tools = await self.mcp_tools.get_tool_definitions(user_message, use_dynamic)

        # Omit jarvis_analyze_image for native vision models to prevent redundant tool execution
        if is_vision_model(active_model):
            filtered_tools = [t for t in filtered_tools if t.get("function", {}).get("name") != "jarvis_analyze_image"]

        # Filter tool definition list based on per-turn coding_mode or effective_tool_mode override
        if overrides.get("coding_mode"):
            coding_allowed = {
                "jarvis_run_terminal", "jarvis_run_python", "jarvis_read_file",
                "jarvis_create_or_edit_file", "jarvis_replace_file_content",
                "jarvis_list_dir_tree", "jarvis_git_status", "find_files_by_glob",
                "jarvis_web_search", "jarvis_web_scrape", "jarvis_system_diagnostics",
                "jarvis_send_stdin", "read_and_review_file", "search_files",
                "read_file_content", "run_terminal_command", "run_python_script",
                "jarvis_analyze_image"
            }
            filtered_tools = [t for t in filtered_tools if t.get("function", {}).get("name") in coding_allowed]
        elif effective_tool_mode == "basic":
            basic_allowed = {
                "web_search", "read_file_content", "search_files", "list_directory",
                "launch_app", "open_or_play_file", "set_system_volume", "manage_time",
                "get_system_stats", "update_user_fact", "take_screenshot", "run_terminal_command", "run_python_script",
                "jarvis_analyze_image"
            }
            filtered_tools = [t for t in filtered_tools if t.get("function", {}).get("name") in basic_allowed]

        if intent_tool_hint:
            targeted = [t for t in filtered_tools if t.get("function", {}).get("name") == intent_tool_hint]
            if targeted:
                tool_names = [t["function"]["name"] for t in targeted]
                print(f"[Tools] Intent-targeted filter ({effective_tool_mode}): sending ONLY [{', '.join(tool_names)}] to LLM")
                return targeted

        tool_names = [t["function"]["name"] for t in filtered_tools]
        source = "MCP stdio" if self.mcp_tools.enabled and not self.mcp_tools.last_error else "local"
        print(f"[Tools] Sending {len(filtered_tools)} {source} tools to LLM (mode: {effective_tool_mode}): {', '.join(tool_names)}")
        return filtered_tools

    async def _stream_request(self, session: aiohttp.ClientSession, url: str, model: str, messages: List[Dict[str, str]], headers: dict = None, temperature: float = 0.7, use_tools: bool = False, intent_tool_hint: str = "", overrides: Optional[Dict[str, Any]] = None):
        llm_backend = get_backend()
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
            
        max_attempts = len(llm_backend.get_api_key_pool()) if hasattr(llm_backend, "get_api_key_pool") and llm_backend.get_api_key_pool() else 1
        for attempt in range(max(1, max_attempts)):
            headers = llm_backend.build_headers()
            async with session.post(url, json=payload, headers=headers, timeout=120) as resp:
                if resp.status != 200:
                    try:
                        err_text = await resp.text()
                        err_json = json.loads(err_text)
                        err_msg = err_json.get("error", {}).get("message", err_text)
                    except Exception:
                        err_text_preview = err_text[:500] if err_text else "(empty body)"
                        err_msg = f"HTTP {resp.status}: {err_text_preview}"
                    
                    if (resp.status == 429 or "RESOURCE_EXHAUSTED" in err_msg or "quota" in err_msg.lower()) and hasattr(llm_backend, "rotate_on_rate_limit") and attempt < max_attempts - 1:
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


    async def _stream_lmstudio_model(self, session: aiohttp.ClientSession, model_name: str, messages: List[Dict[str, str]], temperature: float = 0.7, use_tools: bool = False, intent_tool_hint: str = "", backend=None, overrides: Optional[Dict[str, Any]] = None):
        if backend is None:
            llm_backend = get_backend()
        else:
            llm_backend = backend
        url = llm_backend.get_chat_url()
        headers = llm_backend.build_headers()
        async for chunk in self._stream_request(session, url, model_name, messages, headers=headers, temperature=temperature, use_tools=use_tools, intent_tool_hint=intent_tool_hint, overrides=overrides):
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
                print(f"[Router][Coder Mode] Task=coder -> streaming {tm} via {tb.name} (temp=0.2)")
                async for chunk, label in self._stream_lmstudio_model(session, tm, messages, temperature=0.2, use_tools=use_tools, intent_tool_hint=intent_tool_hint, backend=tb, overrides=overrides):
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
                temp = 0.2 if task in ("complex", "coder", "complex_coder") else 0.7
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
                print(f"[Router][Mode 2] Task=complex -> streaming {config.LLM_MODEL} with full prompt (temp=0.2)")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL, messages, temperature=0.2, use_tools=use_tools, intent_tool_hint=intent_tool_hint, overrides=overrides):
                    yield chunk, label
            except Exception as e:
                llm_backend = get_backend()
                err_msg = {"content": llm_backend.get_error_message(e)}
                yield err_msg, self._get_model_label(config.LLM_MODEL)
        else:
            try:
                tb, tm = self._get_backend_and_model_for_task("simple")
                print(f"[Router] Task=simple -> streaming {tm} via {tb.name} (temp=0.7)")
                async for chunk, label in self._stream_lmstudio_model(session, tm, messages, temperature=0.7, use_tools=use_tools, backend=tb, overrides=overrides):
                    yield chunk, label
            except Exception as e:
                tb_e, tm_e = self._get_backend_and_model_for_task("simple")
                err_msg = {"content": tb_e.get_error_message(e)}
                yield err_msg, self._get_model_label(tm_e)

    def _try_parse_json_tool_call(self, text: str) -> list:
        cleaned = text.strip()
        
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
        self._fallback_call_counter += 1
        return f"call_{prefix}_{self._fallback_call_counter}"

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
                            "content": f"[Previous Tool Result ({extra.get('name', 'Tool')})]: {str(extra.get('content') or '').strip()}"
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
                    "content": f"[Previous Tool Result ({msg.get('name', 'Tool')})]: {str(msg.get('content') or '').strip()}"
                })
                i += 1
            else:
                repaired.append(msg)
                i += 1
        if changed:
            print("[Executor] Transcript repair applied before LLM request.")
        return repaired

    async def _parse_native_stream(self, token_stream):
        """
        Accumulates tool calls from delta chunks and yields normal tokens.
        At the end of the stream, yields "tool_calls" events.
        Supports fallback parsing of text-based JSON tool calls and markdown tool blocks.
        """
        accumulated_tool_calls = {}
        last_label = "local"
        
        text_buffer = ""
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
                            # Plain text response — stream immediately on first token
                            is_json_candidate = False
                            yield "token", text_buffer, label
                            text_buffer = ""
                elif is_json_candidate:
                    text_buffer += content
                else:
                    text_buffer += content
                    yield "token", content, label
                    
            # 2. Accumulate tool calls
            tool_calls = delta.get("tool_calls")
            if tool_calls:
                is_json_candidate = False
                for tc_delta in tool_calls:
                    index = tc_delta.get("index", 0)
                    if index not in accumulated_tool_calls:
                        accumulated_tool_calls[index] = {
                            "id": tc_delta.get("id"),
                            "type": "function",
                            "function": {"name": "", "arguments": ""}
                        }
                    
                    fn_delta = tc_delta.get("function", {})
                    if fn_delta.get("name"):
                        accumulated_tool_calls[index]["function"]["name"] += fn_delta["name"]
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
                
        # Stream complete, yield any accumulated tool calls
        if accumulated_tool_calls:
            sorted_indices = sorted(accumulated_tool_calls.keys())
            compiled_calls = [accumulated_tool_calls[idx] for idx in sorted_indices]
            yield "tool_calls", compiled_calls, last_label

    async def execute_chat_turn_stream(self, user_message: str, chat_history: List[Dict[str, str]], overrides: Optional[Dict[str, Any]] = None, attachments: Optional[List[Dict[str, Any]]] = None):
        """
        Executes a chat turn in a streaming ReAct loop. Supports per-turn overrides from Chat Window.
        """
        overrides = overrides or {}
        effective_tool_mode = overrides.get("tool_mode") or getattr(config, "TOOL_MODE", "basic")

        self.memory.increment_interactions()

        from app.agent.resolver import resolve_command
        from app.tools.safety import strip_internal_auth_fields, issue_confirmation_grant, describe_tool_target

        # ── Layer 1: Zero-LLM Instant Resolver ───────────────────────────────
        # Skip in advanced/autonomous Jarvis mode — the LLM should decide tool calls
        resolved = resolve_command(user_message) if effective_tool_mode == "basic" else None
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
                yield "token", announcement, "resolver"
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
                        {"role": "user",      "content": user_message},
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
                {"role": "user",      "content": user_message},
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
        # Process passive mood drift & intimacy keyword detection
        active_ws_dir = self._get_active_session_dir(overrides or {})
        if active_ws_dir:
            from app.tools.system import set_active_workspace_directory
            set_active_workspace_directory(active_ws_dir)

        try:
            tb, tm = self._get_backend_and_model_for_task(resolved_backend, overrides=overrides)
            current_messages = self._build_messages(user_message, chat_history, resolved_backend, overrides=overrides, active_model=tm, attachments=attachments)
        except Exception as e:
            import traceback
            traceback.print_exc()
            current_messages = [{"role": "user", "content": user_message}]

        async with aiohttp.ClientSession() as session:
            is_coder_mode = bool(overrides.get("coding_mode")) or resolved_backend in ("coder", "complex_coder")
            max_iterations = 30 if is_coder_mode else 10
            iteration = 0
            troubleshoot_attempts = 0

            final_history = list(chat_history)
            final_history.append({"role": "user", "content": user_message})

            accumulated_response_total = []
            backend_used = "local"
            executed_calls = set()
            last_tool_result = ""
            
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
                
                stream = self._query_llm_stream(session, current_messages, user_message=user_message, use_tools=use_tools, resolved_backend=resolved_backend, intent_tool_hint=intent_tool_hint, intent_source=intent_source, overrides=overrides)
                
                tool_calls_to_execute = []
                accumulated_response = ""
                first_token = True
                
                async for event_type, value, label in self._parse_native_stream(stream):
                    backend_used = label
                    if event_type == "token":
                        if first_token:
                            print(f"\n[LLM Response (Iteration {iteration}, Backend: {backend_used})]: ", end="", flush=True)
                            first_token = False
                        accumulated_response += value
                        print(value, end="", flush=True)
                        yield "token", value, label
                    elif event_type == "tool_calls":
                        tool_calls_to_execute = value
                
                if not first_token:
                    print()
                full_llm_response = accumulated_response.strip()
                
                if tool_calls_to_execute:
                    # Pre-filter already-executed duplicate calls and normalize missing
                    # tool_call ids BEFORE appending the assistant message, so every
                    # assistant tool_call has exactly one matching 'tool' response and
                    # the transcript stays valid for the API (prevents code 3230).
                    pending_calls = []
                    for tool_call in tool_calls_to_execute:
                        tool_name = tool_call["function"]["name"]
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
                        if call_signature in executed_calls:
                            print(f"[Executor] Loop detected for tool '{tool_name}'. Skipping duplicate call.")
                            continue

                        executed_calls.add(call_signature)
                        if not tool_call.get("id"):
                            tool_call["id"] = f"call_{uuid.uuid4().hex[:8]}"
                        pending_calls.append((tool_call, tool_name, tool_args))

                    if pending_calls:
                        current_messages.append({
                            "role": "assistant",
                            "content": accumulated_response if accumulated_response.strip() else f"Running tool...",
                            "tool_calls": [pc[0] for pc in pending_calls]
                        })
                    elif accumulated_response.strip():
                        current_messages.append({
                            "role": "assistant",
                            "content": accumulated_response.strip()
                        })

                    for tool_call, tool_name, tool_args in pending_calls:
                        print(f"Agent triggered tool '{tool_name}' with args {tool_args} (iteration {iteration})")
                        yield "tool_start", {"name": tool_name, "args": tool_args}, backend_used

                        tool_result = await self._run_tool_async(tool_name, tool_args)
                        last_tool_result = tool_result

                        tool_failed = False
                        if isinstance(tool_result, str):
                            lower_res = tool_result.lower().strip()
                            if lower_res.startswith("error") or lower_res.startswith("failed") or lower_res.startswith("access denied") or "exception" in lower_res:
                                tool_failed = True

                        output_snippet = str(tool_result).strip()
                        if len(output_snippet) > 800:
                            output_snippet = output_snippet[:800] + "\n... [truncated]"

                        try:
                            args_json = json.dumps(tool_args, indent=2, ensure_ascii=False) if tool_args else ""
                        except Exception:
                            args_json = str(tool_args)
                        args_block = f"\n```tool_args\n{args_json}\n```" if args_json else ""

                        tool_target = tool_args.get("file_path") or tool_args.get("path") or tool_args.get("command") or tool_args.get("url") or ""
                        if tool_target and len(str(tool_target)) > 60:
                            tool_target = "..." + str(tool_target)[-57:]
                        target_info = f" (`{tool_target}`)" if tool_target else ""
                        status_symbol = "❌ Error" if tool_failed else "✓ Done"

                        tool_badge = f"🛠️ **[{tool_name}{target_info} — {status_symbol}]**{args_block}\n```tool_output\n{output_snippet}\n```"
                        accumulated_response_total.append(tool_badge)

                        tc_id = tool_call["id"]
                        current_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "name": tool_name,
                            "content": str(tool_result)
                        })
                        yield "tool_result", tool_result, backend_used

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

                        is_coder_mode = bool(overrides.get("coding_mode")) or resolved_backend in ("coder", "complex_coder")

                        if is_coder_mode:
                            # Autonomous Coder Mode: Keep coder backend active & encourage continuous tool execution until goal is complete!
                            resolved_backend = "coder"
                            reminder = (
                                f"[SYSTEM] {_iter_note} Tool '{tool_name}' completed with result above. "
                                f"User's overall goal: \"{_orig}\". "
                                "You are in Autonomous Coder Mode. If additional steps, file creations, refactors, or terminal/python commands are needed to fully build and verify the user's goal, execute the next tool call immediately. "
                                "Only write your final summary when the entire task is fully built and verified."
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
                        system_message_content = (
                            f"[SYSTEM] Tool '{tool_name}' failed with: {tool_result}. "
                            f"The user's original request was: \"{user_message.strip()}\". "
                            "Explain the failure to the user in 1 sentence, then either try a different approach "
                            "or tell the user what they can do to fix it. Do NOT retry the exact same tool call."
                        )
                        current_messages.append({
                            "role": "user",
                            "content": system_message_content
                        })
                else:
                    if accumulated_response.strip():
                        accumulated_response_total.append(accumulated_response.strip())
                    
                    assistant_final_speech = "\n".join(accumulated_response_total)
                    final_history.append({"role": "assistant", "content": assistant_final_speech})
                    yield "final_history", final_history, backend_used
                    return
            
            assistant_final_speech = "\n".join(accumulated_response_total)
            final_history.append({"role": "assistant", "content": assistant_final_speech})
            yield "final_history", final_history, backend_used
