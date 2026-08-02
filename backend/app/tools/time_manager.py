import time
import re
import subprocess
import datetime
import tempfile
import os
import uuid
import functools
from typing import Dict, Any, List, Optional
from app.memory.db import get_connection, DB_WRITE_LOCK

import sys

# Serialize timer/reminder writes through the shared SQLite write lock so they
# never collide with crawler/watchdog/chat-session writes.
def _write_locked(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        with DB_WRITE_LOCK:
            return func(*args, **kwargs)
    return wrapper

# ── OS-Native Scheduling (works even when app is closed) ────────────────────

def _get_task_name(item_id: int, prefix: str = "YukiAlarm") -> str:
    return f"{prefix}_{item_id}"

def schedule_os_native_alarm(item_id: int, target_timestamp: float, title: str, message: str) -> Optional[str]:
    """
    Schedules a real OS-level alarm/task that fires even if the app is not running.
    - Windows: Windows Task Scheduler (schtasks) with a PowerShell Toast
    - macOS:   launchd LaunchAgent plist in ~/Library/LaunchAgents/
    - Linux:   `at` command one-shot job
    Returns the task_name/identifier for later cancellation, or None on failure.
    """
    task_name = _get_task_name(item_id)
    dt = datetime.datetime.fromtimestamp(target_timestamp)
    clean_title = title.replace('"', '').replace("'", "")
    clean_msg = message.replace('"', '').replace("'", "")

    if sys.platform == "win32":
        try:
            # Build the PowerShell toast payload as a .ps1 script file so we avoid quoting hell
            ps_toast = f"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xmlStr = @"
<toast scenario="alarm">
    <visual><binding template="ToastGeneric"><text>{clean_title}</text><text>{clean_msg}</text></binding></visual>
    <audio src="ms-winsoundevent:Notification.Looping.Alarm" loop="true"/>
    <actions><action content="Dismiss" arguments="dismiss" activationType="background"/></actions>
</toast>
"@
$xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
$xml.LoadXml($xmlStr)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Project Yuki").Show($toast)
"""
            # Write the .ps1 to a stable temp path
            scripts_dir = os.path.join(tempfile.gettempdir(), "yuki_alarms")
            os.makedirs(scripts_dir, exist_ok=True)
            script_path = os.path.join(scripts_dir, f"{task_name}.ps1")
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(ps_toast)

            # Schedule via schtasks (one-shot, fires at exact time)
            date_str = dt.strftime("%m/%d/%Y")
            time_str = dt.strftime("%H:%M")
            cmd = [
                "schtasks", "/create", "/f",
                "/tn", task_name,
                "/sc", "once",
                "/sd", date_str,
                "/st", time_str,
                "/tr", f'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{script_path}"',
                "/it"   # run only when user is logged in (interactive)
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
            if result.returncode == 0:
                print(f"[OS Scheduler] Windows Task '{task_name}' scheduled for {date_str} {time_str}")
                return task_name
            else:
                print(f"[OS Scheduler] schtasks failed: {result.stderr.strip()}")
                return None
        except Exception as e:
            print(f"[OS Scheduler] Windows scheduling error: {e}")
            return None

    elif sys.platform == "darwin":
        try:
            plist_label = f"com.yuki.alarm.{task_name}"
            launch_agents_dir = os.path.expanduser("~/Library/LaunchAgents")
            os.makedirs(launch_agents_dir, exist_ok=True)
            plist_path = os.path.join(launch_agents_dir, f"{plist_label}.plist")

            plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>{plist_label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>osascript</string>
        <string>-e</string>
        <string>display notification "{clean_msg}" with title "{clean_title}" sound name "Glass"</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Month</key><integer>{dt.month}</integer>
        <key>Day</key><integer>{dt.day}</integer>
        <key>Hour</key><integer>{dt.hour}</integer>
        <key>Minute</key><integer>{dt.minute}</integer>
    </dict>
    <key>RunAtLoad</key><false/>
</dict>
</plist>"""
            with open(plist_path, "w") as f:
                f.write(plist_content)

            subprocess.run(["launchctl", "load", plist_path], capture_output=True)
            print(f"[OS Scheduler] macOS LaunchAgent '{plist_label}' scheduled for {dt}")
            return plist_label
        except Exception as e:
            print(f"[OS Scheduler] macOS scheduling error: {e}")
            return None

    else:  # Linux
        try:
            at_time = dt.strftime("%H:%M %m/%d/%Y")
            script = f'notify-send "{clean_title}" "{clean_msg}" && paplay /usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga 2>/dev/null || true'
            result = subprocess.run(
                ["at", at_time],
                input=script,
                capture_output=True, text=True
            )
            # `at` outputs job ID to stderr
            job_match = re.search(r"job (\d+)", result.stderr)
            job_id = job_match.group(1) if job_match else None
            if job_id:
                print(f"[OS Scheduler] Linux `at` job #{job_id} scheduled for {at_time}")
                return f"at_{job_id}"
            return None
        except Exception as e:
            print(f"[OS Scheduler] Linux scheduling error: {e}")
            return None

def cancel_os_native_alarm(task_name: str):
    """Cancels a previously scheduled OS task/job."""
    if not task_name:
        return
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["schtasks", "/delete", "/f", "/tn", task_name],
                capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW
            )
            # Also clean up the .ps1 script file
            script_path = os.path.join(tempfile.gettempdir(), "yuki_alarms", f"{task_name}.ps1")
            if os.path.exists(script_path):
                os.remove(script_path)
            print(f"[OS Scheduler] Windows Task '{task_name}' cancelled")
        elif sys.platform == "darwin":
            plist_path = os.path.expanduser(f"~/Library/LaunchAgents/{task_name}.plist")
            if os.path.exists(plist_path):
                subprocess.run(["launchctl", "unload", plist_path], capture_output=True)
                os.remove(plist_path)
            print(f"[OS Scheduler] macOS LaunchAgent '{task_name}' cancelled")
        else:  # Linux
            if task_name.startswith("at_"):
                job_id = task_name[3:]
                subprocess.run(["atrm", job_id], capture_output=True)
                print(f"[OS Scheduler] Linux at job #{job_id} cancelled")
    except Exception as e:
        print(f"[OS Scheduler] Cancel error for '{task_name}': {e}")

