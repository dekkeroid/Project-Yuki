import { useState, useRef, useEffect, useCallback } from 'react';
import { cleanTextForTTS, getSpeechFriendlyText, detectExpression } from '../constants';
import { stripAnimationTags } from '../utils/responseParser';

export function useAudioPlayback(options = {}) {
  const {
    profile,
    setAudioLevel,
    setVisemeLevels,
    setAvatarExpression,
    updateListeningStateGlobal,
    isVoiceCommandModeRef,
    startSessionTimeout,
    socketRef,
    stopSpeechRecognition,
    setIsThinking
  } = options;

  const [muteVoice, setMuteVoiceState] = useState(() => {
    return localStorage.getItem('yuki-mute-voice') === 'true';
  });
  const muteVoiceRef = useRef(muteVoice);
  const setMuteVoice = useCallback((val) => {
    let nextVal = val;
    if (typeof val === 'function') {
      nextVal = val(muteVoiceRef.current);
    }
    muteVoiceRef.current = nextVal;
    setMuteVoiceState(nextVal);
  }, []);

  useEffect(() => {
    localStorage.setItem('yuki-mute-voice', muteVoiceRef.current);
  }, [muteVoice]);

  const [ttsStreamActive, setTtsStreamActiveState] = useState(false);
  const ttsStreamActiveRef = useRef(false);
  const setTtsStreamActive = useCallback((val) => {
    ttsStreamActiveRef.current = val;
    setTtsStreamActiveState(val);
  }, []);

  const [currentSpeechText, setCurrentSpeechText] = useState('');

  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const hasReceivedAudioRef = useRef(false);
  const audioContextRef = useRef(null);
  const audioRef = useRef(null);
  const analyserRef = useRef(null);
  const isNativeSpeakingRef = useRef(false);
  const systemMessageActiveRef = useRef(false);
  const nativeSpeechIntervalRef = useRef(null);
  const speakTextNativelyRef = useRef(null); // Forward ref to break circular dep with queueAudioChunk
  const bubbleTimeoutRef = useRef(null);
  const playbackTimeoutRef = useRef(null);
  const micActivationTimeoutRef = useRef(null);

  const [voiceVolume, setVoiceVolumeState] = useState(() => {
    try { return parseFloat(localStorage.getItem('yuki-voice-volume') || '1.0'); } catch { return 1.0; }
  });
  const voiceVolumeRef = useRef(voiceVolume);
  const setVoiceVolume = useCallback((val) => {
    voiceVolumeRef.current = val;
    setVoiceVolumeState(val);
    localStorage.setItem('yuki-voice-volume', val.toString());
    if (audioRef.current) {
      audioRef.current.volume = val;
    }
  }, []);
  const animationFrameRef = useRef(null);

  const initAudioAnalyser = useCallback(() => {
    if (audioContextRef.current) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.25;

      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.volume = voiceVolumeRef.current;

      const source = audioCtx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);

      audioRef.current = audio;
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      console.log("[AudioPlayback] Web Audio 256-FFT Spectral Formant Analyser established.");

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let smoothedAa = 0;
      let smoothedIh = 0;
      let smoothedOu = 0;
      let smoothedEe = 0;
      let smoothedOh = 0;
      let lastTime = performance.now();

      const getBandEnergy = (startBin, endBin) => {
        let sum = 0;
        const count = endBin - startBin + 1;
        for (let i = startBin; i <= endBin; i++) {
          sum += dataArray[i] || 0;
        }
        return sum / count / 255.0; // Normalized 0.0 - 1.0
      };

      const checkVolume = () => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastTime) / 1000.0);
        lastTime = now;

        if (analyserRef.current && audioRef.current && !audioRef.current.paused) {
          analyserRef.current.getByteFrequencyData(dataArray);

          // 1. Calculate overall amplitude
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const normalized = Math.min(average / 85.0, 1.0);
          if (setAudioLevel) setAudioLevel(Math.min(normalized, 0.8));

          // 2. 4-Band Acoustic Formant Analysis (bin width ~172Hz-188Hz)
          const bF1 = getBandEnergy(2, 5);       // ~340Hz - 900Hz (Jaw opening / open vowels)
          const bF2Low = getBandEnergy(6, 9);    // ~1000Hz - 1600Hz (Back rounded vowels /u/, /o/)
          const bF2High = getBandEnergy(10, 16); // ~1700Hz - 2900Hz (Front spread vowels /i/, /e/)
          const bSib = getBandEnergy(21, 46);    // ~3600Hz - 8000Hz (Sibilance / consonants /s/, /t/, /f/)

          let targetAa = 0;
          let targetIh = 0;
          let targetOu = 0;
          let targetEe = 0;
          let targetOh = 0;

          if (normalized > 0.02) {
            // Consonant / Sibilance check: high frequency hiss dominates over open vowel formants
            const isConsonant = (bSib > 0.07) && (bSib > bF1 * 0.82);

            if (isConsonant) {
              // Clamp jaw drop shut to keep teeth together on 's', 't', 'sh', 'f'
              targetAa = Math.min(0.04, bF1 * 0.12);
              targetIh = Math.min(0.18, bSib * 1.2);
              targetEe = 0.03;
              targetOu = 0.0;
              targetOh = 0.0;
            } else {
              // Natural conversational mouth opening scales (softer, human-proportional):
              // Open Vowel (aa): Jaw opening calibrated to max ~0.36
              const f1Net = Math.max(0, bF1 - 0.035);
              targetAa = Math.min(0.36, f1Net * 1.4);

              // Front Spread Vowel (ih): Wide spread, calibrated to max ~0.30
              const f2Spread = Math.max(0, bF2High - (bF2Low * 0.65));
              targetIh = Math.min(0.30, f2Spread * 1.5);

              // Back Rounded Vowel (oh): Rounded lips, calibrated to max ~0.26
              const f2Round = Math.max(0, bF2Low - 0.03);
              targetOh = Math.min(0.26, f2Round * 1.3);

              // High Rounded Vowel (ou): Narrow pursed lips, calibrated to max ~0.22
              targetOu = Math.min(0.22, Math.max(0, bF2Low - bF2High) * 1.3);

              // Mid Spread Vowel (ee): Relaxed mid-spread, calibrated to max ~0.24
              targetEe = Math.min(0.24, (targetAa * 0.35) + (targetIh * 0.65));
            }
          }

          // Asymmetric smoothing: fast attack (opens quickly ~32/s), smooth decay (closes gently ~16/s)
          const attackRate = 34.0;
          const decayRate = 16.0;
          const smoothViseme = (curr, target) => {
            const rate = target > curr ? attackRate : decayRate;
            return curr + (target - curr) * Math.min(1.0, dt * rate);
          };

          smoothedAa = smoothViseme(smoothedAa, targetAa);
          smoothedIh = smoothViseme(smoothedIh, targetIh);
          smoothedOu = smoothViseme(smoothedOu, targetOu);
          smoothedEe = smoothViseme(smoothedEe, targetEe);
          smoothedOh = smoothViseme(smoothedOh, targetOh);

          if (setVisemeLevels) {
            setVisemeLevels({
              aa: smoothedAa,
              ih: smoothedIh,
              ou: smoothedOu,
              ee: smoothedEe,
              oh: smoothedOh,
              intensity: normalized
            });
          }
        } else {
          smoothedAa = 0;
          smoothedIh = 0;
          smoothedOu = 0;
          smoothedEe = 0;
          smoothedOh = 0;
          if (setAudioLevel) setAudioLevel(0);
          if (setVisemeLevels) setVisemeLevels(null);
        }
        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) {
      console.warn("Failed to initialize Web Audio API:", e);
    }
  }, [setAudioLevel, setVisemeLevels]);

  const stopAllPlayback = useCallback(() => {
    console.log("[Playback] stopAllPlayback triggered.");

    if (stopSpeechRecognition) {
      stopSpeechRecognition(true);
    }

    if (micActivationTimeoutRef.current) {
      clearTimeout(micActivationTimeoutRef.current);
      micActivationTimeoutRef.current = null;
    }

    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isNativeSpeakingRef.current = false;
    hasReceivedAudioRef.current = false;

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.onplay = null;
      } catch (e) {
        console.warn("Error stopping HTML5 audio:", e);
      }
    }

    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = null;
    }

    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      console.warn("Error cancelling native speech synthesis:", e);
    }
    if (nativeSpeechIntervalRef.current) {
      clearInterval(nativeSpeechIntervalRef.current);
      nativeSpeechIntervalRef.current = null;
    }

    setCurrentSpeechText('');
    if (setAudioLevel) setAudioLevel(0);
    if (setVisemeLevels) setVisemeLevels(null);
    // Preserve active LLM or mood-guided facial expression instead of forcing blank neutral

    if (updateListeningStateGlobal) updateListeningStateGlobal();
  }, [stopSpeechRecognition, setAudioLevel, setVisemeLevels, updateListeningStateGlobal]);

  const playNextAudioRef = useRef(null);

  const playVoiceResponse = useCallback((audioUrl, speechText, forcedExpression = null) => {
    initAudioAnalyser();

    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = null;
    }

    const expr = forcedExpression || detectExpression(speechText);
    if (setAvatarExpression) setAvatarExpression(expr);

    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    isPlayingRef.current = true;

    const triggerNext = () => {
      if (playNextAudioRef.current) {
        playNextAudioRef.current();
      }
    };

    if (muteVoiceRef.current || !audioRef.current) {
      setCurrentSpeechText(stripAnimationTags(speechText));
      if (setIsThinking) setIsThinking(false);

      const readingDelay = Math.max(2000, speechText.length * 60);
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = setTimeout(triggerNext, readingDelay);
      return;
    }

    try {
      audioRef.current.volume = voiceVolumeRef.current;
      if (profile?.settings?.audio_output_device && typeof audioRef.current.setSinkId === 'function') {
        const targetSink = profile?.settings?.audio_output_device === 'default' ? '' : (profile?.settings?.audio_output_device || '');
        audioRef.current.setSinkId(targetSink).catch(() => {});
      }
      audioRef.current.src = audioUrl;
      audioRef.current.load();
      audioRef.current.playbackRate = 1.0;

      audioRef.current.onloadedmetadata = () => {
        if (audioRef.current) {
          audioRef.current.playbackRate = 1.0;
        }
      };

      audioRef.current.onplay = () => {
        if (audioRef.current) {
          audioRef.current.playbackRate = 1.0;
        }
        setCurrentSpeechText(stripAnimationTags(speechText));
        if (setIsThinking) setIsThinking(false);
        if (updateListeningStateGlobal) updateListeningStateGlobal();
      };

      audioRef.current.onended = () => {
        triggerNext();
      };

      audioRef.current.onerror = (e) => {
        console.warn("[Playback] Audio element failed to load voice clip:", e);
        const readingDelay = Math.max(1500, speechText.length * 60);
        if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = setTimeout(triggerNext, readingDelay);
      };

      audioRef.current.play().catch(err => {
        console.warn("[Playback] Autoplay blocked. Displaying subtitles and using fallback timer.", err);
        const readingDelay = Math.max(1500, speechText.length * 60);
        if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = setTimeout(triggerNext, readingDelay);
      });
    } catch (err) {
      console.error("[Playback] Audio trigger error:", err);
      const readingDelay = Math.max(1500, speechText.length * 60);
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = setTimeout(triggerNext, readingDelay);
    }
  }, [initAudioAnalyser, setAvatarExpression, setIsThinking, updateListeningStateGlobal]);

  const playNextAudio = useCallback(() => {
    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = null;
    }

    if (audioQueueRef.current.length === 0) {
      if (ttsStreamActiveRef.current) {
        console.log("[Playback] Queue empty but stream still active. Buffering next chunks...");
        isPlayingRef.current = false;
        if (updateListeningStateGlobal) updateListeningStateGlobal();
      } else {
        console.log("[Playback] Playback completed. Returning to idle state.");
        isPlayingRef.current = false;
        hasReceivedAudioRef.current = false;
        if (setAudioLevel) setAudioLevel(0);
        if (setVisemeLevels) setVisemeLevels(null);

        bubbleTimeoutRef.current = setTimeout(() => {
          setCurrentSpeechText('');
        }, 2000);

        if (isVoiceCommandModeRef && isVoiceCommandModeRef.current && startSessionTimeout) {
          if (systemMessageActiveRef.current) {
            systemMessageActiveRef.current = false;
          } else {
            startSessionTimeout();
          }
        }

        if (micActivationTimeoutRef.current) clearTimeout(micActivationTimeoutRef.current);
        micActivationTimeoutRef.current = setTimeout(() => {
          micActivationTimeoutRef.current = null;
          if (updateListeningStateGlobal) updateListeningStateGlobal();
        }, 700);
      }
      return;
    }

    isPlayingRef.current = true;
    const nextChunk = audioQueueRef.current.shift();
    playVoiceResponse(nextChunk.url, nextChunk.text);
  }, [setAudioLevel, setVisemeLevels, updateListeningStateGlobal, isVoiceCommandModeRef, startSessionTimeout, playVoiceResponse]);

  playNextAudioRef.current = playNextAudio;

  const queueAudioChunk = useCallback((audioUrl, speechText, index) => {
    // Pre-flight: check for 202 X-TTS-Fallback:web sentinel (cloud TTS failure → browser fallback)
    fetch(audioUrl)
      .then(resp => {
        if (resp.status === 202 && resp.headers.get('X-TTS-Fallback') === 'web') {
          // Cloud TTS failed — use browser speechSynthesis as fallback
          console.warn('[TTS] Cloud provider failed, using browser speechSynthesis fallback. Error:', resp.headers.get('X-TTS-Error') || '(unknown)');
          hasReceivedAudioRef.current = true; // prevent duplicate native fallback at stream_done
          if (speakTextNativelyRef.current) speakTextNativelyRef.current(speechText);
          return;
        }
        // Normal audio — create blob URL so we don't re-fetch
        return resp.blob().then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          audioQueueRef.current.push({ url: blobUrl, text: speechText, index: index });
          audioQueueRef.current.sort((a, b) => a.index - b.index);
          if (!isPlayingRef.current) {
            isPlayingRef.current = true;
            playNextAudio();
          }
        });
      })
      .catch(err => {
        // Network error — fall back to native TTS
        console.warn('[TTS] Audio fetch failed, using browser speechSynthesis fallback:', err);
        hasReceivedAudioRef.current = true;
        if (speakTextNativelyRef.current) speakTextNativelyRef.current(speechText);
      });
  }, [playNextAudio]);


  const speakTextNatively = useCallback((text, forcedExpression = null) => {
    window.speechSynthesis.cancel();
    if (nativeSpeechIntervalRef.current) {
      clearInterval(nativeSpeechIntervalRef.current);
      nativeSpeechIntervalRef.current = null;
    }

    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = null;
    }

    const cleanText = cleanTextForTTS(stripAnimationTags(getSpeechFriendlyText(text)));
    if (!cleanText) {
      if (setAudioLevel) setAudioLevel(0);
      if (setVisemeLevels) setVisemeLevels(null);
      isNativeSpeakingRef.current = false;
      if (setIsThinking) setIsThinking(false);
      setTtsStreamActive(false);
      if (updateListeningStateGlobal) updateListeningStateGlobal();
      return;
    }

    isNativeSpeakingRef.current = true;
    if (updateListeningStateGlobal) updateListeningStateGlobal();

    const expr = forcedExpression || detectExpression(text);
    if (setAvatarExpression) setAvatarExpression(expr);

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.volume = voiceVolumeRef.current;

    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v =>
      (v.lang.startsWith('en') && (v.name.includes('Google US English') || v.name.includes('Microsoft Zira') || v.name.includes('Natural') || v.name.includes('Female') || v.name.toLowerCase().includes('sally') || v.name.toLowerCase().includes('susan'))) ||
      (v.lang.startsWith('ja') && v.name.toLowerCase().includes('haruka'))
    ) || voices.find(v => v.lang.startsWith('en'));

    if (femaleVoice) {
      utterance.voice = femaleVoice;
    }

    const storedRate = profile?.settings?.tts_rate === 'auto'
      ? 1.0
      : parseFloat(profile?.settings?.tts_rate || '1.0');
    utterance.rate = isNaN(storedRate) ? 1.05 : storedRate;
    utterance.pitch = 1.1;

    utterance.onstart = () => {
      isNativeSpeakingRef.current = true;
      setCurrentSpeechText(stripAnimationTags(text));
      if (setIsThinking) setIsThinking(false);
      setTtsStreamActive(false);
      if (updateListeningStateGlobal) updateListeningStateGlobal();

      if (nativeSpeechIntervalRef.current) clearInterval(nativeSpeechIntervalRef.current);

      nativeSpeechIntervalRef.current = setInterval(() => {
        const isSpk = Math.random() > 0.35;
        const vol = isSpk ? 0.2 + Math.random() * 0.4 : 0;
        if (setAudioLevel) setAudioLevel(vol);
        if (setVisemeLevels) {
          if (isSpk) {
            const vowels = [
              { aa: 0.38, ih: 0.05, ou: 0.0, ee: 0.1, oh: 0.1 },
              { aa: 0.1, ih: 0.35, ou: 0.0, ee: 0.25, oh: 0.0 },
              { aa: 0.1, ih: 0.0, ou: 0.28, ee: 0.0, oh: 0.32 },
              { aa: 0.05, ih: 0.18, ou: 0.0, ee: 0.05, oh: 0.0 }
            ];
            const pick = vowels[Math.floor(Math.random() * vowels.length)];
            setVisemeLevels({ ...pick, intensity: vol });
          } else {
            setVisemeLevels(null);
          }
        }
      }, 120);
    };

    utterance.onend = () => {
      isNativeSpeakingRef.current = false;
      if (systemMessageActiveRef.current) systemMessageActiveRef.current = false;
      if (setAudioLevel) setAudioLevel(0);
      if (setVisemeLevels) setVisemeLevels(null);
      if (setIsThinking) setIsThinking(false);
      setTtsStreamActive(false);
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }

      bubbleTimeoutRef.current = setTimeout(() => {
        setCurrentSpeechText('');
      }, 2000);

      if (updateListeningStateGlobal) updateListeningStateGlobal();
    };

    utterance.onerror = (e) => {
      console.warn("[Native TTS] utterance error:", e);
      isNativeSpeakingRef.current = false;
      if (systemMessageActiveRef.current) systemMessageActiveRef.current = false;
      if (setAudioLevel) setAudioLevel(0);
      if (setVisemeLevels) setVisemeLevels(null);
      if (setIsThinking) setIsThinking(false);
      setTtsStreamActive(false);
      setCurrentSpeechText('');
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }
      if (updateListeningStateGlobal) updateListeningStateGlobal();
    };

    window.speechSynthesis.speak(utterance);
  }, [profile, setAudioLevel, setVisemeLevels, setAvatarExpression, setIsThinking, updateListeningStateGlobal]);

  // Wire forward ref so queueAudioChunk can call speakTextNatively without circular dep
  speakTextNativelyRef.current = speakTextNatively;

  const speakSystemMessage = useCallback((text, expression = null) => {
    systemMessageActiveRef.current = true;
    if (expression && setAvatarExpression) setAvatarExpression(expression);

    // If the message contains only action descriptions/asterisks (e.g. "*waves hello*") with no speakable text, skip TTS synthesis entirely
    const cleanSpoken = cleanTextForTTS(stripAnimationTags(getSpeechFriendlyText(text)));
    if (!cleanSpoken) {
      systemMessageActiveRef.current = false;
      if (setIsThinking) setIsThinking(false);
      setTtsStreamActive(false);
      return;
    }

    if (muteVoiceRef.current) {
      if (setIsThinking) setIsThinking(false);
      setTtsStreamActive(false);
      return;
    }
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      window.speechSynthesis.cancel();
      hasReceivedAudioRef.current = false;
      setTtsStreamActive(true);
      ws.send(JSON.stringify({ type: 'tts_only', text, expression }));
    } else {
      speakTextNatively(text, expression);
    }
  }, [setAvatarExpression, setIsThinking, socketRef, speakTextNatively, setTtsStreamActive]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    muteVoice,
    setMuteVoice,
    ttsStreamActive,
    setTtsStreamActive,
    currentSpeechText,
    setCurrentSpeechText,
    audioQueueRef,
    isPlayingRef,
    hasReceivedAudioRef,
    isNativeSpeakingRef,
    voiceVolume,
    setVoiceVolume,
    voiceVolumeRef,
    initAudioAnalyser,
    stopAllPlayback,
    playVoiceResponse,
    queueAudioChunk,
    speakTextNatively,
    speakSystemMessage,
    ttsStreamActiveRef
  };
}
