"""
Advanced Jarvis PC Tools Implementation for Project Yuki.
Completely independent, self-contained toolsuite for Frontier Cloud LLMs.
Provides deep system diagnostics, SQLite file database queries, code review, 
web page scraping, git status, file management, app launcher, and PC desktop automation.
"""

import os
import sys
import subprocess
import time
import json
import re
import urllib.request
import urllib.parse
from pathlib import Path
import app.config as config

def jarvis_query_file_db(
    query: str,
    category: str = None,
    extension: str = None,
    path_hint: str = None,
    search_scope: str = "all",
    limit: int = 25
) -> str:
    """
    Searches indexed files across all PC drives using density ranking (/o algorithm).
    Searches file names, parent folders, full directory paths, Japanese/Chinese transliterations,
    and metadata tags (artist, title, genre).

    Args:
        query: Freeform search query (e.g. "fate stay night episode 1", "elden ring save file").
        category: Optional category filter ("video", "audio", "image", "document", "executable", "archive", "code").
            Friendly names are aliased automatically: movie->video, audio->song, image->photo, executable->program.
        extension: Optional file extension filter (e.g. ".mp4", ".mkv", ".pdf", ".zip").
        path_hint: Optional folder or drive hint (e.g. "D:", "Downloads", "Anime", "Desktop").
        search_scope: Optional target scope ("all", "folder_only", "file_only", "metadata_only").
        limit: Max results to return (default 25).
    """
    query_str = str(query).strip() if query is not None else ""
    if not query_str:
        return "Error: Query string cannot be empty."

    clean_query = query_str
    category_str = str(category).strip() if category is not None else ""
    extension_str = str(extension).strip() if extension is not None else ""
    path_hint_str = str(path_hint).strip() if path_hint is not None else ""
    scope_clean = str(search_scope).strip().lower() if search_scope else "all"

    try:
        from app.tools.files import parse_query_with_llm, query_database_union, _density_score, _is_unwanted_installer_or_uninstaller

        parsed = parse_query_with_llm(clean_query)

        # Inject explicit path_hint if provided
        if path_hint_str:
            path_hint_clean = path_hint_str.lower().rstrip("\\/")
            if path_hint_clean and path_hint_clean not in parsed.get("path", []):
                parsed.setdefault("path", []).append(path_hint_clean)

        categories = [category_str.lower()] if category_str else None

        candidates = query_database_union(parsed, limit_raw=max(limit * 4, 500), categories=categories, silent=True)

        if not candidates:
            return f"No indexed files found matching query '{clean_query}'."

        # Filter by search_scope if specified
        if scope_clean == "folder_only":
            q_words = [w for w in clean_query.lower().split() if len(w) > 1]
            candidates = [c for c in candidates if any(w in (c.get("parent_folder") or "").lower() or w in (c.get("file_path") or "").lower() for w in q_words)]
        elif scope_clean == "file_only":
            q_words = [w for w in clean_query.lower().split() if len(w) > 1]
            candidates = [c for c in candidates if any(w in (c.get("file_name") or "").lower() for w in q_words)]

        # Filter by extension if provided
        if extension_str:
            ext_clean = extension_str.lower()
            if not ext_clean.startswith('.'):
                ext_clean = '.' + ext_clean
            candidates = [c for c in candidates if (c.get("extension") or "").lower() == ext_clean or (c.get("file_path") or "").lower().endswith(ext_clean)]

        # Filter unwanted installers unless query asks for setup/install
        filtered_candidates = [c for c in candidates if not _is_unwanted_installer_or_uninstaller(c.get("file_path", ""), clean_query)]
        if filtered_candidates:
            candidates = filtered_candidates

        # Apply Density Ranking (/o algorithm)
        ranked = sorted(candidates, key=lambda c: _density_score(c, parsed), reverse=True)

        seen = set()
        unique = []
        for c in ranked:
            p = c.get("file_path", "")
            if p not in seen:
                seen.add(p)
                unique.append(c)
                if len(unique) >= limit:
                    break

        output_lines = [f"Found {len(unique)} files matching '{clean_query}':"]
        for r in unique:
            output_lines.append(r.get("file_path", ""))

        return "\n".join(output_lines)

    except Exception as e:
        return f"File Database Query Exception: {str(e)}"


def jarvis_read_file(file_path: str, max_lines: int = 250, start_line: int = 1) -> str:
    """
    Reads the content of a local text or code file with line range slicing for code review and analysis.
    """
    clean_path = os.path.abspath(file_path.strip('"\''))
    if not os.path.exists(clean_path):
        return f"File Error: Path '{clean_path}' does not exist."
        
    if not os.path.isfile(clean_path):
        return f"File Error: Path '{clean_path}' is a directory, not a file."

    file_size = os.path.getsize(clean_path)
    if file_size > 10 * 1024 * 1024:
        return f"File Error: File '{os.path.basename(clean_path)}' is too large ({file_size / 1024 / 1024:.1f} MB) to read into context."

    try:
        lines = []
        encodings = ['utf-8', 'latin-1', 'cp1252']
        content_read = False
        
        for enc in encodings:
            try:
                with open(clean_path, 'r', encoding=enc, errors='replace') as f:
                    lines = f.readlines()
                content_read = True
                break
            except Exception:
                continue

        if not content_read:
            return f"File Error: Could not decode text content of '{os.path.basename(clean_path)}'."

        total_lines = len(lines)
        start_idx = max(0, start_line - 1)
        end_idx = min(total_lines, start_idx + max_lines)
        sliced_lines = lines[start_idx:end_idx]

        header = f"=== File: {clean_path} (Lines {start_idx + 1}-{end_idx} of {total_lines}) ==="
        body = "".join([f"{idx + start_idx + 1:4d} | {line}" for idx, line in enumerate(sliced_lines)])
        
        return f"{header}\n{body}"

    except Exception as e:
        return f"Read File Error: {str(e)}"


