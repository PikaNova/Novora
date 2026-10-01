// 平台额度功能的 HTTP 层。三个入口都挂在 api/system.ts 的合并函数上：
//   GET  /api/system?sys=platform-usage         读取配置与最近快照
//   POST /api/system?sys=platform-usage-config  保存或清除凭据
//   POST /api/system?sys=platform-usage-refresh 主动刷新一次读数
//
// 全部要求超级管理员；本地部署下没有可启用的平台，接口仍可访问但返回空列表。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authSql, requireActor } from '../_auth.js';
import { sendDatabaseError } from '../_apiError.js';
import { decryptSecret, encryptSecret, secretHint } from './crypto.js';
import { detectPlatformEnvironment, type PlatformEnvironment } from './environment.js';
import { cumulativeToDailyRates, forecastUsage, type ForecastPoint } from './forecast.js';
import { collectNeonUsage, NEON_FREE_LIMITS } from './neon.js';
import {
  clearPlatformConfig,
  encryptionSecret,
  ensurePlatformUsageTables,
  HISTORY_RETENTION_MS,
  readPlatformConfig,
  readPlatformSnapshot,
  readUsageHistory,
  recordUsageHistory,
  writePlatformConfig,
  writePlatformSnapshot,
  type StoredPlatformConfig,
  type StoredPlatformSnapshot,
} from './store.js';
import {
  isPlatformProviderId,
  remainingCooldownSeconds,
  statusFromMetrics,
  type PlatformConfigFieldSpec,
  type PlatformCustomMetric,
  type PlatformMetric,
  type PlatformProviderId,
  type PlatformProviderSnapshot,
  type PlatformProviderView,
  type PlatformStatus,
  type PlatformUsagePayload,
} from './types.js';
import { collectVercelUsage } from './vercel.js';

const CONSOLE_URLS: Record<PlatformProviderId, string> = {
  vercel: 'https://vercel.com/dashboard/usage',
  neon: 'https://console.neon.tech',
};

const LABELS: Record<PlatformProviderId, string> = { vercel: 'Vercel', neon: 'Neon' };

/** 必填的密钥字段，用于生成尾号提示。 */
const SECRET_FIELD: Record<PlatformProviderId, string> = { vercel: 'token', neon: 'apiKey' };

export const FIELD_SPECS: Record<PlatformProviderId, PlatformConfigFieldSpec[]> = {
  vercel: [
    {
      key: 'token',
      label: 'Access Token',
      placeholder: 'vercel_xxxxxxxx',
      hint: 'Vercel → Account Settings → Tokens 创建。Token 只在服务端使用，保存后不会回显。',
      required: true,
      secret: true,
    },
    {
      key: 'teamId',
      label: 'Team ID / 团队 slug（团队账户必填）',
      placeholder: 'team_xxxxxxxx 或 my-team-projects',
      hint: '个人账户留空。团队账户填 Team Settings → General 的 Team ID（team_ 开头），或部署地址里的团队 slug。',
      required: false,
      secret: false,
    },
  ],
  neon: [
    {
      key: 'apiKey',
      label: 'API Key',
      placeholder: 'napi_xxxxxxxx',
      hint: 'Neon Console → Account settings → API keys 创建，建议使用不过期的密钥。',
      required: true,
      secret: true,
    },
    {
      key: 'organizationId',
      label: 'Organization ID（可选）',
      placeholder: 'org-xxxxxxxx',
      hint: '只属于一个组织时可以留空，系统会自动识别。',
      required: false,
      secret: false,
    },
    {
      key: 'projectId',
      label: 'Project ID（可选）',
      placeholder: 'xxxxxxxx-123456',
      hint: '留空则检查前若干个项目，按用量最高的那个计算百分比。',
      required: false,
      secret: false,
    },
  ],
};

export function providerEnabled(environment: PlatformEnvironment, provider: PlatformProviderId): boolean {
  return provider === 'vercel' ? environment.vercel : environment.neon;
}

