import os
import re
import sys
import time
import json
import string
import threading
import requests
import ctypes
import psutil
from typing import List, Dict, Any, Set
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from app import config
from app.memory import db
from app.tools.files import _is_safe_path

LOG_FILE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "yuki_crawler.log")

FILE_CRAWLER_PAUSED = False
METADATA_TAGGER_PAUSED = True
CURRENT_CRAWL_PATH = "Idle"
CURRENT_TAGGER_PATH = "Idle"

# Crawler metrics and states
CRAWL_ROOTS_TOTAL = 0
CRAWL_ROOTS_CURRENT = 0
CRAWL_ROOTS_CURRENT_PATH = "Idle"
INITIAL_CRAWL_COMPLETED = False

class CrawlAbortException(Exception):
    pass

FORCE_RESET_FLAG = False
STARTUP_PRIORITY_SCAN_COMPLETED = False

class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("dwTime", ctypes.c_uint),
    ]

def get_system_idle_time() -> float:
    """Returns the user idle duration in seconds using Windows API."""
    if sys.platform != "win32":
        return 0.0
    try:
        lii = LASTINPUTINFO()
        lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
        if ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
            millis = ctypes.windll.kernel32.GetTickCount() - lii.dwTime
            return millis / 1000.0
    except Exception:
        pass
    return 0.0

def _is_intensive_process_running() -> bool:
    """
    Returns True if an intensive game process is running.
    """
    game_patterns = [
        "gta", 
        "cyberpunk", "witcher", "valorant", "fifa", "rdr2", 
        "minecraft", "fortnite", "genshin", "overwatch", "csgo", 
        "cs2", "hl2", "skyrim", "fallout", "tombtool", "doom", 
        "forza", "apex", "pubg", "eldenring", "darksouls",
        "unrealengine", "unity", "godot"
    ]
    try:
        # Check running process names
        for proc in psutil.process_iter(['name']):
            name = proc.info.get('name')
            if name:
                name_lower = name.lower()
                if any(pat in name_lower for pat in game_patterns):
                    return True
    except Exception:
        pass
    return False

def is_on_battery() -> bool:
    """Returns True if the system is on battery power (plug is disconnected)."""
    try:
        battery = psutil.sensors_battery()
        if battery is not None:
            return not battery.power_plugged
    except Exception:
        pass
    return False

def check_idle_and_game_pacing():
    """
    Blocks and sleeps if:
    - User is not idle (idle time < 180 seconds, i.e., 3 minutes)
    - Intensive process (game) is running
    - Running on battery power (plug is off)
    """
    global CURRENT_CRAWL_PATH
    if FORCE_RESET_FLAG:
        raise CrawlAbortException()
        
    was_suspended = False
    while True:
        if FORCE_RESET_FLAG:
            raise CrawlAbortException()
            
        # 1. Check if user paused crawler manually
        while FILE_CRAWLER_PAUSED:
            if FORCE_RESET_FLAG:
                raise CrawlAbortException()
            CURRENT_CRAWL_PATH = "Paused by user"
            time.sleep(1)
            
        # 2. Check battery status (suspend if running on battery)
        if is_on_battery():
            CURRENT_CRAWL_PATH = "Suspended: running on battery power"
            if not was_suspended:
                log_message("[Crawler] Running on battery power. Suspending file crawler walk to save energy...")
                was_suspended = True
            time.sleep(5)
            continue
            
        # 3. Check for running games/intensive apps
        if _is_intensive_process_running():
            CURRENT_CRAWL_PATH = "Suspended: game/intensive program running"
            if not was_suspended:
                log_message("[Crawler] Intensive process/game detected. Suspending file crawler walk...")
                was_suspended = True
            time.sleep(5)
            continue
            
        # If all checks pass, we can crawl!
        if was_suspended:
            log_message("[Crawler] System plugged in and intensive processes cleared. Resuming file crawler walk...")
            CURRENT_CRAWL_PATH = "Resuming file scanner walk..."
        break

def pause_crawler():
    global FILE_CRAWLER_PAUSED
    FILE_CRAWLER_PAUSED = True
    log_message("[Crawler] File crawler service paused.")

def resume_crawler():
    global FILE_CRAWLER_PAUSED
    FILE_CRAWLER_PAUSED = False
    log_message("[Crawler] File crawler service resumed.")

def is_crawler_paused():
    return FILE_CRAWLER_PAUSED

def pause_tagger():
    global METADATA_TAGGER_PAUSED
    METADATA_TAGGER_PAUSED = True
    log_message("[Tagger] Metadata tagger service paused.")

def resume_tagger():
    global METADATA_TAGGER_PAUSED
    METADATA_TAGGER_PAUSED = False
    log_message("[Tagger] Metadata tagger service resumed.")

def is_tagger_paused():
    return METADATA_TAGGER_PAUSED

def get_current_crawl_path():
    return CURRENT_CRAWL_PATH

def get_current_tagger_path():
    return CURRENT_TAGGER_PATH

def log_message(message: str):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {message}"
    try:
        with open(LOG_FILE_PATH, "a", encoding="utf-8") as f:
            f.write(formatted + "\n")
    except Exception:
        pass

