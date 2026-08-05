import React, { useState, useEffect, useRef } from 'react';
import { Settings, Cpu, HardDrive, User, Database, Trash2, RefreshCw, ChevronDown, CheckCircle, Zap, Volume2, VolumeX, UserCheck, Plus, Trash, Mic, Upload, Download, Monitor, Sparkles, Brain, Palette, MessageSquare, Clock, Power, Sliders, BellOff, Layout, Play, Square, Music, Eye, EyeOff, Wrench, History, Search } from 'lucide-react';
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

export const SearchableModelSelect = ({ value, onChange, options = [], placeholder = "Select or search a model..." }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = (options || []).filter(opt =>
    !searchTerm || opt.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', marginTop: '4px' }}>
      {/* Trigger Box */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'rgba(15, 23, 42, 0.75)',
          border: isOpen ? '1.5px solid #a78bfa' : '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: '9px',
          color: value ? '#f8fafc' : '#94a3b8',
          fontSize: '0.78rem',
          fontWeight: value ? '500' : '400',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
          boxShadow: isOpen ? '0 0 14px rgba(167, 139, 250, 0.3)' : 'none',
          transition: 'all 0.2s ease',
          boxSizing: 'border-box'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '88%', lineHeight: '1.4' }}>
          {value || placeholder}
        </span>
        <span style={{ fontSize: '0.65rem', color: isOpen ? '#a78bfa' : 'rgba(255,255,255,0.4)', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▼
        </span>
      </div>

      {/* Dropdown Floating Panel */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          right: 0,
          zIndex: 99999,
          background: '#0b0f19',
          border: '1.5px solid rgba(167, 139, 250, 0.45)',
          borderRadius: '10px',
          padding: '8px',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.85), 0 0 16px rgba(167, 139, 250, 0.15)',
          backdropFilter: 'blur(20px)',
          boxSizing: 'border-box'
        }}>
          {/* Search Box */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(167, 139, 250, 0.25)',
            borderRadius: '7px',
            marginBottom: '8px'
          }}>
            <Search style={{ width: '13px', height: '13px', color: '#c4b5fd', flexShrink: 0 }} />
            <input
              type="text"
              autoFocus
              placeholder="Filter model name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#ffffff',
                fontSize: '0.78rem',
                lineHeight: '1.4',
                outline: 'none',
                fontFamily: 'inherit'
              }}
            />
            {searchTerm && (
              <span
                onClick={() => setSearchTerm('')}
                style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#94a3b8', padding: '0 2px' }}
              >
                ✕
              </span>
            )}
          </div>

          {/* Options Scroll Container */}
          <div style={{
            maxHeight: '210px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            paddingRight: '2px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(167, 139, 250, 0.4) transparent'
          }}>
            {searchTerm.trim() && !options.includes(searchTerm.trim()) && (
              <button
                type="button"
                onClick={() => {
                  onChange(searchTerm.trim());
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  fontSize: '0.73rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  background: 'rgba(167, 139, 250, 0.2)',
                  border: '1px dashed #a78bfa',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  marginBottom: '4px',
                  textAlign: 'left'
                }}
              >
                ✨ Use custom model: "{searchTerm.trim()}"
              </button>
            )}
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '12px 8px', fontSize: '0.74rem', color: '#94a3b8', textAlign: 'center', lineHeight: '1.4' }}>
                No model matches "{searchTerm}".
                <button
                  type="button"
                  onClick={() => {
                    onChange(searchTerm);
                    setIsOpen(false);
                  }}
                  style={{
                    display: 'block',
                    margin: '8px auto 0 auto',
                    padding: '5px 12px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    borderRadius: '6px',
                    background: 'rgba(167, 139, 250, 0.25)',
                    border: '1px solid #a78bfa',
                    color: '#ffffff',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  Use "{searchTerm}" as custom model
                </button>
              </div>
            ) : (
              filteredOptions.map((mName) => {
                const isSelected = value === mName;
                return (
                  <div
                    key={mName}
                    onClick={() => {
                      onChange(mName);
                      setIsOpen(false);
                      setSearchTerm('');
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '7px',
                      fontSize: '0.78rem',
                      lineHeight: '1.4',
                      minHeight: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(167, 139, 250, 0.28)' : 'transparent',
                      border: isSelected ? '1px solid rgba(167, 139, 250, 0.5)' : '1px solid transparent',
                      color: isSelected ? '#ffffff' : '#cbd5e1',
                      fontWeight: isSelected ? '600' : '400',
                      wordBreak: 'break-all',
                      transition: 'all 0.15s ease',
                      boxSizing: 'border-box'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                        e.currentTarget.style.color = '#ffffff';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#cbd5e1';
                      }
                    }}
                  >
                    {mName}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

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
  availableSimpleLlmModels = [],
  onRefreshLlmModels,
  onRefreshSimpleLlmModels,
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
  const refreshTimerRef = useRef(null);
  const refreshSimpleTimerRef = useRef(null);

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
      testCtxRef.current.close().catch(() => { });
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
    try { localStorage.setItem('yuki-avatar-scale', val.toString()); } catch { }
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
    send_tools_in_simple: false,
    endpoint_strategy: 'single',
    llm_simple_backend: 'lmstudio',
    llm_simple_base_url: 'http://127.0.0.1:1234',
    llm_simple_api_key: '',
    llm_simple_model: '',
    llm_vision_model: '',
    always_included_tools: [],
    blocked_tools: [],
    tts_voice: 'af_bella',
    tts_rate: 'auto',
    tts_device: 'auto',
    stt_device: 'auto',
    character_name: 'Yuki',
    character_persona: '',
    crawler_paused: false,
    tagger_paused: false,
    active_vrm_model: 'default.vrm',
    whisper_model: 'base',
    use_local_whisper: true,
    stt_language: 'en',
    whisper_idle_timeout: 300,
    whisper_vram_threshold: 90,
    whisper_auto_unload: true,
    // Cloud provider settings
    stt_provider: 'local',
    stt_cloud_api_key: '',
    stt_cloud_endpoint: '',
    stt_cloud_region: 'eastus',
    tts_provider: 'local',
    tts_cloud_api_key: '',
    tts_cloud_endpoint: '',
    tts_cloud_region: 'eastus',
    tts_cloud_voice: '',
    no_llm_mode: false
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

  // Cloud provider key visibility toggles
  const [showSttKey, setShowSttKey] = useState(false);
  const [showTtsKey, setShowTtsKey] = useState(false);
  // Cloud provider config panel open state
  const [sttCloudOpen, setSttCloudOpen] = useState(false);
  const [ttsCloudOpen, setTtsCloudOpen] = useState(false);
  // Pending cloud key edits (not saved until Confirm)
  const [pendingSttKey, setPendingSttKey] = useState('');
  const [pendingTtsKey, setPendingTtsKey] = useState('');

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
  const [blockedToolsList, setBlockedToolsList] = useState([]);
  const [expandedTool, setExpandedTool] = useState(null);
  const [toolSearch, setToolSearch] = useState('');

  // Custom LLM Endpoints & Presets State
  const [customLabel, setCustomLabel] = useState('');
  const [selectedEndpointId, setSelectedEndpointId] = useState('');
  const [customSimpleLabel, setCustomSimpleLabel] = useState('');
  const [selectedSimpleEndpointId, setSelectedSimpleEndpointId] = useState('');
  const [savedCustomEndpoints, setSavedCustomEndpoints] = useState([]);
  const [showComplexApiKey, setShowComplexApiKey] = useState(false);
  const [showSimpleApiKey, setShowSimpleApiKey] = useState(false);
  const [saveEndpointBtnText, setSaveEndpointBtnText] = useState('Save Endpoint Preset');
  const [saveSimpleEndpointBtnText, setSaveSimpleEndpointBtnText] = useState('Save Preset');

  // Export & Import File Input Refs & Handlers
  const personaFileInputRef = useRef(null);
  const settingsFileInputRef = useRef(null);
  const crawlerFileInputRef = useRef(null);

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
        if (fetchProfile) fetchProfile();
      } else {
        alert(`Import failed: ${data.detail || 'Invalid persona format'}`);
      }
    } catch (err) {
      alert(`Error importing persona: ${err.message}`);
    }
    e.target.value = '';
  };

  const handleExportSettings = () => {
    window.location.href = `${API_BASE}/api/settings/export`;
  };

  const handleImportSettingsFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const jsonPayload = JSON.parse(text);
      const res = await fetch(`${API_BASE}/api/settings/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonPayload)
      });
      const data = await res.json();
      if (res.ok) {
        alert('✓ Application settings imported successfully!');
        if (fetchProfile) fetchProfile();
      } else {
        alert(`Import failed: ${data.detail || 'Invalid settings format'}`);
      }
    } catch (err) {
      alert(`Error importing settings: ${err.message}`);
    }
    e.target.value = '';
  };

  const handleExportCrawlerData = () => {
    window.location.href = `${API_BASE}/api/crawler/export`;
  };

  const handleImportCrawlerFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const jsonPayload = JSON.parse(text);
      const res = await fetch(`${API_BASE}/api/crawler/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonPayload)
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✓ Crawler database imported successfully!\n(${data.stats?.files_imported || 0} files, ${data.stats?.metadata_imported || 0} metadata records)`);
        if (fetchCrawlerStatus) fetchCrawlerStatus();
      } else {
        alert(`Import failed: ${data.detail || 'Invalid crawler data format'}`);
      }
    } catch (err) {
      alert(`Error importing crawler data: ${err.message}`);
    }
    e.target.value = '';
  };

  const handleToggleSimpleApiKey = async () => {
    const nextState = !showSimpleApiKey;
    if (nextState && settings.llm_simple_api_key && typeof settings.llm_simple_api_key === 'string' && settings.llm_simple_api_key.startsWith('enc_v1:')) {
      try {
        const res = await fetch(`${API_BASE}/api/settings/decrypt-key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: settings.llm_simple_api_key })
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.decrypted) {
            setSettings(prev => ({ ...prev, llm_simple_api_key: data.decrypted }));
          }
        }
      } catch (e) {
        console.error("Failed to decrypt simple key:", e);
      }
    }
    setShowSimpleApiKey(nextState);
  };

  const handleToggleComplexApiKey = async () => {
    const nextState = !showComplexApiKey;
    if (nextState && settings.llm_api_key && typeof settings.llm_api_key === 'string' && settings.llm_api_key.startsWith('enc_v1:')) {
      try {
        const res = await fetch(`${API_BASE}/api/settings/decrypt-key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: settings.llm_api_key })
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.decrypted) {
            setSettings(prev => ({ ...prev, llm_api_key: data.decrypted }));
          }
        }
      } catch (e) {
        console.error("Failed to decrypt complex key:", e);
      }
    }
    setShowComplexApiKey(nextState);
  };

  const fetchSavedEndpoints = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.endpoints) {
          setSavedCustomEndpoints(data.endpoints);
          // Sync selected ID with current settings base_url
          const currentUrl = settings.llm_base_url;
          const active = data.endpoints.find(e => e.base_url && currentUrl && e.base_url.replace(/\/$/, '') === currentUrl.replace(/\/$/, ''));
          const prevSelectedId = selectedEndpointId;
          if (active) {
            if (prevSelectedId && prevSelectedId !== active.id) {
              console.warn(`[VAULT-SYNC] ⚠️ Auto-sync CHANGING selectedEndpointId: "${prevSelectedId}" → "${active.id}" (label="${active.label}") because URL="${currentUrl}" matched this endpoint`);
            }
            setSelectedEndpointId(active.id);
            if (!customLabel) setCustomLabel(active.label);
          } else if (prevSelectedId) {
            console.warn(`[VAULT-SYNC] ⚠️ No endpoint matches current URL="${currentUrl}" — selectedEndpointId="${prevSelectedId}" will remain (may be stale)`);
          }
          const activeSimple = data.endpoints.find(e => e.base_url && settings.llm_simple_base_url && e.base_url.replace(/\/$/, '') === settings.llm_simple_base_url.replace(/\/$/, ''));
          if (activeSimple) {
            setSelectedSimpleEndpointId(activeSimple.id);
            if (!customSimpleLabel) setCustomSimpleLabel(activeSimple.label);
          }
        }
      }
    } catch (e) {
      console.warn("[VAULT-SYNC] Failed to fetch custom endpoints:", e);
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
          id: selectedEndpointId || '',
          label: labelToSave,
          base_url: baseUrlToSave,
          api_key: settings.llm_api_key || '',
          llm_backend: settings.llm_backend || 'openai',
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSavedCustomEndpoints(data.endpoints || []);
        setCustomLabel(labelToSave);
        if (data.saved && data.saved.id) {
          setSelectedEndpointId(data.saved.id);
        }
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

  const handleSaveSimpleCustomEndpoint = async () => {
    const labelToSave = customSimpleLabel.trim() || autoSuggestLabel(settings.llm_simple_base_url) || 'Simple Custom Endpoint';
    const baseUrlToSave = settings.llm_simple_base_url || '';
    if (!baseUrlToSave) {
      alert("Please enter a valid Simple Endpoint Base URL before saving.");
      return;
    }
    setSaveSimpleEndpointBtnText("Saving...");
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedSimpleEndpointId || '',
          label: labelToSave,
          base_url: baseUrlToSave,
          api_key: settings.llm_simple_api_key || '',
          llm_backend: settings.llm_simple_backend || 'openai',
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSavedCustomEndpoints(data.endpoints || []);
        setCustomSimpleLabel(labelToSave);
        if (data.saved && data.saved.id) {
          setSelectedSimpleEndpointId(data.saved.id);
        }
        setSaveSimpleEndpointBtnText("✓ Saved to DB");
        setTimeout(() => setSaveSimpleEndpointBtnText('Save Preset'), 2500);
      } else {
        setSaveSimpleEndpointBtnText("Save Failed");
        setTimeout(() => setSaveSimpleEndpointBtnText('Save Preset'), 2000);
      }
    } catch (e) {
      console.error("Failed to save simple custom endpoint:", e);
      setSaveSimpleEndpointBtnText("Error Saving");
      setTimeout(() => setSaveSimpleEndpointBtnText('Save Preset'), 2000);
    }
  };

  const handleDeleteCustomEndpoint = async (epId) => {
    const targetId = epId || selectedEndpointId;
    const targetEp = savedCustomEndpoints.find(e => e.id === targetId || e.label === customLabel || e.label === customSimpleLabel);
    if (!targetEp) {
      alert("Please select a saved preset to delete.");
      return;
    }
    if (!confirm(`Delete saved endpoint "${targetEp.label}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: targetEp.id, label: targetEp.label })
      });
      if (res.ok) {
        const data = await res.json();
        setSavedCustomEndpoints(data.endpoints || []);
        if (selectedEndpointId === targetEp.id) setSelectedEndpointId('');
        if (selectedSimpleEndpointId === targetEp.id) setSelectedSimpleEndpointId('');
        if (customLabel === targetEp.label) setCustomLabel('');
        if (customSimpleLabel === targetEp.label) setCustomSimpleLabel('');
      }
    } catch (e) {
      console.error("Failed to delete custom endpoint:", e);
    }
  };

  const handleSelectCustomEndpoint = async (ep, targetType = 'complex') => {
    if (!ep) return;
    console.log(`[VAULT-SELECT] ⚡ Selecting preset: label="${ep.label}" id="${ep.id}" targetType="${targetType}" base_url="${ep.base_url}"`);
    console.log(`[VAULT-SELECT] Before: settings.llm_base_url="${settings.llm_base_url}" settings.llm_api_key="${settings.llm_api_key?.substring(0, 15)}..." settings.llm_backend="${settings.llm_backend}"`);
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ep.id, label: ep.label, target_type: targetType })
      });
      const data = res.ok ? await res.json() : null;
      console.log(`[VAULT-SELECT] Backend response:`, data ? { message: data.message, api_key_decrypted: data.api_key_decrypted?.substring(0, 15) + '...', base_url: data.base_url, backend: data.backend } : 'null');
      const keyToUse = (data && data.active_endpoint && data.active_endpoint.api_key) || ep.api_key || '';
      console.log(`[VAULT-SELECT] keyToUse="${keyToUse?.substring(0, 15)}..."`);

      if (targetType === 'simple') {
        setSelectedSimpleEndpointId(ep.id || '');
        setCustomSimpleLabel(ep.label || '');
        const newSettings = {
          ...settings,
          llm_simple_backend: ep.llm_backend === 'openai' ? 'custom' : (ep.llm_backend || 'custom'),
          llm_simple_base_url: ep.base_url || '',
          llm_simple_api_key: keyToUse,
        };
        console.log(`[VAULT-SELECT] Setting simple: base_url="${newSettings.llm_simple_base_url}" backend="${newSettings.llm_simple_backend}"`);
        setSettings(newSettings);
        if (onRefreshSimpleLlmModels) {
          setTimeout(() => onRefreshSimpleLlmModels(), 400);
        }
      } else {
        setSelectedEndpointId(ep.id || '');
        setCustomLabel(ep.label || '');
        const newSettings = {
          ...settings,
          llm_backend: ep.llm_backend === 'openai' ? 'custom' : (ep.llm_backend || 'custom'),
          llm_base_url: ep.base_url || '',
          llm_api_key: keyToUse,
          llm_model: ep.model || settings.llm_model
        };
        console.log(`[VAULT-SELECT] Setting complex: base_url="${newSettings.llm_base_url}" backend="${newSettings.llm_backend}" model="${newSettings.llm_model}"`);
        setSettings(newSettings);
        await handleUpdateSetting({
          llm_backend: newSettings.llm_backend,
          llm_base_url: newSettings.llm_base_url,
          llm_api_key: newSettings.llm_api_key,
        });
        if (onRefreshLlmModels) {
          setTimeout(() => onRefreshLlmModels(), 400);
        }
      }
    } catch (e) {
      console.error("[VAULT-SELECT] ❌ Failed to select custom endpoint:", e);
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
    playfulness: 55,
    horniness: 50,
    anger: 10
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
  const [, setTick] = useState(0); // forces re-render every second for live stopwatch display

  // API call with cache: 'no-store' to guarantee fresh SQLite data.
  // This prevents the UI from showing deleted items because the browser/fetch
  // can't reuse a cached 200 response for the same URL.
  const fetchTimeItems = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/reminders/active`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setTimeItems(data);
      }
    } catch (e) {
      console.warn("Could not fetch active time items:", e);
    }
  };

  // 1-second tick so stopwatches update live in the UI without extra network calls
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

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
    try { localStorage.setItem('yuki-os-native-alarms', val.toString()); } catch { }
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

  const handlePauseStopwatchUI = async (lbl) => {
    try {
      await fetch(`${API_BASE}/api/reminders/stopwatch/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: lbl })
      });
      fetchTimeItems();
    } catch (e) {
      console.error("Failed to pause stopwatch:", e);
    }
  };

  const handleResumeStopwatchUI = async (lbl) => {
    try {
      await fetch(`${API_BASE}/api/reminders/stopwatch/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: lbl })
      });
      fetchTimeItems();
    } catch (e) {
      console.error("Failed to resume stopwatch:", e);
    }
  };

  const handleResetStopwatchUI = async (lbl) => {
    try {
      await fetch(`${API_BASE}/api/reminders/stopwatch/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: lbl })
      });
      fetchTimeItems();
    } catch (e) {
      console.error("Failed to reset stopwatch:", e);
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

  // ── Scheduled Tasks (Autonomous) ───────────────────────────────────────
  const SCHED_CONDITIONS = {
    process: ['gone', 'present'],
    window: ['closed', 'open'],
    file: ['changed', 'exists', 'deleted'],
    command: ['exit0', 'exit_nonzero'],
  };
  const SCHED_MONITOR_PLACEHOLDERS = {
    process: 'PID or process name (e.g. 8412, chrome)',
    window: 'Window title fragment (e.g. Notepad)',
    file: 'Full file path (e.g. C:/logs/app.log)',
    command: 'Command whose exit code decides (e.g. exit 0)',
  };

  const [scheduledTasks, setScheduledTasks] = useState([]);
  const [schedMsg, setSchedMsg] = useState(null); // { type: 'ok'|'error', text }
  const [schedForm, setSchedForm] = useState({
    type: 'delayed',            // delayed | interval | watcher
    seconds: '30',              // in-seconds (delayed) / every-seconds (interval, watcher poll)
    repeatForever: true,        // interval + watcher
    count: '1',
    monitorType: 'process',
    target: '',
    fireCondition: 'gone',
    actionType: 'shell',        // shell | tool | power
    command: '',
    toolName: '',
    argsJson: '',
    powerAction: 'shutdown',
    confirmDestructive: false,
  });
  const [schedCreating, setSchedCreating] = useState(false);

  const setSched = (patch) => setSchedForm(prev => ({ ...prev, ...patch }));

  const fetchScheduledTasks = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/scheduled-tasks`);
      if (res.ok) {
        const data = await res.json();
        setScheduledTasks((data && data.tasks) || []);
      }
    } catch (e) {
      console.warn("Could not fetch scheduled tasks:", e);
    }
  };

  const schedActionIsDestructive = () => {
    if (schedForm.actionType === 'power') return true;
    if (schedForm.actionType === 'shell') {
      const cmd = (schedForm.command || '').toLowerCase();
      return /shutdown|restart|reboot|\bdel\b|rmdir|rm\s+-rf|format|rd\s+\/s|remove-item/i.test(cmd);
    }
    if (schedForm.actionType === 'tool') {
      const tn = (schedForm.toolName || '').toLowerCase();
      return tn === 'system_power_control' || tn.includes('power');
    }
    return false;
  };
  const destructive = schedActionIsDestructive();

  const schedFormValid = () => {
    if (!(parseFloat(schedForm.seconds) > 0)) return false;
    if (schedForm.type === 'watcher' && !schedForm.target.trim()) return false;
    if (schedForm.actionType === 'shell' && !schedForm.command.trim()) return false;
    if (schedForm.actionType === 'tool' && !schedForm.toolName) return false;
    if (destructive && !schedForm.confirmDestructive) return false;
    return true;
  };

  const handleCreateScheduledTask = async () => {
    if (!schedFormValid() || schedCreating) return;
    let args = {};
    if (schedForm.argsJson && schedForm.argsJson.trim()) {
      try {
        args = JSON.parse(schedForm.argsJson.trim());
      } catch (e) {
        setSchedMsg({ type: 'error', text: 'Action args must be valid JSON.' });
        return;
      }
    }
    const base = {
      action_type: schedForm.actionType,
      action_command: schedForm.actionType === 'shell' ? schedForm.command.trim() : null,
      action_tool: schedForm.actionType === 'tool' ? schedForm.toolName : null,
      action_args: schedForm.actionType === 'power' ? { action: schedForm.powerAction } : args,
      confirm_destructive: schedForm.confirmDestructive,
    };
    let endpoint = '';
    let body = {};
    if (schedForm.type === 'delayed') {
      endpoint = `${API_BASE}/api/scheduled-tasks/delayed`;
      body = { ...base, seconds: parseFloat(schedForm.seconds) };
    } else if (schedForm.type === 'interval') {
      endpoint = `${API_BASE}/api/scheduled-tasks/interval`;
      body = { ...base, interval_seconds: parseFloat(schedForm.seconds), count: schedForm.repeatForever ? null : parseInt(schedForm.count || '1', 10) };
    } else {
      endpoint = `${API_BASE}/api/scheduled-tasks/watcher`;
      body = {
        ...base,
        monitor_type: schedForm.monitorType,
        target: schedForm.target.trim(),
        interval_seconds: parseFloat(schedForm.seconds),
        fire_condition: schedForm.fireCondition,
        count: schedForm.repeatForever ? null : parseInt(schedForm.count || '1', 10),
      };
    }
    setSchedCreating(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data && data.ok) {
        setSchedMsg({ type: 'ok', text: `Scheduled task #${data.task.id} created.` });
        setSchedForm(prev => ({ ...prev, target: '', command: '', argsJson: '', confirmDestructive: false }));
        fetchScheduledTasks();
      } else {
        setSchedMsg({ type: 'error', text: (data && data.error) || 'Failed to create scheduled task.' });
      }
    } catch (e) {
      setSchedMsg({ type: 'error', text: 'Network error creating scheduled task.' });
    }
    setSchedCreating(false);
  };

  const handleCancelScheduledTask = async (id) => {
    try {
      await fetch(`${API_BASE}/api/scheduled-tasks/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: id })
      });
      fetchScheduledTasks();
    } catch (e) {
      console.error("Failed to cancel scheduled task:", e);
    }
  };

  const schedCountdown = (t) => {
    if (!t || t.remaining_seconds == null) return '';
    const rem = Math.max(0, t.remaining_seconds);
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const [toolViewMode, setToolViewMode] = useState('active');

  const fetchToolsList = (mode = toolViewMode) => {
    const query = mode && mode !== 'active' ? `?mode=${mode}` : '';
    fetch(`${API_BASE}/api/tools${query}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.tools) {
          setToolsList(data.tools);
        }
      })
      .catch(err => console.error("Failed to fetch tools list:", err));
  };

  // Full (basic + advanced + MCP) tool list for the blacklist selector, which
  // shows in every mode so users can block any tool regardless of the active mode.
  const fetchBlockedToolsList = () => {
    fetch(`${API_BASE}/api/tools?mode=all`)
      .then(res => res.json())
      .then(data => {
        if (data && data.tools) {
          setBlockedToolsList(data.tools);
        }
      })
      .catch(err => console.error("Failed to fetch blocked-tools list:", err));
  };

  useEffect(() => {
    fetchSavedEndpoints();
  }, []);

  // Live mood_update WS listener — replaces polling while the dashboard is open
  useEffect(() => {
    const handleWsMoodUpdate = (e) => {
      try {
        const msg = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
        if (msg && msg.type === 'mood_update' && msg.mood) {
          setMoodData(prev => ({ ...prev, ...msg.mood }));
        }
      } catch (_) { }
    };
    window.addEventListener('yuki_ws_message', handleWsMoodUpdate);
    return () => window.removeEventListener('yuki_ws_message', handleWsMoodUpdate);
  }, []);

  // Live stopwatch WS listener — keeps Tasks tab in sync with the overlay window
  useEffect(() => {
    const handleWsStopwatchUpdate = (e) => {
      try {
        const msg = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
        console.log('[Tasks tab] stopwatch event received. isOpen:', isOpen, 'activeTab:', activeTab);
        if (msg && (msg.type === 'stopwatch_changed' || msg.type === 'stopwatch_started')) {
          if (isOpen && activeTab === 'tasks') {
            fetchTimeItems();
          }
        }
      } catch (_) { }
    };
    window.addEventListener('yuki_ws_message', handleWsStopwatchUpdate);
    return () => window.removeEventListener('yuki_ws_message', handleWsStopwatchUpdate);
  }, [isOpen, activeTab]);

  useEffect(() => {
    let interval = null;
    if (isOpen) {
      fetchSavedEndpoints();
      fetchToolsList();
      fetchBlockedToolsList();

      if (activeTab === 'memory') {
        fetchMood();
        if (onProfileUpdate) {
          onProfileUpdate();
        }
      }

      if (activeTab === 'tasks') {
        fetchTimeItems();
        fetchScheduledTasks();
      }

      interval = setInterval(() => {
        if (activeTab === 'memory') {
          fetchMood();
          if (onProfileUpdate) {
            onProfileUpdate();
          }
        }
        // Tasks tab: no polling — data is fetched once on open and after each user action.
        // The 1-second setTick above handles smooth live display using local clock math.
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (isOpen && (settings.tool_mode || 'basic') === 'advanced') {
      const hasJarvis = (toolsList || []).some(t => String(t.name || '').startsWith('jarvis_'));
      if (!hasJarvis) fetchToolsList('advanced');
    }
  }, [isOpen, settings.tool_mode, toolsList]);

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
    { label: 'Auto (Mood)', value: 'auto' },
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

  const handleUpdateSetting = async (keyOrObj, value) => {
    const updates = typeof keyOrObj === 'object' && keyOrObj !== null ? keyOrObj : { [keyOrObj]: value };
    const updateKeys = Object.keys(updates);
    console.log(`[SETTINGS-UPDATE] ⚡ Sending:`, JSON.stringify(updates).substring(0, 200));

    // Snapshot before optimistic update
    const prevBaseUrl = settings.llm_base_url;
    const prevApiKey = settings.llm_api_key?.substring(0, 15);

    setSettings(prev => ({ ...prev, ...updates }));
    if (updates.tool_mode) {
      setTimeout(() => fetchToolsList(), 100);
    }
    try {
      const res = await fetch(`${API_BASE}/api/settings/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.settings) {
          // Log what changed between server response and local state
          const serverUrl = data.settings.llm_base_url;
          const serverKey = data.settings.llm_api_key?.substring(0, 15);
          if (serverUrl !== prevBaseUrl) {
            console.warn(`[SETTINGS-UPDATE] ⚠️ SERVER llm_base_url CHANGED: "${prevBaseUrl}" → "${serverUrl}" (sent keys: ${updateKeys.join(',')})`);
          }
          if (serverKey !== prevApiKey) {
            console.warn(`[SETTINGS-UPDATE] ⚠️ SERVER llm_api_key CHANGED: "${prevApiKey}..." → "${serverKey}..."`);
          }
          if (updateKeys.includes('llm_api_key') && serverUrl !== updates.llm_base_url) {
            console.error(`[SETTINGS-UPDATE] ❌ REVERT DETECTED! Sent llm_base_url="${updates.llm_base_url || '(not sent)'}" but server returned llm_base_url="${serverUrl}"`);
          }
          console.log(`[SETTINGS-UPDATE] Server response llm_base_url="${serverUrl}" llm_backend="${data.settings.llm_backend}"`);
          setSettings(prev => ({ ...prev, ...data.settings }));
        }
        if (updates.tool_mode) {
          fetchToolsList();
        }
        if (['llm_simple_backend', 'llm_simple_base_url', 'llm_simple_api_key'].some(k => k in updates)) {
          if (onRefreshSimpleLlmModels) {
            if (refreshSimpleTimerRef.current) clearTimeout(refreshSimpleTimerRef.current);
            refreshSimpleTimerRef.current = setTimeout(() => onRefreshSimpleLlmModels(), 600);
          }
        }
        if (['llm_backend', 'llm_base_url', 'llm_api_key'].some(k => k in updates)) {
          if (onRefreshLlmModels) {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => onRefreshLlmModels(), 600);
          }
        }
      }
    } catch (e) {
      console.error('[SETTINGS-UPDATE] ❌ Failed to update setting:', e);
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

                {/* mood_source toggle — Script vs LLM */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)', flex: 1 }}>Mood driver</span>
                  {['script', 'llm'].map(mode => (
                    <button
                      key={mode}
                      type="button"
                      id={`mood-source-${mode}`}
                      onClick={() => handleUpdateSetting('mood_source', mode)}
                      style={{
                        fontSize: '0.68rem', fontWeight: 600, padding: '3px 10px',
                        borderRadius: '6px', cursor: 'pointer', transition: 'all 0.18s ease',
                        background: settings.mood_source === mode ? 'rgba(167,139,250,0.35)' : 'rgba(255,255,255,0.06)',
                        border: settings.mood_source === mode ? '1px solid rgba(167,139,250,0.7)' : '1px solid rgba(255,255,255,0.1)',
                        color: settings.mood_source === mode ? '#e9d5ff' : 'rgba(255,255,255,0.45)'
                      }}
                    >
                      {mode === 'script' ? '⚙️ Script' : '🤖 LLM'}
                    </button>
                  ))}
                  <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)' }}>
                    {settings.mood_source === 'llm' ? 'LLM appends mood deltas' : 'Rule-based only'}
                  </span>
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
                    { key: 'playfulness', label: 'Playfulness', color: '#c084fc', icon: '🎮' },
                    { key: 'horniness', label: 'Intimacy', color: '#f43f5e', icon: '🔥' },
                    { key: 'anger', label: 'Anger', color: '#f87171', icon: '😠' }
                  ].map(stat => {
                    const val = moodData[stat.key] !== undefined ? moodData[stat.key] : 50;
                    const baseVal = moodData.baselines?.[stat.key];
                    return (
                      <div key={stat.key} style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            <span style={{ marginRight: '4px' }}>{stat.icon}</span> {stat.label}
                          </span>
                          <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 600, color: stat.color }}>
                            {val}/100
                            {baseVal !== undefined && <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)', marginLeft: '4px' }}>({baseVal}↩)</span>}
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

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
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
                      flex: 1,
                      minWidth: '120px',
                      padding: '8px 12px',
                      fontSize: '0.75rem',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)',
                      boxShadow: '0 4px 12px rgba(13,148,136,0.3)',
                      fontWeight: 600
                    }}
                  >
                    Save Specs
                  </button>

                  <button
                    onClick={handleExportPersona}
                    className="glass-button"
                    style={{
                      padding: '8px 12px',
                      fontSize: '0.75rem',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                      boxShadow: '0 4px 12px rgba(139,92,246,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 600
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export Persona JSON
                  </button>

                  <button
                    onClick={() => personaFileInputRef.current?.click()}
                    className="glass-button"
                    style={{
                      padding: '8px 12px',
                      fontSize: '0.75rem',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
                      boxShadow: '0 4px 12px rgba(236,72,153,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 600
                    }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Import Persona JSON
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
                    {(timeItems.stopwatches || []).map(s => {
                      // Active: tick locally using (now - started_at) + paused_elapsed for smooth display.
                      // Paused: show paused_elapsed directly — do NOT subtract started_at (that adds phantom time).
                      const liveElapsed = s.is_active
                        ? Math.floor((Date.now() / 1000 - s.started_at) + (s.paused_elapsed || 0))
                        : Math.floor(s.paused_elapsed || 0);
                      const lh = Math.floor(liveElapsed / 3600);
                      const lm = Math.floor((liveElapsed % 3600) / 60);
                      const ls = liveElapsed % 60;
                      const liveFmt = lh > 0
                        ? `${String(lh).padStart(2, '0')}:${String(lm).padStart(2, '0')}:${String(ls).padStart(2, '0')}`
                        : `${String(lm).padStart(2, '0')}:${String(ls).padStart(2, '0')}`;

                      return (
                        <div key={s.id} style={{ background: 'rgba(0,0,0,0.25)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(167,139,250,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span style={{ fontSize: '0.62rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(167,139,250,0.2)', color: '#a78bfa', fontWeight: 600, textTransform: 'uppercase', marginRight: '6px' }}>
                              {s.is_active ? '▶ Running' : '⏸ Paused'}
                            </span>
                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fff' }}>'{s.label}'</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.85rem', fontFamily: 'monospace', fontWeight: 600, color: s.is_active ? '#a78bfa' : 'rgba(167,139,250,0.5)', minWidth: '54px', textAlign: 'right' }}>
                              {liveFmt}
                            </span>
                            <button
                              type="button"
                              onClick={() => s.is_active ? handlePauseStopwatchUI(s.label) : handleResumeStopwatchUI(s.label)}
                              style={{ background: s.is_active ? 'rgba(245,158,11,0.2)' : 'rgba(167,139,250,0.2)', border: `1px solid ${s.is_active ? 'rgba(245,158,11,0.4)' : 'rgba(167,139,250,0.4)'}`, color: s.is_active ? '#fcd34d' : '#c084fc', borderRadius: '6px', padding: '3px 8px', fontSize: '0.68rem', cursor: 'pointer', fontWeight: 600 }}
                            >
                              {s.is_active ? 'Pause' : 'Resume'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResetStopwatchUI(s.label)}
                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', borderRadius: '6px', padding: '3px 8px', fontSize: '0.68rem', cursor: 'pointer' }}
                            >
                              Reset
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
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Scheduled Tasks (Autonomous) Card */}
              <div className="card-group" style={{ marginBottom: '12px' }}>
                <div className="card-group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span className="card-group-title">Scheduled Tasks (Autonomous)</span>
                  </div>
                  <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', fontWeight: 600 }}>
                    {scheduledTasks.length} Active
                  </span>
                </div>

                <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: '4px', marginBottom: '10px' }}>
                  Fire shell commands, Yuki tools, or power actions once, every N seconds, or when a watched condition flips. Runs autonomously after creation — destructive actions need the confirm box below.
                </div>

                {/* Type selector */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  {['delayed', 'interval', 'watcher'].map(tp => (
                    <button
                      key={tp}
                      type="button"
                      onClick={() => setSched({ type: tp })}
                      style={{
                        flex: 1, padding: '6px 8px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600,
                        background: schedForm.type === tp ? 'linear-gradient(135deg, #f59e0b, #fbbf24)' : 'rgba(255,255,255,0.06)',
                        color: schedForm.type === tp ? '#111' : 'rgba(255,255,255,0.7)',
                      }}
                    >
                      {tp === 'delayed' ? '⏳ Delayed' : tp === 'interval' ? '🔁 Interval' : '👁️ Watcher'}
                    </button>
                  ))}
                </div>

                {/* Timing / watch fields */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }}>
                  {schedForm.type !== 'watcher' ? (
                    <input
                      type="text"
                      placeholder={schedForm.type === 'delayed' ? 'In how long? (e.g. 30s, 5m, 1h)' : 'Every? (e.g. 30s, 5m)'}
                      value={schedForm.seconds}
                      onChange={(e) => setSched({ seconds: e.target.value })}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.78rem', flex: 1, minWidth: '150px' }}
                    />
                  ) : (
                    <>
                      <select
                        value={schedForm.monitorType}
                        onChange={(e) => {
                          const mt = e.target.value;
                          setSched({ monitorType: mt, fireCondition: (SCHED_CONDITIONS[mt] || ['gone'])[0] });
                        }}
                        className="glass-input"
                        style={{ padding: '6px 8px', fontSize: '0.76rem' }}
                      >
                        {['process', 'window', 'file', 'command'].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <input
                        type="text"
                        placeholder={SCHED_MONITOR_PLACEHOLDERS[schedForm.monitorType] || 'Target'}
                        value={schedForm.target}
                        onChange={(e) => setSched({ target: e.target.value })}
                        className="glass-input"
                        style={{ padding: '6px 10px', fontSize: '0.78rem', flex: 1, minWidth: '120px' }}
                      />
                      <select
                        value={schedForm.fireCondition}
                        onChange={(e) => setSched({ fireCondition: e.target.value })}
                        className="glass-input"
                        style={{ padding: '6px 8px', fontSize: '0.76rem' }}
                      >
                        {(SCHED_CONDITIONS[schedForm.monitorType] || ['gone']).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input
                        type="text"
                        placeholder="Poll every (e.g. 30s)"
                        value={schedForm.seconds}
                        onChange={(e) => setSched({ seconds: e.target.value })}
                        className="glass-input"
                        style={{ padding: '6px 10px', fontSize: '0.78rem', width: '115px' }}
                      />
                    </>
                  )}
                  {schedForm.type !== 'delayed' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={schedForm.repeatForever} onChange={(e) => setSched({ repeatForever: e.target.checked })} />
                      forever
                    </label>
                  )}
                </div>
                {schedForm.type !== 'delayed' && !schedForm.repeatForever && (
                  <div style={{ marginBottom: '8px' }}>
                    <input
                      type="number"
                      min="1"
                      value={schedForm.count}
                      onChange={(e) => setSched({ count: e.target.value })}
                      className="glass-input"
                      style={{ padding: '5px 10px', fontSize: '0.76rem', width: '130px' }}
                      placeholder="Times to fire"
                    />
                  </div>
                )}

                {/* Action block */}
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                    {['shell', 'tool', 'power'].map(at => (
                      <button
                        key={at}
                        type="button"
                        onClick={() => setSched({ actionType: at, confirmDestructive: false })}
                        style={{
                          flex: 1, padding: '5px 8px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
                          background: schedForm.actionType === at ? 'linear-gradient(135deg, #38bdf8, #6366f1)' : 'rgba(255,255,255,0.06)',
                          color: schedForm.actionType === at ? '#fff' : 'rgba(255,255,255,0.7)',
                        }}
                      >
                        {at === 'shell' ? '⌨️ Shell' : at === 'tool' ? '🧰 Yuki Tool' : '🔌 Power'}
                      </button>
                    ))}
                  </div>
                  {schedForm.actionType === 'shell' && (
                    <input
                      type="text"
                      placeholder="Shell command to run when fired (e.g. calc.exe)"
                      value={schedForm.command}
                      onChange={(e) => setSched({ command: e.target.value, confirmDestructive: false })}
                      className="glass-input"
                      style={{ padding: '6px 10px', fontSize: '0.76rem', fontFamily: 'monospace', width: '100%' }}
                    />
                  )}
                  {schedForm.actionType === 'tool' && (
                    <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                      <select
                        value={schedForm.toolName}
                        onChange={(e) => setSched({ toolName: e.target.value, confirmDestructive: false })}
                        className="glass-input"
                        style={{ padding: '6px 8px', fontSize: '0.76rem' }}
                      >
                        <option value="">Select a Yuki tool…</option>
                        {(toolsList || []).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                      </select>
                      <input
                        type="text"
                        placeholder='Optional JSON args, e.g. {"window_title":"Notepad"}'
                        value={schedForm.argsJson}
                        onChange={(e) => setSched({ argsJson: e.target.value })}
                        className="glass-input"
                        style={{ padding: '6px 10px', fontSize: '0.72rem', fontFamily: 'monospace', width: '100%' }}
                      />
                    </div>
                  )}
                  {schedForm.actionType === 'power' && (
                    <select
                      value={schedForm.powerAction}
                      onChange={(e) => setSched({ powerAction: e.target.value, confirmDestructive: false })}
                      className="glass-input"
                      style={{ padding: '6px 8px', fontSize: '0.76rem' }}
                    >
                      {['shutdown', 'restart', 'lock', 'sleep', 'hibernate', 'logoff'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}

                  {destructive && (
                    <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.4)', fontSize: '0.7rem', color: '#fca5a5' }}>
                      ⚠️ This action is destructive — it will run autonomously once triggered:
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={schedForm.confirmDestructive} onChange={(e) => setSched({ confirmDestructive: e.target.checked })} />
                        <span>I understand, allow this action.</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Feedback + create */}
                {schedMsg && (
                  <div style={{
                    marginBottom: '8px', padding: '6px 10px', borderRadius: '8px', fontSize: '0.7rem',
                    background: schedMsg.type === 'ok' ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)',
                    border: `1px solid ${schedMsg.type === 'ok' ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'}`,
                    color: schedMsg.type === 'ok' ? '#6ee7b7' : '#fca5a5',
                  }}>
                    {schedMsg.text}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleCreateScheduledTask}
                  disabled={!schedFormValid() || schedCreating}
                  style={{
                    width: '100%', padding: '8px 12px', fontSize: '0.78rem', borderRadius: '8px',
                    background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', border: 'none', color: '#111', fontWeight: 700,
                    cursor: schedFormValid() && !schedCreating ? 'pointer' : 'not-allowed',
                    opacity: schedFormValid() && !schedCreating ? 1 : 0.45,
                  }}
                >
                  {schedCreating ? 'Scheduling…' : '+ Schedule Task'}
                </button>

                {/* Active list */}
                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: '6px' }}>
                    Active Scheduled Tasks
                  </div>
                  {scheduledTasks.length === 0 ? (
                    <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', padding: '14px 0', textAlign: 'center' }}>
                      No autonomous tasks. Ask Yuki or use the form above!
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {scheduledTasks.map(t => {
                        const badgeColor = t.kind === 'delayed' ? '#38bdf8' : t.kind === 'interval' ? '#a78bfa' : '#fbbf24';
                        const badgeBg = t.kind === 'delayed' ? 'rgba(56,189,248,0.15)' : t.kind === 'interval' ? 'rgba(167,139,250,0.15)' : 'rgba(251,191,36,0.15)';
                        const actionDesc = t.action_command || t.action_tool || t.action_type || 'shell';
                        const isWatcher = t.kind === 'watcher';
                        return (
                          <div key={t.id} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: `1px solid ${badgeColor}33`, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: '4px', background: badgeBg, color: badgeColor, fontWeight: 700, letterSpacing: '0.5px' }}>
                                    {String(t.kind || '').toUpperCase()}
                                  </span>
                                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {isWatcher ? `${t.monitor_type} '${t.target}' → ${t.fire_condition}` : actionDesc}
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.64rem', color: 'rgba(255,255,255,0.4)', marginTop: '3px', fontFamily: 'monospace' }}>
                                  {isWatcher ? `action: ${actionDesc} · poll ${Math.round(t.interval_seconds)}s` : (t.interval_seconds ? `every ${Math.round(t.interval_seconds)}s` : '')}
                                  {t.count != null ? ` · x${t.count}` : ''}
                                  {t.remaining_seconds != null ? ` · ${schedCountdown(t)} left` : ''}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleCancelScheduledTask(t.id)}
                                style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', borderRadius: '6px', padding: '3px 8px', fontSize: '0.68rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
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

                  {/* Persistent Chat History Toggle Banner */}
                  <div style={{
                    background: settings.persistent_chat_history ? 'linear-gradient(135deg, rgba(56,189,248,0.18) 0%, rgba(139,92,246,0.15) 100%)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${settings.persistent_chat_history ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '14px',
                    padding: '12px 16px',
                    marginBottom: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <History className="w-5 h-5 text-sky-400" />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>
                            Persistent Chat History
                          </div>
                          <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}>
                            Save conversation logs to disk (<code style={{ color: '#38bdf8' }}>chat_history.json</code>) and restore them on app restart.
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const newVal = !settings.persistent_chat_history;
                          handleUpdateSetting('persistent_chat_history', newVal);
                        }}
                        style={{
                          background: settings.persistent_chat_history ? 'linear-gradient(135deg, #0284c7, #0369a1)' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${settings.persistent_chat_history ? 'rgba(56,189,248,0.6)' : 'rgba(255,255,255,0.12)'}`,
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
                          left: settings.persistent_chat_history ? '22px' : '2px',
                          transition: 'all 0.2s ease',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }} />
                      </button>
                    </div>

                    <div style={{ fontSize: '0.66rem', color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.2)', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', lineHeight: '1.4' }}>
                      ℹ️ <strong>Storage & Pruning Note:</strong> When enabled, chat history is saved to <code>backend/chat_history.json</code>. When the token budget is hit, the oldest/middle share of older turns is compressed into an LLM summary (or a snippet recap if the summary model is unavailable), so the whole prompt stays within the configured limits (2,500 tokens for local models, 40,000 tokens for cloud APIs).
                    </div>
                  </div>

                  {/* Context Pruning & History Controls Card */}
                  <div className="card-group" style={{ marginBottom: '12px' }}>
                    <div className="card-group-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sliders className="w-4 h-4 text-cyan-400" />
                      <span className="card-group-title">Context Pruning & History Limits</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
                      {/* Basic AI Suite (<5B Local LLMs) */}
                      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '10px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', color: '#38bdf8', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Cpu className="w-3.5 h-3.5" />
                          <span>Basic Suite (Sub-5B Models)</span>
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                          Tight budget tuned for weak local LLMs.
                        </div>

                        <div style={{ marginBottom: '8px' }}>
                          <label style={{ fontSize: '0.68rem', color: '#cbd5e1', display: 'block', marginBottom: '2px' }}>Max Context Ceiling (Tokens):</label>
                          <input
                            type="number"
                            min="500"
                            max="15000"
                            step="250"
                            value={settings.basic_history_token_limit || 2500}
                            onChange={(e) => handleUpdateSetting('basic_history_token_limit', parseInt(e.target.value) || 2500)}
                            style={{
                              width: '100%',
                              padding: '4px 8px',
                              fontSize: '0.75rem',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '6px',
                              color: '#fff'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.68rem', color: '#cbd5e1', display: 'block', marginBottom: '2px' }}>Min Intact Recent Turns:</label>
                          <input
                            type="number"
                            min="2"
                            max="20"
                            step="1"
                            value={settings.basic_history_keep_turns || 6}
                            onChange={(e) => handleUpdateSetting('basic_history_keep_turns', parseInt(e.target.value) || 6)}
                            style={{
                              width: '100%',
                              padding: '4px 8px',
                              fontSize: '0.75rem',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '6px',
                              color: '#fff'
                            }}
                          />
                        </div>
                      </div>

                      {/* Advanced AI Suite (Cloud / Free Tier APIs) */}
                      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '10px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', color: '#c084fc', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Zap className="w-3.5 h-3.5" />
                          <span>Advanced Suite (Cloud / API)</span>
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                          Large budget for strong APIs (Gemini, Groq, OpenRouter).
                        </div>

                        <div style={{ marginBottom: '8px' }}>
                          <label style={{ fontSize: '0.68rem', color: '#cbd5e1', display: 'block', marginBottom: '2px' }}>Max Context Ceiling (Tokens):</label>
                          <input
                            type="number"
                            min="5000"
                            max="200000"
                            step="2500"
                            value={settings.advanced_history_token_limit || 40000}
                            onChange={(e) => handleUpdateSetting('advanced_history_token_limit', parseInt(e.target.value) || 40000)}
                            style={{
                              width: '100%',
                              padding: '4px 8px',
                              fontSize: '0.75rem',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '6px',
                              color: '#fff'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.68rem', color: '#cbd5e1', display: 'block', marginBottom: '2px' }}>Min Intact Recent Turns:</label>
                          <input
                            type="number"
                            min="6"
                            max="50"
                            step="2"
                            value={settings.advanced_history_keep_turns || 16}
                            onChange={(e) => handleUpdateSetting('advanced_history_keep_turns', parseInt(e.target.value) || 16)}
                            style={{
                              width: '100%',
                              padding: '4px 8px',
                              fontSize: '0.75rem',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '6px',
                              color: '#fff'
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Rolling LLM Summarization */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.68rem', color: '#cbd5e1', display: 'block', marginBottom: '2px' }}>
                          Summarize Older Turns (%): <span style={{ color: 'rgba(255,255,255,0.4)' }}>0 = off</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="95"
                          step="5"
                          value={settings.history_summary_percent !== undefined ? settings.history_summary_percent : 50}
                          onChange={(e) => handleUpdateSetting('history_summary_percent', Math.max(0, Math.min(95, parseInt(e.target.value) || 0)))}
                          style={{
                            width: '100%',
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px',
                            color: '#fff'
                          }}
                        />
                        <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                          When the token limit is hit, this share of the conversation is compressed into an LLM summary.
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.68rem', color: '#cbd5e1', display: 'block', marginBottom: '2px' }}>Summary Position:</label>
                        <select
                          value={settings.history_summary_position || 'oldest'}
                          onChange={(e) => handleUpdateSetting('history_summary_position', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px',
                            color: '#fff'
                          }}
                        >
                          <option value="oldest">Oldest turns (front)</option>
                          <option value="middle">Middle turns (center)</option>
                        </select>
                        <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                          Which part of the conversation gets condensed. Recent turns always stay verbatim.
                        </div>
                      </div>
                    </div>
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

                  {/* Backup & Restore Application Settings Card Group */}
                  <div className="card-group" style={{ marginBottom: '12px' }}>
                    <div className="card-group-header">
                      <Sliders className="w-4 h-4 text-purple-400" />
                      <span className="card-group-title">Backup & Restore Application Settings</span>
                    </div>
                    <p style={{ fontSize: '0.73rem', color: '#94a3b8', margin: '4px 0 10px 0' }}>
                      Export or import your full Yuki application configuration, model selections, custom endpoints, audio choices, and API keys.
                    </p>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={handleExportSettings}
                        className="glass-button"
                        style={{
                          flex: 1,
                          minWidth: '160px',
                          padding: '8px 12px',
                          fontSize: '0.75rem',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                          boxShadow: '0 4px 12px rgba(139,92,246,0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          fontWeight: 600
                        }}
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export Settings JSON
                      </button>

                      <button
                        onClick={() => settingsFileInputRef.current?.click()}
                        className="glass-button"
                        style={{
                          flex: 1,
                          minWidth: '160px',
                          padding: '8px 12px',
                          fontSize: '0.75rem',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #d946ef 0%, #a21caf 100%)',
                          boxShadow: '0 4px 12px rgba(217,70,239,0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          fontWeight: 600
                        }}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Import Settings JSON
                      </button>

                      <input
                        type="file"
                        ref={settingsFileInputRef}
                        accept=".json"
                        onChange={handleImportSettingsFile}
                        style={{ display: 'none' }}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Sub-tab 1: AI Brain */}
              {settingsSubTab === 'brain' && (
                <>
                  {/* No LLM Mode toggle — first card so it's always visible */}
                  <div className="card-group" style={{ borderColor: settings.no_llm_mode ? 'rgba(248,113,113,0.4)' : undefined }}>
                    <div className="card-group-header">
                      <span style={{ fontSize: '0.9rem' }}>🤖</span>
                      <span className="card-group-title">LLM Access Control</span>
                    </div>
                    <div className="identity-field" style={{ marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span className="field-label" style={{ color: settings.no_llm_mode ? '#f87171' : undefined }}>
                            No LLM Mode {settings.no_llm_mode ? '🔴 ON' : ''}
                          </span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px', maxWidth: '280px', lineHeight: '1.25' }}>
                            When ON, Yuki responds with &quot;sorry, LLM is currently turned off&quot; and skips loading any model.
                            Useful for saving resources or during offline-only usage.
                          </span>
                        </div>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={!!settings.no_llm_mode}
                            onChange={(e) => handleUpdateSetting('no_llm_mode', e.target.checked)}
                          />
                          <span className="slider round" style={settings.no_llm_mode ? { background: '#ef4444' } : {}}></span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Card 1: Prompt & Execution Strategy (First Card) */}
                  <div className="card-group">
                    <div className="card-group-header">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span className="card-group-title">Prompt &amp; Execution Strategy</span>
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

                      {/* Send Tools in Simple Prompts Toggle */}
                      {settings.llm_mode !== 2 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.06)' }}>
                          <div>
                            <span className="field-label" style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600 }}>Enable tools during simple prompts</span>
                            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px', maxWidth: '280px', lineHeight: '1.25' }}>
                              Passes tool schemas to the LLM during simple prompts. Respects intent checking and dynamic tool filtering.
                            </span>
                          </div>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={!!settings.send_tools_in_simple}
                              onChange={(e) => handleUpdateSetting('send_tools_in_simple', e.target.checked)}
                            />
                            <span className="slider round"></span>
                          </label>
                        </div>
                      )}
                    </div>

                    {/* Tool Operating Suite Segment */}
                    <div className="identity-field" style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="field-label" style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Wrench style={{ width: '13px', height: '13px', color: '#c084fc' }} />
                        Tool Operating Suite
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => handleUpdateSetting('tool_mode', 'basic')}
                          style={{
                            padding: '9px 10px',
                            borderRadius: '10px',
                            border: (settings.tool_mode || 'basic') === 'basic' ? '1.5px solid #a78bfa' : '1px solid rgba(255,255,255,0.1)',
                            background: (settings.tool_mode || 'basic') === 'basic' ? 'rgba(167,139,250,0.18)' : 'rgba(0,0,0,0.3)',
                            color: 'white',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <div style={{ fontWeight: '600', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Zap style={{ width: '12px', height: '12px', color: '#a78bfa' }} />
                            Basic Tools
                          </div>
                          <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)', marginTop: '3px', lineHeight: '1.2' }}>
                            For local/fast models. Single-turn tool calling.
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleUpdateSetting('tool_mode', 'advanced')}
                          style={{
                            padding: '9px 10px',
                            borderRadius: '10px',
                            border: settings.tool_mode === 'advanced' ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                            background: settings.tool_mode === 'advanced' ? 'rgba(56,189,248,0.18)' : 'rgba(0,0,0,0.3)',
                            color: 'white',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <div style={{ fontWeight: '600', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Cpu style={{ width: '12px', height: '12px', color: '#38bdf8' }} />
                            Autonomous Jarvis
                          </div>
                          <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)', marginTop: '3px', lineHeight: '1.2' }}>
                            Frontier cloud LLMs. Parallel tools, multi-step ReAct, DB search.
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* Always Included Tools (Dynamic Mode) */}
                    {(settings.tool_mode || 'basic') === 'advanced' && (
                      <div className="identity-field" style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                          <span className="field-label" style={{ color: '#38bdf8' }}>Always Included Tools (Dynamic Mode)</span>
                        </div>
                        <div style={{ fontSize: '0.66rem', color: '#94a3b8', marginBottom: '8px', lineHeight: '1.3' }}>
                          These tools are always sent to the LLM when dynamic tool calling is active, regardless of the query. Unchecking the box removes it from the always-included set.
                        </div>
                        {(() => {
                          const jarvisTools = (toolsList || []).map(t => t.name);
                          const selected = Array.isArray(settings.always_included_tools) ? settings.always_included_tools : [];
                          if (jarvisTools.length === 0) {
                            return <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', padding: '8px 0' }}>Loading tools…</div>;
                          }
                          return (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', maxHeight: '220px', overflowY: 'auto' }}>
                              {jarvisTools.map(name => {
                                const checked = selected.includes(name);
                                return (
                                  <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.68rem', color: checked ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '2px 0' }}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        const next = checked ? selected.filter(t => t !== name) : [...selected, name];
                                        handleUpdateSetting('always_included_tools', next);
                                      }}
                                    />
                                    <span style={{ fontFamily: 'monospace' }}>{name.replace('jarvis_', '')}</span>
                                  </label>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Blocked Tools (never sent in non-coder modes) */}
                    <div className="identity-field" style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <span className="field-label" style={{ color: '#f87171' }}>Blocked Tools (hidden in non-coder mode)</span>
                      </div>
                      <div style={{ fontSize: '0.66rem', color: '#94a3b8', marginBottom: '8px', lineHeight: '1.3' }}>
                        Blocked tools are never sent to the LLM in any non-coder mode (basic/advanced, simple/complex, dynamic on/off), and their names are scrubbed from the system prompt. Coder mode is unaffected.
                      </div>
                      {(() => {
                        const allTools = (blockedToolsList || []).map(t => t.name);
                        const blocked = Array.isArray(settings.blocked_tools) ? settings.blocked_tools : [];
                        if (allTools.length === 0) {
                          return <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', padding: '8px 0' }}>Loading tools…</div>;
                        }
                        return (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', maxHeight: '220px', overflowY: 'auto' }}>
                            {allTools.map(name => {
                              const checked = blocked.includes(name);
                              return (
                                <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.68rem', color: checked ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '2px 0' }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const next = checked ? blocked.filter(t => t !== name) : [...blocked, name];
                                      handleUpdateSetting('blocked_tools', next);
                                    }}
                                  />
                                  <span style={{ fontFamily: 'monospace', textDecoration: checked ? 'line-through' : 'none' }}>{name}</span>
                                </label>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Codegraph (opt-in code intelligence tools) */}
                    <div className="identity-field" style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span className="field-label" style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600 }}>Turn on codegraph for coder mode</span>
                          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px', maxWidth: '300px', lineHeight: '1.25' }}>
                            Lets coder mode use codegraph to explore and navigate indexed codebases. <strong style={{ color: '#fbbf24' }}>Codegraph must be installed on your PC for this tool to work.</strong> (Default: OFF)
                          </span>
                        </div>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={!!settings.codegraph_coder_enabled}
                            onChange={(e) => handleUpdateSetting('codegraph_coder_enabled', e.target.checked)}
                          />
                          <span className="slider round"></span>
                        </label>
                      </div>

                      {/* Advanced (Autonomous Jarvis) suite checkbox — only when coder toggle is on */}
                      {!!settings.codegraph_coder_enabled && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.06)' }}>
                          <div>
                            <span className="field-label" style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600 }}>Turn on codegraph for advanced tools (autonomous jarvis) suite</span>
                            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px', maxWidth: '300px', lineHeight: '1.25' }}>
                              Also sends the codegraph tools in Advanced (Autonomous Jarvis) mode. Requires codegraph to be installed.
                            </span>
                          </div>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={!!settings.codegraph_advanced_enabled}
                              onChange={(e) => handleUpdateSetting('codegraph_advanced_enabled', e.target.checked)}
                            />
                            <span className="slider round"></span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card 2: AI Brain & Language Model (LLM API Configuration) */}
                  <div className="card-group">
                    <div className="card-group-header">
                      <Cpu className="w-4 h-4 text-violet-400" />
                      <span className="card-group-title">AI Brain & Language Model</span>
                    </div>

                    {/* Endpoint Configuration Strategy (Only visible when Prompt Strategy is Dynamic Mixed mode) */}
                    {(settings.llm_mode === 3 || settings.llm_mode === 0 || !settings.llm_mode) && (
                      <div className="identity-field" style={{ marginTop: '4px', marginBottom: '8px' }}>
                        <span className="field-label" style={{ fontWeight: '600', color: '#c4b5fd' }}>Endpoint Strategy</span>
                        <select
                          value={settings.endpoint_strategy || 'single'}
                          onChange={(e) => handleUpdateSetting('endpoint_strategy', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            background: 'rgba(18, 12, 33, 0.85)',
                            border: '1px solid rgba(167, 139, 250, 0.4)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '0.78rem',
                            outline: 'none',
                            cursor: 'pointer',
                            marginTop: '4px'
                          }}
                        >
                          <option value="single" style={{ background: '#120c21', color: 'white' }}>
                            Use single endpoint for all prompts (Default)
                          </option>
                          <option value="dual" style={{ background: '#120c21', color: 'white' }}>
                            Use separate endpoints for simple and complex prompts
                          </option>
                        </select>
                      </div>
                    )}

                    {/* If DUAL Strategy Selected, render Simple Endpoint Sub-Card */}
                    {settings.endpoint_strategy === 'dual' && settings.llm_mode !== 1 && settings.llm_mode !== 2 && (
                      <div style={{ background: 'rgba(139, 92, 246, 0.08)', borderRadius: '10px', padding: '12px', marginBottom: '14px', border: '1px solid rgba(139, 92, 246, 0.25)' }}>
                        <div style={{ fontWeight: '600', fontSize: '0.78rem', color: '#c4b5fd', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          💬 Simple Prompt Endpoint
                        </div>

                        {/* Simple LLM Backend */}
                        <div className="identity-field" style={{ marginTop: '4px' }}>
                          <span className="field-label">Simple LLM Backend</span>
                          <select
                            value={settings.llm_simple_backend || 'lmstudio'}
                            onChange={async (e) => {
                              const newBackend = e.target.value;
                              const defaults = {
                                lmstudio: 'http://127.0.0.1:1234',
                                ollama: 'http://127.0.0.1:11434',
                                vllm: 'http://127.0.0.1:8000/v1',
                                custom: 'https://generativelanguage.googleapis.com/v1beta/openai',
                              };
                              const updates = { llm_simple_backend: newBackend };
                              if (defaults[newBackend]) updates.llm_simple_base_url = defaults[newBackend];
                              await handleUpdateSetting(updates);
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

                        {/* Simple Custom / Cloud API Key Vault & Presets */}
                        {settings.llm_simple_backend === 'custom' && (
                          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            {savedCustomEndpoints.length > 0 && (
                              <div className="identity-field" style={{ marginBottom: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                  <span className="field-label" style={{ color: '#c4b5fd', fontSize: '0.74rem', fontWeight: 600 }}>
                                    🔑 Saved API Key Vault ({savedCustomEndpoints.length})
                                  </span>
                                  <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)' }}>
                                    Select to load preset
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  <select
                                    value={selectedSimpleEndpointId}
                                    onChange={(e) => {
                                      const selId = e.target.value;
                                      const ep = savedCustomEndpoints.find(item => item.id === selId);
                                      if (ep) handleSelectCustomEndpoint(ep, 'simple');
                                    }}
                                    style={{
                                      flex: 1,
                                      padding: '7px 10px',
                                      background: 'rgba(18, 12, 33, 0.95)',
                                      border: '1px solid rgba(167, 139, 250, 0.45)',
                                      borderRadius: '8px',
                                      color: '#ffffff',
                                      fontSize: '0.78rem',
                                      fontWeight: 500,
                                      outline: 'none',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <option value="" style={{ background: '#120c21', color: '#94a3b8' }}>-- Select Saved Simple Preset --</option>
                                    {savedCustomEndpoints.map((ep) => (
                                      <option key={ep.id} value={ep.id} style={{ background: '#120c21', color: '#ffffff' }}>
                                        {ep.label || 'Saved Endpoint'} ({ep.has_key ? '🔑 Key Saved' : 'No Key'})
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    title="Delete selected preset"
                                    onClick={() => handleDeleteCustomEndpoint(selectedSimpleEndpointId)}
                                    className="glass-button"
                                    style={{
                                      padding: '7px 10px',
                                      borderRadius: '8px',
                                      border: '1px solid rgba(239, 68, 68, 0.4)',
                                      background: 'rgba(239, 68, 68, 0.18)',
                                      color: '#fca5a5',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      fontSize: '0.74rem'
                                    }}
                                  >
                                    <Trash2 style={{ width: '13px', height: '13px' }} />
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Quick Cloud Presets for Simple */}
                            <div style={{ marginTop: '6px', marginBottom: '8px' }}>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                                Quick Cloud Provider Presets:
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
                                      setCustomSimpleLabel(p.label);
                                      await handleUpdateSetting('llm_simple_backend', 'custom');
                                      await handleUpdateSetting('llm_simple_base_url', p.url);
                                      if (p.model) await handleUpdateSetting('llm_simple_model', p.model);
                                      if (onRefreshSimpleLlmModels) setTimeout(() => onRefreshSimpleLlmModels(), 400);
                                    }}
                                    className="glass-button"
                                    style={{
                                      padding: '3px 8px',
                                      fontSize: '0.66rem',
                                      borderRadius: '6px',
                                      background: settings.llm_simple_base_url === p.url ? 'rgba(139, 92, 246, 0.35)' : 'rgba(255, 255, 255, 0.05)',
                                      border: settings.llm_simple_base_url === p.url ? '1px solid #a78bfa' : '1px solid rgba(255,255,255,0.08)',
                                      color: settings.llm_simple_base_url === p.url ? '#fff' : '#cbd5e1',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    ⚡ {p.name}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Preset Label Input */}
                            <div className="identity-field" style={{ marginTop: '8px' }}>
                              <span className="field-label">Preset Name / Label</span>
                              <input
                                type="text"
                                placeholder="e.g. Google Gemini Cloud, Local Fast Llama"
                                value={customSimpleLabel}
                                onChange={(e) => setCustomSimpleLabel(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '7px 10px',
                                  background: 'rgba(0,0,0,0.3)',
                                  border: '1px solid rgba(167, 139, 250, 0.3)',
                                  borderRadius: '8px',
                                  color: 'white',
                                  fontSize: '0.78rem',
                                  outline: 'none',
                                  marginTop: '3px'
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Simple Base URL */}
                        {settings.llm_simple_backend !== 'none' && (
                          <div className="identity-field" style={{ marginTop: '8px' }}>
                            <span className="field-label">Simple Base URL</span>
                            <input
                              type="text"
                              placeholder="http://127.0.0.1:1234"
                              value={settings.llm_simple_base_url || ''}
                              onChange={(e) => handleUpdateSetting('llm_simple_base_url', e.target.value)}
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

                        {/* Simple API Key */}
                        {settings.llm_simple_backend === 'custom' && (
                          <div className="identity-field" style={{ marginTop: '8px' }}>
                            <span className="field-label">Simple API Key (Encrypted in DB)</span>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                              <input
                                type={showSimpleApiKey ? "text" : "password"}
                                placeholder="sk-..."
                                value={settings.llm_simple_api_key || ''}
                                onChange={(e) => handleUpdateSetting('llm_simple_api_key', e.target.value)}
                                style={{
                                  flex: 1,
                                  padding: '7px 10px',
                                  background: 'rgba(0,0,0,0.3)',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  borderRadius: '8px',
                                  color: 'white',
                                  fontSize: '0.78rem',
                                  outline: 'none'
                                }}
                              />
                              <button
                                type="button"
                                title={showSimpleApiKey ? "Hide API Key" : "Show API Key"}
                                onClick={handleToggleSimpleApiKey}
                                className="glass-button"
                                style={{
                                  padding: '7px 10px',
                                  borderRadius: '8px',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  background: showSimpleApiKey ? 'rgba(167, 139, 250, 0.25)' : 'rgba(255,255,255,0.05)',
                                  color: showSimpleApiKey ? '#c4b5fd' : '#cbd5e1',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}
                              >
                                {showSimpleApiKey ? <EyeOff style={{ width: '14px', height: '14px' }} /> : <Eye style={{ width: '14px', height: '14px' }} />}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Save Simple Preset Button */}
                        {settings.llm_simple_backend === 'custom' && (
                          <div style={{ marginTop: '10px' }}>
                            <button
                              type="button"
                              onClick={handleSaveSimpleCustomEndpoint}
                              className="glass-button"
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                fontSize: '0.78rem',
                                borderRadius: '8px',
                                background: 'rgba(139, 92, 246, 0.25)',
                                border: '1px solid #a78bfa',
                                color: 'white',
                                cursor: 'pointer'
                              }}
                            >
                              💾 {saveSimpleEndpointBtnText}
                            </button>
                          </div>
                        )}

                        {/* Simple Model Selection */}
                        {settings.llm_simple_backend !== 'none' && (
                          <div className="identity-field" style={{ marginTop: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className="field-label">Simple Model Name</span>
                              <button
                                type="button"
                                onClick={onRefreshSimpleLlmModels}
                                title="Refresh model list from backend"
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                              >
                                <RefreshCw style={{ width: '11px', height: '11px' }} /> Refresh
                              </button>
                            </div>
                            {(() => {
                              const fetchedNames = (availableSimpleLlmModels || []).map(m => typeof m === 'string' ? m : (m.name || m.id || '')).filter(Boolean);
                              const allNames = Array.from(new Set([
                                ...(settings.llm_simple_model ? [settings.llm_simple_model] : []),
                                ...fetchedNames
                              ]));
                              return (
                                <SearchableModelSelect
                                  value={settings.llm_simple_model || ''}
                                  onChange={(val) => handleUpdateSetting('llm_simple_model', val)}
                                  options={allNames}
                                  placeholder="Search or select Simple model..."
                                />
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Section Header if Dual Mode is Active for Complex Endpoint */}
                    {settings.endpoint_strategy === 'dual' && settings.llm_mode !== 1 && settings.llm_mode !== 2 && (
                      <div style={{ fontWeight: '600', fontSize: '0.78rem', color: '#38bdf8', marginTop: '6px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        ⚡ Complex Prompt Endpoint
                      </div>
                    )}

                    {/* LLM Backend Type (Complex / Main) */}
                    <div className="identity-field" style={{ marginTop: '4px' }}>
                      <span className="field-label">
                        {settings.endpoint_strategy === 'dual' && settings.llm_mode !== 1 && settings.llm_mode !== 2 ? 'Complex LLM Backend' : 'LLM Backend'}
                      </span>
                      <select
                        value={settings.llm_backend || 'lmstudio'}
                        onChange={async (e) => {
                          const newBackend = e.target.value;
                          const defaults = {
                            lmstudio: 'http://127.0.0.1:1234',
                            ollama: 'http://127.0.0.1:11434',
                            vllm: 'http://127.0.0.1:8000/v1',
                            custom: 'https://generativelanguage.googleapis.com/v1beta/openai',
                          };
                          await handleUpdateSetting({
                            llm_model: '',
                            llm_backend: newBackend,
                            ...(defaults[newBackend] ? { llm_base_url: defaults[newBackend] } : {})
                          });
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

                    {/* Custom / Cloud API Key Vault & Saved Presets */}
                    {settings.llm_backend === 'custom' && (
                      <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>

                        {/* Saved Key Vault Dropdown + Trash Delete Button */}
                        {savedCustomEndpoints.length > 0 && (
                          <div className="identity-field" style={{ marginBottom: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span className="field-label" style={{ color: '#c4b5fd', fontSize: '0.74rem', fontWeight: 600 }}>
                                🔑 Saved API Key Vault ({savedCustomEndpoints.length})
                              </span>
                              <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)' }}>
                                Select to load preset
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <select
                                value={selectedEndpointId}
                                onChange={(e) => {
                                  const selId = e.target.value;
                                  setSelectedEndpointId(selId);
                                  const ep = savedCustomEndpoints.find(item => item.id === selId);
                                  if (ep) {
                                    handleSelectCustomEndpoint(ep);
                                  }
                                }}
                                style={{
                                  flex: 1,
                                  padding: '7px 10px',
                                  background: 'rgba(18, 12, 33, 0.95)',
                                  border: '1px solid rgba(167, 139, 250, 0.45)',
                                  borderRadius: '8px',
                                  color: '#ffffff',
                                  fontSize: '0.78rem',
                                  fontWeight: 500,
                                  outline: 'none',
                                  cursor: 'pointer'
                                }}
                              >
                                <option value="" style={{ background: '#120c21', color: '#94a3b8' }}>
                                  -- Select Saved API Key Preset --
                                </option>
                                {savedCustomEndpoints.map((ep) => {
                                  const isActive = settings.llm_base_url === ep.base_url;
                                  return (
                                    <option key={ep.id} value={ep.id} style={{ background: '#120c21', color: '#ffffff' }}>
                                      {isActive ? '● ' : ''}{ep.label || 'Saved Endpoint'} ({ep.has_key ? '🔑 Key Saved' : 'No Key'})
                                    </option>
                                  );
                                })}
                              </select>

                              {/* Delete button for currently active or selected preset */}
                              <button
                                type="button"
                                title="Delete active preset from DB"
                                onClick={() => {
                                  const activeEp = savedCustomEndpoints.find(item => settings.llm_base_url === item.base_url || item.label === customLabel);
                                  if (activeEp) {
                                    handleDeleteCustomEndpoint(activeEp.id, activeEp.label);
                                  } else {
                                    alert("Please select a saved preset to delete.");
                                  }
                                }}
                                className="glass-button"
                                style={{
                                  padding: '7px 10px',
                                  borderRadius: '8px',
                                  border: '1px solid rgba(239, 68, 68, 0.4)',
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  color: '#fca5a5',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '0.74rem'
                                }}
                              >
                                <Trash2 style={{ width: '13px', height: '13px' }} />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Quick Provider Templates */}
                        <div style={{ marginTop: '6px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                            Quick Cloud Provider Presets:
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
                                  const updates = {
                                    llm_backend: activeBackend,
                                    llm_base_url: p.url
                                  };
                                  if (p.model && !settings.llm_model) {
                                    updates.llm_model = p.model;
                                  }
                                  await handleUpdateSetting(updates);
                                }}
                                className="glass-button"
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '0.66rem',
                                  borderRadius: '6px',
                                  background: settings.llm_base_url === p.url ? 'rgba(139, 92, 246, 0.35)' : 'rgba(255, 255, 255, 0.05)',
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

                        {/* Preset Name / Label Input */}
                        <div className="identity-field" style={{ marginTop: '8px' }}>
                          <span className="field-label">Preset Name / Label</span>
                          <input
                            type="text"
                            placeholder="e.g. Google Gemini Cloud, My Custom vLLM, xAI Grok"
                            value={customLabel}
                            onChange={(e) => setCustomLabel(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(167, 139, 250, 0.3)',
                              borderRadius: '8px',
                              color: 'white',
                              fontSize: '0.78rem',
                              outline: 'none',
                              marginTop: '3px'
                            }}
                          />
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
                                  settings.llm_backend === 'custom' ? 'https://generativelanguage.googleapis.com/v1beta/openai' :
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
                                custom: 'https://generativelanguage.googleapis.com/v1beta/openai',
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
                    {(settings.llm_backend === 'custom') && (
                      <div className="identity-field" style={{ marginTop: '8px' }}>
                        <span className="field-label">API Key (Encrypted in DB)</span>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                          <input
                            type={showComplexApiKey ? "text" : "password"}
                            placeholder="sk-..."
                            value={settings.llm_api_key || ''}
                            onChange={(e) => {
                              console.log(`[API-KEY-INPUT] 🔑 Typing in complex API key field. Current llm_base_url="${settings.llm_base_url}" value length=${e.target.value.length}`);
                              handleUpdateSetting('llm_api_key', e.target.value);
                            }}
                            style={{
                              flex: 1,
                              padding: '7px 10px',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '8px',
                              color: 'white',
                              fontSize: '0.78rem',
                              outline: 'none'
                            }}
                          />
                          <button
                            type="button"
                            title={showComplexApiKey ? "Hide API Key" : "Show API Key"}
                            onClick={handleToggleComplexApiKey}
                            className="glass-button"
                            style={{
                              padding: '7px 10px',
                              borderRadius: '8px',
                              border: '1px solid rgba(255,255,255,0.15)',
                              background: showComplexApiKey ? 'rgba(167, 139, 250, 0.25)' : 'rgba(255,255,255,0.05)',
                              color: showComplexApiKey ? '#c4b5fd' : '#cbd5e1',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            {showComplexApiKey ? <EyeOff style={{ width: '14px', height: '14px' }} /> : <Eye style={{ width: '14px', height: '14px' }} />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Save Endpoint Preset Button */}
                    {(settings.llm_backend === 'custom') && (
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
                        {(() => {
                          const fetchedNames = (availableLlmModels || []).map(m => typeof m === 'string' ? m : (m.name || m.id || '')).filter(Boolean);
                          const allNames = Array.from(new Set([
                            ...(settings.llm_model ? [settings.llm_model] : []),
                            ...fetchedNames
                          ]));
                          return (
                            <SearchableModelSelect
                              value={settings.llm_model || ''}
                              onChange={(val) => handleUpdateSetting('llm_model', val)}
                              options={allNames}
                              placeholder="Search or select Complex model..."
                            />
                          );
                        })()}
                      </div>
                    )}

                    {/* Vision Scan & Analysis Model Selection */}
                    <div className="identity-field" style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <span className="field-label" style={{ color: '#38bdf8' }}>Vision Scan & Analysis Model (Tool Model)</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '6px' }}>
                        Model used by <code style={{ color: '#38bdf8' }}>jarvis_analyze_image</code> tool when non-vision models analyze screenshots & image files.
                      </div>
                      {(() => {
                        const fetchedNames = (availableLlmModels || []).map(m => typeof m === 'string' ? m : (m.name || m.id || '')).filter(Boolean);
                        const allNames = Array.from(new Set([
                          ...(settings.llm_vision_model ? [settings.llm_vision_model] : []),
                          ...fetchedNames
                        ]));
                        return (
                          <SearchableModelSelect
                            value={settings.llm_vision_model || ''}
                            onChange={(val) => handleUpdateSetting('llm_vision_model', val)}
                            options={allNames}
                            placeholder="Search or select Vision Scan model..."
                          />
                        );
                      })()}
                    </div>
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

                    {/* TTS Provider Select */}
                    <div className="identity-field" style={{ marginTop: '8px' }}>
                      <span className="field-label">TTS Provider</span>
                      <select
                        value={settings.tts_provider || 'local'}
                        onChange={(e) => {
                          handleUpdateSetting('tts_provider', e.target.value);
                          setTtsCloudOpen(e.target.value !== 'local');
                        }}
                        style={{ width: '100%', padding: '7px 10px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', fontSize: '0.78rem', outline: 'none', cursor: 'pointer', marginTop: '2px' }}
                      >
                        <option value="local" style={{ background: '#0b0813' }}>🖥️ Local — Kokoro ONNX (Offline, Private)</option>
                        <option value="google" style={{ background: '#0b0813' }}>☁️ Google Cloud TTS (1M chars/mo free)</option>
                        <option value="azure" style={{ background: '#0b0813' }}>☁️ Azure Cognitive TTS (500K chars/mo free)</option>
                        <option value="elevenlabs" style={{ background: '#0b0813' }}>☁️ ElevenLabs (10K chars/mo free)</option>
                        <option value="openai" style={{ background: '#0b0813' }}>☁️ OpenAI TTS (pay-per-use)</option>
                        <option value="custom" style={{ background: '#0b0813' }}>🔧 Custom API Endpoint</option>
                      </select>
                    </div>

                    {/* Cloud TTS Config Panel */}
                    {(settings.tts_provider && settings.tts_provider !== 'local') && (
                      <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '10px' }}>
                        <div style={{ fontSize: '0.72rem', color: '#c4b5fd', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>☁️</span> Cloud TTS Configuration
                        </div>

                        {/* API Key */}
                        <div style={{ marginBottom: '8px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>API Key</span>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input
                              type={showTtsKey ? 'text' : 'password'}
                              value={pendingTtsKey !== '' ? pendingTtsKey : (settings.tts_cloud_api_key || '')}
                              onChange={(e) => setPendingTtsKey(e.target.value)}
                              placeholder="Paste your API key here…"
                              style={{ flex: 1, padding: '6px 10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px', color: 'white', fontSize: '0.75rem', outline: 'none' }}
                            />
                            <button
                              type="button"
                              onClick={() => setShowTtsKey(v => !v)}
                              title={showTtsKey ? 'Hide key' : 'Show key'}
                              style={{ padding: '5px 8px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#a78bfa', cursor: 'pointer', fontSize: '0.8rem' }}
                            >{showTtsKey ? '🙈' : '👁️'}</button>
                            {pendingTtsKey && (
                              <button
                                type="button"
                                onClick={() => { handleUpdateSetting('tts_cloud_api_key', pendingTtsKey); setPendingTtsKey(''); }}
                                style={{ padding: '5px 10px', background: 'rgba(139,92,246,0.4)', border: '1px solid rgba(139,92,246,0.5)', borderRadius: '7px', color: 'white', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}
                              >Save</button>
                            )}
                          </div>
                        </div>

                        {/* Voice / Model Name */}
                        <div style={{ marginBottom: '8px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>Voice / Model Name</span>
                          <input
                            type="text"
                            value={settings.tts_cloud_voice || ''}
                            onChange={(e) => handleUpdateSetting('tts_cloud_voice', e.target.value)}
                            placeholder={settings.tts_provider === 'google' ? 'e.g. en-US-Standard-C' : settings.tts_provider === 'azure' ? 'e.g. en-US-AriaNeural' : settings.tts_provider === 'elevenlabs' ? 'Voice ID (21m00Tcm4TlvDq8ikWAM)' : settings.tts_provider === 'openai' ? 'alloy / nova / shimmer' : 'voice or model name'}
                            style={{ width: '100%', padding: '6px 10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px', color: 'white', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>

                        {/* Azure Region (Azure only) */}
                        {settings.tts_provider === 'azure' && (
                          <div style={{ marginBottom: '8px' }}>
                            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>Azure Region</span>
                            <input
                              type="text"
                              value={settings.tts_cloud_region || 'eastus'}
                              onChange={(e) => handleUpdateSetting('tts_cloud_region', e.target.value)}
                              placeholder="e.g. eastus, westeurope"
                              style={{ width: '100%', padding: '6px 10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px', color: 'white', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
                            />
                          </div>
                        )}

                        {/* Custom endpoint URL (custom only) */}
                        {settings.tts_provider === 'custom' && (
                          <div style={{ marginBottom: '8px' }}>
                            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>Endpoint URL</span>
                            <input
                              type="text"
                              value={settings.tts_cloud_endpoint || ''}
                              onChange={(e) => handleUpdateSetting('tts_cloud_endpoint', e.target.value)}
                              placeholder="https://your-tts-api.com/synthesize"
                              style={{ width: '100%', padding: '6px 10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px', color: 'white', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
                            />
                          </div>
                        )}

                        <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
                          ⚡ Keys are encrypted (AES-XOR) on the server and never stored in plain text. On cloud failure, browser speechSynthesis is used as fallback.
                        </div>
                      </div>
                    )}

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

                    {/* STT Provider Select */}
                    <div className="identity-field" style={{ marginTop: '10px' }}>
                      <span className="field-label">Speech-to-Text Provider</span>
                      <select
                        value={settings.stt_provider || 'local'}
                        onChange={(e) => handleUpdateSetting('stt_provider', e.target.value)}
                        style={{ width: '100%', padding: '7px 10px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', fontSize: '0.78rem', outline: 'none', cursor: 'pointer', marginTop: '4px' }}
                      >
                        <option value="local" style={{ background: '#0b0813' }}>🖥️ Local — Faster-Whisper (Offline, Private)</option>
                        <option value="google" style={{ background: '#0b0813' }}>☁️ Google Cloud Speech (60 min/mo free)</option>
                        <option value="azure" style={{ background: '#0b0813' }}>☁️ Azure Cognitive Speech (5 hrs/mo free)</option>
                        <option value="assemblyai" style={{ background: '#0b0813' }}>☁️ AssemblyAI (100 hrs/mo free tier)</option>
                        <option value="deepgram" style={{ background: '#0b0813' }}>☁️ Deepgram Nova-3 ($200 free credit)</option>
                        <option value="custom" style={{ background: '#0b0813' }}>🔧 Custom API Endpoint</option>
                      </select>
                    </div>

                    {/* Cloud STT Config Panel */}
                    {(settings.stt_provider && settings.stt_provider !== 'local') && (
                      <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '10px' }}>
                        <div style={{ fontSize: '0.72rem', color: '#c4b5fd', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>☁️</span> Cloud STT Configuration
                        </div>

                        {/* API Key */}
                        <div style={{ marginBottom: '8px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>API Key</span>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input
                              type={showSttKey ? 'text' : 'password'}
                              value={pendingSttKey !== '' ? pendingSttKey : (settings.stt_cloud_api_key || '')}
                              onChange={(e) => setPendingSttKey(e.target.value)}
                              placeholder="Paste your API key here…"
                              style={{ flex: 1, padding: '6px 10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px', color: 'white', fontSize: '0.75rem', outline: 'none' }}
                            />
                            <button
                              type="button"
                              onClick={() => setShowSttKey(v => !v)}
                              title={showSttKey ? 'Hide key' : 'Show key'}
                              style={{ padding: '5px 8px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#a78bfa', cursor: 'pointer', fontSize: '0.8rem' }}
                            >{showSttKey ? '🙈' : '👁️'}</button>
                            {pendingSttKey && (
                              <button
                                type="button"
                                onClick={() => { handleUpdateSetting('stt_cloud_api_key', pendingSttKey); setPendingSttKey(''); }}
                                style={{ padding: '5px 10px', background: 'rgba(139,92,246,0.4)', border: '1px solid rgba(139,92,246,0.5)', borderRadius: '7px', color: 'white', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}
                              >Save</button>
                            )}
                          </div>
                        </div>

                        {/* Azure Region (Azure only) */}
                        {settings.stt_provider === 'azure' && (
                          <div style={{ marginBottom: '8px' }}>
                            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>Azure Region</span>
                            <input
                              type="text"
                              value={settings.stt_cloud_region || 'eastus'}
                              onChange={(e) => handleUpdateSetting('stt_cloud_region', e.target.value)}
                              placeholder="e.g. eastus, westeurope"
                              style={{ width: '100%', padding: '6px 10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px', color: 'white', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
                            />
                          </div>
                        )}

                        {/* Custom endpoint URL (custom only) */}
                        {settings.stt_provider === 'custom' && (
                          <div style={{ marginBottom: '8px' }}>
                            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' }}>Endpoint URL</span>
                            <input
                              type="text"
                              value={settings.stt_cloud_endpoint || ''}
                              onChange={(e) => handleUpdateSetting('stt_cloud_endpoint', e.target.value)}
                              placeholder="https://your-stt-api.com/transcribe"
                              style={{ width: '100%', padding: '6px 10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px', color: 'white', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
                            />
                          </div>
                        )}

                        <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
                          🔒 Keys are encrypted on the server. On failure, an error toast is shown — no silent fallback for STT.
                        </div>
                      </div>
                    )}

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

                        {/* Whisper Memory Management */}
                        <div style={{ marginTop: '16px', marginBottom: '4px', paddingTop: '12px', borderTop: '1px solid rgba(167, 139, 250, 0.15)' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Memory Management</span>
                        </div>

                        {/* Auto-Unload Toggle */}
                        <div className="identity-field" style={{ marginTop: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="field-label">Auto-Unload Whisper (Save VRAM)</span>
                            <button
                              onClick={() => handleUpdateSetting('whisper_auto_unload', settings.whisper_auto_unload !== false ? false : true)}
                              style={{
                                padding: '4px 12px',
                                borderRadius: '12px',
                                border: 'none',
                                background: settings.whisper_auto_unload !== false ? 'rgba(167, 139, 250, 0.3)' : 'rgba(255,255,255,0.1)',
                                color: settings.whisper_auto_unload !== false ? '#a78bfa' : '#888',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                              }}
                            >
                              {settings.whisper_auto_unload !== false ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                            When ON: unloads Whisper from VRAM when mic is off and VRAM is full or idle too long.
                          </span>
                        </div>

                        {/* VRAM Threshold */}
                        <div className="identity-field" style={{ marginTop: '10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="field-label">VRAM Threshold (Force Unload)</span>
                            <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a78bfa' }}>
                              {settings.whisper_vram_threshold || 90}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="50"
                            max="100"
                            step="5"
                            value={settings.whisper_vram_threshold || 90}
                            onChange={(e) => handleUpdateSetting('whisper_vram_threshold', parseFloat(e.target.value))}
                            style={{ width: '100%', cursor: 'pointer', accentColor: '#a78bfa', marginTop: '4px' }}
                          />
                          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                            When mic is off and GPU VRAM exceeds this %, Whisper is force-unloaded. (Default: 90%)
                          </span>
                        </div>

                        {/* Idle Timeout */}
                        <div className="identity-field" style={{ marginTop: '10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="field-label">Idle Timeout (Auto Unload)</span>
                            <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a78bfa' }}>
                              {settings.whisper_idle_timeout || 300}s
                            </span>
                          </div>
                          <input
                            type="range"
                            min="60"
                            max="600"
                            step="30"
                            value={settings.whisper_idle_timeout || 300}
                            onChange={(e) => handleUpdateSetting('whisper_idle_timeout', parseInt(e.target.value, 10))}
                            style={{ width: '100%', cursor: 'pointer', accentColor: '#a78bfa', marginTop: '4px' }}
                          />
                          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                            When mic is off, unload Whisper after this many seconds of no transcription requests. (Default: 300s)
                          </span>
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
                              try { localStorage.setItem('yuki-custom-skintone-color', newCustom); } catch { }
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
                              try { localStorage.setItem('yuki-camera-tracking', val ? 'true' : 'false'); } catch { }
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

                  {/* Crawler Database Export & Import Buttons */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                    <button
                      onClick={handleExportCrawlerData}
                      className="glass-button"
                      style={{
                        flex: 1,
                        minWidth: '150px',
                        padding: '8px 12px',
                        fontSize: '0.78rem',
                        borderRadius: '8px',
                        fontWeight: 600,
                        background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)',
                        transition: 'all 0.2s'
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Crawler Data JSON</span>
                    </button>

                    <button
                      onClick={() => crawlerFileInputRef.current?.click()}
                      className="glass-button"
                      style={{
                        flex: 1,
                        minWidth: '150px',
                        padding: '8px 12px',
                        fontSize: '0.78rem',
                        borderRadius: '8px',
                        fontWeight: 600,
                        background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        boxShadow: '0 4px 12px rgba(13, 148, 136, 0.3)',
                        transition: 'all 0.2s'
                      }}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Import Crawler Data JSON</span>
                    </button>

                    <input
                      type="file"
                      ref={crawlerFileInputRef}
                      accept=".json"
                      onChange={handleImportCrawlerFile}
                      style={{ display: 'none' }}
                    />
                  </div>
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
                    {toolsList.length} Tools
                  </span>
                </div>

                {/* Mode Filter Selector */}
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', marginBottom: '4px' }}>
                  {['active', 'basic', 'advanced', 'all'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setToolViewMode(m);
                        fetchToolsList(m);
                      }}
                      style={{
                        padding: '3px 8px',
                        fontSize: '0.66rem',
                        borderRadius: '6px',
                        background: toolViewMode === m ? 'rgba(139, 92, 246, 0.35)' : 'rgba(255, 255, 255, 0.05)',
                        border: toolViewMode === m ? '1px solid #a78bfa' : '1px solid rgba(255,255,255,0.08)',
                        color: toolViewMode === m ? '#fff' : '#cbd5e1',
                        cursor: 'pointer',
                        textTransform: 'capitalize'
                      }}
                    >
                      {m === 'active' ? `Active (${settings.tool_mode || 'basic'})` : m}
                    </button>
                  ))}
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
