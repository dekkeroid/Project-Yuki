"""Scheduled tasks engine: delayed actions, recurring intervals, and watchers.

Sits alongside ``time_manager.py`` (timers/reminders) but is purpose-built for
"do this after N seconds", "do this every N seconds", and "watch X every N
seconds and run action when it changes" tasks — including firing Yuki *tool*
actions (e.g. take a screenshot) and one-time-confirmed power actions.

Design mirrors ``time_manager``:
  * persistence in the ``scheduled_tasks`` SQLite table
  * writes serialized through the shared ``DB_WRITE_LOCK``
  * each active task is an asyncio task scheduled on the main event loop
  * restored on startup by ``init_scheduled_task_scheduler()``
"""

import asyncio
import functools
import json
import os
import re
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional

from app.memory.db import get_connection, DB_WRITE_LOCK


def _write_locked(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        with DB_WRITE_LOCK:
            return func(*args, **kwargs)
    return wrapper


def _parse_duration_seconds(text: str) -> int:
    """Parses '30', '30 seconds', '5 minutes', '2 hours' into seconds."""
    if not text:
        return 0
    text_lower = str(text).lower().strip()
    if text_lower.isdigit():
        return int(text_lower)
    total = 0
    hrs = re.search(r"(\d+)\s*(?:hours?|hrs?|h\b)", text_lower)
    if hrs:
        total += int(hrs.group(1)) * 3600
    mins = re.search(r"(\d+)\s*(?:minutes?|mins?|m\b)", text_lower)
    if mins:
        total += int(mins.group(1)) * 60
    secs = re.search(r"(\d+)\s*(?:seconds?|secs?|s\b)", text_lower)
    if secs:
        total += int(secs.group(1))
    if total == 0:
        match = re.search(r"(\d+)", text_lower)
        if match:
            val = int(match.group(1))
            if "hour" in text_lower or "hr" in text_lower:
                return val * 3600
            if "min" in text_lower:
                return val * 60
            return val
    return total


# ── Conditions helpers (pure, testable) ─────────────────────────────────────

def _check_process_alive(target) -> bool:
    """True when a PID (numeric target) or process name is currently running."""
    target = str(target or "").strip()
    if not target:
        return False
    try:
        import psutil
    except Exception:
        return False
    try:
        if target.isdigit():
            return psutil.pid_exists(int(target))
        wanted = target.lower()
        for proc in psutil.process_iter(["pid", "name"]):
            try:
                name = proc.info.get("name") or ""
                if name.lower() == wanted:
                    return True
            except Exception:
                continue
    except Exception:
        return False
    return False


def _check_window_open(target) -> bool:
    """True when at least one visible window's title contains ``target``."""
    target = str(target or "").strip().lower()
    if not target:
        return False
    try:
        import win32gui

        found = False

        def _cb(hwnd, _results):
            nonlocal found
            try:
                if win32gui.IsWindowVisible(hwnd):
                    title = win32gui.GetWindowText(hwnd) or ""
                    if target in title.lower():
                        found = True
            except Exception:
                pass

        win32gui.EnumWindows(_cb, None)
        return found
    except Exception:
        pass
    try:
        import pygetwindow as gw
        return len(gw.getWindowsWithTitle(target)) > 0
    except Exception:
        return False


def _file_signature(path: str) -> Optional[tuple]:
    """(mtime, size) for a path, or None when it does not exist."""
    try:
        if not os.path.exists(path):
            return None
        st = os.stat(path)
        return (st.st_mtime, st.st_size)
    except Exception:
        return None


# Last observed state for 'changed' file watchers (keyed by task id).
_FILE_STATE: Dict[int, Any] = {}


def evaluate_watcher_condition(task: Dict[str, Any], previous_fired: bool) -> bool:
    """
    Returns True when the watcher's condition currently holds.

    ``monitor_type``/``fire_condition`` combos:
      process | gone|present
      window  | open|closed
      file    | exists|deleted|changed
      command | exit0|exit_nonzero   (runs ``target`` as a shell command each tick)
    """
    monitor = (task.get("monitor_type") or "").lower().strip()
    condition = (task.get("fire_condition") or "").lower().strip()
    target = task.get("target") or ""

    if monitor == "process":
        alive = _check_process_alive(target)
        return not alive if condition == "gone" else alive if condition == "present" else False

    if monitor == "window":
        open_now = _check_window_open(target)
        return not open_now if condition == "closed" else open_now if condition == "open" else False

    if monitor == "file":
        path = os.path.abspath(os.path.expanduser(os.path.expandvars(target)))
        sig = _file_signature(path)
        task_id = int(task.get("id") or 0)
        if condition == "exists":
            return sig is not None
        if condition == "deleted":
            return sig is None
        if condition == "changed":
            prev = _FILE_STATE.get(task_id)
            _FILE_STATE[task_id] = sig
            # First observation only records the baseline; never fires.
            if prev is None or sig is None:
                return False
            return sig != prev
        return False

    if monitor == "command":
        try:
            result = subprocess.run(
                str(target), shell=True, capture_output=True, text=True, timeout=60
            )
        except Exception:
            return condition == "exit_nonzero"
        if condition == "exit0":
            return result.returncode == 0
        if condition == "exit_nonzero":
            return result.returncode != 0
        return False

    return False


def _describe_watcher(task: Dict[str, Any]) -> str:
    monitor = task.get("monitor_type") or "unknown"
    condition = task.get("fire_condition") or "unknown"
    target = task.get("target") or ""
    return f"{monitor} '{target}' -> {condition}"


# ── Action execution ─────────────────────────────────────────────────────────

_action_executor = None
_main_loop: Optional[asyncio.AbstractEventLoop] = None
_running_tasks: Dict[int, Any] = {}


def set_action_executor(callback):
    """Register the executor callback that runs fired actions.

    Signature: ``callback(action_type, action_command, action_tool, action_args) -> str``.
    ``action_type`` is one of ``shell`` | ``power`` | ``tool``. Registered by
    ``main.py`` / ``AgentExecutor`` so the engine stays backend-agnostic.
    """
    global _action_executor
    _action_executor = callback


def set_main_loop(loop):
    global _main_loop
    _main_loop = loop


def _run_shell_action(command: str) -> str:
    try:
        subprocess.Popen(command, shell=True)
        print(f"[ScheduledTasks] Executed shell action: {command}")
        return f"shell action executed: {command}"
    except Exception as e:
        print(f"[ScheduledTasks] Shell action failed: {e}")
        return f"shell action failed: {e}"


def capture_screenshot(window_title: str = "", save_to: str = "") -> str:
    """Capture the full screen (or a specific window) to a PNG file and return its path.

    Pure capture — no vision analysis, so it is safe to run as a scheduled action.
    """
    try:
        from PIL import Image, ImageGrab
        import datetime

        bbox = None
        if window_title:
            from app.tools.jarvis import _find_window_bbox
            bbox = _find_window_bbox(window_title)

        img = None
        try:
            img = ImageGrab.grab(bbox=bbox, all_screens=True) if not bbox else ImageGrab.grab(bbox=bbox)
        except Exception:
            try:
                img = ImageGrab.grab(bbox=bbox)
            except Exception:
                pass

        if img is None:
            import pyautogui
            img = pyautogui.screenshot(region=bbox) if bbox else pyautogui.screenshot()

        if save_to:
            path = os.path.abspath(os.path.expanduser(save_to))
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        else:
            from app.utils.attachment_manager import get_attachment_directory
            stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            path = os.path.join(get_attachment_directory(), f"scheduled_capture_{stamp}.png")

        img.save(path, "PNG")
        print(f"[ScheduledTasks] Captured screenshot to '{path}'")
        return f"captured screenshot: {path}"
    except Exception as e:
        return f"screenshot failed: {e}"


def execute_action(task: Dict[str, Any]) -> str:
    """Run a task's action synchronously. Returns a human-readable result."""
    action_type = (task.get("action_type") or "shell").lower().strip()
    action_command = task.get("action_command")
    action_tool = task.get("action_tool")
    action_args = task.get("action_args")

    if action_type == "shell" and action_command:
        return _run_shell_action(action_command)

    if _action_executor is None:
        msg = "No action executor registered; cannot run scheduled action."
        print(f"[ScheduledTasks] {msg}")
        return msg

    try:
        return _action_executor(action_type, action_command, action_tool, action_args)
    except Exception as e:
        print(f"[ScheduledTasks] Action executor failed: {e}")
        return f"action failed: {e}"


# ── DB core actions ──────────────────────────────────────────────────────────

def _task_to_dict(row) -> Dict[str, Any]:
    item = dict(row)
    if item.get("action_args"):
        try:
            item["action_args"] = json.loads(item["action_args"])
        except Exception:
            item["action_args"] = {}
    return item


@_write_locked
def _insert_task(now: float, **fields) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO scheduled_tasks (
            created_at, kind, monitor_type, target, interval_seconds, count,
            fire_condition, action_type, action_command, action_tool, action_args,
            is_active, next_run_at, last_run_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            now,
            fields.get("kind") or "delayed",
            fields.get("monitor_type"),
            fields.get("target"),
            fields.get("interval_seconds"),
            fields.get("count"),
            fields.get("fire_condition"),
            fields.get("action_type") or "shell",
            fields.get("action_command"),
            fields.get("action_tool"),
            json.dumps(fields.get("action_args") or {}),
            int(fields.get("is_active", 1)),
            fields.get("next_run_at"),
            fields.get("last_run_at"),
        ),
    )
    conn.commit()
    task_id = cursor.lastrowid
    conn.close()
    return task_id


