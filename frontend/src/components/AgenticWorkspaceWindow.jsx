import React, { useState, useEffect, useRef } from 'react';
import { 
  Cpu, Terminal, Sparkles, MessageSquare, Monitor, X, Maximize2, Minimize2, 
  Send, RefreshCw, Zap, HardDrive, Database, Eye, EyeOff, Wrench, Search,
  Code, Activity, Brain, Volume2, Mic, MicOff, RefreshCw as RefreshIcon
} from 'lucide-react';
import { RenderMessageContent, AgenticToolTimelineItem, parseMessageThought } from './ChatOverlay';
import MicLevelMeter from './MicLevelMeter';
import { API_BASE } from '../api';

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
  const [inspectorFilter, setInspectorFilter] = useState('all'); // 'all' | 'code' | 'db' | 'terminal'
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Extract all tool execution events from messages for the Inspector
  const toolLogs = React.useMemo(() => {
    const logs = [];
    messages.forEach((msg, idx) => {
      const text = msg.content || "";
      if (text.includes("⚙️ [Tool Start]") || text.includes("⚙️ [Tool Result]")) {
        logs.push({ id: idx, text, role: msg.role });
      }
    });
    return logs;
  }, [messages]);

  // Extract last tool output or python execution result
  const lastToolResult = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = messages[i].content || "";
      if (text.includes("⚙️ [Tool Result]")) {
        return text.replace(/⚙️\s*\[Tool Result\]\s*/i, '').trim();
      }
    }
    return null;
  }, [messages]);

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

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.72rem',
            color: '#94a3b8',
            background: 'rgba(255,255,255,0.04)',
            padding: '4px 10px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.08)'
          }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }}></span>
            <span>{settings.llm_model || modelName || 'Frontier Agent'}</span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span style={{ color: '#c4b5fd' }}>{settings.tool_mode === 'advanced' ? 'Autonomous Jarvis' : 'Basic Tools'}</span>
          </div>
        </div>

        {/* Right Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Tool Suite Mode Toggle */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <button
              type="button"
              onClick={() => onUpdateSetting && onUpdateSetting('tool_mode', 'basic')}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.70rem',
                fontWeight: 600,
                border: 'none',
                background: (settings.tool_mode || 'basic') === 'basic' ? 'rgba(167, 139, 250, 0.3)' : 'transparent',
                color: (settings.tool_mode || 'basic') === 'basic' ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              ⚡ Basic
            </button>
            <button
              type="button"
              onClick={() => onUpdateSetting && onUpdateSetting('tool_mode', 'advanced')}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.70rem',
                fontWeight: 600,
                border: 'none',
                background: settings.tool_mode === 'advanced' ? 'rgba(56, 189, 248, 0.3)' : 'transparent',
                color: settings.tool_mode === 'advanced' ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              🧠 Jarvis Mode
            </button>
          </div>

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

      {/* ── Main Dual-Pane Body ────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* ── LEFT PANE: Agentic Timeline & Chat (60% Width) ──────────── */}
        <section style={{
          width: '60%',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid rgba(167, 139, 250, 0.15)',
          background: 'rgba(11, 15, 25, 0.85)'
        }}>
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
            {messages.length === 0 ? (
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
              messages.map((msg, index) => {
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
            padding: '12px 16px',
            background: 'rgba(15, 23, 42, 0.95)',
            borderTop: '1px solid rgba(167, 139, 250, 0.2)'
          }}>
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
        </section>

        {/* ── RIGHT PANE: Live Inspector & Context Monitor (40% Width) ─── */}
        <section style={{
          width: '40%',
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
    </div>
  );
};

export default AgenticWorkspaceWindow;
