import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, X, Minus, Clock } from 'lucide-react';
import { API_BASE, WS_BASE } from '../api';

// ─────────────────────────────────────────────────────────────────────────────
// Architecture:
//   Backend is THE source of truth. It stores:
//     started_at      — Unix timestamp (seconds) when last resumed
//     paused_elapsed  — seconds accumulated before the last pause
//     is_active       — boolean
//
//   Elapsed formula (mirrors the backend exactly):
//     if active:  elapsed_ms = (Date.now() - startedAt_ms) + pausedElapsed_ms
//     if paused:  elapsed_ms = pausedElapsed_ms   ← frozen, local clock NOT used
//
//   syncFromBackend() reads these raw fields and hard-sets the refs.
//   The 30ms interval computes elapsed from refs — it never mutates refs.
//   Every user action: optimistic update refs → await API → syncFromBackend().
// ─────────────────────────────────────────────────────────────────────────────

function fmtMs(ms) {
  const clamped = Math.max(0, ms);
  const totalSecs = Math.floor(clamped / 1000);
  const hh = Math.floor((clamped % 1000) / 10);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0
    ? { main: `${pad(h)}:${pad(m)}:${pad(s)}`, sub: `.${pad(hh)}` }
    : { main: `${pad(m)}:${pad(s)}`, sub: `.${pad(hh)}` };
}

