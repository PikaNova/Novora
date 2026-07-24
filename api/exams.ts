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
          majors JSONB NOT NULL DEFAULT '[]',
          active_major_id TEXT NOT NULL DEFAULT '',
          alerts JSONB,
          weekly_plans JSONB NOT NULL DEFAULT '[]',
          schedule_mode TEXT NOT NULL DEFAULT 'major-only',
          active_weekly_plan_id TEXT NOT NULL DEFAULT '',
          active_weekly_plan_by_class JSONB NOT NULL DEFAULT '{}',
          weekly_conflict_policy JSONB,
          grades JSONB NOT NULL DEFAULT '[]',
          classes JSONB NOT NULL DEFAULT '[]',
          initialization JSONB NOT NULL DEFAULT '{}',
          updated_at BIGINT NOT NULL DEFAULT 0,
          CHECK (id = 1)
        )
      `;
      // 兼容未重置的旧库；并行执行可避免免费函数冷启动串行累加跨洲数据库延迟。
      await Promise.all([
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS majors JSONB NOT NULL DEFAULT '[]'`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS active_major_id TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS alerts JSONB`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS weekly_plans JSONB NOT NULL DEFAULT '[]'`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'major-only'`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS active_weekly_plan_id TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS active_weekly_plan_by_class JSONB NOT NULL DEFAULT '{}'`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS weekly_conflict_policy JSONB`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS grades JSONB NOT NULL DEFAULT '[]'`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS classes JSONB NOT NULL DEFAULT '[]'`,
        sql`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS initialization JSONB NOT NULL DEFAULT '{}'`,
        sql`
        CREATE TABLE IF NOT EXISTS device_instances (
          instance_id TEXT PRIMARY KEY,
          grade_id TEXT NOT NULL DEFAULT '',
          class_id TEXT NOT NULL DEFAULT '',
          revoked BOOLEAN NOT NULL DEFAULT FALSE,
          page TEXT NOT NULL DEFAULT '',
          client_version TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          current_exam TEXT NOT NULL DEFAULT '',
          current_subject TEXT NOT NULL DEFAULT '',
          exam_start TEXT NOT NULL DEFAULT '',
          exam_end TEXT NOT NULL DEFAULT '',
          last_seen_at BIGINT NOT NULL DEFAULT 0,
          updated_at BIGINT NOT NULL
        )
      `,
        ensureUpdatedAtBigIntOnce(),
      ]);
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
  active_weekly_plan_by_class?: unknown;
  weekly_conflict_policy?: unknown;
  grades?: unknown;
  classes?: unknown;
  initialization?: unknown;
  updated_at?: number | string | null;
  bound_grade_id?: string | null;
  bound_class_id?: string | null;
  binding_revoked?: boolean | null;
};
type UpdatedRow = { updated_at: number | string };

function examPayload(row: ExamRow) {
  return {
    ok: true,
    items: row.items ?? [],
    title: row.title ?? '',
    majors: row.majors ?? [],
    activeMajorId: row.active_major_id ?? '',
    alerts: row.alerts ?? null,
    weeklyPlans: row.weekly_plans ?? [],
    scheduleMode: row.schedule_mode ?? 'major-only',
    activeWeeklyPlanId: row.active_weekly_plan_id ?? '',
    activeWeeklyPlanIdByClassId: row.active_weekly_plan_by_class ?? {},
    grades: row.grades ?? [],
    classes: row.classes ?? [],
    initialization: row.initialization ?? {},
    weeklyConflictPolicy: row.weekly_conflict_policy ?? null,
    updatedAt: Number(row.updated_at ?? 0),
  };
}

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

    const action = String(req.method === 'GET' ? req.query?.action ?? '' : req.body?.action ?? '');
    if (action === 'bootstrap') {
      res.setHeader('Cache-Control', 'private, no-store');
      if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }
      const instanceId = String(req.query?.instanceId ?? '').trim().slice(0, 128);
      if (!instanceId) { res.status(400).json({ ok: false, error: 'instanceId is required' }); return; }
      const selectBootstrap = async (): Promise<ExamRow[]> => (
        await sql`
          SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode,
                 active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, updated_at,
                 (SELECT grade_id FROM device_instances WHERE instance_id = ${instanceId}) AS bound_grade_id,
                 (SELECT class_id FROM device_instances WHERE instance_id = ${instanceId}) AS bound_class_id,
                 (SELECT revoked FROM device_instances WHERE instance_id = ${instanceId}) AS binding_revoked
          FROM exam_data
          WHERE id = 1
        `
      ) as unknown as ExamRow[];
      let rows: ExamRow[];
      try { rows = await selectBootstrap(); }
      catch (error) { if (!missingRelation(error)) throw error; await ensureTableOnce(); rows = await selectBootstrap(); }
      const row = rows[0] ?? {};
      res.setHeader('Server-Timing', `app;dur=${Date.now() - startedAt}`);
      res.status(200).json({ ...examPayload(row), binding: row.bound_class_id == null ? null : { gradeId: row.bound_grade_id ?? '', classId: row.bound_class_id, revoked: row.binding_revoked === true } });
      return;
    }
    if (action === 'device-bindings') {
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }
      if (await isPasswordRequired()) {
        const token = extractBearer(req.headers.authorization);
        if (!await verifyToken(token)) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      }
      const selectBindings = async () => (
        await sql`SELECT * FROM device_instances ORDER BY updated_at DESC LIMIT 501`
      ) as unknown as Array<Record<string, any>>;
      let rows: Awaited<ReturnType<typeof selectBindings>>;
      try { rows = await selectBindings(); }
      catch (error) { if (!missingRelation(error)) throw error; await ensureTableOnce(); rows = await selectBindings(); }
      const truncated = rows.length > 500;
      res.status(200).json({
        ok: true,
        bindings: rows.slice(0, 500).map(row => ({ instanceId: row.instance_id, gradeId: row.grade_id, classId: row.class_id, revoked: row.revoked === true, page: row.page, clientVersion: row.client_version, status: row.status, currentExam: row.current_exam, currentSubject: row.current_subject, examStart: row.exam_start, examEnd: row.exam_end, lastSeenAt: Number(row.last_seen_at), updatedAt: Number(row.updated_at) })),
        truncated,
      });
      return;
    }
    if (action === 'device-binding') {
      const instanceId = String(req.method === 'GET' ? req.query?.instanceId ?? '' : req.body?.instanceId ?? '').trim().slice(0, 128);
      if (!instanceId) { res.status(400).json({ ok: false, error: 'instanceId is required' }); return; }
      const runBinding = async () => {
        if (req.method === 'GET') {
          const rows = await sql`SELECT grade_id, class_id, revoked FROM device_instances WHERE instance_id = ${instanceId}` as unknown as Array<{ grade_id?: string; class_id?: string; revoked?: boolean }>;
          res.status(200).json({ ok: true, binding: rows[0] ? { gradeId: rows[0].grade_id ?? '', classId: rows[0].class_id ?? '', revoked: rows[0].revoked === true } : null });
          return;
        }
        if (req.method === 'POST') {
          const gradeId = String(req.body?.gradeId ?? '').trim().slice(0, 128);
          const classId = String(req.body?.classId ?? '').trim().slice(0, 128);
          if (!gradeId || !classId) { res.status(400).json({ ok: false, error: 'gradeId and classId are required' }); return; }
          const updatedAt = Date.now();
          await sql`
            INSERT INTO device_instances (instance_id, grade_id, class_id, revoked, updated_at)
            VALUES (${instanceId}, ${gradeId}, ${classId}, FALSE, ${updatedAt})
            ON CONFLICT (instance_id) DO UPDATE SET grade_id = EXCLUDED.grade_id, class_id = EXCLUDED.class_id, revoked = FALSE, updated_at = EXCLUDED.updated_at
          `;
          res.status(200).json({ ok: true, binding: { gradeId, classId, revoked: false }, updatedAt });
          return;
        }
        res.status(405).json({ ok: false, error: 'Method not allowed' });
      };
      try { await runBinding(); }
      catch (error) { if (!missingRelation(error)) throw error; await ensureTableOnce(); await runBinding(); }
      return;
    }
    if (action === 'device-heartbeat' && req.method === 'POST') {
      const instanceId = String(req.body?.instanceId ?? '').trim().slice(0, 128);
      if (!instanceId) { res.status(400).json({ ok: false, error: 'instanceId is required' }); return; }
      const now = Date.now();
      const value = (key: string, max = 160) => String(req.body?.[key] ?? '').trim().slice(0, max);
      const run = async () => {
        await sql`INSERT INTO device_instances (instance_id, page, client_version, status, current_exam, current_subject, exam_start, exam_end, last_seen_at, updated_at)
          VALUES (${instanceId}, ${value('page')}, ${value('clientVersion', 40)}, ${value('status', 40)}, ${value('currentExam')}, ${value('currentSubject')}, ${value('examStart', 40)}, ${value('examEnd', 40)}, ${now}, ${now})
          ON CONFLICT (instance_id) DO UPDATE SET page=EXCLUDED.page, client_version=EXCLUDED.client_version, status=EXCLUDED.status, current_exam=EXCLUDED.current_exam, current_subject=EXCLUDED.current_subject, exam_start=EXCLUDED.exam_start, exam_end=EXCLUDED.exam_end, last_seen_at=EXCLUDED.last_seen_at`;
        const rows = await sql`SELECT revoked FROM device_instances WHERE instance_id=${instanceId}` as unknown as Array<{ revoked: boolean }>;
        res.status(200).json({ ok: true, revoked: rows[0]?.revoked === true });
      };
      try { await run(); } catch (error) { if (!missingRelation(error)) throw error; await ensureTableOnce(); await run(); }
      return;
    }
    if (action === 'device-revoke' && req.method === 'POST') {
      if (await isPasswordRequired()) { const token = extractBearer(req.headers.authorization); if (!await verifyToken(token)) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; } }
      const instanceId = String(req.body?.instanceId ?? '').trim().slice(0, 128);
      await ensureTableOnce();
      await sql`UPDATE device_instances SET revoked=TRUE, grade_id='', class_id='', updated_at=${Date.now()} WHERE instance_id=${instanceId}`;
      res.status(200).json({ ok: true }); return;
    }

    if (req.method === 'GET') {
      // Warm cache and ETag avoid repeat database reads for unchanged display data.
      if (getCache && getCache.expiresAt > Date.now()) {
        res.setHeader('ETag', getCache.etag);
        if (req.headers['if-none-match'] === getCache.etag) { res.status(304).end(); return; }
        res.setHeader('Server-Timing', `app;dur=${Date.now() - startedAt}`); res.setHeader('Content-Type', 'application/json'); res.status(200).send(getCache.body); return;
      }
      // 快路径：直接查询（一次往返）；仅当表/列缺失时才迁移后重试。
      const selectRow = async (): Promise<ExamRow[]> => (
        await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, updated_at FROM exam_data WHERE id = 1`
      ) as unknown as ExamRow[];
      let rows: ExamRow[];
      try {
        rows = await selectRow();
      } catch (e) {
        if (!missingRelation(e)) throw e;
        await ensureTableOnce();
        rows = await selectRow();
      }
      const row = rows[0] ?? { items: [], title: '', majors: [], active_major_id: '', alerts: null, weekly_plans: [], schedule_mode: 'major-only', active_weekly_plan_id: '', active_weekly_plan_by_class: {}, weekly_conflict_policy: null, updated_at: 0 };
      const payload = examPayload(row);
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
      const { items, title, majors, activeMajorId, alerts, weeklyPlans, scheduleMode, activeWeeklyPlanId, activeWeeklyPlanIdByClassId, weeklyConflictPolicy, grades, classes, initialization, baseUpdatedAt } = req.body ?? {};
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
              active_weekly_plan_by_class = COALESCE(${activeWeeklyPlanIdByClassId && typeof activeWeeklyPlanIdByClassId === 'object' ? JSON.stringify(activeWeeklyPlanIdByClassId) : null}::jsonb, active_weekly_plan_by_class),
              grades = COALESCE(${Array.isArray(grades) ? JSON.stringify(grades) : null}::jsonb, grades),
              classes = COALESCE(${Array.isArray(classes) ? JSON.stringify(classes) : null}::jsonb, classes),
              initialization = COALESCE(${initialization && typeof initialization === 'object' ? JSON.stringify(initialization) : null}::jsonb, initialization),
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
        const rows = (await sql`SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode, active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy, grades, classes, initialization, updated_at FROM exam_data WHERE id = 1`) as unknown as ExamRow[];
        const row = rows[0] ?? {};
        const { ok: _ok, ...remote } = examPayload(row);
        res.status(409).json({ ok: false, error: 'Conflict', remote });
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
