import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requestId, sendDatabaseError } from './_apiError.js';
import { applyCors } from './_cors.js';
import { randomBytes } from 'node:crypto';
import {
  ALL_PERMISSIONS,
  authSql,
  canAccessClass,
  canAccessGrade,
  changeOwnCredentials,
  changeOwnPassword,
  changeOwnUsername,
  ensureAuthTables,
  hasPermission,
  makePasswordHash,
  requireActor,
  writeAudit,
  type AdminActor,
  type AdminScope,
  type Permission,
} from './_auth.js';

const text = (value: unknown, max = 120) => String(value ?? '').trim().slice(0, max);
const jsonPermissions = (value: unknown): Permission[] => Array.isArray(value)
  ? [...new Set(value.filter(item => item === '*' || ALL_PERMISSIONS.includes(item as any)))] as Permission[]
  : [];

function scopes(value: unknown): AdminScope[] {
  if (!Array.isArray(value)) return [];
  const result: AdminScope[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const type = text((raw as any).type, 12) as AdminScope['type'];
    const gradeId = text((raw as any).gradeId, 128);
    const classId = text((raw as any).classId, 128);
    if (type === 'all') return [{ type: 'all', gradeId: '', classId: '' }];
    if (type === 'grade' && gradeId) result.push({ type, gradeId, classId: '' });
    if (type === 'class' && gradeId && classId) result.push({ type, gradeId, classId });
  }
  return result.filter((item, index, all) => all.findIndex(other => `${other.type}|${other.gradeId}|${other.classId}` === `${item.type}|${item.gradeId}|${item.classId}`) === index);
}

async function replaceScopes(userId: number, next: AdminScope[]): Promise<void> {
  const sql = authSql();
  await sql`DELETE FROM app_user_scopes WHERE user_id=${userId}`;
  await Promise.all(next.map(scope => sql`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id)
    VALUES (${userId}, ${scope.type}, ${scope.gradeId}, ${scope.classId}) ON CONFLICT DO NOTHING`));
}

function canDelegatePermissions(actor: AdminActor, permissions: Permission[]): boolean {
  return actor.permissions.includes('*') || (!permissions.includes('*') && permissions.every(permission => actor.permissions.includes(permission)));
}

function canDelegateScopes(actor: AdminActor, next: AdminScope[]): boolean {
  if (actor.permissions.includes('*') || actor.scopes.some(scope => scope.type === 'all')) return true;
  return next.length > 0 && next.every(scope => scope.type === 'grade'
    ? canAccessGrade(actor, scope.gradeId)
    : scope.type === 'class' && canAccessClass(actor, scope.gradeId, scope.classId));
}

async function delegatedRole(actor: AdminActor, roleId: string): Promise<{ id: string; permissions: Permission[] } | null> {
  const rows = await authSql()`SELECT id, permissions FROM app_roles WHERE id=${roleId}` as unknown as Array<{ id: string; permissions: unknown }>;
  if (!rows[0]) return null;
  const role = { id: rows[0].id, permissions: jsonPermissions(rows[0].permissions) };
  return canDelegatePermissions(actor, role.permissions) ? role : null;
}