# Categories mapped by file extensions
EXT_CATEGORIES = {
    # Songs / Audio
    '.mp3': 'song', '.wav': 'song', '.flac': 'song', '.m4a': 'song', 
    '.ogg': 'song', '.wma': 'song', '.aac': 'song', '.opus': 'song',
    
    # Movies / Video
    '.mp4': 'movie', '.mkv': 'movie', '.avi': 'movie', '.mov': 'movie', 
    '.wmv': 'movie', '.flv': 'movie', '.webm': 'movie', '.m4v': 'movie', 
    '.ts': 'movie',
    
    # Photos / Images
    '.jpg': 'photo', '.jpeg': 'photo', '.png': 'photo', '.gif': 'photo', 
    '.bmp': 'photo', '.heic': 'photo', '.tiff': 'photo', '.webp': 'photo', 
    '.svg': 'photo', '.avif': 'photo',
    
    # Documents
    '.pdf': 'document', '.txt': 'document', '.docx': 'document', 
    '.xlsx': 'document', '.pptx': 'document', '.md': 'document', 
    '.rtf': 'document', '.csv': 'document', '.epub': 'document', 
    '.doc': 'document', '.xls': 'document', '.ppt': 'document',
    
    # Archives / Compressed
    '.zip': 'archive', '.rar': 'archive', '.7z': 'archive',
    
    # Application Launchers, Installers, and Scripts
    '.exe': 'program', '.lnk': 'program', '.bat': 'program', '.cmd': 'program',
    '.ps1': 'program', '.msi': 'program', '.msix': 'program', '.appx': 'program',
    '.jar': 'program', '.pyw': 'program', '.vbs': 'program'
}

CRAWL_DRIVES = []
CRAWL_FOLDERS = []
PRIORITY_FOLDERS = []

def build_all_targets() -> List[str]:
    """
    Builds the ordered list of scan root targets.
    Expands every non-C drive into its direct subdirectories AND their immediate
    subfolders (Level 2 subdirectories) so that each subfolder is tracked individually
    in completed_roots — giving highly granular resume checkpointing.
    Order: priority folders → each drive's nested subdirs → C:\\ user folders.
    """
    targets: List[str] = []
    excluded_lower = [e.lower() for e in EXCLUDED_DIRS]

    def _add(path: str):
        if path not in targets:
            targets.append(path)

    # 1. Priority folders first
    for p in PRIORITY_FOLDERS:
        _add(p)

    # 2. Expand every non-C drive into Level 1 and Level 2 subdirectories
    for drive in CRAWL_DRIVES:
        if not os.path.exists(drive):
            continue
        try:
            # Gather top-level directories (Level 1)
            for level1_name in sorted(os.listdir(drive)):
                level1_path = os.path.join(drive, level1_name)
                if not os.path.isdir(level1_path):
                    continue
                if _contains_blacklisted_dir_component(level1_path):
                    continue

                level1_lower = level1_path.lower()
                if any(level1_lower == e or level1_lower.startswith(e + os.sep) for e in excluded_lower):
                    continue

                # Go one step better: check for immediate subfolders (Level 2)
                try:
                    subdirs = [d for d in os.listdir(level1_path) if os.path.isdir(os.path.join(level1_path, d))]
                    
                    if subdirs:
                        # If subfolders exist, register each Level 2 folder as an independent target
                        for level2_name in sorted(subdirs):
                            level2_path = os.path.join(level1_path, level2_name)
                            if _contains_blacklisted_dir_component(level2_path):
                                continue
                            level2_lower = level2_path.lower()
                            
                            if any(level2_lower == e or level2_lower.startswith(e + os.sep) for e in excluded_lower):
                                continue
                            _add(level2_path)
                    else:
                        # Fallback: if Level 1 folder has no subdirectories, add it as a target
                        _add(level1_path)
                except Exception:
                    # If reading Level 2 fails (permissions, etc.), fall back to adding Level 1
                    _add(level1_path)
                    
        except Exception:
            # Critical fallback: treat the entire drive root as a fallback single target
            _add(drive)

    # 3. C:\\ user folders
    for f in CRAWL_FOLDERS:
        _add(f)

    return targets

# Directories that should NEVER be scanned (checked case-insensitively against full path)
EXCLUDED_DIRS = [
    "D:\\WUDownloadCache",          # Windows Update download cache
    "D:\\WpSystem",                  # Windows Phone system partition
    "D:\\WindowsApps",              # UWP app binaries (system-managed)
    "D:\\msdownld.tmp",             # IE/Edge temporary download folder
    "D:\\DeliveryOptimization",     # Windows Delivery Optimization cache
    "D:\\$RECYCLE.BIN",             # Recycle Bin
]

# Every single word here will only trigger a skip if the folder name is an EXACT match
DIR_BLACKLIST_KEYWORDS = {
    # System folder names
    "windows", "appdata", "programdata", "$recycle.bin", "system volume information",
    "deliveryoptimization", "msdownld.tmp",
    
    # Generic temporary / backup folder names
    "stg-backup", "dist", "build", "assets", "temp", "tmp", "cache", "backup",
    
    # Dev environments and dependencies
    "node_modules", ".venv", "venv", "env", "target", "bin", "obj", "out", "src",
    "site-packages", "packages", "library", "projectsettings", "plugins", "libcache","corelibs","lib"
}

