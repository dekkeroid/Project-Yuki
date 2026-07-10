const { app, BrowserWindow, ipcMain, screen, globalShortcut, powerMonitor, Menu, Tray, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

const BACKEND_PORT = 58392;

// ---------- File Logging ----------
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, `yuki-${new Date().toISOString().slice(0, 10)}.log`);

function logToFile(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
}

// Override console to also write to log file
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;
console.log = (...args) => { _origLog(...args); logToFile('INFO', args.join(' ')); };
console.warn = (...args) => { _origWarn(...args); logToFile('WARN', args.join(' ')); };
console.error = (...args) => { _origError(...args); logToFile('ERROR', args.join(' ')); };

console.log(`[Electron] Log file: ${LOG_FILE}`);
console.log(`[Electron] Platform: ${process.platform}, arch: ${process.arch}, packaged: ${app.isPackaged}`);

// ---------- Chromium Performance & VRAM Optimization Switches ----------
// 1. Hard limit the Javascript V8 engine heap size to 512MB and expose V8 garbage collector
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512 --expose-gc');

// 2. Disable asset/network caching so temporary audio/data clips don't save to disk
app.commandLine.appendSwitch('disable-http-cache');

// 3. Set a strict ceiling on generic disk caching (104857600 Bytes = 100 MB)
app.commandLine.appendSwitch('disk-cache-size', '104857600');

// 4. Prevent fallback to CPU software rasterization (SwiftShader) by ignoring GPU blocklists
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// 5. Cap shader caches in system memory (in-memory cache limits)
app.commandLine.appendSwitch('gpu-program-cache-size-kb', '512');
app.commandLine.appendSwitch('gpu-disk-cache-size-kb', '2048');

// 6. Disable hardware audio/video decoders to avoid extra GPU buffer allocations
app.commandLine.appendSwitch('disable-accelerated-video-decode');
app.commandLine.appendSwitch('disable-accelerated-video-encode');

// 7. Prevent over-allocation of background rendering threads
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// ------------------------------------------------------------------------

// ---------- Single Instance Lock ----------
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Electron] Another instance is already running. Quitting.');
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Electron] Second instance detected — focusing existing window.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      showYuki();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.show();
      setupWindow.focus();
    }
  });
}
// ------------------------------------------

// Window Dimensions Configuration
const DEFAULT_WINDOW_WIDTH = 320;
const DEFAULT_WINDOW_HEIGHT = 605;
const windowWidthExtra = 120;

let currentWidth = DEFAULT_WINDOW_WIDTH;
let currentHeight = DEFAULT_WINDOW_HEIGHT;

let mainWindow = null;
let tray = null;
let yukiVisible = true;       // tracks our logical show/hide state
let alwaysOnTopEnabled = true;
let fullscreenPollTimer = null;

// ---------- Backend lifecycle ----------
let backendProcess = null;
let backendRetryCount = 0;
const BACKEND_MAX_RETRIES = 3;
const BACKEND_RETRY_DELAY_MS = 2000;
const BACKEND_UPTIME_RESET_MS = 30000;
let backendStartTime = 0;
let backendRestarting = false;
let backendStderrTail = [];

function sendBackendStatus(status, extra = {}) {
  const payload = { status, ...extra };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('backend-status', payload);
  }
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.webContents.send('backend-status', payload);
  }
}

