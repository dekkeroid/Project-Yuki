import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, X, Minus, Clock } from 'lucide-react';
import { API_BASE } from '../api';

const StopwatchOverlay = ({ initialLabel = 'default' }) => {
  const [label, setLabel] = useState(initialLabel);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const startTimeRef = useRef(Date.now());
  const accumulatedRef = useRef(0);
  const timerRef = useRef(null);

  // Sync / fetch initial stopwatch state from backend
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reminders/active`);
        if (res.ok) {
          const data = await res.json();
          const match = (data.stopwatches || []).find(
            (s) => s.label.toLowerCase() === initialLabel.toLowerCase()
          );
          if (match) {
            accumulatedRef.current = match.elapsed_seconds * 1000;
            startTimeRef.current = Date.now();
            setElapsedMs(accumulatedRef.current);
          }
        }
      } catch (e) {
        console.warn("Could not sync stopwatch state:", e);
      }
    };
    fetchStatus();
  }, [initialLabel]);

  // High precision timer loop (10ms tick for hundredths of a second)
  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const now = Date.now();
        const delta = now - startTimeRef.current;
        setElapsedMs(accumulatedRef.current + delta);
      }, 30);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  const handlePauseResume = async () => {
    if (isRunning) {
      // Pausing — freeze locally AND tell backend to stop accumulating
      accumulatedRef.current = elapsedMs;
      setIsRunning(false);
      try {
        await fetch(`${API_BASE}/api/reminders/stopwatch/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label })
        });
      } catch (e) {
        console.error("Failed to pause stopwatch on backend:", e);
      }
    } else {
      // Resuming — tell backend to resume timing from paused_elapsed
      startTimeRef.current = Date.now();
      setIsRunning(true);
      try {
        await fetch(`${API_BASE}/api/reminders/stopwatch/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label })
        });
      } catch (e) {
        console.error("Failed to resume stopwatch on backend:", e);
      }
    }
  };

  const handleReset = async () => {
    try {
      await fetch(`${API_BASE}/api/reminders/stopwatch/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
      });
    } catch (e) {
      console.error("Failed to reset stopwatch on backend:", e);
    }
    accumulatedRef.current = 0;
    setElapsedMs(0);
    startTimeRef.current = Date.now();
  };

  const handleStopAndClose = async () => {
    try {
      await fetch(`${API_BASE}/api/reminders/stopwatch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
      });
    } catch (e) {
      console.error("Failed to stop stopwatch:", e);
    }
    if (window.electronAPI && window.electronAPI.closeStopwatchWindow) {
      window.electronAPI.closeStopwatchWindow(label);
    }
  };

  const handleMinimize = () => {
    if (window.electronAPI && window.electronAPI.minimizeStopwatchWindow) {
      window.electronAPI.minimizeStopwatchWindow(label);
    }
  };

  // Format elapsedMs into HH:MM:SS.ms
  const formatTime = (ms) => {
    const totalSecs = Math.floor(ms / 1000);
    const hundredths = Math.floor((ms % 1000) / 10);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const pad = (n) => String(n).padStart(2, '0');

    if (hrs > 0) {
      return {
        main: `${pad(hrs)}:${pad(mins)}:${pad(secs)}`,
        sub: `.${pad(hundredths)}`
      };
    }
    return {
      main: `${pad(mins)}:${pad(secs)}`,
      sub: `.${pad(hundredths)}`
    };
  };

  const formatted = formatTime(elapsedMs);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'rgba(10, 8, 22, 0.95)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRadius: '18px',
      border: '1px solid rgba(167, 139, 250, 0.35)',
      boxShadow: '0 0 30px rgba(167, 139, 250, 0.25), 0 10px 40px rgba(0,0,0,0.8)',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '12px 16px',
      color: '#fff',
      userSelect: 'none',
      overflow: 'hidden'
    }}>
      {/* Titlebar Drag Area */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        WebkitAppRegion: 'drag',
        cursor: 'grab',
        paddingBottom: '4px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Clock style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Stopwatch — '{label}'
          </span>
        </div>

        {/* Window Action Controls (No-Drag) */}
        <div style={{ display: 'flex', gap: '6px', WebkitAppRegion: 'no-drag' }}>
          <button
            type="button"
            onClick={handleMinimize}
            title="Minimize"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              borderRadius: '6px',
              width: '24px',
              height: '24px',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Minus style={{ width: '12px', height: '12px' }} />
          </button>
          <button
            type="button"
            onClick={handleStopAndClose}
            title="Stop & Close"
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: 'none',
              borderRadius: '6px',
              width: '24px',
              height: '24px',
              color: '#fca5a5',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X style={{ width: '12px', height: '12px' }} />
          </button>
        </div>
      </div>

      {/* Main Digital Counter */}
      <div style={{
        textAlign: 'center',
        padding: '6px 0',
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'center'
      }}>
        <span style={{
          fontSize: '2.4rem',
          fontFamily: 'monospace',
          fontWeight: 800,
          letterSpacing: '2px',
          color: '#ffffff',
          textShadow: '0 0 16px rgba(167, 139, 250, 0.5)'
        }}>
          {formatted.main}
        </span>
        <span style={{
          fontSize: '1.2rem',
          fontFamily: 'monospace',
          fontWeight: 600,
          color: '#a78bfa',
          marginLeft: '2px'
        }}>
          {formatted.sub}
        </span>
      </div>

      {/* Stopwatch Controls (No-Drag) */}
      <div style={{
        display: 'flex',
        gap: '8px',
        WebkitAppRegion: 'no-drag',
        justifyContent: 'center'
      }}>
        <button
          type="button"
          onClick={handlePauseResume}
          style={{
            flex: 1,
            padding: '7px 12px',
            borderRadius: '10px',
            border: 'none',
            background: isRunning ? 'rgba(245, 158, 11, 0.25)' : 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
            color: isRunning ? '#fcd34d' : '#fff',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            transition: 'all 0.2s'
          }}
        >
          {isRunning ? <Pause style={{ width: '13px', height: '13px' }} /> : <Play style={{ width: '13px', height: '13px' }} />}
          <span>{isRunning ? 'Pause' : 'Resume'}</span>
        </button>

        <button
          type="button"
          onClick={handleReset}
          style={{
            padding: '7px 12px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px'
          }}
        >
          <RotateCcw style={{ width: '13px', height: '13px' }} />
          <span>Reset</span>
        </button>

        <button
          type="button"
          onClick={handleStopAndClose}
          style={{
            padding: '7px 12px',
            borderRadius: '10px',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#fca5a5',
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          Stop
        </button>
      </div>
    </div>
  );
};

export default StopwatchOverlay;
