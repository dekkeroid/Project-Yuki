import React, { useRef, useEffect, useState } from 'react';

const MicLevelMeter = ({ deviceId, deviceName = '', vadThreshold = 0.01 }) => {
  const canvasRef = useRef(null);
  const dbRef = useRef(null);
  const vadLineRef = useRef(null);
  const vadLabelRef = useRef(null);
  const [error, setError] = useState(null);

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
        analyser.fftSize = 2048;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        setError(null);

        const draw = () => {
          if (stopped) return;
          animId = requestAnimationFrame(draw);
          analyser.getByteTimeDomainData(dataArray);

          let mean = 0;
          for (let i = 0; i < dataArray.length; i++) {
            mean += dataArray[i];
          }
          mean /= dataArray.length;

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const val = (dataArray[i] - mean) / 128.0;
            sum += val * val;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          const db = 20 * Math.log10(Math.max(rms, 0.0001));
          const normalized = Math.max(0, Math.min(1, (db + 60) / 60));

          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          if (canvas.clientWidth !== rect.width || canvas.clientHeight !== rect.height) {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
          }
          const dpr = window.devicePixelRatio || 1;
          const ctx = canvas.getContext('2d');
          ctx.save();
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
          ctx.restore();

          if (dbRef.current) {
            const pctVal = Math.round(normalized * 100);
            dbRef.current.textContent = db <= -58 ? '0% (— dBFS)' : `${pctVal}% (${Math.round(db)} dBFS)`;
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

  useEffect(() => {
    const line = vadLineRef.current;
    const label = vadLabelRef.current;
    if (!line) return;
    
    // Convert linear RMS vadThreshold to exact same -60dB to 0dB scale as audio meter
    const vadDb = 20 * Math.log10(Math.max(vadThreshold, 0.0001));
    const vadNormalized = Math.max(0, Math.min(1, (vadDb + 60) / 60));
    const pct = Math.max(0, Math.min(100, vadNormalized * 100));
    
    line.style.left = `${pct}%`;
    if (pct > 80) {
      label.style.left = `${pct - 20}%`;
      label.style.textAlign = 'right';
    } else {
      label.style.left = `${pct + 1.5}%`;
      label.style.textAlign = 'left';
    }
  }, [vadThreshold]);

  if (error) {
    return (
      <div style={{ marginTop: '8px', fontSize: '0.68rem', color: 'rgba(239,68,68,0.7)' }}>
        {error} — allow mic permission in your browser settings
      </div>
    );
  }

  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ position: 'relative', height: '8px' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '8px', borderRadius: '4px', display: 'block' }}
        />
        <div ref={vadLineRef} style={{
          position: 'absolute', top: '-6px', bottom: '-6px', width: '3px',
          background: '#ffffff', borderRadius: '2px', pointerEvents: 'none',
          transform: 'translateX(-50%)'
        }} />
        <div ref={vadLabelRef} style={{
          position: 'absolute', bottom: '-10px', fontSize: '8px',
          color: '#ffffff', fontFamily: 'monospace', fontWeight: 'bold',
          whiteSpace: 'nowrap', pointerEvents: 'none'
        }}>VAD</div>
      </div>
      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
        Mic Signal — <span ref={dbRef} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: '600', color: '#c4b5fd' }}>0% (— dBFS)</span>
      </div>
      <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', marginTop: '1px' }}>
        Testing: {deviceName || 'System Default'}
      </div>
    </div>
  );
};

export default MicLevelMeter;
