import os
import string
import re
import fnmatch
import requests
import json
from typing import List, Dict, Optional
from app.memory import db
from app import config

# Define sensitive directories on Windows (all lowercase for matching)
SENSITIVE_PREFIXES = [
    "c:\\windows",
    "c:\\program files",
    "c:\\program files (x86)",
    "c:\\programdata",
    "c:\\recovery",
    "c:\\$recycle.bin",
    "c:\\system volume information",
    "c:\\users\\all users"
]

def _is_unwanted_installer_or_uninstaller(file_path: str, query: str) -> bool:
    """
    Check if a file path belongs to an installer or uninstaller,
    but only if the query itself doesn't explicitly mention 'install', 'setup', etc.
    """
    path_lower = file_path.lower()
    query_lower = query.lower()
    
    # Keywords that suggest an installer/uninstaller
    installer_keywords = ["install", "setup", "uninst", "unins", "update"]
    
    # Check if the file path contains any of these keywords, or is an MSI installer package
    has_installer_kw = any(kw in path_lower for kw in installer_keywords) or path_lower.endswith(".msi")
    if not has_installer_kw:
        return False
        
    # Check if the query itself mentions any of these keywords or 'msi'
    query_keywords = installer_keywords + ["msi"]
    query_has_installer_kw = any(kw in query_lower for kw in query_keywords)
    
    # If the path has the keyword but the query doesn't, then it's unwanted
    return not query_has_installer_kw

def _is_safe_path(path: str, write_operation: bool = False) -> bool:
    """
    Enforces security boundary.
    - Prevents editing/deleting sensitive C: drive system files.
    - Allows general searching/reading outside C:\\Windows or Program Files.
    - Prevents writing to C:\\ root directly.
    """
    try:
        abs_path = os.path.abspath(path)
    except Exception:
        return False
        
    norm = abs_path.lower()
    
    # Check if the path starts with any sensitive directory prefix
    for prefix in SENSITIVE_PREFIXES:
        if norm.startswith(prefix):
            return False
            
    # Ignore Recycle Bin and System Volume Information on all drives
    if "$recycle.bin" in norm or "system volume information" in norm:
        return False
            
    if write_operation:
        # Prevent writing directly to the root of C: (e.g. C:\boot.ini or C:\hello.txt)
        drive, tail = os.path.splitdrive(abs_path)
        if drive.lower() == "c:":
            clean_tail = tail.lstrip(os.sep)
            if not clean_tail:
                # Modifying C:\ itself
                return False
            parts = clean_tail.split(os.sep)
            if len(parts) == 1:
                # Directly in C:\ root (e.g., C:\test.txt)
                return False
                
    return True

def list_directory(directory_path: str = None) -> str:
    """
    Lists the contents (files and directories) of a specified folder.
    If no directory_path is provided, lists the available drive letters on the system.
    """
    if not directory_path or not directory_path.strip():
        # List drives
        drives = []
        for letter in string.ascii_uppercase:
            if letter in ('A', 'B'):
                continue
            drive = f"{letter}:\\"
            if os.path.exists(drive):
                drives.append(drive)
        return f"System drives: {', '.join(drives)}. Provide one of these paths to list its contents."

    path = os.path.abspath(os.path.expanduser(os.path.expandvars(directory_path.strip())))
    if not os.path.exists(path):
        return f"Error: Path '{path}' does not exist."
        
    if not os.path.isdir(path):
        return f"Error: Path '{path}' is a file, not a directory."

    if not _is_safe_path(path, write_operation=False):
        return f"Access Denied: Reading sensitive system folder '{path}' is blocked."

    try:
        items = os.listdir(path)
        if not items:
            return f"Directory '{path}' is empty."
            
        files = []
        dirs = []
        for item in items:
            full_path = os.path.join(path, item)
            if os.path.isdir(full_path):
                dirs.append(item + "/")
            else:
                files.append(item)
                
        # Limit output list length to keep the response length reasonable
        dirs_str = "Directories:\n  " + "\n  ".join(dirs[:30]) if dirs else "No directories."
        files_str = "Files:\n  " + "\n  ".join(files[:30]) if files else "No files."
        
        total_msg = f"Contents of '{path}':\n\n{dirs_str}\n\n{files_str}"
        if len(dirs) > 30 or len(files) > 30:
            total_msg += "\n\n(Note: Output truncated to first 30 entries)"
            
        return total_msg
    except Exception as e:
        return f"Error reading directory: {str(e)}"


# ---------------------------------------------------------------------------
# Stage 1 — Query Parser (pure Python, no LLM call)
# ---------------------------------------------------------------------------

# Command words to strip from title
_STOP_WORDS = {
    'play','open','find','search','show','run','start','get','watch','listen',
    'of','the','a','an','and','or','in','on','at','to','for','with','by','about',
    'is','are','was','were','be','been','being','have','has','had','do','does','did',
    'me','my','please','yuki','can','u','you','some','any','all','this','that',
    'file','files','video','audio','song','music','movie','anime','episode',
}

# Known genre labels — only these words get classified as genre search
# Includes standard genres, moods, vibes, and atmospheres
_GENRE_LABELS = {
    # Standard music genres
    'rock','jazz','pop','metal','classical','electronic','synthwave','ambient',
    'hiphop','rap','lofi','folk','country','rnb','soul','blues','punk','indie',
    'reggae','disco','edm','techno','trance','house','acoustic','orchestral',
    'kpop','jpop','vocaloid','city','phonk',
    # Moods / vibes / atmosphere
    'romantic','romance','sad','happy','funny','relaxing','relax','calm','chill',
    'energetic','hype','angry','dark','bright','upbeat','melancholic','melancholy',
    'nostalgic','peaceful','intense','dramatic','emotional','sentimental',
    'cheerful','gloomy','motivating','motivational','groovy','dreamy','epic',
    'cozy','atmospheric','bittersweet','playful','tense','suspenseful','eerie',
    'uplifting','heartbreaking','heartwarming','catchy','soothing','aggressive',
    # Video/film genres
    'anime','horror','comedy','drama','action','thriller','romance','fantasy',
    'scifi','documentary','mystery','adventure','slice','life','shounen','shoujo',
    'isekai','mecha','ecchi','hentai','asmr','vtuber','hololive','miku',
}

