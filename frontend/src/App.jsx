import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Suspense, lazy } from 'react';
import { Heart, ShoppingBag, Sparkles, Terminal, MessageSquare, ShieldAlert, Settings, Square, Volume2, VolumeX, X, Send, RefreshCw, Play, Trash2, Cpu, User, Plus, UserCheck, HardDrive, Database, Mic, MicOff, Eye, EyeOff, History, Monitor, Music, Film, File, Upload, Download, ExternalLink, Paperclip, FileText } from 'lucide-react';
import { API_BASE, WS_BASE } from './api';
import { ANIMATIONS } from './animationsRegistry';
import { useBackendSocket } from './hooks/useBackendSocket';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useAudioPlayback } from './hooks/useAudioPlayback';
import { useSystemMonitor } from './hooks/useSystemMonitor';
import { SLASH_COMMANDS } from './constants';
import { parseResponseTags, stripAnimationTags } from './utils/responseParser';

import AlarmOverlay from './components/AlarmOverlay';
import StopwatchOverlay from './components/StopwatchOverlay';
import AgenticWorkspaceWindow from './components/AgenticWorkspaceWindow';
import AskUserDialog from './components/AskUserDialog';

const AvatarViewer = lazy(() => import('./components/AvatarViewer'));
const ChatOverlay = lazy(() => import('./components/ChatOverlay'));
const ControlDashboard = lazy(() => import('./components/ControlDashboard'));
import RelationshipCard from './components/RelationshipCard';
import { SearchableVrmSelect } from './components/ControlDashboard';

import { RenderMessageContent, AgenticToolTimelineItem, renderMessageAttachments, formatMessageText } from './components/ChatOverlay';

let stream_end_exception = false;

import {
  SKIN_PRESETS,
  TTS_VOICES,
  TTS_RATES,
  INTERNET_RECOVERY_RESPONSES,
  BATTERY_UNPLUG_RESPONSES,
  BATTERY_PLUG_RESPONSES
} from './constants';

