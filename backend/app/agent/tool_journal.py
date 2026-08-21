"""
Durable tool execution journal.

Append-only JSONL at config.BASE_DIR / "tool_runs.jsonl". Each line is a single
JSON record, so a hard crash mid-write only ever truncates the trailing line —
which readers safely ignore. This gives us crash-resilient knowledge of exactly
which tool + arguments were running when the backend died.

Records are written under a module-level lock because tools run via
asyncio.to_thread / MCP subprocesses and may complete concurrently.
"""

import json
import os
import threading
import time

from typing import Any, Dict, Optional

from app import config

_journal_lock = threading.Lock()


def _journal_path() -> str:
    base = getattr(config, "BASE_DIR", None)
    if base:
        return os.path.join(str(base), "tool_runs.jsonl")
    return os.path.join(os.getcwd(), "tool_runs.jsonl")


def _append_record(record: Dict[str, Any]) -> None:
    try:
        line = json.dumps(record, ensure_ascii=False, default=str)
        with _journal_lock:
            with open(_journal_path(), "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as e:
        print(f"[ToolJournal] Failed to append record: {e}")


def record_tool_start(turn_id: str, tool_name: str, args: Optional[Dict[str, Any]] = None) -> None:
    """Persist a started record with the FULL raw args BEFORE the tool dispatches."""
    _append_record({
        "type": "tool_start",
        "turn_id": turn_id or "",
        "tool_name": tool_name,
        "args": args or {},
        "ts": time.time(),
    })


def record_tool_end(turn_id: str, tool_name: str, status: str,
                    result: str = "", error: str = "",
                    duration_ms: float = 0.0) -> None:
    _append_record({
        "type": "tool_end",
        "turn_id": turn_id or "",
        "tool_name": tool_name,
        "status": status,
        "result": str(result or "")[:2000],
        "error": str(error or "")[:2000],
        "duration_ms": round(duration_ms, 1),
        "ts": time.time(),
    })


def read_journal(turn_id: Optional[str] = None) -> list:
    """Read records back from the journal. Partial trailing lines are ignored."""
    path = _journal_path()
    if not os.path.exists(path):
        return []
    records = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if turn_id and rec.get("turn_id") != turn_id:
                    continue
                records.append(rec)
    except Exception as e:
        print(f"[ToolJournal] Failed to read journal: {e}")
    return records


def get_recent_tool_names(limit: int = 10) -> list[str]:
    """Return the most recent unique tool names from the journal in reverse-chronological order."""
    records = read_journal()
    seen = set()
    recent = []
    for rec in reversed(records):
        name = rec.get("tool_name")
        if name and name not in seen:
            seen.add(name)
            recent.append(name)
            if len(recent) >= limit:
                break
    return recent

