import os
import subprocess
import sys
import platform

def get_system_stats() -> str:
    """
    Returns system status such as CPU usage, available RAM, and OS details.
    """
    if platform.system() != "Windows":
        return f"Currently running on {platform.system()}. System stats are only fully supported on Windows."
    
    try:
        import ctypes
        from ctypes import wintypes
        import time

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ('dwLength', wintypes.DWORD),
                ('dwMemoryLoad', wintypes.DWORD),
                ('ullTotalPhys', ctypes.c_uint64),
                ('ullAvailPhys', ctypes.c_uint64),
                ('ullTotalPageFile', ctypes.c_uint64),
                ('ullAvailPageFile', ctypes.c_uint64),
                ('ullTotalVirtual', ctypes.c_uint64),
                ('ullAvailVirtual', ctypes.c_uint64),
                ('ullAvailExtendedVirtual', ctypes.c_uint64),
            ]

        def get_cpu_times():
            idle = ctypes.c_uint64()
            kernel = ctypes.c_uint64()
            user = ctypes.c_uint64()
            ctypes.windll.kernel32.GetSystemTimes(
                ctypes.byref(idle),
                ctypes.byref(kernel),
                ctypes.byref(user)
            )
            return idle.value, kernel.value, user.value

        # Get CPU usage over a short 100ms interval
        idle1, kernel1, user1 = get_cpu_times()
        time.sleep(0.1)
        idle2, kernel2, user2 = get_cpu_times()
        
        idle_diff = idle2 - idle1
        kernel_diff = kernel2 - kernel1
        user_diff = user2 - user1
        total_system = kernel_diff + user_diff
        
        if total_system > 0:
            cpu_usage = 100.0 * (total_system - idle_diff) / total_system
            cpu_usage = max(0.0, min(100.0, cpu_usage))
            cpu_usage_str = f"{round(cpu_usage)}%"
        else:
            cpu_usage_str = "Unknown"

        # Get Memory stats
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(stat)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        total_gb = stat.ullTotalPhys / (1024 ** 3)
        free_gb = stat.ullAvailPhys / (1024 ** 3)
        used_gb = total_gb - free_gb
        mem_usage = f"{used_gb:.2f} GB / {total_gb:.2f} GB"

        return f"OS: Windows {platform.release()}\nCPU Usage: {cpu_usage_str}\nMemory Usage: {mem_usage}"
    except Exception as e:
        # Fallback to powershell in case ctypes/Windows APIs fail
        try:
            combined_cmd = (
                'powershell -Command "'
                '$cpu = (Get-CimInstance Win32_Processor).LoadPercentage; '
                '$os = Get-CimInstance Win32_OperatingSystem; '
                '$used = [math]::round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1024 / 1024, 2); '
                '$total = [math]::round($os.TotalVisibleMemorySize / 1024 / 1024, 2); '
                'Write-Output $cpu; Write-Output $used; Write-Output $total"'
            )
            out = subprocess.check_output(combined_cmd, shell=True).decode().strip().split("\n")
            if len(out) >= 3:
                cpu_usage_opt = f"{out[0].strip()}%"
                mem_usage_opt = f"{out[1].strip()} GB / {out[2].strip()} GB"
                return f"OS: Windows {platform.release()}\nCPU Usage: {cpu_usage_opt}\nMemory Usage: {mem_usage_opt}"
        except Exception:
            pass
        return f"Failed to retrieve system stats: {str(e)}"

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
                        # Enforce strong match check:
                        # 1. Bidirectional prefix check (e.g. "tele" starts "telegram" or "telegram" starts "tele")
                        # 2. Length ratio check (query covers at least 50% of target, or vice versa)
                        is_prefix = name_clean.startswith(app_name_clean) or app_name_clean.startswith(name_clean)
                        is_high_ratio = len(app_name_clean) >= (len(name_clean) * 0.5) or len(name_clean) >= (len(app_name_clean) * 0.5)
                        if is_prefix or is_high_ratio:
                            return os.path.join(root, file)
    return None

def _find_app_path(app_name: str):
    # Minor aliases where search terms don't match standard windows exe names
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
        # 1. Registry lookup (exact)
        path = _find_app_in_registry(term)
        if path:
            return path

        # 2. WindowsApps lookup (exact)
        path = _find_app_in_windows_apps(term)
        if path:
            return path

        # 3. Path lookup (where.exe)
        try:
            out = subprocess.check_output(f'where.exe "{term}"', shell=True).decode().strip().split("\n")[0]
            if out and os.path.exists(out):
                return out
        except Exception:
            pass

        # 4. Direct Windows System Directory lookup
        for win_dir in ["C:\\Windows\\System32", "C:\\Windows"]:
            full_path = os.path.join(win_dir, term)
            if os.path.exists(full_path):
                return full_path

        # 5. Exact Start Menu lookup
        path = _find_app_in_start_menu_exact(term)
        if path:
            return path

        # 5b. Exact UWP App lookup
        path = _find_uwp_app(term, exact_only=True)
        if path:
            return path

    # 6. Fallback: Partial searches
    for term in search_terms:
        path = _find_app_in_start_menu_partial(term)
        if path:
            return path

        path = _find_uwp_app(term, exact_only=False)
        if path:
            return path

    return None