def _contains_blacklisted_dir_component(path: str) -> bool:
    """
    Returns True ONLY if a directory component exactly matches a blacklisted keyword,
    or begins with standard hidden/system prefixes (. or _)
    """
    path_lower = path.lower()
    try:
        parts = Path(path_lower).parts
    except Exception:
        parts = re.split(r"[\\/]+", path_lower)

    for part in parts:
        # Clean off trailing slashes, spaces, or drive designators (e.g., 'd:')
        part = part.strip("\\/ :")
        if not part:
            continue
            
        # 1. THE EXACT MATCH CHECK
        if part in DIR_BLACKLIST_KEYWORDS:
            return True
            
        # 2. WILDCARD SYSTEM CHECKS (Keep these to catch hidden paths like .git or __pycache__)
        if part.startswith(".") or part.startswith("_"):
            return True

    return False

def resolve_crawl_targets():
    """
    Finds default crawl targets: C: user directories, and D: through Z: drives.
    """
    global CRAWL_DRIVES, CRAWL_FOLDERS, PRIORITY_FOLDERS
    CRAWL_DRIVES.clear()
    CRAWL_FOLDERS.clear()
    PRIORITY_FOLDERS.clear()
    
    # Add priority folders
    priority_paths = [
        "D:\\video songs",
        "C:\\Users\\ihars\\Downloads",
        "D:\\downloaded videos",
        "D:\\downloaded videos new"
    ]
    for path in priority_paths:
        if os.path.exists(path):
            PRIORITY_FOLDERS.append(path)
    
    # 1. Prioritize D:\ drive and other non-C drives
    for letter in string.ascii_uppercase:
        if letter in ('A', 'B', 'C'):
            continue
        drive = f"{letter}:\\"
        if os.path.exists(drive):
            CRAWL_DRIVES.append(drive)
            
    # Always ensure D:\ is first in our crawl list if it exists
    if "D:\\" not in CRAWL_DRIVES and os.path.exists("D:\\"):
        CRAWL_DRIVES.insert(0, "D:\\")

    # 2. Add C: drive user directories
    user_profile = os.environ.get("USERPROFILE")
    if user_profile:
        folders = ["Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos"]
        for folder in folders:
            folder_path = os.path.join(user_profile, folder)
            if os.path.exists(folder_path):
                CRAWL_FOLDERS.append(folder_path)

def _is_game_or_program_dir(dir_path: str) -> bool:
    """
    Returns True if the directory path belongs to a game library,
    standard Program Files, build output, or system application data.
    """
    path_lower = dir_path.lower()
    patterns = ["steam", "games", "epic games", "origin", "riot games", "blizzard", "ubisoft", "gog", "program files", "programdata", "node_modules", "appdata", ".git", "bin", "obj"]
    return any(pattern in path_lower for pattern in patterns)

def guess_category(file_path: str, ext: str, size: int = 0) -> str:
    """
    Determines category based on extension, size, and directory context.
    """
    ext_lower = ext.lower()
    # Since we whitelist, it will always find a match. Fallback to "other" is just defensive now.
    category = EXT_CATEGORIES.get(ext_lower, "other") 
    
    # Sound effect vs Song heuristic for OGG files
    if ext_lower == '.ogg' and size < 1024 * 1024:
        category = "other"
        
    # Program/Executable heuristics
    if category == "program":
        path_lower = file_path.lower()
        is_game_dir = _is_game_or_program_dir(file_path)
        if not is_game_dir:
            category = "other"
            
    return category


def parse_filename_metadata(filename: str) -> Dict[str, Any]:
    """
    Lightweight local regex heuristic to extract titles, creators, and years from file names.
    E.g. "Linkin Park - In The End (Official).mp3" or "Inception (2010) [1080p].mkv"
    """
    name_without_ext, _ = os.path.splitext(filename)
    metadata = {
        "title": name_without_ext,
        "artist_or_creator": "",
        "release_year": None,
        "genre_or_tags": "",
        "alternate_titles": ""
    }
    
    # 1. Parse Movie/Video Year: e.g. "Inception (2010)"
    year_match = re.search(r'\b(19\d\d|20\d\d)\b', name_without_ext)
    if year_match:
        metadata["release_year"] = int(year_match.group(1))
        # Remove year from title
        name_without_ext = re.sub(r'[\(\[\s]*\b(19\d\d|20\d\d)\b[\)\]\s]*', ' ', name_without_ext).strip()
        
    # Clean up common video metadata residue (e.g. 1080p, BluRay, x264, web-dl)
    name_without_ext = re.sub(r'(?i)\b(1080p|720p|4k|2160p|bluray|x264|x265|hevc|web-dl|webrip|hdtv|aac|dd5\.1|dts)\b', '', name_without_ext)
    name_without_ext = re.sub(r'[\(\[\{].*?[\)\]\}]', '', name_without_ext) # Remove bracket contents
    name_without_ext = ' '.join(name_without_ext.split()).strip('_ -')

    # 2. Parse Song Creator/Artist: e.g. "Artist - Title"
    if " - " in name_without_ext:
        parts = name_without_ext.split(" - ", 1)
        metadata["artist_or_creator"] = parts[0].strip()
        metadata["title"] = parts[1].strip()
    else:
        metadata["title"] = name_without_ext
        
    return metadata

# --- Core Crawler Logic ---

def should_handle_orphan(file_path: str, current_root: str, all_targets: List[str]) -> bool:
    """
    Returns True if file_path belongs to current_root and does not belong to a more specific target.
    """
    fp_lower = file_path.lower()
    cr_lower = current_root.lower()
    
    # Must start with current_root
    if not fp_lower.startswith(cr_lower):
        return False
        
    # Check if there is a more specific target root
    for target in all_targets:
        t_lower = target.lower()
        if t_lower != cr_lower and fp_lower.startswith(t_lower):
            # If target is longer than current_root, it is more specific
            if len(t_lower) > len(cr_lower):
                return False
                
    return True

