// 平台额度功能的持久化层：凭据（加密）与读数快照。
//
// 两张表都用 provider 作主键，天然按平台隔离；DDL 走模块级 Promise 缓存，
// 与 api/_exams/db.ts、api/_auth/db.ts 的做法一致。
import type { DbClient } from '../_dbAdapter.js';
import { authSql, ensureAuthTables } from '../_auth.js';
import {
  isPlatformProviderId,
  type PlatformCustomMetric,
  type PlatformProviderId,
  type PlatformStatus,
} from './types.js';
import type { ForecastPoint } from './forecast.js';

/** 历史采样保留 90 天：够看趋势，又不至于把表撑大。 */
export const HISTORY_RETENTION_MS = 90 * 86_400_000;

export type StoredPlatformConfig = {
  /** 字段名 → 密文（`v1.iv.tag.ct`）。 */
  fields: Record<string, string>;
  /** 主密钥字段的尾号提示，用于「已配置」展示。 */
  hint: string;
  /** 指标上限覆盖值（非密钥，明文存）。 */
  limits: Record<string, number>;
  /** 手工录入的指标。 */
  custom: PlatformCustomMetric[];
  updatedAt: number;
};

export type StoredPlatformSnapshot = {
  status: PlatformStatus;
  message: string;
  observedAt: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  metrics: unknown[];
  consoleUrl: string;
  source: string;
  accountLabel: string | null;
  /** 本次刷新失败、显示的是上一次成功读数时为 true。 */
  stale: boolean;
  updatedAt: number;
};

let ensurePromise: Promise<void> | null = null;

export function ensurePlatformUsageTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql: DbClient = authSql();
      await sql`
        CREATE TABLE IF NOT EXISTS platform_usage_config (
          provider TEXT PRIMARY KEY,
          fields JSONB NOT NULL DEFAULT '{}',
          hint TEXT NOT NULL DEFAULT '',
          extra JSONB NOT NULL DEFAULT '{}',
          updated_by BIGINT,
          updated_at BIGINT NOT NULL
        )
      `;
      await sql`ALTER TABLE platform_usage_config ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'`;
      // 我们自己记的采样：平台不给序列的指标（Neon 存储）只能靠它算趋势。
      await sql`
        CREATE TABLE IF NOT EXISTS platform_usage_history (
          provider TEXT NOT NULL,
          metric_key TEXT NOT NULL,
          observed_at BIGINT NOT NULL,
          used DOUBLE PRECISION NOT NULL,
          PRIMARY KEY (provider, metric_key, observed_at)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_platform_usage_history_recent
        ON platform_usage_history (provider, observed_at DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS platform_usage_snapshots (
          provider TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          observed_at BIGINT,
          period_start TEXT,
          period_end TEXT,
          metrics JSONB NOT NULL DEFAULT '[]',
          console_url TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          account_label TEXT,
          stale BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at BIGINT NOT NULL
        )
      `;
      await sql`
        ALTER TABLE platform_usage_snapshots ADD COLUMN IF NOT EXISTS stale BOOLEAN NOT NULL DEFAULT FALSE
      `;
    })().catch((error) => {
      // 失败后清掉缓存，下一个请求会重新尝试建表。
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* 非法 JSON 视为空对象 */
    }
  }
  return {};
}

function asStringArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* 同上 */
    }
  }
  return [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** 加密用的密钥：复用已有的鉴权密钥，不引入新的环境变量。 */
export async function encryptionSecret(): Promise<string> {
  await ensureAuthTables();
  const rows = await authSql()`SELECT token_secret FROM app_auth WHERE id=1 LIMIT 1`;
  const secret = rows[0]?.token_secret;
  if (typeof secret !== 'string' || !secret) throw new Error('PLATFORM_USAGE_NO_SECRET');
  return secret;
}

export async function readPlatformConfig(provider: PlatformProviderId): Promise<StoredPlatformConfig | null> {
  await ensurePlatformUsageTables();
  const rows =
    await authSql()`SELECT fields, hint, extra, updated_at FROM platform_usage_config WHERE provider=${provider} LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(asObject(row.fields))) {
    if (typeof value === 'string') fields[key] = value;
  }
  const extra = asObject(row.extra);
  const limits: Record<string, number> = {};
  for (const [key, value] of Object.entries(asObject(extra.limits))) {
    const parsed = toNumber(value);
    if (parsed != null && parsed > 0) limits[key] = parsed;
  }
  const custom: PlatformCustomMetric[] = [];
  for (const item of asStringArray(extra.custom)) {
    const record = asObject(item);
    const used = toNumber(record.used);
    if (typeof record.label !== 'string' || !record.label.trim() || used == null) continue;
    const limit = toNumber(record.limit);
    custom.push({
      key: typeof record.key === 'string' && record.key ? record.key : `custom_${custom.length + 1}`,
      label: record.label.trim().slice(0, 80),
      used: Math.max(0, used),
      unit: typeof record.unit === 'string' ? record.unit.trim().slice(0, 12) : '',
      limit: limit != null && limit > 0 ? limit : null,
    });
  }
  return {
    fields,
    hint: typeof row.hint === 'string' ? row.hint : '',
    limits,
    custom,
    updatedAt: toNumber(row.updated_at) ?? 0,
  };
}

export async function writePlatformConfig(
  provider: PlatformProviderId,
  fields: Record<string, string>,
  hint: string,
  actorId: number,
  extra: { limits: Record<string, number>; custom: PlatformCustomMetric[] },
): Promise<void> {
  await ensurePlatformUsageTables();
  const now = Date.now();
  await authSql()`
    INSERT INTO platform_usage_config (provider, fields, hint, extra, updated_by, updated_at)
    VALUES (
      ${provider}, ${JSON.stringify(fields)}::jsonb, ${hint},
      ${JSON.stringify({ limits: extra.limits, custom: extra.custom })}::jsonb, ${actorId}, ${now}
    )
    ON CONFLICT (provider) DO UPDATE SET
      fields = EXCLUDED.fields,
      hint = EXCLUDED.hint,
      extra = EXCLUDED.extra,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function clearPlatformConfig(provider: PlatformProviderId): Promise<void> {
  await ensurePlatformUsageTables();
  await authSql()`DELETE FROM platform_usage_config WHERE provider=${provider}`;
}

/** 记录一次读数（累计值）。同一时刻重复写就覆盖，避免重复刷新堆出重复点。 */
export async function recordUsageHistory(
  provider: PlatformProviderId,
  points: Array<{ metricKey: string; used: number }>,
  now: number,
): Promise<void> {
  const valid = points.filter((point) => point.metricKey && Number.isFinite(point.used));
  if (!valid.length) return;
  await ensurePlatformUsageTables();
  const sql = authSql();
  await sql.transaction((tx) =>
    valid.map(
      (point) =>
        tx`INSERT INTO platform_usage_history (provider, metric_key, observed_at, used)
           VALUES (${provider}, ${point.metricKey}, ${now}, ${point.used})
           ON CONFLICT (provider, metric_key, observed_at) DO UPDATE SET used = EXCLUDED.used`,
    ),
  );
  // 顺手清掉过期点：一次删除比定时任务简单，也不会让表无限增长。
  await sql`DELETE FROM platform_usage_history WHERE provider=${provider} AND observed_at < ${now - HISTORY_RETENTION_MS}`;
}

/** 读回某个平台的全部历史采样，按指标分组。 */
export async function readUsageHistory(
  provider: PlatformProviderId,
  sinceMs: number,
): Promise<Record<string, ForecastPoint[]>> {
  await ensurePlatformUsageTables();
  const rows = await authSql()`
    SELECT metric_key, observed_at, used FROM platform_usage_history
    WHERE provider=${provider} AND observed_at >= ${sinceMs}
    ORDER BY observed_at ASC
  `;
  const grouped: Record<string, ForecastPoint[]> = {};
  for (const row of rows) {
    const key = typeof row.metric_key === 'string' ? row.metric_key : '';
    const at = toNumber(row.observed_at);
    const used = toNumber(row.used);
    if (!key || at == null || used == null) continue;
    const list = grouped[key] ?? [];
    list.push({ date: new Date(at).toISOString(), value: used });
    grouped[key] = list;
  }
  return grouped;
}

export async function readPlatformSnapshot(provider: PlatformProviderId): Promise<StoredPlatformSnapshot | null> {
  await ensurePlatformUsageTables();
  const rows = await authSql()`
    SELECT status, message, observed_at, period_start, period_end, metrics, console_url, source, account_label, stale, updated_at
    FROM platform_usage_snapshots WHERE provider=${provider} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const status = typeof row.status === 'string' ? row.status : 'error';
  if (!isPlatformProviderId(provider)) return null;
  return {
    status: status as PlatformStatus,
    message: typeof row.message === 'string' ? row.message : '',
    observedAt: toNumber(row.observed_at),
    periodStart: toNullableString(row.period_start),
    periodEnd: toNullableString(row.period_end),
    metrics: asStringArray(row.metrics),
    consoleUrl: typeof row.console_url === 'string' ? row.console_url : '',
    source: typeof row.source === 'string' ? row.source : '',
    accountLabel: toNullableString(row.account_label),
    stale: row.stale === true,
    updatedAt: toNumber(row.updated_at) ?? 0,
  };
}

export async function writePlatformSnapshot(
  provider: PlatformProviderId,
  snapshot: Omit<StoredPlatformSnapshot, 'updatedAt'>,
): Promise<void> {
  await ensurePlatformUsageTables();
  const now = Date.now();
  await authSql()`
    INSERT INTO platform_usage_snapshots (
      provider, status, message, observed_at, period_start, period_end, metrics, console_url, source, account_label, stale, updated_at
    ) VALUES (
      ${provider}, ${snapshot.status}, ${snapshot.message}, ${snapshot.observedAt}, ${snapshot.periodStart}, ${snapshot.periodEnd},
      ${JSON.stringify(snapshot.metrics)}::jsonb, ${snapshot.consoleUrl}, ${snapshot.source}, ${snapshot.accountLabel},
      ${snapshot.stale}, ${now}
    )
    ON CONFLICT (provider) DO UPDATE SET
      status = EXCLUDED.status,
      message = EXCLUDED.message,
      observed_at = EXCLUDED.observed_at,
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      metrics = EXCLUDED.metrics,
      console_url = EXCLUDED.console_url,
      source = EXCLUDED.source,
      account_label = EXCLUDED.account_label,
      stale = EXCLUDED.stale,
      updated_at = EXCLUDED.updated_at
  `;
}
