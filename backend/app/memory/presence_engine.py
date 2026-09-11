"""
Presence Engine — living temporal awareness, sleep/wake states, and subconscious time perception for Yuki.

Tracks:
  * Interaction continuity & elapsed silence duration
  * Subconscious boredom level (0.0 to 1.0)
  * Sleep state machine ('active', 'idle', 'drowsy', 'sleeping', 'waking')
  * Sleep duration & awakening delta
  * Experiential temporal context formatting for LLM prompts
"""

import time
import datetime
import random
import re
from typing import Optional, Dict, Any, Tuple
from app import config


def is_media_or_audio_playing() -> bool:
    """Check if any external application is actively outputting audio (e.g. YouTube, media player)."""
    try:
        from pycaw.pycaw import AudioUtilities, IAudioMeterInformation
        from comtypes import CLSCTX_ALL
        device = AudioUtilities.GetSpeakers()
        if device:
            meter = device.Activate(IAudioMeterInformation._iid_, CLSCTX_ALL, None)
            if meter and meter.GetPeakValue() > 0.005:
                return True
    except Exception:
        pass
    return False


_MEDIA_CACHE_TIME: float = 0.0
_MEDIA_CACHE_VAL: str = ""

def get_active_background_media(foreground_title: str = "") -> str:
    """
    Detects background or minimized media/music currently playing (e.g. VLC, Spotify, YouTube).
    Returns a concise string like: 'VLC: "Sidney Gish - Imposter Syndrome"' or empty string if none.
    """
    global _MEDIA_CACHE_TIME, _MEDIA_CACHE_VAL
    now = time.time()
    if now - _MEDIA_CACHE_TIME < 2.5 and _MEDIA_CACHE_VAL:
        return _MEDIA_CACHE_VAL

    try:
        import os
        import psutil
        import ctypes
        from ctypes import wintypes
        from pycaw.pycaw import AudioUtilities

        active_audio_pids = {}
        ignored_proc = ('yuki', 'python', 'electron', 'audiodg', 'system', 'systemsettings')

        for s in AudioUtilities.GetAllSessions():
            if not s.Process or s.State != 1:
                continue
            pname = s.Process.name().lower()
            if any(ig in pname for ig in ignored_proc):
                continue
            active_audio_pids[s.Process.pid] = pname

        if not active_audio_pids:
            _MEDIA_CACHE_TIME = now
            _MEDIA_CACHE_VAL = ""
            return ""

        media_exts = ('.mp4', '.mp3', '.mkv', '.webm', '.flac', '.wav', '.ogg', '.m4a', '.avi')
        found_media = []

        # Strategy A: Command line of local media players (VLC, MPV, MPC-HC)
        for pid, pname in list(active_audio_pids.items()):
            try:
                proc = psutil.Process(pid)
                cmd = proc.cmdline()
                for arg in cmd[1:]:
                    if any(arg.lower().endswith(ext) for ext in media_exts):
                        base_name = os.path.splitext(os.path.basename(arg))[0]
                        app_label = "VLC" if "vlc" in pname else pname.replace(".exe", "").capitalize()
                        found_media.append(f"{app_label}: \"{base_name}\"")
                        break
            except Exception:
                pass

        # Strategy B: Background / Minimized window titles (Spotify, YouTube in browser)
        user32 = ctypes.windll.user32
        fg_hwnd = user32.GetForegroundWindow()
        fg_title_lower = (foreground_title or "").lower()
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        def enum_cb(hwnd, _):
            if hwnd == fg_hwnd:
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value.strip()
                if not title:
                    return True
                title_lower = title.lower()

                if fg_title_lower and fg_title_lower in title_lower:
                    return True

                if "spotify" in title_lower:
                    if title_lower not in ("spotify", "spotify free", "spotify premium"):
                        found_media.append(f"Spotify: \"{title}\"")
                elif "youtube" in title_lower or "soundcloud" in title_lower:
                    clean_title = re.sub(r'\s*[\u2014\u2013\-]\s*(?:Mozilla\s+)?Firefox.*$', '', title, flags=re.IGNORECASE)
                    clean_title = re.sub(r'\s*[\u2014\u2013\-]\s*Google\s+Chrome.*$', '', clean_title, flags=re.IGNORECASE)
                    clean_title = re.sub(r'\s*[\u2014\u2013\-]\s*Microsoft\s+Edge.*$', '', clean_title, flags=re.IGNORECASE)
                    clean_title = re.sub(r'\s*[\u2014\u2013\-]\s*Brave.*$', '', clean_title, flags=re.IGNORECASE)
                    found_media.append(f"YouTube: \"{clean_title.strip()}\"")
                elif "vlc media player" in title_lower and not any("vlc" in m.lower() for m in found_media):
                    clean_title = re.sub(r'\s*[\u2014\u2013\-]\s*VLC\s+media\s+player.*$', '', title, flags=re.IGNORECASE).strip()
                    if clean_title:
                        found_media.append(f"VLC: \"{clean_title}\"")
            return True

        try:
            user32.EnumWindows(WNDENUMPROC(enum_cb), 0)
        except Exception:
            pass

        unique_media = []
        for item in found_media:
            if item not in unique_media:
                unique_media.append(item)

        res = ", ".join(unique_media) if unique_media else ""
        _MEDIA_CACHE_TIME = now
        _MEDIA_CACHE_VAL = res
        return res
    except Exception:
        return ""