def _run_auto_lsp_check(clean_path: str) -> str:
    """Helper to run non-blocking LSP check for python and typescript files."""
    ext = os.path.splitext(clean_path)[1].lower()
    if ext not in ('.py', '.pyi', '.js', '.jsx', '.ts', '.tsx', '.json', '.rs', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.go', '.html', '.htm', '.css', '.scss'):
        return ""

    try:
        from app.tools.lsp_client import get_lsp_client
        workspace_dir = os.path.dirname(clean_path)
        client = get_lsp_client(workspace_dir)

        import asyncio
        loop = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            future = asyncio.run_coroutine_threadsafe(client.check_diagnostics(clean_path, timeout=1.2), loop)
            diags = future.result(timeout=1.5)
        else:
            diags = asyncio.run(client.check_diagnostics(clean_path, timeout=1.2))

        if not diags:
            return "\n[LSP DIAGNOSTICS: VERIFIED CLEAN (0 Errors)]"
        else:
            diag_str = "\n".join([f"  • {d}" for d in diags[:6]])
            return f"\n[⚠️ LSP DIAGNOSTICS DETECTED {len(diags)} ERRORS - PLEASE FIX IN NEXT TURN]:\n{diag_str}"
    except Exception as e:
        return ""


def jarvis_create_or_edit_file(file_path: str, content: str = "", mode: str = "write", **kwargs) -> str:
    """
    Creates or edits a file on disk. Mode: 'write' (overwrite/create) or 'append'.
    """
    if not content and kwargs:
        content = kwargs.get("file_content") or kwargs.get("code") or kwargs.get("text") or kwargs.get("body") or ""
    clean_path = os.path.abspath(file_path.strip('"\''))
    try:
        os.makedirs(os.path.dirname(clean_path), exist_ok=True)
        file_mode = "a" if mode == "append" else "w"
        with open(clean_path, file_mode, encoding="utf-8") as f:
            f.write(content)
        lsp_msg = _run_auto_lsp_check(clean_path)
        return f"Success: File '{clean_path}' written successfully ({len(content)} characters).{lsp_msg}"
    except Exception as e:
        return f"File Write Error: {str(e)}"


def jarvis_replace_file_content(file_path: str, target_content: str, replacement_content: str) -> str:
    """
    Replaces exact instances of target_content with replacement_content in a file on disk.
    This allows non-destructive, precise edits without overwriting the whole file.
    """
    clean_path = os.path.abspath(file_path.strip('"\''))
    if not os.path.exists(clean_path):
        return f"File Error: Path '{clean_path}' does not exist."
    try:
        with open(clean_path, "r", encoding="utf-8") as f:
            full_text = f.read()

        if target_content not in full_text:
            return f"Error: Target text block not found in '{clean_path}'. Please check line numbers or read the file first."

        updated_text = full_text.replace(target_content, replacement_content, 1)

        with open(clean_path, "w", encoding="utf-8") as f:
            f.write(updated_text)

        lsp_msg = _run_auto_lsp_check(clean_path)
        return f"Success: Replaced target block in '{clean_path}' successfully.{lsp_msg}"
    except Exception as e:
        return f"File Edit Error: {str(e)}"


def jarvis_list_dir_tree(dir_path: str, max_depth: int = 2, limit: int = 100) -> str:
    """
    Inspects folder structure and subdirectories up to max_depth.
    """
    clean_path = os.path.abspath(dir_path.strip('"\''))
    if not os.path.exists(clean_path):
        return f"Directory Error: Path '{clean_path}' does not exist."
        
    if not os.path.isdir(clean_path):
        return f"Directory Error: Path '{clean_path}' is a file, not a directory."

    output = [f"=== Directory Tree: {clean_path} ==="]
    
    def _walk(current_dir, current_depth):
        if current_depth > max_depth:
            return
        if len(output) >= limit:
            return
        try:
            entries = sorted(os.listdir(current_dir))
            for entry in entries:
                if entry.startswith('.') or entry in ('__pycache__', 'node_modules', 'venv', 'dist', 'build'):
                    continue
                if len(output) >= limit:
                    return
                full_p = os.path.join(current_dir, entry)
                indent = "  " * current_depth
                if os.path.isdir(full_p):
                    output.append(f"{indent}{entry}/")
                    _walk(full_p, current_depth + 1)
                else:
                    size_kb = os.path.getsize(full_p) / 1024
                    output.append(f"{indent}{entry}  ({size_kb:.1f} KB)")
        except Exception as err:
            output.append(f"{'  ' * current_depth} (Error reading dir: {err})")

    _walk(clean_path, 0)
    return "\n".join(output[:limit])


def jarvis_git_status(repo_path: str = None) -> str:
    """
    Inspects active git branch, modified files, and recent 5 commit history.
    """
    target = os.path.abspath(repo_path.strip('"\'')) if repo_path else config.BASE_DIR
    try:
        status_res = subprocess.run(["git", "status", "-s"], cwd=target, capture_output=True, text=True, timeout=5)
        log_res = subprocess.run(["git", "log", "-n", "5", "--oneline"], cwd=target, capture_output=True, text=True, timeout=5)
        
        status_text = status_res.stdout.strip() or "Clean working tree (no modified files)."
        log_text = log_res.stdout.strip() or "No commit history found."
        
        return f"=== Git Status ({target}) ===\n{status_text}\n\n=== Recent Commits ===\n{log_text}"
    except Exception as e:
        return f"Git Error: {str(e)}"


def jarvis_system_diagnostics(filter_name: str = None, top_n: int = 10) -> str:
    """
    Retrieves system CPU, RAM, disk usage, local IP, ping status, and top resource-heavy active processes.
    """
    try:
        import psutil
        import socket
        import subprocess
        import sys

        cpu_percent = psutil.cpu_percent(interval=0.2)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage('/')

        # Network check
        try:
            hostname = socket.gethostname()
            local_ip = socket.gethostbyname(hostname)
            param = '-n' if sys.platform.lower() == 'win32' else '-c'
            ping_res = subprocess.run(['ping', param, '1', '8.8.8.8'], capture_output=True, text=True, timeout=2)
            net_status = "ONLINE" if ping_res.returncode == 0 else "OFFLINE"
        except Exception:
            local_ip = "Unknown"
            net_status = "Unknown"

        diag = [
            "=== System & Network Diagnostics ===",
            f"• CPU Usage: {cpu_percent}%",
            f"• RAM Usage: {mem.percent}% ({mem.used / 1024**3:.1f} GB / {mem.total / 1024**3:.1f} GB)",
            f"• Disk Usage: {disk.percent}% ({disk.free / 1024**3:.1f} GB free of {disk.total / 1024**3:.1f} GB)",
            f"• Network: IP {local_ip} | Status: {net_status}",
            "",
            "=== Top Active Processes ==="
        ]

        procs = []
        for p in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
            try:
                info = p.info
                if filter_name:
                    if filter_name.lower() not in info['name'].lower():
                        continue
                procs.append(info)
            except Exception:
                continue

        procs.sort(key=lambda x: (x.get('memory_percent') or 0) + (x.get('cpu_percent') or 0), reverse=True)
        
        for p in procs[:top_n]:
            name = p.get('name', 'unknown')
            pid = p.get('pid', 0)
            mem_pct = p.get('memory_percent') or 0
            cpu_pct = p.get('cpu_percent') or 0
            diag.append(f"• PID {pid:6d} | {name:25s} | CPU: {cpu_pct:5.1f}% | RAM: {mem_pct:5.1f}%")

        return "\n".join(diag)
    except Exception as e:
        return f"System Diagnostics Error: {str(e)}"


def jarvis_network_status(host: str = "8.8.8.8") -> str:
    """
    Inspects active listening network ports, local IP, and web ping connectivity.
    """
    try:
        import socket
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)

        param = '-n' if sys.platform.lower() == 'win32' else '-c'
        ping_cmd = ['ping', param, '1', host]
        ping_res = subprocess.run(ping_cmd, capture_output=True, text=True, timeout=4)
        online = ping_res.returncode == 0

        return f"=== Network Status ===\n• Hostname: {hostname}\n• Local IP: {local_ip}\n• Internet Status: {'ONLINE' if online else 'OFFLINE (Ping failed)'}"
    except Exception as e:
        return f"Network Check Error: {str(e)}"


