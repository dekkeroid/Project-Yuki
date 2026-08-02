"""
Mood Engine v2 — a living psychological simulator for Yuki.

Replaces the static 8-axis mood table with a system that actually moves, driven by:

  * Personality baselines + per-axis volatility (how moody she is here)
  * A bounded Ornstein-Uhlenbeck random walk that drifts toward her "home" mood
  * Circadian rhythms (energy peaks/dips, meal-time hunger) by time of day
  * Reactive events — script/regex sentiment from the user's messages
  * Optional LLM mood deltas parsed from a hidden <mood_update> tag in her reply
  * Offline catch-up + seeded daily shake-up so every launch feels different

The engine owns two persisted buckets inside the profile dict:
  * "mood_spectrum"  — her *current* state (kept for API/UI compatibility)
  * "mood_baselines" — her natural home per axis (personality)
plus "mood_last_update" (epoch) and "mood_day_seed" (date string).
"""

import json
import math
import random
import re
import time

# ------------------------------------------------------------------ #
#  Axis personalities                                                 #
#  baseline   — natural home value (her personality).                 #
#  volatility — std-dev of the random walk per hour. The "chaos" knob.#
#  decay      — fraction of the gap to baseline closed per hour.      #
# ------------------------------------------------------------------ #
AXES = {
    "happiness":    {"baseline": 75, "volatility": 5, "decay": 0.28},
    "energy":       {"baseline": 65, "volatility": 7, "decay": 0.22},
    "curiosity":    {"baseline": 80, "volatility": 4, "decay": 0.16},
    "affection":    {"baseline": 70, "volatility": 5, "decay": 0.20},
    "stress_level": {"baseline": 15, "volatility": 6, "decay": 0.16},
    "doomer":       {"baseline": 20, "volatility": 4, "decay": 0.10},
    "hunger":       {"baseline": 30, "volatility": 6, "decay": 0.38},
    "playfulness":  {"baseline": 55, "volatility": 7, "decay": 0.26},
    "horniness":    {"baseline": 50, "volatility": 5, "decay": 0.20},
}

# Axes the LLM mood tag is never allowed to set (script/physical drives only).
SCRIPT_ONLY_AXES = {"horniness"}

# In LLM mood mode, which axes stay script-driven (physical drives the LLM
# cannot judge reliably). The LLM tag handles the emotional axes instead.
LLM_MODE_SCRIPT_AXES = {"horniness", "hunger"}

# Cap for how many hours of offline time we simulate on startup.
MAX_OFFLINE_CATCHUP_HOURS = 16.0


def _clamp(x) -> int:
    return int(round(max(0.0, min(100.0, float(x)))))


def _circadian_energy(hour: float) -> float:
    """Energy target by time-of-day: peaks ~10am, post-lunch dip, low at night."""
    base = 58.0 + 26.0 * math.cos((hour - 10.0) / 24.0 * 2 * math.pi)
    dip = 6.0 * math.exp(-((hour - 14.5) ** 2) / (2 * 1.2 ** 2))
    return base - dip


def _circadian_hunger(hour: float) -> float:
    """Hunger target spiking around breakfast / lunch / dinner."""
    base = 18.0
    for peak in (8.0, 13.0, 19.5):
        base += 34.0 * math.exp(-((hour - peak) ** 2) / (2 * 2.2 ** 2))
    return base


