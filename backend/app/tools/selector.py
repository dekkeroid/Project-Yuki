"""Schema-text tool selection for compact but high-recall tool prompts."""

from __future__ import annotations

import re
from typing import Any, Iterable, Sequence

import app.config as config

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
    "dashboard": ("html", "page", "interactive", "widget"),
    "diagram": ("svg", "flowchart", "architecture", "visual"),
    "dir": ("directory", "folder", "list", "file"),
    "draw": ("svg", "canvas", "illustration", "pixel"),
    "folder": ("directory", "file", "open", "list", "search"),
    "flowchart": ("svg", "diagram", "process", "visual"),
    "google": ("web", "internet", "search"),
    "illustration": ("svg", "draw", "art", "visual"),
    "internet": ("web", "search", "browse"),
    "local": ("file", "html", "serve", "disk"),
    "movie": ("video", "media", "play", "file"),
    "music": ("audio", "media", "play", "file"),
    "open": ("launch", "file", "directory", "application"),
    "page": ("html", "dashboard", "interactive", "website"),
    "pixel": ("art", "svg", "canvas", "sprite"),
    "play": ("media", "audio", "video", "file"),
    "pull": ("open", "launch", "show"),
    "run": ("execute", "terminal", "command", "script"),
    "search": ("find", "lookup", "web", "file"),
    "serve": ("html", "file", "local", "open"),
    "start": ("launch", "open", "play"),
    "time": ("date", "current", "datetime"),
    "video": ("media", "movie", "play", "file", "watch"),
    "visual": ("svg", "canvas", "diagram", "illustration"),
    "watch": ("video", "media", "play", "open"),
    "web": ("internet", "search", "browse"),
    "website": ("html", "page", "dashboard"),
}

_ALWAYS_INCLUDED_JARVIS_TOOLS = {
    "jarvis_run_python",
    "jarvis_remember_user_fact",
    "jarvis_web_search",
    "jarvis_web_scrape",
    "jarvis_launch_app",
    "jarvis_query_file_db",
    "jarvis_see_screen",
    "manage_todo",
    "jarvis_grep_files",
    "jarvis_find_files_by_glob",
}

_ALWAYS_INCLUDED_BASIC_TOOLS = {
    "run_python_script",
    "update_user_fact",
    "web_search",
}

_TOOL_HINTS = {
    # Jarvis Autonomous Mode Tools
    "jarvis_run_python": ("python", "script", "code", "run", "execute", "math", "pandas", "numpy", "calc", "data", "processing"),
    "jarvis_remember_user_fact": ("remember", "memory", "preference", "name", "fact", "user", "like", "dislike", "save"),
    "jarvis_web_search": ("web", "internet", "search", "google", "lookup", "browse", "find", "online"),
    "jarvis_web_scrape": ("scrape", "extract", "fetch", "url", "page", "site", "webpage", "article", "html", "download", "link"),
    "jarvis_query_file_db": ("find", "search", "file", "db", "query", "database", "index", "folder", "locate"),
    "jarvis_read_file": ("read", "view", "open", "file", "cat", "lines", "source", "code", "content"),
    "jarvis_create_or_edit_file": ("create", "write", "new", "file", "edit", "modify", "save"),
    "jarvis_replace_file_content": ("replace", "edit", "change", "file", "modify", "patch"),
    "jarvis_list_dir_tree": ("dir", "directory", "tree", "list", "folder", "files", "ls"),
    "jarvis_git_status": ("git", "repo", "commit", "status", "branch", "diff", "vcs"),
    "manage_todo": ("todo", "task", "checklist", "subtask", "track", "progress", "plan", "steps"),
    "jarvis_system_diagnostics": ("cpu", "ram", "memory", "disk", "stats", "system", "health", "battery", "performance"),
    "jarvis_launch_app": ("open", "launch", "start", "app", "application", "program", "browser", "exec"),
    "jarvis_open_or_play_file": ("open", "play", "media", "video", "audio", "file", "folder", "watch", "music"),
    "jarvis_window_control": ("window", "minimize", "maximize", "focus", "move", "close"),
    "jarvis_system_volume": ("volume", "sound", "audio", "mute", "unmute", "loud"),
    "jarvis_system_power": ("shutdown", "restart", "reboot", "sleep", "lock", "power"),
    "jarvis_manage_time": ("timer", "reminder", "alarm", "stopwatch", "schedule", "clock", "remind"),
    "jarvis_close_app": ("close", "kill", "terminate", "stop", "app", "window"),
    "jarvis_run_terminal": ("terminal", "command", "shell", "powershell", "cmd", "run", "execute", "cli"),
    "jarvis_send_stdin": ("stdin", "input", "press", "enter", "key", "interactive"),
    "jarvis_keyboard_input": ("keyboard", "type", "press", "key", "shortcut"),
    "jarvis_media_playback_control": ("pause", "next", "previous", "media", "music", "playback", "stop"),
    "jarvis_analyze_image": ("screenshot", "image", "vision", "picture", "photo", "scan", "analyze"),
    "jarvis_see_screen": ("screen", "look", "see", "watch", "display", "view", "monitor", "desktop", "window", "current"),
    "jarvis_html_graphics": ("diagram", "flowchart", "pixel", "art", "illustration", "svg", "canvas", "animate", "visual", "architecture", "uml", "wireframe", "draw", "sketch", "icon", "logo"),
    "jarvis_html_viewer": ("html", "page", "website", "dashboard", "interactive", "full", "document", "form", "button", "layout", "webpage", "embed", "open", "file", "serve", "local"),
    "jarvis_find_files_by_glob": ("glob", "find", "search", "pattern", "files", "match"),
    "jarvis_grep_files": ("grep", "search", "find", "pattern", "content", "code", "source", "files", "symbol", "function", "keyword", "line"),

    # Legacy Basic Mode Tools
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
    """Return a compact, ranked tool list containing always-included core tools + query-matched tools."""
    if not tools:
        return []

    # Detect if we are in Jarvis mode (contains jarvis_* tool definitions)
    is_jarvis = any(_tool_name(t).startswith("jarvis_") for t in tools)
    if is_jarvis:
        configured = getattr(config, "ALWAYS_INCLUDED_JARVIS_TOOLS", None)
        if configured is not None:
            always_names = set(configured)
        else:
            always_names = _ALWAYS_INCLUDED_JARVIS_TOOLS
    else:
        always_names = _ALWAYS_INCLUDED_BASIC_TOOLS

    always_tools = [t for t in tools if _tool_name(t) in always_names]
    always_tool_names = {_tool_name(t) for t in always_tools}

    query_terms = _expand_query_terms(_tokens(user_message))
    if not query_terms:
        return always_tools or list(tools)[:max_tools]

    scored = []
    for index, tool in enumerate(tools):
        name = _tool_name(tool)
        if name in always_tool_names:
            continue
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
    
    # If confidence is low (e.g. casual chitchat), return ONLY the always-included core tools!
    if not scored or scored[0][0] < fallback_threshold:
        return always_tools or list(tools)[:max_tools]

    # Otherwise, return always-included tools + top query-matched action tools
    matched_tools = [tool for score, _, tool in scored if score > 0][:max(1, max_tools - len(always_tools))]
    return always_tools + matched_tools


def _tokens(text) -> set[str]:
    if isinstance(text, list):
        text = " ".join(str(p) for p in text)
    return {token for token in _TOKEN_RE.findall(str(text or "").lower()) if token not in _STOPWORDS}


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
