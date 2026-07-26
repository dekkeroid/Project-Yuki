import React, { useState, useEffect, lazy, Suspense } from 'react';
import { API_BASE } from './api';

const ControlDashboard = lazy(() => import('./components/ControlDashboard'));

export default function SettingsApp() {
  const [profile, setProfile] = useState(null);
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
  const [skinToneColor, setSkinToneColor] = useState('#ffdbac');

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
    fetchProfile();
    fetchLlmModels();
    refreshMicDevices();
  }, []);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: '#090d16',
      color: '#e2e8f0',
      overflowY: 'auto',
      padding: '24px',
      boxSizing: 'border-box',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <Suspense fallback={<div style={{ color: '#a855f7', padding: '20px' }}>Loading Control Dashboard...</div>}>
        <ControlDashboard
          API_BASE={API_BASE}
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
    </div>
  );
}
