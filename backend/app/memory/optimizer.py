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

# Active-work guard: while a chat turn or TTS synthesis is running, the optimizer
# must NOT empty the own process's working set — that would page out the just-loaded
# Kokoro/Whisper model pages and force slow re-faults + CUDA re-warm on the next turn.
# Electron/Node processes are still trimmed; only the model-holding Python process
# is spared. A counter (not a plain bool) keeps overlapping turns / background TTS safe.
_own_process_busy_count = 0


def set_own_process_busy(busy: bool):
    """Increment/decrement the active-work counter (nested/overlapping turns safe)."""
    global _own_process_busy_count
    if busy:
        _own_process_busy_count += 1
    else:
        _own_process_busy_count = max(0, _own_process_busy_count - 1)


def is_own_process_busy() -> bool:
    """True while a chat turn or TTS synthesis is actively using the loaded models."""
    return _own_process_busy_count > 0


class own_process_busy_guard:
    """Context manager: marks that a chat turn / TTS synthesis is active."""

    def __enter__(self):
        set_own_process_busy(True)

    def __exit__(self, *exc):
        set_own_process_busy(False)
        return False

# How many memory-heavy processes the >90% RAM branch may trim, and how many
# candidates to enrich before applying the exclusion filters. The enrich window
# is larger than MAX_TRIM_CANDIDATES so that safelist/foreground/young/priority
# exclusions don't starve the trim list below the target size.
MAX_TRIM_CANDIDATES = 15
SCAN_ENRICH_WINDOW = 30

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_SET_QUOTA         = 0x0100

# Never trim working sets of these system-critical processes — trimming dwm/explorer
# at >90% RAM can freeze the UI and look like a crash.
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
    and the foreground-window PID (or None), return up to MAX_TRIM_CANDIDATES
    candidates safe to trim, sorted by memory_percent descending.

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
    return candidates[:MAX_TRIM_CANDIDATES]


def _empty_working_set(pid: int) -> bool:
    """Call EmptyWorkingSet on a process by PID. Returns True on success."""
    try:
        # Defense-in-depth safety guard: never trim safelisted system processes or active foreground PID
        try:
            pname = psutil.Process(pid).name()
            if pname and pname.lower() in _NEVER_TRIM_LOWER:
                return False
            fg_pid = _foreground_pid()
            if fg_pid is not None and pid == fg_pid:
                return False
        except Exception:
            pass

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


def optimize_all_processes(force=False, skip_own_process=False):
    global LAST_OPTIMIZATION_TIME
    now = time.time()
    if not force and now - LAST_OPTIMIZATION_TIME < OPTIMIZATION_COOLDOWN:
        return
    LAST_OPTIMIZATION_TIME = now

    # We skip trimming our own process to protect the loaded Whisper/Kokoro model pages
    # only if Whisper is actively loading, or if listening mode is active AND the user
    # has spoken within the last 120 seconds (active conversation).
    # If they are in idle listening (no speech for >120s), we allow own process trimming.
    try:
        from app.voice.stt import is_whisper_loading, is_listening_mode_active, get_last_stt_time
        should_skip_own = False
        if is_whisper_loading():
            should_skip_own = True
        elif is_listening_mode_active():
            time_since_last_speech = time.time() - get_last_stt_time()
            if time_since_last_speech < 120.0:
                should_skip_own = True
        
        if should_skip_own:
            skip_own_process = True
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
    #    Skipped while a chat turn / TTS synthesis is active (busy guard) and
    #    during the initial startup sweep (skip_own_process) — trimming would
    #    page out the freshly preloaded Kokoro/Whisper model pages and undo the
    #    warm-up, making the first real turn slow.
    if not is_own_process_busy() and not skip_own_process:
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

    # 6. If system RAM > 90%, trim top MAX_TRIM_CANDIDATES memory-hogging
    #    processes — safely. The original branch trimmed the raw top-10 by
    #    memory_percent with no guards, which could trim dwm.exe/explorer.exe/the
    #    just-opened foreground app and freeze the UI. Now we safelist critical
    #    processes, skip the foreground window, skip processes younger than 30s,
    #    and skip HIGH/REALTIME priority processes. Selection is factored into the
    #    pure, unit-testable _select_trim_candidates helper.
    try:
        ram = psutil.virtual_memory()
        if ram.percent > 90:
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

            # Sort by memory_percent desc and only fetch priority for the top
            # SCAN_ENRICH_WINDOW, so the global scan stays cheap (nice() is a
            # per-process syscall) while leaving headroom for the exclusion
            # filters to fill all MAX_TRIM_CANDIDATES slots.
            scanned.sort(key=lambda pi: pi.memory_percent, reverse=True)
            enriched = []
            for pi in scanned[:SCAN_ENRICH_WINDOW]:
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