function spawnBackend() {
  const { cmd, args, cwd } = getBackendExecutable();
  console.log(`[Electron] Spawning backend: ${cmd} ${args.join(' ')}`);

  backendStderrTail = [];
  backendProcess = spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    windowsHide: true,
  });

  backendProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[Backend] ${msg}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) {
      console.error(`[Backend] ${msg}`);
      backendStderrTail.push(msg);
      if (backendStderrTail.length > 30) backendStderrTail.shift();
    }
  });

  backendProcess.on('error', (err) => {
    console.error('[Electron] Backend spawn error:', err.message);
    backendProcess = null;
    sendBackendStatus('stopped', { error: err.message });
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Backend exited with code ${code} (signal: ${signal})`);
    const wasRunning = backendProcess !== null;
    backendProcess = null;

    if (!wasRunning || backendRestarting) return;

    const uptime = Date.now() - backendStartTime;
    if (code === 0 || uptime > BACKEND_UPTIME_RESET_MS) {
      console.log('[Electron] Backend exited gracefully or ran long enough — not retrying.');
      sendBackendStatus('stopped', { exitCode: code });
      return;
    }

    if (backendRetryCount < BACKEND_MAX_RETRIES) {
      backendRetryCount++;
      console.log(`[Electron] Backend crashed. Retrying in ${BACKEND_RETRY_DELAY_MS / 1000}s... (attempt ${backendRetryCount}/${BACKEND_MAX_RETRIES})`);
      sendBackendStatus('crashing', { exitCode: code, attempt: backendRetryCount, maxAttempts: BACKEND_MAX_RETRIES });
      setTimeout(() => {
        spawnBackend();
        waitForBackend(BACKEND_PORT).then((ok) => {
          if (ok) {
            backendStartTime = Date.now();
            sendBackendStatus('online');
          }
        });
      }, BACKEND_RETRY_DELAY_MS);
    } else {
      console.error(`[Electron] Backend crashed ${BACKEND_MAX_RETRIES} times — giving up.`);
      sendBackendStatus('stopped', { exitCode: code, retriesExhausted: true });
      showBackendCrashDialog(code);
    }
  });

  backendStartTime = Date.now();
  sendBackendStatus('starting');
}

function showBackendCrashDialog(exitCode) {
  const stderrSnippet = backendStderrTail.slice(-10).join('\n');
  const result = dialog.showMessageBoxSync({
    type: 'error',
    title: 'Yuki Backend Crashed',
    message: 'The backend process has crashed repeatedly and cannot start.',
    detail: `Exit code: ${exitCode}\n\nRecent errors:\n${stderrSnippet || '(no output captured)'}`,
    buttons: ['Restart Yuki', 'Quit', 'Ignore'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (result === 0) {
    isRestarting = true;
    app.relaunch();
    app.exit(0);
  } else if (result === 1) {
    app.quit();
  }
  // result === 2: ignore, continue with dead backend
}

async function isBackendRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      res.destroy();
      resolve(true);
    });
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => {
      resolve(false);
    });
  });
}

async function startBackend() {
  if (backendProcess) return true;

  // Check if backend is already running (e.g. manually started or dangling)
  const alreadyRunning = await isBackendRunning(BACKEND_PORT);
  if (alreadyRunning) {
    console.log(`[Electron] Backend is already running on port ${BACKEND_PORT}. Reusing existing instance.`);
    sendBackendStatus('online');
    return true;
  }

  backendRetryCount = 0;
  spawnBackend();
  return waitForBackend(BACKEND_PORT);
}

function stopBackend() {
  if (!backendProcess) return;
  backendRestarting = true;
  console.log('[Electron] Stopping backend...');
  try {
    backendProcess.kill('SIGTERM');
    setTimeout(() => {
      if (backendProcess) {
        console.log('[Electron] Force killing backend...');
        backendProcess.kill('SIGKILL');
        backendProcess = null;
      }
      backendRestarting = false;
    }, 3000);
  } catch (e) {
    console.warn('[Electron] Error stopping backend:', e.message);
    backendProcess = null;
    backendRestarting = false;
  }
}

// ---------- Vite port detection ----------

function findVitePort(ports, timeout = 500) {
  return new Promise((resolve) => {
    let checked = 0;
    for (const port of ports) {
      const req = http.get(`http://127.0.0.1:${port}`, () => {
        req.destroy();
        resolve(`http://127.0.0.1:${port}`);
      });
      req.setTimeout(timeout, () => {
        req.destroy();
        checked++;
        if (checked === ports.length) resolve(null);
      });
      req.on('error', () => {
        checked++;
        if (checked === ports.length) resolve(null);
      });
    }
  });
}

