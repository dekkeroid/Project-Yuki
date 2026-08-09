import React, { useMemo } from 'react';
import katex from 'katex';

/**
 * MathRenderer component for rendering KaTeX LaTeX math equations.
 * 
 * Props:
 * - math: string (the LaTeX math string to render, without delimiters)
 * - displayMode: boolean (true for block math, false for inline math)
 * - style: object (optional custom inline styles)
 * - className: string (optional custom CSS class)
 */
const MathRenderer = ({ math, displayMode = false, style = {}, className = '' }) => {
  const html = useMemo(() => {
    if (!math || typeof math !== 'string') return '';
    try {
      return katex.renderToString(math.trim(), {
        displayMode,
        throwOnError: false,
        output: 'htmlAndMathml',
        trust: true,
      });
    } catch (err) {
      console.warn('[KaTeX] Error rendering math:', math, err);
      return null;
    }
  }, [math, displayMode]);

  if (html === null || !html) {
    // Fallback if KaTeX rendering fails
    return (
      <code className={`katex-fallback ${className}`} style={{ fontFamily: 'monospace', color: '#38bdf8', ...style }}>
        {math}
      </code>
    );
  }

  if (displayMode) {
    return (
      <div
        className={`math-block-container ${className}`}
        style={{
          margin: '10px 0',
          padding: '8px 12px',
          overflowX: 'auto',
          maxWidth: '100%',
          borderRadius: '8px',
          background: 'rgba(15, 23, 42, 0.4)',
          border: '1px solid rgba(56, 189, 248, 0.15)',
          ...style
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <span
      className={`math-inline-container ${className}`}
      style={{
        display: 'inline-block',
        padding: '0 2px',
        verticalAlign: 'middle',
        ...style
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default React.memo(MathRenderer);