const StopwatchOverlay = ({ initialLabel = 'default' }) => {
  const label = initialLabel; // immutable for this window's lifetime

  // ── Display state ──────────────────────────────────────────────────────────
  const [displayMs, setDisplayMs] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [synced, setSynced] = useState(false); // false = loading, true = ready

  // ── Backend-anchored refs (set by syncFromBackend, read by tick interval) ──
  // Using refs here means the interval closure never goes stale.
  const startedAtMs = useRef(0);   // backend started_at * 1000
  const pausedElapsedMs = useRef(0);   // backend paused_elapsed * 1000
  const activeRef = useRef(false);
  const tickRef = useRef(null);

  // ── Core sync: fetch backend state and hard-set everything ─────────────────
  const syncFromBackend = useCallback(async () => {
    try {
      // Add cache: 'no-store'
      const res = await fetch(`${API_BASE}/api/reminders/active`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const sw = (data.stopwatches || []).find(
        s => s.label.toLowerCase() === label.toLowerCase()
      );
      if (!sw) return;

      // Use raw backend fields for maximum precision.
      // started_at and paused_elapsed are the ground truth — not elapsed_seconds
      // (which is already int-rounded by the backend).
      startedAtMs.current = (sw.started_at || 0) * 1000;
      pausedElapsedMs.current = (sw.paused_elapsed || 0) * 1000;
      activeRef.current = !!sw.is_active;

      // Compute the correct display value right now
      const now = Date.now();
      const elapsed = sw.is_active
        ? (now - startedAtMs.current) + pausedElapsedMs.current
        : pausedElapsedMs.current;

      setDisplayMs(Math.max(0, elapsed));
      setIsRunning(!!sw.is_active);
      setSynced(true);
    } catch (e) {
      console.warn('[Stopwatch] syncFromBackend failed:', e);
    }
  }, [label]);

  // ── On mount: sync from backend before showing anything ───────────────────
  useEffect(() => {
    syncFromBackend();
  }, [syncFromBackend]);

  // ── Own WebSocket connection ───────────────────────────────────────────────
  // The stopwatch overlay is a separate Electron window that renders before
  // App.jsx's WS setup. We open our own lightweight WS here so we can receive
  // stopwatch_changed / stopwatch_started events and immediately re-sync.
  useEffect(() => {
    let ws = null;
    let reconnectTimer = null;
    let dead = false;

    const connect = () => {
      if (dead) return;
      try {
        ws = new WebSocket(WS_BASE);

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            // Re-sync when backend tells us this stopwatch changed
            if (
              (msg.type === 'stopwatch_changed' || msg.type === 'stopwatch_started') &&
              msg.label?.toLowerCase() === label.toLowerCase()
            ) {
              syncFromBackend();
            }
          } catch { }
        };

        ws.onclose = () => {
          if (!dead) reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => { try { ws.close(); } catch { } };
      } catch { }
    };

    connect();

    return () => {
      dead = true;
      clearTimeout(reconnectTimer);
      if (ws) { ws.onclose = null; try { ws.close(); } catch { } }
    };
  }, [label, syncFromBackend]);

  // ── Tick loop: runs at 30ms, reads refs directly (no stale closure risk) ──
  // Only starts after first successful sync. The interval computes elapsed
  // from the same formula the backend uses — so they always agree.
  useEffect(() => {
    if (!synced) return;

    if (isRunning) {
      tickRef.current = setInterval(() => {
        if (!activeRef.current) return; // guard: don't tick while paused
        const elapsed = (Date.now() - startedAtMs.current) + pausedElapsedMs.current;
        setDisplayMs(Math.max(0, elapsed));
      }, 30);
    } else {
      clearInterval(tickRef.current);
    }

    return () => clearInterval(tickRef.current);
  }, [isRunning, synced]);

  // ── API helper ─────────────────────────────────────────────────────────────
  const swAPI = useCallback(async (endpoint, extraBody = {}) => {
    const res = await fetch(`${API_BASE}/api/reminders/stopwatch/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, ...extraBody }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from /stopwatch/${endpoint}`);
    return res.json();
  }, [label]);

  // ── Handlers: optimistic update → await API → hard-sync ───────────────────

  const handlePauseResume = async () => {
    if (isRunning) {
      // Optimistic: freeze display at current elapsed
      const frozen = (Date.now() - startedAtMs.current) + pausedElapsedMs.current;
      pausedElapsedMs.current = Math.max(0, frozen);
      activeRef.current = false;
      setDisplayMs(Math.max(0, frozen));
      setIsRunning(false);
      try { await swAPI('stop'); } catch (e) { console.error('[Stopwatch] pause failed:', e); }
    } else {
      // Optimistic: resume from current paused position
      startedAtMs.current = Date.now();
      activeRef.current = true;
      setIsRunning(true);
      try { await swAPI('start'); } catch (e) { console.error('[Stopwatch] resume failed:', e); }
    }
    // Hard-sync: snap to exact backend state (corrects any optimistic drift)
    await syncFromBackend();
  };

  const handleReset = async () => {
    // Optimistic: snap to zero immediately
    startedAtMs.current = Date.now();
    pausedElapsedMs.current = 0;
    setDisplayMs(0);
    try { await swAPI('reset'); } catch (e) { console.error('[Stopwatch] reset failed:', e); }
    await syncFromBackend();
  };

  const handleStopAndClose = async () => {
    try { await swAPI('delete'); } catch (e) { console.error('[Stopwatch] stop failed:', e); }
    window.electronAPI?.closeStopwatchWindow?.(label);
  };

  const handleMinimize = () => {
    window.electronAPI?.minimizeStopwatchWindow?.(label);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const { main, sub } = fmtMs(displayMs);

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'rgba(10, 8, 22, 0.95)',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      borderRadius: '18px',
      border: '1px solid rgba(167, 139, 250, 0.35)',
      boxShadow: '0 0 30px rgba(167, 139, 250, 0.25), 0 10px 40px rgba(0,0,0,0.8)',
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', padding: '12px 16px',
      color: '#fff', userSelect: 'none', overflow: 'hidden',
    }}>

      {/* ── Titlebar (drag region) ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        WebkitAppRegion: 'drag', cursor: 'grab', paddingBottom: '4px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Clock style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Stopwatch — '{label}'
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', WebkitAppRegion: 'no-drag' }}>
          <button type="button" onClick={handleMinimize} title="Minimize" style={{
            background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '6px',
            width: '24px', height: '24px', color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Minus style={{ width: '12px', height: '12px' }} />
          </button>
          <button type="button" onClick={handleStopAndClose} title="Stop & Close" style={{
            background: 'rgba(239, 68, 68, 0.2)', border: 'none', borderRadius: '6px',
            width: '24px', height: '24px', color: '#fca5a5',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X style={{ width: '12px', height: '12px' }} />
          </button>
        </div>
      </div>

      {/* ── Digital counter ── */}
      <div style={{ textAlign: 'center', padding: '6px 0', display: 'flex', alignItems: 'baseline', justifyContent: 'center' }}>
        {!synced ? (
          <span style={{ fontSize: '1.2rem', color: 'rgba(167,139,250,0.5)', fontFamily: 'monospace' }}>
            syncing…
          </span>
        ) : (
          <>
            <span style={{
              fontSize: '2.4rem', fontFamily: 'monospace', fontWeight: 800,
              letterSpacing: '2px', color: '#ffffff',
              textShadow: '0 0 16px rgba(167, 139, 250, 0.5)',
            }}>
              {main}
            </span>
            <span style={{
              fontSize: '1.2rem', fontFamily: 'monospace', fontWeight: 600,
              color: '#a78bfa', marginLeft: '2px',
            }}>
              {sub}
            </span>
          </>
        )}
      </div>

      {/* ── Controls (no-drag) ── */}
      <div style={{ display: 'flex', gap: '8px', WebkitAppRegion: 'no-drag', justifyContent: 'center' }}>
        <button type="button" onClick={handlePauseResume} disabled={!synced} style={{
          flex: 1, padding: '7px 12px', borderRadius: '10px', border: 'none',
          background: isRunning ? 'rgba(245, 158, 11, 0.25)' : 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
          color: isRunning ? '#fcd34d' : '#fff',
          fontSize: '0.78rem', fontWeight: 700, cursor: synced ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
          transition: 'all 0.2s', opacity: synced ? 1 : 0.5,
        }}>
          {isRunning
            ? <Pause style={{ width: '13px', height: '13px' }} />
            : <Play style={{ width: '13px', height: '13px' }} />}
          <span>{isRunning ? 'Pause' : 'Resume'}</span>
        </button>

        <button type="button" onClick={handleReset} disabled={!synced} style={{
          padding: '7px 12px', borderRadius: '10px',
          border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)',
          color: '#fff', fontSize: '0.78rem', fontWeight: 600,
          cursor: synced ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
          opacity: synced ? 1 : 0.5,
        }}>
          <RotateCcw style={{ width: '13px', height: '13px' }} />
          <span>Reset</span>
        </button>

        <button type="button" onClick={handleStopAndClose} style={{
          padding: '7px 12px', borderRadius: '10px',
          border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.15)',
          color: '#fca5a5', fontSize: '0.78rem', fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          Stop
        </button>
      </div>
    </div>
  );
};

export default StopwatchOverlay;
