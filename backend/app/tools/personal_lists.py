import datetime
import functools
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple, Union

from dateutil import parser as dt_parser

from app.memory.db import DB_WRITE_LOCK, get_connection


_DAILY_LIST_KEYWORDS = {
    "today", "tasks", "daily", "agenda", "todo", "todos", "to do", "to-do",
    "to do today", "things to do today", "daily todo", "daily to do", "daily agenda",
    "yesterday", "tomorrow", "tonight", "agenda today"
}


def _write_locked(func):
    """Serializes writes through the shared SQLite write lock."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        with DB_WRITE_LOCK:
            return func(*args, **kwargs)
    return wrapper


def _now() -> float:
    return time.time()


def _format_list_display_name(raw_name: str, ref_dt: Optional[datetime.datetime] = None) -> str:
    """Formats a database list_name into a user-facing label."""
    if raw_name.startswith("todo:"):
        date_str = raw_name[5:]
        try:
            d = datetime.date.fromisoformat(date_str)
            ref_dt = ref_dt or datetime.datetime.now()
            today_d = ref_dt.date()
            diff = (d - today_d).days
            if diff == 0:
                rel = "Today"
            elif diff == -1:
                rel = "Yesterday"
            elif diff == 1:
                rel = "Tomorrow"
            else:
                rel = d.strftime("%A")
            return f"To-Do for {rel} ({d.strftime('%A, %b %d, %Y')})"
        except Exception:
            return f"To-Do List ({date_str})"
    elif raw_name == "to do today":
        return "To-Do List (Legacy)"
    return f"{raw_name.capitalize()} List"


def _parse_target_date(
    date_str: Optional[str] = None,
    name_str: Optional[str] = None,
    ref_dt: Optional[datetime.datetime] = None
) -> Tuple[datetime.date, str]:
    """
    Parses a target date from date_str or name_str relative to ref_dt.
    Returns: (target_date, date_source_type)
    """
    ref_dt = ref_dt or datetime.datetime.now()
    today_d = ref_dt.date()

    raw = (date_str or "").strip().lower()
    if not raw and name_str:
        n = name_str.strip().lower()
        if "yesterday" in n:
            raw = "yesterday"
        elif "tomorrow" in n:
            raw = "tomorrow"
        elif "today" in n or "tonight" in n:
            raw = "today"
        else:
            m = re.search(r"\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b", n)
            if m:
                raw = m.group(1)

    if not raw or raw in ("today", "tonight", "now"):
        return today_d, "relative_today"

    if raw == "yesterday":
        return today_d - datetime.timedelta(days=1), "relative_yesterday"

    if raw == "tomorrow":
        return today_d + datetime.timedelta(days=1), "relative_tomorrow"

    try:
        clean_raw = raw.replace("/", "-")
        parsed = dt_parser.parse(clean_raw, default=ref_dt).date()
        return parsed, "explicit"
    except Exception:
        return today_d, "relative_today"


def _resolve_list_and_date(
    name: Optional[str] = None,
    date_str: Optional[str] = None,
    action: str = "show",
    ref_dt: Optional[datetime.datetime] = None
) -> Tuple[str, str, Optional[str]]:
    """
    Resolves the canonical database list name, human display title, and any contextual note.
    Handles the 12:00 AM – 4:00 AM late-night session window seamlessly.
    Returns: (canonical_name, display_title, context_note)
    """
    ref_dt = ref_dt or datetime.datetime.now()
    raw_name = (name or "").strip().lower()

    # Determine if this is a daily to-do list
    is_daily = False
    if date_str or action in ("rollover", "carryover"):
        is_daily = True
    elif raw_name in _DAILY_LIST_KEYWORDS:
        is_daily = True
    elif raw_name.startswith("todo:") or raw_name.startswith("todo_"):
        is_daily = True
    elif any(k in raw_name for k in ("yesterday", "tomorrow", "to do", "todo")):
        is_daily = True
    elif re.search(r"\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b", raw_name):
        is_daily = True

    if not is_daily:
        clean_name = raw_name or "shopping"
        if clean_name in ("groceries", "grocery", "grocery list", "buy"):
            clean_name = "shopping"
        return clean_name, f"{clean_name.capitalize()} List", None

    today_d = ref_dt.date()
    yesterday_d = today_d - datetime.timedelta(days=1)
    tomorrow_d = today_d + datetime.timedelta(days=1)
    is_late_night = (0 <= ref_dt.hour < 4)

    target_d, date_type = _parse_target_date(date_str, raw_name, ref_dt=ref_dt)

    # 1. Late-Night Window (12:00 AM – 4:00 AM) smart resolution for "today"
    if is_late_night and date_type == "relative_today":
        conn = get_connection()
        cursor = conn.cursor()
        today_key = f"todo:{today_d.isoformat()}"
        yesterday_key = f"todo:{yesterday_d.isoformat()}"

        cursor.execute("SELECT COUNT(*) FROM personal_lists WHERE list_name = ?", (today_key,))
        today_total = cursor.fetchone()[0] or 0

        cursor.execute("""
        SELECT COUNT(*), SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)
        FROM personal_lists
        WHERE list_name = ?
        """, (yesterday_key,))
        y_row = cursor.fetchone()
        yesterday_total = (y_row[0] or 0) if y_row else 0
        yesterday_pending = (y_row[1] or 0) if y_row else 0

        if yesterday_total == 0:
            cursor.execute("""
            SELECT COUNT(*), SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)
            FROM personal_lists
            WHERE list_name = 'to do today'
            """)
            leg_row = cursor.fetchone()
            if leg_row and (leg_row[0] or 0) > 0:
                yesterday_total = leg_row[0] or 0
                yesterday_pending = leg_row[1] or 0
                yesterday_key = "to do today"

        conn.close()

        if today_total > 0:
            note = None
            if yesterday_pending > 0:
                note = f"Note: You also have {yesterday_pending} unfinished item(s) from yesterday's session ({yesterday_d.strftime('%a, %b %d')})."
            return today_key, f"To-Do List for Today ({today_d.strftime('%A, %b %d, %Y')})", note
        elif yesterday_total > 0:
            if action in ("show", "list", "view", "get", "display", "check", "uncheck"):
                note = (
                    f"Late-Night Session: It's {ref_dt.strftime('%I:%M %p').lstrip('0')} early morning, "
                    f"so showing your active list from yesterday ({yesterday_d.strftime('%b %d')}). "
                    f"If you want a fresh list for today ({today_d.strftime('%b %d')}), pass clear_old=True or date='today'."
                )
                return yesterday_key, f"To-Do List for {yesterday_d.strftime('%A, %b %d, %Y')} (Late-Night Session)", note
            elif action in ("add", "create", "append", "new", "put") and not (date_str and date_str.lower() in ("today", today_d.isoformat())):
                note = f"(Added to yesterday's late-night session for {yesterday_d.strftime('%b %d')}. Say 'add to today's list' if intended for daytime.)"
                return yesterday_key, f"To-Do List for {yesterday_d.strftime('%A, %b %d, %Y')} (Late-Night Session)", note

    # 2. Daytime or explicit date resolution
    canonical_name = f"todo:{target_d.isoformat()}"
    if target_d == today_d:
        rel_label = "Today"
    elif target_d == yesterday_d:
        rel_label = "Yesterday"
    elif target_d == tomorrow_d:
        rel_label = "Tomorrow"
    else:
        rel_label = target_d.strftime("%A")

    display_title = f"To-Do List for {rel_label} ({target_d.strftime('%A, %b %d, %Y')})"

    tip_note = None
    if target_d == today_d and not is_late_night and action in ("show", "list", "view", "get", "display"):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT item FROM personal_lists WHERE list_name = ? AND status = 'pending' LIMIT 5", (f"todo:{yesterday_d.isoformat()}",))
        y_items = [r[0] for r in cursor.fetchall()]
        if not y_items:
            cursor.execute("SELECT item FROM personal_lists WHERE list_name = 'to do today' AND status = 'pending' LIMIT 5")
            y_items = [r[0] for r in cursor.fetchall()]
        conn.close()

        if y_items:
            sample = ", ".join(f"'{it}'" for it in y_items[:3])
            more = f" and {len(y_items) - 3} more" if len(y_items) > 3 else ""
            tip_note = f"Tip: You have unfinished task(s) from yesterday ({sample}{more}). Say 'roll over yesterday's tasks' to bring them into today's list!"

    return canonical_name, display_title, tip_note


def _normalize_list_name(name: Optional[str], date_str: Optional[str] = None) -> str:
    clean_name, _, _ = _resolve_list_and_date(name, date_str=date_str)
    return clean_name


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


def format_list(
    list_name: str,
    include_completed: bool = False,
    display_title: Optional[str] = None,
    note: Optional[str] = None
) -> str:
    """Formats a human-readable checklist with numbers and status boxes."""
    clean_name = _normalize_list_name(list_name)
    items = get_list_items(clean_name, include_completed=include_completed)

    if not display_title:
        display_title = _format_list_display_name(clean_name)

    if not items:
        if include_completed:
            base_empty = f"Your {display_title} is currently empty."
        else:
            base_empty = f"No pending items in your {display_title}! (All done or empty)."
        if note:
            return f"{base_empty}\n\n{note}"
        return base_empty

    lines = [f"{display_title} ({len(items)} items):"]

    for idx, it in enumerate(items, 1):
        box = "[x]" if it["status"] == "completed" else "[ ]"
        qty_str = f" ({it['quantity']})" if it.get("quantity") else ""
        lines.append(f"{box} {idx}. {it['item']}{qty_str}")

    if note:
        lines.append(f"\n{note}")

    return "\n".join(lines)


def get_all_lists_summary() -> str:
    """Returns an overview of all active lists, separating daily to-dos and general lists."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT list_name,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
           COUNT(*) as total_count
    FROM personal_lists
    GROUP BY list_name
    ORDER BY list_name DESC
    """)
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return "You don't have any active personal lists yet."

    daily_rows = []
    general_rows = []
    for r in rows:
        lname = r["list_name"]
        if lname.startswith("todo:") or lname == "to do today":
            daily_rows.append(r)
        else:
            general_rows.append(r)

    lines = ["Active Personal Lists:"]

    if daily_rows:
        lines.append("\nDaily To-Do Agendas:")
        for r in daily_rows[:6]:
            p = r["pending_count"] or 0
            c = r["completed_count"] or 0
            d_name = _format_list_display_name(r["list_name"])
            lines.append(f"  - {d_name}: {p} pending" + (f", {c} completed" if c > 0 else ""))
        if len(daily_rows) > 6:
            lines.append(f"  - ... ({len(daily_rows) - 6} earlier daily to-do lists archived)")

    if general_rows:
        lines.append("\nEveryday Lists:")
        for r in general_rows:
            p = r["pending_count"] or 0
            c = r["completed_count"] or 0
            lines.append(f"  - {r['list_name'].capitalize()}: {p} pending" + (f", {c} completed" if c > 0 else ""))

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


@_write_locked
def clear_entire_list(list_name: str) -> str:
    """Removes all items (both pending and completed) from a list."""
    clean_name = _normalize_list_name(list_name)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM personal_lists WHERE list_name = ?", (clean_name,))
    count = cursor.rowcount
    conn.commit()
    conn.close()

    if count > 0:
        return f"Cleared all {count} item(s) from '{clean_name}'. The list is now empty."
    return f"List '{clean_name}' is already empty."


@_write_locked
def rollover_tasks(target_date: Optional[str] = None, ref_dt: Optional[datetime.datetime] = None) -> str:
    """
    Rolls over (moves) pending tasks from the most recent active date into the target date's to-do list.
    """
    ref_dt = ref_dt or datetime.datetime.now()
    target_d, _ = _parse_target_date(target_date, ref_dt=ref_dt)
    target_key = f"todo:{target_d.isoformat()}"

    conn = get_connection()
    cursor = conn.cursor()

    # Find the most recent date-based list before target_d with pending items
    cursor.execute("""
    SELECT DISTINCT list_name
    FROM personal_lists
    WHERE list_name LIKE 'todo:%' AND list_name < ? AND status = 'pending'
    ORDER BY list_name DESC
    LIMIT 1
    """, (target_key,))
    row = cursor.fetchone()
    source_key = row[0] if row else None

    # Fallback to legacy 'to do today' if no todo:YYYY-MM-DD has pending items
    if not source_key:
        cursor.execute("SELECT COUNT(*) FROM personal_lists WHERE list_name = 'to do today' AND status = 'pending'")
        leg_count = cursor.fetchone()[0] or 0
        if leg_count > 0:
            source_key = "to do today"

    if not source_key:
        conn.close()
        return f"No pending tasks found from yesterday or previous days to roll over into {target_d.strftime('%A, %b %d')}."

    cursor.execute("SELECT id, item, quantity FROM personal_lists WHERE list_name = ? AND status = 'pending'", (source_key,))
    pending_items = cursor.fetchall()

    if not pending_items:
        conn.close()
        return f"No pending tasks found in '{source_key}' to roll over."

    source_label = source_key[5:] if source_key.startswith("todo:") else source_key
    try:
        source_d = datetime.date.fromisoformat(source_label)
        source_display = source_d.strftime("%b %d")
    except Exception:
        source_display = source_label

    rollover_tag = f"Rolled over from {source_display}"

    now = _now()
    moved_names = []
    for row in pending_items:
        item_id, item_text, qty = row[0], row[1], row[2]
        new_qty = f"{qty} • {rollover_tag}" if qty else rollover_tag
        cursor.execute("SELECT id FROM personal_lists WHERE list_name = ? AND LOWER(item) = ? AND status = 'pending'", (target_key, item_text.strip().lower()))
        existing = cursor.fetchone()
        if existing:
            cursor.execute("DELETE FROM personal_lists WHERE id = ?", (item_id,))
        else:
            cursor.execute("UPDATE personal_lists SET list_name = ?, quantity = ?, updated_at = ? WHERE id = ?", (target_key, new_qty, now, item_id))
        moved_names.append(item_text)

    conn.commit()
    conn.close()

    moved_str = ", ".join(f"'{i}'" for i in moved_names)
    return f"Rolled over {len(moved_names)} pending task(s) from {source_label} to {target_d.strftime('%A, %b %d')}: {moved_str}."


def export_list_to_markdown(list_name: str, target_path: Optional[str] = None, display_title: Optional[str] = None) -> str:
    """Exports a list to a Markdown file on the user's Desktop or custom path."""
    clean_name = _normalize_list_name(list_name)
    items = get_list_items(clean_name, include_completed=True)
    if not items:
        return f"List '{clean_name}' is empty. Nothing to export."

    title = display_title or _format_list_display_name(clean_name)
    if not target_path:
        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        clean_file_title = re.sub(r'[^a-zA-Z0-9_\-]', '_', clean_name)
        target_path = os.path.join(desktop, f"{clean_file_title}_List.md")

    lines = [f"# {title}", ""]
    for it in items:
        box = "- [x]" if it["status"] == "completed" else "- [ ]"
        qty = f" ({it['quantity']})" if it.get("quantity") else ""
        lines.append(f"{box} {it['item']}{qty}")

    try:
        with open(target_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        return f"Successfully exported '{title}' to: {target_path}"
    except Exception as e:
        return f"Failed to export list to markdown: {e}"


def manage_personal_list(
    action: str = "show",
    list_name: Optional[str] = None,
    items: Optional[Union[str, List[str]]] = None,
    include_completed: bool = False,
    quantity: Optional[str] = None,
    target_path: Optional[str] = None,
    item: Optional[str] = None,
    clear_old: bool = False,
    date: Optional[str] = None,
) -> str:
    """
    Main dispatcher for personal lists (daily to-dos with date intelligence, shopping lists, errands, wishlists).
    """
    action = (action or "show").lower().strip()

    if not items and item:
        items = item

    if action in ("replace", "new_list"):
        clear_old = True
        action = "add"

    if action in ("rollover", "carryover", "carry_over", "roll_over"):
        return rollover_tasks(target_date=date)

    if action in ("lists", "all", "overview", "show_all"):
        return get_all_lists_summary()

    if not list_name and not date:
        if action in ("show", "list", "view"):
            return get_all_lists_summary()

    clean_name, display_title, context_note = _resolve_list_and_date(list_name, date_str=date, action=action)

    if action in ("add", "create", "append", "new", "put"):
        if not items and not clear_old:
            return "Please provide the item(s) you would like to add."
        res = add_to_list(clean_name, items or [], quantity=quantity, clear_old=clear_old)
        msg = res["message"]
        if context_note:
            msg += f" {context_note}"
        return msg

    if action in ("show", "list", "view", "get", "display"):
        return format_list(clean_name, include_completed=include_completed, display_title=display_title, note=context_note)

    if action in ("check", "complete", "done", "finish", "mark"):
        if not items:
            return "Please specify which item(s) to check off."
        res = check_items(clean_name, items, completed=True)
        if context_note:
            res += f"\n{context_note}"
        return res

    if action in ("uncheck", "reopen", "undo"):
        if not items:
            return "Please specify which item(s) to reopen."
        return check_items(clean_name, items, completed=False)

    if action in ("remove", "delete", "drop", "rm"):
        if not items:
            return "Please specify which item(s) to remove."
        return remove_items(clean_name, items)

    if action in ("clear", "empty", "clear_all", "delete_list", "reset") or (action == "clear_completed" and clear_old):
        return clear_entire_list(clean_name)

    if action in ("clear_completed", "cleanup", "purge", "clear_done"):
        return clear_completed_items(clean_name)

    if action in ("export", "save", "write_md"):
        return export_list_to_markdown(clean_name, target_path=target_path, display_title=display_title)

    return f"Unknown action '{action}'. Valid actions: add, show, check, uncheck, remove, clear, clear_completed, rollover, lists, export."
