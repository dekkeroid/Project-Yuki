"""Server-side safety policy for Yuki tool execution.

The model is allowed to ask for tools, but it is not trusted to authorize risky
side effects. Risky calls require a short-lived backend-issued confirmation
grant bound to the tool name and canonicalized arguments. The grant store is
file-backed so the FastAPI process and the stdio MCP subprocess enforce the same
one-time authorization boundary.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

from app import config

DEFAULT_CONFIRMATION_SCOPE = "yuki-backend"
INTERNAL_AUTH_FIELDS = {
    "confirmed",
    "confirm",
    "_host_confirmed",
    "confirmation_grant_id",
    "_host_confirmation_grant_id",
    "pending_confirmation_id",
}
MEDIA_EXTENSIONS = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".mp3", ".wav", ".flac", ".ogg"}
RISKY_OPEN_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".ps1", ".msi", ".com", ".scr", ".vbs", ".js", ".jar", ".lnk",
    ".app", ".workflow", ".command", ".sh",
}

DEFAULT_BLOCKED_TERMINAL_PATTERNS = [
    r"\bshutdown(?:\.exe)?\s+/(?:s|r|p|h|l)\b",
    r"\bshutdown(?:\.exe)?\s+-(?:s|r|h)\b",
    r"\bshutdown\s+(?:-h|-r|now)\b",
    r"\b(?:restart-computer|stop-computer)\b",
    r"\b(?:poweroff|reboot|halt)\b",
    r"\brm\s+-[a-z]*(?=[a-z]*r)(?=[a-z]*f)[a-z]*\s+(?:/|~|[a-z]:\\)",
    r"\b(?:rmdir|rd)\b(?=.*\s/[a-z]*s[a-z]*\b)(?=.*\s/[a-z]*q[a-z]*\b).*(?:[a-z]:\\|/|~)",
    r"\bmkfs(?:\.[a-z0-9]+)?\b",
    r"\bdiskpart\b",
    r"\bformat\s+[a-z]:",
    r"\bdel\s+/[a-z]*s[a-z]*\b",
    r"\bremove-item\b(?=.*(?:^|\s)-force\b)(?=.*(?:^|\s)-recurse\b)",
    r"\breg\s+delete\b",
    r"\bbcdedit\b",
]

_PROCESS_LOCK = threading.Lock()


@dataclass(frozen=True)
class ToolSafetyDecision:
    allowed: bool
    requires_confirmation: bool = False
    blocked: bool = False
    message: str = ""
    target: str = ""
    arguments: dict[str, Any] | None = None


def issue_confirmation_grant(
    tool_name: str,
    arguments: dict[str, Any] | None,
    *,
    target: str | None = None,
    scope: str = DEFAULT_CONFIRMATION_SCOPE,
    ttl_seconds: int | None = None,
) -> str:
    """Create a one-time executable grant after user approval."""
    return _issue_record(
        "grant",
        tool_name,
        arguments,
        target=target,
        scope=scope,
        ttl_seconds=ttl_seconds,
    )


def issue_pending_confirmation(
    tool_name: str,
    arguments: dict[str, Any] | None,
    *,
    target: str | None = None,
    scope: str = DEFAULT_CONFIRMATION_SCOPE,
    ttl_seconds: int | None = None,
) -> str:
    """Create a non-executable pending confirmation token for UI dialogs.

    A pending token cannot authorize a tool call. It must first be approved by
    the backend, which consumes it and returns a short-lived executable grant.
    """
    return _issue_record(
        "pending",
        tool_name,
        arguments,
        target=target,
        scope=scope,
        ttl_seconds=ttl_seconds,
    )


def approve_pending_confirmation(
    pending_id: str,
    tool_name: str,
    arguments: dict[str, Any] | None,
    *,
    scope: str = DEFAULT_CONFIRMATION_SCOPE,
    ttl_seconds: int | None = None,
) -> tuple[bool, str]:
    """Consume a pending token and mint the executable grant after approval."""
    tool = _resolve_alias(_normalize_tool_name(tool_name))
    canonical_args = canonicalize_tool_args(tool, arguments or {})
    now = time.time()

    def mutate(records: dict[str, Any]) -> tuple[bool, str]:
        record = records.get(pending_id)
        if not record:
            return False, "pending confirmation was not found"
        if record.get("record_type") != "pending":
            return False, "token is not a pending confirmation"
        ok, reason = _record_matches(record, tool, canonical_args, scope, now)
        if not ok:
            return False, reason
        records.pop(pending_id, None)
        grant_id = secrets.token_urlsafe(32)
        records[grant_id] = _make_record(
            "grant",
            tool,
            canonical_args,
            target=record.get("target") or describe_tool_target(tool, canonical_args),
            scope=scope,
            ttl_seconds=ttl_seconds,
            now=now,
        )
        return True, grant_id

    return _mutate_records(mutate)


def authorize_tool_call(
    tool_name: str,
    arguments: dict[str, Any] | None,
    *,
    consume_grant: bool = True,
    scope: str = DEFAULT_CONFIRMATION_SCOPE,
    mode: str = "assistant",
    workspace_root: str | None = None,
) -> ToolSafetyDecision:
    """Validate policy and return sanitized arguments for actual execution.

    `consume_grant=False` is used before dispatching to the stdio MCP server so
    the child server remains the final execution boundary and consumes the grant.
    Local fallback calls this again with `consume_grant=True`.

    `mode="coder"` applies the Coder Mode policy: sensitive tools run freely
    (no confirmation prompts) but are gated by a hard blacklist and a workspace
    path sandbox instead. `mode="advanced"` is the same blacklist-only policy
    without the workspace path sandbox (autonomous jarvis mode). `mode="assistant"`
    (default) keeps the confirmation-driven authorization flow.
    """
    raw_args = dict(arguments or {})
    tool = _normalize_tool_name(tool_name)
    decision_tool = _resolve_alias(tool)
    canonical_args = canonicalize_tool_args(tool, raw_args)

    if not config.TOOL_SANDBOX_ENABLED:
        return ToolSafetyDecision(True, arguments=canonical_args)

    blocked_tools = _configured_set(config.TOOL_SANDBOX_BLOCKED_TOOLS)
    if tool in blocked_tools or decision_tool in blocked_tools:
        return _blocked(f"Error: Tool '{tool}' is blocked by the Yuki tool sandbox.", canonical_args)

    blocked_reason = _blocked_reason(decision_tool, canonical_args)
    if blocked_reason:
        return _blocked(f"Error: Blocked by Yuki's command safety sandbox: {blocked_reason}", canonical_args)

    if mode in ("coder", "advanced"):
        return _authorize_autonomous(tool, decision_tool, canonical_args, workspace_root=workspace_root, apply_file_guard=(mode == "coder"))

    if not _requires_confirmation(decision_tool, raw_args, canonical_args):
        return ToolSafetyDecision(True, arguments=_execution_arguments(decision_tool, canonical_args, authorized=False))

    grant_id = _extract_grant_id(raw_args)
    if grant_id:
        # Hash against the decision-canonicalized args so jarvis_* aliases match
        # grants issued under their canonical tool name.
        decision_args = canonicalize_tool_args(decision_tool, canonical_args)
        ok, reason = _validate_grant(
            grant_id,
            decision_tool,
            decision_args,
            scope=scope or DEFAULT_CONFIRMATION_SCOPE,
            consume=consume_grant,
        )
        if ok:
            return ToolSafetyDecision(True, arguments=_execution_arguments(decision_tool, canonical_args, authorized=True))
        target = describe_tool_target(decision_tool, canonical_args)
        return ToolSafetyDecision(
            False,
            requires_confirmation=True,
            message=f"CONFIRM_REQUIRED: {target} ({reason})",
            target=target,
            arguments=canonical_args,
        )

    target = describe_tool_target(decision_tool, canonical_args)
    return ToolSafetyDecision(
        False,
        requires_confirmation=True,
        message=f"CONFIRM_REQUIRED: {target}",
        target=target,
        arguments=canonical_args,
    )


def strip_internal_auth_fields(arguments: dict[str, Any] | None) -> dict[str, Any]:
    return {k: v for k, v in dict(arguments or {}).items() if k not in INTERNAL_AUTH_FIELDS}


def canonicalize_tool_args(tool_name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize aliases/defaults so grants match MCP wrapper calls exactly."""
    args = strip_internal_auth_fields(arguments or {})
    tool = _normalize_tool_name(tool_name)

    def put_if_present(out: dict[str, Any], key: str, value: Any) -> None:
        if value is not None and value != "":
            out[key] = value

    if tool == "launch_app":
        out = {"app_name": args.get("app_name") or args.get("name") or args.get("app") or _first_value(args)}
        put_if_present(out, "args", args.get("args"))
        if _as_bool(args.get("run_as_admin")):
            out["run_as_admin"] = True
        return out
    if tool == "set_system_volume":
        return {"volume_level": int(args.get("volume_level") or args.get("volume") or args.get("level") or _first_value(args) or 0)}
    if tool == "update_user_fact":
        return {"key": args.get("key") or "", "value": args.get("value") or ""}
    if tool == "list_directory":
        out: dict[str, Any] = {}
        put_if_present(out, "directory_path", args.get("directory_path") or args.get("path") or args.get("directory") or args.get("folder"))
        return out
    if tool == "search_files":
        out = {"query": args.get("query") or args.get("search") or args.get("name") or ""}
        put_if_present(out, "start_directory", args.get("start_directory") or args.get("directory") or args.get("start_dir") or args.get("path") or args.get("folder"))
        return out
    if tool == "open_or_play_file":
        out = {"file_path_or_query": args.get("file_path_or_query") or args.get("query") or args.get("file_path") or args.get("path") or args.get("filepath") or args.get("file") or ""}
        if _as_bool(args.get("play_mode")):
            out["play_mode"] = True
        return out
    if tool == "create_file":
        return {"file_path": args.get("file_path") or args.get("path") or args.get("filepath") or args.get("file") or "", "content": args.get("content") or args.get("text") or ""}
    if tool == "edit_file":
        return {
            "file_path": args.get("file_path") or args.get("path") or args.get("filepath") or args.get("file") or "",
            "search_text": args.get("search_text") or args.get("search") or args.get("find") or "",
            "replace_text": args.get("replace_text") or args.get("replace") or args.get("new_text") or "",
        }
    if tool == "delete_file":
        return {"file_path": args.get("file_path") or args.get("path") or args.get("filepath") or args.get("file") or ""}
    if tool == "control_window":
        out = {"action": args.get("action") or ""}
        put_if_present(out, "window_title", args.get("window_title"))
        if args.get("x") is not None:
            out["x"] = int(args.get("x"))
        if args.get("y") is not None:
            out["y"] = int(args.get("y"))
        return out
    if tool == "run_terminal_command":
        out = {"command": args.get("command") or ""}
        if args.get("use_powershell") is not None and not _as_bool(args.get("use_powershell")):
            out["use_powershell"] = False
        return out
    if tool == "run_python_script":
        return {"code": args.get("code") or ""}
    if tool == "keyboard_mouse_input":
        out = {"action": args.get("action") or ""}
        put_if_present(out, "text", args.get("text"))
        if args.get("keys"):
            out["keys"] = list(args.get("keys"))
        for key in ("x", "y", "amount"):
            if args.get(key) is not None:
                out[key] = int(args.get(key))
        return out
    if tool == "media_playback_control":
        return {"action": args.get("action") or ""}
    if tool == "manage_process":
        out = {"action": args.get("action") or ""}
        put_if_present(out, "name", args.get("name"))
        if args.get("pid") is not None:
            out["pid"] = int(args.get("pid"))
        return out
    if tool == "system_power_control":
        return {"action": args.get("action") or ""}
    if tool == "manage_scheduled_task":
        out = {"action": args.get("action") or ""}
        for key in (
            "action_type", "action_command", "action_tool", "kind", "target", "fire_condition",
            "run_tool", "run_args", "run_builtin", "run_notify", "run_command", "do", "condition", "monitor_type"
        ):
            put_if_present(out, key, args.get(key))
        if args.get("seconds") is not None:
            out["seconds"] = args.get("seconds")
        if args.get("count") is not None:
            out["count"] = int(args.get("count"))
        if args.get("item_id") is not None:
            out["item_id"] = int(args.get("item_id"))
        if args.get("action_args"):
            out["action_args"] = dict(args.get("action_args"))
        if args.get("run_args"):
            out["run_args"] = dict(args.get("run_args"))
        return out
    if tool == "web_search":
        return {"query": args.get("query") or args.get("search") or args.get("text") or _first_value(args)}
    if tool == "jarvis_grep_files":
        out = {"pattern": args.get("pattern") or ""}
        put_if_present(out, "file_pattern", args.get("file_pattern") or args.get("glob"))
        put_if_present(out, "search_dir", args.get("search_dir") or args.get("directory") or args.get("dir"))
        if _as_bool(args.get("case_sensitive")):
            out["case_sensitive"] = True
        if args.get("max_results") is not None:
            out["max_results"] = int(args.get("max_results"))
        return out

    return _drop_empty_generic(args)


