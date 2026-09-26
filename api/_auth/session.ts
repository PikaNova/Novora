// api/_auth/session.ts
// 凭据 → 对话主体（AdminActor）的解析，以及服务端路由的统一守卫 requireActor。
//
// getActor 不再自己堆 if 分支，而是查一张**凭据解析器登记表**：每种令牌格式注册一个
// 「match + resolve」单元，注册顺序即匹配顺序。现有三种（管理员令牌、访客令牌、
// v1.29.1 及更早的共享令牌）都在本文件注册；未来加设备密钥或 SSO 只需 registerCredentialResolver，
// 不必再动 getActor。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { hasPermission, type Permission } from '../../src/shared/permissionRules.js';
import { assertRows } from '../_validation.js';
import { authSql, config } from './db.js';
import { actorFromUserRow, userById } from './identities.js';
import { parsePermissions } from './roles.js';
import { isGuestDeviceRow, isGuestRoleRow, isUserIdRow, type AdminActor, type AuthRow } from './shapes.js';
import {
  extractBearer,
  guestSignature,
  isLegacySharedTokenVersionCurrent,
  isTokenNotExpired,
  isUserTokenVersionCurrent,
  signature,
} from './tokens.js';

/** 一种令牌格式的解析单元：先 match 判断「这串凭据是不是我的」，命中后再 resolve。 */
type CredentialResolver = {
  id: string;
  match(parts: string[]): boolean;
  resolve(parts: string[], auth: AuthRow): Promise<AdminActor | null>;
};

const credentialResolvers = new Map<string, CredentialResolver>();

/** 注册一种凭据解析器。重复 id 直接抛错：两种格式互相遮蔽会静默放过无效令牌。 */
export function registerCredentialResolver(resolver: CredentialResolver): void {
  if (credentialResolvers.has(resolver.id)) throw new Error(`credential resolver already registered: ${resolver.id}`);
  credentialResolvers.set(resolver.id, resolver);
}

/** 当前生效的解析器 id，按匹配顺序返回（供排错与用例使用）。 */
export function listCredentialResolvers(): string[] {
  return [...credentialResolvers.keys()];
}

export async function getActor(token: string | undefined): Promise<AdminActor | null> {
  if (!token) return null;
  const auth = await config();
  if (!auth) return null;
  const parts = Buffer.from(token, 'base64url').toString().split('.');
  for (const resolver of credentialResolvers.values()) {
    if (!resolver.match(parts)) continue;
    return resolver.resolve(parts, auth);
  }
  return null;
}

/** 用户令牌通过签名校验后的统一收尾：读账号、比版本、确认在用。 */
async function resolveUserActor(userId: number, version: number | null): Promise<AdminActor | null> {
  const row = await userById(userId);
  if (version !== null && !isUserTokenVersionCurrent(row, version)) return null;
  if (!row || row.status !== 'active') return null;
  return actorFromUserRow(row);
}

