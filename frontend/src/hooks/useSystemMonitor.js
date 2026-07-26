import { useState, useEffect, useCallback } from 'react';

export function useSystemMonitor({
  API_BASE,
  setModelName,
  isSettingsOpen,
  activeTab
}) {
  const [cpuLoad, setCpuLoad] = useState(0);
  const [memoryLoad, setMemoryLoad] = useState(0);
  const [diskLoad, setDiskLoad] = useState(0);
  const [activeBackendProcessCount, setActiveBackendProcessCount] = useState(0);
  const [systemIdleTime, setSystemIdleTime] = useState(0);
  const [crawlerStatus, setCrawlerStatus] = useState(null);

  const fetchHealthDetails = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) {
        const data = await response.json();
        
        if (data.cpu_percent !== undefined) setCpuLoad(data.cpu_percent);
        if (data.ram_info && data.ram_info.percent !== undefined) setMemoryLoad(data.ram_info.percent);
        if (data.disk_info && data.disk_info.percent !== undefined) setDiskLoad(data.disk_info.percent);
        
        if (data.model) setModelName(data.model); // App.jsx originally used data.model
        if (data.model_name) setModelName(data.model_name);
        
        if (data.active_tasks !== undefined) setActiveBackendProcessCount(data.active_tasks);
        if (data.system_idle_time !== undefined) setSystemIdleTime(data.system_idle_time);
      }
    } catch (e) {
      console.warn("Could not load health details from API:", e);
    }
  }, [API_BASE, setModelName]);

  const fetchCrawlerStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/crawler/status`);
      if (res.ok) {
        const data = await res.json();
        setCrawlerStatus(data);
      }
    } catch (e) {
      console.warn('Could not fetch crawler status:', e);
    }
  }, [API_BASE]);

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
  }, [isSettingsOpen, activeTab, fetchCrawlerStatus]);

  return {
    cpuLoad,
    setCpuLoad,
    memoryLoad,
    setMemoryLoad,
    diskLoad,
    setDiskLoad,
    activeBackendProcessCount,
    setActiveBackendProcessCount,
    systemIdleTime,
    setSystemIdleTime,
    crawlerStatus,
    setCrawlerStatus,
    fetchHealthDetails,
    fetchCrawlerStatus
  };
}
