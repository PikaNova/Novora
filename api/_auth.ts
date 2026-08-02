import { neon } from '@neondatabase/serverless';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  ALL_PERMISSIONS,
  canAccessClass as sharedCanAccessClass,
  canAccessGrade as sharedCanAccessGrade,
  hasPermission as sharedHasPermission,
  type Permission,
  type PermissionScope,
} from '../src/shared/permissionRules.js';
import { assertRows, isBoolean, isNullableString, isNumberLike, isString, rowShape } from './_validation.js';

const scrypt = promisify(scryptCallback);
const BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD || '';
// 仅用于兼容已经配置过旧版环境变量的部署。新部署会在首次初始化时自动生成恢复密钥。
const LEGACY_ADMIN_RECOVERY_KEY = process.env.ADMIN_RECOVERY_KEY || '';
const TOKEN_TTL = 24 * 60 * 60 * 1000;
const REPAIR_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const REPAIR_RATE_LIMIT_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MAX_FAILURES = 5;
const LOGIN_ALERT_MIN_FAILURES = 3;
export const SCHEMA_MIGRATION_LOCK_ID = 1649236847;

// 权限常量与基础类型现统一定义在 src/shared/permissionRules.ts，前后端共用同一份，避免漂移。
// 仍从本文件导出，保持其他 api/*.ts 文件 `from './_auth.js'` 的引用方式不变。
export { ALL_PERMISSIONS };
export type { Permission };
export type AdminScope = PermissionScope;
export type AdminActor = {
  id: number;
  username: string;
  displayName: string;
  roleId: string;
  roleName: string;
  permissions: Permission[];
  scopes: AdminScope[];
  mustChangePassword: boolean;
};

type AuthRow = { password_hash: string; password_salt: string; token_secret: string; token_version: number };
type UserRow = {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  role_id: string;
  role_name: string;
  permissions: unknown;
  status: string;
  must_change_password: boolean;
  token_version: number;
  last_login_at?: number | null;
};

const isPasswordSaltRow = rowShape<{ password_hash: string; password_salt: string }>({
  password_hash: isString,
  password_salt: isString,
});
const isCountRow = rowShape<{ count: number }>({ count: isNumberLike });
const isIdRow = rowShape<{ id: number }>({ id: isNumberLike });
const isIpSaltRow = rowShape<{ ip_salt: string }>({ ip_salt: isString });
const isAuthRow = rowShape<AuthRow>({
  password_hash: isString,
  password_salt: isString,
  token_secret: isString,
  token_version: isNumberLike,
});
const isRecoveryHashRow = rowShape<{ recovery_key_hash?: string | null }>({
  recovery_key_hash: isNullableString,
});
const isRecoveryHashSaltRow = rowShape<{ recovery_key_hash?: string | null; recovery_key_salt?: string | null }>({
  recovery_key_hash: isNullableString,
  recovery_key_salt: isNullableString,
});
const isIdUsernameRow = rowShape<{ id: number; username: string }>({ id: isNumberLike, username: isString });
const isCountOldestRow = rowShape<{ count: number; oldest: number }>({ count: isNumberLike, oldest: isNumberLike });
const isUserRow = rowShape<UserRow>({
  id: isNumberLike,
  username: isString,
  display_name: isString,
  password_hash: isString,
  password_salt: isString,
  role_id: isString,
  role_name: isString,
  permissions: (value): value is unknown => value !== undefined,
  status: isString,
  must_change_password: isBoolean,
  token_version: isNumberLike,
  last_login_at: (value): value is number | null | undefined => value == null || isNumberLike(value),
});
const isScopeRow = rowShape<{ scope_type: string; grade_id: string; class_id: string }>({
  scope_type: isString,
  grade_id: isString,
  class_id: isString,
});

let sqlClient: ReturnType<typeof neon> | null = null;
let setupPromise: Promise<void> | null = null;

export function authSql() {
  if (sqlClient) return sqlClient;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  sqlClient = neon(url);
  return sqlClient;
}