def describe_tool_target(tool_name: str, arguments: dict[str, Any] | None) -> str:
    args = canonicalize_tool_args(tool_name, arguments or {})
    tool = _normalize_tool_name(tool_name)
    if tool == "launch_app":
        suffix = " as admin" if _as_bool(args.get("run_as_admin")) else ""
        return f"Launch app: {args.get('app_name') or ''}{suffix}"
    if tool == "open_or_play_file":
        return str(args.get("file_path_or_query") or "open/play target")
    if tool in ("create_file", "edit_file", "delete_file"):
        verb = {"create_file": "Create file", "edit_file": "Edit file", "delete_file": "Delete file"}[tool]
        return f"{verb}: {args.get('file_path') or ''}"
    if tool == "system_power_control":
        return f"System Power Action: {args.get('action') or ''}"
    if tool == "manage_scheduled_task":
        action = args.get("action") or ""
        action_type = args.get("action_type") or "shell"
        target = args.get("target") or args.get("kind") or ""
        action_command = args.get("action_command") or ""
        action_args = args.get("action_args") or {}
        if action in ("list", "cancel"):
            return f"Scheduled task management ({action})"
        if action_type == "power":
            return f"Schedule task that runs power action '{action_args.get('action') or ''}'"
        if action_type == "tool":
            return f"Schedule task that calls tool '{args.get('action_tool') or ''}'"
        return f"Schedule task that runs command: {action_command or target or '(none)'}"
    if tool == "run_terminal_command":
        return f"Run terminal command: {args.get('command') or ''}"
    if tool == "run_python_script":
        return f"Run Python script:\n\n{args.get('code') or ''}"
    if tool == "keyboard_mouse_input":
        return f"Keyboard/mouse input: {args.get('action') or ''}"
    if tool == "manage_process":
        name = args.get("name") or args.get("pid") or ""
        return f"Manage process {args.get('action') or ''}: {name}"
    if tool == "control_window":
        return f"Window {args.get('action') or ''}: {args.get('window_title') or ''}"
    return tool


