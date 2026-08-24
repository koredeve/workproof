import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI crash:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', background: '#0d1117', color: '#e6edf3',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif', padding: 24,
        }}>
          <div style={{ maxWidth: 560, border: '1px solid #f85149', borderRadius: 12, padding: 24 }}>
            <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
            <p style={{ color: '#8b949e' }}>
              The interface hit an unexpected error. Your funds are safe on-chain —
              this is only a display problem.
            </p>
            <pre style={{
              background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
              padding: 12, fontSize: 12, overflow: 'auto', whiteSpace: 'pre-wrap',
            }}>
              {String(this.state.error?.message ?? this.state.error)}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); }}
              style={{
                background: '#f78166', color: '#141414', border: 'none',
                borderRadius: 8, padding: '10px 18px', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
