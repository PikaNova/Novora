// 系统相关 Serverless 函数合并：/api/health、/api/status、/api/email-worker、
// /api/diagnostic-worker、/api/time、/api/update-check、/api/redeploy 七个 URL
// 通过 vercel.json rewrites 指向本文件（?sys=...），合并为一个函数以符合 Vercel Hobby
// “单次部署最多 12 个 Serverless Functions”的上限；各 URL 的行为与响应契约不变。
// 兼容纯本地化部署：服务器信息全部来自 Node 运行时，不依赖 Vercel 专属能力。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'node:fs';
import { cpus, freemem, hostname, loadavg, totalmem } from 'node:os';
import { authSql, ensureAuthTables, isAdminRecoveryConfigured, requireActor } from './_auth.js';
import { ensureTableOnce } from './_exams/db.js';
import { assertRows, rowShape, isString, isDatabaseInt8, type DatabaseInt8 } from './_validation.js';
import { requestId, sendDatabaseError } from './_apiError.js';
import { loadSmtpConfig } from './_emailAuth.js';
import { drainOutbox } from './_emailQueue.js';
import { clampDrainLimit, drainDiagnosticQueue, readDiagnosticQueueStats } from './_diagnosticQueue.js';
import { readSchemaMigrationState, type SchemaMigrationState } from './_schemaMigration.js';
import { resolveSubRoute } from './_routeMatch.js';
import { handleTime } from './_system/time.js';
import { handleUpdateCheck } from './_system/updateCheck.js';
import { handleRedeploy } from './_system/redeploy.js';
import { resolveBuildCommit } from './_buildInfo.js';

let cachedVersion: string | null = null;
function readVersionFrom(url: URL): string | null {
  try {
    const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : null;
  } catch {
    return null;
  }
}
function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  cachedVersion =
    readVersionFrom(new URL('../package.json', import.meta.url)) ??
    readVersionFrom(new URL('../../package.json', import.meta.url)) ??
    readVersionFrom(new URL('file://' + process.cwd().replace(/\\/g, '/') + '/package.json')) ??
    'unknown';
  return cachedVersion;
}

/** 本入口承载的全部对外路由（rewrite 别名 → 查询串里的 sys）。 */
const SYSTEM_ROUTES = [
  'health',
  'status',
  'email-worker',
  'diagnostic-worker',
  'time',
  'update-check',
  'redeploy',
] as const;

function sysRoute(req: VercelRequest): string {
  return resolveSubRoute(req, 'sys', SYSTEM_ROUTES);
}

const isCountRow = rowShape<{ count: number }>({ count: (v): v is number => typeof v === 'number' });
const isTableRow = rowShape<{ table_name: string }>({ table_name: isString });
const isStatusRow = rowShape<{ status: string; n: number }>({
  status: isString,
  n: (v): v is number => typeof v === 'number',
});
const isThrottleRow = rowShape<{ last_sent_at: number | string }>({
  last_sent_at: (v): v is number | string => typeof v === 'number' || typeof v === 'string',
});
const isErrorRow = rowShape<{ last_error: string }>({ last_error: isString });
const isEventRow = rowShape<{
  username: string;
  action: string;
  resource_type: string;
  detail: unknown;
  created_at: DatabaseInt8;
}>({
  username: isString,
  action: isString,
  resource_type: isString,
  detail: (_v): _v is unknown => true,
  created_at: isDatabaseInt8,
});

const CORE_TABLES = [
  'app_auth',
  'app_users',
  'app_roles',
  'email_config',
  'email_outbox',
  'write_throttle',
  'exam_records',
  'exam_record_operations',
  'app_schema_versions',
];
const REQUIRED_TABLES = [
  'app_auth',
  'app_roles',
  'app_users',
  'app_user_scopes',
  'app_audit_logs',
  'email_config',
  'email_verification_codes',
  'email_outbox',
  'mail_throttle',
  'write_throttle',
  'device_instances',
  'classisland_plugin_instances',
  'device_commands',
  'exam_records',
  'exam_record_operations',
  'app_schema_versions',
  'app_schema_migration_logs',
  'app_diagnostic_settings',
  'app_diagnostic_bundles',
];

function smtpPresetOf(host: string): 'qq' | '163' | 'custom' {
  const h = host.toLowerCase();
  if (h.includes('qq.com')) return 'qq';
  if (h.includes('163.com')) return '163';
  return 'custom';
}