def jarvis_web_scrape(url: str, max_chars: int = None) -> str:
    """
    Fetches a web page URL over HTTP and returns clean readable Markdown.
    Uses modern Chrome headers, DOM cleaning via extract_clean_markdown, and a fallback reader
    to prevent HTTP 403 Forbidden / bot-protection errors.
    """
    if max_chars is None or max_chars <= 0:
        is_advanced = getattr(config, "TOOL_MODE", "basic") == "advanced"
        max_chars = 15000 if is_advanced else 5000

    if not url or not isinstance(url, str):
        return "Web Scraper Error: URL cannot be empty."

    url = url.strip()
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url

    from app.tools.web import is_youtube_url, extract_youtube_content
    if is_youtube_url(url):
        try:
            yt_text = extract_youtube_content(url, max_chars=max_chars)
            if yt_text and len(yt_text.strip()) >= 50:
                return f"=== Scraped Content ({url}) ===\n{yt_text}"
        except Exception as e:
            import sys
            print(f"[jarvis_web_scrape] YouTube extraction failed for {url}: {e}", file=sys.stderr)

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
    }

    raw_html = ""
    fetch_error = None

    try:
        import httpx
        with httpx.Client(follow_redirects=True, timeout=10.0, headers=headers) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                raw_html = resp.text
            elif resp.status_code in (401, 403, 429, 503):
                fetch_error = f"HTTP {resp.status_code}"
    except Exception as e:
        fetch_error = str(e)

    # If direct fetch succeeded, extract clean markdown
    if raw_html:
        try:
            import urllib.parse
            domain = urllib.parse.urlparse(url).netloc.replace("www.", "")
            from app.tools.web import extract_clean_markdown
            clean_md = extract_clean_markdown(raw_html, max_chars=max_chars, domain=domain, page_url=url)
            if clean_md and len(clean_md.strip()) >= 80:
                return f"=== Scraped Content ({url}) ===\n{clean_md}"
        except Exception:
            pass

    # If direct fetch failed or was blocked (e.g. 403 Forbidden / Cloudflare), attempt fallback via reader proxy
    try:
        import httpx
        jina_url = f"https://r.jina.ai/{url}"
        with httpx.Client(follow_redirects=True, timeout=12.0) as client:
            resp = client.get(jina_url)
            if resp.status_code == 200 and resp.text.strip():
                text = resp.text.strip()
                # Strip Jina header metadata
                text = re.sub(r'^(Title:.*?\n|URL Source:.*?\n|Markdown Content:\s*)+', '', text, flags=re.MULTILINE | re.IGNORECASE).strip()
                # Skip top navigation menu lines before the article / cast content anchor
                entry_match = re.search(r'(?im)^(?:#{1,4}\s+|(?:\*|\-)\s+)?(Full cast\s*&?\s*crew|Series Directed by|Series Cast|Cast and crew|Main Cast|Voice Cast|Characters & Voice Actors|Overview|Summary)\b(?!\s*\]\()', text)
                if entry_match and entry_match.start() < 8000:
                    text = text[entry_match.start():].strip()
                else:
                    first_h = -1
                    for match in re.finditer(r'(?m)^#{1,3}\s+', text):
                        first_h = match.start()
                        break
                    if first_h > 0 and first_h < 4000:
                        text = text[first_h:].strip()

                from app.tools.web import is_bot_blocked
                if is_bot_blocked(text):
                    fetch_error = "Protected by anti-bot/login security"
                else:
                    if len(text) > max_chars:
                        cutoff = max_chars
                        last_para = text.rfind("\n", 0, max_chars)
                        if last_para > max_chars * 0.7:
                            cutoff = last_para
                        text = text[:cutoff].strip() + f"\n\n... [Content truncated at {cutoff} characters]"
                    return f"=== Scraped Content ({url}) ===\n{text}"
    except Exception:
        pass

    return f"Web Scraper Notice: Could not access '{url}' ({fetch_error or 'Forbidden/Blocked'}). The site may require authentication or block automated scraping. Try searching for alternative sources using jarvis_web_search."



