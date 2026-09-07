"""Schema-text tool selection for compact but high-recall tool prompts."""

from __future__ import annotations

import re
from typing import Any, Iterable, Sequence

import app.config as config

DEFAULT_MAX_TOOLS = 8
DEFAULT_MAX_TOOLS_JARVIS = 14
DEFAULT_FALLBACK_THRESHOLD = 0.08

_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could", "do", "for",
    "from", "get", "give", "i", "in", "is", "it", "me", "my", "of", "on", "or", "please",
    "show", "tell", "that", "the", "this", "to", "up", "use", "want", "what", "with", "you",
}

_QUERY_EXPANSIONS = {
    "agenda": ("todo", "tasks", "list", "today", "daily", "yesterday", "tomorrow"),
    "app": ("application", "program", "launch", "open"),
    "application": ("app", "program", "launch", "open"),
    "architecture": ("diagram", "system", "uml", "schema", "flowchart", "svg"),
    "art": ("graphics", "artwork", "draw", "paint", "illustration", "canvas", "svg"),
    "artwork": ("graphics", "art", "paint", "draw", "canvas", "svg"),
    "browse": ("web", "internet", "search"),
    "browser": ("web", "internet", "url", "launch"),
    "choice": ("option", "choose", "select", "pick", "decide", "ask"),
    "choose": ("choice", "option", "select", "pick", "decide", "ask"),
    "clarify": ("ask", "question", "choice", "option", "confirm"),
    "clip": ("screenshot", "capture"),
    "dashboard": ("html", "page", "interactive", "widget"),
    "decide": ("choice", "choose", "pick", "option", "select", "ask"),
    "diagram": ("svg", "flowchart", "architecture", "visual", "wireframe", "graph", "schema", "graphics"),
    "dir": ("directory", "folder", "list", "file"),
    "draw": ("graphics", "svg", "canvas", "pixel", "visual", "sketch", "artwork", "diagram"),
    "flowchart": ("svg", "diagram", "process", "visual", "workflow", "graphics"),
    "flux": ("diffusion", "ai", "generate_image"),
    "folder": ("directory", "file", "open", "list", "search"),
    "generate": ("diffusion", "ai", "flux", "imagen", "generate_image"),
    "google": ("web", "internet", "search"),
    "graphics": ("canvas", "svg", "draw", "pixel", "visual", "diagram", "display"),
    "illustration": ("graphics", "draw", "art", "canvas", "svg"),
    "imagen": ("diffusion", "ai", "generate_image"),
    "internet": ("web", "search", "browse"),
    "local": ("file", "html", "serve", "disk"),
    "movie": ("video", "media", "play", "file"),
    "music": ("audio", "media", "play", "file"),
    "open": ("launch", "file", "directory", "application"),
    "outfit": ("costume", "clothes", "dress", "hat", "wear", "change", "avatar", "model", "uniform"),
    "costume": ("outfit", "clothes", "dress", "wear", "avatar"),
    "clothes": ("outfit", "costume", "dress", "wear", "change"),
    "character": ("avatar", "model", "outfit", "costume", "change"),
    "mita": ("avatar", "model", "character", "outfit", "costume", "change"),
    "skin": ("outfit", "costume", "avatar", "model", "wear"),
    "cosplay": ("outfit", "costume", "avatar", "model", "wear"),
    "hat": ("outfit", "wear", "put", "clothes", "avatar", "costume"),
    "wear": ("outfit", "costume", "clothes", "dress", "hat", "avatar", "model"),
    "veer": ("wear", "outfit", "clothes", "dress", "hat", "avatar"),
    "swimsuit": ("outfit", "bikini", "clothes", "costume", "avatar"),
    "bikini": ("outfit", "swimsuit", "clothes", "costume", "avatar"),
    "dress": ("outfit", "clothes", "costume", "wear", "avatar"),
    "page": ("html", "dashboard", "interactive", "website"),
    "paint": ("draw", "graphics", "canvas", "svg", "artwork", "visual"),
    "photo": ("image", "picture", "photograph", "graphics", "card"),
    "photograph": ("photo", "picture"),
    "pic": ("picture", "photo", "image", "graphics", "card"),
    "picture": ("image", "photo", "graphics", "draw", "card", "visual"),
    "pixel": ("graphics", "canvas", "svg", "draw", "pixelart", "sprite", "8bit", "retro"),
    "pixelart": ("graphics", "canvas", "svg", "draw", "pixel", "sprite", "8bit", "retro"),
    "play": ("media", "audio", "video", "file"),
    "portrait": ("drawing", "art", "photo", "graphics"),
    "pull": ("open", "launch", "show"),
    "run": ("execute", "terminal", "command", "script"),
    "search": ("find", "lookup", "web", "file"),
    "serve": ("html", "file", "local", "open"),
    "sketch": ("draw", "graphics", "svg", "canvas", "artwork", "drawing"),
    "start": ("launch", "open", "play"),
    "stop": ("stopwatch", "timer"),
    "stopwatch": ("stop watch", "stop-watch", "timer"),
    "time": ("date", "current", "datetime"),
    "video": ("media", "movie", "play", "file", "watch"),
    "visual": ("graphics", "svg", "canvas", "diagram", "illustration"),
    "wallpaper": ("scenery", "background", "image"),
    "watch": ("stopwatch", "video", "media", "play", "open"),
    "web": ("internet", "search", "browse"),
    "website": ("html", "page", "dashboard"),
    "wireframe": ("diagram", "architecture", "svg", "schema", "graphics"),
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
    "jarvis_change_avatar_outfit",
}

