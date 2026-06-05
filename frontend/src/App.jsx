import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sparkles, Terminal, MessageSquare, ShieldAlert, Settings, Footprints, Volume2, VolumeX, X, Send, RefreshCw, Play, Trash2, Cpu, User, Plus, UserCheck, HardDrive, Database, Mic, MicOff } from 'lucide-react';
import AvatarViewer from './components/AvatarViewer';
import ChatOverlay, { SLASH_COMMANDS } from './components/ChatOverlay';
import ControlDashboard from './components/ControlDashboard';
import { API_BASE, WS_BASE } from './api';
import { ANIMATIONS } from './animationsRegistry';

const SKIN_PRESETS = [
  { name: 'Original', value: '#ffffff' },
  { name: 'Fair', value: '#FFE5E5' },
  { name: 'Tan', value: '#d89c7b' },
  { name: 'Bronze', value: '#a3654a' },
  { name: 'Cocoa', value: '#593424' }
];

const LLM_MODELS = [
  { label: 'Ministra-3 (Local Llama)', value: 'ministra-3' },
  { label: 'Nvidia Nemotron-3 Nano (Local)', value: 'nvidia/nemotron-3-nano-4b' }
];

const TTS_VOICES = [
  { label: 'Sarah (US Female - Soft/Cute)', value: 'af_sarah' },
  { label: 'Sky (US Female - Natural)', value: 'af_sky' },
  { label: 'Bella (US Female - Warm)', value: 'af_bella' },
  { label: 'Isabella (UK Female - Crisp)', value: 'bf_isabella' },
  { label: 'Alice (UK Female - Clear)', value: 'bf_alice' },
  { label: 'Lily (UK Female - Gentle)', value: 'bf_lily' },
  { label: 'Alpha (JP Female - Bright)', value: 'jf_alpha' },
  { label: 'Glowing (JP Female - Cute)', value: 'jf_glowing' },
  { label: 'Yasmin (JP Female - Soft)', value: 'jf_yasmin' }
];

const TTS_RATES = [
  { label: 'Slow (0.8x)', value: '0.8' },
  { label: 'Normal (1.0x)', value: '1.0' },
  { label: 'Snappy (1.1x)', value: '1.1' },
  { label: 'Fast (1.2x)', value: '1.2' },
  { label: 'Faster (1.4x)', value: '1.4' },
];

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
    return 'happy';
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

