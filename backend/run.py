import os
import sys
from pathlib import Path

if sys.stdout:
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr:
    sys.stderr.reconfigure(encoding='utf-8')

if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--yuki-run-script":
        import runpy
        os.environ.setdefault("PYTHONUNBUFFERED", "1")
        script = sys.argv[2]
        sys.argv = [script] + sys.argv[3:]
        runpy.run_path(script, run_name="__main__")
        raise SystemExit(0)

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
        # Prioritize loose 'app' directory if updated via Fast Update
        for candidate in [app_dir / "_internal" / "app", app_dir / "app"]:
            if (candidate / "main.py").exists() or (candidate / "main_setup.py").exists():
                parent_dir = str(candidate.parent)
                if parent_dir not in sys.path:
                    sys.path.insert(0, parent_dir)
                break
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
