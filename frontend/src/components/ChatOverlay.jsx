import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Send, Mic, MicOff, RefreshCw, MessageSquare, X, Terminal, Cpu, Sparkles } from 'lucide-react';
import { ANIMATIONS } from '../animationsRegistry';

// ─── Slash Command Registry ───────────────────────────────────────────────────
const STATIC_COMMANDS = [
  { cmd: '/pcstat',       description: 'Show live PC stats (CPU, RAM, GPU...)' },
  { cmd: '/open',         description: 'Search and open any file' },
  { cmd: '/play',         description: 'Search and play a video or song' },
  { cmd: '/wink',         description: 'Yuki winks at you' },
  { cmd: '/angry',        description: 'Yuki pouts angrily' },
  { cmd: '/sad',          description: 'Yuki sighs sadly' },
  { cmd: '/surprised',    description: 'Yuki looks surprised' },
  { cmd: '/relaxed',      description: 'Yuki smiles relaxedly' },
  { cmd: '/neutral',      description: 'Reset expression to neutral' },
];

export const SLASH_COMMANDS = [
  ...STATIC_COMMANDS,
  ...ANIMATIONS.flatMap((anim) =>
    anim.commands.map((c) => ({
      cmd: c.cmd,
      description: c.description,
      animName: anim.name
    }))
  )
];

const formatMessageText = (text) => {
  if (!text) return '';
  if (typeof text !== 'string') return text;
  
  // Match delimiters: **, __, *, _, `
  const regex = /(\*\*|__|\*|_|`)([\s\S]*?)\1/g;
  
  const parts = [];
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    const delimiter = match[1];
    const innerText = match[2];
    
    // Add text preceding the match
    if (matchIndex > lastIndex) {
      parts.push(text.substring(lastIndex, matchIndex));
    }
    
    // Format based on delimiter
    if (delimiter === '`') {
      parts.push(
        <code 
          key={matchIndex} 
          style={{ 
            fontFamily: 'Consolas, Monaco, "Andale Mono", monospace',
            fontSize: '0.85em',
            background: 'rgba(255, 255, 255, 0.12)',
            padding: '2px 6px',
            borderRadius: '4px',
            color: '#2dd4bf',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            margin: '0 2px'
          }}
        >
          {innerText}
        </code>
      );
    } else {
      parts.push(
        <strong 
          key={matchIndex} 
          style={{ 
            fontWeight: '800', 
            color: '#ffffff',
            textShadow: '0 0 8px rgba(255, 255, 255, 0.2)'
          }}
        >
          {innerText}
        </strong>
      );
    }
    
    lastIndex = regex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  
  return parts.length > 0 ? parts : text;
};

