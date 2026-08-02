// api/_exams/db.ts
// 数据库连接与建表/迁移：从原 api/exams.ts 抽出，集中管理 neon 客户端、一次性 DDL 与
// “关系/列缺失”“INTEGER 溢出”等错误识别，保持单一职责。

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { SCHEMA_MIGRATION_LOCK_ID } from "../_auth.js";
import { sendRateLimited } from "../_apiError.js";

// 性能：缓存 neon 客户端（同一 warm 实例复用）。
let _sql: ReturnType<typeof neon> | null = null;
export function database() {
  if (_sql) return _sql;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  _sql = neon(connectionString);
  return _sql;
}

// 建表/迁移只需执行一次：用模块级 Promise 缓存，避免每个请求都跑 6 条 DDL。
// （数据库在新加坡、Vercel 在美国，每条 SQL 都是一次跨洲 HTTP 往返，
// 以前每次 GET/POST 都做 6 次 DDL 往返→累计 2-3 秒。现改为按需且仅一次。)
let migratePromise: Promise<void> | null = null;
let updatedAtMigrationPromise: Promise<void> | null = null;

// 早期版本曾将 updated_at 建为 INTEGER；毫秒时间戳超过其上限时，将旧列无损扩展为 BIGINT。
// 仅在旧表首次写入溢出、或按需建表迁移时执行，避免每次请求增加 DDL 往返。
export function ensureUpdatedAtBigIntOnce(): Promise<void> {
  if (!updatedAtMigrationPromise) {
    updatedAtMigrationPromise = (async () => {
      const sql = database();
      await sql`ALTER TABLE exam_data ALTER COLUMN updated_at TYPE BIGINT USING updated_at::BIGINT`;
    })().catch((err) => {
      updatedAtMigrationPromise = null;
      throw err;
    });
  }
  return updatedAtMigrationPromise;
}

export function ensureTableOnce(): Promise<void> {
  if (!migratePromise) {
    migratePromise = (async () => {
      const sql = database();
      await sql.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(${SCHEMA_MIGRATION_LOCK_ID})`,
        transaction`CREATE TABLE IF NOT EXISTS exam_data (
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
          design_policy JSONB NOT NULL DEFAULT '{"rules":[],"updatedAt":0}',
          updated_at BIGINT NOT NULL DEFAULT 0,
          CHECK (id = 1)
        )`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS majors JSONB NOT NULL DEFAULT '[]'`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS active_major_id TEXT NOT NULL DEFAULT ''`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS alerts JSONB`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS weekly_plans JSONB NOT NULL DEFAULT '[]'`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'major-only'`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS active_weekly_plan_id TEXT NOT NULL DEFAULT ''`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS active_weekly_plan_by_class JSONB NOT NULL DEFAULT '{}'`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS weekly_conflict_policy JSONB`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS grades JSONB NOT NULL DEFAULT '[]'`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS classes JSONB NOT NULL DEFAULT '[]'`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS initialization JSONB NOT NULL DEFAULT '{}'`,
        transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS design_policy JSONB NOT NULL DEFAULT '{"rules":[],"updatedAt":0}'`,
        transaction`CREATE TABLE IF NOT EXISTS device_instances (
          instance_id TEXT PRIMARY KEY,
          grade_id TEXT NOT NULL DEFAULT '',
          class_id TEXT NOT NULL DEFAULT '',
          revoked BOOLEAN NOT NULL DEFAULT FALSE,
          is_management BOOLEAN NOT NULL DEFAULT FALSE,
          management_actor_id BIGINT NOT NULL DEFAULT 0,
          management_role_name TEXT NOT NULL DEFAULT '',
          management_scope_label TEXT NOT NULL DEFAULT '',
          page TEXT NOT NULL DEFAULT '',
          client_version TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          current_exam TEXT NOT NULL DEFAULT '',
          current_subject TEXT NOT NULL DEFAULT '',
          exam_start TEXT NOT NULL DEFAULT '',
          exam_end TEXT NOT NULL DEFAULT '',
          temporary_command JSONB,
          last_seen_at BIGINT NOT NULL DEFAULT 0,
          updated_at BIGINT NOT NULL
        )`,
        transaction`CREATE TABLE IF NOT EXISTS classisland_plugin_instances (
          plugin_instance_id TEXT PRIMARY KEY,
          client_secret_hash TEXT NOT NULL,
          pair_token_hash TEXT,
          pair_expires_at BIGINT,
          grade_id TEXT NOT NULL DEFAULT '',
          class_id TEXT NOT NULL DEFAULT '',
          viewer_instance_id TEXT NOT NULL DEFAULT '',
          paired BOOLEAN NOT NULL DEFAULT FALSE,
          viewer_last_seen_at BIGINT NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )`,
        transaction`CREATE TABLE IF NOT EXISTS write_throttle (
          id INTEGER PRIMARY KEY DEFAULT 1,
          next_allowed_at BIGINT NOT NULL DEFAULT 0,
          CHECK (id = 1)
        )`,
      ]);
      await Promise.all([
        ensureUpdatedAtBigIntOnce(),
        sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS temporary_command JSONB`,
        sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS is_management BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS management_actor_id BIGINT NOT NULL DEFAULT 0`,
        sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS management_role_name TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS management_scope_label TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS client_secret_hash TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS pair_token_hash TEXT`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS pair_expires_at BIGINT`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS grade_id TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS class_id TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS viewer_instance_id TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS paired BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS viewer_last_seen_at BIGINT NOT NULL DEFAULT 0`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS created_at BIGINT NOT NULL DEFAULT 0`,
        sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0`,
      ]);
      await sql`
        INSERT INTO exam_data (id, items, title, updated_at)
        VALUES (1, '[]', '', 0)
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO write_throttle (id, next_allowed_at)
        VALUES (1, 0)
        ON CONFLICT (id) DO NOTHING
      `;
    })().catch((err) => {
      migratePromise = null;
      throw err;
    });
  }
  return migratePromise;
}

// 判断是否因“表/列尚未创建”报错，仅在首次遇到时才跑迁移并重试。
export function missingRelation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /does not exist|undefined_table|undefined_column/i.test(msg);
}

export function updatedAtIntegerOverflow(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  return code === "22003" && /out of range for type integer/i.test(msg);
}

export const GLOBAL_WRITE_MIN_INTERVAL_MS = 900;

/**
 * Atomically reserves the next global write slot. The database row is shared
 * by every serverless instance, browser tab, and device.
 */
export async function acquireGlobalWriteSlot(): Promise<boolean> {
  const sql = database();
  const attempt = async (): Promise<boolean> => {
    const now = Date.now();
    const rows = (await sql`
      UPDATE write_throttle
      SET next_allowed_at = ${now + GLOBAL_WRITE_MIN_INTERVAL_MS}
      WHERE id = 1 AND next_allowed_at <= ${now}
      RETURNING id
    `) as unknown as Array<{ id: number }>;
    return rows.length > 0;
  };

  try {
    return await attempt();
  } catch (error) {
    if (!missingRelation(error)) throw error;
    await ensureTableOnce();
    return attempt();
  }
}

/**
 * Reserves the shared write slot after a route has completed authentication,
 * scope, request-shape, and conflict validation. Call exactly once before the
 * route's first mutating statement.
 */
export async function acquireWriteSlotOrReject(
  req: VercelRequest,
  res: VercelResponse,
): Promise<boolean> {
  await ensureTableOnce();
  if (await acquireGlobalWriteSlot()) return true;
  sendRateLimited(req, res);
  return false;
}
