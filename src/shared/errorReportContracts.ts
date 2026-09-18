/** v2：在 v1 的基础上补充网络/同步快照、事件序列、构建号与错误码，便于作者端直接定位。 */
export const ERROR_REPORT_SCHEMA_VERSION = 2 as const;
export const ERROR_REPORT_CHANNEL = 'novora-client-v2' as const;

export const ERROR_REPORT_TYPES = ['js', 'api', 'react', 'network', 'sync', 'database', 'unknown'] as const;
export type ErrorReportType = (typeof ERROR_REPORT_TYPES)[number];

export const ERROR_REPORT_LEVELS = ['critical', 'error', 'warning', 'info'] as const;
export type ErrorReportLevel = (typeof ERROR_REPORT_LEVELS)[number];

/** 归因来源：与作者端 ERROR_SOURCE_LABEL 的键保持一致，客户端不得发明新枚举。 */
export const ERROR_REPORT_SOURCES = [
  'program',
  'user_device',
  'external_service',
  'network',
  'database',
  'sync',
  'device',
  'client',
] as const;
export type ErrorReportSource = (typeof ERROR_REPORT_SOURCES)[number];

/** 严重级别：与 ERROR_REPORT_LEVELS 同集合，单独命名便于作者端按 severity 落库。 */
export const ERROR_REPORT_SEVERITIES = ERROR_REPORT_LEVELS;
export type ErrorReportSeverity = (typeof ERROR_REPORT_LEVELS)[number];

export const ERROR_CONTEXT_KEYS = [
  // 请求维度
  'requestId',
  'operation',
  'retryable',
  'retryAfterMs',
  'syncState',
  'status',
  'component',
  'resource',
  'durationMs',
  'attempt',
  'queued',
  'online',
  'source',
  // 应用状态：只允许计数与枚举，不放考试内容
  'mode',
  'stage',
  'plansTotal',
  'plansEnabled',
  'itemsEnabled',
  'scopeGroups',
  'seriesTotal',
  'pendingReports',
  'captureEnabled',
  'standalone',
  'swActive',
  'storageUsedKb',
  'sinceLoadMs',
  'offlineForMs',
  'failedRequests',
  'lastApiStatus',
] as const;
const ALLOWED_CONTEXT_KEYS = new Set<string>(ERROR_CONTEXT_KEYS);

export type ErrorReportContextValue = string | number | boolean;
export type ErrorReportContext = Record<string, ErrorReportContextValue>;

export interface ErrorReportPayload {
  schemaVersion: typeof ERROR_REPORT_SCHEMA_VERSION;
  clientChannel: typeof ERROR_REPORT_CHANNEL;
  instanceId: string;
  deviceId?: string | null;
  type: ErrorReportType;
  level: ErrorReportLevel;
  fingerprint: string;
  errorName?: string | null;
  message: string;
  stack?: string | null;
  route?: string | null;
  action?: string | null;
  apiEndpoint?: string | null;
  httpStatus?: number | null;
  context?: ErrorReportContext | null;
  /** 动态分包/构建标识：版本号相同但构建不同的场景（如资源版本不一致）靠它区分。 */
  commitSha?: string | null;
  /** 已知错误码时上报，作者端据此给出运维说明与建议操作。 */
  errorCode?: string | null;
  /** 归因来源与严重级别：作者端缺省时会自行推断，带上则以客户端判定为准（client 归因除外）。 */
  errorSource?: ErrorReportSource | null;
  severity?: ErrorReportSeverity | null;
  /** 给用户看的一句话说明（可选，作者端原样展示）。 */
  userMessage?: string | null;
  /** 给运维看的定位说明与建议操作（目录没有对应条目时作者端会兜底）。 */
  operatorMessage?: string | null;
  suggestedAction?: string | null;
  retryable?: boolean | null;
  requestId?: string | null;
  traceId?: string | null;
  migrationVersion?: string | null;
  errorEventId?: string | null;
  occurredAt?: number | null;
  networkState?: ErrorReportContext | null;
  syncState?: ErrorReportContext | null;
  breadcrumbs?: ErrorReportContext[] | null;
  appVersion: string;
  clientTs?: number | null;
  schoolName?: string | null;
  host?: string | null;
  userAgent?: string | null;
  province?: string | null;
  tz?: string | null;
  lang?: string | null;
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4_000;
const MAX_NAME_LENGTH = 120;
const MAX_ROUTE_LENGTH = 160;
const MAX_ACTION_LENGTH = 100;
const MAX_ENDPOINT_LENGTH = 160;
const MAX_FINGERPRINT_LENGTH = 64;
const MAX_CONTEXT_VALUE_LENGTH = 160;
const MAX_DIAGNOSTIC_VALUE_LENGTH = 200;
const MAX_CONTEXT_KEYS = 20;
const MAX_DIAGNOSTIC_KEYS = 16;
const MAX_BREADCRUMB_ROWS = 20;
const MAX_BREADCRUMB_KEYS = 8;
/** 毫秒时间戳约 1.7e12，放行到 1e15 既够用又能挡住异常值。 */
const MAX_DIAGNOSTIC_NUMBER = 1e15;
const MAX_ID_LENGTH = 96;
const MAX_SOURCE_LENGTH = 32;
const MAX_SEVERITY_LENGTH = 16;
const MAX_REASON_LENGTH = 500;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_MIGRATION_VERSION_LENGTH = 96;

const DIAGNOSTIC_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,47}$/;
// 与服务端 _diagnosticBundleContract / 作者端 displaySanitizer 保持一致：这些键名一律不进快照。
const UNSAFE_DIAGNOSTIC_KEY =
  /(exam|student|question|answer|score|class|grade|school|token|cookie|password|passwd|secret|sql|body|payload|authorization|api[-_]?key|connection[-_]?string)/i;