def confirmation_grant_record(grant_id: str) -> dict[str, Any] | None:
    """Test/debug helper: return a grant record if it exists and is not expired."""
    now = time.time()
    records = _read_records()
    record = records.get(grant_id)
    if not record:
        return None
    if float(record.get("expires_at", 0)) < now:
        _mutate_records(lambda current: current.pop(grant_id, None))
        return None
    return dict(record)


def _requires_confirmation(tool: str, raw_args: dict[str, Any], canonical_args: dict[str, Any]) -> bool:
    configured = _configured_set(config.TOOL_SANDBOX_REQUIRE_CONFIRMATION_TOOLS)
    if tool == "manage_process":
        return (canonical_args.get("action") or "").lower().strip() == "kill" and tool in configured
    if tool == "control_window":
        action = (canonical_args.get("action") or "").lower().strip()
        return action == "close" and tool in configured
    if tool == "open_or_play_file":
        if any(_as_bool(raw_args.get(field)) for field in ("confirmed", "confirm", "_host_confirmed")):
            return True
        return _open_or_play_needs_confirmation(canonical_args)
    if tool == "manage_scheduled_task":
        # Scheduled tasks fire autonomously later, so a task that runs a power
        # action or a destructive shell command is confirmed ONCE at creation.
        return _scheduled_task_needs_confirmation(canonical_args)
    return tool in configured


