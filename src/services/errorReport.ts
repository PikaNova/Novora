import { getAppSettings } from '../utils/appSettings';
import { APP_VERSION, getInstanceId, isEnabled } from './telemetry';

export type ErrorReportLevel = 'error' | 'warning' | 'info';

export interface ErrorReportInput {
  message: string;
  errorName?: string;
  stack?: string;
  level?: ErrorReportLevel;
  route?: string;
  action?: string;
  apiEndpoint?: string;
  httpStatus?: number;
  context?: Record<string, unknown>;
}

const SENSITIVE_KEYS = /password|secret|token|cookie|recoveryKey|deployHook/i;
const recentFingerprints = new Map<string, number>();
const DEDUPE_WINDOW_MS = 60_000;

function sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | null {
  if (!context) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEYS.test(key)) continue;
    if (value == null) continue;
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function fingerprintOf(input: ErrorReportInput): string {
  const base = `${input.errorName || ''}|${input.message}|${input.route || ''}|${input.apiEndpoint || ''}`;
  let hash = 0;
  for (let index = 0; index < base.length; index += 1) {
    hash = (hash * 31 + base.charCodeAt(index)) | 0;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

function shouldSkipDuplicate(fingerprint: string): boolean {
  const now = Date.now();
  const last = recentFingerprints.get(fingerprint);
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  recentFingerprints.set(fingerprint, now);
  if (recentFingerprints.size > 200) {
    const cutoff = now - DEDUPE_WINDOW_MS;
    for (const [key, time] of recentFingerprints) {
      if (time < cutoff) recentFingerprints.delete(key);
    }
  }
  return false;
}

export async function reportError(input: ErrorReportInput): Promise<void> {
  if (!isEnabled()) return;
  if (!input?.message) return;

  const fingerprint = fingerprintOf(input);
  if (shouldSkipDuplicate(fingerprint)) return;

  try {
    const settings = getAppSettings();
    const body = {
      instanceId: getInstanceId(),
      message: String(input.message).slice(0, 2000),
      errorName: input.errorName || null,
      stack: input.stack ? String(input.stack).slice(0, 8000) : null,
      fingerprint,
      level: input.level || 'error',
      route: input.route || location.pathname || null,
      action: input.action || null,
      apiEndpoint: input.apiEndpoint || null,
      httpStatus: typeof input.httpStatus === 'number' ? input.httpStatus : null,
      context: sanitizeContext(input.context),
      appVersion: APP_VERSION,
      clientChannel: 'novora-client',
      host: location.host,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language,
      userAgent: navigator.userAgent,
      clientTs: Date.now(),
      province: settings.exam.initialization.province || null,
      schoolName: settings.exam.initialization.schoolFullName || settings.exam.initialization.schoolName || null,
    };
    await fetch('/api/error-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // 错误上报不能影响业务流程，也不能再次抛错形成循环。
  }
}

let installed = false;

export function installGlobalErrorReporting(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : null;
    void reportError({
      message: error?.message || event.message || '未知的全局错误',
      errorName: error?.name || 'Error',
      stack: error?.stack,
      level: 'error',
      action: 'window.onerror',
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : null;
    void reportError({
      message: error?.message || (typeof reason === 'string' ? reason : '未处理的 Promise 拒绝'),
      errorName: error?.name || 'UnhandledRejection',
      stack: error?.stack,
      level: 'error',
      action: 'unhandledrejection',
    });
  });
}
