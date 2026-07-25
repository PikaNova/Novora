import { neon } from '@neondatabase/serverless';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_TTL = 24 * 60 * 60 * 1000;

export const ALL_PERMISSIONS = [
  'overview.read',
  'major.read', 'major.create', 'major.edit', 'major.delete', 'major.import', 'major.export',
  'weekly.read', 'weekly.create', 'weekly.edit', 'weekly.delete', 'weekly.copy', 'weekly.override', 'weekly.import', 'weekly.export',
  'school.read', 'school.grade_manage', 'school.class_manage',
  'device.read', 'device.bind', 'device.revoke',
  'schedule.mode_edit', 'schedule.conflict_edit', 'schedule.term_edit', 'schedule.ab_week_edit', 'schedule.holiday_edit',
  'alerts.read', 'alerts.edit', 'settings.read', 'settings.edit', 'initialization.run', 'demo_data.delete',
  'user.read', 'user.create', 'user.edit', 'user.disable', 'user.delete', 'user.reset_password', 'role.manage', 'audit.read', 'deployment.trigger',
] as const;

export type Permission = typeof ALL_PERMISSIONS[number] | '*';
export type AdminScope = { type: 'all' | 'grade' | 'class'; gradeId: string; classId: string };
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

let sqlClient: ReturnType<typeof neon> | null = null;
let setupPromise: Promise<void> | null = null;

export function authSql() {
  if (sqlClient) return sqlClient;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  sqlClient = neon(url);
  return sqlClient;
}

const BUILTIN_ROLES: Array<{ id: string; name: string; description: string; permissions: Permission[] }> = [
  { id: 'super_admin', name: '超级管理员', description: '拥有全校数据与全部系统权限，可管理用户、角色、部署及所有业务设置。', permissions: ['*'] },
  { id: 'grade_admin', name: '年级管理员', description: '管理授权年级的考试、周测、班级、设备和下级用户，可批量创建该年级的班级管理员，并查看该年级完整运行总览。', permissions: ['overview.read', 'major.read', 'major.create', 'major.edit', 'major.delete', 'major.import', 'major.export', 'weekly.read', 'weekly.create', 'weekly.edit', 'weekly.delete', 'weekly.copy', 'weekly.override', 'weekly.import', 'weekly.export', 'school.read', 'school.class_manage', 'device.read', 'device.bind', 'device.revoke', 'alerts.read', 'user.read', 'user.create', 'user.edit', 'user.disable', 'user.delete', 'user.reset_password'] },
  { id: 'class_admin', name: '班级管理员', description: '管理授权班级的周测、考试安排和绑定设备，可修改自己的用户名与密码，不显示项目运行总览。', permissions: ['major.read', 'weekly.read', 'weekly.create', 'weekly.edit', 'weekly.delete', 'weekly.copy', 'weekly.override', 'weekly.import', 'weekly.export', 'school.read', 'device.read', 'device.bind', 'device.revoke', 'alerts.read'] },
  { id: 'viewer', name: '只读用户', description: '仅按授权范围预览和导出考试与周测安排，不进入运行总览。', permissions: ['major.read', 'weekly.read', 'weekly.export', 'school.read'] },
];

