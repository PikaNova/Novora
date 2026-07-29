import React from 'react';
import { reportError } from '../services/errorReport';

interface ErrorBoundaryState {
  hasError: boolean;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void reportError({
      message: error.message || '页面渲染异常',
      errorName: error.name || 'ReactRenderError',
      stack: error.stack || info.componentStack || undefined,
      level: 'error',
      action: 'react-render',
    });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: '#0d0d0d',
          color: '#f0f0f0',
          fontFamily: 'inherit',
          textAlign: 'center',
          padding: 24,
          zIndex: 9999,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>页面出现异常</div>
        <div style={{ fontSize: 14, opacity: 0.75, maxWidth: 480 }}>
          页面遇到未预期的错误，本机数据不会丢失。点击下方按钮刷新页面即可恢复；如果反复出现，请联系管理员并说明当时的操作。
        </div>
        <button
          onClick={this.handleReload}
          style={{
            padding: '8px 20px',
            borderRadius: 8,
            border: '1px solid #444',
            background: '#1c1c1c',
            color: '#f0f0f0',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          刷新页面
        </button>
      </div>
    );
  }
}
