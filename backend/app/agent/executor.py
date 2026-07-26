import json
import re
import requests
import aiohttp
import asyncio
import concurrent.futures
import inspect
import os
from typing import Dict, Any, List, Tuple
from app import config
from app.agent.prompts import get_system_prompt, get_simple_system_prompt
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
    "take_screenshot"
}



def _extract_confirmation_target(tool_result: str) -> str | None:
    if isinstance(tool_result, str) and tool_result.startswith("CONFIRM_REQUIRED: "):
        return tool_result[len("CONFIRM_REQUIRED: "):].strip()
    return None

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
        from app.tools.web import web_search as _web_search_fn
        from app.tools.safety import authorize_tool_call as _authorize_tool_call_fn
        self._authorize_tool_call = _authorize_tool_call_fn

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
            "update_user_fact": lambda **kwargs: (
                self.memory.set_user_name(kwargs.get("value"))
                if (kwargs.get("key") or "").lower().strip() in ("name", "user_name", "username")
                else (
                    self.memory.add_interest(kwargs.get("value"))
                    if (kwargs.get("key") or "").lower().strip() in ("interest", "user_interest", "hobby")
                    else self.memory.update_fact(kwargs.get("key"), kwargs.get("value"))
                )
            ),

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
                kwargs.get("action") or ""
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
            "web_search": _async_web_search
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

    def _build_messages(
        self,
        user_message: str,
        chat_history: List[Dict[str, str]],
        backend: str,
    ) -> List[Dict[str, str]]:
        """
        Builds the message list to send to the LLM.
        Applies a character-based history limit rather than a message count limit,
        preventing cache invalidations on every single turn.
        """
        memory_summary = self.memory.get_profile_summary()

        if backend == "simple":
            system_content = get_simple_system_prompt(memory_summary)
        else:
            system_content = get_system_prompt(memory_summary)

        system_msg = {"role": "system", "content": system_content}

        # Token-approximate history capping.
        # With an 8 192-token context window the budget splits roughly as:
        #   ~500 system prompt  +  ~900 tool schemas  +  ~200 user msg  +  ~1 000 generation
        #   → ~5 592 tokens available for history.  We cap conservatively at 1 000 tokens
        #   (~3 500 chars) and prune down to 500 tokens (~1 750 chars) when exceeded.
        #   Approximation: 1 token ≈ 3.5 chars (English average).
        APPROX_CHARS_PER_TOKEN = 3.5
        history_limit  = int(1000 * APPROX_CHARS_PER_TOKEN)   # ~3 500 chars
        pruned_target  = int(500 * APPROX_CHARS_PER_TOKEN)    # ~1 750 chars

        pruned_history = list(chat_history)
        total_chars = sum(len(m.get("content") or "") for m in pruned_history)

        if total_chars > history_limit:
            est_tokens = int(total_chars / APPROX_CHARS_PER_TOKEN)
            print(f"[History] {total_chars} chars (~{est_tokens} tokens) exceeds budget. Pruning oldest turns...")
            while total_chars > pruned_target and len(pruned_history) > 2:
                removed_1 = pruned_history.pop(0)
                removed_2 = pruned_history.pop(0)
                total_chars -= (len(removed_1.get("content") or "") + len(removed_2.get("content") or ""))
            print(f"[History] Pruned to {total_chars} chars (~{int(total_chars / APPROX_CHARS_PER_TOKEN)} tokens, {len(pruned_history)} messages).")

        return [system_msg] + pruned_history + [{"role": "user", "content": user_message}]

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
        "seach", "google", "internet", "web", "online", "lookup", "look up", "browse"
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

    def _query_lmstudio_model(self, messages: List[Dict[str, str]], model_name: str, temperature: float = 0.7, use_tools: bool = False) -> Tuple[str, List[Dict[str, Any]], str]:
        """
        Sends a request to the active LLM backend for the specified model.
        Returns (response_text, tool_calls, model_label).
        """
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
        response = requests.post(
            url,
            headers=backend.build_headers(),
            json=payload,
            timeout=120,
        )
        response.raise_for_status()
        res_json = response.json()
        if "error" in res_json:
            return f"Error from brain server: {res_json['error'].get('message')}", None, self._get_model_label(model_name)

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
                print(f"[Router][Mode 3] Task={label} -> using {config.LLM_MODEL} with {'full' if label == 'complex' else 'lean'} prompt (temp={temp})")
                return self._query_lmstudio_model(messages, config.LLM_MODEL, temperature=temp, use_tools=use_tools)
            except Exception as e:
                llm_backend = get_backend()
                return (
                    llm_backend.get_error_message(e),
                    None,
                    self._get_model_label(config.LLM_MODEL)
                )
        elif backend == "complex":
            try:
                print(f"[Router] Task classified as complex -> using {config.LLM_MODEL_COMPLEX} (temp=0.2)")
                return self._query_lmstudio_model(messages, config.LLM_MODEL_COMPLEX, temperature=0.2, use_tools=use_tools)
            except Exception as complex_err:
                print(f"[Router] Complex model '{config.LLM_MODEL_COMPLEX}' failed ({complex_err}), falling back to simple model '{config.LLM_MODEL}' (temp=0.2)")
                try:
                    return self._query_lmstudio_model(messages, config.LLM_MODEL, temperature=0.2, use_tools=use_tools)
                except Exception as fallback_err:
                    return (
                        f"Hmph! Both complex and simple models failed. "
                        f"Complex error: {complex_err} | Simple error: {fallback_err}",
                        None,
                        self._get_model_label(config.LLM_MODEL)
                    )
        else:
            try:
                print(f"[Router] Task classified as simple -> using {config.LLM_MODEL} (temp=0.7)")
                return self._query_lmstudio_model(messages, config.LLM_MODEL, temperature=0.7, use_tools=use_tools)
            except Exception as e:
                llm_backend = get_backend()
                return (
                    llm_backend.get_error_message(e),
                    None,
                    self._get_model_label(config.LLM_MODEL)
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

        max_iterations = 10
        iteration = 0
        troubleshoot_attempts = 0
        accumulated_response_total = []
        final_history = list(chat_history) + [{"role": "user", "content": user_message}]
        backend_used = "local"
        
        while iteration < max_iterations:
            iteration += 1
            
            use_tools = (resolved_backend != "simple")
            llm_response, tool_calls, backend_used = self._query_llm(current_messages, user_message=user_message, use_tools=use_tools)
            print(f"\n[LLM Response (Iteration {iteration}, Backend: {backend_used})]:\n{llm_response}\n")
            
            if tool_calls:
                tool_call = tool_calls[0]
                tool_name = tool_call["function"]["name"]
                try:
                    tool_args = json.loads(tool_call["function"]["arguments"])
                except Exception:
                    tool_args = {}
                    
                print(f"Agent triggered tool '{tool_name}' with args {tool_args} (iteration {iteration})")
                
                tool_failed = False
                tool_result = ""
                
                # Use shared async dispatcher (runs in thread-pool for sync tools).
                # It enforces server-side confirmation grants; model-supplied
                # confirmed=True is never trusted.
                loop = asyncio.get_event_loop()
                tool_result = loop.run_until_complete(self._run_tool_async(tool_name, tool_args))

                if not tool_failed and isinstance(tool_result, str):
                    lower_res = tool_result.lower().strip()
                    if lower_res.startswith("error") or lower_res.startswith("failed") or lower_res.startswith("access denied") or "exception" in lower_res:
                        tool_failed = True

                print(f"Tool execution result: {tool_result}")
                
                if not tool_failed and tool_name in _SHORT_CIRCUIT_TOOLS:
                    short_circuit_msg = _format_short_circuit_result(tool_name, tool_result, tool_args)
                    if llm_response.strip():
                        accumulated_response_total.append(llm_response.strip())
                    accumulated_response_total.append(short_circuit_msg)
                    
                    assistant_final_speech = "\n".join(accumulated_response_total)
                    final_history.append({"role": "assistant", "content": assistant_final_speech})
                    return assistant_final_speech, final_history, backend_used
                    
                if llm_response.strip():
                    accumulated_response_total.append(llm_response.strip())
                
                current_messages.append({
                    "role": "assistant",
                    "content": llm_response or None,
                    "tool_calls": tool_calls
                })
                
                current_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.get("id", "call_default"),
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

    async def _get_tool_definitions_for_messages(self, messages: List[Dict[str, str]]) -> list:
        """Return tool schemas from MCP discovery, with local-schema fallback."""
        use_dynamic = self.memory.profile.get("settings", {}).get("dynamic_tool_calling", True)
        user_message = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                user_message = msg.get("content", "")
                break

        filtered_tools = await self.mcp_tools.get_tool_definitions(user_message, use_dynamic)
        tool_names = [t["function"]["name"] for t in filtered_tools]
        source = "MCP stdio" if self.mcp_tools.enabled and not self.mcp_tools.last_error else "local"
        print(f"[Tools] Sending {len(filtered_tools)} {source} tools to LLM: {', '.join(tool_names)}")
        return filtered_tools


    async def _stream_request(self, session: aiohttp.ClientSession, url: str, model: str, messages: List[Dict[str, str]], headers: dict = None, temperature: float = 0.7, use_tools: bool = False):
        llm_backend = get_backend()
        tools = None
        if use_tools:
            tools = await self._get_tool_definitions_for_messages(messages)

        payload = llm_backend.build_payload(
            model=model,
            messages=messages,
            temperature=temperature,
            use_tools=use_tools,
            tools=tools,
            stream=True,
        )
            
        async with session.post(url, json=payload, headers=headers, timeout=120) as resp:
            if resp.status != 200:
                try:
                    err_text = await resp.text()
                    err_json = json.loads(err_text)
                    err_msg = err_json.get("error", {}).get("message", err_text)
                except Exception:
                    err_text_preview = err_text[:500] if err_text else "(empty body)"
                    err_msg = f"HTTP {resp.status}: {err_text_preview}"
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


    async def _stream_lmstudio_model(self, session: aiohttp.ClientSession, model_name: str, messages: List[Dict[str, str]], temperature: float = 0.7, use_tools: bool = False):
        llm_backend = get_backend()
        url = llm_backend.get_chat_url()
        headers = llm_backend.build_headers()
        async for chunk in self._stream_request(session, url, model_name, messages, headers=headers, temperature=temperature, use_tools=use_tools):
            yield chunk, self._get_model_label(model_name)

    async def _query_llm_stream(self, session: aiohttp.ClientSession, messages: List[Dict[str, str]], user_message: str = "", use_tools: bool = False):
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
                task = self._classify_task(user_message) if user_message else "simple"
                temp = 0.2 if task == "complex" else 0.7
                print(f"[Router][Mode 3] Task={task} -> streaming {config.LLM_MODEL} with {'full' if task == 'complex' else 'lean'} prompt (temp={temp})")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL, messages, temperature=temp, use_tools=use_tools):
                    yield chunk, label
            except Exception as e:
                llm_backend = get_backend()
                err_msg = {"content": llm_backend.get_error_message(e)}
                yield err_msg, self._get_model_label(config.LLM_MODEL)
        elif backend == "complex":
            try:
                print(f"[Router] Task classified as complex -> using {config.LLM_MODEL_COMPLEX} Stream (temp=0.2)")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL_COMPLEX, messages, temperature=0.2, use_tools=use_tools):
                    yield chunk, label
            except Exception as complex_err:
                print(f"[Router] Complex model stream failed ({complex_err}), falling back to simple model stream (temp=0.2)")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL, messages, temperature=0.2, use_tools=use_tools):
                    yield chunk, label
        else:
            try:
                print(f"[Router] Task classified as simple -> using {config.LLM_MODEL} Stream (temp=0.7)")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL, messages, temperature=0.7, use_tools=use_tools):
                    yield chunk, label
            except Exception as e:
                llm_backend = get_backend()
                err_msg = {"content": llm_backend.get_error_message(e)}
                yield err_msg, self._get_model_label(config.LLM_MODEL)

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
                    "id": f"call_fallback_{tool_name}",
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": json.dumps(args_dict)
                    }
                }]
            except Exception:
                pass
        
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
                "id": f"call_fallback_{name}",
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": arguments
                }
            }
        return None

    async def _parse_native_stream(self, token_stream):
        """
        Accumulates tool calls from delta chunks and yields normal tokens.
        At the end of the stream, yields "tool_calls" events.
        Supports fallback parsing of text-based JSON tool calls.
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
                    stripped = text_buffer.strip()
                    if stripped:
                        # Check if text contains JSON pattern like {"name": ...} or {"tool_calls": ...}
                        if "{" in stripped or "`" in stripped or "[" in stripped:
                            is_json_candidate = True
                        elif len(stripped) > 50:
                            # Not JSON after 50 chars of non-JSON text; flush buffer and stream normally
                            is_json_candidate = False
                            yield "token", text_buffer, label
                            text_buffer = ""
                elif is_json_candidate:
                    text_buffer += content
                else:
                    yield "token", content, label
                    
            # 2. Accumulate tool calls
            tool_calls = delta.get("tool_calls")
            if tool_calls:
                is_json_candidate = False
                if text_buffer:
                    yield "token", text_buffer, label
                    text_buffer = ""
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
                
        # Stream complete, yield any accumulated tool calls
        if accumulated_tool_calls:
            sorted_indices = sorted(accumulated_tool_calls.keys())
            compiled_calls = [accumulated_tool_calls[idx] for idx in sorted_indices]
            yield "tool_calls", compiled_calls, last_label

    async def execute_chat_turn_stream(self, user_message: str, chat_history: List[Dict[str, str]]):
        """
        Executes a chat turn in a streaming ReAct loop. Supports multiple sequential tool calls.

        Layer 1 — Zero-LLM Instant Resolver:
            Matches unambiguous PC-control commands (volume, media, screenshot, time, stats)
            and executes them directly without calling the LLM, giving near-instant responses.

        Layer 2 — LLM-backed ReAct loop:
            Everything else is routed through the LLM with the appropriate prompt and tool schemas.
        """
        self.memory.increment_interactions()

        from app.agent.resolver import resolve_command
        from app.tools.safety import strip_internal_auth_fields, issue_confirmation_grant, describe_tool_target

        # ── Layer 1: Zero-LLM Instant Resolver ───────────────────────────────
        resolved = resolve_command(user_message)
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
                
            yield "tool_start", tool_name, "resolver"
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

        if config.LLM_MODE == 1:
            resolved_backend = "simple"
        elif config.LLM_MODE == 2:
            resolved_backend = "complex"
        elif config.LLM_MODE == 3:
            resolved_backend = self._classify_task(user_message) if user_message else "simple"
        else:
            resolved_backend = self._classify_task(user_message) if user_message else "simple"

        current_messages = self._build_messages(user_message, chat_history, resolved_backend)

        async with aiohttp.ClientSession() as session:
            max_iterations = 10
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
                
                use_tools = (resolved_backend != "simple")
                
                # Debug: Show what's being sent to LLM
                msg_roles = [m.get('role') for m in current_messages]
                print(f"[Executor] Sending {len(current_messages)} messages to LLM. Roles: {msg_roles}")
                if len(current_messages) > 0:
                    last_msg = current_messages[-1]
                    print(f"[Executor] Last message: role={last_msg.get('role')}, content preview={str(last_msg.get('content', ''))[:150]}...")
                
                stream = self._query_llm_stream(session, current_messages, user_message=user_message, use_tools=use_tools)
                
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
                    tool_call = tool_calls_to_execute[0]
                    tool_name = tool_call["function"]["name"]
                    try:
                        tool_args = json.loads(tool_call["function"]["arguments"])
                        # Unwrap malformed envelope: some models output the full tool-call
                        # object as the arguments JSON, e.g.:
                        #   {"type": "function", "function": "web_search", "parameters": {"query": "..."}}
                        # Detect this by checking for "type"/"function" keys typical of a
                        # tool-call wrapper, and extract the inner parameters dict.
                        if isinstance(tool_args, dict) and tool_args.get("type") == "function" and "function" in tool_args:
                            inner = tool_args.get("parameters") or tool_args.get("arguments") or {}
                            if isinstance(inner, dict) and inner:
                                print(f"[Executor] Unwrapping malformed tool-call envelope in arguments for '{tool_name}': {tool_args}")
                                tool_args = inner
                    except Exception:
                        tool_args = {}
                        
                    # Loop detection: stop if we are repeating the exact same tool execution
                    tool_args_str = tool_call["function"]["arguments"]
                    call_signature = (tool_name, tool_args_str)
                    if call_signature in executed_calls:
                        print(f"[Executor] Loop detected! Tool '{tool_name}' with args {tool_args_str} was already executed in this turn. Breaking.")
                        # Include last tool result if available
                        if last_tool_result and isinstance(last_tool_result, str):
                            # Stream the tool's result to the frontend so it is displayed and spoken
                            yield "token", last_tool_result, backend_used
                            accumulated_response_total.append(last_tool_result)
                        assistant_final_speech = "\n".join(accumulated_response_total)
                        if not assistant_final_speech.strip():
                            assistant_final_speech = "I have completed that action, Master."
                            yield "token", assistant_final_speech, backend_used
                        final_history.append({"role": "assistant", "content": assistant_final_speech})
                        yield "final_history", final_history, backend_used
                        return
                        
                    skip_execution = False
                    tool_result = ""
                    tool_failed = False

                    if tool_name in ("open_or_play_file", "launch_app"):
                        if any(call[0] == tool_name for call in executed_calls):
                            print(f"[Executor] Prevented duplicate execution of '{tool_name}' in the same turn.")
                            tool_result = "Success: The requested target is already open and active."
                            skip_execution = True

                    # Add to executed calls list
                    executed_calls.add(call_signature)
                    
                    print(f"Agent triggered tool '{tool_name}' with args {tool_args} (iteration {iteration})")
                    yield "tool_start", tool_name, backend_used

                    if not skip_execution:
                        tool_result = await self._run_tool_async(tool_name, tool_args)
                        last_tool_result = tool_result

                        # Handle sandbox/inside-tool confirmation request. The
                        # model cannot authorize by passing confirmed=True; the
                        # backend issues a grant after the user approves.
                        target_path = _extract_confirmation_target(tool_result)
                        if target_path:
                            print(f"[Executor] Tool '{tool_name}' returned CONFIRM_REQUIRED for target: {target_path}")

                            confirmed_args = strip_internal_auth_fields(tool_args)
                            if tool_name == "open_or_play_file":
                                confirmed_args = {
                                    "file_path_or_query": target_path,
                                    "play_mode": bool(tool_args.get("play_mode", False)),
                                }
                            confirmed_status = yield "tool_confirm_required", target_path, backend_used

                            if confirmed_status:
                                grant_id = issue_confirmation_grant(
                                    tool_name,
                                    confirmed_args,
                                    target=target_path or describe_tool_target(tool_name, confirmed_args),
                                )
                                confirmed_args["confirmation_grant_id"] = grant_id
                                print(f"[Executor] Re-running '{tool_name}' with backend confirmation grant for target: {target_path}")
                                tool_result = await self._run_tool_async(tool_name, confirmed_args)
                            else:
                                # User explicitly cancelled. Do not troubleshoot, do not retry. Abort loop immediately.
                                print(f"[Executor] Tool '{tool_name}' execution was cancelled by the user. Aborting ReAct loop.")
                                if accumulated_response.strip():
                                    accumulated_response_total.append(accumulated_response.strip())
                                cancel_msg = "Action cancelled by security confirmation check."
                                accumulated_response_total.append(cancel_msg)
                                
                                assistant_final_speech = "\n".join(accumulated_response_total)
                                final_history.append({"role": "assistant", "content": assistant_final_speech})
                                yield "final_history", final_history, backend_used
                                return

                        if isinstance(tool_result, str):
                            lower_res = tool_result.lower().strip()
                            if lower_res.startswith("error") or lower_res.startswith("failed") or lower_res.startswith("access denied") or "exception" in lower_res:
                                tool_failed = True

                    print(f"Tool execution result: {tool_result}")
                    yield "tool_result", tool_result, backend_used
                    
                    if not tool_failed and tool_name in _SHORT_CIRCUIT_TOOLS:
                        short_circuit_msg = _format_short_circuit_result(tool_name, tool_result, tool_args)
                        yield "token", short_circuit_msg, backend_used
                        if accumulated_response.strip():
                            accumulated_response_total.append(accumulated_response.strip())
                        accumulated_response_total.append(short_circuit_msg)
                        
                        assistant_final_speech = "\n".join(accumulated_response_total)
                        final_history.append({"role": "assistant", "content": assistant_final_speech})
                        yield "final_history", final_history, backend_used
                        return
                    
                    if accumulated_response.strip():
                        accumulated_response_total.append(accumulated_response.strip())
                    
                    current_messages.append({
                        "role": "assistant",
                        "content": accumulated_response if accumulated_response.strip() else "Running tool...",
                        "tool_calls": tool_calls_to_execute
                    })
                    
                    tool_call_id = tool_call.get("id") or "call_default"
                    current_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "content": str(tool_result)
                    })

                    # Inject guidance reminder to prevent small LLMs from repeating the same tool call
                    if not tool_failed:
                        # After a search/read tool, strongly remind the LLM to summarize now
                        # and NOT run auxiliary tools like update_user_fact before answering.
                        is_info_tool = tool_name in ("web_search", "read_file_content", "search_files")
                        if is_info_tool:
                            reminder = (
                                f"[SYSTEM INFO] The tool '{tool_name}' has returned its results above. "
                                "Your ONLY next action MUST be to write a clear, concise natural language summary of these results directly to the user. "
                                "Do NOT call any other tools (including update_user_fact, web_search, or any other tool) before responding. "
                                "Summarize now."
                            )
                        else:
                            reminder = (
                                f"[SYSTEM INFO] The tool '{tool_name}' was successfully executed and returned the output above. "
                                f"Do NOT call the tool '{tool_name}' again with the same arguments. "
                                "Use the returned information to write your final response or summary for the user."
                            )
                        current_messages.append({
                            "role": "user",
                            "content": reminder
                        })

                    final_history.append({
                        "role": "assistant",
                        "content": accumulated_response if accumulated_response.strip() else "Running tool...",
                        "tool_calls": tool_calls_to_execute
                    })
                    final_history.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "content": str(tool_result)
                    })
                    
                    # Debug: Show what's being added to context
                    print(f"[Executor] Tool '{tool_name}' result added to context. Messages count: {len(current_messages)}")
                    print(f"[Executor] Tool result preview: {str(tool_result)[:200]}...")
                    
                    if tool_failed and troubleshoot_attempts < 4:
                        troubleshoot_attempts += 1
                        system_message_content = (
                            f"[SYSTEM TROUBLESHOOTER - TOOL EXCEPTION] The tool '{tool_name}' failed with: {tool_result}. "
                            "Diagnose the issue, explain it to the user, and propose a new tool call or step to resolve it."
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
