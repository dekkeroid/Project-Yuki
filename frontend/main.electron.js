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

  // Explicitly reposition the window
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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
