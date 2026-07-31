"""
GPU Memory Monitor

Queries Windows Performance Counters for per-process VRAM usage.
Works for ALL GPU vendors (NVIDIA, AMD, Intel) on both iGPU and dGPU.
Same data source Task Manager uses.

Instance name format: pid_{PID}_luid_0x00000000_0x{GPU_LUID}_phys_{N}
The SECOND LUID (after the second 0x) is the actual GPU adapter LUID.
"""

import json
import subprocess
import tempfile
import os
import time
import re
from pathlib import Path
from typing import Dict, List, Any, Optional

_cache: Optional[Dict[str, Any]] = None
_cache_time: float = 0
CACHE_TTL: float = 3.0

PS_SCRIPT = r"""
$ErrorActionPreference = 'SilentlyContinue'

# 1. Get GPU names via PnP devices
$gpus = @()
foreach ($dev in Get-PnpDevice -Class Display -PresentOnly) {
    $prop = Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName '{60B193CB-5276-4D0F-96FC-F173ABAD3EC6} 2' -ErrorAction SilentlyContinue
    if ($prop -and $prop.Data) {
        $luidRaw = [uint64]$prop.Data
        $luidLow = [uint32]($luidRaw % 4294967296)
        $gpus += [pscustomobject]@{ name = $dev.FriendlyName; luid = ('0x{0:x8}' -f $luidLow).ToLower() }
    } else {
        $gpus += [pscustomobject]@{ name = $dev.FriendlyName; luid = 'unknown' }
    }
}

# 2. Get per-process dedicated + shared VRAM
$procSamples = $null
try {
    $procSamples = Get-Counter @(
        '\GPU Process Memory(*)\Dedicated Usage',
        '\GPU Process Memory(*)\Shared Usage'
    )
} catch {}

$rows = @{}
if ($procSamples) {
    foreach ($s in $procSamples.CounterSamples) {
        $inst = $s.InstanceName
        # Format: pid_{PID}_luid_0x00000000_0x{GPU_LUID}_phys_{N}
        # The SECOND 0x hex value is the actual GPU adapter LUID
        if ($inst -match '^pid_(\d+)_luid_0x[0-9a-fA-F]+_0x([0-9a-fA-F]+)_') {
            $procId = [int]$Matches[1]
            $luid = ('0x{0}' -f $Matches[2].ToLower())
            $key = "${procId}|${luid}"
            if (-not $rows.ContainsKey($key)) {
                $rows[$key] = [pscustomobject]@{ pid = $procId; luid = $luid; dedicated = [int64]0; shared = [int64]0 }
            }
            if ($s.Path -match 'dedicated usage') {
                $rows[$key].dedicated += [int64]$s.CookedValue
            } elseif ($s.Path -match 'shared usage') {
                $rows[$key].shared += [int64]$s.CookedValue
            }
        }
    }
}

# 3. Resolve process names
$pids = $rows.Values | ForEach-Object { $_.pid } | Sort-Object -Unique
$procMap = @{}
if ($pids) {
    Get-Process -Id $pids -ErrorAction SilentlyContinue | ForEach-Object { $procMap[$_.Id] = $_.ProcessName }
}

# 4. Build output
$processes = @()
foreach ($r in $rows.Values) {
    $pname = if ($procMap.ContainsKey($r.pid)) { $procMap[$r.pid] } else { '(unknown)' }
    $processes += [pscustomobject]@{
        pid = $r.pid
        name = $pname
        luid = $r.luid
        dedicated = $r.dedicated
        shared = $r.shared
    }
}

[pscustomobject]@{
    gpus = $gpus
    processes = $processes
} | ConvertTo-Json -Depth 5 -Compress
"""

_PS_SCRIPT_PATH: Optional[Path] = None


def _get_ps_script_path() -> Path:
    """Write the PS script to a temp file once, reuse it."""
    global _PS_SCRIPT_PATH
    if _PS_SCRIPT_PATH is None or not _PS_SCRIPT_PATH.exists():
        fd, p = tempfile.mkstemp(suffix=".ps1", prefix="yuki_gpu_monitor_")
        os.close(fd)
        Path(p).write_text(PS_SCRIPT.strip(), encoding="utf-8")
        _PS_SCRIPT_PATH = Path(p)
    return _PS_SCRIPT_PATH


