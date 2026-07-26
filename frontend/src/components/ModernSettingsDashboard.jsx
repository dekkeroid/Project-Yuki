import React, { useState, useEffect } from 'react';
import { 
  Settings, Cpu, HardDrive, User, Database, RefreshCw, 
  ChevronRight, CheckCircle, Zap, Volume2, VolumeX, Plus, Trash2, 
  Mic, Upload, Monitor, Sparkles, Layers, Sliders, Shield, Activity, Globe
} from 'lucide-react';
import { API_BASE } from '../api';
import { ANIMATIONS } from '../animationsRegistry';

const SKIN_PRESETS = [
  { name: 'Original', value: '#ffffff' },
  { name: 'Fair', value: '#FFE5E5' },
  { name: 'Tan', value: '#d89c7b' },
  { name: 'Bronze', value: '#a3654a' },
  { name: 'Cocoa', value: '#593424' }
];

export default function ModernSettingsDashboard({
  profile: initialProfile,
  backendStatus = 'online',
  onResetProfile,
  modelName = 'default.vrm',
  onProfileUpdate,
  skinToneColor = '#ffffff',
  onSkinToneChange,
  disabledAnimations = [],
  onToggleAnimation,
  micDevices = [],
  selectedMicDeviceId = '',
  onMicDeviceChange,
  onRefreshMicDevices,
  vadThreshold = -45,
  onVadThresholdChange,
  muteVoice = false,
  onMuteVoiceChange,
  voiceVolume = 1.0,
  onVoiceVolumeChange,
  availableLlmModels = [],
  onRefreshLlmModels,
  preferHeadsetMic = false,
  onPreferHeadsetMicChange
}) {
  const [activeTab, setActiveTab] = useState('ai'); // 'ai' | 'voice' | 'graphics' | 'memory' | 'crawler'

  // Settings State from Backend
  const [settings, setSettings] = useState({
    llm_model: '',
    llm_backend: 'ollama',
    llm_base_url: 'http://127.0.0.1:11434',
    llm_api_key: '',
    tts_voice: 'af_bella',
    tts_rate: '1.0',
    tts_device: 'auto',
    tts_preload: true,
    stt_device: 'auto',
    character_name: 'Yuki',
    character_persona: '',
    crawler_paused: false,
    tagger_paused: false,
    active_vrm_model: 'default.vrm',
    whisper_model: 'small',
    use_local_whisper: true,
    stt_language: 'en',
    vrm_dpr: 1.5,
    vrm_fps: 60
  });

  const [localProfile, setLocalProfile] = useState(initialProfile || {
    user_name: 'User',
    user_interests: [],
    custom_facts: {},
    settings: {}
  });

  const [charName, setCharName] = useState('Yuki');
  const [charPersona, setCharPersona] = useState('');
  const [vrmModels, setVrmModels] = useState(['default.vrm']);
  const [vrmUploading, setVrmUploading] = useState(false);
  const [crawlerStatus, setCrawlerStatus] = useState({
    paused: false,
    tagger_paused: false,
    current_path: 'Idle',
    total_files: 0,
    pending_enrichment: 0
  });

  // Memory & Profile Edit States
  const [userNameInput, setUserNameInput] = useState('');
  const [newInterestInput, setNewInterestInput] = useState('');
  const [newFactKey, setNewFactKey] = useState('');
  const [newFactVal, setNewFactVal] = useState('');
  const [editingFactKey, setEditingFactKey] = useState(null);
  const [editingFactVal, setEditingFactVal] = useState('');

  // Initial Fetch
  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || {});
        if (data.settings?.character_name) setCharName(data.settings.character_name);
        if (data.settings?.character_persona) setCharPersona(data.settings.character_persona);
      }
    } catch (e) {
      console.warn("Failed to fetch settings:", e);
    }
  };

  const fetchVrmModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vrm/list`);
      if (res.ok) {
        const data = await res.json();
        setVrmModels(data.models || ['default.vrm']);
      }
    } catch (e) {
      console.warn("Failed to fetch VRMs:", e);
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
      console.warn("Failed to fetch crawler status:", e);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchVrmModels();
    fetchCrawlerStatus();
    if (onRefreshLlmModels) onRefreshLlmModels();
    if (onRefreshMicDevices) onRefreshMicDevices();
  }, []);

  useEffect(() => {
    if (initialProfile) {
      setLocalProfile(initialProfile);
      setUserNameInput(initialProfile.user_name || '');
    }
  }, [initialProfile]);

  // Handlers
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
        setSettings(data.settings);
        if (onProfileUpdate) onProfileUpdate({ ...localProfile, settings: data.settings });
      }
    } catch (e) {
      console.error('Failed to update setting:', e);
    }
  };

  const handleSavePersona = async () => {
    await handleUpdateSetting('character_name', charName);
    await handleUpdateSetting('character_persona', charPersona);
  };

  const handleVrmUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVrmUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/vrm/upload`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        await fetchVrmModels();
        await handleUpdateSetting('active_vrm_model', file.name);
      }
    } catch (err) {
      console.error("VRM Upload failed:", err);
    } finally {
      setVrmUploading(false);
    }
  };

  const handleAddInterest = async () => {
    if (!newInterestInput.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/profile/interests/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interest: newInterestInput.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setLocalProfile(data.profile);
        setNewInterestInput('');
        if (onProfileUpdate) onProfileUpdate(data.profile);
      }
    } catch (e) { console.error(e); }
  };

  const handleDeleteInterest = async (interest) => {
    try {
      const res = await fetch(`${API_BASE}/api/profile/interests/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interest })
      });
      if (res.ok) {
        const data = await res.json();
        setLocalProfile(data.profile);
        if (onProfileUpdate) onProfileUpdate(data.profile);
      }
    } catch (e) { console.error(e); }
  };

  const handleSaveFact = async (key, value) => {
    try {
      const res = await fetch(`${API_BASE}/api/profile/facts/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
      });
      if (res.ok) {
        const data = await res.json();
        setLocalProfile(data.profile);
        setNewFactKey('');
        setNewFactVal('');
        setEditingFactKey(null);
        if (onProfileUpdate) onProfileUpdate(data.profile);
      }
    } catch (e) { console.error(e); }
  };

  const handleDeleteFact = async (key) => {
    try {
      const res = await fetch(`${API_BASE}/api/profile/facts/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      if (res.ok) {
        const data = await res.json();
        setLocalProfile(data.profile);
        if (onProfileUpdate) onProfileUpdate(data.profile);
      }
    } catch (e) { console.error(e); }
  };

  const handleToggleCrawler = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/crawler/toggle`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setCrawlerStatus(prev => ({ ...prev, paused: data.paused }));
      }
    } catch (e) { console.error(e); }
  };

  return (
    <div style={{
      display: 'flex',
      width: '100%',
      minHeight: '100vh',
      backgroundColor: '#090d16',
      color: '#e2e8f0',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    }}>
      {/* Sidebar Navigation */}
      <aside style={{
        width: '260px',
        backgroundColor: '#0d1322',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 16px',
        flexShrink: 0
      }}>
        {/* App Title Branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 8px 24px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{
            width: '38px', height: '38px', borderRadius: '10px',
            background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 15px rgba(139, 92, 246, 0.4)'
          }}>
            <Sparkles size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '700', letterSpacing: '0.02em', color: '#fff' }}>Yuki Studio</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                backgroundColor: backendStatus === 'online' ? '#10b981' : '#ef4444',
                boxShadow: backendStatus === 'online' ? '0 0 8px #10b981' : 'none'
              }} />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '600' }}>
                {backendStatus === 'online' ? 'Backend Ready' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Sidebar Nav Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '20px' }}>
          {[
            { id: 'ai', label: 'AI & Intelligence', icon: Cpu },
            { id: 'voice', label: 'Voice & Speech', icon: Mic },
            { id: 'graphics', label: 'Avatar & Graphics', icon: Layers },
            { id: 'memory', label: 'Memory & Persona', icon: User },
            { id: 'crawler', label: 'File Indexer', icon: Database }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: isActive ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
                  color: isActive ? '#a855f7' : '#94a3b8',
                  fontWeight: isActive ? '600' : '500',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'left'
                }}
              >
                <Icon size={18} color={isActive ? '#a855f7' : '#64748b'} />
                <span style={{ flex: 1 }}>{tab.label}</span>
                {isActive && <ChevronRight size={16} color="#a855f7" />}
              </button>
            );
          })}
        </nav>

        {/* Footer info */}
        <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.75rem', color: '#64748b', paddingLeft: '8px' }}>
          Yuki Desktop Assistant v0.1.2
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '32px 40px', overflowY: 'auto', maxWidth: '1000px' }}>
        
        {/* TAB 1: AI & INTELLIGENCE */}
        {activeTab === 'ai' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            <div>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '1.5rem', fontWeight: '700', color: '#fff' }}>AI & Intelligence Engine</h2>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>Configure LLM models, provider backends, and character persona responses.</p>
            </div>

            {/* Provider & Model Selection Card */}
            <div style={cardStyle}>
              <h3 style={cardHeaderStyle}><Cpu size={18} color="#8b5cf6" /> LLM Provider & Model</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                  <label style={labelStyle}>Execution Backend</label>
                  <select
                    value={settings.llm_backend || 'ollama'}
                    onChange={(e) => handleUpdateSetting('llm_backend', e.target.value)}
                    style={selectStyle}
                  >
                    <option value="ollama">Ollama Local Engine</option>
                    <option value="lmstudio">LM Studio Local Server</option>
                    <option value="openai">OpenAI Cloud API</option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Active LLM Model</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      value={settings.llm_model || ''}
                      onChange={(e) => handleUpdateSetting('llm_model', e.target.value)}
                      style={{ ...selectStyle, flex: 1 }}
                    >
                      <option value="">Select a model...</option>
                      {availableLlmModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <button onClick={onRefreshLlmModels} style={iconButtonStyle} title="Refresh Models">
                      <RefreshCw size={16} color="#a855f7" />
                    </button>
                  </div>
                </div>
              </div>

              {settings.llm_backend === 'lmstudio' && (
                <div style={{ marginTop: '16px' }}>
                  <label style={labelStyle}>LM Studio Server URL</label>
                  <input
                    type="text"
                    value={settings.llm_base_url || 'http://127.0.0.1:1234'}
                    onChange={(e) => handleUpdateSetting('llm_base_url', e.target.value)}
                    style={inputStyle}
                  />
                </div>
              )}

              {settings.llm_backend === 'openai' && (
                <div style={{ marginTop: '16px' }}>
                  <label style={labelStyle}>OpenAI API Key</label>
                  <input
                    type="password"
                    value={settings.llm_api_key || ''}
                    onChange={(e) => handleUpdateSetting('llm_api_key', e.target.value)}
                    placeholder="sk-..."
                    style={inputStyle}
                  />
                </div>
              )}
            </div>

            {/* Character Persona Card */}
            <div style={cardStyle}>
              <h3 style={cardHeaderStyle}><Sparkles size={18} color="#ec4899" /> Companion Persona</h3>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Companion Name</label>
                <input
                  type="text"
                  value={charName}
                  onChange={(e) => setCharName(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>System Prompt / Persona Instructions</label>
                <textarea
                  value={charPersona}
                  onChange={(e) => setCharPersona(e.target.value)}
                  rows={6}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <button onClick={handleSavePersona} style={primaryButtonStyle}>
                Save Persona Settings
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: VOICE & AUDIO */}
        {activeTab === 'voice' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            <div>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '1.5rem', fontWeight: '700', color: '#fff' }}>Voice & Audio Settings</h2>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>Tune neural Text-to-Speech voices, speed, preloading, and speech recognition devices.</p>
            </div>

            {/* Neural TTS Card */}
            <div style={cardStyle}>
              <h3 style={cardHeaderStyle}><Volume2 size={18} color="#10b981" /> Neural Text-To-Speech (Kokoro-ONNX)</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <div>
                  <label style={labelStyle}>Voice Model Persona</label>
                  <select
                    value={settings.tts_voice || 'af_bella'}
                    onChange={(e) => handleUpdateSetting('tts_voice', e.target.value)}
                    style={selectStyle}
                  >
                    <option value="af_bella">Bella (US Female - Natural/Calm)</option>
                    <option value="af_sarah">Sarah (US Female - Cheerful)</option>
                    <option value="af_sky">Sky (US Female - Soft)</option>
                    <option value="am_adam">Adam (US Male - Clear)</option>
                    <option value="am_michael">Michael (US Male - Deep)</option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Speech Speed Factor ({settings.tts_rate || '1.0'}x)</label>
                  <input
                    type="range"
                    min="0.7"
                    max="1.5"
                    step="0.05"
                    value={parseFloat(settings.tts_rate || 1.0)}
                    onChange={(e) => handleUpdateSetting('tts_rate', e.target.value)}
                    style={{ width: '100%', accentColor: '#8b5cf6', margin: '10px 0' }}
                  />
                </div>
              </div>

              {/* Preload Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                <div>
                  <div style={{ fontWeight: '600', color: '#fff', fontSize: '0.9rem' }}>Preload Neural Voice Engine</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Loads Kokoro neural models into memory on app launch for instant speech latency.</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.tts_preload ?? true}
                  onChange={(e) => handleUpdateSetting('tts_preload', e.target.checked)}
                  style={{ width: '20px', height: '20px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                />
              </div>

              {/* Volume & Mute */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginTop: '16px' }}>
                <button
                  onClick={() => onMuteVoiceChange(!muteVoice)}
                  style={{ ...iconButtonStyle, backgroundColor: muteVoice ? 'rgba(239,68,68,0.2)' : 'rgba(139,92,246,0.15)', width: 'auto', padding: '8px 16px', gap: '8px' }}
                >
                  {muteVoice ? <VolumeX size={18} color="#ef4444" /> : <Volume2 size={18} color="#a855f7" />}
                  <span style={{ color: muteVoice ? '#ef4444' : '#a855f7', fontWeight: '600' }}>{muteVoice ? 'Muted' : 'Voice Enabled'}</span>
                </button>

                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <label style={{ ...labelStyle, margin: 0 }}>Volume ({Math.round(voiceVolume * 100)}%)</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={voiceVolume}
                    onChange={(e) => onVoiceVolumeChange(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: '#a855f7' }}
                  />
                </div>
              </div>
            </div>

            {/* Speech Recognition (STT) Card */}
            <div style={cardStyle}>
              <h3 style={cardHeaderStyle}><Mic size={18} color="#3b82f6" /> Speech Recognition (Whisper VAD)</h3>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Input Microphone Device</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    value={selectedMicDeviceId}
                    onChange={(e) => onMicDeviceChange(e.target.value)}
                    style={{ ...selectStyle, flex: 1 }}
                  >
                    <option value="">Default Microphone</option>
                    {micDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 5)}`}</option>
                    ))}
                  </select>
                  <button onClick={onRefreshMicDevices} style={iconButtonStyle} title="Refresh Mics">
                    <RefreshCw size={16} color="#3b82f6" />
                  </button>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Voice Activity Detection (VAD Sensitivity Threshold: {vadThreshold} dB)</label>
                <input
                  type="range"
                  min="-70"
                  max="-20"
                  step="1"
                  value={vadThreshold}
                  onChange={(e) => onVadThresholdChange(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: '#3b82f6' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: AVATAR & GRAPHICS */}
        {activeTab === 'graphics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            <div>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '1.5rem', fontWeight: '700', color: '#fff' }}>Avatar & 3D Graphics</h2>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>Customize 3D VRM characters, skin color, rendering DPR resolution, and framerate limiters.</p>
            </div>

            {/* VRM Selection & Upload Card */}
            <div style={cardStyle}>
              <h3 style={cardHeaderStyle}><Layers size={18} color="#ec4899" /> 3D VRM Model</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'end' }}>
                <div>
                  <label style={labelStyle}>Active Avatar Model</label>
                  <select
                    value={settings.active_vrm_model || 'default.vrm'}
                    onChange={(e) => handleUpdateSetting('active_vrm_model', e.target.value)}
                    style={selectStyle}
                  >
                    {vrmModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', ...primaryButtonStyle, margin: 0, justifyContent: 'center', width: '100%', boxSizing: 'border-box' }}>
                    <Upload size={16} /> {vrmUploading ? 'Uploading...' : 'Upload Custom VRM'}
                    <input type="file" accept=".vrm" onChange={handleVrmUpload} style={{ display: 'none' }} disabled={vrmUploading} />
                  </label>
                </div>
              </div>
            </div>

            {/* Skin Presets & Graphics Performance Card */}
            <div style={cardStyle}>
              <h3 style={cardHeaderStyle}><Sliders size={18} color="#f59e0b" /> Rendering Resolution & Framerate</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <div>
                  <label style={labelStyle}>Device Pixel Ratio (DPR Resolution)</label>
                  <select
                    value={settings.vrm_dpr ?? 1.5}
                    onChange={(e) => handleUpdateSetting('vrm_dpr', parseFloat(e.target.value))}
                    style={selectStyle}
                  >
                    <option value="1.0">1.0x (Standard - Saves VRAM)</option>
                    <option value="1.25">1.25x (High Quality)</option>
                    <option value="1.5">1.5x (Ultra Sharp - Default)</option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Framerate Cap (FPS)</label>
                  <select
                    value={settings.vrm_fps ?? 60}
                    onChange={(e) => handleUpdateSetting('vrm_fps', parseInt(e.target.value))}
                    style={selectStyle}
                  >
                    <option value={30}>30 FPS (Power Saver)</option>
                    <option value={45}>45 FPS (Balanced)</option>
                    <option value={60}>60 FPS (Ultra Smooth - Default)</option>
                  </select>
                </div>
              </div>

              {/* Skin Tint Presets */}
              <div>
                <label style={labelStyle}>Avatar Skin Tone Presets</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {SKIN_PRESETS.map(preset => (
                    <button
                      key={preset.name}
                      onClick={() => onSkinToneChange(preset.value)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '8px',
                        border: skinToneColor === preset.value ? '2px solid #8b5cf6' : '1px solid rgba(255,255,255,0.1)',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        color: '#fff',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <span style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: preset.value, border: '1px solid #000' }} />
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: MEMORY & PERSONA */}
        {activeTab === 'memory' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            <div>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '1.5rem', fontWeight: '700', color: '#fff' }}>Memory & Personalization</h2>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>Manage saved user facts, interests, and profile memory defaults.</p>
            </div>

            {/* User Name Card */}
            <div style={cardStyle}>
              <h3 style={cardHeaderStyle}><User size={18} color="#8b5cf6" /> User Identity</h3>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input
                  type="text"
                  value={userNameInput}
                  onChange={(e) => setUserNameInput(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={async () => {
                    const res = await fetch(`${API_BASE}/api/profile/update`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ user_name: userNameInput })
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setLocalProfile(data.profile);
                      if (onProfileUpdate) onProfileUpdate(data.profile);
                    }
                  }}
                  style={primaryButtonStyle}
                >
                  Update Name
                </button>
              </div>
            </div>

            {/* User Interests Card */}
            <div style={cardStyle}>
              <h3 style={cardHeaderStyle}><Sparkles size={18} color="#f59e0b" /> User Interests</h3>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                <input
                  type="text"
                  placeholder="Add new interest (e.g. Gaming, Cyberpunk, Coding)..."
                  value={newInterestInput}
                  onChange={(e) => setNewInterestInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddInterest()}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={handleAddInterest} style={primaryButtonStyle}>
                  <Plus size={16} /> Add
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {(localProfile.user_interests || []).map(interest => (
                  <span
                    key={interest}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '20px',
                      backgroundColor: 'rgba(139, 92, 246, 0.15)',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      color: '#c084fc',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    {interest}
                    <Trash2
                      size={14}
                      color="#ef4444"
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleDeleteInterest(interest)}
                    />
                  </span>
                ))}
              </div>
            </div>

            {/* Reset Memory Card */}
            <div style={{ ...cardStyle, border: '1px solid rgba(239, 68, 68, 0.3)', backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
              <h3 style={{ ...cardHeaderStyle, color: '#ef4444' }}><Trash2 size={18} color="#ef4444" /> Reset Companion Memory</h3>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '0 0 16px 0' }}>Completely wipe all learned memories, facts, and conversation history.</p>
              <button onClick={onResetProfile} style={{ ...primaryButtonStyle, backgroundColor: '#ef4444', boxShadow: '0 0 15px rgba(239,68,68,0.4)' }}>
                Reset All Memory Data
              </button>
            </div>
          </div>
        )}

        {/* TAB 5: FILE INDEXER & CRAWLER */}
        {activeTab === 'crawler' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            <div>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '1.5rem', fontWeight: '700', color: '#fff' }}>Knowledge Crawler & File Indexer</h2>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>Monitor background file system indexing, AI metadata tagger, and document search.</p>
            </div>

            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <h3 style={cardHeaderStyle}><Globe size={18} color="#10b981" /> File Crawler Service</h3>
                <button
                  onClick={handleToggleCrawler}
                  style={{
                    ...primaryButtonStyle,
                    backgroundColor: crawlerStatus.paused ? '#10b981' : '#f59e0b'
                  }}
                >
                  {crawlerStatus.paused ? 'Resume Indexing' : 'Pause Indexing'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={statBoxStyle}>
                  <div style={statLabelStyle}>Status</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: '700', color: crawlerStatus.paused ? '#f59e0b' : '#10b981' }}>
                    {crawlerStatus.paused ? 'Paused' : 'Active Indexing'}
                  </div>
                </div>

                <div style={statBoxStyle}>
                  <div style={statLabelStyle}>Indexed Files</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#fff' }}>
                    {crawlerStatus.total_files || 0}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Inline Styles
const cardStyle = {
  backgroundColor: '#0d1322',
  borderRadius: '16px',
  padding: '24px',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
};

const cardHeaderStyle = {
  margin: '0 0 20px 0',
  fontSize: '1.1rem',
  fontWeight: '700',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  gap: '10px'
};

const labelStyle = {
  display: 'block',
  fontSize: '0.85rem',
  fontWeight: '600',
  color: '#94a3b8',
  marginBottom: '8px'
};

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '10px',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  color: '#fff',
  fontSize: '0.9rem',
  outline: 'none',
  boxSizing: 'border-box'
};

const selectStyle = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '10px',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  backgroundColor: '#131b2e',
  color: '#fff',
  fontSize: '0.9rem',
  outline: 'none',
  boxSizing: 'border-box'
};

const primaryButtonStyle = {
  padding: '10px 20px',
  borderRadius: '10px',
  border: 'none',
  background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
  color: '#fff',
  fontWeight: '600',
  fontSize: '0.9rem',
  cursor: 'pointer',
  marginTop: '16px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  boxShadow: '0 0 15px rgba(139, 92, 246, 0.3)'
};

const iconButtonStyle = {
  padding: '10px',
  borderRadius: '10px',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const statBoxStyle = {
  padding: '16px',
  borderRadius: '12px',
  backgroundColor: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)'
};

const statLabelStyle = {
  fontSize: '0.8rem',
  color: '#64748b',
  marginBottom: '4px',
  fontWeight: '600',
  textTransform: 'uppercase'
};
