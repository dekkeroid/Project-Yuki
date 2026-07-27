import React, { useState, useEffect, lazy, Suspense } from 'react';
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
      tts_rate: '1.0',
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
    return parseFloat(localStorage.getItem('yuki-vad-threshold') || '0.01');
  });
  const [muteVoice, setMuteVoice] = useState(() => {
    return localStorage.getItem('yuki-mute-voice') === 'true';
  });
  const [voiceVolume, setVoiceVolume] = useState(() => {
    try { return parseFloat(localStorage.getItem('yuki-voice-volume') || '1.0'); } catch { return 1.0; }
  });
  const [availableLlmModels, setAvailableLlmModels] = useState([]);
  const [preferHeadsetMic, setPreferHeadsetMic] = useState(() => {
    return localStorage.getItem('yuki-prefer-headset') !== 'false';
  });
  const [skinToneColor, setSkinToneColor] = useState(() => {
    return localStorage.getItem('yuki-avatar-skintone-color') || '#ffffff';
  });
  const [cameraTracking, setCameraTracking] = useState(() => {
    return localStorage.getItem('yuki-camera-tracking') !== 'false';
  });

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

  const fetchLlmModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/models`);
      if (res.ok) {
        const data = await res.json();
        setAvailableLlmModels(data.models || []);
      }
    } catch (e) {
      console.warn("Failed to fetch LLM models:", e);
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
    refreshMicDevices();
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
          setProfile(updatedProfile);
          if (updatedProfile.settings && updatedProfile.settings.llm_model) {
            setModelName(updatedProfile.settings.llm_model);
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
        onMicDeviceChange={(id) => {
          setSelectedMicDeviceId(id);
          if (id) localStorage.setItem('yuki-mic-device-id', id);
          else localStorage.removeItem('yuki-mic-device-id');
        }}
        onRefreshMicDevices={refreshMicDevices}
        vadThreshold={vadThreshold}
        onVadThresholdChange={(val) => {
          setVadThreshold(val);
          localStorage.setItem('yuki-vad-threshold', val.toString());
        }}
        muteVoice={muteVoice}
        onMuteVoiceChange={(muted) => {
          setMuteVoice(muted);
          localStorage.setItem('yuki-mute-voice', muted.toString());
        }}
        voiceVolume={voiceVolume}
        onVoiceVolumeChange={(vol) => {
          setVoiceVolume(vol);
          localStorage.setItem('yuki-voice-volume', vol.toString());
        }}
        availableLlmModels={availableLlmModels}
        onRefreshLlmModels={fetchLlmModels}
        preferHeadsetMic={preferHeadsetMic}
        onPreferHeadsetMicChange={(val) => {
          setPreferHeadsetMic(val);
          localStorage.setItem('yuki-prefer-headset', val.toString());
        }}
        initialTab="settings"
        isStandalone={true}
      />
    </Suspense>
  );
}