export async function ensureAuthTables(): Promise<void> {
  if (!setupPromise) setupPromise = (async () => {
    const sql = authSql();
    await sql`CREATE TABLE IF NOT EXISTS app_auth (
      id INTEGER PRIMARY KEY DEFAULT 1,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      token_secret TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      initialized_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      CHECK (id = 1)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS app_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      permissions JSONB NOT NULL DEFAULT '[]',
      built_in BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`;
    await sql`CREATE TABLE IF NOT EXISTS app_users (
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
    )`;
    await Promise.all([
      sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_lower ON app_users (LOWER(username))`,
      sql`CREATE TABLE IF NOT EXISTS app_user_scopes (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL,
        grade_id TEXT NOT NULL DEFAULT '',
        class_id TEXT NOT NULL DEFAULT '',
        UNIQUE(user_id, scope_type, grade_id, class_id)
      )`,
      sql`CREATE TABLE IF NOT EXISTS app_audit_logs (
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
    const [legacyRows, userCountRows] = await Promise.all([
      sql`SELECT password_hash, password_salt FROM app_auth WHERE id=1`,
      sql`SELECT COUNT(*)::int AS count FROM app_users`,
    ]) as unknown as [Array<{ password_hash: string; password_salt: string }>, Array<{ count: number }>];
    if (legacyRows[0] && Number(userCountRows[0]?.count) === 0) {
      const created = await sql`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
        VALUES ('admin', '超级管理员', ${legacyRows[0].password_hash}, ${legacyRows[0].password_salt}, 'super_admin', 'active', FALSE, 1, ${now}, ${now})
        ON CONFLICT DO NOTHING RETURNING id` as unknown as Array<{ id: number }>;
      if (created[0]) await sql`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id) VALUES (${created[0].id}, 'all', '', '') ON CONFLICT DO NOTHING`;
    }
  })().catch(error => { setupPromise = null; throw error; });
  return setupPromise;
}

async function config(): Promise<AuthRow | null> {
  await ensureAuthTables();
  const rows = await authSql()`SELECT password_hash, password_salt, token_secret, token_version FROM app_auth WHERE id = 1` as unknown as AuthRow[];
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
  const users = await authSql()`SELECT COUNT(*)::int AS count FROM app_users` as unknown as Array<{ count: number }>;
  if (Number(users[0]?.count) > 0) return;
  let auth = await config();
  if (!auth) auth = await bootstrapAuth(password);
  if (!auth || !await matches(password, auth.password_hash, auth.password_salt)) return;
  const at = Date.now();
  await authSql()`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
    VALUES ('admin', '超级管理员', ${auth.password_hash}, ${auth.password_salt}, 'super_admin', 'active', FALSE, 1, ${at}, ${at})
    ON CONFLICT DO NOTHING`;
  const rows = await authSql()`SELECT id FROM app_users WHERE LOWER(username)='admin' LIMIT 1` as unknown as Array<{ id: number }>;
  if (rows[0]) await authSql()`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id) VALUES (${rows[0].id}, 'all', '', '') ON CONFLICT DO NOTHING`;
}

function parsePermissions(value: unknown): Permission[] {
  return Array.isArray(value) ? value.filter(item => item === '*' || ALL_PERMISSIONS.includes(item as any)) as Permission[] : [];
}

async function actorFromUserRow(row: UserRow): Promise<AdminActor> {
  const scopes = await authSql()`SELECT scope_type, grade_id, class_id FROM app_user_scopes WHERE user_id=${row.id} ORDER BY id` as unknown as Array<{ scope_type: string; grade_id: string; class_id: string }>;
  return {
    id: Number(row.id), username: row.username, displayName: row.display_name,
    roleId: row.role_id, roleName: row.role_name, permissions: parsePermissions(row.permissions),
    scopes: scopes.map(scope => ({ type: scope.scope_type as AdminScope['type'], gradeId: scope.grade_id || '', classId: scope.class_id || '' })),
    mustChangePassword: row.must_change_password === true,
  };
}

async function userById(id: number): Promise<UserRow | null> {
  const rows = await authSql()`SELECT u.id, u.username, u.display_name, u.password_hash, u.password_salt, u.role_id,
      r.name AS role_name, r.permissions, u.status, u.must_change_password, u.token_version
    FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE u.id=${id} LIMIT 1` as unknown as UserRow[];
  return rows[0] ?? null;
}

function signature(userId: number, expiresAt: number, version: number, secret: string): string {
  return createHmac('sha256', secret).update(`${userId}.${expiresAt}.${version}`).digest('base64url');
}

export async function authenticateUser(username: string, password: string): Promise<{ actor: AdminActor; token: string; expiresAt: number; firstLogin: boolean } | null> {
  await ensureDefaultSuperAdmin(password);
  const name = (username.trim() || 'admin').slice(0, 80);
  const rows = await authSql()`SELECT u.id, u.username, u.display_name, u.password_hash, u.password_salt, u.role_id,
      r.name AS role_name, r.permissions, u.status, u.must_change_password, u.token_version, u.last_login_at
    FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE LOWER(u.username)=LOWER(${name}) LIMIT 1` as unknown as UserRow[];
  const row = rows[0];
  if (!row || row.status !== 'active' || !await matches(password, row.password_hash, row.password_salt)) return null;
  const auth = await config();
  if (!auth) return null;
  const expiresAt = Date.now() + TOKEN_TTL;
  const token = Buffer.from(`${row.id}.${expiresAt}.${row.token_version}.${signature(row.id, expiresAt, row.token_version, auth.token_secret)}`).toString('base64url');
  const firstLogin = row.last_login_at == null;
  await authSql()`UPDATE app_users SET last_login_at=${Date.now()} WHERE id=${row.id}`;
  return { actor: await actorFromUserRow(row), token, expiresAt, firstLogin };
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
      if (!Number.isFinite(userId) || !Number.isFinite(expiresAt) || !Number.isFinite(version) || Date.now() > expiresAt) return null;
      const expected = signature(userId, expiresAt, version, auth.token_secret);
      const a = Buffer.from(received || ''); const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } else if (parts.length === 3) {
      // v1.29.1 及更早版本的共享管理员令牌，迁移窗口内映射到默认超级管理员。
      [expiresAt, version] = parts.slice(0, 2).map(Number); received = parts[2];
      if (!Number.isFinite(expiresAt) || Date.now() > expiresAt || version !== auth.token_version) return null;
      const legacyExpected = createHmac('sha256', auth.token_secret).update(`${expiresAt}.${version}`).digest('base64url');
      const a = Buffer.from(received || ''); const b = Buffer.from(legacyExpected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const adminRows = await authSql()`SELECT id FROM app_users WHERE LOWER(username)='admin' LIMIT 1` as unknown as Array<{ id: number }>;
      userId = Number(adminRows[0]?.id);
    } else return null;
    const row = await userById(userId);
    if (!row || row.status !== 'active' || row.token_version !== version && parts.length === 4) return null;
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
  return actor.permissions.includes('*') || actor.permissions.includes(permission);
}

export function canAccessGrade(actor: AdminActor, gradeId: string): boolean {
  if (actor.permissions.includes('*') || actor.scopes.some(scope => scope.type === 'all')) return true;
  return actor.scopes.some(scope => (scope.type === 'grade' || scope.type === 'class') && scope.gradeId === gradeId);
}

export function canAccessClass(actor: AdminActor, gradeId: string, classId: string): boolean {
  if (actor.permissions.includes('*') || actor.scopes.some(scope => scope.type === 'all')) return true;
  return actor.scopes.some(scope => (scope.type === 'grade' && scope.gradeId === gradeId) || (scope.type === 'class' && scope.classId === classId));
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
  await authSql()`UPDATE app_users SET password_hash=${hash}, password_salt=${salt}, must_change_password=FALSE, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${actorId}`;
  return { ok: true };
}

export async function changeOwnUsername(actorId: number, currentPassword: string, nextUsername: string): Promise<{ ok: boolean; error?: string; oldUsername?: string }> {
  const username = nextUsername.trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return { ok: false, error: '用户名需为 3-40 位字母、数字、点、横线或下划线' };
  const row = await userById(actorId);
  if (!row || !await matches(currentPassword, row.password_hash, row.password_salt)) return { ok: false, error: '当前密码不正确' };
  try {
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
  const rows = await authSql()`SELECT COUNT(*)::int AS count FROM app_users` as unknown as Array<{ count: number }>;
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
