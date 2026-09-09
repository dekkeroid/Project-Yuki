const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// Window Dimensions Configuration
const WINDOW_WIDTH = 320;
const WINDOW_HEIGHT = 605;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_WIDTH,
    minHeight: WINDOW_HEIGHT,
    maxWidth: WINDOW_WIDTH,
    maxHeight: WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load from Vite dev server during development, or fall back to dist index.html
  const startUrl = process.env.ELECTRON_DEV_URL || 'http://localhost:5178';

  if (startUrl.startsWith('http')) {
    mainWindow.loadURL(startUrl).catch((err) => {
      console.warn("Vite dev server not ready, loading built files instead:", err);
      mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  // Enforce strict size constraints on move and resize events
  const enforceSize = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    if (bounds.width !== WINDOW_WIDTH || bounds.height !== WINDOW_HEIGHT) {
      mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT);
    }
  };
  mainWindow.on('move', enforceSize);
  mainWindow.on('resize', enforceSize);

  // Debugging tools (can be opened if necessary during dev)
  // mainWindow.on('ready-to-show', () => {
  //   mainWindow.webContents.openDevTools({ mode: 'detach' });
  // })
  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC Handlers — registered once at module level, not inside createWindow(),
// so they never accumulate duplicate listeners on macOS re-activation.
// ---------------------------------------------------------------------------

// Handle click-through toggle
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setIgnoreMouseEvents(ignore, options);
  }
});

// Get screen bounds (adjusted for taskbar / workArea)
ipcMain.handle('get-screen-size', () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height, x, y } = primaryDisplay.workArea;
  return { width, height, x, y };
});

// Get current window bounds
ipcMain.handle('get-window-bounds', () => {
  if (mainWindow) {
    return mainWindow.getBounds();
  }
  return { x: 0, y: 0, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
});

// Explicitly reposition the window (used during drag)
ipcMain.on('set-window-position', (event, { x, y }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT
    });
  }
});

// Center window on primary display work area.
// Uses setPosition() + hardcoded constants so DPI-scaled getBounds() values
// never corrupt the math, and to avoid triggering the enforceSize re-entrancy
// that setBounds() causes (setBounds fires move+resize -> enforceSize -> setSize).
ipcMain.on('center-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height, x, y } = screen.getPrimaryDisplay().workArea;
  const centerX = Math.round(x + (width - WINDOW_WIDTH) / 2);
  const centerY = Math.round(y + (height - WINDOW_HEIGHT) / 2);
  mainWindow.setPosition(centerX, centerY);
});

// ---------------------------------------------------------------------------

// Disable GPU acceleration if transparency issues occur (especially on virtual machines)
// app.disableHardwareAcceleration();

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