_ALWAYS_INCLUDED_BASIC_TOOLS = {
    "run_python_script",
    "update_user_fact",
    "web_search",
    "manage_personal_list",
    "change_avatar_outfit",
}

_TOOL_HINTS = {
    # Jarvis Autonomous Mode Tools
    "jarvis_run_python": ("python", "script", "code", "run", "execute", "math", "pandas", "numpy", "calc", "data", "processing"),
    "jarvis_remember_user_fact": ("remember", "memory", "preference", "name", "fact", "user", "like", "dislike", "save"),
    "jarvis_web_search": ("web", "internet", "search", "google", "lookup", "browse", "find", "online", "news", "breaking", "headlines", "latest", "article", "update"),
    "jarvis_web_scrape": ("scrape", "extract", "fetch", "url", "page", "site", "webpage", "article", "html", "download", "link"),
    "jarvis_query_file_db": ("find", "search", "file", "db", "query", "database", "index", "folder", "locate"),
    "jarvis_read_file": ("read", "view", "open", "file", "cat", "lines", "source", "code", "content"),
    "jarvis_create_or_edit_file": ("create", "write", "new", "file", "edit", "modify", "save"),
    "jarvis_replace_file_content": ("replace", "edit", "change", "file", "modify", "patch"),
    "jarvis_list_dir_tree": ("dir", "directory", "tree", "list", "folder", "files", "ls"),
    "jarvis_git_status": ("git", "repo", "commit", "status", "branch", "diff", "vcs"),
    "manage_personal_list": ("shopping", "groceries", "grocery", "list", "checklist", "buy", "errands", "today", "yesterday", "tomorrow", "todo", "todos", "agenda", "daily", "tasks", "wishlist", "pack", "items", "rollover"),
    "jarvis_manage_personal_list": ("shopping", "groceries", "grocery", "list", "checklist", "buy", "errands", "today", "yesterday", "tomorrow", "todo", "todos", "agenda", "daily", "tasks", "wishlist", "pack", "items", "rollover"),
    "manage_todo": ("todo", "subtask", "track", "progress", "plan", "steps"),
    "jarvis_system_diagnostics": ("cpu", "ram", "memory", "disk", "stats", "system", "health", "battery", "performance"),
    "jarvis_launch_app": ("open", "launch", "start", "app", "application", "program", "browser", "exec"),
    "jarvis_open_or_play_file": ("open", "play", "media", "video", "audio", "file", "folder", "watch", "music"),
    "jarvis_window_control": ("window", "minimize", "maximize", "focus", "move", "close"),
    "jarvis_system_volume": ("volume", "sound", "audio", "mute", "unmute", "loud", "speaker", "level"),
    "jarvis_system_power": ("shutdown", "restart", "reboot", "sleep", "lock", "power"),
    "jarvis_manage_timer_stopwatch_alarms": ("timer", "reminder", "alarm", "stopwatch", "schedule", "clock", "remind","create","start"),
    "jarvis_close_app": ("close", "kill", "terminate", "stop", "app", "window"),
    "jarvis_run_terminal": ("terminal", "command", "shell", "powershell", "cmd", "run", "execute", "cli"),
    "jarvis_send_stdin": ("stdin", "input", "press", "enter", "key", "interactive"),
    "jarvis_keyboard_mouse_input": ("keyboard", "mouse", "type", "press", "key", "shortcut", "click", "scroll", "move"),
    "jarvis_media_playback_control": ("pause", "next", "previous", "media", "music", "playback", "stop"),
    "jarvis_get_image": ("image", "picture", "photo", "inspect", "view", "vision", "load", "attach", "get"),
    "jarvis_analyze_image": ("screenshot", "image", "vision", "picture", "photo", "scan", "analyze"),
    "jarvis_generate_image": ("generate_image", "generate an image", "generate image", "ai generate", "diffusion", "flux", "imagen", "dall-e", "midjourney", "text-to-image", "ai photo", "ai image"),
    "jarvis_see_screen": ("screen", "look", "see", "watch", "display", "view", "monitor", "desktop", "window", "current"),
    "jarvis_html_graphics": ("graphics", "draw", "drawing", "pixel", "pixelart", "svg", "canvas", "diagram", "flowchart", "architecture", "uml", "wireframe", "graph", "schema", "visual", "card", "banner", "sprite", "8bit", "paint", "sketch", "illustration", "picture", "photo", "pic", "image", "photo"),
    "jarvis_html_viewer": ("html", "page", "website", "dashboard", "interactive", "full", "document", "form", "button", "layout", "webpage", "embed", "open", "file", "serve", "local"),
    "jarvis_find_files_by_glob": ("glob", "find", "search", "pattern", "files", "match"),
    "jarvis_grep_files": ("grep", "search", "find", "pattern", "content", "code", "source", "files", "symbol", "function", "keyword", "line"),
    "ask_user": ("ask", "question", "clarify", "choice", "options", "choose", "pick", "select", "which", "decision", "tradeoff", "prompt", "poll"),
    "telegram_send_screenshot": ("screenshot", "screen", "capture", "send", "snap", "display", "monitor", "telegram", "phone", "mobile", "desktop"),
    "telegram_send_file": ("send", "upload", "file", "folder", "document", "photo", "image", "transfer", "export", "telegram", "share", "drop"),
    "change_avatar_outfit": ("outfit", "costume", "clothes", "wear", "wearing", "hat", "dress", "change", "avatar", "model", "uniform", "version", "appearance", "mita", "character", "skin", "cosplay", "switch", "kind", "bikini", "swimsuit", "veer", "cute", "sexy", "spicy", "casual", "cool", "something", "look", "into"),
    "jarvis_change_avatar_outfit": ("outfit", "costume", "clothes", "wear", "wearing", "hat", "dress", "change", "avatar", "model", "uniform", "version", "appearance", "mita", "character", "skin", "cosplay", "switch", "kind", "bikini", "swimsuit", "veer", "cute", "sexy", "spicy", "casual", "cool", "something", "look", "into"),

    # Legacy Basic Mode Tools
    "generate_image": ("generate_image", "generate an image", "ai generate", "diffusion", "flux", "imagen", "dall-e"),
    "open_or_play_file": ("open", "play", "media", "video", "audio", "file", "folder", "watch", "anime"),
    "search_files": ("search", "find", "file", "folder", "directory", "locate", "anime"),
    "list_directory": ("list", "directory", "folder", "files"),
    "launch_app": ("open", "launch", "start", "app", "application", "program", "browser"),
    "web_search": ("web", "internet", "search", "google", "lookup", "browse", "news", "breaking", "headlines", "latest"),
    "run_terminal_command": ("terminal", "command", "shell", "powershell", "cmd", "run", "execute"),
    "run_python_script": ("python", "script", "code", "run", "execute"),
    "take_screenshot": ("screenshot", "capture", "screen", "image"),
    "set_system_volume": ("volume", "sound", "audio", "mute", "loud", "speaker", "level"),
    "media_playback_control": ("pause", "next", "previous", "media", "music", "playback"),
    "control_window": ("window", "minimize", "maximize", "focus", "move", "close"),
    "keyboard_mouse_input": ("keyboard", "mouse", "type", "click", "press", "scroll"),
    "manage_process": ("process", "task", "kill", "running"),
    "system_power_control": ("shutdown", "restart", "reboot", "sleep", "lock", "sign", "power"),
    "get_current_datetime": ("time", "date", "today", "now", "current"),
    "get_system_stats": ("cpu", "ram", "memory", "disk", "system", "stats", "pc"),
    "update_user_fact": ("remember", "memory", "preference", "name", "interest", "fact"),
    "manage_timer_stopwatch_alarms": ("timer", "reminder", "alarm", "stopwatch", "schedule", "remind", "clock", "countdown","start","create"),
    "manage_scheduled_task": ("schedule", "scheduled", "task", "delayed", "later", "interval", "repeat", "every", "watch", "watcher", "monitor", "poll", "after", "seconds", "shutdown", "trigger", "autonomous"),
    "create_file": ("create", "write", "new", "file"),
    "edit_file": ("edit", "replace", "change", "file"),
    "delete_file": ("delete", "remove", "file"),
}

