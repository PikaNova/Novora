// api/_auth/shapes.ts
// 鉴权相关的领域类型与「数据库返回的行长什么样」的运行时校验。
// 这里只放形状，不放业务逻辑：建表语句在 ./tables.ts，角色种子在 ./roles.ts,
// 令牌与会话流程在 ./tokens.ts / ./session.ts。
import type { Permission, PermissionScope } from '../../src/shared/permissionRules.js';
import {
  isBoolean,
  isDatabaseInt8,
  isNullableString,
  isNumberLike,
  isString,
  rowShape,
  type DatabaseInt8,
} from '../_validation.js';

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

export type AuthRow = { password_hash: string; password_salt: string; token_secret: string; token_version: number };
export type UserRow = {
  id: DatabaseInt8;
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
  last_login_at?: DatabaseInt8 | null;
  email?: string | null;
};
export type LoginAttemptRow = { action: string; created_at: DatabaseInt8 };

export const isPasswordSaltRow = rowShape<{ password_hash: string; password_salt: string }>({
  password_hash: isString,
  password_salt: isString,
});
export const isCountRow = rowShape<{ count: number }>({ count: isNumberLike });
export const isUserIdRow = rowShape<{ id: DatabaseInt8 }>({ id: isDatabaseInt8 });
export const isAuthIdRow = rowShape<{ id: number }>({ id: isNumberLike });
export const isIpSaltRow = rowShape<{ ip_salt: string }>({ ip_salt: isString });
export const isGuestDeviceRow = rowShape<{
  revoked: boolean;
  grade_id: string;
  class_id: string;
  is_management: boolean;
}>({
  revoked: isBoolean,
  grade_id: isString,
  class_id: isString,
  is_management: isBoolean,
});
export const isAuthRow = rowShape<AuthRow>({
  password_hash: isString,
  password_salt: isString,
  token_secret: isString,
  token_version: isNumberLike,
});
export const isRecoveryHashRow = rowShape<{ recovery_key_hash?: string | null }>({
  recovery_key_hash: isNullableString,
});
export const isRecoveryHashSaltRow = rowShape<{ recovery_key_hash?: string | null; recovery_key_salt?: string | null }>(
  {
    recovery_key_hash: isNullableString,
    recovery_key_salt: isNullableString,
  },
);
export const isIdUsernameRow = rowShape<{ id: DatabaseInt8; username: string }>({
  id: isDatabaseInt8,
  username: isString,
});
export const isCountOldestRow = rowShape<{ count: number; oldest: DatabaseInt8 }>({
  count: isNumberLike,
  oldest: isDatabaseInt8,
});
export const isUserRow = rowShape<UserRow>({
  id: isDatabaseInt8,
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
  last_login_at: (value): value is DatabaseInt8 | null | undefined => value == null || isDatabaseInt8(value),
  email: (value): value is string | null | undefined => value == null || isString(value),
});
export const isScopeRow = rowShape<{ scope_type: string; grade_id: string; class_id: string }>({
  scope_type: isString,
  grade_id: isString,
  class_id: isString,
});
export const isGuestRoleRow = rowShape<{ name: string; permissions: unknown }>({
  name: isString,
  permissions: (_value: unknown): _value is unknown => true,
});
export const isLoginAttemptRow = rowShape<LoginAttemptRow>({ action: isString, created_at: isDatabaseInt8 });
export const isLoginAttemptWithUsernameRow = rowShape<LoginAttemptRow & { username: string }>({
  action: isString,
  created_at: isDatabaseInt8,
  username: isString,
});
