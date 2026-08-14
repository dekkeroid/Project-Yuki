"""Yuki stdio MCP server.

This module exposes Yuki's existing local tools through the Model Context
Protocol over stdio. It is intended to be launched by an MCP host/client as a
subprocess, so stdout must contain MCP JSON-RPC messages only. Tool-side logs
are redirected to stderr inside each call.
"""

from __future__ import annotations

import asyncio
import inspect
import sys
from contextlib import redirect_stdout
from typing import Any

from mcp.server.fastmcp import FastMCP

from app.memory.local_mem import MemoryManager
from app.tools import files as file_tools
from app.tools import system as system_tools
from app.tools import web as web_tools
from app.tools.safety import authorize_tool_call

mcp = FastMCP("yuki")
_memory = MemoryManager()
_stdout_lock = asyncio.Lock()


def _run_with_stderr_logging(func: Any, *args: Any, **kwargs: Any) -> Any:
    """Run a synchronous callable while keeping stdout safe for stdio MCP."""
    with redirect_stdout(sys.stderr):
        return func(*args, **kwargs)


async def _safe_tool_call(func: Any, *args: Any, **kwargs: Any) -> str:
    """Run an existing Yuki tool without corrupting the stdio MCP stream."""
    async with _stdout_lock:
        if inspect.iscoroutinefunction(func):
            with redirect_stdout(sys.stderr):
                result = await func(*args, **kwargs)
        else:
            result = await asyncio.to_thread(_run_with_stderr_logging, func, *args, **kwargs)
    return "" if result is None else str(result)


async def _guarded_tool_call(tool_name: str, func: Any, raw_args: dict[str, Any]) -> str:
    """Apply the server-side safety policy before running a tool."""
    decision = authorize_tool_call(tool_name, raw_args, consume_grant=True)
    if not decision.allowed:
        return decision.message
    return await _safe_tool_call(func, **(decision.arguments or {}))


@mcp.tool()
async def get_system_stats() -> str:
    """Get system CPU, RAM, disk usage, active IP, OS version, and current date/time."""
    return await _guarded_tool_call("get_system_stats", system_tools.get_system_stats, {})


@mcp.tool()
async def get_current_datetime() -> str:
    """Get the current local date and time."""
    return await _guarded_tool_call("get_current_datetime", system_tools.get_current_datetime, {})


@mcp.tool()
async def launch_app(
    app_name: str,
    args: str | None = None,
    run_as_admin: bool = False,
    new_window: bool = False,
    confirmation_grant_id: str | None = None,
) -> str:
    """Launch a desktop app, switch to an existing open window, or open a URL in the browser. Requires backend confirmation."""
    return await _guarded_tool_call(
        "launch_app",
        system_tools.launch_app,
        {
            "app_name": app_name,
            "args": args,
            "run_as_admin": run_as_admin,
            "new_window": new_window,
            "confirmation_grant_id": confirmation_grant_id,
        },
    )


@mcp.tool()
async def set_system_volume(volume_level: int) -> str:
    """Set speaker volume percentage from 0 to 100."""
    return await _guarded_tool_call("set_system_volume", system_tools.set_system_volume, {"volume_level": volume_level})


@mcp.tool()
async def update_user_fact(key: str, value: str) -> str:
    """Save a remembered fact, name, interest, or preference about the user."""

    def update() -> str:
        normalized_key = (key or "").lower().strip()
        if normalized_key in ("name", "user_name", "username"):
            return str(_memory.set_user_name(value))
        if normalized_key in ("interest", "user_interest", "hobby"):
            return str(_memory.add_interest(value))
        return str(_memory.update_fact(key, value))

    decision = authorize_tool_call("update_user_fact", {"key": key, "value": value}, consume_grant=True)
    if not decision.allowed:
        return decision.message
    return await _safe_tool_call(update)


@mcp.tool()
async def list_directory(directory_path: str | None = None) -> str:
    """List files and folders in a directory path."""
    return await _guarded_tool_call("list_directory", file_tools.list_directory, {"directory_path": directory_path})


