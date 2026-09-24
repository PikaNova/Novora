import { randomUUID } from 'node:crypto';
import type { DbClient } from './_dbAdapter.js';

/**
 * The last schema version shared by the v2.7 components. Keep this export for
 * callers that only need the legacy baseline; new migrations use the
 * component-specific versions below.
 */
export const NOVORA_SCHEMA_VERSION = 3;

export const SCHEMA_COMPONENT_VERSIONS: Record<SchemaComponent, number> = {
  auth: 3,
  // 5：新增学校侧考试公告表 exam_announcements（与 0005 迁移同一步）。
  exams: 5,
};

export type SchemaComponent = 'auth' | 'exams';

const SCHEMA_COMPONENTS: readonly SchemaComponent[] = ['auth', 'exams'];

export type SchemaMigrationLog = {
  component: SchemaComponent;
  version: number;
  description: string;
  requestId: string;
  status: 'success' | 'failed';
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  error: string;
};

export type SchemaMigrationState = {
  versions: Record<SchemaComponent, number | null>;
  expectedVersions: Record<SchemaComponent, number>;
  version: number | null;
  matches: boolean;
  migrations: SchemaMigrationLog[];
};

type SchemaVersionRow = { component: string; version: number };

type SchemaLogRow = {
  component: string;
  version: number;
  description: string;
  request_id: string;
  status: string;
  started_at: number | string;
  completed_at: number | string | null;
  duration_ms: number | string | null;
  error: string;
};

const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNullableNumber = (value: unknown): value is number | null => value === null || isNumber(value);
const isNullableText = (value: unknown): value is string | null => value === null || isText(value);

function componentOf(value: unknown): SchemaComponent | null {
  return value === 'auth' || value === 'exams' ? value : null;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function ensureSchemaMigrationTables(sql: DbClient, lockId: number): Promise<void> {
  await sql.transaction((transaction) => [
    transaction`SELECT pg_advisory_xact_lock(${lockId})`,
    transaction`CREATE TABLE IF NOT EXISTS app_schema_versions (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
    transaction`CREATE TABLE IF NOT EXISTS app_schema_migration_logs (
      id BIGSERIAL PRIMARY KEY,
      component TEXT NOT NULL,
      version INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      request_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
      started_at BIGINT NOT NULL,
      completed_at BIGINT,
      duration_ms INTEGER,
      error TEXT NOT NULL DEFAULT ''
    )`,
    transaction`CREATE INDEX IF NOT EXISTS idx_schema_migration_logs_recent
      ON app_schema_migration_logs (component, id DESC)`,
  ]);
}

export async function recordSchemaMigration(
  sql: DbClient,
  input: {
    component: SchemaComponent;
    version?: number;
    description: string;
    startedAt: number;
    error?: unknown;
  },
): Promise<string> {
  const version = input.version ?? SCHEMA_COMPONENT_VERSIONS[input.component];
  const requestId = text(process.env.SCHEMA_MIGRATION_REQUEST_ID).slice(0, 128) || randomUUID();
  const completedAt = Date.now();
  const failed = input.error !== undefined;
  const error = failed ? String(input.error instanceof Error ? input.error.message : input.error).slice(0, 2000) : '';

  await sql`
    INSERT INTO app_schema_migration_logs (
      component, version, description, request_id, status,
      started_at, completed_at, duration_ms, error
    )
    VALUES (
      ${input.component}, ${version}, ${input.description.slice(0, 256)},
      ${requestId}, ${failed ? 'failed' : 'success'}, ${input.startedAt},
      ${completedAt}, ${Math.max(0, completedAt - input.startedAt)}, ${error}
    )
  `;

  if (!failed) {
    await sql`
      INSERT INTO app_schema_versions (component, version, updated_at)
      VALUES (${input.component}, ${version}, ${completedAt})
      ON CONFLICT (component) DO UPDATE SET
        version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at
    `;
  }

  return requestId;
}

export async function readSchemaMigrationState(sql: DbClient): Promise<SchemaMigrationState> {
  const versionRows = (await sql`
    SELECT component, version FROM app_schema_versions WHERE component = ANY(${SCHEMA_COMPONENTS})
  `) as unknown as Array<SchemaVersionRow>;
  const logRows = (await sql`
    SELECT component, version, description, request_id, status, started_at, completed_at, duration_ms, error
    FROM app_schema_migration_logs
    ORDER BY id DESC
    LIMIT 10
  `) as unknown as Array<SchemaLogRow>;

  const versions = {
    auth: null,
    exams: null,
  } as Record<SchemaComponent, number | null>;
  for (const row of versionRows) {
    const component = componentOf(row.component);
    if (component && isNumber(row.version)) versions[component] = row.version;
  }

  const migrations: SchemaMigrationLog[] = [];
  for (const row of logRows) {
    const component = componentOf(row.component);
    const version = number(row.version, 0);
    const status = row.status === 'failed' ? 'failed' : row.status === 'success' ? 'success' : null;
    const startedAt = number(row.started_at);
    const completedAt = row.completed_at == null ? null : number(row.completed_at);
    if (!component || !isText(row.description) || !isText(row.request_id) || !status || !isNumber(startedAt)) continue;
    if (!isNullableNumber(completedAt) || !isNullableNumber(row.duration_ms) || !isNullableText(row.error)) continue;
    migrations.push({
      component,
      version,
      description: row.description,
      requestId: row.request_id,
      status,
      startedAt,
      completedAt,
      durationMs: row.duration_ms,
      error: row.error,
    });
  }

  const expectedVersions: Record<SchemaComponent, number> = { ...SCHEMA_COMPONENT_VERSIONS };
  const matches = SCHEMA_COMPONENTS.every((component) => versions[component] === expectedVersions[component]);
  const currentValues = SCHEMA_COMPONENTS.map((component) => versions[component]).filter(
    (value): value is number => value != null,
  );

  return {
    versions,
    expectedVersions,
    version: currentValues.length === SCHEMA_COMPONENTS.length ? Math.min(...currentValues) : null,
    matches,
    migrations,
  };
}
