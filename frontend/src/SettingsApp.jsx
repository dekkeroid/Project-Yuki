import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { API_BASE } from './api';

const ControlDashboard = lazy(() => import('./components/ControlDashboard'));

export default function SettingsApp() {
  const [profile, setProfile] = useState({
    user_name: 'User',
    user_interests: [],
    custom_facts: {},
    settings: {
      llm_model: '',
      tts_voice: 'af_bella',
      tts_rate: 'auto',
      character_name: 'Yuki',
      character_persona: ''
    }
  });
  const [backendStatus, setBackendStatus] = useState('online');
  const [modelName, setModelName] = useState('default.vrm');
  const [disabledAnimations, setDisabledAnimations] = useState(() => {
    try {
      const saved = localStorage.getItem('yuki-disabled-animations');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState(() => {
    return localStorage.getItem('yuki-mic-device-id') || '';
  });
  const [vadThreshold, setVadThreshold] = useState(() => {
    const active = localStorage.getItem('yuki-mic-device-id') || 'default';
    const stored = localStorage.getItem(`yuki-vad-threshold-${active}`);
    if (stored !== null && !isNaN(parseFloat(stored))) return parseFloat(stored);
    return parseFloat(localStorage.getItem('yuki-vad-threshold') || '0.16');
  });
  const [silenceTimeout, setSilenceTimeout] = useState(() => {
    const active = localStorage.getItem('yuki-mic-device-id') || 'default';
    const stored = localStorage.getItem(`yuki-silence-timeout-${active}`);
    if (stored !== null && !isNaN(parseInt(stored, 10))) return parseInt(stored, 10);
    return parseInt(localStorage.getItem('yuki-silence-timeout') || '1000', 10);
  });
  const [muteVoice, setMuteVoice] = useState(() => {
    return localStorage.getItem('yuki-mute-voice') === 'true';
  });
  const [voiceVolume, setVoiceVolume] = useState(() => {
    try { return parseFloat(localStorage.getItem('yuki-voice-volume') || '1.0'); } catch { return 1.0; }
  });
  const [availableLlmModels, setAvailableLlmModels] = useState([]);
  const [availableSimpleLlmModels, setAvailableSimpleLlmModels] = useState([]);
  const [availableEmbeddingModels, setAvailableEmbeddingModels] = useState([]);
  const [preferHeadsetMic, setPreferHeadsetMic] = useState(() => {
    return localStorage.getItem('yuki-prefer-headset') !== 'false';
  });
  const [skinToneColor, setSkinToneColor] = useState(() => {
    return localStorage.getItem('yuki-avatar-skintone-color') || '#ffffff';
  });
  const [cameraTracking, setCameraTracking] = useState(() => {
    return localStorage.getItem('yuki-camera-tracking') !== 'false';
  });

  const preferHeadsetRef = useRef(preferHeadsetMic);
  preferHeadsetRef.current = preferHeadsetMic;
  const selectedMicRef = useRef(selectedMicDeviceId);
  selectedMicRef.current = selectedMicDeviceId;

  const handleMicDeviceChange = useCallback((id) => {
    setSelectedMicDeviceId(id);
    if (id) localStorage.setItem('yuki-mic-device-id', id);
    else localStorage.removeItem('yuki-mic-device-id');
  }, []);

  useEffect(() => {
    const active = selectedMicDeviceId || 'default';
    const storedVad = localStorage.getItem(`yuki-vad-threshold-${active}`);
    if (storedVad !== null && !isNaN(parseFloat(storedVad))) {
      setVadThreshold(parseFloat(storedVad));
    } else {
      setVadThreshold(parseFloat(localStorage.getItem('yuki-vad-threshold') || '0.16'));
    }

    const storedTimeout = localStorage.getItem(`yuki-silence-timeout-${active}`);
    if (storedTimeout !== null && !isNaN(parseInt(storedTimeout, 10))) {
      setSilenceTimeout(parseInt(storedTimeout, 10));
    } else {
      setSilenceTimeout(parseInt(localStorage.getItem('yuki-silence-timeout') || '1000', 10));
    }
  }, [selectedMicDeviceId]);

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'yuki-mute-voice') {
        setMuteVoice(e.newValue === 'true');
      }
      if (e.key === 'yuki-voice-volume') {
        const parsed = parseFloat(e.newValue);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          setVoiceVolume(parsed);
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const hostPlatform = useMemo(() => {
    if (window.electronAPI?.platform) {
      const p = window.electronAPI.platform;
      return p === 'win32' ? 'Windows 10/11' : p === 'darwin' ? 'macOS' : 'Linux';
    }
    const ua = navigator.userAgent;
    return ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : 'Linux';
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/profile`);
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        if (data.settings && data.settings.llm_model) {
          setModelName(data.settings.llm_model);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch profile in Settings window:", e);
      setBackendStatus('offline');
    }
  };

  const lastFetchTime = useRef(0);
  const lastSimpleFetchTime = useRef(0);
  const lastEmbeddingFetchTime = useRef(0);
  const FETCH_COOLDOWN_MS = 2000;

  const fetchLlmModels = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchTime.current < FETCH_COOLDOWN_MS) return;
    lastFetchTime.current = now;
    setAvailableLlmModels([]);
    try {
      const res = await fetch(`${API_BASE}/api/models`);
      if (res.ok) {
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setAvailableLlmModels(data.models);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch LLM models:", e);
    }
  };

  const fetchSimpleLlmModels = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastSimpleFetchTime.current < FETCH_COOLDOWN_MS) return;
    lastSimpleFetchTime.current = now;
    setAvailableSimpleLlmModels([]);
    try {
      const res = await fetch(`${API_BASE}/api/models?target=simple`);
      if (res.ok) {
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setAvailableSimpleLlmModels(data.models);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch simple LLM models:", e);
    }
  };

  const fetchEmbeddingModels = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmbeddingFetchTime.current < FETCH_COOLDOWN_MS) return;
    lastEmbeddingFetchTime.current = now;
    setAvailableEmbeddingModels([]);
    try {
      const res = await fetch(`${API_BASE}/api/models?target=embedding`);
      if (res.ok) {
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setAvailableEmbeddingModels(data.models);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch embedding models:", e);
    }
  };

  const refreshMicDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      setMicDevices(audioInputs);
    } catch (e) {
      console.warn("Failed to enumerate mic devices:", e);
    }
  };

  useEffect(() => {
    document.title = 'Settings';
    fetchProfile();
    fetchLlmModels();
    fetchSimpleLlmModels();
    fetchEmbeddingModels();
    refreshMicDevices();

    const onDeviceChange = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        setMicDevices(audioInputs);
        if (preferHeadsetRef.current) {
          const HEADSET_KEYWORDS = [
            'headset', 'headphone', 'headphones', 'earphone', 'earphones', 'earpiece',
            'bluetooth', 'wireless', 'hands-free', 'handsfree', 'airpod', 'airpods',
            'buds', 'external', 'usb', 'ag audio', 'stereo', 'voice'
          ];
          const label = (d) => (d.label || '').toLowerCase();
          const isCommunications = (d) => label(d).includes('communications');
          const hasKeyword = (d) => HEADSET_KEYWORDS.some(kw => label(d).includes(kw));
          let headset = audioInputs.find(d => hasKeyword(d) && !isCommunications(d));
          if (!headset) headset = audioInputs.find(d => hasKeyword(d));
          if (headset && headset.deviceId !== selectedMicRef.current) {
            handleMicDeviceChange(headset.deviceId);
          }
        }
      } catch (e) {
        console.warn("Failed to enumerate mic devices:", e);
      }
    };

    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
  }, []);

  return (
    <Suspense fallback={<div style={{ color: '#8b5cf6', padding: '30px', backgroundColor: '#090d16', minHeight: '100vh', fontFamily: 'sans-serif' }}>Loading Settings...</div>}>
      <ControlDashboard
        profile={profile}
        backendStatus={backendStatus}
        onResetProfile={async () => {
          try {
            await fetch(`${API_BASE}/api/profile/reset`, { method: 'POST' });
            fetchProfile();
          } catch (e) { console.warn(e); }
        }}
        modelName={modelName}
        onProfileUpdate={(updatedProfile) => {
          if (updatedProfile) {
            setProfile(updatedProfile);
            if (updatedProfile.settings && updatedProfile.settings.llm_model) {
              setModelName(updatedProfile.settings.llm_model);
            }
          } else {
            fetchProfile();
          }
        }}
        skinToneColor={skinToneColor}
        onSkinToneChange={(color) => {
          setSkinToneColor(color);
          localStorage.setItem('yuki-avatar-skintone-color', color);
          if (window.electronAPI && window.electronAPI.setSkinToneColor) {
            window.electronAPI.setSkinToneColor(color);
          }
        }}
        cameraTracking={cameraTracking}
        onCameraTrackingChange={(val) => {
          setCameraTracking(val);
          localStorage.setItem('yuki-camera-tracking', val ? 'true' : 'false');
          if (window.electronAPI && window.electronAPI.setCameraTracking) {
            window.electronAPI.setCameraTracking(val);
          }
        }}
        disabledAnimations={disabledAnimations}
        onToggleAnimation={(animName) => {
          setDisabledAnimations(prev => {
            const next = prev.includes(animName) ? prev.filter(a => a !== animName) : [...prev, animName];
            localStorage.setItem('yuki-disabled-animations', JSON.stringify(next));
            return next;
          });
        }}
        micDevices={micDevices}
        selectedMicDeviceId={selectedMicDeviceId}
        onMicDeviceChange={handleMicDeviceChange}
        onRefreshMicDevices={refreshMicDevices}
        vadThreshold={vadThreshold}
        onVadThresholdChange={(val) => {
          setVadThreshold(val);
          const active = selectedMicDeviceId || 'default';
          localStorage.setItem(`yuki-vad-threshold-${active}`, val.toString());
          localStorage.setItem('yuki-vad-threshold', val.toString());
        }}
        silenceTimeout={silenceTimeout}
        onSilenceTimeoutChange={(val) => {
          setSilenceTimeout(val);
          const active = selectedMicDeviceId || 'default';
          localStorage.setItem(`yuki-silence-timeout-${active}`, val.toString());
          localStorage.setItem('yuki-silence-timeout', val.toString());
        }}
        muteVoice={muteVoice}
        onMuteVoiceChange={(muted) => {
          setMuteVoice(muted);
          localStorage.setItem('yuki-mute-voice', muted.toString());
          if (window.electronAPI && window.electronAPI.setVoiceSettings) {
            window.electronAPI.setVoiceSettings({ muted, volume: voiceVolume });
          }
        }}
        voiceVolume={voiceVolume}
        onVoiceVolumeChange={(vol) => {
          setVoiceVolume(vol);
          localStorage.setItem('yuki-voice-volume', vol.toString());
          if (window.electronAPI && window.electronAPI.setVoiceSettings) {
            window.electronAPI.setVoiceSettings({ muted: muteVoice, volume: vol });
          }
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
            const HEADSET_KEYWORDS = [
              'headset', 'headphone', 'headphones', 'earphone', 'earphones', 'earpiece',
              'bluetooth', 'wireless', 'hands-free', 'handsfree', 'airpod', 'airpods',
              'buds', 'external', 'usb', 'ag audio', 'stereo', 'voice'
            ];
            const label = (d) => (d.label || '').toLowerCase();
            const isCommunications = (d) => label(d).includes('communications');
            const hasKeyword = (d) => HEADSET_KEYWORDS.some(kw => label(d).includes(kw));
            let headset = micDevices.find(d => hasKeyword(d) && !isCommunications(d));
            if (!headset) headset = micDevices.find(d => hasKeyword(d));
            if (headset) onMicDeviceChange(headset.deviceId);
          } else {
            onMicDeviceChange('');
          }
        }}
        hostPlatform={hostPlatform}
        initialTab="settings"
        isStandalone={true}
      />
    </Suspense>
  );
}