def scan_target_root(root_dir: str, all_targets: List[str]):
    """
    Crawls a single target root directory, indexes files, and runs target-specific orphan cleanup.
    """
    global CURRENT_CRAWL_PATH, CRAWL_ROOTS_CURRENT_PATH
    
    CRAWL_ROOTS_CURRENT_PATH = root_dir
    if not os.path.exists(root_dir):
        return

    if _contains_blacklisted_dir_component(root_dir):
        log_message(f"[Crawler] Skipping blacklisted root path: {root_dir}")
        return
        
    all_seen_file_paths = set()
    folders_scanned = 0
    folders_skipped = 0
    total_files_scanned = 0
    new_files_indexed = 0
    modified_files_updated = 0
    
    # Only print indexing path if it's one of the main drives/folders to avoid log flooding
    if root_dir in PRIORITY_FOLDERS or root_dir in CRAWL_DRIVES or root_dir in CRAWL_FOLDERS or len(all_targets) <= 15:
        log_message(f"[Crawler] Indexing target path: {root_dir}")
        
    excluded_lower = [e.lower() for e in EXCLUDED_DIRS]

    for root, dirs, files in os.walk(root_dir):
        check_idle_and_game_pacing()
        CURRENT_CRAWL_PATH = root

        # Skip if the current root itself is an excluded directory
        root_lower = root.lower()
        if any(root_lower == e or root_lower.startswith(e + os.sep) for e in excluded_lower):
            dirs[:] = []  # Don't recurse into it
            continue

        # Exclude priority folders from other roots to avoid duplicate scans
        dirs[:] = [d for d in dirs if not any(
            root_dir.lower() != pf.lower() and os.path.join(root, d).lower() == pf.lower()
            for pf in PRIORITY_FOLDERS
        )]

        # Filter out excluded directories before recursing
        dirs[:] = [d for d in dirs if not any(
            os.path.join(root, d).lower() == e or os.path.join(root, d).lower().startswith(e + os.sep)
            for e in excluded_lower
        )]

        # Filter out blacklisted directory names before recursing
        dirs[:] = [d for d in dirs if not _contains_blacklisted_dir_component(os.path.join(root, d))]

        # Check if current directory path is safe
        if not _is_safe_path(root, write_operation=False):
            dirs[:] = []  # Don't recurse
            continue

        # Filter directories in-place to avoid recursing into sensitive system folders
        dirs[:] = [d for d in dirs if _is_safe_path(os.path.join(root, d), write_operation=False)]
        
        # Pacing sleep to prevent high CPU/disk usage (0.25 seconds for low intensity)
        time.sleep(0.2)
        
        try:
            stat_info = os.stat(root)
            current_mtime = stat_info.st_mtime
        except Exception:
            continue
            
        # Check cached folder details
        cached_dir = db.get_directory(root)
        
        # Smart Folder Skip Optimization:
        if cached_dir and cached_dir["last_modified"] == current_mtime:
            folders_skipped += 1
            conn = db.get_connection()
            cached_files = conn.execute("SELECT file_path FROM files WHERE file_path LIKE ?", (os.path.join(root, "%"),)).fetchall()
            conn.close()
            for cf in cached_files:
                if os.path.dirname(cf["file_path"]) == root:
                    all_seen_file_paths.add(cf["file_path"])
                    total_files_scanned += 1
            continue
            
        folders_scanned += 1
        folder_changes_detected = False
        is_game_program_path = _is_game_or_program_dir(root)
        
        for file in files:
            full_path = os.path.join(root, file)
            CURRENT_CRAWL_PATH = full_path
            _, ext = os.path.splitext(file)
            ext_lower = ext.lower()
            
            # ─── PURE WHITELIST GUARD CLAUSE ───
            # If the extension isn't explicitly tracked in your categories, skip it instantly!
            if ext_lower not in EXT_CATEGORIES:
                continue
                
            if is_game_program_path and ext_lower != '.exe':
                continue
                
            all_seen_file_paths.add(full_path)
            total_files_scanned += 1
            
            try:
                file_stat = os.stat(full_path)
                f_size = file_stat.st_size
                f_mtime = file_stat.st_mtime
            except Exception:
                continue
                
            category = guess_category(full_path, ext, f_size)
            parent_folder = db.get_clean_parent_folder(full_path)
            
            existing_file = db.get_file_by_path(full_path)
            if not existing_file:
                folder_changes_detected = True
                new_files_indexed += 1
                log_message(f"[Crawler] [NEW] Indexed file: '{full_path}' (guessed category: {category}) - successfully added to db")
                file_id = db.upsert_file(full_path, file, parent_folder, ext, f_size, f_mtime, category)
                
                if file_id != -1 and category in ('movie', 'song'):
                    meta = parse_filename_metadata(file)
                    db.upsert_metadata(
                        file_id, 
                        meta["title"], 
                        meta["artist_or_creator"], 
                        meta["genre_or_tags"], 
                        meta["release_year"], 
                        meta["alternate_titles"],
                        enriched=0
                    )
            elif existing_file["size"] != f_size or existing_file["last_modified"] != f_mtime:
                folder_changes_detected = True
                modified_files_updated += 1
                log_message(f"[Crawler] [MODIFIED] Updated stats for file: '{full_path}' - successfully added to db")
                db.upsert_file(full_path, file, parent_folder, ext, f_size, f_mtime, category)
        
        change_increment = 1 if folder_changes_detected else 0
        db.upsert_directory(root, current_mtime, change_increment)
        
    # --- Localized Orphan File Cleanup ---
    conn = db.get_connection()
    search_prefix = root_dir if root_dir.endswith(os.sep) else root_dir + os.sep
    cached_files = conn.execute("SELECT file_path FROM files WHERE file_path LIKE ?", (search_prefix + "%",)).fetchall()
    conn.close()
    
    orphans = []
    for row in cached_files:
        path = row["file_path"]
        if should_handle_orphan(path, root_dir, all_targets):
            if path not in all_seen_file_paths:
                if not os.path.exists(path):
                    orphans.append(path)
                    
    if orphans:
        log_message(f"[Crawler] Found {len(orphans)} deleted files under '{root_dir}'. Removing from database...")
        db.delete_files_by_paths(orphans)
        
    # --- Clean up Zombie Directories Cache ---
    conn = db.get_connection()
    cached_dirs = conn.execute("SELECT path FROM directories WHERE path LIKE ?", (search_prefix + "%",)).fetchall()
    conn.close()
    
    dead_directories = []
    for row in cached_dirs:
        dir_path = row["path"]
        # If the folder no longer physically exists on your hard drive, mark it for execution
        if not os.path.exists(dir_path):
            dead_directories.append(dir_path)
            
    if dead_directories:
        log_message(f"[Crawler] Found {len(dead_directories)} deleted folders under '{root_dir}'. Purging directory cache...")
        conn = db.get_connection()
        try:
            # Batch delete dead directory rows from cache
            batch_size = 500
            for i in range(0, len(dead_directories), batch_size):
                batch = dead_directories[i:i+batch_size]
                placeholders = ",".join("?" for _ in batch)
                conn.execute(f"DELETE FROM directories WHERE path IN ({placeholders})", batch)
            conn.commit()
        except Exception as e:
            log_message(f"[Crawler] Error purging dead directories cache: {e}")
        finally:
            conn.close()
        
    log_message(f"[Crawler] Root '{root_dir}' scan summary: Scanned={folders_scanned}, Skipped={folders_skipped}, TotalFiles={total_files_scanned}, New={new_files_indexed}, Mod={modified_files_updated}, Deleted={len(orphans)}")

