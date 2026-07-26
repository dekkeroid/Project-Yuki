import os
import sys
import ctypes
import psutil
import gc
import time

LAST_OPTIMIZATION_TIME = 0
OPTIMIZATION_COOLDOWN = 10.0

def optimize_all_processes(force=False):
    global LAST_OPTIMIZATION_TIME
    now = time.time()
    if not force and now - LAST_OPTIMIZATION_TIME < OPTIMIZATION_COOLDOWN:
        return
    LAST_OPTIMIZATION_TIME = now

    print('[Memory] Running memory optimization...')
    gc.collect()

    if os.name != 'nt':
        return

    try:
        own_handle = -1
        try:
            ctypes.windll.psapi.EmptyWorkingSet(own_handle)
        except Exception as e:
            print(f'[Memory] Failed to empty working set for own process: {e}')

        try:
            ppid = os.getppid()
        except AttributeError:
            ppid = None

        if ppid:
            pids_to_optimize = [ppid]
            try:
                parent = psutil.Process(ppid)
                for child in parent.children(recursive=True):
                    pids_to_optimize.append(child.pid)
            except Exception as e:
                print(f'[Memory] Failed to resolve parent process child tree: {e}')

        # Also find all electron/node processes associated with Project Yuki
        try:
            for p in psutil.process_iter(['pid', 'name', 'exe', 'cmdline']):
                try:
                    name = p.info.get('name')
                    if name and name.lower() in ('electron.exe', 'node.exe'):
                        exe = p.info.get('exe') or ''
                        cmd = ' '.join(p.info.get('cmdline') or [])
                        if 'Project Yuki' in exe or 'Project Yuki' in cmd or 'yuki' in cmd.lower():
                            if p.pid not in pids_to_optimize:
                                pids_to_optimize.append(p.pid)
                except Exception:
                    pass
        except Exception as e:
            print(f'[Memory] Failed to scan global processes: {e}')

            PROCESS_QUERY_INFORMATION = 0x0400
            PROCESS_SET_QUOTA = 0x0100
            
            optimized_count = 0
            for pid in pids_to_optimize:
                try:
                    handle = ctypes.windll.kernel32.OpenProcess(
                        PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, 
                        False, 
                        pid
                    )
                    if handle:
                        success = ctypes.windll.psapi.EmptyWorkingSet(handle)
                        if success:
                            optimized_count += 1
                        ctypes.windll.kernel32.CloseHandle(handle)
                except Exception:
                    pass
            print(f'[Memory] Successfully optimized working set for {optimized_count} parent/sibling process(es).')
    except Exception as e:
        print(f'[Memory] Failed to run Windows memory optimization: {e}')
