import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requestId, sendDatabaseError } from './_apiError.js';
import { applyCors } from './_cors.js';
import { randomBytes } from 'node:crypto';
import { allScopeOnlyPermissionError, hasGradeLevelAccess } from '../src/shared/permissionRules.js';
import {
  ALL_PERMISSIONS,
  authSql,
  canAccessClass,
  changeOwnCredentials,
  changeOwnPassword,
  changeOwnUsername,
  ensureAuthTables,
  getRecentLoginFailureAlerts,
  hasPermission,
  invalidateLegacySharedToken,
  makePasswordHash,
  requireActor,
  writeAudit,
  type AdminActor,
  type AdminScope,
  type Permission,
} from './_auth.js';
import {
  assertRows,
  rowShape,
  isString,
  isNumberLike,
  isDatabaseInt8,
  isBoolean,
  type DatabaseInt8,
} from './_validation.js';

const text = (value: unknown, max = 120) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const jsonPermissions = (value: unknown): Permission[] =>
  Array.isArray(value)
    ? ([
        ...new Set(
          value.filter((item) => item === '*' || ALL_PERMISSIONS.includes(item as (typeof ALL_PERMISSIONS)[number])),
        ),
      ] as Permission[])
    : [];

/**
 * 统一的 4xx 出口：**一律带 field**，前端据此决定提示落在哪个字段上。
 * `_form` 表示表单级错误（没有具体字段），客户端会把它渲染在弹窗顶部而不是某个输入框下面——
 * 以前这类响应不带 field，前端只能写进面板横幅，弹窗挡着就谁也看不见。
 */
function fail(
  res: VercelResponse,
  status: number,
  error: string,
  field = '_form',
  extra: Record<string, unknown> = {},
) {
  return res.status(status).json({ ok: false, field, error, ...extra });
}

const isUnknown = (_value: unknown): _value is unknown => true;
const isScopeType = (value: unknown): value is AdminScope['type'] =>
  value === 'all' || value === 'grade' || value === 'class';
const isDatabaseInt8OrNull = (value: unknown): value is DatabaseInt8 | null => value == null || isDatabaseInt8(value);

const isIdRow = rowShape<{ id: DatabaseInt8 }>({ id: isDatabaseInt8 });
const isCountRow = rowShape<{ count: number }>({ count: isNumberLike });
const isPermissionsRow = rowShape<{ permissions: unknown }>({ permissions: isUnknown });
const isRolePermissionsRow = rowShape<{ id: string; permissions: unknown }>({
  id: isString,
  permissions: isUnknown,
});
const isUserRoleStatusRow = rowShape<{ role_id: string; status: string }>({
  role_id: isString,
  status: isString,
});
const isBuiltInRow = rowShape<{ built_in: boolean }>({ built_in: isBoolean });
const isBuiltInWithPermissionsRow = rowShape<{ built_in: boolean; permissions: unknown }>({
  built_in: isBoolean,
  permissions: isUnknown,
});
const isTargetInfoRow = rowShape<{ username: string; role_id: string; status: string }>({
  username: isString,
  role_id: isString,
  status: isString,
});
const isScopeRow = rowShape<{
  user_id: DatabaseInt8;
  scope_type: AdminScope['type'];
  grade_id: string;
  class_id: string;
}>({
  user_id: isDatabaseInt8,
  scope_type: isScopeType,
  grade_id: isString,
  class_id: isString,
});
const isUserListRow = rowShape<{
  id: DatabaseInt8;
  username: string;
  displayName: string;
  roleId: string;
  roleName: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: DatabaseInt8 | null;
  createdAt: DatabaseInt8;
  permissions: unknown;
}>({
  id: isDatabaseInt8,
  username: isString,
  displayName: isString,
  roleId: isString,
  roleName: isString,
  status: isString,
  mustChangePassword: isBoolean,
  lastLoginAt: isDatabaseInt8OrNull,
  createdAt: isDatabaseInt8,
  permissions: isUnknown,
});
const isRoleListRow = rowShape<{
  id: string;
  name: string;
  description: string;
  permissions: unknown;
  builtIn: boolean;
  createdAt: DatabaseInt8;
  updatedAt: DatabaseInt8;
}>({
  id: isString,
  name: isString,
  description: isString,
  permissions: isUnknown,
  builtIn: isBoolean,
  createdAt: isDatabaseInt8,
  updatedAt: isDatabaseInt8,
});

