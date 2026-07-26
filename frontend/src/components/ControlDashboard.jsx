import React, { useState, useEffect } from 'react';
import { Settings, Cpu, HardDrive, User, Database, Trash2, RefreshCw, ChevronDown, CheckCircle, Zap, Volume2, VolumeX, UserCheck, Plus, Trash, Mic, Upload, Monitor } from 'lucide-react';
import { API_BASE } from '../api';
import { ANIMATIONS } from '../animationsRegistry';

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
  onPreferHeadsetMicChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('memory');

  // Camera tracking toggle state (persisted via localStorage in AvatarViewer)
  const [cameraTracking, setCameraTracking] = useState(() => {
    try { return localStorage.getItem('yuki-camera-tracking') !== 'false'; } catch { return true; }
  });

  // Model selector state removed

  // Settings State
  const [settings, setSettings] = useState({
    llm_model: '',
    llm_backend: 'lmstudio',
    llm_base_url: '',
    llm_api_key: '',
    tts_voice: 'en-US-AnaNeural',
    tts_rate: '+15%',
    tts_device: 'auto',
    stt_device: 'auto',
    character_name: 'Yuki',
    character_persona: '',
    crawler_paused: false,
    tagger_paused: false,
    active_vrm_model: 'default.vrm'
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

  const interests = profile.user_interests || [];
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
        setSettings(data);
      }
    } catch (e) {
      console.warn('Could not fetch settings:', e);
    }
  };

  const handleUpdateSetting = async (key, value) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        if (key === 'llm_model') {
          setActiveModel(data.settings.llm_model);
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
      <div className="dashboard-trigger-top">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`trigger-gear-btn glass-panel ${isOpen ? 'active' : ''}`}
          title="Yuki Settings & Memory"
        >
          <Settings className={`w-5 h-5 ${isOpen ? 'rotate-45' : ''}`} style={{ transition: 'transform 0.3s' }} />
        </button>
      </div>

      {/* Slide-out Settings Panel (Left side) */}
      <div
        className="slide-panel-left glass-panel"
        style={{
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
            Memories
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
            System Info
          </button>
        </div>

        {/* Tab Contents */}
        <div className="tab-panel-body">
          {activeTab === 'memory' ? (
            <>
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
          ) : activeTab === 'settings' ? (
            <>
              {/* Settings Group */}
              <div className="card-group">
                <div className="card-group-header">
                  <Cpu className="w-4 h-4" />
                  <span className="card-group-title">Yuki Assistant Settings</span>
                </div>



                {/* VRM Avatar Model dropdown */}
                <div className="identity-field" style={{ marginTop: '4px' }}>
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
                          {model.replace('.vrm', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} {vrmCustomModels.includes(model) ? '(Custom)' : ''}
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
                  </div>
                </div>

                {/* Model Credits */}
                <details style={{ marginTop: '6px' }}>
                  <summary style={{
                    fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
                    userSelect: 'none', outline: 'none',
                  }}>
                    Model Credits
                  </summary>
                  <div style={{
                    marginTop: '6px', padding: '10px 12px', borderRadius: '8px',
                    background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)',
                    fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', lineHeight: '1.6',
                  }}>
                    <div style={{ marginBottom: '8px' }}>
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

                {/* TTS Voice Selection */}
                <div className="identity-field" style={{ marginTop: '4px' }}>
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

                {/* TTS Speech Speed Rate */}
                <div className="identity-field" style={{ marginTop: '4px' }}>
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

                {/* TTS Device Selection */}
                <div className="identity-field" style={{ marginTop: '4px' }}>
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

                {/* TTS Preload Toggle */}
                <div className="identity-field" style={{ marginTop: '4px' }}>
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
                {/* Microphone Input Device */}
                <div className="identity-field" style={{ marginTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Mic style={{ width: '13px', height: '13px', color: '#a78bfa' }} />
                      Microphone Input Device
                    </span>
                    <button
                      type="button"
                      onClick={onRefreshMicDevices}
                      title="Refresh device list"
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                    >
                      <RefreshCw style={{ width: '11px', height: '11px' }} /> Refresh
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
                    <option value="" style={{ background: '#0b0813', color: 'white' }}>🎙️ System Default</option>
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
                </div>

                {/* LLM Backend Type */}
                <div className="identity-field" style={{ marginTop: '10px' }}>
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
                        openai: '',
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
                    <option value="openai">OpenAI-Compatible (Cloud)</option>
                    <option value="custom">Custom Endpoint</option>
                    <option value="none">No LLM (Voice + File Search Only)</option>
                  </select>
                </div>

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
                        settings.llm_backend === 'openai' ? 'https://api.groq.com/openai' :
                        'http://127.0.0.1:8000/v1'
                      }
                      value={settings.llm_base_url || ''}
                      onChange={(e) => handleUpdateSetting('llm_base_url', e.target.value)}
                      onBlur={(e) => {
                        if (!e.target.value.trim()) {
                          const defaults = {
                            lmstudio: 'http://127.0.0.1:1234',
                            ollama: 'http://127.0.0.1:11434',
                            vllm: 'http://127.0.0.1:8000/v1',
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
                    <span className="field-label">API Key</span>
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
                    {availableLlmModels.map((model) => (
                      <option key={model.name} value={model.name} style={{ background: '#0b0813', color: 'white' }}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>
                )}

                {/* Speech-to-Text Engine Select */}
                <div className="identity-field" style={{ marginTop: '10px' }}>
                  <span className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Mic style={{ width: '13px', height: '13px', color: '#a78bfa' }} />
                    Speech-to-Text Engine
                  </span>
                  <select
                    value={settings.use_local_whisper !== undefined ? (settings.use_local_whisper ? 'local_whisper' : 'web_speech') : 'local_whisper'}
                    onChange={(e) => handleUpdateSetting('use_local_whisper', e.target.value === 'local_whisper')}
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
                    <option value="local_whisper" style={{ background: '#0b0813', color: 'white' }}>🎙️ Local Whisper (Offline / Recommended)</option>
                    <option value="web_speech" style={{ background: '#0b0813', color: 'white' }}>🌐 Web Speech API (Browser Native)</option>
                  </select>
                </div>

                {/* Local Whisper Model Select */}
                {(settings.use_local_whisper !== false) && (
                  <>
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
                        <option value="base" style={{ background: '#0b0813', color: 'white' }}>Base Model (Accurate / ~140MB)</option>
                        <option value="small" style={{ background: '#0b0813', color: 'white' }}>Small Model (High Accuracy / ~460MB)</option>
                        <option value="tiny" style={{ background: '#0b0813', color: 'white' }}>Tiny Model (Fastest / ~70MB)</option>
                      </select>
                    </div>

                    {/* STT Device Selection */}
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

                    {/* VAD Sensitivity Threshold Slider */}
                    <div className="identity-field" style={{ marginTop: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="field-label">VAD Sensitivity Threshold</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#a78bfa' }}>
                          {vadThreshold.toFixed(3)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.002"
                        max="0.08"
                        step="0.002"
                        value={vadThreshold}
                        onChange={(e) => onVadThresholdChange && onVadThresholdChange(parseFloat(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#a78bfa', marginTop: '4px' }}
                      />
                      <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px', display: 'block', lineHeight: '1.2' }}>
                        Increase if room noise triggers continuous listening loops.
                      </span>
                    </div>

                    {/* Speech-to-Text Language Select */}
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
                      </select>
                    </div>
                  </>
                )}

                {/* Voice Volume & Mute Controls */}
                <div className="identity-field" style={{ marginTop: '10px' }}>
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

                {/* Skin Tone Customization */}
                <div className="identity-field" style={{ marginTop: '10px' }}>
                  <span className="field-label">Avatar Skin Color</span>

                  {/* Presets */}
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {SKIN_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => onSkinToneChange && onSkinToneChange(preset.value)}
                        style={{
                          flex: '1 1 auto',
                          padding: '5px 6px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          borderRadius: '6px',
                          border: skinToneColor === preset.value ? '2px solid #2dd4bf' : '1px solid rgba(255,255,255,0.15)',
                          background: preset.value === '#ffffff' ? '#ffffff' : preset.value,
                          color: preset.value === '#ffffff' || preset.value === '#FFE5E5' || preset.value === '#d89c7b' ? '#111' : '#fff',
                          cursor: 'pointer',
                          textAlign: 'center',
                          boxShadow: skinToneColor === preset.value ? '0 0 8px rgba(45, 212, 191, 0.4)' : 'none',
                          transition: 'all 0.15s'
                        }}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>

                  {/* Custom color input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Custom Color:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                      <input
                        type="color"
                        value={skinToneColor}
                        onChange={(e) => onSkinToneChange && onSkinToneChange(e.target.value)}
                        style={{
                          border: 'none',
                          width: '30px',
                          height: '30px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          background: 'none',
                          padding: 0
                        }}
                      />
                      <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#ccc', fontWeight: 600 }}>
                        {skinToneColor.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Camera-Aware Gaze Tracking Toggle */}
              <div className="card-group" style={{ marginTop: '12px' }}>
                <div className="card-group-header">
                  <Cpu className="w-4 h-4 text-teal-400" />
                  <span className="card-group-title">Rotation Behavior</span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '6px', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={cameraTracking}
                    onChange={(e) => {
                      setCameraTracking(e.target.checked);
                      if (window.yukiDebugToggles) window.yukiDebugToggles.cameraTracking = e.target.checked;
                    }}
                    style={{ accentColor: '#2dd4bf', width: '13px', height: '13px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#99f6e4', lineHeight: 1.3 }}>
                    Enable looking at you — head tracks camera position
                  </span>
                </label>
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

              {/* Format / Wipe memory action at bottom of settings */}
              <button
                onClick={onResetProfile}
                className="panel-btn-action"
                style={{ marginTop: 'auto' }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Format Memory Matrix</span>
              </button>
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
