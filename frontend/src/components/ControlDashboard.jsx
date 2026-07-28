import React, { useState, useEffect, useRef } from 'react';
import { Settings, Cpu, HardDrive, User, Database, Trash2, RefreshCw, ChevronDown, CheckCircle, Zap, Volume2, VolumeX, UserCheck, Plus, Trash, Mic, Upload, Monitor, Sparkles, Brain, Palette, MessageSquare, Clock, Power, Sliders, BellOff, Layout, Play, Square, Music, Eye } from 'lucide-react';
import { API_BASE } from '../api';
import { ANIMATIONS } from '../animationsRegistry';
import { ALARM_TONE_PRESETS, playPresetChime } from '../utils/toneSynthesizer';
import MicLevelMeter from './MicLevelMeter';

const SKIN_PRESETS = [
  { name: 'Original', value: '#ffffff' },
  { name: 'Fair', value: '#FFE5E5' },
  { name: 'Tan', value: '#d89c7b' },
  { name: 'Bronze', value: '#a3654a' },
  { name: 'Cocoa', value: '#593424' }
];

const ControlDashboard = ({
  profile,
  backendStatus,
  onResetProfile,
  modelName,
  lmstudioUrl,
  onProfileUpdate,
  skinToneColor = '#FFE5E5',
  onSkinToneChange,
  cameraTracking = true,
  onCameraTrackingChange,
  disabledAnimations = [],
  onToggleAnimation,
  micDevices = [],
  selectedMicDeviceId = '',
  onMicDeviceChange,
  onRefreshMicDevices,
  vadThreshold = 0.01,
  onVadThresholdChange,
  muteVoice = false,
  onMuteVoiceChange,
  voiceVolume = 1.0,
  onVoiceVolumeChange,
  availableLlmModels = [],
  onRefreshLlmModels,
  preferHeadsetMic = false,
  onPreferHeadsetMicChange,
  hostPlatform = 'Unknown',
  avatarScale,
  onAvatarScaleChange,
  initialTab = 'memory',
  isStandalone = false
}) => {
  const [isOpen, setIsOpen] = useState(isStandalone ? true : false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [settingsSubTab, setSettingsSubTab] = useState('general'); // 'general' | 'avatar' | 'voice' | 'brain'

  const [isDevEnv, setIsDevEnv] = useState(false);
  // Alarm Tone Preview & Custom Audio State
  const [isPlayingToneTest, setIsPlayingToneTest] = useState(false);
  const testAudioRef = useRef(null);
  const testIntervalRef = useRef(null);
  const testCtxRef = useRef(null);
  const [isUploadingTone, setIsUploadingTone] = useState(false);

  const stopToneTest = () => {
    if (testIntervalRef.current) {
      clearInterval(testIntervalRef.current);
      testIntervalRef.current = null;
    }
    if (testCtxRef.current) {
      testCtxRef.current.close().catch(() => {});
      testCtxRef.current = null;
    }
    if (testAudioRef.current) {
      testAudioRef.current.pause();
      testAudioRef.current = null;
    }
    setIsPlayingToneTest(false);
  };

  const handleTestTone = (toneIdOverride) => {
    if (isPlayingToneTest) {
      stopToneTest();
      return;
    }

    const currentTone = toneIdOverride || settings.alarm_tone || 'pulse_chime';
    const customFile = settings.custom_alarm_tone_file || '';

    setIsPlayingToneTest(true);

    if (currentTone === 'custom' && customFile) {
      try {
        const audioUrl = `${API_BASE}/api/settings/alarm-tone/file/${encodeURIComponent(customFile)}`;
        const audio = new Audio(audioUrl);
        audio.play().catch(e => {
          console.warn("Failed to test play custom tone:", e);
          stopToneTest();
        });
        audio.onended = () => stopToneTest();
        testAudioRef.current = audio;
      } catch (e) {
        stopToneTest();
      }
    } else {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          testCtxRef.current = ctx;
          playPresetChime(currentTone, ctx);
          testIntervalRef.current = setInterval(() => playPresetChime(currentTone, ctx), 1200);

          setTimeout(() => {
            stopToneTest();
          }, 4000);
        }
      } catch (e) {
        stopToneTest();
      }
    }
  };

  const handleUploadCustomTone = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingTone(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/api/settings/alarm-tone/upload`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        if (onProfileUpdate) onProfileUpdate();
      } else {
        const errText = await res.text();
        alert(`Failed to upload audio tone: ${errText}`);
      }
    } catch (err) {
      console.error("Tone upload failed:", err);
      alert("Error uploading tone file.");
    } finally {
      setIsUploadingTone(false);
    }
  };


  // Avatar scale size state — prefer persisted localStorage value over prop
  const [localAvatarScale, setLocalAvatarScale] = useState(() => {
    try {
      const saved = localStorage.getItem('yuki-avatar-scale');
      return saved ? parseFloat(saved) : (avatarScale || 1.0);
    } catch { return avatarScale || 1.0; }
  });

  useEffect(() => {
    if (avatarScale !== undefined && avatarScale !== null) {
      setLocalAvatarScale(avatarScale);
    }
  }, [avatarScale]);

  const handleAvatarScaleChange = (val) => {
    setLocalAvatarScale(val);
    try { localStorage.setItem('yuki-avatar-scale', val.toString()); } catch {}
    if (onAvatarScaleChange) onAvatarScaleChange(val);
    if (window.electronAPI && window.electronAPI.setWindowScale) {
      if (window._scaleTimer) clearTimeout(window._scaleTimer);
      window._scaleTimer = setTimeout(() => {
        window.electronAPI.setWindowScale(val);
      }, 50);
    }
  };

  // Camera tracking toggle state (persisted via localStorage in AvatarViewer)
  const [localCameraTracking, setLocalCameraTracking] = useState(() => {
    try { return localStorage.getItem('yuki-camera-tracking') !== 'false'; } catch { return true; }
  });

  const [customSkinColor, setCustomSkinColor] = useState(() => {
    try { return localStorage.getItem('yuki-custom-skintone-color') || '#e0ac69'; } catch { return '#e0ac69'; }
  });

  // Model selector state removed

  // Settings State
  const [settings, setSettings] = useState({
    llm_model: '',
    llm_backend: 'lmstudio',
    llm_base_url: '',
    llm_api_key: '',
    tts_voice: 'af_bella',
    tts_rate: '1.0',
    tts_device: 'auto',
    stt_device: 'auto',
    character_name: 'Yuki',
    character_persona: '',
    crawler_paused: false,
    tagger_paused: false,
    active_vrm_model: 'default.vrm',
    whisper_model: 'base',
    use_local_whisper: true,
    stt_language: 'en'
  });

  // Local Character States
  const [charName, setCharName] = useState('Yuki');
  const [charPersona, setCharPersona] = useState('');

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
  const [gpuMemData, setGpuMemData] = useState({ gpus: [], top5: {} });

  // Sync character local states when settings change
  useEffect(() => {
    if (settings.character_name) {
      setCharName(settings.character_name);
    }
    if (settings.character_persona) {
      setCharPersona(settings.character_persona);
    }
  }, [settings]);

  // Profile Edit State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [newInterestText, setNewInterestText] = useState('');

  // Custom Facts Edit State
  const [isAddingFact, setIsAddingFact] = useState(false);
  const [newFactKey, setNewFactKey] = useState('');
  const [newFactVal, setNewFactVal] = useState('');
  const [editingFactKey, setEditingFactKey] = useState(null);
  const [editingFactValue, setEditingFactValue] = useState('');
  const [newHobbyText, setNewHobbyText] = useState('');
  const [newLikeText, setNewLikeText] = useState('');
  const [newDislikeText, setNewDislikeText] = useState('');

  // LLM Dynamic Tools State
  const [toolsList, setToolsList] = useState([]);
  const [expandedTool, setExpandedTool] = useState(null);
  const [toolSearch, setToolSearch] = useState('');

  // Custom LLM Endpoints & Presets State
  const [customLabel, setCustomLabel] = useState('');
  const [savedCustomEndpoints, setSavedCustomEndpoints] = useState([]);
  const [saveEndpointBtnText, setSaveEndpointBtnText] = useState('Save Endpoint Preset');

  const fetchSavedEndpoints = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.endpoints) {
          setSavedCustomEndpoints(data.endpoints);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch custom endpoints:", e);
    }
  };

  const autoSuggestLabel = (url) => {
    if (!url) return '';
    const u = url.toLowerCase().trim();
    if (u.includes('googleapis') || u.includes('gemini')) return 'Google Gemini Cloud';
    if (u.includes('x.ai') || u.includes('grok')) return 'xAI Grok Cloud';
    if (u.includes('openai.com')) return 'OpenAI Cloud API';
    if (u.includes('openrouter')) return 'OpenRouter Cloud API';
    if (u.includes('groq.com')) return 'Groq Cloud API';
    if (u.includes('mistral.ai')) return 'Mistral Cloud API';
    if (u.includes('together')) return 'Together AI Cloud';
    if (u.includes('deepseek')) return 'DeepSeek Cloud';
    if (u.includes('1234') || u.includes('lmstudio')) return 'Local LM Studio';
    if (u.includes('11434') || u.includes('ollama')) return 'Local Ollama';
    try {
      const host = new URL(url).hostname;
      return `Custom API (${host})`;
    } catch {
      return 'Custom LLM Endpoint';
    }
  };

  const handleSaveCustomEndpoint = async () => {
    const labelToSave = customLabel.trim() || autoSuggestLabel(settings.llm_base_url) || 'Custom LLM Endpoint';
    const baseUrlToSave = settings.llm_base_url || '';
    if (!baseUrlToSave) {
      alert("Please enter a valid Endpoint Base URL before saving.");
      return;
    }
    setSaveEndpointBtnText("Saving...");
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: labelToSave,
          base_url: baseUrlToSave,
          api_key: settings.llm_api_key || '',
          llm_backend: settings.llm_backend || 'openai',
          model: settings.llm_model || ''
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSavedCustomEndpoints(data.endpoints || []);
        setCustomLabel(labelToSave);
        setSaveEndpointBtnText("✓ Saved to DB (Encrypted)");
        setTimeout(() => setSaveEndpointBtnText('Save Endpoint Preset'), 2500);
      } else {
        setSaveEndpointBtnText("Save Failed");
        setTimeout(() => setSaveEndpointBtnText('Save Endpoint Preset'), 2000);
      }
    } catch (e) {
      console.error("Failed to save custom endpoint:", e);
      setSaveEndpointBtnText("Error Saving");
      setTimeout(() => setSaveEndpointBtnText('Save Endpoint Preset'), 2000);
    }
  };

  const handleDeleteCustomEndpoint = async (epId, epLabel) => {
    if (!confirm(`Delete saved endpoint "${epLabel}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: epId, label: epLabel })
      });
      if (res.ok) {
        const data = await res.json();
        setSavedCustomEndpoints(data.endpoints || []);
        if (customLabel === epLabel) setCustomLabel('');
      }
    } catch (e) {
      console.error("Failed to delete custom endpoint:", e);
    }
  };

  // Internal Mood Spectrum State
  const [moodData, setMoodData] = useState({
    happiness: 75,
    energy: 65,
    curiosity: 80,
    affection: 70,
    stress_level: 15,
    doomer: 20,
    hunger: 30,
    horniness: 50
  });

  const fetchMood = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/mood`);
      if (res.ok) {
        const data = await res.json();
        setMoodData(data);
      }
    } catch (e) {
      console.warn("Could not fetch mood spectrum:", e);
    }
  };

  const handleUpdateMood = async (key, val) => {
    const newMood = { ...moodData, [key]: val };
    setMoodData(newMood);
    try {
      await fetch(`${API_BASE}/api/mood/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [key]: val } })
      });
    } catch (e) {
      console.error("Failed to update mood:", e);
    }
  };

  const handleResetMood = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/mood/reset`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setMoodData(data.mood);
      }
    } catch (e) {
      console.error("Failed to reset mood:", e);
    }
  };

  // Active Time Items State (Timers, Reminders, Stopwatches)
  const [timeItems, setTimeItems] = useState({ reminders: [], stopwatches: [] });

  const fetchTimeItems = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/reminders/active`);
      if (res.ok) {
        const data = await res.json();
        setTimeItems(data);
      }
    } catch (e) {
      console.warn("Could not fetch active time items:", e);
    }
  };

  const handleCancelReminder = async (id) => {
    try {
      await fetch(`${API_BASE}/api/reminders/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      fetchTimeItems();
    } catch (e) {
      console.error("Failed to cancel reminder:", e);
    }
  };

  // Inline edit state for reminders/timers (replaces broken window.prompt)
  const [editingItem, setEditingItem] = useState(null); // { id, message }

  const handleEditReminder = (id, currentMessage) => {
    setEditingItem({ id, message: currentMessage });
  };

  const handleSaveEditReminder = async () => {
    if (!editingItem || !editingItem.message.trim()) return;
    try {
      await fetch(`${API_BASE}/api/reminders/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingItem.id, message: editingItem.message.trim() })
      });
      fetchTimeItems();
    } catch (e) {
      console.error('Failed to edit reminder:', e);
    }
    setEditingItem(null);
  };

  // Task UI Inputs State
  const [timerMsgInput, setTimerMsgInput] = useState('');
  const [timerDurInput, setTimerDurInput] = useState('');
  const [stopwatchLabelInput, setStopwatchLabelInput] = useState('');

  // Specific Date & Time Alarm Input State
  const [alarmDateInput, setAlarmDateInput] = useState('');
  const [alarmTimeInput, setAlarmTimeInput] = useState('');
  const [alarmMsgInput, setAlarmMsgInput] = useState('');

  // OS Native Alarms Toggle State (synced via backend profile settings)
  const osNativeAlarms = settings?.os_native_alarms !== false;

  const handleToggleOsNativeAlarms = async (val) => {
    try { localStorage.setItem('yuki-os-native-alarms', val.toString()); } catch {}
    await handleUpdateSetting('os_native_alarms', val);
  };

  const handleCreateTimerUI = async () => {
    if (!timerDurInput.trim()) return;
    try {
      await fetch(`${API_BASE}/api/reminders/create_timer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: timerMsgInput.trim() || 'Timer Up!', duration_str: timerDurInput.trim() })
      });
      setTimerMsgInput('');
      setTimerDurInput('');
      fetchTimeItems();
    } catch (e) {
      console.error("Failed to create timer:", e);
    }
  };

  const handleCreateDatetimeAlarmUI = async () => {
    if (!alarmDateInput || !alarmTimeInput) return;
    try {
      await fetch(`${API_BASE}/api/reminders/create_datetime_alarm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date_str: alarmDateInput,
          time_str: alarmTimeInput,
          message: alarmMsgInput.trim() || 'Alarm!'
        })
      });
      setAlarmDateInput('');
      setAlarmTimeInput('');
      setAlarmMsgInput('');
      fetchTimeItems();
    } catch (e) {
      console.error("Failed to schedule datetime alarm:", e);
    }
  };

  const handleStartStopwatchUI = async (labelOverride) => {
    const lbl = labelOverride || stopwatchLabelInput.trim() || 'gaming';
    try {
      await fetch(`${API_BASE}/api/reminders/stopwatch/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: lbl })
      });
      setStopwatchLabelInput('');
      fetchTimeItems();
      if (window.electronAPI && window.electronAPI.openStopwatchWindow) {
        window.electronAPI.openStopwatchWindow({ label: lbl });
      }
    } catch (e) {
      console.error("Failed to start stopwatch:", e);
    }
  };

  const handleStopStopwatchUI = async (lbl) => {
    try {
      await fetch(`${API_BASE}/api/reminders/stopwatch/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: lbl })
      });
      fetchTimeItems();
    } catch (e) {
      console.error("Failed to stop stopwatch:", e);
    }
  };

  const handleDeleteStopwatchUI = async (lbl) => {
    try {
      await fetch(`${API_BASE}/api/reminders/stopwatch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: lbl })
      });
      fetchTimeItems();
    } catch (e) {
      console.error("Failed to delete stopwatch:", e);
    }
  };

  useEffect(() => {
    let interval = null;
    if (isOpen) {
      if (activeTab === 'brain') {
        fetch(`${API_BASE}/api/tools`)
          .then(res => res.json())
          .then(data => {
            if (data && data.tools) {
              setToolsList(data.tools);
            }
          })
          .catch(err => console.error("Failed to fetch tools list:", err));
        fetchSavedEndpoints();
      }

      if (activeTab === 'memory') {
        fetchMood();
        if (onProfileUpdate) {
          onProfileUpdate();
        }
      }

      if (activeTab === 'reminders') {
        fetchTimeItems();
      }

      interval = setInterval(() => {
        if (activeTab === 'memory') {
          fetchMood();
          if (onProfileUpdate) {
            onProfileUpdate();
          }
        } else if (activeTab === 'reminders') {
          fetchTimeItems();
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOpen, activeTab]);

  const interests = profile.user_interests || [];
  const hobbies = profile.user_hobbies || [];
  const likes = profile.user_likes || [];
  const dislikes = profile.user_dislikes || [];
  const customFacts = profile.custom_facts || {};



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
    { label: 'Normal (1.0x)', value: '1.0' },
    { label: 'Snappy (1.1x)', value: '1.1' },
    { label: 'Fast (1.2x)', value: '1.2' },
    { label: 'Faster (1.4x)', value: '1.4' },
  ];



  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || data);
      }
    } catch (e) {
      console.warn('Could not fetch settings:', e);
    }
  };

  const handleUpdateSetting = async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    try {
      const res = await fetch(`${API_BASE}/api/settings/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.settings) {
          setSettings(data.settings);
        }
      }
    } catch (e) {
      console.error('Failed to update setting:', e);
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

  const handleToggleCrawlerStatus = async () => {
    const nextPausedValue = !crawlerStatus.paused;
    setCrawlerStatus(prev => ({ ...prev, paused: nextPausedValue }));
    try {
      const res = await fetch(`${API_BASE}/api/settings/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crawler_paused: nextPausedValue }),
      });
      if (res.ok) {
        const data = await res.json();
        setCrawlerStatus(prev => ({
          ...prev,
          paused: data.settings.crawler_paused,
          tagger_paused: data.settings.tagger_paused
        }));
        setSettings(data.settings);
      }
    } catch (e) {
      console.error('Failed to update crawler pause state:', e);
    }
  };

  const handleToggleTaggerStatus = async () => {
    const nextPausedValue = !crawlerStatus.tagger_paused;
    setCrawlerStatus(prev => ({ ...prev, tagger_paused: nextPausedValue }));
    try {
      const res = await fetch(`${API_BASE}/api/settings/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagger_paused: nextPausedValue }),
      });
      if (res.ok) {
        const data = await res.json();
        setCrawlerStatus(prev => ({
          ...prev,
          paused: data.settings.crawler_paused,
          tagger_paused: data.settings.tagger_paused
        }));
        setSettings(data.settings);
      }
    } catch (e) {
      console.error('Failed to update tagger pause state:', e);
    }
  };

  const handleTriggerRecrawl = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/crawler/recrawl`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchCrawlerStatus();
      }
    } catch (e) {
      console.error('Failed to trigger recrawl:', e);
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
        if (onProfileUpdate) {
          onProfileUpdate(data.profile);
        }
      }
    } catch (e) {
      console.error('Failed to update profile:', e);
    }
  };

  const handleSaveName = async () => {
    if (!editedName.trim()) return;
    await handleUpdateProfile({ user_name: editedName.trim() });
    setIsEditingName(false);
  };

  const handleAddInterest = async (e) => {
    if (e.key === 'Enter' || e.type === 'click') {
      e.preventDefault();
      if (!newInterestText.trim()) return;
      if (interests.includes(newInterestText.trim())) return;
      const updatedInterests = [...interests, newInterestText.trim()];
      await handleUpdateProfile({ user_interests: updatedInterests });
      setNewInterestText('');
    }
  };

  const handleRemoveInterest = async (interestToRemove) => {
    const updatedInterests = interests.filter(i => i !== interestToRemove);
    await handleUpdateProfile({ user_interests: updatedInterests });
  };

  const handleDeleteFact = async (factKey) => {
    const updatedFacts = { ...customFacts };
    delete updatedFacts[factKey];
    await handleUpdateProfile({ custom_facts: updatedFacts });
  };

  const handleAddFact = async (e) => {
    e.preventDefault();
    if (!newFactKey.trim() || !newFactVal.trim()) return;
    const updatedFacts = { ...customFacts, [newFactKey.trim()]: newFactVal.trim() };
    await handleUpdateProfile({ custom_facts: updatedFacts });
    setNewFactKey('');
    setNewFactVal('');
    setIsAddingFact(false);
  };

  const handleStartEditFact = (key, val) => {
    setEditingFactKey(key);
    setEditingFactValue(val);
  };

  const handleSaveFact = async (key) => {
    const updatedFacts = { ...customFacts, [key]: editingFactValue.trim() };
    await handleUpdateProfile({ custom_facts: updatedFacts });
    setEditingFactKey(null);
    setEditingFactValue('');
  };

  const [vrmModels, setVrmModels] = useState(['default.vrm']);
  const [vrmCustomModels, setVrmCustomModels] = useState([]);
  const [vrmUploading, setVrmUploading] = useState(false);

  const fetchVrmModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/models/vrm`);
      if (res.ok) {
        const data = await res.json();
        if (data.models) {
          setVrmModels(data.models);
        }
        if (data.custom) {
          setVrmCustomModels(data.custom);
        }
      }
    } catch (e) {
      console.warn('Could not fetch VRM models:', e);
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
        if (settings.active_vrm_model === name) {
          handleUpdateSetting('active_vrm_model', 'default.vrm');
        }
        await fetchVrmModels();
      }
    } catch (e) {
      console.warn('Could not delete VRM model:', e);
    }
  };

  // Fetch settings / crawler status on open & handle crawler polling
  useEffect(() => {
    let interval = null;
    if (isOpen) {
      fetchVrmModels();
      if (activeTab === 'crawler') {
        fetchCrawlerStatus();
        interval = setInterval(fetchCrawlerStatus, 2500);
      } else if (activeTab === 'config') {
        fetchGpuMem();
        interval = setInterval(fetchGpuMem, 5000);
      } else {
        fetchSettings();
      }
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOpen, activeTab]);

  return (
    <>
      {/* Settings Toggle Trigger Button (Top-Right Corner) */}
      {!isStandalone && (
        <div className="dashboard-trigger-top">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={`trigger-gear-btn glass-panel ${isOpen ? 'active' : ''}`}
            title="Yuki Settings & Memory"
          >
            <Settings className={`w-5 h-5 ${isOpen ? 'rotate-45' : ''}`} style={{ transition: 'transform 0.3s' }} />
          </button>
        </div>
      )}

      {/* Settings Panel */}
      <div
        className={`slide-panel-left glass-panel ${isStandalone ? 'standalone-panel' : ''}`}
        style={isStandalone ? {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100vh',
          transform: 'none',
          opacity: 1,
          borderRadius: 0,
          padding: '24px 36px',
          boxSizing: 'border-box',
          overflowY: 'auto'
        } : {
          transform: isOpen ? 'translateX(0)' : 'translateX(calc(-100% - 24px))',
          opacity: isOpen ? 1 : 0
        }}
      >
        {/* Header */}
        <div className="panel-header">
          <div className="panel-title-wrapper">
            <Database className="w-5 h-5 text-teal-400" />
            <div>
              <h3 className="panel-title" style={{ fontSize: '0.85rem' }}>System Core & Memory</h3>
              <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-muted)' }}>Yuki Brain Module Settings</p>
            </div>
          </div>
        </div>

        {/* Connection Status Widget */}
        <div className="dashboard-stats-row">
          <div className="stat-widget">
            <span className="stat-label">Brain Connection</span>
            <div className="stat-value-wrapper">
              <span className={`status-dot ${backendStatus === 'online' ? 'online breathing' : 'offline'}`}></span>
              <span className="stat-value">{backendStatus}</span>
            </div>
          </div>
          <div className="stat-widget">
            <span className="stat-label">Interactions</span>
            <span className="stat-value">{profile.interaction_count || 0} cycles</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="tab-nav-bar">
          <button
            onClick={() => setActiveTab('memory')}
            className={`tab-btn ${activeTab === 'memory' ? 'active' : ''}`}
          >
            Persona
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            className={`tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
          >
            Tasks
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          >
            Settings
          </button>
          <button
            onClick={() => setActiveTab('crawler')}
            className={`tab-btn ${activeTab === 'crawler' ? 'active' : ''}`}
          >
            Crawler
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
          >
            Info
          </button>
        </div>

        {/* Tab Contents */}
        <div className="tab-panel-body">
          {activeTab === 'memory' ? (
            <>
              {/* Internal Mood & Psychological Spectrum Card */}
              <div className="card-group" style={{ marginBottom: '12px' }}>
                <div className="card-group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span className="card-group-title">Internal Mood & Psychological Spectrum</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetMood}
                    className="glass-button"
                    style={{ fontSize: '0.68rem', padding: '3px 8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer' }}
                  >
                    Reset Baselines
                  </button>
                </div>

                <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: '4px', marginBottom: '10px' }}>
                  Yuki's real-time psychological state. Injected into every turn to shape her tone, energy, and intimacy without being explicitly spoken.
                </div>

                {/* Mood Gauges Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {[
                    { key: 'happiness', label: 'Happiness', color: '#34d399', icon: '😊' },
                    { key: 'energy', label: 'Energy Level', color: '#38bdf8', icon: '⚡' },
                    { key: 'curiosity', label: 'Curiosity', color: '#a78bfa', icon: '🔍' },
                    { key: 'affection', label: 'Affection', color: '#fb7185', icon: '❤️' },
                    { key: 'stress_level', label: 'Stress Level', color: '#f59e0b', icon: '🧘' },
                    { key: 'doomer', label: 'Doomer Index', color: '#818cf8', icon: '🖤' },
                    { key: 'hunger', label: 'Hunger', color: '#fb923c', icon: '🍕' },
                    { key: 'horniness', label: 'Intimacy / Horniness', color: '#f43f5e', icon: '🔥' }
                  ].map(stat => {
                    const val = moodData[stat.key] !== undefined ? moodData[stat.key] : 50;
                    return (
                      <div key={stat.key} style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            <span style={{ marginRight: '4px' }}>{stat.icon}</span> {stat.label}
                          </span>
                          <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 600, color: stat.color }}>
                            {val}/100
                          </span>
                        </div>
                        {/* Slider */}
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={val}
                          onChange={(e) => handleUpdateMood(stat.key, parseInt(e.target.value, 10))}
                          style={{ width: '100%', accentColor: stat.color, cursor: 'pointer', height: '14px', marginTop: '4px' }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* User Identity Card */}
              <div className="card-group">
                <div className="card-group-header">
                  <User className="w-4 h-4" />
                  <span className="card-group-title">User Identity Card</span>
                </div>

                {/* Preferred Name */}
                <div className="identity-field">
                  <span className="field-label">Preferred Name</span>
                  {isEditingName ? (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <input
                        type="text"
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        className="glass-input"
                        style={{ padding: '4px 8px', fontSize: '0.85rem', flex: 1 }}
                        autoFocus
                      />
                      <button
                        onClick={handleSaveName}
                        style={{
                          background: 'var(--accent-teal)',
                          color: '#0b0813',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '4px 12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setIsEditingName(false)}
                        style={{
                          background: 'rgba(255,255,255,0.1)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '4px 12px',
                          cursor: 'pointer',
                          fontSize: '0.75rem'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                      <span className="field-val">{profile.user_name || 'Master'}</span>
                      <button
                        onClick={() => {
                          setEditedName(profile.user_name || 'Master');
                          setIsEditingName(true);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent-purple)',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
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
                  {interests.length > 0 ? (
                    <div className="interests-pill-box">
                      {interests.map((int, i) => (
                        <span key={i} className="interest-pill" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {int}
                          <button
                            onClick={() => handleRemoveInterest(int)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#fca5a5',
                              cursor: 'pointer',
                              padding: '0 2px',
                              fontSize: '11px',
                              lineHeight: 1,
                              display: 'flex',
                              alignItems: 'center'
                            }}
                            title={`Remove ${int}`}
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '4px 0' }}>
                      No interests recorded yet.
                    </span>
                  )}

                  {/* Add Interest Field */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <input
                      type="text"
                      placeholder="Add interest..."
                      value={newInterestText}
                      onChange={(e) => setNewInterestText(e.target.value)}
                      onKeyDown={handleAddInterest}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', flex: 1 }}
                    />
                    <button
                      onClick={handleAddInterest}
                      className="glass-button"
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.75rem',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* User Hobbies */}
                <div className="identity-field" style={{ marginTop: '8px' }}>
                  <span className="field-label">Hobbies</span>
                  {hobbies.length > 0 ? (
                    <div className="interests-pill-box">
                      {hobbies.map((hob, i) => (
                        <span key={i} className="interest-pill" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)' }}>
                          {hob}
                          <button
                            onClick={async () => {
                              const updatedHobbies = hobbies.filter(h => h !== hob);
                              await handleUpdateProfile({ user_hobbies: updatedHobbies });
                            }}
                            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: '0 2px', fontSize: '11px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
                            title={`Remove ${hob}`}
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '4px 0' }}>
                      No hobbies recorded yet.
                    </span>
                  )}

                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <input
                      type="text"
                      placeholder="Add hobby..."
                      value={newHobbyText}
                      onChange={(e) => setNewHobbyText(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (!newHobbyText.trim()) return;
                          if (hobbies.includes(newHobbyText.trim())) return;
                          await handleUpdateProfile({ user_hobbies: [...hobbies, newHobbyText.trim()] });
                          setNewHobbyText('');
                        }
                      }}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', flex: 1 }}
                    />
                    <button
                      onClick={async () => {
                        if (!newHobbyText.trim()) return;
                        if (hobbies.includes(newHobbyText.trim())) return;
                        await handleUpdateProfile({ user_hobbies: [...hobbies, newHobbyText.trim()] });
                        setNewHobbyText('');
                      }}
                      className="glass-button"
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.75rem',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* User Likes */}
                <div className="identity-field" style={{ marginTop: '8px' }}>
                  <span className="field-label">Likes</span>
                  {likes.length > 0 ? (
                    <div className="interests-pill-box">
                      {likes.map((like, i) => (
                        <span key={i} className="interest-pill" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                          {like}
                          <button
                            onClick={async () => {
                              const updatedLikes = likes.filter(l => l !== like);
                              await handleUpdateProfile({ user_likes: updatedLikes });
                            }}
                            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: '0 2px', fontSize: '11px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
                            title={`Remove ${like}`}
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '4px 0' }}>
                      No likes recorded yet.
                    </span>
                  )}

                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <input
                      type="text"
                      placeholder="Add thing you like..."
                      value={newLikeText}
                      onChange={(e) => setNewLikeText(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (!newLikeText.trim()) return;
                          if (likes.includes(newLikeText.trim())) return;
                          await handleUpdateProfile({ user_likes: [...likes, newLikeText.trim()] });
                          setNewLikeText('');
                        }
                      }}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', flex: 1 }}
                    />
                    <button
                      onClick={async () => {
                        if (!newLikeText.trim()) return;
                        if (likes.includes(newLikeText.trim())) return;
                        await handleUpdateProfile({ user_likes: [...likes, newLikeText.trim()] });
                        setNewLikeText('');
                      }}
                      className="glass-button"
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.75rem',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)'
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* User Dislikes */}
                <div className="identity-field" style={{ marginTop: '8px' }}>
                  <span className="field-label">Dislikes</span>
                  {dislikes.length > 0 ? (
                    <div className="interests-pill-box">
                      {dislikes.map((dis, i) => (
                        <span key={i} className="interest-pill" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(239, 68, 68, 0.2)', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
                          {dis}
                          <button
                            onClick={async () => {
                              const updatedDislikes = dislikes.filter(d => d !== dis);
                              await handleUpdateProfile({ user_dislikes: updatedDislikes });
                            }}
                            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: '0 2px', fontSize: '11px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
                            title={`Remove ${dis}`}
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '4px 0' }}>
                      No dislikes recorded yet.
                    </span>
                  )}

                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <input
                      type="text"
                      placeholder="Add thing you dislike..."
                      value={newDislikeText}
                      onChange={(e) => setNewDislikeText(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (!newDislikeText.trim()) return;
                          if (dislikes.includes(newDislikeText.trim())) return;
                          await handleUpdateProfile({ user_dislikes: [...dislikes, newDislikeText.trim()] });
                          setNewDislikeText('');
                        }
                      }}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', flex: 1 }}
                    />
                    <button
                      onClick={async () => {
                        if (!newDislikeText.trim()) return;
                        if (dislikes.includes(newDislikeText.trim())) return;
                        await handleUpdateProfile({ user_dislikes: [...dislikes, newDislikeText.trim()] });
                        setNewDislikeText('');
                      }}
                      className="glass-button"
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.75rem',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Custom Facts Log */}
              <div className="card-group">
                <div className="card-group-header teal">
                  <Database className="w-4 h-4" />
                  <span className="card-group-title">Episodic Facts</span>
                </div>

                {Object.keys(customFacts).length > 0 ? (
                  <div className="mono-logs-container">
                    {Object.entries(customFacts).map(([key, val]) => (
                      <div key={key} className="log-entry-block">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="log-entry-key" style={{ wordBreak: 'break-all', fontSize: '0.72rem' }}>{key}</span>
                          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                            {editingFactKey !== key && (
                              <button
                                onClick={() => handleStartEditFact(key, val)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--accent-purple)',
                                  cursor: 'pointer',
                                  fontSize: '10px',
                                  textDecoration: 'underline',
                                  padding: 0
                                }}
                              >
                                Edit
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteFact(key)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#f87171',
                                cursor: 'pointer',
                                fontSize: '10px',
                                textDecoration: 'underline',
                                padding: 0
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {editingFactKey === key ? (
                          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                            <input
                              type="text"
                              value={editingFactValue}
                              onChange={(e) => setEditingFactValue(e.target.value)}
                              className="glass-input"
                              style={{ padding: '4px 8px', fontSize: '0.78rem', flex: 1, fontFamily: 'monospace' }}
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveFact(key)}
                              style={{
                                background: 'var(--accent-teal)',
                                color: '#0b0813',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingFactKey(null)}
                              style={{
                                background: 'rgba(255,255,255,0.1)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                fontSize: '0.72rem',
                                cursor: 'pointer'
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <span className="log-entry-val" style={{ wordBreak: 'break-word', marginTop: '2px', fontSize: '0.75rem' }}>{val}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Yuki has not saved any persistent facts about you yet. Try telling her: "My favorite language is JavaScript" or "I am from Seattle".
                  </span>
                )}

                {/* Add Custom Fact Dialog / Button */}
                {isAddingFact ? (
                  <form onSubmit={handleAddFact} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', padding: '10px', background: 'rgba(0,0,0,0.2)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--accent-teal)', textTransform: 'uppercase' }}>Add Custom Fact</span>
                    <input
                      type="text"
                      placeholder="Fact Key (e.g. Favorite Food)"
                      value={newFactKey}
                      onChange={(e) => setNewFactKey(e.target.value)}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                      required
                    />
                    <input
                      type="text"
                      placeholder="Fact Value (e.g. Spicy Ramen)"
                      value={newFactVal}
                      onChange={(e) => setNewFactVal(e.target.value)}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                      required
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="submit"
                        style={{
                          background: 'var(--accent-teal)',
                          color: '#0b0813',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '6px 12px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          flex: 1
                        }}
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAddingFact(false)}
                        style={{
                          background: 'rgba(255,255,255,0.1)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '6px 12px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          flex: 1
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setIsAddingFact(true)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px dashed rgba(255,255,255,0.15)',
                      color: 'var(--text-muted)',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      textAlign: 'center',
                      marginTop: '4px',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={e => {
                      e.currentTarget.style.background = 'rgba(45, 212, 191, 0.05)';
                      e.currentTarget.style.color = 'white';
                      e.currentTarget.style.borderColor = 'rgba(45, 212, 191, 0.4)';
                    }}
                    onMouseOut={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      e.currentTarget.style.color = 'var(--text-muted)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                    }}
                  >
                    + Add Custom Fact
                  </button>
                )}
              </div>

              {/* Companion Character settings card group */}
              <div className="card-group" style={{ marginTop: '12px' }}>
                <div className="card-group-header">
                  <UserCheck className="w-4 h-4" />
                  <span className="card-group-title">Companion Persona Settings</span>
                </div>

                <div className="identity-field">
                  <span className="field-label">Companion Name</span>
                  <input
                    type="text"
                    value={charName}
                    onChange={(e) => setCharName(e.target.value)}
                    className="glass-input"
                    style={{ padding: '6px 10px', fontSize: '0.78rem', marginTop: '2px' }}
                  />
                </div>

                <div className="identity-field" style={{ marginTop: '4px' }}>
                  <span className="field-label">Persona Prompt Instructions</span>
                  <textarea
                    value={charPersona}
                    onChange={(e) => setCharPersona(e.target.value)}
                    className="glass-input"
                    style={{
                      padding: '8px 10px',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                      minHeight: '120px',
                      resize: 'vertical',
                      marginTop: '2px',
                      lineHeight: '1.4'
                    }}
                  />
                </div>

                <button
                  onClick={async (e) => {
                    const btn = e.currentTarget;
                    const originalText = btn.innerText;
                    const originalBg = btn.style.background;
                    btn.innerText = "Saving...";
                    await handleUpdateSetting('character_name', charName);
                    await handleUpdateSetting('character_persona', charPersona);
                    btn.innerText = "✓ Saved";
                    btn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
                    setTimeout(() => {
                      btn.innerText = originalText;
                      btn.style.background = originalBg;
                    }, 2000);
                  }}
                  className="glass-button"
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.75rem',
                    borderRadius: '10px',
                    marginTop: '4px',
                    background: 'linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)',
                    boxShadow: '0 4px 12px rgba(13,148,136,0.3)',
                  }}
                >
                  Save Character Specs
                </button>
              </div>
            </>
          ) : activeTab === 'tasks' ? (
            <>
              {/* Always-On Dual Alarm System Banner */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(56,189,248,0.15) 100%)',
                border: '1px solid rgba(16,185,129,0.4)',
                borderRadius: '14px',
                padding: '12px 16px',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <Zap className="w-5 h-5 text-emerald-400" style={{ flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>Dual Alarm System — Always Active</div>
                  <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.55)', marginTop: '3px', lineHeight: 1.5 }}>
                    <span style={{ color: '#10b981', fontWeight: 600 }}>App running:</span> Popup window + OS toast notification &nbsp;·&nbsp;
                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>App closed:</span> OS Task Scheduler fires native toast automatically
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', fontSize: '0.65rem', padding: '3px 8px', borderRadius: '8px', background: 'rgba(16,185,129,0.2)', color: '#10b981', fontWeight: 700, flexShrink: 0 }}>
                  ALWAYS ON
                </div>
              </div>

              {/* Quick Create Timer, Alarm & Stopwatch Card */}
              <div className="card-group" style={{ marginBottom: '12px' }}>
                <div className="card-group-header">
                  <Plus className="w-4 h-4 text-emerald-400" />
                  <span className="card-group-title">Create Alarm, Timer or Stopwatch</span>
                </div>

                {/* Specific Date & Time Alarm Picker */}
                <div style={{ background: 'rgba(0,0,0,0.25)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '8px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: '6px' }}>
                    ⏰ Schedule Specific Alarm (Date & Time)
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input
                      type="date"
                      value={alarmDateInput}
                      onChange={(e) => setAlarmDateInput(e.target.value)}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', width: '135px', colorScheme: 'dark' }}
                    />
                    <input
                      type="time"
                      value={alarmTimeInput}
                      onChange={(e) => setAlarmTimeInput(e.target.value)}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', width: '110px', colorScheme: 'dark' }}
                    />
                    <input
                      type="text"
                      placeholder="Label (e.g. Doctor Appt)"
                      value={alarmMsgInput}
                      onChange={(e) => setAlarmMsgInput(e.target.value)}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', flex: 1, minWidth: '120px' }}
                    />
                    <button
                      type="button"
                      onClick={handleCreateDatetimeAlarmUI}
                      className="glass-button"
                      style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', background: 'linear-gradient(135deg, #f43f5e, #e11d48)', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                    >
                      + Schedule
                    </button>
                  </div>
                </div>

                {/* Timer Creation Bar */}
                <div style={{ background: 'rgba(0,0,0,0.25)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '8px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: '6px' }}>
                    ⏱️ Set Countdown Timer
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Label (e.g. Oven)"
                      value={timerMsgInput}
                      onChange={(e) => setTimerMsgInput(e.target.value)}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', flex: 1 }}
                    />
                    <input
                      type="text"
                      placeholder="Duration (e.g. 10m, 45s)"
                      value={timerDurInput}
                      onChange={(e) => setTimerDurInput(e.target.value)}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', width: '130px' }}
                    />
                    <button
                      type="button"
                      onClick={handleCreateTimerUI}
                      className="glass-button"
                      style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {/* Stopwatch Start Bar */}
                <div style={{ background: 'rgba(0,0,0,0.25)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: '6px' }}>
                    ⏱️ Start Floating Stopwatch Window
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Label (e.g. Gaming, Coding)"
                      value={stopwatchLabelInput}
                      onChange={(e) => setStopwatchLabelInput(e.target.value)}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => handleStartStopwatchUI()}
                      className="glass-button"
                      style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                    >
                      ▶ Start
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Timers, Reminders & Stopwatches Card */}
              <div className="card-group" style={{ marginBottom: '12px' }}>
                <div className="card-group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock className="w-4 h-4 text-cyan-400" />
                    <span className="card-group-title">Active Timers, Reminders & Stopwatches</span>
                  </div>
                  <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', fontWeight: 600 }}>
                    {(timeItems.reminders || []).length + (timeItems.stopwatches || []).length} Active
                  </span>
                </div>

                <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: '4px', marginBottom: '10px' }}>
                  Live background timers, scheduled alarms, and stopwatches. Timers trigger native Windows notifications on completion.
                </div>

                {(timeItems.reminders || []).length === 0 && (timeItems.stopwatches || []).length === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', padding: '16px 0', textAlign: 'center' }}>
                    No active timers or stopwatches currently running. Ask Yuki or use the controls above to start one!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Active Timers / Reminders */}
                    {(timeItems.reminders || []).map(r => {
                      const mins = Math.floor(r.remaining_seconds / 60);
                      const secs = r.remaining_seconds % 60;
                      const timeFmt = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
                      const cat = (r.category || 'timer').toLowerCase();
                      const isAlarm = cat === 'alarm';
                      const isRem = cat === 'reminder';
                      const badgeBg = isAlarm ? 'rgba(244,63,94,0.2)' : isRem ? 'rgba(245,158,11,0.2)' : 'rgba(56,189,248,0.2)';
                      const badgeColor = isAlarm ? '#f43f5e' : isRem ? '#f59e0b' : '#38bdf8';
                      const badgeText = isAlarm ? '⏰ ALARM' : isRem ? '📌 REMINDER' : '⏱️ TIMER';

                      return (
                        <div key={r.id} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: `1px solid ${badgeColor}33`, overflow: 'hidden' }}>
                          <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.62rem', padding: '1px 6px', borderRadius: '4px', background: badgeBg, color: badgeColor, fontWeight: 700, letterSpacing: '0.5px' }}>
                                  {badgeText}
                                </span>
                                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fff' }}>{r.message}</span>
                              </div>
                              {r.action_command && (
                                <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px', fontFamily: 'monospace' }}>
                                  Command: {r.action_command}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '0.85rem', fontFamily: 'monospace', fontWeight: 600, color: badgeColor }}>
                                {timeFmt}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleEditReminder(r.id, r.message)}
                                style={{ background: 'rgba(56,189,248,0.2)', border: '1px solid rgba(56,189,248,0.4)', color: '#bae6fd', borderRadius: '6px', padding: '3px 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelReminder(r.id)}
                                style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', borderRadius: '6px', padding: '3px 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                          {/* Inline edit row — expands below the item */}
                          {editingItem?.id === r.id && (
                            <div style={{ borderTop: `1px solid ${badgeColor}33`, padding: '8px 12px', display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.2)' }}>
                              <input
                                autoFocus
                                type="text"
                                value={editingItem.message}
                                onChange={(e) => setEditingItem(prev => ({ ...prev, message: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditReminder(); if (e.key === 'Escape') setEditingItem(null); }}
                                className="glass-input"
                                style={{ flex: 1, padding: '5px 10px', fontSize: '0.78rem' }}
                              />
                              <button type="button" onClick={handleSaveEditReminder} style={{ padding: '5px 12px', fontSize: '0.72rem', borderRadius: '6px', background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Save</button>
                              <button type="button" onClick={() => setEditingItem(null)} style={{ padding: '5px 10px', fontSize: '0.72rem', borderRadius: '6px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>✕</button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Active Stopwatches */}
                    {(timeItems.stopwatches || []).map(s => (
                      <div key={s.id} style={{ background: 'rgba(0,0,0,0.25)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(167,139,250,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '0.62rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(167,139,250,0.2)', color: '#a78bfa', fontWeight: 600, textTransform: 'uppercase', marginRight: '6px' }}>
                            Stopwatch
                          </span>
                          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fff' }}>'{s.label}'</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '0.85rem', fontFamily: 'monospace', fontWeight: 600, color: '#a78bfa' }}>
                            {s.formatted_elapsed}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleStopStopwatchUI(s.label)}
                            style={{ background: 'rgba(167,139,250,0.2)', border: '1px solid rgba(167,139,250,0.4)', color: '#c084fc', borderRadius: '6px', padding: '3px 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                          >
                            Stop
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteStopwatchUI(s.label)}
                            style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', borderRadius: '6px', padding: '3px 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : activeTab === 'settings' ? (
            <>
              {/* Sub-Tabs Pill Navigation */}
              <div className="subtab-container" style={{ display: 'flex', gap: '6px', marginBottom: '16px', background: 'rgba(0,0,0,0.25)', padding: '4px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <button
                  type="button"
                  onClick={() => setSettingsSubTab('general')}
                  style={{
                    flex: 1, padding: '7px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    fontSize: '0.76rem', fontWeight: 600, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    background: settingsSubTab === 'general' ? 'linear-gradient(135deg, #8b5cf6, #d946ef)' : 'transparent',
                    color: settingsSubTab === 'general' ? '#fff' : '#94a3b8',
                    boxShadow: settingsSubTab === 'general' ? '0 0 10px rgba(139,92,246,0.3)' : 'none'
                  }}
                >
                  <Sliders style={{ width: '13px', height: '13px' }} />
                  <span>General</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsSubTab('avatar')}
                  style={{
                    flex: 1, padding: '7px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    fontSize: '0.76rem', fontWeight: 600, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    background: settingsSubTab === 'avatar' ? 'linear-gradient(135deg, #8b5cf6, #d946ef)' : 'transparent',
                    color: settingsSubTab === 'avatar' ? '#fff' : '#94a3b8',
                    boxShadow: settingsSubTab === 'avatar' ? '0 0 10px rgba(139,92,246,0.3)' : 'none'
                  }}
                >
                  <Palette style={{ width: '13px', height: '13px' }} />
                  <span>Avatar & Animations</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsSubTab('voice')}
                  style={{
                    flex: 1, padding: '7px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    fontSize: '0.76rem', fontWeight: 600, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    background: settingsSubTab === 'voice' ? 'linear-gradient(135deg, #8b5cf6, #d946ef)' : 'transparent',
                    color: settingsSubTab === 'voice' ? '#fff' : '#94a3b8',
                    boxShadow: settingsSubTab === 'voice' ? '0 0 10px rgba(139,92,246,0.3)' : 'none'
                  }}
                >
                  <Volume2 style={{ width: '13px', height: '13px' }} />
                  <span>Voice & Audio</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsSubTab('brain')}
                  style={{
                    flex: 1, padding: '7px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    fontSize: '0.76rem', fontWeight: 600, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    background: settingsSubTab === 'brain' ? 'linear-gradient(135deg, #8b5cf6, #d946ef)' : 'transparent',
                    color: settingsSubTab === 'brain' ? '#fff' : '#94a3b8',
                    boxShadow: settingsSubTab === 'brain' ? '0 0 10px rgba(139,92,246,0.3)' : 'none'
                  }}
                >
                  <Brain style={{ width: '13px', height: '13px' }} />
                  <span>AI Brain</span>
                </button>
              </div>

              {/* Sub-tab 0: General Settings */}
              {settingsSubTab === 'general' && (
                <>
                  {/* Featured Launch on Startup Toggle Banner */}
                  <div style={{
                    background: settings.launch_on_startup ? 'linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(56,189,248,0.15) 100%)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${settings.launch_on_startup ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '14px',
                    padding: '12px 16px',
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Power className="w-5 h-5 text-emerald-400" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>Launch on Startup (Start with PC)</span>
                          {isDevEnv && (
                            <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(245,158,11,0.2)', color: '#fbbf24', fontWeight: 600 }}>
                              DEV MODE (FOR SHOW ONLY)
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}>
                          Automatically launch Yuki when your computer boots up. {isDevEnv ? '(Active in production builds; skipped during development)' : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const newVal = !settings.launch_on_startup;
                        handleUpdateSetting('launch_on_startup', newVal);
                        if (window.electronAPI && window.electronAPI.setOpenAtLogin) {
                          window.electronAPI.setOpenAtLogin(newVal);
                        }
                      }}
                      style={{
                        background: settings.launch_on_startup ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.08)',
                        border: `1px solid ${settings.launch_on_startup ? 'rgba(16,185,129,0.6)' : 'rgba(255,255,255,0.12)'}`,
                        borderRadius: '14px',
                        width: '44px',
                        height: '24px',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'all 0.2s ease',
                        flexShrink: 0
                      }}
                    >
                      <div style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: '#fff',
                        position: 'absolute',
                        top: '2px',
                        left: settings.launch_on_startup ? '22px' : '2px',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }} />
                    </button>
                  </div>

                  {/* Featured Chat Mode Toggle Banner */}
                  <div style={{
                    background: settings.chat_mode ? 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(217,70,239,0.15) 100%)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${settings.chat_mode ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '14px',
                    padding: '12px 16px',
                    marginBottom: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <MessageSquare className="w-5 h-5 text-violet-400" />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>Chat Mode (Pure Conversation)</div>
                          <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}>
                            Treats all messages as simple chat. Disables computer control tools for fast lightweight responses.
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUpdateSetting('chat_mode', !settings.chat_mode)}
                        style={{
                          background: settings.chat_mode ? 'linear-gradient(135deg, #8b5cf6, #d946ef)' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${settings.chat_mode ? 'rgba(139,92,246,0.6)' : 'rgba(255,255,255,0.12)'}`,
                          borderRadius: '14px',
                          width: '44px',
                          height: '24px',
                          cursor: 'pointer',
                          position: 'relative',
                          transition: 'all 0.2s ease',
                          flexShrink: 0
                        }}
                      >
                        <div style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          background: '#fff',
                          position: 'absolute',
                          top: '2px',
                          left: settings.chat_mode ? '22px' : '2px',
                          transition: 'all 0.2s ease',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }} />
                      </button>
                    </div>

                    {settings.chat_mode && (
                      <div style={{
                        paddingTop: '8px',
                        borderTop: '1px solid rgba(255,255,255,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}>
                        <input
                          type="checkbox"
                          id="top_keep_memory_saving"
                          checked={settings.keep_memory_saving !== false}
                          onChange={(e) => handleUpdateSetting('keep_memory_saving', e.target.checked)}
                          style={{ accentColor: '#a78bfa', cursor: 'pointer', width: '14px', height: '14px' }}
                        />
                        <label htmlFor="top_keep_memory_saving" style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.85)', cursor: 'pointer' }}>
                          Keep memory saving active in Chat Mode
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Always on Top Banner */}
                  <div style={{
                    background: settings.always_on_top !== false ? 'linear-gradient(135deg, rgba(56,189,248,0.15) 0%, rgba(139,92,246,0.15) 100%)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${settings.always_on_top !== false ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '14px',
                    padding: '12px 16px',
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Monitor className="w-5 h-5 text-sky-400" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>Always on Top (Pin Desktop Avatar)</div>
                        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}>
                          Keeps Yuki floating over all open app windows and full-screen games.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const newVal = settings.always_on_top === false;
                        handleUpdateSetting('always_on_top', newVal);
                        if (window.electronAPI && window.electronAPI.setAlwaysOnTop) {
                          window.electronAPI.setAlwaysOnTop(newVal);
                        }
                      }}
                      style={{
                        background: settings.always_on_top !== false ? 'linear-gradient(135deg, #38bdf8, #0284c7)' : 'rgba(255,255,255,0.08)',
                        border: `1px solid ${settings.always_on_top !== false ? 'rgba(56,189,248,0.6)' : 'rgba(255,255,255,0.12)'}`,
                        borderRadius: '14px',
                        width: '44px',
                        height: '24px',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'all 0.2s ease',
                        flexShrink: 0
                      }}
                    >
                      <div style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: '#fff',
                        position: 'absolute',
                        top: '2px',
                        left: settings.always_on_top !== false ? '22px' : '2px',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }} />
                    </button>
                  </div>

                  {/* General Preferences Group */}
                  <div className="card-group" style={{ marginBottom: '12px' }}>
                    <div className="card-group-header">
                      <Layout className="w-4 h-4 text-violet-400" />
                      <span className="card-group-title">Dashboard & Sound Preferences</span>
                    </div>

                    {/* Default Dashboard Tab */}
                    <div className="identity-field" style={{ marginTop: '6px' }}>
                      <span className="field-label">Default Open Tab on Dashboard</span>
                      <select
                        value={settings.default_dashboard_tab || 'memory'}
                        onChange={(e) => handleUpdateSetting('default_dashboard_tab', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.78rem',
                          outline: 'none',
                          cursor: 'pointer',
                          marginTop: '4px'
                        }}
                      >
                        <option value="memory">🧠 Memory & Persona</option>
                        <option value="tasks">⏱️ Tasks & Alarms</option>
                        <option value="chat">💬 Chat & Logs</option>
                        <option value="settings">⚙️ Settings</option>
                      </select>
                    </div>

                    {/* Mute System Alarm Chimes Toggle */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <BellOff className="w-4 h-4 text-rose-400" />
                        <div>
                          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fff' }}>Mute In-App Alarm Chime Audio</div>
                          <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>Rings visual popup only without Web Audio tone synth</div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.mute_alarm_chimes === true}
                        onChange={(e) => handleUpdateSetting('mute_alarm_chimes', e.target.checked)}
                        style={{ accentColor: '#f43f5e', cursor: 'pointer', width: '15px', height: '15px' }}
                      />
                    </div>
                  </div>

                  {/* Alarm & Timer Tone Selector Card */}
                  <div className="card-group" style={{ marginBottom: '12px' }}>
                    <div className="card-group-header">
                      <Music className="w-4 h-4 text-emerald-400" />
                      <span className="card-group-title">Alarm & Timer Sound Tones</span>
                    </div>

                    {/* Ringtone Selector & Test Button */}
                    <div className="identity-field" style={{ marginTop: '6px' }}>
                      <span className="field-label">Active Alarm & Timer Tone</span>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                        <select
                          value={settings.alarm_tone || 'pulse_chime'}
                          onChange={(e) => handleUpdateSetting('alarm_tone', e.target.value)}
                          style={{
                            flex: 1,
                            padding: '7px 10px',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '0.78rem',
                            outline: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          {ALARM_TONE_PRESETS.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>

                        {/* Test Button */}
                        <button
                          type="button"
                          onClick={() => handleTestTone()}
                          style={{
                            padding: '7px 14px',
                            borderRadius: '8px',
                            border: 'none',
                            background: isPlayingToneTest ? 'rgba(239,68,68,0.25)' : 'linear-gradient(135deg, #10b981, #059669)',
                            color: isPlayingToneTest ? '#fca5a5' : '#fff',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            flexShrink: 0
                          }}
                        >
                          {isPlayingToneTest ? (
                            <>
                              <Square className="w-3 h-3 fill-current" />
                              <span>Stop</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current" />
                              <span>Test Tone</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Custom Audio File Upload Section */}
                    {(settings.alarm_tone === 'custom' || settings.custom_alarm_tone_file) && (
                      <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', marginBottom: '6px' }}>
                          Upload Custom Ringtone Audio File (.mp3, .wav, .ogg, .flac, .m4a)
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <label style={{
                            padding: '6px 12px',
                            borderRadius: '8px',
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: '#fff',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}>
                            <Upload className="w-3.5 h-3.5" />
                            <span>{isUploadingTone ? 'Uploading...' : 'Choose Audio File'}</span>
                            <input
                              type="file"
                              accept=".mp3,.wav,.ogg,.flac,.m4a,.aac"
                              onChange={handleUploadCustomTone}
                              disabled={isUploadingTone}
                              style={{ display: 'none' }}
                            />
                          </label>

                          {settings.custom_alarm_tone_file && (
                            <span style={{ fontSize: '0.72rem', color: '#a78bfa', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              🎵 {settings.custom_alarm_tone_file}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Sub-tab 1: AI Brain */}
              {settingsSubTab === 'brain' && (
                <>
                  {/* Card 1: Prompt & Execution Strategy (First Card) */}
                  <div className="card-group">
                    <div className="card-group-header">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span className="card-group-title">Prompt & Execution Strategy</span>
                    </div>

                    {/* Prompt Strategy / LLM Mode (Mixed, Simple Only, Complex Only) */}
                    <div className="identity-field" style={{ marginTop: '4px' }}>
                      <span className="field-label" style={{ fontWeight: '600', color: '#c4b5fd' }}>Prompt Strategy / LLM Mode</span>
                      <select
                        value={settings.llm_mode !== undefined ? settings.llm_mode : 3}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          handleUpdateSetting('llm_mode', val);
                          if (val === 1) {
                            handleUpdateSetting('enable_intent_check', false);
                            handleUpdateSetting('dynamic_tool_calling', false);
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(167, 139, 250, 0.3)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.78rem',
                          outline: 'none',
                          cursor: 'pointer',
                          marginTop: '4px'
                        }}
                      >
                        <option value={3} style={{ background: '#0b0813', color: 'white' }}>Dynamic Mixed Prompts (Default & Recommended)</option>
                        <option value={1} style={{ background: '#0b0813', color: 'white' }}>Simple Prompts Only (Lean & Fast)</option>
                        <option value={2} style={{ background: '#0b0813', color: 'white' }}>Complex Prompts Only (Full Capabilities)</option>
                      </select>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginTop: '4px', lineHeight: '1.3' }}>
                        {settings.llm_mode === 1
                          ? '⚡ Simple Prompts Only: Uses lean prompts for fast responses. Disables tools, intent checking, and dynamic filtering.'
                          : settings.llm_mode === 2
                          ? '🧠 Complex Prompts Only: Forces full tool-aware system prompts for all turns.'
                          : '🔄 Dynamic Mixed Prompts: Automatically uses lightweight prompts for basic chatter and tool-aware prompts for desktop tasks.'}
                      </span>
                    </div>

                    {/* LLM Intent Check Toggle */}
                    <div className="identity-field" style={{ marginTop: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span className="field-label" style={{ opacity: settings.llm_mode === 1 ? 0.5 : 1 }}>LLM Intent Check</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px', maxWidth: '280px', lineHeight: '1.25' }}>
                            Double-checks task intent with a secondary LLM query. <strong style={{ color: '#f472b6' }}>Recommended ON for sub-5B models</strong>. (Default: ON)
                          </span>
                        </div>
                        <label className="switch" style={{ opacity: settings.llm_mode === 1 ? 0.4 : 1, cursor: settings.llm_mode === 1 ? 'not-allowed' : 'pointer' }}>
                          <input
                            type="checkbox"
                            disabled={settings.llm_mode === 1}
                            checked={settings.llm_mode !== 1 && (settings.enable_intent_check !== undefined ? settings.enable_intent_check : true)}
                            onChange={(e) => handleUpdateSetting('enable_intent_check', e.target.checked)}
                          />
                          <span className="slider round"></span>
                        </label>
                      </div>
                    </div>

                    {/* Dynamic Tool Calling Toggle */}
                    <div className="identity-field" style={{ marginTop: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span className="field-label" style={{ opacity: settings.llm_mode === 1 ? 0.5 : 1 }}>Dynamic Tool Calling</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px', maxWidth: '280px', lineHeight: '1.25' }}>
                            Filters tool schemas dynamically by query relevance. When <strong>OFF</strong>, all tool definitions are sent with complex prompts. (Default: ON)
                          </span>
                        </div>
                        <label className="switch" style={{ opacity: settings.llm_mode === 1 ? 0.4 : 1, cursor: settings.llm_mode === 1 ? 'not-allowed' : 'pointer' }}>
                          <input
                            type="checkbox"
                            disabled={settings.llm_mode === 1}
                            checked={settings.llm_mode !== 1 && (settings.dynamic_tool_calling !== undefined ? settings.dynamic_tool_calling : true)}
                            onChange={(e) => handleUpdateSetting('dynamic_tool_calling', e.target.checked)}
                          />
                          <span className="slider round"></span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: AI Brain & Language Model (LLM API Configuration) */}
                  <div className="card-group">
                    <div className="card-group-header">
                      <Cpu className="w-4 h-4 text-violet-400" />
                      <span className="card-group-title">AI Brain & Language Model</span>
                    </div>

                    {/* LLM Backend Type */}
                    <div className="identity-field" style={{ marginTop: '4px' }}>
                      <span className="field-label">LLM Backend</span>
                      <select
                        value={settings.llm_backend || 'lmstudio'}
                        onChange={async (e) => {
                          const newBackend = e.target.value;
                          await handleUpdateSetting('llm_model', '');
                          await handleUpdateSetting('llm_backend', newBackend);
                          const defaults = {
                            lmstudio: 'http://127.0.0.1:1234',
                            ollama: 'http://127.0.0.1:11434',
                            vllm: 'http://127.0.0.1:8000/v1',
                            openai: 'https://api.openai.com/v1',
                            custom: '',
                          };
                          await handleUpdateSetting('llm_base_url', defaults[newBackend] || '');
                          if (newBackend !== 'none' && onRefreshLlmModels) {
                            setTimeout(() => onRefreshLlmModels(), 500);
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.78rem',
                          outline: 'none',
                          cursor: 'pointer',
                          marginTop: '4px'
                        }}
                      >
                        <option value="lmstudio">LM Studio (Local)</option>
                        <option value="ollama">Ollama (Local)</option>
                        <option value="vllm">vLLM (Local)</option>
                        <option value="custom">Custom / Cloud API (OpenAI-Compatible)</option>
                        <option value="none">No LLM (Voice + File Search Only)</option>
                      </select>
                    </div>

                    {/* Custom Endpoint Label & Saved Presets Dropdown (Below LLM Backend, Above Endpoint URL) */}
                    {(settings.llm_backend === 'openai' || settings.llm_backend === 'custom') && (
                      <div className="identity-field" style={{ marginTop: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="field-label">Custom API Label & Saved Presets</span>
                          {savedCustomEndpoints.length > 0 && (
                            <span style={{ fontSize: '0.7rem', color: '#a78bfa' }}>
                              {savedCustomEndpoints.length} saved in DB
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
                          <input
                            type="text"
                            placeholder="e.g. Google Gemini Cloud, xAI Grok, My Custom Server"
                            value={customLabel}
                            onChange={(e) => setCustomLabel(e.target.value)}
                            style={{
                              flex: 1,
                              padding: '7px 10px',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(167, 139, 250, 0.3)',
                              borderRadius: '8px',
                              color: 'white',
                              fontSize: '0.78rem',
                              outline: 'none'
                            }}
                          />

                          {/* Dropdown fetching saved endpoints from DB */}
                          {savedCustomEndpoints.length > 0 && (
                            <select
                              onChange={async (e) => {
                                const selId = e.target.value;
                                if (!selId) return;
                                const ep = savedCustomEndpoints.find(item => item.id === selId || item.label === selId);
                                if (ep) {
                                  setCustomLabel(ep.label);
                                  const targetBackend = settings.llm_backend === 'custom' || settings.llm_backend === 'openai' ? settings.llm_backend : (ep.llm_backend || 'custom');
                                  await handleUpdateSetting('llm_backend', targetBackend);
                                  await handleUpdateSetting('llm_base_url', ep.base_url);
                                  if (ep.api_key_masked && ep.api_key_masked !== '****') {
                                    await handleUpdateSetting('llm_api_key', ep.api_key_masked);
                                  }
                                  if (ep.model) {
                                    await handleUpdateSetting('llm_model', ep.model);
                                  }
                                  if (onRefreshLlmModels) {
                                    setTimeout(() => onRefreshLlmModels(), 500);
                                  }
                                }
                              }}
                              defaultValue=""
                              style={{
                                padding: '7px 8px',
                                background: 'rgba(18, 12, 33, 0.85)',
                                border: '1px solid rgba(139, 92, 246, 0.4)',
                                borderRadius: '8px',
                                color: '#c4b5fd',
                                fontSize: '0.75rem',
                                outline: 'none',
                                cursor: 'pointer',
                                maxWidth: '150px'
                              }}
                            >
                              <option value="" disabled>Saved DB Presets...</option>
                              {savedCustomEndpoints.map((ep) => (
                                <option key={ep.id} value={ep.id}>
                                  {ep.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Popular Cloud AI Preset Suggestions */}
                    {(settings.llm_backend === 'openai' || settings.llm_backend === 'custom') && (
                      <div style={{ marginTop: '6px' }}>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>
                          Quick Cloud Presets:
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {[
                            { name: 'Gemini', label: 'Google Gemini Cloud', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-1.5-flash' },
                            { name: 'OpenAI', label: 'OpenAI Cloud API', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
                            { name: 'Grok', label: 'xAI Grok Cloud', url: 'https://api.x.ai/v1', model: 'grok-beta' },
                            { name: 'OpenRouter', label: 'OpenRouter Cloud API', url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
                            { name: 'Groq', label: 'Groq Cloud API', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
                            { name: 'Mistral', label: 'Mistral Cloud API', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
                            { name: 'DeepSeek', label: 'DeepSeek Cloud', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
                          ].map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              onClick={async () => {
                                setCustomLabel(p.label);
                                const activeBackend = settings.llm_backend === 'openai' || settings.llm_backend === 'custom' ? settings.llm_backend : 'custom';
                                await handleUpdateSetting('llm_backend', activeBackend);
                                await handleUpdateSetting('llm_base_url', p.url);
                                if (p.model && !settings.llm_model) {
                                  await handleUpdateSetting('llm_model', p.model);
                                }
                                if (onRefreshLlmModels) {
                                  setTimeout(() => onRefreshLlmModels(), 500);
                                }
                              }}
                              className="glass-button"
                              style={{
                                padding: '2px 7px',
                                fontSize: '0.68rem',
                                borderRadius: '6px',
                                background: settings.llm_base_url === p.url ? 'rgba(139, 92, 246, 0.4)' : 'rgba(255, 255, 255, 0.06)',
                                border: settings.llm_base_url === p.url ? '1px solid #a78bfa' : '1px solid rgba(255,255,255,0.08)',
                                color: settings.llm_base_url === p.url ? '#fff' : '#cbd5e1',
                                cursor: 'pointer'
                              }}
                            >
                              ⚡ {p.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Base URL */}
                    {settings.llm_backend !== 'none' && (
                      <div className="identity-field" style={{ marginTop: '8px' }}>
                        <span className="field-label">
                          {settings.llm_backend === 'lmstudio' ? 'LM Studio URL' : settings.llm_backend === 'ollama' ? 'Ollama URL' : settings.llm_backend === 'vllm' ? 'vLLM URL' : settings.llm_backend === 'openai' ? 'API Base URL' : 'Endpoint URL'}
                        </span>
                        <input
                          type="text"
                          placeholder={
                            settings.llm_backend === 'lmstudio' ? 'http://127.0.0.1:1234' :
                            settings.llm_backend === 'ollama' ? 'http://127.0.0.1:11434' :
                            settings.llm_backend === 'vllm' ? 'http://127.0.0.1:8000/v1' :
                            settings.llm_backend === 'openai' ? 'https://generativelanguage.googleapis.com/v1beta/openai' :
                            'http://127.0.0.1:8000/v1'
                          }
                          value={settings.llm_base_url || ''}
                          onChange={(e) => {
                            const newUrl = e.target.value;
                            handleUpdateSetting('llm_base_url', newUrl);
                            if (!customLabel || customLabel.startsWith('Custom API') || customLabel.endsWith('Cloud')) {
                              const suggested = autoSuggestLabel(newUrl);
                              if (suggested) setCustomLabel(suggested);
                            }
                          }}
                          onBlur={(e) => {
                            if (!e.target.value.trim()) {
                              const defaults = {
                                lmstudio: 'http://127.0.0.1:1234',
                                ollama: 'http://127.0.0.1:11434',
                                vllm: 'http://127.0.0.1:8000/v1',
                                openai: 'https://generativelanguage.googleapis.com/v1beta/openai',
                                custom: 'http://127.0.0.1:8000/v1',
                              };
                              if (defaults[settings.llm_backend]) handleUpdateSetting('llm_base_url', defaults[settings.llm_backend]);
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '0.78rem',
                            outline: 'none',
                            marginTop: '4px'
                          }}
                        />
                      </div>
                    )}

                    {/* API Key (for OpenAI-compatible / Custom with auth) */}
                    {(settings.llm_backend === 'openai' || settings.llm_backend === 'custom') && (
                      <div className="identity-field" style={{ marginTop: '8px' }}>
                        <span className="field-label">API Key (Encrypted in DB)</span>
                        <input
                          type="password"
                          placeholder="sk-..."
                          value={settings.llm_api_key || ''}
                          onChange={(e) => handleUpdateSetting('llm_api_key', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '0.78rem',
                            outline: 'none',
                            marginTop: '4px'
                          }}
                        />
                      </div>
                    )}

                    {/* Save Endpoint Preset Button */}
                    {(settings.llm_backend === 'openai' || settings.llm_backend === 'custom') && (
                      <div style={{ marginTop: '10px' }}>
                        <button
                          type="button"
                          onClick={handleSaveCustomEndpoint}
                          className="glass-button"
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            fontSize: '0.78rem',
                            borderRadius: '8px',
                            background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                            color: 'white',
                            fontWeight: '600',
                            border: 'none',
                            cursor: 'pointer',
                            boxShadow: '0 4px 12px rgba(109,40,217,0.35)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                          }}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {saveEndpointBtnText}
                        </button>
                      </div>
                    )}

                    {/* Active LLM Model Selection */}
                    {settings.llm_backend !== 'none' && (
                      <div className="identity-field" style={{ marginTop: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="field-label">Active LLM Model</span>
                          <button
                            type="button"
                            onClick={onRefreshLlmModels}
                            title="Refresh model list from backend"
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                          >
                            <RefreshCw style={{ width: '11px', height: '11px' }} /> Refresh
                          </button>
                        </div>
                        <select
                          value={settings.llm_model || ''}
                          onChange={(e) => handleUpdateSetting('llm_model', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '0.78rem',
                            outline: 'none',
                            cursor: 'pointer',
                            marginTop: '4px'
                          }}
                        >
                          {!settings.llm_model && (
                            <option value="" style={{ background: '#0b0813', color: 'white', opacity: 0.5 }}>
                              Select a model...
                            </option>
                          )}
                          {availableLlmModels.map((model) => {
                            const mName = typeof model === 'string' ? model : (model.name || model.id || '');
                            return (
                              <option key={mName} value={mName} style={{ background: '#0b0813', color: 'white' }}>
                                {mName}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Sub-tab 2: Voice & Audio (TTS first, then STT) */}
              {settingsSubTab === 'voice' && (
                <>
                  {/* TTS Output Card Group */}
                  <div className="card-group">
                    <div className="card-group-header">
                      <Volume2 className="w-4 h-4 text-pink-400" />
                      <span className="card-group-title">Speech Synthesis (TTS Output)</span>
                    </div>

                    {/* Voice Volume & Mute Controls */}
                    <div className="identity-field" style={{ marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {muteVoice ? <VolumeX style={{ width: '13px', height: '13px', color: '#f87171' }} /> : <Volume2 style={{ width: '13px', height: '13px', color: '#a78bfa' }} />}
                          Voice Audio Output
                        </span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: 'white', cursor: 'pointer', margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={muteVoice}
                            onChange={(e) => onMuteVoiceChange && onMuteVoiceChange(e.target.checked)}
                            style={{ cursor: 'pointer', accentColor: '#a78bfa' }}
                          />
                          Mute
                        </label>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)' }}>Volume Level</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a78bfa' }}>
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
                        onChange={(e) => onVoiceVolumeChange && onVoiceVolumeChange(parseFloat(e.target.value))}
                        style={{ width: '100%', cursor: muteVoice ? 'not-allowed' : 'pointer', accentColor: '#a78bfa', marginTop: '4px', opacity: muteVoice ? 0.5 : 1 }}
                      />
                    </div>

                    {/* TTS Voice Selection */}
                    <div className="identity-field" style={{ marginTop: '10px' }}>
                      <span className="field-label">Speech Synthesis Voice</span>
                      <select
                        value={settings.tts_voice}
                        onChange={(e) => handleUpdateSetting('tts_voice', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.78rem',
                          outline: 'none',
                          cursor: 'pointer',
                          marginTop: '2px'
                        }}
                      >
                        {TTS_VOICES.map((v) => (
                          <option key={v.value} value={v.value} style={{ background: '#0b0813', color: 'white' }}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* TTS Rate */}
                    <div className="identity-field" style={{ marginTop: '10px' }}>
                      <span className="field-label">Speech Delivery Rate</span>
                      <select
                        value={settings.tts_rate}
                        onChange={(e) => handleUpdateSetting('tts_rate', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.78rem',
                          outline: 'none',
                          cursor: 'pointer',
                          marginTop: '2px'
                        }}
                      >
                        {TTS_RATES.map((r) => (
                          <option key={r.value} value={r.value} style={{ background: '#0b0813', color: 'white' }}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* TTS Device */}
                    <div className="identity-field" style={{ marginTop: '10px' }}>
                      <span className="field-label">TTS Processing Device</span>
                      <select
                        value={settings.tts_device || 'auto'}
                        onChange={(e) => handleUpdateSetting('tts_device', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.78rem',
                          outline: 'none',
                          cursor: 'pointer',
                          marginTop: '2px'
                        }}
                      >
                        <option value="auto" style={{ background: '#0b0813', color: 'white' }}>Auto (Best Available)</option>
                        <option value="gpu" style={{ background: '#0b0813', color: 'white' }}>GPU (CUDA)</option>
                        <option value="cpu" style={{ background: '#0b0813', color: 'white' }}>CPU (Force CPU)</option>
                      </select>
                    </div>

                    {/* Preload TTS */}
                    <div className="identity-field" style={{ marginTop: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span className="field-label">Preload TTS on Startup</span>
                          <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', marginTop: '1px' }}>
                            Loads voice model on boot (~250-400 MB). Off = loads on first speech.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUpdateSetting('tts_preload', !settings.tts_preload)}
                          style={{
                            background: settings.tts_preload ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)',
                            border: `1px solid ${settings.tts_preload ? 'rgba(139,92,246,0.6)' : 'rgba(255,255,255,0.12)'}`,
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
                            background: settings.tts_preload ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                            position: 'absolute',
                            top: '2px',
                            left: settings.tts_preload ? '20px' : '2px',
                            transition: 'all 0.2s ease'
                          }} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* STT Input Card Group */}
                  <div className="card-group" style={{ marginTop: '12px' }}>
                    <div className="card-group-header">
                      <Mic className="w-4 h-4 text-violet-400" />
                      <span className="card-group-title">Speech Recognition (STT Input)</span>
                    </div>

                    {/* Microphone Select */}
                    <div className="identity-field" style={{ marginTop: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span className="field-label" style={{ margin: 0 }}>Microphone Input Device</span>
                        <button
                          type="button"
                          onClick={onRefreshMicDevices}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '4px',
                            fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
                            padding: '2px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)', transition: 'all 0.2s'
                          }}
                        >
                          <RefreshCw size={11} />
                          <span>Refresh</span>
                        </button>
                      </div>
                      <select
                        value={selectedMicDeviceId}
                        onChange={(e) => onMicDeviceChange && onMicDeviceChange(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.78rem',
                          outline: 'none',
                          cursor: 'pointer',
                          marginTop: '4px'
                        }}
                      >
                        <option value="" style={{ background: '#0b0813', color: 'white' }}>System Default</option>
                        {micDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId} style={{ background: '#0b0813', color: 'white' }}>
                            {d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`}
                          </option>
                        ))}
                      </select>

                      {/* Prefer Headset Mic checkbox */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '7px', cursor: 'pointer', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={preferHeadsetMic}
                          onChange={(e) => onPreferHeadsetMicChange && onPreferHeadsetMicChange(e.target.checked)}
                          style={{ accentColor: '#a78bfa', width: '13px', height: '13px', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.72rem', color: '#c4b5fd', lineHeight: 1.3 }}>
                          Prefer headset mic — auto-select headset when connected
                        </span>
                      </label>

                      <MicLevelMeter deviceId={selectedMicDeviceId} deviceName={micDevices.find(d => d.deviceId === selectedMicDeviceId)?.label || ''} vadThreshold={vadThreshold} />
                    </div>

                    {/* STT Engine Select */}
                    <div className="identity-field" style={{ marginTop: '10px' }}>
                      <span className="field-label">Speech-to-Text Engine</span>
                      <select
                        value={settings.use_local_whisper !== false ? 'whisper' : 'web'}
                        onChange={(e) => handleUpdateSetting('use_local_whisper', e.target.value === 'whisper')}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.78rem',
                          outline: 'none',
                          cursor: 'pointer',
                          marginTop: '4px'
                        }}
                      >
                        <option value="whisper" style={{ background: '#0b0813', color: 'white' }}>Local Faster-Whisper (Private / GPU Accelerated)</option>
                        <option value="web" style={{ background: '#0b0813', color: 'web' }}>Web Speech API (Browser Fallback)</option>
                      </select>
                    </div>

                    {/* Local Whisper Options */}
                    {(settings.use_local_whisper !== false) && (
                      <>
                        {/* Whisper Model Size */}
                        <div className="identity-field" style={{ marginTop: '10px' }}>
                          <span className="field-label">Whisper Model Size</span>
                          <select
                            value={settings.whisper_model || 'base'}
                            onChange={(e) => handleUpdateSetting('whisper_model', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '8px',
                              color: 'white',
                              fontSize: '0.78rem',
                              outline: 'none',
                              cursor: 'pointer',
                              marginTop: '4px'
                            }}
                          >
                            <option value="distil-small.en" style={{ background: '#0b0813', color: '#c4b5fd' }}>⚡ Distil-Small.en (Ultra-Fast &lt;100ms / ~150MB VRAM)</option>
                            <option value="base" style={{ background: '#0b0813', color: 'white' }}>Base Model (Accurate / ~140MB)</option>
                            <option value="small" style={{ background: '#0b0813', color: 'white' }}>Small Model (High Accuracy / ~460MB)</option>
                            <option value="tiny" style={{ background: '#0b0813', color: 'white' }}>Tiny Model (Fastest / ~70MB)</option>
                            <option value="medium" style={{ background: '#0b0813', color: 'white' }}>Medium Model (Pro Quality / ~1.5GB)</option>
                          </select>
                        </div>

                        {/* STT Processing Device */}
                        <div className="identity-field" style={{ marginTop: '10px' }}>
                          <span className="field-label">STT Processing Device</span>
                          <select
                            value={settings.stt_device || 'auto'}
                            onChange={(e) => handleUpdateSetting('stt_device', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '8px',
                              color: 'white',
                              fontSize: '0.78rem',
                              outline: 'none',
                              cursor: 'pointer',
                              marginTop: '4px'
                            }}
                          >
                            <option value="auto" style={{ background: '#0b0813', color: 'white' }}>Auto (Best Available)</option>
                            <option value="gpu" style={{ background: '#0b0813', color: 'white' }}>GPU (CUDA)</option>
                            <option value="cpu" style={{ background: '#0b0813', color: 'white' }}>CPU (Force CPU)</option>
                          </select>
                        </div>

                        {/* Whisper Quantization / Compute Type */}
                        <div className="identity-field" style={{ marginTop: '10px' }}>
                          <span className="field-label">Whisper VRAM Quantization Mode</span>
                          <select
                            value={settings.whisper_compute_type || 'int8_float16'}
                            onChange={(e) => handleUpdateSetting('whisper_compute_type', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(167, 139, 250, 0.3)',
                              borderRadius: '8px',
                              color: 'white',
                              fontSize: '0.78rem',
                              outline: 'none',
                              cursor: 'pointer',
                              marginTop: '4px'
                            }}
                          >
                            <option value="int8_float16" style={{ background: '#0b0813', color: 'white' }}>Int8 Weights + FP16 Activations (Recommended - ~250MB VRAM)</option>
                            <option value="int8" style={{ background: '#0b0813', color: 'white' }}>Full Int8 Quantization (Max VRAM Savings - ~180MB VRAM)</option>
                            <option value="float16" style={{ background: '#0b0813', color: 'white' }}>Standard Float16 (~500MB VRAM)</option>
                          </select>
                        </div>

                        {/* Silero VAD Confidence / Sensitivity Threshold */}
                        <div className="identity-field" style={{ marginTop: '10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="field-label">VAD Speech Sensitivity Threshold</span>
                            <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a78bfa' }}>
                              {(settings.vad_threshold !== undefined && settings.vad_threshold < 0.2 ? settings.vad_threshold : 0.015).toFixed(3)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.005"
                            max="0.060"
                            step="0.002"
                            value={settings.vad_threshold !== undefined && settings.vad_threshold < 0.2 ? settings.vad_threshold : 0.015}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              handleUpdateSetting('vad_threshold', val);
                              if (onVadThresholdChange) onVadThresholdChange(val);
                            }}
                            style={{ width: '100%', cursor: 'pointer', accentColor: '#a78bfa', marginTop: '4px' }}
                          />
                          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                            Acoustic sensitivity for speech detection. Lower = more sensitive; Higher = ignores noise. (Recommended: 0.015)
                          </span>
                        </div>

                        {/* Silence Timeout */}
                        <div className="identity-field" style={{ marginTop: '10px' }}>
                          <span className="field-label">Silence Timeout (End of Speech Wait)</span>
                          <select
                            value={settings.silence_timeout_ms || 450}
                            onChange={(e) => handleUpdateSetting('silence_timeout_ms', parseInt(e.target.value, 10))}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '8px',
                              color: 'white',
                              fontSize: '0.78rem',
                              outline: 'none',
                              cursor: 'pointer',
                              marginTop: '4px'
                            }}
                          >
                            <option value={300} style={{ background: '#0b0813', color: 'white' }}>300ms (Fast Turn-Taking)</option>
                            <option value={450} style={{ background: '#0b0813', color: 'white' }}>450ms (Recommended - Balanced)</option>
                            <option value={600} style={{ background: '#0b0813', color: 'white' }}>600ms (Relaxed)</option>
                            <option value={800} style={{ background: '#0b0813', color: 'white' }}>800ms (Slow)</option>
                          </select>
                        </div>

                        {/* STT Language */}
                        <div className="identity-field" style={{ marginTop: '10px' }}>
                          <span className="field-label">Speech-to-Text Language</span>
                          <select
                            value={settings.stt_language || 'en'}
                            onChange={(e) => handleUpdateSetting('stt_language', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '8px',
                              color: 'white',
                              fontSize: '0.78rem',
                              outline: 'none',
                              cursor: 'pointer',
                              marginTop: '4px'
                            }}
                          >
                            <option value="en" style={{ background: '#0b0813', color: 'white' }}>English</option>
                            <option value="hi" style={{ background: '#0b0813', color: 'white' }}>Hindi (हिन्दी)</option>
                            <option value="ja" style={{ background: '#0b0813', color: 'white' }}>Japanese (日本語)</option>
                            <option value="auto" style={{ background: '#0b0813', color: 'white' }}>Auto Detect</option>
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Sub-tab 3: Avatar & Persona */}
              {settingsSubTab === 'avatar' && (
                <>
                  <div className="card-group">
                    <div className="card-group-header">
                      <Sparkles className="w-4 h-4 text-teal-400" />
                      <span className="card-group-title">VRM Avatar & Customization</span>
                    </div>

                    {/* Companion Avatar Scale / Size Slider (50%-200%) & Custom Input (20%-1000%) */}
                    <div className="identity-field" style={{ marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Monitor style={{ width: '13px', height: '13px', color: '#a78bfa' }} />
                          Companion Scale Size
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a78bfa' }}>
                            {Math.round(localAvatarScale * 100)}%
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '6px', border: '1px solid rgba(167,139,250,0.3)' }}>
                            <input
                              type="number"
                              min="20"
                              max="1000"
                              step="1"
                              value={Math.round(localAvatarScale * 100)}
                              onChange={(e) => {
                                const parsed = parseFloat(e.target.value);
                                if (!isNaN(parsed)) {
                                  const clamped = Math.max(0.2, Math.min(10.0, parsed / 100));
                                  handleAvatarScaleChange(clamped);
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
                        value={Math.max(0.5, Math.min(2.0, localAvatarScale))}
                        onChange={(e) => handleAvatarScaleChange(parseFloat(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#a78bfa', marginTop: '4px' }}
                      />
                      <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px', display: 'block', lineHeight: '1.2' }}>
                        Use slider for quick 50%-200% scale, or type custom value (20% to 1000%).
                      </span>
                    </div>

                    {/* VRM Avatar Model */}
                    <div className="identity-field" style={{ marginTop: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span className="field-label" style={{ margin: 0 }}>VRM Avatar Model</span>
                        <label style={{
                          display: 'flex', alignItems: 'center', gap: '4px',
                          fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
                          padding: '2px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)', transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(108,92,231,0.15)'; e.currentTarget.style.borderColor = 'rgba(108,92,231,0.3)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                        >
                          <Upload size={11} />
                          <span>{vrmUploading ? 'Uploading...' : 'Upload VRM'}</span>
                          <input type="file" accept=".vrm" onChange={handleVrmUpload} disabled={vrmUploading} style={{ display: 'none' }} />
                        </label>
                      </div>
                      <div style={{ position: 'relative' }}>
                        <select
                          value={settings.active_vrm_model || 'default.vrm'}
                          onChange={(e) => handleUpdateSetting('active_vrm_model', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '0.78rem',
                            outline: 'none',
                            cursor: 'pointer',
                            marginTop: '2px'
                          }}
                        >
                          {vrmModels.map((model) => (
                            <option key={model} value={model} style={{ background: '#0b0813', color: 'white' }}>
                              {model.replace('.vrm', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                            </option>
                          ))}
                        </select>
                        {vrmCustomModels.length > 0 && (
                          <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {vrmCustomModels.map((model) => (
                              <span key={model} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
                                background: 'rgba(108,92,231,0.15)', color: 'rgba(255,255,255,0.7)',
                                border: '1px solid rgba(108,92,231,0.2)',
                              }}>
                                {model.replace('.vrm', '')}
                                <Trash2
                                  size={10}
                                  style={{ cursor: 'pointer', opacity: 0.6, transition: 'opacity 0.2s' }}
                                  onMouseEnter={(e) => e.target.style.opacity = 1}
                                  onMouseLeave={(e) => e.target.style.opacity = 0.6}
                                  onClick={() => handleVrmDelete(model)}
                                />
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Rendering Resolution (DPR) & FPS Limit */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' }}>
                          <div>
                            <span className="field-label" style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '3px' }}>
                              Resolution (DPR)
                            </span>
                            <select
                              value={settings.vrm_dpr || 1.5}
                              onChange={(e) => handleUpdateSetting('vrm_dpr', parseFloat(e.target.value))}
                              style={{
                                width: '100%',
                                padding: '7px 10px',
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px',
                                color: 'white',
                                fontSize: '0.78rem',
                                outline: 'none',
                                cursor: 'pointer'
                              }}
                            >
                              <option value={1.0} style={{ background: '#0b0813', color: 'white' }}>1.0 (Low VRAM)</option>
                              <option value={1.25} style={{ background: '#0b0813', color: 'white' }}>1.25 (Balanced)</option>
                              <option value={1.5} style={{ background: '#0b0813', color: 'white' }}>1.5 (High Quality)</option>
                              <option value={1.75} style={{ background: '#0b0813', color: 'white' }}>1.75 (Ultra Quality)</option>
                              <option value={2.0} style={{ background: '#0b0813', color: 'white' }}>2.0 (Max / Native)</option>
                            </select>
                          </div>

                          <div>
                            <span className="field-label" style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '3px' }}>
                              FPS Limit
                            </span>
                            <select
                              value={settings.vrm_fps || 40}
                              onChange={(e) => handleUpdateSetting('vrm_fps', parseInt(e.target.value, 10))}
                              style={{
                                width: '100%',
                                padding: '7px 10px',
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px',
                                color: 'white',
                                fontSize: '0.78rem',
                                outline: 'none',
                                cursor: 'pointer'
                              }}
                            >
                              {[30, 40, 45, 50, 55, 60].map((fps) => (
                                <option key={fps} value={fps} style={{ background: '#0b0813', color: 'white' }}>
                                  {fps} FPS
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Skin Tone Customization */}
                    <div className="identity-field" style={{ marginTop: '10px' }}>
                      <span className="field-label">Avatar Skin Color</span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px', alignItems: 'center' }}>
                        {SKIN_PRESETS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            onClick={() => onSkinToneChange && onSkinToneChange(preset.value)}
                            style={{
                              flex: '1 1 auto',
                              padding: '5px 8px',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              borderRadius: '6px',
                              border: skinToneColor.toLowerCase() === preset.value.toLowerCase() ? '2px solid #2dd4bf' : '1px solid rgba(255,255,255,0.15)',
                              background: preset.value === '#ffffff' ? '#ffffff' : preset.value,
                              color: preset.value === '#ffffff' || preset.value === '#FFE5E5' || preset.value === '#d89c7b' ? '#111' : '#fff',
                              cursor: 'pointer',
                              textAlign: 'center',
                              boxShadow: skinToneColor.toLowerCase() === preset.value.toLowerCase() ? '0 0 8px rgba(45, 212, 191, 0.4)' : 'none',
                              transition: 'all 0.15s'
                            }}
                          >
                            {preset.name}
                          </button>
                        ))}

                        {/* Custom Color Picker */}
                        <label
                          title="Pick custom skin color"
                          onClick={() => {
                            if (onSkinToneChange) onSkinToneChange(customSkinColor);
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            background: 'rgba(255,255,255,0.06)',
                            border: skinToneColor.toLowerCase() === customSkinColor.toLowerCase() || !SKIN_PRESETS.some(p => p.value.toLowerCase() === skinToneColor.toLowerCase()) ? '2px solid #2dd4bf' : '1px solid rgba(255,255,255,0.15)',
                            cursor: 'pointer',
                            fontSize: '0.68rem',
                            color: '#fff',
                            fontWeight: 600,
                            boxShadow: skinToneColor.toLowerCase() === customSkinColor.toLowerCase() || !SKIN_PRESETS.some(p => p.value.toLowerCase() === skinToneColor.toLowerCase()) ? '0 0 8px rgba(45, 212, 191, 0.4)' : 'none'
                          }}
                        >
                          <Palette className="w-3 h-3 text-purple-400" />
                          <span>Custom</span>
                          <input
                            type="color"
                            value={customSkinColor}
                            onChange={(e) => {
                              const newCustom = e.target.value;
                              setCustomSkinColor(newCustom);
                              try { localStorage.setItem('yuki-custom-skintone-color', newCustom); } catch {}
                              if (onSkinToneChange) onSkinToneChange(newCustom);
                            }}
                            style={{
                              width: '18px',
                              height: '18px',
                              padding: 0,
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              background: 'none'
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    {/* Camera Eye Tracking Toggle Banner */}
                    {(() => {
                      const isTrackingOn = cameraTracking !== undefined ? cameraTracking : localCameraTracking;
                      return (
                        <div style={{
                          background: isTrackingOn ? 'linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(56,189,248,0.15) 100%)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${isTrackingOn ? 'rgba(168,85,247,0.4)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: '14px',
                          padding: '12px 16px',
                          marginTop: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Eye className="w-5 h-5 text-purple-400" />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>Camera Eye & Gaze Tracking</div>
                              <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}>
                                Follows your cursor and turns head naturally. When disabled, Yuki keeps a fixed forward gaze.
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const val = !isTrackingOn;
                              setLocalCameraTracking(val);
                              try { localStorage.setItem('yuki-camera-tracking', val ? 'true' : 'false'); } catch {}
                              if (!window.yukiDebugToggles) window.yukiDebugToggles = {};
                              window.yukiDebugToggles.cameraTracking = val;
                              if (onCameraTrackingChange) onCameraTrackingChange(val);
                              if (window.electronAPI && window.electronAPI.setCameraTracking) {
                                window.electronAPI.setCameraTracking(val);
                              }
                            }}
                            style={{
                              background: isTrackingOn ? 'linear-gradient(135deg, #a855f7, #6366f1)' : 'rgba(255,255,255,0.08)',
                              border: `1px solid ${isTrackingOn ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.12)'}`,
                              borderRadius: '14px',
                              width: '44px',
                              height: '24px',
                              cursor: 'pointer',
                              position: 'relative',
                              transition: 'all 0.2s ease',
                              flexShrink: 0
                            }}
                          >
                            <div style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '50%',
                              background: '#fff',
                              position: 'absolute',
                              top: '2px',
                              left: isTrackingOn ? '22px' : '2px',
                              transition: 'all 0.2s ease',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                            }} />
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Dynamic Animations Toggles */}
                  <div className="card-group" style={{ marginTop: '12px' }}>
                    <div className="card-group-header">
                      <Cpu className="w-4 h-4 text-violet-400" />
                      <span className="card-group-title">Animations Toggle</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
                      {ANIMATIONS.map((anim) => {
                        const isEnabled = !disabledAnimations.includes(anim.name);
                        const displayName = anim.name
                          .split('_')
                          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                          .join(' ');
                        return (
                          <div key={anim.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0, 0, 0, 0.2)', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                            <span style={{ fontSize: '0.75rem', color: '#cbd5e1', fontWeight: '500' }}>{displayName}</span>
                            <input
                              type="checkbox"
                              style={{ cursor: 'pointer', accentColor: '#a855f7' }}
                              checked={isEnabled}
                              onChange={() => onToggleAnimation && onToggleAnimation(anim.name)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : activeTab === 'crawler' ? (
            <>
              {/* Crawler Diagnostics Group */}
              <div className="card-group">
                <div className="card-group-header teal">
                  <RefreshCw className="w-4 h-4" />
                  <span className="card-group-title">Background File Crawler</span>
                </div>

                {/* Crawler Status Stats */}
                <div className="spec-list-table" style={{ marginTop: '8px' }}>
                  <div className="spec-row">
                    <span className="spec-label">File Crawler Status</span>
                    <span className="spec-val font-semibold" style={{ color: crawlerStatus.paused ? '#c084fc' : (crawlerStatus.current_root_path && crawlerStatus.current_root_path !== 'Idle' ? '#38bdf8' : '#2dd4bf') }}>
                      {crawlerStatus.paused ? 'Paused' : (crawlerStatus.current_root_path && crawlerStatus.current_root_path !== 'Idle' ? `Scanning ${crawlerStatus.roots_current}/${crawlerStatus.roots_total}` : 'Idle / Watching')}
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Priority Scan Status</span>
                    <span className="spec-val font-semibold" style={{ color: crawlerStatus.first_time_priority_done ? '#2dd4bf' : '#38bdf8' }}>
                      {crawlerStatus.first_time_priority_done ? 'Completed' : 'Pending / Scanning'}
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Initial Full Cycle</span>
                    <span className="spec-val font-semibold" style={{ color: crawlerStatus.first_cycle_done ? '#2dd4bf' : '#38bdf8' }}>
                      {crawlerStatus.first_cycle_done ? 'Completed' : 'Scanning'}
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Real-time Watchdog</span>
                    <span className="spec-val font-semibold" style={{ color: crawlerStatus.watchdog_active ? '#2dd4bf' : '#ef4444' }}>
                      {crawlerStatus.watchdog_active ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">AI Tagger Status</span>
                    <span className="spec-val font-semibold" style={{ color: crawlerStatus.tagger_paused ? '#c084fc' : '#2dd4bf' }}>
                      {crawlerStatus.tagger_paused ? 'Paused' : 'Active / Enriching'}
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Total Indexed Files</span>
                    <span className="spec-val font-semibold">{crawlerStatus.total_files}</span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Pending AI Tags</span>
                    <span className="spec-val font-semibold">{crawlerStatus.pending_enrichment}</span>
                  </div>
                </div>

                {/* Crawler Buttons */}
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button
                    onClick={handleToggleCrawlerStatus}
                    className="glass-button"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '0.78rem',
                      borderRadius: '8px',
                      fontWeight: 600,
                      background: crawlerStatus.paused
                        ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'
                        : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: crawlerStatus.paused
                        ? '0 4px 12px rgba(124, 58, 237, 0.3)'
                        : '0 4px 12px rgba(239, 68, 68, 0.3)',
                      transition: 'all 0.2s'
                    }}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${!crawlerStatus.paused ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
                    <span>{crawlerStatus.paused ? 'Resume File Crawler' : 'Pause File Crawler'}</span>
                  </button>

                  <button
                    onClick={handleToggleTaggerStatus}
                    className="glass-button"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '0.78rem',
                      borderRadius: '8px',
                      fontWeight: 600,
                      background: crawlerStatus.tagger_paused
                        ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'
                        : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: crawlerStatus.tagger_paused
                        ? '0 4px 12px rgba(124, 58, 237, 0.3)'
                        : '0 4px 12px rgba(239, 68, 68, 0.3)',
                      transition: 'all 0.2s'
                    }}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${!crawlerStatus.tagger_paused ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
                    <span>{crawlerStatus.tagger_paused ? 'Resume Metadata Tagger' : 'Pause Metadata Tagger'}</span>
                  </button>

                  <button
                    onClick={handleTriggerRecrawl}
                    className="glass-button"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '0.78rem',
                      borderRadius: '8px',
                      fontWeight: 600,
                      background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: '0 4px 12px rgba(20, 184, 166, 0.3)',
                      transition: 'all 0.2s'
                    }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Force Full Recrawl</span>
                  </button>
                </div>
              </div>

              {/* Live Paths Diagnostic */}
              <div className="card-group" style={{ marginTop: '12px' }}>
                <div className="card-group-header">
                  <HardDrive className="w-4 h-4" />
                  <span className="card-group-title">Live Paths Diagnostic</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>1. File Crawler Walk Path:</span>
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        padding: '8px',
                        fontSize: '0.70rem',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        maxHeight: '80px',
                        overflowY: 'auto',
                        color: '#cbd5e1',
                        lineHeight: '1.3',
                        marginTop: '2px'
                      }}
                    >
                      {crawlerStatus.current_path || 'Idle'}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>2. AI Metadata Tagger Path:</span>
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        padding: '8px',
                        fontSize: '0.70rem',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        maxHeight: '80px',
                        overflowY: 'auto',
                        color: '#cbd5e1',
                        lineHeight: '1.3',
                        marginTop: '2px'
                      }}
                    >
                      {crawlerStatus.current_tagger_path || 'Idle'}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>3. Completed Target Roots ({crawlerStatus.completed_roots?.length || 0}):</span>
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        padding: '8px',
                        fontSize: '0.70rem',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        maxHeight: '60px',
                        overflowY: 'auto',
                        color: '#cbd5e1',
                        lineHeight: '1.3',
                        marginTop: '2px'
                      }}
                    >
                      {crawlerStatus.completed_roots && crawlerStatus.completed_roots.length > 0
                        ? crawlerStatus.completed_roots.join(', ')
                        : 'None'}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>4. Remaining Target Roots ({crawlerStatus.remaining_roots?.length || 0}):</span>
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        padding: '8px',
                        fontSize: '0.70rem',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        maxHeight: '60px',
                        overflowY: 'auto',
                        color: '#cbd5e1',
                        lineHeight: '1.3',
                        marginTop: '2px'
                      }}
                    >
                      {crawlerStatus.remaining_roots && crawlerStatus.remaining_roots.length > 0
                        ? crawlerStatus.remaining_roots.join(', ')
                        : 'None'}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Registered LLM Tools List Card */}
              <div className="card-group" style={{ marginBottom: '12px' }}>
                <div className="card-group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Zap className="w-4 h-4 text-violet-400" />
                    <span className="card-group-title">Registered LLM Tools</span>
                  </div>
                  <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)', color: '#c084fc', fontWeight: 600 }}>
                    {toolsList.length} Active Tools
                  </span>
                </div>

                {/* Tool Search Input */}
                <div style={{ marginTop: '8px', marginBottom: '8px' }}>
                  <input
                    type="text"
                    placeholder="Search tools or parameters..."
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    className="glass-input"
                    style={{ width: '100%', padding: '6px 10px', fontSize: '0.75rem' }}
                  />
                </div>

                {/* Tool List Render */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
                  {toolsList
                    .filter(t => !toolSearch || t.name.toLowerCase().includes(toolSearch.toLowerCase()) || t.description.toLowerCase().includes(toolSearch.toLowerCase()))
                    .map((tool) => {
                      const isExpanded = expandedTool === tool.name;
                      const paramEntries = Object.entries(tool.parameters || {});
                      return (
                        <div
                          key={tool.name}
                          style={{
                            background: 'rgba(0, 0, 0, 0.25)',
                            border: `1px solid ${isExpanded ? 'rgba(139,92,246,0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                            borderRadius: '8px',
                            padding: '8px 10px',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <div
                            onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#a78bfa', fontFamily: 'monospace' }}>{tool.name}</span>
                                <span style={{ fontSize: '0.62rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>
                                  {tool.category || 'System'}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px', lineHeight: '1.3' }}>
                                {tool.description}
                              </div>
                            </div>
                            <ChevronDown style={{ width: '14px', height: '14px', color: '#94a3b8', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', flexShrink: 0 }} />
                          </div>

                          {/* Expanded Parameters Breakdown */}
                          {isExpanded && (
                            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#2dd4bf', marginBottom: '6px' }}>
                                Accepting Parameters ({paramEntries.length}):
                              </div>
                              {paramEntries.length === 0 ? (
                                <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                                  No arguments required (takes empty payload).
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {paramEntries.map(([pName, pDef]) => {
                                    const isReq = (tool.required_parameters || []).includes(pName);
                                    return (
                                      <div key={pName} style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                          <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#38bdf8', fontWeight: 600 }}>{pName}</span>
                                          <div style={{ display: 'flex', gap: '4px' }}>
                                            <span style={{ fontSize: '0.6rem', padding: '0 4px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}>
                                              {pDef.type || 'string'}
                                            </span>
                                            {isReq && (
                                              <span style={{ fontSize: '0.6rem', padding: '0 4px', borderRadius: '4px', background: 'rgba(239,68,68,0.2)', color: '#fca5a5', fontWeight: 600 }}>
                                                required
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        {pDef.description && (
                                          <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}>
                                            {pDef.description}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Connection Specs */}
              <div className="card-group">
                <div className="card-group-header teal">
                  <HardDrive className="w-4 h-4" />
                  <span className="card-group-title">Platform Specifications</span>
                </div>

                <div className="spec-list-table">
                  <div className="spec-row">
                    <span className="spec-label">LLM Backend</span>
                    <span className="spec-val" style={{ fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all' }}>
                      {settings.llm_backend || 'lmstudio'}
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">LLM Endpoint</span>
                    <span className="spec-val" style={{ fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all' }}>
                      {settings.llm_base_url || lmstudioUrl || 'http://127.0.0.1:1234'}
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Active LLM Model</span>
                    <span className="spec-val" style={{ fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all' }}>
                      {settings.llm_model || modelName || 'Default'}
                    </span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-label">Host OS</span>
                    <span className="spec-val">{hostPlatform}</span>
                  </div>

                </div>
              </div>

              {/* GPU Memory Usage */}
              <div className="card-group" style={{ marginTop: '12px' }}>
                <div className="card-group-header">
                  <Monitor className="w-4 h-4 text-emerald-400" />
                  <span className="card-group-title">GPU Memory Usage</span>
                </div>

                {gpuMemData.error && (
                  <div style={{ fontSize: '0.68rem', color: '#f87171', marginTop: '6px' }}>
                    {gpuMemData.error}
                  </div>
                )}

                {!gpuMemData.error && Object.keys(gpuMemData.top5 || {}).length === 0 && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                    No GPU process data available
                  </div>
                )}

                {Object.entries(gpuMemData.top5 || {}).map(([gpuName, procs]) => (
                  <div key={gpuName} style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#5eead4', marginBottom: '4px' }}>
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
                          <div key={`${p.pid}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) 90px 90px', gap: '0', padding: '3px 8px', fontSize: '0.72rem', color: '#cbd5e1', borderTop: i > 0 ? '1px solid rgba(255, 255, 255, 0.03)' : 'none' }}>
                            <span>
                              <span style={{ color: 'var(--text-muted)', fontSize: '9px', marginRight: '4px' }}>{p.pid}</span>
                              {p.name}
                            </span>
                            <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.68rem' }}>
                              {p.dedicated_mb >= 1024 ? `${(p.dedicated_mb / 1024).toFixed(1)} GB` : `${p.dedicated_mb} MB`}
                            </span>
                            <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.68rem' }}>
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

        {/* Footer */}
        <div className="dashboard-footer">
          Yuki Desktop Companion v1.0.0 (Agentic Node)
        </div>
      </div>
    </>
  );
};

export default ControlDashboard;
