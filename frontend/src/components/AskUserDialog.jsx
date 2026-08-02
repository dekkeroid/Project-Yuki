import React, { useState, useEffect, useCallback } from 'react';

/**
 * AskUserDialog — MVP functional dialog for the `ask_user` tool.
 *
 * Rendered when the backend broadcasts a `{ type: "ask_user", ask_id, questions }`
 * WebSocket event.  The user selects options (or types a free-text "Other"
 * answer) and the dialog POSTs the answers to
 * `POST /api/ask_user/{ask_id}/answer`.
 *
 * This is a deliberately unstyled-but-functional MVP.  Visual polish is left
 * to the maintainer.
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
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [askData, handleKeyDown]);

  if (!askData?.questions) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
      }}
    >
      <div
        style={{
          background: '#1e1e2e',
          color: '#cdd6f4',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '640px',
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
          fontFamily: 'system-ui, sans-serif',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            Yuki needs your input
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#9399b2',
              cursor: 'pointer', fontSize: '20px', padding: '0 4px',
            }}
            title="Dismiss (the agent will time out and use the recommended option)"
          >
            ✕
          </button>
        </div>

        {askData.questions.map((q, qi) => (
          <div key={q.id} style={{ marginBottom: '20px' }}>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>
              {qi + 1}. {q.question}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {q.options?.map((opt, oi) => {
                const isSelected = q.multi
                  ? Array.isArray(answers[q.id]) && answers[q.id].includes(opt.label)
                  : answers[q.id] === opt.label;
                const isOther = otherText[q.id] && answers[q.id] === otherText[q.id];
                return (
                  <label
                    key={oi}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(137,180,250,0.15)' : 'transparent',
                      border: isSelected ? '1px solid rgba(137,180,250,0.4)' : '1px solid transparent',
                    }}
                  >
                    <input
                      type={q.multi ? 'checkbox' : 'radio'}
                      name={`ask-${q.id}`}
                      checked={isSelected && !isOther}
                      onChange={() => handleSelect(q.id, opt.label, q.multi)}
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <div style={{ fontWeight: 500 }}>{opt.label}</div>
                      {opt.description && (
                        <div style={{ fontSize: '13px', color: '#9399b2', marginTop: '2px' }}>
                          {opt.description}
                        </div>
                      )}
                      {opt.preview && (
                        <pre style={{
                          fontSize: '12px', background: 'rgba(0,0,0,0.3)',
                          padding: '6px', borderRadius: '4px', marginTop: '4px',
                          overflowX: 'auto', whiteSpace: 'pre-wrap',
                        }}>
                          {opt.preview}
                        </pre>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            {/* "Other" free-text fallback */}
            <div style={{ marginTop: '6px' }}>
              <input
                type="text"
                placeholder="Other (type a custom answer)…"
                value={otherText[q.id] || ''}
                onChange={(e) => handleOther(q.id, e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #45475a',
                  background: '#181825',
                  color: '#cdd6f4',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
          <button
            onClick={handleSubmit}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: '#89b4fa',
              color: '#1e1e2e',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Submit (Enter)
          </button>
        </div>
      </div>
    </div>
  );
};

export default AskUserDialog;