function bodyOf(req: VercelRequest): Record<string, unknown> {
  const raw: unknown = req.body;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function parseMetrics(value: unknown): PlatformMetric[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  const metrics: PlatformMetric[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.key !== 'string' || typeof record.label !== 'string') continue;
    if (typeof record.used !== 'number' || !Number.isFinite(record.used)) continue;
    const limit = typeof record.limit === 'number' && Number.isFinite(record.limit) ? record.limit : null;
    metrics.push({
      key: record.key,
      label: record.label,
      used: record.used,
      limit,
      unit: typeof record.unit === 'string' ? record.unit : '',
      percent: typeof record.percent === 'number' && Number.isFinite(record.percent) ? record.percent : null,
      note: typeof record.note === 'string' && record.note ? record.note : undefined,
      series: parseSeries(record.series),
    });
  }
  return metrics;
}

function parseSeries(value: unknown): ForecastPoint[] {
  if (!Array.isArray(value)) return [];
  const points: ForecastPoint[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const date = typeof record.date === 'string' ? record.date : null;
    const point = typeof record.value === 'number' && Number.isFinite(record.value) ? record.value : null;
    if (!date || point == null) continue;
    points.push({ date, value: point });
  }
  return points;
}

/**
 * 留空时的免费版默认上限。
 *
 * Vercel 只有官方 Hobby 文档明确写过的那两项有默认值（Fast Data Transfer 100 GB、
 * Provisioned Memory 360 GB-hrs）；接口本身不返回任何上限，其余指标一律留空，
 * 由管理员按控制台填。
 */
const DEFAULT_LIMITS: Record<PlatformProviderId, Record<string, number>> = {
  vercel: {
    bandwidth_outgoing: 100,
    function_gb_hours: 360,
    active_cpu: 4,
  },
  neon: {
    storage: NEON_FREE_LIMITS.storageBytes / 1_000_000_000,
    compute: NEON_FREE_LIMITS.computeCuHours,
    egress: NEON_FREE_LIMITS.transferBytes / 1_000_000_000,
  },
};

function percentOf(used: number, limit: number | null): number | null {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return null;
  return Number(((used / limit) * 100).toFixed(2));
}

/**
 * 把「上限」和「预测」套到读数上。
 *
 * 上限优先级：用户手填 > 免费版默认值 > 读数自带的（接口基本不给）。
 * 预测放在这里而不是刷新时算，是为了改上限能立刻看到新的天数，不必再等一次刷新。
 */
function decorateMetrics(
  provider: PlatformProviderId,
  metrics: PlatformMetric[],
  config: StoredPlatformConfig | null,
  snapshot: StoredPlatformSnapshot | null,
  now: number,
  history: Record<string, ForecastPoint[]>,
): PlatformMetric[] {
  const defaults = DEFAULT_LIMITS[provider];
  const overrides = config?.limits ?? {};
  const decorated: PlatformMetric[] = metrics.map((metric) => {
    const limit = overrides[metric.key] ?? defaults[metric.key] ?? metric.limit ?? null;
    // 平台自己给的日桶可以直接用；没有的话退回我们自己记的采样——
    // 那是累计值，必须先换算成日均速度。
    const series = metric.series?.length ? metric.series : cumulativeToDailyRates(history[metric.key] ?? []);
    return {
      key: metric.key,
      label: metric.label,
      used: metric.used,
      limit,
      unit: metric.unit,
      percent: percentOf(metric.used, limit),
      note: metric.note,
      forecast: forecastUsage({
        used: metric.used,
        limit,
        series,
        periodStart: snapshot?.periodStart ?? null,
        periodEnd: snapshot?.periodEnd ?? null,
        now,
      }),
    };
  });

  // 手工录入的指标没有序列，只算占比，不编造趋势。
  for (const item of config?.custom ?? []) {
    // 手工指标的序列来自我们自己记的历史：每次保存都会落一个采样点，
    // 于是「每隔几天更新一次数字」也能积累出速度，进而算出还剩几天。
    const series = cumulativeToDailyRates(history[item.key] ?? []);
    decorated.push({
      key: item.key,
      label: item.label,
      used: item.used,
      limit: item.limit,
      unit: item.unit,
      percent: percentOf(item.used, item.limit),
      note: '手工录入',
      forecast: forecastUsage({
        used: item.used,
        limit: item.limit,
        series,
        periodStart: snapshot?.periodStart ?? null,
        periodEnd: snapshot?.periodEnd ?? null,
        now,
      }),
    });
  }
  return decorated;
}