@mcp.tool()
async def search_files(query: str, start_directory: str | None = None) -> str:
    """Search local indexed files by natural-language query, optionally from a starting directory."""
    return await _guarded_tool_call(
        "search_files",
        file_tools.search_files,
        {"query": query, "start_directory": start_directory},
    )


@mcp.tool()
async def jarvis_grep_files(
    pattern: str,
    file_pattern: str | None = None,
    search_dir: str | None = None,
    case_sensitive: bool = False,
    max_results: int = 100,
) -> str:
    """Search file contents for a regex pattern, returning path:line: <matching line> hits."""
    return await _guarded_tool_call(
        "jarvis_grep_files",
        system_tools.jarvis_grep_files,
        {
            "pattern": pattern,
            "file_pattern": file_pattern,
            "search_dir": search_dir,
            "case_sensitive": case_sensitive,
            "max_results": max_results,
        },
    )


@mcp.tool()
async def jarvis_find_files_by_glob(pattern: str, search_dir: str | None = None) -> str:
    """Find files matching a glob pattern inside a folder. Bare patterns like '*.py' match at any depth."""
    return await _guarded_tool_call(
        "jarvis_find_files_by_glob",
        system_tools.find_files_by_glob,
        {"pattern": pattern, "search_dir": search_dir},
    )


@mcp.tool()
async def open_or_play_file(
    file_path_or_query: str,
    play_mode: bool = False,
    confirmed: bool = False,
    confirmation_grant_id: str | None = None,
) -> str:
    """Open a file/app/folder or play media. Risky targets require backend confirmation."""
    return await _guarded_tool_call(
        "open_or_play_file",
        file_tools.open_or_play_file,
        {
            "file_path_or_query": file_path_or_query,
            "play_mode": play_mode,
            "confirmed": confirmed,
            "confirmation_grant_id": confirmation_grant_id,
        },
    )


@mcp.tool()
async def create_file(file_path: str, content: str = "", confirmation_grant_id: str | None = None) -> str:
    """Create a text file at an allowed path. Requires backend confirmation."""
    return await _guarded_tool_call(
        "create_file",
        file_tools.create_file,
        {"file_path": file_path, "content": content, "confirmation_grant_id": confirmation_grant_id},
    )


@mcp.tool()
async def edit_file(
    file_path: str,
    search_text: str,
    replace_text: str,
    confirmation_grant_id: str | None = None,
) -> str:
    """Edit a text file by replacing the first exact search_text match. Requires backend confirmation."""
    return await _guarded_tool_call(
        "edit_file",
        file_tools.edit_file,
        {
            "file_path": file_path,
            "search_text": search_text,
            "replace_text": replace_text,
            "confirmation_grant_id": confirmation_grant_id,
        },
    )


@mcp.tool()
async def delete_file(file_path: str, confirmed: bool = False, confirmation_grant_id: str | None = None) -> str:
    """Delete one file at an allowed path. Requires backend confirmation."""
    return await _guarded_tool_call(
        "delete_file",
        file_tools.delete_file,
        {"file_path": file_path, "confirmed": confirmed, "confirmation_grant_id": confirmation_grant_id},
    )


@mcp.tool()
async def read_file_content(file_path: str) -> str:
    """Read the contents of a local text, code, or PDF file."""
    return await _guarded_tool_call("read_file_content", file_tools.read_file_content, {"file_path": file_path})


@mcp.tool()
async def control_window(
    action: str,
    window_title: str | None = None,
    x: int | None = None,
    y: int | None = None,
    confirmation_grant_id: str | None = None,
) -> str:
    """Control windows: focus, minimize, maximize, close, move, or resize. Close requires confirmation."""
    return await _guarded_tool_call(
        "control_window",
        system_tools.control_window,
        {
            "action": action,
            "window_title": window_title,
            "x": x,
            "y": y,
            "confirmation_grant_id": confirmation_grant_id,
        },
    )


@mcp.tool()
async def run_terminal_command(
    command: str,
    use_powershell: bool = True,
    confirmation_grant_id: str | None = None,
) -> str:
    """Run a terminal command and return output. Requires confirmation and sandbox checks."""
    return await _guarded_tool_call(
        "run_terminal_command",
        system_tools.run_terminal_command,
        {"command": command, "use_powershell": use_powershell, "confirmation_grant_id": confirmation_grant_id},
    )