export const BUILTIN_ROLES: Array<{ id: string; name: string; description: string; permissions: Permission[] }> = [
  { id: 'super_admin', name: '超级管理员', description: '拥有全校数据与全部系统权限，可管理用户、角色、部署及所有业务设置。', permissions: ['*'] },
  { id: 'grade_admin', name: '年级管理员', description: '管理授权年级的考试、周测、班级、设备和下级用户，可批量创建该年级的班级管理员，并查看该年级完整运行总览。', permissions: ['overview.read', 'major.read', 'major.create', 'major.quick_create', 'major.edit', 'major.delete', 'major.import', 'major.export', 'weekly.read', 'weekly.create', 'weekly.edit', 'weekly.delete', 'weekly.copy', 'weekly.override', 'weekly.import', 'weekly.export', 'school.read', 'school.class_manage', 'device.read', 'device.bind', 'device.revoke', 'schedule.term_edit', 'schedule.ab_week_edit', 'schedule.holiday_edit', 'alerts.read', 'settings.read', 'settings.major_batch_edit', 'user.read', 'user.create', 'user.edit', 'user.disable', 'user.delete', 'user.reset_password'] },
  { id: 'class_admin', name: '班级管理员', description: '管理授权班级的周测、考试安排和绑定设备，可快速发布本班临时考试并修改自己的用户名与密码，不显示项目运行总览。', permissions: ['major.read', 'major.quick_create', 'weekly.read', 'weekly.create', 'weekly.edit', 'weekly.delete', 'weekly.copy', 'weekly.override', 'weekly.import', 'weekly.export', 'school.read', 'device.read', 'device.bind', 'device.revoke', 'alerts.read'] },
  { id: 'viewer', name: '只读用户', description: '仅按授权范围预览和导出考试与周测安排，不进入运行总览。', permissions: ['major.read', 'weekly.read', 'weekly.export', 'school.read'] },
];

export async function ensureAuthTables(): Promise<void> {
  if (!setupPromise) setupPromise = (async () => {
    const sql = authSql();
    await sql.transaction(transaction => [
      transaction`SELECT pg_advisory_xact_lock(${SCHEMA_MIGRATION_LOCK_ID})`,
      transaction`CREATE TABLE IF NOT EXISTS app_auth (
        id INTEGER PRIMARY KEY DEFAULT 1,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        token_secret TEXT NOT NULL,
        token_version INTEGER NOT NULL DEFAULT 1,
        initialized_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        CHECK (id = 1)
      )`,
      transaction`ALTER TABLE app_auth ADD COLUMN IF NOT EXISTS recovery_key_hash TEXT`,
      transaction`ALTER TABLE app_auth ADD COLUMN IF NOT EXISTS recovery_key_salt TEXT`,
      transaction`CREATE TABLE IF NOT EXISTS app_telemetry_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        ip_salt TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        CHECK (id = 1)
      )`,
      transaction`CREATE TABLE IF NOT EXISTS app_roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        permissions JSONB NOT NULL DEFAULT '[]',
        built_in BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
      transaction`CREATE TABLE IF NOT EXISTS app_users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role_id TEXT NOT NULL REFERENCES app_roles(id),
        status TEXT NOT NULL DEFAULT 'active',
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        token_version INTEGER NOT NULL DEFAULT 1,
        last_login_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
      transaction`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_lower ON app_users (LOWER(username))`,
      transaction`CREATE TABLE IF NOT EXISTS app_user_scopes (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL,
        grade_id TEXT NOT NULL DEFAULT '',
        class_id TEXT NOT NULL DEFAULT '',
        UNIQUE(user_id, scope_type, grade_id, class_id)
      )`,
      transaction`CREATE TABLE IF NOT EXISTS app_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        username TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL DEFAULT '',
        resource_id TEXT NOT NULL DEFAULT '',
        grade_id TEXT NOT NULL DEFAULT '',
        class_id TEXT NOT NULL DEFAULT '',
        detail JSONB,
        created_at BIGINT NOT NULL
      )`,
    ]);
    const now = Date.now();
    await Promise.all(BUILTIN_ROLES.map(role => sql`INSERT INTO app_roles (id, name, description, permissions, built_in, created_at, updated_at)
      VALUES (${role.id}, ${role.name}, ${role.description}, ${JSON.stringify(role.permissions)}::jsonb, TRUE, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, permissions=EXCLUDED.permissions, built_in=TRUE, updated_at=EXCLUDED.updated_at`));
    // v1.32：精简旧内置角色。教务管理员降为全范围年级管理员，设备管理员迁移为只读用户。
    await sql`UPDATE app_users SET role_id='grade_admin', token_version=token_version+1, updated_at=${now} WHERE role_id='academic_admin'`;
    await sql`UPDATE app_users SET role_id='viewer', token_version=token_version+1, updated_at=${now} WHERE role_id='device_admin'`;
    await sql`DELETE FROM app_roles WHERE id IN ('academic_admin','device_admin') AND NOT EXISTS (SELECT 1 FROM app_users WHERE app_users.role_id=app_roles.id)`;
    // 已经完成过旧版密码初始化的数据库可直接生成默认超级管理员，无需再次输入或重置数据。
    const [legacyRowsRaw, userCountRowsRaw] = await Promise.all([
      sql`SELECT password_hash, password_salt FROM app_auth WHERE id=1`,
      sql`SELECT COUNT(*)::int AS count FROM app_users`,
    ]);
    const legacyRows = assertRows(legacyRowsRaw, isPasswordSaltRow, 'app_auth');
    const userCountRows = assertRows(userCountRowsRaw, isCountRow, 'app_users');
    if (legacyRows[0] && Number(userCountRows[0]?.count) === 0) {
      const created = assertRows(await sql`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
        VALUES ('admin', '超级管理员', ${legacyRows[0].password_hash}, ${legacyRows[0].password_salt}, 'super_admin', 'active', FALSE, 1, ${now}, ${now})
        ON CONFLICT DO NOTHING RETURNING id`, isIdRow, 'app_users');
      if (created[0]) await sql`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id) VALUES (${created[0].id}, 'all', '', '') ON CONFLICT DO NOTHING`;
    }
  })().catch(error => { setupPromise = null; throw error; });
  return setupPromise;
}