# ── Immediate Toast (fires right now, when app IS running) ──────────────────

def trigger_native_os_notification(title: str, message: str):
    """
    Fires an immediate OS notification (used when app IS running and alarm triggers).
    - Windows: PowerShell Toast with looping alarm scenario
    - macOS: AppleScript Notification Center
    - Linux: notify-send + paplay
    """
    clean_title = title.replace('"', '').replace("'", "")
    clean_msg = message.replace('"', '').replace("'", "")

    if sys.platform == "win32":
        try:
            ps_script = f"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xmlStr = @"
<toast scenario="alarm">
    <visual><binding template="ToastGeneric"><text>{clean_title}</text><text>{clean_msg}</text></binding></visual>
    <audio src="ms-winsoundevent:Notification.Looping.Alarm" loop="true"/>
    <actions><action content="Dismiss" arguments="dismiss" activationType="background"/></actions>
</toast>
"@
$xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
$xml.LoadXml($xmlStr)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Project Yuki").Show($toast)
"""
            subprocess.Popen(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", ps_script],
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            print(f"[OS Notification] Windows Native Alarm Toast dispatched: '{title}'")
        except Exception as e:
            print(f"[OS Notification] Windows Toast failed: {e}")

    elif sys.platform == "darwin":
        try:
            apple_script = f'display notification "{clean_msg}" with title "{clean_title}" sound name "Glass"'
            subprocess.Popen(["osascript", "-e", apple_script])
            print(f"[OS Notification] macOS Notification dispatched: '{title}'")
        except Exception as e:
            print(f"[OS Notification] macOS Notification failed: {e}")

    else:  # Linux
        try:
            subprocess.Popen(["notify-send", title, message])
            subprocess.Popen(["paplay", "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga"])
            print(f"[OS Notification] Linux Notification dispatched: '{title}'")
        except Exception as e:
            print(f"[OS Notification] Linux Notification failed: {e}")

def trigger_windows_toast(title: str, message: str):
    trigger_native_os_notification(title, message)

def is_os_native_enabled() -> bool:
    """Reads the os_native_alarms setting from memory_manager profile. Defaults to True."""
    try:
        from app.memory import manager as _mgr
        val = _mgr.memory_manager.profile.get("settings", {}).get("os_native_alarms", True)
        return val is not False and str(val).lower() not in ("false", "0")
    except Exception:
        return True  # default ON if anything fails



def parse_duration_seconds(text: str) -> int:
    """
    Parses duration strings like '10 minutes', '45 seconds', '1 hour 30 mins', '5m', '2h'.
    Returns total seconds.
    """
    if not text:
        return 0
    text_lower = text.lower().strip()
    
    # Direct integer seconds fallback
    if text_lower.isdigit():
        return int(text_lower)
        
    total_seconds = 0
    
    # Hours
    hrs = re.search(r'(\d+)\s*(?:hours?|hrs?|h\b)', text_lower)
    if hrs:
        total_seconds += int(hrs.group(1)) * 3600
        
    # Minutes
    mins = re.search(r'(\d+)\s*(?:minutes?|mins?|m\b)', text_lower)
    if mins:
        total_seconds += int(mins.group(1)) * 60
        
    # Seconds
    secs = re.search(r'(\d+)\s*(?:seconds?|secs?|s\b)', text_lower)
    if secs:
        total_seconds += int(secs.group(1))
        
    if total_seconds == 0:
        # Fallback regex for pure digits + unit
        match = re.search(r'(\d+)', text_lower)
        if match:
            val = int(match.group(1))
            if 'sec' in text_lower or text_lower.endswith('s'):
                return val
            elif 'hour' in text_lower or 'hr' in text_lower:
                return val * 3600
            else:
                return val * 60  # Default to minutes if unspecified
                
    return total_seconds

def parse_target_timestamp(time_str: str) -> float:
    """
    Parses target time string (e.g. '5:30 PM', '17:30', 'in 20 minutes', 'tomorrow at 8am').
    Returns target Unix timestamp float.
    """
    now = datetime.datetime.now()
    if not time_str:
        return now.timestamp() + 300  # Default 5 minutes
        
    time_str_lower = time_str.lower().strip()
    
    # Check relative durations ('in 10 minutes')
    if 'in ' in time_str_lower or any(u in time_str_lower for u in ['min', 'sec', 'hour', 'hr']):
        secs = parse_duration_seconds(time_str_lower.replace('in ', ''))
        if secs > 0:
            return (now + datetime.timedelta(seconds=secs)).timestamp()
            
    # Time of day parsing (e.g. '5:30 PM', '18:00')
    time_match = re.search(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', time_str_lower)
    if time_match:
        hr = int(time_match.group(1))
        minute = int(time_match.group(2)) if time_match.group(2) else 0
        ampm = time_match.group(3)
        
        if ampm == 'pm' and hr < 12:
            hr += 12
        elif ampm == 'am' and hr == 12:
            hr = 0
            
        target = now.replace(hour=hr, minute=minute, second=0, microsecond=0)
        if 'tomorrow' in time_str_lower or target <= now:
            target += datetime.timedelta(days=1)
            
        return target.timestamp()
        
    return now.timestamp() + 300

# ── DB Core Actions ─────────────────────────────────────────────────────────

# OS Task Scheduler only has minute-level precision.
# Don't bother scheduling OS tasks for durations shorter than this — asyncio handles them in-app.
MIN_OS_SCHEDULE_SECONDS = 5 * 60  # 5 minutes

@_write_locked
def add_timer(duration_seconds: int, message: str = "Timer Up!", action_command: Optional[str] = None, category: str = "timer") -> Dict[str, Any]:
    try:
        duration_seconds = int(duration_seconds)
    except (ValueError, TypeError):
        duration_seconds = parse_duration_seconds(str(duration_seconds))
    now = time.time()
    target = now + max(1, duration_seconds)
    
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO reminders (created_at, target_time, message, category, recurrence, action_command, is_completed)
    VALUES (?, ?, ?, ?, NULL, ?, 0)
    """, (now, target, message, category, action_command))
    conn.commit()
    timer_id = cursor.lastrowid

    # Schedule via OS Task Scheduler for alarms that are >= 5 min away
    # (schtasks has only minute-level precision — useless for short timers and causes double-firing)
    title = "⏰ Yuki Alarm" if category == "alarm" else "⏱️ Yuki Timer"
    os_task_name = None
    if duration_seconds >= MIN_OS_SCHEDULE_SECONDS:
        os_task_name = schedule_os_native_alarm(timer_id, target, title, message)
        if os_task_name:
            cursor.execute("UPDATE reminders SET os_task_name = ? WHERE id = ?", (os_task_name, timer_id))
            conn.commit()
    else:
        print(f"[TimeManager] Skipping OS scheduler for short {duration_seconds}s {category} (asyncio handles it)")

    conn.close()
    schedule_exact_timer(timer_id, target)
    
    mins, secs = divmod(duration_seconds, 60)
    time_fmt = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"
    print(f"[TimeManager] {category.capitalize()} #{timer_id} set for {time_fmt}: '{message}' (OS task: {os_task_name})")
    return {
        "status": "ok",
        "id": timer_id,
        "category": category,
        "duration_seconds": duration_seconds,
        "formatted_duration": time_fmt,
        "message": message,
        "target_time": target
    }

