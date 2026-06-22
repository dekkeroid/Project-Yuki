const apiBase = import.meta.env.VITE_API_BASE
  || (window.location.protocol === 'file:'
    ? 'http://127.0.0.1:58392'
    : `${window.location.protocol}//${window.location.hostname}:58392`);

export const API_BASE = apiBase;
export const WS_BASE = apiBase.replace(/^http/, 'ws');
