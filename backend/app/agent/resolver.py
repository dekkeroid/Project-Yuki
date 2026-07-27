"""
Zero-latency command resolver for Yuki AI Assistant.

Matches common user messages directly to tool calls without invoking the LLM.
Handles ~30-40% of typical Jarvis-style PC control commands for near-instant responses.

Rules for what belongs here:
  - Unambiguous commands with no room for misinterpretation.
  - Requires NO confirmation (safe, read-only, or trivially reversible actions).
  - Tool result is human-readable and can be used directly as a response.
  - Does NOT require reasoning, file search, app lookup, or context.

Returns: (tool_name, tool_args) if resolved, else None.
"""
import re
from typing import Optional, Tuple, Dict, Any

ResolvedCommand = Tuple[str, Dict[str, Any]]


def resolve_command(message: str) -> Optional[ResolvedCommand]:
    """
    Attempts to resolve a user message directly to a (tool_name, tool_args) pair
    without invoking the LLM. Falls back to None for anything requiring reasoning.
    """
    msg = message.strip().lower()

    # ── Volume set (numeric) ──────────────────────────────────────────────────
    # "volume 50", "set volume to 70", "volume to 80%", "put volume at 60", "vol 50", "sound 50"
    if re.search(r"\b(volume|vol|sound|audio)\b", msg):
        if not re.search(r"\b(up|down|increase|decrease|raise|lower|louder|quieter|softer|higher|max|min|full|half)\b", msg):
            m = re.search(r"(\d{1,3})\s*%?", msg)
            if m:
                level = int(m.group(1))
                if 0 <= level <= 100:
                    return ("set_system_volume", {"volume_level": level})

    # ── Volume up ─────────────────────────────────────────────────────────────
    if re.search(r"\b((volume|vol|sound|audio) up|turn (the )?(volume|vol|sound|audio) up|louder|raise (the )?(volume|vol|sound|audio)|increase (the )?(volume|vol|sound|audio)|make (it )?louder)\b", msg):
        return ("media_playback_control", {"action": "volume_up"})

    # ── Volume down ───────────────────────────────────────────────────────────
    if re.search(r"\b((volume|vol|sound|audio) down|turn (the )?(volume|vol|sound|audio) down|quieter|softer|lower (the )?(volume|vol|sound|audio)|decrease (the )?(volume|vol|sound|audio)|make (it )?(quieter|softer))\b", msg):
        return ("media_playback_control", {"action": "volume_down"})

    # ── Mute / Unmute ─────────────────────────────────────────────────────────
    # Anchored to avoid false positives like "how do I mute myself on Teams"
    if re.search(r"^(mute|unmute|toggle mute|silence|silence (it|the (sound|audio|volume|vol))|unmute (it|audio|volume|vol|sound)|mute (the )?(sound|audio|volume|vol))$", msg):
        return ("media_playback_control", {"action": "mute"})

    # ── Media: play / pause ───────────────────────────────────────────────────
    # Anchored so "play Bohemian Rhapsody" (needs LLM+file-search) is NOT caught
    if re.search(r"^(pause|unpause|resume|play pause|toggle (playback|music|media|play))$", msg):
        return ("media_playback_control", {"action": "play_pause"})

    # ── Media: next track ─────────────────────────────────────────────────────
    if re.search(r"^(next|next (song|track|one)|skip|skip (this|song|track)|skip (to )?next)$", msg):
        return ("media_playback_control", {"action": "next"})

    # ── Media: previous track ─────────────────────────────────────────────────
    if re.search(r"^(prev|previous|previous (song|track|one)|go back|last (song|track)|back( one)?|rewind)$", msg):
        return ("media_playback_control", {"action": "previous"})

    # ── Screenshot ───────────────────────────────────────────────────────────
    if re.search(r"\b(take (a )?screenshot|screenshot|screen capture|capture (my |the )?(screen|display))\b", msg):
        return ("take_screenshot", {})

    # ── System stats ─────────────────────────────────────────────────────────
    if re.search(
        r"\b(system (stats|status|info|information|performance)|pc (stats|status|info)|"
        r"computer (stats|status)|cpu (usage|percent|load|info)|ram (usage|percent|info)|"
        r"memory (usage|percent|info)|how much (ram|cpu|memory|disk) (do i have|am i using|is (used|free|available))?|"
        r"disk (usage|space|info)|check (my )?(cpu|ram|memory|system|pc)|"
        r"show (me )?(my )?(cpu|ram|stats|system))\b",
        msg,
    ):
        return ("get_system_stats", {})

    # ── Date / Time ───────────────────────────────────────────────────────────
    if re.search(
        r"\b(what('?s| is) (the )?(time|date|day( is it)?)|current (time|date|day)|"
        r"today('?s)? (date|day)|tell me the (time|date)|what time is it|"
        r"what('?s| is) today|what day (is it|is today))\b",
        msg,
    ):
        return ("get_current_datetime", {})

    # ── Stopwatch / Timer ─────────────────────────────────────────────────────
    if re.search(r"\b(start|begin|create)\s+(a\s+)?stopwatch\b", msg):
        label = re.sub(r".*\bstopwatch\s*(for|on|about)?\s*", "", msg).strip() or "default"
        return ("manage_time", {"action": "start_stopwatch", "label": label})

    # ── Open / Launch / Run ───────────────────────────────────────────────────
    # Matches "open notepad", "launch calculator", "run chrome", etc.
    m = re.search(r"^(open|launch|run)\s+(.+)$", msg)
    if m:
        target = m.group(2).strip()
        # Avoid intercepting time tools, terminal/script commands that require specific tools
        if not re.search(r"\b(timer|stopwatch|reminder|alarm|terminal|cmd|powershell|python|script|command|command line|shell)\b", target):
            return ("open_or_play_file", {"file_path_or_query": target})

    return None