const cleanTextForTTS = (text) => {
  if (!text) return '';

  // 1. Double asterisks and double underscores -> replace with inner text
  let clean = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');

  // 2. Single asterisks and single underscores -> filter out actions, keep emphasis
  const actionStems = [
    'wink', 'smile', 'giggle', 'laugh', 'sigh', 'pout', 'wave', 'nod',
    'shrug', 'chuckle', 'blush', 'cry', 'gasp', 'yawn', 'look', 'reset',
    'facepalm', 'point', 'cough', 'scream', 'whisper'
  ];

  const replaceSingle = (match, p1, p2) => {
    const inner = (p1 || p2 || '').trim();
    if (!inner) return '';
    const innerLower = inner.toLowerCase();
    if (actionStems.some(stem => innerLower.includes(stem))) {
      return ''; // strip the gesture action description entirely
    }
    return inner; // keep emphasis text
  };

  clean = clean.replace(/\*(.*?)\*/g, (m, p1) => replaceSingle(m, p1, ''));
  clean = clean.replace(/_(.*?)_/g, (m, p1) => replaceSingle(m, '', p1));

  // 3. Remove backticks but keep their inner text
  clean = clean.replace(/`/g, '');

  // 4. Remove emojis
  clean = clean.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{2600}-\u{27BF}]/gu, '');

  // 5. Replace multiple spaces with a single space
  return clean.replace(/\s+/g, ' ').trim();
};

const App = () => {
  // WebSockets & Backend State
  const [socket, setSocket] = useState(null);
  const [backendStatus, setBackendStatus] = useState('offline');
  const [modelName, setModelName] = useState('');
  const [lmstudioUrl, setLmstudioUrl] = useState('');

  // UI States
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([]);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  // Slash-command autocomplete for desktop input
  const desktopInputRef = useRef(null);
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
  const showCmdSugg = cmdSuggestions.length > 0;
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
  const [crawlerStatus, setCrawlerStatus] = useState({
    paused: false,
    tagger_paused: false,
    current_path: 'Idle',
    current_tagger_path: 'Idle',
    total_files: 0,
    pending_enrichment: 0,
    initial_crawl_completed: false,
    first_time_priority_done: false,
    first_cycle_done: false,
    completed_roots: [],
    remaining_roots: [],
    roots_total: 0,
    roots_current: 0,
    current_root_path: 'Idle',
    watchdog_active: false
  });

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
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTalkMode, setIsTalkMode] = useState(false);
  const [isVoiceCommandMode, setIsVoiceCommandMode] = useState(false);
  const isVoiceCommandModeRef = useRef(false);

  useEffect(() => {
    isVoiceCommandModeRef.current = isVoiceCommandMode;
  }, [isVoiceCommandMode]);
  const [currentSpeechText, setCurrentSpeechText] = useState('');
  const [muteVoice, setMuteVoice] = useState(false);
  const [avatarExpression, setAvatarExpression] = useState('neutral');
  const [crawlerPaused, setCrawlerPaused] = useState(false);
  const [taggerPaused, setTaggerPaused] = useState(false);

  // Microphone device selection
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState(() => {
    return localStorage.getItem('yuki-mic-device-id') || '';
  });
  const selectedMicDeviceIdRef = useRef(localStorage.getItem('yuki-mic-device-id') || '');

  const refreshMicDevices = async () => {
    try {
      // Need at least a temporary permission grant to get labelled devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      setMicDevices(audioInputs);
      // If saved device no longer exists, fall back to default
      if (selectedMicDeviceIdRef.current && !audioInputs.find(d => d.deviceId === selectedMicDeviceIdRef.current)) {
        selectedMicDeviceIdRef.current = '';
        setSelectedMicDeviceId('');
        localStorage.removeItem('yuki-mic-device-id');
      }
    } catch (e) {
      console.warn('Could not enumerate mic devices:', e);
    }
  };

  useEffect(() => {
    refreshMicDevices();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshMicDevices);
      return () => navigator.mediaDevices.removeEventListener('devicechange', refreshMicDevices);
    }
  }, []);

  // OS telemetry and resident companion states
  const [cpuLoad, setCpuLoad] = useState(0);
  const [systemIdleTime, setSystemIdleTime] = useState(0);
  const [powerConnected, setPowerConnected] = useState(true);
  const [lastDrivesCount, setLastDrivesCount] = useState(null);
  const [avatarScale, setAvatarScale] = useState(() => {
    const saved = localStorage.getItem('yuki-avatar-scale');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [avatarSkinToneColor, setAvatarSkinToneColor] = useState(() => {
    const saved = localStorage.getItem('yuki-avatar-skintone-color');
    return saved ? saved : '#BCC68B';
  });
  const [customAnimation, setCustomAnimation] = useState('');

  // Sync avatar scale changes to Electron window bounds size
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.setWindowScale) {
      window.electronAPI.setWindowScale(avatarScale);
    }
  }, [avatarScale]);

  // Desktop Overlay UI states
  const [isWandering, setIsWandering] = useState(false);
  const [isWalking, setIsWalking] = useState(false);
  const [walkDirection, setWalkDirection] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

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

  const handleFileDropped = (name, contents) => {
    if (!contents || !contents.trim()) return;

    const maxChars = 2000;
    const truncated = contents.length > maxChars ? contents.slice(0, maxChars) + "\n...[truncated]" : contents;

    const userMsg = `[Dropped File: ${name}]`;
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);

    const prompt = `I dropped a file named "${name}". Here is its content:\n\n${truncated}\n\nRead this file and give me a brief reaction or summary of what's inside.`;

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
        if (data.disk && data.disk.drives_count !== undefined) {
          const count = data.disk.drives_count;
          setLastDrivesCount((prevCount) => {
            if (prevCount !== null && count !== prevCount) {
              const inserted = count > prevCount;
              const msg = inserted
                ? "Master, did you just plug in a USB device? Let me see what's in there!"
                : "A storage drive was disconnected. Bye-bye USB!";

              setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to drive* ${msg}` }]);
              if (!muteVoice) {
                speakTextNatively(msg, inserted ? 'happy' : 'relaxed');
              } else {
                setAvatarExpression(inserted ? 'happy' : 'relaxed');
              }
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
      const unsubscribe = window.electronAPI.onPowerStateChange((data) => {
        setPowerConnected(data.ac);
        const msg = data.ac
          ? "Power plugged in! Ah, thanks Master! I feel fully charged now."
          : "Power unplugged. Hey, where did my electricity go, Master?";

        setMessages((prev) => [...prev, { role: 'assistant', content: `*reacts to power* ${msg}` }]);
        if (!muteVoice) {
          speakTextNatively(msg, data.ac ? 'happy' : 'surprised');
        } else {
          setAvatarExpression(data.ac ? 'happy' : 'surprised');
        }
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

  // Track window hover state for showing/hiding Electron overlay buttons
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onHoverChange) {
      const unsubscribe = window.electronAPI.onHoverChange((hovering) => {
        setIsHovered(hovering);
      });
      return unsubscribe;
    }
  }, []);

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
      // Clear queue and stop playback
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      window.speechSynthesis.cancel();
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }
      setCurrentSpeechText('');
      setAudioLevel(0);
      setAvatarExpression('neutral');
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

  const fetchCrawlerStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/crawler/status`);
      if (res.ok) {
        const data = await res.json();
        setCrawlerStatus(data);
      }
    } catch (e) {
      console.warn('Could not fetch crawler status:', e);
    }
  };

  // Poll crawler status when Electron settings modal is open and activeTab is crawler
  useEffect(() => {
    let interval = null;
    if (isSettingsOpen && activeTab === 'crawler') {
      fetchCrawlerStatus();
      interval = setInterval(fetchCrawlerStatus, 2500);
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

  // Audio Context references for Lipsync
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const nativeSpeechIntervalRef = useRef(null);
  const currentResponseTextRef = useRef('');
  const hasReceivedAudioRef = useRef(false);

  // Speech Recognition Web API (STT)
  const recognitionRef = useRef(null);
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // Talk Mode — persists between render cycles via ref so callbacks don't get stale closures
  const isTalkModeRef = useRef(false);
  // Track whether Yuki is currently speaking (so we re-listen only after she finishes)
  const isYukiSpeakingRef = useRef(false);
  // Flag to avoid double-starting recognition while waiting for Yuki
  const pendingListenRef = useRef(false);

  // 1. Initialize Audio Analyser on user click (due to browser security)
  const initAudioAnalyser = () => {
    if (audioContextRef.current) return; // Already initialized

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;

      // Create HTML audio element in memory
      const audio = new Audio();
      audio.crossOrigin = "anonymous";

      const source = audioCtx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);

      audioRef.current = audio;
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      console.log("Web Audio Analyser successfully established.");

      // Setup analyser animation loop
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (analyserRef.current && audioRef.current && !audioRef.current.paused) {
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const normalized = Math.min(average / 90.0, 0.8);
          setAudioLevel(normalized);
        } else {
          setAudioLevel(0);
        }
        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) {
      console.warn("Failed to initialize Web Audio API:", e);
    }
  };

  // 2. Play Audio Response & Display Subtitles
  const playVoiceResponse = (audioUrl, speechText, forcedExpression = null) => {
    initAudioAnalyser();

    // Set avatar expression based on speech content guide
    const expr = forcedExpression || detectExpression(speechText);
    setAvatarExpression(expr);

    // Ensure Audio Context is active
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (muteVoice || !audioRef.current) {
      // If muted, just display subtitle bubble then play next chunk
      setCurrentSpeechText(speechText);
      setIsThinking(false);
      setTimeout(() => {
        playNextAudio();
      }, Math.max(2000, speechText.length * 60));
      return;
    }

    try {
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
        setCurrentSpeechText(speechText);
        setIsThinking(false);
      };

      audioRef.current.onended = () => {
        playNextAudio();
      };

      audioRef.current.onerror = (e) => {
        console.warn("Audio element failed to load voice clip:", e);
        setCurrentSpeechText(speechText);
        setTimeout(() => playNextAudio(), Math.max(1500, speechText.length * 60));
      };

      audioRef.current.play().catch(err => {
        console.warn("Playback blocked by browser autoplay policy. Displaying subtitles.", err);
        setCurrentSpeechText(speechText);
        setTimeout(() => playNextAudio(), Math.max(1500, speechText.length * 60));
      });
    } catch (err) {
      console.error("Audio trigger error:", err);
      setCurrentSpeechText(speechText);
      setTimeout(() => playNextAudio(), Math.max(1500, speechText.length * 60));
    }
  };

  const queueAudioChunk = (audioUrl, speechText, index) => {
    audioQueueRef.current.push({ url: audioUrl, text: speechText, index: index });
    audioQueueRef.current.sort((a, b) => a.index - b.index);

    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      playNextAudio();
    }
  };

  const playNextAudio = () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      isYukiSpeakingRef.current = false;
      setCurrentSpeechText('');
      setAudioLevel(0);

      // If Talk Mode or Voice Command Mode is active and we're not already mid-listen, restart listening
      if ((isTalkModeRef.current || isVoiceCommandModeRef.current) && !pendingListenRef.current) {
        pendingListenRef.current = true;
        setTimeout(() => {
          pendingListenRef.current = false;
          if ((isTalkModeRef.current || isVoiceCommandModeRef.current) && recognitionRef.current) {
            try { recognitionRef.current.start(); } catch (e) { console.warn("Re-listen start error:", e); }
          }
        }, 400);
      }
      return;
    }

    isYukiSpeakingRef.current = true;
    const nextChunk = audioQueueRef.current.shift();
    playVoiceResponse(nextChunk.url, nextChunk.text);
  };

  const speakTextNatively = (text, forcedExpression = null) => {
    // 1. Cancel any active native speech
    window.speechSynthesis.cancel();
    if (nativeSpeechIntervalRef.current) {
      clearInterval(nativeSpeechIntervalRef.current);
      nativeSpeechIntervalRef.current = null;
    }

    // 2. Filter actions and emojis from text
    const cleanText = cleanTextForTTS(text);
    if (!cleanText) {
      setAudioLevel(0);
      return;
    }

    // Set avatar expression
    const expr = forcedExpression || detectExpression(text);
    setAvatarExpression(expr);

    // 3. Create Utterance
    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Choose a voice if possible
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v =>
      (v.lang.startsWith('en') && (v.name.includes('Google US English') || v.name.includes('Microsoft Zira') || v.name.includes('Natural') || v.name.includes('Female') || v.name.toLowerCase().includes('sally') || v.name.toLowerCase().includes('susan'))) ||
      (v.lang.startsWith('ja') && v.name.toLowerCase().includes('haruka'))
    ) || voices.find(v => v.lang.startsWith('en'));

    if (femaleVoice) {
      utterance.voice = femaleVoice;
    }

    utterance.rate = 1.05; // Slightly faster/snappier
    utterance.pitch = 1.1; // Slightly higher pitch for Yuki

    // 4. Setup lip-sync animation
    utterance.onstart = () => {
      setCurrentSpeechText(text);
      if (nativeSpeechIntervalRef.current) clearInterval(nativeSpeechIntervalRef.current);

      // Simulate speech mouth movement by cycling audioLevel
      nativeSpeechIntervalRef.current = setInterval(() => {
        setAudioLevel(Math.random() > 0.35 ? 0.2 + Math.random() * 0.4 : 0);
      }, 120);
    };

    utterance.onend = () => {
      setAudioLevel(0);
      setCurrentSpeechText('');
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }
      isYukiSpeakingRef.current = false;
      // Talk Mode or Voice Command Mode: re-listen after native speech ends
      if ((isTalkModeRef.current || isVoiceCommandModeRef.current) && !pendingListenRef.current) {
        pendingListenRef.current = true;
        setTimeout(() => {
          pendingListenRef.current = false;
          if ((isTalkModeRef.current || isVoiceCommandModeRef.current) && recognitionRef.current) {
            try { recognitionRef.current.start(); } catch (e) { console.warn(e); }
          }
        }, 400);
      }
    };

    utterance.onerror = (e) => {
      console.warn("Native TTS utterance error:", e);
      setAudioLevel(0);
      setCurrentSpeechText('');
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }
    };

    window.speechSynthesis.speak(utterance);
  };



  // 3. Establish WebSocket connection
  const connectWebSocket = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (socketRef.current) {
      try {
        socketRef.current.onclose = null;
        socketRef.current.close();
      } catch (err) {
        console.warn("Error closing old socket:", err);
      }
      socketRef.current = null;
    }

    const ws = new WebSocket(`${WS_BASE}/ws`);
    socketRef.current = ws;
    setSocket(ws);

    ws.onopen = () => {
      setBackendStatus('online');
      console.log("WebSocket connected to backend.");
    };

    ws.onmessage = (event) => {
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
          setCurrentSpeechText('');
          currentResponseTextRef.current = '';
          hasReceivedAudioRef.current = false;
        } else if (msg.status === 'idle') {
          setIsThinking(false);
        }
      } else if (msg.type === 'text_stream') {
        setIsThinking(false);
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
        hasReceivedAudioRef.current = true;
        queueAudioChunk(msg.audio_url, msg.text, msg.index);
      } else if (msg.type === 'stream_done') {
        setIsThinking(false);
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
          speakTextNatively(currentResponseTextRef.current);
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
          content: msg.result
        }]);
      } else if (msg.type === 'speech') {
        setIsThinking(false);
        hasReceivedAudioRef.current = true;
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: msg.text,
          backend: msg.backend_used,
          responseTime: msg.response_time
        }]);
        playVoiceResponse(msg.audio_url, msg.text);
      } else if (msg.type === 'error') {
        setIsThinking(false);
        setMessages((prev) => [...prev, { role: 'assistant', content: `Oh no! I encountered an error: ${msg.message}` }]);
      }
    };

    ws.onclose = () => {
      setBackendStatus('offline');
      setSocket(null);
      socketRef.current = null;
      console.warn("WebSocket disconnected. Retrying in 5 seconds...");
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = (e) => {
      console.error("WebSocket error:", e);
    };
  };

  // Prime the browser to use a specific microphone before starting SpeechRecognition.
  // The Web Speech API doesn't accept deviceId directly, but calling getUserMedia
  // with the selected deviceId first causes the browser to use that device.
  const primeSelectedMicDevice = async () => {
    const deviceId = selectedMicDeviceIdRef.current;
    if (!deviceId) return; // Use system default
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
      // Stop tracks immediately — we only needed to set the active device
      stream.getTracks().forEach(t => t.stop());
    } catch (e) {
      console.warn('Could not prime mic device:', e);
    }
  };

  const initSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Browser does not support Speech Recognition Web API.");
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onstart = () => {
      setIsListening(true);
      console.log("Speech recognition started listening...");
    };

    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      console.log("Speech recognition result:", transcript);
      if (!transcript.trim()) return;

      const lower = transcript.toLowerCase().trim();

      // If voice command mode is active
      if (isVoiceCommandModeRef.current) {
        if (lower.includes("yuki stop listening")) {
          console.log("Voice Command Mode: 'yuki stop listening' detected — stopping.");
          isVoiceCommandModeRef.current = false;
          setIsVoiceCommandMode(false);
          pendingListenRef.current = false;
          isYukiSpeakingRef.current = false;
          if (isYukiSpeakingRef._fallbackTimer) {
            clearTimeout(isYukiSpeakingRef._fallbackTimer);
            isYukiSpeakingRef._fallbackTimer = null;
          }
          try { recognitionRef.current.stop(); } catch (e) { /* already stopped */ }
          setIsListening(false);

          setMessages((prev) => [...prev, { role: 'assistant', content: "listening mode off" }]);
          speakTextNatively("listening mode off");
          return;
        }

        // Ignore speech unless her name "yuki" is taken as trigger word
        const triggerMatch = transcript.match(/^yuki\b\s*(.*)/i);
        if (!triggerMatch) {
          console.log("Voice Command Mode: 'yuki' trigger word not taken. Ignoring transcript:", transcript);
          return;
        }

        let innerText = triggerMatch[1].trim();
        if (!innerText) {
          console.log("Voice Command Mode: 'yuki' trigger word was spoken but no instruction followed.");
          return;
        }

        // Check if instructions start with "command" or "slash"
        const cmdMatch = innerText.match(/^(command|slash)\s+(.*)/i);
        if (cmdMatch) {
          // Translate to slash command
          const commandText = "/" + cmdMatch[2].trim();
          console.log("Voice Command Mode: executing translated command:", commandText);
          sendMessageText(commandText);
        } else {
          // Send as regular chat prompt
          console.log("Voice Command Mode: sending prompt:", innerText);
          sendMessageText(innerText);
        }
        return;
      }

      // Allow user to exit Talk Mode by saying "stop"
      if (isTalkModeRef.current && (lower === 'stop' || lower === 'stop listening' || lower === 'exit' || lower === 'quit')) {
        console.log("Talk Mode: exit keyword detected — stopping.");
        isTalkModeRef.current = false;
        setIsTalkMode(false);
        setIsListening(false);
        return;
      }

      // Clear queue and stop playback immediately to handle interruption and clear old bubbles
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      window.speechSynthesis.cancel();
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }
      setCurrentSpeechText('');

      sendMessageText(transcript);
    };

    rec.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      setIsListening(false);

      // In talk mode or voice command mode, ignore 'no-speech' silently and re-listen
      if ((isTalkModeRef.current || isVoiceCommandModeRef.current) && event.error === 'no-speech') {
        setTimeout(() => {
          if ((isTalkModeRef.current || isVoiceCommandModeRef.current) && recognitionRef.current) {
            try { recognitionRef.current.start(); } catch (e) { console.warn(e); }
          }
        }, 300);
        return;
      }

      let errMsg = "System Notice: Speech recognition encountered an error ('" + event.error + "').";
      if (event.error === 'not-allowed') {
        errMsg = "System Notice: Microphone access is blocked. Please click the camera/mic icon in your browser address bar and choose 'Allow'.";
      } else if (event.error === 'no-speech') {
        errMsg = "System Notice: No speech was detected. Please check your microphone connection and try speaking closer to it.";
      } else if (event.error === 'network') {
        errMsg = "System Notice: Speech recognition network error. Please check your internet connectivity.";
      }

      setMessages((prev) => [...prev, { role: 'system', content: errMsg }]);
    };

    rec.onend = () => {
      console.log("Speech recognition ended.");
      setIsListening(false);

      // If voice command mode is active, restart it immediately,
      // unless Yuki is currently speaking.
      if (isVoiceCommandModeRef.current) {
        if (!isYukiSpeakingRef.current && !pendingListenRef.current) {
          pendingListenRef.current = true;
          const fallbackTimer = setTimeout(() => {
            pendingListenRef.current = false;
            if (isVoiceCommandModeRef.current && !isYukiSpeakingRef.current) {
              try { recognitionRef.current.start(); } catch (e) { console.warn(e); }
            }
          }, 300);
          isYukiSpeakingRef._fallbackTimer = fallbackTimer;
        }
        return;
      }

      // Talk Mode: if Yuki isn't speaking yet and no result triggered a playback, re-listen
      if (isTalkModeRef.current && !isYukiSpeakingRef.current && !pendingListenRef.current) {
        pendingListenRef.current = true;
        const fallbackTimer = setTimeout(() => {
          pendingListenRef.current = false;
          if (isTalkModeRef.current && !isYukiSpeakingRef.current) {
            try { recognitionRef.current.start(); } catch (e) { console.warn(e); }
          }
        }, 8000);
        // Clear the fallback once Yuki starts speaking (handled inside playNextAudio)
        isYukiSpeakingRef._fallbackTimer = fallbackTimer;
      }
    };

    recognitionRef.current = rec;
  };

  const toggleTalkMode = async () => {
    initAudioAnalyser();

    if (!recognitionRef.current) {
      initSpeechRecognition();
    }

    if (!recognitionRef.current) {
      alert("Voice speech recognition is only supported in Chrome or Chromium-based browsers like Edge.");
      return;
    }

    // Mutually exclusive: deactivate voice command mode
    if (isVoiceCommandModeRef.current) {
      isVoiceCommandModeRef.current = false;
      setIsVoiceCommandMode(false);
    }

    if (isTalkModeRef.current) {
      // --- EXIT Talk Mode ---
      isTalkModeRef.current = false;
      setIsTalkMode(false);
      pendingListenRef.current = false;
      isYukiSpeakingRef.current = false;
      if (isYukiSpeakingRef._fallbackTimer) {
        clearTimeout(isYukiSpeakingRef._fallbackTimer);
        isYukiSpeakingRef._fallbackTimer = null;
      }
      try { recognitionRef.current.stop(); } catch (e) { /* already stopped */ }
      console.log("Talk Mode: OFF");
    } else {
      // --- ENTER Talk Mode ---
      // Stop any current playback so she doesn't keep talking while we listen
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      isYukiSpeakingRef.current = false;
      pendingListenRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      window.speechSynthesis.cancel();
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }
      setCurrentSpeechText('');

      isTalkModeRef.current = true;
      setIsTalkMode(true);
      console.log("Talk Mode: ON");
      await primeSelectedMicDevice();
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn(e);
      }
    }
  };

  const toggleVoiceCommandMode = async () => {
    initAudioAnalyser();

    if (!recognitionRef.current) {
      initSpeechRecognition();
    }

    if (!recognitionRef.current) {
      alert("Voice speech recognition is only supported in Chrome or Chromium-based browsers like Edge.");
      return;
    }

    // Mutually exclusive: deactivate talk mode
    if (isTalkModeRef.current) {
      isTalkModeRef.current = false;
      setIsTalkMode(false);
    }

    if (isVoiceCommandModeRef.current) {
      // --- EXIT Voice Command Mode ---
      isVoiceCommandModeRef.current = false;
      setIsVoiceCommandMode(false);
      pendingListenRef.current = false;
      isYukiSpeakingRef.current = false;
      if (isYukiSpeakingRef._fallbackTimer) {
        clearTimeout(isYukiSpeakingRef._fallbackTimer);
        isYukiSpeakingRef._fallbackTimer = null;
      }
      try { recognitionRef.current.stop(); } catch (e) { /* already stopped */ }
      console.log("Voice Command Mode: OFF");

      setMessages((prev) => [...prev, { role: 'assistant', content: "listening mode off" }]);
      speakTextNatively("listening mode off");
    } else {
      // --- ENTER Voice Command Mode ---
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      isYukiSpeakingRef.current = false;
      pendingListenRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      window.speechSynthesis.cancel();
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }
      setCurrentSpeechText('');

      isVoiceCommandModeRef.current = true;
      setIsVoiceCommandMode(true);
      console.log("Voice Command Mode: ON");
      await primeSelectedMicDevice();
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn(e);
      }
    }
  };

  // Legacy alias (used in ChatOverlay prop)
  const toggleListening = toggleTalkMode;

  // Extracted message routing core (used by both input bar submit and voice commands)
  const sendMessageText = (text) => {
    if (!text.trim()) return;

    initAudioAnalyser();

    // Clear queue and stop playback
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    window.speechSynthesis.cancel();
    if (nativeSpeechIntervalRef.current) {
      clearInterval(nativeSpeechIntervalRef.current);
      nativeSpeechIntervalRef.current = null;
    }
    setCurrentSpeechText('');

    // Command feature: execute command if matching slash command, else treat as normal prompt
    if (text.startsWith('/')) {
      const cmd = text.toLowerCase().split(' ')[0];

      if (cmd === '/pcstat') {
        // 1. Immediately log user message and clear input field
        setMessages((prev) => [...prev, { role: 'user', content: text }]);
        setAvatarExpression('happy');

        // 2. Fetch PC statistics from backend
        fetch(`${API_BASE}/api/system/pcstat`)
          .then((res) => {
            if (!res.ok) throw new Error("Could not contact system stats endpoint.");
            return res.json();
          })
          .then((data) => {
            if (data.error) {
              throw new Error(data.error);
            }

            // Format statistics nicely for the chat log
            let chatText = "Here are your PC stats, Master:\n";

            // CPU
            if (data.cpu && !data.cpu.error) {
              chatText += `🖥️ **CPU**: ${data.cpu.usage_percent}% (${data.cpu.cores_logical} cores`;
              if (data.cpu.freq_mhz) {
                chatText += ` @ ${(data.cpu.freq_mhz / 1000).toFixed(1)} GHz`;
              }
              chatText += ")\n";
            }

            // RAM
            if (data.ram && !data.ram.error) {
              chatText += `💾 **RAM**: ${data.ram.used_gb} GB / ${data.ram.total_gb} GB (${data.ram.usage_percent}%)\n`;
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
              chatText += `💽 **Disk (C:)**: ${data.disk.used_gb} GB / ${data.disk.total_gb} GB (${data.disk.usage_percent}%)\n`;
            }

            // Uptime
            if (data.uptime && !data.uptime.error) {
              chatText += `⏱️ **Uptime**: ${data.uptime.hours}h ${data.uptime.minutes}m\n`;
            }

            // OS info
            if (data.os) {
              chatText += `⚙️ **OS**: ${data.os}`;
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

            if (!muteVoice) {
              speakTextNatively(ttsText, 'happy');
            } else {
              setAvatarExpression('happy');
            }
          })
          .catch((err) => {
            console.error("Failed to query PC stats:", err);
            const errorMsg = "Sorry Master, I couldn't retrieve your PC statistics right now. Make sure the backend server is running.";
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: errorMsg }
            ]);
            if (!muteVoice) {
              speakTextNatively(errorMsg, 'sad');
            } else {
              setAvatarExpression('sad');
            }
          });
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

        // Execute/Animate facial expression change
        const expr = detectExpression(responseText);
        setAvatarExpression(expr);

        if (!muteVoice) {
          speakTextNatively(responseText, expr);
        }
        return;
      }
    }

    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'chat', message: text }));
    } else {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Hmph! I'm currently offline, Master. Make sure the backend server is running!" }
      ]);
    }
  };

  // 5. Send text message
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    setInputText('');
    sendMessageText(text);
  };

  // 6. Reset settings and history
  const handleReset = async () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'reset' }));
    }

    try {
      await fetch(`${API_BASE}/api/profile/reset`, { method: 'POST' });
    } catch (e) {
      console.warn(e);
    }

    // Clear queue and stop playback
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    window.speechSynthesis.cancel();
    if (nativeSpeechIntervalRef.current) {
      clearInterval(nativeSpeechIntervalRef.current);
      nativeSpeechIntervalRef.current = null;
    }
    setMessages([]);
    setCurrentSpeechText('');
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

  const fetchHealthDetails = async () => {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) {
        const data = await response.json();
        setModelName(data.model);
        setLmstudioUrl(data.lmstudio_url);
      }
    } catch (e) {
      console.warn("Could not retrieve backend stats:", e);
    }
  };

  // Initial mounts
  useEffect(() => {
    connectWebSocket();
    fetchProfileDetails();
    fetchHealthDetails();

    return () => {
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      window.speechSynthesis.cancel();
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
      }
    };
  }, []);

  const isElectron = window.electronAPI && window.electronAPI.isElectron;

  if (isElectron) {
    return (
      <div className="app-viewport">
        {/* Main 3D Canvas Body */}
        <main className="canvas-container">
          <AvatarViewer
            audioLevel={audioLevel}
            isThinking={isThinking}
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
          />
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
              setIsSettingsOpen(true);
            }}
            title="Settings"
          >
            <Settings className="w-5 h-5" />
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
            className={`desktop-menu-btn ${isWandering ? 'active' : ''}`}
            onClick={() => setIsWandering(!isWandering)}
            title="Walk/Wander"
          >
            <Footprints className="w-5 h-5" />
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
        {isThinking && !currentSpeechText && (
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
            {/* Slash-command suggestion dropdown */}
            {showCmdSugg && (
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
                }}>
                  Commands
                </div>
                {cmdSuggestions.map(({ cmd, description }, idx) => (
                  <div
                    key={cmd}
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
                      background: activeCmdIdx === idx ? 'rgba(139,92,246,0.18)' : 'transparent',
                      borderLeft: activeCmdIdx === idx ? '2px solid rgba(139,92,246,0.8)' : '2px solid transparent',
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
                ))}
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
                  if (!showCmdSugg) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveCmdIdx((i) => Math.min(i + 1, cmdSuggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveCmdIdx((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Tab' || (e.key === 'Enter' && activeCmdIdx >= 0)) {
                    e.preventDefault();
                    setInputText(cmdSuggestions[activeCmdIdx].cmd + ' ');
                    setActiveCmdIdx(-1);
                  } else if (e.key === 'Escape') {
                    setInputText('');
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                className={`desktop-chat-mic-btn ${isVoiceCommandMode ? 'active' : ''}`}
                onClick={toggleVoiceCommandMode}
                title={isVoiceCommandMode ? "Voice Commands Active (Listening)" : "Enable Voice Commands"}
              >
                {isVoiceCommandMode ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>
              <button type="submit" className="desktop-chat-send-btn">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* Glassmorphism Settings Modal for Desktop */}
        {isSettingsOpen && (
          <div className="desktop-modal-overlay interactive-element">
            <div className="desktop-modal-card">
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
                          max="1.5"
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
                      </div>
                    </div>

                    {/* Brain & AI Settings */}
                    <div className="card-group" style={{ marginTop: '10px' }}>
                      <div className="card-group-header">
                        <Cpu className="w-3.5 h-3.5 text-purple-400" />
                        <span className="card-group-title">Brain & AI Settings</span>
                      </div>

                      <div className="desktop-form-group">
                        <label className="desktop-label">Active Model Selection</label>
                        <select
                          className="desktop-select"
                          value={profile.settings?.llm_model || 'ministra-3'}
                          onChange={(e) => handleUpdateSetting('llm_model', e.target.value)}
                          style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        >
                          {LLM_MODELS.map((model) => (
                            <option key={model.value} value={model.value} style={{ background: '#120c21', color: 'white' }}>
                              {model.label}
                            </option>
                          ))}
                        </select>
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
                        onClick={async () => {
                          await handleUpdateSetting('character_name', localCharName);
                          await handleUpdateSetting('character_persona', localCharPersona);
                          alert("Companion specifications saved!");
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
                          <span className="spec-label">LM Studio URL</span>
                          <span className="spec-val" style={{ fontFamily: 'monospace', fontSize: '0.68rem', wordBreak: 'break-all' }}>
                            {lmstudioUrl || 'http://localhost:1234'}
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
      </div>
    );
  }

  return (
    <div className="app-viewport">

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
        <AvatarViewer
          audioLevel={audioLevel}
          isThinking={isThinking}
          isListening={isListening}
          expression={avatarExpression}
          cpuLoad={cpuLoad}
          systemIdleTime={systemIdleTime}
          onFileDropped={handleFileDropped}
          scale={avatarScale}
          skinToneColor={avatarSkinToneColor}
          customAnimation={customAnimation}
          disabledAnimations={disabledAnimations}
        />
      </main>

      {/* Floating Symmetrical Control UI overlay */}
      <ChatOverlay
        messages={messages}
        inputText={inputText}
        setInputText={setInputText}
        onSubmit={handleSendMessage}
        isListening={isListening}
        isTalkMode={isTalkMode}
        toggleListening={toggleListening}
        onReset={handleReset}
        isThinking={isThinking}
        currentSpeechText={currentSpeechText}
        isPanelOpen={isPanelOpen}
        setIsPanelOpen={setIsPanelOpen}
        muteVoice={muteVoice}
        setMuteVoice={handleToggleMute}
        disabledAnimations={disabledAnimations}
      />

      {/* Left Symmetrical Diagnostics Dashboard */}
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
      />

      {/* System Offline warning banner */}
      {backendStatus === 'offline' && (
        <div className="offline-banner-floating">
          <ShieldAlert className="w-4 h-4 text-red-400" />
          <span>Core disconnected. Check if backend is active.</span>
        </div>
      )}

    </div>
  );
};

export default App;
