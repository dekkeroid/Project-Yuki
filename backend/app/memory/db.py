import os
import sqlite3
import time
import re
from typing import List, Dict, Any, Optional
from pathlib import Path
from app import config
from anyascii import anyascii
import pykakasi
import pypinyin

DB_PATH = Path(config.BASE_DIR) / "yuki_files.db"

# Initialize pykakasi once
kks = pykakasi.kakasi()

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
            res_kakasi = kks.convert(text)
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

def init_db():
    """
    Initializes database schema and triggers for automated FTS5 indexing.
    Supports auto-migration by dropping and recreating tables when parent_folder is missing.
    """
    conn = get_connection()
    cursor = conn.cursor()

    # Migration Check
    try:
        cursor.execute("PRAGMA table_info(files);")
        columns = [row[1] for row in cursor.fetchall()]
        if columns and "parent_folder" not in columns:
            print("[DB] Migrating database: adding parent_folder column and recreating FTS table...")
            cursor.execute("DROP TABLE IF EXISTS files_fts;")
            cursor.execute("DROP TRIGGER IF EXISTS files_ai;")
            cursor.execute("DROP TRIGGER IF EXISTS files_ad;")
            cursor.execute("DROP TRIGGER IF EXISTS files_au;")
            cursor.execute("DROP TRIGGER IF EXISTS file_metadata_ai;")
            cursor.execute("DROP TRIGGER IF EXISTS file_metadata_au;")
            cursor.execute("DROP TABLE IF EXISTS files;")
            cursor.execute("DROP TABLE IF EXISTS file_metadata;")
            cursor.execute("DROP TABLE IF EXISTS directories;")
    except Exception as e:
        print(f"[DB] Error checking for migration: {e}")

    # 1. Directories Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS directories (
        path TEXT PRIMARY KEY,
        last_modified REAL,
        change_count INTEGER DEFAULT 0
    );
    """)

    # 2. Files Table
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

    # Migrate existing tables if they lack transliterated columns
    try:
        cursor.execute("PRAGMA table_info(files);")
        cols = [row[1] for row in cursor.fetchall()]
        if cols:
            if "transliterated_name" not in cols:
                print("[DB] Migrating: Adding transliterated_name column to files...")
                cursor.execute("ALTER TABLE files ADD COLUMN transliterated_name TEXT;")
            if "transliterated_parent_folder" not in cols:
                print("[DB] Migrating: Adding transliterated_parent_folder column to files...")
                cursor.execute("ALTER TABLE files ADD COLUMN transliterated_parent_folder TEXT;")
    except Exception as e:
        print(f"[DB] Error adding columns: {e}")

    # 3. File Metadata Table (artist, genres, release year)
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

    # 4. FTS5 Virtual Table for Instant Search
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

    # 5. Automated Triggers to sync files table insert/update/delete with FTS5
    cursor.execute("""
    CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(file_id, file_name, parent_folder, category)
        VALUES (new.id, new.file_name, new.parent_folder, new.category);
    END;
    """)

    cursor.execute("""
    CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
        DELETE FROM files_fts WHERE file_id = old.id;
    END;
    """)

    cursor.execute("""
    CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
        UPDATE files_fts SET 
            file_name = new.file_name, 
            parent_folder = new.parent_folder, 
            category = new.category 
        WHERE file_id = new.id;
    END;
    """)

    # 6. Automated Triggers to sync file_metadata inserts/updates with FTS5
    cursor.execute("""
    CREATE TRIGGER IF NOT EXISTS file_metadata_ai AFTER INSERT ON file_metadata BEGIN
        UPDATE files_fts SET 
            title = new.title, 
            artist_or_creator = new.artist_or_creator, 
            genre_or_tags = new.genre_or_tags, 
            alternate_titles = new.alternate_titles 
        WHERE file_id = new.file_id;
    END;
    """)

    cursor.execute("""
    CREATE TRIGGER IF NOT EXISTS file_metadata_au AFTER UPDATE ON file_metadata BEGIN
        UPDATE files_fts SET 
            title = new.title, 
            artist_or_creator = new.artist_or_creator, 
            genre_or_tags = new.genre_or_tags, 
            alternate_titles = new.alternate_titles 
        WHERE file_id = new.file_id;
    END;
    """)

    # 7. Crawler State Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS crawler_state (
        key TEXT PRIMARY KEY,
        val TEXT
    );
    """)

    # One-time migration: rename 'value' column to 'val' if needed
    try:
        cursor.execute("PRAGMA table_info(crawler_state);")
        cols = [row[1] for row in cursor.fetchall()]
        if "value" in cols and "val" not in cols:
            print("[DB] Migrating: Renaming crawler_state.value to val...")
            cursor.execute("ALTER TABLE crawler_state RENAME COLUMN value TO val;")
    except Exception as e:
        print(f"[DB] Error migrating crawler_state column: {e}")

    # One-time migration to populate transliterated names for existing files
    try:
        cursor.execute("SELECT COUNT(*) FROM files WHERE transliterated_name IS NULL")
        null_count = cursor.fetchone()[0]
        if null_count > 0:
            print(f"[DB] One-time migration: Transliterating {null_count} existing files...")
            cursor.execute("SELECT id, file_name, parent_folder FROM files WHERE transliterated_name IS NULL")
            rows = cursor.fetchall()
            
            updates = []
            for row in rows:
                row_id, file_name, parent_folder = row
                trans_name = transliterate_text(file_name or "")
                trans_parent = transliterate_text(parent_folder or "")
                updates.append((trans_name, trans_parent, row_id))
                
            if updates:
                # Update in batches
                cursor.executemany("""
                UPDATE files 
                SET transliterated_name = ?, transliterated_parent_folder = ? 
                WHERE id = ?
                """, updates)
                conn.commit()
                print(f"[DB] One-time migration complete. Transliterated {len(updates)} files.")
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
            print(f"[DB] Reset enriched status for {changes} song(s) with empty genres to trigger MusicBrainz lookup.")
    except Exception as e:
        print(f"[DB] Error resetting empty genre song flags: {e}")

    conn.commit()
    conn.close()
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
      AND f.category IN ('movie', 'song')
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
