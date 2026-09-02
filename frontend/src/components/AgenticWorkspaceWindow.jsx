import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Cpu, Terminal, Sparkles, MessageSquare, Monitor, X, Maximize2, Minimize2,
  Send, RefreshCw, Zap, HardDrive, Database, Eye, EyeOff, Wrench, Search,
  Code, Activity, Brain, Volume2, Mic, MicOff, ChevronDown, ChevronRight,
  Folder, Calendar, Plus, Trash2, History, PanelLeftClose, PanelLeftOpen,
  Settings, Globe, Sliders, Check, ShieldAlert, Tag, FolderPlus, FolderOpen, Layers,
  FileText, ExternalLink, Square, Key, Paperclip, Image, Edit2
} from 'lucide-react';
import { RenderMessageContent, AgenticToolTimelineItem, parseMessageThought, renderMessageAttachments } from './ChatOverlay';
import { SearchableModelSelect } from './ControlDashboard';
import MicLevelMeter from './MicLevelMeter';
import { API_BASE } from '../api';
import { useBackendSocket } from '../hooks/useBackendSocket';

const renderHighlightedText = (text, query, exactMatch = false) => {
  if (!text || !query || !query.trim()) return text;
  
  const hasSpaces = query.startsWith(' ') || query.endsWith(' ');
  let regex;
  try {
    if (exactMatch && !hasSpaces) {
      regex = new RegExp(`\\b(${query.trim().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')})\\b`, 'gi');
    } else {
      regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')})`, 'gi');
    }
  } catch (e) {
    return text;
  }

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    parts.push(
      <span
        key={match.index}
        style={{
          backgroundColor: 'rgba(245, 158, 11, 0.4)',
          color: '#fbbf24',
          borderRadius: '3px',
          padding: '0 2px',
          fontWeight: 700
        }}
      >
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
};

const renderTreeFileIcon = (fileName) => {
  const ext = fileName.split('.').pop().toLowerCase();
  if (["js", "ts", "jsx", "tsx", "py", "c", "cpp", "java", "cs", "rb", "go", "rs"].includes(ext)) {
    return <Code style={{ width: '13px', height: '13px', color: '#a78bfa', flexShrink: 0 }} />;
  }
  if (["css", "scss", "sass", "less"].includes(ext)) {
    return <Sliders style={{ width: '13px', height: '13px', color: '#38bdf8', flexShrink: 0 }} />;
  }
  if (["html", "htm"].includes(ext)) {
    return <Globe style={{ width: '13px', height: '13px', color: '#38bdf8', flexShrink: 0 }} />;
  }
  if (["json", "yaml", "yml", "toml", "db", "sqlite", "env"].includes(ext)) {
    return <Database style={{ width: '13px', height: '13px', color: '#f59e0b', flexShrink: 0 }} />;
  }
  if (["png", "jpg", "jpeg", "svg", "webp", "gif", "ico", "bmp"].includes(ext)) {
    return <Eye style={{ width: '13px', height: '13px', color: '#4ade80', flexShrink: 0 }} />;
  }
  return <FileText style={{ width: '13px', height: '13px', color: '#94a3b8', flexShrink: 0 }} />;
};

const TODO_STATUS_STYLE = {
  pending: { label: 'pending', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)', border: 'rgba(148, 163, 184, 0.4)' },
  in_progress: { label: 'in progress', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)', border: 'rgba(251, 191, 36, 0.4)' },
  completed: { label: 'completed', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)', border: 'rgba(74, 222, 128, 0.4)' },
  blocked: { label: 'blocked', color: '#f87171', bg: 'rgba(248, 113, 113, 0.15)', border: 'rgba(248, 113, 113, 0.4)' },
};
const TODO_GLYPH = { pending: '○', in_progress: '◐', completed: '✓', blocked: '⊗' };

const TodoTree = ({ todos }) => {
  if (!todos || todos.length === 0) return null;
  const byParent = {};
  todos.forEach((t) => { (byParent[t.parent_id ?? null] = byParent[t.parent_id ?? null] || []).push(t); });
  const renderNode = (parentId, counters) => {
    const children = byParent[parentId] || [];
    return children.map((t, i) => {
      const number = [...counters, i + 1].join('.');
      const st = TODO_STATUS_STYLE[t.status] || TODO_STATUS_STYLE.pending;
      const glyph = TODO_GLYPH[t.status] || '○';
      return (
        <React.Fragment key={t.id}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '1px 0' }}>
            <span style={{ color: '#64748b', flexShrink: 0, fontFamily: 'Consolas, Monaco, monospace' }}>
              {number}.
            </span>
            <span style={{ color: st.color, flexShrink: 0 }}>{glyph}</span>
            <span style={{ color: '#94a3b8', flexShrink: 0, fontSize: '0.62rem', fontFamily: 'Consolas, Monaco, monospace', marginTop: '1px' }}>#{t.id}</span>
            <span style={{ color: t.status === 'completed' ? '#6b7280' : '#e2e8f0', textDecoration: t.status === 'completed' ? 'line-through' : 'none' }}>
              {t.title}
            </span>
            {t.priority && t.priority !== 'normal' && (
              <span style={{ fontSize: '0.58rem', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: '4px', padding: '0 4px', flexShrink: 0 }}>{t.priority}</span>
            )}
            <span style={{ fontSize: '0.6rem', color: st.color, background: st.bg, border: `1px solid ${st.border}`, borderRadius: '999px', padding: '0 6px', flexShrink: 0, marginLeft: 'auto' }}>{st.label}</span>
          </div>
          {renderNode(t.id, [...counters, i + 1])}
        </React.Fragment>
      );
    });
  };
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>{renderNode(null, [])}</div>;
};