let telemetryIpSaltPromise: Promise<string> | null = null;

/**
 * Creates one server-only, persistent salt for telemetry IP pseudonymization.
 * The compatibility path never exposes this value in API responses or logs.
 */
export async function ensureTelemetryIpSalt(): Promise<string> {
  if (!telemetryIpSaltPromise) {
    telemetryIpSaltPromise = (async () => {
      await ensureAuthTables();
      const sql = authSql();
      const generated = randomBytes(24).toString('base64url');
      await sql`INSERT INTO app_telemetry_config (id, ip_salt, created_at)
        VALUES (1, ${generated}, ${Date.now()}) ON CONFLICT (id) DO NOTHING`;
      const rows = assertRows(await sql`SELECT ip_salt FROM app_telemetry_config WHERE id=1`, isIpSaltRow, 'app_telemetry_config');
      const value = rows[0]?.ip_salt;
      if (!value) throw new Error('Telemetry IP salt is unavailable');
      return value;
    })().catch(error => {
      telemetryIpSaltPromise = null;
      throw error;
    });
  }
  return telemetryIpSaltPromise;
}

async function config(): Promise<AuthRow | null> {
  await ensureAuthTables();
  const rows = assertRows(await authSql()`SELECT password_hash, password_salt, token_secret, token_version FROM app_auth WHERE id = 1`, isAuthRow, 'app_auth');
  return rows[0] ?? null;
}

export async function makePasswordHash(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('base64url');
  const key = await scrypt(password, salt, 64) as Buffer;
  return { hash: key.toString('base64url'), salt };
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await scrypt(password, salt, 64) as Buffer;
  return key.toString('base64url');
}

