import { hasAllScope, hasPermission, type PermissionSubject } from '../shared/permissionRules.js';
import type { RoleLevel, RoleModule } from '../constants/permissions.js';
import type { SchoolClass, SchoolGrade } from '../types/school.js';

export type UserManagementPermissionFlags = {
  canReadUsers: boolean;
  canCreateUser: boolean;
  canEditUser: boolean;
  canResetPassword: boolean;
  canDeleteUser: boolean;
  canManageRoles: boolean;
  canReadAudit: boolean;
};

export function computeUserManagementPermissionFlags(
  current: PermissionSubject | null | undefined,
): UserManagementPermissionFlags {
  return {
    canReadUsers: hasPermission(current, 'user.read'),
    canCreateUser: hasPermission(current, 'user.create'),
    canEditUser: hasPermission(current, 'user.edit'),
    canResetPassword: hasPermission(current, 'user.reset_password'),
    canDeleteUser: hasPermission(current, 'user.delete'),
    canManageRoles: hasPermission(current, 'role.manage'),
    canReadAudit: hasPermission(current, 'audit.read'),
  };
}

export type DelegableRoleLike = { id: string; permissions: string[] };

export function computeUserManagementScopeAccess<TRole extends DelegableRoleLike>(
  current: PermissionSubject | null | undefined,
  roles: TRole[],
  grades: SchoolGrade[],
  classes: SchoolClass[],
) {
  const canAssignAll = hasAllScope(current);
  const visibleGradeIds = new Set(
    canAssignAll
      ? grades.map((item) => item.id)
      : (current?.scopes ?? []).filter((scope) => scope.type === 'grade').map((scope) => scope.gradeId),
  );
  const visibleClassIds = new Set(
    canAssignAll
      ? classes.map((item) => item.id)
      : (current?.scopes ?? []).filter((scope) => scope.type === 'class').map((scope) => scope.classId),
  );
  classes.forEach((item) => {
    if (visibleGradeIds.has(item.gradeId)) visibleClassIds.add(item.id);
  });
  const visibleGrades = grades.filter((item) => visibleGradeIds.has(item.id));
  const visibleClasses = classes.filter((item) => visibleClassIds.has(item.id));
  const delegableRoles = roles.filter(
    (role) =>
      current?.permissions.includes('*') ||
      (!role.permissions.includes('*') &&
        role.permissions.every((permission) => current?.permissions.includes(permission))),
  );
  return {
    canAssignAll,
    visibleGradeIds,
    visibleClassIds,
    visibleGrades,
    visibleClasses,
    delegableRoles,
  };
}

/**
 * 当前账号能授出的权限集合：`*` 返回 null（表示全部）。
 * 与服务端 `canDelegatePermissions` 同一口径——服务端会拒的，前端不该让人勾得动。
 */
export function computeDelegablePermissionSet(current: PermissionSubject | null | undefined): Set<string> | null {
  if (!current) return new Set();
  if (current.permissions.includes('*')) return null;
  return new Set(current.permissions);
}

/** 把某个模块设成 read / manage 需要哪些权限。 */
export function moduleLevelPermissions(module: Pick<RoleModule, 'read' | 'manage'>, level: RoleLevel): string[] {
  if (level === 'none') return [];
  if (level === 'read') return [...module.read];
  return [...module.read, ...module.manage];
}

/** 当前账号能不能把某个模块设到这个级别（缺权限的级别要在 UI 上禁用掉）。 */
export function canGrantModuleLevel(
  delegable: Set<string> | null,
  module: Pick<RoleModule, 'read' | 'manage'>,
  level: RoleLevel,
): boolean {
  if (!delegable) return true;
  return moduleLevelPermissions(module, level).every((permission) => delegable.has(permission));
}
