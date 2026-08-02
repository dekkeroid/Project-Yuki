"""
AskUserInput tool — presents structured clarifying questions to the user and
**blocks** until the user responds with a schema-validated selection.

Architecture
-------------
* A module-level registry ``_pending_asks`` maps ``ask_id`` → ``asyncio.Future``.
* ``ask_user(questions)`` is an ``async def`` so ``executor.py`` awaits it
  directly (``iscoroutinefunction`` is True → ``await tool_func(...)``, see
  ``executor.py:456-457``).
* ``set_ask_callback(fn)`` wires a broadcast function (set in ``main.py`` startup,
  mirroring ``time_manager.set_due_callback``).  The callback pushes the
  question payload to the frontend via WebSocket so the dialog can render.
* ``resolve_ask(ask_id, answers)`` is called by the
  ``POST /api/ask_user/{ask_id}/answer`` endpoint when the user submits the
  dialog, completing the Future and unblocking the agent.

Clarification ≠ authorization — this module is deliberately separate from
``safety.py`` (different secrets: tradeoff decisions vs. destructive-action
gates).
"""

import asyncio
import json
import uuid
from typing import Any, Callable, Dict, List, Optional

# ask_id → Future that resolves to the user's answers dict
_pending_asks: Dict[str, asyncio.Future] = {}

# Broadcast function set by main.py at startup; pushes {type, ask_id, questions}
# to every connected WebSocket client.
_ask_callback: Optional[Callable[[str, List[Dict[str, Any]]], Any]] = None

# Default timeout in seconds (5 minutes).  The model receives a fallback
# string on timeout so it can proceed with the recommended option.
_DEFAULT_TIMEOUT = 300


def set_ask_callback(fn: Callable[[str, List[Dict[str, Any]]], Any]) -> None:
    """Wire the broadcast function called when a new ask is issued.

    Called once at startup (see ``main.py`` lifespan, alongside
    ``time_manager.set_due_callback``).
    """
    global _ask_callback
    _ask_callback = fn


def resolve_ask(ask_id: str, answers: Dict[str, Any]) -> bool:
    """Complete a pending ask with the user's answers.

    Returns ``True`` if the ask was found and resolved, ``False`` otherwise
    (already answered, timed out, or unknown id).
    """
    fut = _pending_asks.pop(ask_id, None)
    if fut and not fut.done():
        fut.set_result(answers)
        return True
    return False


def _validate_questions(questions: Any) -> Optional[str]:
    """Return an error string if *questions* is malformed, else ``None``."""
    if not questions or not isinstance(questions, list):
        return "Error: 'questions' must be a non-empty array."

    for q in questions:
        if not isinstance(q, dict):
            return "Error: each question must be an object."
        if not isinstance(q.get("id"), str) or not q.get("id"):
            return "Error: each question must have a non-empty string 'id'."
        if not isinstance(q.get("question"), str) or not q.get("question"):
            return "Error: each question must have a non-empty string 'question'."
        options = q.get("options")
        if not isinstance(options, list) or len(options) < 2:
            return "Error: each question must have at least 2 options."
        if len(options) > 5:
            return "Error: each question may have at most 5 options."
        for opt in options:
            if not isinstance(opt, dict) or not isinstance(opt.get("label"), str) or not opt.get("label"):
                return "Error: each option must have a non-empty string 'label'."

    return None


async def ask_user(questions: List[Dict[str, Any]]) -> str:
    """Present clarifying questions with options; block until the user answers.

    Returns a JSON string of ``{<question_id>: <selected label or [labels]>}``
    so the model receives the selection as the tool result.  On timeout returns
    a fallback string so the model can proceed with the ``recommended`` option.
    """
    err = _validate_questions(questions)
    if err:
        return err

    ask_id = uuid.uuid4().hex[:12]
    loop = asyncio.get_event_loop()
    fut = loop.create_future()
    _pending_asks[ask_id] = fut

    if _ask_callback:
        try:
            result = _ask_callback(ask_id, questions)
            # The callback may be async (broadcast_ws is a coroutine) or sync.
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            # Broadcast failure shouldn't block the ask — the user can still
            # answer via the REST endpoint if the frontend is connected.
            print(f"[ask_user] callback broadcast failed: {e}")

    try:
        answers = await asyncio.wait_for(fut, timeout=_DEFAULT_TIMEOUT)
    except asyncio.TimeoutError:
        _pending_asks.pop(ask_id, None)
        recommended = {}
        for q in questions:
            opts = q.get("options", [])
            rec = q.get("recommended")
            if isinstance(rec, int) and 0 <= rec < len(opts):
                recommended[q["id"]] = opts[rec].get("label", "")
        return (
            "The user did not respond within the timeout. "
            f"Falling back to recommended options: {json.dumps(recommended)}"
        )
    except Exception as e:
        _pending_asks.pop(ask_id, None)
        return f"Error: ask_user failed: {e}"

    return json.dumps(answers)