function scopes(value: unknown): AdminScope[] {
  if (!Array.isArray(value)) return [];
  const result: AdminScope[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const type = text((raw as Record<string, unknown>).type, 12) as AdminScope['type'];
    const gradeId = text((raw as Record<string, unknown>).gradeId, 128);
    const classId = text((raw as Record<string, unknown>).classId, 128);
    if (type === 'all') return [{ type: 'all', gradeId: '', classId: '' }];
    if (type === 'grade' && gradeId) result.push({ type, gradeId, classId: '' });
    if (type === 'class' && gradeId && classId) result.push({ type, gradeId, classId });
  }
  return result.filter(
    (item, index, all) =>
      all.findIndex(
        (other) => `${other.type}|${other.gradeId}|${other.classId}` === `${item.type}|${item.gradeId}|${item.classId}`,
      ) === index,
  );
}

async function replaceScopes(userId: number, next: AdminScope[]): Promise<void> {
  const sql = authSql();
  await sql.transaction((transaction) => [
    transaction`DELETE FROM app_user_scopes WHERE user_id=${userId}`,
    ...next.map(
      (scope) => transaction`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id)
      VALUES (${userId}, ${scope.type}, ${scope.gradeId}, ${scope.classId}) ON CONFLICT DO NOTHING`,
    ),
  ]);
}

function canDelegatePermissions(actor: AdminActor, permissions: Permission[]): boolean {
  return (
    actor.permissions.includes('*') ||
    (!permissions.includes('*') && permissions.every((permission) => actor.permissions.includes(permission)))
  );
}

export function canDelegateScopes(actor: AdminActor, next: AdminScope[]): boolean {
  if (actor.permissions.includes('*') || actor.scopes.some((scope) => scope.type === 'all')) return true;
  return (
    next.length > 0 &&
    next.every((scope) =>
      scope.type === 'grade'
        ? hasGradeLevelAccess(actor, scope.gradeId)
        : scope.type === 'class' && canAccessClass(actor, scope.gradeId, scope.classId),
    )
  );
}

export type VisibilityCandidate = {
  scopes: AdminScope[];
  permissions: Permission[];
};

export function filterVisibleUsers<T extends VisibilityCandidate>(actor: AdminActor | undefined, users: T[]): T[] {
  if (!actor || actor.permissions.includes('*') || actor.scopes.some((scope) => scope.type === 'all')) return users;
  return users.filter(
    (user) =>
      canDelegatePermissions(actor, user.permissions) &&
      user.scopes.length > 0 &&
      user.scopes.every(
        (scope) =>
          scope.type !== 'all' &&
          (scope.type === 'grade'
            ? hasGradeLevelAccess(actor, scope.gradeId)
            : canAccessClass(actor, scope.gradeId, scope.classId)),
      ),
  );
}

// Historical audit rows cannot be safely filtered to a grade or class scope.
export function canReadAuditLog(actor: AdminActor): boolean {
  return actor.permissions.includes('*') || actor.scopes.some((scope) => scope.type === 'all');
}

function roleScopeError(roleId: string, next: AdminScope[]): string {
  if (roleId === 'super_admin') return '';
  if (roleId === 'class_admin' && !next.some((scope) => scope.type === 'class'))
    return '班级管理员必须选择至少一个具体班级';
  if (roleId === 'grade_admin' && !next.some((scope) => scope.type === 'grade' || scope.type === 'all'))
    return '年级管理员必须选择至少一个年级';
  if (!next.length) return '至少选择一个年级或班级';
  return '';
}

