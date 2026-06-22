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
TAGGER_LOG_FILE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "metadata_tagger.log")

def log_tagger(message: str):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {message}"
    try:
        with open(TAGGER_LOG_FILE_PATH, "a", encoding="utf-8") as f:
            f.write(formatted + "\n")
    except Exception:
        pass

LAST_LOG_CLEANUP_TIME = 0.0

def cleanup_old_logs():
    """Wipes log entries older than 7 days from crawler and tagger logs, rate-limited to once a day."""
    global LAST_LOG_CLEANUP_TIME
    now = time.time()
    if now - LAST_LOG_CLEANUP_TIME < 86400:
        return
    LAST_LOG_CLEANUP_TIME = now
    
    import datetime
    cutoff = datetime.datetime.now() - datetime.timedelta(days=7)
    for log_path in (LOG_FILE_PATH, TAGGER_LOG_FILE_PATH):
        if not os.path.exists(log_path):
            continue
        try:
            new_lines = []
            with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
            
            current_keep = True
            for line in lines:
                match = re.match(r'^\[(\d{4}-\d{2}-\d{2})\b', line)
                if match:
                    try:
                        line_date = datetime.datetime.strptime(match.group(1), "%Y-%m-%d")
                        current_keep = line_date >= cutoff
                    except Exception:
                        pass
                if current_keep:
                    new_lines.append(line)
            
            if len(new_lines) < len(lines):
                with open(log_path, "w", encoding="utf-8") as f:
                    f.writelines(new_lines)
        except Exception:
            pass

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

def _set_force_reset_flag(value: bool, context: str = ""):
    """Set FORCE_RESET_FLAG with logging."""
    global FORCE_RESET_FLAG
    if FORCE_RESET_FLAG != value:
        log_message(f"[DEBUG] FORCE_RESET_FLAG: {FORCE_RESET_FLAG} -> {value} ({context})")
        FORCE_RESET_FLAG = value

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
        log_message("[DEBUG] check_idle_and_game_pacing: FORCE_RESET_FLAG=True, raising CrawlAbortException")
        raise CrawlAbortException()
        
    was_suspended = False
    while True:
        if FORCE_RESET_FLAG:
            log_message("[DEBUG] check_idle_and_game_pacing (loop): FORCE_RESET_FLAG=True, raising CrawlAbortException")
            raise CrawlAbortException()
            
        # 1. Check if user paused crawler manually
        while FILE_CRAWLER_PAUSED:
            if FORCE_RESET_FLAG:
                log_message("[DEBUG] check_idle_and_game_pacing (paused): FORCE_RESET_FLAG=True, raising CrawlAbortException")
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

def log_memory_stats(context: str = ""):
    """Log current process memory usage (RSS, VMS, pagefile)"""
    try:
        import psutil, os
        p = psutil.Process(os.getpid())
        mi = p.memory_info()
        log_message(f"[MEM] {context} RSS={mi.rss/1024/1024:.1f}MB VMS={mi.vms/1024/1024:.1f}MB Pagefile={getattr(mi, 'pagefile', 0)/1024/1024:.1f}MB Private={getattr(mi, 'private', 0)/1024/1024:.1f}MB")
    except Exception as e:
        log_message(f"[MEM] Failed to log memory: {e}")

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
    '.jar': 'program', '.pyw': 'program', '.vbs': 'program', '.url': 'program'
}

CRAWL_DRIVES = []
CRAWL_FOLDERS = []
PRIORITY_FOLDERS = []

