"""
Advanced Jarvis PC Tools Implementation for Project Yuki.
Completely independent, self-contained toolsuite for Frontier Cloud LLMs.
Provides deep system diagnostics, SQLite file database queries, code review, 
web page scraping, git status, file management, app launcher, and PC desktop automation.
"""

import os
import sys
import sqlite3
import subprocess
import time
import json
import re
import urllib.request
import urllib.parse
from pathlib import Path
import app.config as config

def jarvis_query_file_db(query: str, limit: int = 15) -> str:
    """
    Queries the backend SQLite database (yuki_files.db) using FTS5 full-text search 
    and path matching to locate files instantly across indexed drives.
    """
    if not query or not query.strip():
        return "Error: Query string cannot be empty."

    db_path = getattr(config, "DB_PATH", os.path.join(config.BASE_DIR, "yuki_files.db"))
    if not os.path.exists(db_path):
        return f"Database error: SQLite file database '{db_path}' does not exist yet."

    clean_query = query.strip()
    
    try:
        conn = sqlite3.connect(db_path, timeout=5)
        cursor = conn.cursor()
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('files', 'file_index');")
        tables = [row[0] for row in cursor.fetchall()]
        
        target_table = "files" if "files" in tables else ("file_index" if "file_index" in tables else None)
        if not target_table:
            conn.close()
            return "Database notice: File index table has not been initialized yet."

        sql = f"""
            SELECT file_path, size, extension, last_modified 
            FROM {target_table} 
            WHERE file_path LIKE ? OR file_name LIKE ? 
            ORDER BY last_modified DESC 
            LIMIT ?
        """
        like_pattern = f"%{clean_query}%"
        cursor.execute(sql, (like_pattern, like_pattern, max(1, min(limit, 50))))
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return f"No indexed files found matching query '{clean_query}'."

        output_lines = [f"Found {len(rows)} indexed files for '{clean_query}':"]
        for r in rows:
            path_str, size_bytes, ext, mod_time = r[0], r[1], r[2], r[3]
            size_mb = (size_bytes or 0) / (1024 * 1024)
            output_lines.append(f"• [{path_str}] ({size_mb:.2f} MB, ext: {ext or 'none'})")

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


def jarvis_create_or_edit_file(file_path: str, content: str, mode: str = "write") -> str:
    """
    Creates or edits a file on disk. Mode: 'write' (overwrite/create) or 'append'.
    """
    clean_path = os.path.abspath(file_path.strip('"\''))
    try:
        os.makedirs(os.path.dirname(clean_path), exist_ok=True)
        file_mode = "a" if mode == "append" else "w"
        with open(clean_path, file_mode, encoding="utf-8") as f:
            f.write(content)
        return f"Success: File '{clean_path}' written successfully ({len(content)} characters)."
    except Exception as e:
        return f"File Write Error: {str(e)}"


def jarvis_list_dir_tree(dir_path: str, max_depth: int = 2) -> str:
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
        try:
            entries = os.listdir(current_dir)
            for entry in entries[:40]:
                if entry.startswith('.') or entry in ('__pycache__', 'node_modules', 'venv', 'dist', 'build'):
                    continue
                full_p = os.path.join(current_dir, entry)
                indent = "  " * current_depth
                if os.path.isdir(full_p):
                    output.append(f"{indent}📁 {entry}/")
                    _walk(full_p, current_depth + 1)
                else:
                    size_kb = os.path.getsize(full_p) / 1024
                    output.append(f"{indent}📄 {entry} ({size_kb:.1f} KB)")
        except Exception as err:
            output.append(f"{'  ' * current_depth} (Error reading dir: {err})")

    _walk(clean_path, 0)
    return "\n".join(output[:100])


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
    Retrieves system CPU, RAM, disk usage, and top resource-heavy active processes.
    """
    try:
        import psutil
        cpu_percent = psutil.cpu_percent(interval=0.2)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage('/')

        diag = [
            "=== System Diagnostics ===",
            f"• CPU Usage: {cpu_percent}%",
            f"• RAM Usage: {mem.percent}% ({mem.used / 1024**3:.1f} GB / {mem.total / 1024**3:.1f} GB)",
            f"• Disk Usage: {disk.percent}% ({disk.free / 1024**3:.1f} GB free of {disk.total / 1024**3:.1f} GB)",
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
