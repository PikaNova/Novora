import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { isPasswordRequired, verifyToken, extractBearer } from './_auth.js';

// 性能：缓存 neon 客户端（同一 warm 实例复用）。
let _sql: ReturnType<typeof neon> | null = null;
function database() {
  if (_sql) return _sql;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  _sql = neon(connectionString);
  return _sql;
}

// 建表/迁移只需执行一次：用模块级 Promise 缓存，避免每个请求都跑 6 条 DDL。
// （数据库在新加坡、Vercel 在美国，每条 SQL 都是一次跨洲 HTTP 往返，
// 以前每次 GET/POST 都做 6 次 DDL 往返→累计 2-3 秒。现改为按需且仅一次。)
let migratePromise: Promise<void> | null = null;
let updatedAtMigrationPromise: Promise<void> | null = null;
type CachedGet = { body: string; etag: string; expiresAt: number };
let getCache: CachedGet | null = null;
const GET_CACHE_MS = 10_000;

// 早期版本曾将 updated_at 建为 INTEGER；毫秒时间戳超过其上限时，将旧列无损扩展为 BIGINT。
// 仅在旧表首次写入溢出、或按需建表迁移时执行，避免每次请求增加 DDL 往返。
function ensureUpdatedAtBigIntOnce(): Promise<void> {
  if (!updatedAtMigrationPromise) {
    updatedAtMigrationPromise = (async () => {
      const sql = database();
      await sql`ALTER TABLE exam_data ALTER COLUMN updated_at TYPE BIGINT USING updated_at::BIGINT`;
    })().catch(err => { updatedAtMigrationPromise = null; throw err; });
  }
  return updatedAtMigrationPromise;
}

