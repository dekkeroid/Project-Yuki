import os
import sys
import ctypes
import psutil
import gc
import time
from collections import namedtuple
from typing import List, Optional

LAST_OPTIMIZATION_TIME = 0
OPTIMIZATION_COOLDOWN = 10.0

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_SET_QUOTA         = 0x0100

# Never trim working sets of these system-critical processes — trimming dwm/explorer
# at >95% RAM can freeze the UI and look like a crash.
_NEVER_TRIM = {
    "dwm.exe", "explorer.exe", "csrss.exe", "winlogon.exe", "smss.exe",
    "services.exe", "lsass.exe", "MsMpEng.exe", "SearchIndexer.exe",
    "fontdrvhost.exe", "dwmapi.dll",  # display/compositor
    "System", "Idle", "Registry",
}

# Windows priority classes that are too important to trim. psutil exposes these
# as attributes on Windows; fall back to None on other platforms so the module
# still imports cross-platform.
_HIGH_PRIORITY_CLASS = getattr(psutil, 'HIGH_PRIORITY_CLASS', None)
_REALTIME_PRIORITY_CLASS = getattr(psutil, 'REALTIME_PRIORITY_CLASS', None)
# Lowercased copy for O(1) case-insensitive lookup — process names on Windows
# preserve their real case (e.g. "MsMpEng.exe", "System"), but the match must
# be case-insensitive so "DWM.EXE" / "system" are still safelisted.
_NEVER_TRIM_LOWER = {n.lower() for n in _NEVER_TRIM}
_SKIP_PRIORITIES = {pc for pc in (_HIGH_PRIORITY_CLASS, _REALTIME_PRIORITY_CLASS) if pc is not None}

# Normalized snapshot of a process used by the trim-selection logic. Keeping this
# as plain data lets _select_trim_candidates stay pure and unit-testable without
# touching live psutil.Process objects (or EmptyWorkingSet).
_ProcInfo = namedtuple('_ProcInfo', ['pid', 'name', 'memory_percent', 'create_time', 'priority'])

# ctypes argtypes/restype hygiene: on 64-bit Windows a HANDLE is a pointer-sized
# value. Without these annotations ctypes defaults restype to c_int (32-bit),
# which truncates the handle and causes OpenProcess/EmptyWorkingSet to fail on
# 64-bit Python. Guarded so the module still imports on non-Windows.
if os.name == 'nt':
    ctypes.windll.kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
    ctypes.windll.kernel32.OpenProcess.restype = ctypes.c_void_p
    ctypes.windll.kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    ctypes.windll.kernel32.GetCurrentProcess.argtypes = []
    ctypes.windll.kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    ctypes.windll.psapi.EmptyWorkingSet.argtypes = [ctypes.c_void_p]
    ctypes.windll.psapi.EmptyWorkingSet.restype = ctypes.c_bool


def _foreground_pid() -> Optional[int]:
    """Return the PID owning the current foreground window, or None.

    Skipping the foreground process prevents trimming the app the user just
    opened/focused — the most plausible trigger for the "opened a program →
    laptop crashed" report.
    """
    try:
        import ctypes as _ctypes
        hwnd = _ctypes.windll.user32.GetForegroundWindow()
        if not hwnd:
            return None
        pid = _ctypes.c_uint32(0)
        _ctypes.windll.user32.GetWindowThreadProcessId(hwnd, _ctypes.byref(pid))
        return pid.value if pid.value else None
    except Exception:
        return None


def _select_trim_candidates(procs, now, foreground_pid):
    """Pure, side-effect-free selection of which processes are safe to trim.

    Given an iterable of `_ProcInfo`, the current time `now` (epoch seconds)
    and the foreground-window PID (or None), return up to 10 candidates safe to
    trim, sorted by memory_percent descending.

    Excludes:
      - safelisted system-critical processes (_NEVER_TRIM, matched case-insensitively)
      - the foreground-window process (the app the user just opened/focused)
      - processes younger than 30s (recently launched — trimming them freezes startup)
      - HIGH/REALTIME priority class processes
    """
    candidates = []
    for p in procs:
        name = (p.name or '')
        if name.lower() in _NEVER_TRIM_LOWER:
            continue
        if foreground_pid is not None and p.pid == foreground_pid:
            continue
        if p.create_time is not None and now is not None and (now - p.create_time) < 30:
            continue
        if p.priority in _SKIP_PRIORITIES:
            continue
        candidates.append(p)
    candidates.sort(key=lambda p: p.memory_percent or 0, reverse=True)
    return candidates[:10]


def _empty_working_set(pid: int) -> bool:
    """Call EmptyWorkingSet on a process by PID. Returns True on success."""
    try:
        handle = ctypes.windll.kernel32.OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA,
            False,
            pid,
        )
        if not handle:
            return False
        success = ctypes.windll.psapi.EmptyWorkingSet(handle)
        ctypes.windll.kernel32.CloseHandle(handle)
        return bool(success)
    except Exception:
        return False


