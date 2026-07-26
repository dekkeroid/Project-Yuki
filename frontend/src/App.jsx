import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import { Sparkles, Terminal, MessageSquare, ShieldAlert, Settings, Square, Volume2, VolumeX, X, Send, RefreshCw, Play, Trash2, Cpu, User, Plus, UserCheck, HardDrive, Database, Mic, MicOff, Eye, EyeOff, History, Monitor, Music, Film, File, Upload } from 'lucide-react';
import { API_BASE, WS_BASE } from './api';
import { ANIMATIONS } from './animationsRegistry';
import { useBackendSocket } from './hooks/useBackendSocket';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useAudioPlayback } from './hooks/useAudioPlayback';
import { useSystemMonitor } from './hooks/useSystemMonitor';
import { SLASH_COMMANDS } from './constants';

const AvatarViewer = lazy(() => import('./components/AvatarViewer'));
const ChatOverlay = lazy(() => import('./components/ChatOverlay'));
const ControlDashboard = lazy(() => import('./components/ControlDashboard'));

let stream_end_exception = false;

import {
  SKIN_PRESETS,
  LLM_MODELS,
  TTS_VOICES,
  TTS_RATES,
  INTERNET_RECOVERY_RESPONSES,
  BATTERY_UNPLUG_RESPONSES,
  BATTERY_PLUG_RESPONSES
} from './constants';

