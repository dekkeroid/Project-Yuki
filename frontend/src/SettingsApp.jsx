import React, { useState, useEffect, lazy, Suspense } from 'react';
import { API_BASE } from './api';

const ModernSettingsDashboard = lazy(() => import('./components/ModernSettingsDashboard'));

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
  const [disabledAnimations, setDisabledAnimations] = useState([]);
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState('');
  const [vadThreshold, setVadThreshold] = useState(-45);
  const [muteVoice, setMuteVoice] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(1.0);
  const [availableLlmModels, setAvailableLlmModels] = useState([]);
  const [preferHeadsetMic, setPreferHeadsetMic] = useState(false);
  const [skinToneColor, setSkinToneColor] = useState('#ffffff');

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
      const res = await fetch(`${API_BASE}/api/llm/models`);
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
    <Suspense fallback={<div style={{ color: '#8b5cf6', padding: '30px', backgroundColor: '#090d16', minHeight: '100vh', fontFamily: 'sans-serif' }}>Loading Settings Studio...</div>}>
      <ModernSettingsDashboard
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
        onSkinToneChange={(color) => setSkinToneColor(color)}
        disabledAnimations={disabledAnimations}
        onToggleAnimation={(animName) => {
          setDisabledAnimations(prev => 
            prev.includes(animName) ? prev.filter(a => a !== animName) : [...prev, animName]
          );
        }}
        micDevices={micDevices}
        selectedMicDeviceId={selectedMicDeviceId}
        onMicDeviceChange={(id) => setSelectedMicDeviceId(id)}
        onRefreshMicDevices={refreshMicDevices}
        vadThreshold={vadThreshold}
        onVadThresholdChange={(val) => setVadThreshold(val)}
        muteVoice={muteVoice}
        onMuteVoiceChange={(muted) => setMuteVoice(muted)}
        voiceVolume={voiceVolume}
        onVoiceVolumeChange={(vol) => setVoiceVolume(vol)}
        availableLlmModels={availableLlmModels}
        onRefreshLlmModels={fetchLlmModels}
        preferHeadsetMic={preferHeadsetMic}
        onPreferHeadsetMicChange={(val) => setPreferHeadsetMic(val)}
      />
    </Suspense>
  );
}
