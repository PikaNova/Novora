import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomUUID } from 'node:crypto';
import { requireActor, writeAudit, type AdminActor } from '../_auth.js';
import { hasAllScope } from '../../src/shared/permissionRules.js';
import { database, ensureTableOnce } from '../_exams/db.js';
import { sanitizeRuntimeEvent, RUNTIME_BATCH_SIZE, type RuntimeEvent } from '../../src/shared/runtimeLog.js';
import { ensureRuntimeTables, insertRuntimeEvents, purgeRuntimeEvents } from './store.js';
import { runtimeStorageStatus } from './serverJournal.js';
import { consumeRateLimit, getRateLimitKey } from '../_rateLimiter.js';

type Row = Record<string, unknown>;
class InputError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'INVALID_RUNTIME_REQUEST',
  ) {
    super(message);
  }
}
const scalar = (v: unknown) => (typeof v === 'string' ? v : '');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function id(v: unknown): string {
  const s = scalar(v);
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(s)) throw new InputError('标识格式无效');
  return s;
}
const body = (req: VercelRequest): Row =>
  req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
function range(from: unknown, to: unknown, maxDays: number): { from: number; to: number } {
  const end = to == null || to === '' ? Date.now() : Number(to);
  const start = from == null || from === '' ? end - 86400000 : Number(from);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start <= 0 ||
    end < start ||
    end - start > maxDays * 86400000 ||
    end > 1e15
  )
    throw new InputError('时间范围无效');
  return { from: start, to: end };
}
async function actorFor(
  req: VercelRequest,
  res: VercelResponse,
  permission: 'diagnostics.read' | 'diagnostics.settings' | 'diagnostics.upload' | 'diagnostics.download',
): Promise<AdminActor | null> {
  const actor = await requireActor(req, res, permission);
  if (!actor) return null;
  if (!hasAllScope(actor)) {
    res.status(403).json({ ok: false, code: 'ALL_SCOPE_REQUIRED', error: '运行日志仅限全校范围运维账号查看' });
    return null;
  }
  return actor;
}
async function authenticateDevice(req: VercelRequest): Promise<string> {
  const instanceId = id(req.method === 'GET' ? req.query.instanceId : body(req).instanceId);
  const token = scalar(req.headers.authorization).replace(/^Bearer /, '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new InputError('设备日志凭证无效', 401, 'DEVICE_LOG_UNAUTHORIZED');
  const digest = hash(token);
  const rows =
    await database()`SELECT c.secret_hash FROM app_runtime_credentials c JOIN device_instances d ON d.instance_id=c.instance_id WHERE c.instance_id=${instanceId} AND c.secret_hash=${digest} AND c.status='approved' AND d.revoked=FALSE`;
  if (!rows[0]) throw new InputError('设备日志凭证无效或设备已撤销', 401, 'DEVICE_LOG_UNAUTHORIZED');
  return instanceId;
}
// Only server-owned SQL fragments are composed. All filters remain bound parameters.
function query(sqlText: string, values: unknown[]): Promise<Row[]> {
  const parts = sqlText.split('§');
  Object.defineProperty(parts, 'raw', { value: parts.slice() });
  return database()(parts as unknown as TemplateStringsArray, ...values);
}
function filters(req: VercelRequest): { where: string; values: unknown[] } {
  const q = req.query;
  const r = range(q.from, q.to, 30);
  const clauses = ['received_at >= §', 'received_at <= §'];
  const values: unknown[] = [r.from, r.to];
  for (const key of ['instanceId', 'level', 'category', 'sessionId', 'operationId']) {
    const value = scalar(q[key]);
    if (!value) continue;
    if (value.length > 128) throw new InputError('筛选条件过长');
    const column = key === 'instanceId' ? 'instance_id' : `event->>'${key}'`;
    clauses.push(`${column}=§`);
    values.push(value);
  }
  if (scalar(q.q)) {
    clauses.push("position(lower(§) in lower(event->>'message'))>0");
    values.push(scalar(q.q).slice(0, 160));
  }
  return { where: clauses.join(' AND '), values };
}
export async function handleRuntimeLogs(req: VercelRequest, res: VercelResponse, resource: string): Promise<void> {
  try {
    const b = body(req);
    const sql = database();
    const methods: Record<string, string> = {
      'runtime-enroll': 'POST',
      'runtime-ingest': 'POST',
      'runtime-dashboard': 'GET',
      'runtime-export': 'GET',
    };
    if (!methods[resource]) throw new InputError('接口不存在', 404);
    if (req.method !== methods[resource]) throw new InputError('请求方法不支持', 405);
    const rateDecision = consumeRateLimit(`runtime:${getRateLimitKey(req)}`, { windowMs: 60000, maxRequests: 120 });
    if (!rateDecision.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(rateDecision.retryAfterMs / 1000)));
      throw new InputError('日志请求过于频繁，请稍后重试', 429, 'RUNTIME_RATE_LIMITED');
    }
    await ensureTableOnce();
    await ensureRuntimeTables();
    if (resource === 'runtime-enroll') {
      const instanceId = id(b.instanceId);
      const token = scalar(b.secret);
      if (!/^[a-f0-9]{64}$/.test(token)) throw new InputError('设备日志凭证格式无效');
      const digest = hash(token);
      const existing =
        await sql`SELECT id FROM app_runtime_credentials WHERE instance_id=${instanceId} AND secret_hash=${digest} AND status='approved'`;
      if (existing.length) {
        const device = await sql`SELECT revoked FROM device_instances WHERE instance_id=${instanceId}`;
        if (!device.length || device[0].revoked)
          throw new InputError('设备未登记或已撤销', 401, 'DEVICE_LOG_UNAUTHORIZED');
        res.json({ ok: true });
        return;
      }
      const device = await sql`SELECT revoked FROM device_instances WHERE instance_id=${instanceId}`;
      if (!device.length || device[0].revoked)
        throw new InputError('设备未登记或已撤销', 401, 'DEVICE_LOG_UNAUTHORIZED');
      const credentialId = `runtime_${randomUUID()}`;
      const now = Date.now();
      await sql.transaction((tx) => [
        tx`SELECT pg_advisory_xact_lock(hashtext(${instanceId}))`,
        tx`UPDATE app_runtime_credentials SET status='revoked' WHERE instance_id=${instanceId} AND status='approved' AND secret_hash<>${digest}`,
        tx`INSERT INTO app_runtime_credentials(id,instance_id,secret_hash,status,created_at) VALUES (${credentialId},${instanceId},${digest},'approved',${now}) ON CONFLICT(instance_id,secret_hash) DO UPDATE SET status='approved'`,
      ]);
      res.json({ ok: true });
      return;
    }
    if (resource === 'runtime-ingest') {
      const instanceId = await authenticateDevice(req);
      if (
        !Array.isArray(b.entries) ||
        !b.entries.length ||
        b.entries.length > RUNTIME_BATCH_SIZE ||
        Buffer.byteLength(JSON.stringify(b)) > 512 * 1024
      )
        throw new InputError('日志批次超限或为空', 413);
      const entries = b.entries.map(sanitizeRuntimeEvent);
      if (entries.some((e) => !e)) throw new InputError('日志条目格式无效，整批未接收');
      const accepted = await insertRuntimeEvents(instanceId, entries as RuntimeEvent[]);
      res.json({ ok: true, accepted, duplicates: entries.length - accepted });
      return;
    }
    const permission = resource === 'runtime-export' ? 'diagnostics.download' : 'diagnostics.read';
    const actor = await actorFor(req, res, permission);
    if (!actor) return;
    await purgeRuntimeEvents();
    const f = filters(req);
    const limit = resource === 'runtime-export' ? 5000 : 100;
    const session = scalar(req.query.sessionId);
    let pageWhere = f.where;
    const pageValues = [...f.values];
    if (scalar(req.query.cursor)) {
      const cursor = /^(\d{1,16}):(\d{1,18})$/.exec(scalar(req.query.cursor));
      if (!cursor || !Number.isSafeInteger(Number(cursor[1]))) throw new InputError('分页游标无效');
      const column = session ? "(event->>'sequence')::bigint" : 'received_at';
      const comparison = session ? '>' : '<';
      pageWhere += ` AND (${column}${comparison}§ OR (${column}=§ AND id${comparison}§))`;
      pageValues.push(cursor[1], cursor[1], cursor[2]);
    }
    const order = session ? "(event->>'sequence')::bigint ASC,id ASC" : 'received_at DESC,id DESC';
    const entries = await query(
      `SELECT id,instance_id,received_at,event FROM app_runtime_events WHERE ${pageWhere} ORDER BY ${order} LIMIT ${limit + 1}`,
      pageValues,
    );
    const hasMore = entries.length > limit;
    const page = entries.slice(0, limit).map((row) => ({
      ...row,
      id: String(row.id),
      received_at: Number(row.received_at),
      event: row.event as RuntimeEvent,
    }));
    if (resource === 'runtime-export') {
      await writeAudit(actor, 'diagnostics.runtime.export', 'diagnostics', '', {
        count: page.length,
        truncated: hasMore,
      });
      res.json({ ok: true, entries: page, truncated: hasMore, limit });
      return;
    }
    const [summary, trend, devices] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE event->>'level'='error')::int AS errors,COUNT(*) FILTER(WHERE event->>'level'='warn')::int AS warnings FROM app_runtime_events WHERE ${f.where}`,
        f.values,
      ),
      query(
        `SELECT (received_at/3600000)*3600000 AS at,COUNT(*)::int AS total,COUNT(*) FILTER(WHERE event->>'level'='error')::int AS errors FROM app_runtime_events WHERE ${f.where} GROUP BY 1 ORDER BY 1`,
        f.values,
      ),
      sql`SELECT d.instance_id,d.page,d.client_version,d.last_seen_at,d.revoked FROM device_instances d ORDER BY last_seen_at DESC LIMIT 2000`,
    ]);
    const last = page[page.length - 1];
    res.json({
      ok: true,
      fetchedAt: Date.now(),
      range: { from: f.values[0], to: f.values[1] },
      entries: page,
      hasMore,
      nextCursor: hasMore && last ? `${session ? last.event.sequence : last.received_at}:${last.id}` : null,
      summary: summary[0],
      trend: trend.map((r) => ({ ...r, at: Number(r.at) })),
      devices,
      storage: runtimeStorageStatus(),
    });
  } catch (error) {
    const input = error instanceof InputError;
    res.status(input ? error.status : 503).json({
      ok: false,
      code: input ? error.code : 'RUNTIME_STORE_UNAVAILABLE',
      error: input ? error.message : '学校日志存储暂时不可用，请检查数据库连接',
    });
  }
}
