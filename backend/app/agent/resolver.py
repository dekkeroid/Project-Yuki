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

    # ── Volume get / query ───────────────────────────────────────────────────
    # "can u get current system audio volume", "what is the volume", "check volume", "current volume"
    if re.search(r"\b(what('?s| is)? (?:the )?(?:current )?(?:speaker|system|pc|audio|\s)*(?:volume|vol|sound)|(?:get|check|tell me|show me) (?:the )?(?:current )?(?:speaker|system|pc|audio|\s)*(?:volume|vol|sound)|current (?:speaker|system|pc|audio|\s)*(?:volume|vol|sound)|how loud is (?:it|the (?:pc|audio|sound|volume)))\b", msg) or re.search(r"^(volume|vol|sound|audio)\??$", msg):
        return ("set_system_volume", {"action": "get"})

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

    # ── See the screen (vision capture + analysis) ───────────────────────────
    if re.search(
        r"\b(look at|see|show me|show (yourself )?|read (off )?|what('?s| is) on|what (is |'s )?on|"
        r"check (the )?|describe|look (on|at)|watch|examine|inspect|view|read the (screen|display|window)|"
        r"tell me what('?s| is) on)\b.*\b(screen|display|desktop|monitor|window|tab|page|dialog|popup|message|notification|taskbar|browser)\b",
        msg
    ):
        return ("jarvis_see_screen", {"prompt": msg})

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
        return ("manage_timer_stopwatch_alarms", {"action": "start_stopwatch", "label": label})

    # ── Avatar Outfit / Costume / Hat / Model change ────────────────────────
    # "can u change model to kind", "put on your hat", "wear your hat", "change outfit to school", "wear mixup with hat", "take off your hat"
    _prefix = r"(?:(?:can|could)\s*(?:you|u)\s*)?(?:please\s+)?(?:hey\s+yuki\s*,\s*)?"
    m_outfit = re.search(r"^" + _prefix + r"(?:put on|wear|equip)\s+(?:your\s+)?(.+?)(?:\s+outfit|\s+costume|\s+model)?$", msg)
    if m_outfit:
        target_outfit = m_outfit.group(1).strip()
        if not re.search(r"\b(headphone|earphone|headset)\b", target_outfit):
            return ("change_avatar_outfit", {"model_or_outfit": target_outfit, "outfit": target_outfit})

    m_change = re.search(r"^" + _prefix + r"(?:change|switch)(?:\s+your)?\s+(?:(?:avatar|model|outfit|clothes|costume|character)\s+)?(?:to|into)\s+(.+)$", msg)
    if m_change:
        target_val = m_change.group(1).strip()
        return ("change_avatar_outfit", {"model_or_outfit": target_val, "outfit": target_val})

    m_remove = re.search(r"^" + _prefix + r"(?:take off|remove)\s+(?:your\s+)?(.+?)$", msg)
    if m_remove:
        rem_target = m_remove.group(1).strip()
        if not re.search(r"\b(headphone|earphone|headset)\b", rem_target):
            return ("change_avatar_outfit", {"model_or_outfit": "default", "outfit": "default"})

    # ── Open / Launch / Run ───────────────────────────────────────────────────
    # Matches "open notepad", "launch calculator", "run chrome", etc.
    m = re.search(r"^(open|launch|run)\s+(.+)$", msg)
    if m:
        target = m.group(2).strip()
        # Avoid intercepting time tools, terminal/script commands that require specific tools
        if not re.search(r"\b(timer|stopwatch|reminder|alarm|terminal|cmd|powershell|python|script|command|command line|shell)\b", target):
            return ("open_or_play_file", {"file_path_or_query": target})

    return None