async function delegatedRole(
  actor: AdminActor,
  roleId: string,
): Promise<{ id: string; permissions: Permission[] } | null> {
  const rows = assertRows(
    await authSql()`SELECT id, permissions FROM app_roles WHERE id=${roleId}`,
    isRolePermissionsRow,
    'app_roles',
  );
  if (!rows[0]) return null;
  const role = { id: rows[0].id, permissions: jsonPermissions(rows[0].permissions) };
  return canDelegatePermissions(actor, role.permissions) ? role : null;
}

async function listUsers(actor?: AdminActor) {
  const sql = authSql();
  const [users, scopeRows] = await Promise.all([
    sql`SELECT u.id, u.username, u.display_name AS "displayName", u.role_id AS "roleId", r.name AS "roleName",
      u.status, u.must_change_password AS "mustChangePassword", u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt", r.permissions
      FROM app_users u JOIN app_roles r ON r.id=u.role_id ORDER BY u.created_at ASC`.then((rows) =>
      assertRows(rows, isUserListRow, 'app_users'),
    ),
    sql`SELECT user_id, scope_type, grade_id, class_id FROM app_user_scopes ORDER BY id`.then((rows) =>
      assertRows(rows, isScopeRow, 'app_user_scopes'),
    ),
  ]);
  const scopesByUser = new Map<number, (typeof scopeRows)[number][]>();
  for (const scope of scopeRows) {
    const userId = Number(scope.user_id);
    const bucket = scopesByUser.get(userId);
    if (bucket) bucket.push(scope);
    else scopesByUser.set(userId, [scope]);
  }
  const internal = users.map((user) => ({
    id: Number(user.id),
    username: user.username,
    displayName: user.displayName,
    roleId: user.roleId,
    roleName: user.roleName,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    scopes: (scopesByUser.get(Number(user.id)) ?? []).map((scope) => ({
      type: scope.scope_type,
      gradeId: scope.grade_id,
      classId: scope.class_id,
    })),
    permissions: jsonPermissions(user.permissions),
  }));
  return filterVisibleUsers(actor, internal).map(({ permissions: _permissions, ...publicUser }) => publicUser);
}

async function canManageTarget(actor: AdminActor, userId: number): Promise<boolean> {
  if (actor.permissions.includes('*') || actor.scopes.some((scope) => scope.type === 'all')) return true;
  const sql = authSql();
  const [target, targetScopes] = await Promise.all([
    sql`SELECT r.permissions FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE u.id=${userId}`.then((rows) =>
      assertRows(rows, isPermissionsRow, 'app_users'),
    ),
    sql`SELECT scope_type, grade_id, class_id FROM app_user_scopes WHERE user_id=${userId}`.then((rows) =>
      assertRows(rows, isScopeRow, 'app_user_scopes'),
    ),
  ]);
  if (!target[0] || !canDelegatePermissions(actor, jsonPermissions(target[0].permissions)) || !targetScopes.length)
    return false;
  return targetScopes.every(
    (scope) =>
      scope.scope_type !== 'all' &&
      (scope.scope_type === 'grade'
        ? hasGradeLevelAccess(actor, scope.grade_id)
        : canAccessClass(actor, scope.grade_id, scope.class_id)),
  );
}

async function listRoles() {
  const rows = assertRows(
    await authSql()`SELECT id, name, description, permissions, built_in AS "builtIn", created_at AS "createdAt", updated_at AS "updatedAt" FROM app_roles ORDER BY built_in DESC, created_at ASC`,
    isRoleListRow,
    'app_roles',
  );
  return rows.map((row) => ({ ...row, permissions: jsonPermissions(row.permissions) }));
}

async function ensureNotLastSuperAdmin(userId: number, nextRoleId: string, nextStatus: string): Promise<boolean> {
  const rows = assertRows(
    await authSql()`SELECT role_id, status FROM app_users WHERE id=${userId}`,
    isUserRoleStatusRow,
    'app_users',
  );
  if (
    rows[0]?.role_id !== 'super_admin' ||
    rows[0]?.status !== 'active' ||
    (nextRoleId === 'super_admin' && nextStatus === 'active')
  )
    return true;
  const count = assertRows(
    await authSql()`SELECT COUNT(*)::int AS count FROM app_users WHERE role_id='super_admin' AND status='active'`,
    isCountRow,
    'app_users',
  );
  return Number(count[0]?.count) > 1;
}