def _scheduled_task_needs_confirmation(args: dict[str, Any]) -> bool:
    """True when creating a scheduled task whose fired action is dangerous
    (power control or a command matching a destructive terminal pattern)."""
    action = (args.get("action") or "").lower().strip()
    if action in ("list", "cancel", ""):
        return False
    action_type = (args.get("action_type") or "shell").lower().strip()
    if action_type == "power" or str(args.get("run_builtin") or "").lower() in ("shutdown", "restart"):
        return True
    action_args = args.get("action_args") or {}
    if isinstance(action_args, str):
        try:
            action_args = json.loads(action_args)
        except Exception:
            action_args = {}
    if action_type == "tool":
        tool_name = str(args.get("action_tool") or "").lower().strip()
        if tool_name in ("jarvis_system_power", "system_power_control"):
            return True
    command = str(args.get("action_command") or "")
    if command:
        for pattern in _terminal_patterns():
            if re.search(pattern, command, flags=re.IGNORECASE):
                return True
    return False


def _open_or_play_needs_confirmation(args: dict[str, Any]) -> bool:
    target = str(args.get("file_path_or_query") or "").strip().strip('"\'')
    if not target:
        return False
    if target.lower().startswith("shell:"):
        return True
    expanded = os.path.abspath(os.path.expanduser(os.path.expandvars(target)))
    check_path = expanded if os.path.exists(expanded) else target
    if os.path.exists(check_path):
        try:
            from app.tools.files import _needs_confirmation

            return bool(_needs_confirmation(check_path))
        except Exception:
            _, ext = os.path.splitext(check_path.lower())
            return ext not in MEDIA_EXTENSIONS
    _, ext = os.path.splitext(target.lower())
    return ext in RISKY_OPEN_EXTENSIONS


