import React, { useEffect, useRef } from 'react';
import { BellRing, Clock, X, RotateCcw } from 'lucide-react';
import { API_BASE } from '../api';
import { playPresetChime } from '../utils/toneSynthesizer';

const AlarmOverlay = ({ alarm, onDismiss, onSnooze, isStandaloneWindow = false, muteChime = false, tone, customToneFile }) => {
  const audioCtxRef = useRef(null);
  const intervalRef = useRef(null);
  const customAudioRef = useRef(null);

  // Audio tone playback synthesizer or custom audio player
  useEffect(() => {
    if (!alarm || muteChime) return;

    const toneId = tone || alarm.tone || 'pulse_chime';
    const customFile = customToneFile || alarm.customToneFile || '';

    if (toneId === 'custom' && customFile) {
      try {
        const audioUrl = `${API_BASE}/api/settings/alarm-tone/file/${encodeURIComponent(customFile)}`;
        const audio = new Audio(audioUrl);
        audio.loop = true;
        audio.play().catch(e => console.warn("Failed to play custom tone audio:", e));
        customAudioRef.current = audio;
      } catch (e) {
        console.warn("Failed to initialize custom audio tone:", e);
      }
    } else {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioCtxRef.current = ctx;

          const triggerPulse = () => playPresetChime(toneId, ctx);
          triggerPulse();
          intervalRef.current = setInterval(triggerPulse, 1200);
        }
      } catch (e) {
        console.warn("Failed to initialize alarm audio chime:", e);
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
      if (customAudioRef.current) {
        customAudioRef.current.pause();
        customAudioRef.current = null;
      }
    };
  }, [alarm, muteChime, tone, customToneFile]);

  if (!alarm) return null;

  const isTimer = alarm.category === 'timer';
  const themeColor = isTimer ? '#38bdf8' : '#f43f5e';
  const glowColor = isTimer ? 'rgba(56,189,248,0.45)' : 'rgba(244,63,94,0.45)';

  const handleDismissAction = async () => {
    try {
      if (alarm.id) {
        await fetch(`${API_BASE}/api/reminders/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(alarm.id) })
        });
      }
    } catch (e) {
      console.error("Failed to cancel alarm:", e);
    }
    if (window.electronAPI && window.electronAPI.closeAlarmWindow) {
      window.electronAPI.closeAlarmWindow(alarm.id);
    }
    if (onDismiss) onDismiss(alarm.id);
  };

  const handleSnoozeAction = async () => {
    try {
      if (alarm.id) {
        await fetch(`${API_BASE}/api/reminders/snooze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(alarm.id), minutes: 5 })
        });
      }
    } catch (e) {
      console.error("Failed to snooze alarm:", e);
    }
    if (window.electronAPI && window.electronAPI.closeAlarmWindow) {
      window.electronAPI.closeAlarmWindow(alarm.id);
    }
    if (onSnooze) onSnooze(alarm.id);
  };

  return (
    <div style={{
      position: isStandaloneWindow ? 'relative' : 'fixed',
      inset: 0,
      width: '100vw',
      height: '100vh',
      zIndex: 999999,
      background: 'rgba(9, 11, 22, 0.94)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      boxSizing: 'border-box',
      overflow: 'hidden',
      userSelect: 'none',
      WebkitAppRegion: 'drag'
    }}>
      <div style={{
        background: 'linear-gradient(145deg, rgba(22, 17, 40, 0.98) 0%, rgba(10, 8, 22, 0.99) 100%)',
        border: `2px solid ${themeColor}`,
        boxShadow: `0 0 40px ${glowColor}, 0 20px 50px rgba(0,0,0,0.9)`,
        borderRadius: '24px',
        padding: '24px 28px',
        width: '100%',
        maxWidth: '420px',
        textAlign: 'center',
        color: '#fff',
        position: 'relative',
        WebkitAppRegion: 'no-drag'
      }}>
        {/* Pulsing Icon */}
        <div style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: `${themeColor}22`,
          border: `2px solid ${themeColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 14px auto',
          boxShadow: `0 0 24px ${glowColor}`
        }}>
          {isTimer ? (
            <Clock style={{ width: '30px', height: '30px', color: themeColor }} />
          ) : (
            <BellRing style={{ width: '30px', height: '30px', color: themeColor }} />
          )}
        </div>

        {/* Title */}
        <div style={{
          fontSize: '0.72rem',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '1.8px',
          color: themeColor,
          marginBottom: '6px'
        }}>
          {isTimer ? '⏱️ Timer Finished' : '⏰ Alarm Ringing'}
        </div>

        {/* Message */}
        <h2 style={{
          fontSize: '1.35rem',
          fontWeight: 700,
          margin: '0 0 8px 0',
          lineHeight: '1.3',
          color: '#ffffff',
          wordBreak: 'break-word'
        }}>
          {alarm.message || (isTimer ? 'Timer Up!' : 'Scheduled Alarm')}
        </h2>

        <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', margin: '0 0 20px 0' }}>
          Triggered at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            onClick={handleSnoozeAction}
            style={{
              flex: 1,
              padding: '11px 14px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
          >
            <RotateCcw style={{ width: '14px', height: '14px' }} />
            <span>Snooze 5m</span>
          </button>

          <button
            type="button"
            onClick={handleDismissAction}
            style={{
              flex: 1,
              padding: '11px 14px',
              borderRadius: '12px',
              border: 'none',
              background: `linear-gradient(135deg, ${themeColor}, ${themeColor}bb)`,
              boxShadow: `0 4px 15px ${glowColor}`,
              color: '#fff',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
          >
            <X style={{ width: '15px', height: '15px' }} />
            <span>Dismiss</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlarmOverlay;