@mcp.tool()
async def run_python_script(code: str, confirmation_grant_id: str | None = None) -> str:
    """Run a Python script and return output. Requires backend confirmation."""
    return await _guarded_tool_call(
        "run_python_script",
        system_tools.run_python_script,
        {"code": code, "confirmation_grant_id": confirmation_grant_id},
    )


@mcp.tool()
async def take_screenshot() -> str:
    """Take a screenshot and return the saved screenshot path."""
    return await _guarded_tool_call("take_screenshot", system_tools.take_screenshot, {})


@mcp.tool()
async def keyboard_mouse_input(
    action: str,
    text: str | None = None,
    keys: list[str] | None = None,
    x: int | None = None,
    y: int | None = None,
    amount: int | None = None,
    confirmation_grant_id: str | None = None,
) -> str:
    """Send keyboard or mouse input: type, press, hotkey, click, move, or scroll. Requires confirmation."""
    return await _guarded_tool_call(
        "keyboard_mouse_input",
        system_tools.keyboard_mouse_input,
        {
            "action": action,
            "text": text,
            "keys": keys,
            "x": x,
            "y": y,
            "amount": amount,
            "confirmation_grant_id": confirmation_grant_id,
        },
    )


@mcp.tool()
async def media_playback_control(action: str) -> str:
    """Control media playback: play_pause, next, previous, stop, volume_up, or volume_down."""
    return await _guarded_tool_call("media_playback_control", system_tools.media_playback_control, {"action": action})


@mcp.tool()
async def manage_process(
    action: str,
    name: str | None = None,
    pid: int | None = None,
    confirmation_grant_id: str | None = None,
) -> str:
    """List running processes or kill a process by name or PID. Kill requires confirmation."""
    return await _guarded_tool_call(
        "manage_process",
        system_tools.manage_process,
        {"action": action, "name": name, "pid": pid, "confirmation_grant_id": confirmation_grant_id},
    )


@mcp.tool()
async def system_power_control(action: str, confirmed: bool = False, confirmation_grant_id: str | None = None) -> str:
    """Perform power controls. Shutdown/restart are sandbox-blocked by default; others require confirmation."""
    return await _guarded_tool_call(
        "system_power_control",
        system_tools.system_power_control,
        {"action": action, "confirmed": confirmed, "confirmation_grant_id": confirmation_grant_id},
    )


@mcp.tool()
async def web_search(query: str) -> str:
    """Search the web for information."""
    return await _guarded_tool_call("web_search", web_tools.web_search, {"query": query})


