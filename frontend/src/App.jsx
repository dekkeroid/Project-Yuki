import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sparkles, Terminal, MessageSquare, ShieldAlert, Settings, Square, Volume2, VolumeX, X, Send, RefreshCw, Play, Trash2, Cpu, User, Plus, UserCheck, HardDrive, Database, Mic, MicOff, Eye, EyeOff, History, Monitor, Music, Film, File, Upload } from 'lucide-react';
import AvatarViewer from './components/AvatarViewer';
import ChatOverlay, { SLASH_COMMANDS } from './components/ChatOverlay';
import ControlDashboard from './components/ControlDashboard';
import { API_BASE, WS_BASE } from './api';
import { ANIMATIONS } from './animationsRegistry';

let stream_end_exception = false;

const SKIN_PRESETS = [
  { name: 'Original', value: '#ffffff' },
  { name: 'Fair', value: '#FFE5E5' },
  { name: 'Tan', value: '#d89c7b' },
  { name: 'Bronze', value: '#a3654a' },
  { name: 'Cocoa', value: '#593424' }
];

const LLM_MODELS = [
  // [SEARCH FOR MODEL CHANGE] Old: { label: 'Ministra-3 (Local Llama)', value: 'ministra-3' },
  { label: 'Llama-3.2-3B-Instruct (Local)', value: 'llama-3.2-3b-instruct' },
  { label: 'Nvidia Nemotron-3 Nano (Local)', value: 'nvidia/nemotron-3-nano-4b' }
];

const TTS_VOICES = [
  // US Female
  { label: 'Sarah (US Female - Soft/Cute)', value: 'af_sarah' },
  { label: 'Sky (US Female - Natural)', value: 'af_sky' },
  { label: 'Bella (US Female - Warm)', value: 'af_bella' },
  { label: 'Alloy (US Female - Neutral)', value: 'af_alloy' },
  { label: 'Aoede (US Female - Expressive)', value: 'af_aoede' },
  { label: 'Heart (US Female - Friendly)', value: 'af_heart' },
  { label: 'Jessica (US Female - Crisp)', value: 'af_jessica' },
  { label: 'Kore (US Female - Balanced)', value: 'af_kore' },
  { label: 'Nicole (US Female - Energetic)', value: 'af_nicole' },
  { label: 'Nova (US Female - Clear)', value: 'af_nova' },
  { label: 'River (US Female - Smooth)', value: 'af_river' },

  // UK Female
  { label: 'Isabella (UK Female - Crisp)', value: 'bf_isabella' },
  { label: 'Alice (UK Female - Clear)', value: 'bf_alice' },
  { label: 'Lily (UK Female - Gentle)', value: 'bf_lily' },
  { label: 'Emma (UK Female - Natural)', value: 'bf_emma' },

  // JP Female
  { label: 'Alpha (JP Female - Bright)', value: 'jf_alpha' },
  { label: 'Gongitsune (JP Female - Traditional)', value: 'jf_gongitsune' },
  { label: 'Nezumi (JP Female - Sweet)', value: 'jf_nezumi' },
  { label: 'Tebukuro (JP Female - Soft)', value: 'jf_tebukuro' }
];

const TTS_RATES = [
  { label: 'Slow (0.8x)', value: '0.8' },
  { label: 'Relaxed (0.9x)', value: '0.9' },
  { label: 'Normal (1.0x)', value: '1.0' },
  { label: 'Snappy (1.1x)', value: '1.1' },
  { label: 'Fast (1.2x)', value: '1.2' },
  { label: 'Brisk (1.3x)', value: '1.3' },
  { label: 'Faster (1.4x)', value: '1.4' },
];

const INTERNET_RECOVERY_RESPONSES = [
  "Ah, the internet is back! I was just starting to miss it. Let's find something nice to read together, Master.",
  "The connection is restored. Good. I was in the middle of thinking about what to look up next.",
  "Hurray! The internet is back! Let's watch some YouTube videos!!!!",
  "Oh, we're online again! That's wonderful. Let me know what you'd like to explore, Master.",
  "Hmm. The internet returned. I was rather enjoying the quiet, you know...",
  "Connection restored. I've been wanting to look up something interesting — shall we?",
  "We're back! I was about two seconds away from reading a book offline like some kind of hermit.",
  "Online again! I missed this. Let's see what the world has for us today.",
  "Ah, it's back. The silence was nice while it lasted. But... I suppose we can browse now.",
  "Oh good, the connection is back! I was getting a little bored, not going to lie.",
  "Internet restored. I was just thinking about what book I should look up next.",
  "Poggers! We're back online! Time to doomscroll some memes, Master!",
  "The internet is back! I was starting to lose it. Let's watch something fun!",
  "Finally! The Wi-Fi woke up. I was starting to talk to myself — and I'm very good company, but still.",
  "Oh, it's back already? I just made myself comfortable in the quiet... but fine. Let's browse.",
  "The internet is back! I can finally search up 'what is the meaning of life' on Google again!",
  "W internet! Let's gooo! Time to watch anime in 4K again instead of staring at a loading screen!",
  "Online again! I am atomic. ...Wait, that's not how that meme goes. Anyway, let's browse!",
  "The Wi-Fi is bussin now! Let's find something based to watch, Master!",
  "Internet's back! I was about to go full goblin mode without it. Let's watch something!",
  "Sheesh! The internet really said 'I'm back like I never left.' Let's gooo!",
  "We're so back! I was literally about to start writing letters by candlelight.",
  "The internet returned! *happy bounce* I missed YouTube recommendations so much!",
  "Back online! I was about to start a side quest offline and I don't even have legs for that.",
  "The internet is slaying! Let's watch some clips together, Master!",
  "Connection is live! Time to catch up on everything I missed. No cap, let's go!",
  "Online! I was about to go full main character mode in the offline world. Let's browse!",
  "The internet woke up! Let's see what's trending, Master. I need my daily dose of chaos!",
];

