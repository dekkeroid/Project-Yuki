"""
GPU Setup Script for Kokoro-ONNX TTS
=====================================
Detects the best available GPU and installs the correct onnxruntime package.

  NVIDIA GPU  ->  onnxruntime-gpu  (CUDA)
  AMD / Intel ->  onnxruntime-directml  (DirectML)
  No GPU      ->  onnxruntime  (CPU-only, lightweight)

Run this whenever your hardware changes:
  venv\\Scripts\\python.exe setup_gpu.py
"""

import subprocess
import sys
import importlib

# Force UTF-8 output so Unicode characters don't crash on non-UTF consoles
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PACKAGE_CPU    = "onnxruntime"
PACKAGE_DML    = "onnxruntime-directml"
PACKAGE_CUDA   = "onnxruntime-gpu[cuda,cudnn]"

# Map pip package name -> the module attribute that proves it's installed correctly
PACKAGE_MARKERS = {
    PACKAGE_CUDA:  "CUDAExecutionProvider",
    PACKAGE_DML:   "DmlExecutionProvider",
    PACKAGE_CPU:   "CPUExecutionProvider",
}


def run(cmd: list[str]) -> tuple[int, str]:
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode, (result.stdout + result.stderr).strip()


def detect_gpu() -> str:
    """
    Returns 'nvidia', 'amd', 'intel', or 'none'.
    Detection order: nvidia-smi -> wmic GPU name -> fallback none.
    """
    # 1. NVIDIA - nvidia-smi is the most reliable signal
    code, out = run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"])
    if code == 0 and out.strip():
        print(f"[GPU-Detect] NVIDIA GPU found: {out.strip().splitlines()[0]}")
        return "nvidia"

    # 2. AMD / Intel - check via wmic (Windows only)
    code, out = run(["wmic", "path", "win32_VideoController", "get", "Name"])
    if code == 0:
        for line in out.splitlines():
            line = line.strip().lower()
            if not line or line == "name":
                continue
            if "amd" in line or "radeon" in line:
                print(f"[GPU-Detect] AMD GPU found: {line}")
                return "amd"
            if "intel" in line and "graphics" in line:
                print(f"[GPU-Detect] Intel GPU found: {line}")
                return "intel"

    print("[GPU-Detect] No discrete GPU detected — will use CPU.")
    return "none"


def current_ort_package() -> str | None:
    """Return the currently installed onnxruntime pip package name, or None."""
    for pkg_spec in [PACKAGE_CUDA, PACKAGE_DML, PACKAGE_CPU]:
        pkg_name = pkg_spec.split("[")[0]
        code, _ = run([sys.executable, "-m", "pip", "show", pkg_name])
        if code == 0:
            if pkg_spec == PACKAGE_CUDA:
                # If target is CUDA, also verify that nvidia-cuda-runtime packages are installed.
                # If missing, we return None so it reinstalls with the extras.
                code_cu12, _ = run([sys.executable, "-m", "pip", "show", "nvidia-cuda-runtime-cu12"])
                code_cu13, _ = run([sys.executable, "-m", "pip", "show", "nvidia-cuda-runtime-cu13"])
                if code_cu12 != 0 and code_cu13 != 0:
                    return None
            return pkg_spec
    return None


def get_available_providers() -> list[str]:
    try:
        import onnxruntime as ort
        importlib.reload(ort)
        if hasattr(ort, "preload_dlls"):
            try:
                ort.preload_dlls()
            except Exception as e:
                print(f"[Setup] Warning preloading DLLs: {e}")
        return ort.get_available_providers()
    except Exception:
        return []


def install(package: str):
    print(f"[Setup] Installing {package}...")
    code, out = run([sys.executable, "-m", "pip", "install", package, "--upgrade", "-q"])
    if code != 0:
        print(f"[Setup] ERROR during install:\n{out}")
        sys.exit(1)
    print(f"[Setup] {package} installed successfully.")


def uninstall(package: str):
    print(f"[Setup] Removing {package}...")
    run([sys.executable, "-m", "pip", "uninstall", package, "-y"])


def main():
    print("=" * 60)
    print("  Kokoro-ONNX TTS - GPU Setup")
    print("=" * 60)

    gpu = detect_gpu()

    # Choose the target package based on GPU
    if gpu == "nvidia":
        target = PACKAGE_CUDA
        reason = "NVIDIA GPU detected - using CUDA"
    elif gpu in ("amd", "intel"):
        target = PACKAGE_DML
        reason = "AMD/Intel GPU detected - using DirectML"
    else:
        target = PACKAGE_CPU
        reason = "No GPU detected - using CPU-only"

    print(f"\n[Setup] Target package: {target}  ({reason})")

    current = current_ort_package()
    print(f"[Setup] Currently installed: {current or 'none'}")

    if current == target:
        print(f"[Setup] Already on the correct package. Nothing to do.")
    else:
        if current:
            uninstall(current)
        install(target)

    # Verify
    print("\n[Setup] Verifying ONNX Runtime providers...")
    providers = get_available_providers()
    print(f"[Setup] Available providers: {providers}")

    expected = PACKAGE_MARKERS[target]
    if expected in providers:
        print(f"[Setup] ✓ {expected} is active — setup complete!")
    else:
        print(f"[Setup] ✗ Expected {expected} but it's not in the provider list.")
        print("        This can happen if the GPU driver needs updating.")
        print(f"        ONNX Runtime will fall back to CPUExecutionProvider automatically.")

    print("\n[Setup] Done. Restart the backend for changes to take effect.")
    print("=" * 60)


if __name__ == "__main__":
    main()