# Default tool allowlist shipped to the coding LLM in Coder Mode. Used as the
# baseline for the user-configurable "Included Coder Tools" setting
# (config.INCLUDED_CODER_TOOLS); when that setting is unset (None), this set
# is used verbatim. Codegraph tools are appended dynamically when enabled.
_DEFAULT_CODING_TOOLS = {
    "jarvis_run_terminal", "jarvis_run_python", "jarvis_read_file",
    "jarvis_create_or_edit_file", "jarvis_replace_file_content",
    "jarvis_list_dir_tree", "jarvis_git_status", "jarvis_find_files_by_glob",
    "jarvis_grep_files",
    "jarvis_web_search", "jarvis_web_scrape", "jarvis_system_diagnostics",
    "jarvis_send_stdin", "read_and_review_file", "search_files",
    "read_file_content", "run_terminal_command", "run_python_script",
    "jarvis_get_image", "jarvis_analyze_image", "jarvis_see_screen", "manage_todo", "ask_user"
}

_TOKEN_RE = re.compile(r"[a-z0-9_]+")

_RECENT_TOOLS: list[str] = []
_HISTORY_BOOTSTRAPPED: bool = False


def record_recent_tool(tool_name: str) -> None:
    """Record an executed tool name at the front of the recent tools history."""
    global _RECENT_TOOLS, _HISTORY_BOOTSTRAPPED
    if not tool_name or not isinstance(tool_name, str):
        return
    name = tool_name.strip()
    if not name:
        return
    if not _HISTORY_BOOTSTRAPPED:
        _bootstrap_recent_tools()
    if name in _RECENT_TOOLS:
        _RECENT_TOOLS.remove(name)
    _RECENT_TOOLS.insert(0, name)
    if len(_RECENT_TOOLS) > 20:
        del _RECENT_TOOLS[20:]