const KNOWN_STATUSES: readonly PlatformStatus[] = [
  'ok',
  'warning',
  'critical',
  'unconfigured',
  'unsupported',
  'credential_error',
  'rate_limited',
  'error',
];

/** 这几个状态是由读数推出来的，套上上限后需要重算；其余是失败态，原样保留。 */
const DATA_STATUSES: readonly PlatformStatus[] = ['ok', 'warning', 'critical'];

function toSnapshot(provider: PlatformProviderId, stored: StoredPlatformSnapshot): PlatformProviderSnapshot {
  const status = KNOWN_STATUSES.includes(stored.status) ? stored.status : 'error';
  return {
    provider,
    label: LABELS[provider],
    status,
    message: stored.message,
    observedAt: stored.observedAt,
    periodStart: stored.periodStart,
    periodEnd: stored.periodEnd,
    metrics: parseMetrics(stored.metrics),
    consoleUrl: stored.consoleUrl || CONSOLE_URLS[provider],
    source: stored.source,
    accountLabel: stored.accountLabel,
    stale: stored.stale,
  };
}

async function buildProviderView(provider: PlatformProviderId, enabled: boolean): Promise<PlatformProviderView> {
  if (!enabled) {
    return {
      provider,
      enabled: false,
      configured: false,
      hint: null,
      updatedAt: null,
      nextRefreshInSeconds: 0,
      limits: {},
      custom: [],
      fields: FIELD_SPECS[provider],
      consoleUrl: CONSOLE_URLS[provider],
      snapshot: null,
    };
  }
  const [stored, snapshot] = await Promise.all([readPlatformConfig(provider), readPlatformSnapshot(provider)]);
  const configured = Boolean(stored && Object.keys(stored.fields).length > 0);
  const now = Date.now();
  const base = configured && snapshot ? toSnapshot(provider, snapshot) : null;
  const history = configured ? await readUsageHistory(provider, now - HISTORY_RETENTION_MS) : {};
  // 上限与预测都在视图层套用：改上限能立刻反映到天数上，不必等下一次刷新。
  const decorated = base ? decorateMetrics(provider, base.metrics, stored, snapshot, now, history) : null;
  const view =
    base && decorated
      ? {
          ...base,
          metrics: decorated,
          // 百分比变了，状态要跟着重算；失败态（凭据错误等）保持原样。
          status: DATA_STATUSES.includes(base.status) ? statusFromMetrics(decorated) : base.status,
        }
      : null;
  return {
    provider,
    enabled: true,
    configured,
    hint: configured ? stored?.hint || null : null,
    updatedAt: stored?.updatedAt ?? null,
    nextRefreshInSeconds: remainingCooldownSeconds(snapshot?.updatedAt, now),
    limits: stored?.limits ?? {},
    custom: stored?.custom ?? [],
    fields: FIELD_SPECS[provider],
    consoleUrl: snapshot?.consoleUrl || CONSOLE_URLS[provider],
    // 未配置时不回放历史快照，避免清除凭据后仍显示旧数字。
    snapshot: view,
  };
}

export async function buildPlatformUsagePayload(): Promise<PlatformUsagePayload> {
  const environment = detectPlatformEnvironment();
  const providers: PlatformProviderView[] = [];
  for (const provider of ['vercel', 'neon'] as const) {
    const enabled = providerEnabled(environment, provider);
    if (!enabled) continue;
    providers.push(await buildProviderView(provider, true));
  }
  return {
    ok: true,
    environment: { runtime: environment.runtime, database: environment.database, local: environment.local },
    providers,
  };
}

