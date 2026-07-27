"""Schema-text tool selection for compact but high-recall tool prompts."""

from __future__ import annotations

import re
from typing import Any, Iterable, Sequence

DEFAULT_MAX_TOOLS = 8
DEFAULT_FALLBACK_THRESHOLD = 0.08

_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could", "do", "for",
    "from", "get", "give", "i", "in", "is", "it", "me", "my", "of", "on", "or", "please",
    "show", "tell", "that", "the", "this", "to", "up", "use", "want", "what", "with", "you",
}

_QUERY_EXPANSIONS = {
    "app": ("application", "program", "launch", "open"),
    "application": ("app", "program", "launch", "open"),
    "browse": ("web", "internet", "search"),
    "browser": ("web", "internet", "url", "launch"),
    "clip": ("screenshot", "capture"),
    "dir": ("directory", "folder", "list", "file"),
    "folder": ("directory", "file", "open", "list", "search"),
    "google": ("web", "internet", "search"),
    "internet": ("web", "search", "browse"),
    "movie": ("video", "media", "play", "file"),
    "music": ("audio", "media", "play", "file"),
    "open": ("launch", "file", "directory", "application"),
    "play": ("media", "audio", "video", "file"),
    "pull": ("open", "launch", "show"),
    "run": ("execute", "terminal", "command", "script"),
    "search": ("find", "lookup", "web", "file"),
    "start": ("launch", "open", "play"),
    "time": ("date", "current", "datetime"),
    "video": ("media", "movie", "play", "file", "watch"),
    "watch": ("video", "media", "play", "open"),
    "web": ("internet", "search", "browse"),
}

_TOOL_HINTS = {
    "open_or_play_file": ("open", "play", "media", "video", "audio", "file", "folder", "watch", "anime"),
    "search_files": ("search", "find", "file", "folder", "directory", "locate", "anime"),
    "list_directory": ("list", "directory", "folder", "files"),
    "launch_app": ("open", "launch", "start", "app", "application", "program", "browser"),
    "web_search": ("web", "internet", "search", "google", "lookup", "browse"),
    "run_terminal_command": ("terminal", "command", "shell", "powershell", "cmd", "run", "execute"),
    "run_python_script": ("python", "script", "code", "run", "execute"),
    "take_screenshot": ("screenshot", "capture", "screen", "image"),
    "set_system_volume": ("volume", "sound", "audio", "mute", "loud"),
    "media_playback_control": ("pause", "next", "previous", "media", "music", "playback"),
    "control_window": ("window", "minimize", "maximize", "focus", "move", "close"),
    "keyboard_mouse_input": ("keyboard", "mouse", "type", "click", "press", "scroll"),
    "manage_process": ("process", "task", "kill", "running"),
    "system_power_control": ("shutdown", "restart", "reboot", "sleep", "lock", "sign", "power"),
    "get_current_datetime": ("time", "date", "today", "now", "current"),
    "get_system_stats": ("cpu", "ram", "memory", "disk", "system", "stats", "pc"),
    "update_user_fact": ("remember", "memory", "preference", "name", "interest", "fact"),
    "manage_time": ("timer", "reminder", "alarm", "stopwatch", "schedule", "remind", "clock", "countdown"),
    "create_file": ("create", "write", "new", "file"),
    "edit_file": ("edit", "replace", "change", "file"),
    "delete_file": ("delete", "remove", "file"),
}

_TOKEN_RE = re.compile(r"[a-z0-9_]+")


def select_relevant_tools(
    tools: Sequence[dict[str, Any]],
    user_message: str,
    *,
    max_tools: int = DEFAULT_MAX_TOOLS,
    fallback_threshold: float = DEFAULT_FALLBACK_THRESHOLD,
) -> list[dict[str, Any]]:
    """Return a compact, ranked tool list or all tools when confidence is low.

    This is a local analogue to tool search: it scores the user's words against
    tool names, descriptions, JSON-schema field names, and curated synonyms. If
    the best score is weak, it returns the full list rather than hiding the tool
    the model might need.
    """
    if not tools:
        return []

    query_terms = _expand_query_terms(_tokens(user_message))
    if not query_terms:
        return list(tools)

    scored = []
    for index, tool in enumerate(tools):
        name = _tool_name(tool)
        tool_terms = _tool_terms(tool)
        hint_terms = set(_TOOL_HINTS.get(name, ()))
        overlap = query_terms & (tool_terms | hint_terms)
        if not overlap:
            score = 0.0
        else:
            name_bonus = 0.18 if query_terms & set(name.split("_")) else 0.0
            hint_bonus = 0.12 if query_terms & hint_terms else 0.0
            score = len(overlap) / max(len(query_terms), 1) + name_bonus + hint_bonus
        scored.append((score, -index, tool))

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    if scored[0][0] < fallback_threshold:
        return list(tools)

    selected = [tool for score, _, tool in scored if score > 0][:max(1, max_tools)]
    return selected or list(tools)


def _tokens(text: str) -> set[str]:
    return {token for token in _TOKEN_RE.findall((text or "").lower()) if token not in _STOPWORDS}


def _expand_query_terms(tokens: set[str]) -> set[str]:
    expanded = set(tokens)
    for token in list(tokens):
        expanded.update(_QUERY_EXPANSIONS.get(token, ()))
    if "pull" in tokens and "up" in tokens:
        expanded.update(("open", "launch", "show"))
    return expanded


def _tool_terms(tool: dict[str, Any]) -> set[str]:
    function = tool.get("function", {}) if isinstance(tool, dict) else {}
    text_parts = [
        str(function.get("name", "")),
        str(function.get("description", "")),
        _schema_text(function.get("parameters", {})),
    ]
    return _tokens(" ".join(text_parts).replace("_", " "))


def _tool_name(tool: dict[str, Any]) -> str:
    try:
        return str(tool["function"]["name"])
    except Exception:
        return ""


def _schema_text(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(str(k) + " " + _schema_text(v) for k, v in value.items())
    if isinstance(value, list):
        return " ".join(_schema_text(v) for v in value)
    return str(value or "")
