import os
import sqlite3
import time
import re
import json
from typing import List, Dict, Any, Optional
from pathlib import Path
from app import config
from anyascii import anyascii
import pypinyin

DB_PATH = Path(config.BASE_DIR) / "yuki_files.db"

# Category alias mapping: jarvis/prompt-facing names -> DB category values.
CATEGORY_ALIASES = {
    "video": ["video"],
    "videos": ["video"],
    "movie": ["video"],
    "movies": ["video"],
    "film": ["video"],
    "audio": ["song"],
    "audios": ["song"],
    "songs": ["song"],
    "song": ["song"],
    "music": ["song"],
    "image": ["photo"],
    "images": ["photo"],
    "photo": ["photo"],
    "photos": ["photo"],
    "picture": ["photo"],
    "pictures": ["photo"],
    "document": ["document"],
    "documents": ["document"],
    "docs": ["document"],
    "executable": ["program"],
    "executables": ["program"],
    "program": ["program"],
    "programs": ["program"],
    "apps": ["program"],
    "code": ["code"],
    "archive": ["archive"],
    "archives": ["archive"],
    "zip": ["archive"],
    "other": ["other"],
}

def resolve_categories(categories) -> List[str]:
    """
    Maps friendly category names (e.g. 'video', 'audio', 'image', 'code') to the
    actual DB category values ('video', 'song', 'photo', 'code'). Unknown names
    are passed through unchanged.
    """
    resolved: List[str] = []
    seen: set = set()
    for c in categories or []:
        c = str(c).strip().lower()
        if not c:
            continue
        for target in CATEGORY_ALIASES.get(c, [c]):
            if target not in seen:
                seen.add(target)
                resolved.append(target)
    return resolved

# Lazy-initialized pykakasi instance (deferred to avoid ~15 MB RAM cost on import)
_kks_instance = None

# Path of the last fully-initialized database (re-entrancy guard so repeated
# init_db() calls at startup are no-ops).
_DB_INITIALIZED_PATH = None

def _get_kks():
    global _kks_instance
    if _kks_instance is None:
        import pykakasi
        _kks_instance = pykakasi.kakasi()
    return _kks_instance

def transliterate_text(text: str) -> str:
    """
    Transliterates foreign scripts (Japanese, Chinese, Hindi Devanagari) to English equivalents.
    Concatenates Romaji and Pinyin for CJK characters to handle ambiguity.
    """
    if not text:
        return ""
    # Check if text is pure ASCII
    if all(ord(c) < 128 for c in text):
        return text

    # Identify scripts present in the text
    has_japanese_kana = any(
        (0x3040 <= ord(c) <= 0x309F) or (0x30A0 <= ord(c) <= 0x30FF)
        for c in text
    )
    has_cjk = any(
        (0x4E00 <= ord(c) <= 0x9FFF)
        for c in text
    )
    
    translit_parts = []
    
    # 1. Handle CJK characters (Chinese characters & Japanese Kanji)
    if has_cjk or has_japanese_kana:
        # Get Japanese Romaji
        try:
            res_kakasi = _get_kks().convert(text)
            romaji = " ".join(item['hepburn'] for item in res_kakasi)
            romaji_clean = " ".join(romaji.split())
            if romaji_clean and romaji_clean.lower() != text.lower():
                translit_parts.append(romaji_clean)
        except Exception:
            pass
            
        # Get Chinese Pinyin
        try:
            pinyin_list = pypinyin.lazy_pinyin(text)
            pinyin_clean = "".join(pinyin_list)
            if pinyin_clean and pinyin_clean.lower() != text.lower():
                translit_parts.append(pinyin_clean)
        except Exception:
            pass

    # 2. Handle other non-ASCII characters (e.g. Devanagari, Cyrillic, Greek, etc.)
    try:
        ascii_fallback = anyascii(text)
        if ascii_fallback and ascii_fallback.lower() != text.lower() and ascii_fallback not in translit_parts:
            translit_parts.append(ascii_fallback)
    except Exception:
        pass
        
    # Return all unique transliterated parts joined together
    seen = set()
    unique_parts = []
    for part in translit_parts:
        part_lower = part.lower()
        if part_lower not in seen:
            seen.add(part_lower)
            unique_parts.append(part)
            
    return " ".join(unique_parts)


def get_clean_parent_folder(file_path: str) -> str:
    """
    Extracts a cleaned representation of the folder path containing the file.
    E.g. "C:\\anime\\yuki no sora\\ep1.mp4" -> "anime yuki no sora"
    """
    try:
        dir_path = os.path.dirname(file_path)
        drive, path_tail = os.path.splitdrive(dir_path)
        parts = []
        for part in re.split(r'[\\/]', path_tail):
            part = part.strip()
            if part and part.lower() not in ('users', 'all users', 'desktop', 'documents', 'downloads', 'music', 'pictures', 'videos'):
                parts.append(part)
        return " ".join(parts)
    except Exception:
        return ""

def get_connection():
    """
    Returns a thread-safe connection to the SQLite database.
    Enforces foreign keys support.
    """
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON;")
    # Set journal mode to WAL for concurrent read/write performance
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.row_factory = sqlite3.Row
    return conn

def _fts_needs_migration(cursor) -> bool:
    """
    Detect if files_fts needs to be dropped and recreated.
    Returns True if the table is missing, content-synced, or lacks required columns.
    """
    required_fts = {"file_id", "file_name", "parent_folder", "category",
                    "title", "artist_or_creator", "genre_or_tags", "alternate_titles"}

    # Check 1: Does the table exist at all?
    row = cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='files_fts'").fetchone()
    if not row or not row[0]:
        print("[DB] FTS5: files_fts does not exist - will create.")
        return True

    create_sql = row[0]

    # Check 2: Is it content-synced? (old schema used content='file_metadata')
    if "content=" in create_sql.lower():
        print("[DB] FTS5: files_fts is content-synced - will recreate as standalone.")
        return True

    # Check 3: Does it have all required columns?
    try:
        fts_cols = {r[1] for r in cursor.execute("PRAGMA table_info(files_fts)").fetchall()}
        missing = required_fts - fts_cols
        if missing:
            print(f"[DB] FTS5: files_fts missing columns {missing} - will recreate.")
            return True
    except Exception:
        print("[DB] FTS5: PRAGMA table_info failed - will recreate.")
        return True

    return False


