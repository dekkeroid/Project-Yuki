import os
import sys
from pathlib import Path

# Disable global Python user site-packages to prevent version clashes with bundled GPU packages
os.environ["PYTHONNOUSERSITE"] = "1"
sys.path = [p for p in sys.path if "appdata\\roaming\\python" not in p.lower()]

if sys.stdout:
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr:
    sys.stderr.reconfigure(encoding='utf-8')

if getattr(sys, "frozen", False):
    import importlib.abc
    import importlib.util

    class LooseAppFinder(importlib.abc.MetaPathFinder):
        """
        Prioritizes loose .py and .pyd files/packages in resources/backend/_internal,
        resources/backend, or local dev venv site-packages over frozen PYZ bytecode.
        Enables instant ~0.5s Fast Sync updates for both app code and new pip packages.
        """
        def __init__(self, search_paths):
            self.search_paths = [Path(p).resolve() for p in search_paths if Path(p).exists()]

        def find_spec(self, fullname, path=None, target=None):
            parts = fullname.split(".")
            for base in self.search_paths:
                # Package directory
                dir_candidate = base.joinpath(*parts)
                if dir_candidate.is_dir():
                    init_py = dir_candidate / "__init__.py"
                    if init_py.is_file():
                        return importlib.util.spec_from_file_location(
                            fullname,
                            str(init_py),
                            submodule_search_locations=[str(dir_candidate)]
                        )
                    init_pyd = dir_candidate / "__init__.pyd"
                    if init_pyd.is_file():
                        return importlib.util.spec_from_file_location(
                            fullname,
                            str(init_pyd),
                            submodule_search_locations=[str(dir_candidate)]
                        )
                    for tagged in dir_candidate.glob("__init__.*.pyd"):
                        return importlib.util.spec_from_file_location(
                            fullname,
                            str(tagged),
                            submodule_search_locations=[str(dir_candidate)]
                        )

                # Single module (.py or .pyd)
                parent_dir = base.joinpath(*parts[:-1]) if len(parts) > 1 else base
                if parent_dir.is_dir():
                    py_file = parent_dir / f"{parts[-1]}.py"
                    if py_file.is_file():
                        return importlib.util.spec_from_file_location(fullname, str(py_file))
                    pyd_file = parent_dir / f"{parts[-1]}.pyd"
                    if pyd_file.is_file():
                        return importlib.util.spec_from_file_location(fullname, str(pyd_file))
                    for tagged in parent_dir.glob(f"{parts[-1]}.*.pyd"):
                        return importlib.util.spec_from_file_location(fullname, str(tagged))

            return None

    _app_base_dir = Path(sys.executable).parent
    _internal_dir = _app_base_dir / "_internal"
    _appdata = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
    _user_pkg_dir = _appdata / "Yuki AI" / "packages"

    try:
        _user_pkg_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    # Priority order:
    # 1. Loose app code (for instant Fast Sync updates)
    # 2. Bundled GPU packages in _internal (onnxruntime-gpu, ctranslate2, torch, etc.)
    # 3. Yuki's isolated packages in APPDATA/Yuki AI/packages
    _loose_search_dirs = [
        _app_base_dir / "app",
        _internal_dir / "app",
        _internal_dir,
        _app_base_dir,
        _user_pkg_dir,
    ]

    # Optional local development venv fallback
    if "YUKI_DEV_SITE_PACKAGES" in os.environ:
        _dev_sp = Path(os.environ["YUKI_DEV_SITE_PACKAGES"])
        if _dev_sp.is_dir():
            _loose_search_dirs.append(_dev_sp)

    # Append Yuki package dir to sys.path
    if _user_pkg_dir.is_dir() and str(_user_pkg_dir) not in sys.path:
        sys.path.append(str(_user_pkg_dir))

    # Register bundled NVIDIA CUDA & cuDNN DLL directories early
    _nvidia_base = _internal_dir / "nvidia"
    if _nvidia_base.is_dir():
        for _bin in _nvidia_base.rglob("bin"):
            if _bin.is_dir():
                try:
                    os.add_dll_directory(str(_bin))
                    os.environ["PATH"] = str(_bin) + os.pathsep + os.environ.get("PATH", "")
                except Exception:
                    pass

    # Register all other DLL directories in loose search dirs
    for _sp in _loose_search_dirs:
        if _sp.is_dir():
            try:
                os.add_dll_directory(str(_sp))
            except Exception:
                pass
            try:
                for _sub in _sp.iterdir():
                    if _sub.is_dir() and any(_sub.glob("*.dll")):
                        try:
                            os.add_dll_directory(str(_sub))
                        except Exception:
                            pass
            except Exception:
                pass

    sys.meta_path.insert(0, LooseAppFinder(_loose_search_dirs))

