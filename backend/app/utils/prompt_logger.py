"""
LLM Prompt Logger for Project Yuki
==================================
Logs the complete prompt sent to the LLM into a timestamped file whenever an LLM
request is initiated.

Each log file includes:
1. Header metadata (timestamp, model, caller tag, endpoint, token/char estimates)
2. Human-readable structured prompt (role-by-role as the LLM sees it)
3. Available tools/functions schemas sent with the prompt (if any)
4. Verbatim raw JSON payload as transmitted to the API endpoint
"""

import os
import sys
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from app import config


def get_prompt_logs_dir() -> Path:
    """
    Returns the Path to the directory where prompt logs are stored.
    Defaults to backend/prompt_logs. Ensures the directory exists.
    """
    base = getattr(config, "PROMPT_LOGS_DIR", None)
    if not base:
        base_dir = getattr(config, "BASE_DIR", None) or Path.cwd()
        base = Path(base_dir) / "prompt_logs"
    else:
        base = Path(base)

    try:
        base.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        print(f"[PromptLogger] Failed to create log dir '{base}': {e}")
    return base


def _estimate_tokens(char_count: int) -> int:
    """Rough approximation matching codebase standard (~3.5 chars/token)."""
    return int(char_count / 3.5) if char_count > 0 else 0


def _format_message_content(content: Any) -> str:
    """
    Formats the message content nicely for human inspection.
    Handles plain strings, lists of multimodal parts (text/image), and structured objects.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        formatted_parts = []
        for i, part in enumerate(content, 1):
            if isinstance(part, dict):
                part_type = part.get("type", "unknown")
                if part_type == "text":
                    formatted_parts.append(part.get("text", ""))
                elif part_type == "image_url":
                    img_info = part.get("image_url", {})
                    url_str = img_info.get("url", "") if isinstance(img_info, dict) else str(img_info)
                    if url_str.startswith("data:image"):
                        header = url_str.split(",")[0] if "," in url_str else url_str[:30]
                        formatted_parts.append(f"[MULTIMODAL ATTACHMENT: Inline base64 image ({header}, total len {len(url_str):,} chars)]")
                    else:
                        formatted_parts.append(f"[MULTIMODAL ATTACHMENT: Image URL: {url_str}]")
                else:
                    formatted_parts.append(f"[PART {i} ({part_type})]: {json.dumps(part, ensure_ascii=False)}")
            else:
                formatted_parts.append(str(part))
        return "\n".join(formatted_parts)
    if isinstance(content, dict):
        return json.dumps(content, indent=2, ensure_ascii=False)
    return str(content)


def log_llm_prompt(
    payload: Any,
    model: str = "",
    tag: str = "",
    endpoint: str = "",
    extra_meta: Optional[Dict[str, Any]] = None,
) -> Optional[Path]:
    """
    Writes the complete prompt that is sent to the LLM to a new timestamped log file.

    Parameters:
        payload: The exact request dict (or messages list) sent to the LLM API.
        model: Name of the active model handling the prompt.
        tag: Context/caller tag (e.g. 'stream', 'query', 'intent_check', 'nudge').
        endpoint: Target LLM endpoint URL.
        extra_meta: Optional extra metadata dictionary.

    Returns:
        Path to the newly created log file, or None on error/disabled.
    """
    if not getattr(config, "LOG_LLM_PROMPTS", True):
        return None

    try:
        now = datetime.now()
        timestamp_str = now.strftime("%Y-%m-%d_%H-%M-%S_%f")
        logs_dir = get_prompt_logs_dir()

        # Sanitize tag for filename
        clean_tag = ""
        if tag:
            clean_tag = re.sub(r"[^a-zA-Z0-9_-]", "_", str(tag).strip())
            clean_tag = f"_{clean_tag[:24]}" if clean_tag else ""

        filename = f"prompt_{timestamp_str}{clean_tag}.log"
        log_path = logs_dir / filename

        # Normalize payload into dict
        if isinstance(payload, dict):
            req_dict = payload
        elif isinstance(payload, list):
            req_dict = {"messages": payload, "model": model}
        else:
            req_dict = {"prompt": str(payload), "model": model}

        active_model = model or req_dict.get("model", "unknown")
        messages = req_dict.get("messages") or []
        tools = req_dict.get("tools") or []
        temperature = req_dict.get("temperature")
        max_tokens = req_dict.get("max_tokens")
        stream = req_dict.get("stream", False)

        # Raw payload serialization for exact token/character analysis
        try:
            raw_json = json.dumps(req_dict, indent=2, ensure_ascii=False)
        except Exception:
            raw_json = str(req_dict)

        total_chars = len(raw_json)
        est_tokens = _estimate_tokens(total_chars)

        lines: List[str] = []
        divider = "=" * 80
        sub_divider = "-" * 80

        # ── Header ──
        lines.append(divider)
        lines.append("PROJECT YUKI - LLM PROMPT LOG")
        lines.append(divider)
        lines.append(f"Timestamp:        {now.strftime('%Y-%m-%d %H:%M:%S.%f')}")
        lines.append(f"Model:            {active_model}")
        if tag:
            lines.append(f"Caller / Tag:     {tag}")
        if endpoint:
            lines.append(f"Endpoint URL:     {endpoint}")
        lines.append(f"Messages Count:   {len(messages)}")
        lines.append(f"Tools Count:      {len(tools)}")
        if temperature is not None:
            lines.append(f"Temperature:      {temperature}")
        if max_tokens is not None:
            lines.append(f"Max Tokens:       {max_tokens}")
        lines.append(f"Streaming:        {stream}")
        lines.append(f"Payload Size:     {total_chars:,} chars (~{est_tokens:,} est tokens)")
        if extra_meta:
            for k, v in extra_meta.items():
                lines.append(f"{k}: {v}")
        lines.append(divider)
        lines.append("")

        # ── Section 1: Formatted Messages (As the LLM sees it) ──
        lines.append(divider)
        lines.append("SECTION 1: COMPLETE PROMPT (AS LLM SEES IT)")
        lines.append(divider)
        lines.append("")

        if messages:
            for idx, msg in enumerate(messages, 1):
                role = str(msg.get("role", "unknown")).upper()
                name = msg.get("name")
                tool_call_id = msg.get("tool_call_id")
                tool_calls = msg.get("tool_calls")
                content = msg.get("content")

                role_header = f"[MESSAGE {idx}/{len(messages)}] ROLE: {role}"
                if name:
                    role_header += f" (name: {name})"
                if tool_call_id:
                    role_header += f" (tool_call_id: {tool_call_id})"

                lines.append(sub_divider)
                lines.append(role_header)
                lines.append(sub_divider)

                # Tool calls emitted by assistant in earlier turns
                if tool_calls:
                    lines.append("[Tool Calls Requested by Assistant]:")
                    for tc in tool_calls:
                        if isinstance(tc, dict):
                            fn = tc.get("function", {})
                            fn_name = fn.get("name", "unknown") if isinstance(fn, dict) else str(fn)
                            fn_args = fn.get("arguments", "") if isinstance(fn, dict) else ""
                            call_id = tc.get("id", "")
                            lines.append(f"  - Tool Call ID: {call_id}")
                            lines.append(f"    Function:     {fn_name}")
                            lines.append(f"    Arguments:    {fn_args}")
                        else:
                            lines.append(f"  - {tc}")
                    lines.append("")

                formatted_content = _format_message_content(content)
                if formatted_content:
                    lines.append(formatted_content)
                elif not tool_calls:
                    lines.append("(empty content)")

                lines.append("")
        elif "prompt" in req_dict:
            lines.append(str(req_dict["prompt"]))
            lines.append("")
        else:
            lines.append("(No messages found in payload)")
            lines.append("")

        # ── Section 2: Tools & Function Schemas ──
        if tools:
            lines.append(divider)
            lines.append(f"SECTION 2: AVAILABLE TOOLS SENT TO LLM ({len(tools)} tools)")
            lines.append(divider)
            lines.append("")
            for t_idx, tool_item in enumerate(tools, 1):
                if isinstance(tool_item, dict):
                    fn = tool_item.get("function", tool_item)
                    t_name = fn.get("name", f"tool_{t_idx}")
                    t_desc = fn.get("description", "(No description)")
                    t_params = fn.get("parameters", {})

                    lines.append(f"[{t_idx}/{len(tools)}] TOOL: {t_name}")
                    lines.append(f"Description: {t_desc}")
                    if t_params:
                        try:
                            lines.append("Parameters Schema:")
                            lines.append(json.dumps(t_params, indent=2, ensure_ascii=False))
                        except Exception:
                            lines.append(f"Parameters: {t_params}")
                    lines.append(sub_divider)
                else:
                    lines.append(f"[{t_idx}/{len(tools)}] {tool_item}")
            lines.append("")

        # ── Section 3: Verbatim Raw JSON Payload ──
        lines.append(divider)
        lines.append("SECTION 3: COMPLETE RAW JSON PAYLOAD (AS TRANSMITTED)")
        lines.append(divider)
        lines.append(raw_json)
        lines.append("")
        lines.append(divider)
        lines.append("END OF PROMPT LOG")
        lines.append(divider)

        # Write to file
        log_content = "\n".join(lines)
        log_path.write_text(log_content, encoding="utf-8")
        print(f"[PromptLogger] Logged LLM prompt -> {log_path.name} ({len(messages)} msgs, ~{est_tokens:,} tokens)")
        return log_path

    except Exception as e:
        print(f"[PromptLogger] Failed to write prompt log: {e}")
        return None