// ── /api/health（公开） ─────────────────────────────────────────────
async function handleHealth(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  try {
    const started = Date.now();
    await ensureTableOnce();
    await ensureAuthTables();
    await authSql()`SELECT 1`;
    const latencyMs = Date.now() - started;
    const tables = assertRows(
      await authSql()`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY(${CORE_TABLES})`,
      isTableRow,
      'information_schema',
    );
    const present = new Set(tables.map((row) => row.table_name));
    const missingTables = CORE_TABLES.filter((name) => !present.has(name));
    const pendingRows = assertRows(
      await authSql()`SELECT COUNT(*)::int AS count FROM email_outbox WHERE status='pending' AND next_attempt_at <= ${Date.now()}`,
      isCountRow,
      'email_outbox',
    );
    const schemaState = await readSchemaMigrationState(authSql());
    const schemaOk = missingTables.length === 0 && schemaState.matches;
    const backedUp = Number(pendingRows[0]?.count ?? 0) > 20;
    res.status(schemaOk ? 200 : 503).json({
      ok: schemaOk,
      status: schemaOk ? 'ok' : 'degraded',
      version: appVersion(),
      commit: resolveBuildCommit(),
      serverTime: new Date().toISOString(),
      latencyMs,
      schemaVersion: schemaState.version,
      schemaVersions: schemaState.versions,
      schemaMigrations: schemaState.migrations,
      checks: { db: 'ok', schema: schemaOk ? 'ok' : 'mismatch', mailQueue: backedUp ? 'backed_up' : 'ok' },
    });
  } catch (error) {
    sendDatabaseError(req, res, error, 'read');
  }
}

// ── /api/status（仅超管） ───────────────────────────────────────────
async function collectDatabase(): Promise<{
  reachable: boolean;
  latencyMs: number | null;
  schemaOk: boolean;
  missingTables: string[];
  writeThrottleNextAllowedAt: number | null;
  version: string | null;
  sizeBytes: number | null;
  tables: number | null;
  indexes: number | null;
  activeConnections: number | null;
  maxConnections: number | null;
  cacheHitRate: number | null;
  xactCommit: number | null;
  xactRollback: number | null;
  schemaVersion: number | null;
  schemaVersions: SchemaMigrationState['versions'];
  schemaMigrations: SchemaMigrationState['migrations'];
  error?: string;
}> {
  try {
    const started = Date.now();
    await ensureTableOnce();
    await ensureAuthTables();
    await authSql()`SELECT 1`;
    const latencyMs = Date.now() - started;
    const tables = assertRows(
      await authSql()`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY(${REQUIRED_TABLES})`,
      isTableRow,
      'information_schema',
    );
    const present = new Set(tables.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((name) => !present.has(name));
    const schemaState = await readSchemaMigrationState(authSql());
    const throttle = assertRows(
      await authSql()`SELECT next_allowed_at FROM write_throttle WHERE id=1`,
      rowShape<{ next_allowed_at: number | string }>({
        next_allowed_at: (v): v is number | string => typeof v === 'number' || typeof v === 'string',
      }),
      'write_throttle',
    );
    const [versionRows, sizeRows, countRows, connRows, statRows, xactRows] = await Promise.all([
      authSql()`SHOW server_version`,
      authSql()`SELECT pg_database_size(current_database())::bigint AS size`,
      authSql()`SELECT (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public') AS tables, (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname='public') AS indexes`,
      authSql()`SELECT (SELECT COUNT(*)::int FROM pg_stat_activity) AS active, (SELECT current_setting('max_connections')::int) AS maxconn`,
      authSql()`SELECT blks_hit::bigint AS hit, blks_read::bigint AS read FROM pg_stat_database WHERE datname=current_database()`,
      authSql()`SELECT xact_commit::bigint AS commit, xact_rollback::bigint AS rollback FROM pg_stat_database WHERE datname=current_database()`,
    ]);
    const isNum = (v: unknown): v is number => typeof v === 'number';
    const versionRow = assertRows(
      versionRows,
      rowShape<{ server_version: string }>({ server_version: isString }),
      'pg_version',
    )[0];
    const sizeRow = assertRows(
      sizeRows,
      rowShape<{ size: DatabaseInt8 }>({ size: isDatabaseInt8 }),
      'pg_database_size',
    )[0];
    const countRow = assertRows(
      countRows,
      rowShape<{ tables: number; indexes: number }>({ tables: isNum, indexes: isNum }),
      'pg_counts',
    )[0];
    const connRow = assertRows(
      connRows,
      rowShape<{ active: number; maxconn: number }>({ active: isNum, maxconn: isNum }),
      'pg_conns',
    )[0];
    const statRow = assertRows(
      statRows,
      rowShape<{ hit: DatabaseInt8; read: DatabaseInt8 }>({ hit: isDatabaseInt8, read: isDatabaseInt8 }),
      'pg_stat',
    )[0];
    const xactRow = assertRows(
      xactRows,
      rowShape<{ commit: DatabaseInt8; rollback: DatabaseInt8 }>({ commit: isDatabaseInt8, rollback: isDatabaseInt8 }),
      'pg_xact',
    )[0];
    const hit = Number(statRow?.hit ?? 0);
    const read = Number(statRow?.read ?? 0);
    const cacheHitRate = hit + read > 0 ? (hit / (hit + read)) * 100 : null;
    return {
      reachable: true,
      latencyMs,
      schemaOk: missingTables.length === 0 && schemaState.matches,
      missingTables,
      writeThrottleNextAllowedAt: throttle[0] ? Number(throttle[0].next_allowed_at) : null,
      version: versionRow?.server_version ?? null,
      sizeBytes: sizeRow ? Number(sizeRow.size) : null,
      tables: countRow?.tables ?? null,
      indexes: countRow?.indexes ?? null,
      activeConnections: connRow?.active ?? null,
      maxConnections: connRow?.maxconn ?? null,
      cacheHitRate,
      xactCommit: xactRow ? Number(xactRow.commit) : null,
      xactRollback: xactRow ? Number(xactRow.rollback) : null,
      schemaVersion: schemaState.version,
      schemaVersions: schemaState.versions,
      schemaMigrations: schemaState.migrations,
    };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: null,
      schemaOk: false,
      missingTables: [],
      writeThrottleNextAllowedAt: null,
      version: null,
      sizeBytes: null,
      tables: null,
      indexes: null,
      activeConnections: null,
      maxConnections: null,
      cacheHitRate: null,
      xactCommit: null,
      xactRollback: null,
      schemaVersion: null,
      schemaVersions: { auth: null, exams: null },
      schemaMigrations: [],
      error: String(error instanceof Error ? error.message : error).slice(0, 200),
    };
  }
}

