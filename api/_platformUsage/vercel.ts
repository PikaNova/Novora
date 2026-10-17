// Vercel 用量适配器（未公开端点 `/v2/usage`）。
//
// 参数与响应形状由 2026-10-01 用真实账号逐项实测确定：
//
//   GET /v2/usage?type=<type>&from=<ISO>&to=<ISO>[&teamId=|&slug=]
//
//   - `type` 与 `from` 必填；缺 `type` 会返回 400，错误信息里带完整枚举。
//   - 13 个取值里只有 `requests` 与 `builds` 会返回数据，其余对这个账号恒为空数组。
//   - 窗口越长接口会自动把分桶粒度切成月（30 天=天桶，120 天=月桶），因此必须
//     按返回的桶求和，不能只取第一条——那样会低估十几倍。
//
// 两件必须说清楚的事（都写进了返回值而不是悄悄处理）：
//
//   1. 该端点不提供任何额度上限。团队信息里只有 `billing.plan = "hobby"`，
//      没有配额字段，所以这里只报「已用量」，不计算百分比，避免用错误的
//      上限误导判断。
//   2. 面板上的 Functions Storage、Deployment Storage、ISR、Blob、Queue、
//      Sandbox、Image Optimization 等指标在这个端点里完全没有，无法读取。
//   3. 出站/入站带宽的口径与面板的 Fast Data Transfer / Fast Origin Transfer
//      并不一致（实测同一窗口 3.44 GB vs 面板 5.6 GB），因此按接口自身的
//      语义命名，不冒用面板的名字。
import type { ForecastPoint } from './forecast.js';
import type { PlatformMetric, PlatformProviderSnapshot } from './types.js';

const API_BASE = 'https://api.vercel.com';
const CONSOLE_URL = 'https://vercel.com/dashboard/usage';
const WINDOW_DAYS = 30;
const GB = 1_000_000_000;

/** 会返回数据的两个 type（其余取值已逐一实测为空）。 */
export const VERCEL_USAGE_TYPES = ['requests', 'builds'] as const;
export type VercelUsageType = (typeof VERCEL_USAGE_TYPES)[number];

export type VercelMetricDef = {
  source: VercelUsageType;
  key: string;
  label: string;
  unit: string;
  /** 需要按窗口求和的字段；同一指标可能由多个字段组成。 */
  fields: readonly string[];
  /** 求和后除以该系数（例如字节转 GB、秒转分钟）。 */
  scale?: number;
  /** 展示时保留的小数位。 */
  digits: number;
};

/**
 * 端点能提供的全部指标。没有 `limit` 字段是有意为之：该端点不返回上限，
 * 写死一个数字只会让人误判离限额还有多远。
 */