def sleep_pacing_between_cycles(seconds: float):
    global CURRENT_CRAWL_PATH
    start_t = time.time()
    while time.time() - start_t < seconds:
        if FORCE_RESET_FLAG:
            raise CrawlAbortException()
        if FILE_CRAWLER_PAUSED:
            CURRENT_CRAWL_PATH = "Paused by user"
            time.sleep(1)
            continue
        remaining = int(seconds - (time.time() - start_t))
        CURRENT_CRAWL_PATH = f"Idle (Next cycle in {remaining}s)"
        time.sleep(1)

def run_crawl():
    """
    Main background crawl worker loop.
    Controls priority folder startup scanning and resumes the cycle where it left off.
    Enforces Win32 user idle behaviors and game suspensions.
    """
    global CURRENT_CRAWL_PATH, INITIAL_CRAWL_COMPLETED, CRAWL_ROOTS_TOTAL, CRAWL_ROOTS_CURRENT, CRAWL_ROOTS_CURRENT_PATH, FORCE_RESET_FLAG, STARTUP_PRIORITY_SCAN_COMPLETED
    
    try:
        resolve_crawl_targets()
        
        # Start watchdog immediately if we've already done a full first cycle
        first_cycle_done_init = (db.get_crawler_state("first_cycle_done") == "true")
        if first_cycle_done_init:
            log_message("[Crawler] First cycle already done. Starting watchdog service on startup.")
            start_watchdog_services()
            
        # Check reset flag
        if FORCE_RESET_FLAG:
            FORCE_RESET_FLAG = False
            log_message("[Crawler] Reset flag detected. Resetting crawler state and clearing directories cache to run a fresh scan...")
            db.set_crawler_state("first_time_priority_done", "false")
            db.set_crawler_state("first_cycle_done", "false")
            db.set_crawler_state("completed_roots_in_cycle", "[]")
            STARTUP_PRIORITY_SCAN_COMPLETED = False
            
            # Clear directories cache to force walking all folders
            conn = db.get_connection()
            conn.execute("DELETE FROM directories")
            conn.commit()
            conn.close()
            
        # Check if database index has vanished / is empty
        conn = db.get_connection()
        files_count = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        conn.close()
        
        if files_count == 0:
            log_message("[Crawler] Database files table is empty! Resetting crawler state and clearing directories cache to trigger a full re-index.")
            db.set_crawler_state("first_time_priority_done", "false")
            db.set_crawler_state("first_cycle_done", "false")
            db.set_crawler_state("completed_roots_in_cycle", "[]")
            STARTUP_PRIORITY_SCAN_COMPLETED = False
            
            # Clear directories cache to force walking all folders
            conn = db.get_connection()
            conn.execute("DELETE FROM directories")
            conn.commit()
            conn.close()

        resolve_crawl_targets()
        
        # Fetch state from DB
        first_time_priority_done = (db.get_crawler_state("first_time_priority_done") == "true")
        first_cycle_done = (db.get_crawler_state("first_cycle_done") == "true")
        
        completed_roots_str = db.get_crawler_state("completed_roots_in_cycle")
        completed_roots = json.loads(completed_roots_str) if completed_roots_str else []
        
        # Build targets — D:\\ is expanded into direct subdirs for subfolder-level resume
        all_targets = build_all_targets()
        CRAWL_ROOTS_TOTAL = len(all_targets)
        
        # If the first cycle is already complete, run the startup priority folders sweep and exit
        if first_cycle_done:
            log_message("[Crawler] First cycle is complete. Running startup sweep of priority folders...")
            for idx, root_dir in enumerate(PRIORITY_FOLDERS):
                check_idle_and_game_pacing()
                CRAWL_ROOTS_CURRENT = idx + 1
                scan_target_root(root_dir, all_targets)
            log_message("[Crawler] Startup sweep of priority folders completed. Crawler going to sleep (Watchdog is active).")
            CURRENT_CRAWL_PATH = "Idle"
            CRAWL_ROOTS_CURRENT_PATH = "Idle"
            return
            
        # Scenario A: First time priority scan is NOT done yet
        if not first_time_priority_done:
            log_message("[Crawler] First-time priority scan not done. Initiating priority scan...")
            priority_targets = list(PRIORITY_FOLDERS)
            
            # Scan priority folders
            for idx, root_dir in enumerate(priority_targets):
                check_idle_and_game_pacing()
                CRAWL_ROOTS_CURRENT = idx + 1
                
                if root_dir in completed_roots:
                    continue
                    
                scan_target_root(root_dir, all_targets)
                
                completed_roots.append(root_dir)
                db.set_crawler_state("completed_roots_in_cycle", json.dumps(completed_roots))
                
            # Mark first time priority scan permanently as true
            db.set_crawler_state("first_time_priority_done", "true")
            first_time_priority_done = True
            log_message("[Crawler] First-time priority scan marked permanently done.")
            
        # Quick startup sweep of priority folders.
        # Only runs in Scenario 1 (first_time_priority_done = false) — i.e. the very first
        # app session ever. In Scenario 2 (mid-cycle restart), priority folders were already
        # scanned in a previous session, so we skip this and go straight to cycle resume.
        if not STARTUP_PRIORITY_SCAN_COMPLETED and not first_time_priority_done:
            log_message("[Crawler] App startup: performing initial sweep of priority folders...")
            for idx, root_dir in enumerate(PRIORITY_FOLDERS):
                check_idle_and_game_pacing()
                CRAWL_ROOTS_CURRENT = idx + 1
                scan_target_root(root_dir, all_targets)
            STARTUP_PRIORITY_SCAN_COMPLETED = True
            log_message("[Crawler] App startup sweep of priority folders completed.")
            
        # Now, run/resume the cycle for all remaining folders
        log_message(f"[Crawler] Running/Resuming cycle (completed: {len(completed_roots)}/{len(all_targets)})...")
        
        for idx, root_dir in enumerate(all_targets):
            check_idle_and_game_pacing()
            CRAWL_ROOTS_CURRENT = idx + 1
            
            if root_dir in completed_roots:
                continue
                
            scan_target_root(root_dir, all_targets)
            
            completed_roots.append(root_dir)
            db.set_crawler_state("completed_roots_in_cycle", json.dumps(completed_roots))
            
        # Cycle complete
        log_message("[Crawler] First cycle completed successfully.")
        db.set_crawler_state("first_cycle_done", "true")
        first_cycle_done = True
        
        # Clear completed roots
        completed_roots = []
        db.set_crawler_state("completed_roots_in_cycle", json.dumps(completed_roots))
        
        # Start watchdog service
        start_watchdog_services()
        log_message("[Crawler] Crawler cycle finished. Going to sleep (Watchdog is active).")
        
    except CrawlAbortException:
        log_message("[Crawler] Crawl walk aborted for reset.")
        db.set_crawler_state("first_time_priority_done", "false")
        db.set_crawler_state("first_cycle_done", "false")
        db.set_crawler_state("completed_roots_in_cycle", "[]")
        FORCE_RESET_FLAG = False
        STARTUP_PRIORITY_SCAN_COMPLETED = False
        # Re-trigger crawl walk from scratch
        crawl_thread = threading.Thread(target=run_crawl, name="YukiFileCrawler", daemon=True)
        global CRAWL_THREAD
        CRAWL_THREAD = crawl_thread
        crawl_thread.start()
        return
        
    CURRENT_CRAWL_PATH = "Idle"
    CRAWL_ROOTS_CURRENT_PATH = "Idle"

