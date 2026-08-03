"""Canvas tools for rendering SVG/Canvas graphics and full HTML pages in popup windows."""

import os
import time
import uuid
import asyncio
import logging
from pathlib import Path
from typing import Optional, Any

logger = logging.getLogger(__name__)

_broadcast_callback = None
_main_loop: Optional[Any] = None


def set_broadcast_callback(cb):
    """Register the broadcast_ws callback (called from main.py at startup)."""
    global _broadcast_callback
    _broadcast_callback = cb


def set_main_loop(loop):
    """Register the running event loop (called from main.py at startup)."""
    global _main_loop
    _main_loop = loop


def _get_canvas_dir() -> Path:
    """Get the canvas directory under yuki_attachment."""
    from app.config import BASE_DIR
    canvas_dir = Path(BASE_DIR) / "yuki_attachment" / "canvas"
    canvas_dir.mkdir(parents=True, exist_ok=True)
    return canvas_dir


def _broadcast_canvas_ws(payload: dict):
    """Send a WebSocket broadcast from a sync tool thread."""
    if _broadcast_callback and _main_loop and _main_loop.is_running():
        try:
            future = asyncio.run_coroutine_threadsafe(_broadcast_callback(payload), _main_loop)
            logger.info("[Canvas] Broadcast scheduled: type=%s filename=%s", payload.get("type"), payload.get("filename"))
        except Exception as e:
            logger.error("[Canvas] Failed to schedule broadcast: %s", e)
    else:
        logger.warning("[Canvas] Cannot broadcast — callback=%s, loop=%s, running=%s",
                       _broadcast_callback is not None,
                       _main_loop is not None,
                       _main_loop.is_running() if _main_loop else False)


def jarvis_html_graphics(svg_or_canvas: str) -> str:
    """Render raw SVG or Canvas content in a borderless floating graphics window.

    Args:
        svg_or_canvas: Raw SVG markup (<svg>...</svg>) or a <canvas> element with
                       inline <script> that draws to it. Must be self-contained
                       (no external CSS/JS imports). Do NOT wrap in <html>/<body>.

    Returns:
        Confirmation message with the filename.
    """
    canvas_dir = _get_canvas_dir()
    filename = f"graphics_{int(time.time())}_{uuid.uuid4().hex[:6]}.html"
    file_path = canvas_dir / filename

    content = svg_or_canvas.strip()
    is_svg = content.lower().lstrip().startswith("<svg")

    _GRAPHICS_SHELL = """<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background:#f0f0f0; display:flex; align-items:center; justify-content:center; min-height:100vh; overflow:auto; font-family:system-ui,sans-serif; }
  .canvas-overlay { position:fixed; top:8px; right:8px; display:flex; gap:6px; z-index:9999; opacity:0; transition:opacity 0.2s; }
  body:hover .canvas-overlay { opacity:1; }
  .canvas-btn { width:28px; height:28px; border-radius:50%; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; color:#555; background:rgba(255,255,255,0.85); box-shadow:0 1px 4px rgba(0,0,0,0.15); backdrop-filter:blur(4px); transition:background 0.15s; }
  .canvas-btn:hover { background:rgba(240,240,240,1); }
  .canvas-btn.close:hover { background:rgba(220,80,80,0.9); color:#fff; }
</style>
</head>
<body>
<div class="canvas-overlay">
  <button class="canvas-btn" onclick="window.electronAPI?.saveCanvasContent({filename:'__FILENAME__'})" title="Save">&#8681;</button>
  <button class="canvas-btn" onclick="window.electronAPI?.minimizeCanvasWindow()" title="Minimize">&#x2013;</button>
  <button class="canvas-btn close" onclick="window.electronAPI?.closeCanvasWindow()" title="Close">&#x2715;</button>
</div>
__CANVAS_CONTENT__
</body>
</html>"""

    # Detect canvas tag — if present, treat as canvas content
    if not is_svg and "<canvas" in content.lower():
        canvas_html = content
    else:
        canvas_html = _GRAPHICS_SHELL.replace("__CANVAS_CONTENT__", content).replace("__FILENAME__", filename)

    file_path.write_text(canvas_html, encoding="utf-8")
    _broadcast_canvas_ws({"type": "open-canvas", "mode": "graphics", "filename": filename})
    return f"Opened graphics window for {filename}"


def jarvis_html_viewer(html_content: str = "", file_path: str = "") -> str:
    """Render a full HTML document in a standard Electron window (with title bar).

    Args:
        html_content: Complete HTML document including <!DOCTYPE html>, <html>, <head>,
                      and <body>. All CSS and JS must be inline (no external resources).
                      Required when not using file_path.
        file_path: Absolute path to an existing .html file to open. The file is served
                   from its original location so relative paths (CSS, JS, images) work.
                   Mutually exclusive with html_content.

    Returns:
        Confirmation message with the filename or path served.
    """
    from app.config import BASE_DIR

    # Case 1: serve an existing HTML file from its original location
    if file_path:
        import os
        clean = os.path.normpath(file_path.strip().strip('"\''))
        if not os.path.isfile(clean):
            return f"Error: File not found: {clean}"
        if not clean.lower().endswith((".html", ".htm")):
            return f"Error: Only .html/.htm files are supported: {clean}"
        import urllib.parse
        encoded = urllib.parse.quote(clean.replace("\\", "/"), safe="/:")
        serve_url = f"serve-file?path={encoded}"
        _broadcast_canvas_ws({"type": "open-canvas", "mode": "viewer", "filename": serve_url})
        return f"Opened HTML viewer for {os.path.basename(clean)}"

    # Case 2: save raw HTML content and serve it
    if not html_content or not html_content.strip():
        return "Error: Either html_content or file_path must be provided."

    canvas_dir = _get_canvas_dir()
    filename = f"viewer_{int(time.time())}_{uuid.uuid4().hex[:6]}.html"
    file_path_saved = canvas_dir / filename

    content = html_content.strip()
    if not content.lower().lstrip().startswith("<!doctype"):
        content = f"<!DOCTYPE html>\n{content}"

    file_path_saved.write_text(content, encoding="utf-8")
    _broadcast_canvas_ws({"type": "open-canvas", "mode": "viewer", "filename": filename})
    return f"Opened HTML viewer for {filename}"
