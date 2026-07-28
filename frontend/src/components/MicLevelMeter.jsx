import React, { useRef, useEffect, useState } from 'react';

const MicLevelMeter = ({ deviceId, deviceName = '', vadThreshold = 0.01 }) => {
  const canvasRef = useRef(null);
  const dbRef = useRef(null);
  const vadThresholdRef = useRef(vadThreshold);
  const [error, setError] = useState(null);

  useEffect(() => { vadThresholdRef.current = vadThreshold; }, [vadThreshold]);

  useEffect(() => {
    let animId;
    let audioCtx;
    let stream;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          }
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }

        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        setError(null);

        const draw = () => {
          if (stopped) return;
          animId = requestAnimationFrame(draw);
          analyser.getByteTimeDomainData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const val = (dataArray[i] - 128) / 128;
            sum += val * val;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          const db = 20 * Math.log10(Math.max(rms, 0.0001));
          const normalized = Math.max(0, Math.min(1, (db + 60) / 60));

          const canvas = canvasRef.current;
          if (!canvas) return;
          const dpr = window.devicePixelRatio || 1;
          const rect = canvas.getBoundingClientRect();
          canvas.width = rect.width * dpr;
          canvas.height = rect.height * dpr;
          const ctx = canvas.getContext('2d');
          ctx.scale(dpr, dpr);
          const w = rect.width;
          const h = rect.height;

          ctx.clearRect(0, 0, w, h);

          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(0, 0, w, h);

          const barW = Math.max(2, normalized * w);
          const gradient = ctx.createLinearGradient(0, 0, w, 0);
          gradient.addColorStop(0, '#22c55e');
          gradient.addColorStop(0.55, '#eab308');
          gradient.addColorStop(1, '#ef4444');
          ctx.fillStyle = gradient;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(0, 0, barW, h, 4);
          } else {
            ctx.fillRect(0, 0, barW, h);
          }
          ctx.fill();

          const thresholdX = Math.max(1, Math.min(w - 1, vadThresholdRef.current * w));
          ctx.strokeStyle = 'rgba(168,85,247,0.65)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(thresholdX, 0);
          ctx.lineTo(thresholdX, h);
          ctx.stroke();
          ctx.setLineDash([]);

          if (dbRef.current) {
            dbRef.current.textContent = db <= -40 ? '— dB' : `${Math.round(db)} dB`;
          }
        };
        draw();
      } catch (e) {
        if (!stopped) {
          setError(e.name === 'NotAllowedError' ? 'Mic access denied' : 'No mic available');
        }
      }
    })();

    return () => {
      stopped = true;
      if (animId) cancelAnimationFrame(animId);
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (audioCtx) audioCtx.close();
    };
  }, [deviceId]);

  if (error) {
    return (
      <div style={{ marginTop: '8px', fontSize: '0.68rem', color: 'rgba(239,68,68,0.7)' }}>
        {error} — allow mic permission in your browser settings
      </div>
    );
  }

  return (
    <div style={{ marginTop: '8px' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '8px', borderRadius: '4px', display: 'block' }}
      />
      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', marginTop: '3px' }}>
        Mic Test — <span ref={dbRef} style={{ fontVariantNumeric: 'tabular-nums' }}>— dB</span>
      </div>
      <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', marginTop: '1px' }}>
        Testing: {deviceName || 'System Default'}
      </div>
    </div>
  );
};

export default MicLevelMeter;