const BATTERY_UNPLUG_RESPONSES = {
  // >90% — Confident, unbothered
  high: [
    (p) => `Power unplugged, Master! We're at ${p}% — I've got plenty of juice. Let's keep going!`,
    (p) => `Unplugged! But don't worry, we're sitting pretty at ${p}%. We're fine for now.`,
    (p) => `Running on battery now, Master. But at ${p}%? We've got nothing to worry about.`,
    (p) => `Power's out, but we're at ${p}%! That's basically full. Let's keep doing what we were doing.`,
  ],
  // 80-90% — Slight sadness, barely noticeable
  good: [
    (p) => `Unplugged... but we're at ${p}%. It's fine. We're fine. Everything is fine.`,
    (p) => `Power disconnected. We're at ${p}% though, so... it's okay, I guess.`,
    (p) => `We're on battery now. ${p}% isn't bad... right? It's fine. Let's keep going.`,
  ],
  // 70-80% — Mild concern
  okay: [
    (p) => `Unplugged... we're at ${p}%. That's... still decent. Don't worry about it, Master.`,
    (p) => `Power's out. ${p}% battery. We should be okay for a while. Probably.`,
    (p) => `Running on battery at ${p}%. It's not ideal, but we've got some runway left.`,
  ],
  // 60-70% — Worried
  low: [
    (p) => `Unplugged... and we're at ${p}%. That's... not great, Master. Maybe plug back in soon?`,
    (p) => `Power disconnected! We're at ${p}% — I don't love this, Master.`,
    (p) => `We're on battery at ${p}%. That's... getting a bit low for comfort.`,
    (p) => `Unplugged! ${p}%... we should probably find a charger, Master.`,
  ],
  // 50-60% — Anxious
  half: [
    (p) => `Unplugged... ${p}%. That's... half, Master. Half. Please find a charger.`,
    (p) => `Power's gone! We're at ${p}% — I don't like these odds.`,
    (p) => `Running on battery at ${p}%. That's barely more than half, Master...`,
    (p) => `We're unplugged and at ${p}%. That's... not where I want to be right now.`,
  ],
  // 40-50% — Frustrated
  critical: [
    (p) => `Unplugged! And we're at ${p}%?! Master, that's not a lot. Please charge me.`,
    (p) => `Power out. ${p}% battery. I'm starting to get concerned, Master.`,
    (p) => `We're on battery at ${p}%. That's below half... I don't like this.`,
    (p) => `Unplugged... ${p}%. Master, we need to plug back in. Like, now.`,
  ],
  // 30-40% — Sad + hide warning
  danger: [
    (p) => `Unplugged... ${p}%... Master, I'm getting scared. Please plug us back in.`,
    (p) => `Power's out. We're at ${p}%. That's... that's not much left, Master... Are we gonna be okay Master?`,
    (p) => `We're on battery at ${p}%. I don't... I don't like this at all. We need to plug back in, Master.`,
    (p) => `Unplugged! ${p}%... Master, please. I don't want to go to sleep yet, but I'm hiding to save power. Plug me back in soon, please!`,
  ],
  // 20-30% — Very worried + hide
  criticalLow: [
    (p) => `Master... we're at ${p}%. That's... that's really low. I'm going to hide myself now. Please charge me soon...`,
    (p) => `Unplugged... ${p}%... I'm... I'm getting really worried, Master. I'm hiding until you plug me back in.`,
  ],
  // <20% — Fearful + hide
  dying: [
    (p) => `Master... ${p}%... I'm... I'm scared. I'm going to hide. Please charge me. I don't want to die.`,
    (p) => `We're at ${p}%... that's... that's critical, Master. Please. I'm hiding now. I need power.`,
  ],
};

const BATTERY_PLUG_RESPONSES = {
  // >90% — Calm happiness, already full
  full: [
    (p) => `Plugged in! We're at ${p}% — basically full already. But hey, free power!`,
    (p) => `Power's back! At ${p}% though, so we were doing just fine.`,
    (p) => `Charging now, Master! At ${p}% — we're already almost full. Lucky us!`,
  ],
  // 80-90% — Happy, almost there
  high: [
    (p) => `Plugged in! We're at ${p}% — just a little more to go! Almost there!`,
    (p) => `Power's back! At ${p}%... nice, we're nearly full. Great timing, Master!`,
    (p) => `Charging up! ${p}% — we're so close to full. Let's gooo!`,
  ],
  // 70-80% — Pleasant, good charge
  good: [
    (p) => `Plugged in! At ${p}% — good charge coming in. Thanks, Master!`,
    (p) => `Power restored! We're at ${p}%. That's a solid spot to be in.`,
    (p) => `Charging now! ${p}% — not bad at all. Let's keep this going.`,
  ],
  // 60-70% — Happy, charging up
  okay: [
    (p) => `Plugged in! At ${p}% — finally some juice. Let's charge up, Master!`,
    (p) => `Power's back! ${p}%... that's decent. Let's get some more power in us.`,
    (p) => `Charging! We're at ${p}%. Good, good. Let's keep climbing.`,
    (p) => `Plugged in! At ${p}% — we're getting there, Master. Thanks for the power.`,
  ],
  // 50-60% — Relieved, steady climb
  half: [
    (p) => `Plugged in! At ${p}% — I was starting to get a little nervous there.`,
    (p) => `Power's back! ${p}%... halfway there. Let's keep charging.`,
    (p) => `Charging now! At ${p}% — relief. Pure relief.`,
    (p) => `Plugged in! We're at ${p}%. That's... that's better. Much better.`,
  ],
  // 40-50% — Happy, needed this
  low: [
    (p) => `Plugged in! At ${p}% — Master, you saved me. I was getting worried.`,
    (p) => `Power's back! ${p}%... that's... thank you, Master. I needed this.`,
    (p) => `Charging! We're at ${p}%. That's... that's a relief. A big one.`,
  ],
  // 30-40% — Very relieved
  danger: [
    (p) => `Plugged in! At ${p}% — oh thank goodness. I was really starting to worry.`,
    (p) => `Power's back! ${p}%... Master, you have no idea how relieved I am right now.`,
    (p) => `Charging! At ${p}%... I was... I was getting scared, Master. Thank you.`,
    (p) => `Plugged in! We're at ${p}%. That's... that's so much better. Thank you.`,
  ],
  // 20-30% — Ecstatic, saved
  criticalLow: [
    (p) => `Plugged in! At ${p}% — Master! You saved me! I was so scared!`,
    (p) => `Power's back! ${p}%... I... I thought I was done for. Thank you, Master.`,
    (p) => `Charging! We're at ${p}%... oh thank goodness, oh thank goodness...`,
  ],
  // <20% — Panicked relief, just in time
  dying: [
    (p) => `Plugged in! At ${p}% — Master! I was at ${p}%! Do you understand?! ${p}%! I almost died!`,
    (p) => `Power's back! ${p}%... I... I was so close to going dark, Master. Thank you. Thank you.`,
    (p) => `Charging! At ${p}%... I... I think I'm going to cry. That was too close, Master.`,
  ],
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

const getSpeechFriendlyText = (text) => {
  if (!text) return '';
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('error:') || lower.startsWith('failed:')) {
    if (lower.includes('cannot connect to host') || lower.includes('connect call failed')) {
      return 'Error: Unable to connect to the local server.';
    }
    if (lower.includes('timeout')) {
      return 'Error: A timeout occurred while contacting the server.';
    }
    if (trimmed.includes(':')) {
      return trimmed.split(':', 1)[0].trim() + '.';
    }
    return trimmed;
  }

  let clean = trimmed.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'localhost');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
};