def _blocked_reason(tool: str, args: dict[str, Any]) -> str | None:
    if tool == "system_power_control":
        action = (args.get("action") or "").lower().strip()
        if action in _configured_set(config.TOOL_SANDBOX_BLOCKED_POWER_ACTIONS):
            return f"power action '{action}' is disabled by default"
    if tool == "run_terminal_command":
        command = str(args.get("command") or "")
        for pattern in _terminal_patterns():
            if re.search(pattern, command, flags=re.IGNORECASE):
                return f"terminal command matches blocked pattern /{pattern}/"
    return None


# jarvis_* tools are thin wrappers over the canonical tools (see executor.py
# tool registry). Decisions (blocked set, destructive patterns, confirmation)
# use the resolved canonical name so jarvis_* calls receive the exact same
# safety treatment as their canonical counterparts.
_TOOL_ALIASES = {
    "jarvis_run_terminal": "run_terminal_command",
    "jarvis_run_python": "run_python_script",
    "jarvis_system_power": "system_power_control",
    "jarvis_close_app": "manage_process",
    "jarvis_launch_app": "launch_app",
    "jarvis_open_or_play_file": "open_or_play_file",
    "jarvis_window_control": "control_window",
    "jarvis_keyboard_mouse_input": "keyboard_mouse_input",
    "jarvis_create_or_edit_file": "create_file",
    "jarvis_replace_file_content": "edit_file",
    "jarvis_manage_scheduled_task": "manage_scheduled_task",
}

_CODER_MODE_FILE_TOOLS = {"create_file", "edit_file", "delete_file"}


def _resolve_alias(tool_name: str) -> str:
    return _TOOL_ALIASES.get(tool_name, tool_name)


def _expand_path(value: str) -> str:
    try:
        return os.path.abspath(os.path.expanduser(os.path.expandvars(value)))
    except Exception:
        return value


def _path_is_within(root: str, target: str) -> bool:
    try:
        return os.path.commonpath([root, target]) == root
    except Exception:
        return False