async function loadWithRetry(win, ports, maxAttempts = 40, intervalMs = 800) {
  // In packaged mode, skip Vite detection — load the bundled dist directly
  if (app.isPackaged) {
    console.log('[Electron] Packaged mode — loading bundled dist/index.html');
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
    return;
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = await findVitePort(ports);
    if (url) {
      console.log(`[Electron] Vite found at ${url} (attempt ${attempt})`);
      await win.loadURL(url);
      return;
    }
    console.log(`[Electron] Vite not ready, retrying... (${attempt}/${maxAttempts})`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.warn('[Electron] Falling back to dist/index.html');
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

// ---------- Visibility helpers ----------

function sendVisibility(visible) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('yuki-visibility', { visible });
}

function showYuki() {
  if (yukiVisible) return;
  yukiVisible = true;
  sendVisibility(true);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.restore();
    mainWindow.showInactive();
  }
}

function requestBackendMemoryOptimization() {
  const req = http.request({
    hostname: '127.0.0.1',
    port: BACKEND_PORT,
    path: '/api/system/optimize_memory',
    method: 'POST',
    headers: {
      'Content-Length': '0'
    }
  }, (res) => {
    res.on('data', () => {});
  });
  req.on('error', (e) => {
    console.warn('[Electron] Failed to call backend memory optimization:', e.message);
  });
  req.end();
}

function hideYuki() {
  if (!yukiVisible) return;
  yukiVisible = false;
  sendVisibility(false);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
    mainWindow.hide();
    // Flush caches and clear history dynamically to free memory when idle/hidden
    try {
      mainWindow.webContents.clearHistory();
      const { session } = require('electron');
      session.defaultSession.clearCache();
      
      // Request renderer process to optimize memory / GC
      mainWindow.webContents.send('yuki-optimize-memory');
    } catch (e) {
      console.warn("Failed cache wipe during hide:", e);
    }
  }

  // GC in Main process
  if (global.gc) {
    try {
      global.gc();
      console.log("[Electron] Main process GC invoked.");
    } catch (e) {
      console.warn("Failed main process GC:", e);
    }
  }

  // Request backend memory optimization
  requestBackendMemoryOptimization();
}

// ---------- Fullscreen detection ----------
// When any app goes fullscreen on Windows the taskbar auto-hides,
// making workArea == bounds. We use this as the signal.
function startFullscreenPoll() {
  fullscreenPollTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { workArea, bounds } = screen.getPrimaryDisplay();
    // Fullscreen: workArea height is within 2px of full display height
    const isFullscreen = bounds.height - workArea.height <= 2;
    if (isFullscreen && yukiVisible) {
      console.log('[Electron] Fullscreen detected — hiding Yuki gracefully.');
      hideYuki();
    } else if (!isFullscreen && !yukiVisible) {
      console.log('[Electron] Fullscreen ended — showing Yuki.');
      showYuki();
    }
  }, 2000);
}

// ---------- Window creation ----------

