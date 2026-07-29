import React, { useState, useEffect, useRef } from 'react';
import { 
  Cpu, Terminal, Sparkles, MessageSquare, Monitor, X, Maximize2, Minimize2, 
  Send, RefreshCw, Zap, HardDrive, Database, Eye, EyeOff, Wrench, Search,
  Code, Activity, Brain, Volume2, Mic, MicOff, ChevronDown, ChevronRight,
  Folder, Calendar, Plus, Trash2, History, PanelLeftClose, PanelLeftOpen,
  Settings, Globe, Sliders, Check, ShieldAlert
} from 'lucide-react';
import { RenderMessageContent, AgenticToolTimelineItem, parseMessageThought } from './ChatOverlay';
import { SearchableModelSelect } from './ControlDashboard';
import MicLevelMeter from './MicLevelMeter';
import { API_BASE, WS_BASE } from '../api';

export const AgenticWorkspaceWindow = ({
  messages = [],
  inputText = '',
  onInputChange,
  onSendMessage,
  isGenerating = false,
  modelName = '',
  llmBackend = 'lmstudio',
  availableLlmModels = [],
  onRefreshLlmModels,
  settings = {},
  onUpdateSetting,
  micDevices = [],
  selectedMic = '',
  onMicChange,
  isListening = false,
  onToggleListening,
  vadLevel = 0,
  voiceVolume = 1.0,
  onVolumeChange,
  hostPlatform = 'Unknown',
  systemStats = null
}) => {
  const [activeTab, setActiveTab] = useState('inspector'); // 'inspector' | 'system' | 'memory'
  const [showSidebar, setShowSidebar] = useState(true);
  const [sessionTree, setSessionTree] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [selectedPastSessionId, setSelectedPastSessionId] = useState(null);
  const [viewMessages, setViewMessages] = useState(null); // Loaded messages when inspecting past session
  const [expandedNodes, setExpandedNodes] = useState(new Set()); // Set of expanded node keys (e.g. "year_2026", "date_30 July 2026")
  const messagesEndRef = useRef(null);

  // Standalone Settings Modal State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Chat Window Local Override Tool Mode (Saved in localStorage)
  const [chatWindowToolMode, setChatWindowToolMode] = useState(() => {
    return localStorage.getItem('yuki-chatwindow-tool-mode') || 'advanced';
  });

  // Per-Message System Prompt Component Toggles (Saved in localStorage)
  const [promptPersona, setPromptPersona] = useState(() => {
    return localStorage.getItem('yuki-prompt-persona') !== 'false';
  });
  const [promptExpressions, setPromptExpressions] = useState(() => {
    return localStorage.getItem('yuki-prompt-expressions') !== 'false';
  });
  const [promptMemory, setPromptMemory] = useState(() => {
    return localStorage.getItem('yuki-prompt-memory') !== 'false';
  });
  const [promptDirectives, setPromptDirectives] = useState(() => {
    return localStorage.getItem('yuki-prompt-directives') !== 'false';
  });
  const [promptPlanning, setPromptPlanning] = useState(() => {
    return localStorage.getItem('yuki-prompt-planning') !== 'false';
  });

  // Cross-Window BroadcastChannel Sync
  useEffect(() => {
    let syncChannel;
    try {
      syncChannel = new BroadcastChannel('yuki_chat_sync');
      syncChannel.onmessage = (event) => {
        if (event.data?.type === 'session_tree_update' || event.data?.type === 'session_switched') {
          fetchSessionTree();
          if (event.data?.messages) {
            setViewMessages(event.data.messages);
          }
        }
      };
    } catch (e) {
      console.warn("BroadcastChannel not supported:", e);
    }
    return () => syncChannel?.close();
  }, []);

  // Fetch session hierarchy from backend
  const fetchSessionTree = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.data && data.data.years) {
          setSessionTree(data.data.years);
          if (data.active_session_id) {
            setActiveSessionId(data.active_session_id);
          }

          // Smart Auto-Collapse: expand ONLY active session's Year, Month, and Date
          const activeId = data.active_session_id;
          const initialExpanded = new Set();
          
          data.data.years.forEach((yrObj) => {
            yrObj.months.forEach((mnObj) => {
              mnObj.dates.forEach((dtObj) => {
                const containsActive = dtObj.sessions.some((s) => s.session_id === activeId);
                if (containsActive) {
                  initialExpanded.add(`yr_${yrObj.year}`);
                  initialExpanded.add(`mn_${mnObj.month}`);
                  initialExpanded.add(`dt_${dtObj.date}`);
                }
              });
            });
          });

          // Fallback if active session hasn't been saved yet (default to expanding most recent date)
          if (initialExpanded.size === 0 && data.data.years.length > 0) {
            const firstYr = data.data.years[0];
            initialExpanded.add(`yr_${firstYr.year}`);
            if (firstYr.months.length > 0) {
              const firstMn = firstYr.months[0];
              initialExpanded.add(`mn_${firstMn.month}`);
              if (firstMn.dates.length > 0) {
                initialExpanded.add(`dt_${firstMn.dates[0].date}`);
              }
            }
          }

          setExpandedNodes(initialExpanded);
        }
      }
    } catch (err) {
      console.error("Failed to fetch session tree:", err);
    }
  };

  useEffect(() => {
    fetchSessionTree();
  }, [messages.length]);

  const toggleNode = (nodeKey) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) {
        next.delete(nodeKey);
      } else {
        next.add(nodeKey);
      }
      return next;
    });
  };

  // Inspect and Promote a session to Global Active Session
  const handleSelectSession = async (sessionId) => {
    setSelectedPastSessionId(sessionId);
    try {
      const actRes = await fetch(`${API_BASE}/api/chat/sessions/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });
      if (actRes.ok) {
        const actData = await actRes.json();
        setActiveSessionId(sessionId);
        if (actData.messages) {
          setViewMessages(actData.messages);
        }
      } else {
        const res = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.messages) {
            setViewMessages(data.messages);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load/activate session:", err);
    }
  };

  // Delete a session
  const handleDeleteSession = async (e, sessionId) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
      if (selectedPastSessionId === sessionId) {
        setSelectedPastSessionId(null);
        setViewMessages(null);
      }
      fetchSessionTree();
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  // Trigger New Session
  const handleStartNewSession = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/new`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setActiveSessionId(data.session_id);
        setSelectedPastSessionId(null);
        setViewMessages(null);
        fetchSessionTree();
      }
    } catch (err) {
      console.error("Failed to start new session:", err);
    }
  };

  // Displayed messages: either active turn messages or inspected past session messages
  const displayMessages = selectedPastSessionId && viewMessages ? viewMessages : messages;

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages]);

  // Extract all tool execution events for Inspector
  const toolLogs = React.useMemo(() => {
    const logs = [];
    displayMessages.forEach((msg, idx) => {
      const text = msg.content || "";
      if (text.includes("⚙️ [Tool Start]") || text.includes("⚙️ [Tool Result]")) {
        logs.push({ id: idx, text, role: msg.role });
      }
    });
    return logs;
  }, [displayMessages]);

  // Extract last tool result
  const lastToolResult = React.useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const text = displayMessages[i].content || "";
      if (text.includes("⚙️ [Tool Result]")) {
        return text.replace(/⚙️\s*\[Tool Result\]\s*/i, '').trim();
      }
    }
    return null;
  }, [displayMessages]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100vw',
      height: '100vh',
      background: '#090d16',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      overflow: 'hidden'
    }}>
      {/* ── Top Header Bar ────────────────────────────────────────────── */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: 'rgba(15, 23, 42, 0.95)',
        borderBottom: '1px solid rgba(167, 139, 250, 0.2)',
        backdropFilter: 'blur(12px)',
        zIndex: 100
      }}>
        {/* Left Status & Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setShowSidebar(!showSidebar)}
            title={showSidebar ? "Hide Session History Sidebar" : "Show Session History Sidebar"}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '7px',
              padding: '5px 8px',
              color: '#c4b5fd',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {showSidebar ? <PanelLeftClose style={{ width: '16px', height: '16px' }} /> : <PanelLeftOpen style={{ width: '16px', height: '16px' }} />}
          </button>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'linear-gradient(135deg, rgba(167, 139, 250, 0.2) 0%, rgba(56, 189, 248, 0.2) 100%)',
            padding: '4px 10px',
            borderRadius: '8px',
            border: '1px solid rgba(167, 139, 250, 0.4)'
          }}>
            <Sparkles style={{ width: '15px', height: '15px', color: '#c4b5fd' }} />
            <span style={{ fontWeight: 700, fontSize: '0.84rem', letterSpacing: '0.3px', color: '#ffffff' }}>
              Yuki Agentic Workspace
            </span>
          </div>
        </div>

        {/* Right Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Local Chat Window Tool Suite Override Toggle */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <button
              type="button"
              onClick={() => {
                setChatWindowToolMode('basic');
                localStorage.setItem('yuki-chatwindow-tool-mode', 'basic');
              }}
              title="Override Chat Window mode to Basic Tools (Does not affect main desktop app)"
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.70rem',
                fontWeight: 600,
                border: 'none',
                background: chatWindowToolMode === 'basic' ? 'rgba(167, 139, 250, 0.3)' : 'transparent',
                color: chatWindowToolMode === 'basic' ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              ⚡ Basic
            </button>
            <button
              type="button"
              onClick={() => {
                setChatWindowToolMode('advanced');
                localStorage.setItem('yuki-chatwindow-tool-mode', 'advanced');
              }}
              title="Override Chat Window mode to Autonomous Jarvis (Does not affect main desktop app)"
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.70rem',
                fontWeight: 600,
                border: 'none',
                background: chatWindowToolMode === 'advanced' ? 'rgba(56, 189, 248, 0.3)' : 'transparent',
                color: chatWindowToolMode === 'advanced' ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              🧠 Jarvis Mode
            </button>
          </div>

          {/* Standalone Settings Button */}
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            title="Open Workspace Settings"
            style={{
              padding: '6px 10px',
              borderRadius: '7px',
              border: '1px solid rgba(167, 139, 250, 0.3)',
              background: 'rgba(167, 139, 250, 0.15)',
              color: '#c4b5fd',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '0.72rem',
              fontWeight: 600,
              transition: 'all 0.15s ease'
            }}
          >
            <Settings style={{ width: '13px', height: '13px' }} />
            Settings
          </button>

          {/* Close Window / Dock Back Button */}
          <button
            type="button"
            onClick={() => window.close()}
            title="Close Standalone Workspace"
            style={{
              padding: '6px 10px',
              borderRadius: '7px',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#fca5a5',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.72rem',
              fontWeight: 600,
              transition: 'all 0.15s ease'
            }}
          >
            <X style={{ width: '13px', height: '13px' }} />
            Dock / Close
          </button>
        </div>
      </header>

      {/* ── Main Layout Body ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── SIDEBAR: Hierarchical Chat Session History (Collapsible) ─── */}
        {showSidebar && (
          <aside style={{
            width: '260px',
            background: 'rgba(11, 15, 25, 0.98)',
            borderRight: '1px solid rgba(167, 139, 250, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Sidebar Top Action */}
            <div style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                type="button"
                onClick={handleStartNewSession}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(167, 139, 250, 0.4)',
                  background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(56, 189, 248, 0.25) 100%)',
                  color: '#ffffff',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                <Plus style={{ width: '15px', height: '15px' }} />
                Start New Session
              </button>
            </div>

            {/* Hierarchical Tree Container */}
            <div style={{
              flex: 1,
              padding: '10px 8px',
              overflowY: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(167, 139, 250, 0.3) transparent'
            }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '8px', paddingLeft: '6px' }}>
                Chat History Archive
              </div>

              {sessionTree.length === 0 ? (
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontStyle: 'italic', padding: '10px 6px' }}>
                  No saved sessions yet. Start chatting to archive session logs!
                </div>
              ) : (
                sessionTree.map((yrObj) => {
                  const yrKey = `yr_${yrObj.year}`;
                  const isYrExpanded = expandedNodes.has(yrKey);

                  return (
                    <div key={yrKey} style={{ marginBottom: '6px' }}>
                      {/* Year Node */}
                      <div
                        onClick={() => toggleNode(yrKey)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '5px 6px',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          color: '#c4b5fd',
                          background: 'rgba(255,255,255,0.03)',
                          userSelect: 'none'
                        }}
                      >
                        {isYrExpanded ? <ChevronDown style={{ width: '14px', height: '14px' }} /> : <ChevronRight style={{ width: '14px', height: '14px' }} />}
                        <Folder style={{ width: '14px', height: '14px', color: '#8b5cf6' }} />
                        <span>{yrObj.year}</span>
                      </div>

                      {/* Month Nodes */}
                      {isYrExpanded && (
                        <div style={{ paddingLeft: '12px', marginTop: '4px' }}>
                          {yrObj.months.map((mnObj) => {
                            const mnKey = `mn_${mnObj.month}`;
                            const isMnExpanded = expandedNodes.has(mnKey);

                            return (
                              <div key={mnKey} style={{ marginBottom: '4px' }}>
                                <div
                                  onClick={() => toggleNode(mnKey)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '4px 6px',
                                    borderRadius: '5px',
                                    cursor: 'pointer',
                                    fontSize: '0.74rem',
                                    fontWeight: 600,
                                    color: '#cbd5e1',
                                    userSelect: 'none'
                                  }}
                                >
                                  {isMnExpanded ? <ChevronDown style={{ width: '13px', height: '13px' }} /> : <ChevronRight style={{ width: '13px', height: '13px' }} />}
                                  <Calendar style={{ width: '13px', height: '13px', color: '#38bdf8' }} />
                                  <span>{mnObj.month}</span>
                                </div>

                                {/* Date Nodes */}
                                {isMnExpanded && (
                                  <div style={{ paddingLeft: '12px', marginTop: '3px' }}>
                                    {mnObj.dates.map((dtObj) => {
                                      const dtKey = `dt_${dtObj.date}`;
                                      const isDtExpanded = expandedNodes.has(dtKey);

                                      return (
                                        <div key={dtKey} style={{ marginBottom: '3px' }}>
                                          <div
                                            onClick={() => toggleNode(dtKey)}
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '5px',
                                              padding: '3px 6px',
                                              borderRadius: '4px',
                                              cursor: 'pointer',
                                              fontSize: '0.72rem',
                                              color: '#94a3b8',
                                              userSelect: 'none'
                                            }}
                                          >
                                            {isDtExpanded ? <ChevronDown style={{ width: '12px', height: '12px' }} /> : <ChevronRight style={{ width: '12px', height: '12px' }} />}
                                            <span>📅 {dtObj.date}</span>
                                            <span style={{ fontSize: '0.62rem', opacity: 0.6 }}>({dtObj.sessions.length})</span>
                                          </div>

                                          {/* Session Items */}
                                          {isDtExpanded && (
                                            <div style={{ paddingLeft: '10px', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                              {dtObj.sessions.map((sess) => {
                                                const isActive = sess.session_id === activeSessionId;
                                                const isSelected = sess.session_id === selectedPastSessionId;

                                                return (
                                                  <div
                                                    key={sess.session_id}
                                                    onClick={() => handleSelectSession(sess.session_id)}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'space-between',
                                                      padding: '5px 8px',
                                                      borderRadius: '6px',
                                                      fontSize: '0.70rem',
                                                      cursor: 'pointer',
                                                      background: isSelected
                                                        ? 'rgba(56, 189, 248, 0.25)'
                                                        : isActive
                                                          ? 'rgba(167, 139, 250, 0.2)'
                                                          : 'rgba(255,255,255,0.02)',
                                                      border: isSelected
                                                        ? '1px solid rgba(56, 189, 248, 0.4)'
                                                        : isActive
                                                          ? '1px solid rgba(167, 139, 250, 0.3)'
                                                          : '1px solid transparent',
                                                      color: isSelected ? '#38bdf8' : isActive ? '#c4b5fd' : '#e2e8f0',
                                                      transition: 'all 0.15s ease'
                                                    }}
                                                  >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                                      <MessageSquare style={{ width: '12px', height: '12px', flexShrink: 0 }} />
                                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sess.title}</span>
                                                    </div>

                                                    <button
                                                      type="button"
                                                      onClick={(e) => handleDeleteSession(e, sess.session_id)}
                                                      title="Delete Session"
                                                      style={{
                                                        background: 'none',
                                                        border: 'none',
                                                        color: '#94a3b8',
                                                        opacity: 0.6,
                                                        cursor: 'pointer',
                                                        padding: '2px',
                                                        borderRadius: '3px'
                                                      }}
                                                      onMouseEnter={(e) => e.target.style.opacity = 1}
                                                      onMouseLeave={(e) => e.target.style.opacity = 0.6}
                                                    >
                                                      <Trash2 style={{ width: '11px', height: '11px' }} />
                                                    </button>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}
        
        {/* ── MIDDLE PANE: Agentic Timeline & Chat ────────────────────── */}
        <section style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid rgba(167, 139, 250, 0.15)',
          background: 'rgba(11, 15, 25, 0.85)'
        }}>
          {/* Inspected Past Session Banner */}
          {selectedPastSessionId && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 16px',
              background: 'rgba(56, 189, 248, 0.15)',
              borderBottom: '1px solid rgba(56, 189, 248, 0.3)',
              fontSize: '0.74rem',
              color: '#38bdf8'
            }}>
              <span>📜 Inspecting Archived Session Log ({selectedPastSessionId})</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedPastSessionId(null);
                  setViewMessages(null);
                }}
                style={{
                  background: 'none',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#ffffff',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.68rem',
                  fontWeight: 600
                }}
              >
                Return to Live Session
              </button>
            </div>
          )}

          {/* Chat Messages Feed */}
          <div style={{
            flex: 1,
            padding: '16px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(167, 139, 250, 0.3) transparent'
          }}>
            {displayMessages.length === 0 ? (
              <div style={{
                margin: 'auto',
                textAlign: 'center',
                color: '#64748b',
                maxWidth: '360px',
                padding: '24px'
              }}>
                <Cpu style={{ width: '36px', height: '36px', color: '#a78bfa', margin: '0 auto 12px auto', opacity: 0.8 }} />
                <h3 style={{ color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 600, marginBottom: '6px' }}>
                  Yuki Agentic Workspace Ready
                </h3>
                <p style={{ fontSize: '0.76rem', lineHeight: '1.4' }}>
                  Ask Yuki to write Python code, search local database files, execute shell commands, or perform complex project tasks.
                </p>
              </div>
            ) : (
              displayMessages.map((msg, index) => {
                const isUser = msg.role === 'user';
                const isSystem = msg.role === 'system';
                const isToolEvent = msg.content && (msg.content.includes("⚙️ [Tool Start]") || msg.content.includes("⚙️ [Tool Result]"));

                if (isToolEvent) {
                  return <AgenticToolTimelineItem key={index} content={msg.content} />;
                }

                const { thoughts, cleanContent } = parseMessageThought(msg.content);

                return (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isUser ? 'flex-end' : 'flex-start',
                      maxWidth: '88%',
                      alignSelf: isUser ? 'flex-end' : 'flex-start'
                    }}
                  >
                    {/* Speaker Tag */}
                    <span style={{
                      fontSize: '0.64rem',
                      fontWeight: 700,
                      color: isUser ? '#a78bfa' : '#38bdf8',
                      marginBottom: '3px',
                      paddingLeft: '4px',
                      paddingRight: '4px'
                    }}>
                      {isUser ? 'Master' : 'Yuki AI'}
                    </span>

                    {/* Thought Block */}
                    {thoughts.map((thought, tIdx) => (
                      <details
                        key={tIdx}
                        style={{
                          width: '100%',
                          marginBottom: '6px',
                          background: 'rgba(15, 23, 42, 0.6)',
                          border: '1px solid rgba(167, 139, 250, 0.25)',
                          borderRadius: '8px',
                          padding: '6px 10px',
                          fontSize: '0.72rem',
                          color: '#c4b5fd'
                        }}
                      >
                        <summary style={{ cursor: 'pointer', fontWeight: 600, userSelect: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span>💭 Thinking Process</span>
                        </summary>
                        <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed rgba(167,139,250,0.2)', whiteSpace: 'pre-wrap', lineHeight: '1.4', fontFamily: 'monospace', fontSize: '0.70rem', color: '#e2e8f0' }}>
                          {thought}
                        </div>
                      </details>
                    ))}

                    {/* Message Bubble */}
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                      background: isUser
                        ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.35) 0%, rgba(109, 40, 217, 0.35) 100%)'
                        : 'rgba(15, 23, 42, 0.75)',
                      border: isUser ? '1px solid rgba(167, 139, 250, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#f8fafc',
                      fontSize: '0.82rem',
                      lineHeight: '1.5',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                      wordBreak: 'break-word'
                    }}>
                      <RenderMessageContent content={cleanContent} />
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Prompt Input Box & Controls */}
          <div style={{
            padding: '10px 16px 12px',
            background: 'rgba(15, 23, 42, 0.95)',
            borderTop: '1px solid rgba(167, 139, 250, 0.2)'
          }}>
            {/* Per-Message System Prompt Component Toggles */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px',
              fontSize: '0.68rem',
              color: '#94a3b8',
              userSelect: 'none',
              flexWrap: 'wrap'
            }}>
              <span style={{ fontWeight: 600, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <Sliders style={{ width: '11px', height: '11px' }} /> Prompt Modules:
              </span>
              
              <button
                type="button"
                onClick={() => {
                  const val = !promptPersona;
                  setPromptPersona(val);
                  localStorage.setItem('yuki-prompt-persona', String(val));
                }}
                title="Include/Exclude Yuki Persona & Mood guidelines in system prompt for this turn"
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  border: promptPersona ? '1px solid rgba(167, 139, 250, 0.6)' : '1px solid rgba(255,255,255,0.1)',
                  background: promptPersona ? 'rgba(167, 139, 250, 0.2)' : 'rgba(0,0,0,0.3)',
                  color: promptPersona ? '#c4b5fd' : '#64748b',
                  cursor: 'pointer',
                  fontSize: '0.66rem',
                  fontWeight: 600
                }}
              >
                🎭 Persona {promptPersona ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={() => {
                  const val = !promptExpressions;
                  setPromptExpressions(val);
                  localStorage.setItem('yuki-prompt-expressions', String(val));
                }}
                title="Include/Exclude 3D Avatar Animation & Emotion expression tags in system prompt"
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  border: promptExpressions ? '1px solid rgba(244, 114, 182, 0.6)' : '1px solid rgba(255,255,255,0.1)',
                  background: promptExpressions ? 'rgba(244, 114, 182, 0.2)' : 'rgba(0,0,0,0.3)',
                  color: promptExpressions ? '#f472b6' : '#64748b',
                  cursor: 'pointer',
                  fontSize: '0.66rem',
                  fontWeight: 600
                }}
              >
                🎬 Expressions {promptExpressions ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={() => {
                  const val = !promptMemory;
                  setPromptMemory(val);
                  localStorage.setItem('yuki-prompt-memory', String(val));
                }}
                title="Include/Exclude User Memory Card facts in system prompt"
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  border: promptMemory ? '1px solid rgba(52, 211, 153, 0.6)' : '1px solid rgba(255,255,255,0.1)',
                  background: promptMemory ? 'rgba(52, 211, 153, 0.2)' : 'rgba(0,0,0,0.3)',
                  color: promptMemory ? '#34d399' : '#64748b',
                  cursor: 'pointer',
                  fontSize: '0.66rem',
                  fontWeight: 600
                }}
              >
                🧠 Memory {promptMemory ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={() => {
                  const val = !promptDirectives;
                  setPromptDirectives(val);
                  localStorage.setItem('yuki-prompt-directives', String(val));
                }}
                title="Include/Exclude Jarvis Tool Guidelines & Safety rules in system prompt"
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  border: promptDirectives ? '1px solid rgba(56, 189, 248, 0.6)' : '1px solid rgba(255,255,255,0.1)',
                  background: promptDirectives ? 'rgba(56, 189, 248, 0.2)' : 'rgba(0,0,0,0.3)',
                  color: promptDirectives ? '#38bdf8' : '#64748b',
                  cursor: 'pointer',
                  fontSize: '0.66rem',
                  fontWeight: 600
                }}
              >
                ⚙️ Directives {promptDirectives ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={() => {
                  const val = !promptPlanning;
                  setPromptPlanning(val);
                  localStorage.setItem('yuki-prompt-planning', String(val));
                }}
                title="Include/Exclude Section 5 Complex Coding Implementation Planning directives"
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  border: promptPlanning ? '1px solid rgba(251, 146, 60, 0.6)' : '1px solid rgba(255,255,255,0.1)',
                  background: promptPlanning ? 'rgba(251, 146, 60, 0.2)' : 'rgba(0,0,0,0.3)',
                  color: promptPlanning ? '#fb923c' : '#64748b',
                  cursor: 'pointer',
                  fontSize: '0.66rem',
                  fontWeight: 600
                }}
              >
                📋 Planning {promptPlanning ? 'ON' : 'OFF'}
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (inputText.trim() && onSendMessage) {
                  onSendMessage(inputText);
                }
              }}
              style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
            >
              {/* Mic Voice Toggle */}
              {onToggleListening && (
                <button
                  type="button"
                  onClick={onToggleListening}
                  title={isListening ? "Stop Voice Listening" : "Start Voice Listening"}
                  style={{
                    padding: '9px 11px',
                    borderRadius: '8px',
                    border: isListening ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.15)',
                    background: isListening ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255,255,255,0.06)',
                    color: isListening ? '#fca5a5' : '#cbd5e1',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {isListening ? <MicOff style={{ width: '16px', height: '16px' }} /> : <Mic style={{ width: '16px', height: '16px' }} />}
                </button>
              )}

              {/* Text Area Input */}
              <input
                type="text"
                placeholder="Type a message, slash command (/goal), or request python code..."
                value={inputText}
                onChange={(e) => onInputChange && onInputChange(e.target.value)}
                disabled={isGenerating}
                style={{
                  flex: 1,
                  padding: '9px 14px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(167, 139, 250, 0.35)',
                  borderRadius: '9px',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  outline: 'none',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)'
                }}
              />

              {/* Send Button */}
              <button
                type="submit"
                disabled={isGenerating || !inputText.trim()}
                style={{
                  padding: '9px 16px',
                  borderRadius: '9px',
                  border: 'none',
                  background: isGenerating || !inputText.trim()
                    ? 'rgba(255,255,255,0.1)'
                    : 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.80rem',
                  cursor: isGenerating || !inputText.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 12px rgba(109,40,217,0.35)'
                }}
              >
                {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send
              </button>
            </form>
          </div>

          {/* Bottom Status Footer Bar (Props Input Box Above Taskbar) */}
          <div style={{
            height: '32px',
            background: 'rgba(9, 13, 22, 0.98)',
            borderTop: '1px solid rgba(167, 139, 250, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px',
            fontSize: '0.68rem',
            color: '#94a3b8',
            userSelect: 'none'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#34d399', fontWeight: 600 }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399', boxShadow: '0 0 6px #34d399' }}></span>
                Core Online
              </span>
              <span>Session: <code style={{ color: '#c4b5fd', fontFamily: 'monospace' }}>{activeSessionId || 'session_active'}</code></span>
              <span>Budget: ~40k tokens</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>Type <code style={{ color: '#38bdf8' }}>/goal</code> for autonomous mode</span>
              <span style={{ opacity: 0.5 }}>|</span>
              <span style={{ color: '#c4b5fd' }}>WS Synced</span>
            </div>
          </div>
        </section>

        {/* ── RIGHT PANE: Live Inspector & Context Monitor (35% Width) ─── */}
        <section style={{
          width: '35%',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(7, 10, 18, 0.95)',
          overflow: 'hidden'
        }}>
          {/* Inspector Navigation Tabs */}
          <div style={{
            display: 'flex',
            background: 'rgba(15, 23, 42, 0.8)',
            borderBottom: '1px solid rgba(167, 139, 250, 0.15)',
            padding: '4px'
          }}>
            <button
              type="button"
              onClick={() => setActiveTab('inspector')}
              style={{
                flex: 1,
                padding: '7px 10px',
                fontSize: '0.74rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                background: activeTab === 'inspector' ? 'rgba(167, 139, 250, 0.22)' : 'transparent',
                color: activeTab === 'inspector' ? '#c4b5fd' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                transition: 'all 0.15s ease'
              }}
            >
              <Code style={{ width: '13px', height: '13px' }} /> Live Output
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('system')}
              style={{
                flex: 1,
                padding: '7px 10px',
                fontSize: '0.74rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                background: activeTab === 'system' ? 'rgba(56, 189, 248, 0.22)' : 'transparent',
                color: activeTab === 'system' ? '#38bdf8' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                transition: 'all 0.15s ease'
              }}
            >
              <Activity style={{ width: '13px', height: '13px' }} /> System Stats
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('memory')}
              style={{
                flex: 1,
                padding: '7px 10px',
                fontSize: '0.74rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                background: activeTab === 'memory' ? 'rgba(244, 114, 182, 0.22)' : 'transparent',
                color: activeTab === 'memory' ? '#f472b6' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                transition: 'all 0.15s ease'
              }}
            >
              <Brain style={{ width: '13px', height: '13px' }} /> Memory & State
            </button>
          </div>

          {/* Tab 1: Live Output & Code Inspector */}
          {activeTab === 'inspector' && (
            <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontWeight: '600', fontSize: '0.76rem', color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Terminal style={{ width: '14px', height: '14px' }} />
                Real-Time Tool Execution Log
              </div>

              {lastToolResult ? (
                <div style={{
                  background: '#090d16',
                  border: '1px solid rgba(167, 139, 250, 0.3)',
                  borderRadius: '8px',
                  padding: '10px',
                  fontSize: '0.74rem',
                  fontFamily: 'Consolas, Monaco, monospace',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  color: '#38bdf8'
                }}>
                  <div style={{ fontSize: '0.66rem', color: '#94a3b8', marginBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '4px' }}>
                    Latest Execution Output:
                  </div>
                  {lastToolResult}
                </div>
              ) : (
                <div style={{ fontSize: '0.74rem', color: '#64748b', fontStyle: 'italic', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                  No active tool execution output yet. Ask Yuki to run python code, search files, or execute terminal commands.
                </div>
              )}

              {/* Historical Tool Log Stream */}
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '0.70rem', color: '#94a3b8', fontWeight: 600, marginBottom: '6px' }}>
                  Tool Execution History ({toolLogs.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                  {toolLogs.map((log, i) => (
                    <div key={i} style={{ padding: '6px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '0.70rem', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: System & Diagnostics Monitor */}
          {activeTab === 'system' && (
            <div style={{ flex: 1, padding: '14px', overflowY: 'auto' }}>
              <div style={{ fontWeight: '600', fontSize: '0.76rem', color: '#38bdf8', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Activity style={{ width: '14px', height: '14px' }} />
                Real-Time Host System Diagnostics
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '0.66rem', color: '#94a3b8' }}>Platform</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff', marginTop: '2px' }}>{hostPlatform}</div>
                </div>
                <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '0.66rem', color: '#94a3b8' }}>LLM Backend</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#38bdf8', marginTop: '2px' }}>{llmBackend}</div>
                </div>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(56,189,248,0.2)', fontSize: '0.74rem', color: '#94a3b8' }}>
                To trigger a live CPU/RAM/Disk diagnostic report, ask Yuki: <code>"show system diagnostics"</code> or <code>"check system stats"</code>.
              </div>
            </div>
          )}

          {/* Tab 3: Memory & Mood State */}
          {activeTab === 'memory' && (
            <div style={{ flex: 1, padding: '14px', overflowY: 'auto' }}>
              <div style={{ fontWeight: '600', fontSize: '0.76rem', color: '#f472b6', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Brain style={{ width: '14px', height: '14px' }} />
                Yuki Psychological & Persona Memory Card
              </div>

              <div style={{ background: 'rgba(15, 23, 42, 0.7)', borderRadius: '8px', padding: '10px', border: '1px solid rgba(244, 114, 182, 0.25)', fontSize: '0.74rem', color: '#e2e8f0', lineHeight: '1.4' }}>
                <div style={{ fontSize: '0.68rem', color: '#f472b6', fontWeight: 600, marginBottom: '4px' }}>Saved Profile & Persona Facts</div>
                {settings.user_name ? `• User Name: ${settings.user_name}` : '• No personal user facts remembered yet.'}
              </div>
            </div>
          )}

        </section>
      </div>

      {/* ── Standalone Workspace Settings Modal ─── */}
      {isSettingsModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 8, 15, 0.82)',
          backdropFilter: 'blur(16px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '520px',
            background: 'rgba(15, 23, 42, 0.98)',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            borderRadius: '16px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(139, 92, 246, 0.2)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              borderBottom: '1px solid rgba(167, 139, 250, 0.2)',
              background: 'linear-gradient(135deg, rgba(167, 139, 250, 0.15) 0%, rgba(56, 189, 248, 0.1) 100%)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings style={{ width: '18px', height: '18px', color: '#c4b5fd' }} />
                <h3 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 700, color: '#ffffff' }}>
                  Workspace Settings & LLM Config
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
              >
                <X style={{ width: '16px', height: '16px' }} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '70vh', overflowY: 'auto' }}>
              
              {/* Default Chat Window Tool Mode */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div>
                  <div style={{ fontSize: '0.80rem', fontWeight: 600, color: '#ffffff' }}>Chat Window Tool Mode</div>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Overrides execution tool budget for chats sent from this workspace</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextMode = chatWindowToolMode === 'advanced' ? 'basic' : 'advanced';
                    setChatWindowToolMode(nextMode);
                    localStorage.setItem('yuki-chatwindow-tool-mode', nextMode);
                  }}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '8px',
                    border: chatWindowToolMode === 'advanced' ? '1px solid #38bdf8' : '1px solid #a78bfa',
                    background: chatWindowToolMode === 'advanced' ? 'rgba(56, 189, 248, 0.25)' : 'rgba(167, 139, 250, 0.25)',
                    color: chatWindowToolMode === 'advanced' ? '#38bdf8' : '#c4b5fd',
                    fontWeight: 600,
                    fontSize: '0.74rem',
                    cursor: 'pointer'
                  }}
                >
                  {chatWindowToolMode === 'advanced' ? '🧠 Jarvis (40k)' : '⚡ Basic (2.5k)'}
                </button>
              </div>

              {/* System Prompt Components Preferences */}
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: '0.80rem', fontWeight: 600, color: '#ffffff', marginBottom: '8px' }}>
                  System Prompt Module Defaults
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.72rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={promptPersona}
                      onChange={(e) => {
                        setPromptPersona(e.target.checked);
                        localStorage.setItem('yuki-prompt-persona', String(e.target.checked));
                      }}
                      style={{ accentColor: '#8b5cf6' }}
                    />
                    🎭 Persona & Mood
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={promptExpressions}
                      onChange={(e) => {
                        setPromptExpressions(e.target.checked);
                        localStorage.setItem('yuki-prompt-expressions', String(e.target.checked));
                      }}
                      style={{ accentColor: '#8b5cf6' }}
                    />
                    🎬 Avatar Expressions
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={promptMemory}
                      onChange={(e) => {
                        setPromptMemory(e.target.checked);
                        localStorage.setItem('yuki-prompt-memory', String(e.target.checked));
                      }}
                      style={{ accentColor: '#8b5cf6' }}
                    />
                    🧠 User Memory Card
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={promptDirectives}
                      onChange={(e) => {
                        setPromptDirectives(e.target.checked);
                        localStorage.setItem('yuki-prompt-directives', String(e.target.checked));
                      }}
                      style={{ accentColor: '#8b5cf6' }}
                    />
                    ⚙️ Tool Guidelines
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0', cursor: 'pointer', gridColumn: 'span 2' }}>
                    <input
                      type="checkbox"
                      checked={promptPlanning}
                      onChange={(e) => {
                        setPromptPlanning(e.target.checked);
                        localStorage.setItem('yuki-prompt-planning', String(e.target.checked));
                      }}
                      style={{ accentColor: '#8b5cf6' }}
                    />
                    📋 Implementation Plan Etiquette (Section 5)
                  </label>
                </div>
              </div>

              {/* Voice Volume Control */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Volume2 style={{ width: '13px', height: '13px' }} /> Voice Speech Volume (TTS):
                  </label>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#ffffff' }}>{Math.round(voiceVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={voiceVolume}
                  onChange={(e) => onVolumeChange && onVolumeChange(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#8b5cf6' }}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '12px 18px',
              borderTop: '1px solid rgba(167, 139, 250, 0.2)',
              background: 'rgba(9, 13, 22, 0.95)',
              display: 'flex',
              justify: 'flex-end'
            }}>
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                style={{
                  padding: '7px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.76rem',
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgenticWorkspaceWindow;
