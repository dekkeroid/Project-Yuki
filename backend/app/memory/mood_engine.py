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
    "anger":        {"baseline": 10, "volatility": 6, "decay": 0.24},
}

# In LLM mood mode, which axes stay script-driven (physical drives the LLM
# cannot judge reliably). The LLM tag handles every emotional axis —
# including horniness — plus hunger on top of the script's circadian push.
LLM_MODE_SCRIPT_AXES = {"hunger"}

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
    ("food_eat", [
        "eat", "ate", "eating", "dinner", "lunch", "breakfast", "snack",
        "snacked", "ordered", "cooked", "meal", "fed", "full", "ordering food",
    ], {"hunger": -22, "energy": 8, "happiness": 4}),
    ("food_crave", [
        "hungry", "starving", "crave", "craving", "tasty", "yummy",
        "delicious", "sounds good", "sounds amazing", "want a snack",
        "food craving", "in the mood for",
    ], {"hunger": 12, "playfulness": 1}),
    ("praise", [
        "thank you", "you're the best", "you are the best", "cute", "adorable",
        "amazing", "wonderful", "great job", "well done", "perfect", "beautiful",
        "pretty", "sweet", "kind", "appreciate", "impressive", "you rock",
        "awesome", "genius", "smart", "love you", "i love you",
    ], {"happiness": 6, "affection": 5, "stress_level": -3}),
    ("insult", [
        "stupid", "idiot", "dumb", "shut up", "annoying", "lazy", "pathetic",
        "useless", "trash", "ugly", "hate you", "i hate you",
        "dummy", "moron", "failure", "worst", "are you serious", "really now",
    ], {"happiness": -8, "stress_level": 8, "affection": -4, "playfulness": -2, "anger": 6}),
    ("anger", [
        "angry", "furious", "pissed", "pissed off", "annoyed", "this sucks",
        "fix it now", "what the hell", "damn it", "dammit", "enough", "stop it",
        "that's wrong", "wrong again", "not working",
    ], {"anger": 10, "stress_level": 6, "happiness": -4, "energy": -2}),
    ("annoy", [
        "so annoying", "you're annoying", "you are annoying", "stfu", "shut it",
        "whatever dude", "rolls eyes", "eye roll", "meh", "tch",
        "are you even listening", "not this again", "you again",
    ], {"anger": 8, "stress_level": 4, "happiness": -3}),
    ("boring", [
        "boring", "bored", "tedious", "monotonous", "dull", "mind-numbing",
        "paperwork", "taxes", "bills", "laundry", "spreadsheet", "accounting",
        "documentation", "admin work", "forms", "fine print", "manual", "legal jargon",
    ], {"curiosity": -6, "playfulness": -5, "happiness": -3, "energy": -2}),
    ("sad", [
        "sad", "depressed", "lonely", "upset", "crying", "feel down",
        "tired of everything", "miserable", "heartbroken", "homesick", "grief",
    ], {"happiness": -5, "curiosity": -4, "doomer": 5, "stress_level": 2, "affection": 4}),
    ("dismissal", [
        "whatever", "idk", "i don't care", "dont care", "meh", "fine.",
        "not interested", "don't wanna talk", "stop talking", "leave me alone",
        "go away", "i'm done talking",
    ], {"happiness": -4, "affection": -3, "curiosity": -3}),
    ("good_news", [
        "guess what", "good news", "great news", "i got the job", "i got in",
        "i passed", "i won", "guess what happened", "i did it", "promoted",
        "surprise!", "big news",
    ], {"happiness": 6, "curiosity": 5, "energy": 3, "playfulness": 3}),
    ("deep_talk", [
        "meaning of life", "philosophy", "the universe", "consciousness",
        "existence", "what if humans", "why do we", "nature of reality",
        "afterlife", "fate", "free will",
    ], {"curiosity": 8, "doomer": 3}),
    ("unwell", [
        "sick", "fever", "headache", "migraine", "not feeling well", "feel terrible",
        "feel awful", "throwing up", "stomach ache", "sore throat",
    ], {"affection": 6, "stress_level": 3, "happiness": -3, "doomer": 2}),
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
    ], {"stress_level": 5, "happiness": -3, "doomer": 2, "anger": 4}),
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