// 用 process.cpuUsage() 的两次差值代替原来的 600ms 采样窗口：旧实现每次取样都要让函数
// 空转 600 毫秒，直接记进免费版的 GB-秒。取值含义改为“自上次取样以来的平均占用”。
let cpuUsageCache: { at: number; value: number | null } | null = null;
let lastCpuSample: { at: number; usage: NodeJS.CpuUsage } | null = null;

function cpuPercentBetweenSample(now: number): number | null {
  const usage = process.cpuUsage();
  const previous = lastCpuSample;
  lastCpuSample = { at: now, usage };
  const cores = Math.max(1, cpus().length);
  const clamp = (usedMs: number, capacityMs: number): number | null =>
    capacityMs > 0 ? Math.min(100, Math.max(0, (usedMs / capacityMs) * 100)) : null;
  if (previous && now > previous.at) {
    const usedMs = (usage.user - previous.usage.user + (usage.system - previous.usage.system)) / 1000;
    return clamp(usedMs, (now - previous.at) * cores);
  }
  // 冷启动后的第一次取样没有上一个基线，退回“进程启动至今的平均占用”。
  const totalMs = (usage.user + usage.system) / 1000;
  return clamp(totalMs, Math.max(1, process.uptime() * 1000) * cores);
}

async function currentCpuUsage(): Promise<number | null> {
  const now = Date.now();
  if (cpuUsageCache && now - cpuUsageCache.at < 5000) return cpuUsageCache.value;
  const value = cpuPercentBetweenSample(now);
  cpuUsageCache = { at: now, value };
  return value;
}