async function listUsers(actor?: AdminActor) {
  const sql = authSql();
  type UserRow = {
    id: number;
    username: string;
    displayName: string;
    roleId: string;
    roleName: string;
    status: string;
    mustChangePassword: boolean;
    lastLoginAt: number | null;
    createdAt: number;
    permissions: unknown;
  };
  type ScopeRow = { user_id: number; scope_type: AdminScope['type']; grade_id: string; class_id: string };
  const [users, scopeRows] = await Promise.all([
    sql`SELECT u.id, u.username, u.display_name AS "displayName", u.role_id AS "roleId", r.name AS "roleName",
      u.status, u.must_change_password AS "mustChangePassword", u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt", r.permissions
      FROM app_users u JOIN app_roles r ON r.id=u.role_id ORDER BY u.created_at ASC` as unknown as Promise<UserRow[]>,
    sql`SELECT user_id, scope_type, grade_id, class_id FROM app_user_scopes ORDER BY id` as unknown as Promise<ScopeRow[]>,
  ]);
  const result = users.map(user => ({
    id: Number(user.id), username: user.username, displayName: user.displayName, roleId: user.roleId, roleName: user.roleName,
    status: user.status, mustChangePassword: user.mustChangePassword, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt,
    scopes: scopeRows.filter(scope => Number(scope.user_id) === Number(user.id)).map(scope => ({ type: scope.scope_type, gradeId: scope.grade_id, classId: scope.class_id })),
  }));
  if (!actor || actor.permissions.includes('*') || actor.scopes.some(scope => scope.type === 'all')) return result;
  return result.filter((user: any) => canDelegatePermissions(actor, jsonPermissions(user.permissions)) && user.scopes.length > 0 && user.scopes.every((scope: AdminScope) => scope.type !== 'all' && (scope.type === 'grade' ? canAccessGrade(actor, scope.gradeId) : canAccessClass(actor, scope.gradeId, scope.classId))));
}

async function canManageTarget(actor: AdminActor, userId: number): Promise<boolean> {
  if (actor.permissions.includes('*') || actor.scopes.some(scope => scope.type === 'all')) return true;
  const sql = authSql();
  const [target, targetScopes] = await Promise.all([
    sql`SELECT r.permissions FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE u.id=${userId}` as unknown as Array<{ permissions: unknown }>,
    sql`SELECT scope_type, grade_id, class_id FROM app_user_scopes WHERE user_id=${userId}` as unknown as Array<{ scope_type: AdminScope['type']; grade_id: string; class_id: string }>,
  ]);
  if (!target[0] || !canDelegatePermissions(actor, jsonPermissions(target[0].permissions)) || !targetScopes.length) return false;
  return targetScopes.every(scope => scope.scope_type !== 'all' && (scope.scope_type === 'grade' ? canAccessGrade(actor, scope.grade_id) : canAccessClass(actor, scope.grade_id, scope.class_id)));
}

async function listRoles() {
  const rows = await authSql()`SELECT id, name, description, permissions, built_in AS "builtIn", created_at AS "createdAt", updated_at AS "updatedAt" FROM app_roles ORDER BY built_in DESC, created_at ASC` as unknown as Array<Record<string, any>>;
  return rows.map((row: any) => ({ ...row, permissions: jsonPermissions(row.permissions) }));
}

async function ensureNotLastSuperAdmin(userId: number, nextRoleId: string, nextStatus: string): Promise<boolean> {
  const rows = await authSql()`SELECT role_id, status FROM app_users WHERE id=${userId}` as unknown as Array<{ role_id: string; status: string }>;
  if (rows[0]?.role_id !== 'super_admin' || rows[0]?.status !== 'active' || (nextRoleId === 'super_admin' && nextStatus === 'active')) return true;
  const count = await authSql()`SELECT COUNT(*)::int AS count FROM app_users WHERE role_id='super_admin' AND status='active'` as unknown as Array<{ count: number }>;
  return Number(count[0]?.count) > 1;
}