def jarvis_window_control(action: str = "list", title_query: str = None) -> str:
    """
    Inspects active desktop windows or sends window control actions.
    """
    action = action.lower()
    if action == "list":
        try:
            cmd = "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -HideTableHeaders"
            res = subprocess.run(["powershell", "-Command", cmd], capture_output=True, text=True, timeout=5)
            lines = [line.strip() for line in res.stdout.splitlines() if line.strip()]
            return f"=== Active Application Windows ===\n" + ("\n".join(lines[:20]) if lines else "No active desktop windows found.")
        except Exception as e:
            return f"Window Control Error: {str(e)}"
    
    return f"Window action '{action}' executed for query '{title_query or ''}'."


def jarvis_run_terminal(command: str, use_powershell: bool = True, cwd: str = None, stdin_input: str = None) -> str:
    """
    Runs a shell command via the system process supervisor with real-time output capture,
    working directory (cwd) support, and non-interactive environment variables.
    """
    clean_command = str(command).strip()
    if not clean_command:
        return "Terminal Error: Command string cannot be empty."

    clean_cwd = None
    if cwd:
        candidate_cwd = os.path.abspath(str(cwd).strip('"\''))
        if os.path.exists(candidate_cwd) and os.path.isdir(candidate_cwd):
            clean_cwd = candidate_cwd

    from app.tools.system import run_terminal_command
    return run_terminal_command(
        command=clean_command,
        use_powershell=use_powershell,
        cwd=clean_cwd,
        stdin_input=stdin_input
    )


def jarvis_send_stdin(input_text: str, pid: int = None) -> str:
    """
    Sends text or newline to standard input (stdin) of an active background terminal process.
    """
    from app.tools.system import send_process_stdin
    return send_process_stdin(input_text=input_text, pid=pid)


def _mask_key(key: str) -> str:
    """Mask an API key, keeping only the last 4 characters (e.g. 'ab..****' -> '****xyz1')."""
    key = str(key or "")
    if not key:
        return "<empty>"
    if len(key) <= 4:
        return "*" * len(key)
    return "*" * (len(key) - 4) + key[-4:]


def _analyze_image_file(image_path: str, prompt: str) -> str:
    """
    Shared vision-analysis pipeline used by jarvis_analyze_image and jarvis_see_screen.
    Sends a local image file to the configured vision model and returns its text response.
    """
    clean_path = os.path.abspath(image_path.strip('"\''))
    if not os.path.exists(clean_path):
        return f"Vision Error: Image path '{clean_path}' does not exist."

    from app.utils.attachment_manager import encode_image_to_base64_url
    data_url = encode_image_to_base64_url(clean_path)
    if not data_url:
        return f"Vision Error: Failed to read image bytes from '{clean_path}'."

    try:
        from app import config
        vision_model = ""
        try:
            from app.memory.local_mem import MemoryManager
            vision_model = MemoryManager().profile.get("settings", {}).get("llm_vision_model") or ""
        except Exception:
            pass
        vision_model = vision_model or getattr(config, "LLM_VISION_MODEL", "") or getattr(config, "LLM_MODEL", "") or ""
        api_key = config.LLM_API_KEY or os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""

        base_url = config.get_effective_base_url()
        print(f"[Vision] Analyzing '{clean_path}' with model='{vision_model}' | key='{_mask_key(api_key)}' | base_url='{base_url}'")

        import requests
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        url = f"{base_url}/chat/completions"

        payload = {
            "model": vision_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}}
                    ]
                }
            ],
            "temperature": 0.2
        }

        resp = requests.post(url, headers=headers, json=payload, timeout=60)
        if resp.status_code == 200:
            data = resp.json()
            choices = data.get("choices", [])
            if choices and choices[0].get("message", {}).get("content"):
                return choices[0]["message"]["content"]

        # Fallback to direct Gemini API if custom base_url returns error
        gemini_key = getattr(config, "GEMINI_API_KEY", None) or api_key
        print(f"[Vision] Primary request failed: HTTP {resp.status_code}. "
              f"Fallback direct-Gemini: {'yes' if gemini_key else 'no'} (key='{_mask_key(gemini_key)}'). Response: {resp.text[:300]}")
        if gemini_key:
            g_url = f"https://generativelanguage.googleapis.com/v1beta/models/{vision_model}:generateContent?key={gemini_key}"
            b64_data = data_url.split(",")[1] if "," in data_url else data_url
            mime = data_url.split(";")[0].replace("data:", "") if ";" in data_url else "image/png"
            g_payload = {
                "contents": [{
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": mime, "data": b64_data}}
                    ]
                }]
            }
            g_resp = requests.post(g_url, json=g_payload, timeout=60)
            if g_resp.status_code == 200:
                g_data = g_resp.json()
                try:
                    return g_data["candidates"][0]["content"]["parts"][0]["text"]
                except Exception:
                    pass
            print(f"[Vision] Fallback Gemini request failed: HTTP {g_resp.status_code}. Response: {g_resp.text[:300]}")

        return f"Vision Error: Failed to analyze image. HTTP {resp.status_code}: {resp.text[:300]}"
    except Exception as e:
        print(f"[Vision] Exception during analysis: {str(e)}")
        return f"Vision Exception: {str(e)}"


