import os
import time
import functools
from typing import Any, Dict, List, Optional, Union

from app.memory.db import get_connection, DB_WRITE_LOCK


def _write_locked(func):
    """Serializes writes through the shared SQLite write lock."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        with DB_WRITE_LOCK:
            return func(*args, **kwargs)
    return wrapper


def _now() -> float:
    return time.time()


def _normalize_list_name(name: Optional[str]) -> str:
    name = (name or "default").lower().strip()
    if name in ("groceries", "grocery", "grocery list", "buy"):
        return "shopping"
    if name in ("today", "tasks", "daily", "agenda", "todo", "todos", "to do", "to-do", "to do today", "things to do today"):
        return "to do today"
    return name


@_write_locked
def add_to_list(
    list_name: str,
    items: Union[str, List[str]],
    quantity: Optional[str] = None,
    clear_old: bool = False
) -> Dict[str, Any]:
    """
    Adds one or more items to a named list.
    Supports single strings, comma-separated lists, or arrays of strings.
    If clear_old is True, wipes prior items in this list before adding.
    Deduplicates: avoids adding duplicate items that are already pending.
    """
    clean_name = _normalize_list_name(list_name)
    now = _now()

    item_list: List[str] = []
    if isinstance(items, list):
        for it in items:
            if isinstance(it, str):
                for sub in it.split(","):
                    clean = sub.strip()
                    if clean:
                        item_list.append(clean)
    elif isinstance(items, str):
        for sub in items.split(","):
            clean = sub.strip()
            if clean:
                item_list.append(clean)

    if not item_list and not clear_old:
        return {"status": "error", "message": "No valid items provided to add."}

    conn = get_connection()
    cursor = conn.cursor()

    if clear_old:
        cursor.execute("DELETE FROM personal_lists WHERE list_name = ?", (clean_name,))

    cursor.execute("SELECT id, item FROM personal_lists WHERE list_name = ? AND status = 'pending'", (clean_name,))
    existing_items = {row[1].strip().lower(): row[0] for row in cursor.fetchall()}

    added = []
    already_present = []

    for it in item_list:
        it_lower = it.lower()
        if it_lower in existing_items:
            already_present.append(it)
            if quantity:
                cursor.execute(
                    "UPDATE personal_lists SET quantity = ?, updated_at = ? WHERE id = ?",
                    (quantity, now, existing_items[it_lower])
                )
        else:
            cursor.execute("""
            INSERT INTO personal_lists (list_name, item, status, quantity, created_at, updated_at)
            VALUES (?, ?, 'pending', ?, ?, ?)
            """, (clean_name, it, quantity, now, now))
            existing_items[it_lower] = cursor.lastrowid
            added.append(it)

    conn.commit()
    conn.close()

    parts = []
    if clear_old:
        parts.append(f"Cleared previous '{clean_name}' list.")
    if added:
        items_str = ", ".join(f"'{i}'" for i in added)
        parts.append(f"Added {len(added)} item(s) to '{clean_name}': {items_str}.")
    if already_present and not clear_old:
        dup_str = ", ".join(f"'{i}'" for i in already_present)
        parts.append(f"Already on list: {dup_str}.")

    msg = " ".join(parts) if parts else f"No new items added to '{clean_name}'."
    return {
        "status": "ok",
        "list_name": clean_name,
        "count": len(added),
        "message": msg
    }


def get_list_items(list_name: Optional[str] = None, include_completed: bool = False) -> List[Dict[str, Any]]:
    """Fetches items for a specific list, or all lists if list_name is None or 'all'."""
    conn = get_connection()
    cursor = conn.cursor()

    status_filter = "" if include_completed else " AND status = 'pending'"

    if not list_name or list_name.lower().strip() in ("all", "*", "lists"):
        cursor.execute(f"""
        SELECT id, list_name, item, status, quantity, created_at, updated_at
        FROM personal_lists
        WHERE 1=1{status_filter}
        ORDER BY list_name ASC, status ASC, id ASC
        """)
    else:
        clean_name = _normalize_list_name(list_name)
        cursor.execute(f"""
        SELECT id, list_name, item, status, quantity, created_at, updated_at
        FROM personal_lists
        WHERE list_name = ?{status_filter}
        ORDER BY status ASC, id ASC
        """, (clean_name,))

    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def format_list(list_name: str, include_completed: bool = False) -> str:
    """Formats a human-readable checklist with numbers and status boxes."""
    clean_name = _normalize_list_name(list_name)
    items = get_list_items(clean_name, include_completed=include_completed)

    if not items:
        if include_completed:
            return f"Your '{clean_name}' list is currently empty."
        return f"No pending items in your '{clean_name}' list! (All done or empty)."

    display_title = clean_name.capitalize()
    lines = [f"{display_title} List ({len(items)} items):"]

    for idx, it in enumerate(items, 1):
        box = "[x]" if it["status"] == "completed" else "[ ]"
        qty_str = f" ({it['quantity']})" if it.get("quantity") else ""
        lines.append(f"{box} {idx}. {it['item']}{qty_str}")

    return "\n".join(lines)


def get_all_lists_summary() -> str:
    """Returns an overview of all active lists and their pending/completed counts."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT list_name,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
           COUNT(*) as total_count
    FROM personal_lists
    GROUP BY list_name
    ORDER BY list_name ASC
    """)
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return "You don't have any active personal lists yet."

    lines = ["Active Personal Lists:"]
    for r in rows:
        p = r["pending_count"] or 0
        c = r["completed_count"] or 0
        lines.append(f"- {r['list_name'].capitalize()}: {p} pending" + (f", {c} completed" if c > 0 else ""))
    return "\n".join(lines)


@_write_locked
def check_items(list_name: str, items_or_indices: Union[str, int, List[Union[str, int]]], completed: bool = True) -> str:
    """Marks items as completed (or reopened) by title, index number, or ID."""
    clean_name = _normalize_list_name(list_name)
    all_items = get_list_items(clean_name, include_completed=True)
    if not all_items:
        return f"List '{clean_name}' is empty."

    targets = items_or_indices if isinstance(items_or_indices, list) else [items_or_indices]
    now = _now()
    conn = get_connection()
    cursor = conn.cursor()
    updated = []

    for t in targets:
        matched_id = None
        try:
            val_int = int(t)
            if 1 <= val_int <= len(all_items):
                matched_id = all_items[val_int - 1]["id"]
            else:
                direct = [it for it in all_items if it["id"] == val_int]
                if direct:
                    matched_id = direct[0]["id"]
        except (ValueError, TypeError):
            pass

        if matched_id is None and isinstance(t, str):
            t_lower = t.lower().strip()
            for it in all_items:
                if it["item"].lower().strip() == t_lower:
                    matched_id = it["id"]
                    break
            if matched_id is None:
                for it in all_items:
                    if t_lower in it["item"].lower():
                        matched_id = it["id"]
                        break

        if matched_id is not None:
            new_status = "completed" if completed else "pending"
            cursor.execute("UPDATE personal_lists SET status = ?, updated_at = ? WHERE id = ?", (new_status, now, matched_id))
            item_name = next((it["item"] for it in all_items if it["id"] == matched_id), f"Item #{matched_id}")
            updated.append(item_name)

    conn.commit()
    conn.close()

    if not updated:
        return f"No matching items found in '{clean_name}' to update."

    action_word = "Checked off" if completed else "Reopened"
    items_str = ", ".join(f"'{i}'" for i in updated)
    return f"{action_word} {len(updated)} item(s) from '{clean_name}': {items_str}."


@_write_locked
def remove_items(list_name: str, items_or_indices: Union[str, int, List[Union[str, int]]]) -> str:
    """Deletes item(s) from a list permanently."""
    clean_name = _normalize_list_name(list_name)
    all_items = get_list_items(clean_name, include_completed=True)
    if not all_items:
        return f"List '{clean_name}' is empty."

    targets = items_or_indices if isinstance(items_or_indices, list) else [items_or_indices]
    conn = get_connection()
    cursor = conn.cursor()
    deleted = []

    for t in targets:
        matched_id = None
        try:
            val_int = int(t)
            if 1 <= val_int <= len(all_items):
                matched_id = all_items[val_int - 1]["id"]
        except (ValueError, TypeError):
            pass

        if matched_id is None and isinstance(t, str):
            t_lower = t.lower().strip()
            for it in all_items:
                if it["item"].lower().strip() == t_lower or t_lower in it["item"].lower():
                    matched_id = it["id"]
                    break

        if matched_id is not None:
            cursor.execute("DELETE FROM personal_lists WHERE id = ?", (matched_id,))
            item_name = next((it["item"] for it in all_items if it["id"] == matched_id), f"Item #{matched_id}")
            deleted.append(item_name)

    conn.commit()
    conn.close()

    if not deleted:
        return f"No matching items found in '{clean_name}' to remove."

    items_str = ", ".join(f"'{i}'" for i in deleted)
    return f"Removed {len(deleted)} item(s) from '{clean_name}': {items_str}."


@_write_locked
def clear_completed_items(list_name: str) -> str:
    """Removes all completed items from a list."""
    clean_name = _normalize_list_name(list_name)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM personal_lists WHERE list_name = ? AND status = 'completed'", (clean_name,))
    count = cursor.rowcount
    conn.commit()
    conn.close()

    if count > 0:
        return f"Cleared {count} completed item(s) from '{clean_name}'."
    return f"No completed items to clear in '{clean_name}'."


def export_list_to_markdown(list_name: str, target_path: Optional[str] = None) -> str:
    """Exports a list to a Markdown file on the user's Desktop or custom path."""
    clean_name = _normalize_list_name(list_name)
    items = get_list_items(clean_name, include_completed=True)
    if not items:
        return f"List '{clean_name}' is empty. Nothing to export."

    if not target_path:
        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        target_path = os.path.join(desktop, f"{clean_name.capitalize()}_List.md")

    lines = [f"# {clean_name.capitalize()} List", ""]
    for it in items:
        box = "- [x]" if it["status"] == "completed" else "- [ ]"
        qty = f" ({it['quantity']})" if it.get("quantity") else ""
        lines.append(f"{box} {it['item']}{qty}")

    try:
        with open(target_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        return f"Successfully exported '{clean_name}' to: {target_path}"
    except Exception as e:
        return f"Failed to export list to markdown: {e}"


def manage_personal_list(
    action: str = "show",
    list_name: Optional[str] = "shopping",
    items: Optional[Union[str, List[str]]] = None,
    include_completed: bool = False,
    quantity: Optional[str] = None,
    target_path: Optional[str] = None,
    item: Optional[str] = None,
    clear_old: bool = False
) -> str:
    """
    Main dispatcher for personal lists (shopping lists, daily agendas, errands, wishlists).
    """
    action = (action or "show").lower().strip()

    if not items and item:
        items = item

    if action in ("replace", "new_list"):
        clear_old = True
        action = "add"

    if action in ("lists", "all", "overview", "show_all"):
        return get_all_lists_summary()

    if not list_name or list_name.lower().strip() in ("all", "lists"):
        if action in ("show", "list", "view"):
            return get_all_lists_summary()

    list_name = list_name or "shopping"

    if action in ("add", "create", "append", "new", "put"):
        if not items and not clear_old:
            return "Please provide the item(s) you would like to add."
        res = add_to_list(list_name, items or [], quantity=quantity, clear_old=clear_old)
        return res["message"]

    if action in ("show", "list", "view", "get", "display"):
        return format_list(list_name, include_completed=include_completed)

    if action in ("check", "complete", "done", "finish", "mark"):
        if not items:
            return "Please specify which item(s) to check off."
        return check_items(list_name, items, completed=True)

    if action in ("uncheck", "reopen", "undo"):
        if not items:
            return "Please specify which item(s) to reopen."
        return check_items(list_name, items, completed=False)

    if action in ("remove", "delete", "drop", "rm"):
        if not items:
            return "Please specify which item(s) to remove."
        return remove_items(list_name, items)

    if action in ("clear", "clear_completed", "cleanup", "purge"):
        return clear_completed_items(list_name)

    if action in ("export", "save", "write_md"):
        return export_list_to_markdown(list_name, target_path=target_path)

    return f"Unknown action '{action}'. Valid actions: add, show, check, uncheck, remove, clear_completed, lists, export."
