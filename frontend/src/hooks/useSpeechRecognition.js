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
    isSessionActiveRef
  } = options;

  const [isTranscribing, setIsTranscribingState] = useState(false);
  const isTranscribingRef = useRef(false);
  const setIsTranscribing = useCallback((val) => {
    isTranscribingRef.current = val;
    setIsTranscribingState(val);
  }, []);

  const [isListening, setIsListening] = useState(false);
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

  const [vadThreshold, setVadThreshold] = useState(() => {
    const optVal = options.vadThreshold;
    if (optVal !== undefined && optVal < 0.2) return optVal;
    return parseFloat(localStorage.getItem('yuki-vad-threshold') || '0.015');
  });
  const vadThresholdRef = useRef(vadThreshold);
  useEffect(() => {
    const val = (options.vadThreshold !== undefined && options.vadThreshold < 0.2) ? options.vadThreshold : vadThreshold;
    vadThresholdRef.current = val;
  }, [options.vadThreshold, vadThreshold]);

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

  const logSTTStatus = (message) => {
    console.log(`[STT Coordinator] ${message}`);
  };

  const shouldListen = () => {
    const modeActive = isTalkModeRef.current || isVoiceCommandModeRef.current;
    const yukiBusy = isPlayingRef.current || isThinkingRef.current || ttsStreamActiveRef.current || isNativeSpeakingRef.current || isTranscribingRef.current || hasReceivedAudioRef.current;
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
    sessionTimeoutRef.current = setTimeout(() => {
      console.log("[STT] Continued Conversation session timed out after 8s of silence.");
      setIsSessionActive(false);
      updateListeningState();
    }, 8000);
  };

  const processSTTTranscript = (transcript, sttTimeMs = null) => {
    if (!transcript || !transcript.trim()) {
      if (options.setIsThinking) options.setIsThinking(false);
      if (options.setTtsStreamActive) options.setTtsStreamActive(false);
      if (isVoiceCommandModeRef.current && isSessionActiveRef && isSessionActiveRef.current) {
        startSessionTimeout();
      }
      updateListeningState();
      return;
    }

    // Clean punctuation for command checks
    const cleaned = transcript.trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
    const lower = cleaned.toLowerCase().trim();
    logSTTStatus(`Processing transcript: "${transcript}" (cleaned: "${cleaned}", isVoiceCommandMode=${isVoiceCommandModeRef.current}, isTalkMode=${isTalkModeRef.current})`);

    // If voice command mode is active
    if (isVoiceCommandModeRef.current) {
      const isSession = isSessionActiveRef ? isSessionActiveRef.current : false;

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
          prompt = prompt.replace(regex, "").trim();
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
        updateListeningState();
        return;
      }

      clearContinuedConversationSession();
      if (sendMessageText) sendMessageText(prompt);
      return;
    }

    // Default Talk Mode
    logSTTStatus(`Talk Mode normal transcript: "${transcript}"`);
    if (sendMessageText) sendMessageText(transcript);
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
    if (logToTerminal) logToTerminal("[STT] Microphone listening mode turned ON");

    if (useLocalWhisperRef.current) {
      try {
        isSpeechRecActiveRef.current = true;
        setIsListening(true);
        isRecordingRef.current = true;

        const deviceId = selectedMicDeviceIdRef.current;
        const constraints = {
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (!isSpeechRecActiveRef.current) {
          console.log("[STT] startSpeechRecognition aborted during getUserMedia. Cleaning up stream.");
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        micStreamRef.current = stream;

        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          console.log("[STT] MediaRecorder stopped.");

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

          isRecordingRef.current = false;
          setIsListening(false);
          isSpeechRecActiveRef.current = false;

          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          if (audioChunksRef.current.length === 0 || audioBlob.size < 1200) {
            logSTTStatus(`[STT] Ignored short clip (${audioBlob.size} bytes).`);
            updateListeningState();
            return;
          }

          setIsTranscribing(true);
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

            if (!res.ok) throw new Error(`Server returned code ${res.status}`);
            const data = await res.json();
            const sttDurationMs = Date.now() - sttStartTime;
            logSTTStatus(`Transcribed: "${data.text}" in ${sttDurationMs}ms`);
            if (logToTerminal) logToTerminal(`[STT] Transcribed: "${data.text}" (${sttDurationMs}ms)`);

            setIsTranscribing(false);
            if (data.text && data.text.trim()) {
              processSTTTranscript(data.text, sttDurationMs);
            } else {
              updateListeningState();
            }
          } catch (e) {
            let errMsg = e.message;
            if (res) {
              const body = await res.text().catch(() => '<unreadable>');
              errMsg += ` | status=${res.status} body="${body}"`;
            }
            logSTTStatus(`Whisper STT transcription failed: ${errMsg}`);
            setIsTranscribing(false);
            if (setMessages) {
              setMessages((prev) => [...prev, {
                role: 'system',
                content: "System Notice: Local Whisper Speech-to-Text transcription failed. Please verify your backend server is online."
              }]);
            }
            updateListeningState();
          }
        };

        mediaRecorder.start(250);
        logSTTStatus("Listening...");

        const micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const micAnalyser = micAudioCtx.createAnalyser();
        micAnalyser.fftSize = 64;
        const micSource = micAudioCtx.createMediaStreamSource(stream);
        micSource.connect(micAnalyser);

        micAudioContextRef.current = micAudioCtx;
        micAnalyserRef.current = micAnalyser;

        vadSpeakingRef.current = false;
        vadSilenceStartRef.current = null;
        vadActivationTimeRef.current = Date.now();
        vadActiveRef.current = true;

        const bufferLength = micAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const checkMicVolume = () => {
          if (!vadActiveRef.current || !isRecordingRef.current || !micAnalyserRef.current) return;

          micAnalyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const normalized = average / 255.0;

          if (options.updateAudioLevel) {
            options.updateAudioLevel(normalized);
          }

          const micThreshold = vadThresholdRef.current;
          const silenceTimeoutMs = parseInt(localStorage.getItem('yuki-silence-timeout') || '450', 10);
          const now = Date.now();

          if (normalized > micThreshold) {
            if (now - vadActivationTimeRef.current > 150) {
              if (!vadSpeakingRef.current) {
                logSTTStatus("User speech detected — speech start");
                vadSpeakingRef.current = true;
                if ((isPlayingRef?.current || ttsStreamActiveRef?.current) && stopAllPlayback) {
                  logSTTStatus("Interrupting active Yuki speech playback (barge-in)");
                  if (logToTerminal) logToTerminal("[STT] User speech detected — interrupting playback");
                  stopAllPlayback();
                }
                if (sessionTimeoutRef.current) {
                  clearTimeout(sessionTimeoutRef.current);
                  sessionTimeoutRef.current = null;
                }
              }
              vadSilenceStartRef.current = null;
            }
          } else {
            if (vadSpeakingRef.current) {
              if (vadSilenceStartRef.current === null) {
                vadSilenceStartRef.current = now;
              } else if (now - vadSilenceStartRef.current > silenceTimeoutMs) {
                logSTTStatus(`Silence threshold reached (${silenceTimeoutMs}ms). Stopping recording...`);
                stopSpeechRecognition();
                return;
              }
            }
          }

          setTimeout(checkMicVolume, 30);
        };

        checkMicVolume();

        if (maxRecordingTimeoutRef.current) {
          clearTimeout(maxRecordingTimeoutRef.current);
        }
        maxRecordingTimeoutRef.current = setTimeout(() => {
          if (isRecordingRef.current && mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            stopSpeechRecognition();
          }
        }, 15000);

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

  const stopSpeechRecognition = (forceAbort = false) => {
    if (!isSpeechRecActiveRef.current && !isRecordingRef.current) return;
    if (logToTerminal) logToTerminal(`[STT] Microphone listening mode turned OFF${forceAbort ? ' (forced abort)' : ''}`);

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
      clearContinuedConversationSession();
      stopSpeechRecognition(true);
    }
    if (isTalkModeRef.current) {
      isTalkModeRef.current = false;
      setIsTalkMode(false);
      stopSpeechRecognition(true);
    } else {
      isTalkModeRef.current = true;
      setIsTalkMode(true);
      await startSpeechRecognition();
    }
  };

  const toggleListening = toggleTalkMode;

  const toggleVoiceCommandMode = async () => {
    if (isTalkModeRef.current) {
      isTalkModeRef.current = false;
      setIsTalkMode(false);
      stopSpeechRecognition(true);
    }
    if (isVoiceCommandModeRef.current) {
      isVoiceCommandModeRef.current = false;
      setIsVoiceCommandMode(false);
      clearContinuedConversationSession();
      stopSpeechRecognition(true);
    } else {
      isVoiceCommandModeRef.current = true;
      setIsVoiceCommandMode(true);
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
