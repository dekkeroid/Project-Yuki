const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  setWindowScale: (scale) => {
    return ipcRenderer.invoke('set-window-scale', Number(scale));
  },
  onAvatarScaleChanged: (callback) => {
    const handler = (event, scale) => callback(scale);
    ipcRenderer.on('yuki-avatar-scale-changed', handler);
    return () => ipcRenderer.removeListener('yuki-avatar-scale-changed', handler);
  },
  getScreenSize: () => {
    return ipcRenderer.invoke('get-screen-size');
  },
  getWindowBounds: () => {
    return ipcRenderer.invoke('get-window-bounds');
  },
  selectDirectory: () => {
    return ipcRenderer.invoke('select-directory');
  },
  setWindowPosition: (x, y) => {
    ipcRenderer.send('set-window-position', { x, y });
  },
  minimizeWindow: () => {
    ipcRenderer.send('minimize-window');
  },
  maximizeWindow: () => {
    ipcRenderer.send('maximize-window');
  },
  restoreWindow: () => {
    ipcRenderer.send('restore-window');
  },
  yukiShow: () => {
    ipcRenderer.send('yuki-show');
  },
  yukiHide: () => {
    ipcRenderer.send('yuki-hide');
  },
  onHoverChange: (callback) => {
    const handler = (event, data) => callback(data.hovering);
    ipcRenderer.on('yuki-hover', handler);
    return () => {
      ipcRenderer.removeListener('yuki-hover', handler);
    };
  },
  onCursorMove: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('yuki-cursor-move', handler);
    return () => {
      ipcRenderer.removeListener('yuki-cursor-move', handler);
    };
  },
  onPowerStateChange: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('yuki-power-state', handler);
    return () => {
      ipcRenderer.removeListener('yuki-power-state', handler);
    };
  },
  onSystemIdleChange: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('yuki-system-idle', handler);
    return () => {
      ipcRenderer.removeListener('yuki-system-idle', handler);
    };
  },
  setAlwaysOnTop: (enabled) => {
    ipcRenderer.send('set-always-on-top', Boolean(enabled));
  },
  getAlwaysOnTopState: () => {
    return ipcRenderer.invoke('get-always-on-top-state');
  },
  onAlwaysOnTopChanged: (callback) => {
    const handler = (event, data) => callback(data.enabled);
    ipcRenderer.on('always-on-top-changed', handler);
    return () => {
      ipcRenderer.removeListener('always-on-top-changed', handler);
    };
  },
  onTriggerListening: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-listening', handler);
    return () => {
      ipcRenderer.removeListener('trigger-listening', handler);
    };
  },
  restartApp: () => {
    ipcRenderer.send('restart-app');
  },
  updateGlobalShortcut: (shortcut) => {
    ipcRenderer.send('update-global-shortcut', shortcut);
  },
  onBackendStatus: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('backend-status', handler);
    return () => {
      ipcRenderer.removeListener('backend-status', handler);
    };
  },
  onVisibilityChange: (callback) => {
    const handler = (event, data) => callback(data.visible);
    ipcRenderer.on('yuki-visibility', handler);
    return () => {
      ipcRenderer.removeListener('yuki-visibility', handler);
    };
  },
  onOptimizeMemory: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('yuki-optimize-memory', handler);
    return () => {
      ipcRenderer.removeListener('yuki-optimize-memory', handler);
    };
  },
  openSettingsWindow: () => {
    ipcRenderer.send('open-settings-window');
  },
  openPath: (targetPath) => {
    return ipcRenderer.invoke('open-path', targetPath);
  },
  openExternalUrl: (url) => {
    return ipcRenderer.invoke('open-external-url', url);
  },
  openChatWindow: (payload) => {
    ipcRenderer.send('open-chat-window', payload);
  },
  onOpenFile: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('yuki:open-file', handler);
    return () => ipcRenderer.removeListener('yuki:open-file', handler);
  },
  onOpenFolder: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('yuki:open-folder', handler);
    return () => ipcRenderer.removeListener('yuki:open-folder', handler);
  },
  openAlarmWindow: (alarmData) => {
    ipcRenderer.send('open-alarm-window', alarmData);
  },
  closeAlarmWindow: (id) => {
    ipcRenderer.send('close-alarm-window', id !== undefined ? { id } : {});
  },
  openStopwatchWindow: (data) => {
    ipcRenderer.send('open-stopwatch-window', data);
  },
  closeStopwatchWindow: (label) => {
    ipcRenderer.send('close-stopwatch-window', label ? { label } : {});
  },
  minimizeStopwatchWindow: (label) => {
    ipcRenderer.send('minimize-stopwatch-window', label ? { label } : {});
  },
  setOpenAtLogin: (enabled) => {
    ipcRenderer.send('set-open-at-login', Boolean(enabled));
  },
  getOpenAtLogin: () => {
    return ipcRenderer.invoke('get-open-at-login');
  },
  setSkinToneColor: (color) => {
    ipcRenderer.send('set-skintone-color', color);
  },
  onSkinToneColorChanged: (callback) => {
    const listener = (event, color) => callback(color);
    ipcRenderer.on('yuki-skintone-changed', listener);
    return () => ipcRenderer.removeListener('yuki-skintone-changed', listener);
  },
  setCameraTracking: (enabled) => {
    ipcRenderer.send('set-camera-tracking', Boolean(enabled));
  },
  onCameraTrackingChanged: (callback) => {
    const listener = (event, enabled) => callback(enabled);
    ipcRenderer.on('yuki-camera-tracking-changed', listener);
    return () => ipcRenderer.removeListener('yuki-camera-tracking-changed', listener);
  },
  setVoiceSettings: (data) => {
    ipcRenderer.send('set-voice-settings', data);
  },
  onVoiceSettingsChanged: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('yuki-voice-settings-changed', listener);
    return () => ipcRenderer.removeListener('yuki-voice-settings-changed', listener);
  },
  sendLog: (msg) => {
    ipcRenderer.send('yuki-renderer-log', msg);
  },
  openExternalUrl: (url) => {
    return ipcRenderer.invoke('open-external-url', url);
  },
  // Canvas windows (graphics viewer & HTML viewer)
  openCanvasWindow: (data) => {
    ipcRenderer.send('open-canvas-window', data);
  },
  minimizeCanvasWindow: () => {
    ipcRenderer.send('minimize-canvas-window');
  },
  maximizeCanvasWindow: () => {
    ipcRenderer.send('toggle-maximize-canvas-window');
  },
  closeCanvasWindow: () => {
    ipcRenderer.send('close-canvas-window');
  },
  saveCanvasContent: (data) => {
    return ipcRenderer.invoke('save-canvas-content', data);
  },
  dragWindowBy: (dx, dy) => {
    ipcRenderer.send('drag-canvas-window-by', { dx, dy });
  },
  triggerCustomAnimation: (animName) => {
    ipcRenderer.send('yuki-trigger-animation', animName);
  },
  onTriggerCustomAnimation: (callback) => {
    const listener = (event, animName) => callback(animName);
    ipcRenderer.on('yuki-trigger-animation', listener);
    return () => ipcRenderer.removeListener('yuki-trigger-animation', listener);
  },
  // Dedicated Date Mode Window
  openDateWindow: () => {
    ipcRenderer.send('open-date-window');
  },
  closeDateWindow: () => {
    ipcRenderer.send('close-date-window');
  },
  setDateWindowTitle: (title) => {
    ipcRenderer.send('set-date-window-title', title);
  },
  onDateModeChange: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('yuki:date-mode-change', handler);
    return () => ipcRenderer.removeListener('yuki:date-mode-change', handler);
  },
  getGPUInfo: () => {
    return ipcRenderer.invoke('get-gpu-info');
  },
  platform: process.platform,
  isElectron: true
});