def parse_query_with_llm(query: str) -> Dict:
    """
    Pure-Python query parser — no LLM call, no network latency.

    Extracts:
      title   : list[str]  — individual words forming the title
      path    : list[str]  — drive/folder hints explicitly mentioned
      genre   : list[str]  — genre labels explicitly mentioned
      episode : str | None — episode/season/part reference
    """
    # ── 1. Episode extraction ────────────────────────────────────────────────
    episode: Optional[str] = None
    ep_patterns = [
        # S01E01 / s1e1 style
        (r'\b(s\d{1,2}e\d{1,3})\b',                        lambda m: m.group(1).upper()),
        # "episode 3" / "ep3" / "ep 03"
        (r'\b(?:episode|ep\.?)\s*(\d{1,3})\b',             lambda m: m.group(1)),
        # "part 2" / "pt2"
        (r'\b(?:part|pt\.?)\s*(\d{1,2})\b',                lambda m: m.group(1)),
        # "volume 1" / "vol 1"
        (r'\b(?:volume|vol\.?)\s*(\d{1,2})\b',             lambda m: m.group(1)),
    ]
    query_work = query
    for pattern, extractor in ep_patterns:
        m = re.search(pattern, query_work, re.IGNORECASE)
        if m:
            episode = extractor(m)
            # Remove the matched episode token so it doesn't pollute title
            query_work = query_work[:m.start()] + query_work[m.end():]
            break

    # ── 2. Creator extraction — names in parentheses ─────────────────────────
    creator_words: List[str] = []
    paren_matches = re.findall(r'\(([^)]+)\)', query_work)
    for match in paren_matches:
        creator_words.extend(match.lower().split())
    # Remove parenthesised segments from working query
    query_work = re.sub(r'\([^)]*\)', '', query_work)

    # ── 3. Path / drive hint extraction ──────────────────────────────────────
    path_words: List[str] = []
    # "in D drive" / "from D:" / "on C" / "D:\\" explicit references
    drive_m = re.search(r'\b(?:in|from|on)\s+([a-zA-Z])(?:\s+drive|:)', query_work, re.IGNORECASE)
    if drive_m:
        path_words.append(drive_m.group(1).lower())
        query_work = query_work[:drive_m.start()] + query_work[drive_m.end():]
    # Explicit "downloads", "desktop", "documents" folder hints
    for folder_hint in ('downloads', 'desktop', 'documents', 'music', 'videos', 'pictures'):
        if re.search(rf'\b{folder_hint}\b', query_work, re.IGNORECASE):
            path_words.append(folder_hint)

    # ── 4. Tokenise remaining query ───────────────────────────────────────────
    # Remove punctuation except hyphens between words
    cleaned = re.sub(r'[^\w\s-]', ' ', query_work)
    tokens = [t.lower() for t in cleaned.split() if t]

    genre_words: List[str] = []
    title_words: List[str] = []
    for tok in tokens:
        tok_clean = tok.strip('-')
        if not tok_clean or len(tok_clean) < 2:
            continue
        if tok_clean in _GENRE_LABELS:
            genre_words.append(tok_clean)
        elif tok_clean not in _STOP_WORDS:
            title_words.append(tok_clean)

    # Merge creator words into title (they go into filename/folder matching)
    all_title = list(dict.fromkeys(title_words + creator_words))

    print(f"[Search] Parsed → title={all_title} path={path_words} genre={genre_words} episode={episode}")
    return {"title": all_title, "path": path_words, "genre": genre_words, "episode": episode}


# ---------------------------------------------------------------------------
# Stage 2 — Database Union Search
# ---------------------------------------------------------------------------

def query_database_union(parsed: Dict, limit_raw: int = 100, categories: List[str] = None, silent: bool = False) -> List[Dict]:
    """
    Builds a SQL UNION-like query (actually a single SELECT with OR clauses)
    that returns files matching any element from:
      - title words  → file_name  OR parent_folder  (each word is its own LIKE clause)
      - path  words  → file_path  OR parent_folder
      - genre words  → genre_or_tags
    Returns up to `limit_raw` raw candidates.
    """
    title_words = parsed.get("title", [])
    path_words  = parsed.get("path",  [])
    genre_words = parsed.get("genre", [])

    if not title_words and not path_words and not genre_words:
        return []

    clauses: List[str] = []
    params:  List[str] = []

    # Title words → search file_name, parent_folder, and their transliterated versions
    for w in title_words:
        like = f"%{w}%"
        clauses.append("(f.file_name LIKE ? OR f.parent_folder LIKE ? OR f.transliterated_name LIKE ? OR f.transliterated_parent_folder LIKE ?)")
        params.extend([like, like, like, like])

    # Path words → search full file_path, parent_folder, and their transliterated versions
    for w in path_words:
        like = f"%{w}%"
        clauses.append("(f.file_path LIKE ? OR f.parent_folder LIKE ? OR f.transliterated_name LIKE ? OR f.transliterated_parent_folder LIKE ?)")
        params.extend([like, like, like, like])

    # Genre words → search genre_or_tags AND file_name/parent_folder/transliterated versions.
    # A file named "Romantic Night.mp4" and a file tagged "romantic" are both valid hits.
    for w in genre_words:
        like = f"%{w}%"
        clauses.append("(m.genre_or_tags LIKE ? OR f.file_name LIKE ? OR f.parent_folder LIKE ? OR f.transliterated_name LIKE ? OR f.transliterated_parent_folder LIKE ?)")
        params.extend([like, like, like, like, like])

    where = " OR ".join(clauses)
    category_filter = ""
    if categories:
        placeholders = ", ".join("?" for _ in categories)
        category_filter = f" AND f.category IN ({placeholders})"

    order_by_clause = "ORDER BY LENGTH(f.file_name) ASC"
    order_params = []
    exact_phrase = " ".join(title_words).strip()
    if exact_phrase:
        order_by_clause = "ORDER BY CASE WHEN f.file_name LIKE ? OR f.transliterated_name LIKE ? THEN 1 ELSE 0 END DESC, LENGTH(f.file_name) ASC"
        exact_like = f"%{exact_phrase}%"
        order_params = [exact_like, exact_like]

    sql = f"""
    SELECT f.id, f.file_path, f.file_name, f.parent_folder, f.category,
           f.size, f.last_modified, f.transliterated_name, f.transliterated_parent_folder,
           m.title, m.artist_or_creator, m.genre_or_tags,
           m.release_year, m.alternate_titles
    FROM files f
    LEFT JOIN file_metadata m ON f.id = m.file_id
    WHERE ({where}){category_filter}
    {order_by_clause}
    LIMIT ?
    """
    
    params_sql = params.copy()
    if categories:
        params_sql.extend(categories)
    params_sql.extend(order_params)
    params_sql.append(limit_raw)

    # ── Log the SQL query (params interpolated for readability) ──────────────
    if not silent:
        readable_sql = sql
        for p in params_sql:
            readable_sql = readable_sql.replace("?", repr(p), 1)
        print(f"[Search] SQL:\n{readable_sql.strip()}")

    from app.memory.db import get_connection
    conn = get_connection()
    try:
        rows = conn.execute(sql, params_sql).fetchall()
        if not silent:
            print(f"[Search] SQL returned {len(rows)} raw rows")
        return [dict(r) for r in rows]
    except Exception as e:
        if not silent:
            print(f"[Search] Union DB query failed: {e}")
        return []
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Stage 2b — Density ranking (pick top 50 before sending to LLM)
# ---------------------------------------------------------------------------