async function matches(password: string, hash: string, salt: string): Promise<boolean> {
  const actual = Buffer.from(await hashPassword(password, salt));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function isAdminRecoveryConfigured(): Promise<boolean> {
  await ensureAuthTables();
  const rows = assertRows(await authSql()`SELECT recovery_key_hash FROM app_auth WHERE id=1`, isRecoveryHashRow, 'app_auth');
  return !!rows[0]?.recovery_key_hash || LEGACY_ADMIN_RECOVERY_KEY.length >= 16;
}

async function recoveryKeyMatches(recoveryKey: string): Promise<boolean> {
  const recoveryRows = assertRows(await authSql()`SELECT recovery_key_hash, recovery_key_salt FROM app_auth WHERE id=1`, isRecoveryHashSaltRow, 'app_auth');
  const stored = recoveryRows[0];
  if (stored?.recovery_key_hash && stored.recovery_key_salt) {
    return matches(recoveryKey, stored.recovery_key_hash, stored.recovery_key_salt);
  }
  if (LEGACY_ADMIN_RECOVERY_KEY.length >= 16) {
    const supplied = Buffer.from(recoveryKey);
    const expected = Buffer.from(LEGACY_ADMIN_RECOVERY_KEY);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  return false;
}

export async function recoverSuperAdmin(username: string, recoveryKey: string, nextPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (!await isAdminRecoveryConfigured()) return { ok: false, error: '当前项目尚未生成超级管理员恢复密钥' };
  if (nextPassword.length < 8) return { ok: false, error: '新密码至少需要 8 位' };
  await ensureAuthTables();
  const keyMatches = await recoveryKeyMatches(recoveryKey);
  const rows = assertRows(await authSql()`SELECT id, username FROM app_users
    WHERE LOWER(username)=LOWER(${username.trim().slice(0, 80)}) AND role_id='super_admin' AND status='active' LIMIT 1`, isIdUsernameRow, 'app_users');
  if (!keyMatches || !rows[0]) return { ok: false, error: '恢复信息不正确' };
  const password = await makePasswordHash(nextPassword);
  await invalidateLegacySharedToken();
  await authSql()`UPDATE app_users SET password_hash=${password.hash}, password_salt=${password.salt},
    must_change_password=TRUE, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${rows[0].id}`;
  await writeAudit(null, 'user.password.recover', 'user', String(rows[0].id), { username: rows[0].username });
  return { ok: true };
}

export async function repairSuperAdmin(username: string, recoveryKey: string, nextPassword: string): Promise<{ ok: boolean; error?: string; created?: boolean; retryAfterMs?: number }> {
  if (!await isAdminRecoveryConfigured()) return { ok: false, error: '当前项目尚未生成超级管理员恢复密钥' };
  if (nextPassword.length < 8) return { ok: false, error: '新密码至少需要 8 位' };
  const name = username.trim().slice(0, 80);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(name)) return { ok: false, error: '用户名需为 3-40 位字母、数字、点、横线或下划线' };
  await ensureAuthTables();

  const sql = authSql();
  const now = Date.now();
  const since = now - REPAIR_RATE_LIMIT_WINDOW_MS;
  const recentFailures = assertRows(await sql`SELECT COUNT(*)::int AS count, COALESCE(MIN(created_at), 0) AS oldest FROM app_audit_logs
    WHERE action='user.super_admin.repair.failed' AND created_at > ${since}`, isCountOldestRow, 'app_audit_logs');
  if (Number(recentFailures[0]?.count) >= REPAIR_RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfterMs = Math.max(1_000, Number(recentFailures[0]?.oldest ?? 0) + REPAIR_RATE_LIMIT_WINDOW_MS - now);
    return { ok: false, error: `恢复尝试过于频繁，请 ${Math.ceil(retryAfterMs / 1000)} 秒后再试`, retryAfterMs };
  }

  const keyMatches = await recoveryKeyMatches(recoveryKey);
  if (!keyMatches) {
    await writeAudit(null, 'user.super_admin.repair.failed', 'user', '', { username: name });
    await new Promise(resolve => setTimeout(resolve, 400));
    return { ok: false, error: '恢复信息不正确' };
  }

  const password = await makePasswordHash(nextPassword);
  const existing = assertRows(await sql`SELECT id FROM app_users WHERE LOWER(username)=LOWER(${name}) LIMIT 1`, isIdRow, 'app_users');
  let userId: number;
  let created = false;
  if (existing[0]) {
    userId = existing[0].id;
    await invalidateLegacySharedToken();
    await sql`UPDATE app_users SET role_id='super_admin', status='active', password_hash=${password.hash}, password_salt=${password.salt},
      must_change_password=TRUE, token_version=token_version+1, updated_at=${now} WHERE id=${userId}`;
  } else {
    const insertedRows = assertRows(await sql`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
      VALUES (${name}, '超级管理员', ${password.hash}, ${password.salt}, 'super_admin', 'active', TRUE, 1, ${now}, ${now}) RETURNING id`, isIdRow, 'app_users');
    userId = insertedRows[0].id;
    created = true;
  }
  await sql`DELETE FROM app_user_scopes WHERE user_id=${userId}`;
  await sql`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id) VALUES (${userId}, 'all', '', '') ON CONFLICT DO NOTHING`;
  await writeAudit(null, 'user.super_admin.repair', 'user', String(userId), { username: name, created });
  return { ok: true, created };
}

/** 首次学校初始化时生成一次；数据库只保存加盐哈希，明文只返回给当前超级管理员。 */
export async function ensureGeneratedRecoveryKey(): Promise<string | null> {
  await ensureAuthTables();
  const rows = assertRows(await authSql()`SELECT recovery_key_hash FROM app_auth WHERE id=1`, isRecoveryHashRow, 'app_auth');
  if (rows[0]?.recovery_key_hash || LEGACY_ADMIN_RECOVERY_KEY.length >= 16) return null;
  const recoveryKey = `NVR-${randomBytes(24).toString('base64url')}`;
  const encoded = await makePasswordHash(recoveryKey);
  const updated = assertRows(await authSql()`UPDATE app_auth SET recovery_key_hash=${encoded.hash}, recovery_key_salt=${encoded.salt}, updated_at=${Date.now()}
    WHERE id=1 AND recovery_key_hash IS NULL RETURNING id`, isIdRow, 'app_auth');
  return updated[0] ? recoveryKey : null;
}

async function bootstrapAuth(password: string): Promise<AuthRow | null> {
  if (!BOOTSTRAP_PASSWORD) return null;
  const supplied = Buffer.from(password);
  const expected = Buffer.from(BOOTSTRAP_PASSWORD);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  await ensureAuthTables();
  const existing = await config();
  if (existing) return existing;
  const { hash, salt } = await makePasswordHash(password);
  const tokenSecret = randomBytes(32).toString('base64url');
  const at = Date.now();
  await authSql()`INSERT INTO app_auth (id, password_hash, password_salt, token_secret, token_version, initialized_at, updated_at)
    VALUES (1, ${hash}, ${salt}, ${tokenSecret}, 1, ${at}, ${at}) ON CONFLICT (id) DO NOTHING`;
  return await config();
}

async function ensureDefaultSuperAdmin(password: string): Promise<void> {
  await ensureAuthTables();
  const users = assertRows(await authSql()`SELECT COUNT(*)::int AS count FROM app_users`, isCountRow, 'app_users');
  if (Number(users[0]?.count) > 0) return;
  let auth = await config();
  if (!auth) auth = await bootstrapAuth(password);
  if (!auth || !await matches(password, auth.password_hash, auth.password_salt)) return;
  const at = Date.now();
  await authSql()`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
    VALUES ('admin', '超级管理员', ${auth.password_hash}, ${auth.password_salt}, 'super_admin', 'active', FALSE, 1, ${at}, ${at})
    ON CONFLICT DO NOTHING`;
  const rows = assertRows(await authSql()`SELECT id FROM app_users WHERE LOWER(username)='admin' LIMIT 1`, isIdRow, 'app_users');
  if (rows[0]) await authSql()`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id) VALUES (${rows[0].id}, 'all', '', '') ON CONFLICT DO NOTHING`;
}

function parsePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(ALL_PERMISSIONS as readonly string[]);
  return value.filter((item): item is Permission => item === '*' || (typeof item === 'string' && known.has(item)));
}