# --- Asynchronous AI Metadata Enrichment Worker ---

def run_metadata_enrichment_loop():
    """
    Polls the database for files marked for enrichment (enriched=0).
    Queries the local LM Studio model to extract metadata.
    """
    global CURRENT_TAGGER_PATH
    log_message("[Tagger] Starting metadata enrichment background worker...")
    while True:
        if METADATA_TAGGER_PAUSED:
            time.sleep(5)
            continue
        # Fetch 5 unenriched media records
        pending = db.get_unenriched_files(limit=5)
        if not pending:
            CURRENT_TAGGER_PATH = "Idle"
            # Idle sleep if no files need enrichment
            time.sleep(10)
            continue
            
        for item in pending:
            file_id = item["id"]
            file_path = item["file_path"]
            file_name = item["file_name"]
            category = item["category"]
            
            CURRENT_TAGGER_PATH = file_path
            
            log_message(f"[Tagger] Querying LM Studio (model: {config.LLM_MODEL}) for file '{file_name}' at '{file_path}' - send to llm")
            
            # Fallback local metadata if LLM is unavailable
            local_meta = parse_filename_metadata(file_name)
            title = local_meta["title"]
            artist = local_meta["artist_or_creator"]
            year = local_meta["release_year"]
            genres = ""
            alt_titles = ""
            
            # Try to query LM Studio
            try:
                url = f"{config.LMSTUDIO_URL}/v1/chat/completions"
                
                system_prompt = (
                    "You are a local media manager AI. Analyze the file path and filename provided by the user. "
                    "Extract details in JSON format. "
                    "Fields:\n"
                    "- title (clean song/movie title)\n"
                    "- artist_or_creator (creator, artist, band, or director)\n"
                    "- genre_or_tags (comma-separated list of musical genres, movie genres, or tags. "
                    "For songs, always include mood/vibe/atmosphere tags if applicable, such as 'romantic', 'relaxing', 'funny', 'sad', 'happy', 'chill', 'hype', 'dark', 'bright', etc.)\n"
                    "- release_year (integer year, or null if unknown)\n"
                    "- alternate_titles (comma-separated list of other names, translated names, or common typos)\n"
                    "- category (must be either 'song' for music/songs/video-songs/music-videos, 'movie' for films/movies/videos/tv-shows, or 'other')\n\n"
                    "CRITICAL: Return ONLY a raw JSON block. Do not write explanations, markdown fences (like ```json), or preambles."
                )
                
                user_msg = f"File category guessed: {category}\nFile path: {file_path}\nFile name: {file_name}"
                
                payload = {
                    "model": config.LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg}
                    ],
                    "temperature": 0.2
                }
                
                response = requests.post(url, json=payload, timeout=12)
                if response.status_code == 200:
                    result = response.json()
                    ai_content = result["choices"][0]["message"]["content"].strip()
                    
                    # Clean markdown wrappers if present
                    if ai_content.startswith("```"):
                        # Extract content within fences
                        match = re.search(r'```(?:json)?\s*(.*?)\s*```', ai_content, re.DOTALL)
                        if match:
                            ai_content = match.group(1).strip()
                            
                    data = json.loads(ai_content)
                    
                    # Parse successfully
                    title = data.get("title", title)
                    artist = data.get("artist_or_creator", artist)
                    genres = data.get("genre_or_tags", genres)
                    if isinstance(genres, list):
                        genres = ", ".join(genres)
                    year_val = data.get("release_year")
                    if year_val:
                        try:
                            year = int(year_val)
                        except Exception:
                            pass
                    alt = data.get("alternate_titles", alt_titles)
                    if isinstance(alt, list):
                        alt_titles = ", ".join(alt)
                    else:
                        alt_titles = str(alt)
                        
                    # Let LLM dynamically refine category (e.g. video song from movie to song)
                    ai_cat = data.get("category")
                    if ai_cat in ('song', 'movie', 'program', 'game' , 'games', 'other'):
                        category = ai_cat
                        
                    log_message(f"[Tagger] Received reply from LM Studio for '{file_name}' at '{file_path}' - received from llm")
                    log_message(f"[Tagger] [SUCCESS] AI enriched metadata saved for '{file_name}' at '{file_path}': title='{title}', artist='{artist}', tags='{genres}' - successfully added to db")
                else:
                    log_message(f"[Tagger] [FAILED] LM Studio returned status {response.status_code} for '{file_name}' at '{file_path}'. Using local parsed fallbacks - successfully added to db")
            except Exception as e:
                log_message(f"[Tagger] [FAILED] LM Studio connection failed or JSON parse error for '{file_name}' at '{file_path}': {e}. Using local parsed fallbacks - successfully added to db")
                # We save locally parsed data so we don't block the loop on failure
                
            # Upsert tags and dynamically update the category column
            db.upsert_metadata(file_id, title, artist, genres, year, alt_titles, enriched=1, category=category)
            
            # Pacing sleep between individual file tagging requests to ease local LLM load
            time.sleep(1.0)
            
        CURRENT_TAGGER_PATH = "Idle"
            
        # Pacing sleep between API requests
        time.sleep(2)

