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
        wanted = target.lower().strip()
        wanted_clean = wanted[:-4] if wanted.endswith(".exe") else wanted
        for proc in psutil.process_iter(["pid", "name"]):
            try:
                name = (proc.info.get("name") or "").lower()
                name_clean = name[:-4] if name.endswith(".exe") else name
                if name == wanted or name_clean == wanted_clean or (len(wanted_clean) > 3 and wanted_clean in name_clean):
                    return True
            except Exception:
                continue
    except Exception:
        return False
    return False


def _check_window_state(target: str, condition: str) -> bool:
    """
    Evaluates window condition:
      'open', 'closed', 'minimized', 'maximized', 'focused', 'unfocused'.
    Supports desktop inspection via ctypes (Default desktop) with win32gui/pygetwindow fallbacks.
    """
    target = str(target or "").strip().lower()
    if not target:
        return False
    cond = (condition or "open").lower().strip()
    if cond in ("closed", "gone", "terminated", "killed"):
        cond = "closed"
    elif cond in ("open", "opened", "present", "running"):
        cond = "open"
    elif cond in ("minimized", "minimize", "iconic"):
        cond = "minimized"
    elif cond in ("maximized", "maximize"):
        cond = "maximized"
    elif cond in ("focused", "active", "foreground"):
        cond = "focused"
    elif cond in ("unfocused", "inactive", "background"):
        cond = "unfocused"

    # 1. Inspect user's interactive desktop via ctypes + process map
    try:
        import ctypes
        from ctypes import wintypes
        import psutil
        user32 = ctypes.windll.user32
        h_desk = user32.OpenDesktopW("Default", 0, False, 0x0100)  # DESKTOP_ENUMERATE
        
        pid_map = {}
        try:
            for p in psutil.process_iter(["pid", "name"]):
                try:
                    pid_map[p.info["pid"]] = (p.info.get("name") or "").lower()
                except Exception:
                    pass
        except Exception:
            pass

        target_exe = target if target.endswith(".exe") else f"{target}.exe"
        proc_matches = []
        title_matches = []
        WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def _desk_cb(hwnd, _):
            try:
                if user32.IsWindow(hwnd):
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length > 0:
                        buff = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(hwnd, buff, length + 1)
                        title = buff.value.strip().lower()
                        is_vis = bool(user32.IsWindowVisible(hwnd))
                        is_ico = bool(user32.IsIconic(hwnd))
                        if is_vis or is_ico:
                            pid = wintypes.DWORD()
                            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                            pname = pid_map.get(pid.value, "")
                            if target in pname or pname == target_exe:
                                proc_matches.append((hwnd, is_ico))
                            elif target in title:
                                title_matches.append((hwnd, is_ico))
            except Exception:
                pass
            return True

        if h_desk:
            user32.EnumDesktopWindows(h_desk, WNDENUMPROC(_desk_cb), 0)
            user32.CloseDesktop(h_desk)

        # Prioritize windows belonging to the named application/process over incidental title substrings (e.g. browser tabs)
        matches = proc_matches if proc_matches else title_matches

        if matches:
            if cond == "closed":
                return False
            if cond == "open":
                return True
            fg = user32.GetForegroundWindow()
            for hwnd, is_ico in matches:
                if cond == "minimized" and is_ico:
                    return True
                if cond == "maximized":
                    class WINDOWPLACEMENT(ctypes.Structure):
                        _fields_ = [
                            ("length", wintypes.UINT),
                            ("flags", wintypes.UINT),
                            ("showCmd", wintypes.UINT),
                            ("ptMinPosition", wintypes.POINT),
                            ("ptMaxPosition", wintypes.POINT),
                            ("rcNormalPosition", wintypes.RECT),
                        ]
                    wp = WINDOWPLACEMENT()
                    wp.length = ctypes.sizeof(WINDOWPLACEMENT)
                    if user32.GetWindowPlacement(hwnd, ctypes.byref(wp)) and wp.showCmd == 3:
                        return True
                if cond == "focused" and hwnd == fg:
                    return True
                if cond == "unfocused" and hwnd != fg:
                    return True
            if cond in ("minimized", "maximized", "focused"):
                return False
    except Exception:
        pass

    # 2. Fallback: win32gui
    try:
        import win32gui
        import win32con

        matching_hwnds = []

        def _cb(hwnd, _results):
            try:
                if win32gui.IsWindow(hwnd):
                    title = (win32gui.GetWindowText(hwnd) or "").strip().lower()
                    if target in title:
                        if win32gui.IsWindowVisible(hwnd) or win32gui.IsIconic(hwnd):
                            matching_hwnds.append(hwnd)
            except Exception:
                pass

        win32gui.EnumWindows(_cb, None)
        if cond == "closed":
            return len(matching_hwnds) == 0
        if not matching_hwnds:
            return False
        if cond == "open":
            return True

        fg_hwnd = win32gui.GetForegroundWindow()
        for hwnd in matching_hwnds:
            if cond == "minimized" and win32gui.IsIconic(hwnd):
                return True
            if cond == "maximized":
                plc = win32gui.GetWindowPlacement(hwnd)
                if plc and len(plc) > 1 and plc[1] == win32con.SW_SHOWMAXIMIZED:
                    return True
            if cond == "focused" and hwnd == fg_hwnd:
                return True
            if cond == "unfocused" and hwnd != fg_hwnd:
                return True
        return False
    except Exception:
        pass

    # 3. Fallback: pygetwindow
    try:
        import pygetwindow as gw
        wins = [w for w in gw.getAllWindows() if target in (w.title or "").lower()]
        if cond == "closed":
            return len(wins) == 0
        if not wins:
            return False
        if cond == "open":
            return True
        for w in wins:
            if cond == "minimized" and getattr(w, "isMinimized", False):
                return True
            if cond == "maximized" and getattr(w, "isMaximized", False):
                return True
            if cond == "focused" and getattr(w, "isActive", False):
                return True
            if cond == "unfocused" and not getattr(w, "isActive", False):
                return True
    except Exception:
        pass

    return False