async function actorFromUserRow(row: UserRow): Promise<AdminActor> {
  const scopes = assertRows(await authSql()`SELECT scope_type, grade_id, class_id FROM app_user_scopes WHERE user_id=${row.id} ORDER BY id`, isScopeRow, 'app_user_scopes');
  return {
    id: Number(row.id), username: row.username, displayName: row.display_name,
    roleId: row.role_id, roleName: row.role_name, permissions: parsePermissions(row.permissions),
    scopes: scopes.map(scope => ({ type: scope.scope_type as AdminScope['type'], gradeId: scope.grade_id || '', classId: scope.class_id || '' })),
    mustChangePassword: row.must_change_password === true,
  };
}

async function userById(id: number): Promise<UserRow | null> {
  const rows = assertRows(await authSql()`SELECT u.id, u.username, u.display_name, u.password_hash, u.password_salt, u.role_id,
      r.name AS role_name, r.permissions, u.status, u.must_change_password, u.token_version
    FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE u.id=${id} LIMIT 1`, isUserRow, 'app_users/app_roles');
  return rows[0] ?? null;
}

/**
 * The v1.29.1-and-earlier three-part compatibility token is signed against
 * this global version and maps to the default admin account. This deliberately
 * invalidates every remaining legacy shared token, not an individual account.
 */
export async function invalidateLegacySharedToken(): Promise<void> {
  await authSql()`UPDATE app_auth SET token_version=token_version+1, updated_at=${Date.now()} WHERE id=1`;
}

function signature(userId: number, expiresAt: number, version: number, secret: string): string {
  return createHmac('sha256', secret).update(`${userId}.${expiresAt}.${version}`).digest('base64url');
}

export type LoginAttemptRow = { action: string; created_at: number };
export type LoginFailureAlert = { username: string; failureCount: number; windowStart: number; latestFailureAt: number };
const isLoginAttemptRow = rowShape<LoginAttemptRow>({ action: isString, created_at: isNumberLike });
const isLoginAttemptWithUsernameRow = rowShape<LoginAttemptRow & { username: string }>({
  action: isString,
  created_at: isNumberLike,
  username: isString,
});

