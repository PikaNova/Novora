import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/fonts.css';
import './styles/design-fonts.css';
import './styles/motion-tokens.css';
import './styles/motion.css';
import './styles/schedule-print.css';
import './styles/notice.css';
import './styles/app-dialog.css';
import './styles/temporary-exam.css';
import './styles/subject-icons.css';
import './styles/brand.css';
import './styles/scrollbars.css';
import './styles/transitions.css';
import './styles/loading-state.css';
import { startTimeSyncManager } from './utils/timeSync';
import { registerPwa } from './services/pwa';
import { bindTypographySettings } from './utils/typographySettings';
import { bindMotionSettings } from './utils/motionSettings';
import { reportPerformance } from './services/telemetry';
import { installGlobalErrorReporting } from './services/errorReport';
import { installChunkLoadRecovery } from './utils/chunkLoadRecovery';
import { recordDiagnosticEvent, startDiagnosticTracking } from './utils/diagnostics';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SpeedInsights } from '@vercel/speed-insights/react';

// Global styles
const style = document.createElement('style');
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; }
  body { background: #0d0d0d; color: #f0f0f0; font-family: var(--font-region-content); }
  body.lock-scroll,
  body.preview-scroll-lock { overflow: hidden; }
  button { font-family: inherit; }
  input, textarea, select { font-family: inherit; }
`;
document.head.appendChild(style);

startTimeSyncManager();
bindTypographySettings();
bindMotionSettings();
installGlobalErrorReporting();
// 资源版本不一致（页面跨越了一次发布）导致的分包加载失败：刷新一次即可恢复。
installChunkLoadRecovery();
// 出错上报需要「出错前发生了什么」：登记路由/接口/同步/在线状态的事件序列。
startDiagnosticTracking();
recordDiagnosticEvent('app.start', `${__APP_VERSION__} · ${__COMMIT_SHA__}`);
// 仅生产环境注册 Service Worker：开发环境（vite dev）下残留的生产 SW 会拦截
// Vite 的模块请求、用旧缓存覆盖 dev 资源，导致 `npm run dev` 打开后白屏。
if (import.meta.env.PROD) {
  registerPwa();
} else if ('serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((rs) => rs.forEach((r) => r.unregister()))
    .catch(() => {});
}
window.addEventListener(
  'load',
  () =>
    window.setTimeout(() => {
      void reportPerformance();
    }, 0),
  { once: true },
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    {import.meta.env.VITE_SPEED_INSIGHTS !== 'false' && <SpeedInsights />}
  </React.StrictMode>,
);
