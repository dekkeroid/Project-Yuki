import os
import sys
import ctypes
import psutil
import gc
import time

LAST_OPTIMIZATION_TIME = 0
OPTIMIZATION_COOLDOWN = 10.0

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_SET_QUOTA         = 0x0100


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

    print('[Memory] Running memory optimization...')

    # 1. Python GC — release circular references before trimming pages
    gc.collect()

    if os.name != 'nt':
        return

    pids_to_optimize = []

    # 2. Trim our own Python process first (handle -1 = current process)
    try:
        ctypes.windll.psapi.EmptyWorkingSet(-1)
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
