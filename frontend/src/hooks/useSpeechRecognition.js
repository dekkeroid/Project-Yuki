import { useState, useRef, useEffect, useCallback } from 'react';
import { SLASH_COMMANDS } from '../constants';

export function useSpeechRecognition(options = {}) {
  const {
    API_BASE,
    isThinkingRef,
    ttsStreamActiveRef,
    hasReceivedAudioRef,
    isNativeSpeakingRef,
    isPlayingRef,
    sessionTimeoutRef,
    setIsSessionActive,
    muteVoice,
    setMessages,
    setConfirmModal,
    desktopInputRef,
    stopAllPlayback,
    updateListeningStateGlobal, // In case we need to trigger an update outside
    logToTerminal,
    sendMessageText,
    isSessionActiveRef,
    speakSystemMessage
  } = options;

  const [isTranscribing, setIsTranscribingState] = useState(false);
  const isTranscribingRef = useRef(false);
  const setIsTranscribing = useCallback((val) => {
    isTranscribingRef.current = val;
    setIsTranscribingState(val);
  }, []);

  const [isListening, setIsListening] = useState(false);

  // Signal backend when listening mode changes (prevents whisper unload during active mic)
  useEffect(() => {
    if (!API_BASE) return;
    const msg = isListening ? 'listening_mode_on' : 'listening_mode_off';
    fetch(`${API_BASE}/api/speech/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    }).catch(() => {});
  }, [isListening, API_BASE]);
  const [isTalkMode, setIsTalkModeState] = useState(false);
  const isTalkModeRef = useRef(false);
  const setIsTalkMode = useCallback((val) => {
    isTalkModeRef.current = val;
    setIsTalkModeState(val);
  }, []);

  const [isVoiceCommandMode, setIsVoiceCommandModeState] = useState(false);
  const isVoiceCommandModeRef = useRef(false);
  const setIsVoiceCommandMode = useCallback((val) => {
    isVoiceCommandModeRef.current = val;
    setIsVoiceCommandModeState(val);
  }, []);

  const isSpeechRecActiveRef = useRef(false);

  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicDeviceId, setSelectedMicDeviceIdState] = useState('default');
  const selectedMicDeviceIdRef = useRef('default');
  const setSelectedMicDeviceId = useCallback((val) => {
    selectedMicDeviceIdRef.current = val;
    setSelectedMicDeviceIdState(val);
  }, []);

  const [preferHeadsetMic, setPreferHeadsetMic] = useState(() => {
    return localStorage.getItem('yuki-prefer-headset') !== 'false';
  });

  const [vadThreshold, setVadThresholdState] = useState(() => {
    const activeDevice = selectedMicDeviceIdRef.current || 'default';
    const stored = localStorage.getItem(`yuki-vad-threshold-${activeDevice}`);
    if (stored !== null && !isNaN(parseFloat(stored))) return parseFloat(stored);
    const optVal = options.vadThreshold;
    if (optVal !== undefined && typeof optVal === 'number' && optVal > 0) return optVal;
    return parseFloat(localStorage.getItem('yuki-vad-threshold') || '0.03');
  });
  const vadThresholdRef = useRef(vadThreshold);

  const setVadThreshold = useCallback((val) => {
    vadThresholdRef.current = val;
    setVadThresholdState(val);
    const activeDevice = selectedMicDeviceIdRef.current || 'default';
    try {
      localStorage.setItem(`yuki-vad-threshold-${activeDevice}`, val.toString());
      localStorage.setItem('yuki-vad-threshold', val.toString());
    } catch (e) {}
  }, []);

  const [silenceTimeout, setSilenceTimeoutState] = useState(() => {
    const activeDevice = selectedMicDeviceIdRef.current || 'default';
    const stored = localStorage.getItem(`yuki-silence-timeout-${activeDevice}`);
    if (stored !== null && !isNaN(parseInt(stored, 10))) return parseInt(stored, 10);
    const optVal = options.silenceTimeout;
    if (optVal !== undefined && typeof optVal === 'number' && optVal > 0) return optVal;
    return parseInt(localStorage.getItem('yuki-silence-timeout') || '800', 10);
  });
  const silenceTimeoutRef = useRef(silenceTimeout);

  const setSilenceTimeout = useCallback((val) => {
    silenceTimeoutRef.current = val;
    setSilenceTimeoutState(val);
    const activeDevice = selectedMicDeviceIdRef.current || 'default';
    try {
      localStorage.setItem(`yuki-silence-timeout-${activeDevice}`, val.toString());
      localStorage.setItem('yuki-silence-timeout', val.toString());
    } catch (e) {}
  }, []);

  useEffect(() => {
    const activeDevice = selectedMicDeviceId || 'default';
    const storedVad = localStorage.getItem(`yuki-vad-threshold-${activeDevice}`);
    const storedTimeout = localStorage.getItem(`yuki-silence-timeout-${activeDevice}`);

    // Reload VAD threshold for device (profile setting takes precedence over localStorage)
    let targetVad = 0.03;
    if (options.vadThreshold !== undefined && typeof options.vadThreshold === 'number' && options.vadThreshold > 0) {
      targetVad = options.vadThreshold;
    } else if (storedVad !== null && !isNaN(parseFloat(storedVad))) {
      targetVad = parseFloat(storedVad);
    } else if (localStorage.getItem('yuki-vad-threshold') !== null && !isNaN(parseFloat(localStorage.getItem('yuki-vad-threshold')))) {
      targetVad = parseFloat(localStorage.getItem('yuki-vad-threshold'));
    }
    vadThresholdRef.current = targetVad;
    setVadThresholdState(targetVad);

    // Reload Silence Timeout for device (profile setting takes precedence over localStorage)
    let targetTimeout = 800;
    if (options.silenceTimeout !== undefined && typeof options.silenceTimeout === 'number' && options.silenceTimeout > 0) {
      targetTimeout = options.silenceTimeout;
    } else if (storedTimeout !== null && !isNaN(parseInt(storedTimeout, 10))) {
      targetTimeout = parseInt(storedTimeout, 10);
    } else if (localStorage.getItem('yuki-silence-timeout') !== null && !isNaN(parseInt(localStorage.getItem('yuki-silence-timeout'), 10))) {
      targetTimeout = parseInt(localStorage.getItem('yuki-silence-timeout'), 10);
    }
    silenceTimeoutRef.current = targetTimeout;
    setSilenceTimeoutState(targetTimeout);
  }, [selectedMicDeviceId, options.vadThreshold, options.silenceTimeout]);

  // Dynamically update active microphone hardware constraints when AGC, Echo Cancellation, or Noise Suppression change
  useEffect(() => {
    if (micStreamRef.current) {
      const audioTrack = micStreamRef.current.getAudioTracks()[0];
      if (audioTrack && audioTrack.applyConstraints) {
        audioTrack.applyConstraints({
          autoGainControl: options.sttAutoGainControl ?? true,
          echoCancellation: options.sttEchoCancellation ?? true,
          noiseSuppression: options.sttNoiseSuppression ?? true
        }).catch(e => console.warn('[STT] Dynamic mic constraints update skipped:', e));
      }
    }
  }, [options.sttAutoGainControl, options.sttEchoCancellation, options.sttNoiseSuppression]);

  const [useLocalWhisper, setUseLocalWhisperState] = useState(true);
  const useLocalWhisperRef = useRef(true);
  const setUseLocalWhisper = useCallback((val) => {
    useLocalWhisperRef.current = val;
    setUseLocalWhisperState(val);
  }, []);

  const [whisperModel, setWhisperModelState] = useState(options.whisperModel || 'base');
  const whisperModelRef = useRef(options.whisperModel || 'base');
  const setWhisperModel = useCallback((val) => {
    whisperModelRef.current = val;
    setWhisperModelState(val);
  }, []);

  useEffect(() => {
    if (options.whisperModel) {
      whisperModelRef.current = options.whisperModel;
      setWhisperModelState(options.whisperModel);
    }
  }, [options.whisperModel]);

  const [hotkeyListening, setHotkeyListeningState] = useState(() => {
    const saved = localStorage.getItem('yuki-hotkey-listening');
    return saved !== 'false';
  });
  const hotkeyListeningRef = useRef(hotkeyListening);
  const setHotkeyListening = useCallback((val) => {
    hotkeyListeningRef.current = val;
    setHotkeyListeningState(val);
  }, []);

  // Refs for recording
  const audioChunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const isRecordingRef = useRef(false);
  const micAudioContextRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const micStreamRef = useRef(null);
  const vadActiveRef = useRef(false);
  const vadActivationTimeRef = useRef(null);
  const vadSpeakingRef = useRef(false);
  const vadSilenceStartRef = useRef(null);
  const maxRecordingTimeoutRef = useRef(null);
  const recognitionRef = useRef(null);
  const sttTransportModeRef = useRef(options.sttTransportMode || 'websocket_stream');
  
  useEffect(() => {
    if (options.sttTransportMode) {
      sttTransportModeRef.current = options.sttTransportMode;
    }
  }, [options.sttTransportMode]);

  const bargeInSensitivityRef = useRef(options.bargeInSensitivity ?? 1.0);
  useEffect(() => {
    if (options.bargeInSensitivity !== undefined && typeof options.bargeInSensitivity === 'number') {
      bargeInSensitivityRef.current = options.bargeInSensitivity;
    }
  }, [options.bargeInSensitivity]);

  const allowVoiceBargeInRef = useRef(options.allowVoiceBargeIn ?? false);
  useEffect(() => {
    allowVoiceBargeInRef.current = options.allowVoiceBargeIn ?? false;
  }, [options.allowVoiceBargeIn]);

  const wasBargeInRef = useRef(false);

  const logSTTStatus = (message) => {
    console.log(`[STT Coordinator] ${message}`);
  };

  const shouldListen = () => {
    const modeActive = isTalkModeRef.current || isVoiceCommandModeRef.current;
    let yukiBusy = isThinkingRef.current || isTranscribingRef.current;
    if (!allowVoiceBargeInRef.current) {
      yukiBusy = yukiBusy || isPlayingRef.current || ttsStreamActiveRef.current || isNativeSpeakingRef.current || hasReceivedAudioRef.current;
    }
    return modeActive && !yukiBusy;
  };

  const clearContinuedConversationSession = () => {
    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
    setIsSessionActive(false);
  };

  const startSessionTimeout = () => {
    if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
    setIsSessionActive(true);
    
    // Parse value; default to 120s if null/undefined, but allow 0 to mean 'Never'
    let timeoutSec = options.continuedSessionTimeoutSec;
    if (timeoutSec === undefined || timeoutSec === null) {
      const stored = localStorage.getItem('yuki-continued-session-timeout');
      timeoutSec = stored !== null ? parseInt(stored, 10) : 120;
    }
    
    if (timeoutSec === 0) {
      console.log(`[STT] Continued Conversation session set to NEVER timeout.`);
      return; // Do not start a timer
    }
    
    const timeoutMs = timeoutSec * 1000;
    sessionTimeoutRef.current = setTimeout(() => {
      const reasonStr = `Continuous session timed out after ${timeoutSec}s of idle silence`;
      console.log(`[STT] ${reasonStr}.`);
      if (logToTerminal) logToTerminal(`[STT] Continuous listening mode turned OFF (Reason: ${reasonStr})`);
      setIsSessionActive(false);
      if (setMessages) setMessages((prev) => [...prev, { role: 'assistant', content: "Continuous listening is off. Just call my name if you need me again." }]);
      if (speakSystemMessage) speakSystemMessage("Continuous listening is off. Just call my name if you need me again.");
      updateListeningState();
    }, timeoutMs);
  };

  const processSTTTranscript = (transcript, sttTimeMs = null, sttTiming = null, isBargeIn = false) => {
    if (!transcript || !transcript.trim()) {
      if (isVoiceCommandModeRef.current && isSessionActiveRef && isSessionActiveRef.current) {
        startSessionTimeout();
      }
      updateListeningState();
      return;
    }

    // Clean punctuation for command checks
    const cleaned = transcript.trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
    const lower = cleaned.toLowerCase().trim();
    logSTTStatus(`Processing transcript: "${transcript}" (cleaned: "${cleaned}", isVoiceCommandMode=${isVoiceCommandModeRef.current}, isTalkMode=${isTalkModeRef.current}, isBargeIn=${isBargeIn})`);

    // If voice command mode is active
    if (isVoiceCommandModeRef.current) {
      const isSession = (isSessionActiveRef ? isSessionActiveRef.current : false) || isBargeIn;

      // ─── Extensible Voice Commands List ───
      const voiceCommands = [
        {
          name: 'Stop Listening',
          match: () => lower.includes("yuki stop listening") ||
            lower === "stop listening" ||
            (isSession && (lower === "stop" || lower === "exit" || lower === "quit")),
          action: () => {
            logSTTStatus("Voice Command Mode stop command detected.");
            isVoiceCommandModeRef.current = false;
            setIsVoiceCommandMode(false);
            clearContinuedConversationSession();
            stopSpeechRecognition();
            setIsListening(false);
            if (setMessages) setMessages((prev) => [...prev, { role: 'assistant', content: "listening mode off" }]);
          }
        },
        {
          name: 'Toggle Mute',
          match: () => lower.includes("toggle mute") || lower.includes("mute your voice") || lower.includes("unmute your voice"),
          action: () => {
            if (options.toggleMute) options.toggleMute();
            startSessionTimeout();
            if (setMessages) setMessages((prev) => [...prev, { role: 'assistant', content: "toggled mute" }]);
          }
        }
      ];

      for (const cmd of voiceCommands) {
        if (cmd.match()) {
          cmd.action();
          return; // Command executed, do not pass to LLM
        }
      }

      // Hotword detection logic for Voice Command Mode
      const triggerWords = ["yuki", "yooki", "yuuki", "youkey", "uk"];
      let hasTriggerWord = false;
      let prompt = transcript.trim();

      for (const word of triggerWords) {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(prompt)) {
          hasTriggerWord = true;
          if (!isSession) {
            prompt = prompt.replace(regex, "").trim();
          }
          break;
        }
      }

      if (!hasTriggerWord && !isSession) {
        logSTTStatus("Voice Command mode: Ignored because trigger word missing and no session active.");
        updateListeningState();
        return;
      }

      if (!prompt) {
        logSTTStatus("Voice Command mode: Trigger word heard, but no prompt attached. Opening session.");
        startSessionTimeout();
        if (setMessages) setMessages((prev) => [...prev, { role: 'assistant', content: "yes?" }]);
        if (speakSystemMessage) speakSystemMessage("yes?");
        updateListeningState();
        return;
      }

      clearContinuedConversationSession();
      if (sendMessageText) sendMessageText(prompt, { stt_time_ms: sttTimeMs, stt_timing: sttTiming });
      return;
    }

    // Default Talk Mode
    logSTTStatus(`Talk Mode normal transcript: "${transcript}"`);
    if (sendMessageText) sendMessageText(transcript, { stt_time_ms: sttTimeMs, stt_timing: sttTiming });
  };

  const primeSelectedMicDevice = async () => {
    const deviceId = selectedMicDeviceIdRef.current;
    if (!deviceId) return; // Use system default
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId }
        }
      });
      stream.getTracks().forEach(track => track.stop());
    } catch (e) {
      console.warn('Could not prime mic device:', e);
    }
  };

  const initSpeechRecognition = () => {
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      console.warn("Native SpeechRecognition not supported in this browser.");
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0])
        .map(result => result.transcript)
        .join('');
      logSTTStatus(`(Native STT) result: "${transcript}"`);
      processSTTTranscript(transcript);
    };

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('Native SpeechRecognition error', event.error);
      }
    };

    recognition.onend = () => {
      logSTTStatus("(Native STT) session ended.");
      isSpeechRecActiveRef.current = false;
      setIsListening(false);
      updateListeningState();
    };

    recognitionRef.current = recognition;
  };

  const startSpeechRecognition = async () => {
    if (isSpeechRecActiveRef.current) return;
    const transportMode = sttTransportModeRef.current || 'websocket_stream';
    const transportDesc = transportMode === 'websocket_stream' ? 'WebSocket Real-Time Stream (~450ms)' : 'HTTP Audio Chunking (~2.5s)';
    if (logToTerminal) logToTerminal(`[STT] Microphone listening mode turned ON [Protocol: ${transportDesc}]`);
    logSTTStatus(`Microphone listening mode turned ON [Protocol: ${transportDesc}]`);

    if (useLocalWhisperRef.current) {
      try {
        isSpeechRecActiveRef.current = true;
        setIsListening(true);
        isRecordingRef.current = true;

        const deviceId = selectedMicDeviceIdRef.current;
        const agcValue = options.sttAutoGainControl ?? true;
        const ecValue = options.sttEchoCancellation ?? true;
        const nsValue = options.sttNoiseSuppression ?? true;
        const constraints = {
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: ecValue,
            noiseSuppression: nsValue,
            autoGainControl: agcValue
          }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (!isSpeechRecActiveRef.current) {
          console.log("[STT] startSpeechRecognition aborted during getUserMedia. Cleaning up stream.");
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        const audioTrack = stream.getAudioTracks()[0];
        const trackLabel = audioTrack ? audioTrack.label : 'Unknown Mic';
        const trackState = audioTrack ? audioTrack.readyState : 'none';
        const trackMuted = audioTrack ? audioTrack.muted : false;
        console.log(`[STT-DIAG] Mic stream opened: "${trackLabel}" | readyState=${trackState} | muted=${trackMuted}`);

        micStreamRef.current = stream;

        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];
        const recordingStartTime = Date.now();
        let chunkCount = 0;

        mediaRecorder.onerror = (errEvent) => {
          console.error("[STT-DIAG] MediaRecorder error event:", errEvent.error || errEvent);
        };

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunkCount++;
            audioChunksRef.current.push(event.data);
            const totalBytes = audioChunksRef.current.reduce((acc, c) => acc + c.size, 0);
            console.log(`[STT-DIAG] MediaRecorder Chunk #${chunkCount} (+${event.data.size} bytes, total=${totalBytes} bytes @ ${Date.now() - recordingStartTime}ms)`);
          }
        };

        mediaRecorder.onstop = async () => {
          const totalRecordingDurationMs = Date.now() - recordingStartTime;
          console.log(`[STT-DIAG] MediaRecorder stopped. Total active duration: ${totalRecordingDurationMs}ms, Chunks: ${audioChunksRef.current.length}`);

          if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(track => track.stop());
            micStreamRef.current = null;
          }

          if (micAudioContextRef.current) {
            try { micAudioContextRef.current.close(); } catch (e) { }
            micAudioContextRef.current = null;
          }
          micAnalyserRef.current = null;

          if (!isRecordingRef.current) {
            console.log("[STT] Recording aborted. Ignoring data.");
            setIsListening(false);
            isSpeechRecActiveRef.current = false;
            return;
          }

          setIsTranscribing(true);
          isRecordingRef.current = false;
          setIsListening(false);
          isSpeechRecActiveRef.current = false;

          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          console.log(`[STT-DIAG] Pre-flight AudioBlob: size=${audioBlob.size} bytes, type='${audioBlob.type}', duration=${totalRecordingDurationMs}ms`);

          if (audioChunksRef.current.length === 0 || audioBlob.size < 4000) {
            logSTTStatus(`[STT] Ignored short clip (${audioBlob.size} bytes, ${totalRecordingDurationMs}ms).`);
            setIsTranscribing(false);
            updateListeningState();
            return;
          }

          if (stopAllPlayback) stopAllPlayback();

          const sttStartTime = Date.now();
          let res;
          try {
            const activeModelName = whisperModelRef.current;
            logSTTStatus(`Transcribing (${audioBlob.size} bytes) with model '${activeModelName}'...`);

            const formData = new FormData();
            formData.append("file", audioBlob, "speech.webm");
            formData.append("model", activeModelName);

            res = await fetch(`${API_BASE}/api/speech/transcribe`, {
              method: "POST",
              body: formData
            });

            if (!res.ok) {
              const errorBody = await res.text().catch(() => '');
              if (res.status === 503) {
                // Cloud STT provider error — show specific message, no fallback
                const cloudErrMsg = errorBody || `Cloud STT provider returned error ${res.status}`;
                logSTTStatus(`Cloud STT failed: ${cloudErrMsg}`);
                if (logToTerminal) logToTerminal(`[STT] Cloud provider error: ${cloudErrMsg}`);
                setIsTranscribing(false);
                if (setMessages) {
                  setMessages((prev) => [...prev, {
                    role: 'system',
                    content: `⚠️ Speech-to-Text Error: ${cloudErrMsg}`
                  }]);
                }
                updateListeningState();
                return;
              }
              throw new Error(`Server returned code ${res.status}${errorBody ? ': ' + errorBody.slice(0, 120) : ''}`);
            }
            const data = await res.json();
            const sttDurationMs = Date.now() - sttStartTime;
            logSTTStatus(`Transcribed: "${data.text}" in ${sttDurationMs}ms`);
            if (logToTerminal) logToTerminal(`[STT] Transcribed: "${data.text}" (${sttDurationMs}ms)`);

            setIsTranscribing(false);
            const isBargeInTarget = wasBargeInRef.current || isPlayingRef?.current || ttsStreamActiveRef?.current;
            wasBargeInRef.current = false;

            if (data.text && data.text.trim()) {
              if ((isPlayingRef?.current || ttsStreamActiveRef?.current) && stopAllPlayback) {
                logSTTStatus("Whisper confirmed valid speech transcript — interrupting active Yuki speech playback (barge-in)");
                if (logToTerminal) logToTerminal(`[STT] Barge-in verified: "${data.text.trim()}" — interrupting playback`);
                stopAllPlayback();
              }
              const sttTimingStats = {
                total_stt_ms: sttDurationMs,
                whisper_ms: data.timing?.whisper_ms || sttDurationMs,
                browser_vad_ms: silenceTimeoutRef.current || 350
              };
              processSTTTranscript(data.text, sttDurationMs, sttTimingStats, isBargeInTarget);
            } else {
              logSTTStatus("Whisper returned empty transcript — ignoring noise/barge-in trigger");
              updateListeningState();
            }
          } catch (e) {
            let errMsg = e.message;
            logSTTStatus(`STT transcription failed: ${errMsg}`);
            setIsTranscribing(false);
            if (setMessages) {
              setMessages((prev) => [...prev, {
                role: 'system',
                content: `⚠️ Speech-to-Text failed. Please verify your backend server is online.`
              }]);
            }
            updateListeningState();
          }

        };

        mediaRecorder.start(250);
        logSTTStatus("Listening...");

        const micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const micAnalyser = micAudioCtx.createAnalyser();
        micAnalyser.fftSize = 2048;
        const micSource = micAudioCtx.createMediaStreamSource(stream);
        micSource.connect(micAnalyser);

        micAudioContextRef.current = micAudioCtx;
        micAnalyserRef.current = micAnalyser;
        console.log(`[STT-DIAG] AudioContext created | state=${micAudioCtx.state} | sampleRate=${micAudioCtx.sampleRate}Hz`);

        vadSpeakingRef.current = false;
        vadSilenceStartRef.current = null;
        vadActivationTimeRef.current = Date.now();
        vadActiveRef.current = true;
        let vadSustainedStart = null;

        const bufferLength = micAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        let sampleCount = 0;

        const checkMicVolume = () => {
          if (!vadActiveRef.current || !isRecordingRef.current || !micAnalyserRef.current) return;

          sampleCount++;
          micAnalyserRef.current.getByteTimeDomainData(dataArray);
          
          let mean = 0;
          let minVal = 255;
          let maxVal = 0;
          let zeroCount = 0;
          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i];
            mean += v;
            if (v < minVal) minVal = v;
            if (v > maxVal) maxVal = v;
            if (v === 0) zeroCount++;
          }
          mean /= bufferLength;

          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            const val = (dataArray[i] - mean) / 128.0;
            sum += val * val;
          }
          const rms = Math.sqrt(sum / bufferLength);
          const normalized = rms; // True RMS audio volume from 0.0 to 1.0

          if (options.updateAudioLevel) {
            options.updateAudioLevel(normalized);
          }

          const baseThreshold = vadThresholdRef.current;
          const sensitivityMult = bargeInSensitivityRef.current || 1.0;
          const isYukiSpeaking = (isPlayingRef?.current || ttsStreamActiveRef?.current);
          
          // Dynamic playback threshold boosting: raise threshold when Yuki is speaking to prevent speaker echo
          const micThreshold = isYukiSpeaking ? baseThreshold * 1.5 * sensitivityMult : baseThreshold;

          const silenceTimeoutMs = silenceTimeoutRef.current || 1000;
          const now = Date.now();
          const elapsedStream = now - vadActivationTimeRef.current;

          // Periodic sample diagnostics (every ~1s when idle)
          if (sampleCount % 35 === 0) {
            console.log(`[VAD-DIAG] @${elapsedStream}ms | RMS=${normalized.toFixed(4)} | Thresh=${micThreshold.toFixed(4)} | Min=${minVal} Max=${maxVal} Mean=${mean.toFixed(1)} Zeros=${zeroCount} | Speaking=${vadSpeakingRef.current}`);
          }

          if (normalized > micThreshold) {
            vadSilenceStartRef.current = null;
            if (vadSustainedStart === null) {
              vadSustainedStart = now;
              console.log(`[VAD-DIAG] Volume exceeded threshold (${normalized.toFixed(4)} > ${micThreshold.toFixed(4)}) at ${elapsedStream}ms. Starting 250ms sustain verification.`);
            }

            // Require 250ms of sustained speech energy to reject clicks, coughs, and transient noise
            if (elapsedStream > 150 && now - vadSustainedStart >= 250) {
              if (!vadSpeakingRef.current) {
                const sustainedDuration = now - vadSustainedStart;
                console.log(`[VAD-DIAG] >>> SPEECH ACTIVATED <<< at ${elapsedStream}ms | RMS=${normalized.toFixed(4)} (Threshold=${micThreshold.toFixed(4)}) | Sustained=${sustainedDuration}ms | Waveform: Min=${minVal} Max=${maxVal} Zeros=${zeroCount}`);
                logSTTStatus("Sustained user speech detected (250ms verified)");
                vadSpeakingRef.current = true;
                if (isPlayingRef?.current || ttsStreamActiveRef?.current) {
                  wasBargeInRef.current = true;
                  logSTTStatus("[STT] User speech started while Yuki was speaking — barge-in flagged");
                }

                // Start max recording timeout ONLY when speech actually begins
                if (maxRecordingTimeoutRef.current) {
                  clearTimeout(maxRecordingTimeoutRef.current);
                }
                const maxDurationSec = options.maxRecordingDurationSec || 120;
                const maxDurationMs = maxDurationSec * 1000;
                maxRecordingTimeoutRef.current = setTimeout(() => {
                  if (isRecordingRef.current && mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                    const reasonStr = `Maximum recording clip duration limit reached (${maxDurationSec}s speech safety cap)`;
                    logSTTStatus(`[STT] ${reasonStr}`);
                    stopSpeechRecognition(false, reasonStr);
                  }
                }, maxDurationMs);

                if (sessionTimeoutRef.current) {
                  clearTimeout(sessionTimeoutRef.current);
                  sessionTimeoutRef.current = null;
                }
              }
            }
          } else {
            vadSustainedStart = null;
            if (vadSpeakingRef.current) {
              if (vadSilenceStartRef.current === null) {
                vadSilenceStartRef.current = now;
                console.log(`[VAD-DIAG] Volume dropped below threshold (${normalized.toFixed(4)} <= ${micThreshold.toFixed(4)}). Starting silence timer (Limit: ${silenceTimeoutMs}ms).`);
              } else if (now - vadSilenceStartRef.current > silenceTimeoutMs) {
                const elapsedSilence = Math.round(now - vadSilenceStartRef.current);
                const reasonStr = `Silence Cutoff triggered (${elapsedSilence}ms silence > ${silenceTimeoutMs}ms limit)`;
                console.log(`[VAD-DIAG] >>> SILENCE CUTOFF TRIGGERED <<< at ${elapsedStream}ms | Elapsed Silence: ${elapsedSilence}ms | Current RMS: ${normalized.toFixed(4)} | Threshold: ${micThreshold.toFixed(4)}`);
                logSTTStatus(`[STT] ${reasonStr}`);
                stopSpeechRecognition(false, reasonStr);
                return;
              }
            }
          }

          setTimeout(checkMicVolume, 30);
        };

        checkMicVolume();

      } catch (e) {
        console.warn("[STT] Failed to start local Whisper recording:", e);
        if (logToTerminal) logToTerminal(`[STT Error] Could not access mic (${e.message}). Retrying in 400ms...`);
        isSpeechRecActiveRef.current = false;
        setIsListening(false);
        isRecordingRef.current = false;
        setTimeout(() => {
          updateListeningState();
        }, 400);
      }
    } else {
      if (!recognitionRef.current) return;
      try {
        isSpeechRecActiveRef.current = true;
        setIsListening(true);
        await primeSelectedMicDevice();
        recognitionRef.current.start();
        logSTTStatus("Listening (native)...");
      } catch (e) {
        console.warn("[STT] Failed to start native SpeechRecognition:", e);
        isSpeechRecActiveRef.current = false;
        setIsListening(false);
      }
    }
  };

  const stopSpeechRecognition = (forceAbort = false, reason = '') => {
    if (!isSpeechRecActiveRef.current && !isRecordingRef.current) return;
    const reasonDetail = reason ? ` (Reason: ${reason})` : forceAbort ? ' (forced abort)' : '';
    if (logToTerminal) logToTerminal(`[STT] Microphone listening mode turned OFF${reasonDetail}`);
    console.log(`[STT] Microphone listening mode turned OFF${reasonDetail}`);

    isSpeechRecActiveRef.current = false;
    if (forceAbort) {
      isRecordingRef.current = false;
    }

    if (useLocalWhisperRef.current) {
      if (maxRecordingTimeoutRef.current) {
        clearTimeout(maxRecordingTimeoutRef.current);
        maxRecordingTimeoutRef.current = null;
      }
      vadActiveRef.current = false;

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          console.warn("[STT] Error stopping MediaRecorder:", e);
        }
      } else {
        if (micStreamRef.current) {
          try {
            micStreamRef.current.getTracks().forEach(track => track.stop());
            micStreamRef.current = null;
          } catch (e) { }
        }
      }
    } else {
      if (!recognitionRef.current) return;
      try {
        if (forceAbort) {
          recognitionRef.current.abort();
        } else {
          recognitionRef.current.stop();
        }
      } catch (e) {
        console.warn("[STT] Failed to stop native SpeechRecognition:", e);
      }
    }
  };

  const updateListeningState = useCallback(() => {
    const targetListen = shouldListen();
    if (targetListen) {
      if (!isSpeechRecActiveRef.current && !isTranscribingRef.current) {
        startSpeechRecognition();
      }
    } else {
      if (isSpeechRecActiveRef.current || isRecordingRef.current) {
        stopSpeechRecognition(true);
      }
    }
  }, []);

  const toggleTalkMode = async () => {
    if (isVoiceCommandModeRef.current) {
      isVoiceCommandModeRef.current = false;
      setIsVoiceCommandMode(false);
      localStorage.removeItem('yuki-voice-command-active');
      clearContinuedConversationSession();
      stopSpeechRecognition(true);
    }
    if (isTalkModeRef.current) {
      isTalkModeRef.current = false;
      setIsTalkMode(false);
      localStorage.removeItem('yuki-talk-mode-active');
      stopSpeechRecognition(true);
    } else {
      isTalkModeRef.current = true;
      setIsTalkMode(true);
      localStorage.setItem('yuki-talk-mode-active', 'true');
      await startSpeechRecognition();
    }
  };

  const toggleListening = toggleTalkMode;

  const toggleVoiceCommandMode = async () => {
    if (isTalkModeRef.current) {
      isTalkModeRef.current = false;
      setIsTalkMode(false);
      localStorage.removeItem('yuki-talk-mode-active');
      stopSpeechRecognition(true);
    }
    if (isVoiceCommandModeRef.current) {
      isVoiceCommandModeRef.current = false;
      setIsVoiceCommandMode(false);
      localStorage.removeItem('yuki-voice-command-active');
      clearContinuedConversationSession();
      stopSpeechRecognition(true);
    } else {
      isVoiceCommandModeRef.current = true;
      setIsVoiceCommandMode(true);
      localStorage.setItem('yuki-voice-command-active', 'true');
      await startSpeechRecognition();
    }
  };

  const HEADSET_KEYWORDS = [
    'headset', 'headphone', 'headphones', 'earphone', 'earphones', 'earpiece',
    'bluetooth', 'wireless', 'hands-free', 'handsfree', 'airpod', 'airpods',
    'buds', 'external', 'usb', 'ag audio', 'stereo', 'voice'
  ];

  const applyHeadsetPreference = useCallback((devices, prefer) => {
    if (!prefer) return;
    const label = (d) => (d.label || '').toLowerCase();
    const isCommunications = (d) => label(d).includes('communications');
    const hasKeyword = (d) => HEADSET_KEYWORDS.some(kw => label(d).includes(kw));

    let headset = devices.find(d => hasKeyword(d) && !isCommunications(d));
    if (!headset) headset = devices.find(d => hasKeyword(d));

    if (headset && selectedMicDeviceIdRef.current !== headset.deviceId) {
      setSelectedMicDeviceId(headset.deviceId);
      console.log(`[STT] Auto-selected Headset Mic: ${headset.label}`);
    }
  }, [setSelectedMicDeviceId]);

  const refreshMicDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      setMicDevices(audioInputs);
      applyHeadsetPreference(audioInputs, preferHeadsetMic);
    } catch (e) {
      console.warn("Failed to enumerate mic devices:", e);
    }
  }, [preferHeadsetMic, applyHeadsetPreference]);

  const getWhisperModelSizeText = (modelType, profile) => {
    const computeType = profile?.settings?.whisper_compute_type || 'int8_float16';
    let multiplier = 1.0;
    if (computeType === 'float16') {
      multiplier = 2.0;
    } else if (computeType === 'float32') {
      multiplier = 4.0;
    }

    let baseSize = 140;
    let label = 'Base Model (Accurate)';
    if (modelType === 'small') {
      baseSize = 460;
      label = 'Small Model (High Accuracy)';
    } else if (modelType === 'tiny') {
      baseSize = 70;
      label = 'Tiny Model (Fastest)';
    }

    const finalSize = Math.round(baseSize * multiplier);
    const sizeStr = finalSize >= 1000 ? `${(finalSize / 1000).toFixed(1)} GB` : `${finalSize} MB`;
    return `${label} / ~${sizeStr}`;
  };

  useEffect(() => {
    refreshMicDevices();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshMicDevices);
      return () => navigator.mediaDevices.removeEventListener('devicechange', refreshMicDevices);
    }
  }, [refreshMicDevices]);

  // Sync preferences to localStorage
  useEffect(() => {
    localStorage.setItem('yuki-prefer-headset', preferHeadsetMic);
    if (micDevices.length > 0) {
      applyHeadsetPreference(micDevices, preferHeadsetMic);
    }
  }, [preferHeadsetMic, micDevices, applyHeadsetPreference]);

  useEffect(() => {
    localStorage.setItem('yuki-vad-threshold', vadThreshold.toString());
  }, [vadThreshold]);

  // Init SpeechRecognition natively
  useEffect(() => {
    initSpeechRecognition();
  }, []);

  return {
    isTranscribing,
    setIsTranscribing,
    isListening,
    setIsListening,
    isTalkMode,
    setIsTalkMode,
    isVoiceCommandMode,
    setIsVoiceCommandMode,
    micDevices,
    setMicDevices,
    selectedMicDeviceId,
    setSelectedMicDeviceId,
    preferHeadsetMic,
    setPreferHeadsetMic,
    vadThreshold,
    setVadThreshold,
    silenceTimeout,
    setSilenceTimeout,
    useLocalWhisper,
    setUseLocalWhisper,
    whisperModel,
    setWhisperModel,
    hotkeyListening,
    setHotkeyListening,
    isTranscribingRef,
    isTalkModeRef,
    isVoiceCommandModeRef,
    selectedMicDeviceIdRef,
    vadThresholdRef,
    useLocalWhisperRef,
    whisperModelRef,
    hotkeyListeningRef,
    updateListeningState,
    toggleTalkMode,
    toggleListening,
    toggleVoiceCommandMode,
    refreshMicDevices,
    getWhisperModelSizeText,
    stopSpeechRecognition,
    startSessionTimeout,
    clearContinuedConversationSession,
    applyHeadsetPreference
  };
}
