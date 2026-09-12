export const DIAGNOSTIC_LOG_SCHEMA_VERSION = 1 as const;
export const DIAGNOSTIC_LOG_MODES = ['date', 'error'] as const;
export type DiagnosticLogMode = (typeof DIAGNOSTIC_LOG_MODES)[number];

export const DIAGNOSTIC_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type DiagnosticLogLevel = (typeof DIAGNOSTIC_LOG_LEVELS)[number];

export interface DiagnosticLogEntry {
  at: number;
  level: DiagnosticLogLevel;
  message: string;
  source?: string | null;
  context?: Record<string, string | number | boolean> | null;
}

export interface DiagnosticLogBundleInput {
  bundleId?: string;
  mode: DiagnosticLogMode;
  instanceId: string;
  deviceId?: string | null;
  errorEventId?: string | null;
  fingerprint?: string | null;
  errorCode?: string | null;
  fromTs: number;
  toTs: number;
  entries: DiagnosticLogEntry[];
  appVersion?: string | null;
  commitSha?: string | null;
}

export function normalizeDiagnosticLogMode(value: unknown): DiagnosticLogMode | null {
  return typeof value === 'string' && (DIAGNOSTIC_LOG_MODES as readonly string[]).includes(value)
    ? (value as DiagnosticLogMode)
    : null;
}

export function normalizeDiagnosticLogLevel(value: unknown): DiagnosticLogLevel {
  return typeof value === 'string' && (DIAGNOSTIC_LOG_LEVELS as readonly string[]).includes(value)
    ? (value as DiagnosticLogLevel)
    : 'info';
}

export function sanitizeDiagnosticContext(value: unknown): Record<string, string | number | boolean> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,47}$/.test(key)) continue;
    if (
      /(exam|student|question|answer|score|class|grade|school|token|cookie|password|secret|sql|body|payload)/i.test(key)
    )
      continue;
    if (typeof raw === 'string') {
      const clean = raw
        // eslint-disable-next-line no-control-regex -- security boundary for untrusted diagnostic text
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
      if (clean) result[key] = clean;
    } else if (typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) <= 1_000_000_000) result[key] = raw;
    else if (typeof raw === 'boolean') result[key] = raw;
  }
  return Object.keys(result).length ? result : null;
}

export function sanitizeDiagnosticMessage(value: unknown, max = 500): string {
  return (
    String(value ?? '')
      // eslint-disable-next-line no-control-regex -- security boundary for untrusted diagnostic text
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(
        /Bearer\s+[^\s,;]+|(?:password|token|cookie|authorization)\s*[=:]\s*(?!Bearer\b)[^\s,;]+/gi,
        '<redacted>',
      )
      .replace(
        /(?:exam|subject|class|grade|school|student|question|answer|score)(?:\s|[_-])*(?:name|title|id|code)?\s*[:=]\s*[^,;\n]+/gi,
        '<redacted>',
      )
      .replace(
        /(?:考试|科目|班级|年级|学校|学生|题目|答案|成绩)(?:名称|标题|编号|代码|ID)?\s*[:：=]\s*[^，,；;\n]+/g,
        '<redacted>',
      )
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<redacted>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  );
}

export function sanitizeDiagnosticEntry(value: unknown): DiagnosticLogEntry | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const at = Number(row.at);
  const message = sanitizeDiagnosticMessage(row.message);
  if (!Number.isFinite(at) || at <= 0 || !message) return null;
  return {
    at: Math.round(at),
    level: normalizeDiagnosticLogLevel(row.level),
    message,
    source: row.source == null ? null : sanitizeDiagnosticMessage(row.source, 80),
    context: sanitizeDiagnosticContext(row.context),
  };
}