def _density_score(candidate: Dict, parsed: Dict) -> tuple:
    """
    Scores a candidate by counting keyword hits across its text fields.
    Returns (score: float, title_file_hits: int, tie_breaker: int).
    """
    file_name_lower   = (candidate.get("file_name", "") or "").lower()
    # Strip extension for exact 1:1 name matching
    file_name_no_ext, _ = os.path.splitext(file_name_lower)
    
    parent_lower      = (candidate.get("parent_folder", "") or "").lower()
    file_path_lower   = (candidate.get("file_path", "") or "").lower()
    # Extract the full directory path to catch grand-parent folders like "game folder"
    dir_path_lower    = os.path.dirname(file_path_lower)
    
    trans_name_lower   = (candidate.get("transliterated_name", "") or "").lower()
    trans_parent_lower = (candidate.get("transliterated_parent_folder", "") or "").lower()
    
    meta_combined     = " ".join([
        candidate.get("title", "") or "",
        candidate.get("alternate_titles", "") or "",
        candidate.get("genre_or_tags", "") or "",
    ]).lower()

    score = 0.0
    title_file_hits = 0
    matched_title_words = 0
    
    title_words = parsed.get("title", [])
    exact_phrase = " ".join(title_words).strip()
    
    # 1. THE EXACT MATCH NUKE
    if exact_phrase:
        if exact_phrase == file_name_no_ext or exact_phrase == trans_name_lower:
            score += 500.0  # Undisputed king
            title_file_hits += len(title_words)
        elif exact_phrase in file_name_lower or exact_phrase in trans_name_lower:
            score += 150.0  # Contains the phrase
            title_file_hits += len(title_words)
        elif exact_phrase in parent_lower or exact_phrase in trans_parent_lower:
            score += 100.0  # The immediate folder is exactly the phrase
        elif exact_phrase in dir_path_lower or exact_phrase in trans_parent_lower:
            score += 50.0   # The phrase is somewhere in the path
            
    # 2. INDIVIDUAL WORD SCORING (Additive)
    for w in title_words:
        word_matched = False
        w_pattern = rf'\b{re.escape(w)}\b'
        
        # File name match
        if re.search(w_pattern, file_name_lower) or re.search(w_pattern, trans_name_lower):
            score += 40.0
            word_matched = True
        elif w in file_name_lower or w in trans_name_lower:
            score += 15.0
            word_matched = True
            
        # Full Directory Path match
        if re.search(w_pattern, dir_path_lower) or re.search(w_pattern, trans_parent_lower):
            score += 25.0
            word_matched = True
        elif w in dir_path_lower or w in trans_parent_lower:
            score += 10.0
            
        # Metadata match
        if w in meta_combined:
            score += 5.0
            
        if word_matched:
            matched_title_words += 1
            title_file_hits += 1

    # 3. SYNERGY MULTIPLIER
    # If the search has multiple words, heavily reward files where ALL words are found
    if len(title_words) > 1 and matched_title_words > 0:
        match_ratio = matched_title_words / len(title_words)
        if match_ratio == 1.0:
            score *= 2.5  # 2.5x boost if every query word exists across the file/path
        else:
            score *= (1.0 + match_ratio)

    # 4. PATH AND GENRE HINTS
    for w in parsed.get("path", []):
        if w in file_path_lower:
            score += 10.0

    for w in parsed.get("genre", []):
        if re.search(rf'\b{re.escape(w)}\b', file_name_lower):
            score += 12.0
        elif w in dir_path_lower:
            score += 8.0
        elif w in meta_combined:
            score += 3.0

    # 5. EPISODE MATCHING
    episode = parsed.get("episode")
    if episode:
        ep_str = str(episode).lower()
        ep_num_m = re.search(r'(\d+)$', ep_str)
        ep_num = ep_num_m.group(1) if ep_num_m else None
        if ep_str in file_name_lower:
            score += 50.0
        elif ep_num and re.search(rf'(?:ep|episode|e|s\d{{2}}e|part|pt|vol|_|\s|-|\.)0*{ep_num}(?:\D|$)', file_name_lower):
            score += 45.0
        elif ep_num and ep_num in re.findall(r'\d+', file_name_lower):
            score += 25.0

    # TIE BREAKER: Negative path length favors shorter, more direct paths
    tie_breaker = -len(file_path_lower)
    
    # print(f"[Density-Score] file='{file_name_lower}' score={score:.1f} matched_words={matched_title_words}/{len(title_words)}")

    return score, title_file_hits, tie_breaker


# ---------------------------------------------------------------------------
# Stage 3 — LLM final resolution
# ---------------------------------------------------------------------------

