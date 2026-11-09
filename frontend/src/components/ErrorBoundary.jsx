import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', maxWidth: 500, margin: '60px auto', background: '#fff', borderRadius: 16, border: '1px solid #fee2e2', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fef2f2', color: '#dc2626', display: 'grid', placeItems: 'center', margin: '0 auto 16px', fontSize: 24, fontWeight: 'bold' }}>!</div>
          <h2 style={{ fontSize: 20, color: '#0f172a', marginBottom: 8 }}>Kuch ghalat ho gaya</h2>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
            {this.state.error?.message || 'Page load karne mein masla aaya hai.'}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              style={{ padding: '8px 18px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
            >
              Reload Page
            </button>
            <a
              href="/app"
              style={{ padding: '8px 18px', background: '#f1f5f9', color: '#334155', borderRadius: 8, textDecoration: 'none', fontWeight: 600, display: 'inline-block' }}
            >
              Dashboard
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