app.setName("Yuki AI")

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Yuki AI - Main",
    width: currentWidth + windowWidthExtra,
    height: currentHeight,
    minWidth: Math.round(DEFAULT_WINDOW_WIDTH * 0.4) + windowWidthExtra,
    minHeight: Math.round(DEFAULT_WINDOW_HEIGHT * 0.4),
    maxWidth: Math.round(DEFAULT_WINDOW_WIDTH * 3.0) + windowWidthExtra,
    maxHeight: Math.round(DEFAULT_WINDOW_HEIGHT * 3.0),
    center: true,
    transparent: true,
    frame: false,
    resizable: false,
    // Use 'screen-saver' so we CAN appear above fullscreen when needed
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: true,
      devTools: !app.isPackaged
    }
  });

  // Upgrade to screen-saver level so we can render above fullscreen apps
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Enforce strict size constraints on move and resize events
  const enforceSize = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    if (bounds.width !== currentWidth + windowWidthExtra || bounds.height !== currentHeight) {
      mainWindow.setSize(currentWidth + windowWidthExtra, currentHeight);
    }
  };
  mainWindow.on('move', enforceSize);
  mainWindow.on('resize', enforceSize);

  mainWindow.on('minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('yuki-optimize-memory');
    }
    if (global.gc) {
      try { global.gc(); } catch (_) {}
    }
    requestBackendMemoryOptimization();
  });

  // Debugging tools (can be opened if necessary during dev)
  // mainWindow.on('ready-to-show', () => {
  //   mainWindow.webContents.openDevTools({ mode: 'detach' });
  // })

  // Disable automatic DevTools opening in Electron
  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  loadWithRetry(mainWindow, [5173, 5174]);

  // ---------- IPC Handlers ----------

  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setIgnoreMouseEvents(ignore, options || {});
  });

  ipcMain.handle('get-screen-size', () => {
    return screen.getPrimaryDisplay().workArea;
  });

  ipcMain.handle('get-window-bounds', () => {
    return mainWindow ? mainWindow.getBounds() : { x: 0, y: 0, width: currentWidth + windowWidthExtra, height: currentHeight };
  });

  ipcMain.on('set-window-position', (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: currentWidth + windowWidthExtra,
        height: currentHeight
      });
    }
  });

  ipcMain.on('set-window-scale', (event, scale) => {
    const newWidth = Math.round(DEFAULT_WINDOW_WIDTH * scale);
    const newHeight = Math.round(DEFAULT_WINDOW_HEIGHT * scale);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const bounds = win.getBounds();

      // Keep bottom-center anchored (so Yuki stands on same spot on desktop when scaled)
      const anchorX = bounds.x + bounds.width / 2;
      const anchorY = bounds.y + bounds.height;

      const newX = Math.round(anchorX - (newWidth + windowWidthExtra) / 2);
      const newY = Math.round(anchorY - newHeight);

      currentWidth = newWidth;
      currentHeight = newHeight;

      win.setBounds({
        x: newX,
        y: newY,
        width: newWidth + windowWidthExtra,
        height: newHeight
      });
    }
  });

  ipcMain.on('set-always-on-top', (event, enabled) => {
    alwaysOnTopEnabled = Boolean(enabled);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (alwaysOnTopEnabled) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      } else {
        mainWindow.setAlwaysOnTop(false);
      }
      mainWindow.webContents.send('always-on-top-changed', { enabled: alwaysOnTopEnabled });
    }
  });

  ipcMain.handle('get-always-on-top-state', () => {
    return alwaysOnTopEnabled;
  });

  ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('maximize-window', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('restore-window', () => {
    if (mainWindow) mainWindow.restore();
  });

  // Manual show/hide from renderer (for future use)
  ipcMain.on('yuki-show', () => showYuki());
  ipcMain.on('yuki-hide', () => hideYuki());

  let hoverPollTimer = null;
  let lastHoverState = null;
  let lastCursorX = -1;
  let lastCursorY = -1;

  const startHoverPoll = () => {
    hoverPollTimer = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      const bounds = mainWindow.getBounds();
      const cursor = screen.getCursorScreenPoint();

      const isHovering = (
        cursor.x >= bounds.x &&
        cursor.x <= bounds.x + bounds.width &&
        cursor.y >= bounds.y &&
        cursor.y <= bounds.y + bounds.height
      );

      // Calculate screen space offsets relative to the center-top of the window (where head is)
      const dx = cursor.x - (bounds.x + bounds.width / 2);
      const dy = cursor.y - (bounds.y + bounds.height * 0.25);

      // Send coordinate update only if mouse moved or hover state changed
      if (cursor.x !== lastCursorX || cursor.y !== lastCursorY || lastHoverState !== isHovering) {
        lastCursorX = cursor.x;
        lastCursorY = cursor.y;

        mainWindow.webContents.send('yuki-cursor-move', {
          hovering: isHovering,
          dx: dx,
          dy: dy,
          x: cursor.x - bounds.x,
          y: cursor.y - bounds.y,
          width: bounds.width,
          height: bounds.height
        });
      }

      if (lastHoverState !== isHovering) {
        lastHoverState = isHovering;
        mainWindow.webContents.send('yuki-hover', { hovering: isHovering });
      }
    }, 40); // 40ms interval (25 FPS) for smooth mouse tracking inside Electron
  };

  startHoverPoll();

  let idlePollTimer = null;
  const startIdlePoll = () => {
    idlePollTimer = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const idleTime = powerMonitor.getSystemIdleTime();
        mainWindow.webContents.send('yuki-system-idle', { idleTime });
      } catch (e) {
        console.warn("Failed to get system idle time:", e);
      }
    }, 5000);
  };
  startIdlePoll();

  const onAC = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('yuki-power-state', { ac: true });
    }
  };
  const onBattery = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('yuki-power-state', { ac: false });
    }
  };

  powerMonitor.on('on-ac', onAC);
  powerMonitor.on('on-battery', onBattery);

  mainWindow.on('focus', () => {
    if (!alwaysOnTopEnabled && mainWindow && !mainWindow.isDestroyed()) {
      alwaysOnTopEnabled = true;
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.webContents.send('always-on-top-changed', { enabled: true });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (fullscreenPollTimer) clearInterval(fullscreenPollTimer);
    if (hoverPollTimer) clearInterval(hoverPollTimer);
    if (idlePollTimer) clearInterval(idlePollTimer);
    try {
      powerMonitor.removeListener('on-ac', onAC);
      powerMonitor.removeListener('on-battery', onBattery);
    } catch (_) { }
  });

  // Disabled baseline fullscreen poll to prevent auto-hide false positives
  // setTimeout(startFullscreenPoll, 3000);
}