EXE_MAP = {
    'firefox.exe': 'Firefox',
    'chrome.exe': 'Google Chrome',
    'msedge.exe': 'Microsoft Edge',
    'brave.exe': 'Brave',
    'opera.exe': 'Opera',
    'vivaldi.exe': 'Vivaldi',
    'code.exe': 'VS Code',
    'cursor.exe': 'Cursor',
    'devenv.exe': 'Visual Studio',
    'sublime_text.exe': 'Sublime Text',
    'idea64.exe': 'IntelliJ IDEA',
    'pycharm64.exe': 'PyCharm',
    'acrord32.exe': 'Adobe Acrobat',
    'acrobat.exe': 'Adobe Acrobat',
    'foxitpdfreader.exe': 'Foxit PDF Reader',
    'foxitreader.exe': 'Foxit PDF Reader',
    'winword.exe': 'Microsoft Word',
    'excel.exe': 'Microsoft Excel',
    'powerpnt.exe': 'PowerPoint',
    'vlc.exe': 'VLC Media Player',
    'spotify.exe': 'Spotify',
    'discord.exe': 'Discord',
    'telegram.exe': 'Telegram',
    'slack.exe': 'Slack',
    'obsidian.exe': 'Obsidian',
    'notepad++.exe': 'Notepad++',
    'notepad.exe': 'Notepad',
    'cmd.exe': 'Command Prompt',
    'powershell.exe': 'PowerShell',
    'windowsterminal.exe': 'Windows Terminal',
    'explorer.exe': 'File Explorer'
}

SUFFIX_APPS = [
    (r'(?:Mozilla\s+)?Firefox', 'Firefox'),
    (r'Google\s+Chrome', 'Google Chrome'),
    (r'Microsoft[\s\u200b]+Edge', 'Microsoft Edge'),
    (r'Brave', 'Brave'),
    (r'Opera(?:\s+GX)?', 'Opera'),
    (r'Visual\s+Studio\s+Code', 'VS Code'),
    (r'Visual\s+Studio', 'Visual Studio'),
    (r'Adobe\s+Acrobat(?:\s+(?:Reader|Pro))?', 'Adobe Acrobat'),
    (r'Foxit(?:\s+PDF)?\s+Reader', 'Foxit PDF Reader'),
    (r'(?:Microsoft\s+)?Word', 'Microsoft Word'),
    (r'(?:Microsoft\s+)?Excel', 'Microsoft Excel'),
    (r'(?:Microsoft\s+)?PowerPoint', 'PowerPoint'),
    (r'VLC(?:\s+media\s+player)?', 'VLC Media Player'),
    (r'Spotify(?:\s+(?:Free|Premium))?', 'Spotify'),
    (r'Discord', 'Discord'),
    (r'Telegram', 'Telegram'),
    (r'Notepad\+\+', 'Notepad++'),
    (r'Notepad', 'Notepad'),
    (r'Obsidian', 'Obsidian'),
    (r'Command\s+Prompt', 'Command Prompt'),
    (r'Windows\s+PowerShell', 'PowerShell')
]