def build_all_targets() -> List[str]:
    """
    Builds the ordered list of scan root targets.
    Expands every data drive into its direct subdirectories AND their immediate
    subfolders (Level 2 subdirectories) so that each subfolder is tracked individually
    in completed_roots — giving highly granular resume checkpointing.
    Order: priority folders → each drive's nested subdirs → user home folders.
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

    # 3. User home folders
    for f in CRAWL_FOLDERS:
        _add(f)

    return targets

# Basenames of system directories to exclude on every detected drive (Windows).
_EXCLUDED_WIN_BASENAMES = [
    "WUDownloadCache",       # Windows Update download cache
    "WpSystem",              # Windows Phone system partition
    "WindowsApps",           # UWP app binaries (system-managed)
    "msdownld.tmp",          # IE/Edge temporary download folder
    "DeliveryOptimization",  # Windows Delivery Optimization cache
    "$RECYCLE.BIN",          # Recycle Bin
    "System Volume Information",
]

# Directories that should NEVER be scanned — built dynamically per detected drive.
EXCLUDED_DIRS: List[str] = []

# Folder path keyword constraints: maps a substring pattern in the folder path to the allowed extension(s).
# If the path contains the keyword (case-insensitive), ONLY files with one of the allowed extensions are accepted.
FOLDER_EXTENSION_CONSTRAINTS = {
    # Games and program directories: only index .exe files
    "steam": {".exe"},
    "games": {".exe"},
    "epic games": {".exe"},
    "origin": {".exe"},
    "riot games": {".exe"},
    "blizzard": {".exe"},
    "ubisoft": {".exe"},
    "gog": {".exe"},
    "program files": {".exe"},
    "programdata": {".exe"},
    "node_modules": {".exe"},
    "appdata": {".exe"},
    ".git": {".exe"},
    "bin": {".exe"},
    "obj": {".exe"},
    "windowsapps": {".exe"},
}

def should_skip_by_path_constraints(file_path: str, ext_lower: str) -> bool:
    """
    Checks if a file path matches any folder-specific extension constraints.
    Returns True if the file should be skipped (i.e. is not allowed).
    """
    path_lower = file_path.lower()
    for pattern, allowed_extensions in FOLDER_EXTENSION_CONSTRAINTS.items():
        if pattern in path_lower:
            if ext_lower not in allowed_extensions:
                return True
    return False

# Every single word here will only trigger a skip if the folder name is an EXACT match
DIR_BLACKLIST_KEYWORDS = {
    # System folder names
    "windows", "appdata", "programdata", "$recycle.bin", "system volume information",
    "deliveryoptimization", "msdownld.tmp",
    
    # Generic temporary / backup folder names
    "stg-backup", "dist", "build", "assets","res", "fonts","koe","temp", "tmp", "cache", "backup",
    
    # Dev environments and dependencies
    "node_modules", ".venv", "venv", "extensions" , "env", "target", "bin", "obj", "out", 
    "src","site-packages", "packages", "library", "projectsettings", "plugins", 
    "libcache","librarycache","appcache","httpcache","corelibs","lib", "mdf", "resource"
}

# Skip a specific folder name ONLY if it is nested under one of the specified parent/ancestor folders.
# Format: { "folder_name_to_skip": {"parent_folder_1", "parent_folder_2", ...} }
# Note: All folder names must be lowercase.
CONDITIONAL_DIR_BLACKLIST = {
    "data": {"program files", "program files (x86)"},
    "images": {"games"},
    "renpy": {"games"},
}

def _contains_blacklisted_dir_component(path: str) -> bool:
    """
    Returns True ONLY if a directory component exactly matches a blacklisted keyword,
    or begins with standard hidden/system prefixes (. or _), or matches a conditional
    blacklist rule in CONDITIONAL_DIR_BLACKLIST.
    """
    path_lower = path.lower()
    try:
        parts = Path(path_lower).parts
    except Exception:
        parts = re.split(r"[\\/]+", path_lower)

    # Clean parts and filter out empty ones
    cleaned_parts = [p.strip("\\/ :") for p in parts]
    cleaned_parts = [p for p in cleaned_parts if p]

    # 1. CONDITIONAL MATCH CHECK
    for i, part in enumerate(cleaned_parts):
        if part in CONDITIONAL_DIR_BLACKLIST:
            required_ancestors = CONDITIONAL_DIR_BLACKLIST[part]
            ancestors = set(cleaned_parts[:i])
            if not required_ancestors.isdisjoint(ancestors):
                return True

    # 2. GLOBAL EXACT MATCH CHECK
    for part in cleaned_parts:
        if part in DIR_BLACKLIST_KEYWORDS:
            return True
            
        # 3. WILDCARD SYSTEM CHECKS (Keep these to catch hidden paths like .git or __pycache__)
        if part.startswith(".") or part.startswith("_"):
            return True

    return False

def _detect_data_drives() -> List[str]:
    """
    Return a list of non-system data mount points for the current OS.
    Windows: drive letters D:-Z:  |  macOS: /Volumes/*  |  Linux: /mnt/*, /media/*
    """
    drives: List[str] = []
    if sys.platform == "win32":
        for letter in string.ascii_uppercase:
            if letter in ("A", "B", "C"):
                continue
            drive = f"{letter}:\\"
            if os.path.exists(drive):
                drives.append(drive)
    elif sys.platform == "darwin":
        volumes = Path("/Volumes")
        if volumes.exists():
            for v in sorted(volumes.iterdir()):
                if v.is_dir() and not v.name.startswith("."):
                    drives.append(str(v))
    else:
        for parent in ("/mnt", "/media"):
            base = Path(parent)
            if base.exists():
                try:
                    for d in sorted(base.iterdir()):
                        if d.is_dir():
                            drives.append(str(d))
                except PermissionError:
                    pass
    return drives


def _build_excluded_dirs(drives: List[str]) -> List[str]:
    """Build EXCLUDED_DIRS dynamically for all detected drives."""
    excluded: List[str] = []
    if sys.platform == "win32":
        for drive in drives:
            for name in _EXCLUDED_WIN_BASENAMES:
                excluded.append(os.path.join(drive, name))
    else:
        # Linux/macOS: exclude common system dirs at root level
        for name in ("$RECYCLE.BIN", "System Volume Information"):
            excluded.append(os.path.join("/", name))
    return excluded


def _detect_user_folders() -> List[str]:
    """Return standard user library folders for the current OS."""
    folders: List[str] = []
    home = Path.home()
    if sys.platform == "win32":
        names = ["Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos", "OneDrive"]
    elif sys.platform == "darwin":
        names = ["Desktop", "Documents", "Downloads", "Music", "Pictures", "Movies"]
    else:
        names = ["Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos"]
    for name in names:
        candidate = home / name
        if candidate.exists():
            folders.append(str(candidate))
    return folders


def _detect_program_dirs() -> List[str]:
    """Return Program Files / application directories for the current OS."""
    dirs: List[str] = []
    if sys.platform == "win32":
        for var in ("ProgramFiles", "ProgramFiles(x86)"):
            val = os.environ.get(var)
            if val and os.path.isdir(val):
                dirs.append(val)
    elif sys.platform == "darwin":
        apps = Path("/Applications")
        if apps.is_dir():
            dirs.append(str(apps))
    else:
        for d in ("/usr/bin", "/usr/local/bin"):
            if os.path.isdir(d):
                dirs.append(d)
    return dirs


def resolve_crawl_targets():
    """
    Finds default crawl targets: user folders, data drives, and program directories.
    Cross-platform: works on Windows, macOS, and Linux.
    """
    global CRAWL_DRIVES, CRAWL_FOLDERS, PRIORITY_FOLDERS, EXCLUDED_DIRS
    CRAWL_DRIVES.clear()
    CRAWL_FOLDERS.clear()
    PRIORITY_FOLDERS.clear()

    # --- Priority folders: env override or common home directories ---
    env_priority = os.environ.get("YUKI_CRAWLER_PRIORITY_PATHS", "").strip()
    if env_priority:
        for p in env_priority.split(","):
            p = p.strip()
            if p and os.path.exists(p):
                PRIORITY_FOLDERS.append(p)
    else:
        home = Path.home()
        for name in ("Downloads", "Videos", "Music", "Documents"):
            candidate = home / name
            if candidate.exists():
                PRIORITY_FOLDERS.append(str(candidate))

    # --- Data drives ---
    CRAWL_DRIVES = _detect_data_drives()

    # Apply user-configured primary drive priority
    primary_drive = config.CRAWLER_PRIMARY_DRIVE
    if primary_drive:
        # Normalise: ensure trailing separator for Windows, trailing slash for Unix
        if sys.platform == "win32" and not primary_drive.endswith("\\"):
            primary_drive += "\\"
        elif not primary_drive.endswith("/"):
            primary_drive += "/"
        if primary_drive in CRAWL_DRIVES:
            CRAWL_DRIVES.remove(primary_drive)
        CRAWL_DRIVES.insert(0, primary_drive)

    # --- Build per-drive excluded dirs ---
    EXCLUDED_DIRS = _build_excluded_dirs(CRAWL_DRIVES)

    # --- User home folders ---
    CRAWL_FOLDERS = _detect_user_folders()

    # --- Program / application directories ---
    for prog_dir in _detect_program_dirs():
        if prog_dir not in CRAWL_FOLDERS:
            CRAWL_FOLDERS.append(prog_dir)

def _is_game_or_program_dir(dir_path: str) -> bool:
    """
    Returns True if the directory path belongs to a game library,
    standard Program Files, build output, or system application data.
    """
    path_lower = dir_path.lower()
    # Find all patterns in FOLDER_EXTENSION_CONSTRAINTS that restrict files to .exe
    patterns = [pat for pat, allowed in FOLDER_EXTENSION_CONSTRAINTS.items() if allowed == {".exe"}]
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
            
    # Video songs / Music videos heuristics: classify as song if path contains music/video songs keywords
    if category == "movie":
        path_lower = file_path.lower()
        song_keywords = ["video songs", "video song", "music video", "music-video", "soundtrack", "ost", "singles", "mv"]
        if any(kw in path_lower for kw in song_keywords):
            category = "song"
            
    return category


def parse_filename_metadata(filename: str) -> Dict[str, Any]:
    """
    Lightweight local regex heuristic to extract titles, creators, and years from file names.
    E.g. "Linkin Park - In The End (Official).mp3" or "Inception (2010) [1080p].mkv"
    """
    name_without_ext, _ = os.path.splitext(filename)
    name_without_ext = name_without_ext.replace('_', ' ')
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
        
    # Clean up common video metadata residue (e.g. 1080p, BluRay, x264, web-dl, eng sub, etc.)
    clean_name = re.sub(r'(?i)\b(1080p|720p|4k|2160p|bluray|x264|x265|hevc|web-dl|webrip|hdtv|aac|dd5\.1|dts|eng\s*sub|subbed|subtitle|sub|official\s*video|official\s*audio|music\s*video|mv|pv|full|hd)\b', ' ', name_without_ext)
    clean_name = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', clean_name) # Remove bracket contents
    
    # Split on " by " if it exists to extract artist
    by_match = re.search(r'(?i)\s+by\s+', clean_name)
    if by_match:
        idx = by_match.start()
        artist_candidate = clean_name[idx + by_match.end() - by_match.start():].strip()
        artist_candidate = re.sub(r'(?i)\b(official|video|audio|lyrics|hd|mv|pv)\b', ' ', artist_candidate)
        artist_candidate = ' '.join(artist_candidate.split()).strip('_ -')
        if artist_candidate:
            metadata["artist_or_creator"] = artist_candidate
            
    clean_name = ' '.join(clean_name.split()).strip('_ -')

    # Parse Artist if " - " exists, but keep the full clean name as the title
    if " - " in clean_name and not metadata["artist_or_creator"]:
        parts = clean_name.split(" - ", 1)
        metadata["artist_or_creator"] = parts[0].strip()
        
    metadata["title"] = clean_name
        
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
    log_memory_stats(f"scan_target_root START {root_dir}")
    
    CRAWL_ROOTS_CURRENT_PATH = root_dir
    if not os.path.exists(root_dir):
        log_memory_stats(f"scan_target_root SKIP (not exists) {root_dir}")
        return

    if _contains_blacklisted_dir_component(root_dir):
        log_message(f"[Crawler] Skipping blacklisted root path: {root_dir}")
        log_memory_stats(f"scan_target_root SKIP (blacklisted) {root_dir}")
        return
        
    all_seen_file_paths = set()
    folders_scanned = 0
    folders_skipped = 0
    total_files_scanned = 0
    new_files_indexed = 0
    modified_files_updated = 0
    orphans = []
    
    # Only print indexing path if it's one of the main drives/folders to avoid log flooding
    if root_dir in PRIORITY_FOLDERS or root_dir in CRAWL_DRIVES or root_dir in CRAWL_FOLDERS or len(all_targets) <= 15:
        log_message(f"[Crawler] Indexing target path: {root_dir}")
        
    excluded_lower = [e.lower() for e in EXCLUDED_DIRS]

    # Single connection for entire scan
    conn = db.get_connection()
    try:
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
            cached_dir = db.get_directory(root, conn=conn)
            
            # Smart Folder Skip Optimization: use shared connection
            if cached_dir and cached_dir["last_modified"] == current_mtime:
                folders_skipped += 1
                # Use streaming query instead of fetchall()
                like_pattern = os.path.join(root, "%")
                for row in conn.execute("SELECT file_path FROM files WHERE file_path LIKE ?", (like_pattern,)):
                    cf_path = row["file_path"]
                    if os.path.dirname(cf_path) == root:
                        all_seen_file_paths.add(cf_path)
                        total_files_scanned += 1
                continue
                
            folders_scanned += 1
            folder_changes_detected = False
            
            for file in files:
                full_path = os.path.join(root, file)
                CURRENT_CRAWL_PATH = full_path
                _, ext = os.path.splitext(file)
                ext_lower = ext.lower()
                
                # ─── PURE WHITELIST GUARD CLAUSE ───
                # If the extension isn't explicitly tracked in your categories, skip it instantly!
                if ext_lower not in EXT_CATEGORIES:
                    continue
                    
                if should_skip_by_path_constraints(full_path, ext_lower):
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
                
                existing_file = db.get_file_by_path(full_path, conn=conn)
                if not existing_file:
                    folder_changes_detected = True
                    new_files_indexed += 1
                    log_message(f"[Crawler] [NEW] Indexed file: '{full_path}' (guessed category: {category}) - successfully added to db")
                    file_id = db.upsert_file(full_path, file, parent_folder, ext, f_size, f_mtime, category, conn=conn)
                    
                    if file_id != -1 and category in ('movie', 'song'):
                        meta = parse_filename_metadata(file)
                        db.upsert_metadata(
                            file_id, 
                            meta["title"], 
                            meta["artist_or_creator"], 
                            meta["genre_or_tags"], 
                            meta["release_year"], 
                            meta["alternate_titles"],
                            enriched=0,
                            conn=conn
                        )
                elif existing_file["size"] != f_size or existing_file["last_modified"] != f_mtime:
                    folder_changes_detected = True
                    modified_files_updated += 1
                    log_message(f"[Crawler] [MODIFIED] Updated stats for file: '{full_path}' - successfully added to db")
                    db.upsert_file(full_path, file, parent_folder, ext, f_size, f_mtime, category, conn=conn)
            
            change_increment = 1 if folder_changes_detected else 0
            db.upsert_directory(root, current_mtime, change_increment, conn=conn)
            
        # --- Localized Orphan File Cleanup (streaming) ---
        search_prefix = root_dir if root_dir.endswith(os.sep) else root_dir + os.sep
        like_pattern = search_prefix + "%"
        
        orphans = []
        for row in conn.execute("SELECT file_path FROM files WHERE file_path LIKE ?", (like_pattern,)):
            path = row["file_path"]
            if should_handle_orphan(path, root_dir, all_targets):
                if path not in all_seen_file_paths:
                    if not os.path.exists(path):
                        orphans.append(path)
                        
        if orphans:
            log_message(f"[Crawler] Found {len(orphans)} deleted files under '{root_dir}'. Removing from database...")
            db.delete_files_by_paths(orphans)
            
        # --- Clean up Zombie Directories Cache (streaming) ---
        dead_directories = []
        for row in conn.execute("SELECT path FROM directories WHERE path LIKE ?", (like_pattern,)):
            dir_path = row["path"]
            if not os.path.exists(dir_path):
                dead_directories.append(dir_path)
                
        if dead_directories:
            log_message(f"[Crawler] Found {len(dead_directories)} deleted folders under '{root_dir}'. Purging directory cache...")
            try:
                batch_size = 500
                for i in range(0, len(dead_directories), batch_size):
                    batch = dead_directories[i:i+batch_size]
                    placeholders = ",".join("?" for _ in batch)
                    conn.execute(f"DELETE FROM directories WHERE path IN ({placeholders})", batch)
                conn.commit()
            except Exception as e:
                log_message(f"[Crawler] Error purging dead directories cache: {e}")
                
        # Commit all directory, file, and metadata changes at the end of the root scan
        conn.commit()
    except Exception as e:
        log_message(f"[Crawler] Error scanning root {root_dir}: {e}")
        try:
            conn.rollback()
        except:
            pass
    finally:
        conn.close()
            
    log_message(f"[Crawler] Root '{root_dir}' scan summary: Scanned={folders_scanned}, Skipped={folders_skipped}, TotalFiles={total_files_scanned}, New={new_files_indexed}, Mod={modified_files_updated}, Deleted={len(orphans)}")
    log_memory_stats(f"scan_target_root END {root_dir}")

def sleep_pacing_between_cycles(seconds: float):
    global CURRENT_CRAWL_PATH
    start_t = time.time()
    while time.time() - start_t < seconds:
        if FORCE_RESET_FLAG:
            log_message("[DEBUG] sleep_pacing_between_cycles: FORCE_RESET_FLAG=True, raising CrawlAbortException")
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
        log_memory_stats("run_crawl START")
        cleanup_old_logs()
        resolve_crawl_targets()
        
        # Start watchdog immediately if we've already done a full first cycle
        first_cycle_done_init = (db.get_crawler_state("first_cycle_done") == "true")
        log_message(f"[DEBUG] Startup check: first_cycle_done from DB = {first_cycle_done_init}")
        if first_cycle_done_init:
            log_message("[Crawler] First cycle already done. Starting watchdog service on startup.")
            if not start_watchdog_services():
                log_message("[Crawler] ERROR: Watchdog failed to start on startup!")
        else:
            log_message("[DEBUG] first_cycle_done is false, watchdog NOT started on startup")
            
        # Check reset flag
        if FORCE_RESET_FLAG:
            _set_force_reset_flag(False, "run_crawl entry - FORCE_RESET_FLAG was True")
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
        log_message(f"[DEBUG] Startup files_count = {files_count}")
        
        if files_count == 0:
            log_message("[Crawler] Database files table is empty! Resetting crawler state and clearing directories cache to trigger a full re-index.")
            log_message("[DEBUG] Empty files table -> setting first_time_priority_done=false, first_cycle_done=false")
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
        log_message(f"[DEBUG] State from DB: first_time_priority_done={first_time_priority_done}, first_cycle_done={first_cycle_done}")
        
        completed_roots_str = db.get_crawler_state("completed_roots_in_cycle")
        completed_roots = json.loads(completed_roots_str) if completed_roots_str else []
        log_message(f"[DEBUG] completed_roots_in_cycle count: {len(completed_roots)}")
        
        # Build targets — data drives are expanded into direct subdirs for subfolder-level resume
        all_targets = build_all_targets()
        CRAWL_ROOTS_TOTAL = len(all_targets)
        log_memory_stats(f"build_all_targets DONE roots={CRAWL_ROOTS_TOTAL}")
        
        # If the first cycle is already complete, run a full new cycle (but keep first_cycle_done/first_time_priority_done as true)
        if first_cycle_done:
            log_message("[Crawler] First cycle is complete. Starting a new full crawl cycle...")
            completed_roots = []
            db.set_crawler_state("completed_roots_in_cycle", json.dumps(completed_roots))
            
            for idx, root_dir in enumerate(all_targets):
                log_message(f"[DEBUG] New cycle: scanning root {idx+1}/{len(all_targets)}: {root_dir}")
                check_idle_and_game_pacing()
                CRAWL_ROOTS_CURRENT = idx + 1
                scan_target_root(root_dir, all_targets)
                completed_roots.append(root_dir)
                db.set_crawler_state("completed_roots_in_cycle", json.dumps(completed_roots))
            
            # Cycle complete - clear completed roots but keep first_cycle_done/first_time_priority_done true
            completed_roots = []
            db.set_crawler_state("completed_roots_in_cycle", json.dumps(completed_roots))
            
            # Start watchdog service
            if not start_watchdog_services():
                log_message("[Crawler] ERROR: Watchdog failed to start after cycle completion!")
            log_message("[Crawler] Crawler cycle finished. Going to sleep (Watchdog is active).")
            log_memory_stats("run_crawl CYCLE_COMPLETE")
            
            CURRENT_CRAWL_PATH = "Idle"
            CRAWL_ROOTS_CURRENT_PATH = "Idle"
            return
            
        # Scenario A: First time priority scan is NOT done yet
        if not first_time_priority_done:
            log_message("[Crawler] First-time priority scan not done. Initiating priority scan...")
            priority_targets = list(PRIORITY_FOLDERS)
            
            # Scan priority folders
            for idx, root_dir in enumerate(priority_targets):
                log_message(f"[DEBUG] Priority scan: scanning root {idx+1}/{len(priority_targets)}: {root_dir}")
                check_idle_and_game_pacing()
                CRAWL_ROOTS_CURRENT = idx + 1
                
                if root_dir in completed_roots:
                    log_message(f"[DEBUG] Priority scan: skipping already completed root: {root_dir}")
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
                log_message(f"[DEBUG] Startup sweep: scanning root {idx+1}/{len(PRIORITY_FOLDERS)}: {root_dir}")
                check_idle_and_game_pacing()
                CRAWL_ROOTS_CURRENT = idx + 1
                scan_target_root(root_dir, all_targets)
            STARTUP_PRIORITY_SCAN_COMPLETED = True
            log_message("[Crawler] App startup sweep of priority folders completed.")
            
        # Now, run/resume the cycle for all remaining folders
        log_message(f"[Crawler] Running/Resuming cycle (completed: {len(completed_roots)}/{len(all_targets)})...")
        
        for idx, root_dir in enumerate(all_targets):
            log_message(f"[DEBUG] Resume cycle: scanning root {idx+1}/{len(all_targets)}: {root_dir}")
            check_idle_and_game_pacing()
            CRAWL_ROOTS_CURRENT = idx + 1
            
            if root_dir in completed_roots:
                log_message(f"[DEBUG] Resume cycle: skipping already completed root: {root_dir}")
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
        if not start_watchdog_services():
            log_message("[Crawler] ERROR: Watchdog failed to start after cycle completion!")
        log_message("[Crawler] Crawler cycle finished. Going to sleep (Watchdog is active).")
        log_memory_stats("run_crawl CYCLE_COMPLETE")
        
    except CrawlAbortException:
        log_message("[Crawler] Crawl walk aborted for reset (CrawlAbortException caught).")
        db.set_crawler_state("first_time_priority_done", "false")
        db.set_crawler_state("first_cycle_done", "false")
        db.set_crawler_state("completed_roots_in_cycle", "[]")
        _set_force_reset_flag(False, "CrawlAbortException handler")
        STARTUP_PRIORITY_SCAN_COMPLETED = False
        # Re-trigger crawl walk from scratch
        crawl_thread = threading.Thread(target=run_crawl, name="YukiFileCrawler", daemon=True)
        global CRAWL_THREAD
        CRAWL_THREAD = crawl_thread
        crawl_thread.start()
        return
        
    CURRENT_CRAWL_PATH = "Idle"
    CRAWL_ROOTS_CURRENT_PATH = "Idle"
    log_memory_stats("run_crawl END")

# --- Asynchronous AI Metadata Enrichment Worker ---

def recover_corrupt_utf8(s: str) -> str:
    """Helper to convert double-decoded CP1252/latin-1 strings back to UTF-8 on Windows."""
    if not s:
        return s
    # Direct replacement for common Windows-1252 double-decoded Japanese brackets
    # where the trailing byte might have been discarded as invalid CP1252
    replacements = {
        'ã€Ž': '『',
        'ã€ ': '』',
        'ã€Œ': '「',
        'ã€\x8d': '」',
        'ã€\x8f': '』',
        'ã€\x90': '【',
        'ã€\x91': '】',
    }
    for corrupt, correct in replacements.items():
        s = s.replace(corrupt, correct)
        
    if any(c in s for c in ('ã€', 'å', 'é', 'ç')):
        for enc in ('cp1252', 'latin-1'):
            try:
                candidate = s.encode(enc).decode('utf-8')
                if len(candidate) < len(s):
                    return candidate
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
    return s

def clean_musicbrainz_query(title: str, artist: str = "") -> tuple:
    """
    Cleans up track titles and artist names to improve MusicBrainz search accuracy.
    Removes common noise like bracketed text, featuring artist markers, and video suffixes.
    """
    if not title:
        return "", ""
    t = recover_corrupt_utf8(title)
    a = recover_corrupt_utf8(artist)
    t = t.replace('_', ' ')
    a = a.replace('_', ' ')
    
    # Extract song title from Japanese brackets if present (closed)
    bracket_match = re.search(r'^(.*?)[「『【]([^」』】]+)[」』】](.*)$', t)
    if bracket_match:
        prefix = bracket_match.group(1).strip()
        bracket_content = bracket_match.group(2).strip()
        suffix = bracket_match.group(3).strip()
        is_noise_only = re.match(r'(?i)^[a-z0-9\s_\-\.\(\)\[\]\{\}]*$', bracket_content) and re.match(r'(?i)^(full|mv|pv|op|ed|ost|hd|1080p|720p|eng\s*sub|sub|lyrics|official\s*video|official\s*audio|clean|creditless|opening|ending|clip|off\s*vocal|instrumental|inst|tv\s*size|tv\s*ver|tv)$', bracket_content.strip())
        if not is_noise_only:
            t = bracket_content
            by_match = re.search(r'(?i)\b(?:by|cv)\s+([^「『【\(\[\{]+)', prefix + " " + suffix)
            if by_match:
                a_candidate = by_match.group(1).strip()
                a_candidate = re.sub(r'(?i)\b(full|hd|mv|pv|opening|ending|creditless|official|video|audio|lyrics)\b', ' ', a_candidate)
                a_candidate = ' '.join(a_candidate.split()).strip('_ -')
                if a_candidate:
                    a = a_candidate
            elif not a and prefix:
                clean_pref = re.sub(r'(?i)\b(1080p|720p|4k|2160p|bluray|x264|x265|hevc|web-dl|webrip|hdtv|aac|dd5\.1|dts|eng\s*sub|subbed|subtitle|sub|official\s*video|official\s*audio|music\s*video|mv|pv|full|hd)\b', ' ', prefix)
                clean_pref = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', clean_pref)
                clean_pref = ' '.join(clean_pref.split()).strip('_ -')
                if not re.search(r'(?i)\b(op|ed|ost|theme|opening|ending|insert|soundtrack|episode|ep)\b', clean_pref):
                    a = clean_pref
    else:
        # Check for unclosed brackets
        for open_b, close_b in [('「', '」'), ('『', '』'), ('【', '】')]:
            if open_b in t and close_b not in t:
                parts = t.split(open_b, 1)
                prefix = parts[0].strip()
                bracket_content = parts[1].strip()
                is_noise_only = re.match(r'(?i)^[a-z0-9\s_\-\.\(\)\[\]\{\}]*$', bracket_content) and re.match(r'(?i)^(full|mv|pv|op|ed|ost|hd|1080p|720p|eng\s*sub|sub|lyrics|official\s*video|official\s*audio|clean|creditless|opening|ending|clip|off\s*vocal|instrumental|inst|tv\s*size|tv\s*ver|tv)$', bracket_content.strip())
                if not is_noise_only:
                    t = bracket_content
                    if not a and prefix:
                        clean_pref = re.sub(r'(?i)\b(1080p|720p|4k|2160p|bluray|x264|x265|hevc|web-dl|webrip|hdtv|aac|dd5\.1|dts|eng\s*sub|subbed|subtitle|sub|official\s*video|official\s*audio|music\s*video|mv|pv|full|hd)\b', ' ', prefix)
                        clean_pref = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', clean_pref)
                        clean_pref = ' '.join(clean_pref.split()).strip('_ -')
                        if not re.search(r'(?i)\b(op|ed|ost|theme|opening|ending|insert|soundtrack|episode|ep)\b', clean_pref):
                            a = clean_pref
                break
                
    # Always split on common delimiters to separate artist and track title (NEVER split on single "-" without spaces!)
    for delim in (" - ", " | ", " / ", " ~ "):
        if delim in t:
            parts = t.split(delim, 1)
            split_artist = parts[0].strip()
            split_title = parts[1].strip()
            # If no artist is given, or if the split artist aligns with our artist
            if not a or a.lower() in split_artist.lower() or split_artist.lower() in a.lower():
                a = split_artist
                t = split_title
                break
                
    if " by " in t.lower() and not a:
        by_match = re.search(r'(?i)\s+by\s+', t)
        if by_match:
            idx = by_match.start()
            a_candidate = t[idx + by_match.end() - by_match.start():].strip()
            t = t[:idx].strip()
            a = a_candidate
            
    # Remove featuring artist markings
    t = re.split(r'(?i)\b(?:ft|feat|featuring|with|ft\.|feat\.)\b', t)[0].strip()
    
    # Remove bracketed contents
    t = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', t)
    a = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', a)
    
    # Remove general noise
    noise_patterns = [
        r'(?i)\b(?:official|video|audio|lyrics|lyric|full|hd|4k|1080p|720p|hdtv|bluray|webrip|web-dl|eng\s*sub|subbed|subtitle|sub)\b',
        r'(?i)\b(?:mv|pv)\b',
        r'(?i)\b(?:www\.)?[a-z0-9\-]+\.(?:com|net|org|in|co|info|biz|me|cc|info|xyz|to|ninja|site|club|ws)\b',
        r'\bw/\b',
        r'[\uFFFD\uFF08\uFF09\uFF3B\uFF5D\u3010\u3011\u300C\u300D\u300E\u300F\u00AB\u00BB\u201C\u201D\u2018\u2019]'
    ]
    for pattern in noise_patterns:
        t = re.sub(pattern, ' ', t)
        a = re.sub(pattern, ' ', a)
        
    # Normalize spaces
    t = " ".join(t.split()).strip('_ -/\\|~')
    a = " ".join(a.split()).strip('_ -/\\|~')
    
    # Heuristic for Aimer files
    if not a and t.lower().startswith("aimer"):
        a = "Aimer"
        t = t[5:].strip('_ -')
        
    return t, a

def query_musicbrainz_api(title: str, artist: str = "") -> dict:
    """
    Queries the MusicBrainz Search API for track details using title and artist.
    Searches the top 5 matches to merge and pull missing release years and tags/genres.
    Enforces a 1-second rate-limiting delay to follow guidelines.
    """
    headers = {
        "User-Agent": "YukiMusicTagger/1.0.0 ( contact: https://github.com/dekkeroid/Project-Yuki )"
    }
    
    clean_title, clean_artist = clean_musicbrainz_query(title, artist)
    
    def do_query(query_str):
        if not query_str:
            return {}
        url = "https://musicbrainz.org/ws/2/recording/"
        params = {
            "query": query_str,
            "fmt": "json",
            "limit": 5
        }
        try:
            # Enforce rate limit (max 1 req/sec)
            time.sleep(1.0)
            res = requests.get(url, params=params, headers=headers, timeout=8)
            if res.status_code == 200:
                data = res.json()
                recordings = data.get("recordings", [])
                if recordings:
                    primary = recordings[0]
                    res_title = primary.get("title")
                    artist_credit = primary.get("artist-credit", [])
                    res_artist = artist_credit[0].get("name", "") if artist_credit else ""
                    
                    # Consolidate release year and genres/tags across top 5 matches
                    res_year = None
                    all_tags = []
                    
                    for rec in recordings:
                        # Pull first available release year
                        if not res_year:
                            releases = rec.get("releases", [])
                            if releases:
                                date_str = releases[0].get("date", "")
                                if date_str and len(date_str) >= 4:
                                    try:
                                        res_year = int(date_str[:4])
                                    except ValueError:
                                        pass
                                        
                        # Gather unique tags across matches
                        tags = rec.get("tags", [])
                        if not tags:
                            ac = rec.get("artist-credit", [])
                            if ac:
                                for credit in ac:
                                    art_obj = credit.get("artist", {})
                                    if art_obj and art_obj.get("tags"):
                                        tags = art_obj["tags"]
                                        break
                        if not tags:
                            releases = rec.get("releases", [])
                            if releases:
                                tags = releases[0].get("tags", [])
                                
                        for t_obj in tags:
                            name = t_obj.get("name", "").lower()
                            if name and name not in all_tags:
                                all_tags.append(name)
                                
                    res_genres = ", ".join(all_tags[:5])
                    return {
                        "title": res_title or title,
                        "artist": res_artist or artist,
                        "year": res_year,
                        "genres": res_genres
                    }
        except Exception as e:
            log_message(f"[Tagger] MusicBrainz API query error: {e}")
        return {}

    # Attempt 1: Artist + Title query
    query_parts = []
    if clean_title:
        query_parts.append(f'recording:"{clean_title}"')
    if clean_artist:
        query_parts.append(f'artist:"{clean_artist}"')
        
    query_str = " AND ".join(query_parts) if query_parts else clean_title
    
    result = do_query(query_str)
    # Attempt 2: Fallback query using title only
    if not result and clean_artist and clean_title:
        log_message(f"[Tagger] MusicBrainz Query failed with artist '{clean_artist}'. Retrying with title only: '{clean_title}'")
        result = do_query(f'recording:"{clean_title}"')
        
    return result

# --- Asynchronous Local & MusicBrainz Metadata Enrichment Worker ---

def run_metadata_enrichment_loop():
    """
    Polls the database for files marked for enrichment (enriched=0).
    Extracts metadata using tinytag (local) and MusicBrainz API (remote fallback).
    """
    global CURRENT_TAGGER_PATH
    log_message("[Tagger] Starting metadata enrichment background worker...")
    while True:
        cleanup_old_logs()
        if METADATA_TAGGER_PAUSED:
            time.sleep(5)
            continue
        
        # Fetch 20 unenriched media records at a time
        pending = db.get_unenriched_files(limit=20)
        if not pending:
            CURRENT_TAGGER_PATH = "Idle"
            time.sleep(10)
            continue
            
        for item in pending:
            file_id = item["id"]
            file_path = item["file_path"]
            file_name = item["file_name"]
            category = item["category"]
            
            CURRENT_TAGGER_PATH = file_path
            
            # Start with locally parsed filename regex as baseline
            local_meta = parse_filename_metadata(file_name)
            title = local_meta["title"]
            artist = local_meta["artist_or_creator"]
            year = local_meta["release_year"]
            genres = local_meta["genre_or_tags"]
            alt_titles = local_meta["alternate_titles"]
            
            # Track sources of resolved metadata fields
            meta_sources = {
                "title": "regex",
                "artist": "regex" if local_meta["artist_or_creator"] else "none",
                "genres": "regex" if local_meta["genre_or_tags"] else "none",
                "year": "regex" if local_meta["release_year"] else "none"
            }
            
            did_query_musicbrainz = False
            mb_query_str = ""
            mb_response_summary = "No response"
            
            # 1. Try local audio metadata extraction first if it's a song
            if category == 'song':
                try:
                    from tinytag import TinyTag
                    if os.path.exists(file_path):
                        tag = TinyTag.get(file_path)
                        if tag.title:
                            title = tag.title
                            meta_sources["title"] = "tinytag"
                        if tag.artist:
                            artist = tag.artist
                            meta_sources["artist"] = "tinytag"
                        if tag.genre:
                            genres = tag.genre
                            meta_sources["genres"] = "tinytag"
                        if tag.year:
                            try:
                                year_match = re.search(r'\b(19\d\d|20\d\d)\b', str(tag.year))
                                if year_match:
                                    year = int(year_match.group(1))
                                    meta_sources["year"] = "tinytag"
                            except Exception:
                                pass
                except Exception as e:
                    log_message(f"[Tagger] tinytag failed for '{file_name}': {e}")
                    
                # 2. If tags (title, artist, or genre) are empty or generic, query MusicBrainz API
                if not artist or not title or not genres or artist.lower() == "unknown" or title.lower() == "unknown":
                    search_title = title if (title and title.lower() != "unknown") else local_meta["title"]
                    search_artist = artist if (artist and artist.lower() != "unknown") else local_meta["artist_or_creator"]
                    
                    if search_title:
                        # Re-calculate clean queries to log the request exactly
                        c_title, c_artist = clean_musicbrainz_query(search_title, search_artist)
                        q_parts = []
                        if c_title: q_parts.append(f'recording:"{c_title}"')
                        if c_artist: q_parts.append(f'artist:"{c_artist}"')
                        mb_query_str = " AND ".join(q_parts) if q_parts else c_title
                        
                        mb_data = query_musicbrainz_api(search_title, search_artist)
                        did_query_musicbrainz = True
                        if mb_data:
                            mb_response_summary = f"Match found (Title: '{mb_data.get('title')}', Artist: '{mb_data.get('artist')}', Genres: '{mb_data.get('genres')}', Year: '{mb_data.get('year')}')"
                            if mb_data.get("title") and (not title or title.lower() == "unknown" or meta_sources["title"] == "regex"):
                                title = mb_data["title"]
                                meta_sources["title"] = "musicbrainz"
                            if mb_data.get("artist") and (not artist or artist.lower() == "unknown" or meta_sources["artist"] == "regex"):
                                artist = mb_data["artist"]
                                meta_sources["artist"] = "musicbrainz"
                            if mb_data.get("year") and (not year or meta_sources["year"] == "regex"):
                                year = mb_data["year"]
                                meta_sources["year"] = "musicbrainz"
                            if mb_data.get("genres") and (not genres or meta_sources["genres"] in ("regex", "none")):
                                genres = mb_data["genres"]
                                meta_sources["genres"] = "musicbrainz"
                        else:
                            mb_response_summary = "No match found"
                                
            # 3. Save to database
            db.upsert_metadata(file_id, title, artist, genres, year, alt_titles, enriched=1, category=category)
            log_message(f"[Tagger] [SUCCESS] Metadata enriched for '{file_name}': title='{title}', artist='{artist}', tags='{genres}'")
            
            # Write detailed logging to metadata_tagger.log
            log_tagger(
                f"File: {file_name}\n"
                f"  Path: {file_path}\n"
                f"  Category: {category}\n"
                f"  Resolution Sources:\n"
                f"    - Title:  '{title}' Sourced via [{meta_sources['title']}]\n"
                f"    - Artist: '{artist}' Sourced via [{meta_sources['artist']}]\n"
                f"    - Genres: '{genres}' Sourced via [{meta_sources['genres']}]\n"
                f"    - Year:   '{year}' Sourced via [{meta_sources['year']}]\n"
                + (f"  MusicBrainz Query: '{mb_query_str}' -> Response: {mb_response_summary}\n" if did_query_musicbrainz else "")
                + "="*80
            )
            
            # Appropriate sleep pacing (1.0s if we hit MusicBrainz API; 50ms otherwise)
            sleep_time = 1.0 if did_query_musicbrainz else 0.05
            time.sleep(sleep_time)
            
        CURRENT_TAGGER_PATH = "Idle"
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
            
        try:
            file_path = str(Path(os.path.abspath(file_path)).resolve())
        except Exception:
            file_path = os.path.abspath(file_path)
        
        # Filter out excluded directories
        file_path_lower = file_path.lower()
        excluded_lower = [e.lower() for e in EXCLUDED_DIRS]
        if any(file_path_lower == e or file_path_lower.startswith(e + os.sep) for e in excluded_lower):
            return
            
        # Filter out blacklisted directories (e.g. venv, node_modules, .git)
        if _contains_blacklisted_dir_component(file_path):
            return
            
        file_name = os.path.basename(file_path)
        _, ext = os.path.splitext(file_name)
        ext_lower = ext.lower()
        if ext_lower not in EXT_CATEGORIES:
            return
            
        if should_skip_by_path_constraints(file_path, ext_lower):
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

def start_watchdog_services() -> bool:
    global WATCHDOG_OBSERVER
    log_memory_stats("start_watchdog_services START")
    if WATCHDOG_OBSERVER is not None:
        if WATCHDOG_OBSERVER.is_alive():
            log_message("[Watchdog] Already running.")
            log_memory_stats("start_watchdog_services ALREADY_RUNNING")
            return True
        else:
            log_message("[Watchdog] Previous observer dead, restarting...")
            WATCHDOG_OBSERVER = None
    log_message("[Watchdog] Initializing background event listener...")
    try:
        resolve_crawl_targets()
        log_memory_stats("start_watchdog_services AFTER_RESOLVE_TARGETS")
        observer = Observer()
        handler = YukiFileSystemHandler()
        
        scan_queue = []
        scan_queue.extend(PRIORITY_FOLDERS)
        for d in CRAWL_DRIVES:
            if d not in scan_queue:
                scan_queue.append(d)
        hot_dirs = db.get_hot_directories()
        if hot_dirs:
            log_message(f"[Watchdog] {len(hot_dirs)} hot directories tracked (covered by recursive root watches)")
        for f in CRAWL_FOLDERS:
            if f not in scan_queue:
                scan_queue.append(f)
                
        monitored_paths = 0
        scheduled = []
        for target in scan_queue:
            if os.path.exists(target):
                try:
                    observer.schedule(handler, target, recursive=True)
                    scheduled.append(target)
                    monitored_paths += 1
                except Exception as e:
                    log_message(f"[Watchdog] Failed to schedule path {target}: {e}")
        
        if scheduled:
            log_message(f"[Watchdog] Listening on {len(scheduled)} root paths: {', '.join(scheduled[:5])}{'...' if len(scheduled) > 5 else ''}")
                    
        if monitored_paths > 0:
            observer.start()
            WATCHDOG_OBSERVER = observer
            log_message("[Watchdog] Observer started successfully.")
            log_memory_stats("start_watchdog_services OBSERVER_STARTED")
            return True
        else:
            log_message("[Watchdog] No valid paths found to observe.")
            log_memory_stats("start_watchdog_services NO_PATHS")
            return False
    except Exception as e:
        log_message(f"[Watchdog] Failed to start: {e}")
        log_memory_stats("start_watchdog_services EXCEPTION")
        return False

def get_crawler_status_metrics() -> Dict[str, Any]:
    global CRAWL_ROOTS_TOTAL, CRAWL_ROOTS_CURRENT, CRAWL_ROOTS_CURRENT_PATH
    
    first_time_priority_done = (db.get_crawler_state("first_time_priority_done") == "true")
    first_cycle_done = (db.get_crawler_state("first_cycle_done") == "true")
    
    completed_roots_str = db.get_crawler_state("completed_roots_in_cycle")
    completed_roots = json.loads(completed_roots_str) if completed_roots_str else []
    
    # Resolve targets — data drives are expanded into direct subdirs
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
        
    _set_force_reset_flag(True, "force_recrawl() called")
    log_message("[Crawler] Manual full recrawl requested via force_recrawl().")
    
    # Ensure crawler is running
    if CRAWL_THREAD is None or not CRAWL_THREAD.is_alive():
        # Clean state in DB and flags before starting fresh thread
        db.set_crawler_state("first_time_priority_done", "false")
        db.set_crawler_state("first_cycle_done", "false")
        db.set_crawler_state("completed_roots_in_cycle", "[]")
        global STARTUP_PRIORITY_SCAN_COMPLETED
        STARTUP_PRIORITY_SCAN_COMPLETED = False
        _set_force_reset_flag(False, "force_recrawl() - thread not alive, starting fresh")
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
