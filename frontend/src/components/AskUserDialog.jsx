import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Check, X, CornerDownLeft, Code2, HelpCircle, Edit3, ShieldAlert } from 'lucide-react';

/**
 * AskUserDialog — Premium UI dialog for the `ask_user` tool in Project Yuki.
 *
 * Rendered when the backend broadcasts a `{ type: "ask_user", ask_id, questions }`
 * WebSocket event. Allows single/multi-choice selections, custom write-in answers,
 * and keyboard navigation (Enter/Escape).
 */
const AskUserDialog = ({ askData, onSubmit, onClose }) => {
  const [answers, setAnswers] = useState({});
  const [otherText, setOtherText] = useState({});

  // Pre-select the recommended option (or the first option) for each question
  useEffect(() => {
    if (!askData?.questions) return;
    const initial = {};
    askData.questions.forEach((q) => {
      if (q.multi) {
        const rec = typeof q.recommended === 'number' && q.recommended >= 0 && q.recommended < q.options.length
          ? [q.options[q.recommended].label]
          : [q.options[0].label];
        initial[q.id] = rec;
      } else {
        const rec = typeof q.recommended === 'number' && q.recommended >= 0 && q.recommended < q.options.length
          ? q.options[q.recommended].label
          : q.options[0].label;
        initial[q.id] = rec;
      }
    });
    setAnswers(initial);
    setOtherText({});
  }, [askData]);

  const handleSelect = useCallback((qId, label, multi) => {
    setAnswers((prev) => {
      if (multi) {
        const current = Array.isArray(prev[qId]) ? prev[qId] : [];
        if (current.includes(label)) {
          return { ...prev, [qId]: current.filter((l) => l !== label) };
        }
        return { ...prev, [qId]: [...current, label] };
      }
      return { ...prev, [qId]: label };
    });
    // Clear "other" text when selecting a real option
    setOtherText((prev) => ({ ...prev, [qId]: '' }));
  }, []);

  const handleOther = useCallback((qId, text) => {
    setOtherText((prev) => ({ ...prev, [qId]: text }));
    setAnswers((prev) => ({ ...prev, [qId]: text }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!askData) return;
    onSubmit(askData.ask_id, answers);
  }, [askData, answers, onSubmit]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [handleSubmit, onClose]);

  useEffect(() => {
    if (askData) {
      window.yukiAskUserOpen = true;
      if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
        window.electronAPI.setIgnoreMouseEvents(false);
      }
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.yukiAskUserOpen = false;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [askData, handleKeyDown]);

  if (!askData?.questions) return null;

  return (
    <div
      className="ask-user-dialog-overlay interactive-element"
      onMouseEnter={() => {
        if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
          window.electronAPI.setIgnoreMouseEvents(false);
        }
      }}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(6, 4, 15, 0.82)',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        pointerEvents: 'auto',
        WebkitAppRegion: 'no-drag',
        padding: '12px',
        boxSizing: 'border-box',
        animation: 'fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        className="interactive-element"
        onMouseEnter={() => {
          if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
            window.electronAPI.setIgnoreMouseEvents(false);
          }
        }}
        style={{
          background: 'linear-gradient(150deg, rgba(26, 18, 44, 0.96) 0%, rgba(13, 9, 24, 0.98) 100%)',
          color: '#f8fafc',
          borderRadius: '16px',
          padding: '16px 18px',
          maxWidth: '430px',
          width: '100%',
          maxHeight: 'min(92vh, 540px)',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          boxShadow: '0 20px 50px -10px rgba(0, 0, 0, 0.85), 0 0 35px -5px rgba(139, 92, 246, 0.3)',
          border: '1px solid rgba(167, 139, 250, 0.3)',
          pointerEvents: 'auto',
          WebkitAppRegion: 'no-drag',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {/* Header Bar - Fixed top */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: '12px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(99, 102, 241, 0.2) 100%)',
                border: '1px solid rgba(167, 139, 250, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 10px rgba(139, 92, 246, 0.3)',
                flexShrink: 0,
              }}
            >
              <Sparkles size={16} style={{ color: '#c084fc' }} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, letterSpacing: '-0.01em', color: '#ffffff', lineHeight: 1.2 }}>
                Decision Required
              </h2>
              <p style={{ margin: '1px 0 0', fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.2 }}>
                Yuki needs your choice to continue
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '7px',
              color: '#94a3b8',
              cursor: 'pointer',
              width: '26px',
              height: '26px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
              e.currentTarget.style.color = '#f87171';
              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.color = '#94a3b8';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }}
            title="Dismiss (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* Questions Body - Scrollable center */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflowY: 'auto',
          flex: 1,
          minHeight: 0,
          padding: '12px 2px 12px 0',
          marginRight: '-4px',
          paddingRight: '4px',
        }}>
          {askData.questions.map((q, qi) => (
            <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                {askData.questions.length > 1 && (
                  <span
                    style={{
                      background: 'rgba(139, 92, 246, 0.2)',
                      color: '#c084fc',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '5px',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  >
                    Q{qi + 1}
                  </span>
                )}
                <span style={{ fontWeight: 600, fontSize: '0.86rem', color: '#f1f5f9', lineHeight: 1.35 }}>
                  {q.question}
                </span>
                {q.multi && (
                  <span style={{ fontSize: '0.7rem', color: '#818cf8', fontWeight: 500, flexShrink: 0 }}>
                    (Multi)
                  </span>
                )}
              </div>

              {/* Options List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {q.options?.map((opt, oi) => {
                  const isSelected = q.multi
                    ? Array.isArray(answers[q.id]) && answers[q.id].includes(opt.label)
                    : answers[q.id] === opt.label;
                  const isOther = otherText[q.id] && answers[q.id] === otherText[q.id];
                  const isRecommended = oi === q.recommended;

                  return (
                    <div
                      key={oi}
                      onClick={() => handleSelect(q.id, opt.label, q.multi)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        padding: '8px 10px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        background: isSelected && !isOther
                          ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.24) 0%, rgba(99, 102, 241, 0.16) 100%)'
                          : 'rgba(255, 255, 255, 0.03)',
                        border: isSelected && !isOther
                          ? '1.5px solid rgba(167, 139, 250, 0.7)'
                          : '1px solid rgba(255, 255, 255, 0.07)',
                        boxShadow: isSelected && !isOther
                          ? '0 0 16px rgba(139, 92, 246, 0.25), inset 0 0 10px rgba(139, 92, 246, 0.08)'
                          : 'none',
                        transition: 'all 0.15s ease-in-out',
                      }}
                      onMouseOver={(e) => {
                        if (!isSelected || isOther) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)';
                        }
                      }}
                      onMouseOut={(e) => {
                        if (!isSelected || isOther) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.07)';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {/* Custom Radio / Checkbox Indicator */}
                          <div
                            style={{
                              width: '15px',
                              height: '15px',
                              borderRadius: q.multi ? '4px' : '50%',
                              border: isSelected && !isOther
                                ? '1.5px solid #a78bfa'
                                : '1.5px solid rgba(255, 255, 255, 0.3)',
                              background: isSelected && !isOther ? '#8b5cf6' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {isSelected && !isOther && (
                              q.multi
                                ? <Check size={10} color="#ffffff" strokeWidth={3} />
                                : <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#ffffff' }} />
                            )}
                          </div>

                          <span style={{ fontWeight: 600, fontSize: '0.82rem', color: isSelected && !isOther ? '#ffffff' : '#e2e8f0', lineHeight: 1.25 }}>
                            {opt.label}
                          </span>
                        </div>

                        {isRecommended && (
                          <span
                            style={{
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              padding: '1px 6px',
                              borderRadius: '10px',
                              background: 'rgba(139, 92, 246, 0.25)',
                              color: '#c084fc',
                              border: '1px solid rgba(167, 139, 250, 0.4)',
                              flexShrink: 0,
                            }}
                          >
                            Recommended
                          </span>
                        )}
                      </div>

                      {opt.description && (
                        <div style={{ fontSize: '0.73rem', color: '#94a3b8', paddingLeft: '23px', lineHeight: 1.35 }}>
                          {opt.description}
                        </div>
                      )}

                      {opt.preview && (
                        <div style={{ paddingLeft: '23px', marginTop: '3px' }}>
                          <pre
                            style={{
                              fontSize: '0.68rem',
                              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                              background: 'rgba(0, 0, 0, 0.45)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              padding: '6px 8px',
                              borderRadius: '5px',
                              color: '#a5b4fc',
                              overflowX: 'auto',
                              whiteSpace: 'pre-wrap',
                              margin: 0,
                            }}
                          >
                            {opt.preview}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Custom Write-In Option */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: otherText[q.id] ? 'rgba(139, 92, 246, 0.12)' : 'rgba(0, 0, 0, 0.3)',
                  border: otherText[q.id] ? '1px solid rgba(167, 139, 250, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  padding: '2px 10px',
                  transition: 'all 0.15s ease',
                }}
              >
                <Edit3 size={13} style={{ color: otherText[q.id] ? '#c084fc' : '#64748b', flexShrink: 0 }} />
                <input
                  type="text"
                  placeholder="Other (type custom answer)..."
                  value={otherText[q.id] || ''}
                  onChange={(e) => handleOther(q.id, e.target.value)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    padding: '6px 0',
                    color: '#f8fafc',
                    fontSize: '0.78rem',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Footer Actions - Fixed bottom */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            paddingTop: '12px',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: '0.68rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span><b style={{ color: '#94a3b8' }}>↵ Enter</b> submit</span>
            <span>•</span>
            <span><b style={{ color: '#94a3b8' }}>Esc</b></span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#cbd5e1',
                fontWeight: 600,
                fontSize: '0.78rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              }}
            >
              Dismiss
            </button>

            <button
              onClick={handleSubmit}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '0.78rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 3px 12px rgba(139, 92, 246, 0.4)',
                transition: 'all 0.15s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 5px 16px rgba(139, 92, 246, 0.55)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = '0 3px 12px rgba(139, 92, 246, 0.4)';
              }}
            >
              <span>Submit</span>
              <CornerDownLeft size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AskUserDialog;


