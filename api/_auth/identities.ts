// api/_auth/identities.ts
// 把 app_users / app_user_scopes 的行拼成对话主体 AdminActor。
// 权限判定本身不在这里，而在 src/shared/permissionRules.ts（前后端共用同一份）。
import { assertRows } from '../_validation.js';
import { authSql } from './db.js';
import { parsePermissions } from './roles.js';
import { isScopeRow, isUserRow, type AdminActor, type AdminScope, type UserRow } from './shapes.js';

export async function actorFromUserRow(row: UserRow): Promise<AdminActor> {
  const scopes = assertRows(
    await authSql()`SELECT scope_type, grade_id, class_id FROM app_user_scopes WHERE user_id=${row.id} ORDER BY id`,
    isScopeRow,
    'app_user_scopes',
  );
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    roleId: row.role_id,
    roleName: row.role_name,
    permissions: parsePermissions(row.permissions),
    scopes: scopes.map((scope) => ({
      type: scope.scope_type as AdminScope['type'],
      gradeId: scope.grade_id || '',
      classId: scope.class_id || '',
    })),
    mustChangePassword: row.must_change_password === true,
  };
}

export async function userById(id: number): Promise<UserRow | null> {
  const rows = assertRows(
    await authSql()`SELECT u.id, u.username, u.display_name, u.password_hash, u.password_salt, u.role_id,
      r.name AS role_name, r.permissions, u.status, u.must_change_password, u.token_version, u.email
    FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE u.id=${id} LIMIT 1`,
    isUserRow,
    'app_users/app_roles',
  );
  return rows[0] ?? null;
}
