import os
import re
import base64
import subprocess
import sys
import platform
import socket
import psutil
import time

_DEV_SERVER_ERROR_MESSAGE = "Security / Execution Error: Executing development servers by AI is strictly prohibited by security policy. Project files and builds were updated. Please start dev servers manually in your terminal if needed."

_DEV_SERVER_BANNED_SUBSTRINGS = (
    "npm run dev", "npm dev", "yarn run dev", "yarn dev", "pnpm run dev", "pnpm dev", "bun run dev", "bun dev",
    "npm run start", "yarn run start", "pnpm run start", "bun run start",
    "npm run preview", "yarn run preview", "pnpm run preview", "bun run preview",
    "npm run serve", "yarn run serve", "pnpm run serve", "bun run serve",
    "npm start", "yarn start", "pnpm start", "bun start",
    "npm preview", "yarn preview", "pnpm preview", "bun preview",
    "npm serve", "yarn serve", "pnpm serve", "bun serve",
)

_DEV_SERVER_LAUNCHER_PREFIXES = (
    "npx -y", "npx", "bunx", "yarn dlx", "pnpm dlx",
    "cmd /c", "call", "powershell -command", "pwsh -command",
)

_DEV_SERVER_LEADING_TOKENS = (
    "next dev", "next start", "nuxt dev", "nuxt start",
    "ng serve", "nodemon", "webpack serve", "webpack-dev-server",
    "svelte-kit dev", "astro dev",
)

def _normalize_command_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", str(text).lower()).strip()


def _decode_encoded_command_variants(text: str) -> list:
    """Decode PowerShell -EncodedCommand / -Enc base64 payloads for recursive inspection."""
    variants = []
    for match in re.finditer(r"(?i)(?:-encodedcommand|-enc)\s+([a-z0-9+/=]+)", text):
        token = match.group(1)
        for encoding in ("utf-16-le", "utf-8"):
            try:
                decoded = base64.b64decode(token).decode(encoding, errors="ignore")
                if decoded.strip():
                    variants.append(decoded)
            except Exception:
                continue
    return variants


def _segment_starts_banned_dev_server(segment: str) -> bool:
    s = segment.strip().lower()
    for prefix in _DEV_SERVER_LAUNCHER_PREFIXES:
        if s == prefix or s.startswith(prefix + " "):
            s = s[len(prefix):].strip()
            break
    if s.startswith("vite build"):
        return False
    if s == "vite" or s.startswith("vite ") or s.startswith("vite@"):
        return True
    for token in _DEV_SERVER_LEADING_TOKENS:
        if s == token or s.startswith(token + " "):
            return True
    return False


def _contains_banned_dev_server(text: str) -> bool:
    probe = _normalize_command_whitespace(text)
    if not probe:
        return False
    for banned in _DEV_SERVER_BANNED_SUBSTRINGS:
        if banned in probe:
            return True
    for segment in re.split(r"\s*(?:&&|\|\||;|\||&)\s*", probe):
        if _segment_starts_banned_dev_server(segment):
            return True
    for variant in _decode_encoded_command_variants(text):
        if _contains_banned_dev_server(variant):
            return True
    return False


def _banned_dev_server_check(text: str):
    """Returns the security error message if the input contains a banned dev-server command, else None."""
    if _contains_banned_dev_server(text):
        return _DEV_SERVER_ERROR_MESSAGE
    return None


def _extract_python_string_literals(code: str) -> list:
    """Collect all string literals from Python source to catch subprocess list-args like ['npm', 'run', 'dev']."""
    literals = []
    try:
        import ast
        tree = ast.parse(code)
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                literals.append(node.value)
            elif isinstance(node, ast.JoinedStr):
                for value in node.values:
                    if isinstance(value, ast.Constant) and isinstance(value.value, str):
                        literals.append(value.value)
    except (SyntaxError, ValueError):
        pass
    return literals


def get_system_stats() -> str:
    """
    Returns system status such as CPU usage, available RAM, disk usage, IP address, and OS details.
    """
    if platform.system() != "Windows":
        return f"Currently running on {platform.system()}. System stats are only fully supported on Windows."
    
    os_detail = f"Windows {platform.release()} (Build {platform.version()})"
    
    try:
        cpu = f"{psutil.cpu_percent(interval=0.1)}%"
    except:
        cpu = "Unknown"
        
    try:
        mem = psutil.virtual_memory()
        mem_str = f"{round(mem.used / (1024**3), 2)} GB / {round(mem.total / (1024**3), 2)} GB ({mem.percent}%)"
    except:
        mem_str = "Unknown"
        
    try:
        disk = psutil.disk_usage('C:\\')
        disk_str = f"{round(disk.used / (1024**3), 2)} GB / {round(disk.total / (1024**3), 2)} GB ({disk.percent}%)"
    except:
        disk_str = "Unknown"
        
    # Get local IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip_addr = s.getsockname()[0]
        s.close()
    except:
        ip_addr = "127.0.0.1"
        
    # Get current datetime
    try:
        import datetime
        now = datetime.datetime.now()
        dt_str = now.strftime("%A, %B %d, %Y, %I:%M %p")
    except:
        dt_str = "Unknown"
        
    return f"OS: {os_detail}\nCPU Usage: {cpu}\nMemory Usage: {mem_str}\nDisk Usage (C:): {disk_str}\nIP Address: {ip_addr}\nCurrent Date/Time: {dt_str}"


_UWP_APPS_CACHE = None
_RESOLVED_POWERSHELL_PATH = None
_RESOLVED_NVIDIA_SMI_PATH = None
_NVIDIA_SMI_CHECKED = False

