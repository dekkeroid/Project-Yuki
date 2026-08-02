import os
import time
from typing import Any, Dict, List, Optional

from app.memory.db import get_connection

VALID_STATUSES = {"pending", "in_progress", "completed", "blocked"}
VALID_PRIORITIES = {"low", "normal", "high", "critical"}

DEFAULT_MD_FILENAME = "TODO.md"

_STATUS_ICONS = {"pending": "[ ]", "in_progress": "[~]", "completed": "[x]", "blocked": "[!]"}


def _now() -> float:
    return time.time()


def _validate_status(s: Optional[str]) -> str:
    s = (s or "pending").lower()
    if s not in VALID_STATUSES:
        raise ValueError(f"Invalid status '{s}'. Valid: {sorted(VALID_STATUSES)}.")
    return s


def _validate_priority(p: Optional[str]) -> str:
    p = (p or "normal").lower()
    if p not in VALID_PRIORITIES:
        raise ValueError(f"Invalid priority '{p}'. Valid: {sorted(VALID_PRIORITIES)}.")
    return p


def _adopt_orphaned_todos(conn, session_id: str) -> int:
    """Migrate legacy global todos (session_id IS NULL) into the active session."""
    cursor = conn.execute("UPDATE todos SET session_id = ? WHERE session_id IS NULL", (session_id,))
    return cursor.rowcount


