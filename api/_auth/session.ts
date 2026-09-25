// api/_auth/session.ts
// 凭据 → 对话主体（AdminActor）的解析，以及服务端路由的统一守卫 requireActor。
// 目前支持「管理员令牌」「访客令牌」「v1.29.1 及更早的共享令牌」三种；
// 未来新增设备密钥/SSO 时，应在这里引入解析器登记表，而不是继续堆 if 分支。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { hasPermission, type Permission } from '../../src/shared/permissionRules.js';
import { assertRows } from '../_validation.js';
import { authSql, config } from './db.js';
import { actorFromUserRow, userById } from './identities.js';
import { parsePermissions } from './roles.js';
import { isGuestDeviceRow, isGuestRoleRow, isUserIdRow, type AdminActor } from './shapes.js';
import {
  extractBearer,
  guestSignature,
  isLegacySharedTokenVersionCurrent,
  isTokenNotExpired,
  isUserTokenVersionCurrent,
  signature,
} from './tokens.js';

export async function getActor(token: string | undefined): Promise<AdminActor | null> {
  if (!token) return null;
  const auth = await config();
  if (!auth) return null;
  const parts = Buffer.from(token, 'base64url').toString().split('.');
  if (parts.length === 7 && parts[0] === 'g') {
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
  }
  let userId: number;
  let expiresAt: number;
  let version: number;
  let received: string;
  if (parts.length === 4) {
    [userId, expiresAt, version] = parts.slice(0, 3).map(Number);
    received = parts[3];
    if (!Number.isFinite(userId) || !Number.isFinite(version) || !isTokenNotExpired(expiresAt, Date.now())) return null;
    const expected = signature(userId, expiresAt, version, auth.token_secret);
    const a = Buffer.from(received || '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } else if (parts.length === 3) {
    // v1.29.1 and earlier shared admin tokens map to the default admin account.
    // Their version is global, so security-sensitive user changes invalidate
    // every legacy shared token through invalidateLegacySharedToken().
    [expiresAt, version] = parts.slice(0, 2).map(Number);
    received = parts[2];
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
    userId = Number(adminRows[0]?.id);
  } else return null;
  const row = await userById(userId);
  if (parts.length === 4 && !isUserTokenVersionCurrent(row, version)) return null;
  if (!row || row.status !== 'active') return null;
  return actorFromUserRow(row);
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
