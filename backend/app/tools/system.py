import os
import subprocess
import sys
import platform
import socket
import psutil
import time

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

def _get_uwp_apps() -> list:
    global _UWP_APPS_CACHE
    if _UWP_APPS_CACHE is not None:
        return _UWP_APPS_CACHE
    
    import json
    import subprocess
    try:
        print("[UWP Search] Fetching UWP/Store apps via Get-StartApps...")
        cmd = 'powershell -Command "Get-StartApps | ConvertTo-Json"'
        out = subprocess.check_output(cmd, shell=True).decode('utf-8', errors='ignore')
        apps = json.loads(out)
        if isinstance(apps, dict):
            apps = [apps]
        _UWP_APPS_CACHE = apps
        print(f"[UWP Search] Found {len(_UWP_APPS_CACHE)} apps in Start menu/UWP.")
        return _UWP_APPS_CACHE
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

def launch_app(app_name: str, args: str = None, run_as_admin: bool = False) -> str:
    """
    Launches an application on the user's PC. Supports arguments and admin privilege execution.
    """
    if not app_name or not app_name.strip():
        return "Error: Application name must not be empty."
        
    target = app_name.strip()
    app_path = _find_app_path(target)
    
    executable = app_path if app_path else target
    
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

def run_terminal_command(command: str, use_powershell: bool = True) -> str:
    """
    Runs a shell command in Cmd or PowerShell and returns the output.
    """
    try:
        shell_exe = "powershell.exe" if use_powershell else "cmd.exe"
        shell_arg = "-Command" if use_powershell else "/c"
        
        result = subprocess.run(
            [shell_exe, shell_arg, command],
            capture_output=True,
            text=True,
            shell=True,
            timeout=30
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        
        output = []
        if stdout:
            output.append(stdout)
        if stderr:
            output.append(f"Error output:\n{stderr}")
            
        if not output:
            return f"Command executed successfully (exit code: {result.returncode}), but returned no output."
            
        return "\n".join(output)
    except Exception as e:
        return f"Failed to execute command: {str(e)}"

def run_python_script(code: str) -> str:
    """
    Executes a block of Python code and returns the output.
    """
    import tempfile
    
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w", encoding="utf-8") as f:
        f.write(code)
        temp_file = f.name
        
    try:
        result = subprocess.run(
            [sys.executable, temp_file],
            capture_output=True,
            text=True,
            timeout=30
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        
        output = []
        if stdout:
            output.append(stdout)
        if stderr:
            output.append(f"Error output:\n{stderr}")
            
        if not output:
            return f"Python script finished (exit code: {result.returncode}) with no output."
            
        return "\n".join(output)
    except Exception as e:
        return f"Failed to execute Python script: {str(e)}"
    finally:
        if os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except:
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

def media_playback_control(action: str) -> str:
    """
    Controls media playback keys.
    """
    try:
        import pyautogui
        pyautogui.FAILSAFE = False
        action_clean = action.lower().strip()
        
        # Map common action synonyms to valid pyautogui keys
        if action_clean in ("play", "pause", "stop", "resume", "unpause"):
            action_clean = "play_pause"
        elif action_clean == "vol_up":
            action_clean = "volume_up"
        elif action_clean == "vol_down":
            action_clean = "volume_down"
        
        mapping = {
            "play_pause": "playpause",
            "next": "nexttrack",
            "previous": "prevtrack",
            "volume_up": "volumeup",
            "volume_down": "volumedown",
            "mute": "volumemute"
        }
        
        pykey = mapping.get(action_clean)
        if not pykey:
            return f"Error: Unknown media action '{action}'"
            
        pyautogui.press(pykey)
        return f"Triggered media playback action: {action_clean}"
    except Exception as e:
        return f"Failed to send media key: {str(e)}"

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

def get_detailed_stats() -> dict:
    """
    Returns comprehensive system statistics (CPU, RAM, GPU, Battery, Disk, Uptime) as a dictionary.
    """
    stats = {}
    stats['os'] = f"Windows {platform.release()} (Build {platform.version()})"
    
    try:
        cpu_usage = psutil.cpu_percent(interval=0.1)
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
    detected_gpus = []
    try:
        gpu_wmi_cmd = 'powershell -Command "Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json"'
        gpu_wmi_out = subprocess.check_output(gpu_wmi_cmd, shell=True).decode(errors='ignore').strip()
        if gpu_wmi_out:
            import json
            gpu_wmi_data = json.loads(gpu_wmi_out)
            if isinstance(gpu_wmi_data, list):
                detected_gpus = [g['Name'] for g in gpu_wmi_data if g.get('Name')]
            elif isinstance(gpu_wmi_data, dict) and gpu_wmi_data.get('Name'):
                detected_gpus = [gpu_wmi_data['Name']]
    except Exception:
        pass

    nvidia_gpus = {}
    try:
        nvidia_cmd = 'nvidia-smi --query-gpu=name,utilization.gpu,utilization.memory,memory.total,memory.used,temperature.gpu --format=csv,noheader,nounits'
        nvidia_out = subprocess.check_output(nvidia_cmd, shell=True).decode(errors='ignore').strip()
        if nvidia_out:
            for line in nvidia_out.split('\n'):
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

    try:
        battery = psutil.sensors_battery()
        if battery:
            stats['battery'] = {
                'percent': battery.percent,
                'power_plugged': battery.power_plugged,
                'secs_left': battery.secsleft if battery.secsleft != -2 else None
            }
            try:
                import json
                cmd = 'powershell -Command "Get-CimInstance -ClassName BatteryStatus -Namespace root\\wmi | Select-Object ChargeRate, DischargeRate, Charging, Discharging, Voltage | ConvertTo-Json"'
                out = subprocess.check_output(cmd, shell=True).decode(errors='ignore').strip()
                if out:
                    bat_wmi = json.loads(out)
                    if isinstance(bat_wmi, list):
                        bat_wmi = bat_wmi[0]
                    stats['battery']['charge_rate_mw'] = bat_wmi.get('ChargeRate')
                    stats['battery']['discharge_rate_mw'] = bat_wmi.get('DischargeRate')
                    stats['battery']['charging'] = bat_wmi.get('Charging')
                    stats['battery']['discharging'] = bat_wmi.get('Discharging')
                    stats['battery']['voltage_mv'] = bat_wmi.get('Voltage')
            except Exception:
                pass
        else:
            stats['battery'] = None
    except Exception as e:
        stats['battery'] = {'error': str(e)}

    try:
        disk = psutil.disk_usage('C:\\')
        stats['disk'] = {
            'total_gb': round(disk.total / (1024**3), 2),
            'used_gb': round(disk.used / (1024**3), 2),
            'free_gb': round(disk.free / (1024**3), 2),
            'usage_percent': disk.percent,
            'drives_count': len(psutil.disk_partitions(all=False))
        }
    except Exception as e:
        stats['disk'] = {'error': str(e), 'drives_count': 1}

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