def add_todo(title: str, parent_id: Optional[int] = None, status: str = "pending",
             priority: str = "normal", session_id: Optional[str] = None,
             block_reason: Optional[str] = None) -> Dict[str, Any]:
    """Create a new todo item (or subtask when parent_id is set)."""
    status = _validate_status(status)
    priority = _validate_priority(priority)
    # block_reason is only meaningful when status == 'blocked'; clear otherwise.
    block_reason = block_reason if status == "blocked" and block_reason else None

    now = _now()
    conn = get_connection()
    cursor = conn.cursor()

    if parent_id is not None:
        parent = cursor.execute("SELECT id FROM todos WHERE id = ?", (parent_id,)).fetchone()
        if not parent:
            conn.close()
            raise ValueError(f"Parent todo #{parent_id} does not exist.")

    cursor.execute("""
    SELECT COALESCE(MAX(position), 0) + 1 FROM todos WHERE parent_id IS ?
    """, (parent_id,))
    position = cursor.fetchone()[0]

    cursor.execute("""
    INSERT INTO todos (parent_id, title, status, priority, position, session_id, block_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (parent_id, title, status, priority, position, session_id, block_reason, now, now))
    conn.commit()
    todo_id = cursor.lastrowid
    conn.close()
    return {"status": "ok", "id": todo_id, "parent_id": parent_id, "title": title}


def get_todos(session_id: Optional[str] = None, include_completed: bool = True,
             include_archived: bool = False) -> List[Dict[str, Any]]:
    """Fetch all todos for a session, ordered parent-first then by position.

    When session_id is given, any legacy NULL-session todos are adopted into
    that session first so the list is strictly unique per session.
    Archived todos are excluded by default; pass include_archived=True to
    include them.
    """
    conn = get_connection()
    archived_clause = "" if include_archived else " AND archived = 0"
    if session_id is not None:
        _adopt_orphaned_todos(conn, session_id)
        conn.commit()
        rows = conn.execute(f"""
        SELECT id, parent_id, title, status, priority, position, session_id, block_reason, archived, created_at, updated_at
        FROM todos
        WHERE session_id = ?{archived_clause}
        ORDER BY parent_id IS NOT NULL, position ASC, id ASC
        """, (session_id,)).fetchall()
    else:
        rows = conn.execute(f"""
        SELECT id, parent_id, title, status, priority, position, session_id, block_reason, archived, created_at, updated_at
        FROM todos
        WHERE 1=1{archived_clause}
        ORDER BY parent_id IS NOT NULL, position ASC, id ASC
        """).fetchall()
    conn.close()
    todos = [dict(r) for r in rows]
    if not include_completed:
        todos = [t for t in todos if t["status"] != "completed"]
    return todos


def get_todo(todo_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    row = conn.execute("""
    SELECT id, parent_id, title, status, priority, position, session_id, block_reason, archived, created_at, updated_at
    FROM todos WHERE id = ?
    """, (todo_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_todo(todo_id: int, title: Optional[str] = None, status: Optional[str] = None,
                priority: Optional[str] = None, position: Optional[int] = None,
                session_id: Optional[str] = None,
                block_reason: Optional[str] = None) -> bool:
    conn = get_connection()
    cursor = conn.cursor()

    fields: List[str] = []
    params: List[Any] = []

    if title is not None:
        fields.append("title = ?")
        params.append(title)

    if status is not None:
        status = _validate_status(status)
        fields.append("status = ?")
        params.append(status)
        # block_reason is only meaningful when blocked; setting status to
        # anything else clears it. When status IS 'blocked', honor the
        # explicitly-passed block_reason (may be None to clear an existing one).
        if status == "blocked":
            fields.append("block_reason = ?")
            params.append(block_reason)
        else:
            fields.append("block_reason = NULL")

        # Single in_progress invariant: demote peers before promoting this one.
        if status == "in_progress" and session_id is not None:
            cursor.execute(
                "UPDATE todos SET status='pending', updated_at=? "
                "WHERE session_id=? AND status='in_progress' AND id != ?",
                (_now(), session_id, todo_id))

    if priority is not None:
        priority = _validate_priority(priority)
        fields.append("priority = ?")
        params.append(priority)

    if position is not None:
        fields.append("position = ?")
        params.append(int(position))

    if not fields:
        conn.close()
        return False
    fields.append("updated_at = ?")
    params.append(_now())
    params.append(todo_id)
    cursor = conn.execute(f"UPDATE todos SET {', '.join(fields)} WHERE id = ?", params)
    conn.commit()
    changed = cursor.rowcount > 0
    conn.close()
    return changed


def complete_todo(todo_id: int, session_id: Optional[str] = None) -> bool:
    """Mark a todo completed and auto-advance the next pending sibling.

    After marking this task completed, find the next pending sibling (same
    parent_id, position > completed's position, smallest first) and set it to
    in_progress (which demotes any other in_progress task in the session via
    update_todo). If there is no next sibling, nothing is left in_progress.
    """
    conn = get_connection()
    row = conn.execute(
        "SELECT parent_id, position FROM todos WHERE id = ?", (todo_id,)).fetchone()
    conn.close()
    if not row:
        return False
    parent_id, position = row["parent_id"], row["position"]

    if not update_todo(todo_id, status="completed", session_id=session_id):
        return False

    # Find the next pending sibling after the completed task's position.
    conn = get_connection()
    sibling = conn.execute(
        "SELECT id FROM todos "
        "WHERE parent_id IS ? AND position > ? AND status = 'pending' "
        "ORDER BY position ASC, id ASC LIMIT 1",
        (parent_id, position)).fetchone()
    conn.close()
    if sibling:
        update_todo(sibling["id"], status="in_progress", session_id=session_id)
    return True


def reopen_todo(todo_id: int) -> bool:
    return update_todo(todo_id, status="pending")


def delete_todo(todo_id: int) -> bool:
    """Delete a todo and cascade-delete any subtasks."""
    conn = get_connection()
    conn.execute("PRAGMA foreign_keys = ON;")
    cursor = conn.execute("DELETE FROM todos WHERE id = ? OR parent_id = ?", (todo_id, todo_id))
    conn.commit()
    changed = cursor.rowcount > 0
    conn.close()
    return changed


def clear_completed() -> int:
    """Archive all completed todos (soft-delete via the archived flag).

    Preserves the done-history the tool exists to demonstrate — archived rows
    are excluded from get_todos() unless include_archived=True is passed.
    """
    conn = get_connection()
    cursor = conn.execute(
        "UPDATE todos SET archived=1, updated_at=? WHERE status='completed' AND archived=0",
        (_now(),))
    conn.commit()
    archived = cursor.rowcount
    conn.close()
    return archived


def sync_todos(items: List[Dict[str, Any]], session_id: Optional[str] = None) -> Dict[str, int]:
    """Reconcile the todo list against a desired item list in one transaction.

    Each item may contain: id (existing todo), title, status, priority,
    parent_id, block_reason, and delete (bool). Items with an id are updated
    in place, items without an id are created, and items with delete=True are
    removed (hard DELETE — intentional explicit removal).
    Returns {"created": n, "updated": n, "deleted": n}.

    A pre-validation pass runs over all items first so a single bad value
    aborts the whole sync cleanly rather than partially applying.
    """
    created = 0
    updated = 0
    deleted = 0
    now = _now()

    # Pre-validation pass — raise before any DB write.
    parsed_items: List[Dict[str, Any]] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        if item.get("delete"):
            parsed_items.append({"delete": True, "id": item.get("id")})
            continue
        title = str(item.get("title") or "").strip()
        status = _validate_status(item.get("status"))
        priority = _validate_priority(item.get("priority"))
        block_reason = item.get("block_reason")
        block_reason = block_reason if status == "blocked" and block_reason else None
        parsed_items.append({
            "id": item.get("id"),
            "title": title,
            "status": status,
            "priority": priority,
            "parent_id": item.get("parent_id"),
            "block_reason": block_reason,
        })

    conn = get_connection()
    cursor = conn.cursor()
    if session_id is not None:
        _adopt_orphaned_todos(conn, session_id)

    for item in parsed_items:
        if item.get("delete"):
            todo_id = item.get("id")
            if todo_id is None:
                continue
            cursor.execute("DELETE FROM todos WHERE id = ? OR parent_id = ?", (int(todo_id), int(todo_id)))
            if cursor.rowcount > 0:
                deleted += 1
            continue

        title = item["title"]
        status = item["status"]
        priority = item["priority"]
        block_reason = item["block_reason"]
        parent_id = item.get("parent_id")
        if parent_id is not None:
            parent_id = int(parent_id)

        todo_id = item.get("id")
        if todo_id is not None:
            todo_id = int(todo_id)
            if parent_id is not None:
                cursor.execute("UPDATE todos SET parent_id = ? WHERE id = ?", (parent_id, todo_id))
            if title:
                cursor.execute("UPDATE todos SET title = ? WHERE id = ?", (title, todo_id))
            cursor.execute(
                "UPDATE todos SET status = ?, priority = ?, block_reason = ?, updated_at = ? WHERE id = ?",
                (status, priority, block_reason, now, todo_id))
            if cursor.rowcount > 0:
                updated += 1
        else:
            if not title:
                continue
            if parent_id is not None:
                parent = cursor.execute("SELECT id FROM todos WHERE id = ?", (parent_id,)).fetchone()
                if not parent:
                    continue
            position = cursor.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM todos WHERE parent_id IS ?",
                (parent_id,)).fetchone()[0]
            cursor.execute("""
            INSERT INTO todos (parent_id, title, status, priority, position, session_id, block_reason, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (parent_id, title, status, priority, position, session_id, block_reason, now, now))
            created += 1

    conn.commit()
    conn.close()
    return {"created": created, "updated": updated, "deleted": deleted}


def format_todo_tree(todos: List[Dict[str, Any]], include_completed: bool = True) -> str:
    """Render todos as a numbered indented tree with status/priority markers.

    Numbering is hierarchical: top-level tasks are numbered 1, 2, 3... and
    subtasks are numbered relative to their parent (1.1, 1.2, ...).
    """
    by_parent: Dict[Optional[int], List[Dict[str, Any]]] = {}
    for t in todos:
        by_parent.setdefault(t["parent_id"], []).append(t)

    if not include_completed:
        todos = [t for t in todos if t["status"] != "completed"]
        by_parent = {}
        for t in todos:
            by_parent.setdefault(t["parent_id"], []).append(t)

    def _render(parent: Optional[int], counters: List[int]) -> List[str]:
        lines = []
        index = 1
        for t in by_parent.get(parent, []):
            suffix = "." if not counters else ""
            number = ".".join(str(c) for c in (*counters, index))
            icon = _STATUS_ICONS.get(t["status"], "[ ]")
            pri = f" ({t['priority']})" if t["priority"] != "normal" else ""
            blocked = f" (blocked: {t['block_reason']})" if t["status"] == "blocked" and t.get("block_reason") else ""
            lines.append(f"{number}{suffix} {icon} #{t['id']}{pri}: {t['title']}{blocked}")
            lines.extend(_render(t["id"], [*counters, index]))
            index += 1
        return lines

    lines = _render(None, [])
    if not lines:
        return "No todos in the list."
    return "\n".join(lines)


def render_md_file(todos: List[Dict[str, Any]], target_dir: Optional[str] = None) -> str:
    """Write a human-readable TODO.md into the given directory and return its path."""
    lines = ["# Agent TODO List", ""]
    lines.append("> Auto-managed by `manage_todo`. Tasks survive crashes and are stored in `yuki_files.db`.")
    lines.append("")
    lines.append(format_todo_tree(todos))
    lines.append("")
    path = os.path.join(target_dir or os.getcwd(), DEFAULT_MD_FILENAME)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        return path
    except Exception as e:
        raise RuntimeError(f"Failed to write TODO.md: {e}")


def manage_todo(action: str, title: Optional[str] = None, todo_id: Optional[int] = None,
                parent_id: Optional[int] = None, status: Optional[str] = None,
                priority: Optional[str] = None, position: Optional[int] = None,
                session_id: Optional[str] = None, include_completed: bool = True,
                include_archived: bool = False,
                block_reason: Optional[str] = None,
                target_dir: Optional[str] = None, items: Optional[List[Dict[str, Any]]] = None) -> str:
    """
    Single dispatcher for all persistent TODO list operations.
    Returns a human-readable string result.
    """
    action = (action or "").lower().strip()

    if action in ("sync", "apply", "set", "batch"):
        if not items:
            return "Error: A list of items is required to sync the todo list."
        try:
            counts = sync_todos(items, session_id=session_id)
        except ValueError as e:
            return f"Error: {e}"
        return (f"Success: Synced {counts['created'] + counts['updated'] + counts['deleted']} "
                f"items ({counts['created']} created, {counts['updated']} updated, {counts['deleted']} deleted).\n"
                f"Current list:\n{format_todo_tree(get_todos(session_id=session_id, include_completed=include_completed, include_archived=include_archived), include_completed=include_completed)}")

    if action in ("create", "add", "add_task", "new"):
        if not title or not str(title).strip():
            return "Error: A title is required to create a todo."
        try:
            res = add_todo(str(title).strip(), parent_id=parent_id, status=status or "pending",
                           priority=priority or "normal", session_id=session_id,
                           block_reason=block_reason)
        except ValueError as e:
            return f"Error: {e}"
        label = "subtask" if parent_id is not None else "task"
        return f"Success: Created {label} #{res['id']}: '{res['title']}'."

    if action in ("list", "show", "view", "get", "ls"):
        todos = get_todos(session_id=session_id, include_completed=include_completed,
                          include_archived=include_archived)
        return format_todo_tree(todos, include_completed=include_completed)

    if action in ("update", "edit", "change", "modify", "reorder", "move"):
        if todo_id is None:
            return "Error: A todo id is required to update."
        try:
            if not update_todo(todo_id, title=title, status=status, priority=priority,
                               position=position, session_id=session_id, block_reason=block_reason):
                return f"Error: Todo #{todo_id} not found or nothing to update."
        except ValueError as e:
            return f"Error: {e}"
        return f"Success: Updated todo #{todo_id}."

    if action in ("complete", "done", "finish", "mark_complete"):
        if todo_id is None:
            return "Error: A todo id is required to complete."
        try:
            if not complete_todo(todo_id, session_id=session_id):
                return f"Error: Todo #{todo_id} not found."
        except ValueError as e:
            return f"Error: {e}"
        return f"Success: Marked todo #{todo_id} as completed."

    if action in ("reopen", "uncomplete", "undo"):
        if todo_id is None:
            return "Error: A todo id is required to reopen."
        try:
            if not reopen_todo(todo_id):
                return f"Error: Todo #{todo_id} not found."
        except ValueError as e:
            return f"Error: {e}"
        return f"Success: Reopened todo #{todo_id}."

    if action in ("add_subtask", "subtask", "child"):
        if not title or not str(title).strip():
            return "Error: A title is required for the subtask."
        if parent_id is None:
            return "Error: A parent_id is required to add a subtask."
        try:
            res = add_todo(str(title).strip(), parent_id=parent_id, status=status or "pending",
                           priority=priority or "normal", session_id=session_id,
                           block_reason=block_reason)
        except ValueError as e:
            return f"Error: {e}"
        return f"Success: Created subtask #{res['id']} under todo #{parent_id}: '{res['title']}'."

    if action in ("list_subtasks", "subtasks", "children"):
        if parent_id is None:
            return "Error: A parent_id is required to list subtasks."
        todos = [t for t in get_todos(session_id=session_id, include_archived=include_archived)
                 if t["parent_id"] == parent_id]
        if not todos:
            return f"No subtasks found under todo #{parent_id}."
        lines = []
        for idx, t in enumerate(todos, start=1):
            pri = f" ({t['priority']})" if t["priority"] != "normal" else ""
            icon = _STATUS_ICONS.get(t["status"], "[ ]")
            blocked = f" (blocked: {t['block_reason']})" if t["status"] == "blocked" and t.get("block_reason") else ""
            lines.append(f"{idx}. {icon} #{t['id']}{pri}: {t['title']}{blocked}")
        return "\n".join(lines)

    if action in ("delete", "remove", "rm"):
        if todo_id is None:
            return "Error: A todo id is required to delete."
        if not delete_todo(todo_id):
            return f"Error: Todo #{todo_id} not found."
        return f"Success: Deleted todo #{todo_id} and its subtasks."

    if action in ("clear_completed", "clear", "cleanup"):
        archived = clear_completed()
        return f"Success: Archived {archived} completed todo(s)."

    if action in ("render_md", "render", "md", "todo_md"):
        todos = get_todos(session_id=session_id, include_completed=include_completed,
                          include_archived=include_archived)
        try:
            path = render_md_file(todos, target_dir=target_dir)
        except RuntimeError as e:
            return f"Error: {e}"
        return f"Success: Wrote TODO.md to: {path}"

    return f"Unknown action '{action}' for manage_todo. Valid actions: sync, create, list, update, complete, reopen, add_subtask, list_subtasks, delete, clear_completed, render_md."