@mcp.tool()
async def manage_timer_stopwatch_alarms(
    action: str,
    duration_seconds: int | None = None,
    target_time: str | None = None,
    message: str | None = None,
    recurrence: str | None = None,
    action_command: str | None = None,
    label: str | None = None,
    item_id: int | None = None
) -> str:
    """Manage timers, scheduled reminders, alarms, stopwatches, and background scheduled tasks.
    
    action options:
    - 'set_timer': set countdown timer (e.g. action='set_timer', duration_seconds=600, message='Check oven')
    - 'set_reminder': schedule reminder/alarm (e.g. action='set_reminder', target_time='5:30 PM', message='Call Mom')
    - 'start_stopwatch': start stopwatch (e.g. action='start_stopwatch', label='gaming')
    - 'check_stopwatch': check elapsed time (e.g. action='check_stopwatch', label='gaming')
    - 'stop_stopwatch': stop stopwatch (e.g. action='stop_stopwatch', label='gaming')
    - 'list_active': list all active timers and stopwatches
    - 'cancel': cancel timer or reminder by item_id
    """
    from app.tools import time_manager
    action_clean = (action or "").lower().strip()
    
    if action_clean in ("set_timer", "timer"):
        dur = duration_seconds or time_manager.parse_duration_seconds(target_time or "5m")
        res = time_manager.add_timer(dur, message or "Timer Up!", action_command)
        return f"Successfully set a {res['formatted_duration']} timer for '{res['message']}'."
    elif action_clean in ("set_alarm", "alarm", "create_alarm", "add_alarm"):
        if duration_seconds or (target_time and any(u in target_time.lower() for u in ["sec", "min", "in "])):
            dur = duration_seconds or time_manager.parse_duration_seconds(target_time or "5m")
            res = time_manager.add_timer(dur, message or "Alarm!", action_command, category="alarm")
            return f"Successfully set an alarm for {res['formatted_duration']} from now: '{res['message']}'."
        else:
            res = time_manager.add_reminder(target_time or "5m", message or "Alarm!", recurrence, action_command)
            return f"Successfully scheduled alarm for {res['target_time_formatted']}: '{res['message']}'."
    elif action_clean == "set_reminder":
        res = time_manager.add_reminder(target_time or "5m", message or "Reminder", recurrence, action_command)
        return f"Successfully scheduled reminder for {res['target_time_formatted']}: '{res['message']}'."
    elif action_clean == "start_stopwatch":
        res = time_manager.start_stopwatch(label or "default")
        return f"Started stopwatch '{res['label']}'."
    elif action_clean == "check_stopwatch":
        res = time_manager.check_stopwatch(label or "default")
        if res.get("status") == "ok":
            return f"Stopwatch '{res['label']}' elapsed time: {res['formatted_elapsed']}."
        return res.get("message", "Stopwatch not found.")
    elif action_clean == "stop_stopwatch":
        res = time_manager.stop_stopwatch(label or "default")
        if res.get("status") == "ok":
            return f"Stopped stopwatch '{res['label']}' at {res['formatted_elapsed']}."
        return res.get("message", "Stopwatch not found.")
    elif action_clean == "list_active":
        items = time_manager.get_active_time_items()
        rems = items.get("reminders", [])
        sws = items.get("stopwatches", [])
        out = []
        if rems:
            out.append("Active Timers & Reminders:\n" + "\n".join([f"- #{r['id']} [{r['category']}]: '{r['message']}' ({r['remaining_seconds']}s remaining)" for r in rems]))
        if sws:
            out.append("Active Stopwatches:\n" + "\n".join([f"- '{s['label']}': {s['formatted_elapsed']} elapsed" for s in sws]))
        return "\n\n".join(out) if out else "No active timers, reminders, or stopwatches."
    elif action_clean == "cancel":
        if item_id:
            time_manager.delete_reminder(item_id)
            return f"Successfully cancelled timer/reminder #{item_id}."
        return "Missing item_id for cancellation."
    return f"Unknown action '{action}' for manage_timer_stopwatch_alarms."


@mcp.tool()
async def manage_scheduled_task(
    action: str,
    kind: str | None = None,
    target: str | None = None,
    fire_condition: str | None = None,
    seconds: float | None = None,
    count: int | None = None,
    action_type: str | None = None,
    action_command: str | None = None,
    action_tool: str | None = None,
    action_args: dict | None = None,
    item_id: int | None = None,
    confirmation_grant_id: str | None = None,
) -> str:
    """Schedule autonomous tasks: delayed actions, recurring intervals, and watchers.

    action options:
    - 'set_delayed': fire once after `seconds` (e.g. seconds=30, action_tool='take_screenshot')
    - 'set_interval': fire every `seconds` (e.g. seconds=300, action_command='...')
    - 'watch': poll every `seconds`; fire when condition flips. `kind` in
      process/window/file/command; `fire_condition` e.g. process 'gone'/'present',
      window 'open'/'closed', file 'exists'/'deleted'/'changed', command 'exit0'/'exit_nonzero'.
      Example: watch a terminal PID and shut down the PC when it closes ->
      watch(kind='process', target='<pid>', seconds=30, fire_condition='gone',
            action_type='power', action_args={'action': 'shutdown'})
    - 'list': show active tasks
    - 'cancel': cancel by item_id

    Creating a task whose fired action is a power command or destructive shell
    command is confirmed ONCE at creation; the task then runs autonomously.
    """
    return await _guarded_tool_call(
        "manage_scheduled_task",
        _dispatch_scheduled_task,
        {
            "action": action,
            "kind": kind,
            "target": target,
            "fire_condition": fire_condition,
            "seconds": seconds,
            "count": count,
            "action_type": action_type,
            "action_command": action_command,
            "action_tool": action_tool,
            "action_args": action_args,
            "item_id": item_id,
            "confirmation_grant_id": confirmation_grant_id,
        },
    )