// ---------- System Tray creation ----------

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, 'icon.png');
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Yuki',
      click: () => {
        showYuki();
      }
    },
    {
      label: 'Hide Yuki',
      click: () => {
        hideYuki();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Yuki Desktop Assistant');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (yukiVisible) {
      hideYuki();
    } else {
      showYuki();
    }
  });
}

function isSetupComplete() {
  if (app.isPackaged) {
    const backendDir = path.join(path.dirname(app.getPath('exe')), 'resources', 'backend');
    return fs.existsSync(path.join(backendDir, '.yuki-ready'));
  }
  return fs.existsSync(path.join(__dirname, '..', 'backend', '.yuki-ready'));
}

function getBackendExecutable() {
  if (app.isPackaged) {
    const backendDir = path.join(path.dirname(app.getPath('exe')), 'resources', 'backend');
    return { cmd: path.join(backendDir, 'backend.exe'), args: [], cwd: backendDir };
  }
  const backendDir = path.join(__dirname, '..', 'backend');
  return {
    cmd: path.join(backendDir, 'venv', 'Scripts', 'python.exe'),
    args: ['run.py'],
    cwd: backendDir,
  };
}

function waitForBackend(port, maxAttempts = 30, intervalMs = 1000) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.destroy();
        resolve(true);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (attempts < maxAttempts) {
          setTimeout(check, intervalMs);
        } else {
          resolve(false);
        }
      });
      req.on('error', () => {
        if (attempts < maxAttempts) {
          setTimeout(check, intervalMs);
        } else {
          resolve(false);
        }
      });
    };
    check();
  });
}

// ---------- Setup window ----------

let setupWindow = null;

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    title: 'Yuki AI — Setup',
    width: 520,
    height: 720,
    center: true,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    }
  });

  setupWindow.loadURL(`http://127.0.0.1:${BACKEND_PORT}/setup`);
  setupWindow.on('closed', () => { setupWindow = null; });
}

// ---------- Splash Window (shown during backend startup) ----------

function createSplashWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const splashWidth = 360;
  const splashHeight = 260;

  let splash = new BrowserWindow({
    width: splashWidth,
    height: splashHeight,
    x: Math.round((screenWidth - splashWidth) / 2),
    y: Math.round((screenHeight - splashHeight) / 2),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0612;
    display: flex; justify-content: center; align-items: center;
    height: 100vh; font-family: 'Segoe UI', system-ui, sans-serif;
    overflow: hidden; -webkit-app-region: drag;
    border-radius: 16px;
  }
  .container { text-align: center; -webkit-app-region: no-drag; }
  .logo {
    font-size: 32px; font-weight: 700;
    background: linear-gradient(135deg, #c084fc, #a855f7, #7c3aed);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    letter-spacing: 3px; margin-bottom: 24px;
  }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid rgba(168,85,247,0.15);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin: 0 auto 18px;
  }
  .spinner.hidden { display: none; }
  .status {
    font-size: 13px; color: rgba(255,255,255,0.4);
    letter-spacing: 0.5px;
  }
  .error-status { color: #f87171; }
  .hidden { display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="container">
    <div class="logo">YUKI</div>
    <div class="spinner" id="spinner"></div>
    <div class="status" id="status">Launching...</div>
    <div id="error-block" class="hidden">
      <div class="status error-status" id="error-msg">Backend failed to start.</div>
    </div>
  </div>
</body>
</html>`)}`);

  splash.on('closed', () => { splash = null; });
  return splash;
}

// ---------- App lifecycle ----------

// Global IPC handlers (registered once, work for both setup and main windows)
let isRestarting = false;

ipcMain.on('restart-app', () => {
  console.log('[Electron] Restart requested — relaunching...');
  isRestarting = true;
  app.relaunch();
  app.exit(0);
});

app.whenReady().then(async () => {
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'autoplay', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });

  const setupDone = isSetupComplete();
  console.log(`[Electron] Setup complete: ${setupDone}`);

  let splash = null;
  let splashTimer = null;

  if (app.isPackaged) {
    splash = createSplashWindow();

    // 35-second timeout — if backend hasn't started, show error state
    splashTimer = setTimeout(() => {
      if (splash && !splash.isDestroyed()) {
        console.warn('[Electron] Splash timeout — backend took too long to start.');
        splash.webContents.send('splash-error', 'Backend took too long to start. It may have crashed.');
      }
    }, 35000);
  }

  // Packaged: show splash, wait for backend, handle errors
  // Dev: fire-and-forget backend, open window immediately
  if (app.isPackaged) {
    const backendReady = await startBackend();
    if (splashTimer) clearTimeout(splashTimer);

    if (!backendReady) {
      console.error('[Electron] Backend failed to start within timeout.');
      if (splash && !splash.isDestroyed()) {
        splash.webContents.send('splash-error', 'Backend failed to respond. Check if port 58392 is available.');
        setTimeout(() => {
          if (splash && !splash.isDestroyed()) app.quit();
        }, 10000);
        return;
      }
    }

    if (splash && !splash.isDestroyed()) splash.close();
  } else {
    // Dev mode: open window immediately, defer backend start by 5 seconds
    // to prevent CPU/IO starvation and let Vite start its dev server smoothly.
    setTimeout(() => {
      startBackend();
    }, 5000);
  }

  if (!setupDone) {
    createSetupWindow();
  } else {
    createWindow();
  }

  createTray();

  globalShortcut.register('Alt+S', () => {
    console.log('[Electron] Alt+S — recalling Yuki.');
    showYuki();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('trigger-listening');
    }
  });

  app.on('activate', () => {
    if (!setupDone && setupWindow && !setupWindow.isDestroyed()) return;
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    createTray();
  });
});

app.on('before-quit', () => {
  stopBackend();
});

app.on('window-all-closed', () => {
  if (isRestarting) {
    console.log('[Electron] All windows closed during restart — skipping quit.');
    return;
  }
  console.log('[Electron] All windows closed — quitting.');
  // Clean session cleanup routine added here to clear active cache blocks on close
  const { session } = require('electron');
  try {
    session.defaultSession.clearCache();
    session.defaultSession.clearStorageData({
      storages: ['appcache', 'filesystem', 'shadercache']
    });
  } catch (e) {
    console.warn("Failed cache wipe during window close sequence:", e);
  }

  // Destroy tray so the app doesn't linger
  if (tray) {
    tray.destroy();
    tray = null;
  }

  if (process.platform !== 'darwin') app.quit();
});