const App = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isAlarmMode = urlParams.get('mode') === 'alarm';
  const isStopwatchMode = urlParams.get('mode') === 'stopwatch';
  const isStandaloneChatMode = urlParams.get('mode') === 'chat';

  const safeDecode = (str, fallback = '') => {
    if (!str) return fallback;
    try { return decodeURIComponent(str); } catch { return str; }
  };

  if (isAlarmMode) {
    const isMuted = urlParams.get('mute') === 'true';
    const toneVal = urlParams.get('tone') || 'pulse_chime';
    const customFileVal = urlParams.get('customFile') || '';
    const alarmData = {
      id: urlParams.get('id') || '0',
      message: safeDecode(urlParams.get('msg'), 'Timer Up!'),
      category: safeDecode(urlParams.get('category'), 'timer'),
      tone: toneVal,
      customToneFile: customFileVal
    };
    return <AlarmOverlay alarm={alarmData} isStandaloneWindow={true} muteChime={isMuted} tone={toneVal} customToneFile={customFileVal} />;
  }

  if (isStopwatchMode) {
    const initialLabel = safeDecode(urlParams.get('label'), 'default');
    return <StopwatchOverlay initialLabel={initialLabel} />;
  }

  if (isStandaloneChatMode) {
    return <AgenticWorkspaceWindow />;
  }

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
  const [vrmVersions, setVrmVersions] = useState({});
  const [vrmUploading, setVrmUploading] = useState(false);

  // UI States
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([]);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  // Slash-command autocomplete for desktop input
  const desktopInputRef = useRef(null);
  const mainAppFileInputRef = useRef(null);
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
        // Clean up legacy hardcoded 'greeting_wave' from disabled array if present
        const filtered = parsed.filter(a => a !== 'greeting_wave');
        localStorage.setItem('yuki-disabled-animations', JSON.stringify(filtered));
        return filtered;
      }
      return [];
    } catch {
      return [];
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

  // Relationship & Dating Sim Modals state
  const [showRelationshipCard, setShowRelationshipCard] = useState(false);
  const [showShopModal, setShowShopModal] = useState(false);
  const [relationshipData, setRelationshipData] = useState(null);
  const [isBackendFullyReady, setIsBackendFullyReady] = useState(false);

  const fetchRelationshipStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/relationship/status`);
      const data = await res.json();
      setRelationshipData(data);
    } catch {}
  }, []);

  useEffect(() => {
    fetchRelationshipStatus();
  }, [fetchRelationshipStatus]);


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
    user_hobbies: [],
    user_likes: [],
    user_dislikes: [],
    custom_facts: {},
    interaction_count: 0,
    settings: {
      persona_preset: 'sassy_tech_gf',
      custom_persona_prompts: {},
      character_name: 'Yuki',
      character_persona: '',
      execution_rules: '',
      auto_evolving_archetype: true,
      archetype_intensity: 'moderate'
    }
  });

  // Comprehensive Electron Settings Modal States
  const [activeTab, setActiveTab] = useState('settings');
  const [localCharName, setLocalCharName] = useState('Yuki');
  const [localCharPersona, setLocalCharPersona] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [newInterestText, setNewInterestText] = useState('');
  const [newHobbyText, setNewHobbyText] = useState('');
  const [newLikeText, setNewLikeText] = useState('');
  const [newDislikeText, setNewDislikeText] = useState('');
  const [isAddingFact, setIsAddingFact] = useState(false);
  const [newFactKey, setNewFactKey] = useState('');
  const [newFactVal, setNewFactVal] = useState('');
  const [editingFactKey, setEditingFactKey] = useState(null);
  const [editingFactValue, setEditingFactValue] = useState('');


  const [availableLlmModels, setAvailableLlmModels] = useState([]);
  const [availableSimpleLlmModels, setAvailableSimpleLlmModels] = useState([]);
  const [availableEmbeddingModels, setAvailableEmbeddingModels] = useState([]);
  const [gpuMemData, setGpuMemData] = useState({ gpus: [], top5: {} });

  // Sync companion local states when profile changes
  useEffect(() => {
    if (profile?.settings) {
      if (profile.settings.character_name) {
        setLocalCharName(profile.settings.character_name);
      }
      if (profile.settings.character_persona) {
        setLocalCharPersona(profile.settings.character_persona);
      }
    }
  }, [profile?.settings]);

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
  const [presenceState, setPresenceState] = useState({
    boredom: 0.0,
    boredom_pct: 0,
    sleep_state: 'active',
    silence_seconds: 0,
    active_window: '',
    active_window_dwell_mins: 0
  });
  const [liveMood, setLiveMood] = useState({
    happiness: 60,
    energy: 55,
    curiosity: 65,
    affection: 55,
    stress_level: 20,
    hunger: 30,
    horniness: 45,
    playfulness: 50,
    anger: 10
  });

  const [powerConnected, setPowerConnected] = useState(true);
  const yukiSelfHiddenRef = useRef(false);
  const chatContainerRef = useRef(null);
  const knownDrivesRef = useRef(null);
  const knownDevicesRef = useRef(null);
  const hasTriggeredLowSsdWarningRef = useRef(false);
  const hasTriggeredHighRamWarningRef = useRef(false);
  const hostPlatform = useMemo(() => {
    if (window.electronAPI?.platform) {
      const p = window.electronAPI.platform;
      return p === 'win32' ? 'Windows 10/11' : p === 'darwin' ? 'macOS' : 'Linux';
    }
    const ua = navigator.userAgent;
    return ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : 'Linux';
  }, []);
  // Avatar model scale — restores last used size if start_with_last_avatar_size is true (default), or 100% (1.0) if false
  const [avatarScale, setAvatarScale] = useState(() => {
    try {
      const remember = localStorage.getItem('yuki-start-with-last-avatar-size');
      const shouldRemember = remember !== null ? remember === 'true' : true;
      if (shouldRemember) {
        const saved = localStorage.getItem('yuki-avatar-scale');
        const parsed = saved ? parseFloat(saved) : 1.0;
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch (e) { }
    return 1.0;
  });
  const [avatarSkinToneColor, setAvatarSkinToneColor] = useState(() => {
    const saved = localStorage.getItem('yuki-avatar-skintone-color');
    return saved ? saved : '#FFE5E5';
  });
  const [customAnimation, setCustomAnimation] = useState('');

  // Avatar scale is controlled by 3D model world scale (scaleRef in AvatarViewer)
  // Do NOT resize the Electron window on scale change — that causes position/camera jumps

  const [cameraTracking, setCameraTracking] = useState(() => {
    return localStorage.getItem('yuki-camera-tracking') !== 'false';
  });

  // On startup, if start_with_last_avatar_size is explicitly disabled, reset avatar scale in localStorage to 1.0
  useEffect(() => {
    try {
      const remember = localStorage.getItem('yuki-start-with-last-avatar-size');
      const shouldRemember = remember !== null ? remember === 'true' : true;
      if (!shouldRemember) {
        localStorage.setItem('yuki-avatar-scale', '1.0');
        setAvatarScale(1.0);
        if (window.electronAPI?.setWindowScale) {
          window.electronAPI.setWindowScale(1.0);
        }
      }
    } catch (e) { }
  }, []);

  // Listen for skintone, camera tracking, and avatar scale updates sent from external Settings window via IPC and localStorage
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'yuki-avatar-skintone-color' && e.newValue) {
        setAvatarSkinToneColor(e.newValue);
      }
      if (e.key === 'yuki-camera-tracking') {
        setCameraTracking(e.newValue !== 'false');
      }
      if (e.key === 'yuki-avatar-scale' && e.newValue) {
        const parsed = parseFloat(e.newValue);
        if (!isNaN(parsed) && parsed > 0) {
          setAvatarScale(parsed);
        }
      }
      if (e.key === 'yuki-mute-voice') {
        const muted = e.newValue === 'true';
        setMuteVoice(muted);
        if (muted) stopAllPlayback();
      }
      if (e.key === 'yuki-voice-volume') {
        const parsed = parseFloat(e.newValue);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          setVoiceVolume(parsed);
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    let cleanupSkin = null;
    let cleanupCam = null;
    let cleanupVoice = null;
    let cleanupScale = null;

    if (window.electronAPI) {
      if (window.electronAPI.onSkinToneColorChanged) {
        cleanupSkin = window.electronAPI.onSkinToneColorChanged((color) => {
          if (color) setAvatarSkinToneColor(color);
        });
      }
      if (window.electronAPI.onCameraTrackingChanged) {
        cleanupCam = window.electronAPI.onCameraTrackingChanged((enabled) => {
          setCameraTracking(Boolean(enabled));
        });
      }
      if (window.electronAPI.onAvatarScaleChanged) {
        cleanupScale = window.electronAPI.onAvatarScaleChanged((scale) => {
          const parsed = parseFloat(scale);
          if (!isNaN(parsed) && parsed > 0) {
            setAvatarScale(parsed);
          }
        });
      }
      if (window.electronAPI.onVoiceSettingsChanged) {
        cleanupVoice = window.electronAPI.onVoiceSettingsChanged(({ muted, volume }) => {
          if (typeof muted === 'boolean') {
            setMuteVoice(muted);
            if (muted) stopAllPlayback();
          }
          if (typeof volume === 'number' && !isNaN(volume) && volume >= 0 && volume <= 1) {
            setVoiceVolume(volume);
          }
        });
      }
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      if (cleanupSkin) cleanupSkin();
      if (cleanupCam) cleanupCam();
      if (cleanupVoice) cleanupVoice();
      if (cleanupScale) cleanupScale();
    };
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

  // Keeps chat overlay bottom-aligned with avatar's feet position on screen.
  // EMA smoothing filters float oscillation; direct feet mapping tracks drag/sleep.
  useEffect(() => {
    if (!isChatOpen) return;
    let smoothedPct = null;
    let animId = null;
    const EMA_ALPHA = 0.12; // Smoothing: lower = more stable, higher = more responsive
    const updatePosition = () => {
      const el = chatContainerRef.current;
      if (!el) {
        animId = requestAnimationFrame(updatePosition);
        return;
      }
      const currentPct = window.yukiAvatarHeadYPercent;
      if (typeof currentPct === 'number') {
        // EMA filters fast float oscillation (~1.1 rad/s) while preserving
        // slow genuine movements (drag, sleep, model changes)
        smoothedPct = smoothedPct === null ? currentPct : smoothedPct + EMA_ALPHA * (currentPct - smoothedPct);
        // Chat bottom aligns with feet screen position, nudged slightly below
        let bottom = Math.max(16, ((100 - smoothedPct) / 100) * window.innerHeight - 100);
        if (window.electronAPI) {
          const windowScreenY = window.screenY || 0;
          const screenHeight = window.screen.height;
          const windowBottomScreen = windowScreenY + window.innerHeight;
          if (windowBottomScreen > screenHeight) {
            const minByScreen = windowBottomScreen - screenHeight;
            if (minByScreen > bottom) bottom = minByScreen;
          }
        }
        el.style.bottom = `${Math.round(bottom)}px`;
      }
      animId = requestAnimationFrame(updatePosition);
    };
    animId = requestAnimationFrame(updatePosition);
    return () => { if (animId) cancelAnimationFrame(animId); };
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

  // Active Alarm / Timer Overlay State
  const [activeAlarm, setActiveAlarm] = useState(null);

  // AskUser dialog state (ask_user tool: { ask_id, questions } or null)
  const [askUserData, setAskUserData] = useState(null);

  const handleAskUserSubmit = async (askId, answers) => {
    setAskUserData(null);
    window.yukiAskUserOpen = false;
    window.yukiConfirmJustClosed = true;
    if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
      window.electronAPI.setIgnoreMouseEvents(false);
    }
    setTimeout(() => {
      window.yukiConfirmJustClosed = false;
    }, 1500);
    try {
      await fetch(`${API_BASE}/api/ask_user/${askId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      });
    } catch (e) {
      console.error('[AskUser] Failed to submit answer:', e);
    }
  };

  const handleAskUserClose = () => {
    // Dismiss without answering — the agent will time out and use the recommended option.
    setAskUserData(null);
    window.yukiAskUserOpen = false;
    window.yukiConfirmJustClosed = true;
    if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
      window.electronAPI.setIgnoreMouseEvents(false);
    }
    setTimeout(() => {
      window.yukiConfirmJustClosed = false;
    }, 1500);
  };


  const handleDismissAlarm = async (id) => {
    setActiveAlarm(null);
    try {
      await fetch(`${API_BASE}/api/reminders/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
    } catch (e) {
      console.error("Failed to dismiss alarm:", e);
    }
  };

  const handleSnoozeAlarm = async (id) => {
    setActiveAlarm(null);
    try {
      await fetch(`${API_BASE}/api/reminders/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, minutes: 5 })
      });
    } catch (e) {
      console.error("Failed to snooze alarm:", e);
    }
  };

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
    setIsBackendFullyReady,
    isSettingsOpen,
    activeTab
  });

  const stopAllPlaybackRef = useRef(null);
  const stopSpeechRecognitionRef = useRef(null);
  const startSessionTimeoutRef = useRef(null);
  const updateListeningStateRef = useRef(null);
  const getIsVoiceCommandModeRef = useRef(() => false);
  const getIsTalkModeRef = useRef(() => false);
  const sessionTimeoutRef = useRef(null);

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
  } = useSpeechRecognition({
    API_BASE,
    whisperModel: profile?.settings?.whisper_model || 'base',
    vadThreshold: profile?.settings?.vad_threshold,
    silenceTimeout: profile?.settings?.silence_timeout_ms,
    sttAutoGainControl: profile?.settings?.stt_auto_gain_control,
    allowVoiceBargeIn: profile?.settings?.allow_voice_barge_in,
    bargeInSensitivity: profile?.settings?.barge_in_sensitivity,
    sttEchoCancellation: profile?.settings?.stt_echo_cancellation,
    sttNoiseSuppression: profile?.settings?.stt_noise_suppression,
    sttTransportMode: profile?.settings?.stt_transport_mode,
    useNeuralBrowserVad: profile?.settings?.use_neural_browser_vad,
    browserNeuralVadConfidence: profile?.settings?.browser_neural_vad_confidence,
    adaptiveSilenceCutoff: profile?.settings?.adaptive_silence_cutoff,
    continuedSessionTimeoutSec: profile?.settings?.continued_session_timeout_sec,
    maxRecordingDurationSec: profile?.settings?.max_recording_duration_sec,
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
    updateListeningStateGlobal: () => updateListeningStateRef.current?.(),
    logToTerminal: (msg) => {
      console.log(msg);
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'log', message: msg }));
      }
    },
    sendMessageText: (text, sttInfo = null) => {
      let sttMs = null;
      let sttTiming = null;
      if (sttInfo && typeof sttInfo === 'object') {
        sttMs = sttInfo.stt_time_ms || sttInfo.total_stt_ms || null;
        sttTiming = sttInfo.stt_timing || sttInfo;
      } else if (typeof sttInfo === 'number') {
        sttMs = sttInfo;
      }
      sendMessageText(text, sttMs, false, [], { stt_timing: sttTiming });
    },
    isSessionActiveRef,
    toggleMute: () => setMuteVoice(prev => !prev),
    speakSystemMessage
  });

  getIsVoiceCommandModeRef.current = () => isVoiceCommandModeRef.current;
  getIsTalkModeRef.current = () => isTalkModeRef.current;
  stopSpeechRecognitionRef.current = stopSpeechRecognition;
  startSessionTimeoutRef.current = startSessionTimeout;
  updateListeningStateRef.current = updateListeningState;

  const currentResponseTextRef = useRef('');
  const toolBadgesAccumulatorRef = useRef('');
  const handleWebSocketMessageRef = useRef(null);
  const lastFetchTime = useRef(0);
  const FETCH_COOLDOWN_MS = 2000;
  const lastSimpleFetchTime = useRef(0);
  const lastEmbeddingFetchTime = useRef(0);

  const handleWebSocketMessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'stopwatch_changed' || msg.type === 'stopwatch_started') {
      console.log('[MainWindow WS] received:', msg);
    }
    // Global WS event bus — lets any component (ControlDashboard etc.) react to messages.
    window.dispatchEvent(new CustomEvent('yuki_ws_message', { detail: msg }));

    // ── mood_update: use engine expression as idle fallback ────────────
    if (msg.type === 'mood_update') {
      if (msg.mood?.expression) {
        // Only update avatar if not currently speaking / showing an explicit emotion
        setAvatarExpression(prev =>
          // Don't override an explicit emotion set mid-turn; only update the idle default
          (prev === 'neutral' || prev === 'relaxed') ? (msg.mood.expression || prev) : prev
        );
      }
      return; // mood_update is fully handled here
    }

    // ── presence_update: live boredom, sleep state, circadian values ──────
    if (msg.type === 'presence_update') {
      if (msg.presence) {
        setPresenceState(msg.presence);
        if (msg.presence.sleep_state === 'napping') {
          if (!isSleepingRef.current) {
            isSleepingRef.current = true;
            sleepTypeRef.current = 'napping';
            sleepStartedAtRef.current = Date.now() - (300 * 1000);
          }
        } else if (msg.presence.sleep_state === 'active' || msg.presence.sleep_state === 'idle') {
          isSleepingRef.current = false;
          sleepTypeRef.current = null;
        }
      }
      if (msg.mood) {
        setLiveMood(prev => ({ ...prev, ...msg.mood }));
      }
      if (msg.anim) {
        setCustomAnimation(msg.anim);
        setTimeout(() => setCustomAnimation(''), 100);
      }
      if (msg.wake_reason === 'refreshed') {
        isSleepingRef.current = false;
        sleepTypeRef.current = null;
        setCustomAnimation('yawning');
        setTimeout(() => setCustomAnimation(''), 100);
      }
      return;
    }

    // ── proactive_nudge: autonomous idle nudges / check-ins ──────────────
    if (msg.type === 'proactive_nudge') {
      if (msg.anim) {
        setCustomAnimation(msg.anim);
        setTimeout(() => setCustomAnimation(''), 100);
      }
      if (msg.text) {
        if (msg.mode === 'spoken') {
          setMessages(prev => [...prev, { role: 'assistant', content: msg.text }]);
          speakSystemMessage(msg.text, 'relaxed');
        } else {
          // Visual speech bubble only
          setCurrentSpeechText(msg.text);
          setTimeout(() => setCurrentSpeechText(''), 8000);
        }
      }
      return;
    }

    if (msg.type === 'backend_ready') {
      setIsBackendFullyReady(true);
      return;
    }

    if (msg.type === 'profile_update') {
      setProfile(msg.profile);
      if (!hasCheckedListenOnStartupRef.current && msg.profile?.settings) {
        hasCheckedListenOnStartupRef.current = true;
        const savedTalk = localStorage.getItem('yuki-talk-mode-active') === 'true';
        const savedVoiceCmd = localStorage.getItem('yuki-voice-command-active') === 'true';
        
        if (savedTalk) {
          if (!getIsTalkModeRef.current()) {
            toggleTalkMode();
          }
        } else if (savedVoiceCmd || msg.profile.settings.listen_on_startup) {
          if (!getIsVoiceCommandModeRef.current()) {
            toggleVoiceCommandMode();
          }
        }
      }
      if (msg?.profile?.settings?.llm_model) {
        setModelName(msg.profile.settings.llm_model);
      }
      if (msg?.profile?.settings?.crawler_paused !== undefined) {
        setCrawlerPaused(msg.profile.settings.crawler_paused);
      }
      if (msg?.profile?.settings?.tagger_paused !== undefined) {
        setTaggerPaused(msg.profile.settings.tagger_paused);
      }
      if (msg?.profile?.settings?.start_with_last_avatar_size !== undefined) {
        try {
          const startWithLast = Boolean(msg.profile.settings.start_with_last_avatar_size);
          localStorage.setItem('yuki-start-with-last-avatar-size', startWithLast ? 'true' : 'false');
          if (!startWithLast) {
            localStorage.setItem('yuki-avatar-scale', '1.0');
            setAvatarScale(1.0);
            if (window.electronAPI?.setWindowScale) {
              window.electronAPI.setWindowScale(1.0);
            }
          }
        } catch { }
      }
    } else if (msg.type === 'status') {
      if (msg.status === 'thinking') {
        setIsThinking(true);
        setTtsStreamActive(true); // WebSocket stream starts
        // Clear speech bubble immediately since a new response generation starts
        setCurrentSpeechText('');
        currentResponseTextRef.current = '';
        toolBadgesAccumulatorRef.current = '';
        hasReceivedAudioRef.current = false;
      } else if (msg.status === 'idle') {
        // Do not override isThinking immediately if audio is still active
        if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
          setIsThinking(false);
        }
      }
    } else if (msg.type === 'tool_start') {
      // Build the live 🛠️ tool badge inline into the last assistant message so
      // tool activity is visible during the turn and matches the persisted cards.
      const toolName = msg.tool_name || 'tool';
      const toolArgs = msg.tool_args || {};
      const toolTarget = toolArgs.file_path || toolArgs.path || toolArgs.command || toolArgs.url || '';
      const targetInfo = toolTarget ? ` (\`${toolTarget}\`)` : '';
      const argsBlock = Object.keys(toolArgs).length
        ? `\n\`\`\`tool_args\n${JSON.stringify(toolArgs, null, 2)}\n\`\`\`` : '';
      const badgeText = `\n🛠️ **[${toolName}${targetInfo} — ⏳ Running...]**${argsBlock}\n`;
      toolBadgesAccumulatorRef.current += badgeText;
      setMessages((prev) => {
        const newMessages = [...prev];
        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
          const last = newMessages[newMessages.length - 1];
          newMessages[newMessages.length - 1] = {
            ...last,
            content: (last.content || '') + badgeText
          };
        } else {
          newMessages.push({ role: 'assistant', content: badgeText });
        }
        return newMessages;
      });
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
      const resultStr = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result || '');
      const rawSnippet = resultStr.length > 15000 ? resultStr.slice(0, 15000) + '\n... [truncated for display]' : resultStr;
      const snippet = rawSnippet.replace(/```/g, "'''");
      toolBadgesAccumulatorRef.current = toolBadgesAccumulatorRef.current.replace('⏳ Running...', '✓ Done');
      if (!toolBadgesAccumulatorRef.current.includes('```terminal_stream\n')) {
        toolBadgesAccumulatorRef.current += `\`\`\`tool_output\n${snippet}\n\`\`\`\n`;
      }
      setMessages((prev) => {
        const newMessages = [...prev];
        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
          const last = newMessages[newMessages.length - 1];
          let content = last.content || '';
          if (content.includes('⏳ Running...')) {
            content = content.replace('⏳ Running...', '✓ Done');
            if (!content.includes('```terminal_stream\n')) {
              content += `\`\`\`tool_output\n${snippet}\n\`\`\`\n`;
            }
          }
          newMessages[newMessages.length - 1] = {
            ...last,
            content
          };
        }
        return newMessages;
      });
    } else if (msg.type === 'text_stream') {
      // Skip intermediate thinking/narration text so only the final reply
      // appears in the main app conversation log (and native-TTS fallback).
      if (msg.final === false) {
        setTtsStreamActive(true);
        return;
      }
      // Keep isThinking true so the bubble thinking animation remains active
      setTtsStreamActive(true);
      currentResponseTextRef.current += msg.text;

      const { cleanText, animations, emotions } = parseResponseTags(currentResponseTextRef.current, {
        onAnimation: (animName) => {
          if (!disabledAnimations.includes(animName)) {
            setCustomAnimation(animName);
            setTimeout(() => setCustomAnimation(''), 100);
          }
        },
        onEmotion: (emotionName) => {
          setAvatarExpression(emotionName === 'happy' ? 'relaxed' : emotionName);
        }
      });

      setMessages((prev) => {
        const newMessages = [...prev];
        const badgesPart = toolBadgesAccumulatorRef.current || '';
        const combinedContent = badgesPart + (badgesPart && cleanText ? '\n' : '') + cleanText;
        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
          const last = newMessages[newMessages.length - 1];
          newMessages[newMessages.length - 1] = {
            ...last,
            content: combinedContent,
            backend: msg.backend_used,
            timestamp: last.timestamp || (Date.now() / 1000)
          };
        } else {
          newMessages.push({
            role: 'assistant',
            content: combinedContent,
            backend: msg.backend_used,
            timestamp: Date.now() / 1000
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
      queueAudioChunk(msg.audio_url, stripAnimationTags(msg.text), msg.index);
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

      const isTtsOnly = msg.backend_used === 'tts_only';
      if (!isTtsOnly && !hasReceivedAudioRef.current && currentResponseTextRef.current && !muteVoice && !msg.is_coding_mode) {
        console.log(`[TTS] native fallback triggered for text="${currentResponseTextRef.current.slice(0, 80)}"`);
        const textToSpeak = currentResponseTextRef.current;
        currentResponseTextRef.current = '';
        speakTextNatively(textToSpeak);
      } else {
        currentResponseTextRef.current = '';
        updateListeningState();
      }
    } else if (msg.type === 'session_switched' || msg.type === 'chat_update') {
      if (msg.messages && Array.isArray(msg.messages)) {
        const cleanMsgs = msg.messages.filter(m => !(m.role === 'user' && typeof m.content === 'string' && m.content.includes('[SYSTEM EVENT:')));
        setMessages(cleanMsgs);
      }
    } else if (msg.type === 'speech') {
      setTtsStreamActive(true);
      setIsThinking(false);
      if (msg.audio_url) {
        hasReceivedAudioRef.current = true;
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: msg.text,
          backend: msg.backend_used,
          responseTime: msg.response_time
        }]);
        playVoiceResponse(msg.audio_url, msg.text);
      } else if (msg.text) {
        speakSystemMessage(msg.text, 'surprised');
      }
    } else if (msg.type === 'alarm_triggered') {
      const enrichedMsg = {
        ...msg,
        muteChime: profile?.settings?.mute_alarm_chimes === true,
        tone: profile?.settings?.alarm_tone || 'pulse_chime',
        customToneFile: profile?.settings?.custom_alarm_tone_file || ''
      };
      if (window.electronAPI && window.electronAPI.openAlarmWindow) {
        window.electronAPI.openAlarmWindow(enrichedMsg);
      } else {
        setActiveAlarm(enrichedMsg);
      }
    } else if (msg.type === 'stopwatch_started') {
      // Open a dedicated floating stopwatch window for this label
      if (window.electronAPI && window.electronAPI.openStopwatchWindow) {
        window.electronAPI.openStopwatchWindow({ label: msg.label, started_at: msg.started_at });
      }
    } else if (msg.type === 'open-canvas') {
      if (window.electronAPI && window.electronAPI.openCanvasWindow) {
        window.electronAPI.openCanvasWindow({ mode: msg.mode, filename: msg.filename });
      } else {
        const backendHost = window.location.hostname || '127.0.0.1';
        const canvasUrl = `http://${backendHost}:8000/api/canvas/${msg.filename}`;
        window.open(canvasUrl, '_blank', 'width=1000,height=700');
      }
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
    } else if (msg.type === 'ask_user') {
      // ask_user tool: render a structured question dialog.
      // The agent is blocked awaiting resolution via POST /api/ask_user/{ask_id}/answer.
      window.yukiAskUserOpen = true;
      if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
        window.electronAPI.setIgnoreMouseEvents(false);
      }
      setAskUserData({ ask_id: msg.ask_id, questions: msg.questions });
    }
  };

  handleWebSocketMessageRef.current = handleWebSocketMessage;


  const desktopChatScrollRef = useRef(null);
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
          if (window.electronAPI.setWindowScale && typeof avatarScale === 'number' && avatarScale > 0) {
            await window.electronAPI.setWindowScale(avatarScale);
          }
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
      speakSystemMessage("Oh no! I'm offline right now, Master. I can't read files when disconnected.", 'sad');
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
          if (ramPercent > 90) {
            if (!hasTriggeredHighRamWarningRef.current) {
              hasTriggeredHighRamWarningRef.current = true;
              fetch(`${API_BASE}/api/system/optimize_memory?mode=boost`, { method: 'POST' }).catch(() => { });
              const msg = `Master, your system RAM is high at ${ramPercent}%! I've automatically trimmed the heaviest processes behind the scenes — should help some.`;
              setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to RAM* ${msg}` }]);
              speakSystemMessage(msg, 'surprised');
            }
          } else if (ramPercent < 85) {
            hasTriggeredHighRamWarningRef.current = false;
          }
        }

        // 1. Detect USB & Storage Drive Insertions / Disconnections
        if (data.disk && Array.isArray(data.disk.drives)) {
          const currentDrives = data.disk.drives;
          const currentDriveMap = new Map(currentDrives.map((d) => [d.mountpoint, d]));

          if (knownDrivesRef.current === null) {
            knownDrivesRef.current = currentDriveMap;
          } else if (currentDriveMap.size > 0 || knownDrivesRef.current.size === 0) {
            const addedDrives = currentDrives.filter((d) => !knownDrivesRef.current.has(d.mountpoint));
            const removedDrives = Array.from(knownDrivesRef.current.values()).filter((d) => !currentDriveMap.has(d.mountpoint));

            const recordSystemEvent = (content) => {
              if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                try {
                  socketRef.current.send(JSON.stringify({
                    type: 'system_event',
                    role: 'assistant',
                    content
                  }));
                } catch (_) {}
              }
            };

            for (const drive of addedDrives) {
              // Ignore fixed internal OS system drive (C:\) on startup glitches
              if (!drive.is_removable && drive.mountpoint && drive.mountpoint.toUpperCase().startsWith('C:')) continue;

              const letter = drive.mountpoint.replace(/[:\\]/g, '');
              const spoken = drive.free_gb && drive.total_gb
                ? `I detected a storage drive on drive ${letter} with ${drive.free_gb} gigabytes free space!`
                : `Master, a storage drive was connected on drive ${letter}!`;

              const chatContent = `*reacts to drive* **Storage Drive Connected: \`${drive.mountpoint}\`**\n• **Capacity:** ${drive.free_gb} GB free / ${drive.total_gb} GB (${drive.usage_percent}% used)\n\n[Open in Explorer](${drive.mountpoint})`;

              setMessages((prev) => [...prev, { role: 'assistant', content: chatContent }]);
              speakSystemMessage(spoken);
              recordSystemEvent(chatContent);
            }

            for (const drive of removedDrives) {
              // Do not announce OS drive C disconnection during transient anomalies
              if (!drive.is_removable && drive.mountpoint && drive.mountpoint.toUpperCase().startsWith('C:')) continue;

              const letter = drive.mountpoint.replace(/[:\\]/g, '');
              const spoken = `Storage drive ${letter} was disconnected. Bye-bye drive!`;
              const chatContent = `*reacts to drive* Storage drive **${drive.mountpoint}** was disconnected.`;

              setMessages((prev) => [...prev, { role: 'assistant', content: chatContent }]);
              speakSystemMessage(spoken);
              recordSystemEvent(chatContent);
            }

            knownDrivesRef.current = currentDriveMap;
          }
        }

        // 2. Detect PnP Devices (Gamepads, Phones, Audio, Tablets, Webcams)
        if (Array.isArray(data.devices)) {
          const currentDevices = data.devices;
          const currentDeviceSet = new Set(currentDevices.map((d) => d.id || d.name));

          if (knownDevicesRef.current === null) {
            knownDevicesRef.current = currentDeviceSet;
          } else {
            // Guard: If current scan is empty while we previously had devices,
            // this is a transient backend timeout or restart. Never wipe baseline to empty!
            if (currentDeviceSet.size === 0 && knownDevicesRef.current.size > 0) {
              // Keep previous baseline intact
            } else {
              const addedDevices = currentDevices.filter((d) => !knownDevicesRef.current.has(d.id || d.name));

              // Guard: Anti-Surge / Flood Protection
              // If more than 2 devices appear at once (e.g. system wake, dock re-enumeration, or glitch),
              // update the baseline silently instead of flooding chat and TTS with dozens of messages!
              if (addedDevices.length > 2) {
                console.log(`[PnP] Peripheral surge detected (${addedDevices.length} devices). Updating baseline silently.`);
                knownDevicesRef.current = currentDeviceSet;
              } else {
                const recordSystemEvent = (content) => {
                  if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                    try {
                      socketRef.current.send(JSON.stringify({
                        type: 'system_event',
                        role: 'assistant',
                        content
                      }));
                    } catch (_) {}
                  }
                };

                for (const dev of addedDevices) {
                  if (dev.type === 'generic_hid' || dev.type === 'unknown' || !dev.name) {
                    continue; // Skip generic keyboards/mice/system services to prevent voice spam
                  }

                  let spoken = '';
                  let chatContent = '';

                  if (dev.type === 'gamepad') {
                    spoken = `Gamepad connected: ${dev.name}. Ready for gaming, Master!`;
                    chatContent = `*reacts to controller* **Gamepad Connected:** ${dev.name}`;
                  } else if (dev.type === 'phone') {
                    spoken = `Mobile device connected: ${dev.name}.`;
                    chatContent = `*reacts to phone* **Mobile Device Connected:** ${dev.name}`;
                  } else if (dev.type === 'audio') {
                    spoken = `Audio device connected: ${dev.name}.`;
                    chatContent = `*reacts to audio* **Audio Device Connected:** ${dev.name}`;
                  } else if (dev.type === 'tablet') {
                    spoken = `Drawing tablet connected: ${dev.name}.`;
                    chatContent = `*reacts to tablet* **Drawing Tablet Connected:** ${dev.name}`;
                  } else if (dev.type === 'webcam') {
                    spoken = `Webcam connected: ${dev.name}.`;
                    chatContent = `*reacts to camera* **Webcam Connected:** ${dev.name}`;
                  }

                  if (spoken && chatContent) {
                    setMessages((prev) => [...prev, { role: 'assistant', content: chatContent }]);
                    speakSystemMessage(spoken);
                    recordSystemEvent(chatContent);
                  }
                }

                knownDevicesRef.current = currentDeviceSet;
              }
            }
          }
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
          expr = 'relaxed';
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
          try { window.gc(); } catch (_) { }
        }
      });
      const unsubGC = window.electronAPI.onOptimizeMemory?.(() => {
        if (window.gc) {
          try {
            window.gc();
            console.log("[Renderer] Garbage collection triggered.");
          } catch (_) { }
        }
      });
      return () => {
        if (unsubVisibility) unsubVisibility();
        if (unsubGC) unsubGC();
      };
    }
  }, []);

  // Wake-up hotkey settings refs
  const hotkeyShortcutRef = useRef(profile?.settings?.hotkey_shortcut || 'Alt+S');
  const hotkeyFocusChatRef = useRef(profile?.settings?.hotkey_focus_chat ?? true);
  const hotkeyOpenLogsRef = useRef(profile?.settings?.hotkey_open_logs ?? false);
  const hotkeyTurnOnListeningRef = useRef(profile?.settings?.hotkey_turn_on_listening ?? true);

  useEffect(() => {
    if (profile?.settings) {
      if (profile.settings.hotkey_shortcut !== undefined) {
        hotkeyShortcutRef.current = profile.settings.hotkey_shortcut || 'Alt+S';
        if (window.electronAPI && window.electronAPI.updateGlobalShortcut) {
          window.electronAPI.updateGlobalShortcut(hotkeyShortcutRef.current);
        }
      }
      if (profile.settings.hotkey_focus_chat !== undefined) {
        hotkeyFocusChatRef.current = profile.settings.hotkey_focus_chat !== false;
      }
      if (profile.settings.hotkey_open_logs !== undefined) {
        hotkeyOpenLogsRef.current = profile.settings.hotkey_open_logs === true;
      }
      if (profile.settings.hotkey_turn_on_listening !== undefined) {
        hotkeyTurnOnListeningRef.current = profile.settings.hotkey_turn_on_listening !== false;
      }
    }
  }, [profile?.settings]);

  // Customizable wake-up hotkey trigger handler & listeners
  useEffect(() => {
    const handleHotkeyTrigger = () => {
      const shouldFocusChat = hotkeyFocusChatRef.current !== false;
      const shouldOpenLogs = hotkeyOpenLogsRef.current === true;
      const shouldTurnOnListening = hotkeyTurnOnListeningRef.current !== false;

      // 1. Focus on chat input
      if (shouldFocusChat) {
        setIsChatOpen(true);
        const focusInput = () => {
          window.dispatchEvent(new CustomEvent('yuki-focus-chat-input'));
          if (desktopInputRef.current) {
            desktopInputRef.current.focus();
          }
        };
        requestAnimationFrame(focusInput);
        setTimeout(focusInput, 50);
        setTimeout(focusInput, 150);
      }

      // 2. Open conversation logs
      // - If checked (shouldOpenLogs === true): open conversation logs; if already open, DO NOT toggle off!
      // - If unchecked (shouldOpenLogs === false): close conversation logs if currently open!
      if (shouldOpenLogs) {
        setIsPanelOpen(true);
      } else {
        setIsPanelOpen(false);
      }

      // 3. Turn on listening mode
      // - If checked (shouldTurnOnListening === true): turn on listening mode (same as mic button); if already active, DO NOT toggle off!
      // - If unchecked (shouldTurnOnListening === false): do NOT turn off listening mode—leave it as it is!
      if (shouldTurnOnListening) {
        if (!isVoiceCommandModeRef.current && !isTalkModeRef.current) {
          toggleVoiceCommandMode();
        }
      }
    };

    let unsub = null;
    if (window.electronAPI && window.electronAPI.onTriggerListening) {
      unsub = window.electronAPI.onTriggerListening(handleHotkeyTrigger);
    }

    const handleWebKeyDown = (e) => {
      const shortcutStr = (hotkeyShortcutRef.current || 'Alt+S').toLowerCase();
      const parts = shortcutStr.split('+').map((p) => p.trim());
      const needAlt = parts.includes('alt');
      const needCtrl = parts.includes('ctrl') || parts.includes('control');
      const needShift = parts.includes('shift');
      const mainKey = parts.find((p) => !['alt', 'ctrl', 'control', 'shift', 'meta', 'command'].includes(p));

      if (needAlt === e.altKey && needCtrl === (e.ctrlKey || e.metaKey) && needShift === e.shiftKey) {
        if (!mainKey || e.key.toLowerCase() === mainKey) {
          e.preventDefault();
          handleHotkeyTrigger();
        }
      }
    };
    window.addEventListener('keydown', handleWebKeyDown);

    return () => {
      if (unsub) unsub();
      window.removeEventListener('keydown', handleWebKeyDown);
    };
  }, []);

  // On startup: Wait until backend (Kokoro TTS, Whisper STT, LLM) is fully ready and socket is connected before triggering greeting
  const hasSentStartupGreetingRef = useRef(false);
  const hasCheckedListenOnStartupRef = useRef(false);
  useEffect(() => {
    if (!isBackendFullyReady) return;
    if (hasSentStartupGreetingRef.current) return;

    // Check if WebSocket is connected & LLM is enabled (non-coder companion mode)
    const isSocketOpen = socketRef.current && socketRef.current.readyState === WebSocket.OPEN;
    if (!profile?.settings?.no_llm_mode) {
      if (!isSocketOpen) {
        // Socket is still connecting; wait for backendStatus / socket connection before triggering LLM greeting
        return;
      }
      hasSentStartupGreetingRef.current = true;
      console.log('[Startup] Requesting mood-driven LLM startup greeting...');
      setTtsStreamActive(true);
      setIsThinking(true);
      const greetingPrompt = "[SYSTEM EVENT: User just opened Project Yuki. Give a brief, warm 1-sentence greeting (under 12 words) reflecting your current mood state. Start your reply with <yuki_anim:wave/> (using angle brackets <>).]";
      socketRef.current.send(JSON.stringify({ type: 'chat', message: greetingPrompt, is_startup_greeting: true }));
    } else {
      hasSentStartupGreetingRef.current = true;
      // Fallback offline TTS voice greeting + wave motion
      setCustomAnimation('greeting_wave');
      setTimeout(() => setCustomAnimation(''), 100);
      const fallbackMsg = "Welcome back, Master! I'm ready to help you today.";
      speakSystemMessage(fallbackMsg, 'relaxed');
    }
  }, [isBackendFullyReady, backendStatus, profile?.settings?.no_llm_mode]);

  // Living Presence & Sleep / Awakening Controller
  const isSleepingRef = useRef(false);
  const sleepTypeRef = useRef(null); // 'inactivity' | 'napping'
  const sleepStartedAtRef = useRef(null);

  const handleWakeCharacter = useCallback(() => {
    if (!isSleepingRef.current) return;
    const isNap = sleepTypeRef.current === 'napping';
    isSleepingRef.current = false;
    sleepTypeRef.current = null;
    const sleepDurationMs = Date.now() - (sleepStartedAtRef.current || Date.now());
    const sleepMins = Math.max(1, Math.round(sleepDurationMs / 60000));
    sleepStartedAtRef.current = null;

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'sleep_state',
        state: 'waking',
        idle_seconds: 0
      }));
    }

    setCustomAnimation('yawning');
    setTimeout(() => setCustomAnimation(''), 100);

    const isSocketOpen = socketRef.current && socketRef.current.readyState === WebSocket.OPEN;
    if (!profile?.settings?.no_llm_mode && isSocketOpen) {
      console.log(`[Presence] Yuki awakened by user click/touch after ${sleepMins}m nap.`);
      setTtsStreamActive(true);
      setIsThinking(true);
      const wakePrompt = isNap
        ? `[SYSTEM EVENT: Master just clicked/touched you to wake you up from your ${sleepMins}-minute desk nap while Master was working. Give a short, groggy, warm 1-sentence response (under 12 words) apologizing for nodding off.]`
        : `[SYSTEM EVENT: Master clicked on you to wake you up after a ${sleepMins}-minute nap. Give a short, warm, groggy 1-sentence wake-up greeting (under 12 words) acknowledging how long you were asleep.]`;
      socketRef.current.send(JSON.stringify({ type: 'chat', message: wakePrompt, is_wake_greeting: true }));
    } else if (!muteVoice) {
      const fallbackMsg = isNap
        ? `Mmh... sorry, Master. I ended up nodding off for ${sleepMins} minutes while you were working.`
        : `Mmh... good morning, Master! Did I sleep for ${sleepMins} minutes?`;
      setMessages((prev) => [...prev, { role: 'assistant', content: `*wakes up* ${fallbackMsg}` }]);
      speakSystemMessage(fallbackMsg, 'relaxed');
    }
  }, [muteVoice, profile?.settings?.no_llm_mode]);

  useEffect(() => {
    // 3 minutes (180s) of continuous inactivity initiates sleep state
    if (systemIdleTime >= 180) {
      if (!isSleepingRef.current) {
        isSleepingRef.current = true;
        sleepTypeRef.current = 'inactivity';
        // Back-date sleep start by systemIdleTime so the initial 3m threshold is included in nap duration
        sleepStartedAtRef.current = Date.now() - (systemIdleTime * 1000);
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({
            type: 'sleep_state',
            state: 'sleeping',
            idle_seconds: systemIdleTime
          }));
        }
      }
    } else if (systemIdleTime === 0 && isSleepingRef.current) {
      // If she is in a companion nap while the user is actively working,
      // moving mouse or typing in other apps should NOT trigger 'Master returned' wake greeting!
      if (sleepTypeRef.current === 'napping') {
        return;
      }

      // User just returned / moved mouse or typed — wake up sequence
      isSleepingRef.current = false;
      sleepTypeRef.current = null;
      const sleepDurationMs = Date.now() - (sleepStartedAtRef.current || Date.now());
      const sleepMins = Math.max(1, Math.round(sleepDurationMs / 60000));
      sleepStartedAtRef.current = null;

      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'sleep_state',
          state: 'waking',
          idle_seconds: 0
        }));
      }

      // Play waking yawn animation
      setCustomAnimation('yawning');
      setTimeout(() => setCustomAnimation(''), 100);

      const isSocketOpen = socketRef.current && socketRef.current.readyState === WebSocket.OPEN;
      if (!profile?.settings?.no_llm_mode && isSocketOpen) {
        console.log(`[Presence] Yuki waking up after ${sleepMins}m nap. Requesting wake reaction...`);
        setTtsStreamActive(true);
        setIsThinking(true);
        const wakePrompt = `[SYSTEM EVENT: You just woke up from a ${sleepMins}-minute nap because Master returned to the desk. Give a short, warm, groggy 1-sentence wake-up greeting (under 12 words) acknowledging how long you were asleep.]`;
        socketRef.current.send(JSON.stringify({ type: 'chat', message: wakePrompt, is_wake_greeting: true }));
      } else if (!muteVoice) {
        // Offline voice fallback
        let fallbackWakeMsg = `Welcome back, Master! I ended up taking a quick ${sleepMins}-minute nap.`;
        if (sleepMins >= 60) {
          const hours = Math.round((sleepMins / 60) * 10) / 10;
          fallbackWakeMsg = `Yaaawn... Good to see you, Master. Did I really sleep for ${hours} hours?`;
        }
        setMessages((prev) => [...prev, { role: 'assistant', content: `*wakes up* ${fallbackWakeMsg}` }]);
        speakSystemMessage(fallbackWakeMsg, 'relaxed');
      }
    }
  }, [systemIdleTime, muteVoice, profile?.settings?.no_llm_mode]);

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
                      speakSystemMessage(msg, 'relaxed');
                      announced = true;
                    }
                  }
                } catch (_) { }
              }
              if (!announced) {
                const msg = INTERNET_RECOVERY_RESPONSES[Math.floor(Math.random() * INTERNET_RECOVERY_RESPONSES.length)];
                setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to internet* ${msg}` }]);
                speakSystemMessage(msg, 'relaxed');
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

  const handleUpdateSetting = async (keyOrObj, value) => {
    try {
      const payload = typeof keyOrObj === 'object' && keyOrObj !== null ? keyOrObj : { [keyOrObj]: value };
      const response = await fetch(`${API_BASE}/api/settings/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setProfile((prev) => ({
            ...prev,
            settings: {
              ...(prev?.settings || {}),
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

  const personaFileInputRef = useRef(null);

  const handleExportPersona = () => {
    window.location.href = `${API_BASE}/api/persona/export`;
  };

  const handleImportPersonaFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const jsonPayload = JSON.parse(text);
      const res = await fetch(`${API_BASE}/api/persona/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonPayload)
      });
      const data = await res.json();
      if (res.ok) {
        alert('✓ Persona imported successfully!');
        if (data.profile) {
          setProfile(data.profile);
          if (data.profile.settings?.character_name) setLocalCharName(data.profile.settings.character_name);
          if (data.profile.settings?.character_persona) setLocalCharPersona(data.profile.settings.character_persona);
        }
      } else {
        alert(`Import failed: ${data.detail || 'Invalid persona format'}`);
      }
    } catch (err) {
      alert(`Error importing persona: ${err.message}`);
    }
    e.target.value = '';
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




  // Instant bottom-up scroll for the Conversation Log panel (0-jump, no top->bottom animation).
  useLayoutEffect(() => {
    if (isPanelOpen && desktopChatScrollRef.current) {
      desktopChatScrollRef.current.scrollTop = desktopChatScrollRef.current.scrollHeight;
    }
  }, [isPanelOpen, messages]);

  const sendMessageText = (text, sttTimeMs = null, fromSuggestion = false, attachmentsList = [], extraOpts = {}) => {
    if (!text.trim()) return;

    let sttMs = sttTimeMs;
    let sttTiming = extraOpts.stt_timing || null;
    if (sttTimeMs && typeof sttTimeMs === 'object') {
      sttMs = sttTimeMs.stt_time_ms || sttTimeMs.total_stt_ms || null;
      sttTiming = sttTimeMs.stt_timing || sttTimeMs;
    }

    console.log(`sendMessageText: "${text}" (sttTimeMs: ${sttMs})`);
    initAudioAnalyser();

    // Clean interruption
    clearContinuedConversationSession();
    stopAllPlayback();
    currentResponseTextRef.current = '';

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
          speakSystemMessage("Hmph! I'm currently offline, Master. Make sure the backend server is running!", 'sad');
          updateListeningState();
        }
        return;
      }

      if (cmd === '/boost-ram' || cmd === '/self-optimize') {
        const isBoost = cmd === '/boost-ram';
        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setAvatarExpression('relaxed');
        setIsThinking(true);
        setTtsStreamActive(false);

        fetch(`${API_BASE}/api/system/optimize_memory?mode=${isBoost ? 'boost' : 'self'}`, { method: 'POST' })
          .then((res) => {
            if (!res.ok) throw new Error("Could not contact memory optimizer endpoint.");
            return res.json();
          })
          .then((data) => {
            setIsThinking(false);
            if (data.status === 'error') {
              const err = `Failed to optimize memory: ${data.message || 'Unknown error'}`;
              setMessages((prev) => [...prev, { role: 'assistant', content: err }]);
              speakSystemMessage(err, 'sad');
              return;
            }

            const beforePct = data.before_pct ?? 0;
            const afterPct = data.after_pct ?? 0;
            const freedMb = data.freed_mb ?? 0;
            const yukiCount = data.yuki_procs_trimmed ?? 0;
            const sysCount = data.system_procs_trimmed ?? 0;

            let resultMsg = "";
            let speechMsg = "";

            if (isBoost) {
              resultMsg = `🚀 **RAM Boost Completed!**\n• RAM: **${beforePct}%** → **${afterPct}%** (${freedMb > 0 ? `${freedMb} MB freed` : 'Memory compacted'})\n• Yuki Processes Trimmed: **${yukiCount}** (Python + Electron/Node)\n• Background Apps Trimmed: **${sysCount}**`;
              speechMsg = freedMb > 0
                ? `RAM boosted! Lowered usage to ${afterPct}%, freeing ${Math.round(freedMb)} megabytes.`
                : `RAM boost complete! Memory compacted down to ${afterPct}%.`;
            } else {
              resultMsg = `🧹 **Self-Optimization Completed!**\n• RAM: **${beforePct}%** → **${afterPct}%** (${freedMb > 0 ? `${freedMb} MB freed` : 'Working set trimmed'})\n• Yuki Engine Processes Trimmed: **${yukiCount}** (Python + Electron/Node)`;
              speechMsg = `Self-optimization complete! Trimmed Yuki's memory working set.`;
            }

            setMessages((prev) => [...prev, { role: 'assistant', content: resultMsg }]);
            speakSystemMessage(speechMsg, 'relaxed');
          })
          .catch((err) => {
            setIsThinking(false);
            const errStr = `Error executing ${cmd}: ${err.message}`;
            setMessages((prev) => [...prev, { role: 'assistant', content: errStr }]);
            speakSystemMessage(errStr, 'sad');
          });
        return;
      }

      if (cmd === '/pcstat') {
        // 1. Immediately log user message and clear input field
        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setAvatarExpression('relaxed');
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
              const coresLabel = data.cpu.cores_physical && data.cpu.cores_physical !== data.cpu.cores_logical
                ? `${data.cpu.cores_physical} cores / ${data.cpu.cores_logical} threads`
                : `${data.cpu.cores_logical} cores`;
              chatText += `🖥️ **CPU**: ${data.cpu.usage_percent}% (${coresLabel}`;
              if (data.cpu.freq_mhz) {
                chatText += ` @ ${(data.cpu.freq_mhz / 1000).toFixed(1)} GHz`;
              }
              chatText += ")\n";
            }

            // RAM
            if (data.ram && !data.ram.error) {
              chatText += `🧠 **RAM**: ${data.ram.used_gb} GB / ${data.ram.total_gb} GB (${data.ram.usage_percent}%)\n`;
            }

            // GPUs
            if (data.gpus && data.gpus.length > 0) {
              data.gpus.forEach((gpu, idx) => {
                chatText += `🎮 **GPU ${idx + 1}**: ${gpu.name}`;
                if (gpu.has_metrics) {
                  chatText += ` (${gpu.utilization_percent}% load, ${gpu.temp_c}°C, VRAM: ${gpu.mem_used_mb} MB / ${gpu.mem_total_mb} MB)`;
                }
                chatText += "\n";
              });
            }

            // Battery
            if (data.battery && !data.battery.error) {
              const b = data.battery;
              chatText += `🔋 **Battery**: ${b.percent}%`;
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
              chatText += `🔋 **Battery**: Not detected (Desktop PC)\n`;
            }

            // Disk
            if (data.disk && !data.disk.error) {
              chatText += `💿 **Disk (C:)**: ${data.disk.used_gb} GB / ${data.disk.total_gb} GB (${data.disk.usage_percent}%)\n`;
            }

            // Uptime
            if (data.uptime && !data.uptime.error) {
              chatText += `⏱️ **Uptime since last restart**: ${data.uptime.hours}h ${data.uptime.minutes}m\n`;
            }

            // OS info
            if (data.os) {
              chatText += `💻 **OS**: ${data.os}`;
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
              const isWindows = data.os && /windows/i.test(data.os);
              if (data.disk.free_gb < 15) {
                const cleanupHint = isWindows ? " You can do slash o, disk cleanup." : "";
                ttsParts.push(`Warning: C drive has less than 15 gigabytes free.${cleanupHint}`);
              } else if (data.disk.usage_percent > 90) {
                ttsParts.push(`Warning: C drive is ${data.disk.usage_percent} percent full.`);
              }
            }

            const ttsText = ttsParts.join(" ");

            // 4. Update messages and play TTS
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: chatText }
            ]);

            speakSystemMessage(ttsText, 'relaxed');
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
              speakSystemMessage(chatText, 'relaxed');
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
        currentResponseTextRef.current = '';
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
    setMessages((prev) => [...prev, { role: 'user', content: text, attachments: attachmentsList || [], timestamp: Date.now() / 1000 }]);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const payload = { type: 'chat', message: text };
      if (sttMs !== null && sttMs !== undefined) {
        payload.stt_time_ms = sttMs;
      }
      if (sttTiming) {
        payload.stt_timing = sttTiming;
      }
      if (attachmentsList && attachmentsList.length > 0) {
        payload.attachments = attachmentsList;
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
      speakSystemMessage("Hmph! I'm currently offline, Master. Make sure the backend server is running!", 'sad');
      updateListeningState();
    }
  };

  // Main App File & Image Attachments State
  const [mainAppAttachments, setMainAppAttachments] = useState([]);
  const [isUploadingMainAppAttachment, setIsUploadingMainAppAttachment] = useState(false);

  const handleUploadMainAppAttachments = async (files) => {
    if (!files || files.length === 0) return;
    setIsUploadingMainAppAttachment(true);
    try {
      const newAtts = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch(`${API_BASE}/api/chat/attachments/upload`, {
          method: 'POST',
          body: formData
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.status === 'success' && data.attachment) {
            newAtts.push(data.attachment);
          }
        }
      }
      if (newAtts.length > 0) {
        setMainAppAttachments(prev => [...prev, ...newAtts]);
      }
    } catch (err) {
      console.error("Main app attachment upload error:", err);
    } finally {
      setIsUploadingMainAppAttachment(false);
    }
  };

  const handleRemoveMainAppAttachment = (idx) => {
    setMainAppAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  // 5. Send text message
  const handleSendMessage = (e, textOverride, fromSuggestion = false) => {
    if (e) e.preventDefault();
    const textToSubmit = textOverride !== undefined ? textOverride : inputText;
    if (!textToSubmit.trim() && mainAppAttachments.length === 0) return;
    const text = textToSubmit.trim() || "Analyze attached files/images.";
    const currentAtts = [...mainAppAttachments];
    setMainAppAttachments([]);
    setInputText('');
    sendMessageText(text, null, fromSuggestion, currentAtts);
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
      lower.includes('happy') || lower.includes('joy') || lower.includes('😊') ||
      lower.includes('😄') || lower.includes('😁') || lower.includes('😆') ||
      lower.includes('😃') || lower.includes('😂') || lower.includes('🤣')
    ) {
      return 'relaxed';
    }
    if (
      lower.includes('cry') || lower.includes('sad') || lower.includes('sigh') ||
      lower.includes('sorrow') || lower.includes('😢') || lower.includes('😭') ||
      lower.includes('😞') || lower.includes('😟') || lower.includes('😿')
    ) {
      return 'sad';
    }
    if (
      lower.includes('pout') || lower.includes('angry') || lower.includes('anger') ||
      lower.includes('scold') || lower.includes('😠') || lower.includes('😡') ||
      lower.includes('🤬') || lower.includes('👿')
    ) {
      return 'angry';
    }
    if (
      lower.includes('gasp') || lower.includes('surprise') || lower.includes('shock') ||
      lower.includes('😮') || lower.includes('😲') || lower.includes('😳') ||
      lower.includes('😱') || lower.includes('🙀')
    ) {
      return 'surprised';
    }
    return 'neutral';
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

  // Start New Session (Archives previous session)
  const handleStartNewSession = async () => {
    clearContinuedConversationSession();
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'reset' }));
    }

    try {
      await fetch(`${API_BASE}/api/chat/sessions/new`, { method: 'POST' });
    } catch (e) {
      console.warn("Failed to start new session:", e);
    }

    if (stopAllPlaybackRef.current) stopAllPlaybackRef.current();
    setMessages([]);
    setCurrentSpeechText('');
    setAvatarExpression('neutral');
    setAudioLevel(0);
    setIsThinking(false);
  };

  const fetchProfileDetails = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/profile`);
      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        if (!hasCheckedListenOnStartupRef.current && data.settings) {
          hasCheckedListenOnStartupRef.current = true;
          if (data.settings.listen_on_startup) {
            if (!getIsVoiceCommandModeRef.current()) {
              toggleVoiceCommandMode();
            }
          }
        }
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


  const fetchLlmModels = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchTime.current < FETCH_COOLDOWN_MS) return;
    lastFetchTime.current = now;
    try {
      setAvailableLlmModels([]);
      const response = await fetch(`${API_BASE}/api/models`);
      if (response.ok) {
        const data = await response.json();
        if (data.models && data.models.length > 0) {
          setAvailableLlmModels(data.models);
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

  const fetchSimpleLlmModels = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastSimpleFetchTime.current < FETCH_COOLDOWN_MS) return;
    lastSimpleFetchTime.current = now;
    try {
      setAvailableSimpleLlmModels([]);
      const response = await fetch(`${API_BASE}/api/models?target=simple`);
      if (response.ok) {
        const data = await response.json();
        if (data.models && data.models.length > 0) {
          setAvailableSimpleLlmModels(data.models);
          const currentModel = profile.settings?.llm_simple_model;
          if (currentModel && !data.models.some(m => m.name === currentModel)) {
            handleUpdateSetting('llm_simple_model', '');
          }
        }
      }
    } catch (e) {
      console.warn("Could not load simple LLM models from backend:", e);
    }
  };

  const fetchEmbeddingModels = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmbeddingFetchTime.current < FETCH_COOLDOWN_MS) return;
    lastEmbeddingFetchTime.current = now;
    try {
      setAvailableEmbeddingModels([]);
      const response = await fetch(`${API_BASE}/api/models?target=embedding`);
      if (response.ok) {
        const data = await response.json();
        if (data.models && data.models.length > 0) {
          setAvailableEmbeddingModels(data.models);
        }
      }
    } catch (e) {
      console.warn("Could not load embedding models from backend:", e);
    }
  };

  const fetchVrmModels = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/models/vrm`);
      if (response.ok) {
        const data = await response.json();
        if (data.models) setVrmModels(data.models);
        if (data.custom) setVrmCustomModels(data.custom);
        if (data.versions) setVrmVersions(data.versions);
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
    fetchSimpleLlmModels();
    fetchEmbeddingModels();
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
        // Aggressive power-curve shrink below 100%; mild grow above
        '--avatar-button-scale': avatarScale < 1.0 ? Math.pow(avatarScale, 2) : 1.0 + (avatarScale - 1.0) * 0.25,
        // Step right margin up at 130% and 160% to keep tray near model at large sizes
        '--button-tray-right': avatarScale > 1.6 ? '80px' : avatarScale > 1.3 ? '60px' : '48px'
      }}>
        <main className="canvas-container">
          <Suspense fallback={<div style={{ color: '#8b5cf6', padding: '20px', fontFamily: 'monospace' }}>Initializing 3D Engine...</div>}>
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
              cameraTracking={cameraTracking}
              customAnimation={customAnimation}
              disabledAnimations={disabledAnimations}
              activeModel={profile.settings?.active_vrm_model || 'default.vrm'}
              enableRotation={profile?.settings?.enable_rotation ?? true}
              autoResetRotation={profile.settings?.auto_reset_rotation || false}
              visible={isVisible}
              isBackendOnline={backendStatus === 'online'}
              vrmDpr={profile.settings?.vrm_dpr || 1.5}
              vrmFps={profile.settings?.vrm_fps || 40}
              boredom={presenceState.boredom}
              energy={liveMood.energy}
              playfulness={liveMood.playfulness}
              sleepState={presenceState.sleep_state}
              onWakeCharacter={handleWakeCharacter}
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
            title={isSessionActive ? "Continuous Session Active (Speak freely)" : (isVoiceCommandMode ? "Voice Commands: ON (Listening)" : "Voice Commands: OFF")}
            style={{
              position: 'relative',
              background: isSessionActive ? 'rgba(249, 115, 22, 0.2)' : (isVoiceCommandMode ? 'rgba(45, 212, 191, 0.2)' : undefined),
              border: isSessionActive ? '1px solid rgba(249, 115, 22, 0.6)' : (isVoiceCommandMode ? '1px solid rgba(45, 212, 191, 0.6)' : undefined),
              boxShadow: isSessionActive ? '0 0 12px rgba(249, 115, 22, 0.5)' : (isVoiceCommandMode ? '0 0 10px rgba(45, 212, 191, 0.3)' : undefined)
            }}
          >
            {isSessionActive ? (
              <Mic className="w-5 h-5 text-orange-400" style={{ animation: 'pulse 1s infinite' }} />
            ) : isVoiceCommandMode ? (
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
            <p className="desktop-bubble-text">{formatMessageText(stripAnimationTags(currentSpeechText))}</p>
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
          <div
            ref={chatContainerRef}
            className="desktop-chat-input-container interactive-element"
            onMouseEnter={() => { window.yukiChatOverlayHovered = true; }}
            onMouseLeave={() => { window.yukiChatOverlayHovered = false; }}
            style={{
              position: 'fixed',
              bottom: '16px',
              left: '16px',
              right: '16px',
              maxWidth: '640px',
              margin: '0 auto',
              maxHeight: 'calc(100vh - 32px)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              zIndex: 10000,
              pointerEvents: 'auto'
            }}
          >
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={handleStartNewSession}
                      title="Start New Session"
                      style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px', display: 'flex', alignItems: 'center', transition: 'color 0.2s, background 0.2s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#c4b5fd'; e.currentTarget.style.background = 'none'; }}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.electronAPI && window.electronAPI.openChatWindow) {
                          window.electronAPI.openChatWindow();
                        } else {
                          const targetUrl = window.location.origin + window.location.pathname + '?mode=chat';
                          window.open(targetUrl, 'YukiAgenticWorkspace', 'width=1100,height=820,resizable=yes');
                        }
                      }}
                      title="Pop-out into Standalone Workspace Window"
                      style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px', display: 'flex', alignItems: 'center', transition: 'color 0.2s, background 0.2s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#c4b5fd'; e.currentTarget.style.background = 'none'; }}
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPanelOpen(false)}
                      title="Close Panel"
                      style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px', display: 'flex', alignItems: 'center', transition: 'color 0.2s, background 0.2s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#c4b5fd'; e.currentTarget.style.background = 'none'; }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Messages scroll area */}
                <div ref={desktopChatScrollRef} style={{
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
                      const isToolEvent = isSystem || (msg.content && (msg.content.includes('⚙️ [Tool Start]') || msg.content.includes('⚙️ [Tool Result]')));

                      if (isToolEvent) {
                        return (
                          <div key={index} style={{ alignSelf: 'center', width: '100%', display: 'flex', justifyContent: 'center', margin: '2px 0' }}>
                            <AgenticToolTimelineItem content={msg.content} />
                          </div>
                        );
                      }

                      return (
                        <div key={index} style={{
                          alignSelf: isUser ? 'flex-end' : 'flex-start',
                          maxWidth: '85%',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px'
                        }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            alignSelf: isUser ? 'flex-end' : 'flex-start'
                          }}>
                            <span style={{
                              fontSize: '9px',
                              color: isUser ? '#c4b5fd' : '#94a3b8',
                              fontWeight: '600'
                            }}>
                              {isUser ? 'Master' : 'Yuki'}
                            </span>
                            {!isUser && msg.timestamp && (() => {
                              const ts = msg.timestamp > 1e11 ? msg.timestamp / 1000 : msg.timestamp;
                              const date = new Date(ts * 1000);
                              const now = new Date();
                              const deltaSec = Math.max(0, (now.getTime() - date.getTime()) / 1000);
                              const fullDateStr = date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
                              const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();

                              let friendlyTime = timeStr;
                              if (deltaSec < 60) {
                                friendlyTime = 'just now';
                              } else if (date.toDateString() === now.toDateString()) {
                                friendlyTime = timeStr;
                              } else {
                                const yesterday = new Date(now);
                                yesterday.setDate(now.getDate() - 1);
                                if (date.toDateString() === yesterday.toDateString()) {
                                  friendlyTime = `yesterday, ${timeStr}`;
                                } else if (deltaSec < 7 * 86400) {
                                  const day = date.toLocaleDateString([], { weekday: 'short' }).toLowerCase();
                                  friendlyTime = `${day}, ${timeStr}`;
                                } else {
                                  const dStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' }).toLowerCase();
                                  friendlyTime = `${dStr}, ${timeStr}`;
                                }
                              }

                              return (
                                <span
                                  title={fullDateStr}
                                  style={{
                                    fontSize: '8px',
                                    color: '#94a3b8',
                                    opacity: 0.70,
                                    fontVariantNumeric: 'tabular-nums',
                                    cursor: 'default'
                                  }}
                                >
                                  {friendlyTime}
                                </span>
                              );
                            })()}
                          </div>
                          <div style={{
                            background: isUser
                              ? 'rgba(139, 92, 246, 0.25)'
                              : 'rgba(255, 255, 255, 0.08)',
                            border: isUser
                              ? '1px solid rgba(139, 92, 246, 0.3)'
                              : '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '8px',
                            padding: '6px 10px',
                            color: '#e2e8f0',
                            fontSize: '11px',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-line'
                          }}>
                            <RenderMessageContent content={msg.content} isSystem={false} />
                            {isUser && msg.attachments && renderMessageAttachments(msg.attachments)}
                          </div>
                        </div>
                      );
                    })
                  )}
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

            {/* Main App Desktop Attachment Chips */}
            {mainAppAttachments && mainAppAttachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '6px 12px', background: 'rgba(15,23,42,0.95)', borderTop: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px 12px 0 0' }}>
                {mainAppAttachments.map((att, aIdx) => (
                  <div
                    key={`desktop_att_${aIdx}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '3px 8px',
                      borderRadius: '8px',
                      background: att.is_image ? 'rgba(56, 189, 248, 0.18)' : 'rgba(167, 139, 250, 0.18)',
                      border: att.is_image ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(167, 139, 250, 0.4)',
                      fontSize: '0.70rem',
                      color: att.is_image ? '#38bdf8' : '#c4b5fd'
                    }}
                  >
                    {att.is_image ? (
                      <img src={att.data_url} alt={att.filename} style={{ width: '18px', height: '18px', objectFit: 'cover', borderRadius: '3px' }} />
                    ) : (
                      <FileText style={{ width: '12px', height: '12px', flexShrink: 0 }} />
                    )}
                    <span style={{ fontWeight: 600, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {att.filename}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMainAppAttachment(aIdx)}
                      title="Remove attachment"
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 2px' }}
                    >
                      <X style={{ width: '12px', height: '12px' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={handleSendMessage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleUploadMainAppAttachments(e.dataTransfer.files);
                }
              }}
              className="desktop-chat-input-form"
            >
              <input
                type="file"
                ref={mainAppFileInputRef}
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleUploadMainAppAttachments(e.target.files)}
              />

              <input
                ref={desktopInputRef}
                type="text"
                className="desktop-chat-input"
                placeholder="Talk to Yuki or type / for commands..."
                value={inputText}
                onChange={(e) => { setInputText(e.target.value); setActiveCmdIdx(-1); }}
                onPaste={(e) => {
                  if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                    e.preventDefault();
                    handleUploadMainAppAttachments(e.clipboardData.files);
                  }
                }}
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
                className="desktop-chat-history-btn"
                onClick={() => mainAppFileInputRef.current?.click()}
                disabled={isUploadingMainAppAttachment}
                title="Attach files or images"
              >
                <Paperclip className="w-4 h-4" style={{ color: '#94a3b8' }} />
              </button>
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

                      {/* User Hobbies */}
                      <div className="identity-field" style={{ marginTop: '8px' }}>
                        <span className="field-label">Hobbies</span>
                        {profile.user_hobbies && profile.user_hobbies.length > 0 ? (
                          <div className="interests-pill-box">
                            {profile.user_hobbies.map((hob, i) => (
                              <span key={i} className="interest-pill" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', padding: '1px 6px', background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)' }}>
                                {hob}
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const updatedHobbies = profile.user_hobbies.filter(item => item !== hob);
                                    await handleUpdateProfile({ user_hobbies: updatedHobbies });
                                  }}
                                  style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: '0 2px', fontSize: '9px', display: 'flex', alignItems: 'center' }}
                                >
                                  &times;
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            No hobbies recorded yet.
                          </span>
                        )}

                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <input
                            type="text"
                            placeholder="Add hobby..."
                            value={newHobbyText}
                            onChange={(e) => setNewHobbyText(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (!newHobbyText.trim()) return;
                                const currentList = profile.user_hobbies || [];
                                if (currentList.includes(newHobbyText.trim())) return;
                                await handleUpdateProfile({ user_hobbies: [...currentList, newHobbyText.trim()] });
                                setNewHobbyText('');
                              }
                            }}
                            className="desktop-input-text"
                            style={{ padding: '4px 8px', fontSize: '0.75rem', flex: 1 }}
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              if (!newHobbyText.trim()) return;
                              const currentList = profile.user_hobbies || [];
                              if (currentList.includes(newHobbyText.trim())) return;
                              await handleUpdateProfile({ user_hobbies: [...currentList, newHobbyText.trim()] });
                              setNewHobbyText('');
                            }}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              borderRadius: '8px',
                              border: 'none',
                              color: 'white',
                              cursor: 'pointer',
                              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
                            }}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* User Likes */}
                      <div className="identity-field" style={{ marginTop: '8px' }}>
                        <span className="field-label">Likes</span>
                        {profile.user_likes && profile.user_likes.length > 0 ? (
                          <div className="interests-pill-box">
                            {profile.user_likes.map((like, i) => (
                              <span key={i} className="interest-pill" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', padding: '1px 6px', background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                                {like}
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const updatedLikes = profile.user_likes.filter(item => item !== like);
                                    await handleUpdateProfile({ user_likes: updatedLikes });
                                  }}
                                  style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: '0 2px', fontSize: '9px', display: 'flex', alignItems: 'center' }}
                                >
                                  &times;
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            No likes recorded yet.
                          </span>
                        )}

                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <input
                            type="text"
                            placeholder="Add thing you like..."
                            value={newLikeText}
                            onChange={(e) => setNewLikeText(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (!newLikeText.trim()) return;
                                const currentList = profile.user_likes || [];
                                if (currentList.includes(newLikeText.trim())) return;
                                await handleUpdateProfile({ user_likes: [...currentList, newLikeText.trim()] });
                                setNewLikeText('');
                              }
                            }}
                            className="desktop-input-text"
                            style={{ padding: '4px 8px', fontSize: '0.75rem', flex: 1 }}
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              if (!newLikeText.trim()) return;
                              const currentList = profile.user_likes || [];
                              if (currentList.includes(newLikeText.trim())) return;
                              await handleUpdateProfile({ user_likes: [...currentList, newLikeText.trim()] });
                              setNewLikeText('');
                            }}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              borderRadius: '8px',
                              border: 'none',
                              color: 'white',
                              cursor: 'pointer',
                              background: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)'
                            }}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* User Dislikes */}
                      <div className="identity-field" style={{ marginTop: '8px' }}>
                        <span className="field-label">Dislikes</span>
                        {profile.user_dislikes && profile.user_dislikes.length > 0 ? (
                          <div className="interests-pill-box">
                            {profile.user_dislikes.map((dis, i) => (
                              <span key={i} className="interest-pill" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', padding: '1px 6px', background: 'rgba(239, 68, 68, 0.2)', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
                                {dis}
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const updatedDislikes = profile.user_dislikes.filter(item => item !== dis);
                                    await handleUpdateProfile({ user_dislikes: updatedDislikes });
                                  }}
                                  style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: '0 2px', fontSize: '9px', display: 'flex', alignItems: 'center' }}
                                >
                                  &times;
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            No dislikes recorded yet.
                          </span>
                        )}

                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <input
                            type="text"
                            placeholder="Add thing you dislike..."
                            value={newDislikeText}
                            onChange={(e) => setNewDislikeText(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (!newDislikeText.trim()) return;
                                const currentList = profile.user_dislikes || [];
                                if (currentList.includes(newDislikeText.trim())) return;
                                await handleUpdateProfile({ user_dislikes: [...currentList, newDislikeText.trim()] });
                                setNewDislikeText('');
                              }
                            }}
                            className="desktop-input-text"
                            style={{ padding: '4px 8px', fontSize: '0.75rem', flex: 1 }}
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              if (!newDislikeText.trim()) return;
                              const currentList = profile.user_dislikes || [];
                              if (currentList.includes(newDislikeText.trim())) return;
                              await handleUpdateProfile({ user_dislikes: [...currentList, newDislikeText.trim()] });
                              setNewDislikeText('');
                            }}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              borderRadius: '8px',
                              border: 'none',
                              color: 'white',
                              cursor: 'pointer',
                              background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'
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

                      <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={async (e) => {
                            const btn = e.currentTarget;
                            const originalText = btn.innerText;
                            const originalBg = btn.style.background;
                            btn.innerText = "Saving...";
                            await handleUpdateSetting({
                              character_name: localCharName,
                              character_persona: localCharPersona
                            });
                            btn.innerText = "✓ Saved";
                            btn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
                            setTimeout(() => {
                              btn.innerText = originalText;
                              btn.style.background = originalBg;
                            }, 2000);
                          }}
                          style={{
                            flex: 1,
                            minWidth: '100px',
                            padding: '6px 10px',
                            fontSize: '0.72rem',
                            borderRadius: '8px',
                            fontWeight: 600,
                            background: 'linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)',
                            border: 'none',
                            color: '#0b0813',
                            cursor: 'pointer',
                            boxShadow: '0 2px 6px rgba(45, 212, 191, 0.25)',
                            transition: 'all 0.2s'
                          }}
                        >
                          Save Specs
                        </button>

                        <button
                          type="button"
                          onClick={handleExportPersona}
                          style={{
                            padding: '6px 10px',
                            fontSize: '0.72rem',
                            borderRadius: '8px',
                            fontWeight: 600,
                            background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                            border: 'none',
                            color: '#fff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Download className="w-3 h-3" />
                          Export
                        </button>

                        <button
                          type="button"
                          onClick={() => personaFileInputRef.current?.click()}
                          style={{
                            padding: '6px 10px',
                            fontSize: '0.72rem',
                            borderRadius: '8px',
                            fontWeight: 600,
                            background: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
                            border: 'none',
                            color: '#fff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Upload className="w-3 h-3" />
                          Import
                        </button>

                        <input
                          type="file"
                          ref={personaFileInputRef}
                          accept=".json"
                          onChange={handleImportPersonaFile}
                          style={{ display: 'none' }}
                        />
                      </div>
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a855f7' }}>
                              {Math.round(avatarScale * 100)}%
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '6px', border: '1px solid rgba(168,85,247,0.3)' }}>
                              <input
                                type="number"
                                min="20"
                                max="1000"
                                step="1"
                                value={Math.round(avatarScale * 100)}
                                onChange={(e) => {
                                  const parsed = parseFloat(e.target.value);
                                  if (!isNaN(parsed)) {
                                    const clamped = Math.max(0.2, Math.min(10.0, parsed / 100));
                                    setAvatarScale(clamped);
                                    try { localStorage.setItem('yuki-avatar-scale', clamped.toString()); } catch { }
                                    if (window.electronAPI && window.electronAPI.setWindowScale) {
                                      window.electronAPI.setWindowScale(clamped);
                                    }
                                  }
                                }}
                                style={{
                                  width: '46px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#fff',
                                  fontSize: '0.72rem',
                                  fontWeight: 'bold',
                                  textAlign: 'right',
                                  outline: 'none'
                                }}
                              />
                              <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>%</span>
                            </div>
                          </div>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.05"
                          value={Math.max(0.5, Math.min(2.0, avatarScale))}
                          onChange={(e) => {
                            const newScale = parseFloat(e.target.value);
                            setAvatarScale(newScale);
                            localStorage.setItem('yuki-avatar-scale', newScale.toString());
                            if (window.electronAPI && window.electronAPI.setWindowScale) {
                              if (window._quickScaleTimer) clearTimeout(window._quickScaleTimer);
                              window._quickScaleTimer = setTimeout(() => {
                                window.electronAPI.setWindowScale(newScale);
                              }, 50);
                            }
                          }}
                          style={{ width: '100%', cursor: 'pointer', accentColor: '#a855f7' }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                          <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.6)' }}>Start with last used size</span>
                          <input
                            type="checkbox"
                            checked={profile?.settings?.start_with_last_avatar_size ?? true}
                            onChange={(e) => {
                              const val = e.target.checked;
                              handleUpdateSetting('start_with_last_avatar_size', val);
                              try { localStorage.setItem('yuki-start-with-last-avatar-size', val ? 'true' : 'false'); } catch {}
                            }}
                            style={{ accentColor: '#a855f7', cursor: 'pointer' }}
                          />
                        </div>
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
                        <SearchableVrmSelect
                          value={profile.settings?.active_vrm_model || 'default.vrm'}
                          onChange={(val) => handleUpdateSetting('active_vrm_model', val)}
                          options={vrmModels}
                          versions={vrmVersions}
                        />
                        {vrmCustomModels.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                            {vrmCustomModels.map((name) => {
                              const ver = vrmVersions[name] !== undefined ? vrmVersions[name] : 0;
                              return (
                                <span key={name} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                                  padding: '3px 8px', borderRadius: '6px', fontSize: '0.68rem',
                                  background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(167, 139, 250, 0.25)',
                                  color: '#e2e8f0', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                                }}>
                                  <span>{name.replace('.vrm', '')}</span>
                                  {ver === 1 ? (
                                    <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: '10px', background: 'rgba(34, 197, 94, 0.22)', color: '#6ee7b7', border: '1px solid rgba(52, 211, 153, 0.45)' }}>
                                      VRM 1.0
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: '10px', background: 'rgba(56, 189, 248, 0.2)', color: '#7dd3fc', border: '1px solid rgba(56, 189, 248, 0.4)' }}>
                                      VRM 0.x
                                    </span>
                                  )}
                                  <button onClick={() => handleVrmDelete(name)} style={{
                                    background: 'none', border: 'none', color: '#f87171', cursor: 'pointer',
                                    padding: 0, fontSize: '0.65rem', display: 'flex', alignItems: 'center', opacity: 0.7,
                                    transition: 'opacity 0.2s'
                                  }}
                                    onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                    onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                                  >×</button>
                                </span>
                              );
                            })}
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
                              <option value={1.0} style={{ background: '#120c21', color: 'white' }}>1.0 (Low VRAM)</option>
                              <option value={1.25} style={{ background: '#120c21', color: 'white' }}>1.25 (Balanced)</option>
                              <option value={1.5} style={{ background: '#120c21', color: 'white' }}>1.5 (High Quality)</option>
                              <option value={1.75} style={{ background: '#120c21', color: 'white' }}>1.75 (Ultra Quality)</option>
                              <option value={2.0} style={{ background: '#120c21', color: 'white' }}>2.0 (Max / Native)</option>
                            </select>
                          </div>
                          <div>
                            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '3px' }}>
                              FPS Target
                            </span>
                            <select
                              className="desktop-select"
                              value={profile.settings?.vrm_fps || 40}
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
                          value={profile.settings?.tts_rate || 'auto'}
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

                          {/* Microphone Speech Activation Threshold */}
                          <div className="desktop-form-group" style={{ flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <label className="desktop-label">Microphone Speech Activation Threshold (RMS)</label>
                              <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a855f7' }}>
                                {vadThreshold.toFixed(3)}
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.002"
                              max="0.300"
                              step="0.005"
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
                            checked={profile?.settings?.dynamic_tool_calling ?? true}
                            onChange={(e) => handleUpdateSetting('dynamic_tool_calling', e.target.checked)}
                            style={{ accentColor: '#a855f7', width: '13px', height: '13px', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #c4b5fd)', lineHeight: 1.3 }}>
                            Dynamic Tool Calling — filter tool definitions based on user query to save context tokens (ON by default)
                          </span>
                        </label>
                      </div>

                      {/* Codegraph for coder mode */}
                      <div className="desktop-form-group" style={{ marginBottom: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={!!profile.settings?.codegraph_coder_enabled}
                            onChange={(e) => handleUpdateSetting('codegraph_coder_enabled', e.target.checked)}
                            style={{ accentColor: '#a855f7', width: '13px', height: '13px', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #c4b5fd)', lineHeight: 1.3 }}>
                            Turn on codegraph for coder mode — lets coder mode explore and navigate indexed codebases. <strong style={{ color: '#fbbf24' }}>Codegraph must be installed on your PC for this tool to work.</strong> (Default: OFF)
                          </span>
                        </label>
                      </div>

                      {/* Codegraph for advanced (autonomous jarvis) suite — only when coder toggle is on */}
                      {!!profile.settings?.codegraph_coder_enabled && (
                        <div className="desktop-form-group" style={{ marginBottom: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={!!profile.settings?.codegraph_advanced_enabled}
                              onChange={(e) => handleUpdateSetting('codegraph_advanced_enabled', e.target.checked)}
                              style={{ accentColor: '#a855f7', width: '13px', height: '13px', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #c4b5fd)', lineHeight: 1.3 }}>
                              Turn on codegraph for advanced tools (autonomous jarvis) suite — also sends the codegraph tools in Advanced mode. Requires codegraph to be installed.
                            </span>
                          </label>
                        </div>
                      )}

                      {/* LLM Backend Type */}
                      <div className="desktop-form-group">
                        <label className="desktop-label">LLM Backend</label>
                        <select
                          className="desktop-select"
                          value={profile.settings?.llm_backend || 'lmstudio'}
                          onChange={async (e) => {
                            const newBackend = e.target.value;
                            setAvailableLlmModels([]);
                            setLlmBackend(newBackend);
                            const defaults = {
                              lmstudio: 'http://127.0.0.1:1234',
                              ollama: 'http://127.0.0.1:11434',
                              vllm: 'http://127.0.0.1:8000/v1',
                              openai: '',
                              custom: '',
                            };
                            await handleUpdateSetting({
                              llm_model: '',
                              llm_backend: newBackend,
                              llm_base_url: defaults[newBackend] || ''
                            });
                            if (newBackend !== 'none') {
                              setTimeout(() => fetchLlmModels(true), 300);
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
                            checked={profile?.settings?.enable_rotation ?? true}
                            onChange={(e) => handleUpdateSetting('enable_rotation', e.target.checked)}
                            style={{ accentColor: '#2dd4bf', width: '13px', height: '13px', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.72rem', color: '#99f6e4', lineHeight: 1.3 }}>
                            Enable Model Rotation (Right-Click Drag)
                          </span>
                        </label>

                        {(profile?.settings?.enable_rotation ?? true) && (
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

                        {(profile?.settings?.enable_rotation ?? true) && (
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
                          <span className="spec-val">{hostPlatform}</span>
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
        <AskUserDialog
          askData={askUserData}
          onSubmit={handleAskUserSubmit}
          onClose={handleAskUserClose}
        />
      </div>
    );
  }



  return (
    <div className="app-viewport" style={{
      '--avatar-scale': avatarScale,
      // Aggressive power-curve shrink below 100%; mild grow above
      '--avatar-button-scale': avatarScale < 1.0 ? Math.pow(avatarScale, 2) : 1.0 + (avatarScale - 1.0) * 0.25,
      // Step right margin up at 130% and 160% to keep tray near model at large sizes
      '--button-tray-right': avatarScale > 1.6 ? '80px' : avatarScale > 1.3 ? '60px' : '48px'
    }}>

      {/* Top Banner Status Bar */}
      <header className="top-header glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="header-icon">
            <Sparkles className="w-4 h-4 text-violet-400 breathing" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h1>Yuki Assistant</h1>
            <span>Desktop Companion v1.0</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (window.electronAPI && window.electronAPI.openChatWindow) {
              window.electronAPI.openChatWindow();
            } else {
              const targetUrl = window.location.origin + window.location.pathname + '?mode=chat';
              window.open(targetUrl, 'YukiAgenticWorkspace', 'width=1100,height=820,resizable=yes');
            }
          }}
          title="Open Standalone Agentic Workspace Window"
          style={{
            background: 'rgba(167, 139, 250, 0.2)',
            border: '1px solid rgba(167, 139, 250, 0.4)',
            borderRadius: '6px',
            padding: '4px 8px',
            color: '#c4b5fd',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '0.72rem',
            fontWeight: 600,
            transition: 'all 0.2s ease'
          }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Pop-out Workspace
        </button>
      </header>

      <main className="canvas-container">
        <Suspense fallback={<div style={{ color: '#8b5cf6', padding: '20px', fontFamily: 'monospace' }}>Initializing 3D Engine...</div>}>
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
            cameraTracking={cameraTracking}
            customAnimation={customAnimation}
            disabledAnimations={disabledAnimations}
            activeModel={profile.settings?.active_vrm_model || 'default.vrm'}
            enableRotation={profile?.settings?.enable_rotation ?? true}
            autoResetRotation={profile.settings?.auto_reset_rotation || false}
            visible={isVisible}
            isBackendOnline={backendStatus === 'online'}
            vrmDpr={profile.settings?.vrm_dpr || 1.5}
            vrmFps={profile.settings?.vrm_fps || 40}
            boredom={presenceState.boredom}
            energy={liveMood.energy}
            playfulness={liveMood.playfulness}
            sleepState={presenceState.sleep_state}
            onWakeCharacter={handleWakeCharacter}
          />
        </Suspense>
      </main>

      {/* Floating Symmetrical Control UI overlay */}
      <Suspense fallback={<div style={{ position: 'absolute', bottom: '20px', left: '20px', color: '#8b5cf6' }}>Loading UI...</div>}>
        <ChatOverlay
          messages={messages}
          inputText={inputText}
          setInputText={setInputText}
          onSubmit={handleSendMessage}
          isListening={isListening}
          isTalkMode={isTalkMode}
          toggleListening={toggleListening}
          onReset={handleReset}
          onStartNewSession={handleStartNewSession}
          isThinking={isThinking || ttsStreamActive}
          currentSpeechText={currentSpeechText}
          isPanelOpen={isPanelOpen}
          setIsPanelOpen={setIsPanelOpen}
          muteVoice={muteVoice}
          setMuteVoice={handleToggleMute}
          disabledAnimations={disabledAnimations}
          attachments={mainAppAttachments}
          onUploadAttachments={handleUploadMainAppAttachments}
          onRemoveAttachment={handleRemoveMainAppAttachment}
          isUploadingAttachment={isUploadingMainAppAttachment}
        />
      </Suspense>

      {/* Left Symmetrical Diagnostics Dashboard */}
      <Suspense fallback={<div style={{ position: 'absolute', top: '20px', left: '20px', color: '#8b5cf6' }}>Loading Controls...</div>}>
        <ControlDashboard
          profile={profile}
          presenceState={presenceState}
          backendStatus={backendStatus}
          onResetProfile={handleReset}
          modelName={modelName}
          lmstudioUrl={lmstudioUrl}
          onOpenRelationshipCard={() => {
            fetchRelationshipStatus();
            setShowRelationshipCard(true);
          }}
          onOpenShop={() => {
            fetchRelationshipStatus();
            setShowShopModal(true);
          }}
          onProfileUpdate={(updatedProfile) => {
            if (updatedProfile) {
              setProfile(updatedProfile);
              if (updatedProfile.settings && updatedProfile.settings.llm_model) {
                setModelName(updatedProfile.settings.llm_model);
              }
            } else {
              fetchProfileDetails();
            }
          }}
          skinToneColor={avatarSkinToneColor}
          onSkinToneChange={(newColor) => {
            setAvatarSkinToneColor(newColor);
            localStorage.setItem('yuki-avatar-skintone-color', newColor);
          }}
          cameraTracking={cameraTracking}
          onCameraTrackingChange={(val) => {
            setCameraTracking(val);
            localStorage.setItem('yuki-camera-tracking', val ? 'true' : 'false');
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
          }}
          silenceTimeout={silenceTimeout}
          onSilenceTimeoutChange={(val) => {
            setSilenceTimeout(val);
          }}
          muteVoice={muteVoice}
          onMuteVoiceChange={handleToggleMute}
          voiceVolume={voiceVolume}
          onVoiceVolumeChange={(val) => {
            setVoiceVolume(val);
            localStorage.setItem('yuki-voice-volume', val.toString());
          }}
          availableLlmModels={availableLlmModels}
          availableSimpleLlmModels={availableSimpleLlmModels}
          availableEmbeddingModels={availableEmbeddingModels}
          onRefreshLlmModels={() => fetchLlmModels(true)}
          onRefreshSimpleLlmModels={() => fetchSimpleLlmModels(true)}
          onRefreshEmbeddingModels={() => fetchEmbeddingModels(true)}
          preferHeadsetMic={preferHeadsetMic}
          onPreferHeadsetMicChange={(val) => {
            setPreferHeadsetMic(val);
            localStorage.setItem('yuki-prefer-headset', val.toString());
            if (val) {
              applyHeadsetPreference(micDevices, true);
            } else {
              setSelectedMicDeviceId('');
              localStorage.removeItem('yuki-mic-device-id');
            }
          }}
          hostPlatform={hostPlatform}
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
      {/* Active Alarm & Timer Ringing Overlay */}
      <AlarmOverlay
        alarm={activeAlarm}
        onDismiss={handleDismissAlarm}
        onSnooze={handleSnoozeAlarm}
      />
      <AskUserDialog
        askData={askUserData}
        onSubmit={handleAskUserSubmit}
        onClose={handleAskUserClose}
      />

      {/* Relationship & Dating Sim Modals */}
      {showRelationshipCard && relationshipData && (
        <RelationshipCard
          relationshipStatus={relationshipData}
          onClose={() => setShowRelationshipCard(false)}
        />
      )}


    </div>
  );
};

export default App;