def get_gpu_memory_usage() -> Dict[str, Any]:
    """Get per-process VRAM usage for all GPUs. Cached for 3 seconds."""
    global _cache, _cache_time

    now = time.time()
    if _cache and (now - _cache_time) < CACHE_TTL:
        return _cache

    try:
        script_path = _get_ps_script_path()
        result = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script_path)],
            capture_output=True, text=True, timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

        if result.returncode != 0 and not result.stdout.strip():
            stderr_msg = (result.stderr or "").strip()[:200]
            return {"gpus": [], "top5": {}, "error": f"PowerShell failed (code {result.returncode}): {stderr_msg}"}

        raw = result.stdout.strip()
        if not raw:
            return {"gpus": [], "top5": {}, "error": "Empty PowerShell output"}

        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if not match:
            return {"gpus": [], "top5": {}, "error": "No JSON in PowerShell output"}

        data = json.loads(match.group())
        gpu_list = data.get("gpus", [])
        processes = data.get("processes", [])

        # Group processes by GPU LUID
        luid_to_gpu: Dict[str, str] = {g["luid"]: g["name"] for g in gpu_list if g.get("luid") != "unknown"}
        gpu_procs: Dict[str, List[Dict]] = {}

        for p in processes:
            gpu_name = luid_to_gpu.get(p["luid"], f"GPU ({p['luid']})")
            if gpu_name not in gpu_procs:
                gpu_procs[gpu_name] = []
            gpu_procs[gpu_name].append({
                "pid": p["pid"],
                "name": p["name"],
                "dedicated_mb": round(p["dedicated"] / (1024 * 1024), 1),
                "shared_mb": round(p["shared"] / (1024 * 1024), 1),
            })

        # Ensure every GPU from PnP devices appears in top5 even if no processes
        for g in gpu_list:
            if g["luid"] != "unknown" and g["name"] not in gpu_procs:
                gpu_procs[g["name"]] = []

        # Sort by dedicated VRAM descending, take top 5
        top5: Dict[str, List[Dict]] = {}
        for gpu_name, procs in gpu_procs.items():
            procs.sort(key=lambda x: x["dedicated_mb"], reverse=True)
            top5[gpu_name] = procs[:5]

        # Filter out ghost GPUs where all processes show 0 MB dedicated + 0 MB shared
        # (Microsoft Basic Render Driver, inactive Intel iGPU, etc.)
        top5 = {
            name: procs for name, procs in top5.items()
            if any(p["dedicated_mb"] > 0 or p["shared_mb"] > 0 for p in procs)
        }

        _cache = {"gpus": gpu_list, "top5": top5}
        _cache_time = now
        return _cache

    except subprocess.TimeoutExpired:
        return {"gpus": [], "top5": {}, "error": "PowerShell timed out (10s)"}
    except Exception as e:
        return {"gpus": [], "top5": {}, "error": f"GPU monitor error: {type(e).__name__}"}


def get_dedicated_gpu_vram_percent() -> Optional[float]:
    """
    Returns used/total VRAM percentage for the dedicated (non-integrated) NVIDIA GPU via NVML.
    Picks the NVIDIA device with the largest total memory. Returns None if unavailable.
    """
    try:
        import ctypes
        nvml = ctypes.WinDLL("nvml.dll")

        nvml.nvmlInit.restype = ctypes.c_int
        nvml.nvmlDeviceGetCount.restype = ctypes.c_int
        nvml.nvmlDeviceGetHandleByIndex.restype = ctypes.c_int
        nvml.nvmlDeviceGetMemoryInfo.restype = ctypes.c_int
        nvml.nvmlShutdown.restype = ctypes.c_int

        if nvml.nvmlInit() != 0:
            return None

        try:
            count = ctypes.c_uint(0)
            if nvml.nvmlDeviceGetCount(ctypes.byref(count)) != 0:
                return None

            class MemoryInfo(ctypes.Structure):
                _fields_ = [
                    ("total", ctypes.c_ulonglong),
                    ("free", ctypes.c_ulonglong),
                    ("used", ctypes.c_ulonglong),
                ]

            best_used = 0
            best_total = 0
            for i in range(count.value):
                handle = ctypes.c_void_p()
                if nvml.nvmlDeviceGetHandleByIndex(i, ctypes.byref(handle)) != 0:
                    continue
                info = MemoryInfo()
                if nvml.nvmlDeviceGetMemoryInfo(handle, ctypes.byref(info)) != 0:
                    continue
                # Dedicated GPU = the one with the most total VRAM (beats any iGPU)
                if info.total > best_total:
                    best_total = info.total
                    best_used = info.used

            if best_total <= 0:
                return None
            return round((best_used / best_total) * 100.0, 1)
        finally:
            try:
                nvml.nvmlShutdown()
            except Exception:
                pass
    except Exception:
        return None