# ------------------------------------------------------------------ #
#  Reactive events (script / regex path)                              #
# ------------------------------------------------------------------ #
REACTIONS = [
    ("intimacy", [
        "kiss", "kissing", "kisses", "cuddle", "cuddling", "embrace",
        "make out", "holding hands", "hold my hand", "touch me", "lips",
        "hug me", "snuggle", "sexy", "flirt", "muah", "xoxo", "romantic",
    ], {"horniness": 12, "affection": 6, "happiness": 4, "playfulness": 3}),
    ("food", [
        "eat", "food", "dinner", "lunch", "breakfast", "snack", "pizza",
        "burger", "cookie", "ramen", "hungry", "cook", "taco", "sushi",
        "noodles", "pasta", "dessert", "ice cream", "ordering food",
    ], {"hunger": -22, "happiness": 4}),
    ("praise", [
        "thank you", "you're the best", "you are the best", "cute", "adorable",
        "amazing", "wonderful", "great job", "well done", "perfect", "beautiful",
        "pretty", "sweet", "kind", "appreciate", "impressive", "you rock",
        "awesome", "genius", "smart", "love you", "i love you",
    ], {"happiness": 6, "affection": 5, "stress_level": -3}),
    ("insult", [
        "stupid", "idiot", "dumb", "shut up", "annoying", "lazy", "pathetic",
        "useless", "trash", "ugly", "hate you", "i hate you", "boring",
        "dummy", "moron", "failure", "worst", "are you serious", "really now",
    ], {"happiness": -8, "stress_level": 8, "affection": -4, "playfulness": -2}),
    ("anger", [
        "angry", "furious", "pissed", "pissed off", "annoyed", "this sucks",
        "fix it now", "what the hell", "damn it", "dammit", "enough", "stop it",
        "that's wrong", "wrong again", "not working",
    ], {"stress_level": 6, "happiness": -4, "energy": -2}),
    ("sad", [
        "sad", "depressed", "lonely", "upset", "crying", "feel down",
        "tired of everything", "miserable", "heartbroken", "homesick", "grief",
    ], {"happiness": -4, "stress_level": 3, "affection": 5, "doomer": 3}),
    ("playful", [
        "haha", "hehe", "lol", "lmao", "just kidding", "joking", "prank",
        "tease", "troll", "funny", "laugh", "rofl", "giggle",
    ], {"playfulness": 6, "happiness": 3}),
    ("greeting", [
        "hello", "hey", "good morning", "good afternoon", "good evening",
        "yo", "heya", "sup", "morning!", "hi there",
    ], {"happiness": 3, "energy": 2, "playfulness": 3, "affection": 2}),
    ("farewell", [
        "bye", "goodbye", "good night", "goodnight", "going to sleep",
        "going to bed", "see you", "gtg", "heading out", "time to sleep",
    ], {"affection": 4, "energy": -3, "playfulness": -2}),
    ("complaint", [
        "ugh", "this is so hard", "why me", "everything is broken",
        "nothing works", "i can't do this", "so frustrating", "this is a mess",
        "awful", "horrible day", "what a day",
    ], {"stress_level": 5, "happiness": -3, "doomer": 2}),
    ("comfort", [
        "i'm here", "you're ok", "its ok", "don't worry", "it'll be okay",
        "everything will be fine", "you've got this", "i'll take care of you",
        "feel better", "it's not your fault", "take your time",
    ], {"affection": 5, "happiness": 2, "stress_level": -3}),
    ("help_request", [
        "can you", "could you", "please", "help me", "need you", "will you",
        "do me a favor", "assist me", "i need your help",
    ], {"happiness": 2, "energy": 3}),
]

# Single-char / short greeting tokens are matched word-bounded so "hi"
# doesn't fire inside "this" / "high".
_REACTION_PATTERNS = [
    (name, [re.compile(r"(?<!\w)" + re.escape(kw) + r"(?!\w)", re.IGNORECASE) for kw in kws], deltas)
    for name, kws, deltas in REACTIONS
]

# Cap for the net reaction delta applied to a single axis per turn.
MAX_REACTION_DELTA = 15

# ------------------------------------------------------------------ #
#  LLM mood tag scrubbing                                             #
# ------------------------------------------------------------------ #
_MOOD_TAG_RE = re.compile(r"<mood_update>\s*(.*?)\s*</mood_update>", re.DOTALL)