// Keep operational identifiers useful while removing values that can identify a person or expose credentials.
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:basic|digest)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|password|passwd|secret|cookie)\s*[:=]\s*[^\s,;]+/gi,
  /(?:^|[?&])(?:token|access_token|refresh_token|api_key|key|secret|password)=[^&#\s]+/gi,
];
const PERSONAL_VALUE_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /(?:\+?86[-\s]?)?1\d{10}/g,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
];
const BUSINESS_VALUE_PATTERNS = [
  /\b(?:exam|subject|class|grade|school|student|question|answer|score)(?:\s|[_-])*(?:name|title|id|code)?\s*[:=]\s*[^,;\n]+/gi,
  /(?:考试|科目|班级|年级|学校|学生|题目|答案|成绩)(?:名称|标题|编号|代码|ID)?\s*[:：=]\s*[^，,；;\n]+/g,
];
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_HEX_PATTERN = /\b[0-9a-f]{16,}\b/gi;
const ISO_TIME_PATTERN = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
// eslint-disable-next-line no-control-regex -- security boundary for untrusted diagnostic text
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanText(value: unknown, maxLength: number, preserveNewlines = false): string | null {
  if (value == null) return null;
  let text = String(value);
  // Security boundary: discard control characters before storing or relaying diagnostics.
  text = text.replace(CONTROL_CHARACTER_PATTERN, ' ');
  if (!preserveNewlines) text = text.replace(/[\r\n\t]+/g, ' ');
  for (const pattern of [...SECRET_VALUE_PATTERNS, ...PERSONAL_VALUE_PATTERNS, ...BUSINESS_VALUE_PATTERNS]) {
    text = text.replace(pattern, '<redacted>');
  }
  return text.trim().slice(0, maxLength) || null;
}

export function sanitizeErrorReportText(value: unknown, maxLength = MAX_MESSAGE_LENGTH): string | null {
  return cleanText(value, maxLength);
}

export function sanitizeErrorReportStack(value: unknown): string | null {
  const cleaned = cleanText(value, MAX_STACK_LENGTH, true);
  return cleaned ? cleaned.split('\n').slice(0, 40).join('\n').slice(0, MAX_STACK_LENGTH) : null;
}

export function sanitizeErrorReportId(value: unknown): string | null {
  return cleanText(value, MAX_ID_LENGTH);
}

