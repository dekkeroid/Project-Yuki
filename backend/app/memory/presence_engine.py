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


class PresenceEngine:
    def __init__(self):
        now = time.time()
        self.last_interaction_time: float = now
        self.sleep_started_at: Optional[float] = None
        self.last_sleep_duration_sec: float = 0.0
        self.sleep_state: str = "active"  # "active", "idle", "drowsy", "sleeping", "waking"
        self.boredom: float = 0.0         # 0.0 (fully engaged) to 1.0 (very bored)
        self.user_idle_seconds: float = 0.0

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
            if self.sleep_state != "sleeping":
                self.sleep_started_at = now
                self.boredom = 0.0
                self.sleep_state = "sleeping"
        elif new_state in ("waking", "active"):
            if self.sleep_state == "sleeping" and self.sleep_started_at:
                self.last_sleep_duration_sec = max(0.0, now - self.sleep_started_at)
                self.sleep_started_at = None
                self.sleep_state = "waking" if new_state == "waking" else "active"
            else:
                self.sleep_state = new_state
        else:
            self.sleep_state = new_state

    def step_idle(self, delta_seconds: float = 60.0):
        """Accumulates or pauses subconscious state drifts during idle periods."""
        if self.is_sleeping():
            self.boredom = 0.0
            return

        now = time.time()
        elapsed_since_chat = max(0.0, now - self.last_interaction_time)

        # Boredom rises smoothly when awake and idle (reaches 1.0 after ~30 minutes of no interaction)
        if elapsed_since_chat > 300:  # after 5 minutes of silence
            # increment roughly 0.03 per minute
            self.boredom = min(1.0, self.boredom + (delta_seconds / 1800.0))
        else:
            self.boredom = max(0.0, self.boredom - (delta_seconds / 600.0))

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
            duration_mins = int(round(self.last_sleep_duration_sec / 60.0))
            if duration_mins < 1:
                return (
                    f"[INTERNAL SENSE: You just briefly dozed off for a moment and woke up because Master returned. "
                    f"It is {time_str} on {day_str}. You feel a little surprised and are shaking off sleepiness.]"
                )
            elif duration_mins <= 30:
                return (
                    f"[INTERNAL SENSE: You just woke up from a {duration_mins}-minute power nap because Master returned. "
                    f"It is {time_str} on {day_str}. You feel a little groggy, blinking and stretching with <yuki_anim:stretch/>.]"
                )
            elif duration_mins <= 180:
                hours = round(duration_mins / 60.0, 1)
                return (
                    f"[INTERNAL SENSE: You just woke up from a long {hours}-hour deep sleep. "
                    f"It is {time_str} on {day_str}. You are rubbing your eyes and yawning with <yuki_anim:yawn/>.]"
                )
            else:
                return (
                    f"[INTERNAL SENSE: You just woke up after a very long rest. "
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

        return (
            f"[INTERNAL SENSE: Time is {time_str} ({day_str} {period}). {silence_desc} "
            f"Boredom: {int(self.boredom * 100)}%]"
        )


# Global singleton presence manager
presence_manager = PresenceEngine()