export const VERCEL_METRICS: readonly VercelMetricDef[] = [
  {
    source: 'requests',
    key: 'cdn_requests',
    label: 'CDN 请求（缓存命中 + 回源）',
    unit: '次',
    fields: ['request_hit_count', 'request_miss_count'],
    digits: 0,
  },
  {
    source: 'requests',
    key: 'bandwidth_outgoing',
    label: '出站带宽（CDN → 用户）',
    unit: 'GB',
    fields: ['bandwidth_outgoing_bytes'],
    scale: GB,
    digits: 3,
  },
  {
    source: 'requests',
    key: 'bandwidth_incoming',
    label: '入站带宽（源站 → CDN）',
    unit: 'GB',
    fields: ['bandwidth_incoming_bytes'],
    scale: GB,
    digits: 3,
  },
  {
    source: 'requests',
    key: 'function_invocations',
    label: '函数调用次数',
    unit: '次',
    fields: [
      'function_invocation_successful_count',
      'function_invocation_error_count',
      'function_invocation_throttle_count',
      'function_invocation_timeout_count',
    ],
    digits: 0,
  },
  {
    source: 'requests',
    key: 'function_gb_hours',
    label: '函数内存时长',
    unit: 'GB-hrs',
    fields: [
      'function_execution_successful_gb_hours',
      'function_execution_error_gb_hours',
      'function_execution_timeout_gb_hours',
    ],
    digits: 3,
  },
  {
    source: 'requests',
    key: 'monitoring_metrics',
    label: '监控指标',
    unit: '次',
    fields: ['monitoring_metric_count'],
    digits: 0,
  },
  {
    source: 'builds',
    key: 'builds',
    label: '构建次数',
    unit: '次',
    fields: ['build_completed_count', 'build_failed_count'],
    digits: 0,
  },
  {
    source: 'builds',
    key: 'build_minutes',
    label: '构建耗时',
    unit: '分钟',
    fields: ['build_build_seconds', 'build_queued_seconds'],
    scale: 60,
    digits: 1,
  },
];

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** 对分桶数组里指定字段求和；非数值与缺失字段按 0 处理，不抛错。 */
export function sumBuckets(data: unknown, fields: readonly string[]): number {
  if (!Array.isArray(data)) return 0;
  let total = 0;
  for (const bucket of data) {
    if (!bucket || typeof bucket !== 'object') continue;
    const record = bucket as Record<string, unknown>;
    for (const field of fields) {
      const value = toNumber(record[field]);
      if (value != null) total += value;
    }
  }
  return total;
}

/**
 * 逐桶取值，供预测用。`used` 用 sumBuckets 求（保持四舍五入口径一致），
 * 这里额外保留每一天的量，好让「还能用几天」按真实分布算而不是拿一个平均外推。
 */
export function bucketSeries(data: unknown, fields: readonly string[], scale?: number): ForecastPoint[] {
  if (!Array.isArray(data)) return [];
  const points: ForecastPoint[] = [];
  for (const bucket of data) {
    if (!bucket || typeof bucket !== 'object') continue;
    const record = bucket as Record<string, unknown>;
    const date = typeof record.date === 'string' ? record.date : null;
    if (!date) continue;
    let value = 0;
    for (const field of fields) {
      const parsed = toNumber(record[field]);
      if (parsed != null) value += parsed;
    }
    points.push({ date, value: scale ? value / scale : value });
  }
  return points;
}

/** 只描述结构骨架（键名与类型，不含数值），用于遇到未知响应时把形状回显到面板上。 */
export function describeShape(node: unknown, depth = 0): string {
  if (depth > 3) return '…';
  if (node === null) return 'null';
  if (Array.isArray(node)) return node.length ? `[${describeShape(node[0], depth + 1)}]` : '[]';
  if (typeof node === 'object') {
    const entries = Object.entries(node as Record<string, unknown>);
    if (!entries.length) return '{}';
    const shown = entries.slice(0, 12).map(([key, value]) => `${key}: ${describeShape(value, depth + 1)}`);
    return `{ ${shown.join(', ')}${entries.length > 12 ? ', …' : ''} }`;
  }
  return typeof node;
}

/** 按指标定义把某一类响应的分桶数组换算成读数；没有上限，因此不给百分比。 */
export function buildVercelMetrics(dataByType: Partial<Record<VercelUsageType, unknown>>): PlatformMetric[] {
  const metrics: PlatformMetric[] = [];
  for (const def of VERCEL_METRICS) {
    const raw = sumBuckets(dataByType[def.source], def.fields);
    const used = def.scale ? raw / def.scale : raw;
    const series = bucketSeries(dataByType[def.source], def.fields, def.scale);
    metrics.push({
      key: def.key,
      label: def.label,
      used: Number(used.toFixed(def.digits)),
      limit: null,
      unit: def.unit,
      percent: null,
      // 没有序列就不带这个字段，免得快照里堆一堆空数组。
      ...(series.length ? { series } : {}),
    });
  }
  return metrics;
}

