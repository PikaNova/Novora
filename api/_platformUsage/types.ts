import type { ForecastPoint, ForecastResult } from './forecast.js';

// 平台额度面板的对外契约。前端只依赖这里的形状，不感知具体平台的原始响应。

export type PlatformProviderId = 'vercel' | 'neon';

export const PLATFORM_PROVIDERS: readonly PlatformProviderId[] = ['vercel', 'neon'];

export function isPlatformProviderId(value: unknown): value is PlatformProviderId {
  return value === 'vercel' || value === 'neon';
}

/**
 * 读数状态。本地部署不会出现在返回里；`unconfigured` 之外的失败状态都保留了
 * 「最后一次成功读数」，前端据此显示可能过期的数据。
 */
export type PlatformStatus =
  'ok' | 'warning' | 'critical' | 'unconfigured' | 'unsupported' | 'credential_error' | 'rate_limited' | 'error';

export type PlatformMetric = {
  key: string;
  label: string;
  /** 已用量；limit 为 null 时表示平台未公布上限。 */
  used: number;
  limit: number | null;
  unit: string;
  /** 已用百分比（0-100+）；limit 为 null 时为 null。 */
  percent: number | null;
  note?: string;
  /** 源数据的分桶序列。只存在于服务端保存的快照里，不随视图返回给前端。 */
  series?: ForecastPoint[];
  /** 服务端按当前上限算出的预测。只随视图返回。 */
  forecast?: ForecastResult;
};

export type PlatformProviderSnapshot = {
  provider: PlatformProviderId;
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
  /** 数据来自上一次成功读数、本次刷新失败时为 true。 */
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

/** 用户手工录入的指标：公开接口拿不到的那几项（Functions Storage 之类）。 */
export type PlatformCustomMetric = {
  key: string;
  label: string;
  used: number;
  unit: string;
  limit: number | null;
};

export type PlatformProviderView = {
  provider: PlatformProviderId;
  /** 该平台在当前部署环境下是否启用（本地部署两者都为 false）。 */
  enabled: boolean;
  configured: boolean;
  /** 已保存凭据的尾号提示，例如 `••••ab12`；未配置或非密钥字段为 null。 */
  hint: string | null;
  updatedAt: number | null;
  /** 距离下次可刷新还剩的秒数；0 表示现在就能刷新。 */
  nextRefreshInSeconds: number;
  /** 指标 key → 用户设定的上限；没有条目表示沿用内置默认值。 */
  limits: Record<string, number>;
  /** 手工录入的指标，与自动读数一起展示。 */
  custom: PlatformCustomMetric[];
  fields: PlatformConfigFieldSpec[];
  consoleUrl: string;
  snapshot: PlatformProviderSnapshot | null;
};

/** 两次手动刷新之间的最短间隔。与「10 秒系统状态轮询」解耦，避免误触耗光免费额度。 */
export const PLATFORM_REFRESH_COOLDOWN_MS = 60_000;

/** 由上次刷新时间推算剩余冷却秒数（向上取整，0 表示可刷新）。 */
export function remainingCooldownSeconds(
  lastRefreshAt: number | null | undefined,
  now: number,
  cooldownMs: number = PLATFORM_REFRESH_COOLDOWN_MS,
): number {
  if (!lastRefreshAt || lastRefreshAt <= 0) return 0;
  const remaining = cooldownMs - (now - lastRefreshAt);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export type PlatformUsagePayload = {
  ok: true;
  environment: {
    runtime: 'vercel' | 'local';
    database: 'neon' | 'postgres' | 'unknown';
    local: boolean;
  };
  providers: PlatformProviderView[];
};

export function statusTone(status: PlatformStatus): 'ok' | 'warn' | 'err' | 'idle' {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'warning':
      return 'warn';
    case 'critical':
    case 'credential_error':
      return 'err';
    case 'unconfigured':
    case 'unsupported':
    case 'rate_limited':
    case 'error':
      return 'idle';
    default:
      return 'idle';
  }
}

/** 由已用/上限推导读数状态，阈值与系统状态面板的既有口径一致（80% / 95%）。 */
export function statusFromMetrics(metrics: PlatformMetric[]): PlatformStatus {
  let worst: PlatformStatus = 'ok';
  for (const metric of metrics) {
    if (metric.percent == null) continue;
    if (metric.percent >= 100) return 'critical';
    if (metric.percent >= 95) worst = 'critical';
    else if (metric.percent >= 80 && worst === 'ok') worst = 'warning';
  }
  return worst;
}