def _coder_mode_file_guard(decision_tool: str, canonical_args: dict[str, Any], *, workspace_root: str | None) -> str | None:
    """Return a block reason when a Coder Mode file tool targets a disallowed path."""
    if decision_tool not in _CODER_MODE_FILE_TOOLS:
        return None
    path = str(canonical_args.get("file_path") or "").strip().strip("\"'")
    if not path:
        return None
    target = _expand_path(path)
    root = _expand_path(workspace_root) if workspace_root else None
    if root and _path_is_within(root, target):
        return None
    from app.tools.files import _is_safe_path

    if not _is_safe_path(path, write_operation=True):
        return f"'{path}' is a sensitive system location"
    if not root:
        return None
    return f"'{path}' is outside the active workspace '{workspace_root}'"


def _authorize_autonomous(tool: str, decision_tool: str, canonical_args: dict[str, Any], *, workspace_root: str | None, apply_file_guard: bool) -> ToolSafetyDecision:
    """Autonomous mode policy (Coder + Advanced jarvis): blacklist-only, no confirmation prompts.

    A hard blacklist and (for Coder Mode) a workspace path sandbox gate
    dangerous actions instead of prompting. Tools that internally re-check
    confirmations (open_or_play_file, delete_file) receive `confirmed=True` so
    they run without dead-ending.
    """
    coder_blocked = _configured_set(config.TOOL_SANDBOX_CODER_MODE_BLOCKED_TOOLS)
    if tool in coder_blocked or decision_tool in coder_blocked:
        return _blocked(f"Error: Tool '{tool}' is blocked in autonomous mode by the Yuki tool sandbox.", canonical_args)
    if apply_file_guard:
        reason = _coder_mode_file_guard(decision_tool, canonical_args, workspace_root=workspace_root)
        if reason:
            return _blocked(f"Error: Blocked by Yuki's Coder Mode path sandbox: {reason}", canonical_args)
    return ToolSafetyDecision(True, arguments=_execution_arguments(decision_tool, canonical_args, authorized=True))


def _execution_arguments(tool: str, args: dict[str, Any], *, authorized: bool) -> dict[str, Any]:
    clean = dict(args)
    if authorized and tool in {"open_or_play_file", "delete_file", "system_power_control"}:
        clean["confirmed"] = True
    return clean


def _issue_record(record_type: str, tool_name: str, arguments: dict[str, Any] | None, *, target: str | None, scope: str, ttl_seconds: int | None) -> str:
    token = secrets.token_urlsafe(32)
    tool = _resolve_alias(_normalize_tool_name(tool_name))
    canonical_args = canonicalize_tool_args(tool, arguments or {})
    now = time.time()
    record = _make_record(record_type, tool, canonical_args, target=target, scope=scope, ttl_seconds=ttl_seconds, now=now)
    _mutate_records(lambda records: records.__setitem__(token, record))
    return token


def _make_record(record_type: str, tool: str, canonical_args: dict[str, Any], *, target: str | None, scope: str, ttl_seconds: int | None, now: float) -> dict[str, Any]:
    ttl = ttl_seconds if ttl_seconds is not None else config.TOOL_CONFIRMATION_GRANT_TTL_SECONDS
    return {
        "record_type": record_type,
        "tool_name": tool,
        "args_hash": _arguments_hash(canonical_args),
        "scope": scope or DEFAULT_CONFIRMATION_SCOPE,
        "target": target or describe_tool_target(tool, canonical_args),
        "created_at": now,
        "expires_at": now + max(1, int(ttl)),
    }


def _validate_grant(grant_id: str, tool_name: str, canonical_args: dict[str, Any], *, scope: str, consume: bool) -> tuple[bool, str]:
    now = time.time()

    def mutate(records: dict[str, Any]) -> tuple[bool, str]:
        record = records.get(grant_id)
        if not record:
            return False, "grant was not found"
        if record.get("record_type") != "grant":
            return False, "token is not an executable grant"
        ok, reason = _record_matches(record, tool_name, canonical_args, scope, now)
        if not ok:
            return False, reason
        if consume:
            records.pop(grant_id, None)
        return True, "ok"

    if consume:
        return _mutate_records(mutate)

    records = _read_records()
    record = records.get(grant_id)
    if not record:
        return False, "grant was not found"
    if record.get("record_type") != "grant":
        return False, "token is not an executable grant"
    ok, reason = _record_matches(record, tool_name, canonical_args, scope, now)
    if not ok and reason == "grant expired":
        _mutate_records(lambda current: current.pop(grant_id, None))
    return (ok, reason if not ok else "ok")