def launch_app(app_name: str) -> str:
    """
    Launches an application on the user's PC. E.g. 'notepad', 'calc', 'chrome'.
    """
    if not app_name or not app_name.strip():
        return "Error: Application name must not be empty."
        
    target = app_name.strip()
    
    # 1. Try to dynamically resolve the application path/shortcut
    app_path = _find_app_path(target)
    
    if app_path:
        try:
            # os.startfile will launch executables or resolve .lnk shortcuts natively
            os.startfile(app_path) if hasattr(os, "startfile") else subprocess.Popen(app_path, shell=True)
            return f"Success: Launched '{app_name}'!"
        except Exception as e:
            return f"Failed to launch '{app_path}': {str(e)}"
            
    # 2. Fallback to general system command start or powershell if resolution failed
    try:
        os.startfile(target) if hasattr(os, "startfile") else subprocess.Popen(target, shell=True)
        return f"Success: Triggered startup for '{app_name}'!"
    except Exception as e:
        try:
            subprocess.Popen(["powershell", "-Command", f'Start-Process "{target}"'])
            return f"Success: Launched '{app_name}' via PowerShell."
        except Exception as e2:
            return f"Failed to launch '{app_name}': {str(e)} (fallback: {str(e2)})"

def set_system_volume(volume_level: int) -> str:
    """
    Sets the system volume. Range is 0 to 100.
    """
    if volume_level < 0 or volume_level > 100:
        return "Error: Volume must be between 0 and 100."
    
    # Instantly set Windows system volume using Core Audio COM interface
    ps_command = """
    $Definition = @'
    using System;
    using System.Runtime.InteropServices;

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        int f(); int g(); int h(); int i();
        int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int k(); int l(); int m(); int n();
        int SetMute(bool bMute, Guid pguidEventContext);
        int GetMute(out bool pbMute);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        int f();
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

    public class Audio {
        public static void SetVolume(float level) {
            var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
            IMMDevice dev = null;
            enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
            IAudioEndpointVolume epv = null;
            var epvid = typeof(IAudioEndpointVolume).GUID;
            dev.Activate(ref epvid, 23, 0, out epv);
            epv.SetMasterVolumeLevelScalar(level / 100f, Guid.Empty);
        }
    }
    '@
    try {
        Add-Type -TypeDefinition $Definition -ErrorAction SilentlyContinue
    } catch {}
    [Audio]::SetVolume(%d)
    """ % volume_level

    try:
        subprocess.run(["powershell", "-Command", ps_command], capture_output=True, text=True)
        return f"Successfully set volume to approximately {volume_level}%."
    except Exception as e:
        return f"Failed to set volume: {str(e)}"

def get_current_datetime() -> str:
    """
    Returns the current date and time on the user's PC.
    """
    import datetime
    now = datetime.datetime.now()
    return now.strftime("%A, %B %d, %Y, %I:%M %p")

def get_detailed_stats() -> dict:
    """
    Returns comprehensive system statistics (CPU, RAM, GPU, Battery, Disk, Uptime) as a dictionary.
    """
    import psutil
    import json
    import time
    
    stats = {}
    
    # 1. OS details
    stats['os'] = f"Windows {platform.release()} (Build {platform.version()})"
    
    # 2. CPU usage and info
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

    # 3. RAM usage
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

    # 4. GPU info and usage
    stats['gpus'] = []
    detected_gpus = []
    try:
        gpu_wmi_cmd = 'powershell -Command "Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json"'
        gpu_wmi_out = subprocess.check_output(gpu_wmi_cmd, shell=True).decode(errors='ignore').strip()
        if gpu_wmi_out:
            gpu_wmi_data = json.loads(gpu_wmi_out)
            if isinstance(gpu_wmi_data, list):
                detected_gpus = [g['Name'] for g in gpu_wmi_data if g.get('Name')]
            elif isinstance(gpu_wmi_data, dict) and gpu_wmi_data.get('Name'):
                detected_gpus = [gpu_wmi_data['Name']]
    except Exception:
        pass

    # Try getting NVIDIA metrics
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

    # Combine GPU lists
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

    # If WMI was empty but nvidia-smi succeeded, populate from nvidia-smi
    if not stats['gpus'] and nvidia_gpus:
        for name, metrics in nvidia_gpus.items():
            gpu_entry = {'name': name}
            gpu_entry.update(metrics)
            gpu_entry['has_metrics'] = True
            stats['gpus'].append(gpu_entry)

    # 5. Battery info
    try:
        battery = psutil.sensors_battery()
        if battery:
            stats['battery'] = {
                'percent': battery.percent,
                'power_plugged': battery.power_plugged,
                'secs_left': battery.secsleft if battery.secsleft != -2 else None
            }
            # Fetch charge/discharge rates via WMI
            try:
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

    # 6. Disk usage (C: drive)
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

    # 7. Uptime
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

