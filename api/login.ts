import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  authenticateUser,
  authSql,
  checkLoginLockout,
  extractBearer,
  getActor,
  isAdminRecoveryConfigured,
  isPasswordRequired,
  issueGuestToken,
  recoverSuperAdmin,
  repairSuperAdmin,
  writeAudit,
} from './_auth.js';
import { assertRows, isBoolean, isString, rowShape } from './_validation.js';
import { handleEmailAuth, loadSmtpConfig } from './_emailAuth.js';
import { opportunisticDrain } from './_emailQueue.js';
import { requestId, sendDatabaseError, sendRateLimited } from './_apiError.js';
import { consumeRateLimit } from './_rateLimiter.js';
import { applyCors } from './_cors.js';

const AUTH_FAILURE_DELAY_MS = 400;
const GUEST_LOGIN_WINDOW_MS = 60_000;
const GUEST_LOGIN_MAX_REQUESTS = 6;
const isGuestLoginDeviceRow = rowShape<{
  revoked: boolean;
  grade_id: string;
  class_id: string;
  is_management: boolean;
}>({ revoked: isBoolean, grade_id: isString, class_id: isString, is_management: isBoolean });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  requestId(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (!applyCors(req, res, { methods: ['GET', 'POST'] })) return;
  const emailAction = String(req.method === 'GET' ? (req.query?.action ?? '') : ((req.body ?? {}).action ?? ''));
  if (
    [
      'email-config',
      'email-config-full',
      'email-send-code',
      'email-login',
      'email-bind-request',
      'email-bind-confirm',
      'email-unbind',
      'email-save-config',
      'email-test-config',
      'email-clear-config',
    ].includes(emailAction)
  ) {
    return handleEmailAuth(req, res, emailAction);
  }
  try {
    if (req.method === 'GET') {
      const action = String(req.query?.action ?? 'status');
      if (action === 'me') {
        const actor = await getActor(extractBearer(req.headers.authorization));
        if (!actor) {
          res.status(401).json({ ok: false, code: 'AUTH_EXPIRED', error: '登录状态已失效，请重新登录' });
          return;
        }
        res.json({ ok: true, user: actor });
        return;
      }
      if (action === 'recovery-status') {
        res.json({ ok: true, configured: await isAdminRecoveryConfigured() });
        return;
      }
      await opportunisticDrain({ smtpLoader: loadSmtpConfig });
      res.json({ ok: true, required: await isPasswordRequired(), multiUser: true, defaultUsername: 'admin' });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }
    const { action, username, password, recoveryKey, newPassword } = req.body ?? {};
    if (action === 'recover-super-admin') {
      const result = await recoverSuperAdmin(
        String(username ?? ''),
        String(recoveryKey ?? ''),
        String(newPassword ?? ''),
      );
      if (!result.ok) {
        await new Promise((resolve) => setTimeout(resolve, AUTH_FAILURE_DELAY_MS));
        res
          .status(result.error?.includes('未配置') ? 503 : 401)
          .json({ ok: false, code: 'RECOVERY_FAILED', error: result.error });
        return;
      }
      res.json({ ok: true });
      return;
    }
    if (action === 'repair-super-admin') {
      const result = await repairSuperAdmin(
        String(username ?? ''),
        String(recoveryKey ?? ''),
        String(newPassword ?? ''),
      );
      if (!result.ok) {
        await new Promise((resolve) => setTimeout(resolve, AUTH_FAILURE_DELAY_MS));
        if (typeof result.retryAfterMs === 'number') {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
          res
            .status(429)
            .json({ ok: false, code: 'REPAIR_FAILED', error: result.error, retryAfterMs: result.retryAfterMs });
          return;
        }
        res
          .status(result.error?.includes('未配置') ? 503 : result.error?.includes('频繁') ? 429 : 401)
          .json({ ok: false, code: 'REPAIR_FAILED', error: result.error });
        return;
      }
      res.json({ ok: true, created: result.created === true });
      return;
    }
    const guestBody = (req.body ?? {}) as Record<string, unknown>;
    if (action === 'guest-login') {
      const instanceId = String(guestBody.instanceId ?? '').trim();
      const gradeId = String(guestBody.gradeId ?? '').trim();
      const classId = String(guestBody.classId ?? '').trim();
      if (!instanceId || !gradeId || !classId) {
        res.status(400).json({ ok: false, error: '缺少设备或班级信息' });
        return;
      }
      const guestLimit = consumeRateLimit(`guest-login:${instanceId}`, {
        windowMs: GUEST_LOGIN_WINDOW_MS,
        maxRequests: GUEST_LOGIN_MAX_REQUESTS,
      });
      if (!guestLimit.allowed) {
        sendRateLimited(req, res, Math.max(1, Math.ceil(guestLimit.retryAfterMs / 1000)));
        return;
      }
      const deviceRows = assertRows(
        await authSql()`SELECT revoked, grade_id, class_id, is_management FROM device_instances WHERE instance_id=${instanceId} LIMIT 1`,
        isGuestLoginDeviceRow,
        'device_instances',
      );
      const device = deviceRows[0];
      if (!device || device.revoked !== false || device.is_management === true) {
        res.status(403).json({ ok: false, error: '设备未绑定或不允许访客登录' });
        return;
      }
      if (String(device.grade_id) !== gradeId || String(device.class_id) !== classId) {
        res.status(403).json({ ok: false, error: '班级信息不匹配' });
        return;
      }
      const issued = await issueGuestToken(instanceId, gradeId, classId);
      if (!issued) {
        res.status(500).json({ ok: false, error: '访客令牌签发失败' });
        return;
      }
      const actor = await getActor(issued.token);
      const guestActor = actor ?? {
        id: 0,
        username: instanceId,
        displayName: '班级访客',
        roleId: 'viewer',
        roleName: '班级访客',
        permissions: [] as never[],
        scopes: [],
        mustChangePassword: false,
      };
      await writeAudit(guestActor, 'auth.guest.login', 'device', instanceId, {});
      res.json({ ok: true, token: issued.token, expiresAt: issued.expiresAt, user: actor, guest: true });
      return;
    }
    if (!(await isPasswordRequired())) {
      res.json({ ok: true, token: null });
      return;
    }
    const usernameInput = String(username ?? 'admin');
    const sendLockout = (retryAfterMs: number) => {
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        ok: false,
        code: 'LOGIN_LOCKED',
        error: `登录失败次数过多，请 ${retryAfterSeconds} 秒后再试`,
        retryAfterMs,
      });
    };
    const lockout = await checkLoginLockout(usernameInput);
    if (lockout.locked) {
      await new Promise((resolve) => setTimeout(resolve, AUTH_FAILURE_DELAY_MS));
      sendLockout(lockout.retryAfterMs);
      return;
    }
    const login = await authenticateUser(usernameInput, String(password ?? ''));
    if (!login) {
      const updatedLockout = await checkLoginLockout(usernameInput);
      await new Promise((resolve) => setTimeout(resolve, AUTH_FAILURE_DELAY_MS));
      if (updatedLockout.locked) {
        sendLockout(updatedLockout.retryAfterMs);
        return;
      }
      res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', error: '用户名或密码不正确' });
      return;
    }
    await writeAudit(login.actor, 'auth.login', 'user', String(login.actor.id));
    res.json({
      ok: true,
      token: login.token,
      expiresAt: login.expiresAt,
      user: login.actor,
      firstLogin: login.firstLogin,
    });
  } catch (error) {
    sendDatabaseError(req, res, error, req.method === 'GET' ? 'read' : 'write');
  }
}