const App = () => {
  // WebSockets & Backend State
  const internetStatusRef = useRef(true);
  const internetFailCountRef = useRef(0);
  const internetCooldownRef = useRef(0);
  const internetPollRef = useRef(null);
  const internetStartupTimeRef = useRef(Date.now());
  const [modelName, setModelName] = useState('');
  const [lmstudioUrl, setLmstudioUrl] = useState('');
  const [llmBackend, setLlmBackend] = useState('lmstudio');
  const [vrmModels, setVrmModels] = useState(['default.vrm']);
  const [vrmCustomModels, setVrmCustomModels] = useState([]);
  const [vrmUploading, setVrmUploading] = useState(false);

  // UI States
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([]);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  // Slash-command autocomplete for desktop input
  const desktopInputRef = useRef(null);
  const desktopDropdownRef = useRef(null);
  const settingsOverlayRef = useRef(null);
  const settingsCardRef = useRef(null);
  const [settingsPaddingTop, setSettingsPaddingTop] = useState(75);
  const [activeCmdIdx, setActiveCmdIdx] = useState(-1);
  const [disabledAnimations, setDisabledAnimations] = useState(() => {
    try {
      const saved = localStorage.getItem('yuki-disabled-animations');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!parsed.includes('greeting_wave')) {
          parsed.push('greeting_wave');
          localStorage.setItem('yuki-disabled-animations', JSON.stringify(parsed));
        }
        return parsed;
      }
      return ['greeting_wave'];
    } catch {
      return ['greeting_wave'];
    }
  });

  const toggleAnimationEnabled = (animName) => {
    setDisabledAnimations((prev) => {
      const next = prev.includes(animName)
        ? prev.filter((name) => name !== animName)
        : [...prev, animName];
      localStorage.setItem('yuki-disabled-animations', JSON.stringify(next));
      return next;
    });
  };

  const cmdSuggestions = useMemo(() => {
    if (!inputText.startsWith('/')) return [];
    const q = inputText.toLowerCase();
    return SLASH_COMMANDS.filter(({ cmd, animName }) => {
      if (animName && disabledAnimations.includes(animName)) return false;
      return cmd.startsWith(q);
    });
  }, [inputText, disabledAnimations]);

  const [desktopSearchSuggestions, setDesktopSearchSuggestions] = useState([]);
  const [desktopSearchMode, setDesktopSearchMode] = useState(null); // 'open' | 'play' | null
  const [desktopSearchQuery, setDesktopSearchQuery] = useState('');
  const [isDesktopLoadingSuggestions, setIsDesktopLoadingSuggestions] = useState(false);

  // Parse command suggestions query
  const parsedDesktopSearch = useMemo(() => {
    const trimmed = inputText.trimStart();
    const openMatch = trimmed.match(/^\/(open|o)\s+(.*)/i);
    const playMatch = trimmed.match(/^\/(play|p)\s+(.*)/i);
    const readMatch = trimmed.match(/^\/(read)\s+(.*)/i);
    const sumMatch = trimmed.match(/^\/(sum)\s+(.*)/i);
    if (openMatch) {
      return { type: 'open', query: openMatch[2] };
    }
    if (playMatch) {
      return { type: 'play', query: playMatch[2] };
    }
    if (readMatch) {
      return { type: 'read', query: readMatch[2] };
    }
    if (sumMatch) {
      return { type: 'sum', query: sumMatch[2] };
    }
    return null;
  }, [inputText]);

  // FetchSuggestions effect for desktop chat overlay input
  useEffect(() => {
    if (!parsedDesktopSearch) {
      setDesktopSearchSuggestions([]);
      setDesktopSearchMode(null);
      setDesktopSearchQuery('');
      setIsDesktopLoadingSuggestions(false);
      return;
    }

    const { type, query } = parsedDesktopSearch;
    setDesktopSearchMode(type);
    setDesktopSearchQuery(query);

    if (!query.trim()) {
      setDesktopSearchSuggestions([]);
      setIsDesktopLoadingSuggestions(false);
      return;
    }

    setIsDesktopLoadingSuggestions(true);

    const controller = new AbortController();
    const signal = controller.signal;

    const delayDebounceFn = setTimeout(() => {
      fetch(`${API_BASE}/api/system/suggestions?query=${encodeURIComponent(query)}&type=${type}`, { signal })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch suggestions');
          return res.json();
        })
        .then((data) => {
          if (data && data.suggestions) {
            setDesktopSearchSuggestions(data.suggestions);
          } else {
            setDesktopSearchSuggestions([]);
          }
          setIsDesktopLoadingSuggestions(false);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            console.error('Error fetching suggestions:', err);
            setIsDesktopLoadingSuggestions(false);
          }
        });
    }, 200);

    return () => {
      clearTimeout(delayDebounceFn);
      controller.abort();
    };
  }, [parsedDesktopSearch]);

  const activeDesktopSuggestions = useMemo(() => {
    return desktopSearchMode ? desktopSearchSuggestions : cmdSuggestions;
  }, [desktopSearchMode, desktopSearchSuggestions, cmdSuggestions]);

  const showDesktopDropdown = (cmdSuggestions.length > 0) || (desktopSearchMode !== null);

  // ---------- Global error handlers (Electron) ----------
  useEffect(() => {
    const isElectron = window.electronAPI?.isElectron;
    if (!isElectron) return;

    const handleError = (event) => {
      event.preventDefault();
      console.error('[Global] Uncaught error:', event.error);
    };
    const handleRejection = (event) => {
      event.preventDefault();
      console.error('[Global] Unhandled promise rejection:', event.reason);
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    // Subscribe to backend status from main process
    const unsub = window.electronAPI.onBackendStatus?.((data) => {
      console.log('[Backend Status]', data.status, data);
      if (data.status === 'online') {
        setBackendStatus('online');
      } else if (data.status === 'crashing') {
        setBackendStatus('offline');
      } else if (data.status === 'stopped') {
        setBackendStatus('offline');
      }
    });

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
      unsub?.();
    };
  }, []);

  useEffect(() => {
    setActiveCmdIdx(-1);
  }, [activeDesktopSuggestions.length]);

  // Auto-scroll selected command suggestion into view
  useEffect(() => {
    if (desktopDropdownRef.current && activeCmdIdx >= 0) {
      const activeEl = desktopDropdownRef.current.querySelector(`[data-index="${activeCmdIdx}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeCmdIdx]);



  const pickDesktopSearchSuggestion = (item) => {
    let cmdPrefix = '/open';
    if (desktopSearchMode === 'play') cmdPrefix = '/play';
    else if (desktopSearchMode === 'read') cmdPrefix = '/read';
    else if (desktopSearchMode === 'sum') cmdPrefix = '/sum';
    const pathVal = item.path.includes(' ') ? `"${item.path}"` : item.path;
    const newText = `${cmdPrefix} ${pathVal}`;
    setInputText(newText);
    setActiveCmdIdx(-1);

    // Submit command immediately
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => { } };
      handleSendMessage(fakeEvent, newText, true);
    }, 50);
  };
  const [profile, setProfile] = useState({
    user_name: 'Master',
    user_interests: [],
    custom_facts: {},
    interaction_count: 0
  });

  // Comprehensive Electron Settings Modal States
  const [activeTab, setActiveTab] = useState('settings');
  const [localCharName, setLocalCharName] = useState('Yuki');
  const [localCharPersona, setLocalCharPersona] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [newInterestText, setNewInterestText] = useState('');
  const [isAddingFact, setIsAddingFact] = useState(false);
  const [newFactKey, setNewFactKey] = useState('');
  const [newFactVal, setNewFactVal] = useState('');
  const [editingFactKey, setEditingFactKey] = useState(null);
  const [editingFactValue, setEditingFactValue] = useState('');


  const [availableLlmModels, setAvailableLlmModels] = useState([]);
  const [gpuMemData, setGpuMemData] = useState({ gpus: [], top5: {} });

  // Sync companion local states when profile changes
  useEffect(() => {
    if (profile.settings) {
      if (profile.settings.character_name) {
        setLocalCharName(profile.settings.character_name);
      }
      if (profile.settings.character_persona) {
        setLocalCharPersona(profile.settings.character_persona);
      }
    }
  }, [profile.settings]);

  const [audioLevel, setAudioLevel] = useState(0);
  const [isThinking, setIsThinkingState] = useState(false);
  const isThinkingRef = useRef(false);
  const setIsThinking = (val) => {
    isThinkingRef.current = val;
    setIsThinkingState(val);
  };
  const [cameraTrackingState, setCameraTrackingState] = useState(() => {
    try { return localStorage.getItem('yuki-camera-tracking') !== 'false'; } catch { return true; }
  });
  const [avatarExpression, setAvatarExpression] = useState('neutral');
  const [crawlerPaused, setCrawlerPaused] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [taggerPaused, setTaggerPaused] = useState(false);

  const [powerConnected, setPowerConnected] = useState(true);
  const yukiSelfHiddenRef = useRef(false);
  const [lastDrivesCount, setLastDrivesCount] = useState(null);
  const hasTriggeredLowSsdWarningRef = useRef(false);
  const hasTriggeredHighRamWarningRef = useRef(false);
  const [avatarScale, setAvatarScale] = useState(() => {
    const saved = localStorage.getItem('yuki-avatar-scale');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [avatarSkinToneColor, setAvatarSkinToneColor] = useState(() => {
    const saved = localStorage.getItem('yuki-avatar-skintone-color');
    return saved ? saved : '#FFE5E5';
  });
  const [customAnimation, setCustomAnimation] = useState('');

  // Sync avatar scale changes to Electron window bounds size (debounced to avoid slider dragging jitter)
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.setWindowScale) return;

    const timer = setTimeout(() => {
      window.electronAPI.setWindowScale(avatarScale);
    }, 250);

    return () => clearTimeout(timer);
  }, [avatarScale]);

  // Listen for scale updates sent from external Settings window
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onAvatarScaleChanged) return;
    const cleanup = window.electronAPI.onAvatarScaleChanged((newScale) => {
      if (newScale && !isNaN(newScale)) {
        setAvatarScale(newScale);
      }
    });
    return cleanup;
  }, []);

  // Desktop Overlay UI states
  const [isWandering, setIsWandering] = useState(false);
  const [isWalking, setIsWalking] = useState(false);
  const [walkDirection, setWalkDirection] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isSettingsOpenRef = useRef(false);
  useEffect(() => {
    isSettingsOpenRef.current = isSettingsOpen;
  }, [isSettingsOpen]);

  // Keep settings modal inside screen boundaries by adjusting container padding-top when top clips
  useEffect(() => {
    if (!isSettingsOpen || !window.electronAPI) {
      setSettingsPaddingTop(75);
      return;
    }

    let active = true;
    const adjustPadding = async () => {
      if (!active) return;
      try {
        const bounds = await window.electronAPI.getWindowBounds();
        const overlay = settingsOverlayRef.current;
        const card = settingsCardRef.current;
        if (overlay && card) {
          const windowHeight = window.innerHeight;
          const cardHeight = card.offsetHeight;
          const naturalPadding = Math.max(20, (windowHeight - cardHeight) / 2);

          const margin = 20;
          let padding = naturalPadding;

          // If window top is off-screen, add padding to push card down
          if (bounds.y < margin) {
            const offScreenAmt = margin - bounds.y;
            padding = Math.max(naturalPadding, offScreenAmt);
          }

          setSettingsPaddingTop(padding);
        }
      } catch (err) {
        console.warn("Failed to adjust settings padding:", err);
      }
    };

    adjustPadding();
    const interval = setInterval(adjustPadding, 100);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isSettingsOpen]);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const isChatOpenRef = useRef(false);
  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);

  const [isHovered, setIsHovered] = useState(false);

  // Custom styled confirmation modal state
  const [confirmModal, setConfirmModal] = useState({
    visible: false,
    title: '',
    message: '',
    onConfirm: null,
    onCancel: null
  });

  const confirmModalRef = useRef(confirmModal);
  useEffect(() => {
    confirmModalRef.current = confirmModal;
  }, [confirmModal]);

  useEffect(() => {
    window.yukiConfirmModalVisible = confirmModal.visible;
  }, [confirmModal.visible]);

  // OS telemetry and resident companion states
  const {
    cpuLoad,
    setCpuLoad,
    systemIdleTime,
    setSystemIdleTime,
    crawlerStatus,
    fetchHealthDetails,
    fetchCrawlerStatus
  } = useSystemMonitor({
    API_BASE,
    setModelName,
    isSettingsOpen,
    activeTab
  });

  const stopAllPlaybackRef = useRef(null);
  const stopSpeechRecognitionRef = useRef(null);
  const startSessionTimeoutRef = useRef(null);
  const updateListeningStateRef = useRef(null);
  const getIsVoiceCommandModeRef = useRef(() => false);

  const {
    socket,
    socketRef,
    backendStatus,
    setBackendStatus,
    isSessionActive,
    isSessionActiveRef,
    setIsSessionActive,
    connectWebSocket
  } = useBackendSocket({
    onOpen: () => {
      fetchProfileDetails();
      fetchHealthDetails();
      fetchVrmModels();
      fetchLlmModels();
    },
    onMessage: (event) => handleWebSocketMessageRef.current?.(event)
  });

  const {
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
  } = useAudioPlayback({
    profile,
    setAudioLevel,
    setAvatarExpression,
    updateListeningStateGlobal: () => updateListeningStateRef.current?.(),
    isVoiceCommandModeRef: { get current() { return getIsVoiceCommandModeRef.current(); } },
    startSessionTimeout: () => startSessionTimeoutRef.current?.(),
    socketRef,
    stopSpeechRecognition: (force) => stopSpeechRecognitionRef.current?.(force),
    setIsThinking
  });
  stopAllPlaybackRef.current = stopAllPlayback;

  const {
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
  } = useSpeechRecognition({
    API_BASE,
    isThinkingRef,
    ttsStreamActiveRef,
    hasReceivedAudioRef,
    isNativeSpeakingRef,
    isPlayingRef,
    sessionTimeoutRef: useRef(null),
    setIsSessionActive,
    muteVoice,
    setMessages,
    setConfirmModal,
    desktopInputRef,
    stopAllPlayback,
    updateListeningStateGlobal: () => updateListeningStateRef.current?.(),
    logToTerminal: (msg) => {
      console.log(msg);
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'log', message: msg }));
      }
    },
    sendMessageText: (text) => handleSendMessage(null, text, false),
    isSessionActiveRef,
    toggleMute: () => setMuteVoice(prev => !prev)
  });

  getIsVoiceCommandModeRef.current = () => isVoiceCommandModeRef.current;
  stopSpeechRecognitionRef.current = stopSpeechRecognition;
  startSessionTimeoutRef.current = startSessionTimeout;
  updateListeningStateRef.current = updateListeningState;

  const currentResponseTextRef = useRef('');
  const handleWebSocketMessageRef = useRef(null);

      const handleWebSocketMessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'profile_update') {
        setProfile(msg.profile);
        if (msg.profile.settings && msg.profile.settings.llm_model) {
          setModelName(msg.profile.settings.llm_model);
        }
        if (msg.profile.settings && msg.profile.settings.crawler_paused !== undefined) {
          setCrawlerPaused(msg.profile.settings.crawler_paused);
        }
        if (msg.profile.settings && msg.profile.settings.tagger_paused !== undefined) {
          setTaggerPaused(msg.profile.settings.tagger_paused);
        }
      } else if (msg.type === 'status') {
        if (msg.status === 'thinking') {
          setIsThinking(true);
          setTtsStreamActive(true); // WebSocket stream starts
          // Clear speech bubble immediately since a new response generation starts
          setCurrentSpeechText('');
          currentResponseTextRef.current = '';
          hasReceivedAudioRef.current = false;
          if (msg.message) {
            setMessages((prev) => [...prev, {
              role: 'system',
              content: `⚙️ [Tool Start] ${msg.message}`
            }]);
          }
        } else if (msg.status === 'idle') {
          // Do not override isThinking immediately if audio is still active
          if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
            setIsThinking(false);
          }
        }
      } else if (msg.type === 'text_stream') {
        // Keep isThinking true so the bubble thinking animation remains active
        setTtsStreamActive(true);
        currentResponseTextRef.current += msg.text;
        setMessages((prev) => {
          const newMessages = [...prev];
          if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
            const last = newMessages[newMessages.length - 1];
            newMessages[newMessages.length - 1] = {
              ...last,
              content: last.content + msg.text,
              backend: msg.backend_used
            };
          } else {
            newMessages.push({
              role: 'assistant',
              content: msg.text,
              backend: msg.backend_used
            });
          }
          return newMessages;
        });
      } else if (msg.type === 'audio_chunk') {
        setTtsStreamActive(true);
        hasReceivedAudioRef.current = true;
        try {
          console.log(`[TTS] audio_chunk received idx=${msg.index} backend=${msg.tts_backend || 'unknown'} time_ms=${msg.tts_time_ms || 0} text="${(msg.text || '').slice(0, 80)}"`);
        } catch (e) { /* ignore logging errors */ }
        queueAudioChunk(msg.audio_url, msg.text, msg.index);
      } else if (msg.type === 'stream_done') {
        setIsThinking(false);
        setTtsStreamActive(false);

        setMessages((prev) => {
          const newMessages = [...prev];
          if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
            newMessages[newMessages.length - 1] = {
              ...newMessages[newMessages.length - 1],
              responseTime: msg.response_time
            };
          }
          return newMessages;
        });

        if (!hasReceivedAudioRef.current && currentResponseTextRef.current && !muteVoice) {
          console.log(`[TTS] native fallback triggered for text="${currentResponseTextRef.current.slice(0, 80)}"`);
          speakTextNatively(currentResponseTextRef.current);
        } else {
          updateListeningState();
        }
      } else if (msg.type === 'tool_result') {
        try {
          if (msg.result && typeof msg.result === 'string' && msg.result.includes('window_control')) {
            const data = JSON.parse(msg.result);
            if (data.window_control && window.electronAPI) {
              const act = data.window_control.action;
              if (act === 'minimize') {
                window.electronAPI.minimizeWindow();
              } else if (act === 'maximize') {
                window.electronAPI.maximizeWindow();
              } else if (act === 'restore') {
                window.electronAPI.restoreWindow();
              } else if (act === 'move') {
                const { x, y } = data.window_control;
                if (x !== undefined && y !== undefined) {
                  window.electronAPI.setWindowPosition(x, y);
                }
              }
            }
          }
        } catch (e) {
          console.warn("Failed to check tool result for window_control JSON:", e);
        }

        setMessages((prev) => [...prev, {
          role: 'system',
          content: `⚙️ [Tool Result] ${msg.result}`
        }]);
      } else if (msg.type === 'speech') {
        setTtsStreamActive(true);
        setIsThinking(false);
        hasReceivedAudioRef.current = true;
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: msg.text,
          backend: msg.backend_used,
          responseTime: msg.response_time
        }]);
        playVoiceResponse(msg.audio_url, msg.text);
      } else if (msg.type === 'confirm_request') {
        let displayMessage = `Yuki wants to execute the following action:\n\n${msg.name}`;
        if (msg.name.startsWith("Run terminal command:")) {
          displayMessage = `Yuki wants to run the following terminal command:\n\n${msg.name.replace("Run terminal command:", "").trim()}`;
        } else if (msg.name.startsWith("Run Python script:")) {
          displayMessage = `Yuki wants to execute the following custom Python script:\n\n${msg.name.replace("Run Python script:", "").trim()}`;
        } else if (msg.name.startsWith("System Power Action:")) {
          displayMessage = `Yuki wants to execute the following system power command:\n\n${msg.name.replace("System Power Action:", "").trim()}`;
        } else if (msg.name.startsWith("Delete file:")) {
          displayMessage = `Yuki wants to delete the following file:\n\n${msg.name.replace("Delete file:", "").trim()}`;
        }

        setConfirmModal({
          visible: true,
          title: 'Security Confirmation',
          message: displayMessage,
          onConfirm: () => {
            setConfirmModal(prev => ({ ...prev, visible: false }));

            // Refocus, disable clickthrough suspension temporarily
            window.yukiConfirmJustClosed = true;
            if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
              window.electronAPI.setIgnoreMouseEvents(false);
            }
            setTimeout(() => {
              window.yukiConfirmJustClosed = false;
            }, 2000);
            setTimeout(() => {
              desktopInputRef.current?.focus();
            }, 50);

            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({
                type: 'confirm_response',
                conf_id: msg.conf_id,
                confirmed: true
              }));
            }
          },
          onCancel: () => {
            setConfirmModal(prev => ({ ...prev, visible: false }));

            window.yukiConfirmJustClosed = true;
            if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
              window.electronAPI.setIgnoreMouseEvents(false);
            }
            setTimeout(() => {
              window.yukiConfirmJustClosed = false;
            }, 2000);
            setTimeout(() => {
              desktopInputRef.current?.focus();
            }, 50);

            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({
                type: 'confirm_response',
                conf_id: msg.conf_id,
                confirmed: false
              }));
            }
          }
        });
      }
    };

  handleWebSocketMessageRef.current = handleWebSocketMessage;


  const desktopChatEndRef = useRef(null);
  useEffect(() => {
    isSessionActiveRef.current = isSessionActive;
  }, [isSessionActive]);


  // Desktop positioning and alignment
  useEffect(() => {
    if (window.electronAPI) {
      // Apply to BOTH html and body so :root background-color gets neutralized
      document.documentElement.classList.add('desktop-overlay');
      document.body.classList.add('desktop-overlay');

      const initPosition = async () => {
        try {
          const screen = await window.electronAPI.getScreenSize();
          const bounds = await window.electronAPI.getWindowBounds();
          const targetX = screen.width - bounds.width - 40;
          const targetY = screen.height - bounds.height - 20;
          window.electronAPI.setWindowPosition(targetX, targetY);
        } catch (err) {
          console.warn("Failed to set window starting position:", err);
        }
      };
      initPosition();

      return () => {
        document.documentElement.classList.remove('desktop-overlay');
        document.body.classList.remove('desktop-overlay');
      };
    }
  }, []);

  const handleFileDropped = (name, contentOrPath, isPath) => {
    if (!contentOrPath || !contentOrPath.trim()) return;

    const userMsg = `[Dropped File: ${name}]`;
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);

    let prompt;
    if (isPath) {
      prompt = `I dropped a file at absolute path "${contentOrPath}". Please use your read_file_content tool to read it, and then summarize it for me in 2-3 paragraphs (under 150 words total).`;
    } else {
      const maxChars = 2000;
      const truncated = contentOrPath.length > maxChars ? contentOrPath.slice(0, maxChars) + "\n...[truncated]" : contentOrPath;
      prompt = `I dropped a file named "${name}". Here is its content:\n\n${truncated}\n\nRead this file and give me a brief reaction or summary of what's inside (under 150 words total).`;
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      setIsThinking(true);
      socketRef.current.send(JSON.stringify({ type: 'chat', message: prompt }));
    } else {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Oh no! I'm offline right now, Master. I can't read files when disconnected." }
      ]);
    }
  };

  // 1. Poll CPU stats & detect USB/disk changes from FastAPI backend
  useEffect(() => {
    const checkTelemetry = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/pcstat`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.cpu && !data.cpu.error) {
          setCpuLoad(data.cpu.usage_percent);
        }

        if (data.disk && !data.disk.error) {
          const freeGb = data.disk.free_gb;
          if (freeGb < 2.0) {
            if (!hasTriggeredLowSsdWarningRef.current) {
              hasTriggeredLowSsdWarningRef.current = true;
              const msg = `Master, your SSD storage space is extremely low! You have only ${freeGb} GB free remaining on your C drive. Please clean up some space!`;
              setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to SSD* ${msg}` }]);
              speakSystemMessage(msg, 'sad');
            }
          } else {
            hasTriggeredLowSsdWarningRef.current = false;
          }
        }

        if (data.ram && !data.ram.error) {
          const ramPercent = data.ram.usage_percent;
          if (ramPercent > 95) {
            if (!hasTriggeredHighRamWarningRef.current) {
              hasTriggeredHighRamWarningRef.current = true;
              const msg = `Master, your system RAM is almost full! Usage has reached ${ramPercent} percent. Please close some heavy applications!`;
              setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to RAM* ${msg}` }]);
              speakSystemMessage(msg, 'surprised');
            }
          } else {
            hasTriggeredHighRamWarningRef.current = false;
          }
        }

        if (data.disk && data.disk.drives_count !== undefined) {
          const count = data.disk.drives_count;
          setLastDrivesCount((prevCount) => {
            if (prevCount !== null && count !== prevCount) {
              const inserted = count > prevCount;
              const msg = inserted
                ? "Master, did you just plug in a USB device? Let me see what's in there!"
                : "A storage drive was disconnected. Bye-bye USB!";

              setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to drive* ${msg}` }]);
              speakSystemMessage(msg, inserted ? 'happy' : 'relaxed');
            }
            return count;
          });
        }
      } catch (e) {
        console.warn("Telemetry check failed:", e);
      }
    };

    checkTelemetry();
    const interval = setInterval(checkTelemetry, 6000);
    return () => clearInterval(interval);
  }, [muteVoice]);

  // 2. Listen to Electron power plug AC/Battery changes
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onPowerStateChange) {
      const unsubscribe = window.electronAPI.onPowerStateChange(async (data) => {
        setPowerConnected(data.ac);

        // Read actual battery percentage
        let pct = null;
        try {
          if ('getBattery' in navigator) {
            const bat = await navigator.getBattery();
            pct = Math.round(bat.level * 100);
          }
        } catch (_) { }

        const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

        let msg;
        let expr;

        if (data.ac) {
          // --- PLUGGED IN ---
          const wasHiding = yukiSelfHiddenRef.current;
          if (wasHiding) {
            yukiSelfHiddenRef.current = false;
            if (window.electronAPI.yukiShow) window.electronAPI.yukiShow();
          }

          let tier;
          if (pct === null) tier = 'okay';
          else if (pct >= 90) tier = 'full';
          else if (pct >= 80) tier = 'high';
          else if (pct >= 70) tier = 'good';
          else if (pct >= 60) tier = 'okay';
          else if (pct >= 50) tier = 'half';
          else if (pct >= 40) tier = 'low';
          else if (pct >= 30) tier = 'danger';
          else if (pct >= 20) tier = 'criticalLow';
          else tier = 'dying';

          const baseMsg = pct !== null ? pickRandom(BATTERY_PLUG_RESPONSES[tier])(pct) : "Power plugged in! Charging now, Master.";
          msg = wasHiding ? `*stretches* I'm back, Master! ${baseMsg}` : baseMsg;
          expr = 'happy';
        } else {
          // --- UNPLUGGED ---
          let tier;
          if (pct === null) tier = 'okay';
          else if (pct > 90) tier = 'high';
          else if (pct >= 80) tier = 'good';
          else if (pct >= 70) tier = 'okay';
          else if (pct >= 60) tier = 'low';
          else if (pct >= 50) tier = 'half';
          else if (pct >= 40) tier = 'critical';
          else if (pct >= 30) tier = 'danger';
          else if (pct >= 20) tier = 'criticalLow';
          else tier = 'dying';

          msg = pct !== null ? pickRandom(BATTERY_UNPLUG_RESPONSES[tier])(pct) : "Power unplugged, Master!";

          // Hide window if battery <= 30%
          if (pct !== null && pct <= 30) {
            yukiSelfHiddenRef.current = true;
            if (window.electronAPI.yukiHide) window.electronAPI.yukiHide();
          }

          expr = pct !== null && pct <= 30 ? 'sad' : 'surprised';
        }

        setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to power* ${msg}` }]);
        speakSystemMessage(msg, expr);
      });
      return unsubscribe;
    }
  }, [muteVoice]);

  // 3. Listen to Electron system idle telemetry (falling back to simple mouse/keyboard timers)
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onSystemIdleChange) {
      const unsubscribe = window.electronAPI.onSystemIdleChange((data) => {
        setSystemIdleTime(data.idleTime);
      });
      return unsubscribe;
    } else {
      let localIdleTimer = 0;
      const interval = setInterval(() => {
        localIdleTimer += 5;
        setSystemIdleTime(localIdleTimer);
      }, 5000);

      const resetIdle = () => {
        localIdleTimer = 0;
        setSystemIdleTime(0);
      };

      window.addEventListener('keydown', resetIdle);
      window.addEventListener('mousemove', resetIdle);
      window.addEventListener('mousedown', resetIdle);

      return () => {
        clearInterval(interval);
        window.removeEventListener('keydown', resetIdle);
        window.removeEventListener('mousemove', resetIdle);
        window.removeEventListener('mousedown', resetIdle);
      };
    }
  }, []);

  // Focus the desktop chat input box automatically when the chat overlay is toggled/opened
  useEffect(() => {
    if (isChatOpen) {
      const timer = setTimeout(() => {
        desktopInputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isChatOpen]);

  // Track window hover state for showing/hiding Electron overlay buttons
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onHoverChange) {
      const unsubscribe = window.electronAPI.onHoverChange((hovering) => {
        setIsHovered(hovering);
      });
      return unsubscribe;
    }
  }, []);

  // Track window visibility & handle V8 GC commands from Electron
  useEffect(() => {
    if (window.electronAPI) {
      const unsubVisibility = window.electronAPI.onVisibilityChange?.((visible) => {
        setIsVisible(visible);
        if (!visible && window.gc) {
          try { window.gc(); } catch (_) {}
        }
      });
      const unsubGC = window.electronAPI.onOptimizeMemory?.(() => {
        if (window.gc) {
          try {
            window.gc();
            console.log("[Renderer] Garbage collection triggered.");
          } catch (_) {}
        }
      });
      return () => {
        if (unsubVisibility) unsubVisibility();
        if (unsubGC) unsubGC();
      };
    }
  }, []);

  // AFK Welcoming Detector hook
  const isAfkRef = useRef(false);
  useEffect(() => {
    if (systemIdleTime >= 1800) { // 30 minutes
      isAfkRef.current = true;
    } else if (systemIdleTime === 0 && isAfkRef.current) {
      isAfkRef.current = false;
      const msg = "Welcome back, Master! I missed you.";
      setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to welcome* ${msg}` }]);
      speakSystemMessage(msg, 'happy');
    }
  }, [systemIdleTime, muteVoice]);

  // Internet connectivity polling — detects drops/recovery within 1-2 seconds
  useEffect(() => {
    // Check initial state on mount
    if (!navigator.onLine) {
      internetStatusRef.current = false;
      if (!profile?.settings?.no_llm_mode) {
        const msg = "Oh no! Master, I think my connection to the internet is gone...";
        setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to internet* ${msg}` }]);
        speakSystemMessage(msg, 'sad');
      }
    }

    const CHECK_URL = "https://dns.google/resolve?name=google.com&type=A";

    const checkInternet = async () => {
      try {
        const res = await fetch(CHECK_URL, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          // Internet is online
          internetFailCountRef.current = 0;
          if (!internetStatusRef.current) {
            // Recovered from offline
            if (Date.now() - internetCooldownRef.current < 10000) return;
            internetStatusRef.current = true;
            internetCooldownRef.current = Date.now();
            if (!profile?.settings?.no_llm_mode) {
              const useFunFact = Math.random() < 0.2;
              let announced = false;
              if (useFunFact) {
                try {
                  const factRes = await fetch("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en");
                  if (factRes.ok) {
                    const factData = await factRes.json();
                    if (factData.text) {
                      const msg = `Hurray, the internet is back! Let's see something fun! Did you know? ${factData.text}`;
                      setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to internet* ${msg}` }]);
                      speakSystemMessage(msg, 'happy');
                      announced = true;
                    }
                  }
                } catch (_) { }
              }
              if (!announced) {
                const msg = INTERNET_RECOVERY_RESPONSES[Math.floor(Math.random() * INTERNET_RECOVERY_RESPONSES.length)];
                setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to internet* ${msg}` }]);
                speakSystemMessage(msg, 'happy');
              }
            }
          }
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (_) {
        // Fetch failed — count consecutive failures
        internetFailCountRef.current += 1;
        // Skip disconnect detection during first 30s after mount (startup grace)
        const inGracePeriod = Date.now() - internetStartupTimeRef.current < 30000;
        // Require 4 consecutive failures (~2 seconds at 500ms interval) before announcing offline
        if (!inGracePeriod && internetStatusRef.current && internetFailCountRef.current >= 4) {
          if (Date.now() - internetCooldownRef.current < 10000) return;
          internetStatusRef.current = false;
          internetCooldownRef.current = Date.now();
          if (!profile?.settings?.no_llm_mode) {
            const msg = "Oh no! Master, I think my connection to the internet is gone...";
            setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to internet* ${msg}` }]);
            speakSystemMessage(msg, 'sad');
          }
        }
      }
    };

    internetPollRef.current = setInterval(checkInternet, 500);

    return () => {
      if (internetPollRef.current) clearInterval(internetPollRef.current);
    };
  }, [profile, muteVoice]);

  // Desktop Wander Mechanics state machine
  const wanderTimerRef = useRef(null);
  const wanderStateRef = useRef({
    dx: -1.5,
    targetDuration: 3000,
    elapsed: 0,
    state: 'walk'
  });

  useEffect(() => {
    if (!isWandering || !window.electronAPI) {
      setIsWalking(false);
      setWalkDirection(0);
      if (wanderTimerRef.current) {
        clearInterval(wanderTimerRef.current);
        wanderTimerRef.current = null;
      }
      return;
    }

    const tickInterval = 50;
    setIsWalking(true);
    setWalkDirection(wanderStateRef.current.dx > 0 ? 1 : -1);

    wanderTimerRef.current = setInterval(async () => {
      try {
        const screen = await window.electronAPI.getScreenSize();
        const bounds = await window.electronAPI.getWindowBounds();
        let { x, y } = bounds;
        const ws = wanderStateRef.current;

        ws.elapsed += tickInterval;

        if (ws.elapsed >= ws.targetDuration) {
          ws.elapsed = 0;
          if (ws.state === 'walk') {
            ws.state = 'idle';
            setIsWalking(false);
            setWalkDirection(0);
            ws.targetDuration = 2000 + Math.random() * 3000;
          } else {
            ws.state = 'walk';
            setIsWalking(true);
            ws.dx = Math.random() > 0.5 ? 1.5 : -1.5;
            setWalkDirection(ws.dx > 0 ? 1 : -1);
            ws.targetDuration = 3000 + Math.random() * 5000;
          }
        }

        if (ws.state === 'walk') {
          let newX = x + ws.dx;
          if (newX < 0) {
            newX = 0;
            ws.dx = -ws.dx;
            setWalkDirection(ws.dx > 0 ? 1 : -1);
          } else if (newX + bounds.width > screen.width) {
            newX = screen.width - bounds.width;
            ws.dx = -ws.dx;
            setWalkDirection(ws.dx > 0 ? 1 : -1);
          }
          window.electronAPI.setWindowPosition(newX, y);
        }
      } catch (err) {
        console.warn("Wander tick failed:", err);
      }
    }, tickInterval);

    return () => {
      if (wanderTimerRef.current) {
        clearInterval(wanderTimerRef.current);
        wanderTimerRef.current = null;
      }
    };
  }, [isWandering]);



  const handleToggleMute = (newMuteValue) => {
    setMuteVoice(newMuteValue);
    if (newMuteValue) {
      stopAllPlayback();
    }
  };

  const handleUpdateSetting = async (key, value) => {
    try {
      const response = await fetch(`${API_BASE}/api/settings/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setProfile((prev) => ({
            ...prev,
            settings: {
              ...prev.settings,
              ...data.settings
            }
          }));
          if (data.settings.llm_model) {
            setModelName(data.settings.llm_model);
          }
          if (data.settings.crawler_paused !== undefined) {
            setCrawlerPaused(data.settings.crawler_paused);
          }
          if (data.settings.tagger_paused !== undefined) {
            setTaggerPaused(data.settings.tagger_paused);
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to update setting ${key}:`, e);
    }
  };

  const handleUpdateProfile = async (updates) => {
    try {
      const res = await fetch(`${API_BASE}/api/profile/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data.profile);
      }
    } catch (e) {
      console.error('Failed to update profile:', e);
    }
  };

  useEffect(() => {
    let interval = null;
    if (isSettingsOpen) {
      fetchVrmModels();
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSettingsOpen]);

  const fetchGpuMem = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/system/gpumem`);
      if (res.ok) {
        const data = await res.json();
        setGpuMemData(data);
      }
    } catch (e) {
      console.warn('Could not fetch GPU memory:', e);
    }
  };

  // Poll GPU memory when config tab is open
  useEffect(() => {
    let interval = null;
    if (isSettingsOpen && activeTab === 'config') {
      fetchGpuMem();
      interval = setInterval(fetchGpuMem, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSettingsOpen, activeTab]);

  const handleToggleCrawlerPause = async (newPauseValue) => {
    setCrawlerPaused(newPauseValue);
    await handleUpdateSetting('crawler_paused', newPauseValue);
  };

  const handleToggleTaggerPause = async (newPauseValue) => {
    setTaggerPaused(newPauseValue);
    await handleUpdateSetting('tagger_paused', newPauseValue);
  };

  const handleTriggerRecrawl = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/crawler/recrawl`, {
        method: 'POST',
      });
      if (res.ok && isSettingsOpen && activeTab === 'crawler') {
        fetchCrawlerStatus();
      }
    } catch (e) {
      console.warn("Failed to trigger recrawl:", e);
    }
  };




  useEffect(() => {
    if (isPanelOpen && desktopChatEndRef.current) {
      desktopChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isPanelOpen, messages]);

  const sendMessageText = (text, sttTimeMs = null, fromSuggestion = false) => {
    if (!text.trim()) return;

    console.log(`sendMessageText: "${text}" (sttTimeMs: ${sttTimeMs})`);
    initAudioAnalyser();

    // Clean interruption
    clearContinuedConversationSession();
    stopAllPlayback();

    console.log("Clear queue and stop playback");

    // Command feature: execute command if matching slash command, else treat as normal prompt
    if (text.startsWith('/')) {
      const parts = text.split(' ');
      const cmd = parts[0].toLowerCase();

      // Check if it's a known command
      const isKnownCommand = SLASH_COMMANDS.some(sc => sc.cmd.toLowerCase() === cmd);

      if (!isKnownCommand) {
        // Unknown command error
        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setIsThinking(false);
        setTtsStreamActive(false);

        const errorMsg = `Unknown command: ${cmd}. Type / to see all available commands.`;
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: errorMsg }
        ]);
        speakSystemMessage(errorMsg, 'neutral');
        return;
      }

      if (cmd === '/read' || cmd === '/sum') {
        const filePath = parts.slice(1).join(' ').trim().replace(/^"(.*)"$/, '$1'); // strip quotes if any
        if (!filePath) {
          const errorMsg = `Please provide a file path. E.g. ${cmd} "D:\\Documents\\notes.txt"`;
          setMessages((prev) => [...prev, { role: 'user', content: text }]);
          setMessages((prev) => [...prev, { role: 'assistant', content: errorMsg }]);
          speakSystemMessage(errorMsg, 'neutral');
          return;
        }

        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setTtsStreamActive(true);
        setIsThinking(true);

        let payloadMessage;
        if (cmd === '/read') {
          payloadMessage = text;
        } else {
          payloadMessage = `Master requested to summarize the file content at absolute path "${filePath}". Use the read_file_content tool to load it, and then summarize it concisely in 2-3 paragraphs (under 150 words total).`;
        }

        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          const payload = { type: 'chat', message: payloadMessage };
          if (sttTimeMs !== null) {
            payload.stt_time_ms = sttTimeMs;
          }
          socketRef.current.send(JSON.stringify(payload));
        } else {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: "Hmph! I'm currently offline, Master. Make sure the backend server is running!" }
          ]);
          setIsThinking(false);
          setTtsStreamActive(false);
          updateListeningState();
        }
        return;
      }

      if (cmd === '/pcstat') {
        // 1. Immediately log user message and clear input field
        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setAvatarExpression('happy');
        setIsThinking(true);
        setTtsStreamActive(false);

        // 2. Fetch PC statistics from backend
        fetch(`${API_BASE}/api/system/pcstat`)
          .then((res) => {
            if (!res.ok) throw new Error("Could not contact system stats endpoint.");
            return res.json();
          })
          .then((data) => {
            setIsThinking(false);
            if (data.error) {
              throw new Error(data.error);
            }

            // Format statistics nicely for the chat log
            let chatText = "Here are your PC stats, Master:\n";

            // CPU
            if (data.cpu && !data.cpu.error) {
              chatText += `箕・・**CPU**: ${data.cpu.usage_percent}% (${data.cpu.cores_logical} cores`;
              if (data.cpu.freq_mhz) {
                chatText += ` @ ${(data.cpu.freq_mhz / 1000).toFixed(1)} GHz`;
              }
              chatText += ")\n";
            }

            // RAM
            if (data.ram && !data.ram.error) {
              chatText += `沈 **RAM**: ${data.ram.used_gb} GB / ${data.ram.total_gb} GB (${data.ram.usage_percent}%)\n`;
            }

            // GPUs
            if (data.gpus && data.gpus.length > 0) {
              data.gpus.forEach((gpu, idx) => {
                chatText += `式 **GPU ${idx + 1}**: ${gpu.name}`;
                if (gpu.has_metrics) {
                  chatText += ` (${gpu.utilization_percent}% load, ${gpu.temp_c}ﾂｰC, VRAM: ${gpu.mem_used_mb} MB / ${gpu.mem_total_mb} MB)`;
                }
                chatText += "\n";
              });
            }

            // Battery
            if (data.battery && !data.battery.error) {
              const b = data.battery;
              chatText += `萩 **Battery**: ${b.percent}%`;
              if (b.charging) {
                const rate = b.charge_rate_mw ? ` at ${(b.charge_rate_mw / 1000).toFixed(1)}W` : '';
                chatText += ` (Charging${rate})`;
              } else if (b.discharging) {
                const rate = b.discharge_rate_mw ? ` at ${(b.discharge_rate_mw / 1000).toFixed(1)}W` : '';
                chatText += ` (Discharging${rate})`;
              } else {
                chatText += " (Plugged in/Full)";
              }
              chatText += "\n";
            } else if (data.battery === null) {
              chatText += `萩 **Battery**: Not detected (Desktop PC)\n`;
            }

            // Disk
            if (data.disk && !data.disk.error) {
              chatText += `朕 **Disk (C:)**: ${data.disk.used_gb} GB / ${data.disk.total_gb} GB (${data.disk.usage_percent}%)\n`;
            }

            // Uptime
            if (data.uptime && !data.uptime.error) {
              chatText += `竢ｱ・・**Uptime**: ${data.uptime.hours}h ${data.uptime.minutes}m\n`;
            }

            // OS info
            if (data.os) {
              chatText += `笞呻ｸ・**OS**: ${data.os}`;
            }

            // 3. Build a natural summary for TTS
            let ttsParts = [];
            ttsParts.push("Here are your PC statistics.");

            if (data.cpu && !data.cpu.error) {
              ttsParts.push(`CPU usage is at ${Math.round(data.cpu.usage_percent)} percent.`);
            }
            if (data.ram && !data.ram.error) {
              ttsParts.push(`RAM usage is ${Math.round(data.ram.used_gb)} gigabytes out of ${Math.round(data.ram.total_gb)}.`);
            }

            const activeNvidia = data.gpus ? data.gpus.find(g => g.has_metrics) : null;
            if (activeNvidia) {
              ttsParts.push(`The GPU is at ${activeNvidia.utilization_percent} percent usage and ${activeNvidia.temp_c} degrees.`);
            }

            if (data.battery && !data.battery.error) {
              const b = data.battery;
              if (b.charging) {
                const rate = b.charge_rate_mw ? ` at ${(b.charge_rate_mw / 1000).toFixed(1)} watts` : '';
                ttsParts.push(`The battery is at ${b.percent} percent and charging${rate}.`);
              } else if (b.discharging) {
                const rate = b.discharge_rate_mw ? ` at ${(b.discharge_rate_mw / 1000).toFixed(1)} watts` : '';
                ttsParts.push(`The battery is at ${b.percent} percent and discharging${rate}.`);
              } else {
                ttsParts.push(`The battery is fully charged at ${b.percent} percent.`);
              }
            }

            if (data.disk && !data.disk.error) {
              if (data.disk.usage_percent > 90) {
                ttsParts.push(`Warning: C drive is ${data.disk.usage_percent} percent full.`);
              }
            }

            const ttsText = ttsParts.join(" ");

            // 4. Update messages and play TTS
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: chatText }
            ]);

            speakSystemMessage(ttsText, 'happy');
          })
          .catch((err) => {
            setIsThinking(false);
            console.error("Failed to query PC stats:", err);
            const errorMsg = "Sorry Master, I couldn't retrieve your PC statistics right now. Make sure the backend server is running.";
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: errorMsg }
            ]);
            speakSystemMessage(errorMsg, 'sad');
          });
        return;
      }

      const isOpenCmd = cmd === '/open' || cmd === '/o';
      const isPlayCmd = cmd === '/play' || cmd === '/p';
      if (isOpenCmd || isPlayCmd) {
        const query = text.substring(cmd.length).trim();
        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setIsThinking(false);
        setTtsStreamActive(false);

        if (!query) {
          const errorMsg = `Please specify what you want to ${isOpenCmd ? 'open' : 'play'}. Example: ${cmd} paint`;
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: errorMsg }
          ]);
          speakSystemMessage(errorMsg, 'neutral');
          return;
        }

        const runOpenPlay = (forceFlag = false, pendingConfirmationId = null) => {
          fetch(`${API_BASE}/api/system/open_or_play`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: query,
              play_mode: isPlayCmd,
              force: forceFlag,
              pending_confirmation_id: pendingConfirmationId,
              from_suggestion: fromSuggestion
            })
          })
            .then((res) => {
              if (!res.ok) throw new Error("Could not contact system open/play endpoint.");
              return res.json();
            })
            .then((data) => {
              if (data.status === 'confirm_required') {
                setIsThinking(false);
                setConfirmModal({
                  visible: true,
                  title: 'Security Confirmation',
                  message: `Yuki wants to open/run the following program:\n\n${data.name}`,
                  onConfirm: () => {
                    setConfirmModal(prev => ({ ...prev, visible: false }));

                    // Refocus, disable clickthrough suspension temporarily
                    window.yukiConfirmJustClosed = true;
                    if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
                      window.electronAPI.setIgnoreMouseEvents(false);
                    }
                    setTimeout(() => {
                      window.yukiConfirmJustClosed = false;
                    }, 2000);
                    setTimeout(() => {
                      desktopInputRef.current?.focus();
                    }, 50);

                    setIsThinking(true);
                    runOpenPlay(true, data.pending_confirmation_id || null);
                  },
                  onCancel: () => {
                    setConfirmModal(prev => ({ ...prev, visible: false }));

                    // Refocus, disable clickthrough suspension temporarily
                    window.yukiConfirmJustClosed = true;
                    if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
                      window.electronAPI.setIgnoreMouseEvents(false);
                    }
                    setTimeout(() => {
                      window.yukiConfirmJustClosed = false;
                    }, 2000);
                    setTimeout(() => {
                      desktopInputRef.current?.focus();
                    }, 50);

                    const cancelMsg = "Error: Execution cancelled by user confirmation security check.";
                    setMessages((prev) => [
                      ...prev,
                      { role: 'assistant', content: cancelMsg }
                    ]);
                    speakSystemMessage(cancelMsg, 'sad');
                  }
                });
                return;
              }
              setIsThinking(false);
              if (data.error) {
                throw new Error(data.error);
              }
              const chatText = data.result || "Command executed.";
              setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: chatText }
              ]);
              speakSystemMessage(chatText, 'happy');
            })
            .catch((err) => {
              setIsThinking(false);
              console.error("Failed to execute open/play command:", err);
              const errorMsg = `Sorry Master, I couldn't execute that command: ${err.message}`;
              setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: errorMsg }
              ]);
              speakSystemMessage(errorMsg, 'sad');
            });
        };

        setIsThinking(true);
        runOpenPlay(false);
        return;
      }

      let resolvedCmd = false;
      let responseText = '';

      if (cmd === '/wink') {
        responseText = "*winks at you*";
        resolvedCmd = true;
      } else if (cmd === '/angry') {
        responseText = "*pouts angrily*";
        resolvedCmd = true;
      } else if (cmd === '/sad') {
        responseText = "*sighs sadly*";
        resolvedCmd = true;
      } else if (cmd === '/surprised') {
        responseText = "*looks surprised*";
        resolvedCmd = true;
      } else if (cmd === '/relaxed') {
        responseText = "*smiles relaxedly*";
        resolvedCmd = true;
      } else if (cmd === '/neutral') {
        responseText = "*resets expression*";
        resolvedCmd = true;
      } else {
        const matchingAnim = ANIMATIONS.find((anim) =>
          anim.commands.some((c) => c.cmd === cmd)
        );
        if (matchingAnim) {
          if (disabledAnimations.includes(matchingAnim.name)) {
            const errorMsg = `*Animation "${matchingAnim.name}" is currently disabled.*`;
            setMessages((prev) => [
              ...prev,
              { role: 'user', content: text },
              { role: 'assistant', content: errorMsg }
            ]);
            setIsThinking(false);
            setTtsStreamActive(false);
            return;
          }
          responseText = matchingAnim.responseText;
          setCustomAnimation(matchingAnim.name);
          setTimeout(() => setCustomAnimation(''), 100);
          resolvedCmd = true;
        }
      }

      if (resolvedCmd) {
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: responseText }
        ]);

        const expr = detectExpression(responseText);
        setAvatarExpression(expr);
        speakSystemMessage(responseText, expr);
        return;
      }
    }

    // Default chat turn: Set stream active and thinking state FIRST to prevent coordinator race
    setTtsStreamActive(true);
    setIsThinking(true);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const payload = { type: 'chat', message: text };
      if (sttTimeMs !== null) {
        payload.stt_time_ms = sttTimeMs;
      }
      socketRef.current.send(JSON.stringify(payload));
    } else {
      console.log(`WebSocket offline, cannot send message. ReadyState: ${socketRef.current ? socketRef.current.readyState : 'null'}`);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Hmph! I'm currently offline, Master. Make sure the backend server is running!" }
      ]);
      setIsThinking(false);
      setTtsStreamActive(false);
      updateListeningState();
    }
  };

