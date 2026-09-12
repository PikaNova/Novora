const isDev = typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

export type LocalLogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LocalLogEntry {
  at: number;
  level: LocalLogLevel;
  message: string;
}

const MAX_ENTRIES = 500;
const LOG_KEY = 'novora_runtime_log_v1';
const BUNDLE_KEY = 'novora_diagnostic_bundles_v1';
const CAPTURE_KEY = 'novora_diagnostic_capture_v1';
export interface DiagnosticCaptureConfig {
  captureOnError: boolean;
  beforeSeconds: number;
  afterSeconds: number;
  retentionDays: number;
}
export interface LocalDiagnosticBundle {
  bundleId: string;
  errorEventId?: string;
  fingerprint?: string;
  errorCode?: string;
  fromTs: number;
  toTs: number;
  entries: LocalLogEntry[];
  createdAt: number;
}

function localStorageSafe(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
function readJson<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorageSafe()?.getItem(key) || 'null');
    return value == null ? fallback : (value as T);
  } catch {
    return fallback;
  }
}
const entries: LocalLogEntry[] = readJson<LocalLogEntry[]>(LOG_KEY, [])
  .filter((entry) => entry && Number.isFinite(entry.at))
  .slice(-MAX_ENTRIES);
function persist(): void {
  try {
    localStorageSafe()?.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* best effort */
  }
}
function record(level: LocalLogLevel, args: unknown[]): void {
  const message = args
    .map((value) =>
      typeof value === 'string' ? value : value instanceof Error ? `${value.name}: ${value.message}` : String(value),
    )
    .join(' ')
    // eslint-disable-next-line no-control-regex -- security boundary for untrusted runtime log text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 500);
  entries.push({ at: Date.now(), level, message });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  persist();
}

export function getLocalLogEntries(from = 0, to = Date.now()): LocalLogEntry[] {
  return entries.filter((entry) => entry.at >= from && entry.at <= to).map((entry) => ({ ...entry }));
}

export function getDiagnosticCaptureConfig(): DiagnosticCaptureConfig {
  const value = readJson<Partial<DiagnosticCaptureConfig>>(CAPTURE_KEY, {});
  return {
    captureOnError: value.captureOnError === true,
    beforeSeconds: Math.min(Math.max(Number(value.beforeSeconds) || 60, 0), 300),
    afterSeconds: Math.min(Math.max(Number(value.afterSeconds) || 30, 0), 300),
    retentionDays: Math.min(Math.max(Number(value.retentionDays) || 7, 1), 30),
  };
}

export function setDiagnosticCaptureConfig(config: Partial<DiagnosticCaptureConfig>): DiagnosticCaptureConfig {
  const next = { ...getDiagnosticCaptureConfig(), ...config };
  try {
    localStorageSafe()?.setItem(CAPTURE_KEY, JSON.stringify(next));
  } catch {
    /* best effort */
  }
  return next;
}

export function getDiagnosticBundles(): LocalDiagnosticBundle[] {
  const cutoff = Date.now() - getDiagnosticCaptureConfig().retentionDays * 86400000;
  const bundles = readJson<LocalDiagnosticBundle[]>(BUNDLE_KEY, []).filter(
    (bundle) => bundle && bundle.createdAt >= cutoff,
  );
  try {
    localStorageSafe()?.setItem(BUNDLE_KEY, JSON.stringify(bundles.slice(-30)));
  } catch {
    /* best effort */
  }
  return bundles.slice(-30);
}

export function captureErrorWindow(meta: {
  errorEventId?: string;
  fingerprint?: string;
  errorCode?: string;
}): string | null {
  const config = getDiagnosticCaptureConfig();
  if (!config.captureOnError) return null;
  const at = Date.now();
  const bundleId = `bundle_${at}_${Math.random().toString(36).slice(2, 8)}`;
  const fromTs = at - config.beforeSeconds * 1000;
  const before = getLocalLogEntries(fromTs, at);
  const finish = () => {
    const entriesForBundle = getLocalLogEntries(fromTs, Date.now());
    const bundles = getDiagnosticBundles().filter((item) => item.bundleId !== bundleId);
    bundles.push({
      bundleId,
      ...meta,
      fromTs,
      toTs: Date.now(),
      entries: entriesForBundle.length ? entriesForBundle : before,
      createdAt: Date.now(),
    });
    try {
      localStorageSafe()?.setItem(BUNDLE_KEY, JSON.stringify(bundles.slice(-30)));
    } catch {
      /* best effort */
    }
  };
  if (config.afterSeconds > 0) window.setTimeout(finish, config.afterSeconds * 1000);
  else finish();
  return bundleId;
}

export const logger = {
  debug: (...args: unknown[]) => {
    record('debug', args);
    if (isDev) console.debug(...args);
  },
  info: (...args: unknown[]) => {
    record('info', args);
    if (isDev) console.info(...args);
  },
  warn: (...args: unknown[]) => {
    record('warn', args);
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    record('error', args);
    console.error(...args);
  },
};

export const { debug, info, warn, error } = logger;