def format_active_window(raw_title: str, proc_name: str = "") -> dict:
    """
    Parses a raw Windows foreground window title and process name into clean,
    structured application and document/tab metadata.
    """
    clean = (raw_title or "").strip()
    clean = re.sub(r'[\s\-\u2014\u2013\u2022\|]+$', '', clean).strip()

    if not clean:
        app = EXE_MAP.get(proc_name.lower(), proc_name.replace('.exe', '').capitalize() if proc_name else "Desktop")
        return {"app": app, "doc": "", "summary": app, "prompt": app}

    matched_app = None
    doc_part = clean

    # 1. Match from title suffixes (e.g. "... - Mozilla Firefox" -> doc="..." and app="Firefox")
    for pat, app_label in SUFFIX_APPS:
        m = re.search(r'(?:[\s\-\u2014\u2013\u2022\|]+\s*)?' + pat + r'\s*$', clean, re.IGNORECASE)
        if m:
            matched_app = app_label
            doc_part = clean[:m.start()].strip()
            doc_part = re.sub(r'[\s\-\u2014\u2013\u2022\|]+$', '', doc_part).strip()
            break

    # 2. If title suffix didn't match, check process name
    if not matched_app and proc_name:
        p_lower = proc_name.lower()
        if p_lower in EXE_MAP:
            matched_app = EXE_MAP[p_lower]
            doc_part = clean

    # 3. Fallback generic split
    if not matched_app:
        parts = re.split(r'\s*[\u2014\u2013\-]\s*', clean)
        if len(parts) > 1 and len(parts[-1].strip()) < 30:
            matched_app = parts[-1].strip()
            doc_part = ' - '.join(parts[:-1]).strip()
        else:
            matched_app = clean[:24]
            doc_part = ''

    if doc_part and matched_app and doc_part.lower() == matched_app.lower():
        doc_part = ""

    if matched_app and doc_part:
        summary = f'{matched_app}: "{doc_part}"'
        prompt_desc = f"{matched_app} (active document/tab: '{doc_part}')"
    else:
        summary = matched_app or clean
        prompt_desc = matched_app or clean

    return {
        "app": matched_app,
        "doc": doc_part,
        "summary": summary,
        "prompt": prompt_desc
    }

def _get_current_active_window() -> tuple[str, str]:
    """Read the current foreground window title and process name safely."""
    try:
        import ctypes
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        if not hwnd:
            return "", ""
        buf = ctypes.create_unicode_buffer(512)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, 512)
        title = buf.value.strip()
        yuki_keywords = ("yuki", "project yuki", "control dashboard", "vrm viewer", "electron")
        if any(k in title.lower() for k in yuki_keywords):
            return "", ""

        proc_name = ""
        try:
            pid = ctypes.c_ulong()
            ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value:
                import psutil
                proc_name = psutil.Process(pid.value).name()
        except Exception:
            pass

        return title, proc_name
    except Exception:
        return "", ""


