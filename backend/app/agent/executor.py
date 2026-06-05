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
from app.memory.local_mem import MemoryManager
from app.tools.system import get_system_stats, launch_app, set_system_volume, get_current_datetime
from app.tools.web import get_weather, web_search
from app.tools.files import list_directory, search_files, open_or_play_file, create_file, edit_file, delete_file, resolve_best_file_no_llm

class AgentExecutor:
    def __init__(self, memory_manager: MemoryManager):
        self.memory = memory_manager
        
        # Map tool names to python functions
        self.tools = {
            "get_system_stats": get_system_stats,
            "launch_app": lambda **kwargs: launch_app(kwargs.get("app_name") or kwargs.get("name") or kwargs.get("app") or (list(kwargs.values())[0] if kwargs else "")),
            "set_system_volume": lambda **kwargs: set_system_volume(int(kwargs.get("volume_level") or kwargs.get("volume") or kwargs.get("level") or (list(kwargs.values())[0] if kwargs else 0))),
            "get_weather": lambda **kwargs: get_weather(kwargs.get("city") or kwargs.get("location") or (list(kwargs.values())[0] if kwargs else "")),
            "web_search": lambda **kwargs: web_search(kwargs.get("query") or kwargs.get("search") or kwargs.get("text") or (list(kwargs.values())[0] if kwargs else "")),
            "get_current_datetime": get_current_datetime,
            "update_user_name": lambda name: self.memory.set_user_name(name),
            "add_user_interest": lambda interest: self.memory.add_interest(interest),
            "update_user_fact": lambda key, value: self.memory.update_fact(key, value),
            "list_directory": lambda **kwargs: list_directory(
                kwargs.get("directory_path") or kwargs.get("path") or kwargs.get("directory") or kwargs.get("folder")
            ),
            "search_files": lambda **kwargs: search_files(
                kwargs.get("query") or kwargs.get("search") or kwargs.get("name") or "",
                kwargs.get("start_directory") or kwargs.get("directory") or kwargs.get("start_dir") or kwargs.get("path") or kwargs.get("folder")
            ),
            "open_or_play_file": lambda **kwargs: open_or_play_file(
                kwargs.get("file_path_or_query") or kwargs.get("query") or kwargs.get("file_path") or kwargs.get("path") or kwargs.get("filepath") or kwargs.get("file") or ""
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
            "control_window": lambda **kwargs: json.dumps({
                "status": "success",
                "action": kwargs.get("action"),
                "window_control": {
                    "action": kwargs.get("action"),
                    "x": int(kwargs.get("x")) if kwargs.get("x") is not None else None,
                    "y": int(kwargs.get("y")) if kwargs.get("y") is not None else None
                }
            })
        }

    async def get_friendly_error_explanation(self, exception_msg: str) -> str:
        """
        Asks the LLM to explain a Python exception in a friendly way for the user.
        If the LLM itself is offline or fails, returns a pre-configured diagnostic fallback.
        """
        prompt = f"Explain this Python exception to a desktop user in 1-2 friendly sentences and tell them how to fix it: {exception_msg}"
        messages = [
            {"role": "system", "content": f"You are {config.CHARACTER_NAME}, a helpful assistant. Keep your response minimal, friendly, and direct. Explain the error simply in 1-2 sentences. Do not use generic AI fluff."},
            {"role": "user", "content": prompt}
        ]
        try:
            url = f"{config.LMSTUDIO_URL}/v1/chat/completions"
            payload = {
                "model": config.LLM_MODEL,
                "messages": messages,
                "temperature": 0.5,
            }
            # We can use a short timeout for this quick diagnostic
            response = requests.post(
                url,
                headers={"Content-Type": "application/json"},
                json=payload,
                timeout=5,
            )
            response.raise_for_status()
            choices = response.json().get("choices", [])
            if choices:
                explanation = choices[0].get("message", {}).get("content", "").strip()
                if explanation:
                    return explanation
            raise Exception("Empty response from LLM")
        except Exception as e:
            # Fallback when LM Studio is offline or fails
            return (
                f"Hmph! Something went wrong in my system. It looks like my brain server (LM Studio) "
                f"might be offline or unreachable on {config.LMSTUDIO_URL}. "
                f"Please ensure LM Studio is running, and that the model '{config.LLM_MODEL}' is active."
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
        Builds the message list to send to the LLM:
          - Caps chat history to the last CHAT_HISTORY_LIMIT turns
            (a turn = 1 user msg + 1 assistant msg = 2 entries).
          - Picks the lean simple prompt for Qwen, full prompt for Nemotron.
        """
        memory_summary = self.memory.get_profile_summary()

        if backend == "simple":
            system_content = get_simple_system_prompt(memory_summary)
        else:  # "complex" or "complex_single" (mode 3)
            system_content = get_system_prompt(memory_summary)

        system_msg = {"role": "system", "content": system_content}

        # Cap history: keep the last N turns (N turns = N*2 messages)
        limit = config.CHAT_HISTORY_LIMIT
        if limit > 0 and len(chat_history) > limit * 2:
            capped_history = chat_history[-(limit * 2):]
        else:
            capped_history = chat_history

        return [system_msg] + capped_history + [{"role": "user", "content": user_message}]

    # ------------------------------------------------------------------ #
    #  Task router                                                          #
    # ------------------------------------------------------------------ #

    _CREATIVE_KEYWORDS = {
        # Creative writing
        "write", "writing", "story", "stories", "poem", "poetry", "essay",
        "narrative", "fiction", "creative", "imagine", "novel", "script",
        "lyrics", "describe", "brainstorm", "idea", "ideas",
        # Complex / deep coding
        "code", "coding", "program", "programming", "implement", "implementation",
        "algorithm", "refactor", "architecture", "optimize", "optimization",
        "debug", "debugging", "review", "unittest", "test", "testing",
        "class", "function", "module", "library", "framework", "design pattern",
        # Analysis / reasoning
        "analyze", "analysis", "explain", "compare", "summarize", "summary",
        "research", "plan", "strategy", "evaluate", "pros", "cons",
        # File finding, management and search (Complex Tasks)
        "find", "finding", "search", "searching", "locate", "locating",
        "where is", "where are", "directory", "directories", "folder", "folders",
        "file", "files", "play", "open", "list my", "list drives", "delete", "create"
    }

    _CREATIVE_PATTERN = re.compile(
        r'\b(' + '|'.join(re.escape(kw) for kw in _CREATIVE_KEYWORDS) + r')\b',
        re.IGNORECASE
    )

    def _classify_task(self, user_message: str) -> str:
        """
        Returns 'complex' if the message looks creative, complex, or relates to file finding/searching,
        otherwise returns 'simple'.
        Uses a simple keyword and pattern heuristic — fast, no extra LLM call needed.
        """
        lower = user_message.lower()
        
        # Check for path/drive patterns (e.g. C:\ or D:/)
        if re.search(r'[a-zA-Z]:[/\\]', lower):
            return "complex"

        if self._CREATIVE_PATTERN.search(lower):
            return "complex"
        return "simple"

    # ------------------------------------------------------------------ #
    #  Backend helpers                                                     #
    # ------------------------------------------------------------------ #

    def _get_model_label(self, model_name: str) -> str:
        lower = model_name.lower()
        if "qwen" in lower:
            return "qwen"
        if "nemotron" in lower:
            return "nemotron"
        return "local"

    def _query_lmstudio_model(self, messages: List[Dict[str, str]], model_name: str, temperature: float = 0.7) -> Tuple[str, str]:
        """
        Sends a request to the local LM Studio OpenAI-compatible endpoint for the specified model.
        Returns (response_text, model_label).
        """
        url = f"{config.LMSTUDIO_URL}/v1/chat/completions"
        payload = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
        }
        response = requests.post(
            url,
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
        content = self._extract_content(response.json())
        return content, self._get_model_label(model_name)

    def _extract_content(self, res_json: dict) -> str:
        """Pulls the text content out of an OpenAI-compatible chat completion response."""
        choices = res_json.get("choices")
        if not choices:
            return "Hmph! I received an empty choices response. Please verify your prompt wasn't flagged by safety filters."

        choice = choices[0]
        message = choice.get("message", {})
        content = message.get("content")
        if content is not None:
            return content

        refusal = message.get("refusal")
        if refusal:
            return f"Hmph! The model refused to answer: {refusal}"

        finish_reason = choice.get("finish_reason")
        if finish_reason in ("safety", "content_filter"):
            return "Hmph! The response was blocked by the safety filters."

        return "Hmph! I received a reply from my brain, but the text content field was missing."

    # ------------------------------------------------------------------ #
    #  Main LLM entry point with routing + fallback                        #
    # ------------------------------------------------------------------ #

    def _query_llm(self, messages: List[Dict[str, str]], user_message: str = "") -> Tuple[str, str]:
        """
        Routes the request based on task complexity:
          - Coding/file search/reasoning  →  config.LLM_MODEL_COMPLEX
          - Greetings / simple chats      →  config.LLM_MODEL
        Returns (response_text, backend_label).
        Respects config.LLM_MODE override:
          0 = auto (classifier picks model AND prompt)
          1 = force simple (LLM_MODEL + lean prompt)
          2 = force complex (LLM_MODEL_COMPLEX + full prompt)
          3 = smart single (LLM_MODEL always, classifier picks prompt)
        """
        if config.LLM_MODE == 1:
            backend = "simple"
        elif config.LLM_MODE == 2:
            backend = "complex"
        elif config.LLM_MODE == 3:
            # Always use ministra-3, but let classifier choose the prompt
            task = self._classify_task(user_message) if user_message else "simple"
            # Use "complex" label so _build_messages picks the full tool prompt,
            # but we will always send to LLM_MODEL below.
            backend = task  # "simple" or "complex" — only affects the prompt
        else:
            backend = self._classify_task(user_message) if user_message else "simple"

        if config.LLM_MODE == 3:
            # Mode 3: ministra-3 for everything, prompt already baked into messages
            try:
                label = "complex" if backend == "complex" else "simple"
                temp = 0.2 if label == "complex" else 0.7
                print(f"[Router][Mode 3] Task={label} → using {config.LLM_MODEL} with {'full' if label == 'complex' else 'lean'} prompt (temp={temp})")
                return self._query_lmstudio_model(messages, config.LLM_MODEL, temperature=temp)
            except Exception as e:
                return (
                    f"Hmph! I couldn't reach my brain server (LM Studio). "
                    f"Make sure it's running on {config.LMSTUDIO_URL}! Error: {str(e)}",
                    self._get_model_label(config.LLM_MODEL)
                )
        elif backend == "complex":
            try:
                print(f"[Router] Task classified as complex → using local {config.LLM_MODEL_COMPLEX} (temp=0.2)")
                return self._query_lmstudio_model(messages, config.LLM_MODEL_COMPLEX, temperature=0.2)
            except Exception as complex_err:
                print(f"[Router] Complex model '{config.LLM_MODEL_COMPLEX}' failed ({complex_err}), falling back to simple model '{config.LLM_MODEL}' (temp=0.2)")
                try:
                    return self._query_lmstudio_model(messages, config.LLM_MODEL, temperature=0.2)
                except Exception as fallback_err:
                    return (
                        f"Hmph! Both complex and simple local models failed. "
                        f"Complex error: {complex_err} | Simple error: {fallback_err}",
                        self._get_model_label(config.LLM_MODEL)
                    )
        else:
            try:
                print(f"[Router] Task classified as simple → using local {config.LLM_MODEL} (temp=0.7)")
                return self._query_lmstudio_model(messages, config.LLM_MODEL, temperature=0.7)
            except Exception as e:
                return (
                    f"Hmph! I couldn't reach my brain server (LM Studio). "
                    f"Make sure it's running on {config.LMSTUDIO_URL}! Error: {str(e)}",
                    self._get_model_label(config.LLM_MODEL)
                )

    def parse_tool_call(self, text: str) -> Tuple[str, Dict[str, Any]]:
        """
        Parses <tool_call>{"name": ..., "arguments": ...}</tool_call> tags.
        Returns the parsed tool name and arguments dictionary if found, or None.
        """
        pattern = r"<tool_call>(.*?)</tool_call>"
        match = re.search(pattern, text, re.DOTALL)
        if not match:
            return None, None
            
        json_str = match.group(1).strip()
        
        # Self-healing cleanups for Windows backslash escaping errors:
        cleaned_json = json_str
        
        # 1. Fix trailing backslashes escaping closing quotes (e.g. D:\" or folder\" at the end of a value)
        cleaned_json = re.sub(r'\\"(?=\s*[,\}\]])', r'\\\\"', cleaned_json)
        
        try:
            # First try parsing directly
            tool_data = json.loads(cleaned_json)
            return tool_data.get("name"), tool_data.get("arguments", {})
        except json.JSONDecodeError:
            # 2. Fix unescaped backslashes inside string literals (e.g., \v in \video songs)
            # Scan char-by-char and turn invalid escape sequences into forward slashes (which Windows supports natively)
            fixed_chars = []
            i = 0
            while i < len(cleaned_json):
                char = cleaned_json[i]
                if char == '\\':
                    if i + 1 < len(cleaned_json):
                        next_char = cleaned_json[i+1]
                        if next_char in ['"', '\\', '/', 'n', 'r', 't', 'b', 'f']:
                            # Valid escape sequence
                            fixed_chars.append(char)
                            fixed_chars.append(next_char)
                            i += 2
                            continue
                        elif next_char == 'u':
                            # Check if followed by 4 hex digits (e.g., \u2661)
                            if i + 5 < len(cleaned_json) and all(c in '0123456789abcdefABCDEF' for c in cleaned_json[i+2:i+6]):
                                fixed_chars.append('\\u')
                                i += 2
                                continue
                    # Invalid JSON escape sequence, replace with a safe forward slash
                    fixed_chars.append('/')
                    i += 1
                else:
                    fixed_chars.append(char)
                    i += 1
            
            cleaned_json = "".join(fixed_chars)
            try:
                tool_data = json.loads(cleaned_json)
                return tool_data.get("name"), tool_data.get("arguments", {})
            except Exception:
                # Last resort fallback: replace single quotes
                try:
                    fixed_str = cleaned_json.replace("'", '"')
                    tool_data = json.loads(fixed_str)
                    return tool_data.get("name"), tool_data.get("arguments", {})
                except Exception:
                    # Final recovery: model may have omitted 1-2 closing braces.
                    # Try appending } or }} to close the JSON object.
                    for suffix in ("}", "}}"):
                        try:
                            tool_data = json.loads(cleaned_json + suffix)
                            print(f"[Parser] Recovered tool call by appending '{suffix}'")
                            return tool_data.get("name"), tool_data.get("arguments", {})
                        except Exception:
                            pass
                    print(f"Failed to parse tool call JSON: {json_str} (Cleaned: {cleaned_json})")
                    return None, None

    def execute_chat_turn(self, user_message: str, chat_history: List[Dict[str, str]]) -> Tuple[str, List[Dict[str, str]], str]:
        """
        Executes a chat turn in a ReAct loop. Supports multiple sequential tool calls.
        """
        self.memory.increment_interactions()

        # Check for non-LLM commands /open and /play
        msg_lower = user_message.lower().strip()
        if msg_lower.startswith('/open ') or msg_lower.startswith('/play '):
            play_mode = msg_lower.startswith('/play ')
            cmd_prefix = '/play ' if play_mode else '/open '
            query = user_message[len(cmd_prefix):].strip()
            
            print(f"[Executor] Running non-LLM resolver in thread for query='{query}' play_mode={play_mode}")
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(resolve_best_file_no_llm, query, play_mode)
                resolved_path = future.result()
            if resolved_path:
                try:
                    os.startfile(resolved_path)
                    response_text = f"Success: Found best matching file and opened '{resolved_path}'."
                except Exception as e:
                    response_text = f"Failed to open '{resolved_path}': {str(e)}"
            else:
                response_text = f"Error: Could not find any files matching '{query}' on your system."
            
            final_history = list(chat_history) + [
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": response_text}
            ]
            return response_text, final_history, "local"

        # Determine backend first so we can pick the right prompt
        if config.LLM_MODE == 1:
            resolved_backend = "simple"
        elif config.LLM_MODE == 2:
            resolved_backend = "complex"
        elif config.LLM_MODE == 3:
            # Always ministra-3, but classifier picks the prompt
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
            llm_response, backend_used = self._query_llm(current_messages, user_message=user_message)
            print(f"\n[LLM Response (Iteration {iteration}, Backend: {backend_used})]:\n{llm_response}\n")
            
            tool_name, tool_args = self.parse_tool_call(llm_response)
            
            if tool_name:
                print(f"Agent triggered tool '{tool_name}' with args {tool_args} (iteration {iteration})")
                
                tool_failed = False
                if tool_name in self.tools:
                    try:
                        tool_func = self.tools[tool_name]
                        if tool_args:
                            tool_result = tool_func(**tool_args)
                        else:
                            tool_result = tool_func()
                    except Exception as e:
                        tool_result = f"Error executing tool: {str(e)}"
                        tool_failed = True
                else:
                    tool_result = f"Error: Tool '{tool_name}' is not registered."
                    tool_failed = True
                    
                if not tool_failed and isinstance(tool_result, str):
                    lower_res = tool_result.lower().strip()
                    if lower_res.startswith("error") or lower_res.startswith("failed") or lower_res.startswith("access denied") or "exception" in lower_res:
                        tool_failed = True

                print(f"Tool execution result: {tool_result}")
                
                clean_speech = re.sub(r"<tool_call>.*?</tool_call>", "", llm_response, flags=re.DOTALL).strip()
                if clean_speech:
                    accumulated_response_total.append(clean_speech)
                
                current_messages.append({"role": "assistant", "content": llm_response})
                
                if tool_failed and troubleshoot_attempts < 4:
                    troubleshoot_attempts += 1
                    system_message_content = (
                        f"[SYSTEM TROUBLESHOOTER - TOOL EXCEPTION] The tool '{tool_name}' failed with: {tool_result}. "
                        "Diagnose the issue, explain it to the user, and propose a new tool call or step to resolve it."
                    )
                elif tool_failed:
                    system_message_content = (
                        f"[SYSTEM MESSAGE - TOOL CALL EXECUTED]\nTool '{tool_name}' completed and returned:\n{tool_result}\n\n"
                        "Maximum self-healing attempts reached. Please explain the failure to the user and ask for manual help."
                    )
                else:
                    system_message_content = (
                        f"[SYSTEM MESSAGE - TOOL CALL EXECUTED]\nTool '{tool_name}' completed and returned:\n{tool_result}\n\n"
                        "Formulate your next response. If you need to call another tool, do so. Otherwise, give your final response to the user."
                    )
                
                current_messages.append({
                    "role": "user",
                    "content": system_message_content
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

    async def _stream_request(self, session: aiohttp.ClientSession, url: str, model: str, messages: List[Dict[str, str]], headers: dict = None, temperature: float = 0.7):
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": True
        }
        async with session.post(url, json=payload, headers=headers, timeout=60) as resp:
            resp.raise_for_status()
            async for line_bytes in resp.content:
                line = line_bytes.decode("utf-8").strip()
                if not line:
                    continue
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        content = data["choices"][0]["delta"].get("content", "")
                        if content:
                            yield content
                    except Exception:
                        pass

    async def _stream_lmstudio_model(self, session: aiohttp.ClientSession, model_name: str, messages: List[Dict[str, str]], temperature: float = 0.7):
        """
        Streams a request to the local LM Studio endpoint for the specified model.
        """
        url = f"{config.LMSTUDIO_URL}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        async for chunk in self._stream_request(session, url, model_name, messages, headers=headers, temperature=temperature):
            yield chunk, self._get_model_label(model_name)

    async def _query_llm_stream(self, session: aiohttp.ClientSession, messages: List[Dict[str, str]], user_message: str = ""):
        """
        Routes the streaming request based on task complexity.
        Respects config.LLM_MODE override (0=auto, 1=force simple, 2=force complex, 3=smart single).
        """
        if config.LLM_MODE == 1:
            backend = "simple"
        elif config.LLM_MODE == 2:
            backend = "complex"
        elif config.LLM_MODE == 3:
            # Always ministra-3 — prompt was already chosen in _build_messages
            backend = "mode3"
        else:
            backend = self._classify_task(user_message) if user_message else "simple"

        if backend == "mode3":
            try:
                task = self._classify_task(user_message) if user_message else "simple"
                temp = 0.2 if task == "complex" else 0.7
                print(f"[Router][Mode 3] Task={task} → streaming {config.LLM_MODEL} with {'full' if task == 'complex' else 'lean'} prompt (temp={temp})")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL, messages, temperature=temp):
                    yield chunk, label
            except Exception as e:
                err_msg = f"Hmph! I couldn't reach my brain server (LM Studio). Make sure it's running on {config.LMSTUDIO_URL}! Error: {str(e)}"
                yield err_msg, self._get_model_label(config.LLM_MODEL)
        elif backend == "complex":
            try:
                print(f"[Router] Task classified as complex → using local {config.LLM_MODEL_COMPLEX} Stream (temp=0.2)")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL_COMPLEX, messages, temperature=0.2):
                    yield chunk, label
            except Exception as complex_err:
                print(f"[Router] Complex model stream failed ({complex_err}), falling back to simple model stream (temp=0.2)")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL, messages, temperature=0.2):
                    yield chunk, label
        else:
            try:
                print(f"[Router] Task classified as simple → using local {config.LLM_MODEL} Stream (temp=0.7)")
                async for chunk, label in self._stream_lmstudio_model(session, config.LLM_MODEL, messages, temperature=0.7):
                    yield chunk, label
            except Exception as e:
                err_msg = f"Hmph! I couldn't reach my brain server (LM Studio). Make sure it's running on {config.LMSTUDIO_URL}! Error: {str(e)}"
                yield err_msg, self._get_model_label(config.LLM_MODEL)

    async def _parse_stream(self, token_stream):
        buffer = ""
        in_tool_call = False
        tool_call_buffer = ""
        
        async for chunk, label in token_stream:
            buffer += chunk
            
            if not in_tool_call:
                if "<tool_call>" in buffer:
                    parts = buffer.split("<tool_call>", 1)
                    if parts[0]:
                        yield "token", parts[0], label
                    
                    in_tool_call = True
                    tool_call_buffer = parts[1]
                    buffer = ""
                else:
                    prefix_match = False
                    for i in range(1, 12):
                        suffix = buffer[-i:]
                        if "<tool_call>".startswith(suffix):
                            yield_len = len(buffer) - i
                            if yield_len > 0:
                                yield "token", buffer[:yield_len], label
                            buffer = suffix
                            prefix_match = True
                            break
                    
                    if not prefix_match:
                        yield "token", buffer, label
                        buffer = ""
            else:
                tool_call_buffer += chunk
                if "</tool_call>" in tool_call_buffer:
                    parts = tool_call_buffer.split("</tool_call>", 1)
                    yield "tool_call", parts[0], label
                    in_tool_call = False
                    buffer = parts[1]
                    tool_call_buffer = ""
                    
        if not in_tool_call:
            if buffer:
                yield "token", buffer, label
        else:
            # Stream ended while still inside a <tool_call> block.
            # The model likely emitted valid JSON but forgot the closing </tool_call> tag.
            # Check if the accumulated JSON looks complete (balanced braces).
            raw = tool_call_buffer.strip()
            # Strip any accidental </tool_call> prefix/suffix fragments
            raw = re.sub(r'</?tool_call>', '', raw).strip()

            def _is_balanced(s: str) -> bool:
                depth = 0
                in_str = False
                escape = False
                for ch in s:
                    if escape:
                        escape = False
                        continue
                    if ch == '\\' and in_str:
                        escape = True
                        continue
                    if ch == '"':
                        in_str = not in_str
                        continue
                    if in_str:
                        continue
                    if ch == '{':
                        depth += 1
                    elif ch == '}':
                        depth -= 1
                if depth == 0 and s.count('{') > 0:
                    return True
                return False

            if raw and _is_balanced(raw):
                # Valid complete JSON — yield as a recovered tool call
                print(f"[Parser] Stream ended without </tool_call> tag — recovering tool call from buffer.")
                yield "tool_call", raw, label
            else:
                # Incomplete / broken — surface the raw text so the user sees something
                yield "token", "<tool_call>" + tool_call_buffer, label


    async def execute_chat_turn_stream(self, user_message: str, chat_history: List[Dict[str, str]]):
        """
        Executes a chat turn in a streaming ReAct loop. Supports multiple sequential tool calls.
        """
        self.memory.increment_interactions()

        # Check for non-LLM commands /open and /play
        msg_lower = user_message.lower().strip()
        if msg_lower.startswith('/open ') or msg_lower.startswith('/play '):
            play_mode = msg_lower.startswith('/play ')
            cmd_prefix = '/play ' if play_mode else '/open '
            query = user_message[len(cmd_prefix):].strip()
            
            yield "tool_start", "resolve_best_file_no_llm", "local"
            # Offload the potentially blocking DB/search work to a thread to avoid
            # blocking the event loop and delaying websocket token sends.
            resolved_path = await asyncio.to_thread(resolve_best_file_no_llm, query, play_mode)
            if resolved_path:
                try:
                    os.startfile(resolved_path)
                    response_text = f"Success: Found best matching file and opened '{resolved_path}'."
                except Exception as e:
                    response_text = f"Failed to open '{resolved_path}': {str(e)}"
            else:
                response_text = f"Error: Could not find any files matching '{query}' on your system."
            
            yield "tool_result", response_text, "local"
            yield "token", response_text, "local"
            
            final_history = list(chat_history) + [
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": response_text}
            ]
            yield "final_history", final_history, "local"
            return

        # Determine backend first so we can pick the right prompt
        if config.LLM_MODE == 1:
            resolved_backend = "simple"
        elif config.LLM_MODE == 2:
            resolved_backend = "complex"
        elif config.LLM_MODE == 3:
            # Always ministra-3, but classifier picks the prompt
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
            
            while iteration < max_iterations:
                iteration += 1
                stream = self._query_llm_stream(session, current_messages, user_message=user_message)
                
                tool_name = None
                tool_args = {}
                accumulated_response = ""
                
                async for event_type, value, label in self._parse_stream(stream):
                    backend_used = label
                    if event_type == "token":
                        accumulated_response += value
                        yield "token", value, label
                    elif event_type == "tool_call":
                        parsed_name, parsed_args = self.parse_tool_call(f"<tool_call>{value}</tool_call>")
                        if parsed_name:
                            tool_name = parsed_name
                            tool_args = parsed_args
                
                # Print the full LLM response for logging
                full_llm_response = accumulated_response.strip()
                if tool_name:
                    tool_json = json.dumps({"name": tool_name, "arguments": tool_args})
                    full_llm_response = f"{full_llm_response}\n<tool_call>{tool_json}</tool_call>".strip()
                print(f"\n[LLM Response (Iteration {iteration}, Backend: {backend_used})]:\n{full_llm_response}\n")
                
                if tool_name:
                    print(f"Agent triggered tool '{tool_name}' with args {tool_args} (iteration {iteration})")
                    yield "tool_start", tool_name, backend_used
                    
                    tool_failed = False
                    if tool_name in self.tools:
                        try:
                            tool_func = self.tools[tool_name]
                            if inspect.iscoroutinefunction(tool_func):
                                if tool_args:
                                    tool_result = await tool_func(**tool_args)
                                else:
                                    tool_result = await tool_func()
                            else:
                                if tool_args:
                                    tool_result = await asyncio.to_thread(tool_func, **tool_args)
                                else:
                                    tool_result = await asyncio.to_thread(tool_func)
                        except Exception as e:
                            tool_result = f"Error executing tool: {str(e)}"
                            tool_failed = True
                    else:
                        tool_result = f"Error: Tool '{tool_name}' is not registered."
                        tool_failed = True
                        
                    if not tool_failed and isinstance(tool_result, str):
                        lower_res = tool_result.lower().strip()
                        if lower_res.startswith("error") or lower_res.startswith("failed") or lower_res.startswith("access denied") or "exception" in lower_res:
                            tool_failed = True

                    print(f"Tool execution result: {tool_result}")
                    yield "tool_result", tool_result, backend_used
                    
                    clean_speech = accumulated_response.strip()
                    assistant_content = f"{clean_speech}\n<tool_call>{json.dumps({'name': tool_name, 'arguments': tool_args})}</tool_call>" if clean_speech else f"<tool_call>{json.dumps({'name': tool_name, 'arguments': tool_args})}</tool_call>"
                    
                    current_messages.append({"role": "assistant", "content": assistant_content})
                    
                    if tool_failed and troubleshoot_attempts < 4:
                        troubleshoot_attempts += 1
                        system_message_content = (
                            f"[SYSTEM TROUBLESHOOTER - TOOL EXCEPTION] The tool '{tool_name}' failed with: {tool_result}. "
                            "Diagnose the issue, explain it to the user, and propose a new tool call or step to resolve it."
                        )
                    elif tool_failed:
                        system_message_content = (
                            f"[SYSTEM MESSAGE - TOOL CALL EXECUTED]\nTool '{tool_name}' completed and returned:\n{tool_result}\n\n"
                            "Maximum self-healing attempts reached. Please explain the failure to the user and ask for manual help."
                        )
                    else:
                        system_message_content = (
                            f"[SYSTEM MESSAGE - TOOL CALL EXECUTED]\nTool '{tool_name}' completed and returned:\n{tool_result}\n\n"
                            "Formulate your next response. If you need to call another tool, do so. Otherwise, give your final response to the user."
                        )
                    
                    current_messages.append({
                        "role": "user",
                        "content": system_message_content
                    })
                    
                    if clean_speech:
                        accumulated_response_total.append(clean_speech)
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