def _get_powershell_executable() -> str | None:
    global _RESOLVED_POWERSHELL_PATH
    if _RESOLVED_POWERSHELL_PATH is not None:
        return _RESOLVED_POWERSHELL_PATH or None
    import shutil
    for name in ("powershell", "pwsh", "powershell.exe", "pwsh.exe"):
        found = shutil.which(name)
        if found:
            _RESOLVED_POWERSHELL_PATH = found
            return _RESOLVED_POWERSHELL_PATH
    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    candidates = [
        os.path.join(system_root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        os.path.join(system_root, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe"),
        os.path.join(program_files, "PowerShell", "7", "pwsh.exe"),
        os.path.join(program_files, "PowerShell", "6", "pwsh.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            _RESOLVED_POWERSHELL_PATH = c
            return _RESOLVED_POWERSHELL_PATH
    _RESOLVED_POWERSHELL_PATH = ""
    return None

def _run_powershell_command(command_str: str, timeout: float = 10.0) -> str | None:
    """Execute a PowerShell command safely without shell=True or leaking stderr."""
    ps_exe = _get_powershell_executable()
    if not ps_exe:
        return None
    try:
        res = subprocess.run(
            [ps_exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command_str],
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
        if res.returncode == 0:
            return res.stdout.strip()
    except Exception:
        pass
    return None

def _get_nvidia_smi_executable() -> str | None:
    global _RESOLVED_NVIDIA_SMI_PATH, _NVIDIA_SMI_CHECKED
    if _NVIDIA_SMI_CHECKED:
        return _RESOLVED_NVIDIA_SMI_PATH or None
    _NVIDIA_SMI_CHECKED = True
    import shutil
    for name in ("nvidia-smi", "nvidia-smi.exe"):
        found = shutil.which(name)
        if found:
            _RESOLVED_NVIDIA_SMI_PATH = found
            return _RESOLVED_NVIDIA_SMI_PATH
    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    candidates = [
        os.path.join(system_root, "System32", "nvidia-smi.exe"),
        os.path.join(program_files, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            _RESOLVED_NVIDIA_SMI_PATH = c
            return _RESOLVED_NVIDIA_SMI_PATH
    _RESOLVED_NVIDIA_SMI_PATH = ""
    return None

def _get_uwp_apps() -> list:
    global _UWP_APPS_CACHE
    if _UWP_APPS_CACHE is not None:
        return _UWP_APPS_CACHE
    
    import json
    try:
        out = _run_powershell_command("Get-StartApps | ConvertTo-Json", timeout=8.0)
        if out:
            apps = json.loads(out)
            if isinstance(apps, dict):
                apps = [apps]
            _UWP_APPS_CACHE = apps
            print(f"[UWP Search] Found {len(_UWP_APPS_CACHE)} apps in Start menu/UWP.")
            return _UWP_APPS_CACHE
        _UWP_APPS_CACHE = []
        return []
    except Exception as e:
        print(f"[UWP Search] Error listing apps: {e}")
        _UWP_APPS_CACHE = []
        return []

def _find_uwp_app(app_name: str, exact_only: bool = False) -> str | None:
    apps = _get_uwp_apps()
    app_name_clean = app_name.lower().replace(".exe", "").replace(" ", "")
    if not app_name_clean:
        return None
        
    # Try exact match first
    for app in apps:
        name = app.get("Name", "")
        name_clean = name.lower().replace(" ", "")
        if app_name_clean == name_clean:
            app_id = app.get("AppID")
            if app_id:
                return f"shell:AppsFolder\\{app_id}"
                
    if exact_only:
        return None
        
    # Try partial match/contains match
    for app in apps:
        name = app.get("Name", "")
        name_clean = name.lower().replace(" ", "")
        if app_name_clean in name_clean or name_clean in app_name_clean:
            is_prefix = name_clean.startswith(app_name_clean) or app_name_clean.startswith(name_clean)
            is_high_ratio = len(app_name_clean) >= (len(name_clean) * 0.5) or len(name_clean) >= (len(app_name_clean) * 0.5)
            if is_prefix or is_high_ratio:
                app_id = app.get("AppID")
                if app_id:
                    return f"shell:AppsFolder\\{app_id}"
    return None

def _find_app_in_registry(app_name: str) -> str:
    try:
        import winreg
        names_to_try = [app_name, f"{app_name}.exe"] if not app_name.endswith(".exe") else [app_name]
        for name in names_to_try:
            for hive in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER]:
                reg_path = f"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{name}"
                try:
                    with winreg.OpenKey(hive, reg_path) as key:
                        exe_path, _ = winreg.QueryValueEx(key, "")
                        if exe_path:
                            exe_path = exe_path.strip().strip('"')
                            exe_path = os.path.expandvars(exe_path)
                            if os.path.exists(exe_path):
                                return exe_path
                except OSError:
                    continue
    except ImportError:
        pass
    return None

def _find_app_in_windows_apps(app_name: str) -> str:
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    win_apps_dir = os.path.join(local_app_data, "Microsoft", "WindowsApps")
    if os.path.exists(win_apps_dir):
        app_name_clean = app_name.lower().replace(".exe", "").replace(" ", "")
        for file in os.listdir(win_apps_dir):
            if file.endswith(".exe"):
                name_clean = os.path.splitext(file)[0].lower().replace(" ", "")
                if app_name_clean == name_clean:
                    return os.path.join(win_apps_dir, file)
    return None

def _find_app_in_start_menu_exact(app_name: str) -> str:
    search_dirs = [
        os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"), "Microsoft\\Windows\\Start Menu\\Programs"),
        os.path.join(os.environ.get("AppData", ""), "Microsoft\\Windows\\Start Menu\\Programs")
    ]
    app_name_clean = app_name.lower().replace(".exe", "").replace(" ", "")
    for search_dir in search_dirs:
        if not os.path.exists(search_dir):
            continue
        for root, dirs, files in os.walk(search_dir):
            # Exclude 'Startup' folder
            parts = root.lower().replace("\\", "/").split("/")
            if "startup" in parts:
                continue
            for file in files:
                if file.endswith(".lnk"):
                    name_clean = os.path.splitext(file)[0].lower().replace(" ", "")
                    if app_name_clean == name_clean:
                        return os.path.join(root, file)
    return None

def _find_app_in_start_menu_partial(app_name: str) -> str:
    search_dirs = [
        os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"), "Microsoft\\Windows\\Start Menu\\Programs"),
        os.path.join(os.environ.get("AppData", ""), "Microsoft\\Windows\\Start Menu\\Programs")
    ]
    app_name_clean = app_name.lower().replace(".exe", "").replace(" ", "")
    for search_dir in search_dirs:
        if not os.path.exists(search_dir):
            continue
        for root, dirs, files in os.walk(search_dir):
            # Exclude 'Startup' folder
            parts = root.lower().replace("\\", "/").split("/")
            if "startup" in parts:
                continue
            for file in files:
                if file.endswith(".lnk"):
                    name_clean = os.path.splitext(file)[0].lower().replace(" ", "")
                    if app_name_clean in name_clean or name_clean in app_name_clean:
                        is_prefix = name_clean.startswith(app_name_clean) or app_name_clean.startswith(name_clean)
                        is_high_ratio = len(app_name_clean) >= (len(name_clean) * 0.5) or len(name_clean) >= (len(app_name_clean) * 0.5)
                        if is_prefix or is_high_ratio:
                            return os.path.join(root, file)
    return None

def _find_app_path(app_name: str):
    aliases = {
        "calculator": "calc.exe",
        "calc": "calc.exe",
        "paint": "mspaint.exe",
        "ms paint": "mspaint.exe",
        "mspaint": "mspaint.exe",
        "task manager": "taskmgr.exe",
        "taskmgr": "taskmgr.exe",
    }
    
    app_name_lower = app_name.lower().strip()
    search_term = aliases.get(app_name_lower, app_name_lower)
    
    if not search_term.endswith(".exe") and search_term not in ["cmd", "powershell"]:
        search_terms = [search_term, f"{search_term}.exe"]
    else:
        search_terms = [search_term]

    for term in search_terms:
        path = _find_app_in_registry(term)
        if path:
            return path

        path = _find_app_in_windows_apps(term)
        if path:
            return path

        try:
            out = subprocess.check_output(f'where.exe "{term}"', shell=True, stderr=subprocess.DEVNULL).decode().strip().split("\n")[0]
            if out and os.path.exists(out):
                return out
        except Exception:
            pass

        for win_dir in ["C:\\Windows\\System32", "C:\\Windows"]:
            full_path = os.path.join(win_dir, term)
            if os.path.exists(full_path):
                return full_path

        path = _find_app_in_start_menu_exact(term)
        if path:
            return path

        path = _find_uwp_app(term, exact_only=True)
        if path:
            return path

    for term in search_terms:
        path = _find_app_in_start_menu_partial(term)
        if path:
            return path

        path = _find_uwp_app(term, exact_only=False)
        if path:
            return path

    return None

def _find_and_focus_running_app(app_name: str, app_path: str = None) -> tuple[bool, str]:
    """
    Checks if a top-level window for the given application is already running.
    If found, brings it to the foreground (restoring if minimized) and returns (True, window_title).
    Otherwise returns (False, "").
    """
    if platform.system() != "Windows":
        return False, ""

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    dwmapi = getattr(ctypes.windll, "dwmapi", None)

    target_clean = app_name.lower().strip()
    target_exes = set()
    if target_clean.endswith(".exe"):
        target_exes.add(target_clean)
    else:
        target_exes.add(f"{target_clean}.exe")
        target_exes.add(target_clean)

    if app_path:
        base_exe = os.path.basename(app_path).lower()
        target_exes.add(base_exe)
        if base_exe.endswith(".exe"):
            target_exes.add(base_exe[:-4])

    # Common alias mappings for fast process name matching
    aliases = {
        "chrome": "chrome.exe",
        "google chrome": "chrome.exe",
        "firefox": "firefox.exe",
        "mozilla firefox": "firefox.exe",
        "edge": "msedge.exe",
        "msedge": "msedge.exe",
        "microsoft edge": "msedge.exe",
        "brave": "brave.exe",
        "opera": "opera.exe",
        "code": "code.exe",
        "vscode": "code.exe",
        "visual studio code": "code.exe",
        "spotify": "spotify.exe",
        "discord": "discord.exe",
        "notepad": "notepad.exe",
        "calc": "calculatorapp.exe",
        "calculator": "calculatorapp.exe",
        "word": "winword.exe",
        "excel": "excel.exe",
        "powerpoint": "powerpnt.exe",
        "steam": "steam.exe",
        "obs": "obs64.exe",
        "obsidian": "obsidian.exe",
        "vlc": "vlc.exe",
        "terminal": "windowsterminal.exe",
        "windows terminal": "windowsterminal.exe",
    }
    if target_clean in aliases:
        target_exes.add(aliases[target_clean].lower())

    EnumWindows = user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
    GetWindowText = user32.GetWindowTextW
    GetWindowTextLength = user32.GetWindowTextLengthW
    IsWindowVisible = user32.IsWindowVisible
    GetWindowThreadProcessId = user32.GetWindowThreadProcessId

    found_hwnd = None
    found_title = ""

    system_titles = {"program manager", "windows input experience", "taskbar", "yuki ai", "yuki"}

    def enum_cb(hwnd, lParam):
        nonlocal found_hwnd, found_title
        if not IsWindowVisible(hwnd):
            return True

        length = GetWindowTextLength(hwnd)
        if length == 0:
            return True

        # Check cloaked status (UWP background / virtual desktop cloaking)
        if dwmapi:
            cloaked = ctypes.c_int(0)
            try:
                dwmapi.DwmGetWindowAttribute(hwnd, 14, ctypes.byref(cloaked), ctypes.sizeof(cloaked))
                if cloaked.value != 0:
                    return True
            except Exception:
                pass

        buff = ctypes.create_unicode_buffer(length + 1)
        GetWindowText(hwnd, buff, length + 1)
        title = buff.value.strip()
        title_lower = title.lower()

        if any(st == title_lower or st in title_lower for st in system_titles):
            return True

        # 1. Match by Process Name (PID)
        pid = wintypes.DWORD()
        GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value:
            try:
                proc = psutil.Process(pid.value)
                proc_name = proc.name().lower()
                if proc_name in target_exes:
                    found_hwnd = hwnd
                    found_title = title
                    return False  # Stop enumeration on first (most active) match
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        # 2. Fallback: match by Window Title substring
        if target_clean in title_lower or any(t in title_lower for t in target_exes if not t.endswith(".exe")):
            found_hwnd = hwnd
            found_title = title
            return False

        return True

    EnumWindows(EnumWindowsProc(enum_cb), 0)

    if found_hwnd:
        try:
            # If minimized, restore window
            if user32.IsIconic(found_hwnd):
                user32.ShowWindow(found_hwnd, 9)  # SW_RESTORE
            else:
                user32.ShowWindow(found_hwnd, 5)  # SW_SHOW

            # Attach thread inputs to grant foreground activation privilege without pressing ALT (which toggles Firefox/Notepad menu bars)
            cur_thread = ctypes.windll.kernel32.GetCurrentThreadId()
            fg_hwnd = user32.GetForegroundWindow()
            fg_thread = user32.GetWindowThreadProcessId(fg_hwnd, None) if fg_hwnd else 0
            target_thread = user32.GetWindowThreadProcessId(found_hwnd, None)
            
            attached = False
            if fg_thread and fg_thread != cur_thread:
                user32.AttachThreadInput(cur_thread, fg_thread, True)
                attached = True
            if target_thread and target_thread != cur_thread:
                user32.AttachThreadInput(cur_thread, target_thread, True)
                attached = True

            user32.BringWindowToTop(found_hwnd)
            user32.SetForegroundWindow(found_hwnd)
            user32.SetFocus(found_hwnd)

            if attached:
                if fg_thread and fg_thread != cur_thread:
                    user32.AttachThreadInput(cur_thread, fg_thread, False)
                if target_thread and target_thread != cur_thread:
                    user32.AttachThreadInput(cur_thread, target_thread, False)

            return True, found_title
        except Exception as e:
            print(f"[launch_app] Error focusing existing window: {e}")
            return False, ""

    return False, ""

def launch_app(app_name: str, args: str = None, run_as_admin: bool = False, new_window: bool = False) -> str:
    """
    Launches an application, URL, or file link on the user's PC.
    If the app is already running and new_window is False, brings the active window to the front.
    Supports arguments and admin privilege execution.
    """
    if not app_name or not app_name.strip():
        return "Error: Application name must not be empty."
        
    target = app_name.strip()
    
    # Check if target is a URL or URI scheme (http, https, file, mailto, ftp, etc.)
    import webbrowser
    import urllib.parse
    parsed_url = urllib.parse.urlparse(target)
    if parsed_url.scheme in ("http", "https", "file", "ftp", "mailto", "vscode", "obsidian"):
        try:
            webbrowser.open(target)
            return f"Success: Launched URL/Link '{target}'"
        except Exception as e:
            return f"Error opening URL/Link '{target}': {str(e)}"

    app_path = _find_app_path(target)
    executable = app_path if app_path else target

    # Focus existing instance if already open (unless user requested new window, admin, or special args)
    if not new_window and not run_as_admin and not args:
        focused, title = _find_and_focus_running_app(target, app_path)
        if focused:
            return f"Success: Switched to already open '{app_name}' ({title})!"
    
    try:
        if run_as_admin:
            cmd_args = f'-FilePath "{executable}"'
            if args:
                cmd_args += f' -ArgumentList "{args}"'
            subprocess.Popen(["powershell", "-Command", f'Start-Process {cmd_args} -Verb RunAs'])
            return f"Success: Triggered startup for '{app_name}' as Administrator!"
        else:
            if args:
                if app_path:
                    subprocess.Popen([app_path] + args.split())
                else:
                    subprocess.Popen(["powershell", "-Command", f'Start-Process "{executable}" -ArgumentList "{args}"'])
            else:
                os.startfile(executable) if hasattr(os, "startfile") else subprocess.Popen(executable, shell=True)
            return f"Success: Launched '{app_name}'!"
    except Exception as e:
        return f"Failed to launch '{app_name}': {str(e)}"

def set_system_volume(volume_level: int) -> str:
    """
    Sets the Windows master speaker volume (0-100).
    Uses pycaw (Windows Core Audio API) as the primary method,
    falling back to a corrected PowerShell COM script if pycaw is unavailable.
    """
    if volume_level < 0 or volume_level > 100:
        return "Error: Volume must be between 0 and 100."

    # ── Method 1: pycaw (most reliable, direct Windows Core Audio API) ────
    try:
        import comtypes
        comtypes.CoInitialize()
        from pycaw.pycaw import AudioUtilities
        speakers = AudioUtilities.GetSpeakers()
        volume = speakers.EndpointVolume
        volume.SetMasterVolumeLevelScalar(volume_level / 100.0, None)
        return f"Volume set to {volume_level}%."
    except ImportError:
        pass
    except Exception as e:
        print(f"[Volume] pycaw failed: {e}, trying PowerShell fallback...")

    # ── Method 2: PowerShell nircmd (if installed) ────────────────────────
    try:
        # nircmd setsysvolume range is 0-65535
        nircmd_level = int(volume_level / 100 * 65535)
        result = subprocess.run(
            ["nircmd", "setsysvolume", str(nircmd_level)],
            capture_output=True, timeout=3
        )
        if result.returncode == 0:
            return f"Volume set to {volume_level}%."
    except Exception:
        pass

    # ── Method 3: PowerShell with corrected C# COM interop ────────────────
    # The key fix vs the old code: 'ref IMMDevice dev = null' and 'ref epvid'
    ps_script = f"""
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
$wshShell = New-Object -ComObject WScript.Shell

Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {{
    int _1(); int _2(); int _3(); int _4();
    int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
    int GetMasterVolumeLevelScalar(out float pfLevel);
}}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {{
    int Activate(ref System.Guid id, int clsCtx, int activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object aev);
}}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {{
    int _f();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorClass {{}}
'@ -ErrorAction SilentlyContinue

try {{
    $enumerator = [MMDeviceEnumeratorClass] -as [IMMDeviceEnumerator]
    $device = $null
    [void]$enumerator.GetDefaultAudioEndpoint(0, 1, [ref]$device)
    $epvGuid = [System.Guid]'5CDF2C82-841E-4546-9722-0CF74078229A'
    $epvObj = $null
    [void]$device.Activate([ref]$epvGuid, 23, 0, [ref]$epvObj)
    $epv = $epvObj -as [IAudioEndpointVolume]
    [void]$epv.SetMasterVolumeLevelScalar({volume_level / 100.0:.4f}, [System.Guid]::Empty)
}} catch {{ Write-Error $_.Exception.Message }}
"""
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return f"Volume set to {volume_level}%."
        else:
            return f"Failed to set volume. PowerShell error: {result.stderr.strip()[:200]}"
    except Exception as e:
        return f"Failed to set volume: {str(e)}"


def get_current_datetime() -> str:
    """
    Returns the current date and time on the user's PC.
    """
    import datetime
    now = datetime.datetime.now()
    return now.strftime("%A, %B %d, %Y, %I:%M %p")

def list_active_windows() -> str:
    import ctypes
    EnumWindows = ctypes.windll.user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
    GetWindowText = ctypes.windll.user32.GetWindowTextW
    GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
    IsWindowVisible = ctypes.windll.user32.IsWindowVisible
    
    windows = []
    
    def foreach_window(hwnd, lParam):
        if IsWindowVisible(hwnd):
            length = GetWindowTextLength(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                GetWindowText(hwnd, buff, length + 1)
                title = buff.value.strip()
                if title:
                    windows.append(title)
        return True
        
    EnumWindows(EnumWindowsProc(foreach_window), 0)
    return "Active Windows:\n" + "\n".join(f"- {w}" for w in sorted(set(windows)))

def control_window(action: str, window_title: str = None, x: int = None, y: int = None) -> str:
    """
    Minimizes, maximizes, restores, focuses, closes, or moves active application windows.
    """
    import ctypes
    action = action.lower().strip()
    
    if action == "list":
        return list_active_windows()
        
    match_all = False
    if not window_title or window_title.lower().strip() in ("*", "all", "all windows", "them all"):
        match_all = True
        
    EnumWindows = ctypes.windll.user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
    GetWindowText = ctypes.windll.user32.GetWindowTextW
    GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
    IsWindowVisible = ctypes.windll.user32.IsWindowVisible
    
    found_hwnd = []
    
    def foreach_window(hwnd, lParam):
        if IsWindowVisible(hwnd):
            length = GetWindowTextLength(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                GetWindowText(hwnd, buff, length + 1)
                title = buff.value.strip()
                if title:
                    title_lower = title.lower()
                    if match_all:
                        # Exclude system manager windows
                        if title_lower in ("program manager", "windows input experience", "taskbar"):
                            return True
                        # If action is close/minimize, avoid closing/minimizing Yuki itself unless targeted
                        if "yuki ai" in title_lower and action in ("close", "minimize"):
                            return True
                        found_hwnd.append((hwnd, title))
                    else:
                        if window_title.lower() in title_lower:
                            found_hwnd.append((hwnd, title))
        return True
        
    EnumWindows(EnumWindowsProc(foreach_window), 0)
    
    if not found_hwnd:
        if match_all:
            return "No active windows were found to process."
        return f"Window matching '{window_title}' was not found."
        
    results = []
    
    for hwnd, title in found_hwnd:
        if action == "minimize":
            ctypes.windll.user32.ShowWindow(hwnd, 6)
            results.append(title)
        elif action == "maximize":
            ctypes.windll.user32.ShowWindow(hwnd, 3)
            results.append(title)
        elif action == "restore":
            ctypes.windll.user32.ShowWindow(hwnd, 9)
            results.append(title)
        elif action == "focus":
            ctypes.windll.user32.ShowWindow(hwnd, 9)
            ctypes.windll.user32.SetForegroundWindow(hwnd)
            results.append(title)
            # Only focus one window
            break
        elif action == "close":
            ctypes.windll.user32.PostMessageW(hwnd, 0x0010, 0, 0)
            results.append(title)
        elif action == "move":
            if x is None or y is None:
                return "Error: x and y coordinates are required to move a window."
            class RECT(ctypes.Structure):
                _fields_ = [('left', ctypes.c_long), ('top', ctypes.c_long), ('right', ctypes.c_long), ('bottom', ctypes.c_long)]
            rect = RECT()
            ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
            w = rect.right - rect.left
            h = rect.bottom - rect.top
            ctypes.windll.user32.MoveWindow(hwnd, x, y, w, h, True)
            results.append(title)
            
    if not results:
        return "No windows were affected."
        
    action_past_tense = {
        "minimize": "Minimized",
        "maximize": "Maximized",
        "restore": "Restored",
        "focus": "Focused",
        "close": "Closed",
        "move": "Moved"
    }.get(action, "Processed")

    if len(results) == 1:
        return f"{action_past_tense} window: '{results[0]}'"
    else:
        quoted_results = ", ".join(f'"{r}"' for r in results)
        return f"{action_past_tense} {len(results)} windows: {quoted_results}"

_ACTIVE_PROCESSES = set()

def kill_active_supervisor_processes() -> int:
    """
    Forcefully terminates all active subprocesses spawned by system supervisor tools.
    """
    global _ACTIVE_PROCESSES
    killed_count = 0
    for proc in list(_ACTIVE_PROCESSES):
        try:
            if proc.poll() is None:
                print(f"[ProcessSupervisor] Terminating process PID {proc.pid} on user interrupt...")
                proc.kill()
                killed_count += 1
        except Exception as e:
            print(f"[ProcessSupervisor] Error killing PID {proc.pid}: {e}")
    _ACTIVE_PROCESSES.clear()

def smart_truncate_output(lines: list, max_lines: int = 65, head_count: int = 15, tail_count: int = 40) -> str:
    """
    Intelligently truncates long terminal output lines.
    Keeps head_count top lines and tail_count bottom lines.
    Scans omitted middle lines for error keywords and preserves extracted error lines.
    """
    clean_lines = [line for line in lines if line and str(line).strip()]
    if not clean_lines:
        return ""
    if len(clean_lines) <= max_lines:
        return "\n".join(clean_lines)

    head_lines = clean_lines[:head_count]
    tail_lines = clean_lines[-tail_count:]
    middle_lines = clean_lines[head_count:-tail_count]

    # Scan middle lines for critical error indicators
    error_keywords = ["error", "exception", "failed", "fatal", "traceback", "uncaught", "syntaxerror", "typeerror"]
    extracted_errors = [
        line for line in middle_lines
        if any(kw in line.lower() for kw in error_keywords)
    ]

    omitted_count = len(middle_lines)
    parts = ["\n".join(head_lines)]
    
    if extracted_errors:
        parts.append(f"\n... [omitted {omitted_count} lines — extracted {len(extracted_errors)} error lines below] ...")
        parts.append("\n".join(extracted_errors[:15]))
    else:
        parts.append(f"\n... [omitted {omitted_count} intermediate output lines] ...")

    parts.append("\n".join(tail_lines))
    return "\n".join(parts)

_ACTIVE_WORKSPACE_DIR: str = None

def set_active_workspace_directory(dir_path: str):
    global _ACTIVE_WORKSPACE_DIR
    if dir_path:
        _ACTIVE_WORKSPACE_DIR = os.path.abspath(str(dir_path).strip('"\''))

def get_active_workspace_directory() -> str:
    return _ACTIVE_WORKSPACE_DIR

def find_files_by_glob(pattern: str, search_dir: str = None, root_dir: str = None, max_results: int = 150) -> str:
    """
    Finds files matching a glob pattern (e.g. '*.py', 'src/**/*.jsx') inside search_dir.
    Bare basename patterns (no '/' and no '**') are matched RECURSIVELY — '*.py' finds
    .py files at any depth inside search_dir. Explicit '**' and path-scoped patterns
    ('src/**/*.jsx', 'sub/*.py') behave per normal glob semantics.
    Automatically excludes node_modules, .git, dist, build, venv directories.
    """
    import os, pathlib

    clean_pattern = str(pattern).strip()
    if not clean_pattern:
        return "Error: Glob pattern cannot be empty."

    target_dir = search_dir or root_dir
    raw_dir = str(target_dir).strip('"\'') if target_dir else None
    if raw_dir and raw_dir != "None":
        final_dir = os.path.abspath(os.path.expanduser(os.path.expandvars(raw_dir)))
    else:
        active_ws = get_active_workspace_directory()
        final_dir = active_ws if active_ws else os.getcwd()

    if not os.path.exists(final_dir):
        return f"Error: Search directory '{final_dir}' does not exist."

    ignored = {"node_modules", ".git", "dist", "build", "venv", ".venv", "__pycache__", ".next", ".cache", "coverage"}
    ignored_prefixes = ("venv", ".venv", "site-packages")

    def _is_ignored_dir(name: str) -> bool:
        name_lower = name.lower()
        return name_lower in ignored or name_lower.startswith(ignored_prefixes)

    matches = []
    try:
        path_obj = pathlib.Path(final_dir)
        glob_pat = clean_pattern.lstrip('/\\')

        # Auto-recursion: a bare basename pattern ('*.py') is almost always intended to
        # match files at any depth (mirrors jarvis_grep_files file_pattern semantics).
        # Only pattern with no path separator and no '**' gets the recursive treatment.
        bare_pattern = ("/" not in glob_pat) and ("**" not in glob_pat)
        iterator = path_obj.rglob(glob_pat) if bare_pattern else path_obj.glob(glob_pat)

        for p in iterator:
            parts = set(p.parts)
            if parts.intersection(ignored):
                continue
            if _is_ignored_dir(p.name):
                continue
            if p.is_file():
                rel_path = os.path.relpath(str(p), final_dir)
                matches.append(rel_path.replace('\\', '/'))
                if len(matches) >= max_results:
                    break

        if not matches:
            return f"No files matching pattern '{clean_pattern}' found in {final_dir}."

        result_str = "\n".join(f"- {m}" for m in matches)
        count_suffix = f" (showing first {max_results})" if len(matches) >= max_results else ""
        return f"=== Glob Search Results for '{clean_pattern}' in {final_dir} ({len(matches)} files found{count_suffix}) ===\n{result_str}"
    except Exception as e:
        return f"Glob Search Error: {str(e)}"

def jarvis_grep_files(pattern: str, file_pattern: str = "*", search_dir: str = None, case_sensitive: bool = False, max_results: int = 100) -> str:
    """
    Search file CONTENTS for a regex pattern and return every match as path:line: <matching line>.
    Accepts a file glob filter (e.g. '*.py', 'src/**/*.tsx') to limit which files are scanned.
    Skips ignored directories (node_modules, .git, venv, dist, build, __pycache__, ...), binary
    files, and paths outside the safety boundary.
    """
    import fnmatch as _fnmatch
    from app.tools.files import _is_safe_path

    clean_pattern = str(pattern).strip() if pattern is not None else ""
    if not clean_pattern:
        return "Error: Search pattern cannot be empty."

    try:
        flags = 0 if case_sensitive else re.IGNORECASE
        regex = re.compile(clean_pattern, flags)
    except re.error as e:
        return f"Error: Invalid regex pattern '{clean_pattern}': {e}"

    target_dir = str(search_dir).strip('"\'') if search_dir and str(search_dir).strip('"\'').lower() not in ("", "none") else None
    if target_dir:
        final_dir = os.path.abspath(os.path.expanduser(os.path.expandvars(target_dir)))
    else:
        active_ws = get_active_workspace_directory()
        final_dir = active_ws if active_ws else os.getcwd()

    if not os.path.isdir(final_dir):
        return f"Error: Search directory '{final_dir}' does not exist."

    ignored = {"node_modules", ".git", "dist", "build", "venv", ".venv", "__pycache__", ".next", ".cache", "coverage", "site-packages"}
    ignored_prefixes = ("venv", ".venv", "site-packages")

    def _is_ignored_dir(name: str) -> bool:
        name_lower = name.lower()
        return name_lower in ignored or name_lower.startswith(ignored_prefixes)

    clean_file_pat = str(file_pattern or "*").strip()

    def _match_file_pattern(filepath: str, fname: str, pat: str) -> bool:
        if not pat or pat == "*":
            return True
        # Expand curly braces like *.{js,jsx,html} or *.js,*.jsx
        sub_patterns = []
        if "{" in pat and "}" in pat:
            prefix, rest = pat.split("{", 1)
            body, suffix = rest.split("}", 1)
            for choice in body.split(","):
                sub_patterns.append(f"{prefix}{choice.strip()}{suffix}")
        elif "," in pat:
            sub_patterns = [p.strip() for p in pat.split(",") if p.strip()]
        else:
            sub_patterns = [pat]

        for p in sub_patterns:
            if _fnmatch.fnmatch(fname, p) or _fnmatch.fnmatch(filepath, p):
                return True
        return False

    hits = []
    try:
        for root, dirs, files in os.walk(final_dir):
            dirs[:] = [d for d in dirs if not _is_ignored_dir(d)]
            for fname in files:
                rel_file_path = os.path.relpath(os.path.join(root, fname), final_dir)
                if not _match_file_pattern(rel_file_path, fname, clean_file_pat):
                    continue
                full_path = os.path.join(root, fname)
                if not _is_safe_path(full_path):
                    continue
                if os.path.getsize(full_path) > 20 * 1024 * 1024:
                    continue
                try:
                    with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                        for line_no, line in enumerate(f, 1):
                            if len(line) > 10000:
                                continue
                            if regex.search(line):
                                rel_path = os.path.relpath(full_path, final_dir).replace("\\", "/")
                                hits.append(f"{rel_path}:{line_no}: {line.rstrip()}")
                                if len(hits) >= max_results:
                                    break
                except Exception:
                    continue
                if len(hits) >= max_results:
                    break
            if len(hits) >= max_results:
                break
    except Exception as e:
        return f"Grep Search Error: {str(e)}"

    if not hits:
        return f"No matches for '{clean_pattern}' in {final_dir} (file filter: {clean_file_pat})."

    count_suffix = f" (showing first {max_results} of more)" if len(hits) >= max_results else ""
    return f"=== Grep Results for '{clean_pattern}' in {final_dir} ({len(hits)} match{'' if len(hits) == 1 else 'es'}{count_suffix}) ===\n" + "\n".join(hits)

_TERMINAL_STREAM_LISTENERS = []

def register_terminal_stream_listener(listener):
    global _TERMINAL_STREAM_LISTENERS
    if listener not in _TERMINAL_STREAM_LISTENERS:
        _TERMINAL_STREAM_LISTENERS.append(listener)

def emit_terminal_stream_event(payload: dict):
    global _TERMINAL_STREAM_LISTENERS
    for listener in list(_TERMINAL_STREAM_LISTENERS):
        try:
            listener(payload)
        except Exception as e:
            print(f"[TerminalStream] Listener error: {e}")

def send_process_stdin(input_text: str, pid: int = None) -> str:
    """
    Sends input_text (text or newline) directly to the stdin pipe of an actively running background process.
    """
    global _ACTIVE_PROCESSES
    if not _ACTIVE_PROCESSES:
        return "No active background processes are currently running to receive stdin input."

    target_proc = None
    if pid:
        for proc in _ACTIVE_PROCESSES:
            if proc.pid == pid and proc.poll() is None:
                target_proc = proc
                break
    else:
        # Use latest active process
        active_list = [p for p in _ACTIVE_PROCESSES if p.poll() is None]
        if active_list:
            target_proc = active_list[-1]

    if not target_proc or not target_proc.stdin:
        return f"Process (PID {pid or 'latest'}) is either not running or stdin pipe is unavailable."

    try:
        clean_input = input_text if input_text.endswith('\n') else input_text + '\n'
        target_proc.stdin.write(clean_input)
        target_proc.stdin.flush()
        
        # Log to terminal stream listeners
        emit_terminal_stream_event({
            "type": "terminal_stream",
            "line": f"> [STDIN INPUT SENT TO PID {target_proc.pid}]: {input_text.strip()}",
            "stype": "stdin",
            "pid": target_proc.pid
        })
        return f"Successfully sent stdin input '{input_text.strip()}' to active process PID {target_proc.pid}."
    except Exception as e:
        return f"Error sending stdin input to PID {target_proc.pid}: {str(e)}"

def run_terminal_command(command: str, use_powershell: bool = True, max_timeout: int = 300, heartbeat_interval: int = 30, cwd: str = None, stdin_input: str = None) -> str:
    """
    Runs a shell command asynchronously with real-time output capture, line-by-line streaming,
    stdin input support, non-interactive environment variables, and ExecutionPolicy Bypass.
    """
    banned_error = _banned_dev_server_check(command)
    if banned_error:
        return banned_error

    # ── Safety: block terminal commands that permanently delete without Recycle Bin ──
    import re as _re
    _TERMINAL_DELETION_PATTERNS = [
        r'\brd\s+/s\b',                      # rd /s (removes whole directory tree)
        r'\brmdir\s+/s\b',                   # rmdir /s
        r'\bdel\s+/f\b',                     # del /f (force delete)
        r'\brm\s+-(r|f|rf|fr|rf\s|fr\s)',   # rm -r, rm -f, rm -rf etc
        r'\bRemove-Item\b.*(-Recurse|-Force|-rf)\b',  # PowerShell Remove-Item -Force/-Recurse
        r'\bri\s+.*-Force\b',               # PowerShell alias ri -Force
    ]
    _cmd_check = command.strip()
    for _pat in _TERMINAL_DELETION_PATTERNS:
        if _re.search(_pat, _cmd_check, _re.IGNORECASE):
            return (
                "Error: Permanent deletion terminal commands (del /f, rd /s, rm -rf, Remove-Item -Force, etc.) "
                "are blocked for safety. These bypass the Recycle Bin and cannot be undone. "
                "Use the delete_file tool instead, which moves files to the Recycle Bin safely."
            )

    import time, os, threading, queue
    global _ACTIVE_PROCESSES
    
    # Industry Standard Non-Interactive Environment
    env = os.environ.copy()
    env["CI"] = "true"
    env["DEBIAN_FRONTEND"] = "noninteractive"
    env["PYTHONUNBUFFERED"] = "1"
    env["PIP_NO_INPUT"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"

    # Dynamic Command Timeout Scaling
    if max_timeout == 300 or max_timeout is None:
        cmd_low = command.lower().strip()
        quick_cmds = ("dir", "ls", "pwd", "cd ", "mkdir ", "echo ", "git status", "git branch", "git diff", "cat ", "type ", "whoami")
        if any(cmd_low.startswith(q) for q in quick_cmds):
            max_timeout = 20

    start_time = time.time()
    try:
        proc = subprocess.Popen(
            command,
            stdin=subprocess.PIPE if stdin_input else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8",
            errors="replace",
            shell=True,
            cwd=cwd,
            env=env,
            bufsize=1
        )
        _ACTIVE_PROCESSES.add(proc)

        if stdin_input and proc.stdin:
            try:
                proc.stdin.write(stdin_input if stdin_input.endswith('\n') else stdin_input + '\n')
                proc.stdin.flush()
                emit_terminal_stream_event({
                    "type": "terminal_stream",
                    "line": f"> [STDIN INITIAL INPUT]: {stdin_input.strip()}",
                    "stype": "stdin",
                    "pid": proc.pid
                })
            except Exception as e:
                print(f"[ProcessSupervisor] Error writing to stdin: {e}")

        output_queue = queue.Queue()

        def stream_reader(stream, stream_type):
            for line in iter(stream.readline, ''):
                if line:
                    output_queue.put((stream_type, line))
            try:
                stream.close()
            except Exception:
                pass

        t_out = threading.Thread(target=stream_reader, args=(proc.stdout, 'stdout'), daemon=True)
        t_err = threading.Thread(target=stream_reader, args=(proc.stderr, 'stderr'), daemon=True)
        t_out.start()
        t_err.start()

        stdout_chunks = []
        stderr_chunks = []
        PROMPT_KEYWORDS = ["?", "choose", "proceed", "confirm", "select", "y/n", "enter:", "cancel operation", "please choose"]

        while True:
            # Drain queue items immediately
            try:
                while True:
                    stype, line = output_queue.get_nowait()
                    line_clean = line.rstrip('\r\n')
                    if stype == 'stdout':
                        stdout_chunks.append(line_clean)
                    else:
                        stderr_chunks.append(line_clean)
                    
                    emit_terminal_stream_event({
                        "type": "terminal_stream",
                        "line": line_clean,
                        "stype": stype,
                        "pid": proc.pid
                    })
            except queue.Empty:
                pass

            if proc.poll() is not None:
                t_out.join(timeout=1)
                t_err.join(timeout=1)
                while not output_queue.empty():
                    stype, line = output_queue.get_nowait()
                    line_clean = line.rstrip('\r\n')
                    if stype == 'stdout':
                        stdout_chunks.append(line_clean)
                    else:
                        stderr_chunks.append(line_clean)
                    emit_terminal_stream_event({
                        "type": "terminal_stream",
                        "line": line_clean,
                        "stype": stype,
                        "pid": proc.pid
                    })
                break

            elapsed = int(time.time() - start_time)

            # Check for interactive prompt early exit (3s)
            recent_output = stdout_chunks[-15:]
            has_interactive_prompt = any(
                any(kw in line.lower() for kw in PROMPT_KEYWORDS)
                for line in recent_output
            )
            if has_interactive_prompt and elapsed >= 3:
                stdout_str = "\n".join(filter(None, stdout_chunks))
                stderr_str = "\n".join(filter(None, stderr_chunks))
                return f"[STATUS: RUNNING IN BACKGROUND - INTERACTIVE PROMPT DETECTED] Command '{command}' (PID {proc.pid}) is actively waiting for user selection ({elapsed}s elapsed).\nCaptured Output So Far:\n{stdout_str}\n{stderr_str}\n\nDIAGNOSTIC NOTICE FOR AI: The process PID {proc.pid} is currently paused on an interactive prompt question. Call 'jarvis_send_stdin(input_text=\"1\", pid={proc.pid})' or 'jarvis_send_stdin(input_text=\"\\n\", pid={proc.pid})' immediately to send your choice!".strip()

            # Periodic 30-second status update checkpoint
            last_check = getattr(proc, '_last_checkpoint', 0)
            if elapsed >= heartbeat_interval and (elapsed - last_check) >= heartbeat_interval:
                setattr(proc, '_last_checkpoint', elapsed)
                stdout_str = "\n".join(filter(None, stdout_chunks))
                stderr_str = "\n".join(filter(None, stderr_chunks))
                return f"[STATUS: RUNNING IN BACKGROUND - {elapsed}S CHECKPOINT] Command '{command}' (PID {proc.pid}) is still actively processing ({elapsed}s elapsed).\nCaptured Output So Far:\n{stdout_str}\n{stderr_str}\n\nDIAGNOSTIC NOTICE FOR AI: The process is actively running in the background. You may monitor progress or proceed.".strip()

            if elapsed >= max_timeout:
                stdout_str = "\n".join(filter(None, stdout_chunks))
                stderr_str = "\n".join(filter(None, stderr_chunks))
                return f"[STATUS: RUNNING IN BACKGROUND] Command '{command}' (PID {proc.pid}) is still actively running ({elapsed}s elapsed, hit {max_timeout}s checkpoint).\nCaptured Output So Far:\n{stdout_str}\n{stderr_str}\n\nDIAGNOSTIC NOTICE FOR AI: The process is still running. Decide whether to monitor, wait, or terminate PID {proc.pid} based on output progress.".strip()

            time.sleep(0.15)

        _ACTIVE_PROCESSES.discard(proc)

        stdout_str = smart_truncate_output(stdout_chunks)
        stderr_str = smart_truncate_output(stderr_chunks)
        
        output = []
        if stdout_str:
            output.append(stdout_str)
        if stderr_str:
            output.append(f"Error output:\n{stderr_str}")
            
        if not output:
            return f"Command executed successfully (exit code: {proc.returncode}), but returned no output."
            
        return "\n".join(output)
    except Exception as e:
        return f"Failed to execute command: {str(e)}"

def run_python_script(code: str, max_timeout: int = 300, heartbeat_interval: int = 30, cwd: str = None) -> str:
    """
    Executes a block of Python code asynchronously with dynamic 30-second heartbeat monitoring without force-killing.
    """
    banned_error = _banned_dev_server_check(code)
    if not banned_error:
        literals = _extract_python_string_literals(code)
        if literals and _banned_dev_server_check(" ".join(literals)):
            banned_error = _DEV_SERVER_ERROR_MESSAGE
    if banned_error:
        return banned_error

    # ── Safety: block permanent deletion operations (bypass Recycle Bin) ──────
    import re as _re
    _DELETION_PATTERNS = [
        r'\bos\.remove\s*\(',
        r'\bos\.unlink\s*\(',
        r'\bshutil\.rmtree\s*\(',
        r'\bshutil\.rmdir\s*\(',
        r'\bpathlib\.Path[^)]*\.unlink\s*\(',
        r'\bPath[^)]*\.unlink\s*\(',
    ]
    for _pat in _DELETION_PATTERNS:
        if _re.search(_pat, code):
            return (
                "Error: Permanent file deletion operations (os.remove, os.unlink, shutil.rmtree, etc.) "
                "are blocked in Python scripts for safety. These bypass the Recycle Bin and cannot be undone. "
                "Use the delete_file tool instead, which moves files to the Recycle Bin safely."
            )

    import tempfile, time, os
    
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w", encoding="utf-8") as f:
        f.write(code)
        temp_file = f.name

    saved_cache_path = ""
    # Only cache substantial scripts (>= 300 chars or >= 5 lines) to avoid cluttering disk with trivial math/one-liners
    if len(code.strip()) >= 300 or len(code.strip().splitlines()) >= 5:
        try:
            from app.tools.tool_cache import save_python_artifact
            saved_cache_path = save_python_artifact(code)
        except Exception:
            pass
        
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["CI"] = "true"
    env["YUKI_SCRIPT_RUNNER"] = "1"

    start_time = time.time()
    try:
        if getattr(sys, "frozen", False):
            cmd = [sys.executable, "--yuki-run-script", temp_file]
        else:
            cmd = [sys.executable, temp_file]
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8",
            errors="replace",
            cwd=cwd,
            env=env
        )
        _ACTIVE_PROCESSES.add(proc)
        
        stdout_chunks = []
        stderr_chunks = []
        
        try:
            while True:
                try:
                    stdout_data, stderr_data = proc.communicate(timeout=heartbeat_interval)
                    if stdout_data:
                        stdout_chunks.append(stdout_data.strip())
                    if stderr_data:
                        stderr_chunks.append(stderr_data.strip())
                    break
                except subprocess.TimeoutExpired as te:
                    if te.stdout:
                        stdout_chunks.append(te.stdout.decode('utf-8', errors='replace').strip() if isinstance(te.stdout, bytes) else te.stdout.strip())
                    if te.stderr:
                        stderr_chunks.append(te.stderr.decode('utf-8', errors='replace').strip() if isinstance(te.stderr, bytes) else te.stderr.strip())
                    
                    elapsed = int(time.time() - start_time)
                    if elapsed >= max_timeout:
                        # Do NOT force-kill. Return current status & output to AI
                        stdout_str = "\n".join(filter(None, stdout_chunks))
                        stderr_str = "\n".join(filter(None, stderr_chunks))
                        return f"[STATUS: RUNNING IN BACKGROUND] Python script (PID {proc.pid}) is still running ({elapsed}s elapsed, hit {max_timeout}s checkpoint).\nCaptured Output So Far:\n{stdout_str}\n{stderr_str}\n\nDIAGNOSTIC NOTICE FOR AI: Script is still active. Decide whether to wait or terminate PID {proc.pid} based on progress.".strip()
                    
                    print(f"[ProcessSupervisor] Python script active (PID {proc.pid}, {elapsed}s elapsed)...")
        finally:
            _ACTIVE_PROCESSES.discard(proc)

        stdout_str = "\n".join(filter(None, stdout_chunks))
        stderr_str = "\n".join(filter(None, stderr_chunks))

        output_parts = []
        if stdout_str:
            output_parts.append(stdout_str)
        if stderr_str:
            output_parts.append(f"Error output:\n{stderr_str}")

        if not output_parts:
            res_text = f"Script executed successfully (exit code: {proc.returncode}), but returned no output."
        else:
            res_text = "\n".join(output_parts)

        if saved_cache_path:
            res_text += f"\n(Script source saved to: {saved_cache_path})"
        return res_text
    except Exception as e:
        return f"Failed to execute Python script: {str(e)}"
    finally:
        if os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except Exception:
                pass

def take_screenshot() -> str:
    """
    Opens the Windows Snipping Tool overlay (Win+Shift+S), exactly like pressing PrtSc.
    The user can then select the area to capture — it saves to clipboard and shows a notification.
    """
    try:
        import pyautogui
        pyautogui.FAILSAFE = False
        import time
        # Small delay so Yuki's window doesn't block the screen
        time.sleep(0.4)
        # Win+Shift+S = Windows Snipping Tool (same as PrtSc in modern Windows 10/11)
        pyautogui.hotkey('win', 'shift', 's')
        return "Snipping Tool opened — select your area to capture."
    except Exception as e:
        return f"Failed to open Snipping Tool: {str(e)}"

def keyboard_mouse_input(action: str, text: str = None, keys: list = None, x: int = None, y: int = None, amount: int = None) -> str:
    """
    Simulates keyboard keystrokes, key combinations, mouse clicks, movements, or scrolls.
    """
    try:
        import pyautogui
        pyautogui.FAILSAFE = True
        
        action = action.lower().strip()
        
        if action == "type":
            if not text:
                return "Error: text is required for 'type' action."
            pyautogui.write(text, interval=0.01)
            return f"Typed: '{text}'"
            
        elif action == "press_keys":
            if not keys:
                return "Error: keys list is required for 'press_keys' action."
            if len(keys) > 1:
                pyautogui.hotkey(*keys)
            else:
                pyautogui.press(keys[0])
            return f"Pressed keys: {keys}"
            
        elif action == "click":
            if x is not None and y is not None:
                pyautogui.click(x=x, y=y)
                return f"Clicked at ({x}, {y})"
            else:
                pyautogui.click()
                return "Clicked at current mouse position"
                
        elif action == "double_click":
            if x is not None and y is not None:
                pyautogui.doubleClick(x=x, y=y)
                return f"Double-clicked at ({x}, {y})"
            else:
                pyautogui.doubleClick()
                return "Double-clicked at current position"
                
        elif action == "move_to":
            if x is None or y is None:
                return "Error: x and y coordinates are required for 'move_to' action."
            pyautogui.moveTo(x=x, y=y, duration=0.2)
            return f"Moved mouse to ({x}, {y})"
            
        elif action == "scroll":
            if amount is None:
                return "Error: amount is required for 'scroll' action."
            pyautogui.scroll(amount)
            return f"Scrolled by {amount}"
            
        return f"Error: Unknown action '{action}'"
    except Exception as e:
        return f"Input simulation failed: {str(e)}"

def _send_wm_appcommand(hwnd: int, cmd: int) -> None:
    """Post a WM_APPCOMMAND message to a window handle."""
    import ctypes
    WM_APPCOMMAND = 0x0319
    ctypes.windll.user32.PostMessageW(hwnd, WM_APPCOMMAND, 0, cmd << 16)


def _focus_and_send_space(hwnd: int) -> None:
    """Bring a window to foreground and send Space (pause/unpause in most players)."""
    import ctypes
    import time
    user32 = ctypes.windll.user32
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.05)
    user32.keybd_event(0x20, 0, 0, 0)
    user32.keybd_event(0x20, 0, 2, 0)


def _find_window_containing(substring: str) -> list:
    """Return list of (hwnd, title) for visible windows whose title contains substring (case-insensitive)."""
    import ctypes
    user32 = ctypes.windll.user32
    EnumWindows = user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
    GetWindowText = user32.GetWindowTextW
    GetWindowTextLength = user32.GetWindowTextLengthW
    IsWindowVisible = user32.IsWindowVisible

    sub_lower = substring.lower()
    found = []

    def foreach_window(hwnd, lParam):
        if IsWindowVisible(hwnd):
            length = GetWindowTextLength(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                GetWindowText(hwnd, buff, length + 1)
                title = buff.value.strip()
                if title:
                    title_lower = title.lower()
                    if sub_lower in title_lower:
                        found.append((hwnd, title))
        return True

    EnumWindows(EnumWindowsProc(foreach_window), 0)
    return found


def _all_visible_windows() -> list:
    """Return list of (hwnd, title) for all visible windows with a title."""
    import ctypes
    user32 = ctypes.windll.user32
    EnumWindows = user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
    GetWindowText = user32.GetWindowTextW
    GetWindowTextLength = user32.GetWindowTextLengthW
    IsWindowVisible = user32.IsWindowVisible

    windows = []

    def foreach_window(hwnd, lParam):
        if IsWindowVisible(hwnd):
            length = GetWindowTextLength(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                GetWindowText(hwnd, buff, length + 1)
                title = buff.value.strip()
                if title:
                    windows.append((hwnd, title))
        return True

    EnumWindows(EnumWindowsProc(foreach_window), 0)
    return windows


_MEDIA_PLAYER_KEYWORDS = [
    "vlc", "spotify", "wmplayer", "windows media player", "mpc-hc",
    "mpc-be", "mpv", "foobar2000", "aimp", "winamp", "music bee",
    "strawberry", "groove music", "netflix", "youtube",
]


def media_playback_control(action: str, app_name: str = None, all: bool = False) -> str:
    """
    Controls media playback across apps.  Uses three strategies:

      1. WM_APPCOMMAND posted to the target window(s) — the native Windows
         message that media apps handle (works even for background windows).
      2. SMTC keybd_event as a backup for browser tabs / foreground apps
         that don't process WM_APPCOMMAND on background windows.
      3. Window focus + Space key for desktop media players that may need
         focus to respond.

    Parameters
    ----------
    action : "play", "pause", "next", "previous", "stop"
    app_name : optional — target a specific app by window title substring
    all : optional — pause all known media-player windows
    """
    import ctypes
    import time

    action_clean = action.lower().strip()

    if action_clean in ("play", "pause", "stop", "resume", "unpause"):
        action_clean = "play_pause"
    elif action_clean == "volume_up":
        return "Use set_system_volume for volume control."
    elif action_clean == "volume_down":
        return "Use set_system_volume for volume control."
    elif action_clean == "mute":
        return "Use set_system_volume for volume control."

    # APPCOMMAND constant (the raw int before shifting into HIWORD)
    APPCMDS = {
        "play_pause": 14,
        "next": 11,
        "previous": 12,
        "stop": 13,
    }

    cmd = APPCMDS.get(action_clean)
    if cmd is None:
        return f"Error: Unknown media action '{action}'"

    user32 = ctypes.windll.user32
    targeted = []
    skipped = []

    try:
        if all:
            # Send WM_APPCOMMAND to every visible window whose title
            # suggests a media player, then also focus+Space for them.
            all_windows = _all_visible_windows()
            # Further narrowed to only known players
            media_windows = []
            for hwnd, title in all_windows:
                tl = title.lower()
                if any(kw in tl for kw in _MEDIA_PLAYER_KEYWORDS):
                    media_windows.append((hwnd, title))

            if not media_windows:
                return "No known media-player windows found."

            for hwnd, title in media_windows:
                _send_wm_appcommand(hwnd, cmd)
                targeted.append(title)
                try:
                    _focus_and_send_space(hwnd)
                    time.sleep(0.03)
                except Exception:
                    skipped.append(title)

        elif app_name:
            # Find window(s) matching the requested app name
            matches = _find_window_containing(app_name)
            if not matches:
                return f"No window found matching '{app_name}'."

            for hwnd, title in matches:
                _send_wm_appcommand(hwnd, cmd)
                targeted.append(title)
                try:
                    _focus_and_send_space(hwnd)
                except Exception:
                    skipped.append(title)

        else:
            # No target — send to foreground window and also broadcast
            # SMTC key for browser tabs that register globally.
            hwnd_fg = user32.GetForegroundWindow()
            _send_wm_appcommand(hwnd_fg, cmd)
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd_fg, buf, 256)
            fg_title = buf.value.strip() or "foreground window"
            targeted.append(fg_title)

            # SMTC fallback — may help with browser tabs
            MEDIA_VK = {
                "play_pause": 0xB3,
                "next": 0xB0,
                "previous": 0xB1,
                "stop": 0xB2,
            }
            vk = MEDIA_VK.get(action_clean)
            if vk:
                KEYEVENTF_EXTENDEDKEY = 0x0001
                KEYEVENTF_KEYUP = 0x0002
                user32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0)
                user32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)

            # Also try known media-player windows as a fallback
            all_windows = _all_visible_windows()
            known_players = [(h, t) for h, t in all_windows
                             if any(kw in t.lower() for kw in _MEDIA_PLAYER_KEYWORDS)]
            for hwnd, title in known_players:
                _send_wm_appcommand(hwnd, cmd)
                if title not in targeted:
                    targeted.append(title)

        parts = [f"Triggered {action_clean} on: {', '.join(targeted)}"]
        if skipped:
            parts.append(f"(focus+Space skipped for: {', '.join(skipped)})")
        return "\n".join(parts)

    except Exception as e:
        return f"Failed to send media command: {str(e)}"

def manage_process(action: str, name: str = None, pid: int = None) -> str:
    """
    Lists running processes or kills a process.
    """
    action = action.lower().strip()
    
    if action == "list":
        procs = []
        for p in psutil.process_iter(['pid', 'name', 'memory_info']):
            try:
                info = p.info
                mem_info = info.get('memory_info')
                mem_mb = mem_info.rss / (1024 * 1024) if mem_info else 0
                procs.append((info['pid'], info['name'], mem_mb))
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        procs = sorted(procs, key=lambda x: x[2], reverse=True)[:30]
        res = "Top 30 Running Processes (by RAM):\n"
        res += "\n".join(f"- PID: {p[0]} | {p[1]} ({p[2]:.1f} MB)" for p in procs)
        return res
        
    elif action == "kill":
        if not name and pid is None:
            return "Error: name or pid is required to kill a process."
            
        killed_count = 0
        for p in psutil.process_iter(['pid', 'name']):
            try:
                if pid is not None and p.info['pid'] == pid:
                    p.kill()
                    return f"Successfully terminated process with PID {pid} ({p.info['name']})."
                elif name and p.info['name'].lower() == name.lower():
                    p.kill()
                    killed_count += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
                
        if killed_count > 0:
            return f"Successfully terminated {killed_count} instance(s) of '{name}'."
        return f"No active process found matching name='{name}' or pid={pid}."
        
    return f"Error: Unknown action '{action}'"

def system_power_control(action: str, confirmed: bool = False) -> str:
    """
    Performs power controls (lock, sleep, sign_out, shutdown, restart).
    """
    action = action.lower().strip()
    
    if not confirmed:
        return f"Error: Action '{action}' was not confirmed. User must explicitly confirm this power operation."
        
    try:
        if action == "lock":
            subprocess.run(["rundll32.exe", "user32.dll,LockWorkStation"])
            return "Locked workstation successfully."
            
        elif action == "sleep":
            subprocess.run(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
            return "Put system to sleep."
            
        elif action == "sign_out":
            subprocess.run(["shutdown", "/l"])
            return "Signing out user."
            
        elif action == "shutdown":
            subprocess.run(["shutdown", "/s", "/t", "10"])
            return "System shutdown initiated. Powering off in 10 seconds."
            
        elif action == "restart":
            subprocess.run(["shutdown", "/r", "/t", "10"])
            return "System restart initiated. Rebooting in 10 seconds."
            
        return f"Error: Unknown power action '{action}'"
    except Exception as e:
        return f"Failed to perform system power action: {str(e)}"

_CACHED_DETECTED_GPUS = None
_CACHED_NVIDIA_METRICS = {}
_CACHED_NVIDIA_TIME = 0.0
_CACHED_BATTERY_WMI = None
_CACHED_BATTERY_TIME = 0.0

def get_detailed_stats() -> dict:
    """
    Returns comprehensive system statistics (CPU, RAM, GPU, Battery, Disk, Uptime) as a dictionary.
    Cached WMI/PowerShell & nvidia-smi calls avoid spawning heavy subprocesses on every periodic poll.
    """
    global _CACHED_DETECTED_GPUS, _CACHED_NVIDIA_METRICS, _CACHED_NVIDIA_TIME, _CACHED_BATTERY_WMI, _CACHED_BATTERY_TIME

    stats = {}
    stats['os'] = f"Windows {platform.release()} (Build {platform.version()})"
    
    try:
        # Non-blocking instant CPU percentage since last check
        cpu_usage = psutil.cpu_percent(interval=None)
        cpu_cores_phys = psutil.cpu_count(logical=False)
        cpu_cores_log = psutil.cpu_count(logical=True)
        cpu_freq = psutil.cpu_freq()
        stats['cpu'] = {
            'usage_percent': cpu_usage,
            'cores_physical': cpu_cores_phys,
            'cores_logical': cpu_cores_log,
            'freq_mhz': cpu_freq.current if cpu_freq else None
        }
    except Exception as e:
        stats['cpu'] = {'error': str(e)}

    try:
        mem = psutil.virtual_memory()
        stats['ram'] = {
            'total_gb': round(mem.total / (1024**3), 2),
            'used_gb': round(mem.used / (1024**3), 2),
            'free_gb': round(mem.available / (1024**3), 2),
            'usage_percent': mem.percent
        }
    except Exception as e:
        stats['ram'] = {'error': str(e)}

    stats['gpus'] = []
    
    # 1. Cache GPU names from WMI (hardware does not change at runtime)
    if _CACHED_DETECTED_GPUS is None:
        detected_gpus = []
        gpu_wmi_out = _run_powershell_command("Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json", timeout=5.0)
        if gpu_wmi_out:
            try:
                import json
                gpu_wmi_data = json.loads(gpu_wmi_out)
                if isinstance(gpu_wmi_data, list):
                    detected_gpus = [g['Name'] for g in gpu_wmi_data if g.get('Name')]
                elif isinstance(gpu_wmi_data, dict) and gpu_wmi_data.get('Name'):
                    detected_gpus = [gpu_wmi_data['Name']]
            except Exception:
                pass
        _CACHED_DETECTED_GPUS = detected_gpus
    else:
        detected_gpus = _CACHED_DETECTED_GPUS

    # 2. Cache nvidia-smi metrics for 10 seconds
    now = time.time()
    if now - _CACHED_NVIDIA_TIME > 10.0:
        nvidia_gpus = {}
        ns_exe = _get_nvidia_smi_executable()
        if ns_exe:
            try:
                ns_res = subprocess.run(
                    [ns_exe, "--query-gpu=name,utilization.gpu,utilization.memory,memory.total,memory.used,temperature.gpu", "--format=csv,noheader,nounits"],
                    capture_output=True,
                    text=True,
                    timeout=5.0,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
                )
                if ns_res.returncode == 0 and ns_res.stdout.strip():
                    for line in ns_res.stdout.strip().split('\n'):
                        if not line.strip():
                            continue
                        parts = [p.strip() for p in line.split(',')]
                        if len(parts) >= 6:
                            name = parts[0]
                            nvidia_gpus[name] = {
                                'utilization_percent': int(parts[1]),
                                'mem_utilization_percent': int(parts[2]),
                                'mem_total_mb': int(parts[3]),
                                'mem_used_mb': int(parts[4]),
                                'temp_c': int(parts[5])
                            }
            except Exception:
                pass
        _CACHED_NVIDIA_METRICS = nvidia_gpus
        _CACHED_NVIDIA_TIME = now
    else:
        nvidia_gpus = _CACHED_NVIDIA_METRICS

    for gpu_name in detected_gpus:
        gpu_entry = {'name': gpu_name}
        matching_nvidia = None
        for n_name, metrics in nvidia_gpus.items():
            if n_name.lower() in gpu_name.lower() or gpu_name.lower() in n_name.lower():
                matching_nvidia = metrics
                break
        if matching_nvidia:
            gpu_entry.update(matching_nvidia)
            gpu_entry['has_metrics'] = True
        else:
            gpu_entry['has_metrics'] = False
        stats['gpus'].append(gpu_entry)

    if not stats['gpus'] and nvidia_gpus:
        for name, metrics in nvidia_gpus.items():
            gpu_entry = {'name': name}
            gpu_entry.update(metrics)
            gpu_entry['has_metrics'] = True
            stats['gpus'].append(gpu_entry)

    # 3. Battery status with 15-second TTL for WMI call
    try:
        battery = psutil.sensors_battery()
        if battery:
            stats['battery'] = {
                'percent': battery.percent,
                'power_plugged': battery.power_plugged,
                'secs_left': battery.secsleft if battery.secsleft != -2 else None
            }
            if now - _CACHED_BATTERY_TIME > 15.0:
                bat_wmi = None
                bat_out = _run_powershell_command('Get-CimInstance -ClassName BatteryStatus -Namespace root\\wmi | Select-Object ChargeRate, DischargeRate, Charging, Discharging, Voltage | ConvertTo-Json', timeout=5.0)
                if bat_out:
                    try:
                        import json
                        bat_wmi = json.loads(bat_out)
                        if isinstance(bat_wmi, list):
                            bat_wmi = bat_wmi[0]
                    except Exception:
                        pass
                _CACHED_BATTERY_WMI = bat_wmi
                _CACHED_BATTERY_TIME = now
            else:
                bat_wmi = _CACHED_BATTERY_WMI

            if bat_wmi:
                stats['battery']['charge_rate_mw'] = bat_wmi.get('ChargeRate')
                stats['battery']['discharge_rate_mw'] = bat_wmi.get('DischargeRate')
                stats['battery']['charging'] = bat_wmi.get('Charging')
                stats['battery']['discharging'] = bat_wmi.get('Discharging')
                stats['battery']['voltage_mv'] = bat_wmi.get('Voltage')
        else:
            stats['battery'] = None
    except Exception as e:
        stats['battery'] = {'error': str(e)}

    try:
        disk = psutil.disk_usage('C:\\')
        drives_list = []
        import ctypes
        DRIVE_REMOVABLE = 2
        for p in psutil.disk_partitions(all=False):
            mount = p.mountpoint
            try:
                du = psutil.disk_usage(mount)
                is_removable = False
                if sys.platform == "win32":
                    try:
                        dtype = ctypes.windll.kernel32.GetDriveTypeW(mount)
                        is_removable = (dtype == DRIVE_REMOVABLE)
                    except Exception:
                        is_removable = 'removable' in (p.opts or '').lower()
                else:
                    is_removable = 'removable' in (p.opts or '').lower() or '/media/' in mount or '/Volumes/' in mount

                drives_list.append({
                    'mountpoint': mount,
                    'device': p.device,
                    'fstype': p.fstype,
                    'opts': p.opts,
                    'is_removable': is_removable,
                    'total_gb': round(du.total / (1024**3), 1),
                    'free_gb': round(du.free / (1024**3), 1),
                    'used_gb': round(du.used / (1024**3), 1),
                    'usage_percent': round(du.percent, 1)
                })
            except Exception:
                drives_list.append({
                    'mountpoint': mount,
                    'device': p.device,
                    'fstype': p.fstype,
                    'opts': p.opts,
                    'is_removable': False,
                    'total_gb': 0.0,
                    'free_gb': 0.0,
                    'used_gb': 0.0,
                    'usage_percent': 0.0
                })

        stats['disk'] = {
            'total_gb': round(disk.total / (1024**3), 2),
            'used_gb': round(disk.used / (1024**3), 2),
            'free_gb': round(disk.free / (1024**3), 2),
            'usage_percent': disk.percent,
            'drives_count': len(drives_list),
            'drives': drives_list
        }
    except Exception as e:
        stats['disk'] = {'error': str(e), 'drives_count': 1, 'drives': []}

    try:
        stats['devices'] = _get_connected_pnp_devices()
    except Exception as e:
        stats['devices'] = []

    try:
        boot_time = psutil.boot_time()
        uptime_seconds = time.time() - boot_time
        uptime_hours = int(uptime_seconds // 3600)
        uptime_minutes = int((uptime_seconds % 3600) // 60)
        stats['uptime'] = {
            'hours': uptime_hours,
            'minutes': uptime_minutes
        }
    except Exception as e:
        stats['uptime'] = {'error': str(e)}

    return stats


_CACHED_PNP_DEVICES = None
_CACHED_PNP_TIME = 0.0


def _get_connected_pnp_devices():
    global _CACHED_PNP_DEVICES, _CACHED_PNP_TIME
    now = time.time()
    if _CACHED_PNP_DEVICES is not None and (now - _CACHED_PNP_TIME) < 10.0:
        return _CACHED_PNP_DEVICES

    if sys.platform != "win32":
        return []

    try:
        ps_code = """
$classes = @('Media','AudioEndpoint','Camera','Image','WPD','XboxComposite','HIDClass','Bluetooth')
Get-PnpDevice -PresentOnly | Where-Object { $classes -contains $_.Class -and $_.FriendlyName } | Select-Object FriendlyName, Class, InstanceId | ConvertTo-Json -Compress
"""
        cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_code]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if proc.returncode == 0 and proc.stdout.strip():
            import json
            raw_data = json.loads(proc.stdout.strip())
            if isinstance(raw_data, dict):
                raw_data = [raw_data]
            devices = []
            for item in raw_data:
                name = item.get("FriendlyName")
                pnp_class = item.get("Class")
                inst_id = item.get("InstanceId")
                if not name or not inst_id:
                    continue
                dev_type = _classify_pnp_device(name, pnp_class)
                devices.append({
                    "name": name,
                    "class": pnp_class,
                    "type": dev_type,
                    "id": inst_id
                })
            _CACHED_PNP_DEVICES = devices
            _CACHED_PNP_TIME = now
            return devices
    except Exception:
        pass

    return _CACHED_PNP_DEVICES or []


def _classify_pnp_device(name: str, pnp_class: str = "") -> str:
    n = (name or "").lower()
    c = (pnp_class or "").lower()

    # 1. Gamepads / Controllers
    if any(k in n for k in ["controller", "gamepad", "dualsense", "dualshock", "xbox", "joystick", "8bitdo", "flydigi", "thrustmaster"]) or c == "xboxcomposite":
        return "gamepad"

    # 2. Drawing Tablets
    if any(k in n for k in ["wacom", "xp-pen", "huion", "gaomon", "pen tablet", "drawing tablet"]):
        return "tablet"

    # 3. Webcams / Cameras
    if any(k in n for k in ["webcam", "brio", "cam link", "c920", "c922", "c930", "hd pro webcam"]) or c in ["camera", "image"]:
        return "webcam"

    # 4. Phones / Portable Media (WPD)
    if c == "wpd" or any(k in n for k in ["iphone", "pixel", "galaxy", "redmi", "oneplus", "xperia", "android", "portable device", "lumia", "gopro"]):
        return "phone"

    # 5. Audio Devices (Mics, Headsets, DACs)
    if any(k in n for k in ["microphone", "mic", "headset", "headphone", "earphone", "earbuds", "buds", "scarlett", "quadcast", "yeti", "dac", "amplifier", "audio interface", "airpods", "rockerz", "soundbar", "stone 260"]) or c in ["audioendpoint"]:
        return "audio"

    # 6. Generic Input / HID (mice, keyboards, etc. - ignored from voice spam)
    return "generic_hid"

