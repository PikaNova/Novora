/**
 * T-280-04：考试记录层迁移与回滚脚本的真实验证。
 *
 * 直接执行 `migrations/0004_*.sql`（与 0003 一样，这两个文件是部署审计与手动初始化用的
 * 幂等脚本），在独立 schema 里验证四种场景：空库、旧库（v2.7.x 只有 exam_data）、
 * 重复执行、回滚不丢数据；并顺带核对脚本与运行时 DDL 的结构一致。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';

const require = createRequire(import.meta.url);
const { Client } = require('pg') as typeof import('pg');

const PROBE_SCHEMA = 'migration_probe';
const FORWARD_SQL = path.resolve('migrations/0004_create_exam_record_tables.sql');
const ROLLBACK_SQL = path.resolve('migrations/0004_rollback_exam_record_tables.sql');

function script(file: string): string {
  return readFileSync(file, 'utf8');
}

async function withProbeDatabase(run: (client: import('pg').Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${PROBE_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${PROBE_SCHEMA}`);
    await client.query(`SET search_path TO ${PROBE_SCHEMA}`);
    await run(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${PROBE_SCHEMA} CASCADE`).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

async function columns(client: import('pg').Client, schema: string, table: string): Promise<string[]> {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 ORDER BY column_name`,
    [schema, table],
  );
  return result.rows.map((row: { column_name: string }) => row.column_name);
}

async function tableExists(client: import('pg').Client, schema: string, table: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  return (result.rowCount ?? 0) > 0;
}

after(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${PROBE_SCHEMA} CASCADE`).catch(() => undefined);
  await client.end().catch(() => undefined);
});

test('迁移 0004：空库可建表且结构与运行时 DDL 一致', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let runtimeColumns: string[] = [];
  try {
    runtimeColumns = await columns(client, 'public', 'exam_records');
  } finally {
    await client.end();
  }
  assert.ok(runtimeColumns.length > 0, '集成库应当已有运行时建出的 exam_records');

  await withProbeDatabase(async (probe) => {
    await probe.query(script(FORWARD_SQL));
    assert.equal(await tableExists(probe, PROBE_SCHEMA, 'exam_records'), true);
    assert.equal(await tableExists(probe, PROBE_SCHEMA, 'exam_record_operations'), true);
    assert.deepEqual(
      await columns(probe, PROBE_SCHEMA, 'exam_records'),
      runtimeColumns,
      '迁移脚本必须与运行时 DDL 保持同构，否则手动初始化的库会缺列',
    );
    assert.deepEqual(
      await columns(probe, PROBE_SCHEMA, 'exam_record_operations'),
      await (async () => {
        const c = new Client({ connectionString: process.env.DATABASE_URL });
        await c.connect();
        try {
          return await columns(c, 'public', 'exam_record_operations');
        } finally {
          await c.end();
        }
      })(),
    );
  });
});

test('迁移 0004：旧库（只有 exam_data）升级后权威快照不变，只是多了空记录表', async () => {
  await withProbeDatabase(async (probe) => {
    // 模拟 v2.7.x：只有 exam_data，且里面已经有一场考试
    await probe.query(`
      CREATE TABLE exam_data (
        id INTEGER PRIMARY KEY DEFAULT 1,
        items JSONB NOT NULL DEFAULT '[]',
        title TEXT NOT NULL DEFAULT '',
        majors JSONB NOT NULL DEFAULT '[]',
        active_major_id TEXT NOT NULL DEFAULT '',
        updated_at BIGINT NOT NULL
      )
    `);
    const majors = [{ id: 'legacy-1', name: '历史考试', items: [], order: 0, source: 'regular' }];
    await probe.query(`INSERT INTO exam_data (id, majors, updated_at) VALUES (1, $1::jsonb, $2)`, [
      JSON.stringify(majors),
      Date.now(),
    ]);

    await probe.query(script(FORWARD_SQL));

    const snapshot = await probe.query(`SELECT majors FROM exam_data WHERE id = 1`);
    assert.deepEqual(snapshot.rows[0].majors, majors, '迁移不得改写权威快照');
    const records = await probe.query(`SELECT COUNT(*)::int AS count FROM exam_records`);
    assert.equal(records.rows[0].count, 0, '旧库升级只建结构，记录由运行时投影补');
  });
});

test('迁移 0004：重复执行不会报错也不会重复建对象', async () => {
  await withProbeDatabase(async (probe) => {
    await probe.query(script(FORWARD_SQL));
    const first = await probe.query(
      `SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = $1`,
      [PROBE_SCHEMA],
    );
    const firstIndexes = await probe.query(`SELECT COUNT(*)::int AS count FROM pg_indexes WHERE schemaname = $1`, [
      PROBE_SCHEMA,
    ]);

    await probe.query(script(FORWARD_SQL));
    await probe.query(script(FORWARD_SQL));

    const second = await probe.query(
      `SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = $1`,
      [PROBE_SCHEMA],
    );
    const secondIndexes = await probe.query(`SELECT COUNT(*)::int AS count FROM pg_indexes WHERE schemaname = $1`, [
      PROBE_SCHEMA,
    ]);
    assert.equal(second.rows[0].count, first.rows[0].count);
    assert.equal(secondIndexes.rows[0].count, firstIndexes.rows[0].count);
  });
});

test('回滚 0004：只删派生投影，权威快照与操作日志都保留', async () => {
  await withProbeDatabase(async (probe) => {
    await probe.query(`
      CREATE TABLE exam_data (
        id INTEGER PRIMARY KEY DEFAULT 1,
        majors JSONB NOT NULL DEFAULT '[]',
        updated_at BIGINT NOT NULL
      )
    `);
    const majors = [{ id: 'rollback-1', name: '回滚前考试', items: [], order: 0, source: 'quick' }];
    await probe.query(`INSERT INTO exam_data (id, majors, updated_at) VALUES (1, $1::jsonb, $2)`, [
      JSON.stringify(majors),
      Date.now(),
    ]);
    await probe.query(script(FORWARD_SQL));
    await probe.query(`INSERT INTO exam_records (id, runtime_major_id, name, status, created_at, updated_at)
      VALUES ('rollback-1', 'rollback-1', '回滚前考试', 'published', 1, 1)`);
    await probe.query(`INSERT INTO exam_record_operations
      (idempotency_key, action, source_record_id, result_record_id, from_status, to_status, reason, created_at)
      VALUES ('op-1', 'publish', 'rollback-1', 'rollback-1', 'draft', 'published', '', 1)`);

    await probe.query(script(ROLLBACK_SQL));

    assert.equal(await tableExists(probe, PROBE_SCHEMA, 'exam_records'), false, '派生投影应被删除');
    assert.equal(
      await tableExists(probe, PROBE_SCHEMA, 'exam_record_operations'),
      true,
      '操作日志不可重建，回滚默认保留',
    );
    const operations = await probe.query(`SELECT COUNT(*)::int AS count FROM exam_record_operations`);
    assert.equal(operations.rows[0].count, 1);
    const snapshot = await probe.query(`SELECT majors FROM exam_data WHERE id = 1`);
    assert.deepEqual(snapshot.rows[0].majors, majors, '回滚不得丢权威数据');

    // 回滚后再升级一次即可重建结构（等价于运行时 ensureTableOnce 的自愈）
    await probe.query(script(FORWARD_SQL));
    assert.equal(await tableExists(probe, PROBE_SCHEMA, 'exam_records'), true);
  });
});