def _check_window_open(target) -> bool:
    """True when at least one visible window's title contains ``target``."""
    return _check_window_state(target, "open")


def _play_builtin_sound(sound_name: str) -> str:
    """Plays a Windows built-in sound (e.g. tada, chime, beep, alert, chord)."""
    sound = (sound_name or "tada").lower().strip()
    try:
        import winsound
        alias_map = {
            "tada": "SystemAsterisk",
            "asterisk": "SystemAsterisk",
            "chime": "SystemNotification",
            "notification": "SystemNotification",
            "beep": "SystemDefault",
            "default": "SystemDefault",
            "alert": "SystemHand",
            "hand": "SystemHand",
            "error": "SystemHand",
            "chord": "SystemQuestion",
            "question": "SystemQuestion",
            "exclamation": "SystemExclamation",
        }
        alias = alias_map.get(sound, sound)
        try:
            winsound.PlaySound(alias, winsound.SND_ALIAS | winsound.SND_ASYNC)
            return f"played sound: {sound}"
        except Exception:
            winsound.MessageBeep(winsound.MB_ICONASTERISK)
            return f"played system beep for: {sound}"
    except Exception as e:
        try:
            subprocess.Popen('powershell -c "[System.Media.SystemSounds]::Asterisk.Play()"', shell=True)
            return f"played sound via powershell: {sound}"
        except Exception as e2:
            return f"sound playback failed: {e2}"


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
# Previous observed condition truth value for edge-triggered watchers (keyed by task id).
_WATCHER_PREV_STATE: Dict[int, bool] = {}