class PresenceEngine:
    def __init__(self):
        now = time.time()
        self.last_interaction_time: float = now
        self.sleep_started_at: Optional[float] = None
        self.last_sleep_duration_sec: float = 0.0
        self.last_awakened_at: float = 0.0
        self.is_nap: bool = False
        self.is_date_mode: bool = False
        self.sleep_state: str = "active"  # "active", "idle", "drowsy", "sleeping", "napping", "waking"
        self.boredom: float = 0.0         # 0.0 (fully engaged) to 1.0 (very bored)
        self.user_idle_seconds: float = 0.0
        self.active_window_title: str = ""
        self.active_window_proc: str = ""
        self.active_window_dwell_seconds: float = 0.0
        self.last_nudge_time: float = 0.0

    def record_interaction(self):
        """Called whenever the user speaks or sends a message to Yuki."""
        now = time.time()
        self.last_interaction_time = now
        self.boredom = 0.0
        self.last_nudge_time = 0.0  # Clear any leftover nudge repeat cooldown so Cooldown resets to Ready
        if self.is_sleeping():
            self.set_sleep_state("waking", is_nap=self.is_nap)
        else:
            self.sleep_state = "active"

    def is_sleeping(self) -> bool:
        return self.sleep_state in ("sleeping", "napping")

    def set_sleep_state(self, new_state: str, idle_seconds: float = 0.0, is_nap: bool = False):
        """Update sleep state ('active', 'idle', 'drowsy', 'sleeping', 'napping', 'waking')."""
        now = time.time()
        self.user_idle_seconds = max(0.0, float(idle_seconds))

        if new_state in ("sleeping", "napping"):
            if self.is_date_mode:
                self.sleep_state = "active"
                return
            self.is_nap = is_nap if new_state == "sleeping" else True
            # Guard: If user is watching a video / listening to audio, suppress false sleep (except quiet companion naps)
            if not self.is_nap and is_media_or_audio_playing():
                print("[Presence] Media/sound output detected; suppressing sleeping state to active idle.")
                self.sleep_state = "idle"
                return

            if not self.is_sleeping():
                # Back-date sleep start by idle_seconds so the full inactive absence is counted
                self.sleep_started_at = now - self.user_idle_seconds if self.user_idle_seconds > 0 else now
                self.boredom = 0.0
                self.sleep_state = new_state
            else:
                self.sleep_state = new_state
        elif new_state in ("waking", "active"):
            if self.is_sleeping() and self.sleep_started_at:
                self.last_sleep_duration_sec = max(0.0, now - self.sleep_started_at)
                self.last_awakened_at = now
                self.sleep_started_at = None
                self.sleep_state = "waking" if new_state == "waking" else "active"
            elif new_state == "waking":
                if self.last_awakened_at == 0.0:
                    self.last_awakened_at = now
                self.sleep_state = "waking"
            else:
                self.sleep_state = new_state
        else:
            self.sleep_state = new_state

    def get_system_idle_seconds(self) -> float:
        """Returns the OS user idle time in seconds using Windows LastInputInfo API."""
        try:
            from app.memory.crawler import get_system_idle_time
            return float(get_system_idle_time())
        except Exception:
            return 0.0

    def step_idle(self, delta_seconds: float = 60.0, current_energy: float = 55.0) -> Optional[str]:
        """
        Accumulates or pauses subconscious state drifts during idle periods.
        Evaluates companion naps when energy is low (<= 30%) after silence threshold.
        Evaluates natural recovery waking when energy reaches healthy level (>= 65).
        """
        now = time.time()
        self.user_idle_seconds = self.get_system_idle_seconds()

        # Update active window, process, and dwell time
        curr_win, curr_proc = _get_current_active_window()
        if curr_win and curr_win == self.active_window_title:
            self.active_window_dwell_seconds += delta_seconds
        elif curr_win:
            self.active_window_title = curr_win
            self.active_window_proc = curr_proc
            self.active_window_dwell_seconds = 0.0

        elapsed_since_chat = max(0.0, now - self.last_interaction_time)

        # 1. Check for Companion Nap:
        # If awake/idle, energy is low (<= configured %, default 30), and no interaction with Yuki for configured minutes:
        silence_threshold = getattr(config, "COMPANION_NAP_SILENCE_MIN", 5) * 60.0
        energy_threshold = float(getattr(config, "COMPANION_NAP_ENERGY_PCT", 30))
        if self.sleep_state in ("active", "idle") and current_energy <= energy_threshold and elapsed_since_chat >= silence_threshold:
            print(f"[Presence] Energy is low ({current_energy}/100 <= {energy_threshold}) after {int(elapsed_since_chat)}s silence. Yuki is nodding off for a nap.")
            self.set_sleep_state("napping", idle_seconds=0.0, is_nap=True)
            self.boredom = 0.0
            return "started_nap"

        # 2. Check for Natural Recovery from Nap:
        # If napping and energy has recharged to healthy level (>= 65) after at least 3 minutes of nap:
        nap_duration = max(0.0, now - (self.sleep_started_at or now))
        if self.sleep_state == "napping" and current_energy >= 65.0 and nap_duration >= 180.0:
            os_idle = self.get_system_idle_seconds()
            desk_sleep_sec = getattr(config, "DESK_SLEEP_IDLE_MIN", 10) * 60.0
            if os_idle >= desk_sleep_sec and not is_media_or_audio_playing():
                print(f"[Presence] Yuki recharged energy ({current_energy}/100), but Master is away from PC ({int(os_idle)}s idle). Seamlessly transitioning from nap to full sleep.")
                self.set_sleep_state("sleeping", idle_seconds=os_idle, is_nap=False)
                return None
            print(f"[Presence] Yuki has recharged energy to {current_energy}/100! Waking up naturally refreshed from nap.")
            self.set_sleep_state("waking", is_nap=True)
            return "woke_from_nap"

        if self.is_date_mode:
            self.boredom = 0.0
            if self.sleep_state in ("sleeping", "napping", "drowsy"):
                self.sleep_state = "active"
            return None

        if self.is_sleeping():
            self.boredom = 0.0
            return None

        # Boredom rises smoothly when awake and idle (reaches 1.0 after ~30 minutes of no interaction)
        self.boredom = min(1.0, self.boredom + (delta_seconds / 1800.0))

        return None

    def get_presence_snapshot(self) -> Dict[str, Any]:
        """Returns live presence metrics for WebSocket broadcasts & UI gauges."""
        now = time.time()
        win_info = format_active_window(self.active_window_title, self.active_window_proc)
        media_playing = is_media_or_audio_playing()
        active_media = get_active_background_media(self.active_window_title) if media_playing else ""
        return {
            "boredom": round(self.boredom, 2),
            "boredom_pct": int(round(self.boredom * 100)),
            "sleep_state": self.sleep_state,
            "is_nap": self.is_nap,
            "is_date_mode": self.is_date_mode,
            "silence_seconds": int(max(0.0, now - self.last_interaction_time)),
            "user_idle_seconds": int(self.get_system_idle_seconds()),
            "is_media_playing": media_playing,
            "active_media": active_media,
            "active_window": self.active_window_title,
            "active_window_app": win_info.get("app", ""),
            "active_window_doc": win_info.get("doc", ""),
            "active_window_summary": win_info.get("summary", ""),
            "active_window_prompt": win_info.get("prompt", ""),
            "active_window_dwell_seconds": int(self.active_window_dwell_seconds),
            "active_window_dwell_mins": int(self.active_window_dwell_seconds // 60)
        }

    def get_temporal_context(self) -> str:
        """
        Generates an experiential, subjective perception of time for the LLM prompt.
        Transforms abstract clock timestamps into felt narrative context.
        """
        now = time.time()
        dt = datetime.datetime.now()
        time_str = dt.strftime("%I:%M %p").lstrip("0")
        day_str = dt.strftime("%A")

        # 1. Just woke up state
        if self.sleep_state == "waking" and self.last_sleep_duration_sec > 10:
            duration_mins = max(1, int(round(self.last_sleep_duration_sec / 60.0)))
            if self.is_nap:
                return (
                    f"[INTERNAL SENSE: You just woke up from a {duration_mins}-minute nap at your desk while Master was working. "
                    f"It is {time_str} on {day_str}. You feel refreshed, blinking and yawning softly with <yuki_anim:yawn/>. "
                    f"You know you took a {duration_mins}-minute nap.]"
                )
            elif duration_mins <= 30:
                return (
                    f"It is {time_str} on {day_str}. You are rubbing your eyes and yawning with <yuki_anim:yawn/>.]"
                )
            else:
                hours = round(duration_mins / 60.0, 1)
                return (
                    f"[INTERNAL SENSE: You just woke up after a long rest of {hours} hours ({duration_mins} minutes). "
                    f"It is {time_str} on {day_str}. You are yawning softly with <yuki_anim:yawn/> and ready for the day.]"
                )

        # 2. Active or awake state
        elapsed_silence = max(0.0, now - self.last_interaction_time)
        silence_mins = int(elapsed_silence // 60)

        hour = dt.hour
        if 5 <= hour < 12:
            period = "morning"
        elif 12 <= hour < 17:
            period = "afternoon"
        elif 17 <= hour < 22:
            period = "evening"
        else:
            period = "late night"

        if silence_mins < 2:
            silence_desc = "You and Master are actively talking."
        elif silence_mins < 10:
            silence_desc = f"You and Master last spoke {silence_mins} minutes ago."
        elif silence_mins < 30:
            if self.boredom > 0.5:
                silence_desc = f"It has been {silence_mins} minutes of quiet. You've been sitting quietly and are feeling a bit bored/daydreaming."
            else:
                silence_desc = f"It has been {silence_mins} minutes of quiet focus while Master works."
        else:
            silence_desc = f"It has been over {silence_mins} minutes since you last spoke."

        dwell_desc = ""
        if self.active_window_title and self.active_window_dwell_seconds >= 900:
            dwell_mins = int(self.active_window_dwell_seconds // 60)
            win_info = format_active_window(self.active_window_title, self.active_window_proc)
            dwell_desc = f" Master has been focused in {win_info.get('prompt') or self.active_window_title} for {dwell_mins} minutes."

        # Check if recently awakened (within the last 20 minutes) so Yuki retains exact memory of her sleep duration
        recent_wake_mins = (now - self.last_awakened_at) / 60.0 if self.last_awakened_at > 0 else 999.0
        sleep_memo = ""
        if recent_wake_mins <= 20.0 and self.last_sleep_duration_sec >= 10.0:
            nap_mins = max(1, int(round(self.last_sleep_duration_sec / 60.0)))
            if nap_mins < 60:
                duration_desc = f"{nap_mins} minute{'s' if nap_mins != 1 else ''}"
            else:
                hrs = round(nap_mins / 60.0, 1)
                duration_desc = f"{hrs} hours ({nap_mins} minutes)"
            wake_m = int(round(recent_wake_mins))
            wake_desc = "just now" if wake_m < 1 else f"{wake_m}m ago"
            sleep_kind = "taking a power nap at your desk while Master was working" if self.is_nap else "being asleep"
            sleep_memo = f" You woke up {wake_desc} after {sleep_kind} for {duration_desc}. If Master asks how long you were asleep or napping, you were asleep for {duration_desc}."

        return (
            f"[INTERNAL SENSE: Time is {time_str} ({day_str} {period}). {silence_desc}{dwell_desc}{sleep_memo} "
            f"Boredom: {int(self.boredom * 100)}%]"
        )


# Global singleton presence manager
presence_manager = PresenceEngine()


def get_versatile_template_nudge(active_window: str = "", dwell_mins: int = 0, boredom: float = 0.8, energy: float = 50.0, user_name: str = "") -> Tuple[str, str]:
    """
    Generates a natural, spoken-only nudge without asterisks or roleplay stage directions.
    Selects from versatile candidates based on foreground application, dwell duration, time of day, and boredom.
    Returns (spoken_text, anim_name).
    """
    now = datetime.datetime.now()
    hour = now.hour
    is_late_night = (0 <= hour < 5) or (hour >= 23)

    clean_win = ""
    win_lower = ""
    if active_window:
        win_info = format_active_window(active_window)
        clean_win = win_info.get("app") or active_window[:24]
        win_lower = f"{win_info.get('app', '')} {win_info.get('doc', '')} {active_window}".lower()

    name_clean = user_name.strip() if user_name and user_name.strip().lower() != "master" else ""
    tag = f" {name_clean}" if name_clean else ""

    candidates = []

    # 1. Late Night Awareness (00:00 - 05:00)
    if is_late_night:
        candidates.extend([
            (f"Psst{',' + tag if tag else ''}... it's getting really late. Aren't you sleepy yet?", "peer"),
            ("Mmh... it's the middle of the night. Make sure you don't overwork yourself.", "peer"),
            (f"Still awake? Your sleep schedule is completely upside down{tag}.", "pout"),
            ("Hey... don't stay up all night, okay? Even you need some sleep.", "wave")
        ])

    # 2. Application Category Awareness
    if any(k in win_lower for k in ("visual studio", "code", "cursor", "pycharm", "sublime", "intellij", "nvim", "vim", "dev")):
        candidates.extend([
            (f"Still wrestling with that code{tag}? Remember to blink sometimes!", "peer"),
            ("Psst... don't forget to take a sip of water while you're programming.", "peer"),
            ("You've been staring at that syntax for ages now. Take a quick breather!", "pout"),
            (f"Hey{tag}... don't let the compiler errors drive you crazy.", "wave")
        ])
    elif any(k in win_lower for k in ("chrome", "firefox", "edge", "brave", "safari", "opera", "browser")):
        candidates.extend([
            (f"Down another internet rabbit hole{tag}?", "peer"),
            ("Find anything interesting to read over there?", "peer"),
            ("Psst... how many tabs do you have open right now?", "pout"),
            (f"Don't get too lost in reading{tag}. Remember to stretch your neck!", "peer")
        ])
    elif any(k in win_lower for k in ("blender", "figma", "photoshop", "premiere", "after effects", "unity", "unreal", "illustrator")):
        candidates.extend([
            ("Working on something creative? Don't forget to shake out your hands.", "peer"),
            (f"That looks super detailed{tag}. Take a second to rest your eyes.", "peer"),
            ("Uwah... you've been focused on that design for a long time.", "pout")
        ])
    elif any(k in win_lower for k in ("powershell", "cmd", "terminal", "bash", "zsh", "command prompt")):
        candidates.extend([
            (f"Lots of commands flying by... everything compiling alright{tag}?", "peer"),
            ("Psst... don't let the terminal logs drive you crazy.", "pout")
        ])
    elif clean_win and dwell_mins >= 30:
        candidates.extend([
            (f"Still busy with {clean_win}? Don't forget to take a stretch break!", "peer"),
            (f"Psst... you've been working on {clean_win} for a while. Everything going smoothly?", "peer"),
            (f"Hey{tag}... make sure you pause and stretch your legs soon.", "wave")
        ])

    # 3. High Boredom Candidates (> 88%)
    if boredom >= 0.88:
        candidates.extend([
            (f"Mmh... it's so quiet. Did you get lost in your work{tag}?", "pout"),
            ("Psst... say something to me whenever you get a break.", "pout"),
            ("Uwah... I'm so bored sitting here. How much longer are you working?", "pout"),
            (f"Hey{tag}... I'm still right here beside you, you know.", "wave")
        ])

    # 4. General Caring Companion Fallbacks
    candidates.extend([
        (f"Psst{',' + tag if tag else ''}... taking a break anytime soon?", "peer"),
        (f"Mmh... don't forget to drink some water{tag}.", "wave"),
        ("Hey... just checking in on you. Don't push yourself too hard.", "wave"),
        (f"You've been super focused today{tag}. Remember to take care of yourself.", "peer")
    ])

    return random.choice(candidates)