/** 没有读数时的占位：同样的指标清单，全部按 0 显示。 */
export function vercelDeclarativeMetrics(): PlatformMetric[] {
  return VERCEL_METRICS.map((def) => ({
    key: def.key,
    label: def.label,
    used: 0,
    limit: null,
    unit: def.unit,
    percent: null,
  }));
}

export type VercelCollectInput = {
  token: string;
  /** 团队作用域：Team ID（`team_…`）或团队 slug。个人账户可留空。 */
  teamId?: string;
  now?: number;
};

/** 把 `{ error: { message } }` 读出来，让报错带上平台原话。 */
async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown }; message?: unknown };
    const message = body?.error?.message ?? body?.message;
    if (typeof message === 'string' && message) return message.slice(0, 200);
  } catch {
    /* 无 JSON 响应体 */
  }
  return `HTTP ${response.status}`;
}

const MISSING_NOTE =
  'Vercel 公开接口不提供额度上限，也不返回 Functions Storage、Deployment Storage 等指标，这些请到用量页查看。';

export async function collectVercelUsage(input: VercelCollectInput): Promise<PlatformProviderSnapshot> {
  const now = input.now ?? Date.now();
  const from = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
  const to = new Date(now).toISOString();
  const scope = input.teamId?.trim() ?? '';

  const base: PlatformProviderSnapshot = {
    provider: 'vercel',
    label: 'Vercel',
    status: 'unsupported',
    message: '',
    observedAt: null,
    periodStart: from,
    periodEnd: to,
    metrics: vercelDeclarativeMetrics(),
    consoleUrl: scope && !scope.startsWith('team_') ? `https://vercel.com/${scope}/~/usage` : CONSOLE_URL,
    source: 'vercel-api',
    accountLabel: scope || null,
    stale: false,
  };

  const dataByType: Partial<Record<VercelUsageType, unknown>> = {};
  const problems: string[] = [];
  let rateLimited = false;
  let sawBucket = false;

  for (const type of VERCEL_USAGE_TYPES) {
    const params = new URLSearchParams({ type, from, to });
    // `team_` 开头按 Team ID 传，否则按 slug 传——两者在 Vercel 是分开的参数。
    if (scope) params.set(scope.startsWith('team_') ? 'teamId' : 'slug', scope);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/v2/usage?${params.toString()}`, {
        headers: { Authorization: `Bearer ${input.token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      problems.push(`${type}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      return { ...base, status: 'credential_error', message: 'Vercel Token 无效或权限不足，请重新填写。' };
    }
    if (response.status === 429) {
      rateLimited = true;
      continue;
    }
    if (!response.ok) {
      problems.push(`${type}: ${await readApiError(response)}`);
      continue;
    }

    try {
      const payload = (await response.json()) as { data?: unknown };
      if (!Array.isArray(payload?.data)) {
        problems.push(`${type}: 未知结构 ${describeShape(payload).slice(0, 200)}`);
        continue;
      }
      dataByType[type] = payload.data;
      if (payload.data.length) sawBucket = true;
    } catch {
      problems.push(`${type}: 响应无法解析`);
    }
  }

  if (!sawBucket) {
    if (rateLimited && !problems.length) {
      return { ...base, status: 'rate_limited', message: 'Vercel 接口触发限流，请稍后再试。' };
    }
    return {
      ...base,
      status: problems.length ? 'error' : 'unsupported',
      message: problems.length
        ? `Vercel 用量接口未返回可用数据（${problems.join('；')}）。`
        : 'Vercel 返回的用量列表为空：近 30 天没有可用记录，请到 Vercel 用量页核对团队与计费周期。',
    };
  }

  return {
    ...base,
    status: 'ok',
    message: `数据来自 Vercel 用量接口，统计窗口为近 ${WINDOW_DAYS} 天并按返回的桶累加。${MISSING_NOTE}`,
    observedAt: now,
    metrics: buildVercelMetrics(dataByType),
  };
}