export function evaluateLoginLockout(
  recentAttemptsDesc: LoginAttemptRow[],
  now: number,
  options: { maxFailures?: number; windowMs?: number } = {},
): { locked: boolean; retryAfterMs: number } {
  const maxFailures = options.maxFailures ?? LOGIN_LOCKOUT_MAX_FAILURES;
  const windowMs = options.windowMs ?? LOGIN_LOCKOUT_WINDOW_MS;
  if (recentAttemptsDesc.length < maxFailures) return { locked: false, retryAfterMs: 0 };
  const window = recentAttemptsDesc.slice(0, maxFailures);
  if (window.some(attempt => attempt.action === 'auth.login')) return { locked: false, retryAfterMs: 0 };
  const oldest = window[maxFailures - 1];
  const unlockAt = Number(oldest.created_at) + windowMs;
  if (now >= unlockAt) return { locked: false, retryAfterMs: 0 };
  return { locked: true, retryAfterMs: unlockAt - now };
}

export async function checkLoginLockout(username: string): Promise<{ locked: boolean; retryAfterMs: number }> {
  await ensureAuthTables();
  const name = (username.trim() || 'admin').slice(0, 80);
  const rows = assertRows(await authSql()`SELECT action, created_at FROM app_audit_logs
    WHERE LOWER(username)=LOWER(${name}) AND action IN ('auth.login','auth.login.failed')
    ORDER BY created_at DESC LIMIT ${LOGIN_LOCKOUT_MAX_FAILURES}`, isLoginAttemptRow, 'app_audit_logs');
  return evaluateLoginLockout(rows, Date.now());
}

export function evaluateLoginFailureAlerts(
  recentAttemptsDesc: Array<LoginAttemptRow & { username: string }>,
  now: number,
  options: { minFailures?: number; windowMs?: number } = {},
): LoginFailureAlert[] {
  const minFailures = options.minFailures ?? LOGIN_ALERT_MIN_FAILURES;
  const windowMs = options.windowMs ?? LOGIN_LOCKOUT_WINDOW_MS;
  const byUsername = new Map<string, Array<LoginAttemptRow & { username: string }>>();
  for (const row of recentAttemptsDesc) {
    const key = row.username.toLowerCase();
    const bucket = byUsername.get(key);
    if (bucket) bucket.push(row); else byUsername.set(key, [row]);
  }
  const alerts: LoginFailureAlert[] = [];
  for (const rows of byUsername.values()) {
    const successIndex = rows.findIndex(row => row.action === 'auth.login');
    const failures = rows
      .slice(0, successIndex === -1 ? rows.length : successIndex)
      .filter(row => row.action === 'auth.login.failed' && now - Number(row.created_at) <= windowMs);
    if (failures.length < minFailures) continue;
    const newest = failures[0];
    const oldest = failures[failures.length - 1];
    alerts.push({
      username: rows[0].username,
      failureCount: failures.length,
      windowStart: Number(oldest.created_at),
      latestFailureAt: Number(newest.created_at),
    });
  }
  return alerts.sort((a, b) => b.latestFailureAt - a.latestFailureAt);
}

export async function getRecentLoginFailureAlerts(): Promise<LoginFailureAlert[]> {
  await ensureAuthTables();
  const rows = assertRows(await authSql()`SELECT username, action, created_at FROM app_audit_logs
    WHERE action IN ('auth.login', 'auth.login.failed') ORDER BY created_at DESC LIMIT 500`, isLoginAttemptWithUsernameRow, 'app_audit_logs');
  return evaluateLoginFailureAlerts(rows, Date.now());
}

async function recordFailedLoginAttempt(username: string): Promise<void> {
  try {
    await ensureAuthTables();
    await authSql()`INSERT INTO app_audit_logs (user_id, username, action, resource_type, resource_id, grade_id, class_id, detail, created_at)
      VALUES (NULL, ${username}, 'auth.login.failed', 'user', '', '', '', NULL, ${Date.now()})`;
  } catch {
    // Audit availability must not obscure the ordinary invalid-credentials response.
  }
}

export async function authenticateUser(username: string, password: string): Promise<{ actor: AdminActor; token: string; expiresAt: number; firstLogin: boolean } | null> {
  await ensureDefaultSuperAdmin(password);
  const name = (username.trim() || 'admin').slice(0, 80);
  const rows = assertRows(await authSql()`SELECT u.id, u.username, u.display_name, u.password_hash, u.password_salt, u.role_id,
      r.name AS role_name, r.permissions, u.status, u.must_change_password, u.token_version, u.last_login_at
    FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE LOWER(u.username)=LOWER(${name}) LIMIT 1`, isUserRow, 'app_users/app_roles');
  const row = rows[0];
  if (!row || row.status !== 'active' || !await matches(password, row.password_hash, row.password_salt)) {
    await recordFailedLoginAttempt(name);
    return null;
  }
  const auth = await config();
  if (!auth) return null;
  const expiresAt = Date.now() + TOKEN_TTL;
  const token = Buffer.from(`${row.id}.${expiresAt}.${row.token_version}.${signature(row.id, expiresAt, row.token_version, auth.token_secret)}`).toString('base64url');
  const firstLogin = row.last_login_at == null;
  await authSql()`UPDATE app_users SET last_login_at=${Date.now()} WHERE id=${row.id}`;
  return { actor: await actorFromUserRow(row), token, expiresAt, firstLogin };
}

