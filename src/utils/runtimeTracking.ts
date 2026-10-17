import { getRuntimeDisplaySnapshot } from './runtimeDisplayState.js';
import {
  journal,
  subscribeRuntimeEvents,
  captureRuntimeWindow,
  finishRuntimeWindows,
  flushRuntimeEvents,
  saveRuntimeRecovery,
  getRuntimeStorageState,
} from './runtimeJournal.js';
import { getAppSettings } from './appSettings';
import { getDiagnosticCaptureConfig } from './logger';
import { nowMs, isTimeSyncReady } from './timeSource';
import { sanitizeErrorReportText } from '../shared/errorReportContracts';

let started = false;
export function startRuntimeTracking(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const errors = new Map<string, { at: number; repeats: number }>();
  subscribeRuntimeEvents((row) => {
    const captureConfig = getDiagnosticCaptureConfig();
    if (row.level !== 'error' || !captureConfig.captureOnError) return;
    const key = `${row.code}:${row.message}`;
    const previous = errors.get(key);
    const mono = performance.now();
    if (previous && mono - previous.at < 60000) {
      previous.repeats += 1;
      return;
    }
    if (previous?.repeats)
      journal('page.error_repeated', { code: row.code, count: previous.repeats }, 'warn', 'page', '同类异常重复发生');
    errors.set(key, { at: mono, repeats: 0 });
    if (errors.size > 100) errors.delete(errors.keys().next().value!);
    const capture = captureRuntimeWindow(row.eventId, captureConfig.beforeSeconds, captureConfig.afterSeconds);
    journal(
      'page.error_window',
      { windowId: capture.id, errorEventId: capture.errorEventId, fromTs: capture.from, toTs: capture.to },
      'info',
      'page',
      '已保留异常前后日志窗口',
      row.operationId || row.eventId,
    );
  });
  journal(
    'page.start',
    {
      online: navigator.onLine,
      visible: document.visibilityState === 'visible',
      swActive: !!navigator.serviceWorker?.controller,
    },
    'info',
    'page',
    '页面启动',
  );
  window.addEventListener(
    'error',
    (event: Event) => {
      const error = event as ErrorEvent;
      const resource = event.target instanceof HTMLScriptElement || event.target instanceof HTMLLinkElement;
      journal(
        resource ? 'page.resource_failed' : 'page.js_error',
        { name: error.error?.name || 'Error', stack: sanitizeErrorReportText(error.error?.stack, 1000) || '' },
        'error',
        'page',
        error.message || '资源加载失败',
      );
    },
    true,
  );
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const aborted = reason?.name === 'AbortError';
    journal(
      'page.promise_rejected',
      { name: reason?.name || 'Rejection' },
      aborted ? 'warn' : 'error',
      'page',
      typeof reason === 'string' ? reason : reason?.message || '未处理的 Promise 拒绝',
    );
  });
  const flush = () => {
    finishRuntimeWindows();
    saveRuntimeRecovery();
    void flushRuntimeEvents().catch(() => undefined);
  };
  window.addEventListener('pagehide', flush);
  window.addEventListener('pageshow', (event) =>
    journal('page.resume', { persisted: event.persisted }, 'info', 'page', '页面恢复'),
  );
  document.addEventListener('visibilitychange', () => {
    journal('page.visibility', { visible: document.visibilityState === 'visible' }, 'info', 'page', '页面可见性变化');
    if (document.visibilityState === 'hidden') flush();
  });
  document.addEventListener('fullscreenchange', () =>
    journal('display.fullscreen', { active: !!document.fullscreenElement }, 'info', 'display', '全屏状态变化'),
  );
  window.addEventListener('pwa:update-ready', () => journal('pwa.update_ready', {}, 'info', 'pwa', '应用资源更新就绪'));
  navigator.serviceWorker?.addEventListener('controllerchange', () =>
    journal('pwa.controller_changed', {}, 'info', 'pwa', 'Service Worker 控制器变化'),
  );
  window.addEventListener('timeSync:updated', () => {
    const s = getAppSettings().general.timeSync;
    journal(
      'time.state',
      {
        source: s.provider,
        offsetMs: s.offsetMs,
        rttMs: s.lastRttMs || 0,
        ready: isTimeSyncReady(),
        calibratedAt: s.lastSyncServerAt || 0,
        revision: s.calibrationRevision || 0,
        manualOffsetMs: s.manualOffsetMs,
      },
      s.lastError ? 'warn' : 'info',
      'time',
      s.lastError || '校时状态更新',
    );
  });
  let lastMono = performance.now();
  let lastWall = Date.now();
  let lastDisplay = nowMs();
  let lastStorageState = '';
  setInterval(() => {
    const mono = performance.now();
    const wall = Date.now();
    const display = nowMs();
    const elapsed = mono - lastMono;
    if (elapsed > 90000)
      journal(
        'page.timer_gap',
        { gapMs: Math.round(elapsed), visible: document.visibilityState === 'visible' },
        'warn',
        'page',
        '计时回调长时间未运行，可能休眠或被节流',
      );
    if (Math.abs(wall - lastWall - elapsed) > 5000)
      journal(
        'time.system_jump',
        { deltaMs: Math.round(wall - lastWall - elapsed) },
        'warn',
        'time',
        '本机时钟与单调时间推进不一致',
      );
    if (Math.abs(display - lastDisplay - elapsed) > 5000)
      journal(
        'time.display_jump',
        { deltaMs: Math.round(display - lastDisplay - elapsed) },
        'warn',
        'time',
        '显示时间基准发生大幅变化',
      );
    const s = getAppSettings();
    const storageState = getRuntimeStorageState();
    if (storageState !== lastStorageState) {
      journal(
        'storage.state',
        { state: storageState },
        storageState === 'indexeddb' ? 'info' : 'warn',
        'storage',
        storageState === 'indexeddb' ? '日志本地存储正常' : '日志存储降级，保留能力受限',
      );
      lastStorageState = storageState;
    }
    journal(
      'page.health',
      {
        ...getRuntimeDisplaySnapshot(),
        online: navigator.onLine,
        visible: document.visibilityState === 'visible',
        swActive: !!navigator.serviceWorker?.controller,
        dataVersion: s.exam.updatedAt || 0,
        timeReady: isTimeSyncReady(),
        displayAt: display,
        width: innerWidth,
        height: innerHeight,
        fullScreen: !!document.fullscreenElement,
      },
      'info',
      'page',
      '运行状态快照',
    );
    lastMono = mono;
    lastWall = wall;
    lastDisplay = display;
  }, 60000);
}