def get_recent_tools(limit: int = 2) -> list[str]:
    """Return the last `limit` unique tool names used in reverse chronological order."""
    global _RECENT_TOOLS, _HISTORY_BOOTSTRAPPED
    if not _HISTORY_BOOTSTRAPPED:
        _bootstrap_recent_tools()
    return list(_RECENT_TOOLS[:limit])


def _bootstrap_recent_tools() -> None:
    """Bootstrap in-memory recent tools from durable journal if available."""
    global _RECENT_TOOLS, _HISTORY_BOOTSTRAPPED
    _HISTORY_BOOTSTRAPPED = True
    try:
        from app.agent.tool_journal import get_recent_tool_names
        recent = get_recent_tool_names(limit=10)
        for name in reversed(recent):
            if name not in _RECENT_TOOLS:
                _RECENT_TOOLS.insert(0, name)
    except Exception as e:
        print(f"[ToolSelector] Could not bootstrap tool history from journal: {e}")


def select_relevant_tools(
    tools: Sequence[dict[str, Any]],
    user_message: str,
    *,
    max_tools: int | None = None,   
    fallback_threshold: float = DEFAULT_FALLBACK_THRESHOLD,
) -> list[dict[str, Any]]:
    """Return a compact, ranked tool list containing always-included core tools + query-matched tools + recent history tools."""
    if not tools:
        return []

    # Detect if we are in Jarvis mode (contains jarvis_* tool definitions)
    is_jarvis = any(_tool_name(t).startswith("jarvis_") for t in tools)

    if max_tools is None:
        max_tools = DEFAULT_MAX_TOOLS_JARVIS if is_jarvis else DEFAULT_MAX_TOOLS

    print(f"[MAX TOOLS] = {max_tools}")

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
        base_tools = list(always_tools) or list(tools)[:max_tools]
    else:
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
                name_bonus = 0.22 if query_terms & set(name.split("_")) else 0.0
                hint_bonus = 0.12 if query_terms & hint_terms else 0.0
                score = len(overlap) / max(len(query_terms), 1) + name_bonus + hint_bonus
            scored.append((score, -index, tool))

        scored.sort(key=lambda item: (item[0], item[1]), reverse=True)

        debug_view = [(round(score, 4), -neg_index, _tool_name(tool)) for score, neg_index, tool in scored]
        print(f"[SCORED] max_tools={max_tools} query={sorted(query_terms)}")
        for score, index, name in debug_view:
            print(f"  {score:>7.4f}  idx={index:<3d}  {name}")
        
        # If confidence is low (e.g. casual chitchat), use ONLY the always-included core tools!
        if not scored or scored[0][0] < fallback_threshold:
            base_tools = list(always_tools) or list(tools)[:max_tools]
        else:
            # Otherwise, use always-included tools + top query-matched action tools
            matched_tools = [tool for score, _, tool in scored if score > 0][:max(1, max_tools - len(always_tools))]
            base_tools = list(always_tools) + matched_tools

    # Append the last 2 unique tools from history if not already in the list
    recent_names = get_recent_tools(limit=2)
    if recent_names:
        present_names = {_tool_name(t) for t in base_tools}
        tools_by_name = {_tool_name(t): t for t in tools}
        appended_history = []
        for r_name in recent_names:
            if r_name not in present_names and r_name in tools_by_name:
                appended_history.append(tools_by_name[r_name])
                present_names.add(r_name)
        if appended_history:
            history_names_str = ", ".join(_tool_name(t) for t in appended_history)
            print(f"[Tools] Appended {len(appended_history)} history tools to payload ({len(base_tools)} base -> {len(base_tools) + len(appended_history)} total): {history_names_str}")
            return base_tools + appended_history

    return base_tools



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
