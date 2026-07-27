const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  setWindowScale: (scale) => {
    ipcRenderer.send('set-window-scale', scale);
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
  isElectron: true
});
