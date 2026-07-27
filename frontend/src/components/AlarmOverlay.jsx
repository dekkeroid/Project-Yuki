import React, { useEffect, useRef } from 'react';
import { BellRing, Clock, X, RotateCcw } from 'lucide-react';
import { API_BASE } from '../api';

const AlarmOverlay = ({ alarm, onDismiss, onSnooze }) => {
  const audioCtxRef = useRef(null);
  const intervalRef = useRef(null);

  // Cross-platform Web Audio API repeating chime synthesizer
  useEffect(() => {
    if (!alarm) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;

        const playChimeNote = (freq, startTime, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.3, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + duration);
        };

        const triggerPulse = () => {
          if (ctx.state === 'suspended') ctx.resume();
          const now = ctx.currentTime;
          // Dual-pitch alarm chime pulse (E5 -> A5)
          playChimeNote(659.25, now, 0.2);
          playChimeNote(880.00, now + 0.25, 0.3);
        };

        triggerPulse();
        intervalRef.current = setInterval(triggerPulse, 1200);
      }
    } catch (e) {
      console.warn("Failed to initialize Web Audio alarm chime:", e);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [alarm]);

  if (!alarm) return null;

  const isTimer = alarm.category === 'timer';
  const themeColor = isTimer ? '#38bdf8' : '#f43f5e';
  const glowColor = isTimer ? 'rgba(56,189,248,0.4)' : 'rgba(244,63,94,0.4)';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      background: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.3s ease'
    }}>
      <div style={{
        background: 'linear-gradient(145deg, rgba(20,15,35,0.98) 0%, rgba(10,8,20,0.99) 100%)',
        border: `2px solid ${themeColor}`,
        boxShadow: `0 0 40px ${glowColor}, 0 20px 50px rgba(0,0,0,0.9)`,
        borderRadius: '20px',
        padding: '28px 36px',
        width: '90%',
        maxWidth: '440px',
        textAlign: 'center',
        color: '#fff',
        position: 'relative'
      }}>
        {/* Pulsing Icon Header */}
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          background: `${themeColor}22`,
          border: `2px solid ${themeColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px auto',
          boxShadow: `0 0 20px ${glowColor}`
        }}>
          {isTimer ? (
            <Clock style={{ width: '32px', height: '32px', color: themeColor }} />
          ) : (
            <BellRing style={{ width: '32px', height: '32px', color: themeColor }} />
          )}
        </div>

        {/* Title */}
        <div style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          color: themeColor,
          marginBottom: '6px'
        }}>
          {isTimer ? '⏱️ Timer Finished' : '⏰ Alarm Ringing'}
        </div>

        {/* Message */}
        <h2 style={{
          fontSize: '1.4rem',
          fontWeight: 700,
          margin: '0 0 12px 0',
          lineHeight: '1.3',
          color: '#ffffff'
        }}>
          {alarm.message || (isTimer ? 'Timer Up!' : 'Scheduled Alarm')}
        </h2>

        <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', margin: '0 0 24px 0' }}>
          Triggered at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            onClick={() => onSnooze(alarm.id)}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
          >
            <RotateCcw style={{ width: '15px', height: '15px' }} />
            <span>Snooze 5m</span>
          </button>

          <button
            type="button"
            onClick={() => onDismiss(alarm.id)}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: '12px',
              border: 'none',
              background: `linear-gradient(135deg, ${themeColor}, ${themeColor}bb)`,
              boxShadow: `0 4px 15px ${glowColor}`,
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
          >
            <X style={{ width: '16px', height: '16px' }} />
            <span>Dismiss</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlarmOverlay;
