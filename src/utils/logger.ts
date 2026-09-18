const isDev = typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

export type LocalLogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LocalLogEntry {
  at: number;
  level: LocalLogLevel;
  message: string;
}

// 与作者端手动诊断包上限对齐：5000 条 / 单条 2000 字符 / 7 天窗口。
const MAX_ENTRIES = 5000;
const MAX_MESSAGE_LENGTH = 2000;
const RETENTION_MS = 7 * 86400000;
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
  .filter((entry) => entry && Number.isFinite(entry.at));

/**
 * 就地裁剪本地日志：先丢 7 天窗口外的条目，再在超限时优先丢 info/debug，
 * 最后才从最旧的条目开始丢。这样「全量日志」在体量受限时也尽量保住 warn/error。
 */
function pruneEntries(now = Date.now()): void {
  const cutoff = now - RETENTION_MS;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].at < cutoff) entries.splice(index, 1);
  }
  if (entries.length <= MAX_ENTRIES) return;
  let overflow = entries.length - MAX_ENTRIES;
  for (let index = 0; index < entries.length && overflow > 0; ) {
    const level = entries[index].level;
    if (level === 'info' || level === 'debug') {
      entries.splice(index, 1);
      overflow -= 1;
    } else {
      index += 1;
    }
  }
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

pruneEntries();

function persist(): void {
  try {
    pruneEntries();
    localStorageSafe()?.setItem(LOG_KEY, JSON.stringify(entries));
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
    .slice(0, MAX_MESSAGE_LENGTH);
  entries.push({ at: Date.now(), level, message });
  pruneEntries();
  persist();
}

export function getLocalLogEntries(from = 0, to = Date.now()): LocalLogEntry[] {
  return entries.filter((entry) => entry.at >= from && entry.at <= to).map((entry) => ({ ...entry }));
}

export function getDiagnosticCaptureConfig(): DiagnosticCaptureConfig {
  const value = readJson<Partial<DiagnosticCaptureConfig>>(CAPTURE_KEY, {});
  return {
    // 默认开启：只有管理员显式关掉时才为 false。
    captureOnError: value.captureOnError !== false,
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
