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
  html, body {
    background:#121220;
    width:100vw;
    height:100vh;
    overflow:hidden;
    font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    user-select:none;
    margin:0;
    padding:0;
    position:relative;
  }
  .canvas-top-bar {
    position:fixed;
    top:0;
    left:0;
    right:0;
    height:38px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:0 10px;
    background:rgba(18, 18, 32, 0.88);
    backdrop-filter:blur(12px);
    border-bottom:1px solid rgba(255, 255, 255, 0.08);
    z-index:9999;
    -webkit-app-region:drag;
  }
  .canvas-brand {
    display:flex;
    align-items:center;
    gap:8px;
    font-size:12px;
    font-weight:600;
    color:rgba(255, 255, 255, 0.75);
    letter-spacing:0.4px;
    pointer-events:none;
  }
  .canvas-brand-icon {
    color:#ec4899;
    font-size:13px;
  }
  .canvas-drag-grip {
    color:rgba(56, 189, 248, 0.75);
    font-size:14px;
    margin-right:2px;
  }
  .canvas-controls {
    display:flex;
    gap:5px;
    align-items:center;
    -webkit-app-region:no-drag;
  }
  .canvas-btn {
    width:26px;
    height:26px;
    border-radius:6px;
    border:none;
    cursor:pointer;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:13px;
    font-weight:bold;
    color:#ccc;
    background:rgba(255, 255, 255, 0.07);
    transition:all 0.15s ease;
    -webkit-app-region:no-drag;
  }
  .canvas-btn:hover {
    background:rgba(255, 255, 255, 0.16);
    color:#fff;
    transform:translateY(-1px);
  }
  .canvas-btn.close:hover {
    background:rgba(239, 68, 68, 0.85);
    color:#fff;
  }
  #zoom-label {
    font-size:11px;
    color:rgba(255, 255, 255, 0.75);
    background:rgba(0, 0, 0, 0.4);
    padding:2px 8px;
    border-radius:6px;
    pointer-events:none;
    min-width:44px;
    text-align:center;
    font-weight:600;
  }
  #viewport-wrapper {
    width:100%;
    height:calc(100% - 38px);
    margin-top:38px;
    display:flex;
    align-items:center;
    justify-content:center;
    cursor:grab;
    position:absolute;
    top:0;
    left:0;
  }
  #viewport-wrapper:active {
    cursor:grabbing;
  }
  #zoom-container {
    transform-origin:center center;
    transition:transform 0.05s ease-out;
    display:inline-block;
  }
  .drag-hint {
    position:fixed;
    bottom:8px;
    left:50%;
    transform:translateX(-50%);
    font-size:10px;
    color:rgba(255, 255, 255, 0.35);
    pointer-events:none;
    opacity:0;
    transition:opacity 0.3s;
    background:rgba(0, 0, 0, 0.5);
    padding:3px 12px;
    border-radius:10px;
    backdrop-filter:blur(6px);
  }
  body:hover .drag-hint { opacity:1; }
</style>
</head>
<body>
<div class="canvas-top-bar">
  <div class="canvas-brand">
    <span class="canvas-drag-grip">⠿</span>
    <span class="canvas-brand-icon">✦</span>
    <span>Yuki Canvas</span>
  </div>
  <div class="canvas-controls">
    <button class="canvas-btn" onclick="zoomOut()" title="Zoom Out (− or Ctrl+Scroll)">−</button>
    <span id="zoom-label">100%</span>
    <button class="canvas-btn" onclick="zoomIn()" title="Zoom In (+ or Ctrl+Scroll)">+</button>
    <button class="canvas-btn" onclick="resetZoom()" title="Reset Zoom">⊙</button>
    <button class="canvas-btn" onclick="window.electronAPI?.saveCanvasContent({filename:'__FILENAME__'})" title="Save PNG/SVG">&#8681;</button>
    <button class="canvas-btn" onclick="window.electronAPI?.minimizeCanvasWindow()" title="Minimize">&#x2013;</button>
    <button class="canvas-btn close" onclick="window.electronAPI?.closeCanvasWindow()" title="Close">&#x2715;</button>
  </div>
</div>
<div id="viewport-wrapper">
  <div id="zoom-container">
    __CANVAS_CONTENT__
  </div>
</div>
<div class="drag-hint">Drag top bar to move window • Drag canvas to pan • Ctrl+Scroll to zoom</div>
<script>
  // ── Zoom & Pan State ──
  let currentZoom = 1.0;
  let panX = 0;
  let panY = 0;
  const ZOOM_STEP = 0.15;
  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 8.0;

  const container = document.getElementById('zoom-container');
  const wrapper = document.getElementById('viewport-wrapper');
  const label = document.getElementById('zoom-label');

  function applyTransform() {
    container.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
    label.textContent = Math.round(currentZoom * 100) + '%';
  }

  function zoomIn()  { currentZoom = Math.min(ZOOM_MAX, currentZoom + ZOOM_STEP); applyTransform(); }
  function zoomOut() { currentZoom = Math.max(ZOOM_MIN, currentZoom - ZOOM_STEP); applyTransform(); }
  function resetZoom() { currentZoom = 1.0; panX = 0; panY = 0; applyTransform(); }

  // Keyboard shortcut controls: + / - / 0
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') { zoomIn(); }
    else if (e.key === '-' || e.key === '_') { zoomOut(); }
    else if (e.key === '0' || e.key === 'r') { resetZoom(); }
  });

  // Ctrl + MouseWheel zoom scaling
  document.addEventListener('wheel', function(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn(); else zoomOut();
    }
  }, { passive: false });

  // ── Drag-to-Move Panning & Window Drag ──
  let isPanning = false;
  let startX = 0, startY = 0;
  let lastWindowX = 0, lastWindowY = 0;

  wrapper.addEventListener('mousedown', function(e) {
    if (e.target.closest('.canvas-top-bar') || e.target.closest('button, a, input, select, textarea')) return;
    if (e.button !== 0 && e.button !== 1) return;
    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    lastWindowX = e.screenX;
    lastWindowY = e.screenY;
  });

  document.addEventListener('mousemove', function(e) {
    if (!isPanning) return;
    const dx = e.screenX - lastWindowX;
    const dy = e.screenY - lastWindowY;
    lastWindowX = e.screenX;
    lastWindowY = e.screenY;

    // Alt or Middle Click drags the whole OS window anywhere
    if ((e.altKey || e.buttons === 4) && window.electronAPI && window.electronAPI.dragWindowBy) {
      window.electronAPI.dragWindowBy(dx, dy);
    } else {
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    }
  });

  document.addEventListener('mouseup', function() {
    isPanning = false;
  });
</script>
</body>
</html>"""

    if content.lower().lstrip().startswith("<!doctype") or content.lower().lstrip().startswith("<html"):
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
