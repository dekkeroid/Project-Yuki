import time
import re
import subprocess
import datetime
from typing import Dict, Any, List, Optional
from app.memory.db import get_connection

def trigger_windows_toast(title: str, message: str):
    """
    Fires a native Windows Toast Notification using PowerShell.
    Works natively on Windows 10/11 with standard OS chime and visual pop-up.
    """
    try:
        clean_title = title.replace('"', '`"').replace("'", "`'")
        clean_msg = message.replace('"', '`"').replace("'", "`'")
        
        # PowerShell script using Windows.UI.Notifications
        ps_script = f"""
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
        $xml.LoadXml($template.GetXml())
        $textNodes = $xml.GetElementsByTagName("text")
        $textNodes.Item(0).AppendChild($xml.CreateTextNode('{clean_title}')) | Out-Null
        $textNodes.Item(1).AppendChild($xml.CreateTextNode('{clean_msg}')) | Out-Null
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Project Yuki").Show($toast)
        """
        
        subprocess.Popen(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
            creationflags=subprocess.CREATE_NO_WINDOW
        )
        print(f"[Toast] Windows Toast Notification dispatched: '{title}' - '{message}'")
    except Exception as e:
        print(f"[Toast] Failed to trigger toast notification: {e}")

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

def add_timer(duration_seconds: int, message: str = "Timer Up!", action_command: Optional[str] = None) -> Dict[str, Any]:
    now = time.time()
    target = now + max(1, duration_seconds)
    
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO reminders (created_at, target_time, message, category, recurrence, action_command, is_completed)
    VALUES (?, ?, ?, 'timer', NULL, ?, 0)
    """, (now, target, message, action_command))
    conn.commit()
    timer_id = cursor.lastrowid
    conn.close()
    
    mins, secs = divmod(duration_seconds, 60)
    time_fmt = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"
    print(f"[TimeManager] Timer #{timer_id} set for {time_fmt}: '{message}'")
    return {
        "status": "ok",
        "id": timer_id,
        "category": "timer",
        "duration_seconds": duration_seconds,
        "formatted_duration": time_fmt,
        "message": message,
        "target_time": target
    }

def add_reminder(target_time_str: str, message: str, recurrence: Optional[str] = None, action_command: Optional[str] = None) -> Dict[str, Any]:
    now = time.time()
    target = parse_target_timestamp(target_time_str)
    
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO reminders (created_at, target_time, message, category, recurrence, action_command, is_completed)
    VALUES (?, ?, ?, 'reminder', ?, ?, 0)
    """, (now, target, message, recurrence, action_command))
    conn.commit()
    reminder_id = cursor.lastrowid
    conn.close()
    
    dt_str = datetime.datetime.fromtimestamp(target).strftime("%I:%M %p")
    print(f"[TimeManager] Reminder #{reminder_id} set for {dt_str}: '{message}'")
    return {
        "status": "ok",
        "id": reminder_id,
        "category": "reminder",
        "target_time_formatted": dt_str,
        "message": message,
        "recurrence": recurrence,
        "target_time": target
    }

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

def stop_stopwatch(label: str = "default") -> Dict[str, Any]:
    label_clean = (label or "default").strip().lower()
    info = check_stopwatch(label_clean)
    
    if info.get("status") == "ok":
        conn = get_connection()
        conn.execute("UPDATE stopwatches SET is_active = 0 WHERE label = ?", (label_clean,))
        conn.commit()
        conn.close()
        
    return info

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

def delete_reminder(item_id: int) -> bool:
    conn = get_connection()
    conn.execute("DELETE FROM reminders WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return True

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
        
        # 1. Fire Windows Toast Notification
        trigger_windows_toast(title, msg)
        
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