def _dispatch_scheduled_task(**kwargs) -> str:
    from app.tools import scheduled_tasks
    action_clean = (kwargs.get("action") or "").lower().strip()
    action_type = (kwargs.get("action_type") or "shell").lower().strip()
    action_args = kwargs.get("action_args") or {}
    if isinstance(action_args, str):
        try:
            import json
            action_args = json.loads(action_args)
        except Exception:
            action_args = {}

    if action_clean in ("set_delayed", "delayed"):
        seconds = kwargs.get("seconds") or 0
        try:
            seconds = float(seconds)
        except (ValueError, TypeError):
            seconds = 1.0
        if not seconds or seconds <= 0:
            return "Error: 'seconds' is required for set_delayed."
        res = scheduled_tasks.add_delayed(
            seconds,
            action_type=action_type,
            action_command=kwargs.get("action_command"),
            action_tool=kwargs.get("action_tool"),
            action_args=action_args,
        )
        return f"Scheduled task #{res['id']} to fire in {res['seconds']:.0f} seconds."

    if action_clean in ("set_interval", "interval"):
        seconds = kwargs.get("seconds") or 0
        try:
            seconds = float(seconds)
        except (ValueError, TypeError):
            seconds = 1.0
        if not seconds or seconds <= 0:
            return "Error: 'seconds' (interval) is required for set_interval."
        res = scheduled_tasks.add_interval(
            seconds,
            count=kwargs.get("count"),
            action_type=action_type,
            action_command=kwargs.get("action_command"),
            action_tool=kwargs.get("action_tool"),
            action_args=action_args,
        )
        return f"Interval task #{res['id']} every {res['interval_seconds']:.0f}s (count={kwargs.get('count')})."

    if action_clean in ("watch", "watcher", "monitor"):
        monitor = (kwargs.get("kind") or kwargs.get("monitor_type") or "").lower().strip()
        target = kwargs.get("target") or ""
        condition = (kwargs.get("fire_condition") or "gone").lower().strip()
        if not monitor or not target:
            return "Error: 'kind' (process/window/file/command) and 'target' are required for watch."
        seconds = kwargs.get("seconds") or 30
        try:
            seconds = float(seconds)
        except (ValueError, TypeError):
            seconds = 30.0
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
            action_command=kwargs.get("action_command"),
            action_tool=kwargs.get("action_tool"),
            action_args=action_args,
        )
        return (
            f"Watcher #{res['id']} active: every {res['interval_seconds']:.0f}s check {res['monitor_type']} "
            f"'{res['target']}' and fire when {res['fire_condition']}."
        )

    if action_clean == "list":
        items = scheduled_tasks.list_tasks(active_only=True).get("tasks", [])
        if not items:
            return "No active scheduled tasks."
        lines = []
        for t in items:
            kind_t = t.get("kind")
            if kind_t == "watcher":
                desc = f"{t.get('monitor_type')} '{t.get('target')}' -> {t.get('fire_condition')}"
            else:
                desc = f"every {t.get('interval_seconds')}s" if kind_t == "interval" else f"in {t.get('remaining_seconds')}s"
            action_desc = t.get("action_command") or t.get("action_tool") or t.get("action_type") or "shell"
            lines.append(f"- #{t['id']} [{kind_t}] {desc} -> {action_desc}")
        return "Active scheduled tasks:\n" + "\n".join(lines)

    if action_clean in ("cancel", "stop"):
        item_id = kwargs.get("item_id") or kwargs.get("id")
        if item_id:
            scheduled_tasks.cancel_task(int(item_id))
            return f"Cancelled scheduled task #{item_id}."
        return "Missing item_id for cancellation."

    return f"Unknown action '{action_clean}' for manage_scheduled_task."


def main() -> None:
    """Run the MCP server over stdio."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