def _drop_all_triggers(cursor):
    """Drop every trigger we create so they can be recreated with correct definitions."""
    for name in ("files_ai", "files_ad", "files_au", "file_metadata_ai", "file_metadata_au"):
        cursor.execute(f"DROP TRIGGER IF EXISTS {name}")


def _create_triggers(cursor):
    """Create (or replace) all FTS sync triggers."""
    _drop_all_triggers(cursor)

    cursor.execute("""
    CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(file_id, file_name, parent_folder, category)
        VALUES (new.id, new.file_name, new.parent_folder, new.category);
    END;
    """)
    cursor.execute("""
    CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
        DELETE FROM files_fts WHERE file_id = old.id;
    END;
    """)
    cursor.execute("""
    CREATE TRIGGER files_au AFTER UPDATE ON files BEGIN
        UPDATE files_fts SET
            file_name = new.file_name,
            parent_folder = new.parent_folder,
            category = new.category
        WHERE file_id = new.id;
    END;
    """)
    cursor.execute("""
    CREATE TRIGGER file_metadata_ai AFTER INSERT ON file_metadata BEGIN
        UPDATE files_fts SET
            title = new.title,
            artist_or_creator = new.artist_or_creator,
            genre_or_tags = new.genre_or_tags,
            alternate_titles = new.alternate_titles
        WHERE file_id = new.file_id;
    END;
    """)
    cursor.execute("""
    CREATE TRIGGER file_metadata_au AFTER UPDATE ON file_metadata BEGIN
        UPDATE files_fts SET
            title = new.title,
            artist_or_creator = new.artist_or_creator,
            genre_or_tags = new.genre_or_tags,
            alternate_titles = new.alternate_titles
        WHERE file_id = new.file_id;
    END;
    """)


def _rebuild_fts_index(cursor):
    """Rebuild the FTS5 index from files + file_metadata."""
    try:
        cursor.execute("""
        INSERT INTO files_fts(file_id, file_name, parent_folder, category,
                              title, artist_or_creator, genre_or_tags, alternate_titles)
        SELECT f.id, f.file_name, f.parent_folder, f.category,
               m.title, m.artist_or_creator, m.genre_or_tags, m.alternate_titles
        FROM files f
        LEFT JOIN file_metadata m ON f.id = m.file_id
        """)
        print(f"[DB] FTS5: Rebuilt index for {cursor.rowcount} files.")
    except Exception as e:
        print(f"[DB] FTS5: Error rebuilding index: {e}")