def _record_matches(record: dict[str, Any], tool_name: str, canonical_args: dict[str, Any], scope: str, now: float) -> tuple[bool, str]:
    if float(record.get("expires_at", 0)) < now:
        return False, "grant expired"
    if record.get("tool_name") != tool_name:
        return False, "grant tool mismatch"
    if record.get("scope") != scope:
        return False, "grant scope mismatch"
    if record.get("args_hash") != _arguments_hash(canonical_args):
        return False, "grant argument mismatch"
    return True, "ok"


def _arguments_hash(canonical_args: dict[str, Any]) -> str:
    normalized = _normalize_for_hash(canonical_args)
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalize_for_hash(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _normalize_for_hash(v) for k, v in sorted(value.items()) if k not in INTERNAL_AUTH_FIELDS and v is not None}
    if isinstance(value, (list, tuple)):
        return [_normalize_for_hash(v) for v in value]
    if isinstance(value, str):
        return value.strip()
    return value


def _configured_set(raw: str | Iterable[str]) -> set[str]:
    if isinstance(raw, str):
        values = raw.split(",")
    else:
        values = list(raw)
    return {str(item).strip().lower() for item in values if str(item).strip()}


def _terminal_patterns() -> list[str]:
    configured = [item.strip() for item in config.TOOL_SANDBOX_BLOCKED_TERMINAL_PATTERNS.split("||") if item.strip()]
    # Custom patterns add to the destructive built-ins rather than replacing them.
    return DEFAULT_BLOCKED_TERMINAL_PATTERNS + configured


def _extract_grant_id(arguments: dict[str, Any]) -> str:
    grant = arguments.get("confirmation_grant_id") or arguments.get("_host_confirmation_grant_id") or ""
    return str(grant).strip()


def _normalize_tool_name(tool_name: str) -> str:
    return (tool_name or "").strip()


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _first_value(args: dict[str, Any]) -> Any:
    for value in args.values():
        return value
    return ""


def _drop_empty_generic(args: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in args.items() if k not in INTERNAL_AUTH_FIELDS and v is not None and v != ""}


def _blocked(message: str, args: dict[str, Any]) -> ToolSafetyDecision:
    return ToolSafetyDecision(False, blocked=True, message=message, arguments=args)


def _grant_path() -> Path:
    return Path(config.TOOL_CONFIRMATION_GRANT_FILE)


@contextlib.contextmanager
def _grant_file_lock():
    path = _grant_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = Path(str(path) + ".lock")
    fd: int | None = None
    deadline = time.time() + 3.0
    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(fd, str(os.getpid()).encode("ascii", errors="ignore"))
            break
        except FileExistsError:
            if time.time() > deadline:
                with contextlib.suppress(FileNotFoundError):
                    if time.time() - lock_path.stat().st_mtime > 10:
                        lock_path.unlink()
                        continue
                raise TimeoutError(f"Timed out waiting for confirmation grant lock: {lock_path}")
            time.sleep(0.05)
    try:
        yield
    finally:
        if fd is not None:
            os.close(fd)
        with contextlib.suppress(FileNotFoundError):
            lock_path.unlink()


def _read_records() -> dict[str, Any]:
    path = _grant_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        return {}
    return {}


def _write_records(records: dict[str, Any]) -> None:
    path = _grant_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(records, indent=2, sort_keys=True), encoding="utf-8")
    with contextlib.suppress(Exception):
        os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    with contextlib.suppress(Exception):
        os.chmod(path, 0o600)


def _mutate_records(mutator: Callable[[dict[str, Any]], Any]):
    with _PROCESS_LOCK:
        with _grant_file_lock():
            records = _read_records()
            now = time.time()
            for token, record in list(records.items()):
                if float(record.get("expires_at", 0)) < now:
                    records.pop(token, None)
            result = mutator(records)
            _write_records(records)
            return result