def ask_llm_to_resolve_match(query: str, candidates: List[Dict], is_generic: bool = False) -> Optional[str]:
    """
    Sends the user query and the candidate list to the LLM and asks
    it to return the best matching file path.
    """
    import random
    if is_generic:
        candidates = list(candidates)
        random.shuffle(candidates)

    candidates_str_list = []
    for idx, c in enumerate(candidates):
        metadata_parts = []
        if c.get("title"):
            metadata_parts.append(f"Title: {c['title']}")
        if c.get("artist_or_creator"):
            metadata_parts.append(f"Artist: {c['artist_or_creator']}")
        if c.get("genre_or_tags"):
            metadata_parts.append(f"Tags: {c['genre_or_tags']}")
            
        metadata_str = f" ({', '.join(metadata_parts)})" if metadata_parts else ""
        candidates_str_list.append(f"[{idx}] Path: {c['file_path']}{metadata_str}")

    candidates_text = "\n".join(candidates_str_list)

    if is_generic:
        system_prompt = (
            "You are a media file resolver. The user query is a generic mood or genre request (e.g. 'play something romantic') rather than a request for a specific file.\n"
            "Pick one candidate completely randomly from the provided list. Do not try to find a title match, just select the path of any random candidate from the list.\n"
            "Respond ONLY with raw JSON — no markdown, no explanation:\n"
            "{\"best_match\": \"<exact path or null>\", \"reason\": \"<one sentence>\"}"
        )
    else:
        system_prompt = (
            "You are a media file resolver. The user wants to open a specific file.\n"
            "Given the query and the candidate list, pick the single best matching file path from the list.\n"
            "Understand: 'ep1'/'e1'/'episode 1'/'s01e01' all refer to the same episode.\n"
            "Look at the full file path — folder names contain the show/album name.\n"
            "If no candidate is a reasonable match, return null for best_match.\n"
            "Respond ONLY with raw JSON — no markdown, no explanation:\n"
            "{\"best_match\": \"<exact path or null>\", \"reason\": \"<one sentence>\"}"
        )
    user_msg = (
        f"User query: \"{query}\"\n\n"
        f"Candidates:\n{candidates_text}"
    )

    try:
        url = f"{config.LMSTUDIO_URL}/v1/chat/completions"
        resp = requests.post(
            url,
            json={
                "model": config.LLM_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_msg}
                ],
                "temperature": 0.0
            },
            timeout=10
        )
        if resp.status_code == 200:
            raw = resp.json()["choices"][0]["message"]["content"].strip()
            if raw.startswith("```"):
                m = re.search(r'```(?:json)?\s*(.*?)\s*```', raw, re.DOTALL)
                if m:
                    raw = m.group(1).strip()
            data  = json.loads(raw)
            best  = data.get("best_match")
            reason= data.get("reason", "")
            if best:
                print(f"[Search] LLM resolved → '{best}' ({reason})")
                return best
    except Exception as e:
        print(f"[Search] LLM resolution failed/timed-out: {e}")

    return None


# ---------------------------------------------------------------------------
# Core resolution entry-point
# ---------------------------------------------------------------------------

def resolve_best_file(query: str, play_mode: bool = False, start_directory: str = None) -> Optional[str]:
    """
    Full multi-stage resolution pipeline:
      1. LLM parses query into title / path / genre / episode arrays.
      2. DB union search fetches up to 300 raw candidates.
      3. Python density scoring picks the top 50.
      4. LLM selects the single best match from the top 10.
    Falls back to top-1 by density score if LLM is unavailable.
    """
    clean_query = query.strip().strip('"\'')
    if not clean_query:
        return None

    print(f"[Search] Query: '{clean_query}' (play_mode={play_mode})")

    # Step 1 — parse
    parsed = parse_query_with_llm(clean_query)

    # Step 2 — DB union
    categories = ["song", "movie"] if play_mode else None
    raw_candidates = query_database_union(parsed, limit_raw=2000, categories=categories)

    if start_directory and start_directory.strip():
        base = os.path.abspath(start_directory.strip()).lower()
        raw_candidates = [c for c in raw_candidates if c["file_path"].lower().startswith(base)]

    # Keep only physically-existing, safe files
    safe_existing = [
        c for c in raw_candidates
        if _is_safe_path(c["file_path"]) 
        and os.path.exists(c["file_path"])
        and not _is_unwanted_installer_or_uninstaller(c["file_path"], clean_query)
    ]

    if not safe_existing:
        return None

    # Step 3 — density ranking → top 50
    for c in safe_existing:
        score, title_file_hits, tie_breaker = _density_score(c, parsed)
        c["_density"]         = score
        c["_tie_breaker"]     = tie_breaker
        c["_title_file_hits"] = title_file_hits

    # Sort by score descending, then by tie_breaker descending (shorter paths win)
    safe_existing.sort(key=lambda x: (x["_density"], x["_tie_breaker"]), reverse=True)
    top50 = safe_existing[:50]

    print(f"[Search] Top-50 candidates (density score / file_hits):")
    for c in top50:
        print(f"  {c['_density']:7.1f} file_hits={c['_title_file_hits']}  {c['file_path']}")

    # Quality gate: if the query has title words, at least 1 must appear in file_name or file_path.
    # If the query has ONLY genre/mood words (e.g. "play something romantic"),
    # skip this gate — a tag match is sufficient.
    title_words = parsed.get("title", [])
    genre_words = parsed.get("genre", [])
    if title_words and top50[0]["_title_file_hits"] == 0:
        # But allow if genre words exist — the genre search may have fetched valid results
        if not genre_words:
            print(f"[Search] No title words matched file_name/file_path — not found.")
            return None
        print(f"[Search] Title words had no file hits, but genre words present — continuing with genre results.")

    # Step 4 — send only the top 10 to LLM for final selection
    top10_for_llm = top50[:10]
    candidate_paths = {c["file_path"] for c in top10_for_llm}

    if len(top10_for_llm) == 1:
        return top10_for_llm[0]["file_path"]

    # Landslide victory check: if top candidate has a clear lead, bypass the LLM matcher
    if len(top50) > 1:
        score_gap = top50[0]["_density"] - top50[1]["_density"]
        if top50[0]["_density"] >= 150.0 and score_gap >= 100.0:
            print(f"[Search] Bypassing LLM matcher: Landslide winner '{top50[0]['file_path']}' (score: {top50[0]['_density']} vs {top50[1]['_density']})")
            return top50[0]["file_path"]

    is_generic = (not parsed.get("title")) and bool(parsed.get("genre"))
    llm_path = ask_llm_to_resolve_match(clean_query, top10_for_llm, is_generic=is_generic)

    if llm_path:
        # Case 1: exact match against a real candidate path — ideal
        if llm_path in candidate_paths and os.path.exists(llm_path):
            return llm_path

        # Case 2: LLM hallucinated a slightly wrong path — try to find the
        #          closest real candidate whose path contains the LLM's filename
        llm_name = os.path.basename(llm_path).lower()
        for c in top10_for_llm:
            if llm_name and llm_name in c["file_path"].lower():
                print(f"[Search] LLM path not found on disk; matched candidate by filename: '{c['file_path']}'")
                return c["file_path"]

        # Case 3: LLM returned a path that exists but wasn't in our candidate list
        if os.path.exists(llm_path) and _is_safe_path(llm_path):
            print(f"[Search] LLM returned an off-list path that exists — trusting it.")
            return llm_path

        print(f"[Search] LLM path rejected (not found on disk / no candidate match): '{llm_path}' — falling back to density rank-1.")

    # Fallback — highest density score
    return top50[0]["file_path"]


