"""
LLM Response Logger for Project Yuki
====================================
Logs the exact response received from the LLM into a timestamped file whenever an LLM
request completes (both streaming and non-streaming).

Each log file includes:
1. Header metadata (timestamp, model, caller tag, endpoint, HTTP status, duration, sizing)
2. Human-readable parsed assistant output (content, reasoning/thinking, tool calls)
3. Verbatim exact raw response as received over the wire (raw JSON, raw text, or SSE stream chunks)

Also provides startup cleanup to purge logs older than yesterday from both response_logs and prompt_logs.
"""

import os
import sys
import json
import re
from datetime import datetime, timedelta, date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app import config


def get_response_logs_dir() -> Path:
    """
    Returns the Path to the directory where response logs are stored.
    Defaults to backend/response_logs. Ensures the directory exists.
    """
    base = getattr(config, "RESPONSE_LOGS_DIR", None)
    if not base:
        base_dir = getattr(config, "BASE_DIR", None) or Path.cwd()
        base = Path(base_dir) / "response_logs"
    else:
        base = Path(base)

    try:
        base.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        print(f"[ResponseLogger] Failed to create log dir '{base}': {e}")
    return base


def _estimate_tokens(char_count: int) -> int:
    """Rough approximation matching codebase standard (~3.5 chars/token)."""
    return int(char_count / 3.5) if char_count > 0 else 0


def cleanup_logs_before_yesterday(target_dir: Optional[Path] = None) -> int:
    """
    Scans the given directory and removes all log files whose date is strictly
    before yesterday (i.e. older than yesterday).

    Logs from today and yesterday are preserved.
    Returns the number of deleted files.
    """
    if target_dir is None:
        target_dir = get_response_logs_dir()
    else:
        target_dir = Path(target_dir)

    if not target_dir.exists() or not target_dir.is_dir():
        return 0

    now = datetime.now()
    today = now.date()
    yesterday = today - timedelta(days=1)

    deleted_count = 0
    try:
        for file_path in target_dir.iterdir():
            if not file_path.is_file():
                continue

            file_date: Optional[date] = None
            date_match = re.search(r"(\d{4}-\d{2}-\d{2})", file_path.name)
            if date_match:
                try:
                    file_date = datetime.strptime(date_match.group(1), "%Y-%m-%d").date()
                except Exception:
                    file_date = None

            if file_date is None:
                try:
                    file_date = datetime.fromtimestamp(file_path.stat().st_mtime).date()
                except Exception:
                    continue

            # If strictly before yesterday (i.e. older than yesterday), delete it
            if file_date < yesterday:
                try:
                    file_path.unlink(missing_ok=True)
                    deleted_count += 1
                except Exception as del_err:
                    print(f"[ResponseLogger] Failed to delete old log '{file_path.name}': {del_err}")

    except Exception as scan_err:
        print(f"[ResponseLogger] Error scanning '{target_dir}' for cleanup: {scan_err}")

    return deleted_count


def cleanup_all_old_logs() -> Dict[str, int]:
    """
    Cleans up logs from before yesterday across both response_logs and prompt_logs.
    Preserves logs from today and yesterday.
    """
    results: Dict[str, int] = {}
    resp_dir = get_response_logs_dir()
    resp_deleted = cleanup_logs_before_yesterday(resp_dir)
    results["response_logs"] = resp_deleted

    try:
        from app.utils.prompt_logger import get_prompt_logs_dir
        prompt_dir = get_prompt_logs_dir()
        prompt_deleted = cleanup_logs_before_yesterday(prompt_dir)
        results["prompt_logs"] = prompt_deleted
    except Exception:
        results["prompt_logs"] = 0

    total = sum(results.values())
    if total > 0:
        print(
            f"[LogCleanup] Purged {total} log file(s) before yesterday "
            f"({results['response_logs']} response logs, {results['prompt_logs']} prompt logs)."
        )
    else:
        print(f"[LogCleanup] Response & prompt logs clean (0 files older than yesterday).")

    return results


