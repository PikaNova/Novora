// 平台额度面板的前端服务层。
// 凭据只在提交时经过这里一次，之后接口只会回显尾号提示，不会回传明文。
import { authHeaders } from './auth/session';

export type PlatformStatus =
  'ok' | 'warning' | 'critical' | 'unconfigured' | 'unsupported' | 'credential_error' | 'rate_limited' | 'error';

export type PlatformMetric = {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  unit: string;
  percent: number | null;
  note?: string;
  /** 服务端按当前上限算出的预测。 */
  forecast?: PlatformForecast;
};

export type PlatformForecastStatus = 'ok' | 'insufficient' | 'no-usage' | 'exceeded';

export type PlatformForecast = {
  status: PlatformForecastStatus;
  basis: 'period' | 'window' | null;
  sampleDays: number;
  dailyRate: number | null;
  recentDailyRate: number | null;
  remaining: number | null;
  daysToPeriodEnd: number | null;
  daysLeft: number | null;
  exhaustsWithinPeriod: boolean | null;
  projectedExhaustDate: string | null;
  volatile: boolean;
};

/** 手工录入的指标。 */
export type PlatformCustomMetric = {
  key: string;
  label: string;
  used: number;
  unit: string;
  limit: number | null;
};

export type PlatformProviderSnapshot = {
  provider: 'vercel' | 'neon';
  label: string;
  status: PlatformStatus;
  message: string;
  observedAt: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  metrics: PlatformMetric[];
  consoleUrl: string;
  source: string;
  accountLabel: string | null;
  stale: boolean;
};

export type PlatformConfigFieldSpec = {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
  required: boolean;
  secret: boolean;
};

export type PlatformProviderView = {
  provider: 'vercel' | 'neon';
  enabled: boolean;
  configured: boolean;
  hint: string | null;
  updatedAt: number | null;
  /** 距离下次可刷新还剩的秒数；0 表示现在就能刷新。 */
  nextRefreshInSeconds: number;
  /** 指标 key → 用户设定的上限；留空的指标不会出现在这里，表示用免费版默认值。 */
  limits: Record<string, number>;
  /** 手工录入的指标。 */
  custom: PlatformCustomMetric[];
  fields: PlatformConfigFieldSpec[];
  consoleUrl: string;
  snapshot: PlatformProviderSnapshot | null;
};

export type PlatformUsagePayload = {
  ok: true;
  environment: { runtime: 'vercel' | 'local'; database: 'neon' | 'postgres' | 'unknown'; local: boolean };
  providers: PlatformProviderView[];
};

/** 带业务码的请求错误。刷新冷却时携带剩余秒数，前端据此倒计时。 */
export class PlatformUsageError extends Error {
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, code: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = 'PlatformUsageError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => null)) as
    (T & { error?: string; code?: string; retryAfterSeconds?: number }) | null;
  if (!response.ok || !data) {
    const retry = Number(data?.retryAfterSeconds);
    throw new PlatformUsageError(
      data?.error || `HTTP ${response.status}`,
      data?.code || 'REQUEST_FAILED',
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
  return data;
}

export function fetchPlatformUsage(): Promise<PlatformUsagePayload> {
  return request<PlatformUsagePayload>('/api/platform-usage');
}

export function savePlatformConfig(
  provider: 'vercel' | 'neon',
  values: Record<string, string>,
  extra?: {
    limits?: Record<string, string>;
    custom?: Array<{ key: string; label: string; used: string; unit: string; limit: string }>;
  },
): Promise<PlatformUsagePayload> {
  return request<PlatformUsagePayload>('/api/platform-usage-config', {
    method: 'POST',
    body: JSON.stringify({ provider, values, ...(extra ?? {}) }),
  });
}

export function clearPlatformConfig(provider: 'vercel' | 'neon'): Promise<PlatformUsagePayload> {
  return request<PlatformUsagePayload>('/api/platform-usage-config', {
    method: 'POST',
    body: JSON.stringify({ provider, action: 'clear' }),
  });
}

export function refreshPlatformUsage(provider: 'vercel' | 'neon'): Promise<PlatformUsagePayload> {
  return request<PlatformUsagePayload>('/api/platform-usage-refresh', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}