async function handleUsers(req: VercelRequest, res: VercelResponse, actor: AdminActor) {
  const sql = authSql();
  const body = req.body ?? {};
  const action = text(body.action, 40);
  if (req.method === 'POST' && action === 'change-own-credentials') {
    const result = await changeOwnCredentials(actor.id, String(body.currentPassword ?? ''), String(body.username ?? ''), String(body.newPassword ?? ''));
    if (!result.ok) return res.status(400).json(result);
    await writeAudit(actor, 'user.credentials.change', 'user', String(actor.id), { from: result.oldUsername, to: result.username, passwordChanged: Boolean(body.newPassword) });
    return res.json({ ok: true, username: result.username, message: 'Credentials changed. Please sign in again.' });
  }
  if (req.method === 'POST' && action === 'change-own-password') {
    const result = await changeOwnPassword(actor.id, String(body.currentPassword ?? ''), String(body.newPassword ?? ''));
    if (!result.ok) return res.status(400).json(result);
    await writeAudit(actor, 'user.password.change', 'user', String(actor.id));
    return res.json({ ok: true, message: 'Password changed. Please sign in again.' });
  }
  if (req.method === 'POST' && action === 'change-own-username') {
    const result = await changeOwnUsername(actor.id, String(body.currentPassword ?? ''), String(body.username ?? ''));
    if (!result.ok) return res.status(400).json(result);
    await writeAudit(actor, 'user.username.change', 'user', String(actor.id), { from: result.oldUsername, to: text(body.username, 40) });
    return res.json({ ok: true, message: 'Username changed. Please sign in again.' });
  }
  if (req.method === 'GET') {
    if (!hasPermission(actor, 'user.read')) return res.status(403).json({ ok: false, error: 'Forbidden' });
    return res.json({ ok: true, users: await listUsers(actor), roles: await listRoles(), permissions: ALL_PERMISSIONS });
  }
  if (action === 'create') {
    if (!hasPermission(actor, 'user.create')) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const username = text(body.username, 40);
    const displayName = text(body.displayName, 80) || username;
    const password = String(body.password ?? '');
    const roleId = text(body.roleId, 80);
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ ok: false, field: 'username', error: '用户名需为 3-40 位字母、数字、点、横线或下划线' });
    if (!displayName) return res.status(400).json({ ok: false, field: 'displayName', error: '请输入显示名称' });
    if (password.length < 8) return res.status(400).json({ ok: false, field: 'password', error: '初始密码至少需要 8 位' });
    const role = await delegatedRole(actor, roleId);
    if (!role) return res.status(403).json({ ok: false, field: 'roleId', error: '不能授予超出当前账号的角色权限' });
    const nextScopes = roleId === 'super_admin' ? [{ type: 'all' as const, gradeId: '', classId: '' }] : scopes(body.scopes);
    if (!canDelegateScopes(actor, nextScopes)) return res.status(403).json({ ok: false, field: 'scopes', error: '不能授予超出当前账号的数据范围' });
    const { hash, salt } = await makePasswordHash(password);
    const at = Date.now();
    try {
      const inserted = await sql`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
        VALUES (${username}, ${displayName}, ${hash}, ${salt}, ${roleId}, 'active', TRUE, 1, ${at}, ${at}) RETURNING id` as unknown as Array<{ id: number }>;
      await replaceScopes(Number(inserted[0].id), nextScopes);
      await writeAudit(actor, 'user.create', 'user', String(inserted[0].id), { username, roleId });
      return res.json({ ok: true, users: await listUsers(actor) });
    } catch (error) {
      if (/unique/i.test(error instanceof Error ? error.message : String(error))) return res.status(409).json({ ok: false, field: 'username', error: '用户名已存在' });
      throw error;
    }
  }
  if (action === 'update') {
    if (!hasPermission(actor, 'user.edit')) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const id = Number(body.id);
    const displayName = text(body.displayName, 80);
    const roleId = text(body.roleId, 80);
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    if (!Number.isFinite(id) || !displayName) return res.status(400).json({ ok: false, error: '用户信息不完整' });
    if (!await canManageTarget(actor, id)) return res.status(403).json({ ok: false, error: '不能修改超出当前账号管理范围的用户' });
    const existing = await sql`SELECT role_id, status FROM app_users WHERE id=${id}` as unknown as Array<{ role_id: string; status: string }>;
    if (!existing[0]) return res.status(404).json({ ok: false, error: '用户不存在' });
    if (id === actor.id && (status !== 'active' || roleId !== actor.roleId)) return res.status(400).json({ ok: false, error: '不能停用自己或修改自己的角色' });
    if (status !== existing[0].status && !hasPermission(actor, 'user.disable')) return res.status(403).json({ ok: false, error: '无权启用或停用用户' });
    const role = await delegatedRole(actor, roleId);
    if (!role) return res.status(403).json({ ok: false, error: '不能授予超出当前账号的角色权限' });
    const nextScopes = roleId === 'super_admin' ? [{ type: 'all' as const, gradeId: '', classId: '' }] : scopes(body.scopes);
    if (!canDelegateScopes(actor, nextScopes)) return res.status(403).json({ ok: false, error: '不能授予超出当前账号的数据范围' });
    if (!await ensureNotLastSuperAdmin(id, roleId, status)) return res.status(400).json({ ok: false, error: '必须至少保留一个启用的超级管理员' });
    const updated = await sql`UPDATE app_users SET display_name=${displayName}, role_id=${roleId}, status=${status}, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${id} RETURNING id` as unknown as Array<{ id: number }>;
    if (!updated.length) return res.status(404).json({ ok: false, error: '用户不存在' });
    await replaceScopes(id, nextScopes);
    await writeAudit(actor, 'user.update', 'user', String(id), { roleId, status });
    return res.json({ ok: true, users: await listUsers(actor) });
  }
  if (action === 'reset-password') {
    if (!hasPermission(actor, 'user.reset_password')) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const id = Number(body.id); const password = String(body.password ?? '');
    if (!Number.isFinite(id) || password.length < 8) return res.status(400).json({ ok: false, error: '新密码至少需要 8 位' });
    if (!await canManageTarget(actor, id)) return res.status(403).json({ ok: false, error: '不能重置超出当前账号管理范围的用户密码' });
    const target = await sql`SELECT r.permissions FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE u.id=${id}` as unknown as Array<{ permissions: unknown }>;
    if (!target[0]) return res.status(404).json({ ok: false, error: '用户不存在' });
    if (!canDelegatePermissions(actor, jsonPermissions(target[0].permissions))) return res.status(403).json({ ok: false, error: '不能重置权限高于当前账号的用户密码' });
    const { hash, salt } = await makePasswordHash(password);
    await sql`UPDATE app_users SET password_hash=${hash}, password_salt=${salt}, must_change_password=TRUE, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${id}`;
    await writeAudit(actor, 'user.password.reset', 'user', String(id));
    return res.json({ ok: true });
  }
  if (action === 'delete') {
    if (!hasPermission(actor, 'user.delete')) return res.status(403).json({ ok: false, error: '无权删除用户' });
    const id = Number(body.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: '用户信息不完整' });
    if (id === actor.id) return res.status(400).json({ ok: false, error: '不能删除当前登录账号' });
    if (!await canManageTarget(actor, id)) return res.status(403).json({ ok: false, error: '不能删除超出当前账号管理范围的用户' });
    const target = await sql`SELECT username, role_id, status FROM app_users WHERE id=${id}` as unknown as Array<{ username: string; role_id: string; status: string }>;
    if (!target[0]) return res.status(404).json({ ok: false, error: '用户不存在' });
    if (target[0].role_id === 'super_admin' && target[0].status === 'active') {
      const count = await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE role_id='super_admin' AND status='active'` as unknown as Array<{ count: number }>;
      if (Number(count[0]?.count) <= 1) return res.status(400).json({ ok: false, error: '必须至少保留一个启用的超级管理员' });
    }
    await writeAudit(actor, 'user.delete', 'user', String(id), { username: target[0].username, roleId: target[0].role_id });
    await sql`DELETE FROM app_users WHERE id=${id}`;
    return res.json({ ok: true, users: await listUsers(actor) });
  }
  return res.status(400).json({ ok: false, error: '未知用户操作' });
}

async function handleRoles(req: VercelRequest, res: VercelResponse, actor: AdminActor) {
  if (!hasPermission(actor, 'role.manage')) return res.status(403).json({ ok: false, error: 'Forbidden' });
  const sql = authSql(); const body = req.body ?? {};
  if (req.method === 'GET') return res.json({ ok: true, roles: await listRoles(), permissions: ALL_PERMISSIONS });
  const action = text(body.action, 40);
  if (action === 'save') {
    const rawId = text(body.id, 80); const name = text(body.name, 80); const permissions = jsonPermissions(body.permissions);
    if (!name || !permissions.length) return res.status(400).json({ ok: false, error: '角色名称和权限不能为空' });
    if (!canDelegatePermissions(actor, permissions)) return res.status(403).json({ ok: false, error: '不能创建权限高于当前账号的角色' });
    const id = rawId || `role_${randomBytes(6).toString('hex')}`;
    const existing = await sql`SELECT built_in FROM app_roles WHERE id=${id}` as unknown as Array<{ built_in: boolean }>;
    if (existing[0]?.built_in) return res.status(400).json({ ok: false, error: '内置角色不可修改，请创建自定义角色' });
    const at = Date.now();
    await sql`INSERT INTO app_roles (id, name, description, permissions, built_in, created_at, updated_at)
      VALUES (${id}, ${name}, ${text(body.description, 300)}, ${JSON.stringify(permissions)}::jsonb, FALSE, ${at}, ${at})
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, permissions=EXCLUDED.permissions, updated_at=EXCLUDED.updated_at`;
    await writeAudit(actor, rawId ? 'role.update' : 'role.create', 'role', id, { name, permissions });
    return res.json({ ok: true, roles: await listRoles() });
  }
  if (action === 'delete') {
    const id = text(body.id, 80);
    const role = await sql`SELECT built_in FROM app_roles WHERE id=${id}` as unknown as Array<{ built_in: boolean }>;
    if (!role.length) return res.status(404).json({ ok: false, error: '角色不存在' });
    if (role[0].built_in) return res.status(400).json({ ok: false, error: '内置角色不可删除' });
    const used = await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE role_id=${id}` as unknown as Array<{ count: number }>;
    if (Number(used[0]?.count) > 0) return res.status(409).json({ ok: false, error: '该角色仍有用户，不能删除' });
    await sql`DELETE FROM app_roles WHERE id=${id}`;
    await writeAudit(actor, 'role.delete', 'role', id);
    return res.json({ ok: true, roles: await listRoles() });
  }
  return res.status(400).json({ ok: false, error: '未知角色操作' });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  requestId(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (!applyCors(req, res, { methods: ['GET', 'POST'] })) return;
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }
  try {
    await ensureAuthTables();
    const ownAccountChange = req.method === 'POST' && text(req.body?.resource, 30) === 'users' && ['change-own-password', 'change-own-username', 'change-own-credentials'].includes(text(req.body?.action, 40));
    const actor = await requireActor(req, res, undefined, ownAccountChange);
    if (!actor) return;
    const resource = text(req.method === 'GET' ? req.query?.resource : req.body?.resource, 30) || 'users';
    if (resource === 'roles') return await handleRoles(req, res, actor);
    if (resource === 'audit') {
      if (!hasPermission(actor, 'audit.read')) return res.status(403).json({ ok: false, error: 'Forbidden' });
      const logs = await authSql()`SELECT id, user_id AS "userId", username, action, resource_type AS "resourceType", resource_id AS "resourceId", grade_id AS "gradeId", class_id AS "classId", detail, created_at AS "createdAt" FROM app_audit_logs ORDER BY created_at DESC LIMIT 300`;
      return res.json({ ok: true, logs });
    }
    return await handleUsers(req, res, actor);
  } catch (error) {
    sendDatabaseError(req, res, error, req.method === 'GET' ? 'read' : 'write');
  }
}