const guestCredential: CredentialResolver = {
  id: 'guest',
  match: (parts) => parts.length === 7 && parts[0] === 'g',
  resolve: async (parts, auth) => {
    const guestInstanceId = parts[1];
    const guestGradeId = parts[2];
    const guestClassId = parts[3];
    const guestExpiresAt = Number(parts[4]);
    const guestVersion = Number(parts[5]);
    const guestReceived = parts[6];
    if (
      !Number.isFinite(guestExpiresAt) ||
      !Number.isFinite(guestVersion) ||
      !isTokenNotExpired(guestExpiresAt, Date.now()) ||
      guestVersion !== auth.token_version
    )
      return null;
    const expectedGuest = guestSignature(
      guestInstanceId,
      guestGradeId,
      guestClassId,
      guestExpiresAt,
      guestVersion,
      auth.token_secret,
    );
    const guestA = Buffer.from(guestReceived || '');
    const guestB = Buffer.from(expectedGuest);
    if (guestA.length !== guestB.length || !timingSafeEqual(guestA, guestB)) return null;
    const deviceRows = assertRows(
      await authSql()`SELECT revoked, grade_id, class_id, is_management FROM device_instances WHERE instance_id=${guestInstanceId} LIMIT 1`,
      isGuestDeviceRow,
      'device_instances',
    );
    const guestDevice = deviceRows[0];
    if (!guestDevice || guestDevice.revoked !== false || guestDevice.is_management === true) return null;
    if (String(guestDevice.grade_id) !== guestGradeId || String(guestDevice.class_id) !== guestClassId) return null;
    const guestRoleRows = assertRows(
      await authSql()`SELECT name, permissions FROM app_roles WHERE id='viewer' LIMIT 1`,
      isGuestRoleRow,
      'app_roles',
    );
    return {
      id: 0,
      username: guestInstanceId,
      displayName: '班级访客',
      roleId: 'viewer',
      roleName: guestRoleRows[0]?.name ?? '班级访客',
      permissions: parsePermissions(guestRoleRows[0]?.permissions),
      scopes: [{ type: 'class', gradeId: guestGradeId, classId: guestClassId }],
      mustChangePassword: false,
    };
  },
};

const userTokenCredential: CredentialResolver = {
  id: 'admin',
  match: (parts) => parts.length === 4,
  resolve: async (parts, auth) => {
    const [userId, expiresAt, version] = parts.slice(0, 3).map(Number);
    const received = parts[3];
    if (!Number.isFinite(userId) || !Number.isFinite(version) || !isTokenNotExpired(expiresAt, Date.now())) return null;
    const expected = signature(userId, expiresAt, version, auth.token_secret);
    const a = Buffer.from(received || '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return resolveUserActor(userId, version);
  },
};

const legacySharedTokenCredential: CredentialResolver = {
  id: 'legacy-shared',
  match: (parts) => parts.length === 3,
  resolve: async (parts, auth) => {
    // v1.29.1 and earlier shared admin tokens map to the default admin account.
    // Their version is global, so security-sensitive user changes invalidate
    // every legacy shared token through invalidateLegacySharedToken().
    const [expiresAt, version] = parts.slice(0, 2).map(Number);
    const received = parts[2];
    if (!isTokenNotExpired(expiresAt, Date.now()) || !isLegacySharedTokenVersionCurrent(version, auth.token_version))
      return null;
    const legacyExpected = createHmac('sha256', auth.token_secret)
      .update(`${expiresAt}.${version}`)
      .digest('base64url');
    const a = Buffer.from(received || '');
    const b = Buffer.from(legacyExpected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const adminRows = assertRows(
      await authSql()`SELECT id FROM app_users WHERE LOWER(username)='admin' LIMIT 1`,
      isUserIdRow,
      'app_users',
    );
    return resolveUserActor(Number(adminRows[0]?.id), null);
  },
};

// 注册顺序即匹配顺序：访客 → 管理员 → 旧共享令牌，与拆分前的分支顺序一致。
for (const resolver of [guestCredential, userTokenCredential, legacySharedTokenCredential]) {
  registerCredentialResolver(resolver);
}

export async function requireActor(
  req: VercelRequest,
  res: VercelResponse,
  permission?: Permission,
  allowPasswordChange = false,
): Promise<AdminActor | null> {
  const actor = await getActor(extractBearer(req.headers.authorization));
  if (!actor) {
    res.status(401).json({ ok: false, code: 'AUTH_EXPIRED', error: '登录状态已失效，请重新登录' });
    return null;
  }
  if (actor.mustChangePassword && !allowPasswordChange) {
    res.status(403).json({ ok: false, error: '请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' });
    return null;
  }
  if (permission && !hasPermission(actor, permission)) {
    res.status(403).json({ ok: false, code: 'PERMISSION_DENIED', error: '当前账号没有执行此操作的权限', permission });
    return null;
  }
  return actor;
}