# ────────────────────────────────────────────────────────────────── #
#  Self-reactions (her own speech)                                    #
#  Talking isn't passive: laughing lifts her, venting drains her,     #
#  being sweet warms her. These fire on Yuki's OWN generated words.   #
# ────────────────────────────────────────────────────────────────── #
SELF_REACTIONS = [
    ("self_playful", [
        "haha", "hehe", "lol", "lmao", "rofl", "giggle", "chuckle", "funny",
        "silly", "tease", "teasing", "joking", "joke", "prank", "just kidding", "jk",
    ], {"playfulness": 6, "happiness": 3, "energy": 1}),
    ("self_intimate", [
        "love you", "miss you", "kiss", "kissing", "cuddle", "hug", "hug you",
        "hold you", "want you", "need you", "snuggle", "come here", "muah", "xoxo",
        "sweetheart", "darling",
    ], {"affection": 7, "horniness": 6, "happiness": 3}),
    ("self_energetic", [
        "exciting", "excited", "so excited", "can't wait", "cant wait", "awesome",
        "amazing", "incredible", "woohoo", "yay", "finally", "perfect", "let's go",
        "lets go", "yesss", "hell yeah",
    ], {"energy": 6, "happiness": 4, "curiosity": 2}),
    ("self_food", [
        "hungry", "snack", "snacks", "eat", "food", "pizza", "ramen", "coffee",
        "cookie", "cookies", "dinner", "lunch", "breakfast", "taco", "noodles", "dessert",
    ], {"hunger": 8, "happiness": 2}),
    ("self_tired", [
        "tired", "exhausted", "sleepy", "drowsy", "yawning", "yawn", "long day",
        "drained", "worn out", "so sleepy",
    ], {"energy": -7, "stress_level": 2}),
    ("self_stressed", [
        "ugh", "sigh", "frustrated", "annoyed", "so annoyed", "this is hard",
        "overwhelmed", "stressed", "stressing", "i'm sorry", "sorry", "apologize",
        "what a mess", "i can't", "screw this", "so done with",
    ], {"stress_level": 6, "happiness": -3, "energy": -3, "anger": 4}),
    ("self_angry", [
        "angry", "pissed", "pissed off", "furious", "mad", "irritating",
        "damn", "what the hell", "i can't believe", "so done with", "enough",
        "you keep doing this", "this is ridiculous",
    ], {"anger": 10, "stress_level": 5, "happiness": -5, "energy": -2}),
    ("self_bored", [
        "boring", "bored", "tedious", "dull", "monotonous", "mind-numbing",
        "this is a drag", "what a snooze",
    ], {"curiosity": -6, "playfulness": -5, "happiness": -3, "energy": -3}),
    ("self_soothing", [
        "it's okay", "its okay", "don't worry", "everything will be fine", "it'll be fine",
        "i've got you", "i got you", "you're safe", "take your time", "no worries", "it's fine",
    ], {"stress_level": -5, "affection": 4, "happiness": 2}),
    ("self_accomplished", [
        "done", "finished", "completed", "success", "successfully", "worked", "fixed",
        "solved", "figured it out", "got it working", "there you go", "all set", "it's ready",
    ], {"happiness": 5, "stress_level": -4, "curiosity": 2}),
    ("self_curious", [
        "wonder", "interesting", "curious", "what if", "how does", "how does that",
        "tell me more", "let me think", "let me check", "i'll look", "i'll check", "good question",
    ], {"curiosity": 6, "energy": 1}),
    ("self_down", [
        "sad", "upset", "lonely", "down", "miserable", "heartbroken", "cry", "crying",
        "depressed", "numb", "empty",
    ], {"happiness": -6, "affection": 4, "doomer": 3}),
]

_SELF_REACTION_PATTERNS = [
    (name, [re.compile(r"(?<!\w)" + re.escape(kw) + r"(?!\w)", re.IGNORECASE) for kw in kws], deltas)
    for name, kws, deltas in SELF_REACTIONS
]

# ────────────────────────────────────────────────────────────────── #
#  Repetition escalation ("emotional momentum")                       #
#  Repeated triggers compound — the 5th provocation bites harder      #
#  than the 1st, just like patience wearing thin — then cools off     #
#  with time. Applies to user AND self reactions, positive and        #
#  negative alike.                                                    #
# ────────────────────────────────────────────────────────────────── #
ESCALATION_MAX_BOOST = 2.8        # ceiling multiplier (~6-7 repeats)
ESCALATION_STEP = 0.35            # extra multiplier per repeat
ESCALATION_HALFLIFE_HOURS = 2.0   # how fast her patience recovers
ESCALATION_PRUNE_WEIGHT = 0.5     # forget a category below this weight
ESCALATION_MAX_AGE_HOURS = 24.0   # hard forget after a day

