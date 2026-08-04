import {
  hasAllScope,
  hasPermission,
  type PermissionSubject,
} from "../shared/permissionRules.js";
import type { SchoolClass, SchoolGrade } from "../types/school.js";

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
    canReadUsers: hasPermission(current, "user.read"),
    canCreateUser: hasPermission(current, "user.create"),
    canEditUser: hasPermission(current, "user.edit"),
    canResetPassword: hasPermission(current, "user.reset_password"),
    canDeleteUser: hasPermission(current, "user.delete"),
    canManageRoles: hasPermission(current, "role.manage"),
    canReadAudit: hasPermission(current, "audit.read"),
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
      : (current?.scopes ?? [])
          .filter((scope) => scope.type === "grade")
          .map((scope) => scope.gradeId),
  );
  const visibleClassIds = new Set(
    canAssignAll
      ? classes.map((item) => item.id)
      : (current?.scopes ?? [])
          .filter((scope) => scope.type === "class")
          .map((scope) => scope.classId),
  );
  classes.forEach((item) => {
    if (visibleGradeIds.has(item.gradeId)) visibleClassIds.add(item.id);
  });
  const visibleGrades = grades.filter((item) => visibleGradeIds.has(item.id));
  const visibleClasses = classes.filter((item) => visibleClassIds.has(item.id));
  const delegableRoles = roles.filter(
    (role) =>
      current?.permissions.includes("*") ||
      (!role.permissions.includes("*") &&
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
