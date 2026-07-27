export const ALARM_TONE_PRESETS = [
  { id: 'pulse_chime', name: '🔔 Pulse Chime (Default)', type: 'synth' },
  { id: 'digital_beep', name: '⏰ Digital Alarm Beep', type: 'synth' },
  { id: 'gentle_bells', name: '🎐 Gentle Bells Chord', type: 'synth' },
  { id: 'retro_arcade', name: '👾 Retro Arcade Arpeggio', type: 'synth' },
  { id: 'marimba_melody', name: '🎵 Marimba Tri-Tone', type: 'synth' },
  { id: 'custom', name: '📁 Custom Uploaded Audio File', type: 'custom' },
];

/**
 * Synthesizes built-in alarm tone presets using Web Audio API
 */
export function playPresetChime(toneId, ctx) {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();

  const now = ctx.currentTime;

  const playNote = (freq, startTime, duration, type = 'sine', gainVal = 0.3) => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(gainVal, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch (e) {
      console.warn('Error playing synth note:', e);
    }
  };

  switch (toneId) {
    case 'digital_beep':
      // Double 1046Hz square-wave beep
      playNote(1046.50, now, 0.1, 'square', 0.25);
      playNote(1046.50, now + 0.15, 0.1, 'square', 0.25);
      break;

    case 'gentle_bells':
      // Soft 3-note harmonic bell chord (A4, C#5, E5)
      playNote(440.00, now, 0.6, 'sine', 0.2);
      playNote(554.37, now + 0.1, 0.6, 'sine', 0.2);
      playNote(659.25, now + 0.2, 0.8, 'sine', 0.25);
      break;

    case 'retro_arcade':
      // 8-bit fast arpeggio (C5 -> E5 -> G5 -> C6)
      playNote(523.25, now, 0.08, 'triangle', 0.3);
      playNote(659.25, now + 0.08, 0.08, 'triangle', 0.3);
      playNote(784.00, now + 0.16, 0.08, 'triangle', 0.3);
      playNote(1046.50, now + 0.24, 0.18, 'triangle', 0.35);
      break;

    case 'marimba_melody':
      // Warm wooden tri-tone (G4 -> B4 -> D5)
      playNote(392.00, now, 0.25, 'sine', 0.35);
      playNote(493.88, now + 0.18, 0.25, 'sine', 0.35);
      playNote(587.33, now + 0.36, 0.4, 'sine', 0.4);
      break;

    case 'pulse_chime':
    default:
      // Default dual-tone pulse chime (E5 -> A5)
      playNote(659.25, now, 0.2, 'sine', 0.3);
      playNote(880.00, now + 0.25, 0.3, 'sine', 0.35);
      break;
  }
}
