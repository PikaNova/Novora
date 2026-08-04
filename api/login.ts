import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, checkLoginLockout, extractBearer, getActor, isAdminRecoveryConfigured, isPasswordRequired, recoverSuperAdmin, repairSuperAdmin, writeAudit } from './_auth.js';
import { requestId, sendDatabaseError } from './_apiError.js';
import { applyCors } from './_cors.js';

const AUTH_FAILURE_DELAY_MS = 400;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  requestId(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (!applyCors(req, res, { methods: ['GET', 'POST'] })) return;
  try {
    if (req.method === 'GET') {
      const action = String(req.query?.action ?? 'status');
      if (action === 'me') {
        const actor = await getActor(extractBearer(req.headers.authorization));
        if (!actor) { res.status(401).json({ ok: false, code: 'AUTH_EXPIRED', error: '登录状态已失效，请重新登录' }); return; }
        res.json({ ok: true, user: actor }); return;
      }
      if (action === 'recovery-status') { res.json({ ok: true, configured: await isAdminRecoveryConfigured() }); return; }
      res.json({ ok: true, required: await isPasswordRequired(), multiUser: true, defaultUsername: 'admin' }); return;
    }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }
    const { action, username, password, recoveryKey, newPassword } = req.body ?? {};
    if (action === 'recover-super-admin') {
      const result = await recoverSuperAdmin(String(username ?? ''), String(recoveryKey ?? ''), String(newPassword ?? ''));
      if (!result.ok) {
        await new Promise(resolve => setTimeout(resolve, AUTH_FAILURE_DELAY_MS));
        res.status(result.error?.includes('未配置') ? 503 : 401).json({ ok: false, code: 'RECOVERY_FAILED', error: result.error }); return;
      }
      res.json({ ok: true }); return;
    }
    if (action === 'repair-super-admin') {
      const result = await repairSuperAdmin(String(username ?? ''), String(recoveryKey ?? ''), String(newPassword ?? ''));
      if (!result.ok) {
        await new Promise(resolve => setTimeout(resolve, AUTH_FAILURE_DELAY_MS));
        if (typeof result.retryAfterMs === 'number') {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
          res.status(429).json({ ok: false, code: 'REPAIR_FAILED', error: result.error, retryAfterMs: result.retryAfterMs }); return;
        }
        res.status(result.error?.includes('未配置') ? 503 : result.error?.includes('频繁') ? 429 : 401).json({ ok: false, code: 'REPAIR_FAILED', error: result.error }); return;
      }
      res.json({ ok: true, created: result.created === true }); return;
    }
    if (!await isPasswordRequired()) { res.json({ ok: true, token: null }); return; }
    const usernameInput = String(username ?? 'admin');
    const sendLockout = (retryAfterMs: number) => {
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ ok: false, code: 'LOGIN_LOCKED', error: `登录失败次数过多，请 ${retryAfterSeconds} 秒后再试`, retryAfterMs });
    };
    const lockout = await checkLoginLockout(usernameInput);
    if (lockout.locked) {
      await new Promise(resolve => setTimeout(resolve, AUTH_FAILURE_DELAY_MS));
      sendLockout(lockout.retryAfterMs);
      return;
    }
    const login = await authenticateUser(usernameInput, String(password ?? ''));
    if (!login) {
      const updatedLockout = await checkLoginLockout(usernameInput);
      await new Promise(resolve => setTimeout(resolve, AUTH_FAILURE_DELAY_MS));
      if (updatedLockout.locked) { sendLockout(updatedLockout.retryAfterMs); return; }
      res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', error: '用户名或密码不正确' }); return;
    }
    await writeAudit(login.actor, 'auth.login', 'user', String(login.actor.id));
    res.json({ ok: true, token: login.token, expiresAt: login.expiresAt, user: login.actor, firstLogin: login.firstLogin });
  } catch (error) {
    sendDatabaseError(req, res, error, req.method === 'GET' ? 'read' : 'write');
  }
}
