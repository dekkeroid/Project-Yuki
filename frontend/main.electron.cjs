const { app, BrowserWindow, ipcMain, screen, globalShortcut, powerMonitor, Menu, Tray } = require('electron');
const path = require('path');
const http = require('http');

// ---------- Chromium Performance & VRAM Optimization Switches ----------
// 1. Hard limit the Javascript V8 engine heap size to 1.2GB to stop virtual memory bloating
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1200');

// 2. Disable asset/network caching so temporary audio/data clips don't save to disk
app.commandLine.appendSwitch('disable-http-cache');

// 3. Set a strict ceiling on generic disk caching (104857600 Bytes = 100 MB)
app.commandLine.appendSwitch('disk-cache-size', '104857600');

// 4. Force the 3D renderer to compile shaders directly in VRAM instead of creating massive cache files on C:
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// 5. Prevent over-allocation of background rendering threads
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// ------------------------------------------------------------------------

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

// ---------- Vite port detection ----------

function findVitePort(ports, timeout = 500) {
  return new Promise((resolve) => {
    let checked = 0;
    for (const port of ports) {
      const req = http.get(`http://localhost:${port}`, () => {
        req.destroy();
        resolve(`http://localhost:${port}`);
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

async function loadWithRetry(win, ports, maxAttempts = 10, intervalMs = 800) {
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
    mainWindow.showInactive();
  }
}

function hideYuki() {
  if (!yukiVisible) return;
  yukiVisible = false;
  sendVisibility(false);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
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
      autoplayPolicy: 'no-user-gesture-required'
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

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Global recall shortcut — works even when another app is fullscreen
  globalShortcut.register('CommandOrControl+Shift+Y', () => {
    console.log('[Electron] Ctrl+Shift+Y — toggling Yuki visibility.');
    if (yukiVisible) {
      hideYuki();
    } else {
      showYuki();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    createTray();
  });
});

app.on('window-all-closed', () => {
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

  if (process.platform !== 'darwin') app.quit();
});