const ChatOverlay = ({
  messages,
  inputText,
  setInputText,
  onSubmit,
  isListening,
  isTalkMode,
  toggleListening,
  onReset,
  isThinking,
  currentSpeechText,
  isPanelOpen,
  setIsPanelOpen,
  muteVoice,
  setMuteVoice,
  disabledAnimations = []
}) => {
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // ── Slash-command autocomplete state ──────────────────────────────────────
  const [activeSuggIdx, setActiveSuggIdx] = useState(-1);

  const suggestions = useMemo(() => {
    if (!inputText.startsWith('/')) return [];
    const q = inputText.toLowerCase();
    return SLASH_COMMANDS.filter(({ cmd, animName }) => {
      if (animName && disabledAnimations.includes(animName)) return false;
      return cmd.startsWith(q);
    });
  }, [inputText, disabledAnimations]);

  const showSugg = suggestions.length > 0;

  // Reset highlighted index whenever the list changes
  useEffect(() => {
    setActiveSuggIdx(-1);
  }, [suggestions.length]);

  const pickSuggestion = (cmd) => {
    setInputText(cmd + ' ');
    setActiveSuggIdx(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (!showSugg) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab' || (e.key === 'Enter' && activeSuggIdx >= 0)) {
      e.preventDefault();
      pickSuggestion(suggestions[activeSuggIdx].cmd);
    } else if (e.key === 'Escape') {
      setInputText('');
    }
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isThinking]);

  return (
    <div className="chat-overlay-container">
      
      {/* Floating Dialog Bubble (hovers near character, visible when she speaks) */}
      {currentSpeechText && (
        <div className="speech-bubble-floating glass-panel animate-fade-in">
          {/* Arrow pointing at character */}
          <div className="bubble-arrow"></div>
          
          <span className="bubble-tag">Yuki</span>
          <p className="bubble-text">{formatMessageText(currentSpeechText)}</p>
        </div>
      )}

      {/* Floating Thinking indicator */}
      {isThinking && !currentSpeechText && (
        <div className="thinking-floating glass-panel">
          <Cpu className="w-4 h-4 animate-spin" />
          <span>Yuki is reasoning...</span>
        </div>
      )}

      {/* Left Bottom Trigger for Panel */}
      <div className="panel-trigger-bottom">
        <button
          onClick={() => setIsPanelOpen(!isPanelOpen)}
          className={`panel-trigger-button glass-panel ${isPanelOpen ? 'active' : ''}`}
          title="Toggle Chat Log"
        >
          <MessageSquare className="w-5 h-5" />
        </button>

        <button
          onClick={onReset}
          className="panel-trigger-button reset glass-panel"
          title="Clear History"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Slide-out Sidebar Panel for logs/chat history */}
      <div
        className="slide-panel-right glass-panel"
        style={{
          transform: isPanelOpen ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          opacity: isPanelOpen ? 1 : 0
        }}
      >
        {/* Panel Header */}
        <div className="panel-header">
          <div className="panel-title-wrapper">
            <Terminal className="w-4.5 h-4.5 text-violet-400" />
            <h3 className="panel-title">Neural Conversation Log</h3>
          </div>
          <button
            onClick={() => setIsPanelOpen(false)}
            className="panel-close-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message Log Scroll Container */}
        <div className="chat-scroll-area">
          {messages.length === 0 && (
            <div className="chat-empty-state">
              <MessageSquare className="w-8 h-8 opacity-25" style={{ color: 'var(--text-muted)' }} />
              <p className="font-semibold text-sm">No records in connection buffer.</p>
              <p className="text-xs opacity-75">Say "Hello" or ask Yuki to do something!</p>
            </div>
          )}

          {messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            const isSystem = msg.role === 'system';
            
            return (
              <div
                key={index}
                className={`chat-bubble-wrapper ${isUser ? 'user' : 'assistant'} ${isSystem ? 'system' : ''}`}
              >
                {/* Sender badge + model flag */}
                {!isSystem && (() => {
                  const badgeStyles = {
                    gemini: {
                      background: 'linear-gradient(90deg, #7c3aed, #4f46e5)',
                      color: '#e0d7ff',
                      boxShadow: '0 0 8px rgba(124,58,237,0.4)',
                      label: 'Gemini',
                    },
                    qwen: {
                      background: 'linear-gradient(90deg, #0e7490, #0891b2)',
                      color: '#cffafe',
                      boxShadow: '0 0 8px rgba(8,145,178,0.4)',
                      label: 'Qwen',
                    },
                    gemma: {
                      background: 'linear-gradient(90deg, #166534, #15803d)',
                      color: '#dcfce7',
                      boxShadow: '0 0 8px rgba(21,128,61,0.4)',
                      label: 'Gemma',
                    },
                    nemotron: {
                      background: 'linear-gradient(90deg, #76b900, #388e3c)',
                      color: '#e8f5e9',
                      boxShadow: '0 0 8px rgba(118,185,0,0.4)',
                      label: 'Nemotron',
                    },
                  };
                  const badge = !isUser && msg.backend ? badgeStyles[msg.backend] : null;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="bubble-sender-title">
                        {isUser ? 'Master' : 'Yuki'}
                      </span>
                      {badge && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          fontSize: '10px',
                          fontWeight: '600',
                          padding: '1px 7px',
                          borderRadius: '999px',
                          background: badge.background,
                          color: badge.color,
                          letterSpacing: '0.03em',
                          boxShadow: badge.boxShadow,
                        }}>
                          <Sparkles style={{ width: '9px', height: '9px' }} />
                          {badge.label}
                        </span>
                      )}
                      {!isUser && msg.responseTime !== undefined && (
                        <span style={{
                          fontSize: '9px',
                          color: '#94a3b8',
                          marginLeft: '2px',
                          opacity: 0.85,
                          fontFamily: 'monospace'
                        }}>
                          {msg.responseTime}s
                        </span>
                      )}
                    </div>
                  );
                })()}

                {/* Speech Bubble */}
                <div
                  className={`bubble-content-block ${
                    isSystem ? 'system' : isUser ? 'user' : 'assistant'
                  }`}
                >
                  <p style={{ margin: 0, whiteSpace: 'pre-line' }}>
                    {isSystem && <span style={{ color: 'var(--accent-teal)', fontWeight: 'bold', marginRight: '6px' }}>[TOOL]</span>}
                    {formatMessageText(msg.content)}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Thinking Status inside log */}
          {isThinking && (
            <div className="chat-bubble-wrapper assistant">
              <span className="bubble-sender-title">Yuki</span>
              <div className="bubble-content-block assistant thinking-bubble">
                <span className="thinking-dot" style={{ animationDelay: '0ms' }}></span>
                <span className="thinking-dot" style={{ animationDelay: '150ms' }}></span>
                <span className="thinking-dot" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <div style={{ position: 'relative' }}>
          {/* Slash Command Suggestion Dropdown */}
          {showSugg && (
            <div
              ref={dropdownRef}
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: '6px',
                background: 'rgba(15, 10, 30, 0.96)',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                borderRadius: '10px',
                boxShadow: '0 -8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(139,92,246,0.1)',
                backdropFilter: 'blur(20px)',
                overflow: 'hidden',
                zIndex: 999,
                maxHeight: '260px',
                overflowY: 'auto',
              }}
            >
              {/* Header */}
              <div style={{
                padding: '6px 12px 4px',
                fontSize: '9px',
                fontWeight: '700',
                letterSpacing: '0.1em',
                color: 'rgba(139,92,246,0.7)',
                textTransform: 'uppercase',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                Commands
              </div>
              {suggestions.map(({ cmd, description }, idx) => (
                <div
                  key={cmd}
                  onMouseDown={(e) => { e.preventDefault(); pickSuggestion(cmd); }}
                  onMouseEnter={() => setActiveSuggIdx(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '7px 12px',
                    cursor: 'pointer',
                    background: activeSuggIdx === idx
                      ? 'rgba(139, 92, 246, 0.18)'
                      : 'transparent',
                    borderLeft: activeSuggIdx === idx
                      ? '2px solid rgba(139,92,246,0.8)'
                      : '2px solid transparent',
                    transition: 'background 0.1s, border-color 0.1s',
                  }}
                >
                  <span style={{
                    fontFamily: 'Consolas, monospace',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: activeSuggIdx === idx ? '#c4b5fd' : '#a78bfa',
                    minWidth: '130px',
                    flexShrink: 0,
                  }}>
                    {cmd}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    color: 'rgba(200, 200, 220, 0.55)',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}>
                    {description}
                  </span>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={onSubmit} className="input-form-row">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command or message..."
              className="glass-input"
            />
            <button type="submit" className="glass-button">
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Floating Bottom Center Audio Control Bar */}
      <div className="audio-control-hub glass-panel">
        <button
          onClick={toggleListening}
          className={`listen-toggle-btn ${
            isTalkMode ? (isListening ? 'active' : 'active talk-waiting') : ''
          }`}
          title={isTalkMode ? 'Click to exit Talk Mode' : 'Click to enter Talk Mode'}
        >
          {isTalkMode ? (
            isListening ? (
              <>
                <Mic className="w-4 h-4 text-teal-400" style={{ animation: 'pulse 1s infinite' }} />
                <span>Listening...</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 text-amber-400" />
                <span>Talk Mode — Yuki speaking</span>
              </>
            )
          ) : (
            <>
              <MicOff className="w-4 h-4" />
              <span>Talk Mode</span>
            </>
          )}
        </button>

        <div className="divider-vertical"></div>

        <button
          onClick={() => setMuteVoice(!muteVoice)}
          className={`audio-mute-btn ${muteVoice ? 'muted' : ''}`}
          title={muteVoice ? 'Unmute Voice output' : 'Mute Voice output'}
        >
          {muteVoice ? 'Muted' : 'Voice On'}
        </button>
      </div>

    </div>
  );
};

export default ChatOverlay;