async function handleUsers(req: VercelRequest, res: VercelResponse, actor: AdminActor) {
  const sql = authSql();
  const body = req.body ?? {};
  const action = text(body.action, 40);
  if (req.method === 'POST' && action === 'change-own-credentials') {
    const result = await changeOwnCredentials(
      actor.id,
      String(body.currentPassword ?? ''),
      String(body.username ?? ''),
      String(body.newPassword ?? ''),
    );
    if (!result.ok) return res.status(400).json({ ...result, field: result.field ?? '_form' });
    await writeAudit(actor, 'user.credentials.change', 'user', String(actor.id), {
      from: result.oldUsername,
      to: result.username,
      passwordChanged: Boolean(body.newPassword),
    });
    return res.json({ ok: true, username: result.username, message: 'Credentials changed. Please sign in again.' });
  }
  if (req.method === 'POST' && action === 'change-own-password') {
    const result = await changeOwnPassword(
      actor.id,
      String(body.currentPassword ?? ''),
      String(body.newPassword ?? ''),
    );
    if (!result.ok) return res.status(400).json({ ...result, field: result.field ?? '_form' });
    await writeAudit(actor, 'user.password.change', 'user', String(actor.id));
    return res.json({ ok: true, message: 'Password changed. Please sign in again.' });
  }
  if (req.method === 'POST' && action === 'change-own-username') {
    const result = await changeOwnUsername(actor.id, String(body.currentPassword ?? ''), String(body.username ?? ''));
    if (!result.ok) return res.status(400).json({ ...result, field: result.field ?? '_form' });
    await writeAudit(actor, 'user.username.change', 'user', String(actor.id), {
      from: result.oldUsername,
      to: text(body.username, 40),
    });
    return res.json({ ok: true, message: 'Username changed. Please sign in again.' });
  }
  if (req.method === 'GET') {
    if (!hasPermission(actor, 'user.read')) return fail(res, 403, '当前账号没有查看用户列表的权限');
    return res.json({
      ok: true,
      users: await listUsers(actor),
      roles: await listRoles(),
      permissions: ALL_PERMISSIONS,
    });
  }
  if (action === 'create') {
    if (!hasPermission(actor, 'user.create')) return fail(res, 403, '当前账号没有创建用户的权限');
    const username = text(body.username, 40);
    const displayName = text(body.displayName, 80) || username;
    const password = String(body.password ?? '');
    const roleId = text(body.roleId, 80);
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username))
      return res
        .status(400)
        .json({ ok: false, field: 'username', error: '用户名需为 3-40 位字母、数字、点、横线或下划线' });
    if (!displayName) return fail(res, 400, '请输入显示名称', 'displayName');
    if (password.length < 8) return fail(res, 400, '初始密码至少需要 8 位', 'password');
    const role = await delegatedRole(actor, roleId);
    if (!role) return fail(res, 403, '不能授予超出当前账号的角色权限', 'roleId');
    const nextScopes =
      roleId === 'super_admin' ? [{ type: 'all' as const, gradeId: '', classId: '' }] : scopes(body.scopes);
    const scopeError = roleScopeError(roleId, nextScopes);
    if (scopeError) return fail(res, 400, scopeError, 'scopes');
    const allScopeOnlyError = allScopeOnlyPermissionError(role.permissions, nextScopes);
    if (allScopeOnlyError) return fail(res, 400, allScopeOnlyError, 'scopes');
    if (!canDelegateScopes(actor, nextScopes)) return fail(res, 403, '不能授予超出当前账号的数据范围', 'scopes');
    const { hash, salt } = await makePasswordHash(password);
    const at = Date.now();
    try {
      const inserted = assertRows(
        await sql`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
        VALUES (${username}, ${displayName}, ${hash}, ${salt}, ${roleId}, 'active', TRUE, 1, ${at}, ${at}) RETURNING id`,
        isIdRow,
        'app_users',
      );
      await replaceScopes(Number(inserted[0].id), nextScopes);
      await writeAudit(actor, 'user.create', 'user', String(inserted[0].id), { username, roleId });
      return res.json({ ok: true, users: await listUsers(actor) });
    } catch (error) {
      if (/unique/i.test(error instanceof Error ? error.message : String(error)))
        return fail(res, 409, '用户名已存在', 'username');
      throw error;
    }
  }
  if (action === 'update') {
    if (!hasPermission(actor, 'user.edit')) return fail(res, 403, '当前账号没有修改用户的权限');
    const id = Number(body.id);
    const displayName = text(body.displayName, 80);
    const roleId = text(body.roleId, 80);
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    if (!Number.isFinite(id) || !displayName) return fail(res, 400, '用户信息不完整', 'displayName');
    if (!(await canManageTarget(actor, id))) return fail(res, 403, '不能修改超出当前账号管理范围的用户');
    const existing = assertRows(
      await sql`SELECT role_id, status FROM app_users WHERE id=${id}`,
      isUserRoleStatusRow,
      'app_users',
    );
    if (!existing[0]) return fail(res, 404, '用户不存在');
    if (id === actor.id && (status !== 'active' || roleId !== actor.roleId))
      return fail(res, 400, '不能停用自己或修改自己的角色', 'status');
    if (status !== existing[0].status && !hasPermission(actor, 'user.disable'))
      return fail(res, 403, '无权启用或停用用户', 'status');
    const role = await delegatedRole(actor, roleId);
    if (!role) return fail(res, 403, '不能授予超出当前账号的角色权限', 'roleId');
    const nextScopes =
      roleId === 'super_admin' ? [{ type: 'all' as const, gradeId: '', classId: '' }] : scopes(body.scopes);
    const scopeError = roleScopeError(roleId, nextScopes);
    if (scopeError) return fail(res, 400, scopeError, 'scopes');
    const allScopeOnlyError = allScopeOnlyPermissionError(role.permissions, nextScopes);
    if (allScopeOnlyError) return fail(res, 400, allScopeOnlyError, 'scopes');
    if (!canDelegateScopes(actor, nextScopes)) return fail(res, 403, '不能授予超出当前账号的数据范围', 'scopes');
    if (!(await ensureNotLastSuperAdmin(id, roleId, status)))
      return fail(res, 400, '必须至少保留一个启用的超级管理员', 'roleId');
    await invalidateLegacySharedToken();
    const transactionResults = await sql.transaction((transaction) => [
      transaction`UPDATE app_users SET display_name=${displayName}, role_id=${roleId}, status=${status}, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${id} RETURNING id`,
      transaction`DELETE FROM app_user_scopes WHERE user_id=${id}`,
      ...nextScopes.map(
        (scope) => transaction`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id)
        VALUES (${id}, ${scope.type}, ${scope.gradeId}, ${scope.classId}) ON CONFLICT DO NOTHING`,
      ),
    ]);
    const updated = assertRows(transactionResults[0] ?? [], isIdRow, 'app_users');
    if (!updated.length) return fail(res, 404, '用户不存在');
    await writeAudit(actor, 'user.update', 'user', String(id), { roleId, status });
    return res.json({ ok: true, users: await listUsers(actor) });
  }
  if (action === 'reset-password') {
    if (!hasPermission(actor, 'user.reset_password')) return fail(res, 403, '当前账号没有重置密码的权限');
    const id = Number(body.id);
    const password = String(body.password ?? '');
    if (!Number.isFinite(id) || password.length < 8) return fail(res, 400, '新密码至少需要 8 位', 'password');
    if (!(await canManageTarget(actor, id))) return fail(res, 403, '不能重置超出当前账号管理范围的用户密码');
    const target = assertRows(
      await sql`SELECT r.permissions FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE u.id=${id}`,
      isPermissionsRow,
      'app_users',
    );
    if (!target[0]) return fail(res, 404, '用户不存在');
    if (!canDelegatePermissions(actor, jsonPermissions(target[0].permissions)))
      return fail(res, 403, '不能重置权限高于当前账号的用户密码');
    const { hash, salt } = await makePasswordHash(password);
    await invalidateLegacySharedToken();
    await sql`UPDATE app_users SET password_hash=${hash}, password_salt=${salt}, must_change_password=TRUE, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${id}`;
    await writeAudit(actor, 'user.password.reset', 'user', String(id));
    return res.json({ ok: true });
  }
  if (action === 'delete') {
    if (!hasPermission(actor, 'user.delete')) return fail(res, 403, '无权删除用户');
    const id = Number(body.id);
    if (!Number.isFinite(id)) return fail(res, 400, '用户信息不完整', 'id');
    if (id === actor.id) return fail(res, 400, '不能删除当前登录账号', 'id');
    if (!(await canManageTarget(actor, id))) return fail(res, 403, '不能删除超出当前账号管理范围的用户');
    const target = assertRows(
      await sql`SELECT username, role_id, status FROM app_users WHERE id=${id}`,
      isTargetInfoRow,
      'app_users',
    );
    if (!target[0]) return fail(res, 404, '用户不存在');
    if (target[0].role_id === 'super_admin' && target[0].status === 'active') {
      const count = assertRows(
        await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE role_id='super_admin' AND status='active'`,
        isCountRow,
        'app_users',
      );
      if (Number(count[0]?.count) <= 1) return fail(res, 400, '必须至少保留一个启用的超级管理员', 'roleId');
    }
    await writeAudit(actor, 'user.delete', 'user', String(id), {
      username: target[0].username,
      roleId: target[0].role_id,
    });
    await sql`DELETE FROM app_users WHERE id=${id}`;
    return res.json({ ok: true, users: await listUsers(actor) });
  }
  return fail(res, 400, '未知用户操作');
}

async function handleRoles(req: VercelRequest, res: VercelResponse, actor: AdminActor) {
  if (!hasPermission(actor, 'role.manage')) return fail(res, 403, '当前账号没有管理角色的权限');
  const sql = authSql();
  const body = req.body ?? {};
  if (req.method === 'GET') return res.json({ ok: true, roles: await listRoles(), permissions: ALL_PERMISSIONS });
  const action = text(body.action, 40);
  if (action === 'save') {
    const rawId = text(body.id, 80);
    const name = text(body.name, 80);
    const permissions = jsonPermissions(body.permissions);
    if (!name) return fail(res, 400, '请填写角色名称', 'name');
    if (!permissions.length) return fail(res, 400, '至少选择一项权限', 'permissions');
    if (!canDelegatePermissions(actor, permissions))
      return fail(res, 403, '不能创建权限高于当前账号的角色', 'permissions');
    const id = rawId || `role_${randomBytes(6).toString('hex')}`;
    const existing = assertRows(
      await sql`SELECT built_in, permissions FROM app_roles WHERE id=${id}`,
      isBuiltInWithPermissionsRow,
      'app_roles',
    );
    if (existing[0]?.built_in) return fail(res, 400, '内置角色不可修改，请创建自定义角色', 'id');
    const builtinRoleNames = new Set([
      '\u8d85\u7ea7\u7ba1\u7406\u5458',
      '\u5e74\u7ea7\u7ba1\u7406\u5458',
      '\u73ed\u7ea7\u7ba1\u7406\u5458',
      '\u53ea\u8bfb\u7528\u6237',
    ]);
    const normalizedName = name.trim();
    if (builtinRoleNames.has(normalizedName)) {
      return fail(
        res,
        400,
        '\u201c' +
          normalizedName +
          '\u201d\u4e3a\u7cfb\u7edf\u5185\u7f6e\u89d2\u8272\u540d\u79f0\uff0c\u8bf7\u4e3a\u81ea\u5b9a\u4e49\u89d2\u8272\u4f7f\u7528\u5176\u4ed6\u540d\u79f0\uff0c\u907f\u514d\u4e0e\u771f\u5b9e\u7ba1\u7406\u5458\u8eab\u4efd\u6df7\u6dc6',
        'name',
      );
    }
    const at = Date.now();
    const before = jsonPermissions(existing[0]?.permissions);
    await sql`INSERT INTO app_roles (id, name, description, permissions, built_in, created_at, updated_at)
      VALUES (${id}, ${name}, ${text(body.description, 300)}, ${JSON.stringify(permissions)}::jsonb, FALSE, ${at}, ${at})
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, permissions=EXCLUDED.permissions, updated_at=EXCLUDED.updated_at`;
    /*
     * 权限真的变了就让该角色的在线账号重新登录：客户端 `can()` 用的是登录时那一份权限缓存，
     * 不失效会话就会出现「前端还按旧权限显示、服务端已经按新权限拦截」的错位。
     * 只改名/改说明时不动会话。
     */
    const permissionsChanged =
      existing.length > 0 &&
      (before.length !== permissions.length || !before.every((permission) => permissions.includes(permission)));
    let sessionsInvalidated = 0;
    if (permissionsChanged) {
      const affected = assertRows(
        await sql`UPDATE app_users SET token_version = token_version + 1, updated_at = ${at}
          WHERE role_id = ${id} RETURNING id`,
        isIdRow,
        'app_users',
      );
      sessionsInvalidated = affected.length;
    }
    await writeAudit(actor, rawId ? 'role.update' : 'role.create', 'role', id, {
      name,
      permissions,
      ...(permissionsChanged ? { sessionsInvalidated } : {}),
    });
    return res.json({ ok: true, roles: await listRoles(), sessionsInvalidated });
  }
  if (action === 'delete') {
    const id = text(body.id, 80);
    const role = assertRows(await sql`SELECT built_in FROM app_roles WHERE id=${id}`, isBuiltInRow, 'app_roles');
    if (!role.length) return fail(res, 404, '角色不存在', 'id');
    if (role[0].built_in) return fail(res, 400, '内置角色不可删除', 'id');
    const used = assertRows(
      await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE role_id=${id}`,
      isCountRow,
      'app_users',
    );
    if (Number(used[0]?.count) > 0) return fail(res, 409, '该角色仍有用户，不能删除', 'id');
    await sql`DELETE FROM app_roles WHERE id=${id}`;
    await writeAudit(actor, 'role.delete', 'role', id);
    return res.json({ ok: true, roles: await listRoles() });
  }
  return fail(res, 400, '未知角色操作');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  requestId(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (!applyCors(req, res, { methods: ['GET', 'POST'] })) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    await ensureAuthTables();
    const ownAccountChange =
      req.method === 'POST' &&
      text(req.body?.resource, 30) === 'users' &&
      ['change-own-password', 'change-own-username', 'change-own-credentials'].includes(text(req.body?.action, 40));
    const actor = await requireActor(req, res, undefined, ownAccountChange);
    if (!actor) return;
    const resource = text(req.method === 'GET' ? req.query?.resource : req.body?.resource, 30) || 'users';
    if (resource === 'roles') return await handleRoles(req, res, actor);
    if (resource === 'audit') {
      if (!hasPermission(actor, 'audit.read') || !canReadAuditLog(actor))
        return fail(res, 403, '当前账号没有查看操作日志的权限');
      const [logs, loginFailureAlerts] = await Promise.all([
        authSql()`SELECT id, user_id AS "userId", username, action, resource_type AS "resourceType", resource_id AS "resourceId", grade_id AS "gradeId", class_id AS "classId", detail, created_at AS "createdAt" FROM app_audit_logs ORDER BY created_at DESC LIMIT 300`,
        getRecentLoginFailureAlerts(),
      ]);
      return res.json({ ok: true, logs, loginFailureAlerts });
    }
    return await handleUsers(req, res, actor);
  } catch (error) {
    sendDatabaseError(req, res, error, req.method === 'GET' ? 'read' : 'write');
  }
}