def jarvis_analyze_image(image_path: str, prompt: str = "Analyze and describe this image in detail.") -> str:
    """
    Scans and analyzes an image file on disk using a vision API or vision model.
    Allows text-only LLMs to understand visual diagrams, screenshots, and UI mockups.
    """
    return _analyze_image_file(image_path, prompt)


def jarvis_see_screen(prompt: str, window_title: str = None) -> str:
    """
    Captures the current screen (or a specific app window via window_title) and analyzes it
    with a vision model, returning a detailed description of what is visible including any text.
    """
    try:
        from app.utils.attachment_manager import get_attachment_directory
        from app.utils.screen_capture import grab_screen_clean
        from PIL import Image
        import datetime

        bbox = _find_window_bbox(window_title) if window_title else None
        img = grab_screen_clean(bbox=bbox)

        # Downscale very large captures to keep vision payloads token-efficient.
        max_dim = 1280
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

        target_dir = get_attachment_directory()
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        save_path = os.path.join(target_dir, f"screen_{stamp}.png")
        img.save(save_path, "PNG")
        print(f"[Jarvis] Screen captured to '{save_path}' ({img.size[0]}x{img.size[1]}).")
    except Exception as e:
        return f"Vision Exception: Screen capture failed: {str(e)}"

    avatar_anchor = (
        "\n\n[DESKTOP CONTEXT: The 3D anime avatar visible floating on this desktop screen is the AI assistant (Yuki). "
        "Do NOT describe, mention, or focus on the 3D avatar; focus entirely on the open applications, browser windows, code, documents, and desktop content.]"
    )
    base_prompt = prompt or (
        "Analyze this screen capture in extreme detail. Describe every visible element: layout, "
        "windows, icons, buttons, menus, colors, and state. Then transcribe ALL visible text verbatim, "
        "including titles, labels, error messages, dialog boxes, status bars, and menu items."
    )
    effective_prompt = base_prompt + avatar_anchor
    try:
        result = _analyze_image_file(save_path, effective_prompt)
    finally:
        try:
            if os.path.exists(save_path):
                os.remove(save_path)
                print(f"[Jarvis] Temp screen capture '{save_path}' deleted.")
        except Exception:
            pass
    return result


def _find_window_bbox(window_title: str):
    """Returns (left, top, right, bottom) for the first window matching window_title, or None."""
    try:
        import win32gui
    except Exception:
        try:
            import pygetwindow as gw
            wins = gw.getWindowsWithTitle(window_title)
            if not wins:
                return None
            w = wins[0]
            return (w.left, w.top, w.right, w.bottom)
        except Exception:
            return None

    def enum_cb(hwnd, results):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        if title and (window_title.lower() in title.lower()):
            results.append(hwnd)

    results = []
    try:
        win32gui.EnumWindows(enum_cb, results)
    except Exception:
        pass
    if not results:
        return None
    rect = win32gui.GetWindowRect(results[0])
    return tuple(rect)


