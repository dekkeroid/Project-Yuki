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
  // Local Input Text State (Fixes standalone typing when props are unpassed)
  const [localInputText, setLocalInputText] = useState('');
  const currentInputText = onInputChange ? inputText : localInputText;
  const handleInputChange = (val) => {
    if (onInputChange) onInputChange(val);
    setLocalInputText(val);
  };

  // Standalone WebSocket Connection for standalone Chat Window mode
  const wsRef = useRef(null);
  useEffect(() => {
    if (onSendMessage) return; // Main app prop provided, use parent socket
    
    let ws;
    try {
      ws = new WebSocket(WS_BASE);
      wsRef.current = ws;
      
      ws.onopen = () => console.log('[ChatWindow] WebSocket connected directly.');
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'chat_update' && data.messages) {
            setViewMessages(data.messages);
          }
        } catch (_) {}
      };
    } catch (e) {
      console.warn('[ChatWindow] WebSocket init error:', e);
    }

    return () => {
      if (ws) ws.close();
    };
  }, [onSendMessage]);

  const handleSendPrompt = (textToSend) => {
    if (!textToSend.trim()) return;
    if (onSendMessage) {
      onSendMessage(textToSend);
    } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        message: textToSend,
        overrides: {
          tool_mode: chatWindowToolMode,
          prompt_persona: promptPersona,
          prompt_expressions: promptExpressions,
          prompt_memory: promptMemory,
          prompt_directives: promptDirectives,
          prompt_planning: promptPlanning
        }
      }));
    }
    handleInputChange('');
  };

  // Standalone Preferences Modal & Active Tab State
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [prefTab, setPrefTab] = useState('appearance'); // 'appearance' | 'engine' | 'prompts' | 'audio'

  // Appearance Preferences (Saved in localStorage)
  const [themeAccent, setThemeAccent] = useState(() => {
    return localStorage.getItem('yuki-chatwindow-theme') || '#8b5cf6';
  });
  const [chatFontSize, setChatFontSize] = useState(() => {
    return localStorage.getItem('yuki-chatwindow-fontsize') || '0.84rem';
  });

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

          {/* Standalone Preferences Button */}
          <button
            type="button"
            onClick={() => setIsPreferencesOpen(true)}
            title="Open Workspace Preferences"
            style={{
              padding: '6px 10px',
              borderRadius: '7px',
              border: `1px solid ${themeAccent}60`,
              background: `${themeAccent}25`,
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '0.72rem',
              fontWeight: 600,
              transition: 'all 0.15s ease'
            }}
          >
            <Sliders style={{ width: '13px', height: '13px' }} />
            Preferences
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

          {/* Prompt Input Container (Modern Unified Card Layout) */}
          <div style={{
            padding: '12px 16px 14px',
            background: 'rgba(15, 23, 42, 0.95)',
            borderTop: '1px solid rgba(167, 139, 250, 0.2)'
          }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendPrompt(currentInputText);
              }}
              style={{
                background: 'rgba(24, 24, 32, 0.95)',
                border: `1px solid ${themeAccent}35`,
                borderRadius: '18px',
                padding: '12px 14px 10px',
                boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 15px ${themeAccent}15`,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              {/* Top Textarea Input Area */}
              <textarea
                value={currentInputText}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendPrompt(currentInputText);
                  }
                }}
                placeholder="Ask Yuki anything, run code, or search session history (Shift+Enter for line break)..."
                rows={2}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#f8fafc',
                  fontSize: chatFontSize || '0.84rem',
                  lineHeight: '1.5',
                  resize: 'none',
                  fontFamily: 'inherit'
                }}
              />

              {/* Bottom Action Bar Inside Container */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justify: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
                paddingTop: '6px',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)'
              }}>
                {/* Left Side: Prompt Module Toggles */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const val = !promptPersona;
                      setPromptPersona(val);
                      localStorage.setItem('yuki-prompt-persona', String(val));
                    }}
                    title="Persona & Mood module"
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      border: promptPersona ? `1px solid ${themeAccent}` : '1px solid rgba(255,255,255,0.1)',
                      background: promptPersona ? `${themeAccent}30` : 'rgba(0,0,0,0.3)',
                      color: promptPersona ? '#ffffff' : '#64748b',
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
                    title="Avatar Expressions module"
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      border: promptExpressions ? '1px solid #f472b6' : '1px solid rgba(255,255,255,0.1)',
                      background: promptExpressions ? 'rgba(244, 114, 182, 0.25)' : 'rgba(0,0,0,0.3)',
                      color: promptExpressions ? '#ffffff' : '#64748b',
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
                    title="User Memory Card module"
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      border: promptMemory ? '1px solid #34d399' : '1px solid rgba(255,255,255,0.1)',
                      background: promptMemory ? 'rgba(52, 211, 153, 0.25)' : 'rgba(0,0,0,0.3)',
                      color: promptMemory ? '#ffffff' : '#64748b',
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
                    title="Tool Directives module"
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      border: promptDirectives ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                      background: promptDirectives ? 'rgba(56, 189, 248, 0.25)' : 'rgba(0,0,0,0.3)',
                      color: promptDirectives ? '#ffffff' : '#64748b',
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
                    title="Section 5 Implementation Plan Etiquette module"
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      border: promptPlanning ? '1px solid #fb923c' : '1px solid rgba(255,255,255,0.1)',
                      background: promptPlanning ? 'rgba(251, 146, 60, 0.25)' : 'rgba(0,0,0,0.3)',
                      color: promptPlanning ? '#ffffff' : '#64748b',
                      cursor: 'pointer',
                      fontSize: '0.66rem',
                      fontWeight: 600
                    }}
                  >
                    📋 Planning {promptPlanning ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* Right Side: Mic + Circular Send Button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {onToggleListening && (
                    <button
                      type="button"
                      onClick={onToggleListening}
                      title={isListening ? "Stop Voice Listening" : "Start Voice Listening"}
                      style={{
                        padding: '6px',
                        borderRadius: '50%',
                        border: 'none',
                        background: isListening ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
                        color: isListening ? '#fca5a5' : '#94a3b8',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      {isListening ? <MicOff style={{ width: '18px', height: '18px' }} /> : <Mic style={{ width: '18px', height: '18px' }} />}
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={!currentInputText.trim()}
                    title="Send Prompt (Enter)"
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      border: 'none',
                      background: currentInputText.trim()
                        ? `linear-gradient(135deg, ${themeAccent} 0%, #0284c7 100%)`
                        : 'rgba(255, 255, 255, 0.1)',
                      color: currentInputText.trim() ? '#ffffff' : '#64748b',
                      cursor: currentInputText.trim() ? 'pointer' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: currentInputText.trim() ? `0 4px 14px ${themeAccent}60` : 'none'
                    }}
                  >
                    <Send style={{ width: '15px', height: '15px' }} />
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Bottom Status Footer Bar (Minimalist Clean Status Bar) */}
          <div style={{
            height: '26px',
            background: 'rgba(9, 13, 22, 0.98)',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            fontSize: '0.66rem',
            color: '#64748b',
            userSelect: 'none'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#10b981', fontWeight: 600 }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }}></span>
                Core Connected
              </span>
              <span style={{ opacity: 0.4 }}>•</span>
              <span>Session: <code style={{ color: themeAccent, fontFamily: 'monospace' }}>{(activeSessionId || '').slice(-12) || 'active'}</code></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Shift+Enter (Line Break) • Enter (Send)</span>
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

      {/* ── Standalone Workspace Preferences Modal (Tabbed) ─── */}
      {isPreferencesOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 8, 15, 0.85)',
          backdropFilter: 'blur(18px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '560px',
            background: 'rgba(15, 23, 42, 0.98)',
            border: `1px solid ${themeAccent}40`,
            borderRadius: '16px',
            boxShadow: `0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px ${themeAccent}30`,
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
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: `linear-gradient(135deg, ${themeAccent}25 0%, rgba(56, 189, 248, 0.1) 100%)`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sliders style={{ width: '18px', height: '18px', color: themeAccent }} />
                <h3 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 700, color: '#ffffff' }}>
                  Workspace Preferences
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPreferencesOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
              >
                <X style={{ width: '16px', height: '16px' }} />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div style={{
              display: 'flex',
              background: 'rgba(0, 0, 0, 0.3)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '4px 12px'
            }}>
              <button
                type="button"
                onClick={() => setPrefTab('appearance')}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: '6px',
                  background: prefTab === 'appearance' ? `${themeAccent}30` : 'transparent',
                  color: prefTab === 'appearance' ? '#ffffff' : '#94a3b8',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                🎨 Appearance
              </button>

              <button
                type="button"
                onClick={() => setPrefTab('engine')}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: '6px',
                  background: prefTab === 'engine' ? `${themeAccent}30` : 'transparent',
                  color: prefTab === 'engine' ? '#ffffff' : '#94a3b8',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                ⚙️ Engine
              </button>

              <button
                type="button"
                onClick={() => setPrefTab('prompts')}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: '6px',
                  background: prefTab === 'prompts' ? `${themeAccent}30` : 'transparent',
                  color: prefTab === 'prompts' ? '#ffffff' : '#94a3b8',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                🎭 Prompts
              </button>
            </div>

            {/* Tab 1: Appearance */}
            {prefTab === 'appearance' && (
              <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '65vh', overflowY: 'auto' }}>
                <div>
                  <label style={{ fontSize: '0.76rem', fontWeight: 600, color: '#c4b5fd', display: 'block', marginBottom: '8px' }}>
                    🎨 Theme Accent Color:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
                    {[
                      { label: 'Violet Neon', color: '#8b5cf6' },
                      { label: 'Cyber Cyan', color: '#38bdf8' },
                      { label: 'Emerald Pulse', color: '#34d399' },
                      { label: 'Rose Gold', color: '#f472b6' }
                    ].map((t) => (
                      <button
                        key={t.color}
                        type="button"
                        onClick={() => {
                          setThemeAccent(t.color);
                          localStorage.setItem('yuki-chatwindow-theme', t.color);
                        }}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          border: themeAccent === t.color ? `2px solid ${t.color}` : '1px solid rgba(255,255,255,0.1)',
                          background: themeAccent === t.color ? `${t.color}35` : 'rgba(0,0,0,0.3)',
                          color: '#ffffff',
                          fontSize: '0.70rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: t.color }}></span>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.76rem', fontWeight: 600, color: '#c4b5fd', display: 'block', marginBottom: '8px' }}>
                    🔤 Chat Font Size:
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {[
                      { label: 'Compact (0.78rem)', size: '0.78rem' },
                      { label: 'Standard (0.84rem)', size: '0.84rem' },
                      { label: 'Large (0.92rem)', size: '0.92rem' }
                    ].map((f) => (
                      <button
                        key={f.size}
                        type="button"
                        onClick={() => {
                          setChatFontSize(f.size);
                          localStorage.setItem('yuki-chatwindow-fontsize', f.size);
                        }}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: '8px',
                          border: chatFontSize === f.size ? `1px solid ${themeAccent}` : '1px solid rgba(255,255,255,0.1)',
                          background: chatFontSize === f.size ? `${themeAccent}30` : 'rgba(0,0,0,0.3)',
                          color: chatFontSize === f.size ? '#ffffff' : '#94a3b8',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Workspace Engine */}
            {prefTab === 'engine' && (
              <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '65vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div>
                    <div style={{ fontSize: '0.80rem', fontWeight: 600, color: '#ffffff' }}>Chat Window Tool Suite Mode</div>
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
              </div>
            )}

            {/* Tab 3: System Prompt Modules */}
            {prefTab === 'prompts' && (
              <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '65vh', overflowY: 'auto' }}>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '0.80rem', fontWeight: 600, color: '#ffffff', marginBottom: '10px' }}>
                    System Prompt Module Defaults
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.74rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={promptPersona}
                        onChange={(e) => {
                          setPromptPersona(e.target.checked);
                          localStorage.setItem('yuki-prompt-persona', String(e.target.checked));
                        }}
                        style={{ accentColor: themeAccent }}
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
                        style={{ accentColor: themeAccent }}
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
                        style={{ accentColor: themeAccent }}
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
                        style={{ accentColor: themeAccent }}
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
                        style={{ accentColor: themeAccent }}
                      />
                      📋 Implementation Plan Etiquette (Section 5)
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Audio & Speech */}
            {prefTab === 'audio' && (
              <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '65vh', overflowY: 'auto' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '0.76rem', fontWeight: 600, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Volume2 style={{ width: '14px', height: '14px' }} /> Voice Speech Volume (TTS):
                    </label>
                    <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#ffffff' }}>{Math.round(voiceVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={voiceVolume}
                    onChange={(e) => onVolumeChange && onVolumeChange(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: themeAccent }}
                  />
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div style={{
              padding: '12px 18px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(9, 13, 22, 0.95)',
              display: 'flex',
              justify: 'flex-end'
            }}>
              <button
                type="button"
                onClick={() => setIsPreferencesOpen(false)}
                style={{
                  padding: '7px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  background: `linear-gradient(135deg, ${themeAccent} 0%, #6d28d9 100%)`,
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