class MoodTagScrubber:
    """Wraps a parsed stream and extracts/strips hidden <mood_update> tags.

    The LLM is instructed to append a hidden JSON tag at the end of its reply.
    This wrapper intercepts "token" events, removes the tag so it never reaches
    chat/TTS/avatar, and collects the raw JSON payloads in ``self.deltas``.
    """

    def __init__(self):
        self.deltas = []

    async def wrap(self, parsed_stream):
        holdback = ""
        last_label = "local"
        async for event_type, value, label in parsed_stream:
            last_label = label
            if event_type == "token":
                holdback += value
                emit, holdback = self._consume(holdback, force=False)
                if emit:
                    yield "token", emit, label
            else:
                if holdback:
                    emit, holdback = self._consume(holdback, force=True)
                    if emit:
                        yield "token", emit, label
                yield event_type, value, label
        if holdback:
            emit, _rest = self._consume(holdback, force=True)
            if emit:
                yield "token", emit, last_label

    def _consume(self, buffer: str, force: bool = False):
        emit_parts = []
        pos = 0
        while True:
            m = _MOOD_TAG_RE.search(buffer, pos)
            if not m:
                break
            emit_parts.append(buffer[pos:m.start()])
            raw = m.group(1).strip()
            if raw:
                self.deltas.append(raw)
            pos = m.end()

        emit = "".join(emit_parts)
        tail = buffer[pos:]

        idx = tail.find("<mood_update>")
        if idx != -1:
            # An unfinished opening tag is buffered until it closes (or the
            # stream ends / a tool boundary forces us to drop it).
            emit += tail[:idx]
            tail = "" if force else tail[idx:]
        else:
            emit += tail
            tail = ""
        return emit, tail

    def parsed_deltas(self) -> dict:
        """Merge every captured tag into a single int-delta dict (later wins)."""
        out = {}
        for raw in self.deltas:
            try:
                data = json.loads(raw)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            for k, v in data.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    out[k] = int(v)
        return out