async function requireSuperAdmin(req: VercelRequest, res: VercelResponse) {
  const actor = await requireActor(req, res);
  if (!actor) return null;
  if (!actor.permissions.includes('*')) {
    res.status(403).json({ ok: false, code: 'PERMISSION_DENIED', error: '仅超级管理员可查看平台额度' });
    return null;
  }
  return actor;
}

async function selfMeasuredDatabaseBytes(): Promise<number | null> {
  try {
    const rows = await authSql()`SELECT pg_database_size(current_database())::bigint AS size`;
    const raw = rows[0]?.size;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function handlePlatformUsage(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;
  try {
    res.json(await buildPlatformUsagePayload());
  } catch (error) {
    sendDatabaseError(req, res, error, 'read');
  }
}

export async function handlePlatformUsageConfig(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const body = bodyOf(req);
  const provider = body.provider;
  if (!isPlatformProviderId(provider)) {
    res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: '未知的平台标识' });
    return;
  }
  const environment = detectPlatformEnvironment();
  if (!providerEnabled(environment, provider)) {
    res.status(400).json({ ok: false, code: 'PLATFORM_DISABLED', error: '当前部署未启用该平台' });
    return;
  }

  try {
    await ensurePlatformUsageTables();
    if (body.action === 'clear') {
      await clearPlatformConfig(provider);
      res.json(await buildPlatformUsagePayload());
      return;
    }

    const rawValues = body.values;
    const values =
      rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues)
        ? (rawValues as Record<string, unknown>)
        : {};
    const specs = FIELD_SPECS[provider];
    const provided = specs.filter((spec) => Object.prototype.hasOwnProperty.call(values, spec.key));

    // 上限与手工指标都整体替换：留空的条目直接消失，即回落到免费版默认值。
    const hasLimits = Boolean(body.limits && typeof body.limits === 'object' && !Array.isArray(body.limits));
    const hasCustom = Array.isArray(body.custom);
    if (!provided.length && !hasLimits && !hasCustom) {
      res.status(400).json({ ok: false, code: 'NO_FIELDS', error: '没有需要保存的内容' });
      return;
    }

    const secret = await encryptionSecret();
    const existing = await readPlatformConfig(provider);
    const fields: Record<string, string> = { ...(existing?.fields ?? {}) };

    for (const spec of provided) {
      const raw = String(values[spec.key] ?? '').trim();
      if (!raw) {
        if (!spec.required) delete fields[spec.key];
        continue;
      }
      if (raw.length > 4096) {
        res.status(400).json({ ok: false, code: 'FIELD_TOO_LONG', error: `${spec.label} 过长` });
        return;
      }
      fields[spec.key] = encryptSecret(raw, secret);
    }

    // 只改上限/手工指标时不必重填凭据，所以必填校验只在本次提交了凭据字段时做。
    if (provided.length) {
      for (const spec of specs) {
        if (spec.required && !fields[spec.key]) {
          res.status(400).json({ ok: false, code: 'FIELD_REQUIRED', error: `请填写${spec.label}` });
          return;
        }
      }
    }

    const limits: Record<string, number> = hasLimits ? {} : { ...(existing?.limits ?? {}) };
    if (hasLimits) {
      for (const [key, value] of Object.entries(body.limits as Record<string, unknown>)) {
        const metricKey = key.trim().slice(0, 64);
        if (!metricKey) continue;
        const raw = typeof value === 'string' ? value.trim() : value;
        if (raw === '' || raw == null) continue; // 留空 = 用免费版默认值
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          res.status(400).json({ ok: false, code: 'INVALID_LIMIT', error: `上限必须是大于 0 的数字（${metricKey}）` });
          return;
        }
        limits[metricKey] = parsed;
      }
    }

    const custom: PlatformCustomMetric[] = [];
    if (hasCustom) {
      for (const item of (body.custom as unknown[]).slice(0, 20)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const label = String(record.label ?? '').trim();
        if (!label) continue;
        const used = Number(record.used);
        if (!Number.isFinite(used) || used < 0) {
          res.status(400).json({ ok: false, code: 'INVALID_METRIC', error: `自定义指标「${label}」的已用量无效` });
          return;
        }
        const limitRaw = record.limit;
        const limitValue = limitRaw === '' || limitRaw == null ? null : Number(limitRaw);
        if (limitValue != null && (!Number.isFinite(limitValue) || limitValue <= 0)) {
          res.status(400).json({ ok: false, code: 'INVALID_METRIC', error: `自定义指标「${label}」的上限无效` });
          return;
        }
        custom.push({
          // 稳定的 key 由前端生成，跨多次保存保持不变，历史采样才能连成一条线。
          key: (String(record.key ?? '').trim() || `custom_${custom.length + 1}`).slice(0, 64),
          label: label.slice(0, 80),
          used,
          unit: String(record.unit ?? '')
            .trim()
            .slice(0, 12),
          limit: limitValue,
        });
      }
    }

    const secretPlain = decryptSecret(fields[SECRET_FIELD[provider]] ?? '', secret) ?? '';
    const finalCustom = hasCustom ? custom : (existing?.custom ?? []);
    await writePlatformConfig(provider, fields, secretHint(secretPlain), actor.id, {
      limits,
      custom: finalCustom,
    });
    // 手工指标没有外部来源，每保存一次就落一个采样点，攒够几天就能算趋势。
    if (hasCustom && finalCustom.length) {
      await recordUsageHistory(
        provider,
        finalCustom.map((item) => ({ metricKey: item.key, used: item.used })),
        Date.now(),
      );
    }
    res.json(await buildPlatformUsagePayload());
  } catch (error) {
    sendDatabaseError(req, res, error, 'write');
  }
}