# ---------------------------------------------------------------------------
# Public tool functions
# ---------------------------------------------------------------------------

def search_files(query: str, start_directory: str = None) -> str:
    """
    Searches for files matching the query using the multi-stage LLM pipeline.
    Returns a formatted list of the top matching files.
    """
    if not query or not query.strip():
        return "Error: Search query must not be empty."

    clean_query = query.strip().strip('"\'')

    parsed         = parse_query_with_llm(clean_query)
    raw_candidates = query_database_union(parsed, limit_raw=100)

    if start_directory and start_directory.strip():
        base = os.path.abspath(os.path.expanduser(os.path.expandvars(start_directory.strip()))).lower()
        raw_candidates = [c for c in raw_candidates if c["file_path"].lower().startswith(base)]

    safe_existing = [
        c for c in raw_candidates
        if _is_safe_path(c["file_path"]) and os.path.exists(c["file_path"])
    ]

    if not safe_existing:
        loc = f" in '{start_directory}'" if start_directory else ""
        return f"No files matching '{query}' were found{loc} on your system."

    for c in safe_existing:
        score, title_hits = _density_score(c, parsed)
        c["_density"]    = score
        c["_title_hits"] = title_hits
    safe_existing.sort(key=lambda x: x["_density"], reverse=True)
    top25 = safe_existing[:25]

    msg = f"Found {len(top25)} matching file(s):\n"
    for i, r in enumerate(top25, 1):
        path     = r["file_path"]
        category = r.get("category", "other")
        meta_parts = []
        if r.get("title") and r["title"].lower() != r["file_name"].lower():
            meta_parts.append(f"Title: {r['title']}")
        if r.get("artist_or_creator"):
            meta_parts.append(f"Creator: {r['artist_or_creator']}")
        if r.get("genre_or_tags"):
            meta_parts.append(f"Tags: {r['genre_or_tags']}")
        if r.get("release_year"):
            meta_parts.append(f"Year: {r['release_year']}")
        meta_str = f" ({', '.join(meta_parts)})" if meta_parts else ""
        msg += f"{i}. [{category.upper()}] {path}{meta_str}\n"

    return msg


def resolve_best_file_no_llm(query: str, play_mode: bool = False, start_directory: str = None) -> Optional[str]:
    """
    Resolves the best matching file entirely without any LLM calls, using only DB search & density scoring.
    If play_mode is True, prioritizes mp4/mkv/webm, then mp3, then other formats.
    """
    clean_query = query.strip().strip('"\'')
    if not clean_query:
        return None

    print(f"[Search-NoLLM] Query: '{clean_query}' (play_mode={play_mode})")

    # Step 1 — Parse query into keywords
    parsed = parse_query_with_llm(clean_query)

    # Step 2 — DB union search
    categories = ["song", "movie"] if play_mode else None
    raw_candidates = query_database_union(parsed, limit_raw=2000, categories=categories)

    if start_directory and start_directory.strip():
        base = os.path.abspath(start_directory.strip()).lower()
        raw_candidates = [c for c in raw_candidates if c["file_path"].lower().startswith(base)]

    # Keep only physically-existing, safe files
    safe_existing = [
        c for c in raw_candidates
        if _is_safe_path(c["file_path"]) 
        and os.path.exists(c["file_path"])
        and not _is_unwanted_installer_or_uninstaller(c["file_path"], clean_query)
    ]

    if not safe_existing:
        return None

    # Step 3 — Density ranking + extension boost for play mode
    for c in safe_existing:
        # Unpack the 3 values from our new density scorer
        score, title_file_hits, tie_breaker = _density_score(c, parsed)
        
        # Apply your original play mode prioritization
        boost = 0.0
        if play_mode:
            file_path_lower = c["file_path"].lower()
            _, ext = os.path.splitext(file_path_lower)
            if ext in ('.mp4', '.mkv', '.webm'):
                boost = 100.0
            elif ext == '.mp3':
                boost = 50.0
                
        # Add the boost to the new base score
        c["_density"]         = score + boost
        c["_raw_density"]     = score
        c["_tie_breaker"]     = tie_breaker
        c["_title_file_hits"] = title_file_hits

    # Sort by final score (density + boost) descending, then by tie-breaker (shorter path)
    safe_existing.sort(key=lambda x: (x["_density"], x["_tie_breaker"]), reverse=True)

    top50 = safe_existing[:50]
    
    print(f"\n[Search-NoLLM] Top-50 candidates (Final Score [Raw] / file_hits):")
    for c in top50:
        print(f"  Score: {c['_density']:5.1f} [{c['_raw_density']:5.1f}] | Hits: {c['_title_file_hits']} | Path: {c['file_path']}")
    
    # Check quality gate on the raw density score to make sure title words match
    # (If the highest raw density has 0 title hits, we check quality)
    top_candidates_by_raw = sorted(safe_existing, key=lambda x: x["_raw_density"], reverse=True)
    title_words = parsed.get("title", [])
    genre_words = parsed.get("genre", [])
    if title_words and top_candidates_by_raw[0]["_title_file_hits"] == 0:
        if not genre_words:
            print(f"[Search-NoLLM] Quality Gate: No title words matched file_name/file_path — not found.")
            return None

    best = safe_existing[0]
    print(f"[Search-NoLLM] !!!play modee='{play_mode}'!!! Resolved to: '{best['file_path']}' with score={best['_density']} (raw={best['_raw_density']})")
    return best["file_path"]


