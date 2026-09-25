// api/_auth/db.ts
// 鉴权模块的数据库入口：连接、单行配置缓存、建表编排、全局令牌版本。
// 具体的 DDL 在 ./tables.ts，种子与存量数据迁移在 ./seeds.ts。
import { createDbClient, type DbClient } from '../_dbAdapter.js';
import { assertRows } from '../_validation.js';
import { ensureSchemaMigrationTables, recordSchemaMigration } from '../_schemaMigration.js';
import { AUTH_CONFIG_CACHE_MS, BOOTSTRAP_PASSWORD } from './env.js';
import { authSchemaStatements } from './tables.js';
import { migrateLegacyRoleAssignments, seedBuiltinRoles, seedMailThrottleRow } from './seeds.js';
import { isAuthRow, isCountRow, isPasswordSaltRow, isUserIdRow, type AuthRow } from './shapes.js';

export const SCHEMA_MIGRATION_LOCK_ID = 1649236847;

let sqlClient: DbClient | null = null;
let setupPromise: Promise<void> | null = null;
let authConfigCache: { at: number; row: AuthRow | null } | null = null;

export function invalidateAuthConfigCache(): void {
  authConfigCache = null;
}

export function authSql() {
  if (sqlClient) return sqlClient;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  sqlClient = createDbClient(url);
  return sqlClient;
}

export async function ensureAuthTables(): Promise<void> {
  if (!setupPromise)
    setupPromise = (async () => {
      const sql = authSql();
      const migrationStartedAt = Date.now();
      await ensureSchemaMigrationTables(sql, SCHEMA_MIGRATION_LOCK_ID);
      try {
        await sql.transaction((transaction) => [
          transaction`SELECT pg_advisory_xact_lock(${SCHEMA_MIGRATION_LOCK_ID})`,
          ...authSchemaStatements(transaction),
        ]);
        const now = Date.now();
        await seedMailThrottleRow(authSql());
        await seedBuiltinRoles(sql, now);
        await migrateLegacyRoleAssignments(sql, now);
        // 已经完成过旧版密码初始化的数据库可直接生成默认超级管理员，无需再次输入或重置数据。
        const [legacyRowsRaw, userCountRowsRaw] = await Promise.all([
          sql`SELECT password_hash, password_salt FROM app_auth WHERE id=1`,
          sql`SELECT COUNT(*)::int AS count FROM app_users`,
        ]);
        const legacyRows = assertRows(legacyRowsRaw, isPasswordSaltRow, 'app_auth');
        const userCountRows = assertRows(userCountRowsRaw, isCountRow, 'app_users');
        if (legacyRows[0] && Number(userCountRows[0]?.count) === 0) {
          const created = assertRows(
            await sql`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
        VALUES ('admin', '超级管理员', ${legacyRows[0].password_hash}, ${legacyRows[0].password_salt}, 'super_admin', 'active', FALSE, 1, ${now}, ${now})
        ON CONFLICT DO NOTHING RETURNING id`,
            isUserIdRow,
            'app_users',
          );
          if (created[0])
            await sql`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id) VALUES (${created[0].id}, 'all', '', '') ON CONFLICT DO NOTHING`;
        }
        await recordSchemaMigration(sql, {
          component: 'auth',
          description: 'authentication tables, roles, and bootstrap data',
          startedAt: migrationStartedAt,
        });
      } catch (error) {
        await recordSchemaMigration(sql, {
          component: 'auth',
          description: 'authentication tables, roles, and bootstrap data',
          startedAt: migrationStartedAt,
          error,
        }).catch(() => undefined);
        throw error;
      }
    })().catch((error) => {
      setupPromise = null;
      throw error;
    });
  return setupPromise;
}

export async function config(): Promise<AuthRow | null> {
  await ensureAuthTables();
  const now = Date.now();
  if (authConfigCache && now - authConfigCache.at < AUTH_CONFIG_CACHE_MS) return authConfigCache.row;
  const rows = assertRows(
    await authSql()`SELECT password_hash, password_salt, token_secret, token_version FROM app_auth WHERE id = 1`,
    isAuthRow,
    'app_auth',
  );
  const row = rows[0] ?? null;
  authConfigCache = { at: now, row };
  return row;
}

/**
 * The v1.29.1-and-earlier three-part compatibility token is signed against
 * this global version and maps to the default admin account. This deliberately
 * invalidates every remaining legacy shared token, not an individual account.
 */
export async function invalidateLegacySharedToken(): Promise<void> {
  await authSql()`UPDATE app_auth SET token_version=token_version+1, updated_at=${Date.now()} WHERE id=1`;
  invalidateAuthConfigCache();
}

export async function isPasswordRequired(): Promise<boolean> {
  await ensureAuthTables();
  const rows = assertRows(await authSql()`SELECT COUNT(*)::int AS count FROM app_users`, isCountRow, 'app_users');
  return Number(rows[0]?.count) > 0 || !!(await config()) || !!BOOTSTRAP_PASSWORD;
}