def log_llm_response(
    response: Any,
    model: str = "",
    tag: str = "",
    endpoint: str = "",
    status_code: Optional[int] = 200,
    duration_sec: Optional[float] = None,
    raw_chunks: Optional[List[str]] = None,
    assembled_content: Optional[str] = None,
    assembled_reasoning: Optional[str] = None,
    assembled_tool_calls: Optional[List[Dict[str, Any]]] = None,
    extra_meta: Optional[Dict[str, Any]] = None,
) -> Optional[Path]:
    """
    Writes the exact response received from the LLM to a new timestamped log file.

    Parameters:
        response: The exact response data (raw string, parsed JSON dict, or status error).
        model: Name of the active model that responded.
        tag: Context/caller tag (e.g. 'stream', 'query', 'intent_check', 'presence_nudge').
        endpoint: Target LLM endpoint URL.
        status_code: HTTP response status code (e.g. 200, 429, 500).
        duration_sec: Roundtrip duration in seconds.
        raw_chunks: Optional list of verbatim raw SSE chunk lines (for streaming requests).
        assembled_content: Optional assembled full text content across chunks.
        assembled_reasoning: Optional assembled reasoning/thinking content.
        assembled_tool_calls: Optional assembled tool calls list.
        extra_meta: Optional extra metadata dictionary.

    Returns:
        Path to the newly created log file, or None on error/disabled.
    """
    if not getattr(config, "LOG_LLM_RESPONSES", True):
        return None

    try:
        now = datetime.now()
        timestamp_str = now.strftime("%Y-%m-%d_%H-%M-%S_%f")
        logs_dir = get_response_logs_dir()

        # Sanitize tag for filename
        clean_tag = ""
        if tag:
            clean_tag = re.sub(r"[^a-zA-Z0-9_-]", "_", str(tag).strip())
            clean_tag = f"_{clean_tag[:24]}" if clean_tag else ""

        filename = f"response_{timestamp_str}{clean_tag}.log"
        log_path = logs_dir / filename

        is_streaming = bool(raw_chunks is not None)
        parsed_dict: Optional[Dict[str, Any]] = None
        raw_text_payload: str = ""

        if isinstance(response, dict):
            parsed_dict = response
            try:
                raw_text_payload = json.dumps(response, indent=2, ensure_ascii=False)
            except Exception:
                raw_text_payload = str(response)
        elif isinstance(response, str):
            raw_text_payload = response
            try:
                parsed_candidate = json.loads(response)
                if isinstance(parsed_candidate, dict):
                    parsed_dict = parsed_candidate
            except Exception:
                pass
        elif raw_chunks:
            raw_text_payload = "\n".join(raw_chunks)
        else:
            raw_text_payload = str(response)

        # Extract parsed elements if available
        content_text = assembled_content or ""
        reasoning_text = assembled_reasoning or ""
        tool_calls_list = assembled_tool_calls or []

        if parsed_dict and not content_text and not tool_calls_list:
            choices = parsed_dict.get("choices", [])
            if choices and isinstance(choices[0], dict):
                msg = choices[0].get("message", choices[0].get("delta", {}))
                content_text = msg.get("content") or ""
                reasoning_text = msg.get("reasoning_content") or msg.get("reasoning") or ""
                tool_calls_list = msg.get("tool_calls") or []
            elif "candidates" in parsed_dict:
                # Gemini native format
                try:
                    parts = parsed_dict["candidates"][0]["content"]["parts"]
                    content_text = "\n".join(p.get("text", "") for p in parts if "text" in p)
                except Exception:
                    pass

        active_model = model or (parsed_dict.get("model") if parsed_dict else "") or "unknown"
        total_chars = len(raw_text_payload)
        est_tokens = _estimate_tokens(total_chars)

        lines: List[str] = []
        divider = "=" * 80
        sub_divider = "-" * 80

        # ── Header ──
        lines.append(divider)
        lines.append("PROJECT YUKI - LLM RESPONSE LOG")
        lines.append(divider)
        lines.append(f"Timestamp:        {now.strftime('%Y-%m-%d %H:%M:%S.%f')}")
        lines.append(f"Model:            {active_model}")
        if tag:
            lines.append(f"Caller / Tag:     {tag}")
        if endpoint:
            lines.append(f"Endpoint URL:     {endpoint}")
        if status_code is not None:
            lines.append(f"HTTP Status:      {status_code}")
        if duration_sec is not None:
            lines.append(f"Duration:         {duration_sec:.2f}s")
        lines.append(f"Streaming:        {is_streaming}")
        if raw_chunks is not None:
            lines.append(f"Stream Chunks:    {len(raw_chunks)}")
        lines.append(f"Response Size:    {total_chars:,} chars (~{est_tokens:,} est tokens)")
        if extra_meta:
            for k, v in extra_meta.items():
                lines.append(f"{k}: {v}")
        lines.append(divider)
        lines.append("")

        # ── Section 1: Parsed Assistant Output ──
        lines.append(divider)
        lines.append("SECTION 1: PARSED ASSISTANT OUTPUT (AS YUKI CONSUMES IT)")
        lines.append(divider)
        lines.append("")

        if reasoning_text:
            lines.append(sub_divider)
            lines.append("[THINKING / REASONING CONTENT]")
            lines.append(sub_divider)
            lines.append(reasoning_text.strip())
            lines.append("")

        if content_text:
            lines.append(sub_divider)
            lines.append("[ASSISTANT MESSAGE CONTENT]")
            lines.append(sub_divider)
            lines.append(content_text.strip())
            lines.append("")

        if tool_calls_list:
            lines.append(sub_divider)
            lines.append(f"[TOOL CALLS REQUESTED ({len(tool_calls_list)})]")
            lines.append(sub_divider)
            for tc_idx, tc in enumerate(tool_calls_list, 1):
                if isinstance(tc, dict):
                    fn = tc.get("function", {})
                    fn_name = fn.get("name", "unknown") if isinstance(fn, dict) else str(fn)
                    fn_args = fn.get("arguments", "") if isinstance(fn, dict) else ""
                    call_id = tc.get("id", f"call_{tc_idx}")
                    lines.append(f"  - Tool Call ID: {call_id}")
                    lines.append(f"    Function:     {fn_name}")
                    lines.append(f"    Arguments:    {fn_args}")
                else:
                    lines.append(f"  - {tc}")
            lines.append("")

        if not content_text and not reasoning_text and not tool_calls_list:
            lines.append("(No structured assistant content parsed; see Section 2 for exact raw body)")
            lines.append("")

        # ── Section 2: Exact Raw Response As Received Over Wire ──
        lines.append(divider)
        if is_streaming:
            lines.append(f"SECTION 2: EXACT RAW SSE STREAM CHUNKS ({len(raw_chunks or [])} lines as received)")
        else:
            lines.append("SECTION 2: EXACT RAW RESPONSE (AS RECEIVED OVER WIRE)")
        lines.append(divider)
        lines.append(raw_text_payload)
        lines.append("")
        lines.append(divider)
        lines.append("END OF RESPONSE LOG")
        lines.append(divider)

        # Write to file
        log_content = "\n".join(lines)
        log_path.write_text(log_content, encoding="utf-8")
        duration_str = f" in {duration_sec:.2f}s" if duration_sec is not None else ""
        print(f"[ResponseLogger] Logged LLM response -> {log_path.name} ({total_chars:,} chars, ~{est_tokens:,} tokens{duration_str})")
        return log_path

    except Exception as e:
        print(f"[ResponseLogger] Failed to write response log: {e}")
        return None