function normalizeDynamicValues(value: string): string {
  return value
    .replace(UUID_PATTERN, '<uuid>')
    .replace(ISO_TIME_PATTERN, '<time>')
    .replace(LONG_HEX_PATTERN, '<hex>')
    .replace(/\b\d+\b/g, '<number>')
    .replace(/([?&][^\s=&#]+)=([^&#\s]*)/g, '$1=<param>');
}

export function sanitizeErrorReportPath(value: unknown, maxLength = MAX_ROUTE_LENGTH): string | null {
  if (value == null) return null;
  const raw = String(value).replace(CONTROL_CHARACTER_PATTERN, ' ').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, 'https://novora.invalid');
    const path = cleanText(parsed.pathname || '/', maxLength);
    return path ? normalizeDynamicValues(path).slice(0, maxLength) : '/';
  } catch {
    const path = cleanText(raw.split(/[?#]/, 1)[0] || '/', maxLength);
    return path ? normalizeDynamicValues(path).slice(0, maxLength) : '/';
  }
}

export function sanitizeErrorReportContext(value: unknown): ErrorReportContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: ErrorReportContext = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key) || raw == null) continue;
    if (typeof raw === 'string') {
      const sanitized = cleanText(raw, MAX_CONTEXT_VALUE_LENGTH);
      if (sanitized) result[key] = sanitized;
    } else if (typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) <= MAX_DIAGNOSTIC_NUMBER) {
      result[key] = raw;
    } else if (typeof raw === 'boolean') {
      result[key] = raw;
    }
    if (Object.keys(result).length >= MAX_CONTEXT_KEYS) break;
  }
  return Object.keys(result).length ? result : null;
}

/**
 * 网络/同步快照：键名走固定白名单正则，值只允许标量。
 * 与 `context` 的区别是键名开放（由客户端定义），但同样禁止敏感键与业务正文。
 */
export function sanitizeErrorReportRecord(value: unknown, maxKeys = MAX_DIAGNOSTIC_KEYS): ErrorReportContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: ErrorReportContext = {};
  for (const [rawKey, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(result).length >= maxKeys) break;
    if (raw == null) continue;
    const key = String(rawKey).slice(0, 48);
    if (!DIAGNOSTIC_KEY_PATTERN.test(key) || UNSAFE_DIAGNOSTIC_KEY.test(key)) continue;
    if (typeof raw === 'string') {
      const sanitized = cleanText(raw, MAX_DIAGNOSTIC_VALUE_LENGTH);
      if (sanitized) result[key] = sanitized;
    } else if (typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) <= MAX_DIAGNOSTIC_NUMBER) {
      result[key] = raw;
    } else if (typeof raw === 'boolean') {
      result[key] = raw;
    }
  }
  return Object.keys(result).length ? result : null;
}

/** 出错前后的操作时间线，逐条过滤并限制条数。 */
export function sanitizeErrorReportBreadcrumbs(value: unknown): ErrorReportContext[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ErrorReportContext[] = [];
  for (const row of value.slice(-MAX_BREADCRUMB_ROWS)) {
    const sanitized = sanitizeErrorReportRecord(row, MAX_BREADCRUMB_KEYS);
    if (sanitized) rows.push(sanitized);
  }
  return rows.length ? rows : null;
}

export function normalizeErrorReportType(value: unknown): ErrorReportType {
  return typeof value === 'string' && (ERROR_REPORT_TYPES as readonly string[]).includes(value)
    ? (value as ErrorReportType)
    : 'unknown';
}

export function normalizeErrorReportLevel(value: unknown): ErrorReportLevel {
  return typeof value === 'string' && (ERROR_REPORT_LEVELS as readonly string[]).includes(value)
    ? (value as ErrorReportLevel)
    : 'error';
}

/** 非法或未声明的归因/级别一律落成 null，由作者端按错误码自行推断，不落原字符串。 */
export function normalizeErrorReportSource(value: unknown): ErrorReportSource | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase().slice(0, MAX_SOURCE_LENGTH);
  return (ERROR_REPORT_SOURCES as readonly string[]).includes(text) ? (text as ErrorReportSource) : null;
}

export function normalizeErrorReportSeverity(value: unknown): ErrorReportSeverity | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase().slice(0, MAX_SEVERITY_LENGTH);
  return (ERROR_REPORT_SEVERITIES as readonly string[]).includes(text) ? (text as ErrorReportSeverity) : null;
}

