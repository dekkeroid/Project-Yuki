import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Caught:', error, errorInfo);
  }

  handleRestart = () => {
    window.electronAPI?.restartApp?.();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || 'Unknown error';
      const stack = this.state.errorInfo?.componentStack || '';

      return (
        <div style={{
          position: 'fixed', inset: 0,
          background: '#0a0612',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          zIndex: 99999,
        }}>
          <div style={{
            textAlign: 'center', maxWidth: 440, padding: '40px 32px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(168,85,247,0.15)',
            borderRadius: 16,
          }}>
            <div style={{
              fontSize: 28, fontWeight: 700,
              background: 'linear-gradient(135deg, #c084fc, #a855f7, #7c3aed)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              letterSpacing: 3, marginBottom: 16,
            }}>
              YUKI
            </div>
            <div style={{ fontSize: 15, color: '#f87171', marginBottom: 8 }}>
              Something went wrong
            </div>
            <div style={{
              fontSize: 12, color: 'rgba(255,255,255,0.35)',
              marginBottom: 20, lineHeight: 1.5, wordBreak: 'break-word',
            }}>
              {msg}
            </div>
            {stack && (
              <details style={{
                fontSize: 11, color: 'rgba(255,255,255,0.2)',
                textAlign: 'left', maxHeight: 120, overflow: 'auto',
                marginBottom: 20, whiteSpace: 'pre-wrap',
                background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 10,
              }}>
                {stack}
              </details>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={this.handleRestart}
                style={{
                  padding: '8px 24px',
                  background: 'rgba(168,85,247,0.15)',
                  border: '1px solid rgba(168,85,247,0.3)',
                  color: '#c084fc', borderRadius: 8, cursor: 'pointer',
                  fontSize: 13, letterSpacing: 0.5,
                }}
              >
                Restart
              </button>
              <button
                onClick={this.handleDismiss}
                style={{
                  padding: '8px 24px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.4)', borderRadius: 8, cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