# --- Watchdog Filesystem Observer Handler ---

class YukiFileSystemHandler(FileSystemEventHandler):
    def on_created(self, event):
        if event.is_directory:
            return
        self.handle_file_change(event.src_path, "created")

    def on_modified(self, event):
        if event.is_directory:
            return
        self.handle_file_change(event.src_path, "modified")

    def on_deleted(self, event):
        if event.is_directory:
            return
        self.handle_file_change(event.src_path, "deleted")

    def handle_file_change(self, file_path: str, change_type: str):
        if not _is_safe_path(file_path, write_operation=False):
            return
        if _is_game_or_program_dir(file_path):
            return
            
        file_path = os.path.abspath(file_path)
        file_name = os.path.basename(file_path)
        _, ext = os.path.splitext(file_name)
        ext_lower = ext.lower()
        if ext_lower not in EXT_CATEGORIES:
            return
            
        if change_type == "deleted":
            log_message(f"[Watchdog] Detected deleted file: '{file_path}'")
            db.delete_files_by_paths([file_path])
        else:
            try:
                # Give file a brief moment to finish writing if copying/moving
                time.sleep(0.5)
                if not os.path.exists(file_path):
                    return
                file_stat = os.stat(file_path)
                f_size = file_stat.st_size
                f_mtime = file_stat.st_mtime
            except Exception:
                return
                
            category = guess_category(file_path, ext, f_size)
            parent_folder = db.get_clean_parent_folder(file_path)
            
            existing = db.get_file_by_path(file_path)
            if not existing:
                log_message(f"[Watchdog] [NEW] Detected file: '{file_path}'")
                file_id = db.upsert_file(file_path, file_name, parent_folder, ext, f_size, f_mtime, category)
                if file_id != -1 and category in ('movie', 'song'):
                    meta = parse_filename_metadata(file_name)
                    db.upsert_metadata(file_id, meta["title"], meta["artist_or_creator"], meta["genre_or_tags"], meta["release_year"], meta["alternate_titles"], enriched=0)
            elif existing["size"] != f_size or existing["last_modified"] != f_mtime:
                log_message(f"[Watchdog] [MODIFIED] Detected file: '{file_path}'")
                db.upsert_file(file_path, file_name, parent_folder, ext, f_size, f_mtime, category)