if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--yuki-run-script":
        import runpy
        os.environ.setdefault("PYTHONUNBUFFERED", "1")
        script = sys.argv[2]
        sys.argv = [script] + sys.argv[3:]
        runpy.run_path(script, run_name="__main__")
        raise SystemExit(0)

    if len(sys.argv) >= 2 and sys.argv[1] == "-m":
        import subprocess, shutil, runpy
        mod = sys.argv[2] if len(sys.argv) > 2 else ""

        if mod == "pip" and getattr(sys, "frozen", False):
            # When running frozen pip install, automatically target the user packages dir if not specified
            _user_pkg_dir = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))) / "Yuki AI" / "packages"
            _user_pkg_dir.mkdir(parents=True, exist_ok=True)
            if len(sys.argv) >= 4 and sys.argv[3] == "install" and "--target" not in sys.argv and "-t" not in sys.argv:
                sys.argv.extend(["--target", str(_user_pkg_dir)])

            try:
                sys.argv = [mod] + sys.argv[3:]
                runpy.run_module("pip", run_name="__main__", alter_sys=True)
                raise SystemExit(0)
            except Exception as e:
                print(f"Error running pip: {e}", file=sys.stderr)
                raise SystemExit(1)
        else:
            py_cmd = shutil.which("python") or shutil.which("py")
            if py_cmd and "windowsapps" not in py_cmd.lower() and os.path.abspath(py_cmd).lower() != os.path.abspath(sys.executable).lower():
                res = subprocess.run([py_cmd] + sys.argv[1:])
                raise SystemExit(res.returncode)
            else:
                try:
                    sys.argv = [mod] + sys.argv[3:]
                    runpy.run_module(mod, run_name="__main__", alter_sys=True)
                    raise SystemExit(0)
                except Exception as e:
                    print(f"Error executing module -m {mod}: {e}", file=sys.stderr)
                    raise SystemExit(1)

    if getattr(sys, "frozen", False) and len(sys.argv) > 1 and sys.argv[1].startswith("-"):
        print(f"Error: Packaged executable does not support arbitrary Python CLI flag '{sys.argv[1]}'.", file=sys.stderr)
        raise SystemExit(1)

    import uvicorn

    print("Launching Yuki Desktop Assistant Backend...")
    is_dev = not getattr(sys, 'frozen', False)
    default_reload = "1" if is_dev else "0"
    reload = os.environ.get("YUKI_DEV_RELOAD", default_reload) == "1"
    host = os.environ.get("YUKI_HOST", "127.0.0.1")
    port = int(os.environ.get("YUKI_PORT", "58392"))

    # Determine setup vs full mode
    if getattr(sys, 'frozen', False):
        app_dir = Path(sys.executable).parent
    else:
        app_dir = Path(__file__).resolve().parent

    ready_marker = app_dir / ".yuki-ready"
    module = "app.main" if ready_marker.exists() else "app.main_setup"

    if getattr(sys, 'frozen', False):
        if module == "app.main":
            from app.main import app
        else:
            from app.main_setup import app
        uvicorn.run(app, host=host, port=port, reload=False,
                    ws_ping_interval=30, ws_ping_timeout=10)
    else:
        uvicorn.run(f"{module}:app", host=host, port=port, reload=reload,
                    reload_dirs=["app"] if reload else None,
                    reload_includes=["*.py"] if reload else None,
                    ws_ping_interval=30, ws_ping_timeout=10)
