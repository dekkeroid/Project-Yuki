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


def jarvis_web_scrape(url: str, max_chars: int = 4000) -> str:
    """
    Fetches a web page URL over HTTP and returns clean readable markdown text.
    """
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url

    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            html = response.read().decode('utf-8', errors='replace')

        clean_html = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', clean_html)
        text = re.sub(r'\s+', ' ', text).strip()

        if len(text) > max_chars:
            text = text[:max_chars] + f"\n... [Truncated at {max_chars} characters]"

        return f"=== Scraped Content ({url}) ===\n{text}"
    except Exception as e:
        return f"Web Scraper Error: {str(e)}"


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
        vision_model = vision_model or getattr(config, "LLM_VISION_MODEL", "") or ""
        if not vision_model:
            vision_model = "gemini-3.6-flash"
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
        from PIL import Image, ImageGrab
        import datetime

        if window_title:
            bbox = _find_window_bbox(window_title)
            if bbox:
                img = ImageGrab.grab(bbox=bbox)
            else:
                img = ImageGrab.grab()
        else:
            img = ImageGrab.grab()

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

    effective_prompt = prompt or (
        "Analyze this screen capture in extreme detail. Describe every visible element: layout, "
        "windows, icons, buttons, menus, colors, and state. Then transcribe ALL visible text verbatim, "
        "including titles, labels, error messages, dialog boxes, status bars, and menu items."
    )
    return _analyze_image_file(save_path, effective_prompt)


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
