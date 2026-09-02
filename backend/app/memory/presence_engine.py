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
from typing import Optional, Dict, Any


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
        self.sleep_state: str = "active"  # "active", "idle", "drowsy", "sleeping", "waking"
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
        if self.sleep_state == "sleeping":
            self.set_sleep_state("waking")
        else:
            self.sleep_state = "active"

    def is_sleeping(self) -> bool:
        return self.sleep_state == "sleeping"

    def set_sleep_state(self, new_state: str, idle_seconds: float = 0.0):
        """Update sleep state ('active', 'idle', 'drowsy', 'sleeping', 'waking')."""
        now = time.time()
        self.user_idle_seconds = max(0.0, float(idle_seconds))

        if new_state == "sleeping":
            # Guard: If user is watching a video / listening to audio, suppress false sleep
            if is_media_or_audio_playing():
                print("[Presence] Media/sound output detected; suppressing sleeping state to active idle.")
                self.sleep_state = "idle"
                return

            if self.sleep_state != "sleeping":
                # Back-date sleep start by idle_seconds so the full inactive absence is counted
                self.sleep_started_at = now - self.user_idle_seconds if self.user_idle_seconds > 0 else now
                self.boredom = 0.0
                self.sleep_state = "sleeping"
        elif new_state in ("waking", "active"):
            if self.sleep_state == "sleeping" and self.sleep_started_at:
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

    def step_idle(self, delta_seconds: float = 60.0):
        """Accumulates or pauses subconscious state drifts during idle periods."""
        now = time.time()

        # Update active window and dwell time
        curr_win = _get_current_active_window()
        if curr_win and curr_win == self.active_window_title:
            self.active_window_dwell_seconds += delta_seconds
        elif curr_win:
            self.active_window_title = curr_win
            self.active_window_dwell_seconds = 0.0

        if self.is_sleeping():
            self.boredom = 0.0
            return

        elapsed_since_chat = max(0.0, now - self.last_interaction_time)

        # Boredom rises smoothly when awake and idle (reaches 1.0 after ~30 minutes of no interaction)
        if elapsed_since_chat > 300:  # after 5 minutes of silence
            self.boredom = min(1.0, self.boredom + (delta_seconds / 1800.0))
        else:
            self.boredom = max(0.0, self.boredom - (delta_seconds / 600.0))

    def get_presence_snapshot(self) -> Dict[str, Any]:
        """Returns live presence metrics for WebSocket broadcasts & UI gauges."""
        now = time.time()
        return {
            "boredom": round(self.boredom, 2),
            "boredom_pct": int(round(self.boredom * 100)),
            "sleep_state": self.sleep_state,
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
            if duration_mins <= 30:
                return (
                    f"[INTERNAL SENSE: You just woke up from a {duration_mins}-minute power nap because Master returned. "
                    f"It is {time_str} on {day_str}. You feel a little groggy, blinking and stretching with <yuki_anim:stretch/>. "
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
                    f"It is {time_str} on {day_str}. You are stretching and ready for the day.]"
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
            sleep_memo = f" You woke up {wake_desc} after sleeping for {duration_desc}. If Master asks how long you were asleep, you were asleep for {duration_desc}."

        return (
            f"[INTERNAL SENSE: Time is {time_str} ({day_str} {period}). {silence_desc}{dwell_desc}{sleep_memo} "
            f"Boredom: {int(self.boredom * 100)}%]"
        )


# Global singleton presence manager
presence_manager = PresenceEngine()