function ensureTableOnce(): Promise<void> {
  if (!migratePromise) {
    migratePromise = (async () => {
      const sql = database();
      await sql`
        CREATE TABLE IF NOT EXISTS exam_data (
          id INTEGER PRIMARY KEY DEFAULT 1,
          items JSONB NOT NULL DEFAULT '[]',
          title TEXT NOT NULL DEFAULT '',
          updated_at BIGINT NOT NULL DEFAULT 0,
          CHECK (id = 1)
        )
      `;
      await sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS majors JSONB NOT NULL DEFAULT '[]'`;
      await sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS active_major_id TEXT NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS alerts JSONB`;
      // v1.24.0 周测：周测计划 / 调度模式 / 激活计划 / 冲突策略。
      await sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS weekly_plans JSONB NOT NULL DEFAULT '[]'`;
      await sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'major-only'`;
      await sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS active_weekly_plan_id TEXT NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS weekly_conflict_policy JSONB`;
      await ensureUpdatedAtBigIntOnce();
      await sql`
        INSERT INTO exam_data (id, items, title, updated_at)
        VALUES (1, '[]', '', 0)
        ON CONFLICT (id) DO NOTHING
      `;
    })().catch(err => { migratePromise = null; throw err; });
  }
  return migratePromise;
}

type ExamRow = {
  items?: unknown;
  title?: string;
  majors?: unknown;
  active_major_id?: string;
  alerts?: unknown;
  weekly_plans?: unknown;
  schedule_mode?: string;
  active_weekly_plan_id?: string;
  weekly_conflict_policy?: unknown;
  updated_at?: number | string | null;
};
type UpdatedRow = { updated_at: number | string };

// 判断是否因“表/列尚未创建”报错，仅在首次遇到时才跑迁移并重试。
function missingRelation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /does not exist|undefined_table|undefined_column/i.test(msg);
}

function updatedAtIntegerOverflow(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code ?? '')
    : '';
  return code === '22003' && /out of range for type integer/i.test(msg);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  // Short edge cache reduces repeated US→Singapore database reads while keeping updates prompt.
  if (req.method === 'GET') res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=50');
  else res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const sql = database();

    if (req.method === 'GET') {
      // Warm cache and ETag avoid repeat database reads for unchanged display data.
      if (getCache && getCache.expiresAt > Date.now()) {
        res.setHeader('ETag', getCache.etag);
        if (req.headers['if-none-match'] === getCache.etag) { res.status(304).end(); return; }
        res.setHeader('Server-Timing', `app;dur=${Date.now() - startedAt}`); res.setHeader('Content-Type', 'application/json'); res.status(200).send(getCache.body); return;
      }
      // 快路径：直接查询（一次往返）；仅当表/列��失时才迁移后重试。
      const selectRow = async (): Promise<ExamRow[]> => (
        await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, weekly_conflict_policy, updated_at FROM exam_data WHERE id = 1`
      ) as unknown as ExamRow[];
      let rows: ExamRow[];
      try {
        rows = await selectRow();
      } catch (e) {
        if (!missingRelation(e)) throw e;
        await ensureTableOnce();
        rows = await selectRow();
      }
      const row = rows[0] ?? { items: [], title: '', majors: [], active_major_id: '', alerts: null, weekly_plans: [], schedule_mode: 'major-only', active_weekly_plan_id: '', weekly_conflict_policy: null, updated_at: 0 };
      const payload = { ok: true, items: row.items ?? [], title: row.title ?? '', majors: row.majors ?? [], activeMajorId: row.active_major_id ?? '', alerts: row.alerts ?? null, weeklyPlans: row.weekly_plans ?? [], scheduleMode: row.schedule_mode ?? 'major-only', activeWeeklyPlanId: row.active_weekly_plan_id ?? '', weeklyConflictPolicy: row.weekly_conflict_policy ?? null, updatedAt: Number(row.updated_at ?? 0) };
      const body = JSON.stringify(payload); const etag = `\"exam-${payload.updatedAt}\"`;
      getCache = { body, etag, expiresAt: Date.now() + GET_CACHE_MS };
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
      res.setHeader('Server-Timing', `app;dur=${Date.now() - startedAt}`); res.setHeader('Content-Type', 'application/json'); res.status(200).send(body);
      return;
    }

    if (req.method === 'POST') {
      if (await isPasswordRequired()) {
        const token = extractBearer(req.headers.authorization);
        if (!await verifyToken(token)) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      }
      const { items, title, majors, activeMajorId, alerts, weeklyPlans, scheduleMode, activeWeeklyPlanId, weeklyConflictPolicy, baseUpdatedAt } = req.body ?? {};
      if (!Array.isArray(items)) { res.status(400).json({ ok: false, error: 'items must be an array' }); return; }
      const expectedVersion = Number(baseUpdatedAt ?? 0);
      const updatedAt = Date.now();
      const runUpdate = async (): Promise<UpdatedRow[]> => (
        await sql`
          UPDATE exam_data
          SET items = ${JSON.stringify(items)}::jsonb,
              title = ${typeof title === 'string' ? title : ''},
              majors = ${JSON.stringify(Array.isArray(majors) ? majors : [])}::jsonb,
              active_major_id = ${typeof activeMajorId === 'string' ? activeMajorId : ''},
              alerts = ${alerts && typeof alerts === 'object' ? JSON.stringify(alerts) : null}::jsonb,
              -- 周测字段：仅当请求显式携带时才覆写，否则 COALESCE 保留既有值（后台保存不带周测→不丢失）。
              weekly_plans = COALESCE(${weeklyPlans !== undefined ? JSON.stringify(Array.isArray(weeklyPlans) ? weeklyPlans : []) : null}::jsonb, weekly_plans),
              schedule_mode = COALESCE(${typeof scheduleMode === 'string' ? scheduleMode : null}, schedule_mode),
              active_weekly_plan_id = COALESCE(${typeof activeWeeklyPlanId === 'string' ? activeWeeklyPlanId : null}, active_weekly_plan_id),
              weekly_conflict_policy = COALESCE(${weeklyConflictPolicy && typeof weeklyConflictPolicy === 'object' ? JSON.stringify(weeklyConflictPolicy) : null}::jsonb, weekly_conflict_policy),
              updated_at = ${updatedAt}
          -- 显式 BIGINT：毫秒级 baseUpdatedAt 不能在与字面量 0 比较时被 PostgreSQL 推断为 INTEGER。
          WHERE id = 1 AND (${expectedVersion}::BIGINT <= 0 OR updated_at = ${expectedVersion}::BIGINT)
          RETURNING updated_at
        `
      ) as unknown as UpdatedRow[];
      let updatedRows: UpdatedRow[];
      try {
        updatedRows = await runUpdate();
      } catch (e) {
        if (missingRelation(e)) {
          await ensureTableOnce();
          updatedRows = await runUpdate();
        } else if (updatedAtIntegerOverflow(e)) {
          // 旧实例数据库的 updated_at 仍为 INTEGER：自动升级后重试本次保存。
          await ensureUpdatedAtBigIntOnce();
          updatedRows = await runUpdate();
        } else {
          throw e;
        }
      }
      if (!updatedRows?.length) {
        const rows = (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, weekly_conflict_policy, updated_at FROM exam_data WHERE id = 1`) as unknown as ExamRow[];
        const row = rows[0] ?? {};
        res.status(409).json({ ok: false, error: 'Conflict', remote: { items: row.items ?? [], title: row.title ?? '', majors: row.majors ?? [], activeMajorId: row.active_major_id ?? '', alerts: row.alerts ?? null, weeklyPlans: row.weekly_plans ?? [], scheduleMode: row.schedule_mode ?? 'major-only', activeWeeklyPlanId: row.active_weekly_plan_id ?? '', weeklyConflictPolicy: row.weekly_conflict_policy ?? null, updatedAt: Number(row.updated_at ?? 0) } });
        return;
      }
      getCache = null;
      res.setHeader('Server-Timing', `app;dur=${Date.now() - startedAt}`); res.status(200).json({ ok: true, updatedAt });
      return;
    }

    res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error: unknown) {
    console.error('Exam API error:', error);
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Database error' });
  }
}