@_write_locked
def _mark_fired(task_id: int, *, deactivate: bool, next_run_at: Optional[float] = None) -> None:
    conn = get_connection()
    now = time.time()
    if deactivate:
        conn.execute(
            "UPDATE scheduled_tasks SET is_active = 0, last_run_at = ?, next_run_at = NULL WHERE id = ?",
            (now, task_id),
        )
    elif next_run_at is not None:
        conn.execute(
            "UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?",
            (now, next_run_at, task_id),
        )
    conn.commit()
    conn.close()


@_write_locked
def _fetch_task(task_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    row = conn.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return _task_to_dict(row) if row else None


def add_delayed(
    seconds: float,
    action_type: str = "shell",
    action_command: Optional[str] = None,
    action_tool: Optional[str] = None,
    action_args: Optional[dict] = None,
) -> Dict[str, Any]:
    """Fire a single action after ``seconds``."""
    try:
        seconds = float(seconds)
    except (ValueError, TypeError):
        seconds = 1.0
    seconds = max(1.0, seconds)
    now = time.time()
    task_id = _insert_task(
        now,
        kind="delayed",
        interval_seconds=seconds,
        count=1,
        action_type=action_type,
        action_command=action_command,
        action_tool=action_tool,
        action_args=action_args or {},
        next_run_at=now + seconds,
    )
    start_task(task_id)
    print(f"[ScheduledTasks] Delayed task #{task_id} scheduled to fire in {seconds:.0f}s")
    return {"status": "ok", "id": task_id, "kind": "delayed", "seconds": seconds}


def add_interval(
    interval_seconds: float,
    count: Optional[int] = None,
    action_type: str = "shell",
    action_command: Optional[str] = None,
    action_tool: Optional[str] = None,
    action_args: Optional[dict] = None,
) -> Dict[str, Any]:
    """Fire an action every ``interval_seconds``. ``count``=None means forever."""
    try:
        interval_seconds = float(interval_seconds)
    except (ValueError, TypeError):
        interval_seconds = 1.0
    interval_seconds = max(1.0, interval_seconds)
    now = time.time()
    task_id = _insert_task(
        now,
        kind="interval",
        interval_seconds=interval_seconds,
        count=count,
        action_type=action_type,
        action_command=action_command,
        action_tool=action_tool,
        action_args=action_args or {},
        next_run_at=now + interval_seconds,
    )
    start_task(task_id)
    print(f"[ScheduledTasks] Interval task #{task_id} every {interval_seconds:.0f}s (count={count})")
    return {"status": "ok", "id": task_id, "kind": "interval", "interval_seconds": interval_seconds, "count": count}


def add_watcher(
    monitor_type: str,
    target: str,
    interval_seconds: float,
    fire_condition: str = "gone",
    count: Optional[int] = 1,
    action_type: str = "shell",
    action_command: Optional[str] = None,
    action_tool: Optional[str] = None,
    action_args: Optional[dict] = None,
) -> Dict[str, Any]:
    """Watch ``monitor_type`` every ``interval_seconds`` and fire when the
    ``fire_condition`` holds. Default ``count=1`` fires once then stops."""
    try:
        interval_seconds = float(interval_seconds)
    except (ValueError, TypeError):
        interval_seconds = 1.0
    interval_seconds = max(1.0, interval_seconds)
    now = time.time()
    task_id = _insert_task(
        now,
        kind="watcher",
        monitor_type=(monitor_type or "").lower().strip(),
        target=str(target or "").strip(),
        interval_seconds=interval_seconds,
        count=count,
        fire_condition=(fire_condition or "gone").lower().strip(),
        action_type=action_type,
        action_command=action_command,
        action_tool=action_tool,
        action_args=action_args or {},
        next_run_at=now + interval_seconds,
    )
    start_task(task_id)
    print(f"[ScheduledTasks] Watcher #{task_id}: {_describe_watcher(dict(task_id=task_id, monitor_type=monitor_type, target=target, fire_condition=fire_condition))} every {interval_seconds:.0f}s")
    return {
        "status": "ok",
        "id": task_id,
        "kind": "watcher",
        "monitor_type": monitor_type,
        "target": target,
        "fire_condition": fire_condition,
        "interval_seconds": interval_seconds,
        "count": count,
    }


@_write_locked
def cancel_task(task_id: int) -> Dict[str, Any]:
    """Cancel and deactivate a scheduled task."""
    stop_task(task_id)
    conn = get_connection()
    conn.execute("UPDATE scheduled_tasks SET is_active = 0, next_run_at = NULL WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    _FILE_STATE.pop(task_id, None)
    return {"status": "ok", "id": task_id, "cancelled": True}


def list_tasks(active_only: bool = True) -> Dict[str, Any]:
    conn = get_connection()
    if active_only:
        rows = conn.execute("SELECT * FROM scheduled_tasks WHERE is_active = 1 ORDER BY next_run_at ASC").fetchall()
    else:
        rows = conn.execute("SELECT * FROM scheduled_tasks ORDER BY id DESC").fetchall()
    conn.close()
    now = time.time()
    tasks = []
    for row in rows:
        item = _task_to_dict(row)
        if item.get("next_run_at"):
            item["remaining_seconds"] = max(0, int(item["next_run_at"] - now))
        tasks.append(item)
    return {"tasks": tasks}


# ── Firing logic ─────────────────────────────────────────────────────────────

def _action_is_destructive(task: Dict[str, Any]) -> bool:
    """True when the fired action can shut down or alter system power state.

    Destructive actions are ALWAYS one-shot: they deactivate after the first
    fire, so a recurring/long-running task (or a leaked DB row) can never
    repeatedly shut down the PC.
    """
    action_type = str(task.get("action_type") or "").lower().strip()
    if action_type == "power":
        return True
    if action_type == "tool":
        tool = str(task.get("action_tool") or "").lower().strip()
        if tool in ("jarvis_system_power", "system_power_control"):
            return True
    command = str(task.get("action_command") or "")
    if command:
        try:
            import re as _re
            from app.tools.safety import _terminal_patterns
            for pattern in _terminal_patterns():
                if _re.search(pattern, command, flags=_re.IGNORECASE):
                    return True
        except Exception:
            pass
    return False


def _deactivate_after_fire(task: Dict[str, Any]) -> bool:
    """After firing, returns True when the task should stop (one-shot / count reached)."""
    if _action_is_destructive(task):
        return True
    kind = task.get("kind")
    if kind == "delayed":
        return True
    if kind == "watcher":
        count = task.get("count")
        return count is None or int(count) <= 1
    if kind == "interval":
        count = task.get("count")
        return count is not None and int(count) <= 1
    return False


def process_single_due_task(task_id: int) -> Dict[str, Any]:
    """
    Fire one task (used by the asyncio runners and testable directly).
    Returns the fired task dict, or {} when nothing was due/active.
    """
    task = _fetch_task(task_id)
    if not task or not task.get("is_active"):
        return {}

    kind = task.get("kind")

    # Watchers only fire when their condition currently holds.
    if kind == "watcher":
        if not evaluate_watcher_condition(task, previous_fired=False):
            # Re-arm for the next poll interval (with current data as baseline).
            _mark_fired(task_id, deactivate=False, next_run_at=time.time() + float(task.get("interval_seconds") or 1))
            return {}

    result = execute_action(task)

    deactivate = _deactivate_after_fire(task)
    if deactivate:
        _mark_fired(task_id, deactivate=True)
        stop_task(task_id)
    else:
        interval = float(task.get("interval_seconds") or 1)
        _mark_fired(task_id, deactivate=False, next_run_at=time.time() + interval)
        # For intervals, decrement the count so it eventually stops.
        count = task.get("count")
        if count is not None:
            with DB_WRITE_LOCK:
                conn = get_connection()
                conn.execute("UPDATE scheduled_tasks SET count = ? WHERE id = ?", (int(count) - 1, task_id))
                conn.commit()
                conn.close()

    print(f"[ScheduledTasks] Task #{task_id} [{kind}] fired: {result}")
    task["_action_result"] = result
    return task


# ── Asyncio runners & startup restore ───────────────────────────────────────

def _target_loop():
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return _main_loop


def _schedule(coro):
    loop = _target_loop()
    if loop is None or not loop.is_running():
        print("[ScheduledTasks] No running event loop available to schedule task")
        try:
            coro.close()
        except Exception:
            pass
        return
    fut = asyncio.run_coroutine_threadsafe(coro, loop)
    return fut


def start_task(task_id: int):
    """(Re)start an active task's asyncio runner."""
    if task_id in _running_tasks:
        try:
            _running_tasks[task_id].cancel()
        except Exception:
            pass
        _running_tasks.pop(task_id, None)

    task = _fetch_task(task_id)
    if not task or not task.get("is_active"):
        return

    kind = task.get("kind")
    if kind == "delayed":
        runner = _runner_delayed(task_id)
    elif kind == "interval":
        runner = _runner_interval(task_id)
    elif kind == "watcher":
        runner = _runner_watcher(task_id)
    else:
        return

    fut = _schedule(runner)
    if fut is not None:
        _running_tasks[task_id] = fut


def stop_task(task_id: int):
    fut = _running_tasks.pop(task_id, None)
    if fut is not None:
        try:
            fut.cancel()
        except Exception:
            pass


async def _runner_delayed(task_id: int):
    try:
        task = _fetch_task(task_id)
        if task:
            delay = max(0.0, float(task.get("next_run_at") or time.time()) - time.time())
            if delay > 0:
                await asyncio.sleep(delay)
        await asyncio.to_thread(process_single_due_task, task_id)
    except asyncio.CancelledError:
        pass
    finally:
        _running_tasks.pop(task_id, None)


async def _runner_interval(task_id: int):
    try:
        while True:
            task = _fetch_task(task_id)
            if not task or not task.get("is_active"):
                break
            delay = max(0.0, float(task.get("next_run_at") or time.time()) - time.time())
            if delay > 0:
                await asyncio.sleep(delay)
            await asyncio.to_thread(process_single_due_task, task_id)
            # If it deactivated after firing, the loop ends next iteration.
    except asyncio.CancelledError:
        pass
    finally:
        _running_tasks.pop(task_id, None)


async def _runner_watcher(task_id: int):
    try:
        while True:
            task = _fetch_task(task_id)
            if not task or not task.get("is_active"):
                break
            await asyncio.to_thread(process_single_due_task, task_id)
            # Sleep for the poll interval before the next check.
            interval = float(task.get("interval_seconds") or 1)
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        pass
    finally:
        _running_tasks.pop(task_id, None)


def init_scheduled_task_scheduler():
    """Restore active tasks on startup (mirrors ``init_exact_timer_scheduler``)."""
    global _main_loop
    try:
        _main_loop = asyncio.get_running_loop()
    except RuntimeError:
        pass

    from app.memory.db import init_db

    init_db()
    conn = get_connection()
    rows = conn.execute("SELECT id FROM scheduled_tasks WHERE is_active = 1").fetchall()
    conn.close()

    for row in rows:
        task_id = row["id"]
        start_task(task_id)
        print(f"[ScheduledTasks] Restored active task #{task_id}")
