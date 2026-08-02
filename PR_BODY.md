# fix(memory): safelist critical processes + log names + 64-bit HANDLE hygiene

## Incident hypothesis

The >95% RAM branch (step 6 of `optimize_all_processes`) had **no safelist** and trimmed the raw top-10 memory-hogging processes by `memory_percent` with no guards. At memory pressure that top-10 routinely includes `dwm.exe` (Desktop Window Manager — the compositor that renders every window), `explorer.exe` (the shell/taskbar), and **whatever app the user just opened** (a freshly-launched process briefly spikes to the top of the list before settling). Trimming the working set of any of these causes a transient UI freeze — pages must be faulted back in from the pagefile/standby list before the process can paint again. To the user this looks exactly like "I opened a program and the laptop crashed/froze."

`EmptyWorkingSet` does **not** free committed memory — it only evicts pages from the process's working set, forcing the OS to re-fault them on next access. It therefore cannot prevent a true out-of-memory condition (only Windows' Memory Compression / commit limits govern that), but it *can* induce a freeze side-effect on the wrong target. The fix keeps the trim but makes it safe so the side-effect can't hit critical processes.

## Changes (all in `backend/app/memory/optimizer.py`)

1. **Safelist (`_NEVER_TRIM`)** — never trim the working sets of system-critical processes: `dwm.exe`, `explorer.exe`, `csrss.exe`, `winlogon.exe`, `smss.exe`, `services.exe`, `lsass.exe`, `MsMpEng.exe`, `SearchIndexer.exe`, `fontdrvhost.exe`, `dwmapi.dll`, `System`, `Idle`, `Registry`. Matched case-insensitively (Windows process names preserve their real case, e.g. `MsMpEng.exe`). This is the headline fix.

2. **Skip the foreground window + recently-launched processes** — `_foreground_pid()` resolves the PID owning the current foreground window via `user32.GetForegroundWindow` + `GetWindowThreadProcessId`, and step 6 skips it. Processes younger than 30 s (`now - create_time() < 30`) are also skipped, so a freshly-opened app is never trimmed mid-startup. Both guards are wrapped in try/except (`AccessDenied`/`NoSuchProcess`).

3. **Respect process priority** — HIGH and REALTIME priority class processes are never trimmed. Priority is fetched only for the top ~15 candidates (via `psutil.Process(pid).nice()`), not the full scan, to keep the global pass cheap.

4. **Log names + working-set sizes, not just a count** — step 6 now prints per-process `name (pid=…, ws~…MB)` for everything it actually trimmed, capturing the working-set size before trim (`memory_info().rss`). This is essential for post-incident diagnosis ("did we trim dwm?"). The selection logic is factored into a pure, side-effect-free helper `_select_trim_candidates(procs, now, foreground_pid)` so the safety filter is unit-testable in isolation without calling `EmptyWorkingSet`.

5. **ctypes `argtypes`/`restype` hygiene (64-bit HANDLE correctness)** — `OpenProcess`, `CloseHandle`, `GetCurrentProcess`, and `EmptyWorkingSet` now have explicit `argtypes`/`restype` with `c_void_p` for handles. Without these, ctypes defaults `restype` to `c_int` (32-bit), which truncates a 64-bit `HANDLE` and causes the calls to fail on 64-bit Python. The own-process trim (step 2) now uses `kernel32.GetCurrentProcess()` (returns the `-1` pseudo-handle correctly typed) instead of passing the bare integer `-1`.

## Non-destructive

- **Step 6 is kept** — it is not removed or disabled; it is made safe.
- **Yuki's own-process trimming (steps 1–5) is unchanged** — GC, own-process `EmptyWorkingSet`, parent-tree collection, the Yuki Electron/Node scan, and the per-PID trim all behave exactly as before (step 2 only swaps the bare `-1` for the properly-typed `GetCurrentProcess()` pseudo-handle, which is semantically identical).

## Design note

The safelist + foreground/age/priority guards are the memory-optimizer analogue of how a well-disciplined agent harness scopes the blast radius of a system-modifying action: before mutating state, you enumerate the targets and **skip the protected/critical ones** (system processes, the user's active foreground app, high-priority work) so an aggressive optimization can't take down the very thing it was trying to help. Factoring the filter into a pure helper makes that boundary reviewable and testable rather than buried inside an imperative loop.

## Verification

- **Import smoke:** `PYTHONPATH=backend python -c "from app.memory.optimizer import optimize_all_processes, _NEVER_TRIM, _foreground_pid"` ✔
- **Unit test of `_select_trim_candidates`:** asserts `dwm.exe`/`explorer.exe`/`System` excluded by safelist (case-insensitive), foreground PID excluded, `<30 s`-old excluded, `HIGH`/`REALTIME` priority excluded, returns at most 10, sorted by `memory_percent` desc — all passing. The helper touches no live `psutil.Process` objects and never calls `EmptyWorkingSet`, so the safety logic is verified without running the backend. ✔
- `git diff --stat` touches only `optimizer.py`. ✔
