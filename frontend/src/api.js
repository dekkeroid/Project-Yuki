const defaultApiBase = import.meta.env.VITE_API_BASE || '';

export const API_BASE = defaultApiBase;
export const WS_BASE = import.meta.env.VITE_API_BASE
  ? import.meta.env.VITE_API_BASE.replace(/^http/, 'ws')
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