function mergeWithPrevious(
  current: PlatformProviderSnapshot,
  previous: StoredPlatformSnapshot | null,
): Omit<StoredPlatformSnapshot, 'updatedAt'> {
  // 本次没有拿到新读数（失败/限流/不支持）时，保留上一次成功读数并标记过期。
  if (current.observedAt == null && previous && previous.observedAt != null && previous.status !== 'unsupported') {
    const carried = parseMetrics(previous.metrics);
    if (carried.length) {
      return {
        status: current.status,
        message: current.message,
        observedAt: previous.observedAt,
        periodStart: previous.periodStart,
        periodEnd: previous.periodEnd,
        metrics: carried,
        consoleUrl: current.consoleUrl || previous.consoleUrl,
        source: previous.source || current.source,
        accountLabel: current.accountLabel ?? previous.accountLabel,
        stale: true,
      };
    }
  }
  return {
    status: current.status,
    message: current.message,
    observedAt: current.observedAt,
    periodStart: current.periodStart,
    periodEnd: current.periodEnd,
    metrics: current.metrics,
    consoleUrl: current.consoleUrl,
    source: current.source,
    accountLabel: current.accountLabel,
    stale: false,
  };
}

export async function handlePlatformUsageRefresh(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const body = bodyOf(req);
  const provider = body.provider;
  if (!isPlatformProviderId(provider)) {
    res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: '未知的平台标识' });
    return;
  }
  const environment = detectPlatformEnvironment();
  if (!providerEnabled(environment, provider)) {
    res.status(400).json({ ok: false, code: 'PLATFORM_DISABLED', error: '当前部署未启用该平台' });
    return;
  }

  try {
    const stored = await readPlatformConfig(provider);
    if (!stored || !Object.keys(stored.fields).length) {
      res.status(400).json({ ok: false, code: 'NOT_CONFIGURED', error: '请先完成平台凭据设置' });
      return;
    }

    const previous = await readPlatformSnapshot(provider);
    const now = Date.now();
    if (previous && remainingCooldownSeconds(previous.updatedAt, now) > 0) {
      const retryAfterSeconds = remainingCooldownSeconds(previous.updatedAt, now);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res
        .status(429)
        .json({ ok: false, code: 'REFRESH_TOO_SOON', error: '刷新过于频繁，请稍后再试', retryAfterSeconds });
      return;
    }

    const outcome = await refreshProvider(provider, now);
    if (isRefreshFailure(outcome)) {
      res.status(outcome.status).json({ ok: false, code: outcome.code, error: outcome.message });
      return;
    }
    res.json(await buildPlatformUsagePayload());
  } catch (error) {
    sendDatabaseError(req, res, error, 'write');
  }
}

