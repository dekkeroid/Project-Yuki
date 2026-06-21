const apiBase = import.meta.env.VITE_API_BASE
  || `${window.location.protocol}//${window.location.hostname}:7860`;

export const API_BASE = apiBase;
export const WS_BASE = apiBase.replace(/^http/, 'ws');