@_write_locked
def add_reminder(target_time_str: str, message: str, recurrence: Optional[str] = None, action_command: Optional[str] = None, category: str = "reminder") -> Dict[str, Any]:
    now = time.time()
    target = parse_target_timestamp(target_time_str)
    
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO reminders (created_at, target_time, message, category, recurrence, action_command, is_completed)
    VALUES (?, ?, ?, ?, ?, ?, 0)
    """, (now, target, message, category, recurrence, action_command))
    conn.commit()
    reminder_id = cursor.lastrowid

    # Schedule via OS Task Scheduler for reminders >= 5 min away
    title = "⏰ Yuki Alarm" if category == "alarm" else "📌 Yuki Reminder"
    os_task_name = None
    time_until = target - time.time()
    if not recurrence and time_until >= MIN_OS_SCHEDULE_SECONDS:
        os_task_name = schedule_os_native_alarm(reminder_id, target, title, message)
        if os_task_name:
            cursor.execute("UPDATE reminders SET os_task_name = ? WHERE id = ?", (os_task_name, reminder_id))
            conn.commit()
    elif not recurrence:
        print(f"[TimeManager] Skipping OS scheduler for near-term reminder ({int(time_until)}s away, asyncio handles it)")

    conn.close()
    schedule_exact_timer(reminder_id, target)
    
    dt_str = datetime.datetime.fromtimestamp(target).strftime("%I:%M %p")
    print(f"[TimeManager] Reminder #{reminder_id} set for {dt_str}: '{message}' (OS task: {os_task_name})")
    return {
        "status": "ok",
        "id": reminder_id,
        "category": category,
        "target_time_formatted": dt_str,
        "message": message,
        "recurrence": recurrence,
        "target_time": target
    }

@_write_locked
def add_datetime_alarm(date_str: str, time_str: str, message: str = "Alarm!") -> Dict[str, Any]:
    """
    Schedules an alarm for a specific date (YYYY-MM-DD) and time (HH:MM).
    """
    now = time.time()
    try:
        dt = datetime.datetime.strptime(f"{date_str.strip()} {time_str.strip()}", "%Y-%m-%d %H:%M")
        target = dt.timestamp()
    except Exception:
        target = now + 300
        
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO reminders (created_at, target_time, message, category, recurrence, action_command, is_completed)
    VALUES (?, ?, ?, 'alarm', NULL, NULL, 0)
    """, (now, target, message))
    conn.commit()
    reminder_id = cursor.lastrowid

    # Always schedule via OS Task Scheduler so alarm fires even if app is closed
    os_task_name = schedule_os_native_alarm(reminder_id, target, "⏰ Yuki Alarm", message)
    if os_task_name:
        cursor.execute("UPDATE reminders SET os_task_name = ? WHERE id = ?", (os_task_name, reminder_id))
        conn.commit()

    conn.close()
    schedule_exact_timer(reminder_id, target)
    
    dt_str = datetime.datetime.fromtimestamp(target).strftime("%Y-%m-%d %I:%M %p")
    print(f"[TimeManager] Alarm #{reminder_id} scheduled for {dt_str}: '{message}' (OS task: {os_task_name})")
    return {
        "status": "ok",
        "id": reminder_id,
        "category": "alarm",
        "target_time_formatted": dt_str,
        "message": message,
        "target_time": target
    }

