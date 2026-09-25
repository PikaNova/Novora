import React from 'react';
import { reportError } from '../services/errorReport';
import { isChunkLoadError } from '../shared/chunkLoadError';
import { hardReloadWithCacheClear, recoverFromChunkLoadError } from '../utils/chunkLoadRecovery';

interface ErrorBoundaryState {
  error: Error | null;
  recovering: boolean;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, recovering: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const chunkError = isChunkLoadError(error);
    void reportError({
      message: error.message || '页面渲染异常',
      errorName: error.name || 'ReactRenderError',
      stack: error.stack || info.componentStack || undefined,
      level: 'error',
      action: 'react-render',
      context: chunkError ? { source: 'chunk-load', operation: 'load-page-chunk' } : undefined,
    });
    // 分包加载失败通常是「页面停留期间发生了发布」，刷新一次就能拿到新版本资源，
    // 不必把「页面出现异常」甩给用户；冷却期内重复失败才展示错误页。
    if (chunkError && recoverFromChunkLoadError(error)) this.setState({ recovering: true });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleHardReload = (): void => {
    void hardReloadWithCacheClear();
  };

  render(): React.ReactNode {
    const { error, recovering } = this.state;
    if (!error) return this.props.children;
    const chunkError = isChunkLoadError(error);
    if (recovering) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0d0d0d',
            color: '#f0f0f0',
            fontSize: 14,
            opacity: 0.8,
          }}
        >
          正在更新到最新版本…
        </div>
      );
    }
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
          {chunkError
            ? '页面加载的版本与服务器上的最新版本不一致（通常是更新期间页面没有刷新）。本机数据不会丢失，刷新页面即可恢复。'
            : '页面遇到未预期的错误，本机数据不会丢失。点击下方按钮刷新页面即可恢复；如果反复出现，请联系管理员并说明当时的操作。'}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
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
          {chunkError && (
            <button
              onClick={this.handleHardReload}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: '1px solid #444',
                background: 'transparent',
                color: '#f0f0f0',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              清理缓存并刷新
            </button>
          )}
        </div>
      </div>
    );
  }
}