const detectExpression = (text) => {
  if (!text) return 'neutral';
  const lower = text.toLowerCase();

  if (lower.includes('wink')) {
    return 'wink';
  }
  if (lower.includes('relaxed') || lower.includes('smug') || lower.includes('flirt')) {
    return 'relaxed';
  }
  if (
    lower.includes('smile') || lower.includes('giggle') || lower.includes('laugh') ||
    lower.includes('happy') || lower.includes('joy') || lower.includes('・') ||
    lower.includes('・') || lower.includes('・') || lower.includes('・') ||
    lower.includes('・') || lower.includes('・') || lower.includes('､｣')
  ) {
    return 'happy';
  }
  if (
    lower.includes('cry') || lower.includes('sad') || lower.includes('sigh') ||
    lower.includes('sorrow') || lower.includes('个') || lower.includes('亊') ||
    lower.includes('・') || lower.includes('弌') || lower.includes('仭')
  ) {
    return 'sad';
  }
  if (
    lower.includes('pout') || lower.includes('angry') || lower.includes('anger') ||
    lower.includes('scold') || lower.includes('丐') || lower.includes('丕') ||
    lower.includes('､ｬ') || lower.includes('汰')
  ) {
    return 'angry';
  }
  if (
    lower.includes('gasp') || lower.includes('surprise') || lower.includes('shock') ||
    lower.includes('舒') || lower.includes('亟') || lower.includes('亠') ||
    lower.includes('亞') || lower.includes('凰')
  ) {
    return 'surprised';
  }
  return 'neutral';
};

  // 5. Send text message
  const handleSendMessage = (e, textOverride, fromSuggestion = false) => {
    e.preventDefault();
    const textToSubmit = textOverride !== undefined ? textOverride : inputText;
    if (!textToSubmit.trim()) return;
    const text = textToSubmit.trim();
    setInputText('');
    sendMessageText(text, null, fromSuggestion);
  };

  // 6. Reset settings and history
  const handleReset = async () => {
    clearContinuedConversationSession();
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'reset' }));
    }

    try {
      await fetch(`${API_BASE}/api/profile/reset`, { method: 'POST' });
    } catch (e) {
      console.warn(e);
    }

    // Clear queue and stop playback
    if (stopAllPlaybackRef.current) stopAllPlaybackRef.current();
    setMessages([]);
    setCurrentSpeechText('');
    console.log(" Clear queue and stop playback");
    setAvatarExpression('neutral');
    setAudioLevel(0);
    setIsThinking(false);

    fetchProfileDetails();
  };

  const fetchProfileDetails = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/profile`);
      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        if (data.settings && data.settings.crawler_paused !== undefined) {
          setCrawlerPaused(data.settings.crawler_paused);
        }
        if (data.settings && data.settings.tagger_paused !== undefined) {
          setTaggerPaused(data.settings.tagger_paused);
        }
      }
    } catch (e) {
      console.warn("Could not load memory profile from REST API:", e);
    }
  };


  const fetchLlmModels = async () => {
    try {
      setAvailableLlmModels([]);
      const response = await fetch(`${API_BASE}/api/models`);
      if (response.ok) {
        const data = await response.json();
        if (data.models && data.models.length > 0) {
          setAvailableLlmModels(data.models);
          // Clear stale model if current selection not in new list
          const currentModel = profile.settings?.llm_model;
          if (currentModel && !data.models.some(m => m.name === currentModel)) {
            handleUpdateSetting('llm_model', '');
          }
        }
      }
    } catch (e) {
      console.warn("Could not load LLM models from backend:", e);
    }
  };

  const fetchVrmModels = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/models/vrm`);
      if (response.ok) {
        const data = await response.json();
        if (data.models) setVrmModels(data.models);
        if (data.custom) setVrmCustomModels(data.custom);
      }
    } catch (e) {
      console.warn("Could not load VRM models list from REST API:", e);
    }
  };

  const handleVrmUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.vrm')) {
      alert('Only .vrm files are supported');
      return;
    }
    setVrmUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/api/models/vrm/upload`, { method: 'POST', body: form });
      if (res.ok) {
        await fetchVrmModels();
        handleUpdateSetting('active_vrm_model', file.name);
      } else {
        const err = await res.text();
        alert('Upload failed: ' + err);
      }
    } catch (err) {
      alert('Upload failed: ' + err.message);
    }
    setVrmUploading(false);
    e.target.value = '';
  };

  const handleVrmDelete = async (name) => {
    if (!confirm(`Delete custom model "${name.replace('.vrm', '')}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/models/vrm/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (res.ok) {
        if (profile.settings?.active_vrm_model === name) {
          handleUpdateSetting('active_vrm_model', 'default.vrm');
        }
        await fetchVrmModels();
      }
    } catch (e) {
      console.warn('Could not delete VRM model:', e);
    }
  };

  // Initial mounts
  useEffect(() => {
    connectWebSocket();
    fetchProfileDetails();
    fetchHealthDetails();
    fetchVrmModels();
    fetchLlmModels();
  }, []);

  const handleTerminate = () => {
    console.log("[Terminate] Interrupting current turn and reverting messages.");
    stopAllPlayback();
    setIsThinking(false);
    setTtsStreamActive(false);
    setCurrentSpeechText("");
    hasReceivedAudioRef.current = false;

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }

    setMessages((prev) => {
      const lastUserIdx = [...prev].reverse().findIndex(m => m.role === 'user');
      if (lastUserIdx !== -1) {
        const idx = prev.length - 1 - lastUserIdx;
        console.log(`[Terminate] Slicing messages to index ${idx} to revert last user message.`);
        return prev.slice(0, idx);
      }
      return prev;
    });

    setTimeout(() => {
      updateListeningState();
    }, 100);
  };

  const isElectron = window.electronAPI && window.electronAPI.isElectron;

  if (isElectron) {
    return (
      <div className="app-viewport" style={{
        '--avatar-scale': avatarScale,
        '--avatar-button-scale': avatarScale < 1.0 ? avatarScale : 1.0 + (avatarScale - 1.0) * 0.25
      }}>
        <main className="canvas-container">
          <Suspense fallback={<div style={{color: '#8b5cf6', padding: '20px', fontFamily: 'monospace'}}>Initializing 3D Engine...</div>}>
            <AvatarViewer
              audioLevel={audioLevel}
              isThinking={isThinking || ttsStreamActive}
              isListening={isListening}
              isWalking={isWalking}
              walkDirection={walkDirection}
              expression={avatarExpression}
              cpuLoad={cpuLoad}
              systemIdleTime={systemIdleTime}
              onFileDropped={handleFileDropped}
              scale={avatarScale}
              skinToneColor={avatarSkinToneColor}
              customAnimation={customAnimation}
              disabledAnimations={disabledAnimations}
              activeModel={profile.settings?.active_vrm_model || 'default.vrm'}
              enableRotation={profile.settings?.enable_rotation !== undefined ? profile.settings.enable_rotation : true}
              autoResetRotation={profile.settings?.auto_reset_rotation || false}
              visible={isVisible}
              isBackendOnline={backendStatus === 'online'}
              vrmDpr={profile.settings?.vrm_dpr || 1.5}
              vrmFps={profile.settings?.vrm_fps || 60}
            />
          </Suspense>
        </main>

        {/* Floating Vertical Menu near Yuki's body */}
        <div className={`desktop-overlay-menu interactive-element ${isHovered || isChatOpen || isSettingsOpen ? 'visible' : ''}`}>
          <button
            className={`desktop-menu-btn ${isChatOpen ? 'active' : ''}`}
            onClick={() => setIsChatOpen(!isChatOpen)}
            title="Chat"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <button
            className={`desktop-menu-btn ${isSettingsOpen ? 'active' : ''}`}
            onClick={() => {
              if (window.electronAPI && window.electronAPI.openSettingsWindow) {
                window.electronAPI.openSettingsWindow();
              } else {
                setIsSettingsOpen(prev => !prev);
              }
            }}
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button
            className="desktop-menu-btn"
            onClick={() => window.electronAPI?.yukiHide?.()}
            title="Hide Yuki"
          >
            <Eye className="w-5 h-5" />
          </button>
          <button
            className={`desktop-menu-btn ${isVoiceCommandMode ? 'active' : ''}`}
            onClick={toggleVoiceCommandMode}
            title={isVoiceCommandMode ? "Voice Commands: ON (Listening)" : "Voice Commands: OFF"}
            style={{
              position: 'relative',
              background: isVoiceCommandMode ? 'rgba(45, 212, 191, 0.2)' : undefined,
              border: isVoiceCommandMode ? '1px solid rgba(45, 212, 191, 0.6)' : undefined,
              boxShadow: isVoiceCommandMode ? '0 0 10px rgba(45, 212, 191, 0.3)' : undefined
            }}
          >
            {isVoiceCommandMode ? (
              <Mic className="w-5 h-5 text-teal-400 breathing" />
            ) : (
              <MicOff className="w-5 h-5 text-gray-400" />
            )}
          </button>
          <button
            className="desktop-menu-btn terminate-btn"
            onClick={handleTerminate}
            title="Terminate/Cancel Processing"
          >
            <Square className="w-4 h-4 text-red-500 fill-red-500" />
          </button>
          <button
            className={`desktop-menu-btn ${muteVoice ? 'active' : ''}`}
            onClick={() => handleToggleMute(!muteVoice)}
            title="Mute/Unmute"
          >
            {muteVoice ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <button
            className="desktop-menu-btn close-btn"
            onClick={() => window.close()}
            title="Exit Yuki"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Comic Speech Bubble next to Yuki's head */}
        {currentSpeechText && (
          <div className="desktop-speech-bubble interactive-element">
            <span className="desktop-bubble-tag">Yuki</span>
            <p className="desktop-bubble-text">{currentSpeechText}</p>
          </div>
        )}
        {(isThinking || ttsStreamActive) && !currentSpeechText && (
          <div className="desktop-speech-bubble interactive-element">
            <span className="desktop-bubble-tag">Yuki</span>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center', height: '20px', padding: '4px 0' }}>
              <div className="thinking-dot" style={{ animationDelay: '0s' }}></div>
              <div className="thinking-dot" style={{ animationDelay: '0.2s' }}></div>
              <div className="thinking-dot" style={{ animationDelay: '0.4s' }}></div>
            </div>
          </div>
        )}

        {/* Floating Chat Input bar */}
        {isChatOpen && (
          <div className="desktop-chat-input-container interactive-element" style={{ position: 'absolute' }}>
            {/* Chat History Log Panel */}
            {isPanelOpen && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: '8px',
                background: 'rgba(12, 8, 26, 0.97)',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                borderRadius: '12px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.08)',
                backdropFilter: 'blur(24px)',
                zIndex: 9998,
                maxHeight: '320px',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}>
                {/* Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 14px 6px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Terminal className="w-3.5 h-3.5 text-violet-400" />
                    <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.12em', color: 'rgba(139,92,246,0.85)', textTransform: 'uppercase' }}>
                      Conversation Log
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPanelOpen(false)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0 }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Messages scroll area */}
                <div style={{
                  padding: '10px 14px',
                  overflowY: 'auto',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  {messages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', opacity: 0.5, fontSize: '11px', color: 'white' }}>
                      No messages in buffer.
                    </div>
                  ) : (
                    messages.map((msg, index) => {
                      const isUser = msg.role === 'user';
                      const isSystem = msg.role === 'system';
                      return (
                        <div key={index} style={{
                          alignSelf: isSystem ? 'center' : isUser ? 'flex-end' : 'flex-start',
                          maxWidth: '85%',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px'
                        }}>
                          <span style={{
                            fontSize: '9px',
                            color: isSystem ? '#2dd4bf' : isUser ? '#c4b5fd' : '#94a3b8',
                            alignSelf: isUser ? 'flex-end' : 'flex-start',
                            fontWeight: '600'
                          }}>
                            {isSystem ? '[TOOL]' : isUser ? 'Master' : 'Yuki'}
                          </span>
                          <div style={{
                            background: isSystem
                              ? 'rgba(45, 212, 191, 0.1)'
                              : isUser
                                ? 'rgba(139, 92, 246, 0.25)'
                                : 'rgba(255, 255, 255, 0.08)',
                            border: isSystem
                              ? '1px solid rgba(45, 212, 191, 0.2)'
                              : isUser
                                ? '1px solid rgba(139, 92, 246, 0.3)'
                                : '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '8px',
                            padding: '6px 10px',
                            color: '#e2e8f0',
                            fontSize: '11px',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-line',
                            maxHeight: isSystem ? '80px' : 'none',
                            overflowY: isSystem ? 'auto' : 'visible'
                          }}>
                            {msg.content}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {/* Dummy ref to scroll to bottom */}
                  <div ref={desktopChatEndRef} />
                </div>
              </div>
            )}

            {/* Slash-command suggestion dropdown */}
            {showDesktopDropdown && (
              <div
                ref={desktopDropdownRef}
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  right: 0,
                  marginBottom: '8px',
                  background: 'rgba(12, 8, 26, 0.97)',
                  border: '1px solid rgba(139, 92, 246, 0.35)',
                  borderRadius: '12px',
                  boxShadow: '0 -10px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.08)',
                  backdropFilter: 'blur(24px)',
                  overflow: 'hidden',
                  zIndex: 9999,
                  maxHeight: '280px',
                  overflowY: 'auto',
                }}>
                <div style={{
                  padding: '6px 14px 5px',
                  fontSize: '9px',
                  fontWeight: '700',
                  letterSpacing: '0.12em',
                  color: 'rgba(139,92,246,0.65)',
                  textTransform: 'uppercase',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span>{desktopSearchMode ? `${desktopSearchMode.toUpperCase()} Suggestions` : 'Commands'}</span>
                  {isDesktopLoadingSuggestions && (
                    <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.4)', textTransform: 'none' }}>
                      Searching...
                    </span>
                  )}
                </div>

                {desktopSearchMode ? (
                  // Search suggestions render
                  desktopSearchQuery.trim() === '' ? (
                    <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                      Type to search {desktopSearchMode === 'play' ? 'songs and movies' : 'apps and files'}...
                    </div>
                  ) : (isDesktopLoadingSuggestions && desktopSearchSuggestions.length === 0) ? (
                    <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                      Scanning filesystem & database...
                    </div>
                  ) : desktopSearchSuggestions.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                      No matching results.
                    </div>
                  ) : (
                    desktopSearchSuggestions.map((item, idx) => (
                      <div
                        key={item.path}
                        data-index={idx}
                        onMouseDown={(e) => { e.preventDefault(); pickDesktopSearchSuggestion(item); }}
                        onMouseEnter={() => setActiveCmdIdx(idx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '8px 14px',
                          cursor: 'pointer',
                          background: activeCmdIdx === idx ? 'rgba(139, 92, 246, 0.18)' : 'transparent',
                          borderLeft: activeCmdIdx === idx ? '3px solid rgba(139, 92, 246, 0.85)' : '3px solid transparent',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {/* Icon */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '26px',
                          height: '26px',
                          borderRadius: '6px',
                          background: activeCmdIdx === idx ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.04)',
                          color: activeCmdIdx === idx ? '#c4b5fd' : 'rgba(255,255,255,0.5)',
                          transition: 'all 0.15s ease',
                          flexShrink: 0,
                        }}>
                          {item.type === 'app' ? (
                            <Monitor size={13} />
                          ) : (
                            /\.(mp3|wav|flac|ogg)$/i.test(item.path) ? (
                              <Music size={13} />
                            ) : /\.(mp4|mkv|webm|avi|mov)$/i.test(item.path) ? (
                              <Film size={13} />
                            ) : (
                              <File size={13} />
                            )
                          )}
                        </div>

                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          minWidth: 0,
                          flex: 1,
                        }}>
                          <span style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: activeCmdIdx === idx ? '#ffffff' : '#e2e8f0',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                          }}>
                            {item.name}
                          </span>
                          <span style={{
                            fontSize: '10px',
                            color: activeCmdIdx === idx ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                            direction: 'rtl',
                            textAlign: 'left',
                          }}>
                            {item.path}
                          </span>
                        </div>

                        {/* Badge */}
                        <span style={{
                          fontSize: '9px',
                          fontWeight: '700',
                          textTransform: 'uppercase',
                          padding: '1.5px 5px',
                          borderRadius: '4px',
                          letterSpacing: '0.05em',
                          background: item.type === 'app' ? 'rgba(45,212,191,0.12)' : 'rgba(139,92,246,0.12)',
                          color: item.type === 'app' ? '#2dd4bf' : '#a78bfa',
                          border: item.type === 'app' ? '1px solid rgba(45,212,191,0.2)' : '1px solid rgba(139,92,246,0.2)',
                          flexShrink: 0,
                        }}>
                          {item.type}
                        </span>
                      </div>
                    ))
                  )
                ) : (
                  // Static commands list render
                  cmdSuggestions.map(({ cmd, description }, idx) => (
                    <div
                      key={cmd}
                      data-index={idx}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setInputText(cmd + ' ');
                        setActiveCmdIdx(-1);
                        desktopInputRef.current?.focus();
                      }}
                      onMouseEnter={() => setActiveCmdIdx(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '8px 14px',
                        cursor: 'pointer',
                        background: activeCmdIdx === idx ? 'rgba(139, 92, 246, 0.18)' : 'transparent',
                        borderLeft: activeCmdIdx === idx ? '2px solid rgba(139, 92, 246, 0.8)' : '2px solid transparent',
                        transition: 'background 0.1s, border-color 0.1s',
                      }}
                    >
                      <span style={{
                        fontFamily: 'Consolas, monospace',
                        fontSize: '12px',
                        fontWeight: '600',
                        color: activeCmdIdx === idx ? '#c4b5fd' : '#a78bfa',
                        minWidth: '140px',
                        flexShrink: 0,
                      }}>
                        {cmd}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        color: 'rgba(200,200,220,0.5)',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}>
                        {description}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            <form onSubmit={handleSendMessage} className="desktop-chat-input-form">
              <input
                ref={desktopInputRef}
                type="text"
                className="desktop-chat-input"
                placeholder="Talk to Yuki or type / for commands..."
                value={inputText}
                onChange={(e) => { setInputText(e.target.value); setActiveCmdIdx(-1); }}
                onKeyDown={(e) => {
                  if (!showDesktopDropdown || activeDesktopSuggestions.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveCmdIdx((i) => Math.min(i + 1, activeDesktopSuggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveCmdIdx((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Tab' || (e.key === 'Enter' && activeCmdIdx >= 0)) {
                    e.preventDefault();
                    if (desktopSearchMode) {
                      pickDesktopSearchSuggestion(activeDesktopSuggestions[activeCmdIdx]);
                    } else {
                      setInputText(activeDesktopSuggestions[activeCmdIdx].cmd + ' ');
                      setActiveCmdIdx(-1);
                    }
                  } else if (e.key === 'Escape') {
                    setInputText('');
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                className={`desktop-chat-history-btn ${isPanelOpen ? 'active' : ''}`}
                onClick={() => setIsPanelOpen(!isPanelOpen)}
                title={isPanelOpen ? "Hide Chat History" : "Show Chat History"}
              >
                <History className="w-4 h-4" />
              </button>
              <button type="submit" className="desktop-chat-send-btn">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* Glassmorphism Settings Modal for Desktop */}
        {isSettingsOpen && (
          <div
            ref={settingsOverlayRef}
            className="desktop-modal-overlay interactive-element"
            style={{
              paddingTop: `${settingsPaddingTop}px`,
              alignItems: 'flex-start',
              justifyContent: 'center',
              display: 'flex',
              boxSizing: 'border-box',
              overflowY: 'auto'
            }}
          >
            <div ref={settingsCardRef} className="desktop-modal-card">
              <div className="desktop-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Settings className="w-4 h-4 text-purple-400" />
                  <h3 className="desktop-modal-title">Yuki Settings</h3>
                </div>
                <button className="desktop-modal-close" onClick={() => setIsSettingsOpen(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tab Navigation */}
              <div className="tab-nav-bar" style={{ marginBottom: '10px' }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('memory')}
                  className={`tab-btn ${activeTab === 'memory' ? 'active' : ''}`}
                  style={{ fontSize: '0.68rem', paddingBottom: '4px' }}
                >
                  Memory
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
                  style={{ fontSize: '0.68rem', paddingBottom: '4px' }}
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('crawler')}
                  className={`tab-btn ${activeTab === 'crawler' ? 'active' : ''}`}
                  style={{ fontSize: '0.68rem', paddingBottom: '4px' }}
                >
                  Crawler
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('config')}
                  className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
                  style={{ fontSize: '0.68rem', paddingBottom: '4px' }}
                >
                  Sys Info
                </button>
              </div>

              <div className="desktop-modal-body">
                {activeTab === 'memory' && (
                  <>
                    {/* User Identity Card */}
                    <div className="card-group">
                      <div className="card-group-header">
                        <User className="w-3.5 h-3.5" />
                        <span className="card-group-title">User Identity Card</span>
                      </div>

                      <div className="identity-field">
                        <span className="field-label">Preferred Name</span>
                        {isEditingName ? (
                          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                            <input
                              type="text"
                              value={editedName}
                              onChange={(e) => setEditedName(e.target.value)}
                              className="desktop-input-text"
                              style={{ padding: '4px 8px', fontSize: '0.75rem', flex: 1 }}
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                if (!editedName.trim()) return;
                                await handleUpdateProfile({ user_name: editedName.trim() });
                                setIsEditingName(false);
                              }}
                              style={{
                                background: 'var(--accent-teal)',
                                color: '#0b0813',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontSize: '0.72rem'
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingName(false)}
                              style={{
                                background: 'rgba(255,255,255,0.1)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                cursor: 'pointer',
                                fontSize: '0.72rem'
                              }}
                            >
                              X
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                            <span className="field-val" style={{ fontSize: '0.8rem' }}>{profile.user_name || 'Master'}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditedName(profile.user_name || 'Master');
                                setIsEditingName(true);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent-purple)',
                                cursor: 'pointer',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                textDecoration: 'underline',
                                padding: 0
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </div>

                      {/* User Interests */}
                      <div className="identity-field" style={{ marginTop: '4px' }}>
                        <span className="field-label">Interests</span>
                        {profile.user_interests && profile.user_interests.length > 0 ? (
                          <div className="interests-pill-box">
                            {profile.user_interests.map((int, i) => (
                              <span key={i} className="interest-pill" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', padding: '1px 6px' }}>
                                {int}
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const updatedInterests = profile.user_interests.filter(item => item !== int);
                                    await handleUpdateProfile({ user_interests: updatedInterests });
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#fca5a5',
                                    cursor: 'pointer',
                                    padding: '0 2px',
                                    fontSize: '9px',
                                    display: 'flex',
                                    alignItems: 'center'
                                  }}
                                >
                                  &times;
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            No interests recorded yet.
                          </span>
                        )}

                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <input
                            type="text"
                            placeholder="Add interest..."
                            value={newInterestText}
                            onChange={(e) => setNewInterestText(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (!newInterestText.trim()) return;
                                const currentList = profile.user_interests || [];
                                if (currentList.includes(newInterestText.trim())) return;
                                await handleUpdateProfile({ user_interests: [...currentList, newInterestText.trim()] });
                                setNewInterestText('');
                              }
                            }}
                            className="desktop-input-text"
                            style={{ padding: '4px 8px', fontSize: '0.75rem', flex: 1 }}
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              if (!newInterestText.trim()) return;
                              const currentList = profile.user_interests || [];
                              if (currentList.includes(newInterestText.trim())) return;
                              await handleUpdateProfile({ user_interests: [...currentList, newInterestText.trim()] });
                              setNewInterestText('');
                            }}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              borderRadius: '8px',
                              border: 'none',
                              color: 'white',
                              cursor: 'pointer',
                              background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'
                            }}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Episodic Facts Log */}
                    <div className="card-group" style={{ marginTop: '10px' }}>
                      <div className="card-group-header teal">
                        <Database className="w-3.5 h-3.5" />
                        <span className="card-group-title">Episodic Facts</span>
                      </div>

                      {profile.custom_facts && Object.keys(profile.custom_facts).length > 0 ? (
                        <div className="mono-logs-container" style={{ maxHeight: '160px', overflowY: 'auto' }}>
                          {Object.entries(profile.custom_facts).map(([key, val]) => (
                            <div key={key} className="log-entry-block" style={{ padding: '6px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="log-entry-key" style={{ fontSize: '0.68rem', wordBreak: 'break-all' }}>{key}</span>
                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                  {editingFactKey !== key ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingFactKey(key);
                                        setEditingFactValue(val);
                                      }}
                                      style={{ background: 'none', border: 'none', color: 'var(--accent-purple)', cursor: 'pointer', fontSize: '9px', textDecoration: 'underline', padding: 0 }}
                                    >
                                      Edit
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const updatedFacts = { ...profile.custom_facts };
                                      delete updatedFacts[key];
                                      await handleUpdateProfile({ custom_facts: updatedFacts });
                                    }}
                                    style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '9px', textDecoration: 'underline', padding: 0 }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>

                              {editingFactKey === key ? (
                                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                  <input
                                    type="text"
                                    value={editingFactValue}
                                    onChange={(e) => setEditingFactValue(e.target.value)}
                                    className="desktop-input-text"
                                    style={{ padding: '4px 6px', fontSize: '0.72rem', flex: 1, fontFamily: 'monospace' }}
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const updatedFacts = { ...profile.custom_facts, [key]: editingFactValue.trim() };
                                      await handleUpdateProfile({ custom_facts: updatedFacts });
                                      setEditingFactKey(null);
                                    }}
                                    style={{ background: 'var(--accent-teal)', color: '#0b0813', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingFactKey(null)}
                                    style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.7rem', cursor: 'pointer' }}
                                  >
                                    X
                                  </button>
                                </div>
                              ) : (
                                <span className="log-entry-val" style={{ fontSize: '0.72rem', wordBreak: 'break-word', marginTop: '2px' }}>{val}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          Yuki has not saved any persistent facts about you yet.
                        </span>
                      )}

                      {/* Add Custom Fact Inline Form */}
                      {isAddingFact ? (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!newFactKey.trim() || !newFactVal.trim()) return;
                            const updatedFacts = { ...profile.custom_facts, [newFactKey.trim()]: newFactVal.trim() };
                            await handleUpdateProfile({ custom_facts: updatedFacts });
                            setNewFactKey('');
                            setNewFactVal('');
                            setIsAddingFact(false);
                          }}
                          style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', padding: '6px', background: 'rgba(0,0,0,0.2)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '6px' }}
                        >
                          <span style={{ fontSize: '8px', fontWeight: 700, color: 'var(--accent-teal)' }}>Add Episodic Fact</span>
                          <input
                            type="text"
                            placeholder="Fact name (e.g. Hobby)"
                            value={newFactKey}
                            onChange={(e) => setNewFactKey(e.target.value)}
                            className="desktop-input-text"
                            style={{ padding: '4px 6px', fontSize: '0.72rem' }}
                            required
                          />
                          <input
                            type="text"
                            placeholder="Fact details (e.g. Piano)"
                            value={newFactVal}
                            onChange={(e) => setNewFactVal(e.target.value)}
                            className="desktop-input-text"
                            style={{ padding: '4px 6px', fontSize: '0.72rem' }}
                            required
                          />
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="submit"
                              style={{ background: 'var(--accent-teal)', color: '#0b0813', border: 'none', borderRadius: '4px', padding: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', flex: 1 }}
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsAddingFact(false)}
                              style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', borderRadius: '4px', padding: '4px', fontSize: '0.72rem', cursor: 'pointer', flex: 1 }}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsAddingFact(true)}
                          style={{
                            width: '100%',
                            padding: '6px',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px dashed rgba(255,255,255,0.15)',
                            color: 'var(--text-muted)',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            cursor: 'pointer',
                            textAlign: 'center',
                            marginTop: '2px'
                          }}
                        >
                          + Add Episodic Fact
                        </button>
                      )}
                    </div>

                    {/* Companion Specifications */}
                    <div className="card-group" style={{ marginTop: '10px' }}>
                      <div className="card-group-header teal">
                        <User className="w-3.5 h-3.5" />
                        <span className="card-group-title">Companion Specifications</span>
                      </div>
                      <div className="desktop-form-group" style={{ marginTop: '4px' }}>
                        <label className="desktop-label">Companion Name</label>
                        <input
                          type="text"
                          className="desktop-input-text"
                          value={localCharName}
                          onChange={(e) => setLocalCharName(e.target.value)}
                          style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                        />
                      </div>

                      <div className="desktop-form-group" style={{ marginTop: '4px' }}>
                        <label className="desktop-label">Persona Prompt Instructions</label>
                        <textarea
                          className="desktop-textarea"
                          value={localCharPersona}
                          onChange={(e) => setLocalCharPersona(e.target.value)}
                          style={{ padding: '6px 10px', fontSize: '0.72rem', minHeight: '90px' }}
                        />
                      </div>

                      <button
                        type="button"
                        onClick={async (e) => {
                          const btn = e.currentTarget;
                          const originalText = btn.innerText;
                          const originalBg = btn.style.background;
                          btn.innerText = "Saving...";
                          await handleUpdateSetting('character_name', localCharName);
                          await handleUpdateSetting('character_persona', localCharPersona);
                          btn.innerText = "✓ Saved";
                          btn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
                          setTimeout(() => {
                            btn.innerText = originalText;
                            btn.style.background = originalBg;
                          }, 2000);
                        }}
                        style={{
                          width: '100%',
                          padding: '6px 12px',
                          fontSize: '0.72rem',
                          borderRadius: '8px',
                          fontWeight: 600,
                          background: 'linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)',
                          border: 'none',
                          color: '#0b0813',
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(45, 212, 191, 0.25)',
                          transition: 'all 0.2s',
                          marginTop: '2px'
                        }}
                      >
                        Save Character Specs
                      </button>
                    </div>
                  </>
                )}

                {activeTab === 'settings' && (
                  <>
                    {/* Visuals & Audio */}
                    <div className="card-group">
                      <div className="card-group-header">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span className="card-group-title">Visuals & Audio</span>
                      </div>

                      <div className="desktop-form-group" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                        <label className="desktop-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                          {muteVoice ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-purple-400" />}
                          Mute Voice Output
                        </label>
                        <input
                          type="checkbox"
                          style={{ cursor: 'pointer', accentColor: '#a855f7' }}
                          checked={muteVoice}
                          onChange={(e) => handleToggleMute(e.target.checked)}
                        />
                      </div>

                      {/* Voice Volume Control */}
                      <div className="desktop-form-group" style={{ flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label className="desktop-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                            {muteVoice || voiceVolume === 0 ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-purple-400" />}
                            Voice Volume
                          </label>
                          <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a855f7' }}>
                            {Math.round(voiceVolume * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.0"
                          max="1.0"
                          step="0.05"
                          disabled={muteVoice}
                          value={muteVoice ? 0 : voiceVolume}
                          onChange={(e) => {
                            const newVolume = parseFloat(e.target.value);
                            setVoiceVolume(newVolume);
                            localStorage.setItem('yuki-voice-volume', newVolume.toString());
                          }}
                          style={{ width: '100%', cursor: muteVoice ? 'not-allowed' : 'pointer', accentColor: '#a855f7', opacity: muteVoice ? 0.5 : 1 }}
                        />
                      </div>

                      <div className="desktop-form-group" style={{ flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label className="desktop-label">Companion Scale</label>
                          <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a855f7' }}>
                            {Math.round(avatarScale * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.05"
                          value={avatarScale}
                          onChange={(e) => {
                            const newScale = parseFloat(e.target.value);
                            setAvatarScale(newScale);
                            localStorage.setItem('yuki-avatar-scale', newScale.toString());
                          }}
                          style={{ width: '100%', cursor: 'pointer', accentColor: '#a855f7' }}
                        />
                      </div>

                      <div className="desktop-form-group" style={{ flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                        <label className="desktop-label">Skin Color Preset</label>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {SKIN_PRESETS.map((preset) => (
                            <button
                              key={preset.value}
                              type="button"
                              onClick={() => {
                                setAvatarSkinToneColor(preset.value);
                                localStorage.setItem('yuki-avatar-skintone-color', preset.value);
                              }}
                              style={{
                                flex: '1 1 auto',
                                padding: '3px 4px',
                                fontSize: '0.65rem',
                                fontWeight: 700,
                                borderRadius: '4px',
                                border: avatarSkinToneColor === preset.value ? '1.5px solid #2dd4bf' : '1px solid rgba(255,255,255,0.12)',
                                background: preset.value === '#ffffff' ? '#ffffff' : preset.value,
                                color: preset.value === '#ffffff' || preset.value === '#FFE5E5' || preset.value === '#d89c7b' ? '#111' : '#fff',
                                cursor: 'pointer',
                                textAlign: 'center',
                                transition: 'all 0.1s'
                              }}
                            >
                              {preset.name}
                            </button>
                          ))}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                          <span className="desktop-label" style={{ fontSize: '0.68rem', margin: 0 }}>Custom Color:</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                            <input
                              type="color"
                              value={avatarSkinToneColor}
                              onChange={(e) => {
                                const val = e.target.value;
                                setAvatarSkinToneColor(val);
                                localStorage.setItem('yuki-avatar-skintone-color', val);
                              }}
                              style={{ border: 'none', width: '22px', height: '22px', borderRadius: '4px', cursor: 'pointer', background: 'none', padding: 0 }}
                            />
                            <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#ccc', fontWeight: 600 }}>
                              {avatarSkinToneColor.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* VRM Avatar Model dropdown */}
                      <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                        <label className="desktop-label">VRM Avatar Model</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                          <label style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px',
                            borderRadius: '6px', border: '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(255,255,255,0.04)', color: '#94a3b8', fontSize: '0.7rem',
                            cursor: 'pointer', userSelect: 'none', fontFamily: 'monospace', fontWeight: 600,
                          }}>
                            <Upload className="w-3 h-3" />
                            {vrmUploading ? 'Uploading...' : 'Upload VRM'}
                            <input type="file" accept=".vrm" onChange={handleVrmUpload} style={{ display: 'none' }} />
                          </label>
                        </div>
                        <select
                          className="desktop-select"
                          value={profile.settings?.active_vrm_model || 'default.vrm'}
                          onChange={(e) => handleUpdateSetting('active_vrm_model', e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        >
                          {vrmModels.map((model) => (
                            <option key={model} value={model} style={{ background: '#120c21', color: 'white' }}>
                              {model.replace('.vrm', '').replace(/_/g, ' ').toUpperCase() || model}
                            </option>
                          ))}
                        </select>
                        {vrmCustomModels.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                            {vrmCustomModels.map((name) => (
                              <span key={name} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '3px',
                                padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem',
                                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace',
                              }}>
                                {name.replace('.vrm', '')}
                                <button onClick={() => handleVrmDelete(name)} style={{
                                  background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer',
                                  padding: 0, fontSize: '0.65rem', display: 'flex', alignItems: 'center'
                                }}>×</button>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Rendering Resolution (DPR) & FPS Limit */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                          <div>
                            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '3px' }}>
                              Resolution (DPR)
                            </span>
                            <select
                              className="desktop-select"
                              value={profile.settings?.vrm_dpr || 1.5}
                              onChange={(e) => handleUpdateSetting('vrm_dpr', parseFloat(e.target.value))}
                              style={{ width: '100%', padding: '5px 6px', fontSize: '0.75rem' }}
                            >
                              <option value={1.0} style={{ background: '#120c21', color: 'white' }}>1.0 (Low RAM)</option>
                              <option value={1.25} style={{ background: '#120c21', color: 'white' }}>1.25 (Balanced)</option>
                              <option value={1.5} style={{ background: '#120c21', color: 'white' }}>1.5 (High Quality)</option>
                            </select>
                          </div>
                          <div>
                            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '3px' }}>
                              FPS Target
                            </span>
                            <select
                              className="desktop-select"
                              value={profile.settings?.vrm_fps || 60}
                              onChange={(e) => handleUpdateSetting('vrm_fps', parseInt(e.target.value, 10))}
                              style={{ width: '100%', padding: '5px 6px', fontSize: '0.75rem' }}
                            >
                              {[30, 40, 45, 50, 55, 60].map((fps) => (
                                <option key={fps} value={fps} style={{ background: '#120c21', color: 'white' }}>
                                  {fps} FPS
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Model Credits */}
                      <details style={{ marginTop: '4px' }}>
                        <summary style={{
                          fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer',
                          userSelect: 'none', outline: 'none',
                        }}>
                          Model Credits
                        </summary>
                        <div style={{
                          marginTop: '4px', padding: '8px', borderRadius: '6px',
                          background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)',
                          fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', lineHeight: '1.6',
                        }}>
                          <div style={{ marginBottom: '6px' }}>
                            <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: '2px' }}>Mizuki 2.0</div>
                            <div>Creator: <a href="https://hub.vroid.com/en/users/121822769" target="_blank" rel="noopener" style={{ color: '#6c5ce7', textDecoration: 'none' }}>googoogaga496</a></div>
                            <div>Model: <a href="https://hub.vroid.com/en/characters/147433999399938929/models/4488526919145096128" target="_blank" rel="noopener" style={{ color: '#6c5ce7', textDecoration: 'none' }}>VRoid Hub</a></div>
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: '2px' }}>Mixup, Mixup with Hat, Trial, Whai</div>
                            <div>Creator: <a href="https://hub.vroid.com/en/users/60415018" target="_blank" rel="noopener" style={{ color: '#6c5ce7', textDecoration: 'none' }}>opinion</a></div>
                          </div>
                        </div>
                      </details>

                      {/* TTS Voice Profile dropdown */}
                      <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                        <label className="desktop-label">Speech Synthesis Voice</label>
                        <select
                          className="desktop-select"
                          value={profile.settings?.tts_voice || 'af_sarah'}
                          onChange={(e) => handleUpdateSetting('tts_voice', e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        >
                          {TTS_VOICES.map((v) => (
                            <option key={v.value} value={v.value} style={{ background: '#120c21', color: 'white' }}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Speech delivery speed rate select */}
                      <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                        <label className="desktop-label">Speech Delivery Speed</label>
                        <select
                          className="desktop-select"
                          value={profile.settings?.tts_rate || '1.0'}
                          onChange={(e) => handleUpdateSetting('tts_rate', e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        >
                          {TTS_RATES.map((r) => (
                            <option key={r.value} value={r.value} style={{ background: '#120c21', color: 'white' }}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* TTS Device Selection */}
                      <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                        <label className="desktop-label">TTS Processing Device</label>
                        <select
                          className="desktop-select"
                          value={profile.settings?.tts_device || 'auto'}
                          onChange={(e) => handleUpdateSetting('tts_device', e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        >
                          <option value="auto" style={{ background: '#120c21', color: 'white' }}>Auto (Best Available)</option>
                          <option value="gpu" style={{ background: '#120c21', color: 'white' }}>GPU (CUDA)</option>
                          <option value="cpu" style={{ background: '#120c21', color: 'white' }}>CPU (Force CPU)</option>
                        </select>
                      </div>

                      {/* TTS Preload Toggle */}
                      <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <label className="desktop-label" style={{ marginBottom: 0 }}>Preload TTS on Startup</label>
                            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>
                              Loads voice model on boot (~250-400 MB). Off = loads on first speech.
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleUpdateSetting('tts_preload', !profile.settings?.tts_preload)}
                            style={{
                              background: profile.settings?.tts_preload ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)',
                              border: `1px solid ${profile.settings?.tts_preload ? 'rgba(139,92,246,0.6)' : 'rgba(255,255,255,0.12)'}`,
                              borderRadius: '12px',
                              width: '40px',
                              height: '22px',
                              cursor: 'pointer',
                              position: 'relative',
                              transition: 'all 0.2s ease',
                              flexShrink: 0
                            }}
                          >
                            <div style={{
                              width: '16px',
                              height: '16px',
                              borderRadius: '50%',
                              background: profile.settings?.tts_preload ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                              position: 'absolute',
                              top: '2px',
                              left: profile.settings?.tts_preload ? '20px' : '2px',
                              transition: 'all 0.2s ease'
                            }} />
                          </button>
                        </div>
                      </div>

                      {/* Microphone Input Device */}
                      <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label className="desktop-label">Microphone Input Device</label>
                          <button
                            type="button"
                            onClick={refreshMicDevices}
                            title="Refresh device list"
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                          >
                            <RefreshCw style={{ width: '10px', height: '10px' }} /> Refresh
                          </button>
                        </div>
                        <select
                          className="desktop-select"
                          value={selectedMicDeviceId}
                          onChange={(e) => {
                            const deviceId = e.target.value;
                            setSelectedMicDeviceId(deviceId);
                            selectedMicDeviceIdRef.current = deviceId;
                            if (deviceId) {
                              localStorage.setItem('yuki-mic-device-id', deviceId);
                            } else {
                              localStorage.removeItem('yuki-mic-device-id');
                            }
                          }}
                          style={{ padding: '6px 8px', fontSize: '0.75rem', marginTop: '2px' }}
                        >
                          <option value="" style={{ background: '#120c21', color: 'white' }}>🎙️ System Default</option>
                          {micDevices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId} style={{ background: '#120c21', color: 'white' }}>
                              {d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`}
                            </option>
                          ))}
                        </select>

                        {/* Prefer Headset Mic checkbox */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '7px', cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={preferHeadsetMic}
                            onChange={(e) => {
                              const val = e.target.checked;
                              setPreferHeadsetMic(val);
                              localStorage.setItem('yuki-prefer-headset', val.toString());
                              if (val) {
                                applyHeadsetPreference(micDevices, true);
                              }
                            }}
                            style={{ accentColor: '#a855f7', width: '13px', height: '13px', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #c4b5fd)', lineHeight: 1.3 }}>
                            Prefer headset mic — auto-select headset when connected, fall back to system default
                          </span>
                        </label>

                        {/* Wake up hotkey Alt+S turns on listening checkbox */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '7px', cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={hotkeyListening}
                            onChange={(e) => {
                              const val = e.target.checked;
                              setHotkeyListening(val);
                              localStorage.setItem('yuki-hotkey-listening', val.toString());
                            }}
                            style={{ accentColor: '#a855f7', width: '13px', height: '13px', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #c4b5fd)', lineHeight: 1.3 }}>
                            Wake up hotkey (Alt+S) turns on her listening
                          </span>
                        </label>
                      </div>

                      {/* Speech-to-Text Engine Select */}
                      <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                        <label className="desktop-label">Speech-to-Text Engine</label>
                        <select
                          className="desktop-select"
                          value={profile.settings?.use_local_whisper !== undefined ? (profile.settings.use_local_whisper ? 'local_whisper' : 'web_speech') : 'local_whisper'}
                          onChange={(e) => handleUpdateSetting('use_local_whisper', e.target.value === 'local_whisper')}
                          style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        >
                          <option value="local_whisper" style={{ background: '#120c21', color: 'white' }}>🎙️ Local Whisper (Offline / Recommended)</option>
                          <option value="web_speech" style={{ background: '#120c21', color: 'white' }}>🌐 Web Speech API (Browser Native)</option>
                        </select>
                      </div>

                      {/* Local Whisper Model Select */}
                      {(profile.settings?.use_local_whisper !== false) && (
                        <>
                          <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                            <label className="desktop-label">Whisper Model Size</label>
                            <select
                              className="desktop-select"
                              value={profile.settings?.whisper_model || 'base'}
                              onChange={(e) => handleUpdateSetting('whisper_model', e.target.value)}
                              style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                            >
                              <option value="base" style={{ background: '#120c21', color: 'white' }}>{getWhisperModelSizeText('base')}</option>
                              <option value="small" style={{ background: '#120c21', color: 'white' }}>{getWhisperModelSizeText('small')}</option>
                              <option value="tiny" style={{ background: '#120c21', color: 'white' }}>{getWhisperModelSizeText('tiny')}</option>
                            </select>
                          </div>

                          <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                            <label className="desktop-label">Whisper Compute Type</label>
                            <select
                              className="desktop-select"
                              value={profile.settings?.whisper_compute_type || 'int8_float16'}
                              onChange={(e) => handleUpdateSetting('whisper_compute_type', e.target.value)}
                              style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                            >
                              <option value="int8_float16" style={{ background: '#120c21', color: 'white' }}>int8_float16 (Low VRAM GPU)</option>
                              <option value="int8_float32" style={{ background: '#120c21', color: 'white' }}>int8_float32 (Recommended for GTX)</option>
                              <option value="float16" style={{ background: '#120c21', color: 'white' }}>float16 (Best for RTX GPU)</option>
                              <option value="int8" style={{ background: '#120c21', color: 'white' }}>int8 (Lightweight CPU / GPU)</option>
                              <option value="float32" style={{ background: '#120c21', color: 'white' }}>float32 (Unquantized - Slowest)</option>
                            </select>
                          </div>

                          {/* STT Device Selection */}
                          <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                            <label className="desktop-label">STT Processing Device</label>
                            <select
                              className="desktop-select"
                              value={profile.settings?.stt_device || 'auto'}
                              onChange={(e) => handleUpdateSetting('stt_device', e.target.value)}
                              style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                            >
                              <option value="auto" style={{ background: '#120c21', color: 'white' }}>Auto (Best Available)</option>
                              <option value="gpu" style={{ background: '#120c21', color: 'white' }}>GPU (CUDA)</option>
                              <option value="cpu" style={{ background: '#120c21', color: 'white' }}>CPU (Force CPU)</option>
                            </select>
                          </div>

                          {/* VAD Sensitivity Threshold Slider */}
                          <div className="desktop-form-group" style={{ flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <label className="desktop-label">VAD Sensitivity Threshold</label>
                              <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a855f7' }}>
                                {vadThreshold.toFixed(3)}
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.002"
                              max="0.08"
                              step="0.002"
                              value={vadThreshold}
                              onChange={(e) => {
                                const newThreshold = parseFloat(e.target.value);
                                setVadThreshold(newThreshold);
                                localStorage.setItem('yuki-vad-threshold', newThreshold.toString());
                              }}
                              style={{ width: '100%', cursor: 'pointer', accentColor: '#a855f7' }}
                            />
                            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: '1.2' }}>
                              Increase this threshold if Yuki gets stuck in a listening loop due to room noise or fan hum.
                            </span>
                          </div>

                          {/* Speech-to-Text Language Selection */}
                          <div className="desktop-form-group" style={{ marginTop: '6px' }}>
                            <label className="desktop-label">Speech-to-Text Language</label>
                            <select
                              className="desktop-select"
                              value={profile.settings?.stt_language || 'en'}
                              onChange={(e) => handleUpdateSetting('stt_language', e.target.value)}
                              style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                            >
                              <option value="en" style={{ background: '#120c21', color: 'white' }}>English</option>
                              <option value="hi" style={{ background: '#120c21', color: 'white' }}>Hindi (हिन्दी)</option>
                              <option value="ja" style={{ background: '#120c21', color: 'white' }}>Japanese (日本語)</option>
                            </select>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Brain & AI Settings */}
                    <div className="card-group" style={{ marginTop: '10px' }}>
                      <div className="card-group-header">
                        <Cpu className="w-3.5 h-3.5 text-purple-400" />
                        <span className="card-group-title">Brain & AI Settings</span>
                      </div>

                      {/* No LLM Mode */}
                      <div className="desktop-form-group" style={{ marginBottom: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={profile.settings?.no_llm_mode || false}
                            onChange={(e) => {
                              handleUpdateSetting('no_llm_mode', e.target.checked);
                            }}
                            style={{ accentColor: '#a855f7', width: '13px', height: '13px', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #c4b5fd)', lineHeight: 1.3 }}>
                            No LLM Mode — she will respond with "sorry, LLM is currently turned off" and avoid loading model
                          </span>
                        </label>
                      </div>

                      {/* Dynamic Tool Calling */}
                      <div className="desktop-form-group" style={{ marginBottom: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={profile.settings?.dynamic_tool_calling !== undefined ? profile.settings.dynamic_tool_calling : true}
                            onChange={(e) => handleUpdateSetting('dynamic_tool_calling', e.target.checked)}
                            style={{ accentColor: '#a855f7', width: '13px', height: '13px', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #c4b5fd)', lineHeight: 1.3 }}>
                            Dynamic Tool Calling — filter tool definitions based on user query to save context tokens (ON by default)
                          </span>
                        </label>
                      </div>

                      {/* LLM Backend Type */}
                      <div className="desktop-form-group">
                        <label className="desktop-label">LLM Backend</label>
                        <select
                          className="desktop-select"
                          value={profile.settings?.llm_backend || 'lmstudio'}
                          onChange={async (e) => {
                            const newBackend = e.target.value;
                            setAvailableLlmModels([]);
                            await handleUpdateSetting('llm_model', '');
                            await handleUpdateSetting('llm_backend', newBackend);
                            setLlmBackend(newBackend);
                            const defaults = {
                              lmstudio: 'http://127.0.0.1:1234',
                              ollama: 'http://127.0.0.1:11434',
                              vllm: 'http://127.0.0.1:8000/v1',
                              openai: '',
                              custom: '',
                            };
                            await handleUpdateSetting('llm_base_url', defaults[newBackend] || '');
                            if (newBackend !== 'none') {
                              setTimeout(() => fetchLlmModels(), 500);
                            }
                          }}
                          style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        >
                          <option value="lmstudio">LM Studio (Local)</option>
                          <option value="ollama">Ollama (Local)</option>
                          <option value="vllm">vLLM (Local)</option>
                          <option value="openai">OpenAI-Compatible (Cloud)</option>
                          <option value="custom">Custom Endpoint</option>
                          <option value="none">No LLM (Voice + File Search Only)</option>
                        </select>
                      </div>

                      {/* Base URL */}
                      {llmBackend !== 'none' && (
                        <div className="desktop-form-group">
                          <label className="desktop-label">
                            {llmBackend === 'lmstudio' ? 'LM Studio URL' : llmBackend === 'ollama' ? 'Ollama URL' : llmBackend === 'vllm' ? 'vLLM URL' : llmBackend === 'openai' ? 'API Base URL' : 'Endpoint URL'}
                          </label>
                          <input
                            type="text"
                            className="desktop-input"
                            placeholder={
                              llmBackend === 'lmstudio' ? 'http://127.0.0.1:1234' :
                                llmBackend === 'ollama' ? 'http://127.0.0.1:11434' :
                                  llmBackend === 'vllm' ? 'http://127.0.0.1:8000/v1' :
                                    llmBackend === 'openai' ? 'https://api.groq.com/openai' :
                                      'http://127.0.0.1:8000/v1'
                            }
                            value={profile.settings?.llm_base_url || ''}
                            onChange={(e) => handleUpdateSetting('llm_base_url', e.target.value)}
                            onBlur={(e) => {
                              if (!e.target.value.trim()) {
                                const defaults = {
                                  lmstudio: 'http://127.0.0.1:1234',
                                  ollama: 'http://127.0.0.1:11434',
                                  vllm: 'http://127.0.0.1:8000/v1',
                                  custom: 'http://127.0.0.1:8000/v1',
                                };
                                if (defaults[llmBackend]) handleUpdateSetting('llm_base_url', defaults[llmBackend]);
                              }
                            }}
                            style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                          />
                        </div>
                      )}

                      {/* API Key (for cloud backends) */}
                      {(llmBackend === 'openai' || llmBackend === 'custom') && (
                        <div className="desktop-form-group">
                          <label className="desktop-label">API Key</label>
                          <input
                            type="password"
                            className="desktop-input"
                            placeholder="sk-..."
                            value={profile.settings?.llm_api_key || ''}
                            onChange={(e) => handleUpdateSetting('llm_api_key', e.target.value)}
                            style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                          />
                        </div>
                      )}

                      {/* Active Model Selection */}
                      {llmBackend !== 'none' && (
                      <div className="desktop-form-group">
                        <label className="desktop-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>Active Model Selection</span>
                          <button
                            onClick={fetchLlmModels}
                            style={{ background: 'none', border: 'none', color: 'var(--accent-purple, #a855f7)', cursor: 'pointer', fontSize: '0.65rem', padding: '0', opacity: 0.75 }}
                            title="Refresh models from backend"
                          >↻ Refresh</button>
                        </label>
                        <select
                          className="desktop-select"
                          value={profile.settings?.llm_model || ''}
                          onChange={(e) => handleUpdateSetting('llm_model', e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        >
                          {!profile.settings?.llm_model && (
                            <option value="" style={{ background: '#120c21', color: 'white', opacity: 0.5 }}>
                              Select a model...
                            </option>
                          )}
                          {availableLlmModels.map((model) => (
                            <option key={model.name} value={model.name} style={{ background: '#120c21', color: 'white' }}>
                              {model.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      )}
                    </div>

                    {/* Rotation Behavior */}
                    <div className="card-group" style={{ marginTop: '10px' }}>
                      <div className="card-group-header">
                        <Cpu className="w-3.5 h-3.5 text-teal-400" />
                        <span className="card-group-title">Rotation Behavior</span>
                      </div>

                      <div className="desktop-form-group" style={{ flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={profile.settings?.enable_rotation !== undefined ? profile.settings.enable_rotation : true}
                            onChange={(e) => handleUpdateSetting('enable_rotation', e.target.checked)}
                            style={{ accentColor: '#2dd4bf', width: '13px', height: '13px', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.72rem', color: '#99f6e4', lineHeight: 1.3 }}>
                            Enable Model Rotation (Right-Click Drag)
                          </span>
                        </label>

                        {(profile.settings?.enable_rotation !== undefined ? profile.settings.enable_rotation : true) && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '4px', marginLeft: '16px', cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={profile.settings?.auto_reset_rotation || false}
                              onChange={(e) => handleUpdateSetting('auto_reset_rotation', e.target.checked)}
                              style={{ accentColor: '#2dd4bf', width: '13px', height: '13px', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '0.72rem', color: '#99f6e4', lineHeight: 1.3 }}>
                              Return to original position after 10s
                            </span>
                          </label>
                        )}

                        {(profile.settings?.enable_rotation !== undefined ? profile.settings.enable_rotation : true) && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '4px', marginLeft: '16px', cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={cameraTrackingState}
                              onChange={(e) => {
                                setCameraTrackingState(e.target.checked);
                                if (window.yukiDebugToggles) window.yukiDebugToggles.cameraTracking = e.target.checked;
                              }}
                              style={{ accentColor: '#2dd4bf', width: '13px', height: '13px', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '0.72rem', color: '#99f6e4', lineHeight: 1.3 }}>
                              Enable looking at you — head tracks camera position
                            </span>
                          </label>
                        )}
                      </div>
                    </div>

                    {/* Animations Toggle */}
                    <div className="card-group" style={{ marginTop: '10px' }}>
                      <div className="card-group-header">
                        <Play className="w-3.5 h-3.5 text-purple-400" />
                        <span className="card-group-title">Animations Toggle</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '110px', overflowY: 'auto', paddingRight: '4px' }}>
                        {ANIMATIONS.map((anim) => {
                          const isEnabled = !disabledAnimations.includes(anim.name);
                          const displayName = anim.name
                            .split('_')
                            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                            .join(' ');
                          return (
                            <div key={anim.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.03)', padding: '4px 6px', borderRadius: '4px', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                              <span style={{ fontSize: '0.7rem', color: '#e2e8f0', fontWeight: '500' }}>{displayName}</span>
                              <input
                                type="checkbox"
                                style={{ cursor: 'pointer', accentColor: '#a855f7' }}
                                checked={isEnabled}
                                onChange={() => toggleAnimationEnabled(anim.name)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Maintenance */}
                    <div className="card-group" style={{ marginTop: '10px' }}>
                      <div className="card-group-header">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        <span className="card-group-title text-red-400">Maintenance</span>
                      </div>

                      <button
                        type="button"
                        className="panel-btn-action"
                        style={{
                          width: '100%',
                          padding: '6px 12px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#ef4444',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          marginTop: '2px'
                        }}
                        onClick={() => {
                          if (confirm("Reset chat memory and settings?")) {
                            handleReset();
                            setIsSettingsOpen(false);
                          }
                        }}
                      >
                        Reset Companion Card
                      </button>
                    </div>
                  </>
                )}

                {activeTab === 'crawler' && (
                  <>
                    {/* Indexer Status Diagnostics */}
                    <div className="card-group">
                      <div className="card-group-header teal">
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span className="card-group-title">File Crawler status</span>
                      </div>

                      <div className="spec-list-table" style={{ fontSize: '0.72rem' }}>
                        <div className="spec-row">
                          <span className="spec-label">Scan State</span>
                          <span className="spec-val" style={{ color: crawlerStatus.paused ? '#c084fc' : (crawlerStatus.current_root_path && crawlerStatus.current_root_path !== 'Idle' ? '#38bdf8' : '#2dd4bf'), fontWeight: 600 }}>
                            {crawlerStatus.paused ? 'Paused' : (crawlerStatus.current_root_path && crawlerStatus.current_root_path !== 'Idle' ? `Scanning (${crawlerStatus.roots_current}/${crawlerStatus.roots_total})` : 'Idle / Watching')}
                          </span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Priority Phase</span>
                          <span className="spec-val" style={{ color: crawlerStatus.first_time_priority_done ? '#2dd4bf' : '#38bdf8', fontWeight: 600 }}>
                            {crawlerStatus.first_time_priority_done ? 'Completed' : 'Pending / Scanning'}
                          </span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Initial Full Cycle</span>
                          <span className="spec-val" style={{ color: crawlerStatus.first_cycle_done ? '#2dd4bf' : '#38bdf8', fontWeight: 600 }}>
                            {crawlerStatus.first_cycle_done ? 'Completed' : 'Scanning'}
                          </span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Real-time Watchdog</span>
                          <span className="spec-val" style={{ color: crawlerStatus.watchdog_active ? '#2dd4bf' : '#ef4444', fontWeight: 600 }}>
                            {crawlerStatus.watchdog_active ? 'Active' : 'Offline'}
                          </span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">AI Tagger Status</span>
                          <span className="spec-val" style={{ color: crawlerStatus.tagger_paused ? '#c084fc' : '#2dd4bf', fontWeight: 600 }}>
                            {crawlerStatus.tagger_paused ? 'Paused' : 'Active'}
                          </span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Indexed Files</span>
                          <span className="spec-val" style={{ fontWeight: 600 }}>{crawlerStatus.total_files}</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Pending AI Tags</span>
                          <span className="spec-val" style={{ fontWeight: 600 }}>{crawlerStatus.pending_enrichment}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                        <button
                          type="button"
                          onClick={() => handleToggleCrawlerPause(!crawlerPaused)}
                          style={{
                            width: '100%',
                            padding: '6px 12px',
                            fontSize: '0.72rem',
                            borderRadius: '6px',
                            fontWeight: 600,
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            background: crawlerPaused
                              ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'
                              : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                          }}
                        >
                          {crawlerPaused ? 'Resume File Crawler' : 'Pause File Crawler'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleTaggerPause(!taggerPaused)}
                          style={{
                            width: '100%',
                            padding: '6px 12px',
                            fontSize: '0.72rem',
                            borderRadius: '6px',
                            fontWeight: 600,
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            background: taggerPaused
                              ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'
                              : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                          }}
                        >
                          {taggerPaused ? 'Resume Metadata Tagger' : 'Pause Metadata Tagger'}
                        </button>

                        <button
                          type="button"
                          onClick={handleTriggerRecrawl}
                          style={{
                            width: '100%',
                            padding: '6px 12px',
                            fontSize: '0.72rem',
                            borderRadius: '6px',
                            fontWeight: 600,
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)'
                          }}
                        >
                          Force Full Recrawl
                        </button>
                      </div>
                    </div>

                    {/* Live Paths Diagnostic */}
                    <div className="card-group" style={{ marginTop: '10px' }}>
                      <div className="card-group-header">
                        <HardDrive className="w-3.5 h-3.5 text-teal-400" />
                        <span className="card-group-title">Live Paths Diagnostic</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.7rem' }}>
                        <div>
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>File Crawler Walk Path:</span>
                          <div style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '4px', padding: '4px 6px', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: '50px', overflowY: 'auto', color: '#cbd5e1', lineHeight: '1.2', marginTop: '2px' }}>
                            {crawlerStatus.current_path || 'Idle'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>AI Metadata Tagger Path:</span>
                          <div style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '4px', padding: '4px 6px', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: '50px', overflowY: 'auto', color: '#cbd5e1', lineHeight: '1.2', marginTop: '2px' }}>
                            {crawlerStatus.current_tagger_path || 'Idle'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>Completed Target Roots ({crawlerStatus.completed_roots?.length || 0}):</span>
                          <div style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '4px', padding: '4px 6px', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: '40px', overflowY: 'auto', color: '#cbd5e1', lineHeight: '1.2', marginTop: '2px' }}>
                            {crawlerStatus.completed_roots && crawlerStatus.completed_roots.length > 0 ? crawlerStatus.completed_roots.join(', ') : 'None'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>Remaining Target Roots ({crawlerStatus.remaining_roots?.length || 0}):</span>
                          <div style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '4px', padding: '4px 6px', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: '40px', overflowY: 'auto', color: '#cbd5e1', lineHeight: '1.2', marginTop: '2px' }}>
                            {crawlerStatus.remaining_roots && crawlerStatus.remaining_roots.length > 0 ? crawlerStatus.remaining_roots.join(', ') : 'None'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeTab === 'config' && (
                  <>
                    {/* Platform specs */}
                    <div className="card-group">
                      <div className="card-group-header teal">
                        <HardDrive className="w-3.5 h-3.5" />
                        <span className="card-group-title">Platform Specifications</span>
                      </div>

                      <div className="spec-list-table" style={{ fontSize: '0.72rem' }}>
                        <div className="spec-row">
                          <span className="spec-label">LLM Backend</span>
                          <span className="spec-val" style={{ fontFamily: 'monospace', fontSize: '0.68rem', wordBreak: 'break-all' }}>
                            {llmBackend || 'lmstudio'}
                          </span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">LLM Endpoint</span>
                          <span className="spec-val" style={{ fontFamily: 'monospace', fontSize: '0.68rem', wordBreak: 'break-all' }}>
                            {lmstudioUrl || 'http://127.0.0.1:1234'}
                          </span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Host OS</span>
                          <span className="spec-val">Windows 10/11</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Audio Output</span>
                          <span className="spec-val">Web Audio Synthesizer</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">STT Listener</span>
                          <span className="spec-val">Web Speech API</span>
                        </div>
                      </div>
                    </div>

                    {/* GPU Memory Usage */}
                    <div className="card-group" style={{ marginTop: '10px' }}>
                      <div className="card-group-header">
                        <Monitor className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="card-group-title">GPU Memory Usage</span>
                      </div>

                      {gpuMemData.error && (
                        <div style={{ fontSize: '0.68rem', color: '#f87171', marginTop: '4px' }}>
                          {gpuMemData.error}
                        </div>
                      )}

                      {!gpuMemData.error && Object.keys(gpuMemData.top5 || {}).length === 0 && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          No GPU process data available
                        </div>
                      )}

                      {Object.entries(gpuMemData.top5 || {}).map(([gpuName, procs]) => (
                        <div key={gpuName} style={{ marginTop: '8px' }}>
                          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#5eead4', marginBottom: '4px' }}>
                            {gpuName}
                          </div>
                          <div style={{ overflowX: 'auto', background: 'rgba(0, 0, 0, 0.25)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.06)', maxHeight: '160px', overflowY: 'auto' }}>
                            <div style={{ minWidth: '280px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) 90px 90px', gap: '0', padding: '4px 8px', fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                <span>Process</span>
                                <span style={{ textAlign: 'right' }}>Dedicated</span>
                                <span style={{ textAlign: 'right' }}>Shared</span>
                              </div>
                              {procs.map((p, i) => (
                                <div key={`${p.pid}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) 90px 90px', gap: '0', padding: '3px 8px', fontSize: '0.68rem', color: '#cbd5e1', borderTop: i > 0 ? '1px solid rgba(255, 255, 255, 0.03)' : 'none' }}>
                                  <span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '9px', marginRight: '4px' }}>{p.pid}</span>
                                    {p.name}
                                  </span>
                                  <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.65rem' }}>
                                    {p.dedicated_mb >= 1024 ? `${(p.dedicated_mb / 1024).toFixed(1)} GB` : `${p.dedicated_mb} MB`}
                                  </span>
                                  <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.65rem' }}>
                                    {p.shared_mb >= 1024 ? `${(p.shared_mb / 1024).toFixed(1)} GB` : `${p.shared_mb} MB`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* System Offline warning banner */}
        {backendStatus === 'offline' && (
          <div className="offline-banner-floating interactive-element" style={{ bottom: '16px', left: '16px' }}>
            <ShieldAlert className="w-4 h-4 text-red-400" />
            <span>Core disconnected.</span>
          </div>
        )}

        {/* Custom Styled Confirmation Modal */}
        {confirmModal.visible && (
          <div className="yuki-confirm-overlay interactive-element">
            <div className="yuki-confirm-card">
              <h3 className="yuki-confirm-title">
                <ShieldAlert className="w-5 h-5 text-violet-400" />
                {confirmModal.title}
              </h3>
              <p className="yuki-confirm-message">{confirmModal.message}</p>
              <div className="yuki-confirm-buttons">
                <button
                  type="button"
                  className="yuki-confirm-btn yuki-confirm-btn-proceed"
                  onClick={confirmModal.onConfirm}
                >
                  Proceed (Enter)
                </button>
                <button
                  type="button"
                  className="yuki-confirm-btn yuki-confirm-btn-cancel"
                  onClick={confirmModal.onCancel}
                >
                  Cancel (Esc)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-viewport" style={{
      '--avatar-scale': avatarScale,
      '--avatar-button-scale': avatarScale < 1.0 ? avatarScale : 1.0 + (avatarScale - 1.0) * 0.25
    }}>

      {/* Top Banner Status Bar */}
      <header className="top-header glass-panel">
        <div className="header-icon">
          <Sparkles className="w-4 h-4 text-violet-400 breathing" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1>Yuki Assistant</h1>
          <span>Desktop Companion v1.0</span>
        </div>
      </header>

      <main className="canvas-container">
        <Suspense fallback={<div style={{color: '#8b5cf6', padding: '20px', fontFamily: 'monospace'}}>Initializing 3D Engine...</div>}>
          <AvatarViewer
            audioLevel={audioLevel}
            isThinking={isThinking || ttsStreamActive}
            isListening={isListening}
            expression={avatarExpression}
            cpuLoad={cpuLoad}
            systemIdleTime={systemIdleTime}
            onFileDropped={handleFileDropped}
            scale={avatarScale}
            skinToneColor={avatarSkinToneColor}
            customAnimation={customAnimation}
            disabledAnimations={disabledAnimations}
            activeModel={profile.settings?.active_vrm_model || 'default.vrm'}
            enableRotation={profile.settings?.enable_rotation !== undefined ? profile.settings.enable_rotation : true}
            autoResetRotation={profile.settings?.auto_reset_rotation || false}
            visible={isVisible}
            isBackendOnline={backendStatus === 'online'}
            vrmDpr={profile.settings?.vrm_dpr || 1.5}
            vrmFps={profile.settings?.vrm_fps || 60}
          />
        </Suspense>
      </main>

      {/* Floating Symmetrical Control UI overlay */}
      <Suspense fallback={<div style={{position: 'absolute', bottom: '20px', left: '20px', color: '#8b5cf6'}}>Loading UI...</div>}>
        <ChatOverlay
          messages={messages}
          inputText={inputText}
          setInputText={setInputText}
          onSubmit={handleSendMessage}
          isListening={isListening}
          isTalkMode={isTalkMode}
          toggleListening={toggleListening}
          onReset={handleReset}
          isThinking={isThinking || ttsStreamActive}
          currentSpeechText={currentSpeechText}
          isPanelOpen={isPanelOpen}
          setIsPanelOpen={setIsPanelOpen}
          muteVoice={muteVoice}
          setMuteVoice={handleToggleMute}
          disabledAnimations={disabledAnimations}
        />
      </Suspense>

      {/* Left Symmetrical Diagnostics Dashboard */}
      <Suspense fallback={<div style={{position: 'absolute', top: '20px', left: '20px', color: '#8b5cf6'}}>Loading Controls...</div>}>
        <ControlDashboard
        profile={profile}
        backendStatus={backendStatus}
        onResetProfile={handleReset}
        modelName={modelName}
        lmstudioUrl={lmstudioUrl}
        onProfileUpdate={(updatedProfile) => {
          setProfile(updatedProfile);
          if (updatedProfile.settings && updatedProfile.settings.llm_model) {
            setModelName(updatedProfile.settings.llm_model);
          }
        }}
        skinToneColor={avatarSkinToneColor}
        onSkinToneChange={(newColor) => {
          setAvatarSkinToneColor(newColor);
          localStorage.setItem('yuki-avatar-skintone-color', newColor);
        }}
        disabledAnimations={disabledAnimations}
        onToggleAnimation={toggleAnimationEnabled}
        micDevices={micDevices}
        selectedMicDeviceId={selectedMicDeviceId}
        onMicDeviceChange={(deviceId) => {
          setSelectedMicDeviceId(deviceId);
          selectedMicDeviceIdRef.current = deviceId;
          if (deviceId) {
            localStorage.setItem('yuki-mic-device-id', deviceId);
          } else {
            localStorage.removeItem('yuki-mic-device-id');
          }
        }}
        onRefreshMicDevices={refreshMicDevices}
        vadThreshold={vadThreshold}
        onVadThresholdChange={(val) => {
          setVadThreshold(val);
          localStorage.setItem('yuki-vad-threshold', val.toString());
        }}
        muteVoice={muteVoice}
        onMuteVoiceChange={handleToggleMute}
        voiceVolume={voiceVolume}
        onVoiceVolumeChange={(val) => {
          setVoiceVolume(val);
          localStorage.setItem('yuki-voice-volume', val.toString());
        }}
        availableLlmModels={availableLlmModels}
        onRefreshLlmModels={fetchLlmModels}
        preferHeadsetMic={preferHeadsetMic}
        onPreferHeadsetMicChange={(val) => {
          setPreferHeadsetMic(val);
          localStorage.setItem('yuki-prefer-headset', val.toString());
          if (val) applyHeadsetPreference(micDevices, true);
        }}
        avatarScale={avatarScale}
        onAvatarScaleChange={(newScale) => {
          setAvatarScale(newScale);
          localStorage.setItem('yuki-avatar-scale', newScale.toString());
        }}
      />
      </Suspense>

      {/* System Offline warning banner */}
      {backendStatus === 'offline' && (
        <div className="offline-banner-floating">
          <ShieldAlert className="w-4 h-4 text-red-400" />
          <span>Core disconnected. Check if backend is active.</span>
        </div>
      )}

      {/* Custom Styled Confirmation Modal */}
      {confirmModal.visible && (
        <div className="yuki-confirm-overlay interactive-element">
          <div className="yuki-confirm-card">
            <h3 className="yuki-confirm-title">
              <ShieldAlert className="w-5 h-5 text-violet-400" />
              {confirmModal.title}
            </h3>
            <p className="yuki-confirm-message">{confirmModal.message}</p>
            <div className="yuki-confirm-buttons">
              <button
                type="button"
                className="yuki-confirm-btn yuki-confirm-btn-proceed"
                onClick={confirmModal.onConfirm}
              >
                Proceed (Enter)
              </button>
              <button
                type="button"
                className="yuki-confirm-btn yuki-confirm-btn-cancel"
                onClick={confirmModal.onCancel}
              >
                Cancel (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;