export function buildErrorReportFingerprint(input: {
  type: ErrorReportType;
  errorName?: unknown;
  message: unknown;
  route?: unknown;
  apiEndpoint?: unknown;
}): string {
  const base = normalizeDynamicValues(
    [
      input.type,
      cleanText(input.errorName, MAX_NAME_LENGTH) || 'Error',
      cleanText(input.message, MAX_MESSAGE_LENGTH) || 'Unknown error',
      sanitizeErrorReportPath(input.route, MAX_ROUTE_LENGTH) || '',
      sanitizeErrorReportPath(input.apiEndpoint, MAX_ENDPOINT_LENGTH) || '',
    ].join('|'),
  );
  let hash = 2_166_136_261;
  for (let index = 0; index < base.length; index += 1) {
    hash ^= base.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fp_${(hash >>> 0).toString(36)}`.slice(0, MAX_FINGERPRINT_LENGTH);
}

export function sanitizeErrorReportPayload(input: Partial<ErrorReportPayload>): ErrorReportPayload | null {
  const instanceId = sanitizeErrorReportId(input.instanceId);
  const message = cleanText(input.message, MAX_MESSAGE_LENGTH);
  if (!instanceId || !message) return null;
  const type = normalizeErrorReportType(input.type);
  const route = sanitizeErrorReportPath(input.route, MAX_ROUTE_LENGTH);
  const apiEndpoint = sanitizeErrorReportPath(input.apiEndpoint, MAX_ENDPOINT_LENGTH);
  return {
    schemaVersion: ERROR_REPORT_SCHEMA_VERSION,
    clientChannel: ERROR_REPORT_CHANNEL,
    instanceId,
    deviceId: sanitizeErrorReportId(input.deviceId),
    type,
    level: normalizeErrorReportLevel(input.level),
    fingerprint:
      cleanText(input.fingerprint, MAX_FINGERPRINT_LENGTH) ||
      buildErrorReportFingerprint({ type, errorName: input.errorName, message, route, apiEndpoint }),
    errorName: cleanText(input.errorName, MAX_NAME_LENGTH),
    message,
    stack: sanitizeErrorReportStack(input.stack),
    route,
    action: cleanText(input.action, MAX_ACTION_LENGTH),
    apiEndpoint,
    httpStatus:
      typeof input.httpStatus === 'number' &&
      Number.isInteger(input.httpStatus) &&
      input.httpStatus >= 0 &&
      input.httpStatus <= 599
        ? input.httpStatus
        : null,
    context: sanitizeErrorReportContext(input.context),
    commitSha: cleanText(input.commitSha, 96),
    errorCode: cleanText(input.errorCode, 96),
    errorSource: normalizeErrorReportSource(input.errorSource),
    severity: normalizeErrorReportSeverity(input.severity),
    userMessage: cleanText(input.userMessage, 300),
    operatorMessage: cleanText(input.operatorMessage, MAX_REASON_LENGTH),
    suggestedAction: cleanText(input.suggestedAction, MAX_REASON_LENGTH),
    retryable: typeof input.retryable === 'boolean' ? input.retryable : null,
    requestId: cleanText(input.requestId, MAX_REQUEST_ID_LENGTH),
    traceId: cleanText(input.traceId, MAX_REQUEST_ID_LENGTH),
    migrationVersion: cleanText(input.migrationVersion, MAX_MIGRATION_VERSION_LENGTH),
    errorEventId: sanitizeErrorReportId(input.errorEventId),
    occurredAt:
      typeof input.occurredAt === 'number' &&
      Number.isFinite(input.occurredAt) &&
      input.occurredAt > 0 &&
      input.occurredAt <= MAX_DIAGNOSTIC_NUMBER
        ? Math.round(input.occurredAt)
        : null,
    networkState: sanitizeErrorReportRecord(input.networkState),
    syncState: sanitizeErrorReportRecord(input.syncState),
    breadcrumbs: sanitizeErrorReportBreadcrumbs(input.breadcrumbs),
    appVersion: cleanText(input.appVersion, 32) || 'unknown',
    clientTs:
      typeof input.clientTs === 'number' && Number.isFinite(input.clientTs) && input.clientTs > 0
        ? Math.round(input.clientTs)
        : null,
    schoolName: cleanText(input.schoolName, 80),
    host: cleanText(input.host, 128),
    userAgent: cleanText(input.userAgent, 512),
    province: cleanText(input.province, 40),
    tz: cleanText(input.tz, 64),
    lang: cleanText(input.lang, 32),
  };
}