export function isTokenNotExpired(expiresAt: number, now: number): boolean {
  return Number.isFinite(expiresAt) && now <= expiresAt;
}

export function isLegacySharedTokenVersionCurrent(tokenVersion: number, currentAuthTokenVersion: number): boolean {
  return tokenVersion === currentAuthTokenVersion;
}

export function isUserTokenVersionCurrent(row: { status: string; token_version: number } | null | undefined, tokenVersion: number): boolean {
  return row?.status === 'active' && row.token_version === tokenVersion;
}

export async function getActor(token: string | undefined): Promise<AdminActor | null> {
  if (!token) return null;
  const auth = await config();
  if (!auth) return null;
  try {
    const parts = Buffer.from(token, 'base64url').toString().split('.');
    let userId: number; let expiresAt: number; let version: number; let received: string;
    if (parts.length === 4) {
      [userId, expiresAt, version] = parts.slice(0, 3).map(Number); received = parts[3];
      if (!Number.isFinite(userId) || !Number.isFinite(version) || !isTokenNotExpired(expiresAt, Date.now())) return null;
      const expected = signature(userId, expiresAt, version, auth.token_secret);
      const a = Buffer.from(received || ''); const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } else if (parts.length === 3) {
      // v1.29.1 and earlier shared admin tokens map to the default admin account.
      // Their version is global, so security-sensitive user changes invalidate
      // every legacy shared token through invalidateLegacySharedToken().
      [expiresAt, version] = parts.slice(0, 2).map(Number); received = parts[2];
      if (!isTokenNotExpired(expiresAt, Date.now()) || !isLegacySharedTokenVersionCurrent(version, auth.token_version)) return null;
      const legacyExpected = createHmac('sha256', auth.token_secret).update(`${expiresAt}.${version}`).digest('base64url');
      const a = Buffer.from(received || ''); const b = Buffer.from(legacyExpected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const adminRows = assertRows(await authSql()`SELECT id FROM app_users WHERE LOWER(username)='admin' LIMIT 1`, isIdRow, 'app_users');
      userId = Number(adminRows[0]?.id);
    } else return null;
    const row = await userById(userId);
    if (parts.length === 4 && !isUserTokenVersionCurrent(row, version)) return null;
    if (!row || row.status !== 'active') return null;
    return actorFromUserRow(row);
  } catch (error) {
    // Token validation uses explicit null returns above. Re-throw unexpected failures so a
    // database outage is reported as such instead of being disguised as an expired login.
    throw error;
  }
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  return !!(await getActor(token));
}

export function hasPermission(actor: AdminActor, permission: Permission): boolean {
  return sharedHasPermission(actor, permission);
}

export function canAccessGrade(actor: AdminActor, gradeId: string): boolean {
  return sharedCanAccessGrade(actor, gradeId);
}

export function canAccessClass(actor: AdminActor, gradeId: string, classId: string): boolean {
  return sharedCanAccessClass(actor, gradeId, classId);
}

export async function requireActor(req: VercelRequest, res: VercelResponse, permission?: Permission, allowPasswordChange = false): Promise<AdminActor | null> {
  const actor = await getActor(extractBearer(req.headers.authorization));
  if (!actor) { res.status(401).json({ ok: false, code: 'AUTH_EXPIRED', error: '登录状态已失效，请重新登录' }); return null; }
  if (actor.mustChangePassword && !allowPasswordChange) { res.status(403).json({ ok: false, error: '请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' }); return null; }
  if (permission && !hasPermission(actor, permission)) { res.status(403).json({ ok: false, code: 'PERMISSION_DENIED', error: '当前账号没有执行此操作的权限', permission }); return null; }
  return actor;
}

export async function changeOwnPassword(actorId: number, currentPassword: string, nextPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (nextPassword.length < 8) return { ok: false, error: '新密码至少需要 8 位' };
  const row = await userById(actorId);
  if (!row || !await matches(currentPassword, row.password_hash, row.password_salt)) return { ok: false, error: '当前密码不正确' };
  if (row.must_change_password && row.role_id === 'class_admin') return { ok: false, error: '班级管理员首次登录必须同时设置新的用户名和密码' };
  const { hash, salt } = await makePasswordHash(nextPassword);
  await invalidateLegacySharedToken();
  await authSql()`UPDATE app_users SET password_hash=${hash}, password_salt=${salt}, must_change_password=FALSE, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${actorId}`;
  return { ok: true };
}

export async function changeOwnUsername(actorId: number, currentPassword: string, nextUsername: string): Promise<{ ok: boolean; error?: string; oldUsername?: string }> {
  const username = nextUsername.trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return { ok: false, error: '用户名需为 3-40 位字母、数字、点、横线或下划线' };
  const row = await userById(actorId);
  if (!row || !await matches(currentPassword, row.password_hash, row.password_salt)) return { ok: false, error: '当前密码不正确' };
  try {
    await invalidateLegacySharedToken();
    await authSql()`UPDATE app_users SET username=${username}, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${actorId}`;
    return { ok: true, oldUsername: row.username };
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : String(error))) return { ok: false, error: '用户名已存在' };
    throw error;
  }
}