# ------------------------------------------------------------------ #
#  The engine                                                         #
# ------------------------------------------------------------------ #
class MoodEngine:
    def __init__(self, profile: dict, save_fn, broadcast_fn=None):
        self._profile = profile
        self._save = save_fn
        self._broadcast = broadcast_fn
        self._ensure_initialized()

    # -- persistence helpers -----------------------------------------
    def _ensure_initialized(self):
        ms = self._profile.get("mood_spectrum")
        if not isinstance(ms, dict):
            ms = {k: cfg["baseline"] for k, cfg in AXES.items()}
            self._profile["mood_spectrum"] = ms
        changed = False
        for k, cfg in AXES.items():
            if k not in ms or not isinstance(ms[k], (int, float)):
                ms[k] = cfg["baseline"]
                changed = True

        mb = self._profile.get("mood_baselines")
        if not isinstance(mb, dict):
            self._profile["mood_baselines"] = {k: _clamp(ms.get(k, cfg["baseline"])) for k, cfg in AXES.items()}
            changed = True
        else:
            for k, cfg in AXES.items():
                if k not in mb:
                    mb[k] = cfg["baseline"]
                    changed = True

        if "mood_last_update" not in self._profile or not isinstance(self._profile["mood_last_update"], (int, float)):
            self._profile["mood_last_update"] = time.time()
            changed = True
        if changed:
            self._save()

    def _read(self) -> dict:
        self._ensure_initialized()
        return self._profile["mood_spectrum"]

    def _write(self, values: dict):
        self._profile["mood_spectrum"] = {k: _clamp(values[k]) for k in AXES if k in values}

    def _baselines(self) -> dict:
        mb = self._profile.get("mood_baselines") or {}
        return {k: _clamp(mb.get(k, cfg["baseline"])) for k, cfg in AXES.items()}

    def _touch(self):
        self._profile["mood_last_update"] = time.time()
        self._save()
        self._notify()

    def _notify(self):
        if not self._broadcast:
            return
        payload = {
            "type": "mood_update",
            "mood": {
                **self.current(),
                "expression": self.expression(),
                "voice": self.voice_scale(),
                "baselines": self._baselines(),
            },
        }
        try:
            import asyncio
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return
            if loop.is_running():
                loop.create_task(self._broadcast(payload))
        except Exception:
            pass

    def set_broadcast(self, broadcast_fn):
        self._broadcast = broadcast_fn

    # -- public API --------------------------------------------------
    def current(self) -> dict:
        return {k: _clamp(v) for k, v in self._read().items()}

    def baselines(self) -> dict:
        return self._baselines()

    def apply_manual(self, updates: dict) -> dict:
        """Slider overrides — sets absolute current values (decay pulls her back later)."""
        current = self._read()
        changed = False
        for k, v in updates.items():
            if k not in AXES:
                continue
            try:
                nv = _clamp(int(v))
            except Exception:
                continue
            if nv != current[k]:
                current[k] = nv
                changed = True
        if changed:
            self._write(current)
            self._touch()
        return self.current()

    def set_baseline(self, updates: dict) -> dict:
        mb = self._baselines()
        changed = False
        for k, v in updates.items():
            if k in AXES:
                try:
                    nv = _clamp(int(v))
                except Exception:
                    continue
                if nv != mb[k]:
                    mb[k] = nv
                    changed = True
        if changed:
            self._profile["mood_baselines"] = mb
            self._touch()
        return mb

    def reset(self) -> dict:
        self._write(self._baselines())
        self._touch()
        return self.current()

    def step(self, now: float = None) -> bool:
        """Time-based drift (decay to home + bounded random walk + circadian)."""
        now = now if now is not None else time.time()
        last = self._profile.get("mood_last_update") or now
        hours = max(0.0, (now - last) / 3600.0)
        changed = self._drift(now, hours, noise_scale=1.0)
        self._profile["mood_last_update"] = now
        if changed:
            self._save()
            self._notify()
        return changed

    def react_to_message(self, text: str, scope: str = "full") -> dict:
        """Script/regex mood reactions. scope: full | physical | emotion."""
        if not text:
            return {}
        updates = {}
        for _name, patterns, deltas in _REACTION_PATTERNS:
            if any(p.search(text) for p in patterns):
                for axis, delta in deltas.items():
                    updates[axis] = updates.get(axis, 0) + delta
        for axis in list(updates):
            updates[axis] = max(-MAX_REACTION_DELTA, min(MAX_REACTION_DELTA, int(updates[axis])))
        if scope == "physical":
            updates = {k: v for k, v in updates.items() if k in LLM_MODE_SCRIPT_AXES}
        elif scope == "emotion":
            updates = {k: v for k, v in updates.items() if k not in LLM_MODE_SCRIPT_AXES}
        if updates:
            self.apply_deltas(updates)
        return updates

    def apply_llm_deltas(self, deltas: dict) -> bool:
        """Apply parsed LLM <mood_update> deltas (script-only axes are blocked)."""
        clean = {k: v for k, v in deltas.items() if k in AXES and k not in SCRIPT_ONLY_AXES}
        if not clean:
            return False
        self.apply_deltas(clean)
        return True

    def apply_deltas(self, deltas: dict):
        current = self._read()
        for k, v in deltas.items():
            if k in AXES and isinstance(v, (int, float)) and not isinstance(v, bool):
                current[k] = _clamp(current[k] + v)
        self._write(current)
        self._touch()

    def react_to_outcome(self, tool_name: str, success: bool):
        """Reactions to her own tool results — doing work saps energy, failing stresses her."""
        if success:
            self.apply_deltas({"happiness": 2, "energy": -1, "stress_level": -1})
        else:
            self.apply_deltas({"happiness": -3, "stress_level": 4, "energy": -2})

    def on_startup(self, now: float = None) -> bool:
        """Offline catch-up + daily shake-up + hourly jitter so each launch differs."""
        now = now if now is not None else time.time()
        last = self._profile.get("mood_last_update") or now
        hours = min(MAX_OFFLINE_CATCHUP_HOURS, max(0.0, (now - last) / 3600.0))
        changed = self._drift(now, hours, noise_scale=0.55)
        changed = self._daily_shakeup(now) or changed
        changed = self._startup_jitter(now) or changed
        self._profile["mood_last_update"] = now
        if changed:
            self._save()
            self._notify()
        return changed

    # -- internals ---------------------------------------------------
    def _home_value(self, axis: str, lt) -> float:
        base = self._baselines()[axis]
        if axis == "energy":
            return base + (_circadian_energy(lt.tm_hour + lt.tm_min / 60.0) - 58.0) * 0.5
        if axis == "hunger":
            return base + (_circadian_hunger(lt.tm_hour + lt.tm_min / 60.0) - 18.0) * 0.4
        return base

    def _drift(self, now: float, hours: float, noise_scale: float = 1.0) -> bool:
        if hours <= 0:
            return False
        current = self._read()
        lt = time.localtime(now)
        changed = False
        for axis, cfg in AXES.items():
            home = self._home_value(axis, lt)
            pull = (home - current[axis]) * (1.0 - math.exp(-cfg["decay"] * hours))
            noise = random.gauss(0.0, cfg["volatility"] * math.sqrt(hours) * noise_scale)
            new = _clamp(current[axis] + pull + noise)
            if new != current[axis]:
                changed = True
                current[axis] = new
        if changed:
            self._write(current)
        return changed

    def _daily_shakeup(self, now: float) -> bool:
        date_str = time.strftime("%Y-%m-%d", time.localtime(now))
        if self._profile.get("mood_day_seed") == date_str:
            return False
        seed = "yuki-day:" + date_str + ":" + json.dumps(self._baselines(), sort_keys=True)
        rng = random.Random(seed)
        lt = time.localtime(now)
        current = self._read()
        spread = {
            "happiness": 12, "energy": 10, "curiosity": 10, "affection": 10,
            "stress_level": 10, "doomer": 10, "hunger": 12, "playfulness": 12, "horniness": 10,
        }
        for axis in AXES:
            current[axis] = _clamp(self._home_value(axis, lt) + rng.uniform(-spread[axis], spread[axis]))
        self._write(current)
        self._profile["mood_day_seed"] = date_str
        return True

    def _startup_jitter(self, now: float) -> bool:
        hour_key = time.strftime("%Y-%m-%d:%H", time.localtime(now))
        seed = "yuki-hour:" + hour_key + ":" + json.dumps(self._baselines(), sort_keys=True)
        rng = random.Random(seed)
        current = self._read()
        changed = False
        for axis in AXES:
            new = _clamp(current[axis] + rng.uniform(-2.5, 2.5))
            if new != current[axis]:
                changed = True
                current[axis] = new
        if changed:
            self._write(current)
        return changed

    # -- outputs for prompt / avatar / voice -------------------------
    def narrative(self) -> str:
        m = self.current()
        base = self._baselines()
        parts = []

        def trend(axis, high, low):
            diff = m[axis] - base[axis]
            if diff >= 8:
                return high
            if diff <= -8:
                return low
            return None

        v = trend("happiness", "You're in a notably better mood than your norm right now.",
                  "You're feeling a bit down compared to your usual self.")
        if v:
            parts.append(v)
        v = trend("energy", "You have more energy than usual.",
                  "You're running on low energy today.")
        if v:
            parts.append(v)
        v = trend("stress_level", "You're feeling more on edge than usual.",
                  "You're unusually relaxed and at ease right now.")
        if v:
            parts.append(v)
        v = trend("affection", "You're feeling extra affectionate.",
                  "You're feeling a bit more distant than usual.")
        if v:
            parts.append(v)
        v = trend("playfulness", "You're feeling mischievous and playful.",
                  "You're in a more serious mood right now.")
        if v:
            parts.append(v)

        if m["hunger"] >= 65:
            parts.append("You're getting hungry and could really go for a snack.")
        elif m["hunger"] <= 12:
            parts.append("You're comfortably full and not hungry at all.")
        if m["energy"] <= 35:
            parts.append("You're starting to feel drowsy.")
        if m["horniness"] >= 75:
            parts.append("You're feeling warm and intimately inclined.")

        if not parts:
            parts.append("You feel about like you normally do.")
        return " ".join(parts)

    def volatility_label(self) -> str:
        avg = sum(cfg["volatility"] for cfg in AXES.values()) / len(AXES)
        return "high" if avg >= 6.0 else ("medium" if avg >= 5.0 else "low")

    def expression(self) -> str:
        """Dominant avatar expression when the LLM emits no explicit tag."""
        m = self.current()
        if m["energy"] <= 30:
            return "relaxed"
        if m["happiness"] <= 25 or m["stress_level"] >= 70:
            return "sad"
        if m["stress_level"] >= 60:
            return "surprised"
        if m["playfulness"] >= 70:
            return "smug"
        if m["happiness"] >= 70 and m["energy"] >= 55:
            return "happy"
        return "relaxed"

    def voice_scale(self) -> dict:
        """Suggested TTS rate/energy modifiers derived from current mood."""
        m = self.current()
        energy = m["energy"] / 100.0
        happiness = m["happiness"] / 100.0
        rate = round(0.92 + 0.18 * energy + 0.06 * happiness, 2)
        return {"rate": rate, "energy": round(energy, 2), "valence": round(happiness, 2)}

    def meta(self) -> dict:
        return {
            "narrative": self.narrative(),
            "volatility": self.volatility_label(),
            "expression": self.expression(),
            "voice": self.voice_scale(),
            "baselines": self._baselines(),
        }
