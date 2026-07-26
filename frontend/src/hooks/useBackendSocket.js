import { useState, useRef, useEffect, useCallback } from 'react';
import { API_BASE, WS_BASE } from '../api';

export function useBackendSocket(options = {}) {
  const { onOpen, onMessage, onClose, onError } = options;
  const [backendStatus, setBackendStatus] = useState('offline'); // 'online' or 'offline'
  const [isSessionActive, setIsSessionActiveState] = useState(false);
  const isSessionActiveRef = useRef(false);

  const setIsSessionActive = useCallback((val) => {
    isSessionActiveRef.current = val;
    setIsSessionActiveState(val);
  }, []);
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const healthCheckIntervalRef = useRef(null);

  const callbacksRef = useRef({ onOpen, onMessage, onClose, onError });

  useEffect(() => {
    callbacksRef.current = { onOpen, onMessage, onClose, onError };
  });

  const connectWebSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (socketRef.current) {
      try {
        socketRef.current.onclose = null;
        socketRef.current.close();
      } catch (err) {
        console.warn("Error closing old socket:", err);
      }
      socketRef.current = null;
    }

    const ws = new WebSocket(`${WS_BASE}/ws`);
    socketRef.current = ws;
    setSocket(ws);

    ws.onopen = () => {
      setBackendStatus('online');
      reconnectAttemptRef.current = 0;
      console.log("WebSocket connected to backend.");
      if (callbacksRef.current.onOpen) callbacksRef.current.onOpen();
    };

    ws.onmessage = (event) => {
      if (callbacksRef.current.onMessage) callbacksRef.current.onMessage(event);
    };

    ws.onclose = () => {
      if (socketRef.current !== ws) return;
      setBackendStatus('offline');
      setSocket(null);
      socketRef.current = null;
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(5000 * Math.pow(2, attempt), 60000);
      reconnectAttemptRef.current = attempt + 1;
      console.warn(`WebSocket disconnected. Retrying in ${delay / 1000}s (attempt ${attempt + 1})...`);
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
      if (callbacksRef.current.onClose) callbacksRef.current.onClose();
    };

    ws.onerror = (e) => {
      console.error("WebSocket error:", e);
      if (callbacksRef.current.onError) callbacksRef.current.onError(e);
    };
  }, []);

  useEffect(() => {
    healthCheckIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            setBackendStatus('online');
          }
        } else {
          setBackendStatus('offline');
        }
      } catch {
        setBackendStatus('offline');
      }
    }, 30000);

    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return {
    socket,
    socketRef,
    backendStatus,
    setBackendStatus,
    isSessionActive,
    isSessionActiveRef,
    setIsSessionActive,
    connectWebSocket
  };
}