async function collectSystem(): Promise<{
  hostname: string;
  node: string;
  platform: string;
  arch: string;
  pid: number;
  uptimeSeconds: number;
  startedAt: number;
  memory: { rss: number; heapUsed: number; total: number; free: number };
  cpu: {
    model: string | null;
    cores: number;
    usagePercent: number | null;
    load1: number;
    load5: number;
    load15: number;
  };
  time: { iso: string; epochMs: number; timezone: string };
}> {
  const now = Date.now();
  const uptimeSeconds = Math.round(process.uptime());
  const cores = cpus();
  const load = loadavg();
  return {
    hostname: hostname(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    uptimeSeconds,
    startedAt: now - uptimeSeconds * 1000,
    memory: {
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      total: totalmem(),
      free: freemem(),
    },
    cpu: {
      model: cores[0]?.model ?? null,
      cores: cores.length,
      usagePercent: await currentCpuUsage(),
      load1: load[0] ?? 0,
      load5: load[1] ?? 0,
      load15: load[2] ?? 0,
    },
    time: {
      iso: new Date(now).toISOString(),
      epochMs: now,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

type LocalRequestStats = { windowStart: number; total: number; failed: number };
function readLocalRequestStats(): LocalRequestStats | null {
  const stats = (globalThis as Record<string, unknown>).__NOVORA_LOCAL_REQ_STATS__;
  if (!stats || typeof stats !== 'object') return null;
  const typed = stats as LocalRequestStats;
  return {
    windowStart: Number(typed.windowStart) || 0,
    total: Number(typed.total) || 0,
    failed: Number(typed.failed) || 0,
  };
}

async function collectInfra(): Promise<{
  users: { total: number; active: number; pendingChangePassword: number };
  roles: number;
  devices: { total: number; online: number; revoked: number };
  plugins: number;
}> {
  const fiveMinAgo = Date.now() - 5 * 60_000;
  const [userRows, roleRows, deviceRows, pluginRows] = await Promise.all([
    authSql()`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active, COUNT(*) FILTER (WHERE must_change_password)::int AS pending FROM app_users`,
    authSql()`SELECT COUNT(*)::int AS count FROM app_roles`,
    authSql()`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE NOT revoked AND last_seen_at >= ${fiveMinAgo})::int AS online, COUNT(*) FILTER (WHERE revoked)::int AS revoked FROM device_instances`,
    authSql()`SELECT COUNT(*)::int AS count FROM classisland_plugin_instances`,
  ]);
  const user = assertRows(
    userRows,
    rowShape<{ total: number; active: number; pending: number }>({
      total: (v): v is number => typeof v === 'number',
      active: (v): v is number => typeof v === 'number',
      pending: (v): v is number => typeof v === 'number',
    }),
    'app_users',
  )[0];
  const roles = Number(assertRows(roleRows, isCountRow, 'app_roles')[0]?.count ?? 0);
  const device = assertRows(
    deviceRows,
    rowShape<{ total: number; online: number; revoked: number }>({
      total: (v): v is number => typeof v === 'number',
      online: (v): v is number => typeof v === 'number',
      revoked: (v): v is number => typeof v === 'number',
    }),
    'device_instances',
  )[0];
  const plugins = Number(assertRows(pluginRows, isCountRow, 'classisland_plugin_instances')[0]?.count ?? 0);
  return {
    users: { total: user?.total ?? 0, active: user?.active ?? 0, pendingChangePassword: user?.pending ?? 0 },
    roles,
    devices: { total: device?.total ?? 0, online: device?.online ?? 0, revoked: device?.revoked ?? 0 },
    plugins,
  };
}

async function collectMailQueue(): Promise<{
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  lastError: string | null;
  lastSentAt: number | null;
}> {
  const statusRows = assertRows(
    await authSql()`SELECT status, COUNT(*)::int AS n FROM email_outbox GROUP BY status`,
    isStatusRow,
    'email_outbox',
  );
  const counts: Record<string, number> = {};
  for (const row of statusRows) counts[row.status] = row.n;
  const errorRows = assertRows(
    await authSql()`SELECT last_error FROM email_outbox WHERE status IN ('pending','failed') AND last_error <> '' ORDER BY updated_at DESC LIMIT 1`,
    isErrorRow,
    'email_outbox',
  );
  const throttleRows = assertRows(
    await authSql()`SELECT last_sent_at FROM mail_throttle WHERE id=1`,
    isThrottleRow,
    'mail_throttle',
  );
  return {
    pending: counts.pending ?? 0,
    sending: counts.sending ?? 0,
    sent: counts.sent ?? 0,
    failed: counts.failed ?? 0,
    lastError: errorRows[0]?.last_error ?? null,
    lastSentAt: throttleRows[0] ? Number(throttleRows[0].last_sent_at) : null,
  };
}

async function collectEvents(): Promise<
  Array<{ username: string; action: string; resourceType: string; detail: unknown; createdAt: number }>
> {
  const rows = assertRows(
    await authSql()`SELECT username, action, resource_type, detail, created_at FROM app_audit_logs
      WHERE action NOT LIKE 'major.%' AND action NOT LIKE 'weekly.%' AND action NOT LIKE 'exam.%'
      ORDER BY created_at DESC LIMIT 20`,
    isEventRow,
    'app_audit_logs',
  );
  return rows.map((row) => ({
    username: row.username,
    action: row.action,
    resourceType: row.resource_type,
    detail: row.detail,
    createdAt: Number(row.created_at),
  }));
}

async function handleStatus(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  try {
    const actor = await requireActor(req, res);
    if (!actor) return;
    if (!actor.permissions.includes('*')) {
      res.status(403).json({ ok: false, code: 'PERMISSION_DENIED', error: '仅超级管理员可查看系统状态' });
      return;
    }
    // 诊断队列统计直接查表；与 collectDatabase 的 DDL 并行会让首次部署出现“表不存在”。
    await ensureTableOnce();
    const [database, infra, mailQueue, diagnosticQueue, events, recoveryConfigured, smtp, system] = await Promise.all([
      collectDatabase(),
      collectInfra(),
      collectMailQueue(),
      readDiagnosticQueueStats(),
      collectEvents(),
      isAdminRecoveryConfigured(),
      loadSmtpConfig(),
      collectSystem(),
    ]);
    const now = Date.now();
    res.json({
      ok: true,
      fetchedAt: now,
      service: {
        version: appVersion(),
        runtime: process.env.VERCEL ? 'vercel' : 'local',
        region: process.env.VERCEL_REGION ?? null,
      },
      server: system,
      config: {
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        adminPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD),
        deployHookConfigured: Boolean(process.env.VERCEL_DEPLOY_HOOK_URL),
        recoveryConfigured,
        smtpConfigured: Boolean(smtp),
        smtpPreset: smtp ? smtpPresetOf(smtp.host) : null,
        diagnosticWorkerProtected: Boolean(diagnosticWorkerSecret()),
      },
      database,
      infra,
      mailQueue,
      diagnosticQueue,
      events,
      requestStats: readLocalRequestStats(),
    });
  } catch (error) {
    sendDatabaseError(req, res, error, 'read');
  }
}

// ── /api/email-worker（Cron 消费） ──────────────────────────────────
/** 可选的 Cron 共享密钥；配置后要求调用方携带，未配置时保持与 email-worker 一致的开放行为。 */
function diagnosticWorkerSecret(): string {
  return (process.env.DIAGNOSTIC_WORKER_SECRET ?? '').trim();
}

function diagnosticWorkerAuthorized(req: VercelRequest): boolean {
  const secret = diagnosticWorkerSecret();
  if (!secret) return true;
  const bearer = String(req.headers.authorization ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const header = String(req.headers['x-cron-secret'] ?? '').trim();
  return bearer === secret || header === secret;
}

// ── /api/diagnostic-worker（Cron 消费诊断包重试队列） ─────────────────
async function handleDiagnosticWorker(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  if (!diagnosticWorkerAuthorized(req)) {
    res.status(401).json({ ok: false, code: 'WORKER_UNAUTHORIZED', error: '诊断队列 worker 密钥不正确' });
    return;
  }
  try {
    // worker 可能是部署后的第一个请求，先确保诊断表存在（模块级 Promise，仅首次真正执行 DDL）。
    await ensureTableOnce();
    const result = await drainDiagnosticQueue({
      limit: clampDrainLimit(req.query?.limit),
      deadlineMs: 8_000,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendDatabaseError(req, res, error, 'write');
  }
}

async function handleWorker(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
    return;
  }
  try {
    const smtp = await loadSmtpConfig();
    if (!smtp) {
      res.json({ ok: true, sent: 0, failed: 0, remaining: 0, skipped: 'not_configured' });
      return;
    }
    const result = await drainOutbox(smtp, { max: 5, hardTimeoutMs: 8_000, acquireSlot: false });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendDatabaseError(req, res, error, 'write');
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  requestId(req, res);
  res.setHeader('Cache-Control', 'no-store');
  switch (sysRoute(req)) {
    case 'health':
      return handleHealth(req, res);
    case 'status':
      return handleStatus(req, res);
    case 'email-worker':
      return handleWorker(req, res);
    case 'diagnostic-worker':
      return handleDiagnosticWorker(req, res);
    case 'time':
      return handleTime(req, res);
    case 'update-check':
      return handleUpdateCheck(req, res);
    case 'redeploy':
      return handleRedeploy(req, res);
    default:
      res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Not found' });
  }
}
