// api/_auth.ts
// 鉴权模块的唯一对外出口（barrel）。实现按职责拆在 ./_auth/*：
//   连接/建表编排/全局令牌版本 → ./_auth/db.ts
//   建表语句 DDL              → ./_auth/tables.ts
//   角色种子与存量数据迁移     → ./_auth/seeds.ts
//   行形状与领域类型           → ./_auth/shapes.ts
//   口令哈希                  → ./_auth/passwords.ts
//   令牌签发与校验             → ./_auth/tokens.ts
//   凭据 → 主体解析、路由守卫   → ./_auth/session.ts
//   登录与失败锁定/告警        → ./_auth/login.ts
//   恢复密钥与首次引导         → ./_auth/recovery.ts
//   账号自助改密改用户名       → ./_auth/credentials.ts
//   审计写入                  → ./_auth/audit.ts
// 本文件只做转出：api/**、server/**、tests/** 里 `from './_auth.js'` 的引用保持不变。
// 遥测 IP 盐已移出鉴权（见 api/_telemetry/ipSalt.ts）。
//
// 已移除的历史导出（全仓库无调用方，见本次拆分）：
//   verifyToken / checkPassword / changePassword / generateToken

export { ALL_PERMISSIONS, canAccessClass, canAccessGrade, hasPermission } from '../src/shared/permissionRules.js';
export type { Permission, PermissionScope } from '../src/shared/permissionRules.js';

export {
  SCHEMA_MIGRATION_LOCK_ID,
  authSql,
  ensureAuthTables,
  invalidateLegacySharedToken,
  isPasswordRequired,
} from './_auth/db.js';
export { BUILTIN_ROLES } from './_auth/roles.js';
export { makePasswordHash, validateEmailFormat } from './_auth/passwords.js';
export {
  extractBearer,
  isLegacySharedTokenVersionCurrent,
  isTokenNotExpired,
  isUserTokenVersionCurrent,
  issueGuestToken,
  issueTokenForUser,
} from './_auth/tokens.js';
export { getActor, requireActor } from './_auth/session.js';
export {
  authenticateUser,
  checkLoginLockout,
  evaluateLoginFailureAlerts,
  evaluateLoginLockout,
  getRecentLoginFailureAlerts,
} from './_auth/login.js';
export {
  ensureGeneratedRecoveryKey,
  isAdminRecoveryConfigured,
  recoverSuperAdmin,
  repairSuperAdmin,
} from './_auth/recovery.js';
export { changeOwnCredentials, changeOwnPassword, changeOwnUsername } from './_auth/credentials.js';
export { writeAudit } from './_auth/audit.js';

export type { AdminActor, AdminScope, LoginAttemptRow } from './_auth/shapes.js';
export type { LoginFailureAlert } from '../src/shared/authContracts.js';