def optimize_all_processes(force=False):
    global LAST_OPTIMIZATION_TIME
    now = time.time()
    if not force and now - LAST_OPTIMIZATION_TIME < OPTIMIZATION_COOLDOWN:
        return
    LAST_OPTIMIZATION_TIME = now

    # Hold off trimming while the Whisper model is loading - EmptyWorkingSet would
    # page out the model pages as they're being read, massively slowing STT startup.
    try:
        from app.voice.stt import is_whisper_loading
        if is_whisper_loading():
            try:
                print('[Memory] Whisper model is still loading - holding off memory optimization until it completes.')
            except Exception:
                pass
            return
    except Exception:
        pass

    print('[Memory] Running memory optimization...')

    # 1. Python GC — release circular references before trimming pages
    gc.collect()

    if os.name != 'nt':
        return

    pids_to_optimize = []

    # 2. Trim our own Python process first. GetCurrentProcess() returns the
    #    current-process pseudo-handle (equivalent to -1) but correctly typed
    #    as a pointer-sized HANDLE for 64-bit Python.
    try:
        own_handle = ctypes.windll.kernel32.GetCurrentProcess()
        ctypes.windll.psapi.EmptyWorkingSet(own_handle)
        print('[Memory] Own process working set trimmed.')
    except Exception as e:
        print(f'[Memory] Failed to trim own process: {e}')

    # 3. Collect parent PID + its full child tree (covers the Electron main process
    #    when Python is launched as a child, or vice-versa)
    try:
        ppid = os.getppid()
    except AttributeError:
        ppid = None

    if ppid:
        pids_to_optimize.append(ppid)
        try:
            parent = psutil.Process(ppid)
            for child in parent.children(recursive=True):
                pids_to_optimize.append(child.pid)
        except Exception as e:
            print(f'[Memory] Could not resolve parent process tree: {e}')

    # 4. Scan ALL running processes for Electron/Node processes belonging to Project Yuki
    #    This catches the GPU process and renderer, which are NOT in the parent tree.
    try:
        for p in psutil.process_iter(['pid', 'name', 'exe', 'cmdline']):
            try:
                name = (p.info.get('name') or '').lower()
                if name not in ('electron.exe', 'node.exe'):
                    continue
                exe = p.info.get('exe') or ''
                cmd = ' '.join(p.info.get('cmdline') or [])
                if 'Project Yuki' in exe or 'Project Yuki' in cmd or 'yuki' in cmd.lower():
                    if p.pid not in pids_to_optimize:
                        pids_to_optimize.append(p.pid)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    except Exception as e:
        print(f'[Memory] Global process scan error (non-fatal): {e}')

    # 5. Call EmptyWorkingSet on every collected PID
    optimized_count = 0
    for pid in pids_to_optimize:
        if _empty_working_set(pid):
            optimized_count += 1

    if pids_to_optimize:
        print(f'[Memory] EmptyWorkingSet called on {optimized_count}/{len(pids_to_optimize)} Electron/Node process(es).')

    # 6. If system RAM > 95%, trim top 10 memory-hogging processes — safely.
    #    The original branch trimmed the raw top-10 by memory_percent with no
    #    guards, which could trim dwm.exe/explorer.exe/the just-opened foreground
    #    app and freeze the UI. Now we safelist critical processes, skip the
    #    foreground window, skip processes younger than 30s, and skip HIGH/
    #    REALTIME priority processes. Selection is factored into the pure, unit-
    #    testable _select_trim_candidates helper.
    try:
        ram = psutil.virtual_memory()
        if ram.percent > 95:
            fg_pid = _foreground_pid()
            scan_time = time.time()
            scanned = []
            for p in psutil.process_iter(['pid', 'name', 'memory_percent', 'create_time']):
                try:
                    pid = p.info['pid']
                    # Don't re-trim processes already handled in steps 3-5.
                    if pid in pids_to_optimize:
                        continue
                    scanned.append(_ProcInfo(
                        pid=pid,
                        name=p.info.get('name') or '',
                        memory_percent=p.info.get('memory_percent') or 0.0,
                        create_time=p.info.get('create_time'),
                        priority=None,
                    ))
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

            # Sort by memory_percent desc and only fetch priority for the top ~15,
            # so the global scan stays cheap (nice() is a per-process syscall).
            scanned.sort(key=lambda pi: pi.memory_percent, reverse=True)
            enriched = []
            for pi in scanned[:15]:
                pc = None
                try:
                    pc = psutil.Process(pi.pid).nice()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pc = None
                except Exception:
                    pc = None
                enriched.append(pi._replace(priority=pc))

            candidates = _select_trim_candidates(enriched, scan_time, fg_pid)

            trimmed_details = []
            for pi in candidates:
                try:
                    proc = psutil.Process(pi.pid)
                    before_mb = proc.memory_info().rss / (1024 * 1024)
                    if _empty_working_set(pi.pid):
                        trimmed_details.append((pi.name, pi.pid, before_mb))
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

            print(f"[Memory] RAM at {ram.percent}% — trimming {len(trimmed_details)} processes:")
            for name, pid, before_mb in trimmed_details:
                print(f"  - {name} (pid={pid}, ws~{before_mb:.0f}MB)")
    except Exception as e:
        print(f'[Memory] RAM-triggered optimization error: {e}')