@_write_locked
def start_stopwatch(label: str = "default") -> Dict[str, Any]:
    label_clean = (label or "default").strip().lower()
    now = time.time()
    
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT OR REPLACE INTO stopwatches (label, started_at, is_active)
    VALUES (?, ?, 1)
    """, (label_clean, now))
    conn.commit()
    conn.close()
    
    print(f"[TimeManager] Stopwatch '{label_clean}' started at {now}")

    # Notify frontend so it opens a stopwatch window
    if _stopwatch_callback and _main_loop and _main_loop.is_running():
        asyncio.run_coroutine_threadsafe(
            _stopwatch_callback({"type": "stopwatch_started", "label": label_clean, "started_at": now}),
            _main_loop
        )

    return {
        "status": "ok",
        "label": label_clean,
        "started_at": now
    }

def check_stopwatch(label: str = "default") -> Dict[str, Any]:
    label_clean = (label or "default").strip().lower()
    now = time.time()
    
    conn = get_connection()
    cursor = conn.cursor()
    row = cursor.execute("SELECT started_at, is_active FROM stopwatches WHERE label = ?", (label_clean,)).fetchone()
    conn.close()
    
    if not row:
        return {"status": "error", "message": f"No active stopwatch found for '{label_clean}'."}
        
    elapsed = int(now - row["started_at"])
    hrs, remainder = divmod(elapsed, 3600)
    mins, secs = divmod(remainder, 60)
    
    elapsed_str = f"{hrs:02d}:{mins:02d}:{secs:02d}" if hrs > 0 else f"{mins:02d}:{secs:02d}"
    return {
        "status": "ok",
        "label": label_clean,
        "elapsed_seconds": elapsed,
        "formatted_elapsed": elapsed_str,
        "is_active": bool(row["is_active"])
    }

@_write_locked
def stop_stopwatch(label: str = "default") -> Dict[str, Any]:
    label_clean = (label or "default").strip().lower()
    info = check_stopwatch(label_clean)
    
    if info.get("status") == "ok":
        conn = get_connection()
        conn.execute("UPDATE stopwatches SET is_active = 0 WHERE label = ?", (label_clean,))
        conn.commit()
        conn.close()
        
    return info

@_write_locked
def edit_reminder(reminder_id: int, new_message: str) -> bool:
    conn = get_connection()
    conn.execute("UPDATE reminders SET message = ? WHERE id = ?", (new_message, reminder_id))
    conn.commit()
    conn.close()
    return True

@_write_locked
def delete_stopwatch(label: str = "default") -> bool:
    label_clean = (label or "default").strip().lower()
    conn = get_connection()
    conn.execute("DELETE FROM stopwatches WHERE label = ?", (label_clean,))
    conn.commit()
    conn.close()
    return True

def init_time_manager():
    """
    Called on startup to load and schedule all active timers/reminders that survived restart.
    """
    reminders = []
    try:
        # Always ensure schema exists before querying (guards against fresh installs / schema upgrades)
        from app.memory.db import init_db
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
        reminders = cursor.execute("""
        SELECT id, target_time
        FROM reminders
        WHERE is_completed = 0
        """).fetchall()
        conn.close()
    except Exception as e:
        print(f"[TimeManager] Warning: could not restore reminders on startup: {e}")
        reminders = []

    for row in reminders:
        schedule_exact_timer(row["id"], row["target_time"])
        print(f"[TimeManager] Restored schedule for reminder #{row['id']}")

def get_active_time_items() -> Dict[str, Any]:
    now = time.time()
    conn = get_connection()
    cursor = conn.cursor()
    
    reminders_rows = cursor.execute("""
    SELECT id, created_at, target_time, message, category, recurrence, action_command
    FROM reminders
    WHERE is_completed = 0
    ORDER BY target_time ASC
    """).fetchall()
    
    stopwatches_rows = cursor.execute("""
    SELECT id, label, started_at
    FROM stopwatches
    WHERE is_active = 1
    """).fetchall()
    
    conn.close()
    
    reminders = []
    for r in reminders_rows:
        rem_dict = dict(r)
        rem_dict["remaining_seconds"] = max(0, int(r["target_time"] - now))
        reminders.append(rem_dict)
        
    stopwatches = []
    for s in stopwatches_rows:
        sw_dict = dict(s)
        elapsed = int(now - s["started_at"])
        hrs, remainder = divmod(elapsed, 3600)
        mins, secs = divmod(remainder, 60)
        sw_dict["elapsed_seconds"] = elapsed
        sw_dict["formatted_elapsed"] = f"{hrs:02d}:{mins:02d}:{secs:02d}" if hrs > 0 else f"{mins:02d}:{secs:02d}"
        stopwatches.append(sw_dict)
        
    return {
        "reminders": reminders,
        "stopwatches": stopwatches
    }

@_write_locked
def delete_reminder(item_id: int) -> bool:
    conn = get_connection()
    # Fetch OS task name before deleting so we can cancel it
    row = conn.execute("SELECT os_task_name FROM reminders WHERE id = ?", (item_id,)).fetchone()
    os_task_name = row["os_task_name"] if row else None
    conn.execute("DELETE FROM reminders WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    if os_task_name:
        cancel_os_native_alarm(os_task_name)
    return True

import asyncio

_due_callback = None
_stopwatch_callback = None
_main_loop = None
_scheduled_tasks: Dict[int, Any] = {}

def set_due_callback(callback):
    global _due_callback, _main_loop
    _due_callback = callback
    try:
        _main_loop = asyncio.get_running_loop()
    except RuntimeError:
        pass

def set_stopwatch_callback(callback):
    """Called from main.py at startup. Receives an async fn(label, started_at) to broadcast stopwatch_started."""
    global _stopwatch_callback
    _stopwatch_callback = callback

def schedule_exact_timer(item_id: int, target_time: float):
    global _main_loop
    now = time.time()
    delay = max(0.0, target_time - now)
    
    if item_id in _scheduled_tasks:
        try:
            _scheduled_tasks[item_id].cancel()
        except Exception:
            pass
            
    async def _exact_runner():
        if delay > 0:
            await asyncio.sleep(delay)
        # Run the DB write off the event loop so a lock wait never blocks the server.
        due_items = await asyncio.to_thread(process_single_due_reminder, item_id)
        if due_items and _due_callback:
            try:
                if asyncio.iscoroutinefunction(_due_callback):
                    await _due_callback(due_items)
                else:
                    _due_callback(due_items)
            except Exception as e:
                print(f"[TimeManager] Error in due_callback for #{item_id}: {e}")
        _scheduled_tasks.pop(item_id, None)

    target_loop = None
    try:
        target_loop = asyncio.get_running_loop()
    except RuntimeError:
        target_loop = _main_loop

    if target_loop and target_loop.is_running():
        fut = asyncio.run_coroutine_threadsafe(_exact_runner(), target_loop)
        _scheduled_tasks[item_id] = fut
        print(f"[TimeManager] Exact event scheduled for item #{item_id} in {delay:.2f}s")
    else:
        print(f"[TimeManager] Error: No running event loop available to schedule timer #{item_id}")

def init_exact_timer_scheduler():
    global _main_loop
    try:
        _main_loop = asyncio.get_running_loop()
    except RuntimeError:
        pass

    rows = []
    try:
        # Always ensure schema exists before querying (guards against fresh installs / schema upgrades)
        from app.memory.db import init_db
        init_db()
        conn = get_connection()
        rows = conn.execute("SELECT id, target_time FROM reminders WHERE is_completed = 0").fetchall()
        conn.close()
    except Exception as e:
        print(f"[TimeManager] Warning: could not load pending reminders on startup: {e}")
        rows = []

    for r in rows:
        schedule_exact_timer(r["id"], r["target_time"])

@_write_locked
def process_single_due_reminder(item_id: int) -> List[Dict[str, Any]]:
    now = time.time()
    conn = get_connection()
    cursor = conn.cursor()
    row = cursor.execute("""
    SELECT id, created_at, target_time, message, category, recurrence, action_command
    FROM reminders
    WHERE id = ? AND is_completed = 0
    """, (item_id,)).fetchone()
    
    if not row:
        conn.close()
        return []
        
    item = dict(row)
    
    title = "Yuki Timer Up!" if item["category"] == "timer" else "Yuki Reminder"
    msg = item["message"] or "Your scheduled reminder is due."
    
    # Trigger native OS Toast notification
    trigger_windows_toast(title, msg)
    
    if item.get("action_command"):
        try:
            subprocess.Popen(item["action_command"], shell=True)
            print(f"[TimeManager] Executed background task: {item['action_command']}")
        except Exception as cmd_err:
            print(f"[TimeManager] Failed to execute background command: {cmd_err}")
            
    rec = item.get("recurrence")
    if rec == "daily":
        new_target = item["target_time"] + 86400
        cursor.execute("UPDATE reminders SET target_time = ? WHERE id = ?", (new_target, item_id))
        schedule_exact_timer(item_id, new_target)
    elif rec == "hourly":
        new_target = item["target_time"] + 3600
        cursor.execute("UPDATE reminders SET target_time = ? WHERE id = ?", (new_target, item_id))
        schedule_exact_timer(item_id, new_target)
    else:
        cursor.execute("UPDATE reminders SET is_completed = 1 WHERE id = ?", (item_id,))
        
    conn.commit()
    conn.close()
    return [item]

@_write_locked
def snooze_reminder(item_id: int, minutes: int = 5) -> Dict[str, Any]:
    now = time.time()
    new_target = now + (minutes * 60)
    conn = get_connection()
    conn.execute("UPDATE reminders SET target_time = ?, is_completed = 0 WHERE id = ?", (new_target, item_id))
    conn.commit()
    conn.close()
    schedule_exact_timer(item_id, new_target)
    return {"status": "ok", "id": item_id, "new_target": new_target}

@_write_locked
def process_due_reminders() -> List[Dict[str, Any]]:
    """
    Called every 10 seconds by the heartbeat loop in main.py.
    Finds due reminders/timers, triggers Windows Toasts, runs background commands,
    and returns due items for WebSocket speech announcements.
    """
    now = time.time()
    conn = get_connection()
    cursor = conn.cursor()
    
    due_rows = cursor.execute("""
    SELECT id, created_at, target_time, message, category, recurrence, action_command
    FROM reminders
    WHERE is_completed = 0 AND target_time <= ?
    """, (now,)).fetchall()
    
    due_items = []
    for r in due_rows:
        item = dict(r)
        due_items.append(item)
        
        title = "Yuki Timer Up!" if item["category"] == "timer" else "Yuki Reminder"
        msg = item["message"] or "Your scheduled reminder is due."
        
        # 2. Execute background action command if present
        if item.get("action_command"):
            try:
                subprocess.Popen(item["action_command"], shell=True)
                print(f"[TimeManager] Executed background task: {item['action_command']}")
            except Exception as cmd_err:
                print(f"[TimeManager] Failed to execute background command: {cmd_err}")
                
        # 3. Handle recurrence or mark completed
        rec = item.get("recurrence")
        if rec == "daily":
            new_target = item["target_time"] + 86400
            cursor.execute("UPDATE reminders SET target_time = ? WHERE id = ?", (new_target, item["id"]))
        elif rec == "hourly":
            new_target = item["target_time"] + 3600
            cursor.execute("UPDATE reminders SET target_time = ? WHERE id = ?", (new_target, item["id"]))
        else:
            cursor.execute("UPDATE reminders SET is_completed = 1 WHERE id = ?", (item["id"],))
            
    conn.commit()
    conn.close()
    return due_items