type RefreshFailure = { ok: false; status: number; code: string; message: string };
type RefreshOutcome = { ok: true } | RefreshFailure;

/** 本仓库 api 的 tsconfig 未开 strictNullChecks，布尔判别联合要靠显式谓词收窄。 */
function isRefreshFailure(outcome: RefreshOutcome): outcome is RefreshFailure {
  return outcome.ok === false;
}

/**
 * 真正拉一次外部读数并落库的共用逻辑：手动刷新与定时采样走同一条路径，
 * 因此定时采样同样受 60 秒冷却约束，不会因为被反复调用而烧掉免费额度。
 */
async function refreshProvider(provider: PlatformProviderId, now: number): Promise<RefreshOutcome> {
  const stored = await readPlatformConfig(provider);
  if (!stored || !Object.keys(stored.fields).length) {
    return { ok: false, status: 400, code: 'NOT_CONFIGURED', message: '请先完成平台凭据设置' };
  }

  const previous = await readPlatformSnapshot(provider);
  if (previous && remainingCooldownSeconds(previous.updatedAt, now) > 0) {
    return { ok: false, status: 429, code: 'REFRESH_TOO_SOON', message: '刷新过于频繁，请稍后再试' };
  }

  const secret = await encryptionSecret();
  const plain = (key: string): string | null => {
    const encrypted = stored.fields[key];
    if (!encrypted) return null;
    return decryptSecret(encrypted, secret);
  };

  let snapshot: PlatformProviderSnapshot;
  if (provider === 'vercel') {
    const token = plain('token');
    if (!token) {
      return { ok: false, status: 400, code: 'CREDENTIAL_UNREADABLE', message: 'Vercel Token 无法解密，请重新填写' };
    }
    snapshot = await collectVercelUsage({ token, teamId: plain('teamId') ?? undefined, now });
  } else {
    const apiKey = plain('apiKey');
    if (!apiKey) {
      return { ok: false, status: 400, code: 'CREDENTIAL_UNREADABLE', message: 'Neon API Key 无法解密，请重新填写' };
    }
    snapshot = await collectNeonUsage({
      apiKey,
      organizationId: plain('organizationId') ?? undefined,
      projectId: plain('projectId') ?? undefined,
      selfMeasuredStorageBytes: await selfMeasuredDatabaseBytes(),
      now,
    });
  }

  await writePlatformSnapshot(provider, mergeWithPrevious(snapshot, previous));
  // 记一次历史：平台不给序列的指标（Neon 存储）靠它算趋势。
  await recordUsageHistory(
    provider,
    snapshot.metrics.map((metric) => ({ metricKey: metric.key, used: metric.used })),
    now,
  );
  return { ok: true };
}

/** 定时采样入口（Vercel Cron 每天调一次）。只读外部接口，写入的是我们自己两张表。 */
export async function handlePlatformUsageWorker(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  const secret = (process.env.PLATFORM_USAGE_WORKER_SECRET ?? '').trim();
  if (secret) {
    const bearer = String(req.headers.authorization ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    const header = String(req.headers['x-cron-secret'] ?? '').trim();
    if (bearer !== secret && header !== secret) {
      res.status(401).json({ ok: false, code: 'WORKER_UNAUTHORIZED', error: '采样 worker 密钥不正确' });
      return;
    }
  }

  try {
    const environment = detectPlatformEnvironment();
    const now = Date.now();
    const refreshed: string[] = [];
    const skipped: Array<{ provider: string; reason: string }> = [];
    for (const provider of ['vercel', 'neon'] as const) {
      if (!providerEnabled(environment, provider)) continue;
      const outcome = await refreshProvider(provider, now);
      if (outcome.ok) refreshed.push(provider);
      else if (isRefreshFailure(outcome)) skipped.push({ provider, reason: outcome.code });
    }
    res.json({ ok: true, refreshed, skipped });
  } catch (error) {
    sendDatabaseError(req, res, error, 'write');
  }
}