const CodeViewerWithLineNumbers = ({ content, maxHeight = '450px' }) => {
  if (!content && content !== '') return null;
  const lines = content.split('\n');
  const padLength = Math.max(2, String(lines.length).length);
  return (
    <div style={{
      background: '#020617',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      fontSize: '0.74rem',
      fontFamily: 'Consolas, Monaco, "Andale Mono", monospace',
      overflowX: 'auto',
      overflowY: 'auto',
      maxHeight: maxHeight,
      display: 'flex',
      lineHeight: '1.5'
    }}>
      {/* Line Number Gutter */}
      <div style={{
        padding: '10px 8px 10px 10px',
        background: '#090d16',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#475569',
        textAlign: 'right',
        userSelect: 'none',
        flexShrink: 0
      }}>
        {lines.map((_, i) => (
          <div key={i} style={{ height: '1.5em' }}>
            {String(i + 1).padStart(padLength, ' ')}
          </div>
        ))}
      </div>

      {/* Code Text Content */}
      <div style={{
        padding: '10px 14px',
        color: '#38bdf8',
        whiteSpace: 'pre',
        wordBreak: 'normal',
        minWidth: '100%',
        flex: 1
      }}>
        {lines.map((line, i) => (
          <div key={i} style={{ height: '1.5em' }}>
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  );
};

const InteractiveDirectoryNode = ({ item, onSelectFile }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggleFolder = async (e) => {
    e.stopPropagation();
    if (!item.is_dir) return;

    if (!isOpen && children === null) {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/system/file_content?path=${encodeURIComponent(item.path)}`);
        if (res.ok) {
          const data = await res.json();
          setChildren(data.items || []);
        }
      } catch (err) {
        console.error('Failed to load subfolder:', err);
      } finally {
        setLoading(false);
      }
    }
    setIsOpen(prev => !prev);
  };

  if (item.is_dir) {
    return (
      <div style={{ marginLeft: '10px', marginTop: '3px', marginBottom: '3px' }}>
        <div
          onClick={toggleFolder}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 8px',
            borderRadius: '5px',
            cursor: 'pointer',
            background: isOpen ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            color: '#fbbf24',
            fontSize: '0.74rem',
            fontWeight: 600,
            userSelect: 'none',
            transition: 'all 0.15s ease'
          }}
        >
          <span style={{ fontSize: '0.66rem', color: '#f59e0b', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease', width: '10px', display: 'inline-block' }}>
            ▶
          </span>
          {isOpen ? <FolderOpen style={{ width: '13px', height: '13px', color: '#fbbf24', flexShrink: 0 }} /> : <Folder style={{ width: '13px', height: '13px', color: '#f59e0b', flexShrink: 0 }} />}
          <span>{item.name}</span>
          {loading && <RefreshCw style={{ width: '10px', height: '10px', animation: 'spin 1s linear infinite', color: '#f59e0b', marginLeft: 'auto' }} />}
        </div>
        {isOpen && (
          <div style={{ paddingLeft: '6px', borderLeft: '1px solid rgba(245, 158, 11, 0.25)', marginLeft: '12px', marginTop: '2px' }}>
            {children && children.length > 0 ? (
              children.map(child => (
                <InteractiveDirectoryNode key={child.path} item={child} onSelectFile={onSelectFile} />
              ))
            ) : !loading ? (
              <div style={{ fontSize: '0.68rem', color: '#64748b', fontStyle: 'italic', padding: '3px 12px' }}>
                (empty folder)
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelectFile(item.path)}
      style={{
        marginLeft: '10px',
        marginTop: '2px',
        marginBottom: '2px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 8px',
        borderRadius: '4px',
        cursor: 'pointer',
        color: '#cbd5e1',
        fontSize: '0.74rem',
        userSelect: 'none',
        transition: 'background 0.15s ease'
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      {renderTreeFileIcon(item.name)}
      <span style={{ fontFamily: 'Consolas, Monaco, monospace', color: '#e2e8f0' }}>{item.name}</span>
      {item.size > 0 && (
        <span style={{ fontSize: '0.62rem', color: '#64748b', marginLeft: 'auto' }}>
          {(item.size / 1024).toFixed(1)} KB
        </span>
      )}
    </div>
  );
};

const InteractiveDirectoryViewer = ({ rootData, onSelectFile }) => {
  if (!rootData || !rootData.items) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      <div style={{
        background: '#090d16',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        borderRadius: '8px',
        padding: '10px 12px',
        maxHeight: '260px',
        overflowY: 'auto',
        overflowX: 'auto',
        fontFamily: 'sans-serif'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.76rem', fontWeight: 700, color: '#fbbf24', marginBottom: '8px', borderBottom: '1px solid rgba(245, 158, 11, 0.2)', paddingBottom: '6px' }}>
          <FolderOpen style={{ width: '15px', height: '15px', color: '#f59e0b', flexShrink: 0 }} />
          <span style={{ fontFamily: 'Consolas, Monaco, monospace', wordBreak: 'break-all' }}>{rootData.path}</span>
          <span style={{ fontSize: '0.64rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.2)', color: '#fef08a', marginLeft: 'auto', flexShrink: 0 }}>
            {rootData.items.length} items
          </span>
        </div>

        {rootData.items.map(item => (
          <InteractiveDirectoryNode key={item.path} item={item} onSelectFile={onSelectFile} />
        ))}
      </div>
    </div>
  );
};

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
  const [viewMessages, setViewMessages] = useState(null); // Loaded messages when inspecting past or standalone active session
  const displayMessages = selectedPastSessionId && viewMessages ? viewMessages : ((!onSendMessage || messages.length === 0) && viewMessages !== null ? viewMessages : messages);
  const [isTurnRunning, setIsTurnRunning] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState(new Set()); // Set of expanded node keys (e.g. "year_2026", "date_30 July 2026")
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [exactMatch, setExactMatch] = useState(false);
  const [filterMaster, setFilterMaster] = useState(true);
  const [filterYuki, setFilterYuki] = useState(true);
  const [searchSortOrder, setSearchSortOrder] = useState('newest'); // 'newest' | 'oldest'
  const [isSearching, setIsSearching] = useState(false);
  const [scrollTargetMessageId, setScrollTargetMessageId] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitleText, setEditingTitleText] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);
  const targetScrollRef = useRef(null);
  const isSearchNavigatingRef = useRef(false);
  const [coderLlmModels, setCoderLlmModels] = useState([]);
  const coderModelsFetchRef = useRef(0);
  const CODER_FETCH_COOLDOWN = 2000;

  const fetchCoderLlmModels = async () => {
    const now = Date.now();
    if (now - coderModelsFetchRef.current < CODER_FETCH_COOLDOWN) return;
    coderModelsFetchRef.current = now;
    setCoderLlmModels([]);
    try {
      const res = await fetch(`${API_BASE}/api/models?target=coder`);
      if (res.ok) {
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setCoderLlmModels(data.models);
        }
      }
    } catch (e) {
      console.warn("[CoderModels] Failed to fetch:", e);
    }
  };

  // Local Input Text State (Fixes standalone typing when props are unpassed)
  const [localInputText, setLocalInputText] = useState('');
  const currentInputText = onInputChange ? inputText : localInputText;
  const handleInputChange = (val) => {
    if (onInputChange) onInputChange(val);
    setLocalInputText(val);
  };

  // Auto-expand textarea vertically up to 200px max height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollH = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(38, scrollH), 200)}px`;
    }
  }, [currentInputText]);
  // Sidebar Resizing States (Width in pixels, saved in localStorage)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('yuki-left-sidebar-width');
    return saved ? parseInt(saved, 10) : 260;
  });

  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('yuki-right-sidebar-width');
    return saved ? parseInt(saved, 10) : 340;
  });

  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  // Global Mouse Drag Handlers for Horizontal Sidebar Resizing
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingLeft) {
        const newWidth = Math.min(Math.max(180, e.clientX), 500);
        setLeftSidebarWidth(newWidth);
        localStorage.setItem('yuki-left-sidebar-width', String(newWidth));
      } else if (isResizingRight) {
        const newWidth = Math.min(Math.max(220, window.innerWidth - e.clientX), 650);
        setRightSidebarWidth(newWidth);
        localStorage.setItem('yuki-right-sidebar-width', String(newWidth));
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
    };

    if (isResizingLeft || isResizingRight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingLeft, isResizingRight]);

  // WebSocket Connection (shared useBackendSocket hook — auto-reconnects on backend restarts)
  const handleSocketOpen = () => {
    console.log('[ChatWindow] WebSocket connected.');
    fetchSessionTree();
    if (selectedPastSessionId) {
      fetch(`${API_BASE}/api/chat/sessions/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: selectedPastSessionId })
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((actData) => {
          if (actData && actData.messages) setViewMessages(actData.messages);
        })
        .catch(() => { });
    } else if (!onSendMessage || !messages || messages.length === 0) {
      // Standalone mode: load active session in-memory messages immediately on connect
      fetch(`${API_BASE}/api/chat/sessions/active`)
        .then((res) => (res.ok ? res.json() : null))
        .then((actData) => {
          if (actData && actData.messages) setViewMessages(actData.messages);
        })
        .catch(() => { });
    }
  };

  const handleSocketMessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'text_stream') {
        setViewMessages(prev => {
          if (!prev || prev.length === 0) return prev;
          const newMsgs = [...prev];
          const lastIdx = newMsgs.length - 1;
          const lastMsg = newMsgs[lastIdx];
          if (lastMsg && lastMsg.role === 'assistant') {
            const currentContent = lastMsg.isThinking ? '' : (lastMsg.content || '');
            newMsgs[lastIdx] = {
              ...lastMsg,
              content: currentContent + (data.text || ''),
              isThinking: false,
              backend: data.backend_used || lastMsg.backend
            };
          }
          return newMsgs;
        });
      } else if (data.type === 'tool_start') {
        const toolName = data.tool_name || 'tool';
        const toolArgs = data.tool_args || {};
        const toolTarget = toolArgs.file_path || toolArgs.path || toolArgs.command || toolArgs.url || '';
        const targetInfo = toolTarget ? ` (\`${toolTarget}\`)` : '';
        const argsBlock = Object.keys(toolArgs).length
          ? `\n\`\`\`tool_args\n${JSON.stringify(toolArgs, null, 2)}\n\`\`\`` : '';
        const badgeText = `\n🛠️ **[${toolName}${targetInfo} — ⏳ Running...]**${argsBlock}\n`;

        setViewMessages(prev => {
          if (!prev || prev.length === 0) return prev;
          const newMsgs = [...prev];
          const lastIdx = newMsgs.length - 1;
          const lastMsg = newMsgs[lastIdx];
          if (lastMsg && lastMsg.role === 'assistant') {
            const currentContent = lastMsg.isThinking ? '' : (lastMsg.content || '');
            newMsgs[lastIdx] = {
              ...lastMsg,
              content: currentContent + badgeText,
              isThinking: false
            };
          }
          return newMsgs;
        });
      } else if (data.type === 'terminal_stream') {
        const streamLine = data.line || '';
        if (streamLine) {
          setViewMessages(prev => {
            if (!prev || prev.length === 0) return prev;
            const newMsgs = [...prev];
            const lastIdx = newMsgs.length - 1;
            const lastMsg = newMsgs[lastIdx];
            if (lastMsg && lastMsg.role === 'assistant') {
              let content = lastMsg.content || '';
              if (content.includes('⏳ Running...')) {
                if (!content.includes('```terminal_stream\n')) {
                  content += '\n```terminal_stream\n';
                }
                content += streamLine + '\n';
              }
              newMsgs[lastIdx] = {
                ...lastMsg,
                content: content
              };
            }
            return newMsgs;
          });
        }
      } else if (data.type === 'tool_result') {
        const resultStr = typeof data.result === 'string' ? data.result : JSON.stringify(data.result || '');
        const rawSnippet = resultStr.length > 15000 ? resultStr.slice(0, 15000) + '\n... [truncated for display]' : resultStr;
        const snippet = rawSnippet.replace(/```/g, "'''");

        setViewMessages(prev => {
          if (!prev || prev.length === 0) return prev;
          const newMsgs = [...prev];
          const lastIdx = newMsgs.length - 1;
          const lastMsg = newMsgs[lastIdx];
          if (lastMsg && lastMsg.role === 'assistant') {
            let content = lastMsg.content || '';
            if (content.includes('⏳ Running...')) {
              content = content.replace('⏳ Running...', '✓ Done');
              if (content.includes('```terminal_stream\n')) {
                content += '```\n';
              } else {
                content += `\`\`\`tool_output\n${snippet}\n\`\`\`\n`;
              }
            }
            newMsgs[lastIdx] = {
              ...lastMsg,
              content: content
            };
          }
          return newMsgs;
        });
      } else if (data.type === 'turn_interrupted') {
        setIsTurnRunning(false);
        setViewMessages(prev => {
          if (!prev || prev.length === 0) return prev;
          const newMsgs = [...prev];
          const lastIdx = newMsgs.length - 1;
          const lastMsg = newMsgs[lastIdx];
          if (lastMsg && lastMsg.role === 'assistant') {
            let content = lastMsg.content || '';
            if (content.includes('⏳ Running...')) {
              content = content.replace(/⏳ Running\.\.\./g, '🛑 Terminated');
              if (!content.includes('[PROCESS TERMINATED BY USER]')) {
                content += `\`\`\`tool_output\n[PROCESS TERMINATED BY USER]\n\`\`\`\n`;
              }
            } else if (lastMsg.isThinking) {
              content = '🛑 *Process execution was terminated by user.*';
            }
            newMsgs[lastIdx] = {
              ...lastMsg,
              content: content,
              isThinking: false,
              thinkingStatus: null
            };
          }
          return newMsgs;
        });
      } else if (data.type === 'status') {
        if (data.status === 'idle') {
          setIsTurnRunning(false);
        }
        if (data.message && data.status !== 'idle') {
          setViewMessages(prev => {
            if (!prev || prev.length === 0) return prev;
            const newMsgs = [...prev];
            const lastIdx = newMsgs.length - 1;
            const lastMsg = newMsgs[lastIdx];
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isThinking) {
              newMsgs[lastIdx] = {
                ...lastMsg,
                thinkingStatus: data.message
              };
            }
            return newMsgs;
          });
        }
      } else if (data.type === 'chat_update' && data.messages) {
        setViewMessages(data.messages);
        fetchSessionTree();
      } else if (data.type === 'stream_done') {
        setIsTurnRunning(false);
        fetchSessionTree();
      } else if (data.type === 'session_renamed') {
        fetchSessionTree();
      }
    } catch (_) { }
  };

  const { socketRef, backendStatus, connectWebSocket } = useBackendSocket({
    onMessage: handleSocketMessage,
    onOpen: handleSocketOpen
  });

  // Standalone mode connects its own auto-reconnecting socket; when a parent
  // onSendMessage prop is provided, the parent app owns the connection instead.
  useEffect(() => {
    if (!onSendMessage) connectWebSocket();
  }, [onSendMessage, connectWebSocket]);

  // Backend connection offline notice (shown when a send is attempted while the
  // standalone socket is still reconnecting after a backend restart)
  const [offlineSendNotice, setOfflineSendNotice] = useState(false);

  // Clear the offline-send notice once the connection is restored or after a delay.
  useEffect(() => {
    if (backendStatus === 'online' && offlineSendNotice) {
      setOfflineSendNotice(false);
    }
  }, [backendStatus, offlineSendNotice]);

  useEffect(() => {
    if (!offlineSendNotice) return;
    const t = setTimeout(() => setOfflineSendNotice(false), 6000);
    return () => clearTimeout(t);
  }, [offlineSendNotice]);

  const [llmModeOverride, setLlmModeOverride] = useState(() => {
    const saved = localStorage.getItem('yuki-override-llm-mode');
    return saved !== null ? parseInt(saved, 10) : 3;
  });
  const [enableIntentCheckOverride, setEnableIntentCheckOverride] = useState(() => {
    const saved = localStorage.getItem('yuki-override-intent-check');
    return saved !== null ? saved === 'true' : true;
  });
  const [dynamicToolCallingOverride, setDynamicToolCallingOverride] = useState(() => {
    const saved = localStorage.getItem('yuki-override-dynamic-tools');
    return saved !== null ? saved === 'true' : true;
  });
  const [sendToolsInSimpleOverride, setSendToolsInSimpleOverride] = useState(() => {
    const saved = localStorage.getItem('yuki-override-tools-in-simple');
    return saved !== null ? saved === 'true' : false;
  });

  // Dedicated Coding Mode State (OFF by default on open — zero persistence as requested)
  const [isCodingMode, setIsCodingMode] = useState(false);

  // Per-Session Metadata (Facts & Workspace Directories) State
  const [sessionFacts, setSessionFacts] = useState([]);
  const [sessionDirectories, setSessionDirectories] = useState([]);
  const [showFactForm, setShowFactForm] = useState(false);
  const [showDirForm, setShowDirForm] = useState(false);
  const [factKeyInput, setFactKeyInput] = useState('');
  const [factValInput, setFactValInput] = useState('');
  const [dirKeyInput, setDirKeyInput] = useState('');
  const [dirValInput, setDirValInput] = useState('');

  // File & Image Attachments State
  const [attachments, setAttachments] = useState([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const attachmentInputRef = useRef(null);

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    setIsUploadingAttachment(true);
    try {
      const newAtts = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch(`${API_BASE}/api/chat/attachments/upload`, {
          method: 'POST',
          body: formData
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.status === 'success' && data.attachment) {
            newAtts.push(data.attachment);
          }
        }
      }
      if (newAtts.length > 0) {
        setAttachments(prev => [...prev, ...newAtts]);
      }
    } catch (err) {
      console.error("Attachment upload error:", err);
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const handleRemoveAttachment = (idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  // File Viewer (Readonly Inspector) State
  const [fileInspectorData, setFileInspectorData] = useState(null);
  const [treeSelectedFileData, setTreeSelectedFileData] = useState(null);
  const [loadingFileInspector, setLoadingFileInspector] = useState(false);

  const handleSelectTreeFile = async (filePath) => {
    try {
      const res = await fetch(`${API_BASE}/api/system/file_content?path=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const data = await res.json();
        setTreeSelectedFileData(data);
      }
    } catch (err) {
      console.error('Failed to load file content from tree:', err);
    }
  };

  useEffect(() => {
    const handleOpenFileEvent = async (e) => {
      if (e && e.detail && e.detail.path) {
        const targetPath = e.detail.path;
        setActiveTab('file_viewer');
        setLoadingFileInspector(true);
        try {
          const res = await fetch(`${API_BASE}/api/system/file_content?path=${encodeURIComponent(targetPath)}`);
          if (res.ok) {
            const data = await res.json();
            setFileInspectorData(data);
          } else {
            setFileInspectorData({ path: targetPath, name: targetPath.split('\\').pop() || targetPath, content: `Failed to load file content: HTTP ${res.status}` });
          }
        } catch (err) {
          setFileInspectorData({ path: targetPath, name: targetPath.split('\\').pop() || targetPath, content: `Error opening file: ${err}` });
        } finally {
          setLoadingFileInspector(false);
        }
      }
    };

    const handleOpenFolderEvent = async (e) => {
      if (e && e.detail && e.detail.path) {
        const targetPath = e.detail.path;
        setActiveTab('file_viewer');
        setLoadingFileInspector(true);
        try {
          const res = await fetch(`${API_BASE}/api/system/file_content?path=${encodeURIComponent(targetPath)}`);
          if (res.ok) {
            const data = await res.json();
            setFileInspectorData(data);
          } else {
            setFileInspectorData({ path: targetPath, name: targetPath.split('\\').pop() || targetPath, content: `Failed to load folder: HTTP ${res.status}` });
          }
        } catch (err) {
          setFileInspectorData({ path: targetPath, name: targetPath.split('\\').pop() || targetPath, content: `Error opening folder: ${err}` });
        } finally {
          setLoadingFileInspector(false);
        }
      }
    };

    window.addEventListener('yuki:open-file', handleOpenFileEvent);
    window.addEventListener('yuki:open-folder', handleOpenFolderEvent);
    let unsubFile = null;
    let unsubFolder = null;
    if (window.electronAPI?.onOpenFile) {
      unsubFile = window.electronAPI.onOpenFile((data) => handleOpenFileEvent({ detail: data }));
    }
    if (window.electronAPI?.onOpenFolder) {
      unsubFolder = window.electronAPI.onOpenFolder((data) => handleOpenFolderEvent({ detail: data }));
    }
    return () => {
      window.removeEventListener('yuki:open-file', handleOpenFileEvent);
      window.removeEventListener('yuki:open-folder', handleOpenFolderEvent);
      if (unsubFile) unsubFile();
      if (unsubFolder) unsubFolder();
    };
  }, []);
  // Internal Settings Sync (for standalone Chat Window mode)
  const [internalSettings, setInternalSettings] = useState({});
  const [savedCustomEndpoints, setSavedCustomEndpoints] = useState([]);
  const [selectedCoderEndpointId, setSelectedCoderEndpointId] = useState('');
  const [coderCustomLabel, setCoderCustomLabel] = useState('');
  const [saveCoderEndpointBtnText, setSaveCoderEndpointBtnText] = useState('Save Preset');
  const [draftCoderKeys, setDraftCoderKeys] = useState(['']);

  const [coderToolsList, setCoderToolsList] = useState([]);

  const activeSettings = { ...internalSettings, ...settings };

  const handleUpdateSetting = async (keyOrUpdates, value) => {
    const updates = typeof keyOrUpdates === 'object' ? keyOrUpdates : { [keyOrUpdates]: value };
    setInternalSettings(prev => ({ ...prev, ...updates }));
    if (onUpdateSetting) {
      onUpdateSetting(updates);
    }
    try {
      const res = await fetch(`${API_BASE}/api/settings/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Settings] Update failed (${res.status}): ${errText}`);
      }
      if (['llm_coder_backend', 'llm_coder_base_url', 'llm_coder_api_key'].some(k => k in updates)) {
        setTimeout(() => fetchCoderLlmModels(), 400);
      }
    } catch (err) {
      console.error("[Settings] Error updating settings:", err);
    }
  };

  const fetchSettingsAndEndpoints = useCallback(async () => {
    try {
      const sRes = await fetch(`${API_BASE}/api/settings`);
      if (sRes.ok) {
        const sData = await sRes.json();
        setInternalSettings(sData || {});
      }
      const pRes = await fetch(`${API_BASE}/api/profile?decrypt_keys=true`);
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData.settings && pData.settings.llm_coder_api_key) {
          const arr = pData.settings.llm_coder_api_key.split(',').map(k => k.trim());
          setDraftCoderKeys(arr.length > 0 ? arr : ['']);
        }
      }
      const eRes = await fetch(`${API_BASE}/api/settings/custom-endpoints?decrypt=true`);
      if (eRes.ok) {
        const eData = await eRes.json();
        setSavedCustomEndpoints(eData.endpoints || []);
      }
      const tRes = await fetch(`${API_BASE}/api/tools?mode=all`);
      if (tRes.ok) {
        const tData = await tRes.json();
        if (tData && tData.tools) {
          setCoderToolsList(tData.tools);
        }
      }
    } catch (err) {
      console.error("[Settings] Error fetching settings/endpoints:", err);
    }
  }, []);

  useEffect(() => {
    fetchSettingsAndEndpoints();
    fetchCoderLlmModels();
  }, [fetchSettingsAndEndpoints]);

  const selectCoderPreset = async (targetId) => {
    if (!targetId) {
      setSelectedCoderEndpointId('');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: targetId, target_type: 'coder' })
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedCoderEndpointId(targetId);
        if (data.active_endpoint && data.active_endpoint.label) {
          setCoderCustomLabel(data.active_endpoint.label);
        }
        const keysArr = data.keys_array && data.keys_array.length > 0 ? data.keys_array : [''];
        setDraftCoderKeys(keysArr);
        handleUpdateSetting({
          llm_coder_backend: data.backend || 'custom',
          llm_coder_base_url: data.base_url || '',
          llm_coder_api_key: data.api_key_decrypted || '',
          llm_coder_model: data.coder_model || activeSettings.llm_coder_model || '',
          llm_reviewer_model: data.reviewer_model || activeSettings.llm_reviewer_model || '',
          llm_summary_model: data.summary_model || activeSettings.llm_summary_model || '',
        });
      }
    } catch (err) {
      console.error("Failed to select custom endpoint preset:", err);
    }
  };

  const handleSaveCoderEndpoint = async () => {
    const labelToSave = coderCustomLabel.trim() || 'Coder Endpoint';
    const baseUrlToSave = activeSettings.llm_coder_base_url || '';
    if (!baseUrlToSave) {
      alert("Please enter a valid Base URL before saving preset.");
      return;
    }
    setSaveCoderEndpointBtnText("Saving...");
    const joinedKeys = draftCoderKeys.filter(k => k.trim()).join(', ');
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedCoderEndpointId || '',
          label: labelToSave,
          base_url: baseUrlToSave,
          api_key: joinedKeys,
          llm_backend: activeSettings.llm_coder_backend || 'custom',
          coder_model: activeSettings.llm_coder_model || '',
          reviewer_model: activeSettings.llm_reviewer_model || '',
          summary_model: activeSettings.llm_summary_model || ''
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSavedCustomEndpoints(data.endpoints || []);
        setCoderCustomLabel(labelToSave);
        if (data.saved && data.saved.id) {
          setSelectedCoderEndpointId(data.saved.id);
        }
        if (data.keys_array) {
          setDraftCoderKeys(data.keys_array.length > 0 ? data.keys_array : ['']);
        }
        await handleUpdateSetting({ llm_coder_api_key: joinedKeys });
        setSaveCoderEndpointBtnText("✓ Saved to DB");
        setTimeout(() => setSaveCoderEndpointBtnText('Save Preset'), 2500);
      } else {
        setSaveCoderEndpointBtnText("Save Failed");
        setTimeout(() => setSaveCoderEndpointBtnText('Save Preset'), 2000);
      }
    } catch (err) {
      console.error("Failed to save coder custom endpoint:", err);
      setSaveCoderEndpointBtnText("Error Saving");
      setTimeout(() => setSaveCoderEndpointBtnText('Save Preset'), 2000);
    }
  };

  const handleDeleteCoderEndpoint = async (epId) => {
    const targetId = epId || selectedCoderEndpointId;
    const targetEp = savedCustomEndpoints.find(e => e.id === targetId || e.label === coderCustomLabel);
    if (!targetEp) {
      alert("Please select a saved preset to delete.");
      return;
    }
    if (!confirm(`Delete saved endpoint "${targetEp.label}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/settings/custom-endpoints/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: targetEp.id, label: targetEp.label })
      });
      if (res.ok) {
        const data = await res.json();
        setSavedCustomEndpoints(data.endpoints || []);
        if (selectedCoderEndpointId === targetEp.id) setSelectedCoderEndpointId('');
        if (coderCustomLabel === targetEp.label) setCoderCustomLabel('');
      }
    } catch (err) {
      console.error("Failed to delete custom endpoint:", err);
    }
  };

  const fetchSessionMeta = useCallback(async (sid) => {
    if (!sid) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${encodeURIComponent(sid)}/meta`);
      if (res.ok) {
        const data = await res.json();
        setSessionFacts(data.facts || []);
        setSessionDirectories(data.directories || []);
      }
    } catch (err) {
      console.error("[SessionMeta] Error fetching session meta:", err);
    }
  }, []);

  const handleSaveSessionMeta = async (type, key, value) => {
    const targetSession = selectedPastSessionId || activeSessionId;
    if (!targetSession || !key.trim() || !value.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${encodeURIComponent(targetSession)}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, key: key.trim(), value: value.trim() })
      });
      if (res.ok) {
        fetchSessionMeta(targetSession);
        if (type === 'fact') { setFactKeyInput(''); setFactValInput(''); setShowFactForm(false); }
        if (type === 'directory') { setDirKeyInput(''); setDirValInput(''); setShowDirForm(false); }
      }
    } catch (err) {
      console.error("[SessionMeta] Error saving session meta:", err);
    }
  };

  const handleDeleteSessionMeta = async (type, key) => {
    const targetSession = selectedPastSessionId || activeSessionId;
    if (!targetSession || !key) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${encodeURIComponent(targetSession)}/meta?meta_type=${encodeURIComponent(type)}&meta_key=${encodeURIComponent(key)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchSessionMeta(targetSession);
      }
    } catch (err) {
      console.error("[SessionMeta] Error deleting session meta:", err);
    }
  };

  const handlePickFolder = async () => {
    try {
      if (window.electronAPI && window.electronAPI.selectDirectory) {
        const selectedPath = await window.electronAPI.selectDirectory();
        if (selectedPath) {
          setDirValInput(selectedPath);
        }
      } else {
        alert("Directory picker is running in Electron mode. If running in a web browser, please enter or paste the absolute folder path directly.");
      }
    } catch (err) {
      console.error("[FolderPicker] Error picking folder:", err);
    }
  };

  const toggleAddDirectoryForm = () => {
    setShowDirForm(prev => {
      const nextState = !prev;
      if (nextState && !dirKeyInput) {
        const nextNum = (sessionDirectories || []).length + 1;
        setDirKeyInput(`Project Folder ${nextNum}`);
      }
      return nextState;
    });
    setShowFactForm(false);
  };

  const handleSendPrompt = (textToSend) => {
    if (!textToSend.trim()) return;

    const socketOpen = socketRef.current && socketRef.current.readyState === WebSocket.OPEN;

    // If the standalone socket is offline (e.g. backend restarting), keep the
    // input text and surface a notice instead of silently dropping the message.
    if (!onSendMessage && !socketOpen) {
      setOfflineSendNotice(true);
      return;
    }

    // 1. Instantly append User message & pending AI thinking card to local view
    const userMsg = { role: 'user', content: textToSend, attachments: attachments || [] };
    const pendingAiMsg = { role: 'assistant', content: '...', isThinking: true };

    if (selectedPastSessionId || viewMessages !== null) {
      setViewMessages(prev => [...(prev || []), userMsg, pendingAiMsg]);
    }

    setIsTurnRunning(true);

    if (onSendMessage) {
      onSendMessage(textToSend);
    } else {
      socketRef.current.send(JSON.stringify({
        type: 'chat',
        message: textToSend,
        attachments: attachments,
        overrides: {
          coding_mode: isCodingMode,
          session_facts: sessionFacts,
          session_directories: isCodingMode ? sessionDirectories : [],
          tool_mode: chatWindowToolMode,
          llm_mode: llmModeOverride,
          enable_intent_check: enableIntentCheckOverride,
          dynamic_tool_calling: dynamicToolCallingOverride,
          send_tools_in_simple: sendToolsInSimpleOverride,
          llm_coder_model: activeSettings.llm_coder_model,
          llm_coder_api_key: (activeSettings.llm_coder_api_key && !activeSettings.llm_coder_api_key.includes('...') && !activeSettings.llm_coder_api_key.includes('•••')) ? activeSettings.llm_coder_api_key : '',
          llm_coder_backend: activeSettings.llm_coder_backend,
          llm_coder_base_url: activeSettings.llm_coder_base_url,
          llm_reviewer_enabled: activeSettings.llm_reviewer_enabled !== undefined ? activeSettings.llm_reviewer_enabled : true,
          llm_reviewer_model: activeSettings.llm_reviewer_model,
          llm_summary_model: activeSettings.llm_summary_model,
          prompt_persona: isCodingMode ? false : promptPersona,
          prompt_expressions: isCodingMode ? false : promptExpressions,
          prompt_memory: isCodingMode ? false : promptMemory,
          prompt_directives: promptDirectives,
          prompt_planning: promptPlanning
        }
      }));
    }
    setAttachments([]);
    handleInputChange('');
  };

  const handleInterruptProcess = () => {
    setIsTurnRunning(false);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
      console.log('[ChatWindow] Sent interrupt signal to backend.');
    }
  };

  // Escape key instantly stops a running turn (same as the Stop button).
  const handleInterruptProcessRef = useRef(null);
  handleInterruptProcessRef.current = handleInterruptProcess;
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && (isTurnRunning || isGenerating)) {
        e.preventDefault();
        handleInterruptProcessRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTurnRunning, isGenerating]);

  // Standalone Preferences Modal & Active Tab State
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [prefTab, setPrefTab] = useState('coder'); // 'coder' | 'appearance' | 'engine' | 'prompts' | 'audio'
  const [showCoderKey, setShowCoderKey] = useState(false);

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

  const generateDynamicPayloadPreview = () => {
    // 1. System Prompt Block
    const promptParts = [];
    if (isCodingMode) {
      promptParts.push(`[SPECIALIZED AGENTIC CODER PROMPT (Coding Mode ACTIVE)]\nYou are an Elite Agentic AI Coding Assistant and Senior Software Architect.\n- Zero persona/roleplay fluff or casual chatter\n- Direct, analytical pair programming & code execution\n- Inspect files & logs before diagnosing\n- Execute builds/tests to verify clean completion`);
    } else {
      if (promptPersona) {
        promptParts.push(`[1. CHARACTER PERSONA & MOOD SPECTRUM]\nYou are Yuki, a cute, playful, intelligent anime-style companion and AI assistant.\n[Mood Spectrum: Joy: 85%, Playfulness: 90%, Affection: 80%]`);
      }
      if (promptExpressions) {
        promptParts.push(`[2. 3D AVATAR EXPRESSION TAGS]\nYou can trigger 3D Avatar Animations using tags like <anim:happy>, <anim:thinking>, <anim:wave>, <anim:nod>.`);
      }
      if (promptMemory) {
        const summaryText = settings?.user_name ? `• User Name: ${settings.user_name}` : `(No personal facts stored in memory card)`;
        promptParts.push(`[3. USER MEMORY CARD]\n--- USER MEMORY CARD ---\n${summaryText}\n------------------------`);
      }
      if (promptDirectives) {
        if (chatWindowToolMode === 'advanced') {
          promptParts.push(`[4. AUTONOMOUS JARVIS OPERATING DIRECTIVES]\nYou are operating in ADVANCED JARVIS MODE powered by Frontier LLM.\n- Parallel multi-step reasoning\n- SQLite file database search (yuki_files.db)\n- Full terminal execution & Python auto-installation\n- Code review & git inspection`);
        } else {
          promptParts.push(`[4. CORE TOOL RULES & TRIGGER CONDITIONS]\n- RULE 1: Conversational intent -> No tool calls\n- RULE 2: Specific tool triggers (web_search, launch_app, open_or_play_file...)\n- RULE 3: One tool per turn\n- RULE 4: Summarize tool outputs in < 3 sentences\n- RULE 5: Confirmation required for destructive actions`);
        }
      }
      if (promptPlanning) {
        promptParts.push(`[5. SECTION 5 IMPLEMENTATION PLANNING ETIQUETTE]\nFor complex requests, create implementation_plan.md and present a structured plan before taking code actions.`);
      }
    }

    // 2. Active Tool Schemas
    const basicTools = ['web_search', 'read_file_content', 'search_files', 'list_directory', 'launch_app', 'open_or_play_file', 'set_system_volume', 'manage_timer_stopwatch_alarms', 'get_system_stats', 'update_user_fact', 'take_screenshot', 'run_terminal_command', 'run_python_script', 'jarvis_query_file_db', 'jarvis_open_or_play_file'];
    const jarvisTools = [...basicTools, 'read_and_review_file', 'list_directory_tree', 'git_status_and_history', 'system_diagnostics_and_processes', 'scrape_web_page', 'jarvis_remember_user_fact'];
    const codingTools = ['jarvis_run_terminal', 'jarvis_run_python', 'jarvis_read_file', 'jarvis_create_or_edit_file', 'jarvis_replace_file_content', 'jarvis_list_dir_tree', 'jarvis_git_status', 'jarvis_find_files_by_glob', 'jarvis_grep_files', 'jarvis_web_search', 'jarvis_web_scrape', 'jarvis_system_diagnostics', 'jarvis_send_stdin'];

    const activeToolList = isCodingMode ? codingTools : (chatWindowToolMode === 'advanced' ? jarvisTools : basicTools);

    // 3. Conversational Message Context
    const historyMsgs = viewMessages || messages || [];
    const recentTurn = historyMsgs.length > 0 ? historyMsgs.slice(-2) : [];

    return `═════════════════════════════════════════════════════════
1. SYSTEM PROMPT INSTRUCTIONS (role: "system")
═════════════════════════════════════════════════════════
${promptParts.length > 0 ? promptParts.join('\n\n') : '⚠️ All prompt modules disabled.'}

═════════════════════════════════════════════════════════
2. CONVERSATIONAL MESSAGES ARRAY (messages: [...])
═════════════════════════════════════════════════════════
• Message History Count: ${historyMsgs.length} messages (pruned via token limits)
• Live Payload Message Structure:
  [
    ${recentTurn.map(m => `{\n      "role": "${m.role}",\n      "content": "${(m.content || '').slice(0, 80).replace(/\n/g, ' ')}${(m.content || '').length > 80 ? '...' : ''}"\n    }`).join(',\n    ')}${recentTurn.length > 0 ? ',\n    ' : ''}{
      "role": "user",
      "content": "<your_current_prompt_input>"
    }
  ]

═════════════════════════════════════════════════════════
3. ACTIVE TOOL DEFINITIONS ARRAY (tools: [...])
═════════════════════════════════════════════════════════
• Tool Operating Mode: ${isCodingMode ? '💻 Specialized Coding Agent (12 coding tools)' : (chatWindowToolMode === 'advanced' ? '🤖 Autonomous Jarvis (20 tools)' : '⚡ Basic ReAct (13 tools)')}
• Dynamic Relevance Filter: ${dynamicToolCallingOverride ? 'ENABLED (selects schemas by query intent)' : 'DISABLED (sends all active schemas)'}
• Tool Schemas Active for LLM:
  [
    ${activeToolList.map(name => `{"type": "function", "function": {"name": "${name}"}}`).join(',\n    ')}
  ]

═════════════════════════════════════════════════════════
4. LLM BACKEND & EXECUTION PARAMETERS
═════════════════════════════════════════════════════════
• Coding Mode: ${isCodingMode ? 'ACTIVE (Zero persona/chatter, strict coding agent directives)' : 'INACTIVE'}
• Endpoint Strategy: ${profileData?.settings?.endpoint_strategy === 'separate' ? 'Separate Endpoints (Simple vs Complex)' : 'Single Unified Endpoint'}
• Simple Query Model: [${profileData?.settings?.llm_backend || 'groq'}] ${profileData?.settings?.llm_model || 'llama-3.3-70b-versatile'}
${profileData?.settings?.endpoint_strategy === 'separate' ? `• Complex Agentic Model: [${profileData?.settings?.llm_complex_backend || profileData?.settings?.llm_backend || 'groq'}] ${profileData?.settings?.llm_complex_model || profileData?.settings?.llm_model || 'llama-3.3-70b-versatile'}\n` : ''}• Prompt Router Mode: Mode ${llmModeOverride} (${llmModeOverride === 3 ? 'Dynamic Mixed Prompts' : llmModeOverride === 1 ? 'Fast/Simple' : 'Full Agentic'})
• LLM Intent Check: ${enableIntentCheckOverride ? 'ENABLED' : 'DISABLED'}
• Tools in Simple Chatter: ${sendToolsInSimpleOverride ? 'ENABLED' : 'DISABLED'}
• Temperature: ${isCodingMode ? '0.1 (Low Entropy Coder)' : (llmModeOverride === 2 ? '0.2 (Deterministic)' : '0.7 (Creative)')}
`;
  };

  useEffect(() => {
    const targetSid = selectedPastSessionId || activeSessionId;
    if (targetSid) {
      fetchSessionMeta(targetSid);
    }
  }, [selectedPastSessionId, activeSessionId, fetchSessionMeta]);

  // Profile & System Details State
  const [profileData, setProfileData] = useState(null);

  const fetchProfileInfo = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/profile`);
      if (res.ok) {
        const data = await res.json();
        setProfileData(data);
      }
    } catch (e) {
      console.warn('[ChatWindow] Profile fetch error:', e);
    }
  };

  useEffect(() => {
    document.title = 'Chat';
    fetchProfileInfo();
  }, []);

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

  // Refresh Workspace (F5 Key & Top Header Button)
  const handleRefreshWorkspace = async () => {
    console.log('[ChatWindow] Refreshing session tree and workspace state...');
    fetchSessionTree();
    if (selectedPastSessionId) {
      try {
        const res = await fetch(`${API_BASE}/api/chat/sessions/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: selectedPastSessionId })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.messages) setViewMessages(data.messages);
        }
      } catch (e) {
        console.warn('[ChatWindow] Session refresh error:', e);
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F5') {
        e.preventDefault();
        handleRefreshWorkspace();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPastSessionId]);

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
            if (!selectedPastSessionId && (!onSendMessage || !messages || messages.length === 0)) {
              try {
                const sessRes = await fetch(`${API_BASE}/api/chat/sessions/${encodeURIComponent(data.active_session_id)}`);
                if (sessRes.ok) {
                  const sessData = await sessRes.json();
                  if (sessData && sessData.messages) {
                    setViewMessages(sessData.messages);
                  }
                }
              } catch (_) {}
            }
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

  // Debounced search across all conversations (with Exact Match, Speaker Filter, & Date Sorting)
  useEffect(() => {
    const q = searchQuery;
    if (!q || !q.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const speakerRole = (filterMaster && !filterYuki) ? 'user' : (!filterMaster && filterYuki) ? 'assistant' : null;
    const roleParam = speakerRole ? `&role=${speakerRole}` : '';

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        // Fetch all matching results sorted chronologically
        const res = await fetch(`${API_BASE}/api/chat/search?q=${encodeURIComponent(q)}&exact=${exactMatch}&sort=${searchSortOrder}${roleParam}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results || []);
        }
      } catch (err) {
        console.error("Failed to search conversations:", err);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery, exactMatch, filterMaster, filterYuki, searchSortOrder]);

  // Inspect and Promote a session to Global Active Session (Instant 0ms Highlight + Optional Target Message Scroll)
  const handleSelectSession = async (sessionId, targetMessageId = null) => {
    if (targetMessageId != null) {
      isSearchNavigatingRef.current = true;
      targetScrollRef.current = targetMessageId;
      setScrollTargetMessageId(targetMessageId);
      setHighlightedMessageId(targetMessageId);

      // Check if we are already viewing this session
      const isAlreadyActive =
        selectedPastSessionId === sessionId ||
        (!selectedPastSessionId && activeSessionId === sessionId);

      if (isAlreadyActive && displayMessages && displayMessages.length > 0) {
        // Direct scroll to existing DOM element in current session!
        const scrollDirect = (attempts = 0) => {
          const el =
            document.getElementById(`chat-msg-${targetMessageId}`) ||
            document.querySelector(`[data-msg-id="${targetMessageId}"]`) ||
            document.querySelector(`[data-msg-index="${targetMessageId}"]`);

          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setHighlightedMessageId(targetMessageId);
            setTimeout(() => {
              isSearchNavigatingRef.current = false;
              targetScrollRef.current = null;
              setScrollTargetMessageId(null);
            }, 2500);
            setTimeout(() => {
              setHighlightedMessageId(null);
            }, 4000);
          } else if (attempts < 25) {
            setTimeout(() => scrollDirect(attempts + 1), 40);
          } else {
            isSearchNavigatingRef.current = false;
            targetScrollRef.current = null;
            setScrollTargetMessageId(null);
          }
        };
        requestAnimationFrame(() => scrollDirect(0));
        return;
      }
    } else {
      isSearchNavigatingRef.current = false;
      targetScrollRef.current = null;
      setScrollTargetMessageId(null);
    }

    setSelectedPastSessionId(sessionId);
    setActiveSessionId(sessionId);

    try {
      const actRes = await fetch(`${API_BASE}/api/chat/sessions/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });
      if (actRes.ok) {
        const actData = await actRes.json();
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
      isSearchNavigatingRef.current = false;
    }
  };

  // Resilient scroll to targeted search message with glow highlight on session load
  useEffect(() => {
    const targetId = targetScrollRef.current || scrollTargetMessageId;
    if (!targetId || !displayMessages || displayMessages.length === 0) return;

    let cancelled = false;
    let attempts = 0;

    const tryScroll = () => {
      if (cancelled) return;
      const el =
        document.getElementById(`chat-msg-${targetId}`) ||
        document.querySelector(`[data-msg-id="${targetId}"]`) ||
        document.querySelector(`[data-msg-index="${targetId}"]`);

      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedMessageId(targetId);
        setTimeout(() => {
          if (!cancelled) {
            isSearchNavigatingRef.current = false;
            targetScrollRef.current = null;
            setScrollTargetMessageId(null);
          }
        }, 2500);
        setTimeout(() => {
          if (!cancelled) {
            setHighlightedMessageId(null);
          }
        }, 4000);
      } else if (attempts < 30) {
        attempts++;
        setTimeout(tryScroll, 50);
      } else {
        isSearchNavigatingRef.current = false;
        targetScrollRef.current = null;
        setScrollTargetMessageId(null);
      }
    };

    const timer = setTimeout(tryScroll, 60);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [displayMessages, selectedPastSessionId]);

  // Save renamed session title
  const handleSaveRename = async (sessionId, customText = null) => {
    const titleToSave = (customText !== null ? customText : editingTitleText).trim();
    if (!titleToSave) {
      setEditingSessionId(null);
      return;
    }

    // Optimistic UI update across session tree
    setSessionTree((prevTree) =>
      prevTree.map((yr) => ({
        ...yr,
        months: yr.months.map((mn) => ({
          ...mn,
          dates: mn.dates.map((dt) => ({
            ...dt,
            sessions: dt.sessions.map((s) => {
              if (s.session_id === sessionId) {
                return { ...s, title: titleToSave };
              }
              return s;
            })
          }))
        }))
      }))
    );

    setEditingSessionId(null);

    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${encodeURIComponent(sessionId)}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleToSave })
      });
      if (!res.ok) {
        fetchSessionTree();
      }
    } catch (err) {
      console.error("Failed to rename session:", err);
      fetchSessionTree();
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
        setSelectedPastSessionId(data.session_id);
        setViewMessages([]);
        fetchSessionMeta(data.session_id);
        fetchSessionTree();
      }
    } catch (err) {
      console.error("Failed to start new session:", err);
    }
  };

  // Instant Bottom-Up Scroll (Industry Standard 0-Jump Layout, skipped when targeting search message)
  React.useLayoutEffect(() => {
    if (isSearchNavigatingRef.current || targetScrollRef.current || scrollTargetMessageId) {
      return;
    }
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [displayMessages, selectedPastSessionId]);

  // Persistent TODO list panel (Live Output tab) — visible in coder mode when the toggle is ON
  const [todoListText, setTodoListText] = React.useState('');
  const [todoItems, setTodoItems] = React.useState([]);
  const [todoListLoading, setTodoListLoading] = React.useState(false);
  const todoEnabled = activeSettings.manage_todo_enabled !== undefined ? activeSettings.manage_todo_enabled : true;
  React.useEffect(() => {
    if (!isCodingMode || !todoEnabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        setTodoListLoading(true);
        const targetSid = selectedPastSessionId || activeSessionId;
        const url = `${API_BASE}/api/todo/list${targetSid ? `?session_id=${encodeURIComponent(targetSid)}` : ''}`;
        const res = await fetch(url);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setTodoListText(data.text || '');
          setTodoItems(data.todos || []);
        }
      } catch (e) {
        if (!cancelled) { setTodoListText(''); setTodoItems([]); }
      } finally {
        if (!cancelled) setTodoListLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isCodingMode, todoEnabled, activeTab, displayMessages, selectedPastSessionId, activeSessionId]);

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

  const currentSessionTitle = React.useMemo(() => {
    const targetId = selectedPastSessionId || activeSessionId;
    if (!targetId) return '';
    for (const yr of sessionTree) {
      for (const mn of yr.months || []) {
        for (const dt of mn.dates || []) {
          const found = dt.sessions?.find((s) => s.session_id === targetId);
          if (found) return found.title;
        }
      }
    }
    return '';
  }, [sessionTree, selectedPastSessionId, activeSessionId]);

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

          {/* Stop Button — instantly aborts the running turn (kills subprocesses + cancels iteration loop) */}
          {(isTurnRunning || isGenerating) && (
            <button
              type="button"
              onClick={handleInterruptProcess}
              title="Stop the running process and abort this turn immediately (Esc)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '7px',
                border: '1px solid rgba(239, 68, 68, 0.7)',
                background: 'rgba(239, 68, 68, 0.25)',
                color: '#fecaca',
                cursor: 'pointer',
                fontSize: '0.72rem',
                fontWeight: 800,
                boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.6)',
                animation: 'yuki-stop-pulse 1.2s infinite',
                transition: 'all 0.15s ease'
              }}
            >
              <Square style={{ width: '12px', height: '12px', fill: '#f87171' }} />
              Stop
            </button>
          )}

          {/* Coding Mode Toggle Button (OFF by default on open) */}
          <button
            type="button"
            onClick={() => setIsCodingMode(prev => !prev)}
            title="Toggle Coding Mode (Zero persona/chatter, technical coding agent directives & coding-only toolset)"
            style={{
              padding: '6px 12px',
              borderRadius: '7px',
              border: isCodingMode ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.15)',
              background: isCodingMode ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              color: isCodingMode ? '#6ee7b7' : '#cbd5e1',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.72rem',
              fontWeight: 700,
              transition: 'all 0.15s ease'
            }}
          >
            <Code style={{ width: '13px', height: '13px', color: isCodingMode ? '#6ee7b7' : '#cbd5e1' }} />
            {isCodingMode ? '⚡ Coding Mode ACTIVE' : '💻 Coding Mode'}
          </button>

          {/* Refresh Workspace Button (F5) */}
          <button
            type="button"
            onClick={handleRefreshWorkspace}
            title="Refresh Session Archive, Active Messages & Workspace State (F5)"
            style={{
              padding: '6px 10px',
              borderRadius: '7px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#cbd5e1',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '0.72rem',
              fontWeight: 600,
              transition: 'all 0.15s ease'
            }}
          >
            <RefreshCw style={{ width: '13px', height: '13px' }} />
            Refresh (F5)
          </button>

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
      <div style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
        cursor: (isResizingLeft || isResizingRight) ? 'col-resize' : 'default',
        userSelect: (isResizingLeft || isResizingRight) ? 'none' : 'auto'
      }}>

        {/* ── SIDEBAR: Hierarchical Chat Session History (Collapsible & Resizable) ─── */}
        {showSidebar && (
          <aside style={{
            width: `${leftSidebarWidth}px`,
            minWidth: `${leftSidebarWidth}px`,
            background: 'rgba(11, 15, 25, 0.98)',
            borderRight: '1px solid rgba(167, 139, 250, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Sidebar Top Action & Search */}
            <div style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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

              {/* Search Bar Across All Conversations */}
              <div style={{ position: 'relative', width: '100%' }}>
                <Search style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', width: '13px', height: '13px', color: searchQuery ? '#38bdf8' : '#94a3b8', pointerEvents: 'none' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search all conversations..."
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 65px 6px 26px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: searchQuery ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '0.72rem',
                    outline: 'none',
                    transition: 'all 0.15s ease'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'rgba(56, 189, 248, 0.6)'}
                  onBlur={(e) => { if (!searchQuery) e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'; }}
                />
                
                {/* Search Actions: Match Exact Toggle & Clear */}
                <div style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <button
                    type="button"
                    onClick={() => setExactMatch(!exactMatch)}
                    title={exactMatch ? "Match Exact / Whole Word: Active" : "Match Exact / Whole Word: Inactive (Click to match exact words or phrases)"}
                    style={{
                      background: exactMatch ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                      border: exactMatch ? '1px solid rgba(56, 189, 248, 0.6)' : '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '4px',
                      color: exactMatch ? '#38bdf8' : '#94a3b8',
                      fontSize: '0.58rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '2px 4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      userSelect: 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: '0.62rem', letterSpacing: '-0.5px' }}>"Ab"</span>
                    <span>Exact</span>
                  </button>

                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                      title="Clear Search"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <X style={{ width: '12px', height: '12px' }} />
                    </button>
                  )}
                </div>
              </div>

              {/* Speaker Role & Date Sort Filter Controls (Only shown when searching) */}
              {searchQuery.trim().length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px', gap: '4px', marginTop: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (filterMaster && !filterYuki) {
                          setFilterYuki(true);
                        } else {
                          setFilterMaster(!filterMaster);
                        }
                      }}
                      title="Filter messages sent by Master (User)"
                      style={{
                        background: filterMaster ? 'rgba(167, 139, 250, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                        border: filterMaster ? '1px solid rgba(167, 139, 250, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '10px',
                        color: filterMaster ? '#c4b5fd' : '#64748b',
                        fontSize: '0.58rem',
                        fontWeight: 600,
                        padding: '1px 6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span style={{ fontSize: '0.62rem' }}>{filterMaster ? '✓' : '○'}</span>
                      <span>Master</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!filterMaster && filterYuki) {
                          setFilterMaster(true);
                        } else {
                          setFilterYuki(!filterYuki);
                        }
                      }}
                      title="Filter messages sent by Yuki AI (Assistant)"
                      style={{
                        background: filterYuki ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                        border: filterYuki ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '10px',
                        color: filterYuki ? '#38bdf8' : '#64748b',
                        fontSize: '0.58rem',
                        fontWeight: 600,
                        padding: '1px 6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span style={{ fontSize: '0.62rem' }}>{filterYuki ? '✓' : '○'}</span>
                      <span>Yuki AI</span>
                    </button>
                  </div>

                  {/* Date Sort Toggle: Newest vs Oldest */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => setSearchSortOrder(searchSortOrder === 'newest' ? 'oldest' : 'newest')}
                      title={searchSortOrder === 'newest' ? "Sort order: Newest first (Click to sort Oldest first)" : "Sort order: Oldest first (Click to sort Newest first)"}
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '10px',
                        color: '#cbd5e1',
                        fontSize: '0.58rem',
                        fontWeight: 600,
                        padding: '1px 6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span>{searchSortOrder === 'newest' ? '↓ Newest' : '↑ Oldest'}</span>
                    </button>

                    {(!filterMaster || !filterYuki) && (
                      <button
                        type="button"
                        onClick={() => { setFilterMaster(true); setFilterYuki(true); }}
                        title="Reset filter to all speakers"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          fontSize: '0.56rem',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: '0'
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar Content: Search Results OR Hierarchical Archive Tree */}
            <div style={{
              flex: 1,
              padding: '10px 8px',
              overflowY: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(167, 139, 250, 0.3) transparent'
            }}>
              {searchQuery.trim().length > 0 ? (
                /* Search Results View */
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', paddingLeft: '4px', paddingRight: '4px' }}>
                    <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#38bdf8', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                      Search Results {exactMatch && <span style={{ color: '#a78bfa', textTransform: 'none', fontSize: '0.58rem', fontWeight: 600 }}>(Exact)</span>}
                      {filterMaster && !filterYuki && <span style={{ color: '#c4b5fd', textTransform: 'none', fontSize: '0.58rem', fontWeight: 600 }}> [Master]</span>}
                      {!filterMaster && filterYuki && <span style={{ color: '#38bdf8', textTransform: 'none', fontSize: '0.58rem', fontWeight: 600 }}> [Yuki AI]</span>}
                    </span>
                    {isSearching ? (
                      <RefreshCw style={{ width: '11px', height: '11px', color: '#38bdf8', animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <span style={{ fontSize: '0.62rem', color: '#94a3b8' }}>
                        {searchResults.length} session{searchResults.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  {!isSearching && searchResults.length === 0 ? (
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontStyle: 'italic', padding: '12px 6px', textAlign: 'center' }}>
                      No messages found for "{searchQuery}" {exactMatch && '(Exact Word Match)'}
                    </div>
                  ) : (
                    searchResults.map((res) => {
                      const isSessSelected = res.session_id === selectedPastSessionId;
                      const isSessActive = res.session_id === activeSessionId;

                      return (
                        <div
                          key={res.session_id}
                          style={{
                            marginBottom: '8px',
                            background: isSessSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                            borderRadius: '7px',
                            border: isSessSelected ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(255, 255, 255, 0.06)',
                            padding: '6px 8px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {/* Session Title Header Card */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectSession(res.session_id, res.matches && res.matches[0] ? res.matches[0].id : null);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              cursor: 'pointer',
                              marginBottom: res.matches && res.matches.length > 0 ? '6px' : '0',
                              gap: '6px'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', minWidth: 0 }}>
                              <MessageSquare style={{ width: '12px', height: '12px', color: '#38bdf8', flexShrink: 0 }} />
                              <span
                                title={res.title}
                                style={{
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  color: isSessSelected ? '#38bdf8' : isSessActive ? '#c4b5fd' : '#e2e8f0',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {renderHighlightedText(res.title, searchQuery, exactMatch)}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.58rem', color: '#94a3b8', flexShrink: 0 }}>
                              {res.date_str}
                            </span>
                          </div>

                          {/* Matching Messages List */}
                          {res.matches && res.matches.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {res.matches.map((m) => {
                                const isUser = m.role === 'user';
                                return (
                                  <div
                                    key={m.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectSession(res.session_id, m.id);
                                    }}
                                    title="Click to scroll to this message in conversation"
                                    style={{
                                      padding: '5px 7px',
                                      background: 'rgba(15, 23, 42, 0.75)',
                                      border: '1px solid rgba(56, 189, 248, 0.15)',
                                      borderRadius: '5px',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.5)';
                                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.15)';
                                      e.currentTarget.style.background = 'rgba(15, 23, 42, 0.75)';
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                                      <span style={{ fontSize: '0.60rem', fontWeight: 700, color: isUser ? '#a78bfa' : '#38bdf8' }}>
                                        {isUser ? 'Master' : 'Yuki AI'}
                                      </span>
                                      <span style={{ fontSize: '0.55rem', color: '#64748b' }}>
                                        {m.timestamp ? new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.66rem', color: '#cbd5e1', lineHeight: '1.35', overflowWrap: 'break-word' }}>
                                      {renderHighlightedText(m.snippet, searchQuery, exactMatch)}
                                    </div>
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
              ) : (
                /* Standard Hierarchical Tree Archive View */
                <div>
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
                                                    const isEditing = editingSessionId === sess.session_id;

                                                    if (isEditing) {
                                                      return (
                                                        <div
                                                          key={sess.session_id}
                                                          onClick={(e) => e.stopPropagation()}
                                                          style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            padding: '3px 6px',
                                                            background: 'rgba(15, 23, 42, 0.95)',
                                                            borderRadius: '6px',
                                                            border: '1px solid rgba(56, 189, 248, 0.6)',
                                                            width: '100%',
                                                            boxSizing: 'border-box'
                                                          }}
                                                        >
                                                          <input
                                                            autoFocus
                                                            type="text"
                                                            value={editingTitleText}
                                                            onChange={(e) => setEditingTitleText(e.target.value)}
                                                            onKeyDown={(e) => {
                                                              if (e.key === 'Enter') handleSaveRename(sess.session_id);
                                                              if (e.key === 'Escape') setEditingSessionId(null);
                                                            }}
                                                            onFocus={(e) => e.target.select()}
                                                            style={{
                                                              flex: 1,
                                                              minWidth: 0,
                                                              background: 'transparent',
                                                              border: 'none',
                                                              outline: 'none',
                                                              color: '#ffffff',
                                                              fontSize: '0.70rem',
                                                              fontFamily: 'inherit'
                                                            }}
                                                          />
                                                          <button
                                                            type="button"
                                                            onClick={() => handleSaveRename(sess.session_id)}
                                                            title="Save Title (Enter)"
                                                            style={{ background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                          >
                                                            <Check style={{ width: '12px', height: '12px' }} />
                                                          </button>
                                                          <button
                                                            type="button"
                                                            onClick={() => setEditingSessionId(null)}
                                                            title="Cancel (Esc)"
                                                            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                          >
                                                            <X style={{ width: '12px', height: '12px' }} />
                                                          </button>
                                                        </div>
                                                      );
                                                    }

                                                    return (
                                                      <div
                                                        key={sess.session_id}
                                                        onClick={() => handleSelectSession(sess.session_id)}
                                                        onDoubleClick={(e) => {
                                                          e.stopPropagation();
                                                          setEditingSessionId(sess.session_id);
                                                          setEditingTitleText(sess.title);
                                                        }}
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
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>
                                                          <MessageSquare style={{ width: '12px', height: '12px', flexShrink: 0 }} />
                                                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sess.title}</span>
                                                          {sess.status === 'incomplete' && (
                                                            <span
                                                              title="This turn was interrupted or crashed and was recovered"
                                                              style={{
                                                                flexShrink: 0,
                                                                fontSize: '0.58rem',
                                                                fontWeight: 600,
                                                                color: '#fbbf24',
                                                                background: 'rgba(251, 191, 36, 0.15)',
                                                                border: '1px solid rgba(251, 191, 36, 0.4)',
                                                                borderRadius: '4px',
                                                                padding: '1px 5px'
                                                              }}
                                                            >
                                                              ⚠ Recovered
                                                            </span>
                                                          )}
                                                        </div>

                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                                                          <button
                                                            type="button"
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                              setEditingSessionId(sess.session_id);
                                                              setEditingTitleText(sess.title);
                                                            }}
                                                            title="Rename Session"
                                                            style={{
                                                              background: 'none',
                                                              border: 'none',
                                                              color: '#94a3b8',
                                                              opacity: 0.6,
                                                              cursor: 'pointer',
                                                              padding: '2px',
                                                              borderRadius: '3px',
                                                              display: 'flex',
                                                              alignItems: 'center'
                                                            }}
                                                            onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                                                            onMouseLeave={(e) => e.currentTarget.style.opacity = 0.6}
                                                          >
                                                            <Edit2 style={{ width: '11px', height: '11px' }} />
                                                          </button>
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
                                                              borderRadius: '3px',
                                                              display: 'flex',
                                                              alignItems: 'center'
                                                            }}
                                                            onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                                                            onMouseLeave={(e) => e.currentTarget.style.opacity = 0.6}
                                                          >
                                                            <Trash2 style={{ width: '11px', height: '11px' }} />
                                                          </button>
                                                        </div>
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
              )}
            </div>
          </aside>
        )}

        {/* Left Sidebar Drag Resizer Handle */}
        {showSidebar && (
          <div
            onMouseDown={() => setIsResizingLeft(true)}
            title="Drag to resize left sidebar width"
            style={{
              width: '5px',
              background: isResizingLeft ? themeAccent : 'rgba(255, 255, 255, 0.05)',
              cursor: 'col-resize',
              userSelect: 'none',
              zIndex: 10,
              transition: 'background 0.15s ease'
            }}
          />
        )}

        {/* ── MIDDLE PANE: Agentic Timeline & Chat ────────────────────── */}
        <section style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid rgba(167, 139, 250, 0.15)',
          background: 'rgba(11, 15, 25, 0.85)'
        }}>
          {/* Active / Inspected Past Session Banner */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: showSidebar ? '6px 16px' : '6px 20px 6px 28px',
            transition: 'padding 0.2s ease',
            background: selectedPastSessionId ? 'rgba(56, 189, 248, 0.15)' : 'rgba(15, 23, 42, 0.95)',
            borderBottom: selectedPastSessionId ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(167, 139, 250, 0.15)',
            fontSize: '0.74rem',
            color: selectedPastSessionId ? '#38bdf8' : '#e2e8f0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              <span style={{ color: selectedPastSessionId ? '#38bdf8' : '#a78bfa', fontWeight: 600, flexShrink: 0 }}>
                {selectedPastSessionId ? '📜 Inspected Session:' : '💬 Current Session:'}
              </span>

              {editingSessionId === (selectedPastSessionId || activeSessionId) ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    type="text"
                    value={editingTitleText}
                    onChange={(e) => setEditingTitleText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(selectedPastSessionId || activeSessionId);
                      if (e.key === 'Escape') setEditingSessionId(null);
                    }}
                    onFocus={(e) => e.target.select()}
                    style={{
                      padding: '2px 6px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(56, 189, 248, 0.6)',
                      borderRadius: '4px',
                      color: '#ffffff',
                      fontSize: '0.74rem',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveRename(selectedPastSessionId || activeSessionId)}
                    title="Save Title"
                    style={{ background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                  >
                    <Check style={{ width: '13px', height: '13px' }} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSessionId(null)}
                    title="Cancel"
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                  >
                    <X style={{ width: '13px', height: '13px' }} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                  <span style={{ fontWeight: 600, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {currentSessionTitle || selectedPastSessionId || activeSessionId || 'Active Session'}
                  </span>
                  {(selectedPastSessionId || activeSessionId) && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetId = selectedPastSessionId || activeSessionId;
                        setEditingSessionId(targetId);
                        setEditingTitleText(currentSessionTitle || targetId);
                      }}
                      title="Rename Session Title"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        opacity: 0.7
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                      onMouseLeave={(e) => e.currentTarget.style.opacity = 0.7}
                    >
                      <Edit2 style={{ width: '12px', height: '12px' }} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {selectedPastSessionId && (
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
                  fontWeight: 600,
                  flexShrink: 0
                }}
              >
                Return to Live Session
              </button>
            )}
          </div>

          {/* Active Session Context & Workspace Directories Toolbar */}
          <div style={{
            padding: showSidebar ? '8px 16px' : '8px 20px 8px 28px',
            transition: 'padding 0.2s ease',
            background: 'rgba(15, 23, 42, 0.85)',
            borderBottom: '1px solid rgba(167, 139, 250, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Tag style={{ width: '12px', height: '12px' }} /> Temp Custom Facts ({sessionFacts.length})
                </span>
                {isCodingMode && (
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
                    <Folder style={{ width: '12px', height: '12px' }} /> Workspace Directories ({sessionDirectories.length})
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => { setShowFactForm(prev => !prev); setShowDirForm(false); }}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '5px',
                    background: showFactForm ? 'rgba(167, 139, 250, 0.3)' : 'rgba(167, 139, 250, 0.15)',
                    border: '1px solid rgba(167, 139, 250, 0.3)',
                    color: '#c4b5fd',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus style={{ width: '11px', height: '11px' }} /> Add Temp Custom Fact
                </button>

                {isCodingMode && (
                  <button
                    type="button"
                    onClick={toggleAddDirectoryForm}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '5px',
                      background: showDirForm ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: '#6ee7b7',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <FolderPlus style={{ width: '11px', height: '11px' }} /> Add Directory
                  </button>
                )}
              </div>
            </div>

            {/* Inline Fact Creation Form */}
            {showFactForm && (
              <div style={{ display: 'flex', gap: '6px', padding: '6px 8px', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(167, 139, 250, 0.3)', marginTop: '4px' }}>
                <input
                  type="text"
                  placeholder="Temp Fact Label (e.g. Target DB, Framework)"
                  value={factKeyInput}
                  onChange={(e) => setFactKeyInput(e.target.value)}
                  style={{ width: '160px', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#090d16', color: '#fff', fontSize: '0.70rem' }}
                />
                <input
                  type="text"
                  placeholder="Fact Value (e.g. PostgreSQL, Next.js 14)"
                  value={factValInput}
                  onChange={(e) => setFactValInput(e.target.value)}
                  style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#090d16', color: '#fff', fontSize: '0.70rem' }}
                />
                <button
                  type="button"
                  onClick={() => handleSaveSessionMeta('fact', factKeyInput, factValInput)}
                  style={{ padding: '4px 10px', borderRadius: '4px', background: '#8b5cf6', color: '#fff', fontSize: '0.70rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
                >
                  Save Temp Fact
                </button>
              </div>
            )}

            {/* Inline Directory Creation Form (Coder Mode) */}
            {showDirForm && isCodingMode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 8px', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(16, 185, 129, 0.3)', marginTop: '4px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    placeholder="Directory Label (e.g. Project Root, Backend)"
                    value={dirKeyInput}
                    onChange={(e) => setDirKeyInput(e.target.value)}
                    style={{ width: '180px', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#090d16', color: '#fff', fontSize: '0.70rem' }}
                  />
                  <input
                    type="text"
                    placeholder="Absolute Directory Path (e.g. D:/Projects/Yuki)"
                    value={dirValInput}
                    onChange={(e) => setDirValInput(e.target.value)}
                    style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#090d16', color: '#fff', fontSize: '0.70rem' }}
                  />
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    title="Browse System Folders via Native Dialog"
                    style={{ padding: '4px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.4)', fontSize: '0.70rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <FolderOpen style={{ width: '12px', height: '12px' }} />
                    Browse
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => handleSaveSessionMeta('directory', dirKeyInput, dirValInput)}
                  style={{ padding: '4px', borderRadius: '4px', background: '#10b981', color: '#fff', fontSize: '0.70rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
                >
                  Save Workspace Directory
                </button>
              </div>
            )}

            {/* Active Chips List */}
            {(sessionFacts.length > 0 || (isCodingMode && sessionDirectories.length > 0)) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                {sessionFacts.map((fact, idx) => (
                  <div key={`f_${idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(167, 139, 250, 0.15)', border: '1px solid rgba(167, 139, 250, 0.3)', fontSize: '0.68rem', color: '#c4b5fd' }}>
                    <strong>{fact.key}:</strong> {fact.value}
                    <button
                      type="button"
                      onClick={() => handleDeleteSessionMeta('fact', fact.key)}
                      title="Delete Fact"
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', padding: '0 2px', display: 'flex', alignItems: 'center' }}
                    >
                      <Trash2 style={{ width: '10px', height: '10px' }} />
                    </button>
                  </div>
                ))}

                {isCodingMode && sessionDirectories.map((dir, idx) => (
                  <div key={`d_${idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', fontSize: '0.68rem', color: '#6ee7b7' }}>
                    <Folder style={{ width: '10px', height: '10px' }} />
                    <strong>{dir.key}:</strong> <code style={{ color: '#e2e8f0' }}>{dir.value}</code>
                    <button
                      type="button"
                      onClick={() => handleDeleteSessionMeta('directory', dir.key)}
                      title="Delete Directory"
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', padding: '0 2px', display: 'flex', alignItems: 'center' }}
                    >
                      <Trash2 style={{ width: '10px', height: '10px' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div
            ref={chatContainerRef}
            style={{
              flex: 1,
              padding: showSidebar ? '16px 20px' : '16px 24px 16px 36px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(167, 139, 250, 0.3) transparent',
              transition: 'padding 0.2s ease'
            }}
          >
            {backendStatus === 'offline' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#fbbf24', fontSize: '0.76rem', fontWeight: 600, flexShrink: 0 }}>
                <RefreshCw style={{ width: '14px', height: '14px', animation: 'spin 1.5s linear infinite' }} />
                Backend offline — reconnecting...
              </div>
            )}
            {offlineSendNotice && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#f87171', fontSize: '0.76rem', fontWeight: 600, flexShrink: 0 }}>
                <ShieldAlert style={{ width: '14px', height: '14px' }} />
                Message kept in the input — backend is offline, it will send once the connection is restored.
              </div>
            )}
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

                // Render Instant AI Thinking Bubble
                if (msg.isThinking) {
                  return (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        maxWidth: '88%',
                        alignSelf: 'flex-start'
                      }}
                    >
                      <span style={{ fontSize: '0.64rem', fontWeight: 700, color: '#38bdf8', marginBottom: '3px', paddingLeft: '4px' }}>
                        Yuki AI
                      </span>
                      <div style={{
                        padding: '10px 14px',
                        borderRadius: '14px 14px 14px 2px',
                        background: 'linear-gradient(135deg, rgba(22, 30, 46, 0.85) 0%, rgba(34, 46, 68, 0.75) 100%)',
                        border: `1px solid ${themeAccent}45`,
                        color: '#cbd5e1',
                        fontSize: '0.80rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: `0 4px 14px ${themeAccent}20`
                      }}>
                        <Sparkles style={{ width: '14px', height: '14px', color: themeAccent }} />
                        <span>Yuki is processing your request...</span>
                      </div>
                    </div>
                  );
                }

                const { thoughts, toolBadges, cleanContent } = parseMessageThought(msg.content);

                const isMsgHighlighted =
                  highlightedMessageId != null &&
                  (String(msg.id) === String(highlightedMessageId) ||
                   String(index) === String(highlightedMessageId));

                return (
                  <div
                    key={msg.id ?? index}
                    id={`chat-msg-${msg.id ?? index}`}
                    data-msg-id={msg.id}
                    data-msg-index={index}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isUser ? 'flex-end' : 'flex-start',
                      maxWidth: '88%',
                      width: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      alignSelf: isUser ? 'flex-end' : 'flex-start',
                      borderRadius: '12px',
                      transition: 'all 0.3s ease',
                      boxShadow: isMsgHighlighted ? '0 0 24px rgba(56, 189, 248, 0.8), inset 0 0 12px rgba(56, 189, 248, 0.3)' : 'none',
                      outline: isMsgHighlighted ? '2px solid #38bdf8' : 'none',
                      padding: isMsgHighlighted ? '6px' : '0px',
                      background: isMsgHighlighted ? 'rgba(56, 189, 248, 0.12)' : 'transparent'
                    }}
                  >
                    {/* Speaker Tag */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginBottom: '3px',
                      paddingLeft: '4px',
                      paddingRight: '4px'
                    }}>
                      <span style={{
                        fontSize: '0.64rem',
                        fontWeight: 700,
                        color: isUser ? '#a78bfa' : '#38bdf8'
                      }}>
                        {isUser ? 'Master' : 'Yuki AI'}
                      </span>
                      {msg.timestamp && (() => {
                        const ts = msg.timestamp > 1e11 ? msg.timestamp / 1000 : msg.timestamp;
                        const date = new Date(ts * 1000);
                        const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                        const fullDateStr = date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
                        return (
                          <span
                            title={fullDateStr}
                            style={{
                              fontSize: '0.58rem',
                              color: '#64748b',
                              fontVariantNumeric: 'tabular-nums',
                              cursor: 'default'
                            }}
                          >
                            {timeStr}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Thought Block */}
                    {thoughts.map((thought, tIdx) => (
                      <details
                        key={tIdx}
                        style={{
                          width: '100%',
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                          marginBottom: '6px',
                          background: 'rgba(15, 23, 42, 0.6)',
                          border: '1px solid rgba(167, 139, 250, 0.25)',
                          borderRadius: '8px',
                          padding: '6px 10px',
                          fontSize: '0.72rem',
                          color: '#c4b5fd',
                          overflow: 'hidden'
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

                    {/* Dedicated Collapsible Tool Accordion Cards (Modern Cursor/Windsurf Style) */}
                    {toolBadges && toolBadges.map((tb, bIdx) => {
                      const isRunning = tb.status.includes('Running') || tb.status.includes('Processing');
                      const isSuccess = tb.status.includes('Done') || tb.status.includes('Success') || tb.status.includes('Completed');
                      const isFailed = !isRunning && !isSuccess;

                      const statusBadgeBg = isRunning ? 'rgba(56, 189, 248, 0.15)' : isSuccess ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)';
                      const statusBadgeColor = isRunning ? '#38bdf8' : isSuccess ? '#4ade80' : '#f87171';
                      const statusBadgeBorder = isRunning ? 'rgba(56, 189, 248, 0.4)' : isSuccess ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)';
                      const statusLabel = isRunning ? '⏳ Processing...' : isSuccess ? '✓ Completed' : '❌ Failed';

                      return (
                        <details
                          key={bIdx}
                          open={isRunning}
                          style={{
                            width: '100%',
                            maxWidth: '100%',
                            boxSizing: 'border-box',
                            marginBottom: '6px',
                            background: 'rgba(15, 23, 42, 0.85)',
                            border: `1px solid ${statusBadgeBorder}`,
                            borderRadius: '8px',
                            overflow: 'hidden',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                          }}
                        >
                          <summary style={{
                            cursor: 'pointer',
                            padding: '7px 12px',
                            background: 'rgba(30, 41, 59, 0.8)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            color: '#38bdf8',
                            userSelect: 'none',
                            maxWidth: '100%',
                            boxSizing: 'border-box'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                              <Terminal style={{ width: '13px', height: '13px', color: '#38bdf8', flexShrink: 0 }} />
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                🛠️ Tool Run: <strong>{tb.toolName}</strong>
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                              {isRunning && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleInterruptProcess();
                                  }}
                                  title="Force terminate running process and stop turn"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    background: 'rgba(239, 68, 68, 0.2)',
                                    border: '1px solid rgba(239, 68, 68, 0.5)',
                                    borderRadius: '4px',
                                    padding: '2px 8px',
                                    color: '#f87171',
                                    fontSize: '0.66rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  <Square style={{ width: '9px', height: '9px', fill: '#f87171' }} />
                                  <span>Terminate Process</span>
                                </button>
                              )}
                              <span style={{
                                fontSize: '0.68rem',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                background: statusBadgeBg,
                                color: statusBadgeColor,
                                border: `1px solid ${statusBadgeBorder}`,
                                flexShrink: 0
                              }}>
                                {statusLabel}
                              </span>
                            </div>
                          </summary>
                          <div style={{ padding: '10px 12px', fontSize: '0.74rem', background: '#090d16', color: '#cbd5e1', fontFamily: 'monospace', maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
                            {/* Terminal Prompt Line Header for Terminal/Python runs */}
                            {(tb.toolName.includes('terminal') || tb.toolName.includes('python')) && (
                              <div style={{
                                background: '#0f172a',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                marginBottom: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.74rem',
                                maxWidth: '700px',
                                width: '100%',
                                overflowX: 'auto',
                                whiteSpace: 'nowrap',
                                boxSizing: 'border-box'
                              }}>
                                <span style={{ color: '#a78bfa', fontWeight: 700, flexShrink: 0 }}>
                                  {(sessionDirectories && sessionDirectories.length > 0 && sessionDirectories[0].value) ? sessionDirectories[0].value : 'd:\\workspace'}
                                </span>
                                <span style={{ color: '#4ade80', fontWeight: 700, flexShrink: 0 }}>$</span>
                                <span style={{ color: '#f8fafc', fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'Consolas, Monaco, monospace' }}>
                                  {tb.target ? tb.target : tb.toolName}
                                </span>
                              </div>
                            )}

                            {tb.target && !tb.toolName.includes('terminal') && !tb.toolName.includes('python') && (
                              <div style={{ color: '#94a3b8', marginBottom: '6px', fontSize: '0.72rem', wordBreak: 'break-all' }}>
                                <strong style={{ color: '#a78bfa' }}>Target / Command:</strong> {tb.target}
                              </div>
                            )}

                            {tb.args && (
                              <div style={{ marginTop: '6px', marginBottom: '8px', maxWidth: '700px', width: '100%', boxSizing: 'border-box' }}>
                                <div style={{ color: '#38bdf8', fontSize: '0.68rem', fontWeight: 700, marginBottom: '4px' }}>
                                  📥 INPUT / ARGUMENTS:
                                </div>
                                <div style={{
                                  background: '#020617',
                                  padding: '8px 10px',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(56, 189, 248, 0.2)',
                                  maxHeight: '400px',
                                  maxWidth: '700px',
                                  width: '100%',
                                  overflowY: 'auto',
                                  overflowX: 'auto',
                                  boxSizing: 'border-box',
                                  fontSize: '0.72rem',
                                  color: '#cbd5e1'
                                }}>
                                  <pre style={{ margin: 0, whiteSpace: 'pre', wordBreak: 'normal', display: 'block', width: 'max-content', minWidth: '100%', fontFamily: 'Consolas, Monaco, monospace' }}>{tb.args}</pre>
                                </div>
                              </div>
                            )}

                            {tb.output && (
                              <div style={{ marginTop: '6px', marginBottom: '6px', maxWidth: '700px', width: '100%', boxSizing: 'border-box' }}>
                                <div style={{ color: '#64748b', fontSize: '0.68rem', fontWeight: 600, marginBottom: '4px' }}>
                                  📤 RESULT / OUTPUT:
                                </div>
                                <div style={{
                                  background: '#020617',
                                  padding: '8px 10px',
                                  borderRadius: '6px',
                                  border: '1px solid #1e293b',
                                  maxHeight: '400px',
                                  maxWidth: '700px',
                                  width: '100%',
                                  overflowY: 'auto',
                                  overflowX: 'auto',
                                  boxSizing: 'border-box',
                                  fontSize: '0.72rem',
                                  color: isFailed ? '#f87171' : '#4ade80'
                                }}>
                                  <pre style={{ margin: 0, whiteSpace: 'pre', wordBreak: 'normal', display: 'block', width: 'max-content', minWidth: '100%', fontFamily: 'Consolas, Monaco, monospace' }}>{tb.output}</pre>
                                </div>
                              </div>
                            )}
                            <div style={{ color: '#64748b', fontSize: '0.68rem', fontStyle: 'italic', marginTop: '4px' }}>
                              Executed via Yuki ReAct Engine in workspace directory.
                            </div>
                          </div>
                        </details>
                      );
                    })}

                    {/* Message Bubble */}
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                      background: isUser
                        ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.35) 0%, rgba(109, 40, 217, 0.35) 100%)'
                        : 'linear-gradient(135deg, rgba(22, 30, 46, 0.85) 0%, rgba(34, 46, 68, 0.75) 100%)',
                      border: isUser ? '1px solid rgba(167, 139, 250, 0.4)' : '1px solid rgba(148, 163, 184, 0.18)',
                      color: '#f8fafc',
                      fontSize: '0.82rem',
                      lineHeight: '1.5',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                      wordBreak: 'break-word',
                      maxWidth: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box'
                    }}>
                      {isUser && msg.attachments && renderMessageAttachments(msg.attachments)}
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
            padding: showSidebar ? '12px 16px 14px' : '12px 20px 14px 32px',
            background: 'rgba(15, 23, 42, 0.95)',
            borderTop: '1px solid rgba(167, 139, 250, 0.2)',
            transition: 'padding 0.2s ease'
          }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendPrompt(currentInputText);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleFileUpload(e.dataTransfer.files);
                }
              }}
              style={{
                background: 'rgba(24, 24, 32, 0.95)',
                border: isDragOver ? '2px dashed #38bdf8' : `1px solid ${themeAccent}35`,
                borderRadius: '18px',
                padding: '12px 14px 10px',
                boxShadow: isDragOver ? '0 0 20px rgba(56, 189, 248, 0.4)' : `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 15px ${themeAccent}15`,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                transition: 'border 0.15s ease, box-shadow 0.15s ease'
              }}
            >
              {/* Hidden File Input */}
              <input
                type="file"
                ref={attachmentInputRef}
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleFileUpload(e.target.files)}
              />

              {/* Attachment Preview Chips */}
              {attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '4px' }}>
                  {attachments.map((att, aIdx) => (
                    <div
                      key={`att_${aIdx}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 8px',
                        borderRadius: '8px',
                        background: att.is_image ? 'rgba(56, 189, 248, 0.18)' : 'rgba(167, 139, 250, 0.18)',
                        border: att.is_image ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(167, 139, 250, 0.4)',
                        fontSize: '0.72rem',
                        color: att.is_image ? '#38bdf8' : '#c4b5fd'
                      }}
                    >
                      {att.is_image ? (
                        <img src={att.data_url} alt={att.filename} style={{ width: '20px', height: '20px', objectFit: 'cover', borderRadius: '4px' }} />
                      ) : (
                        <FileText style={{ width: '14px', height: '14px', flexShrink: 0 }} />
                      )}
                      <span style={{ fontWeight: 600, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {att.filename}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(aIdx)}
                        title="Remove attachment"
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 2px' }}
                      >
                        <X style={{ width: '12px', height: '12px' }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Top Textarea Input Area (Auto-expanding up to 200px max height) */}
              <textarea
                ref={textareaRef}
                value={currentInputText}
                onChange={(e) => handleInputChange(e.target.value)}
                onPaste={(e) => {
                  if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                    e.preventDefault();
                    handleFileUpload(e.clipboardData.files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendPrompt(currentInputText);
                  }
                }}
                placeholder={isDragOver ? "Drop files here to attach..." : "Ask Yuki anything, run code, or attach files/images (Shift+Enter for line break)..."}
                style={{
                  width: '100%',
                  minHeight: '38px',
                  maxHeight: '200px',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#f8fafc',
                  fontSize: chatFontSize || '0.84rem',
                  lineHeight: '1.5',
                  resize: 'none',
                  fontFamily: 'inherit',
                  overflowY: 'auto',
                  scrollbarWidth: 'thin',
                  scrollbarColor: `${themeAccent}60 transparent`
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
                  {!isCodingMode && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const val = !promptPersona;
                          setPromptPersona(val);
                          localStorage.setItem('yuki-prompt-persona', String(val));
                        }}
                        title="Persona & Roleplay module"
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
                    </>
                  )}

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

                  {isCodingMode && (
                    <button
                      type="button"
                      onClick={() => {
                        const val = activeSettings.manage_todo_enabled !== undefined ? !activeSettings.manage_todo_enabled : false;
                        handleUpdateSetting({ manage_todo_enabled: val });
                      }}
                      title="Persistent TODO list tool (coder mode)"
                      style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        border: (activeSettings.manage_todo_enabled !== undefined ? activeSettings.manage_todo_enabled : true) ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                        background: (activeSettings.manage_todo_enabled !== undefined ? activeSettings.manage_todo_enabled : true) ? 'rgba(16, 185, 129, 0.25)' : 'rgba(0,0,0,0.3)',
                        color: (activeSettings.manage_todo_enabled !== undefined ? activeSettings.manage_todo_enabled : true) ? '#ffffff' : '#64748b',
                        cursor: 'pointer',
                        fontSize: '0.66rem',
                        fontWeight: 600
                      }}
                    >
                      ✅ TODO List {activeSettings.manage_todo_enabled !== undefined ? (activeSettings.manage_todo_enabled ? 'ON' : 'OFF') : 'ON'}
                    </button>
                  )}
                </div>

                {/* Right Side: Mic + Circular Send Button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
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

                  {/* Paperclip Attach Button right next to Send */}
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={isUploadingAttachment}
                    title="Attach files or images (or drag & drop / Ctrl+V paste)"
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      background: isUploadingAttachment ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                      color: isUploadingAttachment ? '#a78bfa' : '#94a3b8',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s ease',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                    }}
                  >
                    <Paperclip style={{ width: '15px', height: '15px' }} />
                  </button>

                  <button
                    type="submit"
                    disabled={!currentInputText.trim() && attachments.length === 0}
                    title="Send Prompt (Enter)"
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      border: 'none',
                      background: (currentInputText.trim() || attachments.length > 0)
                        ? `linear-gradient(135deg, ${themeAccent} 0%, #0284c7 100%)`
                        : 'rgba(255, 255, 255, 0.1)',
                      color: (currentInputText.trim() || attachments.length > 0) ? '#ffffff' : '#64748b',
                      cursor: (currentInputText.trim() || attachments.length > 0) ? 'pointer' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: (currentInputText.trim() || attachments.length > 0) ? `0 4px 14px ${themeAccent}60` : 'none'
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

        {/* Right Sidebar Drag Resizer Handle */}
        <div
          onMouseDown={() => setIsResizingRight(true)}
          title="Drag to resize right sidebar width"
          style={{
            width: '5px',
            background: isResizingRight ? themeAccent : 'rgba(255, 255, 255, 0.05)',
            cursor: 'col-resize',
            userSelect: 'none',
            zIndex: 10,
            transition: 'background 0.15s ease'
          }}
        />

        {/* ── RIGHT PANE: Live Inspector & Context Monitor (Resizable Width) ─── */}
        <section style={{
          width: `${rightSidebarWidth}px`,
          minWidth: `${rightSidebarWidth}px`,
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
                padding: '7px 8px',
                fontSize: '0.72rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                background: activeTab === 'memory' ? 'rgba(244, 114, 182, 0.22)' : 'transparent',
                color: activeTab === 'memory' ? '#f472b6' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                transition: 'all 0.15s ease'
              }}
            >
              <Brain style={{ width: '13px', height: '13px' }} /> Memory
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('file_viewer')}
              style={{
                flex: 1,
                padding: '7px 8px',
                fontSize: '0.72rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                background: activeTab === 'file_viewer' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                color: activeTab === 'file_viewer' ? '#38bdf8' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                transition: 'all 0.15s ease'
              }}
            >
              <FileText style={{ width: '13px', height: '13px' }} /> File Viewer
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('brain')}
              style={{
                flex: 1,
                padding: '7px 8px',
                fontSize: '0.72rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                background: activeTab === 'brain' ? 'rgba(167, 139, 250, 0.22)' : 'transparent',
                color: activeTab === 'brain' ? '#c4b5fd' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                transition: 'all 0.15s ease'
              }}
            >
              <Cpu style={{ width: '13px', height: '13px' }} /> AI Brain
            </button>
          </div>

          {/* Tab: Universal File Viewer (Readonly Mode) */}
          {activeTab === 'file_viewer' && (
            <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(167, 139, 250, 0.2)', paddingBottom: '8px' }}>
                <div style={{ fontWeight: '700', fontSize: '0.78rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FileText style={{ width: '14px', height: '14px', color: '#38bdf8' }} />
                  <span>{fileInspectorData ? fileInspectorData.name : 'File Viewer'}</span>
                  <span style={{ fontSize: '0.64rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(167, 139, 250, 0.2)', color: '#c4b5fd', border: '1px solid rgba(167, 139, 250, 0.3)' }}>Readonly</span>
                </div>
                {fileInspectorData && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(fileInspectorData.path);
                    }}
                    title="Copy File Path"
                    style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#94a3b8', fontSize: '0.66rem', cursor: 'pointer' }}
                  >
                    Copy Path
                  </button>
                )}
              </div>

              {loadingFileInspector ? (
                <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8', fontSize: '0.76rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <RefreshCw style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />
                  <span>Loading file content...</span>
                </div>
              ) : fileInspectorData ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '0.66rem', color: '#64748b', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {fileInspectorData.path}
                  </div>

                  {fileInspectorData.is_directory ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                      <InteractiveDirectoryViewer rootData={fileInspectorData} onSelectFile={handleSelectTreeFile} />
                      {treeSelectedFileData && (
                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(56, 189, 248, 0.2)', paddingTop: '8px' }}>
                            <div style={{ color: '#38bdf8', fontSize: '0.74rem', fontWeight: 700, fontFamily: 'Consolas, Monaco, monospace', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {renderTreeFileIcon(treeSelectedFileData.name)}
                              <span>{treeSelectedFileData.name}</span>
                            </div>
                            <span style={{ fontSize: '0.62rem', color: '#64748b', fontFamily: 'monospace' }}>
                              {treeSelectedFileData.path}
                            </span>
                          </div>

                          {treeSelectedFileData.is_image ? (
                            <div style={{ padding: '12px', background: 'rgba(15, 23, 42, 0.9)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                              <img src={treeSelectedFileData.data_url} alt={treeSelectedFileData.name} style={{ maxWidth: '100%', maxHeight: '350px', objectFit: 'contain', borderRadius: '4px' }} />
                            </div>
                          ) : treeSelectedFileData.ext === '.md' ? (
                            <div style={{ background: 'rgba(15, 23, 42, 0.85)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '8px', padding: '12px', fontSize: '0.78rem', color: '#cbd5e1', overflowY: 'auto', maxHeight: '350px' }}>
                              <RenderMessageContent content={treeSelectedFileData.content} disableFileLinks={true} />
                            </div>
                          ) : (
                            <CodeViewerWithLineNumbers content={treeSelectedFileData.content} maxHeight="350px" />
                          )}
                        </div>
                      )}
                    </div>
                  ) : fileInspectorData.is_image ? (
                    <div style={{ padding: '12px', background: 'rgba(15, 23, 42, 0.9)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                      <img src={fileInspectorData.data_url} alt={fileInspectorData.name} style={{ maxWidth: '100%', maxHeight: '380px', objectFit: 'contain', borderRadius: '4px' }} />
                    </div>
                  ) : fileInspectorData.ext === '.md' ? (
                    <div style={{ background: 'rgba(15, 23, 42, 0.85)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '8px', padding: '12px', fontSize: '0.78rem', color: '#cbd5e1', overflowY: 'auto' }}>
                      <RenderMessageContent content={fileInspectorData.content} disableFileLinks={true} />
                    </div>
                  ) : (
                    <CodeViewerWithLineNumbers content={fileInspectorData.content} maxHeight="450px" />
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '30px 16px', color: '#64748b', fontSize: '0.76rem', fontStyle: 'italic' }}>
                  No file opened yet. Click on any file link or markdown document in the chat to open it in Readonly Mode here.
                </div>
              )}
            </div>
          )}

          {/* Tab 1: Live Output & Code Inspector */}
          {activeTab === 'inspector' && (
            <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontWeight: '600', fontSize: '0.76rem', color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Terminal style={{ width: '14px', height: '14px' }} />
                Real-Time Tool Execution Log
              </div>

              {isCodingMode && todoEnabled && (
                <div style={{
                  background: 'rgba(16, 185, 129, 0.07)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '8px',
                  padding: '10px'
                }}>
                  <div style={{ fontSize: '0.70rem', color: '#6ee7b7', fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    ✅ Persistent TODO List
                    {todoListLoading && <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 400 }}>refreshing...</span>}
                  </div>
                  <div style={{
                    fontSize: '0.72rem',
                    fontFamily: 'Consolas, Monaco, monospace',
                    whiteSpace: 'pre-wrap',
                    color: '#e2e8f0',
                    lineHeight: '1.5',
                    maxHeight: '220px',
                    overflowY: 'auto'
                  }}>
                    {todoItems.length > 0 ? <TodoTree todos={todoItems} /> : (todoListText ? todoListText : 'No todos yet. Ask the coding agent to start a task list with manage_todo.')}
                  </div>
                </div>
              )}

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

              <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', marginBottom: '12px' }}>
                <div style={{ fontSize: '0.66rem', color: '#94a3b8' }}>Platform</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff', marginTop: '2px' }}>
                  {profileData?.platform || (navigator.userAgent.includes('Win') ? 'Windows 11' : 'Windows')}
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

          {/* Tab 4: AI Brain & Execution Overrides */}
          {activeTab === 'brain' && (
            <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontWeight: '600', fontSize: '0.76rem', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cpu style={{ width: '14px', height: '14px' }} />
                Per-Turn AI Brain & Execution Overrides
              </div>

              {/* Section 0: Live AI Brain & Language Model Strategy Card */}
              <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(167, 139, 250, 0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontSize: '0.68rem', color: '#c4b5fd', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Sparkles style={{ width: '13px', height: '13px' }} />
                    AI Brain & Language Model Pipeline
                  </div>
                  <span style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: isCodingMode
                      ? 'rgba(251, 146, 60, 0.25)'
                      : (profileData?.settings?.endpoint_strategy === 'dual' || profileData?.settings?.endpoint_strategy === 'separate')
                        ? 'rgba(56, 189, 248, 0.2)'
                        : 'rgba(167, 139, 250, 0.2)',
                    color: isCodingMode
                      ? '#fb923c'
                      : (profileData?.settings?.endpoint_strategy === 'dual' || profileData?.settings?.endpoint_strategy === 'separate')
                        ? '#38bdf8'
                        : '#c4b5fd',
                    border: isCodingMode
                      ? '1px solid rgba(251, 146, 60, 0.4)'
                      : (profileData?.settings?.endpoint_strategy === 'dual' || profileData?.settings?.endpoint_strategy === 'separate')
                        ? '1px solid rgba(56, 189, 248, 0.4)'
                        : '1px solid rgba(167, 139, 250, 0.4)'
                  }}>
                    {isCodingMode
                      ? '🛠️ Coder Mode Active'
                      : (profileData?.settings?.endpoint_strategy === 'dual' || profileData?.settings?.endpoint_strategy === 'separate')
                        ? '⚡ Dual Endpoints'
                        : '🎯 Single Endpoint'}
                  </span>
                </div>

                {isCodingMode ? (
                  <div style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(251, 146, 60, 0.12)', border: '1px solid rgba(251, 146, 60, 0.3)' }}>
                    <div style={{ fontSize: '0.62rem', color: '#fb923c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      ⚡ Dedicated Coder Mode Engine
                    </div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f8fafc', marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      <span style={{ color: '#94a3b8', textTransform: 'capitalize' }}>
                        [{profileData?.settings?.llm_coder_backend && profileData?.settings?.llm_coder_backend !== 'none' ? profileData?.settings?.llm_coder_backend : (profileData?.settings?.llm_backend || 'groq')}]
                      </span>{' '}
                      {profileData?.settings?.llm_coder_model || profileData?.settings?.llm_model || 'llama-3.3-70b-versatile'}
                    </div>
                  </div>
                ) : (profileData?.settings?.endpoint_strategy === 'dual' || profileData?.settings?.endpoint_strategy === 'separate') ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(56,189,248,0.2)' }}>
                      <div style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        ⚡ Fast/Simple Queries Model
                      </div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f8fafc', marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        <span style={{ color: '#94a3b8', textTransform: 'capitalize' }}>[{profileData?.settings?.llm_simple_backend || profileData?.settings?.llm_backend || 'groq'}]</span> {profileData?.settings?.llm_simple_model || profileData?.settings?.llm_model || 'llama-3.3-70b-versatile'}
                      </div>
                    </div>

                    <div style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(167, 139, 250, 0.2)' }}>
                      <div style={{ fontSize: '0.62rem', color: '#c4b5fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        🧠 Complex & Agentic Tasks Model
                      </div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f8fafc', marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        <span style={{ color: '#94a3b8', textTransform: 'capitalize' }}>[{profileData?.settings?.llm_complex_backend || profileData?.settings?.llm_backend || 'groq'}]</span> {profileData?.settings?.llm_complex_model || profileData?.settings?.llm_model || 'llama-3.3-70b-versatile'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: '0.62rem', color: '#c4b5fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Unified Language Model
                    </div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f8fafc', marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      <span style={{ color: '#94a3b8', textTransform: 'capitalize' }}>[{profileData?.settings?.llm_backend || 'groq'}]</span> {profileData?.settings?.llm_model || 'llama-3.3-70b-versatile'}
                    </div>
                  </div>
                )}
              </div>

              {/* Section 0.5: Per-Session Custom Facts & Workspace Directories */}
              <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.25)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '0.68rem', color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Layers style={{ width: '13px', height: '13px' }} />
                    Session Facts & Workspace Paths
                  </div>
                  <span style={{ fontSize: '0.60rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                    Per-Session DB Saved
                  </span>
                </div>

                {/* Session Facts List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.66rem', color: '#cbd5e1', fontWeight: 600 }}>📌 Temp Custom Facts ({sessionFacts.length})</span>
                    <button
                      type="button"
                      onClick={() => setShowFactForm(prev => !prev)}
                      style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.62rem', background: 'rgba(167, 139, 250, 0.2)', color: '#c4b5fd', border: '1px solid rgba(167, 139, 250, 0.4)', cursor: 'pointer' }}
                    >
                      {showFactForm ? 'Cancel' : '+ Add Temp Fact'}
                    </button>
                  </div>

                  {showFactForm && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(167, 139, 250, 0.3)' }}>
                      <input
                        type="text"
                        placeholder="Label / Key (e.g. Target Database, User Role)"
                        value={factKeyInput}
                        onChange={(e) => setFactKeyInput(e.target.value)}
                        style={{ padding: '5px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#090d16', color: '#fff', fontSize: '0.70rem' }}
                      />
                      <input
                        type="text"
                        placeholder="Value (e.g. PostgreSQL v16, Senior Dev)"
                        value={factValInput}
                        onChange={(e) => setFactValInput(e.target.value)}
                        style={{ padding: '5px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#090d16', color: '#fff', fontSize: '0.70rem' }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveSessionMeta('fact', factKeyInput, factValInput)}
                        style={{ padding: '5px', borderRadius: '4px', background: '#8b5cf6', color: '#fff', fontSize: '0.70rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
                      >
                        Save Temp Custom Fact
                      </button>
                    </div>
                  )}

                  {sessionFacts.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {sessionFacts.map((fact, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: '5px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '0.68rem' }}>
                          <span style={{ color: '#cbd5e1' }}>
                            <strong style={{ color: '#c4b5fd' }}>{fact.key}:</strong> {fact.value}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteSessionMeta('fact', fact.key)}
                            title="Delete Fact"
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 4px' }}
                          >
                            <Trash2 style={{ width: '12px', height: '12px' }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.64rem', color: '#64748b', fontStyle: 'italic' }}>No custom facts added for this session yet.</div>
                  )}
                </div>

                {/* Workspace Directories (In Coder Mode or general) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.66rem', color: '#cbd5e1', fontWeight: 600 }}>📁 Workspace Directories ({sessionDirectories.length})</span>
                    <button
                      type="button"
                      onClick={toggleAddDirectoryForm}
                      style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.62rem', background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7', border: '1px solid rgba(16, 185, 129, 0.4)', cursor: 'pointer' }}
                    >
                      {showDirForm ? 'Cancel' : '+ Add Directory'}
                    </button>
                  </div>

                  {showDirForm && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                      <input
                        type="text"
                        placeholder="Directory Label (e.g. Project Root, Backend)"
                        value={dirKeyInput}
                        onChange={(e) => setDirKeyInput(e.target.value)}
                        style={{ padding: '5px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#090d16', color: '#fff', fontSize: '0.70rem' }}
                      />
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input
                          type="text"
                          placeholder="Absolute Path (e.g. D:/Projects/Yuki)"
                          value={dirValInput}
                          onChange={(e) => setDirValInput(e.target.value)}
                          style={{ flex: 1, padding: '5px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#090d16', color: '#fff', fontSize: '0.70rem' }}
                        />
                        <button
                          type="button"
                          onClick={handlePickFolder}
                          title="Browse Local Folder System (Electron Dialog)"
                          style={{ padding: '5px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.4)', fontSize: '0.70rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <FolderOpen style={{ width: '13px', height: '13px' }} />
                          Browse
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSaveSessionMeta('directory', dirKeyInput, dirValInput)}
                        style={{ padding: '5px', borderRadius: '4px', background: '#10b981', color: '#fff', fontSize: '0.70rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
                      >
                        Save Workspace Directory
                      </button>
                    </div>
                  )}

                  {sessionDirectories.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {sessionDirectories.map((dir, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: '5px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '0.68rem' }}>
                          <span style={{ color: '#cbd5e1', wordBreak: 'break-all' }}>
                            <strong style={{ color: '#6ee7b7' }}>{dir.key}:</strong> <code style={{ color: '#94a3b8' }}>{dir.value}</code>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteSessionMeta('directory', dir.key)}
                            title="Delete Directory"
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 4px', marginLeft: '6px' }}
                          >
                            <Trash2 style={{ width: '12px', height: '12px' }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.64rem', color: '#64748b', fontStyle: 'italic' }}>No workspace directories added. (Directories are sent to LLM during Coder Mode).</div>
                  )}
                </div>
              </div>

              {/* Section 1: Tool Operating Suite */}
              <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600, marginBottom: '8px' }}>
                  Tool Operating Suite
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setChatWindowToolMode('basic');
                      localStorage.setItem('yuki-chat-tool-mode', 'basic');
                    }}
                    style={{
                      padding: '7px 10px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      border: chatWindowToolMode === 'basic' ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                      background: chatWindowToolMode === 'basic' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(0,0,0,0.3)',
                      color: chatWindowToolMode === 'basic' ? '#38bdf8' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    ⚡ Basic Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setChatWindowToolMode('advanced');
                      localStorage.setItem('yuki-chat-tool-mode', 'advanced');
                    }}
                    style={{
                      padding: '7px 10px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      border: chatWindowToolMode === 'advanced' ? '1px solid #c4b5fd' : '1px solid rgba(255,255,255,0.1)',
                      background: chatWindowToolMode === 'advanced' ? 'rgba(167, 139, 250, 0.2)' : 'rgba(0,0,0,0.3)',
                      color: chatWindowToolMode === 'advanced' ? '#c4b5fd' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    🤖 Autonomous Jarvis
                  </button>
                </div>
              </div>

              {/* Section 2: Prompt Strategy / LLM Mode */}
              <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600, marginBottom: '8px' }}>
                  Prompt Strategy (LLM Mode)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setLlmModeOverride(3);
                      localStorage.setItem('yuki-override-llm-mode', '3');
                    }}
                    style={{
                      padding: '7px 10px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      textAlign: 'left',
                      border: llmModeOverride === 3 ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                      background: llmModeOverride === 3 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(0,0,0,0.3)',
                      color: llmModeOverride === 3 ? '#38bdf8' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    🔄 Mode 3 — Dynamic Mixed Prompts (Default)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLlmModeOverride(1);
                      localStorage.setItem('yuki-override-llm-mode', '1');
                    }}
                    style={{
                      padding: '7px 10px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      textAlign: 'left',
                      border: llmModeOverride === 1 ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                      background: llmModeOverride === 1 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0,0,0,0.3)',
                      color: llmModeOverride === 1 ? '#f59e0b' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    ⚡ Mode 1 — Fast/Simple Single Prompt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLlmModeOverride(2);
                      localStorage.setItem('yuki-override-llm-mode', '2');
                    }}
                    style={{
                      padding: '7px 10px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      textAlign: 'left',
                      border: llmModeOverride === 2 ? '1px solid #c4b5fd' : '1px solid rgba(255,255,255,0.1)',
                      background: llmModeOverride === 2 ? 'rgba(167, 139, 250, 0.2)' : 'rgba(0,0,0,0.3)',
                      color: llmModeOverride === 2 ? '#c4b5fd' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    🧠 Mode 2 — Full Agentic Complex Prompt
                  </button>
                </div>
              </div>

              {/* Section 3: Granular Execution Flags */}
              <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600 }}>
                  Granular Execution Flags
                </div>

                {/* LLM Intent Check */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.74rem', color: '#e2e8f0' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>LLM Intent Check</div>
                    <div style={{ fontSize: '0.64rem', color: '#94a3b8' }}>Double-checks tool intent before calling</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !enableIntentCheckOverride;
                      setEnableIntentCheckOverride(next);
                      localStorage.setItem('yuki-override-intent-check', String(next));
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      border: enableIntentCheckOverride ? '1px solid #22c55e' : '1px solid rgba(255,255,255,0.2)',
                      background: enableIntentCheckOverride ? 'rgba(34, 197, 94, 0.2)' : 'rgba(0,0,0,0.4)',
                      color: enableIntentCheckOverride ? '#4ade80' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    {enableIntentCheckOverride ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* Dynamic Tool Calling */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.74rem', color: '#e2e8f0' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Dynamic Tool Calling</div>
                    <div style={{ fontSize: '0.64rem', color: '#94a3b8' }}>Filters tool schemas by query relevance</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !dynamicToolCallingOverride;
                      setDynamicToolCallingOverride(next);
                      localStorage.setItem('yuki-override-dynamic-tools', String(next));
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      border: dynamicToolCallingOverride ? '1px solid #22c55e' : '1px solid rgba(255,255,255,0.2)',
                      background: dynamicToolCallingOverride ? 'rgba(34, 197, 94, 0.2)' : 'rgba(0,0,0,0.4)',
                      color: dynamicToolCallingOverride ? '#4ade80' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    {dynamicToolCallingOverride ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* Tools in Simple Prompts */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.74rem', color: '#e2e8f0' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Tools in Simple Prompts</div>
                    <div style={{ fontSize: '0.64rem', color: '#94a3b8' }}>Sends tool schemas during simple chatter</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !sendToolsInSimpleOverride;
                      setSendToolsInSimpleOverride(next);
                      localStorage.setItem('yuki-override-tools-in-simple', String(next));
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      border: sendToolsInSimpleOverride ? '1px solid #22c55e' : '1px solid rgba(255,255,255,0.2)',
                      background: sendToolsInSimpleOverride ? 'rgba(34, 197, 94, 0.2)' : 'rgba(0,0,0,0.4)',
                      color: sendToolsInSimpleOverride ? '#4ade80' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    {sendToolsInSimpleOverride ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              {/* Section 4: System Prompt Modules */}
              <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600, marginBottom: '2px' }}>
                  System Prompt Modules
                </div>
                {isCodingMode && (
                  <div style={{ fontSize: '0.65rem', color: '#f59e0b', marginBottom: '4px' }}>
                    Coding Mode: Persona, Expressions &amp; Memory modules are ignored (coding agent prompt is used).
                  </div>
                )}
                {[
                  { id: 'persona', label: 'Persona & Mood Spectrum', state: promptPersona, set: setPromptPersona, key: 'yuki-prompt-persona', coderInert: true },
                  { id: 'expressions', label: '3D Avatar Expressions', state: promptExpressions, set: setPromptExpressions, key: 'yuki-prompt-expressions', coderInert: true },
                  { id: 'memory', label: 'User Memory Card', state: promptMemory, set: setPromptMemory, key: 'yuki-prompt-memory', coderInert: true },
                  { id: 'directives', label: 'Behavioral Tool Directives', state: promptDirectives, set: setPromptDirectives, key: 'yuki-prompt-directives' },
                  { id: 'planning', label: 'Section 5 Implementation Planning', state: promptPlanning, set: setPromptPlanning, key: 'yuki-prompt-planning' }
                ].map(mod => {
                  const inert = isCodingMode && mod.coderInert;
                  return (
                    <label key={mod.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.73rem', color: inert ? '#475569' : '#cbd5e1', cursor: inert ? 'not-allowed' : 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={mod.state}
                        disabled={inert}
                        onChange={(e) => {
                          mod.set(e.target.checked);
                          localStorage.setItem(mod.key, String(e.target.checked));
                        }}
                        style={{ accentColor: '#a78bfa' }}
                      />
                      {mod.label}{inert ? ' (ignored in Coding Mode)' : ''}
                    </label>
                  );
                })}
              </div>

              {/* Section 5: Dynamic API Payload & Prompt Inspector */}
              <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(167, 139, 250, 0.25)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '0.68rem', color: '#c4b5fd', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Code style={{ width: '13px', height: '13px' }} />
                    Live Full API Payload & Structure Inspector
                  </div>
                  <span style={{ fontSize: '0.60rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(167, 139, 250, 0.2)', color: '#c4b5fd', border: '1px solid rgba(167, 139, 250, 0.3)' }}>
                    Real-Time Structure
                  </span>
                </div>

                <div style={{
                  background: '#060911',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '6px',
                  padding: '10px',
                  fontSize: '0.67rem',
                  fontFamily: 'Consolas, Monaco, monospace',
                  color: '#cbd5e1',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  lineHeight: '1.45',
                  scrollbarWidth: 'thin'
                }}>
                  {generateDynamicPayloadPreview()}
                </div>
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
              padding: '4px 8px',
              gap: '4px'
            }}>
              <button
                type="button"
                onClick={() => setPrefTab('coder')}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  border: 'none',
                  borderRadius: '6px',
                  background: prefTab === 'coder' ? 'rgba(16, 185, 129, 0.25)' : 'transparent',
                  color: prefTab === 'coder' ? '#6ee7b7' : '#94a3b8',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px'
                }}
              >
                <Code style={{ width: '13px', height: '13px' }} /> Coder Engine
              </button>

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
                ⚙️ Overrides
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

            {/* Tab 0: Dedicated Coder Engine Configuration */}
            {prefTab === 'coder' && (
              <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '65vh', overflowY: 'auto' }}>
                <div style={{ background: 'rgba(16, 185, 129, 0.08)', borderRadius: '12px', padding: '14px', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#6ee7b7', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Code style={{ width: '15px', height: '15px' }} /> Dedicated Coder Mode Engine & Endpoint
                  </div>
                  <div style={{ fontSize: '0.70rem', color: 'rgba(255,255,255,0.65)', lineHeight: '1.4', marginBottom: '12px' }}>
                    Configure the custom LLM Provider, Base URL, API Key, and Model specifically used when Coder Mode is ON. Bypasses TTS voice audio and avatar animations for raw coding throughput.
                  </div>

                  {/* 1. Coder Mode LLM Backend Dropdown */}
                  <div>
                    <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#c4b5fd', display: 'block', marginBottom: '4px' }}>
                      Coder Mode LLM Backend:
                    </label>
                    <select
                      value={activeSettings.llm_coder_backend ?? ''}
                      onChange={async (e) => {
                        const newBackend = e.target.value;
                        const defaults = {
                          lmstudio: 'http://127.0.0.1:1234',
                          ollama: 'http://127.0.0.1:11434',
                          vllm: 'http://127.0.0.1:8000/v1',
                          custom: 'https://api.groq.com/openai/v1',
                        };
                        const updates = { llm_coder_backend: newBackend, llm_coder_model: '' };
                        if (defaults[newBackend]) updates.llm_coder_base_url = defaults[newBackend];
                        await handleUpdateSetting(updates);
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        background: 'rgba(9, 13, 22, 0.95)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '8px',
                        color: 'white',
                        fontSize: '0.78rem',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="">Same as Main/Complex Endpoint (Default)</option>
                      <option value="custom">Custom / Cloud API (OpenAI-Compatible)</option>
                      <option value="lmstudio">LM Studio (Local)</option>
                      <option value="ollama">Ollama (Local)</option>
                      <option value="vllm">vLLM (Local)</option>
                    </select>
                  </div>

                  {/* 2. Custom / Cloud API Vault & Presets Section */}
                  {(activeSettings.llm_coder_backend === 'custom' || activeSettings.llm_coder_backend === 'openai') && (
                    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>

                      {/* Saved Key Vault Dropdown + Trash Delete Button */}
                      {savedCustomEndpoints.length > 0 && (
                        <div style={{ marginBottom: '10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ color: '#c4b5fd', fontSize: '0.74rem', fontWeight: 600 }}>
                              🔑 Saved API Key Vault ({savedCustomEndpoints.length})
                            </span>
                            <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)' }}>
                              Select to load preset
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <select
                              value={selectedCoderEndpointId}
                              onChange={(e) => selectCoderPreset(e.target.value)}
                              style={{
                                flex: 1,
                                padding: '7px 10px',
                                background: 'rgba(18, 12, 33, 0.95)',
                                border: '1px solid rgba(167, 139, 250, 0.45)',
                                borderRadius: '8px',
                                color: '#ffffff',
                                fontSize: '0.78rem',
                                fontWeight: 500,
                                outline: 'none',
                                cursor: 'pointer'
                              }}
                            >
                              <option value="" style={{ background: '#120c21', color: '#94a3b8' }}>
                                -- Select Saved API Key Preset --
                              </option>
                              {savedCustomEndpoints.map((ep) => {
                                const isActive = activeSettings.llm_coder_base_url === ep.base_url;
                                return (
                                  <option key={ep.id} value={ep.id} style={{ background: '#120c21', color: '#ffffff' }}>
                                    {isActive ? '● ' : ''}{ep.label || 'Saved Endpoint'} ({ep.has_key ? '🔑 Key Saved' : 'No Key'})
                                  </option>
                                );
                              })}
                            </select>

                            <button
                              type="button"
                              title="Delete active preset from DB"
                              onClick={() => handleDeleteCoderEndpoint()}
                              style={{
                                padding: '7px 10px',
                                borderRadius: '8px',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#fca5a5',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.74rem'
                              }}
                            >
                              <Trash2 style={{ width: '13px', height: '13px' }} />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Quick Cloud Provider Presets */}
                      <div style={{ marginTop: '6px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.68rem', color: '#c4b5fd', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                          Quick Cloud Provider Presets:
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {[
                            { name: 'Groq', label: 'Groq Cloud API', url: 'https://api.groq.com/openai/v1', model: 'qwen2.5-coder-32b-instruct' },
                            { name: 'Gemini', label: 'Google Gemini Cloud', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-1.5-flash' },
                            { name: 'OpenAI', label: 'OpenAI Cloud API', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
                            { name: 'Grok', label: 'xAI Grok Cloud', url: 'https://api.x.ai/v1', model: 'grok-beta' },
                            { name: 'OpenRouter', label: 'OpenRouter Cloud API', url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
                            { name: 'Mistral', label: 'Mistral Cloud API', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
                            { name: 'DeepSeek', label: 'DeepSeek Cloud', url: 'https://api.deepseek.com/v1', model: 'deepseek-coder' }
                          ].map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              onClick={async () => {
                                setCoderCustomLabel(p.label);
                                const keyOk = activeSettings.llm_coder_api_key && !activeSettings.llm_coder_api_key.includes('...') && !activeSettings.llm_coder_api_key.includes('•••');
                                if (!keyOk) {
                                  alert(`${p.label} requires an API key. Enter your ${p.name} API key in the "Coder API Key Pool" field below, then click "Save Preset" before chatting.`);
                                }
                                const updates = {
                                  llm_coder_backend: 'custom',
                                  llm_coder_base_url: p.url
                                };
                                if (p.model && !activeSettings.llm_coder_model) {
                                  updates.llm_coder_model = p.model;
                                }
                                await handleUpdateSetting(updates);
                              }}
                              style={{
                                padding: '4px 8px',
                                fontSize: '0.66rem',
                                borderRadius: '6px',
                                background: activeSettings.llm_coder_base_url === p.url ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255, 255, 255, 0.05)',
                                border: activeSettings.llm_coder_base_url === p.url ? '1px solid #6ee7b7' : '1px solid rgba(255,255,255,0.1)',
                                color: activeSettings.llm_coder_base_url === p.url ? '#ffffff' : '#cbd5e1',
                                cursor: 'pointer',
                                fontWeight: 500
                              }}
                            >
                              ⚡ {p.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Preset Name / Label Input */}
                      <div style={{ marginTop: '8px' }}>
                        <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#c4b5fd', display: 'block', marginBottom: '3px' }}>
                          Preset Name / Label
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Groq Qwen Coder, Google Gemini Cloud, DeepSeek Coder"
                          value={coderCustomLabel}
                          onChange={(e) => setCoderCustomLabel(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            background: 'rgba(9, 13, 22, 0.95)',
                            border: '1px solid rgba(167, 139, 250, 0.3)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '0.78rem',
                            outline: 'none'
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* 3. LLM Backend URL Input */}
                  <div style={{ marginTop: '10px' }}>
                    <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#c4b5fd', display: 'block', marginBottom: '4px' }}>
                      {activeSettings.llm_coder_backend === 'lmstudio' ? 'LM Studio Coder URL' :
                        activeSettings.llm_coder_backend === 'ollama' ? 'Ollama Coder URL' :
                          activeSettings.llm_coder_backend === 'vllm' ? 'vLLM Coder URL' :
                            'Coder Base URL'}
                    </label>
                    <input
                      type="text"
                      value={activeSettings.llm_coder_base_url || ''}
                      onChange={(e) => handleUpdateSetting({ llm_coder_base_url: e.target.value })}
                      placeholder={
                        activeSettings.llm_coder_backend === 'lmstudio' ? 'http://127.0.0.1:1234' :
                          activeSettings.llm_coder_backend === 'ollama' ? 'http://127.0.0.1:11434' :
                            activeSettings.llm_coder_backend === 'vllm' ? 'http://127.0.0.1:8000/v1' :
                              'https://api.groq.com/openai/v1'
                      }
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        background: 'rgba(9, 13, 22, 0.95)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '8px',
                        color: 'white',
                        fontSize: '0.78rem',
                        outline: 'none'
                      }}
                    />
                  </div>

                  {/* 4. Multi-API Key Vault Pool (Scalable Key A, Key B, Key C...) */}
                  {(activeSettings.llm_coder_backend === 'custom' || activeSettings.llm_coder_backend === 'openai') && (() => {
                    const keyArray = draftCoderKeys.length > 0 ? draftCoderKeys : [''];

                    const updateKeyAtIndex = (idx, val) => {
                      setDraftCoderKeys(prev => {
                        const updated = [...prev];
                        updated[idx] = val;
                        return updated;
                      });
                    };

                    const addKeySlot = () => {
                      setDraftCoderKeys(prev => [...prev, '']);
                    };

                    const removeKeySlot = (idx) => {
                      setDraftCoderKeys(prev => {
                        const updated = prev.filter((_, i) => i !== idx);
                        return updated.length > 0 ? updated : [''];
                      });
                    };

                    return (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Key style={{ width: '12px', height: '12px', color: '#a78bfa' }} />
                            Coder API Key Pool ({keyArray.length} {keyArray.length === 1 ? 'Key' : 'Keys'} - Auto Rotated)
                          </label>
                          <button
                            type="button"
                            onClick={async () => {
                              const nextState = !showCoderKey;
                              setShowCoderKey(nextState);
                              if (nextState) {
                                try {
                                  const res = await fetch(`${API_BASE}/api/profile?decrypt_keys=true`);
                                  if (res.ok) {
                                    const data = await res.json();
                                    if (data.settings && data.settings.llm_coder_api_key) {
                                      const arr = data.settings.llm_coder_api_key.split(',').map(k => k.trim());
                                      setDraftCoderKeys(arr.length > 0 ? arr : ['']);
                                    }
                                  }
                                } catch (err) {
                                  console.warn('Failed to fetch decrypted key:', err);
                                }
                              }
                            }}
                            title={showCoderKey ? "Hide API Keys" : "Decrypt & Reveal Keys"}
                            style={{
                              padding: '2px 8px',
                              borderRadius: '6px',
                              background: showCoderKey ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                              border: showCoderKey ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.12)',
                              color: showCoderKey ? '#38bdf8' : '#cbd5e1',
                              fontSize: '0.68rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            {showCoderKey ? <EyeOff style={{ width: '11px', height: '11px' }} /> : <Eye style={{ width: '11px', height: '11px' }} />}
                            {showCoderKey ? 'Hide' : 'Reveal'}
                          </button>
                        </div>

                        {keyArray.map((kVal, kIdx) => {
                          const keyLabel = kIdx === 0 ? "Key A (Primary API Key)" : `Key ${String.fromCharCode(65 + kIdx)} (Optional Backup Key)`;
                          return (
                            <div key={kIdx} style={{ marginBottom: '8px' }}>
                              <span style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>
                                {keyLabel}
                              </span>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <input
                                  type={showCoderKey ? 'text' : 'password'}
                                  value={kVal}
                                  onChange={(e) => updateKeyAtIndex(kIdx, e.target.value)}
                                  placeholder={kIdx === 0 ? "Enter Primary API Key (e.g. AIzaSy...)" : `Enter Backup API Key ${String.fromCharCode(65 + kIdx)} (e.g. AIzaSy...)`}
                                  style={{
                                    flex: 1,
                                    padding: '7px 10px',
                                    background: 'rgba(9, 13, 22, 0.95)',
                                    border: '1px solid rgba(139, 92, 246, 0.25)',
                                    borderRadius: '8px',
                                    color: 'white',
                                    fontSize: '0.78rem',
                                    outline: 'none'
                                  }}
                                />
                                {kIdx > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => removeKeySlot(kIdx)}
                                    title="Remove this API Key from Pool"
                                    style={{
                                      padding: '7px 10px',
                                      borderRadius: '8px',
                                      background: 'rgba(239, 68, 68, 0.15)',
                                      border: '1px solid rgba(239, 68, 68, 0.3)',
                                      color: '#f87171',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center'
                                    }}
                                  >
                                    <Trash2 style={{ width: '13px', height: '13px' }} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          onClick={addKeySlot}
                          style={{
                            marginTop: '4px',
                            padding: '5px 10px',
                            borderRadius: '6px',
                            background: 'rgba(139, 92, 246, 0.15)',
                            border: '1px border-dashed rgba(139, 92, 246, 0.4)',
                            color: '#c4b5fd',
                            fontSize: '0.70rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}
                        >
                          <Plus style={{ width: '12px', height: '12px' }} /> Add API Key to Rotation Pool
                        </button>
                      </div>
                    );
                  })()}

                  {/* Save Preset Button (Rendered if Custom chosen) */}
                  {(activeSettings.llm_coder_backend === 'custom' || activeSettings.llm_coder_backend === 'openai') && (
                    <div style={{ marginTop: '10px' }}>
                      <button
                        type="button"
                        onClick={handleSaveCoderEndpoint}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          fontSize: '0.78rem',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          color: 'white',
                          fontWeight: '600',
                          border: 'none',
                          cursor: 'pointer',
                          boxShadow: '0 4px 12px rgba(16, 185, 129, 0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                      >
                        <Sparkles style={{ width: '14px', height: '14px' }} />
                        {saveCoderEndpointBtnText}
                      </button>
                    </div>
                  )}

                  {/* 5. Dynamic Task-Specialized Roles (Primary Coder, Reviewer, Synthesizer) */}
                  <div style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Sparkles style={{ width: '13px', height: '13px', color: '#34d399' }} />
                        Task-Specialized AI Model Routing
                      </label>
                      <button
                        type="button"
                        onClick={() => fetchCoderLlmModels()}
                        title="Refresh dynamic model list from backend endpoint"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#6ee7b7',
                          cursor: 'pointer',
                          padding: '2px 4px',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          fontWeight: 600
                        }}
                      >
                        <RefreshCw style={{ width: '11px', height: '11px' }} /> Refresh Models
                      </button>
                    </div>

                    {(() => {
                      const fetchedNames = (coderLlmModels || []).map(m => typeof m === 'string' ? m : (m.name || m.id || '')).filter(Boolean);
                      const allNames = Array.from(new Set([
                        ...(activeSettings.llm_coder_model ? [activeSettings.llm_coder_model] : []),
                        ...(activeSettings.llm_reviewer_model ? [activeSettings.llm_reviewer_model] : []),
                        ...(activeSettings.llm_summary_model ? [activeSettings.llm_summary_model] : []),
                        ...fetchedNames
                      ]));

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {/* Role 1: Primary Coder Model */}
                          <div style={{ background: 'rgba(9, 13, 22, 0.6)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(52, 211, 153, 0.25)' }}>
                            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#34d399', display: 'block', marginBottom: '4px' }}>
                              🛠️ 1. Primary Coder Model (Tool Calling & File Writing)
                            </label>
                            <SearchableModelSelect
                              value={activeSettings.llm_coder_model || ''}
                              onChange={(val) => handleUpdateSetting({ llm_coder_model: val })}
                              options={allNames}
                              placeholder="Search or select Coder model (e.g. gemini-3.5-flash-lite)..."
                            />
                          </div>

                          {/* Role 2: Code Reviewer & Bug Finder */}
                          <div style={{ background: 'rgba(9, 13, 22, 0.6)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(167, 139, 250, 0.25)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                🧠 2. Code Reviewer & Bug Finder Model
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.68rem', color: '#cbd5e1', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={activeSettings.llm_reviewer_enabled !== undefined ? activeSettings.llm_reviewer_enabled : true}
                                  onChange={(e) => handleUpdateSetting({ llm_reviewer_enabled: e.target.checked })}
                                />
                                Enable Review
                              </label>
                            </div>
                            <SearchableModelSelect
                              value={activeSettings.llm_reviewer_model || ''}
                              onChange={(val) => handleUpdateSetting({ llm_reviewer_model: val })}
                              options={allNames}
                              placeholder="Search or select Reviewer model (e.g. gemma-31b-thinking)..."
                            />
                          </div>

                          {/* Role 3: Response Synthesizer */}
                          <div style={{ background: 'rgba(9, 13, 22, 0.6)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#38bdf8', display: 'block', marginBottom: '4px' }}>
                              💬 3. Response Walkthrough Synthesizer
                            </label>
                            <SearchableModelSelect
                              value={activeSettings.llm_summary_model || ''}
                              onChange={(val) => handleUpdateSetting({ llm_summary_model: val })}
                              options={allNames}
                              placeholder="Search or select Synthesizer model (e.g. gemini-3.5-flash-lite)..."
                            />
                          </div>

                          {/* Role 4: Vision Scan & Analysis Model */}
                          <div style={{ background: 'rgba(9, 13, 22, 0.6)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#38bdf8', display: 'block', marginBottom: '2px' }}>
                              4. Vision Scan & Analysis Model (Tool Model)
                            </label>
                            <div style={{ fontSize: '0.66rem', color: '#94a3b8', marginBottom: '6px' }}>
                              Target model used by <code style={{ color: '#38bdf8' }}>jarvis_analyze_image</code> tool when non-vision models analyze screenshots & image files.
                            </div>
                            <SearchableModelSelect
                              value={activeSettings.llm_vision_model || ''}
                              onChange={(val) => handleUpdateSetting({ llm_vision_model: val })}
                              options={allNames}
                              placeholder="Search or select Vision Scan model..."
                            />
                          </div>

                          {/* Role 5: Image Generation Model */}
                          <div style={{ background: 'rgba(9, 13, 22, 0.6)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(236, 72, 153, 0.25)' }}>
                            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#ec4899', display: 'block', marginBottom: '2px' }}>
                              5. Image Generation Engine & Provider
                            </label>
                            <div style={{ fontSize: '0.66rem', color: '#94a3b8', marginBottom: '6px' }}>
                              Provider used by <code style={{ color: '#ec4899' }}>jarvis_generate_image</code> to render art, wallpapers, and anime.
                            </div>
                            <select
                              value={activeSettings.image_gen_provider || 'pollinations'}
                              onChange={(e) => handleUpdateSetting({ image_gen_provider: e.target.value })}
                              style={{ width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'white', fontSize: '0.74rem', outline: 'none', marginBottom: '6px' }}
                            >
                              <option value="pollinations" style={{ background: '#0b0813' }}>🌸 Free FLUX.1 Engine (Pollinations — Zero Config)</option>
                              <option value="huggingface" style={{ background: '#0b0813' }}>🤗 Hugging Face (FLUX.1-dev / SDXL)</option>
                              <option value="stable_horde" style={{ background: '#0b0813' }}>🐎 Stable Horde (Pony XL / Illustrious / Uncensored)</option>
                              <option value="custom" style={{ background: '#0b0813' }}>⚡ Configured LLM / OpenAI Image Endpoint</option>
                            </select>
                            {(activeSettings.image_gen_provider === 'custom') && (
                              <SearchableModelSelect
                                value={activeSettings.llm_image_gen_model || ''}
                                onChange={(val) => handleUpdateSetting({ llm_image_gen_model: val })}
                                options={allNames}
                                placeholder="Search or select Image Generation model..."
                              />
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Codegraph toggle */}
                <div style={{ background: 'rgba(9, 13, 22, 0.6)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(139, 92, 246, 0.25)' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={!!activeSettings.codegraph_coder_enabled}
                      onChange={(e) => handleUpdateSetting('codegraph_coder_enabled', e.target.checked)}
                      style={{ accentColor: '#8b5cf6', width: '13px', height: '13px', cursor: 'pointer', marginTop: '2px' }}
                    />
                    <span style={{ fontSize: '0.74rem', color: '#c4b5fd', lineHeight: 1.35, fontWeight: 600 }}>
                      Turn on codegraph for coder mode
                    </span>
                  </label>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '6px', lineHeight: 1.35, paddingLeft: '21px' }}>
                    Lets coder mode use codegraph to explore and navigate indexed codebases. <strong style={{ color: '#fbbf24' }}>Codegraph must be installed on your PC for this tool to work.</strong> (Default: OFF)
                  </div>
                </div>

                {/* Included Coder Tools (allowlist sent to coder mode) */}
                <div style={{ background: 'rgba(9, 13, 22, 0.6)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                  <div style={{ fontSize: '0.78rem', color: '#6ee7b7', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Wrench style={{ width: '13px', height: '13px' }} /> Included Coder Tools
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: '8px', lineHeight: 1.35 }}>
                    Tools sent to the coding LLM. Uncheck any tool to remove it from coder mode — its schema is not sent and its name is scrubbed from the coder system prompt. Deselection always wins; only the tools you check can be called. Codegraph tools are added automatically while codegraph is on. Note: only coder-capable tools can actually be sent.
                  </div>
                  {(() => {
                    const coderTools = (coderToolsList || []).map(t => t.name);
                    const included = Array.isArray(activeSettings.included_coder_tools) ? activeSettings.included_coder_tools : [];
                    if (coderTools.length === 0) {
                      return <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', padding: '8px 0' }}>Loading tools…</div>;
                    }
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', maxHeight: '240px', overflowY: 'auto' }}>
                        {coderTools.map(name => {
                          const checked = included.includes(name);
                          return (
                            <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.68rem', color: checked ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)', cursor: 'pointer', padding: '2px 0' }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = checked ? included.filter(t => t !== name) : [...included, name];
                                  handleUpdateSetting('included_coder_tools', next);
                                }}
                                style={{ accentColor: '#10b981', width: '12px', height: '12px', cursor: 'pointer' }}
                              />
                              <span style={{ fontFamily: 'monospace', textDecoration: checked ? 'none' : 'line-through' }}>{name}</span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

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