def evaluate_watcher_condition(task: Dict[str, Any], previous_fired: bool) -> bool:
    """
    Returns True when the watcher's condition currently holds.

    ``monitor_type``/``fire_condition`` combos:
      process | gone|present
      window  | minimized|maximized|focused|unfocused|open|closed
      file    | exists|deleted|changed
      command | exit0|exit_nonzero   (runs ``target`` as a shell command each tick)
      battery | low|charging|discharging
      storage | low|<N>gb
      network | disconnected|connected
    """
    monitor = (task.get("monitor_type") or "").lower().strip()
    condition = (task.get("fire_condition") or "").lower().strip()
    target = task.get("target") or ""
    task_id = int(task.get("id") or 0)
    count = task.get("count")

    curr_truth = False

    if monitor == "process":
        alive = _check_process_alive(target)
        if condition in ("gone", "closed", "close", "quit", "exit", "stopped", "killed", "terminated", "process"):
            curr_truth = not alive
        elif condition in ("present", "open", "opened", "running", "started"):
            curr_truth = alive
        else:
            curr_truth = not alive

    elif monitor == "window":
        curr_truth = _check_window_state(target, condition)

    elif monitor == "file":
        path = os.path.abspath(os.path.expanduser(os.path.expandvars(target)))
        sig = _file_signature(path)
        if condition == "exists":
            return sig is not None
        if condition == "deleted":
            return sig is None
        if condition == "changed":
            prev = _FILE_STATE.get(task_id)
            _FILE_STATE[task_id] = sig
            if prev is None or sig is None:
                return False
            return sig != prev
        return False

    elif monitor == "command":
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

    elif monitor in ("battery", "power"):
        try:
            import psutil
            batt = psutil.sensors_battery()
            if batt:
                if condition in ("low", "<20"):
                    curr_truth = (batt.percent <= 20 and not batt.power_plugged)
                elif condition in ("charging", "plugged"):
                    curr_truth = bool(batt.power_plugged)
                elif condition in ("discharging", "unplugged"):
                    curr_truth = not bool(batt.power_plugged)
        except Exception:
            curr_truth = False

    elif monitor in ("storage", "disk"):
        try:
            import shutil
            drive = str(target or "C:\\")
            usage = shutil.disk_usage(drive)
            free_gb = usage.free / (1024 ** 3)
            if condition in ("low", "<10gb"):
                curr_truth = free_gb < 10.0
            elif "gb" in condition:
                thresh = float(condition.replace("gb", "").replace("<", "").strip())
                curr_truth = free_gb < thresh
        except Exception:
            curr_truth = False

    elif monitor in ("network", "internet"):
        try:
            import socket
            conn = socket.create_connection(("1.1.1.1", 53), timeout=1.5)
            conn.close()
            connected = True
        except Exception:
            connected = False
        if condition in ("disconnected", "down", "offline"):
            curr_truth = not connected
        elif condition in ("connected", "up", "online"):
            curr_truth = connected

    # Edge-triggering for recurring watchers (count is None or > 1):
    # Only fire when transitioning from False -> True (edge), not continuously while True.
    if count is None or int(count) > 1:
        prev_truth = _WATCHER_PREV_STATE.get(task_id, False)
        _WATCHER_PREV_STATE[task_id] = curr_truth
        return (not prev_truth) and curr_truth

    return curr_truth


def _describe_watcher(task: Dict[str, Any]) -> str:
    monitor = task.get("monitor_type") or "unknown"
    condition = task.get("fire_condition") or "unknown"
    target = task.get("target") or ""
    return f"{monitor} '{target}' -> {condition}"


# ── Action execution ─────────────────────────────────────────────────────────

_action_executor = None
_main_loop: Optional[asyncio.AbstractEventLoop] = None
_running_tasks: Dict[int, Any] = {}
_fire_callback = None


def set_action_executor(callback):
    """Register the executor callback that runs fired actions.

    Signature: ``callback(action_type, action_command, action_tool, action_args) -> str``.
    ``action_type`` is one of ``shell`` | ``power`` | ``tool``. Registered by
    ``main.py`` / ``AgentExecutor`` so the engine stays backend-agnostic.
    """
    global _action_executor
    _action_executor = callback


def set_fire_callback(callback):
    """Register the callback invoked when a scheduled task or watcher fires.

    Signature: ``async def callback(task: dict, result: str)``.
    Used by ``main.py`` to broadcast live WebSocket events and synthesize TTS announcements.
    """
    global _fire_callback
    _fire_callback = callback


def set_main_loop(loop):
    global _main_loop
    _main_loop = loop