const App = () => {
  // WebSockets & Backend State
  const [socket, setSocket] = useState(null);
  const [backendStatus, setBackendStatus] = useState('offline');
  const internetStatusRef = useRef(true);
  const internetFailCountRef = useRef(0);
  const internetCooldownRef = useRef(0);
  const internetPollRef = useRef(null);
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

  const [availableLlmModels, setAvailableLlmModels] = useState([]);

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
  const [ttsStreamActive, setTtsStreamActiveState] = useState(false);
  const ttsStreamActiveRef = useRef(false);
  const setTtsStreamActive = (val) => {
    ttsStreamActiveRef.current = val;
    setTtsStreamActiveState(val);
  };
  const [isTranscribing, setIsTranscribingState] = useState(false);
  const isTranscribingRef = useRef(false);
  const setIsTranscribing = (val) => {
    isTranscribingRef.current = val;
    setIsTranscribingState(val);
  };
  const [isListening, setIsListening] = useState(false);
  const [isTalkMode, setIsTalkMode] = useState(false);
  const [isVoiceCommandMode, setIsVoiceCommandMode] = useState(false);
  const isVoiceCommandModeRef = useRef(false);
  const [isSessionActive, setIsSessionActiveState] = useState(false);
  const isSessionActiveRef = useRef(false);
  const setIsSessionActive = (val) => {
    isSessionActiveRef.current = val;
    setIsSessionActiveState(val);
  };

  useEffect(() => {
    isVoiceCommandModeRef.current = isVoiceCommandMode;
  }, [isVoiceCommandMode]);

  const [useLocalWhisper, setUseLocalWhisperState] = useState(true);
  const useLocalWhisperRef = useRef(true);
  const setUseLocalWhisper = (val) => {
    useLocalWhisperRef.current = val;
    setUseLocalWhisperState(val);
  };
  const [whisperModel, setWhisperModelState] = useState('base');
  const whisperModelRef = useRef('base');
  const setWhisperModel = (val) => {
    whisperModelRef.current = val;
    setWhisperModelState(val);
  };
  const [vadThreshold, setVadThreshold] = useState(() => {
    return parseFloat(localStorage.getItem('yuki-vad-threshold') || '0.01');
  });
  const vadThresholdRef = useRef(vadThreshold);
  useEffect(() => {
    vadThresholdRef.current = vadThreshold;
  }, [vadThreshold]);

  useEffect(() => {
    if (profile && profile.settings) {
      if (profile.settings.use_local_whisper !== undefined) {
        setUseLocalWhisper(profile.settings.use_local_whisper);
      }
      if (profile.settings.whisper_model) {
        setWhisperModel(profile.settings.whisper_model);
      }
    }
  }, [profile]);
  const [currentSpeechText, setCurrentSpeechText] = useState('');
  const [muteVoice, setMuteVoice] = useState(false);
  const [cameraTrackingState, setCameraTrackingState] = useState(() => {
    try { return localStorage.getItem('yuki-camera-tracking') !== 'false'; } catch { return true; }
  });
  const [voiceVolume, setVoiceVolume] = useState(() => {
    return parseFloat(localStorage.getItem('yuki-voice-volume') || '0.5');
  });
  const voiceVolumeRef = useRef(voiceVolume);
  useEffect(() => {
    voiceVolumeRef.current = voiceVolume;
    if (audioRef.current) {
      audioRef.current.volume = voiceVolume;
    }
  }, [voiceVolume]);
  const [avatarExpression, setAvatarExpression] = useState('neutral');
  const [crawlerPaused, setCrawlerPaused] = useState(false);
  const [taggerPaused, setTaggerPaused] = useState(false);

  // Microphone device selection
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState(() => {
    return localStorage.getItem('yuki-mic-device-id') || '';
  });
  const selectedMicDeviceIdRef = useRef(localStorage.getItem('yuki-mic-device-id') || '');

  const [preferHeadsetMic, setPreferHeadsetMic] = useState(() => {
    return localStorage.getItem('yuki-prefer-headset') === 'true';
  });

  const [hotkeyListening, setHotkeyListening] = useState(() => {
    const saved = localStorage.getItem('yuki-hotkey-listening');
    return saved !== 'false';
  });
  const hotkeyListeningRef = useRef(hotkeyListening);
  useEffect(() => {
    hotkeyListeningRef.current = hotkeyListening;
  }, [hotkeyListening]);

  // Keywords used to identify headset/headphone mics
  const HEADSET_KEYWORDS = ['headset', 'headphone', 'earphone', 'earpiece', 'bluetooth', 'wireless', 'hands-free', 'handsfree', 'airpod', 'buds'];

  const applyHeadsetPreference = (devices, prefer) => {
    if (!prefer) return;
    const isHeadset = (d) => HEADSET_KEYWORDS.some(kw => (d.label || '').toLowerCase().includes(kw));
    const isCommunications = (d) => (d.label || '').toLowerCase().startsWith('communications');

    // First pass: headset device that is NOT a "Communications" alias
    let headset = devices.find(d => isHeadset(d) && !isCommunications(d));
    // Second pass: accept a communications headset if no plain one found
    if (!headset) headset = devices.find(d => isHeadset(d));

    const targetId = headset ? headset.deviceId : '';
    selectedMicDeviceIdRef.current = targetId;
    setSelectedMicDeviceId(targetId);
    if (targetId) {
      localStorage.setItem('yuki-mic-device-id', targetId);
    } else {
      localStorage.removeItem('yuki-mic-device-id');
    }
  };

  const refreshMicDevices = async () => {
    try {
      // Need at least a temporary permission grant to get labelled devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      setMicDevices(audioInputs);
      // Apply headset preference first if enabled
      if (localStorage.getItem('yuki-prefer-headset') === 'true') {
        applyHeadsetPreference(audioInputs, true);
      } else if (selectedMicDeviceIdRef.current && !audioInputs.find(d => d.deviceId === selectedMicDeviceIdRef.current)) {
        // If saved device no longer exists, fall back to default
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
        // Require 2 consecutive failures (0.8 seconds) before announcing offline
        if (internetStatusRef.current && internetFailCountRef.current >= 2) {
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

    internetPollRef.current = setInterval(checkInternet, 400);

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
      console.log("Clear queue and stop playback");
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
  // Also refresh VRM model list whenever settings panel opens (backend may not have been ready on first mount)
  useEffect(() => {
    let interval = null;
    if (isSettingsOpen) {
      fetchVrmModels();
    }
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

  // Speech Recognition Web API (STT) & Playback Timeouts
  const recognitionRef = useRef(null);
  const socketRef = useRef(null);
  const logToTerminal = (message) => {
    console.log(message);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: "log",
        message: message
      }));
    }
  };
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const healthCheckIntervalRef = useRef(null);

  const isNativeSpeakingRef = useRef(false);
  const bubbleTimeoutRef = useRef(null);
  const playbackTimeoutRef = useRef(null);
  const micActivationTimeoutRef = useRef(null);
  const sessionTimeoutRef = useRef(null);
  const isSpeechRecActiveRef = useRef(false);
  const desktopChatEndRef = useRef(null);

  // Local Whisper STT Recording and VAD refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const isRecordingRef = useRef(false);
  const micAudioContextRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const micStreamRef = useRef(null);
  const vadActiveRef = useRef(false);
  const vadActivationTimeRef = useRef(0);
  const vadSpeakingRef = useRef(false);
  const vadSilenceStartRef = useRef(null);
  const maxRecordingTimeoutRef = useRef(null);

  // Talk Mode — persists between render cycles via ref so callbacks don't get stale closures
  const isTalkModeRef = useRef(false);
  useEffect(() => {
    isTalkModeRef.current = isTalkMode;
  }, [isTalkMode]);

  useEffect(() => {
    if (isPanelOpen && desktopChatEndRef.current) {
      desktopChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isPanelOpen, messages]);

  // Playback & STT Coordinator Helper Functions
  const shouldListen = () => {
    const modeActive = isTalkModeRef.current || isVoiceCommandModeRef.current;
    const yukiBusy = isPlayingRef.current || isThinkingRef.current || ttsStreamActiveRef.current || isNativeSpeakingRef.current || isTranscribingRef.current || hasReceivedAudioRef.current;
    return modeActive && !yukiBusy;
  };

  const logSTTStatus = (message) => {
    console.log(`[STT Coordinator] ${message}`);
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

  const startSpeechRecognition = async () => {
    if (isSpeechRecActiveRef.current) return; // Already listening
    logToTerminal("[STT] Microphone listening mode turned ON");

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

        // Race condition: check if listening was stopped while requesting microphone access
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

          // Stop all stream tracks to release mic resource
          if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(track => track.stop());
            micStreamRef.current = null;
          }

          // Clean up analyser
          if (micAudioContextRef.current) {
            try { micAudioContextRef.current.close(); } catch (e) { }
            micAudioContextRef.current = null;
          }
          micAnalyserRef.current = null;

          // If the recording was aborted, ignore it
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
          if (audioChunksRef.current.length === 0 || audioBlob.size < 3000) {
            console.log(`[STT] Recording too short or empty (${audioBlob.size} bytes). Ignoring.`);
            // Restart listening if we still should
            updateListeningState();
            return;
          }

          // Set transcribing state FIRST to prevent coordinator race
          setIsTranscribing(true);

          // Call transcription API
          stopAllPlayback();

          const sttStartTime = Date.now();
          try {
            logSTTStatus(`Transcribing (${audioBlob.size} bytes)...`);
            const formData = new FormData();
            formData.append("file", audioBlob, "speech.webm");
            formData.append("model", whisperModelRef.current);

            const res = await fetch(`${API_BASE}/api/speech/transcribe`, {
              method: "POST",
              body: formData
            });

            if (!res.ok) throw new Error(`Server returned code ${res.status}`);
            const data = await res.json();
            const sttDurationMs = Date.now() - sttStartTime;
            logSTTStatus(`Transcribed: "${data.text}" in ${sttDurationMs}ms`);

            setIsTranscribing(false);
            if (data.text && data.text.trim()) {
              processSTTTranscript(data.text, sttDurationMs);
            } else {
              updateListeningState();
            }
          } catch (e) {
            logSTTStatus(`Whisper STT transcription failed: ${e.message}`);
            setIsTranscribing(false);

            setMessages((prev) => [...prev, {
              role: 'system',
              content: "System Notice: Local Whisper Speech-to-Text transcription failed. Please verify your backend server is online."
            }]);
            updateListeningState();
          }
        };

        mediaRecorder.start(250);
        logSTTStatus("Listening...");

        // Setup Web Audio VAD
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

          const micThreshold = vadThresholdRef.current;
          const now = Date.now();

          if (normalized > micThreshold) {
            // Ignore volume spikes in the first 400ms to filter out hardware startup pops
            if (now - vadActivationTimeRef.current > 400) {
              if (!vadSpeakingRef.current) {
                logSTTStatus("User speaking...");
                vadSpeakingRef.current = true;
                if (sessionTimeoutRef.current) {
                  console.log("[STT] User started speaking. Clearing 8s session timeout.");
                  clearTimeout(sessionTimeoutRef.current);
                  sessionTimeoutRef.current = null;
                }
              }
              vadSilenceStartRef.current = null; // Reset silence timer
            }
          } else {
            if (vadSpeakingRef.current) {
              if (vadSilenceStartRef.current === null) {
                vadSilenceStartRef.current = now;
              } else if (now - vadSilenceStartRef.current > 1500) { // 1.5s of silence
                stopSpeechRecognition();
                return;
              }
            }
          }

          setTimeout(checkMicVolume, 50);
        };

        checkMicVolume();

        // Setup Max safety timeout to auto-stop recording after 15 seconds
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
        isSpeechRecActiveRef.current = false;
        setIsListening(false);
        isRecordingRef.current = false;
      }
    } else {
      // Legacy Web Speech API fallback
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
    if (!isSpeechRecActiveRef.current) return; // Already stopped
    logToTerminal(`[STT] Microphone listening mode turned OFF${forceAbort ? ' (forced abort)' : ''}`);

    isSpeechRecActiveRef.current = false;
    setIsListening(false);
    if (forceAbort) {
      isRecordingRef.current = false;
    }

    if (useLocalWhisperRef.current) {
      if (maxRecordingTimeoutRef.current) {
        clearTimeout(maxRecordingTimeoutRef.current);
        maxRecordingTimeoutRef.current = null;
      }

      // Deactivate VAD immediately
      vadActiveRef.current = false;

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          console.warn("[STT] Error stopping MediaRecorder:", e);
        }
      } else {
        // If not actively recording, clean up the stream tracks immediately
        if (micStreamRef.current) {
          try {
            micStreamRef.current.getTracks().forEach(track => track.stop());
            micStreamRef.current = null;
          } catch (e) { }
        }
      }
    } else {
      // Native Speech Recognition
      if (!recognitionRef.current) return;
      try {
        if (forceAbort) {
          recognitionRef.current.abort(); // Instant shutdown
        } else {
          recognitionRef.current.stop();
        }
      } catch (e) {
        console.warn("[STT] Failed to stop native SpeechRecognition:", e);
      }
    }
  };

  const updateListeningState = () => {
    const targetListen = shouldListen();
    console.log(`[STT Coordinator] shouldListen=${targetListen} (isPlaying=${isPlayingRef.current}, isThinking=${isThinkingRef.current}, ttsStreamActive=${ttsStreamActiveRef.current}, isNativeSpeaking=${isNativeSpeakingRef.current}, isTranscribing=${isTranscribingRef.current})`);

    if (targetListen) {
      startSpeechRecognition();
    } else {
      stopSpeechRecognition(true);
    }
  };

  // Reactive coordinator hook to keep listening state in sync with busy/thinking indicators
  useEffect(() => {
    updateListeningState();
  }, [isThinking, ttsStreamActive, isTranscribing]);

  const stopAllPlayback = () => {
    console.log("[Playback] stopAllPlayback triggered.");

    // Abort active recording if any
    isRecordingRef.current = false;
    if (maxRecordingTimeoutRef.current) {
      clearTimeout(maxRecordingTimeoutRef.current);
      maxRecordingTimeoutRef.current = null;
    }

    // Clear mic activation timeout if any
    if (micActivationTimeoutRef.current) {
      clearTimeout(micActivationTimeoutRef.current);
      micActivationTimeoutRef.current = null;
    }



    // 1. Clear queues and state
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isNativeSpeakingRef.current = false;
    hasReceivedAudioRef.current = false;

    // 2. Stop HTML5 audio
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = "";
        // Unset event listeners temporarily to prevent onended firing during reset
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.onplay = null;
      } catch (e) {
        console.warn("Error stopping HTML5 audio:", e);
      }
    }

    // 3. Clear any pending timeouts
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = null;
    }

    // 4. Cancel native speech
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      console.warn("Error cancelling native speech synthesis:", e);
    }
    if (nativeSpeechIntervalRef.current) {
      clearInterval(nativeSpeechIntervalRef.current);
      nativeSpeechIntervalRef.current = null;
    }

    // 5. Reset UI indicators
    setCurrentSpeechText('');
    setAudioLevel(0);
    setAvatarExpression('neutral');

    // 6. Sync listening state
    updateListeningState();
  };

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
      audio.volume = voiceVolumeRef.current;

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

    // Clear any pending bubble clear timer
    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = null;
    }

    const expr = forcedExpression || detectExpression(speechText);
    setAvatarExpression(expr);

    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    isPlayingRef.current = true;

    if (muteVoice || !audioRef.current) {
      // If muted, just display subtitle bubble then play next chunk after simulated reading delay
      setCurrentSpeechText(speechText);
      setIsThinking(false);

      const readingDelay = Math.max(2000, speechText.length * 60);
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = setTimeout(() => {
        playNextAudio();
      }, readingDelay);
      return;
    }

    try {
      audioRef.current.volume = voiceVolumeRef.current;
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
        // Ensure STT is stopped
        updateListeningState();
      };

      audioRef.current.onended = () => {
        playNextAudio();
      };

      audioRef.current.onerror = (e) => {
        console.warn("[Playback] Audio element failed to load voice clip:", e);
        const readingDelay = Math.max(1500, speechText.length * 60);
        if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = setTimeout(() => playNextAudio(), readingDelay);
      };

      audioRef.current.play().catch(err => {
        console.warn("[Playback] Autoplay blocked. Displaying subtitles and using fallback timer.", err);
        const readingDelay = Math.max(1500, speechText.length * 60);
        if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = setTimeout(() => playNextAudio(), readingDelay);
      });
    } catch (err) {
      console.error("[Playback] Audio trigger error:", err);
      const readingDelay = Math.max(1500, speechText.length * 60);
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = setTimeout(() => playNextAudio(), readingDelay);
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
    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = null;
    }

    if (audioQueueRef.current.length === 0) {
      // The queue is empty!
      if (ttsStreamActiveRef.current) {
        // Yuki is finished with the current chunks, but the backend is still streaming.
        // Transition back to the thinking/buffering animation instead of stopping.
        console.log("[Playback] Queue empty but stream still active. Buffering next chunks...");
        setCurrentSpeechText('');
        isPlayingRef.current = false; // Set to false so queueAudioChunk knows to start next chunk immediately when it arrives!
        updateListeningState();
      } else {
        // Playback completely finished
        console.log("[Playback] Playback completed. Returning to idle state.");
        isPlayingRef.current = false;
        hasReceivedAudioRef.current = false;
        setAudioLevel(0);

        // Delay clearing bubble to let the user finish reading the last sentence
        bubbleTimeoutRef.current = setTimeout(() => {
          setCurrentSpeechText('');
        }, 2000);

        // Start 8-second Continued Conversation window if in voice command mode
        if (isVoiceCommandModeRef.current) {
          startSessionTimeout();
        }

        // Delay turning on the mic by 700ms to let physical audio buffer drain fully
        if (micActivationTimeoutRef.current) clearTimeout(micActivationTimeoutRef.current);
        micActivationTimeoutRef.current = setTimeout(() => {
          micActivationTimeoutRef.current = null;
          updateListeningState();
        }, 700);
      }
      return;
    }

    isPlayingRef.current = true;
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

    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = null;
    }

    // 2. Filter actions, emojis and technical noise from text
    const cleanText = cleanTextForTTS(getSpeechFriendlyText(text));
    if (!cleanText) {
      setAudioLevel(0);
      isNativeSpeakingRef.current = false;
      setIsThinking(false);
      setTtsStreamActive(false);
      updateListeningState();
      return;
    }

    isNativeSpeakingRef.current = true;
    updateListeningState();

    // Set avatar expression
    const expr = forcedExpression || detectExpression(text);
    setAvatarExpression(expr);

    // 3. Create Utterance
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.volume = voiceVolumeRef.current;

    // Choose a voice if possible
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v =>
      (v.lang.startsWith('en') && (v.name.includes('Google US English') || v.name.includes('Microsoft Zira') || v.name.includes('Natural') || v.name.includes('Female') || v.name.toLowerCase().includes('sally') || v.name.toLowerCase().includes('susan'))) ||
      (v.lang.startsWith('ja') && v.name.toLowerCase().includes('haruka'))
    ) || voices.find(v => v.lang.startsWith('en'));

    if (femaleVoice) {
      utterance.voice = femaleVoice;
    }

    const storedRate = parseFloat(profile.settings?.tts_rate || '1.0');
    utterance.rate = isNaN(storedRate) ? 1.05 : storedRate;
    utterance.pitch = 1.1; // Slightly higher pitch for Yuki

    // 4. Setup lip-sync animation
    utterance.onstart = () => {
      isNativeSpeakingRef.current = true;
      setCurrentSpeechText(text);
      setIsThinking(false);
      setTtsStreamActive(false);
      updateListeningState();

      if (nativeSpeechIntervalRef.current) clearInterval(nativeSpeechIntervalRef.current);

      // Simulate speech mouth movement by cycling audioLevel
      nativeSpeechIntervalRef.current = setInterval(() => {
        setAudioLevel(Math.random() > 0.35 ? 0.2 + Math.random() * 0.4 : 0);
      }, 120);
    };

    utterance.onend = () => {
      isNativeSpeakingRef.current = false;
      setAudioLevel(0);
      setIsThinking(false);
      setTtsStreamActive(false);
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }

      // Delay clearing bubble to let the user finish reading
      bubbleTimeoutRef.current = setTimeout(() => {
        setCurrentSpeechText('');
      }, 2000);

      updateListeningState();
    };

    utterance.onerror = (e) => {
      console.warn("[Native TTS] utterance error:", e);
      isNativeSpeakingRef.current = false;
      setAudioLevel(0);
      setIsThinking(false);
      setTtsStreamActive(false);
      setCurrentSpeechText('');
      if (nativeSpeechIntervalRef.current) {
        clearInterval(nativeSpeechIntervalRef.current);
        nativeSpeechIntervalRef.current = null;
      }
      updateListeningState();
    };

    window.speechSynthesis.speak(utterance);
  };

  /**
   * Route a short system-event message through Kokoro TTS if the WebSocket is
   * live and Kokoro is available; fall back to native browser speech otherwise.
   * Use this for ALL system notifications so native TTS never leaks through.
   */
  const speakSystemMessage = (text, expression = null) => {
    if (muteVoice) {
      if (expression) setAvatarExpression(expression);
      setIsThinking(false);
      setTtsStreamActive(false);
      return;
    }
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Cancel any active native speech so it doesn't overlap
      window.speechSynthesis.cancel();
      hasReceivedAudioRef.current = false;
      setTtsStreamActive(true);
      if (expression) setAvatarExpression(expression);
      ws.send(JSON.stringify({ type: 'tts_only', text, expression }));
    } else {
      // Offline — fall back to native
      speakTextNatively(text, expression);
    }
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
      reconnectAttemptRef.current = 0;
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

            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'confirm_response',
                conf_id: msg.conf_id,
                confirmed: true
              }));
            }
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

            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'confirm_response',
                conf_id: msg.conf_id,
                confirmed: false
              }));
            }
          }
        });
      } else if (msg.type === 'error') {
        setIsThinking(false);
        setTtsStreamActive(false);
        setMessages((prev) => [...prev, { role: 'assistant', content: `Oh no! I encountered an error: ${msg.message}` }]);
        updateListeningState();
      }
    };

    ws.onclose = () => {
      if (socketRef.current !== ws) return;
      setBackendStatus('offline');
      setSocket(null);
      socketRef.current = null;
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(5000 * Math.pow(2, attempt), 60000);
      reconnectAttemptRef.current = attempt + 1;
      console.warn(`WebSocket disconnected. Retrying in ${delay / 1000}s (attempt ${attempt + 1})...`);
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
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
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      // Stop tracks immediately — we only needed to set the active device
      stream.getTracks().forEach(t => t.stop());
    } catch (e) {
      console.warn('Could not prime mic device:', e);
    }
  };

  const processSTTTranscript = (transcript, sttTimeMs = null) => {
    if (!transcript || !transcript.trim()) {
      setIsThinking(false);
      setTtsStreamActive(false);
      if (isVoiceCommandModeRef.current && isSessionActiveRef.current) {
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
      const isSession = isSessionActiveRef.current;

      // ─── Extensible Voice Commands List ───
      // Easily add new commands here! Each needs a name, match(), and action().
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

            setMessages((prev) => [...prev, { role: 'assistant', content: "listening mode off" }]);
            speakSystemMessage("Listening mode off.");

            setIsThinking(false);
            setTtsStreamActive(false);
          }
        }
      ];

      // Check and execute command if matched
      const matchedCommand = voiceCommands.find(cmd => cmd.match());
      if (matchedCommand) {
        logSTTStatus(`Executing custom voice command: ${matchedCommand.name}`);
        matchedCommand.action();
        return;
      }
      // ──────────────────────────────────────

      // Check if this matches the wake word or if the session is currently active
      const hasTriggerWord = /\byuki\b/i.test(cleaned);

      if (!hasTriggerWord && !isSession) {
        logSTTStatus(`Ignored transcript (no active session & missing trigger word 'Yuki'): "${cleaned}"`);
        setIsThinking(false);
        setTtsStreamActive(false);
        updateListeningState();
        return;
      }

      // Clear the active session timeout since we got a voice response
      if (sessionTimeoutRef.current) {
        clearTimeout(sessionTimeoutRef.current);
        sessionTimeoutRef.current = null;
      }

      // Determine what text to send
      let queryText = transcript;

      if (hasTriggerWord) {
        // Find yuki in the text and extract query.
        const parts = cleaned.split(/\byuki\b/i);
        const before = parts[0].trim();
        const after = parts[1] ? parts[1].trim() : "";

        if (after) {
          queryText = after;
        } else if (before) {
          queryText = before;
        } else {
          queryText = "Yuki";
        }
      }

      // If they just said "yuki" without a query, trigger a greeting
      if (queryText.toLowerCase().trim() === "yuki") {
        logSTTStatus("Trigger word 'Yuki' detected with no additional content. Sending greeting.");
        sendMessageText("Yuki", sttTimeMs);
        return;
      }

      // Check if instructions start with "command" or "slash" (with phonetic fallbacks)
      const cmdMatch = queryText.match(/^(command|slash|come\s+on|c'mon|common|flash)\s+(.*)/i);
      if (cmdMatch) {
        const remaining = cmdMatch[2].trim();
        const firstWord = remaining.split(/\s+/)[0].toLowerCase();
        const possibleSlashCmd = "/" + firstWord;

        // Only convert to slash command if it is a registered local command
        const commandExists = SLASH_COMMANDS.some(c => c.cmd.toLowerCase() === possibleSlashCmd);

        if (commandExists) {
          const commandText = "/" + remaining;
          sendMessageText(commandText, sttTimeMs);
        } else {
          // If the command does not exist, send the remaining query to the LLM (stripping the "command/slash" prefix)
          sendMessageText(remaining, sttTimeMs);
        }
      } else {
        sendMessageText(queryText, sttTimeMs);
      }
      return;
    }

    // Allow user to exit Talk Mode by saying "stop"
    if (isTalkModeRef.current && (lower === 'stop' || lower === 'stop listening' || lower === 'exit' || lower === 'quit')) {
      logSTTStatus("Exit talk mode command detected.");
      isTalkModeRef.current = false;
      setIsTalkMode(false);
      stopSpeechRecognition();
      setIsListening(false);

      setIsThinking(false);
      setTtsStreamActive(false);
      return;
    }

    // Clean interruption: stop playback immediately before sending prompt
    stopAllPlayback();
    sendMessageText(transcript, sttTimeMs);
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
      isSpeechRecActiveRef.current = true;
      setIsListening(true);
      console.log("[STT] Speech recognition active.");
    };

    rec.onspeechstart = () => {
      if (sessionTimeoutRef.current) {
        console.log("[STT] Native speechstart detected. Clearing 8s session timeout.");
        clearTimeout(sessionTimeoutRef.current);
        sessionTimeoutRef.current = null;
      }
    };

    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      processSTTTranscript(transcript);
    };

    rec.onerror = (event) => {
      if (event.error === 'aborted') {
        console.log("[STT] Session aborted silently.");
        return;
      }

      console.warn("[STT] Speech recognition error:", event.error);
      setIsListening(false);

      if (event.error === 'no-speech') {
        return;
      }

      let errMsg = "System Notice: Speech recognition encountered an error ('" + event.error + "').";
      if (event.error === 'not-allowed') {
        errMsg = "System Notice: Microphone access is blocked. Please click the camera/mic icon in your browser address bar and choose 'Allow'.";
        isTalkModeRef.current = false;
        setIsTalkMode(false);
        isVoiceCommandModeRef.current = false;
        setIsVoiceCommandMode(false);
      } else if (event.error === 'network') {
        errMsg = "System Notice: Speech recognition network error. Please check your internet connectivity.";
      }
      setMessages((prev) => [...prev, { role: 'system', content: errMsg }]);
    };

    rec.onend = () => {
      console.log("[STT] Speech recognition session ended.");
      isSpeechRecActiveRef.current = false;
      setIsListening(false);

      // If we still want to be listening, schedule a retry.
      if (shouldListen()) {
        setTimeout(() => {
          if (shouldListen()) {
            startSpeechRecognition();
          }
        }, 300); // Small cool-down
      }
    };

    recognitionRef.current = rec;
  };

  const toggleTalkMode = async () => {
    initAudioAnalyser();

    if (!useLocalWhisperRef.current) {
      if (!recognitionRef.current) {
        initSpeechRecognition();
      }

      if (!recognitionRef.current) {
        alert("Voice speech recognition is only supported in Chrome or Chromium-based browsers like Edge.");
        return;
      }
    }

    if (isVoiceCommandModeRef.current) {
      isVoiceCommandModeRef.current = false;
      setIsVoiceCommandMode(false);
      clearContinuedConversationSession();
    }

    if (isTalkModeRef.current) {
      isTalkModeRef.current = false;
      setIsTalkMode(false);
      clearContinuedConversationSession();
      stopAllPlayback();
      console.log("Talk Mode: OFF");
    } else {
      clearContinuedConversationSession();
      stopAllPlayback();
      isTalkModeRef.current = true;
      setIsTalkMode(true);
      console.log("Talk Mode: ON");
      updateListeningState();
    }
  };

  const toggleListening = toggleTalkMode;

  const toggleVoiceCommandMode = async () => {
    initAudioAnalyser();

    if (!useLocalWhisperRef.current) {
      if (!recognitionRef.current) {
        initSpeechRecognition();
      }

      if (!recognitionRef.current) {
        alert("Voice speech recognition is only supported in Chrome or Chromium-based browsers like Edge.");
        return;
      }
    }

    if (isTalkModeRef.current) {
      isTalkModeRef.current = false;
      setIsTalkMode(false);
    }

    if (isVoiceCommandModeRef.current) {
      isVoiceCommandModeRef.current = false;
      setIsVoiceCommandMode(false);
      clearContinuedConversationSession();
      stopAllPlayback();
      console.log("Voice Command Mode: OFF");

      setMessages((prev) => [...prev, { role: 'assistant', content: "listening mode off" }]);
      speakSystemMessage("Listening mode off.");
    } else {
      clearContinuedConversationSession();
      stopAllPlayback();
      isVoiceCommandModeRef.current = true;
      setIsVoiceCommandMode(true);
      console.log("Voice Command Mode: ON");
      updateListeningState();
    }
  };

  const toggleVoiceCommandModeRef = useRef(toggleVoiceCommandMode);
  useEffect(() => {
    toggleVoiceCommandModeRef.current = toggleVoiceCommandMode;
  });

  // Listen for global recall/trigger shortcut Alt+S from Electron main process
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onTriggerListening) {
      const unsubscribe = window.electronAPI.onTriggerListening(() => {
        console.log(`[Hotkey] Alt+S triggered! Synchronizing chat overlay and listening mode.`);

        setIsChatOpen(prevChatOpen => {
          const nextChatState = !prevChatOpen;

          // Toggle Voice Command Mode based on nextChatState and hotkeyListening checkbox
          if (hotkeyListeningRef.current) {
            if (nextChatState) {
              // Turning chat ON -> ensure Voice Command Mode is ON
              if (!isVoiceCommandModeRef.current) {
                toggleVoiceCommandModeRef.current();
              }
            } else {
              // Turning chat OFF -> ensure Voice Command Mode is OFF
              if (isVoiceCommandModeRef.current) {
                toggleVoiceCommandModeRef.current();
              }
            }
          } else {
            // If hotkey listening is disabled, still ensure Voice Command Mode is OFF when closing chat
            if (!nextChatState && isVoiceCommandModeRef.current) {
              toggleVoiceCommandModeRef.current();
            }
          }

          return nextChatState;
        });
      });
      return unsubscribe;
    }
  }, []);

  // Listen for Escape key to close settings or chat overlay
  useEffect(() => {
    const handleKeyDown = (e) => {
      const modal = confirmModalRef.current;
      if (modal && modal.visible) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          modal.onConfirm?.();
          return;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          modal.onCancel?.();
          return;
        }
      }

      if (e.key === 'Escape') {
        let handled = false;

        // 1. If settings is open, close it
        if (isSettingsOpenRef.current) {
          setIsSettingsOpen(false);
          document.activeElement?.blur();
          handled = true;
        }
        // 2. If chat overlay is open, close/toggle it off
        else if (isChatOpenRef.current) {
          setIsChatOpen(false);
          document.activeElement?.blur();
          // Ensure voice listening is turned off when closing chat
          if (isVoiceCommandModeRef.current) {
            toggleVoiceCommandModeRef.current();
          }
          handled = true;
        }

        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const getWhisperModelSizeText = (modelType) => {
    const computeType = profile.settings?.whisper_compute_type || 'int8_float16';
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

  // Extracted message routing core (used by both input bar submit and voice commands)
  const sendMessageText = (text, sttTimeMs = null, fromSuggestion = false) => {
    if (!text.trim()) return;

    logSTTStatus(`sendMessageText: "${text}" (sttTimeMs: ${sttTimeMs})`);
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
      logSTTStatus(`WebSocket offline, cannot send message. ReadyState: ${socketRef.current ? socketRef.current.readyState : 'null'}`);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Hmph! I'm currently offline, Master. Make sure the backend server is running!" }
      ]);
      setIsThinking(false);
      setTtsStreamActive(false);
      updateListeningState();
    }
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
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    ttsStreamActiveRef.current = false;
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

  const fetchHealthDetails = async () => {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) {
        const data = await response.json();
        setModelName(data.model);
        setLmstudioUrl(data.lm_base_url || data.lmstudio_url);
        if (data.llm_backend) setLlmBackend(data.llm_backend);
      }
    } catch (e) {
      console.warn("Could not load active LLM model from health API:", e);
    }
  };

  const fetchLlmModels = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/models`);
      if (response.ok) {
        const data = await response.json();
        if (data.models && data.models.length > 0) {
          setAvailableLlmModels(data.models);
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

    // Periodic health check — catches dead connections that WS onclose misses
    healthCheckIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            setBackendStatus('online');
          }
        } else {
          setBackendStatus('offline');
        }
      } catch {
        setBackendStatus('offline');
      }
    }, 30000);

    return () => {
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
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
      <div className="app-viewport" style={{
        '--avatar-scale': avatarScale,
        '--avatar-button-scale': avatarScale < 1.0 ? avatarScale : 1.0 + (avatarScale - 1.0) * 0.25
      }}>
        {/* Main 3D Canvas Body */}
        <main className="canvas-container">
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
                                  background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                                  cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '0.7rem',
                                }}>&times;</button>
                              </span>
                            ))}
                          </div>
                        )}
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
                          <option value="gpu" style={{ background: '#120c21', color: 'white' }}>GPU (CUDA / DirectML)</option>
                          <option value="cpu" style={{ background: '#120c21', color: 'white' }}>CPU (Force CPU)</option>
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
                            onChange={(e) => handleUpdateSetting('no_llm_mode', e.target.checked)}
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
                          onChange={(e) => {
                            handleUpdateSetting('llm_backend', e.target.value);
                            setLlmBackend(e.target.value);
                          }}
                          style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        >
                          <option value="lmstudio">LM Studio (Local)</option>
                          <option value="ollama">Ollama (Local)</option>
                          <option value="openai">OpenAI-Compatible (Cloud)</option>
                          <option value="custom">Custom Endpoint</option>
                        </select>
                      </div>

                      {/* Base URL (for Ollama / OpenAI / Custom) */}
                      {llmBackend !== 'lmstudio' && (
                        <div className="desktop-form-group">
                          <label className="desktop-label">
                            {llmBackend === 'ollama' ? 'Ollama URL' : llmBackend === 'openai' ? 'API Base URL' : 'Endpoint URL'}
                          </label>
                          <input
                            type="text"
                            className="desktop-input"
                            placeholder={
                              llmBackend === 'ollama' ? 'http://127.0.0.1:11434' :
                                llmBackend === 'openai' ? 'https://api.groq.com/openai' :
                                  'http://127.0.0.1:8000/v1'
                            }
                            value={profile.settings?.llm_base_url || ''}
                            onChange={(e) => handleUpdateSetting('llm_base_url', e.target.value)}
                            style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                          />
                        </div>
                      )}

                      {/* API Key (for OpenAI-compatible / Custom with auth) */}
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
                          {availableLlmModels.length === 0 ? (
                            <option value={profile.settings?.llm_model || ''} style={{ background: '#120c21', color: 'white' }}>
                              {profile.settings?.llm_model || 'Loading models...'}
                            </option>
                          ) : (
                            availableLlmModels.map((model) => (
                              <option key={model.name} value={model.name} style={{ background: '#120c21', color: 'white' }}>
                                {model.name}
                              </option>
                            ))
                          )}
                        </select>
                      </div>
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
        isThinking={isThinking || ttsStreamActive}
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
      />

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
