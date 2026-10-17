// api/_dbAdapter.ts
// 数据库驱动适配层：
// - Neon 云端连接串（host 含 neon.tech，或带 channel_binding 参数）走 @neondatabase/serverless 的 neon()（Neon HTTP 协议）；
// - 本地/内网标准 PostgreSQL 走 pg（原生 5432 协议）。
// 两种驱动对外暴露一致的调用形状，api/_auth.ts 的 authSql() 与 api/_exams/db.ts 的 database() 无需感知底层驱动：
//   标签模板：sql`SELECT ... ${value}` → Promise<rows[]>（rows 为对象数组）
//   事务：sql.transaction(tx => [tx`...`, tx`...`]) → Promise<rows[][]>
import { neon } from '@neondatabase/serverless';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let pgModule: typeof import('pg') | null = null;
function pgClientModule(): typeof import('pg') {
  if (!pgModule) {
    pgModule = require('pg') as typeof import('pg');
  }
  return pgModule;
}

type Row = Record<string, unknown>;

export type SqlTx = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

export type DbClient = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  transaction(
    callback: (tx: SqlTx) => Array<Promise<Row[]> | Row[]> | Promise<Array<Promise<Row[]> | Row[]>>,
  ): Promise<Row[][]>;
};

type QueryExecutor = {
  query(text: string, values: unknown[]): Promise<{ rows: Row[] }>;
};

export function isNeonEndpoint(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.hostname.includes('neon.tech') || url.searchParams.has('channel_binding');
  } catch {
    return false;
  }
}

export function buildSqlText(strings: readonly string[], values: unknown[]): string {
  let text = strings[0] ?? '';
  for (let index = 0; index < values.length; index += 1) {
    text += `$${index + 1}${strings[index + 1] ?? ''}`;
  }
  return text;
}

function runQuery(executor: QueryExecutor, strings: TemplateStringsArray, values: unknown[]): Promise<Row[]> {
  return executor.query(buildSqlText(strings, values), values).then((result) => result.rows);
}

function createPgClient(connectionString: string): DbClient {
  const { Pool } = pgClientModule();
  const requestedMax = Number.parseInt(process.env.NOVORA_PG_POOL_MAX ?? '', 10);
  const poolMax = Number.isFinite(requestedMax) ? Math.max(2, Math.min(16, requestedMax)) : 4;
  const pool = new Pool({
    connectionString,
    max: poolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  const poolExecutor = pool as unknown as QueryExecutor;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    runQuery(poolExecutor, strings, values)) as DbClient;

  sql.transaction = async (callback) => {
    const connection = await pool.connect();
    const connectionExecutor = connection as unknown as QueryExecutor;
    try {
      await connection.query('BEGIN');
      const tx: SqlTx = (strings, ...values) => runQuery(connectionExecutor, strings, values);
      const listed = await callback(tx);
      const results = await Promise.all(listed.map((item) => Promise.resolve(item)));
      await connection.query('COMMIT');
      return results;
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  };

  return sql;
}

export function createDbClient(connectionString: string): DbClient {
  return isNeonEndpoint(connectionString)
    ? (neon(connectionString) as unknown as DbClient)
    : createPgClient(connectionString);
}