export async function changeOwnCredentials(actorId: number, currentPassword: string, nextUsername: string, nextPassword: string): Promise<{ ok: boolean; error?: string; oldUsername?: string; username?: string }> {
  const username = nextUsername.trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return { ok: false, error: '用户名需为 3-40 位字母、数字、点、横线或下划线' };
  const row = await userById(actorId);
  if (!row || !await matches(currentPassword, row.password_hash, row.password_salt)) return { ok: false, error: '当前密码不正确' };
  if (row.must_change_password && row.role_id === 'class_admin' && username.toLowerCase() === row.username.toLowerCase()) return { ok: false, error: '班级管理员首次登录必须设置新的用户名' };
  if (row.must_change_password && nextPassword.length < 8) return { ok: false, error: '首次登录必须设置至少 8 位的新密码' };
  if (nextPassword && nextPassword.length < 8) return { ok: false, error: '新密码至少需要 8 位' };
  if (!nextPassword && username.toLowerCase() === row.username.toLowerCase()) return { ok: false, error: '用户名和密码均未修改' };
  const password = nextPassword ? await makePasswordHash(nextPassword) : { hash: row.password_hash, salt: row.password_salt };
  try {
    await invalidateLegacySharedToken();
    await authSql()`UPDATE app_users SET username=${username}, password_hash=${password.hash}, password_salt=${password.salt},
      must_change_password=${nextPassword ? false : row.must_change_password}, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${actorId}`;
    return { ok: true, oldUsername: row.username, username };
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : String(error))) return { ok: false, error: '用户名已存在' };
    throw error;
  }
}

export async function writeAudit(actor: AdminActor | null, action: string, resourceType: string, resourceId = '', detail: unknown = null, gradeId = '', classId = ''): Promise<void> {
  try {
    await ensureAuthTables();
    await authSql()`INSERT INTO app_audit_logs (user_id, username, action, resource_type, resource_id, grade_id, class_id, detail, created_at)
      VALUES (${actor?.id ?? null}, ${actor?.username ?? ''}, ${action}, ${resourceType}, ${resourceId}, ${gradeId}, ${classId}, ${detail == null ? null : JSON.stringify(detail)}::jsonb, ${Date.now()})`;
  } catch { /* 审计失败不能让业务操作产生第二次提交。 */ }
}

export async function isPasswordRequired(): Promise<boolean> {
  await ensureAuthTables();
  const rows = assertRows(await authSql()`SELECT COUNT(*)::int AS count FROM app_users`, isCountRow, 'app_users');
  return Number(rows[0]?.count) > 0 || !!(await config()) || !!BOOTSTRAP_PASSWORD;
}

export async function checkPassword(password: string): Promise<boolean> {
  return !!(await authenticateUser('admin', password));
}

export async function generateToken(): Promise<{ token: string; expiresAt: number }> {
  throw new Error('generateToken requires a user; use authenticateUser');
}

export async function changePassword(currentPassword: string, nextPassword: string): Promise<{ ok: boolean; error?: string }> {
  const login = await authenticateUser('admin', currentPassword);
  return login ? changeOwnPassword(login.actor.id, currentPassword, nextPassword) : { ok: false, error: '当前密码不正确' };
}

export function extractBearer(authHeader: string | undefined): string | undefined {
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
}