def init_db():
    """
    Initializes database schema and triggers for automated FTS5 indexing.
    Handles migration from old schemas (content-synced FTS5, old file_metadata with id PK,
    old directories with dir_path, etc.) by detecting and recreating as needed.
    No-op if this database path was already initialized in this process.
    """
    global _DB_INITIALIZED_PATH
    if _DB_INITIALIZED_PATH == str(DB_PATH):
        return
    conn = get_connection()
    cursor = conn.cursor()

    # ── Phase 1: Migrate table schemas ──────────────────────────────────

    # 1a. Directories: if old schema has 'dir_path' instead of 'path', drop it
    try:
        dir_cols = {r[1] for r in cursor.execute("PRAGMA table_info(directories)").fetchall()}
        if dir_cols and "path" not in dir_cols:
            print("[DB] Migrating: Recreating directories table (dir_path -> path)...")
            cursor.execute("DROP TABLE IF EXISTS directories;")
    except Exception:
        pass

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS directories (
        path TEXT PRIMARY KEY,
        last_modified REAL,
        change_count INTEGER DEFAULT 0
    );
    """)

    # 1b. Files: drop everything and recreate if parent_folder is missing (ancient schema)
    try:
        columns = [row[1] for row in cursor.execute("PRAGMA table_info(files)").fetchall()]
        if columns and "parent_folder" not in columns:
            print("[DB] Migrating: Ancient files schema - dropping FTS/triggers/tables for full rebuild...")
            cursor.execute("DROP TABLE IF EXISTS files_fts;")
            _drop_all_triggers(cursor)
            cursor.execute("DROP TABLE IF EXISTS files;")
            cursor.execute("DROP TABLE IF EXISTS file_metadata;")
            cursor.execute("DROP TABLE IF EXISTS directories;")
            cursor.execute("""
            CREATE TABLE directories (
                path TEXT PRIMARY KEY,
                last_modified REAL,
                change_count INTEGER DEFAULT 0
            );
            """)
    except Exception as e:
        print(f"[DB] Error checking files schema: {e}")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE,
        file_name TEXT,
        parent_folder TEXT,
        extension TEXT,
        size INTEGER,
        last_modified REAL,
        category TEXT,
        indexed_at REAL,
        transliterated_name TEXT,
        transliterated_parent_folder TEXT
    );
    """)

    # Add transliterated columns if missing
    try:
        cols = [row[1] for row in cursor.execute("PRAGMA table_info(files)").fetchall()]
        if cols:
            if "transliterated_name" not in cols:
                print("[DB] Migrating: Adding transliterated_name column to files...")
                cursor.execute("ALTER TABLE files ADD COLUMN transliterated_name TEXT;")
            if "transliterated_parent_folder" not in cols:
                print("[DB] Migrating: Adding transliterated_parent_folder column to files...")
                cursor.execute("ALTER TABLE files ADD COLUMN transliterated_parent_folder TEXT;")
    except Exception as e:
        print(f"[DB] Error adding transliterated columns: {e}")

    # 1c. File Metadata: if old schema has 'id' column, drop + recreate
    #     IMPORTANT: drop FTS5 and triggers FIRST to avoid broken content-sync references
    try:
        meta_cols = {r[1] for r in cursor.execute("PRAGMA table_info(file_metadata)").fetchall()}
        if meta_cols and "id" in meta_cols:
            print("[DB] Migrating: file_metadata has old 'id' PK - dropping FTS/triggers, recreating...")
            # Drop FTS and triggers FIRST (they may reference old file_metadata)
            cursor.execute("DROP TABLE IF EXISTS files_fts;")
            _drop_all_triggers(cursor)
            # Preserve existing metadata
            old_meta = {}
            try:
                for row in cursor.execute("SELECT file_id, title, artist_or_creator, genre_or_tags, release_year, alternate_titles, enriched FROM file_metadata"):
                    old_meta[row[0]] = dict(row)
            except Exception:
                pass
            cursor.execute("DROP TABLE IF EXISTS file_metadata;")
            cursor.execute("""
            CREATE TABLE file_metadata (
                file_id INTEGER PRIMARY KEY,
                title TEXT,
                artist_or_creator TEXT,
                genre_or_tags TEXT,
                release_year INTEGER,
                alternate_titles TEXT,
                enriched INTEGER DEFAULT 0,
                FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
            );
            """)
            if old_meta:
                for fid, m in old_meta.items():
                    cursor.execute("""
                    INSERT OR REPLACE INTO file_metadata (file_id, title, artist_or_creator, genre_or_tags, release_year, alternate_titles, enriched)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (fid, m.get("title"), m.get("artist_or_creator"), m.get("genre_or_tags"),
                          m.get("release_year"), m.get("alternate_titles"), m.get("enriched", 0)))
                print(f"[DB] Restored {len(old_meta)} metadata records.")
    except Exception as e:
        print(f"[DB] Error migrating file_metadata: {e}")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS file_metadata (
        file_id INTEGER PRIMARY KEY,
        title TEXT,
        artist_or_creator TEXT,
        genre_or_tags TEXT,
        release_year INTEGER,
        alternate_titles TEXT,
        enriched INTEGER DEFAULT 0,
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
    );
    """)

    # 1d. Time Management: Reminders, Timers, Alarms & Stopwatches
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at REAL,
        target_time REAL,
        message TEXT,
        category TEXT DEFAULT 'timer',
        recurrence TEXT,
        action_command TEXT,
        is_completed INTEGER DEFAULT 0,
        os_task_name TEXT
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stopwatches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT UNIQUE,
        started_at REAL,
        is_active INTEGER DEFAULT 1
    );
    """)

    # 1d2. Persistent Agent TODO List (tasks & subtasks)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER,
        title TEXT,
        status TEXT DEFAULT 'pending',
        priority TEXT DEFAULT 'normal',
        position INTEGER DEFAULT 0,
        session_id TEXT,
        created_at REAL,
        updated_at REAL
    );
    """)

    # Migration check for block_reason / archived columns on todos
    todo_cols = [row[1] for row in cursor.execute("PRAGMA table_info(todos)").fetchall()]
    if "block_reason" not in todo_cols:
        cursor.execute("ALTER TABLE todos ADD COLUMN block_reason TEXT")
    if "archived" not in todo_cols:
        cursor.execute("ALTER TABLE todos ADD COLUMN archived INTEGER DEFAULT 0")

    # 1e. Persistent Chat Sessions & Message History
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chat_sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT,
        created_at REAL,
        updated_at REAL,
        year INTEGER,
        month_name TEXT,
        date_str TEXT,
        pruned_context TEXT
    );
    """)

    # Migration check for pruned_context column if table already exists
    cursor.execute("PRAGMA table_info(chat_sessions);")
    cols = [col[1] for col in cursor.fetchall()]
    if 'pruned_context' not in cols:
        cursor.execute("ALTER TABLE chat_sessions ADD COLUMN pruned_context TEXT;")

    # Migration: add status column (default 'complete'; 'incomplete' = recovered/crashed temp turns)
    if 'status' not in cols:
        cursor.execute("ALTER TABLE chat_sessions ADD COLUMN status TEXT;")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        role TEXT,
        content TEXT,
        timestamp REAL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions (session_id) ON DELETE CASCADE
    );
    """)

    # Migration: add attachments column to chat_messages if missing
    chat_msg_cols = [col[1] for col in cursor.execute("PRAGMA table_info(chat_messages)").fetchall()]
    if "attachments" not in chat_msg_cols:
        cursor.execute("ALTER TABLE chat_messages ADD COLUMN attachments TEXT;")

    # Migration: add os_task_name column if it doesn't exist yet
    existing_cols = [row[1] for row in cursor.execute("PRAGMA table_info(reminders)").fetchall()]
    if "os_task_name" not in existing_cols:
        cursor.execute("ALTER TABLE reminders ADD COLUMN os_task_name TEXT")

    # 1f. Session Metadata (Per-session Custom Facts & Workspace Directories)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS session_metadata (
        session_id TEXT NOT NULL,
        meta_type TEXT NOT NULL,
        meta_key TEXT NOT NULL,
        meta_value TEXT NOT NULL,
        created_at REAL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (session_id, meta_type, meta_key)
    );
    """)

    # ── Phase 2: FTS5 Virtual Table ─────────────────────────────────────

    if _fts_needs_migration(cursor):
        cursor.execute("DROP TABLE IF EXISTS files_fts;")
        cursor.execute("""
        CREATE VIRTUAL TABLE files_fts USING fts5(
            file_id UNINDEXED,
            file_name,
            parent_folder,
            category,
            title,
            artist_or_creator,
            genre_or_tags,
            alternate_titles,
            tokenize='unicode61'
        );
        """)
        _rebuild_fts_index(cursor)
    else:
        # Table exists with correct schema - ensure it exists (defensive)
        cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            file_id UNINDEXED,
            file_name,
            parent_folder,
            category,
            title,
            artist_or_creator,
            genre_or_tags,
            alternate_titles,
            tokenize='unicode61'
        );
        """)

    # ── Phase 3: Triggers (always recreate to fix stale definitions) ────

    _create_triggers(cursor)

    # ── Phase 3b: Category rename migration (movie -> video) ─────────────
    # AFTER UPDATE trigger on files keeps files_fts.category in sync.
    try:
        cursor.execute("UPDATE files SET category = 'video' WHERE category = 'movie';")
        if cursor.rowcount:
            print(f"[DB] Migrating: Renamed {cursor.rowcount} file(s) from category 'movie' to 'video'.")
    except Exception as e:
        print(f"[DB] Error during movie->video category migration: {e}")

    # ── Phase 4: Crawler State Table ────────────────────────────────────

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS crawler_state (
        key TEXT PRIMARY KEY,
        val TEXT
    );
    """)

    # One-time migration: rename 'value' column to 'val' if needed
    try:
        cols = [row[1] for row in cursor.execute("PRAGMA table_info(crawler_state)").fetchall()]
        if "value" in cols and "val" not in cols:
            print("[DB] Migrating: Renaming crawler_state.value to val...")
            cursor.execute("ALTER TABLE crawler_state RENAME COLUMN value TO val;")
    except Exception as e:
        print(f"[DB] Error migrating crawler_state column: {e}")

    # ── Phase 5: One-time data migrations ───────────────────────────────

    # Populate transliterated names for existing files
    try:
        null_count = cursor.execute("SELECT COUNT(*) FROM files WHERE transliterated_name IS NULL").fetchone()[0]
        if null_count > 0:
            print(f"[DB] Transliterating {null_count} existing files...")
            rows = cursor.execute("SELECT id, file_name, parent_folder FROM files WHERE transliterated_name IS NULL").fetchall()
            updates = [(transliterate_text(r[1] or ""), transliterate_text(r[2] or ""), r[0]) for r in rows]
            if updates:
                cursor.executemany("UPDATE files SET transliterated_name=?, transliterated_parent_folder=? WHERE id=?", updates)
                conn.commit()
                print(f"[DB] Transliterated {len(updates)} files.")
    except Exception as e:
        print(f"[DB] Error running transliteration migration: {e}")

    # Reset enriched status for songs with empty genres to trigger MusicBrainz lookup
    try:
        cursor.execute("""
        UPDATE file_metadata
        SET enriched = 0
        WHERE enriched = 1
          AND (genre_or_tags IS NULL OR genre_or_tags = '')
          AND file_id IN (SELECT id FROM files WHERE category = 'song')
        """)
        changes = cursor.rowcount
        conn.commit()
        if changes > 0:
            print(f"[DB] Reset enriched status for {changes} song(s) with empty genres.")
    except Exception as e:
        print(f"[DB] Error resetting empty genre song flags: {e}")

    conn.commit()
    conn.close()
    _DB_INITIALIZED_PATH = str(DB_PATH)
    print(f"[DB] Initialized database at '{DB_PATH}'")

def get_crawler_state(key: str) -> Optional[str]:
    conn = get_connection()
    row = conn.execute("SELECT val FROM crawler_state WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["val"] if row else None

def set_crawler_state(key: str, val: str):
    conn = get_connection()
    try:
        conn.execute("""
        INSERT INTO crawler_state (key, val)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET val = excluded.val
        """, (key, val))
        conn.commit()
    except Exception as e:
        print(f"[DB] Error setting crawler state '{key}': {e}")
    finally:
        conn.close()

# --- Directories CRUD ---

def get_directory(path: str, conn=None) -> Optional[Dict[str, Any]]:
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    try:
        row = conn.execute("SELECT * FROM directories WHERE path = ?", (path,)).fetchone()
        return dict(row) if row else None
    finally:
        if should_close:
            conn.close()

def get_hot_directories() -> List[str]:
    """
    Returns directories sorted by change frequency (change_count DESC).
    """
    conn = get_connection()
    rows = conn.execute("SELECT path FROM directories ORDER BY change_count DESC").fetchall()
    conn.close()
    return [row["path"] for row in rows]

def upsert_directory(path: str, last_modified: float, change_count_increment: int = 0, conn=None):
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    try:
        conn.execute("""
        INSERT INTO directories (path, last_modified, change_count)
        VALUES (?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            last_modified = excluded.last_modified,
            change_count = change_count + ?
        """, (path, last_modified, change_count_increment, change_count_increment))
        if should_close:
            conn.commit()
    except Exception as e:
        print(f"[DB] Error upserting directory '{path}': {e}")
    finally:
        if should_close:
            conn.close()

# --- Files CRUD ---

def get_file_by_path(file_path: str, conn=None) -> Optional[Dict[str, Any]]:
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    try:
        row = conn.execute("SELECT * FROM files WHERE file_path = ?", (file_path,)).fetchone()
        return dict(row) if row else None
    finally:
        if should_close:
            conn.close()

def get_all_indexed_file_paths() -> List[str]:
    conn = get_connection()
    rows = conn.execute("SELECT file_path FROM files").fetchall()
    conn.close()
    return [row["file_path"] for row in rows]

def upsert_file(file_path: str, file_name: str, parent_folder: str, extension: str, size: int, last_modified: float, category: str, conn=None) -> int:
    """
    Inserts a new file or updates file size/mtime if modified.
    Returns the file's ID.
    Supports older SQLite versions by falling back if RETURNING id is unsupported.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    cursor = conn.cursor()
    now = time.time()
    file_id = -1
    
    # Generate transliterated search strings
    trans_name = transliterate_text(file_name)
    trans_parent = transliterate_text(parent_folder)
    
    try:
        try:
            cursor.execute("""
            INSERT INTO files (file_path, file_name, parent_folder, extension, size, last_modified, category, indexed_at, transliterated_name, transliterated_parent_folder)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
                file_name = excluded.file_name,
                parent_folder = excluded.parent_folder,
                extension = excluded.extension,
                size = excluded.size,
                last_modified = excluded.last_modified,
                category = excluded.category,
                indexed_at = excluded.indexed_at,
                transliterated_name = excluded.transliterated_name,
                transliterated_parent_folder = excluded.transliterated_parent_folder
            RETURNING id
            """, (file_path, file_name, parent_folder, extension, size, last_modified, category, now, trans_name, trans_parent))
            row = cursor.fetchone()
            file_id = row[0] if row else cursor.lastrowid
        except sqlite3.OperationalError:
            # Fallback if RETURNING id is unsupported by user's SQLite version
            cursor.execute("""
            INSERT INTO files (file_path, file_name, parent_folder, extension, size, last_modified, category, indexed_at, transliterated_name, transliterated_parent_folder)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
                file_name = excluded.file_name,
                parent_folder = excluded.parent_folder,
                extension = excluded.extension,
                size = excluded.size,
                last_modified = excluded.last_modified,
                category = excluded.category,
                indexed_at = excluded.indexed_at,
                transliterated_name = excluded.transliterated_name,
                transliterated_parent_folder = excluded.transliterated_parent_folder
            """, (file_path, file_name, parent_folder, extension, size, last_modified, category, now, trans_name, trans_parent))
            cursor.execute("SELECT id FROM files WHERE file_path = ?", (file_path,))
            row = cursor.fetchone()
            file_id = row[0] if row else cursor.lastrowid
            
        if should_close:
            conn.commit()
        return file_id
    except Exception as e:
        print(f"[DB] Error upserting file '{file_path}': {e}")
        return -1
    finally:
        if should_close:
            conn.close()

def delete_files_by_paths(file_paths: List[str]):
    if not file_paths:
        return
    conn = get_connection()
    try:
        # Batch deletes to prevent hitting maximum parameter limits
        batch_size = 500
        for i in range(0, len(file_paths), batch_size):
            batch = file_paths[i:i+batch_size]
            placeholders = ",".join("?" for _ in batch)
            conn.execute(f"DELETE FROM files WHERE file_path IN ({placeholders})", batch)
        conn.commit()
    except Exception as e:
        print(f"[DB] Error deleting files: {e}")
    finally:
        conn.close()

# --- Metadata CRUD ---

def upsert_metadata(file_id: int, title: str, artist_or_creator: str, genre_or_tags: str, release_year: Optional[int], alternate_titles: str, enriched: int = 1, category: Optional[str] = None, conn=None):
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    try:
        conn.execute("""
        INSERT INTO file_metadata (file_id, title, artist_or_creator, genre_or_tags, release_year, alternate_titles, enriched)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET
            title = excluded.title,
            artist_or_creator = excluded.artist_or_creator,
            genre_or_tags = excluded.genre_or_tags,
            release_year = excluded.release_year,
            alternate_titles = excluded.alternate_titles,
            enriched = excluded.enriched
        """, (file_id, title, artist_or_creator, genre_or_tags, release_year, alternate_titles, enriched))
        
        if category:
            conn.execute("UPDATE files SET category = ? WHERE id = ?", (category, file_id))
            
        if should_close:
            conn.commit()
    except Exception as e:
        print(f"[DB] Error upserting metadata for file_id {file_id}: {e}")
    finally:
        if should_close:
            conn.close()

def get_unenriched_files(limit: int = 50) -> List[Dict[str, Any]]:
    """
    Returns files that have not been enriched with AI metadata.
    Specifically prioritizes audio/video categories.
    """
    conn = get_connection()
    query = """
    SELECT f.id, f.file_path, f.file_name, f.category 
    FROM files f
    LEFT JOIN file_metadata m ON f.id = m.file_id
    WHERE (m.enriched IS NULL OR m.enriched = 0)
      AND f.category IN ('video', 'song')
    LIMIT ?
    """
    rows = conn.execute(query, (limit,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]

# --- Search Interface ---

def search_files_fts(query: str, category_filter: Optional[str] = None, limit: int = 25) -> List[Dict[str, Any]]:
    """
    Runs full-text query matching using SQLite FTS5.
    If no matches are found, it falls back to a simple LIKE wildcard match.
    """
    conn = get_connection()
    results = []
    
    clean_query = query.strip()
    if not clean_query:
        conn.close()
        return []

    # Resolve friendly category names (e.g. 'video' or legacy 'movie') to DB values
    if category_filter:
        resolved_cats = resolve_categories([category_filter])
        category_filter = resolved_cats[0] if resolved_cats else None

    # Clean double quotes to prevent syntax errors in SQLite FTS query parser
    safe_query = clean_query.replace('"', '""')
    
    # We construct a match query: prefix searches for words, e.g. "linkin park" -> "linkin* park*"
    words = [w for w in safe_query.split() if w]
    if words:
        fts_query = " AND ".join(f'"{w}"*' for w in words)
    else:
        fts_query = f'"{safe_query}"*'

    category_clause = "AND f.category = ?" if category_filter else ""
    params = [fts_query]
    if category_filter:
        params.append(category_filter)
    params.append(limit)

    sql_fts = f"""
    SELECT f.id, f.file_path, f.file_name, f.parent_folder, f.category, f.size, f.last_modified,
           m.title, m.artist_or_creator, m.genre_or_tags, m.release_year, m.alternate_titles
    FROM files_fts fts
    JOIN files f ON fts.file_id = f.id
    LEFT JOIN file_metadata m ON f.id = m.file_id
    WHERE files_fts MATCH ? {category_clause}
    LIMIT ?
    """

    try:
        rows = conn.execute(sql_fts, params).fetchall()
        results = [dict(row) for row in rows]
    except Exception as e:
        print(f"[DB] FTS MATCH search failed: {e}. Falling back to LIKE.")

    # Fallback to standard LIKE queries if FTS fails or returns no results
    if not results:
        # Replace spaces with % to match underscores/hyphens interchangeably
        words_like = [w for w in clean_query.split() if w]
        like_query = f"%{'%'.join(words_like)}%" if words_like else f"%{clean_query}%"
        category_clause_like = "AND f.category = ?" if category_filter else ""
        
        sql_like = f"""
        SELECT f.id, f.file_path, f.file_name, f.parent_folder, f.category, f.size, f.last_modified,
               m.title, m.artist_or_creator, m.genre_or_tags, m.release_year, m.alternate_titles
        FROM files f
        LEFT JOIN file_metadata m ON f.id = m.file_id
        WHERE (f.file_name LIKE ? OR f.parent_folder LIKE ? OR m.title LIKE ? OR m.artist_or_creator LIKE ? OR m.alternate_titles LIKE ?) {category_clause_like}
        LIMIT ?
        """
        params_like = [like_query, like_query, like_query, like_query, like_query]
        if category_filter:
            params_like.append(category_filter)
        params_like.append(limit)
        
        try:
            rows = conn.execute(sql_like, params_like).fetchall()
            results = [dict(row) for row in rows]
        except Exception as e:
            print(f"[DB] Standard LIKE search failed: {e}")

    conn.close()
    return results

def get_search_candidates(keywords: List[str], limit: int = 100) -> List[Dict[str, Any]]:
    """
    Retrieves files that contain at least one of the primary keywords in their
    filename, parent folder, metadata title, or alternate titles.
    Used for custom Python relevance ranking and LLM mapping.
    """
    if not keywords:
        return []
    conn = get_connection()
    clauses = []
    params = []
    for kw in keywords:
        clauses.append("(f.file_name LIKE ? OR f.parent_folder LIKE ? OR m.title LIKE ? OR m.alternate_titles LIKE ?)")
        like_val = f"%{kw}%"
        params.extend([like_val, like_val, like_val, like_val])
        
    sql = f"""
    SELECT f.id, f.file_path, f.file_name, f.parent_folder, f.category, f.size, f.last_modified,
           m.title, m.artist_or_creator, m.genre_or_tags, m.release_year, m.alternate_titles
    FROM files f
    LEFT JOIN file_metadata m ON f.id = m.file_id
    WHERE {" OR ".join(clauses)}
    LIMIT ?
    """
    params.append(limit)
    try:
        rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        print(f"[DB] Error getting search candidates: {e}")
        return []
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Chat Session History CRUD & Title Generator
# ---------------------------------------------------------------------------

GENERIC_GREETINGS = {
    'hello', 'hi', 'hey', 'yo', 'sup', 'greetings', 'good morning', 
    'good afternoon', 'good evening', 'how are you', 'hows it going',
    'what is up', 'whats up', 'yuki', 'master'
}

def clean_prompt_for_title(text: str) -> str:
    if not text:
        return ""
    clean = re.sub(r'<(thought|think|reasoning)>[\s\S]*?(?:<\/\1>|$)', '', text, flags=re.IGNORECASE).strip()
    clean = re.sub(r'[^\w\s-]', '', clean)
    words = [w for w in clean.split() if w]
    filtered = [w for w in words if w.lower() not in GENERIC_GREETINGS]
    return " ".join(filtered)

def generate_session_title(messages: List[Dict[str, str]]) -> str:
    """
    Combines meaningful non-greeting terms from the first 3 user prompts.
    """
    user_prompts = []
    for msg in messages:
        if msg.get("role") == "user":
            c = clean_prompt_for_title(msg.get("content", ""))
            if c:
                user_prompts.append(c)
            if len(user_prompts) >= 3:
                break
    
    if not user_prompts:
        return "Chat Session"
    
    combined = " • ".join(user_prompts)
    if len(combined) > 60:
        return combined[:57] + "..."
    return combined.title()

def save_chat_session_if_eligible(session_id: str, messages: List[Dict[str, str]], pruned_context: Optional[List[Dict[str, str]]] = None, status: str = "complete"):
    """
    Saves or updates a chat session in SQLite ONLY IF len(messages) >= 2.
    Discards empty or 1-message orphan turns. Stores optional pruned_context JSON for LLM budget state.
    """
    if not session_id or not messages or len(messages) < 2:
        return
    
    now = time.time()
    t_struct = time.localtime(now)
    year = t_struct.tm_year
    month_name = time.strftime("%B %Y", t_struct)  # e.g. "July 2026"
    date_str = time.strftime("%d %B %Y", t_struct)  # e.g. "30 July 2026"
    
    title = generate_session_title(messages)
    pruned_json = json.dumps(pruned_context) if pruned_context else None
    
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO chat_sessions (session_id, title, created_at, updated_at, year, month_name, date_str, pruned_context, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            title = excluded.title,
            updated_at = excluded.updated_at,
            pruned_context = COALESCE(excluded.pruned_context, chat_sessions.pruned_context),
            status = excluded.status
        """, (session_id, title, now, now, year, month_name, date_str, pruned_json, status))
        
        cursor.execute("DELETE FROM chat_messages WHERE session_id = ?", (session_id,))
        msg_rows = []
        for m in messages:
            r = m.get("role", "user")
            c = str(m.get("content") or "").strip()
            if r == "tool":
                r = "user"
                tool_name = m.get("name", "Tool")
                c = f"[Previous Tool Result ({tool_name})]: {c}"
            if c:
                atts = m.get("attachments")
                atts_json = None
                if atts:
                    try:
                        atts_json = json.dumps(atts, ensure_ascii=False)
                    except Exception:
                        atts_json = None
                msg_rows.append((session_id, r, c, atts_json, now))

        cursor.executemany("""
        INSERT INTO chat_messages (session_id, role, content, attachments, timestamp)
        VALUES (?, ?, ?, ?, ?)
        """, msg_rows)
        
        conn.commit()
    except Exception as e:
        print(f"[DB] Error saving chat session '{session_id}': {e}")
    finally:
        conn.close()

def save_incomplete_turn(turn_id: str, messages: List[Dict[str, str]]):
    """
    Writes a crash-recovery checkpoint into a temp session `turn_<id>` with
    status='incomplete'. DELETE+INSERT makes each checkpoint idempotent.
    The real session's completed history is never touched.
    """
    if not turn_id or not messages:
        return
    session_id = f"turn_{turn_id}"
    now = time.time()
    t_struct = time.localtime(now)
    year = t_struct.tm_year
    month_name = time.strftime("%B %Y", t_struct)
    date_str = time.strftime("%d %B %Y", t_struct)

    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO chat_sessions (session_id, title, created_at, updated_at, year, month_name, date_str, pruned_context, status)
        VALUES (?, 'Recovered (crashed)', ?, ?, ?, ?, ?, NULL, 'incomplete')
        ON CONFLICT(session_id) DO UPDATE SET
            updated_at = excluded.updated_at,
            status = 'incomplete'
        """, (session_id, now, now, year, month_name, date_str))

        cursor.execute("DELETE FROM chat_messages WHERE session_id = ?", (session_id,))
        msg_rows = []
        for m in messages:
            r = m.get("role", "user")
            c = str(m.get("content") or "").strip()
            if r == "tool":
                r = "user"
                tool_name = m.get("name", "Tool")
                c = f"[Previous Tool Result ({tool_name})]: {c}"
            if c:
                atts = m.get("attachments")
                atts_json = None
                if atts:
                    try:
                        atts_json = json.dumps(atts, ensure_ascii=False)
                    except Exception:
                        atts_json = None
                msg_rows.append((session_id, r, c, atts_json, now))

        cursor.executemany("""
        INSERT INTO chat_messages (session_id, role, content, attachments, timestamp)
        VALUES (?, ?, ?, ?, ?)
        """, msg_rows)

        conn.commit()
    except Exception as e:
        print(f"[DB] Error saving incomplete turn '{turn_id}': {e}")
    finally:
        conn.close()


def delete_incomplete_turn(turn_id: str):
    """Removes the temp recovery session for a turn that completed normally."""
    if not turn_id:
        return
    session_id = f"turn_{turn_id}"
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM chat_messages WHERE session_id = ?", (session_id,))
        cursor.execute("DELETE FROM chat_sessions WHERE session_id = ?", (session_id,))
        conn.commit()
    except Exception as e:
        print(f"[DB] Error deleting incomplete turn '{turn_id}': {e}")
    finally:
        conn.close()


def get_session_pruned_context(session_id: str) -> Optional[List[Dict[str, str]]]:
    """
    Retrieves the serialized pruned LLM context JSON for a session if available.
    """
    if not session_id:
        return None
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT pruned_context FROM chat_sessions WHERE session_id = ?", (session_id,))
        row = cursor.fetchone()
        if row and row[0]:
            return json.loads(row[0])
    except Exception as e:
        print(f"[DB] Error reading pruned context for session '{session_id}': {e}")
    finally:
        conn.close()
    return None

def get_hierarchical_chat_sessions() -> Dict[str, Any]:
    """
    Returns sessions grouped hierarchically by Year -> Month -> Date.
    """
    conn = get_connection()
    try:
        rows = conn.execute("""
        SELECT session_id, title, created_at, updated_at, year, month_name, date_str, status
        FROM chat_sessions
        ORDER BY updated_at DESC
        """).fetchall()
        
        tree = {}
        for r in rows:
            yr = r["year"]
            mn = r["month_name"]
            ds = r["date_str"]
            
            if yr not in tree:
                tree[yr] = {}
            if mn not in tree[yr]:
                tree[yr][mn] = {}
            if ds not in tree[yr][mn]:
                tree[yr][mn][ds] = []
                
            tree[yr][mn][ds].append({
                "session_id": r["session_id"],
                "title": r["title"] or "Chat Session",
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
                "status": r["status"] or "complete"
            })
            
        result_years = []
        for yr in sorted(tree.keys(), reverse=True):
            months = []
            for mn in tree[yr]:
                dates = []
                for ds in tree[yr][mn]:
                    dates.append({
                        "date": ds,
                        "sessions": tree[yr][mn][ds]
                    })
                months.append({
                    "month": mn,
                    "dates": dates
                })
            result_years.append({
                "year": yr,
                "months": months
            })
            
        return {"years": result_years}
    except Exception as e:
        print(f"[DB] Error getting hierarchical chat sessions: {e}")
        return {"years": []}
    finally:
        conn.close()

def get_session_messages(session_id: str, limit: Optional[int] = None) -> List[Dict[str, str]]:
    conn = get_connection()
    try:
        if limit and isinstance(limit, int) and limit > 0:
            rows = conn.execute("""
            SELECT role, content, attachments FROM (
                SELECT id, role, content, attachments FROM chat_messages
                WHERE session_id = ?
                ORDER BY id DESC
                LIMIT ?
            ) ORDER BY id ASC
            """, (session_id, limit)).fetchall()
        else:
            rows = conn.execute("""
            SELECT role, content, attachments FROM chat_messages
            WHERE session_id = ?
            ORDER BY id ASC
            """, (session_id,)).fetchall()
        msgs = []
        for r in rows:
            msg = {"role": r["role"], "content": r["content"]}
            atts = r["attachments"]
            if atts:
                try:
                    parsed = json.loads(atts)
                    if isinstance(parsed, list) and len(parsed) > 0:
                        msg["attachments"] = parsed
                except Exception:
                    pass
            msgs.append(msg)
        return msgs
    except Exception as e:
        print(f"[DB] Error fetching messages for session '{session_id}': {e}")
        return []
    finally:
        conn.close()

def delete_chat_session(session_id: str):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM chat_sessions WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM session_metadata WHERE session_id = ?", (session_id,))
        conn.commit()
    except Exception as e:
        print(f"[DB] Error deleting session '{session_id}': {e}")
    finally:
        conn.close()


# ── Session Metadata Helpers (Facts & Workspace Directories) ─────────

def save_session_meta(session_id: str, meta_type: str, meta_key: str, meta_value: str):
    """
    Saves or updates a session metadata entry (meta_type: 'fact' | 'directory').
    """
    conn = get_connection()
    try:
        conn.execute("""
            INSERT OR REPLACE INTO session_metadata (session_id, meta_type, meta_key, meta_value, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (session_id, meta_type, meta_key, meta_value, time.time()))
        conn.commit()
    except Exception as e:
        print(f"[DB] Error saving session meta for '{session_id}': {e}")
    finally:
        conn.close()

def get_session_meta(session_id: str) -> Dict[str, List[Dict[str, str]]]:
    """
    Returns session metadata grouped into facts and directories.
    """
    conn = get_connection()
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT meta_type, meta_key, meta_value, created_at
            FROM session_metadata
            WHERE session_id = ?
            ORDER BY created_at ASC
        """, (session_id,)).fetchall()
        
        facts = []
        directories = []
        for r in rows:
            item = {"key": r["meta_key"], "value": r["meta_value"], "created_at": r["created_at"]}
            if r["meta_type"] == "fact":
                facts.append(item)
            elif r["meta_type"] == "directory":
                directories.append(item)
                
        return {"facts": facts, "directories": directories}
    except Exception as e:
        print(f"[DB] Error fetching session meta for '{session_id}': {e}")
        return {"facts": [], "directories": []}
    finally:
        conn.close()

def delete_session_meta(session_id: str, meta_type: str, meta_key: str):
    """
    Deletes a session metadata entry.
    """
    conn = get_connection()
    try:
        conn.execute("""
            DELETE FROM session_metadata
            WHERE session_id = ? AND meta_type = ? AND meta_key = ?
        """, (session_id, meta_type, meta_key))
        conn.commit()
    except Exception as e:
        print(f"[DB] Error deleting session meta for '{session_id}': {e}")
    finally:
        conn.close()


# ── Crawler Database Export & Import Helpers ──────────────────────────

def export_crawler_database_json() -> dict:
    import datetime
    conn = get_connection()
    try:
        conn.row_factory = sqlite3.Row
        dirs = [dict(r) for r in conn.execute("SELECT * FROM directories").fetchall()]
        files = [dict(r) for r in conn.execute("SELECT * FROM files").fetchall()]
        meta = [dict(r) for r in conn.execute("SELECT * FROM file_metadata").fetchall()]
        state = [dict(r) for r in conn.execute("SELECT * FROM crawler_state").fetchall()]
        
        return {
            "export_type": "crawler_data",
            "version": "1.0",
            "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "app": "Project Yuki",
            "stats": {
                "total_directories": len(dirs),
                "total_files": len(files),
                "total_metadata_records": len(meta)
            },
            "directories": dirs,
            "files": files,
            "file_metadata": meta,
            "crawler_state": state
        }
    except Exception as e:
        print(f"[DB] Error exporting crawler database: {e}")
        raise e
    finally:
        conn.close()

def import_crawler_database_json(data: dict) -> dict:
    if not isinstance(data, dict):
        raise ValueError("Invalid crawler data JSON payload")

    dirs = data.get("directories", [])
    files = data.get("files", [])
    meta = data.get("file_metadata", [])
    state = data.get("crawler_state", [])

    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN TRANSACTION;")

        # 1. Directories
        for d in dirs:
            if isinstance(d, dict) and "path" in d:
                cursor.execute("""
                INSERT OR REPLACE INTO directories (path, last_modified, change_count)
                VALUES (?, ?, ?)
                """, (d.get("path"), d.get("last_modified", time.time()), d.get("change_count", 0)))

        # 2. Files
        for f in files:
            if isinstance(f, dict) and "file_path" in f:
                cursor.execute("""
                INSERT OR REPLACE INTO files (id, file_path, file_name, parent_folder, extension, size, last_modified, category, indexed_at, transliterated_name, transliterated_parent_folder)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    f.get("id"),
                    f.get("file_path"),
                    f.get("file_name"),
                    f.get("parent_folder"),
                    f.get("extension"),
                    f.get("size", 0),
                    f.get("last_modified", time.time()),
                    f.get("category", "other"),
                    f.get("indexed_at", time.time()),
                    f.get("transliterated_name"),
                    f.get("transliterated_parent_folder")
                ))

        # 3. File Metadata
        for m in meta:
            if isinstance(m, dict) and "file_id" in m:
                cursor.execute("""
                INSERT OR REPLACE INTO file_metadata (file_id, title, artist_or_creator, genre_or_tags, release_year, alternate_titles, enriched)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    m.get("file_id"),
                    m.get("title"),
                    m.get("artist_or_creator"),
                    m.get("genre_or_tags"),
                    m.get("release_year"),
                    m.get("alternate_titles"),
                    m.get("enriched", 0)
                ))

        # 4. Crawler state
        for s in state:
            if isinstance(s, dict) and "key" in s:
                cursor.execute("""
                INSERT OR REPLACE INTO crawler_state (key, val)
                VALUES (?, ?)
                """, (s.get("key"), s.get("val")))

        conn.commit()

        # Rebuild FTS index
        try:
            _rebuild_fts_index(cursor)
            conn.commit()
        except Exception as fts_err:
            print(f"[DB] Warning: Rebuilding FTS index after import encountered error: {fts_err}")

        return {
            "directories_imported": len(dirs),
            "files_imported": len(files),
            "metadata_imported": len(meta),
            "state_imported": len(state)
        }
    except Exception as e:
        conn.rollback()
        print(f"[DB] Error importing crawler database: {e}")
        raise e
    finally:
        conn.close()



