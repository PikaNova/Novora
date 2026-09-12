// api/_exams/db.ts
// 数据库连接与建表/迁移：从原 api/exams.ts 抽出，集中管理 neon 客户端、一次性 DDL 与
// “关系/列缺失”“INTEGER 溢出”等错误识别，保持单一职责。

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createDbClient, type DbClient } from '../_dbAdapter.js';
import { SCHEMA_MIGRATION_LOCK_ID } from '../_auth.js';
import { sendRateLimited } from '../_apiError.js';
import { ensureSchemaMigrationTables, recordSchemaMigration } from '../_schemaMigration.js';
import { projectCurrentExamRecords } from './examRecordProjection.js';

// 性能：缓存 neon 客户端（同一 warm 实例复用）。
let _sql: DbClient | null = null;
export function database() {
  if (_sql) return _sql;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  _sql = createDbClient(connectionString);
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
      const migrationStartedAt = Date.now();
      await ensureSchemaMigrationTables(sql, SCHEMA_MIGRATION_LOCK_ID);
      try {
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
          transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS major_batch_presets JSONB NOT NULL DEFAULT '{"subjectGroups":[],"timeGroups":[],"updatedAt":0}'`,
          transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS exam_metadata JSONB NOT NULL DEFAULT '{}'`,
          transaction`ALTER TABLE exam_data ADD COLUMN IF NOT EXISTS lifecycle JSONB NOT NULL DEFAULT '{"status":"draft","createdAt":0,"startedAt":null,"endedAt":null}'`,
          transaction`CREATE TABLE IF NOT EXISTS exam_records (
          id TEXT PRIMARY KEY,
          runtime_major_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'ended', 'archived')),
          items JSONB NOT NULL DEFAULT '[]',
          target_grade_ids JSONB NOT NULL DEFAULT '[]',
          target_class_ids JSONB NOT NULL DEFAULT '[]',
          source TEXT NOT NULL DEFAULT 'regular' CHECK (source IN ('regular', 'quick')),
          temporary BOOLEAN NOT NULL DEFAULT FALSE,
          priority_over_schedule BOOLEAN NOT NULL DEFAULT FALSE,
          config JSONB NOT NULL DEFAULT '{}',
          created_by BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          start_at BIGINT,
          end_at BIGINT,
          actual_start_at BIGINT,
          actual_end_at BIGINT,
          published_at BIGINT,
          ended_at BIGINT,
          archived_at BIGINT,
          version INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0
        )`,
          transaction`CREATE INDEX IF NOT EXISTS idx_exam_records_status ON exam_records(status)`,
          transaction`CREATE INDEX IF NOT EXISTS idx_exam_records_updated ON exam_records(updated_at DESC)`,
          transaction`CREATE TABLE IF NOT EXISTS exam_record_operations (
          idempotency_key TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          source_record_id TEXT NOT NULL,
          result_record_id TEXT NOT NULL,
          created_at BIGINT NOT NULL
        )`,
          transaction`CREATE INDEX IF NOT EXISTS idx_exam_record_operations_created ON exam_record_operations(created_at DESC)`,
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
          transaction`CREATE TABLE IF NOT EXISTS device_commands (
          id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL REFERENCES device_instances(instance_id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          minutes INTEGER,
          created_at BIGINT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          idempotency_key TEXT NOT NULL DEFAULT '',
          expires_at BIGINT,
          claimed_at BIGINT,
          acknowledged_at BIGINT,
          failure_reason TEXT NOT NULL DEFAULT ''
        )`,
          transaction`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`,
          transaction`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT ''`,
          transaction`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS expires_at BIGINT`,
          transaction`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS claimed_at BIGINT`,
          transaction`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS failure_reason TEXT NOT NULL DEFAULT ''`,
          transaction`UPDATE device_commands SET status='acknowledged' WHERE acknowledged_at IS NOT NULL AND status='pending'`,
          transaction`CREATE UNIQUE INDEX IF NOT EXISTS device_commands_idempotency_idx ON device_commands(instance_id, idempotency_key) WHERE idempotency_key <> ''`,
          transaction`CREATE INDEX IF NOT EXISTS device_commands_pending_idx ON device_commands(instance_id, status, created_at)`,
          transaction`CREATE TABLE IF NOT EXISTS app_diagnostic_settings (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          capture_on_error BOOLEAN NOT NULL DEFAULT FALSE,
          before_seconds INTEGER NOT NULL DEFAULT 60,
          after_seconds INTEGER NOT NULL DEFAULT 30,
          retention_days INTEGER NOT NULL DEFAULT 7,
          max_bundle_bytes INTEGER NOT NULL DEFAULT 1048576,
          updated_at BIGINT NOT NULL DEFAULT 0
        )`,
          transaction`CREATE TABLE IF NOT EXISTS app_diagnostic_bundles (
          id BIGSERIAL PRIMARY KEY,
          bundle_id TEXT NOT NULL UNIQUE,
          mode TEXT NOT NULL CHECK (mode IN ('date', 'error')),
          instance_id TEXT NOT NULL,
          device_id TEXT,
          error_event_id TEXT,
          fingerprint TEXT,
          error_code TEXT,
          from_ts BIGINT NOT NULL,
          to_ts BIGINT NOT NULL,
          entries JSONB NOT NULL DEFAULT '[]',
          entry_count INTEGER NOT NULL DEFAULT 0,
          content_bytes INTEGER NOT NULL DEFAULT 0,
          app_version TEXT,
          commit_sha TEXT,
          status TEXT NOT NULL DEFAULT 'retained' CHECK (status IN ('retained', 'queued', 'sending', 'sent', 'failed', 'expired')),
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          requested_by BIGINT,
          created_at BIGINT NOT NULL,
          expires_at BIGINT,
          sent_at BIGINT,
          next_attempt_at BIGINT
        )`,
          transaction`CREATE INDEX IF NOT EXISTS idx_diagnostic_bundles_time ON app_diagnostic_bundles(from_ts, to_ts)`,
          transaction`CREATE INDEX IF NOT EXISTS idx_diagnostic_bundles_error ON app_diagnostic_bundles(error_event_id, fingerprint)`,
          transaction`CREATE INDEX IF NOT EXISTS idx_diagnostic_bundles_status ON app_diagnostic_bundles(status, created_at DESC)`,
          transaction`CREATE INDEX IF NOT EXISTS idx_diagnostic_bundles_retry_due ON app_diagnostic_bundles(status, next_attempt_at, created_at)`,
        ]);
        await sql`INSERT INTO app_diagnostic_settings (id, updated_at) VALUES (1, ${Date.now()}) ON CONFLICT (id) DO NOTHING`;
        await Promise.all([
          ensureUpdatedAtBigIntOnce(),
          sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS temporary_command JSONB`,
          sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS is_management BOOLEAN NOT NULL DEFAULT FALSE`,
          sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS management_actor_id BIGINT NOT NULL DEFAULT 0`,
          sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS management_role_name TEXT NOT NULL DEFAULT ''`,
          sql`ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS management_scope_label TEXT NOT NULL DEFAULT ''`,
          sql`ALTER TABLE classisland_plugin_instances ADD COLUMN IF NOT EXISTS client_secret_hash TEXT NOT NULL DEFAULT ''`,
          sql`ALTER TABLE app_diagnostic_bundles ADD COLUMN IF NOT EXISTS next_attempt_at BIGINT`,
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
        await sql.transaction((transaction) => [projectCurrentExamRecords(transaction)]);
        await recordSchemaMigration(sql, {
          component: 'exams',
          version: 4,
          description: 'exam snapshot, devices, plugins, commands, and write throttle',
          startedAt: migrationStartedAt,
        });
      } catch (error) {
        await recordSchemaMigration(sql, {
          component: 'exams',
          description: 'exam snapshot, devices, plugins, commands, and write throttle',
          startedAt: migrationStartedAt,
          error,
        }).catch(() => undefined);
        throw error;
      }
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
    typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  return code === '22003' && /out of range for type integer/i.test(msg);
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
export async function acquireWriteSlotOrReject(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  await ensureTableOnce();
  if (await acquireGlobalWriteSlot()) return true;
  sendRateLimited(req, res);
  return false;
}