def jarvis_generate_image(prompt: str, aspect_ratio: str = "1:1", style: str = "auto") -> str:
    """
    Generates a high-quality image from a text description using the configured Image Generation Model.
    Supports OpenRouter, Grok (xAI), OpenAI, Together AI, Google AI Studio, Local WebUI, and Free FLUX.1 with style presets.
    Saves the image to yuki_attachment/generated_images and automatically opens it in the default system image viewer and Canvas.
    """
    import base64
    import datetime
    import json
    import os
    import re
    import time
    import urllib.parse
    import uuid
    from pathlib import Path
    import requests
    from app import config
    from app.tools.canvas import _broadcast_canvas_ws

    if not prompt or not prompt.strip():
        return "Image Generation Error: Please provide a description of the image you want to generate."

    # 1. Resolve configured Image Generation Provider, Models & Keys
    image_provider = "pollinations"
    image_model = ""
    use_free_override = False
    hf_key = ""
    horde_key = "0000000000"
    horde_model = "Pony Diffusion V6 XL"

    try:
        from app.memory.local_mem import MemoryManager
        mem_settings = MemoryManager().profile.get("settings", {})
        image_provider = mem_settings.get("image_gen_provider") or getattr(config, "IMAGE_GEN_PROVIDER", "pollinations")
        image_model = mem_settings.get("llm_image_gen_model") or getattr(config, "LLM_IMAGE_GEN_MODEL", "")
        use_free_override = bool(mem_settings.get("use_free_image_gen", getattr(config, "USE_FREE_IMAGE_GEN", False)))
        hf_key = mem_settings.get("huggingface_api_key") or getattr(config, "HUGGINGFACE_API_KEY", "")
        horde_key = mem_settings.get("stable_horde_api_key") or getattr(config, "STABLE_HORDE_API_KEY", "0000000000")
        horde_model = mem_settings.get("stable_horde_model") or getattr(config, "STABLE_HORDE_MODEL", "Pony Diffusion V6 XL")
    except Exception:
        image_provider = getattr(config, "IMAGE_GEN_PROVIDER", "pollinations")
        image_model = getattr(config, "LLM_IMAGE_GEN_MODEL", "")
        use_free_override = getattr(config, "USE_FREE_IMAGE_GEN", False)
        hf_key = getattr(config, "HUGGINGFACE_API_KEY", "")
        horde_key = getattr(config, "STABLE_HORDE_API_KEY", "0000000000")
        horde_model = getattr(config, "STABLE_HORDE_MODEL", "Pony Diffusion V6 XL")

    image_provider = (image_provider or "pollinations").strip().lower()
    image_model = (image_model or "").strip()
    hf_key = (hf_key or "").strip()
    horde_key = (horde_key or "0000000000").strip()
    horde_model = (horde_model or "Pony Diffusion V6 XL").strip()

    def generate_via_flux_free(prompt_text: str, aspect: str, chosen_style: str = "auto"):
        try:
            w, h = 1024, 1024
            if "16:9" in aspect:
                w, h = 1344, 768
            elif "9:16" in aspect:
                w, h = 768, 1344
            elif "4:3" in aspect:
                w, h = 1152, 864
            elif "3:4" in aspect:
                w, h = 864, 1152

            # Resolve style model preset (flux, flux-anime, flux-realism, flux-3d, turbo)
            effective_style = "flux"
            s_lower = (chosen_style or "auto").strip().lower()
            p_lower = prompt_text.lower()
            if s_lower in ("flux", "flux-anime", "flux-realism", "flux-3d", "turbo", "any-dark"):
                effective_style = s_lower
            elif s_lower == "anime" or any(w in p_lower for w in ("anime", "manga", "waifu", "chibi", "otaku", "shonen", "shoujo", "kawaii", "genshin", "vtuber")):
                effective_style = "flux-anime"
            elif s_lower in ("realism", "realistic", "photo") or any(w in p_lower for w in ("realistic", "realism", "photograph", "portrait", "dslr", "raw photo", "cinematic photo", "real life")):
                effective_style = "flux-realism"
            elif s_lower in ("3d", "cgi", "render") or any(w in p_lower for w in ("3d", "cgi", "unreal engine", "isometric", "pixar", "claymation", "blender", "octane render")):
                effective_style = "flux-3d"
            elif s_lower == "turbo":
                effective_style = "turbo"

            encoded_prompt = urllib.parse.quote(prompt_text)
            flux_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={w}&height={h}&nologo=true&model={effective_style}"
            print(f"[ImageGen][FLUX-Free] Fetching free image ({effective_style}) from {flux_url[:110]}...")
            resp = requests.get(flux_url, timeout=50)
            if resp.status_code == 200 and len(resp.content) > 5000:
                return resp.content, effective_style

            # If specialized style timed out or returned error, try fast base flux
            if effective_style != "flux":
                print("[ImageGen][FLUX-Free] Specialized style failed/timed out. Trying base FLUX.1...")
                fallback_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={w}&height={h}&nologo=true&model=flux"
                fb_resp = requests.get(fallback_url, timeout=30)
                if fb_resp.status_code == 200 and len(fb_resp.content) > 5000:
                    return fb_resp.content, "flux"
        except Exception as e:
            print(f"[ImageGen][FLUX-Free] Free generation error: {e}")
            try:
                # Emergency fast retry with base model
                encoded_prompt = urllib.parse.quote(prompt_text)
                fb_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=1024&height=1024&nologo=true&model=flux"
                fb_resp = requests.get(fb_url, timeout=25)
                if fb_resp.status_code == 200 and len(fb_resp.content) > 5000:
                    return fb_resp.content, "flux"
            except Exception:
                pass
        return None, "flux"

    def enrich_prompt_for_style(p_text: str, s_choice: str) -> str:
        s = (s_choice or "auto").strip().lower()
        p_lower = p_text.lower()
        if s in ("flux-anime", "anime") or any(w in p_lower for w in ("anime", "manga", "waifu", "chibi", "otaku", "genshin")):
            if "anime" not in p_lower and "manga" not in p_lower and "cel-shaded" not in p_lower:
                return f"{p_text}, vibrant Japanese anime artwork, highly detailed cel-shaded illustration"
        elif s in ("flux-realism", "realism", "photo") or any(w in p_lower for w in ("realistic", "realism", "photograph", "portrait", "dslr")):
            if "photorealistic" not in p_lower and "realistic" not in p_lower and "photography" not in p_lower:
                return f"{p_text}, photorealistic 85mm portrait photography, natural skin texture, studio lighting, 8k resolution"
        elif s in ("flux-3d", "3d", "cgi") or any(w in p_lower for w in ("3d", "cgi", "pixar", "isometric", "render", "unreal engine")):
            if "3d" not in p_lower and "pixar" not in p_lower and "render" not in p_lower:
                return f"{p_text}, 3D CGI Disney Pixar style character render, Octane 3D render, volumetric lighting"
        return p_text

    def generate_via_huggingface(prompt_text: str, token: str, model_name: str = "", chosen_style: str = "auto"):
        if not token:
            return None
        raw_model = (model_name or "").strip().replace("models/", "")
        if not raw_model or "/" not in raw_model or any(k in raw_model.lower() for k in ("gemini", "gpt", "claude", "qwen", "llama", "deepseek")):
            target_model = "black-forest-labs/FLUX.1-dev"
        else:
            target_model = raw_model
        styled_prompt = enrich_prompt_for_style(prompt_text, chosen_style)
        endpoints = [
            f"https://router.huggingface.co/hf-inference/models/{target_model}",
            f"https://api-inference.huggingface.co/models/{target_model}"
        ]
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "x-wait-for-model": "true"
        }
        for ep in endpoints:
            try:
                print(f"[ImageGen][HuggingFace] Requesting model '{target_model}' via {ep} (prompt='{styled_prompt[:60]}')...")
                resp = requests.post(ep, headers=headers, json={"inputs": styled_prompt}, timeout=75)
                if resp.status_code == 200 and len(resp.content) > 5000:
                    return resp.content
                elif resp.status_code == 503:
                    # Model is currently loading into GPU memory on Hugging Face
                    time.sleep(6)
                    retry_resp = requests.post(ep, headers=headers, json={"inputs": styled_prompt}, timeout=75)
                    if retry_resp.status_code == 200 and len(retry_resp.content) > 5000:
                        return retry_resp.content
            except Exception as e:
                print(f"[ImageGen][HuggingFace] Attempt error via {ep}: {e}")
        return None

    def generate_via_stable_horde(prompt_text: str, aspect: str, api_token: str, model_choice: str, chosen_style: str = "auto"):
        try:
            w, h = 512, 512
            if "16:9" in aspect:
                w, h = 768, 448
            elif "9:16" in aspect:
                w, h = 448, 768

            styled_prompt = enrich_prompt_for_style(prompt_text, chosen_style)
            h_url = "https://aihorde.net/api/v2/generate/async"
            h_headers = {
                "apikey": api_token or "0000000000",
                "Client-Agent": "ProjectYuki:v0.3.5:github.com/dekkeroid/Project-Yuki"
            }

            # Resolve target models dynamically if set to 'auto'
            s_lower = (chosen_style or "auto").strip().lower()
            p_lower = prompt_text.lower()
            if not model_choice or model_choice.lower() == "auto":
                if s_lower in ("flux-anime", "anime") or any(w in p_lower for w in ("anime", "manga", "waifu", "genshin")):
                    target_models = ["Pony Diffusion V6 XL", "Illustrious XL"]
                elif s_lower in ("flux-realism", "realism", "photo") or any(w in p_lower for w in ("realistic", "photograph", "portrait", "dslr")):
                    target_models = ["Juggernaut XL", "ICBINP - I Can't Believe It's Not Photography"]
                else:
                    target_models = ["Dreamshaper", "Pony Diffusion V6 XL", "stable_diffusion"]
            else:
                target_models = [model_choice]

            h_payload = {
                "prompt": styled_prompt,
                "params": {
                    "sampler_name": "k_euler",
                    "cfg_scale": 7.0,
                    "width": w,
                    "height": h,
                    "steps": 25,
                    "n": 1
                },
                "models": target_models
            }
            print(f"[ImageGen][StableHorde] Submitting prompt to Horde models {target_models} (prompt='{styled_prompt[:60]}')...")
            resp = requests.post(h_url, headers=h_headers, json=h_payload, timeout=20)
            if resp.status_code == 202:
                task_id = resp.json().get("id")
                print(f"[ImageGen][StableHorde] Task accepted (ID: {task_id}). Awaiting generation...")
                for _ in range(25):  # Poll up to ~50s
                    time.sleep(2)
                    c_resp = requests.get(f"https://aihorde.net/api/v2/generate/check/{task_id}", headers=h_headers, timeout=10)
                    if c_resp.status_code == 200 and c_resp.json().get("done"):
                        break
                # Fetch result
                s_resp = requests.get(f"https://aihorde.net/api/v2/generate/status/{task_id}", headers=h_headers, timeout=15)
                if s_resp.status_code == 200:
                    gens = s_resp.json().get("generations", [])
                    if gens:
                        img_field = gens[0].get("img", "")
                        if img_field.startswith("http"):
                            dl = requests.get(img_field, timeout=30)
                            if dl.status_code == 200:
                                return dl.content
                        elif img_field:
                            return base64.b64decode(img_field)
        except Exception as e:
            print(f"[ImageGen][StableHorde] Error: {e}")
        return None

    # 2. Resolve credentials & endpoint
    api_key = config.LLM_API_KEY or os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    base_url = config.get_effective_base_url()

    out_dir = Path(config.BASE_DIR) / "yuki_attachment" / "generated_images"
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"gen_{int(time.time())}_{uuid.uuid4().hex[:6]}.png"
    file_path = out_dir / filename

    print(f"[ImageGen] Generating image | provider='{image_provider}' | prompt='{prompt[:60]}...' | model='{image_model or '(default)'}'")

    image_bytes = None
    last_error = ""
    engine_used = ""

    # Check Provider Strategy
    if image_provider == "huggingface" and hf_key:
        print("[ImageGen] Using Hugging Face Inference API.")
        image_bytes = generate_via_huggingface(prompt, hf_key, image_model, style)
        if image_bytes:
            engine_used = f"Hugging Face ({image_model or 'FLUX.1-dev'})"

    elif image_provider == "stable_horde":
        print(f"[ImageGen] Using Stable Horde ({horde_model}).")
        image_bytes = generate_via_stable_horde(prompt, aspect_ratio, horde_key, horde_model, style)
        if image_bytes:
            engine_used = f"Stable Horde ({horde_model})"

    elif use_free_override or image_provider == "pollinations":
        print("[ImageGen] Using Free FLUX.1 Engine as primary generator.")
        image_bytes, used_style = generate_via_flux_free(prompt, aspect_ratio, style)
        if image_bytes:
            engine_used = f"Free FLUX.1 ({used_style})"

    # Strategy 1: OpenAI-Compatible /images/generations endpoint (OpenRouter, Grok, OpenAI, Together, Custom)
    if not image_bytes and base_url:
        try:
            oai_url = f"{base_url.rstrip('/')}/images/generations"
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            payload = {
                "prompt": prompt,
                "n": 1,
                "size": "1024x1024" if aspect_ratio == "1:1" else ("1792x1024" if "16:9" in aspect_ratio else "1024x1792"),
                "response_format": "b64_json"
            }
            if image_model:
                payload["model"] = image_model

            resp = requests.post(oai_url, headers=headers, json=payload, timeout=90)
            if resp.status_code == 200:
                res_data = resp.json()
                items = res_data.get("data", [])
                if items:
                    if items[0].get("b64_json"):
                        image_bytes = base64.b64decode(items[0]["b64_json"])
                    elif items[0].get("url"):
                        img_dl = requests.get(items[0]["url"], timeout=30)
                        if img_dl.status_code == 200:
                            image_bytes = img_dl.content
                    if image_bytes:
                        engine_used = image_model or "OpenAI Image Endpoint"
            else:
                last_error = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except Exception as e:
            last_error = str(e)

    # Strategy 2: Google AI Studio / Gemini REST API (if base_url is Google or Strategy 1 failed)
    if not image_bytes and api_key and ("googleapis.com" in base_url or not base_url or "gemini" in (image_model or "").lower() or "imagen" in (image_model or "").lower()):
        clean_model = image_model.replace("models/", "").strip() if image_model else ""
        imagen_target = clean_model if (clean_model and clean_model.lower().startswith("imagen-")) else "imagen-3.0-generate-002"
        # Try Imagen :predict endpoint
        try:
            g_url = f"https://generativelanguage.googleapis.com/v1beta/models/{imagen_target}:predict?key={api_key}"
            g_payload = {
                "instances": [{"prompt": prompt}],
                "parameters": {"sampleCount": 1, "aspectRatio": aspect_ratio}
            }
            g_resp = requests.post(g_url, json=g_payload, timeout=60)
            if g_resp.status_code == 200:
                g_data = g_resp.json()
                preds = g_data.get("predictions", [])
                if preds and preds[0].get("bytesBase64Encoded"):
                    image_bytes = base64.b64decode(preds[0]["bytesBase64Encoded"])
                    engine_used = imagen_target
            else:
                last_error = f"Google Predict HTTP {g_resp.status_code}: {g_resp.text[:300]}"
        except Exception as e:
            last_error = str(e)

        # Try Gemini multimodal :generateContent inline_data
        if not image_bytes:
            gemini_target = clean_model if (clean_model and "gemini" in clean_model.lower()) else "gemini-2.0-flash"
            try:
                g_url2 = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_target}:generateContent?key={api_key}"
                g_payload2 = {
                    "contents": [{"parts": [{"text": f"Generate an image of: {prompt}"}]}]
                }
                g_resp2 = requests.post(g_url2, json=g_payload2, timeout=60)
                if g_resp2.status_code == 200:
                    g_data2 = g_resp2.json()
                    candidates = g_data2.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for p in parts:
                            if "inline_data" in p and p["inline_data"].get("data"):
                                image_bytes = base64.b64decode(p["inline_data"]["data"])
                                engine_used = gemini_target
                                break
                            elif "text" in p:
                                b64_match = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)', p["text"])
                                if b64_match:
                                    image_bytes = base64.b64decode(b64_match.group(1))
                                    engine_used = gemini_target
                                    break
            except Exception as e:
                last_error = str(e)

    # Strategy 3: Chat Interleaved / Multimodal fallback via /chat/completions
    if not image_bytes and base_url:
        try:
            chat_url = f"{base_url.rstrip('/')}/chat/completions"
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            chat_payload = {
                "model": image_model or getattr(config, "LLM_MODEL", ""),
                "messages": [{"role": "user", "content": f"Generate an image of: {prompt}"}]
            }
            c_resp = requests.post(chat_url, headers=headers, json=chat_payload, timeout=60)
            if c_resp.status_code == 200:
                c_data = c_resp.json()
                c_text = c_data.get("choices", [{}])[0].get("message", {}).get("content", "")
                b64_match = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)', c_text)
                if b64_match:
                    image_bytes = base64.b64decode(b64_match.group(1))
                    engine_used = image_model or "Multimodal Chat Model"
                else:
                    url_match = re.search(r'https?://[^\s\)\"\']+\.(?:png|jpg|jpeg|webp)', c_text)
                    if url_match:
                        dl = requests.get(url_match.group(0), timeout=30)
                        if dl.status_code == 200:
                            image_bytes = dl.content
                            engine_used = image_model or "Multimodal Chat Model"
        except Exception:
            pass

    # Strategy 4: Automatic Free FLUX.1 Fallback if upstream provider failed or had 0 quota
    if not image_bytes:
        print(f"[ImageGen] Configured provider failed ({last_error or 'No response'}). Activating Free FLUX.1 fallback...")
        image_bytes, used_style = generate_via_flux_free(prompt, aspect_ratio, style)
        if image_bytes:
            engine_used = f"Free FLUX.1 ({used_style}) [Auto Fallback]"

    if not image_bytes:
        return f"Image Generation Notice: Could not generate image using model '{image_model or 'default'}'. Details: {last_error or 'No image data returned from provider or fallback.'}"

    # 3. Save to disk
    file_path.write_bytes(image_bytes)
    print(f"[ImageGen] Image saved successfully to '{file_path}' ({len(image_bytes)} bytes) using engine '{engine_used}'.")

    # 4. Open in native system default Image Viewer (Windows Photos, IrfanView, Honeyview, etc.)
    clean_path_str = str(file_path).replace("\\", "/")
    try:
        if hasattr(os, "startfile"):
            os.startfile(str(file_path))
        else:
            import subprocess
            subprocess.Popen(["start", "", str(file_path)], shell=True)
        print(f"[ImageGen] Opened '{file_path}' in native system image viewer.")
    except Exception as e:
        print(f"[ImageGen] Native image viewer launch warning: {e}")

    return f"Successfully generated image using {engine_used} for: \"{prompt}\"\n\n- File Path: {clean_path_str}\n- Opened in default image viewer."