def _run_shell_action(command: str) -> str:
    if not command:
        return "empty shell command"
    cmd_clean = command.strip()
    for prefix in ("app_name:", "app:", "launch:", "open:", "launch_app:", "start:"):
        if cmd_clean.lower().startswith(prefix):
            app_target = cmd_clean.split(":", 1)[1].strip()
            from app.tools.system import launch_app
            return launch_app(app_name=app_target)

    # If the command is an executable path (or ends in .exe) or an existing file on disk
    if cmd_clean.lower().endswith(".exe") or (os.path.isabs(cmd_clean) and os.path.exists(cmd_clean)):
        try:
            from app.tools.system import launch_app
            res = launch_app(app_name=cmd_clean)
            if "not found" not in res.lower() and "error" not in res.lower():
                return res
        except Exception:
            pass

    try:
        if os.path.isfile(cmd_clean):
            os.startfile(cmd_clean)
            return f"opened: {cmd_clean}"
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

    if action_type == "sound":
        sound_target = action_command or (action_args.get("sound") if isinstance(action_args, dict) else "") or "tada"
        return _play_builtin_sound(sound_target)

    if action_type == "popup":
        msg = str(action_command or (action_args.get("message") if isinstance(action_args, dict) else "") or "Yuki Reminder")
        try:
            safe_msg = msg.replace('"', '`"').replace("'", "''")
            cmd = f'powershell -WindowStyle Hidden -NoProfile -Command "(New-Object -ComObject Wscript.Shell).Popup(\'{safe_msg}\', 6, \'Project Yuki\', 64)"'
            subprocess.Popen(cmd, shell=True)
            return f"displayed popup: {msg}"
        except Exception as e:
            return f"popup failed: {e}"

    if action_type == "notify":
        msg = str(action_command or (action_args.get("message") if isinstance(action_args, dict) else "") or "Yuki Notification")
        try:
            from app.tools.time_manager import trigger_windows_toast
            trigger_windows_toast("Project Yuki", msg)
            return f"dispatched notification: {msg}"
        except Exception:
            try:
                subprocess.Popen(f'msg * "{msg}"', shell=True)
                return f"dispatched notification: {msg}"
            except Exception as e:
                return f"notification failed: {e}"

    if action_type == "telegram":
        msg = str(action_command or (action_args.get("message") if isinstance(action_args, dict) else "") or "Scheduled alert from Yuki")
        try:
            from app.channels import telegram_service
            loop = _target_loop()
            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(telegram_service.send_telegram_message(msg), loop)
            return f"sent telegram alert: {msg}"
        except Exception as e:
            return f"telegram alert failed: {e}"

    if action_type == "shell":
        cmd = action_command or (action_args.get("command") if isinstance(action_args, dict) else "") or (action_args.get("app_name") if isinstance(action_args, dict) else "")
        if cmd:
            return _run_shell_action(cmd)

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
    m_type = (monitor_type or "").lower().strip()
    try:
        interval_seconds = float(interval_seconds)
    except (ValueError, TypeError):
        interval_seconds = 1.5 if m_type == "window" else 1.0
    # For UI window watchers, default to 1.5s if omitted or left at high default
    if m_type == "window" and interval_seconds >= 30.0:
        interval_seconds = 1.5
    interval_seconds = max(0.5, interval_seconds)
    now = time.time()
    task_id = _insert_task(
        now,
        kind="watcher",
        monitor_type=m_type,
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
    if not task or not task.get("is_active") or bool(task.get("is_paused")):
        return {}

    kind = task.get("kind")

    # Watchers only fire when their condition currently holds.
    if kind == "watcher":
        if not evaluate_watcher_condition(task, previous_fired=False):
            # Re-arm for the next poll interval (with current data as baseline).
            _mark_fired(task_id, deactivate=False, next_run_at=time.time() + float(task.get("interval_seconds") or 1.5))
            return {}

    result = execute_action(task)
    now = time.time()

    deactivate = _deactivate_after_fire(task)
    if deactivate:
        _mark_fired(task_id, deactivate=True)
        stop_task(task_id)
    else:
        interval = float(task.get("interval_seconds") or 1.0)
        _mark_fired(task_id, deactivate=False, next_run_at=now + interval)
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

    # 1. Audit Log to SQLite scheduled_task_runs table
    action_desc = task.get("action_command") or task.get("action_tool") or task.get("action_type") or "action"
    status = "error" if any(w in str(result).lower() for w in ("failed", "error", "exception")) else "success"
    try:
        with DB_WRITE_LOCK:
            conn = get_connection()
            conn.execute(
                """
                INSERT INTO scheduled_task_runs (task_id, kind, target, action_desc, result, status, fired_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, kind, task.get("target"), str(action_desc), str(result), status, now),
            )
            conn.commit()
            conn.close()
    except Exception as log_err:
        print(f"[ScheduledTasks] Failed to log run to database: {log_err}")

    # 2. Invoke Fire Callback (for WebSocket broadcast and Kokoro TTS speech announcement)
    if _fire_callback is not None:
        try:
            loop = _target_loop()
            if loop and loop.is_running():
                if asyncio.iscoroutinefunction(_fire_callback):
                    asyncio.run_coroutine_threadsafe(_fire_callback(task, result), loop)
                else:
                    loop.call_soon_threadsafe(_fire_callback, task, result)
            else:
                if not asyncio.iscoroutinefunction(_fire_callback):
                    _fire_callback(task, result)
        except Exception as cb_err:
            print(f"[ScheduledTasks] Fire callback error: {cb_err}")

    return task


@_write_locked
def pause_task(task_id: int) -> Dict[str, Any]:
    """Pauses an active scheduled task or watcher."""
    task = _fetch_task(task_id)
    if not task:
        return {"status": "error", "message": f"Task #{task_id} not found."}
    conn = get_connection()
    conn.execute("UPDATE scheduled_tasks SET is_paused = 1 WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    stop_task(task_id)
    print(f"[ScheduledTasks] Paused task #{task_id}")
    return {"status": "ok", "id": task_id, "is_paused": True}


@_write_locked
def resume_task(task_id: int) -> Dict[str, Any]:
    """Resumes a paused scheduled task or watcher."""
    task = _fetch_task(task_id)
    if not task:
        return {"status": "error", "message": f"Task #{task_id} not found."}
    now = time.time()
    interval = float(task.get("interval_seconds") or 1.0)
    next_run = now + interval
    conn = get_connection()
    conn.execute("UPDATE scheduled_tasks SET is_paused = 0, next_run_at = ? WHERE id = ?", (next_run, task_id))
    conn.commit()
    conn.close()
    start_task(task_id)
    print(f"[ScheduledTasks] Resumed task #{task_id}, next run in {interval:.1f}s")
    return {"status": "ok", "id": task_id, "is_paused": False, "next_run_at": next_run}


def list_task_runs(limit: int = 50, task_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """Fetch recent execution runs from the audit table."""
    conn = get_connection()
    if task_id:
        rows = conn.execute(
            "SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY fired_at DESC LIMIT ?",
            (task_id, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM scheduled_task_runs ORDER BY fired_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


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
            try:
                await asyncio.to_thread(process_single_due_task, task_id)
            except Exception as e:
                print(f"[ScheduledTasks] Interval task #{task_id} execution error: {e}")
                await asyncio.sleep(1.0)
            # If it deactivated after firing, the loop ends next iteration.
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[ScheduledTasks] Interval runner crashed for task #{task_id}: {e}")
    finally:
        _running_tasks.pop(task_id, None)


async def _runner_watcher(task_id: int):
    try:
        while True:
            task = _fetch_task(task_id)
            if not task or not task.get("is_active"):
                break
            try:
                await asyncio.to_thread(process_single_due_task, task_id)
            except Exception as e:
                print(f"[ScheduledTasks] Watcher task #{task_id} evaluation error: {e}")
            # Sleep for the poll interval before the next check.
            interval = float(task.get("interval_seconds") or 1.5)
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[ScheduledTasks] Watcher runner crashed for task #{task_id}: {e}")
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
    rows = conn.execute("SELECT id FROM scheduled_tasks WHERE is_active = 1 AND (is_paused IS NULL OR is_paused = 0)").fetchall()
    conn.close()

    for row in rows:
        task_id = row["id"]
        start_task(task_id)
        print(f"[ScheduledTasks] Restored active task #{task_id}")