def _get_steam_appid(game_exe_path: str) -> str | None:
    """
    Try to find Steam AppID for a game executable.
    Checks for steam_appid.txt in game dir and parent dirs, and .acf files in steamapps.
    """
    print(f"[STEAM DEBUG] Finding AppID for: {game_exe_path}")
    try:
        game_dir = os.path.dirname(game_exe_path)
        # 1. Check for steam_appid.txt in game directory and parents (up to 3 levels)
        for i in range(4):
            appid_file = os.path.join(game_dir, "steam_appid.txt")
            print(f"[STEAM DEBUG] Checking level {i}: {appid_file} (exists={os.path.isfile(appid_file)})")
            if os.path.isfile(appid_file):
                with open(appid_file, "r", encoding="utf-8", errors="ignore") as f:
                    appid = f.read().strip()
                    print(f"[STEAM DEBUG] Found steam_appid.txt: '{appid}'")
                    if appid.isdigit():
                        print(f"[STEAM DEBUG] Valid AppID from steam_appid.txt: {appid}")
                        return appid
            parent = os.path.dirname(game_dir)
            if parent == game_dir:
                break
            game_dir = parent
        
        # 2. Check .acf files in steamapps folders
        # Game exe is typically at: <steam_root>/steamapps/common/<game>/<game>.exe
        # Need to go up 3 levels: exe_dir -> game_dir -> common_dir -> steamapps_dir
        game_dir = os.path.dirname(os.path.dirname(os.path.dirname(game_exe_path)))  # Go up to steamapps
        steamapps_dir = game_dir
        print(f"[STEAM DEBUG] Checking steamapps dir: {steamapps_dir} (exists={os.path.isdir(steamapps_dir)})")
        if os.path.isdir(steamapps_dir):
            # Get game folder name and exe name for matching
            exe_name = os.path.basename(game_exe_path).lower()
            game_folder_name = os.path.basename(os.path.dirname(game_exe_path)).lower()
            print(f"[STEAM DEBUG] Matching against exe_name='{exe_name}', game_folder='{game_folder_name}'")
            
            for acf_file in os.listdir(steamapps_dir):
                if acf_file.endswith(".acf"):
                    acf_path = os.path.join(steamapps_dir, acf_file)
                    try:
                        with open(acf_path, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                            # Parse ACF for appid and installdir (most reliable match)
                            import re
                            appid_match = re.search(r'"appid"\s+"(\d+)"', content)
                            installdir_match = re.search(r'"installdir"\s+"([^"]+)"', content)
                            
                            if appid_match:
                                appid = appid_match.group(1)
                                
                                # Check installdir against game folder name (most reliable)
                                if installdir_match:
                                    acf_installdir = installdir_match.group(1)
                                    print(f"[STEAM DEBUG] ACF {acf_file}: appid={appid}, installdir='{acf_installdir}', our_folder='{game_folder_name}'")
                                    if acf_installdir.lower() == game_folder_name.lower():
                                        print(f"[STEAM DEBUG] Exact installdir match! AppID: {appid}")
                                        return appid
                                    # Also check if game folder name contains installdir or vice versa
                                    if game_folder_name.lower() in acf_installdir.lower() or acf_installdir.lower() in game_folder_name.lower():
                                        print(f"[STEAM DEBUG] Partial installdir match! AppID: {appid}")
                                        return appid
                                    # installdir exists but doesn't match - SKIP this ACF, don't fall through
                                    print(f"[STEAM DEBUG] installdir mismatch, skipping ACF {acf_file}")
                                    continue
                                
                                # NO installdir field in ACF - check name as fallback
                                name_match = re.search(r'"name"\s+"([^"]+)"', content)
                                if name_match:
                                    acf_name = name_match.group(1)
                                    print(f"[STEAM DEBUG] ACF {acf_file} (no installdir): name='{acf_name}'")
                                    if game_folder_name.lower() in acf_name.lower() or acf_name.lower() in game_folder_name.lower():
                                        print(f"[STEAM DEBUG] Name match! AppID: {appid}")
                                        return appid
                                
                                # Last resort: appmanifest_<appid>.acf filename (only if no installdir)
                                if acf_file.startswith("appmanifest_") and acf_file.endswith(".acf"):
                                    print(f"[STEAM DEBUG] ACF filename match (no installdir fallback): {acf_file} -> AppID: {appid}")
                                    return appid
                    except Exception as e:
                        print(f"[STEAM DEBUG] Error reading ACF {acf_file}: {e}")
                        continue
    except Exception as e:
        print(f"[STEAM DEBUG] Exception in _get_steam_appid: {e}")
    print(f"[STEAM DEBUG] No AppID found for {game_exe_path}")
    return None


def _launch_steam_game(appid: str) -> bool:
    """Launch a Steam game via steam:// protocol."""
    print(f"[STEAM DEBUG] Launching via steam://run/{appid}")
    try:
        os.startfile(f"steam://run/{appid}")
        print(f"[STEAM DEBUG] steam://run/{appid} launched successfully")
        return True
    except Exception as e:
        print(f"[STEAM DEBUG] Failed to launch steam://run/{appid}: {e}")
        return False



def open_or_play_file_no_llm(file_path_or_query: str, play_mode: bool = False) -> str:
    """
    Opens or plays a file or app without LLM pipeline, using pure-Python heuristics.
    """
    if not file_path_or_query or not file_path_or_query.strip():
        return "Error: File path or query must not be empty."

    clean = file_path_or_query.strip().strip('"\'')

    # Direct launch for shell folder paths (UWP apps)
    if clean.lower().startswith("shell:"):
        try:
            os.startfile(clean)
            return f"Success: Launched UWP application '{clean}'."
        except Exception as e:
            return f"Failed to launch UWP application '{clean}': {e}"

    # 1. Direct path shortcut
    if os.path.exists(clean) and os.path.isfile(clean):
        if not _is_safe_path(clean):
            return f"Access Denied: Opening sensitive system file '{clean}' is blocked."
        
        if play_mode:
            _, ext = os.path.splitext(clean.lower())
            is_media = ext in ('.mp4', '.mkv', '.webm', '.avi', '.mov', '.mp3', '.wav', '.flac', '.ogg')
            if not is_media:
                return f"Error: Playback is restricted to audio and video files only."
        
        if clean.lower().endswith(".exe"):
            appid = _get_steam_appid(clean)
            if appid:
                if _launch_steam_game(appid):
                    return f"Success: Launched Steam game (AppID: {appid}) via Steam."
        
        try:
            os.startfile(clean)
            return f"Success: Opened '{clean}'." if not play_mode else f"Success: Started playing '{clean}'."
        except Exception as e:
            return f"Failed to open '{clean}': {e}"

    # 2. Check if it's an application (e.g. mspaint, notepad)
    if not play_mode:
        from app.tools.system import launch_app, _find_app_path
        app_path = _find_app_path(clean)
        if app_path:
            print(f"[Search-NoLLM] Found system app path: {app_path}")
            return launch_app(clean)

    # 3. Resolve using database/metadata (No LLM)
    resolved = resolve_best_file_no_llm(clean, play_mode=play_mode)
    print(f"[Search-NoLLM] Resolved file: {resolved}")
    if not resolved:
        return f"Error: Could not find any apps or files matching '{file_path_or_query}' on your system."

    # Check if resolved file is a Steam game
    if resolved.lower().endswith(".exe"):
        appid = _get_steam_appid(resolved)
        if appid:
            if _launch_steam_game(appid):
                return f"Success: Found best matching file and launched Steam game (AppID: {appid}) via Steam."

    try:
        os.startfile(resolved)
        return f"Success: Found best matching file and opened '{resolved}'." if not play_mode else f"Success: Found best matching file and started playing '{resolved}'."
    except Exception as e:
        return f"Failed to open '{resolved}': {e}"


def resolve_best_folder(query: str) -> Optional[str]:
    """
    Looks up crawled directory roots and distinct parent folders in the database
    to find any directory whose name/path matches the query.
    """
    clean_query = query.strip().lower().replace(" ", "")
    if not clean_query:
        return None

    from app.memory.db import get_connection
    conn = get_connection()
    try:
        # Check 1: Check the directories table (roots)
        rows = conn.execute("SELECT path FROM directories").fetchall()
        for r in rows:
            path = r["path"]
            if os.path.exists(path) and os.path.isdir(path):
                folder_name = os.path.basename(path).lower().replace(" ", "")
                if clean_query == folder_name or clean_query in folder_name:
                    return path

        # Check 2: Check all unique parent_folder values from files table
        rows = conn.execute("SELECT DISTINCT parent_folder FROM files").fetchall()
        candidates = []
        for r in rows:
            path = r["parent_folder"]
            if path and os.path.exists(path) and os.path.isdir(path):
                folder_name = os.path.basename(path).lower().replace(" ", "")
                if clean_query == folder_name:
                    return path
                if clean_query in folder_name:
                    candidates.append((path, len(folder_name)))
        
        if candidates:
            candidates.sort(key=lambda x: x[1])
            return candidates[0][0]
            
    except Exception as e:
        print(f"[Search] Directory lookup failed: {e}")
    finally:
        conn.close()
    return None


def _needs_confirmation(path: str) -> bool:
    if not path:
        return False
    # Directories are safe to browse
    if os.path.isdir(path):
        return False
    path_lower = path.lower()
    # Steam games (.exe with valid appid) are safe
    is_steam = path_lower.endswith(".exe") and _get_steam_appid(path) is not None
    # Media files are safe
    _, ext = os.path.splitext(path_lower)
    is_media = ext in ('.mp4', '.mkv', '.webm', '.avi', '.mov', '.mp3', '.wav', '.flac', '.ogg')
    return not (is_steam or is_media)


def resolve_best_file_via_suggestions(query: str, play_mode: bool = False) -> Optional[str]:
    """
    Finds the single best match (Start Menu App or Database File) using the exact same
    density scoring logic as the UI search autocomplete suggestions.
    """
    import os
    from app.tools.system import _get_uwp_apps
    
    clean_query = query.strip()
    if not clean_query:
        return None

    words = [w.lower() for w in clean_query.split() if w.strip()]
    parsed = {
        "title": words,
        "path": [],
        "genre": [],
        "episode": None
    }

    results = []

    if play_mode:
        try:
            raw_candidates = query_database_union(parsed, limit_raw=500, categories=["song", "movie"], silent=True)
        except Exception:
            raw_candidates = []

        for c in raw_candidates:
            file_path = c.get("file_path")
            if not file_path or not os.path.exists(file_path) or not _is_safe_path(file_path):
                continue
            
            score, title_hits, tie_breaker = _density_score(c, parsed)
            boost = 0.0
            _, ext = os.path.splitext(file_path.lower())
            if ext in ('.mp4', '.mkv', '.webm'):
                boost = 100.0
            elif ext == '.mp3':
                boost = 50.0
                
            final_score = score + boost
            if final_score > 0:
                results.append({
                    "path": file_path,
                    "score": final_score,
                    "tie_breaker": tie_breaker
                })
    else:
        try:
            apps = _get_uwp_apps()
        except Exception:
            apps = []
            
        for app in apps:
            name = app.get("Name", "")
            if not name:
                continue
            
            app_id = app.get("AppID")
            app_path = f"shell:AppsFolder\\{app_id}" if app_id else name
            app_candidate = {
                "file_name": name,
                "file_path": app_path,
                "parent_folder": "",
                "title": name,
                "alternate_titles": "",
                "genre_or_tags": ""
            }
            score, title_hits, tie_breaker = _density_score(app_candidate, parsed)
            if score > 0:
                results.append({
                    "path": app_path,
                    "score": score,
                    "tie_breaker": tie_breaker
                })
                
        try:
            raw_candidates = query_database_union(parsed, limit_raw=500, silent=True)
        except Exception:
            raw_candidates = []

        for c in raw_candidates:
            file_path = c.get("file_path")
            if not file_path or not os.path.exists(file_path) or not _is_safe_path(file_path):
                continue
                
            score, title_hits, tie_breaker = _density_score(c, parsed)
            if score > 0:
                results.append({
                    "path": file_path,
                    "score": score,
                    "tie_breaker": tie_breaker
                })

    if not results:
        return None

    results.sort(key=lambda x: (x["score"], x["tie_breaker"]), reverse=True)
    return results[0]["path"]


def open_or_play_file(file_path_or_query: str, play_mode: bool = False, confirmed: bool = False) -> str:
    """
    Opens or plays a file or directory. Accepts a direct path or a natural-language query.
    Uses the suggestions-based density scoring pipeline to resolve the best match.
    """
    if not file_path_or_query or not file_path_or_query.strip():
        return "Error: File path or query must not be empty."

    clean = file_path_or_query.strip().strip('"\'')
    expanded = os.path.abspath(os.path.expanduser(os.path.expandvars(clean)))
    if os.path.exists(expanded):
        clean = expanded

    # 1. Direct path shortcut (files and directories)
    if os.path.exists(clean):
        if not _is_safe_path(clean):
            return f"Access Denied: Opening sensitive system path '{clean}' is blocked."
        
        if play_mode:
            if os.path.isdir(clean):
                return "Error: Cannot play a directory. Please specify a media file."
            _, ext = os.path.splitext(clean.lower())
            is_media = ext in ('.mp4', '.mkv', '.webm', '.avi', '.mov', '.mp3', '.wav', '.flac', '.ogg')
            if not is_media:
                return f"Error: Playback is restricted to audio and video files only."
        
        if not confirmed and _needs_confirmation(clean):
            return f"CONFIRM_REQUIRED: {clean}"

        print(f"[STEAM DEBUG] open_or_play_file: clean='{clean}', is_exe={clean.lower().endswith('.exe')}")
        if os.path.isfile(clean) and clean.lower().endswith(".exe"):
            appid = _get_steam_appid(clean)
            if appid:
                if _launch_steam_game(appid):
                    return f"Success: Launched Steam game (AppID: {appid}) via Steam."
        try:
            os.startfile(clean)
            return f"Success: Opened '{clean}'." if not play_mode else f"Success: Started playing '{clean}'."
        except Exception as e:
            return f"Failed to open '{clean}': {e}"

    # 2. Use suggestions scoring logic (UWP apps + DB union search with density scoring)
    resolved = resolve_best_file_via_suggestions(clean, play_mode=play_mode)
    if resolved:
        clean = resolved

    # 3. Handle UWP apps (shell:AppsFolder)
    if clean.lower().startswith("shell:"):
        from app.tools.system import launch_app
        if not confirmed and _needs_confirmation(clean):
            return f"CONFIRM_REQUIRED: {clean}"
        return launch_app(clean)

    # 4. Handle resolved file path
    if os.path.exists(clean):
        if not _is_safe_path(clean):
            return f"Access Denied: Opening sensitive system path '{clean}' is blocked."
        if not confirmed and _needs_confirmation(clean):
            return f"CONFIRM_REQUIRED: {clean}"
        
        if clean.lower().endswith(".exe"):
            appid = _get_steam_appid(clean)
            if appid:
                if _launch_steam_game(appid):
                    return f"Success: Found best matching file and launched Steam game (AppID: {appid}) via Steam."
        try:
            os.startfile(clean)
            return f"Success: Found best matching file and opened '{clean}'." if not play_mode else f"Success: Found best matching file and started playing '{clean}'."
        except Exception as e:
            return f"Failed to open '{clean}': {e}"

    # 5. Legacy app path finding fallback
    if not play_mode:
        from app.tools.system import launch_app, _find_app_path
        app_path = _find_app_path(clean)
        if app_path:
            if not confirmed and _needs_confirmation(app_path):
                return f"CONFIRM_REQUIRED: {app_path}"
            return launch_app(clean)

    return f"Error: Could not find any files matching '{file_path_or_query}' on your system."

def create_file(file_path: str, content: str = "") -> str:
    """
    Creates a new file at file_path with the specified text content.
    """
    if not file_path or not file_path.strip():
        return "Error: File path must not be empty."

    path = os.path.abspath(os.path.expanduser(os.path.expandvars(file_path.strip())))
    if not _is_safe_path(path, write_operation=True):
        return f"Access Denied: Creating files in sensitive system directory '{path}' is blocked."

    try:
        # Create directories if they don't exist
        parent = os.path.dirname(path)
        if parent and not os.path.exists(parent):
            os.makedirs(parent, exist_ok=True)
            
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
            
        return f"Success: File created successfully at '{path}'."
    except Exception as e:
        return f"Failed to create file: {str(e)}"

def edit_file(file_path: str, search_text: str, replace_text: str) -> str:
    """
    Edits a file by replacing an exact text match with replacement text.
    """
    if not file_path or not file_path.strip():
        return "Error: File path must not be empty."

    path = os.path.abspath(os.path.expanduser(os.path.expandvars(file_path.strip())))
    if not os.path.exists(path):
        return f"Error: File '{path}' does not exist."

    if not _is_safe_path(path, write_operation=True):
        return f"Access Denied: Editing files in sensitive system directory '{path}' is blocked."

    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        if search_text not in content:
            return f"Error: Could not find the exact text block in the file for replacement. Please make sure search_text matches exactly."

        new_content = content.replace(search_text, replace_text, 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)

        return f"Success: File '{path}' was successfully edited."
    except Exception as e:
        return f"Failed to edit file: {str(e)}"

def delete_file(file_path: str, confirmed: bool = False) -> str:
    """
    Deletes the file at file_path. Requires user confirmation flag to be True.
    """
    if not file_path or not file_path.strip():
        return "Error: File path must not be empty."

    path = os.path.abspath(os.path.expanduser(os.path.expandvars(file_path.strip())))
    if not os.path.exists(path):
        return f"Error: File '{path}' does not exist."

    if os.path.isdir(path):
        return f"Error: '{path}' is a directory. Deletion of full directories is blocked for safety."

    if not _is_safe_path(path, write_operation=True):
        return f"Access Denied: Deleting files in sensitive system directory '{path}' is blocked."

    if not confirmed:
        return f"[CONFIRMATION REQUIRED] To delete '{path}', you must ask the user in chat. Once they explicitly approve, call delete_file again with confirmed=True."

    try:
        os.remove(path)
        return f"Success: File '{path}' was successfully deleted."
    except Exception as e:
        return f"Failed to delete file: {str(e)}"

def read_file_content(file_path: str) -> str:
    """
    Reads the content of a text/code file, or extracts text from a PDF file.
    Only allows reading safe paths.
    """
    if not file_path or not file_path.strip():
        return "Error: File path must not be empty."

    path = os.path.abspath(os.path.expanduser(os.path.expandvars(file_path.strip())))
    if not _is_safe_path(path, write_operation=False):
        return f"Access Denied: Reading files in sensitive system directory '{path}' is blocked."

    if not os.path.exists(path):
        return f"Error: File '{path}' does not exist."

    if os.path.isdir(path):
        return f"Error: '{path}' is a directory. Reading directories as files is not supported."

    ext = os.path.splitext(path)[1].lower()
    max_chars = 25000 # Keep LLM context from blowing up

    if ext == '.pdf':
        try:
            import pypdf
            reader = pypdf.PdfReader(path)
            text = ""
            for idx, page in enumerate(reader.pages):
                t = page.extract_text()
                if t:
                    text += t + "\n"
                if len(text) > max_chars:
                    text = text[:max_chars] + f"\n... [Truncated: PDF is too large, showing first {max_chars} characters]"
                    break
            
            cleaned = text.strip()
            if not cleaned:
                return "Warning: This PDF seems to contain no extractable text."
            return cleaned
        except Exception as e:
            return f"Error reading PDF file: {str(e)}"
    else:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            if len(content) > max_chars:
                return content[:max_chars] + f"\n... [Truncated: File is too large, showing first {max_chars} characters]"
            return content
        except Exception as e:
            return f"Error reading file: {str(e)}"

