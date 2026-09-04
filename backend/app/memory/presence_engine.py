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


def _get_current_active_window() -> str:
    """Read the current foreground window title safely."""
    try:
        import ctypes
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        if not hwnd:
            return ""
        buf = ctypes.create_unicode_buffer(256)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, 256)
        title = buf.value.strip()
        yuki_keywords = ("yuki", "project yuki", "control dashboard", "vrm viewer", "electron")
        if any(k in title.lower() for k in yuki_keywords):
            return ""
        return title
    except Exception:
        return ""


class PresenceEngine:
    def __init__(self):
        now = time.time()
        self.last_interaction_time: float = now
        self.sleep_started_at: Optional[float] = None
        self.last_sleep_duration_sec: float = 0.0
        self.last_awakened_at: float = 0.0
        self.is_nap: bool = False
        self.sleep_state: str = "active"  # "active", "idle", "drowsy", "sleeping", "napping", "waking"
        self.boredom: float = 0.0         # 0.0 (fully engaged) to 1.0 (very bored)
        self.user_idle_seconds: float = 0.0
        self.active_window_title: str = ""
        self.active_window_dwell_seconds: float = 0.0
        self.last_nudge_time: float = 0.0

    def record_interaction(self):
        """Called whenever the user speaks or sends a message to Yuki."""
        now = time.time()
        self.last_interaction_time = now
        self.boredom = 0.0
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

    def step_idle(self, delta_seconds: float = 60.0, current_energy: float = 55.0) -> Optional[str]:
        """
        Accumulates or pauses subconscious state drifts during idle periods.
        Evaluates companion naps when energy is low (<= 30%) after silence threshold.
        Evaluates natural recovery waking when energy reaches healthy level (>= 65).
        """
        now = time.time()

        # Update active window and dwell time
        curr_win = _get_current_active_window()
        if curr_win and curr_win == self.active_window_title:
            self.active_window_dwell_seconds += delta_seconds
        elif curr_win:
            self.active_window_title = curr_win
            self.active_window_dwell_seconds = 0.0

        elapsed_since_chat = max(0.0, now - self.last_interaction_time)

        # 1. Check for Companion Nap:
        # If awake/idle, energy is low (<= configured %, default 30), and no interaction with Yuki for configured minutes:
        silence_threshold = getattr(config, "COMPANION_NAP_SILENCE_MIN", 5) * 60.0
        energy_threshold = float(getattr(config, "COMPANION_NAP_ENERGY_PCT", 30))
        if self.sleep_state in ("active", "idle") and current_energy <= energy_threshold and elapsed_since_chat >= silence_threshold:
            print(f"[Presence] Energy is low ({current_energy}/100 <= {energy_threshold}) after {int(elapsed_since_chat)}s silence. Yuki is nodding off for a nap.")
            self.set_sleep_state("napping", idle_seconds=silence_threshold, is_nap=True)
            self.boredom = 0.0
            return "started_nap"

        # 2. Check for Natural Recovery from Nap:
        # If napping and energy has recharged to healthy level (>= 65) after at least 3 minutes of nap:
        nap_duration = max(0.0, now - (self.sleep_started_at or now))
        if self.sleep_state == "napping" and current_energy >= 65.0 and nap_duration >= 180.0:
            if self.user_idle_seconds >= 180.0:
                print(f"[Presence] Yuki recharged energy ({current_energy}/100), but Master is away from PC. Seamlessly transitioning from nap to full sleep.")
                self.set_sleep_state("sleeping", idle_seconds=self.user_idle_seconds, is_nap=False)
                return None
            print(f"[Presence] Yuki has recharged energy to {current_energy}/100! Waking up naturally refreshed from nap.")
            self.set_sleep_state("waking", is_nap=True)
            return "woke_from_nap"

        if self.is_sleeping():
            self.boredom = 0.0
            return None

        # Boredom rises smoothly when awake and idle (reaches 1.0 after ~30 minutes of no interaction)
        if elapsed_since_chat > 300:  # after 5 minutes of silence
            self.boredom = min(1.0, self.boredom + (delta_seconds / 1800.0))
        else:
            self.boredom = max(0.0, self.boredom - (delta_seconds / 600.0))

        return None

    def get_presence_snapshot(self) -> Dict[str, Any]:
        """Returns live presence metrics for WebSocket broadcasts & UI gauges."""
        now = time.time()
        return {
            "boredom": round(self.boredom, 2),
            "boredom_pct": int(round(self.boredom * 100)),
            "sleep_state": self.sleep_state,
            "is_nap": self.is_nap,
            "silence_seconds": int(max(0.0, now - self.last_interaction_time)),
            "active_window": self.active_window_title,
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
                    f"[INTERNAL SENSE: You just woke up from a {duration_mins}-minute power nap because Master returned. "
                    f"It is {time_str} on {day_str}. You feel a little groggy, blinking and yawning with <yuki_anim:yawn/>. "
                    f"You know you were asleep for {duration_mins} minute{'s' if duration_mins != 1 else ''}.]"
                )
            elif duration_mins <= 180:
                hours = round(duration_mins / 60.0, 1)
                return (
                    f"[INTERNAL SENSE: You just woke up from a {hours}-hour deep sleep ({duration_mins} minutes). "
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
            dwell_desc = f" Master has been focused in \"{self.active_window_title}\" for {dwell_mins} minutes."

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


def get_versatile_template_nudge(active_window: str = "", dwell_mins: int = 0, boredom: float = 0.8, energy: float = 50.0) -> Tuple[str, str]:
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
        clean_win = active_window.split("-")[-1].split("—")[-1].strip()[:24]
        win_lower = active_window.lower()

    candidates = []

    # 1. Late Night Awareness (00:00 - 05:00)
    if is_late_night:
        candidates.extend([
            ("Psst, Master... it's getting really late. Aren't you sleepy yet?", "peer"),
            ("Mmh... it's the middle of the night. Make sure you don't overwork yourself.", "peer"),
            ("Still awake? Your sleep schedule is completely upside down, Master.", "pout"),
            ("Hey... don't stay up all night, okay? Even you need some sleep.", "wave")
        ])

    # 2. Application Category Awareness
    if any(k in win_lower for k in ("visual studio", "code", "cursor", "pycharm", "sublime", "intellij", "nvim", "vim", "dev")):
        candidates.extend([
            ("Still wrestling with that code, Master? Remember to blink sometimes!", "peer"),
            ("Psst... don't forget to take a sip of water while you're programming.", "peer"),
            ("You've been staring at that syntax for ages now. Take a quick breather!", "pout"),
            ("Hey, Master... don't let the compiler errors drive you crazy.", "wave")
        ])
    elif any(k in win_lower for k in ("chrome", "firefox", "edge", "brave", "safari", "opera", "browser")):
        candidates.extend([
            ("Down another internet rabbit hole, Master?", "peer"),
            ("Find anything interesting to read over there?", "peer"),
            ("Psst... how many tabs do you have open right now?", "pout"),
            ("Don't get too lost in reading, Master. Remember to stretch your neck!", "peer")
        ])
    elif any(k in win_lower for k in ("blender", "figma", "photoshop", "premiere", "after effects", "unity", "unreal", "illustrator")):
        candidates.extend([
            ("Working on something creative? Don't forget to shake out your hands.", "peer"),
            ("That looks super detailed, Master. Take a second to rest your eyes.", "peer"),
            ("Uwah... you've been focused on that design for a long time.", "pout")
        ])
    elif any(k in win_lower for k in ("powershell", "cmd", "terminal", "bash", "zsh", "command prompt")):
        candidates.extend([
            ("Lots of commands flying by... everything compiling alright, Master?", "peer"),
            ("Psst... don't let the terminal logs drive you crazy.", "pout")
        ])
    elif clean_win and dwell_mins >= 30:
        candidates.extend([
            (f"Still busy with {clean_win}? Don't forget to take a stretch break!", "peer"),
            (f"Psst... you've been working on {clean_win} for a while. Everything going smoothly?", "peer"),
            (f"Hey, Master... make sure you pause and stretch your legs soon.", "wave")
        ])

    # 3. High Boredom Candidates (> 88%)
    if boredom >= 0.88:
        candidates.extend([
            ("Mmh... it's so quiet. Did you get lost in your work, Master?", "pout"),
            ("Psst... Master. Say something to me whenever you get a break.", "pout"),
            ("Uwah... I'm so bored sitting here. How much longer are you working?", "pout"),
            ("Hey, Master... I'm still right here beside you, you know.", "wave")
        ])

    # 4. General Caring Companion Fallbacks
    candidates.extend([
        ("Psst, Master... taking a break anytime soon?", "peer"),
        ("Mmh... don't forget to drink some water, Master.", "wave"),
        ("Hey... just checking in on you. Don't push yourself too hard.", "wave"),
        ("You've been super focused today, Master. Remember to take care of yourself.", "peer")
    ])

    return random.choice(candidates)