WATCHDOG_OBSERVER = None

def start_watchdog_services():
    global WATCHDOG_OBSERVER
    if WATCHDOG_OBSERVER is not None:
        return
    log_message("[Watchdog] Initializing background event listener...")
    resolve_crawl_targets()
    observer = Observer()
    handler = YukiFileSystemHandler()
    
    scan_queue = []
    scan_queue.extend(PRIORITY_FOLDERS)
    for d in CRAWL_DRIVES:
        if d not in scan_queue:
            scan_queue.append(d)
    for hd in db.get_hot_directories():
        if hd not in scan_queue and os.path.exists(hd):
            scan_queue.append(hd)
    for f in CRAWL_FOLDERS:
        if f not in scan_queue:
            scan_queue.append(f)
            
    monitored_paths = 0
    for target in scan_queue:
        if os.path.exists(target):
            try:
                observer.schedule(handler, target, recursive=True)
                log_message(f"[Watchdog] Listening for file events on: '{target}'")
                monitored_paths += 1
            except Exception as e:
                log_message(f"[Watchdog] Failed to schedule path {target}: {e}")
                
    if monitored_paths > 0:
        observer.start()
        WATCHDOG_OBSERVER = observer
        log_message("[Watchdog] Observer started successfully.")
    else:
        log_message("[Watchdog] No valid paths found to observe.")

def get_crawler_status_metrics() -> Dict[str, Any]:
    global CRAWL_ROOTS_TOTAL, CRAWL_ROOTS_CURRENT, CRAWL_ROOTS_CURRENT_PATH
    
    first_time_priority_done = (db.get_crawler_state("first_time_priority_done") == "true")
    first_cycle_done = (db.get_crawler_state("first_cycle_done") == "true")
    
    completed_roots_str = db.get_crawler_state("completed_roots_in_cycle")
    completed_roots = json.loads(completed_roots_str) if completed_roots_str else []
    
    # Resolve targets — D:\\ is expanded into direct subdirs
    resolve_crawl_targets()
    all_targets = build_all_targets()
            
    remaining_roots = [t for t in all_targets if t not in completed_roots]
    
    return {
        "initial_crawl_completed": first_cycle_done,
        "first_time_priority_done": first_time_priority_done,
        "first_cycle_done": first_cycle_done,
        "completed_roots": completed_roots,
        "remaining_roots": remaining_roots,
        "roots_total": len(all_targets),
        "roots_current": CRAWL_ROOTS_CURRENT,
        "current_root_path": CRAWL_ROOTS_CURRENT_PATH,
        "watchdog_active": (WATCHDOG_OBSERVER is not None and WATCHDOG_OBSERVER.is_alive())
    }

def force_recrawl():
    global FORCE_RESET_FLAG, WATCHDOG_OBSERVER, CRAWL_THREAD
    log_message("[Crawler] Manual full recrawl requested.")
    
    if WATCHDOG_OBSERVER is not None:
        try:
            WATCHDOG_OBSERVER.stop()
            WATCHDOG_OBSERVER.join()
        except Exception:
            pass
        WATCHDOG_OBSERVER = None
        
    FORCE_RESET_FLAG = True
    
    # Ensure crawler is running
    if CRAWL_THREAD is None or not CRAWL_THREAD.is_alive():
        # Clean state in DB and flags before starting fresh thread
        db.set_crawler_state("first_time_priority_done", "false")
        db.set_crawler_state("first_cycle_done", "false")
        db.set_crawler_state("completed_roots_in_cycle", "[]")
        global STARTUP_PRIORITY_SCAN_COMPLETED
        STARTUP_PRIORITY_SCAN_COMPLETED = False
        FORCE_RESET_FLAG = False
        CRAWL_THREAD = threading.Thread(target=run_crawl, name="YukiFileCrawler", daemon=True)
        CRAWL_THREAD.start()

# --- Entry Points ---

CRAWL_THREAD = None

def start_crawler_services():
    """
    Main entry point. Initializes DB and spawns the background threads.
    """
    global CRAWL_THREAD
    db.init_db()
    
    if CRAWL_THREAD is None or not CRAWL_THREAD.is_alive():
        CRAWL_THREAD = threading.Thread(target=run_crawl, name="YukiFileCrawler", daemon=True)
        CRAWL_THREAD.start()
    
    # 2. Run metadata tagger loop in a separate thread
    tagger_thread = threading.Thread(target=run_metadata_enrichment_loop, name="YukiMetadataTagger", daemon=True)
    tagger_thread.start()
