import assert from 'node:assert/strict';
import test from 'node:test';
import { authSql, ensureAuthTables } from '../../api/_auth.js';
import { database, ensureTableOnce } from '../../api/_exams/db.js';
import { projectCurrentExamRecords } from '../../api/_exams/examRecordProjection.js';
import { SCHEMA_COMPONENT_VERSIONS, readSchemaMigrationState } from '../../api/_schemaMigration.js';
import { isDatabaseInt8, rowShape } from '../../api/_validation.js';

type DatabaseInt8Row = { updated_at: number | string };

test('schema migration: records versions and success logs for both components', async () => {
  await ensureTableOnce();
  await ensureAuthTables();

  const state = await readSchemaMigrationState(authSql());
  assert.equal(state.version, Math.min(...Object.values(SCHEMA_COMPONENT_VERSIONS)));
  assert.equal(state.matches, true);
  assert.equal(state.versions.auth, SCHEMA_COMPONENT_VERSIONS.auth);
  assert.equal(state.versions.exams, SCHEMA_COMPONENT_VERSIONS.exams);

  for (const component of ['auth', 'exams'] as const) {
    const log = state.migrations.find((item) => item.component === component && item.status === 'success');
    assert.ok(log, `expected a successful ${component} migration log`);
    assert.equal(log?.version, SCHEMA_COMPONENT_VERSIONS[component]);
    assert.ok(log?.requestId, 'migration log must include a request id');
    assert.ok(log?.durationMs != null && log.durationMs >= 0, 'migration log must include duration');
  }
});

test('schema migration: repeated initialization does not duplicate schema rows', async () => {
  await ensureTableOnce();
  await ensureAuthTables();
  const before = (await database()`
      SELECT
        (SELECT COUNT(*)::int FROM app_schema_versions) AS version_count,
        (SELECT COUNT(*)::int FROM app_schema_migration_logs) AS log_count
    `) as unknown as Array<{ version_count: number; log_count: number }>;

  await ensureTableOnce();
  await ensureAuthTables();

  const after = (await database()`
      SELECT
        (SELECT COUNT(*)::int FROM app_schema_versions) AS version_count,
        (SELECT COUNT(*)::int FROM app_schema_migration_logs) AS log_count
    `) as unknown as Array<{ version_count: number; log_count: number }>;

  assert.equal(Number(after[0]?.version_count), 2);
  assert.equal(Number(after[0]?.version_count), Number(before[0]?.version_count));
  assert.equal(Number(after[0]?.log_count), Number(before[0]?.log_count));
});

test('database write: BIGINT timestamps survive the driver boundary', async () => {
  await ensureTableOnce();
  const bigintValue = 4102444800000;
  await database()`UPDATE exam_data SET updated_at=${bigintValue} WHERE id=1`;
  const rows = (await database()`SELECT updated_at FROM exam_data WHERE id=1`) as unknown as Array<{
    updated_at: unknown;
  }>;
  const guard = rowShape<DatabaseInt8Row>({
    updated_at: isDatabaseInt8,
  });
  assert.equal(guard(rows[0]), true, 'BIGINT must arrive as a safe number or decimal string');
  assert.equal(Number(rows[0]?.updated_at), bigintValue);
});

test('exam record projection: snapshot majors are backfilled without removing records', async () => {
  await ensureTableOnce();
  const now = Date.now();
  const major = {
    id: `integration-record-${now}`,
    name: '集成测试考试',
    items: [],
    order: 2,
    source: 'regular',
    targetGradeIds: ['g1'],
    targetClassIds: ['c1'],
    createdAt: now - 1000,
  };
  await database()`UPDATE exam_data SET majors=${JSON.stringify([major])}::jsonb, updated_at=${now} WHERE id=1`;
  await database().transaction((transaction) => [projectCurrentExamRecords(transaction)]);
  const rows = (await database()`
    SELECT id, runtime_major_id, name, status, target_grade_ids, target_class_ids
    FROM exam_records WHERE id=${major.id}
  `) as unknown as Array<Record<string, unknown>>;
  assert.equal(rows[0]?.id, major.id);
  assert.equal(rows[0]?.runtime_major_id, major.id);
  assert.equal(rows[0]?.name, major.name);
  assert.equal(rows[0]?.status, 'draft');
  assert.deepEqual(rows[0]?.target_grade_ids, ['g1']);
  assert.deepEqual(rows[0]?.target_class_ids, ['c1']);
  await database()`UPDATE exam_data SET majors='[]'::jsonb, updated_at=${now + 1} WHERE id=1`;
});