# Hard cap on a single axis swing per turn after escalation (matches
# the LLM <mood_update> tag's ±40 range so both modes feel symmetric).
MAX_ESCALATED_DELTA = 40

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
        self._reaction_memory = {}
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
        for name, patterns, deltas in _REACTION_PATTERNS:
            if any(p.search(text) for p in patterns):
                boost = self._bump_reaction(name)
                for axis, delta in deltas.items():
                    updates[axis] = updates.get(axis, 0) + int(round(delta * boost))
        for axis in list(updates):
            updates[axis] = max(-MAX_ESCALATED_DELTA, min(MAX_ESCALATED_DELTA, int(updates[axis])))
        if scope == "physical":
            updates = {k: v for k, v in updates.items() if k in LLM_MODE_SCRIPT_AXES}
        elif scope == "emotion":
            updates = {k: v for k, v in updates.items() if k not in LLM_MODE_SCRIPT_AXES}
        if updates:
            self.apply_deltas(updates)
        return updates

    def react_to_self(self, text: str, scope: str = "full") -> dict:
        """Script/regex self-reactions — her OWN spoken words feed back into her mood.

        Speaking is a mirror, not just an output: laughing lifts her, venting
        drains her, being sweet warms her, saying she's done calms her. scope:
        full | physical | emotion (same semantics as react_to_message).
        """
        if not text:
            return {}
        updates = {}
        for name, patterns, deltas in _SELF_REACTION_PATTERNS:
            if any(p.search(text) for p in patterns):
                boost = self._bump_reaction(name)
                for axis, delta in deltas.items():
                    updates[axis] = updates.get(axis, 0) + int(round(delta * boost))
        for axis in list(updates):
            updates[axis] = max(-MAX_ESCALATED_DELTA, min(MAX_ESCALATED_DELTA, int(updates[axis])))
        if scope == "physical":
            updates = {k: v for k, v in updates.items() if k in LLM_MODE_SCRIPT_AXES}
        elif scope == "emotion":
            updates = {k: v for k, v in updates.items() if k not in LLM_MODE_SCRIPT_AXES}
        if updates:
            self.apply_deltas(updates)
        return updates

    def apply_turn_effects(self) -> dict:
        """mood_effecter — per-turn coupling of her own state.

        Runs once at the end of every turn, after LLM deltas and self-reactions.
        No reversion pull: only real elapsed time (step(), run at turn start)
        drifts her back toward baseline, so moods persist during an active session.
        """
        m = self.current()
        deltas = {"energy": -1}
        if m["doomer"] >= 70:
            deltas["happiness"] = deltas.get("happiness", 0) - 3
            deltas["energy"] = deltas.get("energy", 0) - 3
        elif m["doomer"] >= 55:
            deltas["happiness"] = deltas.get("happiness", 0) - 1
        if m["affection"] >= 60 or m["horniness"] >= 75:
            deltas["happiness"] = deltas.get("happiness", 0) + 4
            deltas["energy"] = deltas.get("energy", 0) + 2
        if m["stress_level"] >= 65:
            deltas["happiness"] = deltas.get("happiness", 0) - 2
        if m["anger"] >= 70:
            deltas["happiness"] = deltas.get("happiness", 0) - 2
            deltas["stress_level"] = deltas.get("stress_level", 0) + 2
        if m["hunger"] >= 75:
            deltas["happiness"] = deltas.get("happiness", 0) - 1
            deltas["energy"] = deltas.get("energy", 0) - 2
        if m["playfulness"] >= 65:
            deltas["energy"] = deltas.get("energy", 0) + 1
        if m["happiness"] >= 80:
            deltas["energy"] = deltas.get("energy", 0) + 1
        if m["happiness"] <= 25:
            deltas["energy"] = deltas.get("energy", 0) - 1
            deltas["doomer"] = deltas.get("doomer", 0) + 1
        if m["energy"] <= 30:
            deltas["happiness"] = deltas.get("happiness", 0) - 1
            deltas["curiosity"] = deltas.get("curiosity", 0) - 1
        if m["curiosity"] >= 70:
            deltas["energy"] = deltas.get("energy", 0) + 1
        if deltas:
            self.apply_deltas(deltas)
        return deltas

    def _bump_reaction(self, name: str) -> float:
        """Record a firing of a reaction category and return its boost multiplier."""
        now = time.time()
        mem = self._reaction_memory.get(name)
        if mem is None:
            mem = {"count": 0, "last": now}
        mem["count"] += 1
        mem["last"] = now
        self._reaction_memory[name] = mem
        self._prune_reaction_memory(now)
        return self._reaction_boost(name)

    def _reaction_boost(self, name: str) -> float:
        """Emotional momentum multiplier for a category, fading with time."""
        mem = self._reaction_memory.get(name)
        if not mem:
            return 1.0
        hours_since = max(0.0, (time.time() - mem["last"]) / 3600.0)
        decayed = mem["count"] * (0.5 ** (hours_since / ESCALATION_HALFLIFE_HOURS))
        return 1.0 + min(ESCALATION_MAX_BOOST - 1.0, max(0.0, decayed - 1.0) * ESCALATION_STEP)

    def _prune_reaction_memory(self, now: float):
        stale = []
        for name, mem in self._reaction_memory.items():
            hours_since = max(0.0, (now - mem["last"]) / 3600.0)
            decayed = mem["count"] * (0.5 ** (hours_since / ESCALATION_HALFLIFE_HOURS))
            if decayed < ESCALATION_PRUNE_WEIGHT or hours_since > ESCALATION_MAX_AGE_HOURS:
                stale.append(name)
        for name in stale:
            self._reaction_memory.pop(name, None)

    def apply_llm_deltas(self, deltas: dict) -> bool:
        """Apply parsed LLM <mood_update> deltas (all axes, incl. horniness/anger)."""
        clean = {k: v for k, v in deltas.items() if k in AXES}
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
            "stress_level": 10, "doomer": 10, "hunger": 12, "playfulness": 12,
            "horniness": 10, "anger": 8,
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
        v = trend("anger", "You're feeling unusually irritated and short-fused right now.",
                  "You're uncharacteristically patient and even-tempered.")
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
        if m["anger"] >= 60:
            parts.append("You're genuinely angry right now — on the verge of losing your temper.")
        elif m["anger"] >= 35:
            parts.append("You're noticeably irritated and would rather not be provoked further.")

        if not parts:
            parts.append("You feel about like you normally do.")
        return " ".join(parts)

    def volatility_label(self) -> str:
        avg = sum(cfg["volatility"] for cfg in AXES.values()) / len(AXES)
        return "high" if avg >= 6.0 else ("medium" if avg >= 5.0 else "low")

    def expression(self) -> str:
        """Dominant avatar expression when the LLM emits no explicit tag."""
        m = self.current()
        if m["anger"] >= 70:
            return "angry"
        if m["energy"] <= 30:
            return "relaxed"
        if m["happiness"] <= 25 or m["stress_level"] >= 70:
            return "sad"
        if m["stress_level"] >= 60:
            return "surprised"
        if m["playfulness"] >= 70:
            return "smug"
        # High happiness → use relaxed (content/serene look), not happy emote
        # (the "happy" blend has mouth-open/droopy-eyes which reads as goofy, not happy)
        if m["happiness"] >= 70 and m["energy"] >= 55:
            return "relaxed"
        return "relaxed"

    def voice_scale(self) -> dict:
        """Discrete TTS rate/energy modifiers derived from current mood.

        A fixed ladder instead of a continuous formula so delivery changes are
        audible. Negative states are checked first, so they always win when
        multiple thresholds match (e.g. high energy + high doom = slow).
        """
        m = self.current()
        if m["energy"] < 30:
            rate = 0.8
        elif m["doomer"] > 80:
            rate = 0.8
        elif m["doomer"] > 55:
            rate = 0.9
        elif m["energy"] < 35 or m["curiosity"] < 35:
            rate = 0.9
        elif m["energy"] > 90:
            rate = 1.2
        elif m["energy"] > 70:
            rate = 1.1
        elif m["curiosity"] > 70:
            rate = 1.1
        else:
            rate = 1.0
        return {"rate": rate, "energy": round(m["energy"] / 100.0, 2), "valence": round(m["happiness"] / 100.0, 2)}

    def meta(self) -> dict:
        return {
            "narrative": self.narrative(),
            "volatility": self.volatility_label(),
            "expression": self.expression(),
            "voice": self.voice_scale(),
            "baselines": self._baselines(),
        }
