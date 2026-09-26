// 邮箱验证码登录：统一入口 handleEmailAuth，由 /api/login 按 action 分发。
//
// 本文件没有 default export，不是 HTTP 入口，只是被 /api/login 与 /api/system 复用的共享模块；
// 名字带下划线后 Vercel 不再把它算成一个 Serverless Function（Hobby 单次部署上限 12 个）。
// 复用：authSql/assertRows/rowShape、issueTokenForUser/getActor/writeAudit/validateEmailFormat、
//       evaluateLoginLockout（审计行驱动锁定）、consumeRateLimit（限频）、sendVerificationCode（Nodemailer）。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import {
  authSql,
  ensureAuthTables,
  evaluateLoginLockout,
  extractBearer,
  getActor,
  issueTokenForUser,
  requireActor,
  validateEmailFormat,
  writeAudit,
} from './_auth.js';
import {
  assertRows,
  rowShape,
  isString,
  isNumberLike,
  isBoolean,
  isDatabaseInt8,
  type DatabaseInt8,
} from './_validation.js';
import { consumeRateLimit } from './_rateLimiter.js';
import { sendVerificationCode, type SmtpConfig } from '../src/services/emailSender.js';
import { drainOutbox, enqueueEmailOutbox } from './_emailQueue.js';
import { requestId, sendDatabaseError } from './_apiError.js';

const AUTH_FAILURE_DELAY_MS = 400;
const CODE_TTL_MS = 5 * 60 * 1000;
const EMAIL_COOLDOWN_MS = 60 * 1000;
const IP_HOURLY_MAX = 5;
const IP_HOURLY_WINDOW_MS = 60 * 60 * 1000;
const LOCKOUT_MAX_FAILURES = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

type EmailConfigRow = {
  id: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_require_tls: boolean;
  smtp_user: string;
  smtp_pass_enc: string;
  smtp_from: string;
  smtp_from_name: string;
  admin_emails: string;
  init_bind_policy: string;
  updated_at: DatabaseInt8;
};
const isEmailConfigRow = rowShape<EmailConfigRow>({
  id: isNumberLike,
  smtp_host: isString,
  smtp_port: isNumberLike,
  smtp_secure: isBoolean,
  smtp_require_tls: isBoolean,
  smtp_user: isString,
  smtp_pass_enc: isString,
  smtp_from: isString,
  smtp_from_name: isString,
  admin_emails: isString,
  init_bind_policy: isString,
  updated_at: isDatabaseInt8,
});

type EmailCodeRow = { id: DatabaseInt8; code: string; expires_at: DatabaseInt8; used: boolean };
const isEmailCodeRow = rowShape<EmailCodeRow>({
  id: isDatabaseInt8,
  code: isString,
  expires_at: isDatabaseInt8,
  used: isBoolean,
});

type EmailUserRow = {
  id: DatabaseInt8;
  username: string;
  display_name: string;
  role_id: string;
  role_name: string;
  permissions: unknown;
  status: string;
  must_change_password: boolean;
  token_version: number;
  last_login_at: DatabaseInt8 | null;
};
const isEmailUserRow = rowShape<EmailUserRow>({
  id: isDatabaseInt8,
  username: isString,
  display_name: isString,
  role_id: isString,
  role_name: isString,
  permissions: (_value): _value is unknown => true,
  status: isString,
  must_change_password: isBoolean,
  token_version: isNumberLike,
  last_login_at: (value): value is DatabaseInt8 | null => value == null || isDatabaseInt8(value),
});
const isUserIdRow = rowShape<{ id: DatabaseInt8 }>({ id: isDatabaseInt8 });

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return String(raw ?? req.socket?.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 64);
}

function fail(
  res: VercelResponse,
  status: number,
  code: string,
  error: string,
  extra: Record<string, unknown> = {},
): void {
  res.status(status).json({ ok: false, code, error, ...extra });
}

async function secretKey(): Promise<Buffer> {
  await ensureAuthTables();
  const rows = assertRows(
    await authSql()`SELECT token_secret FROM app_auth WHERE id=1`,
    rowShape<{ token_secret: string }>({ token_secret: isString }),
    'app_auth',
  );
  return createHash('sha256')
    .update(rows[0]?.token_secret ?? 'email-fallback')
    .digest();
}

function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function decryptSecret(payload: string, key: Buffer): string {
  const [ivB, tagB, dataB] = payload.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
}

async function loadEmailConfigRow(): Promise<EmailConfigRow | null> {
  await ensureAuthTables();
  const rows = assertRows(
    await authSql()`SELECT id, smtp_host, smtp_port, smtp_secure, smtp_require_tls, smtp_user, smtp_pass_enc, smtp_from, smtp_from_name, admin_emails, init_bind_policy, updated_at FROM email_config WHERE id=1`,
    isEmailConfigRow,
    'email_config',
  );
  return rows[0] ?? null;
}

async function smtpConfigFromRow(row: EmailConfigRow): Promise<SmtpConfig | null> {
  if (!row.smtp_host || !row.smtp_from) return null;
  let pass = '';
  if (row.smtp_pass_enc) {
    try {
      pass = decryptSecret(row.smtp_pass_enc, await secretKey());
    } catch {
      pass = '';
    }
  }
  return {
    host: row.smtp_host,
    port: Number(row.smtp_port),
    secure: row.smtp_secure,
    requireTls: row.smtp_require_tls,
    user: row.smtp_user,
    pass,
    from: row.smtp_from,
    fromName: row.smtp_from_name || 'Novora考试系统',
  };
}

export async function loadSmtpConfig(): Promise<SmtpConfig | null> {
  const row = await loadEmailConfigRow();
  return row ? smtpConfigFromRow(row) : null;
}

async function emailLockout(email: string): Promise<{ locked: boolean; retryAfterMs: number }> {
  const rows = assertRows(
    await authSql()`SELECT action, created_at FROM app_audit_logs WHERE LOWER(username)=LOWER(${email}) AND action='auth.email.failed' ORDER BY created_at DESC LIMIT ${LOCKOUT_MAX_FAILURES}`,
    rowShape<{ action: string; created_at: DatabaseInt8 }>({ action: isString, created_at: isDatabaseInt8 }),
    'app_audit_logs',
  );
  return evaluateLoginLockout(rows, Date.now(), { maxFailures: LOCKOUT_MAX_FAILURES, windowMs: LOCKOUT_WINDOW_MS });
}

async function recordEmailFailure(email: string): Promise<void> {
  await authSql()`INSERT INTO app_audit_logs (user_id, username, action, resource_type, resource_id, grade_id, class_id, detail, created_at)
    VALUES (NULL, ${email}, 'auth.email.failed', 'user', '', '', '', NULL, ${Date.now()})`;
}

async function issueAndEnqueueCode(
  smtp: SmtpConfig,
  email: string,
  purpose: 'login' | 'bind',
  ip: string,
): Promise<{
  ok: boolean;
  status?: number;
  code?: string;
  error?: string;
  retryAfterMs?: number;
  outboxId?: DatabaseInt8;
}> {
  const emailLimit = consumeRateLimit(`email-${purpose}-code:${email.toLowerCase()}`, {
    windowMs: EMAIL_COOLDOWN_MS,
    maxRequests: 1,
  });
  if (!emailLimit.allowed)
    return {
      ok: false,
      status: 429,
      code: 'EMAIL_SEND_FREQUENT',
      error: '请等待60秒后再试',
      retryAfterMs: emailLimit.retryAfterMs,
    };
  const ipLimit = consumeRateLimit(`email-code-ip:${ip}`, {
    windowMs: IP_HOURLY_WINDOW_MS,
    maxRequests: IP_HOURLY_MAX,
  });
  if (!ipLimit.allowed)
    return {
      ok: false,
      status: 429,
      code: 'EMAIL_IP_LIMITED',
      error: '请求过于频繁，请稍后再试',
      retryAfterMs: ipLimit.retryAfterMs,
    };
  const code = String(randomInt(100000, 1000000)).padStart(6, '0');
  const now = Date.now();
  await authSql()`DELETE FROM email_verification_codes WHERE email=${email} AND purpose=${purpose} AND (used OR expires_at < ${now})`;
  const inserted = assertRows(
    await authSql()`INSERT INTO email_verification_codes (email, purpose, code, expires_at, used, created_at, ip)
      VALUES (${email}, ${purpose}, ${code}, ${now + CODE_TTL_MS}, FALSE, ${now}, ${ip}) RETURNING id`,
    isUserIdRow,
    'email_verification_codes',
  );
  const outboxId = await enqueueEmailOutbox(email, purpose, inserted[0].id);
  return { ok: true, outboxId };
}

async function verifyCode(
  email: string,
  purpose: 'login' | 'bind',
  code: string,
): Promise<{ ok: boolean; code?: string; error?: string }> {
  const rows = assertRows(
    await authSql()`SELECT id, code, expires_at, used FROM email_verification_codes WHERE email=${email} AND purpose=${purpose} ORDER BY id DESC LIMIT 1`,
    isEmailCodeRow,
    'email_verification_codes',
  );
  const row = rows[0];
  if (!row || row.used || Number(row.expires_at) < Date.now()) {
    return { ok: false, code: 'EMAIL_CODE_EXPIRED', error: '验证码已过期，请重新获取' };
  }
  if (row.code !== code) {
    return { ok: false, code: 'EMAIL_CODE_INVALID', error: '验证码错误，请重新输入' };
  }
  const consumed = assertRows(
    await authSql()`UPDATE email_verification_codes SET used=TRUE WHERE id=${row.id} AND used=FALSE RETURNING id`,
    isUserIdRow,
    'email_verification_codes',
  );
  if (!consumed.length) return { ok: false, code: 'EMAIL_CODE_USED', error: '验证码已使用，请重新获取' };
  return { ok: true };
}

async function handleSendCode(req: VercelRequest, res: VercelResponse): Promise<void> {
  const email = String((req.body ?? {}).email ?? '')
    .trim()
    .toLowerCase();
  if (!validateEmailFormat(email)) {
    fail(res, 400, 'EMAIL_FORMAT_INVALID', '邮箱格式无效');
    return;
  }
  const row = await loadEmailConfigRow();
  if (!row) {
    fail(res, 503, 'EMAIL_NOT_CONFIGURED', '邮件服务未配置');
    return;
  }
  const smtp = await smtpConfigFromRow(row);
  if (!smtp) {
    fail(res, 503, 'EMAIL_NOT_CONFIGURED', '邮件服务未配置');
    return;
  }
  const users = assertRows(
    await authSql()`SELECT id FROM app_users WHERE LOWER(email)=LOWER(${email}) AND status='active' LIMIT 1`,
    isUserIdRow,
    'app_users',
  );
  if (!users[0]) {
    await recordEmailFailure(email);
    await new Promise((r) => setTimeout(r, AUTH_FAILURE_DELAY_MS));
    fail(res, 403, 'EMAIL_NOT_BOUND', '该邮箱未绑定账号');
    return;
  }
  const whitelist = (row.admin_emails || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (whitelist.length && !whitelist.includes(email)) {
    fail(res, 403, 'EMAIL_NOT_ALLOWED', '该邮箱无权登录');
    return;
  }
  const queued = await issueAndEnqueueCode(smtp, email, 'login', clientIp(req));
  if (!queued.ok) {
    fail(
      res,
      queued.status ?? 500,
      queued.code ?? 'EMAIL_SEND_FAILED',
      queued.error ?? '发送失败',
      queued.retryAfterMs != null ? { retryAfterMs: queued.retryAfterMs } : {},
    );
    return;
  }
  if (queued.outboxId != null) {
    const first = await drainOutbox(smtp, {
      jobId: queued.outboxId,
      hardTimeoutMs: 8_000,
      slotWaitMs: 2_000,
      acquireSlot: true,
      deadlineMs: Date.now() + 9_000,
    });
    if (first.sent > 0) {
      await writeAudit(null, 'auth.email.code', 'user', String(users[0].id), { email });
      res.json({ ok: true, message: '验证码已发送到您的邮箱，5 分钟内有效' });
      return;
    }
  }
  await writeAudit(null, 'auth.email.code.queued', 'user', String(users[0].id), { email });
  res.json({ ok: true, queued: true, message: '验证码已加入发送队列，系统将自动重试，请留意查收（5 分钟内有效）' });
}

async function handleEmailLogin(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  const code = String(body.code ?? '').trim();
  if (!validateEmailFormat(email)) {
    fail(res, 400, 'EMAIL_FORMAT_INVALID', '邮箱格式无效');
    return;
  }
  const users = assertRows(
    await authSql()`SELECT u.id, u.username, u.display_name, u.role_id, r.name AS role_name, r.permissions, u.status, u.must_change_password, u.token_version, u.last_login_at
      FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE LOWER(u.email)=LOWER(${email}) LIMIT 1`,
    isEmailUserRow,
    'app_users/app_roles',
  );
  const user = users[0];
  if (!user) {
    await recordEmailFailure(email);
    await new Promise((r) => setTimeout(r, AUTH_FAILURE_DELAY_MS));
    fail(res, 403, 'EMAIL_NOT_BOUND', '该邮箱未绑定账号');
    return;
  }
  if (user.status !== 'active') {
    fail(res, 403, 'ACCOUNT_DISABLED', '账号已停用');
    return;
  }
  const lock = await emailLockout(email);
  if (lock.locked) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(lock.retryAfterMs / 1000))));
    fail(res, 429, 'EMAIL_CODE_LOCKED', '验证失败次数过多，请稍后重试', { retryAfterMs: lock.retryAfterMs });
    return;
  }
  const verify = await verifyCode(email, 'login', code);
  if (!verify.ok) {
    await recordEmailFailure(email);
    const lock2 = await emailLockout(email);
    await new Promise((r) => setTimeout(r, AUTH_FAILURE_DELAY_MS));
    if (lock2.locked) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(lock2.retryAfterMs / 1000))));
      fail(res, 429, 'EMAIL_CODE_LOCKED', '验证失败次数过多，请稍后重试', { retryAfterMs: lock2.retryAfterMs });
      return;
    }
    fail(res, 401, verify.code ?? 'EMAIL_CODE_INVALID', verify.error ?? '验证码无效');
    return;
  }
  await authSql()`DELETE FROM app_audit_logs WHERE LOWER(username)=LOWER(${email}) AND action='auth.email.failed'`;
  const issued = await issueTokenForUser(user);
  if (!issued) {
    fail(res, 500, 'TOKEN_ISSUE_FAILED', '登录令牌签发失败');
    return;
  }
  await authSql()`UPDATE app_users SET last_login_at=${Date.now()} WHERE id=${user.id}`;
  const actor = await getActor(issued.token);
  await writeAudit(actor, 'auth.email.login', 'user', String(user.id), { email });
  res.json({
    ok: true,
    token: issued.token,
    expiresAt: issued.expiresAt,
    user: actor,
    firstLogin: user.last_login_at == null,
  });
}

async function handleBindRequest(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, undefined, true);
  if (!actor) return;
  const email = String((req.body ?? {}).email ?? '')
    .trim()
    .toLowerCase();
  if (!validateEmailFormat(email)) {
    fail(res, 400, 'EMAIL_FORMAT_INVALID', '邮箱格式无效');
    return;
  }
  const row = await loadEmailConfigRow();
  if (!row) {
    fail(res, 503, 'EMAIL_NOT_CONFIGURED', '邮件服务未配置');
    return;
  }
  const smtp = await smtpConfigFromRow(row);
  if (!smtp) {
    fail(res, 503, 'EMAIL_NOT_CONFIGURED', '邮件服务未配置');
    return;
  }
  const taken = assertRows(
    await authSql()`SELECT id FROM app_users WHERE LOWER(email)=LOWER(${email}) AND id <> ${actor.id} LIMIT 1`,
    isUserIdRow,
    'app_users',
  );
  if (taken[0]) {
    fail(res, 409, 'EMAIL_TAKEN', '该邮箱已被其他账号绑定');
    return;
  }
  const queued = await issueAndEnqueueCode(smtp, email, 'bind', clientIp(req));
  if (!queued.ok) {
    fail(
      res,
      queued.status ?? 500,
      queued.code ?? 'EMAIL_SEND_FAILED',
      queued.error ?? '发送失败',
      queued.retryAfterMs != null ? { retryAfterMs: queued.retryAfterMs } : {},
    );
    return;
  }
  if (queued.outboxId != null) {
    const first = await drainOutbox(smtp, {
      jobId: queued.outboxId,
      hardTimeoutMs: 8_000,
      slotWaitMs: 2_000,
      acquireSlot: true,
      deadlineMs: Date.now() + 9_000,
    });
    if (first.sent > 0) {
      await writeAudit(actor, 'auth.email.bind.request', 'user', String(actor.id), { email });
      res.json({ ok: true, message: '验证码已发送到您的邮箱，5 分钟内有效' });
      return;
    }
  }
  await writeAudit(actor, 'auth.email.bind.request.queued', 'user', String(actor.id), { email });
  res.json({ ok: true, queued: true, message: '验证码已加入发送队列，系统将自动重试，请留意查收（5 分钟内有效）' });
}

async function handleBindConfirm(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, undefined, true);
  if (!actor) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  const code = String(body.code ?? '').trim();
  if (!validateEmailFormat(email)) {
    fail(res, 400, 'EMAIL_FORMAT_INVALID', '邮箱格式无效');
    return;
  }
  const taken = assertRows(
    await authSql()`SELECT id FROM app_users WHERE LOWER(email)=LOWER(${email}) AND id <> ${actor.id} LIMIT 1`,
    isUserIdRow,
    'app_users',
  );
  if (taken[0]) {
    fail(res, 409, 'EMAIL_TAKEN', '该邮箱已被其他账号绑定');
    return;
  }
  const verify = await verifyCode(email, 'bind', code);
  if (!verify.ok) {
    fail(res, 401, verify.code ?? 'EMAIL_CODE_INVALID', verify.error ?? '验证码无效');
    return;
  }
  await authSql()`UPDATE app_users SET email=${email}, email_bound_at=${Date.now()} WHERE id=${actor.id}`;
  await writeAudit(actor, 'auth.email.bind.confirm', 'user', String(actor.id), { email });
  res.json({ ok: true });
}

async function handleUnbind(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res);
  if (!actor) return;
  await authSql()`UPDATE app_users SET email=NULL, email_bound_at=NULL WHERE id=${actor.id}`;
  await writeAudit(actor, 'auth.email.unbind', 'user', String(actor.id));
  res.json({ ok: true });
}

function smtpConfigFromBody(body: Record<string, unknown>, _existingPassEnc: string): SmtpConfig | null {
  const host = String(body.smtpHost ?? '').trim();
  const from = String(body.smtpFrom ?? '').trim();
  const port = Number(body.smtpPort ?? 465);
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    host,
    port,
    secure: body.smtpSecure !== false,
    requireTls: body.smtpRequireTls === true,
    user: String(body.smtpUser ?? '').trim(),
    pass: String(body.smtpPass ?? ''),
    from,
    fromName: String(body.smtpFromName ?? '').trim() || 'Novora考试系统',
  };
}

async function handleSaveConfig(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'settings.edit');
  if (!actor) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const smtp = smtpConfigFromBody(body, '');
  if (!smtp) {
    fail(res, 400, 'EMAIL_CONFIG_INCOMPLETE', '请填写 SMTP 主机与发件地址');
    return;
  }
  const existing = await loadEmailConfigRow();
  let passEnc = existing?.smtp_pass_enc ?? '';
  if (smtp.pass) passEnc = encryptSecret(smtp.pass, await secretKey());
  const initBindPolicy = normalizeInitBindPolicy(body.initBindPolicy);
  const adminEmails = String(body.adminEmails ?? '')
    .split(/[，,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
  await authSql()`INSERT INTO email_config (id, smtp_host, smtp_port, smtp_secure, smtp_require_tls, smtp_user, smtp_pass_enc, smtp_from, smtp_from_name, admin_emails, init_bind_policy, updated_at)
    VALUES (1, ${smtp.host}, ${smtp.port}, ${smtp.secure}, ${smtp.requireTls}, ${smtp.user}, ${passEnc}, ${smtp.from}, ${smtp.fromName}, ${adminEmails}, ${initBindPolicy}, ${Date.now()})
    ON CONFLICT (id) DO UPDATE SET smtp_host=EXCLUDED.smtp_host, smtp_port=EXCLUDED.smtp_port, smtp_secure=EXCLUDED.smtp_secure,
      smtp_require_tls=EXCLUDED.smtp_require_tls, smtp_user=EXCLUDED.smtp_user, smtp_pass_enc=EXCLUDED.smtp_pass_enc,
      smtp_from=EXCLUDED.smtp_from, smtp_from_name=EXCLUDED.smtp_from_name, admin_emails=EXCLUDED.admin_emails, init_bind_policy=EXCLUDED.init_bind_policy, updated_at=EXCLUDED.updated_at`;
  await writeAudit(actor, 'email.config.save', 'settings', '', { host: smtp.host, from: smtp.from, initBindPolicy });
  res.json({ ok: true, enabled: true, initBindPolicy });
}

async function handleTestConfig(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'settings.edit');
  if (!actor) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const to = String(body.testEmail ?? '')
    .trim()
    .toLowerCase();
  if (!validateEmailFormat(to)) {
    fail(res, 400, 'EMAIL_FORMAT_INVALID', '测试邮箱格式无效');
    return;
  }
  const existing = await loadEmailConfigRow();
  const smtp = smtpConfigFromBody(body, existing?.smtp_pass_enc ?? '');
  if (!smtp) {
    fail(res, 400, 'EMAIL_CONFIG_INCOMPLETE', '请填写 SMTP 主机与发件地址');
    return;
  }
  const existingEnc = existing?.smtp_pass_enc ?? '';
  if (!smtp.pass && existingEnc) {
    try {
      smtp.pass = decryptSecret(existingEnc, await secretKey());
    } catch {
      smtp.pass = '';
    }
  }
  try {
    await sendVerificationCode(smtp, { to, code: '123456', purpose: 'login' });
    res.json({ ok: true, message: '测试邮件已发送' });
  } catch (error) {
    console.error('[email-test]', error);
    fail(res, 500, 'EMAIL_SEND_FAILED', '测试邮件发送失败，请检查配置');
  }
}

async function handleConfigFull(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'settings.read');
  if (!actor) return;
  const row = await loadEmailConfigRow();
  res.json({
    ok: true,
    enabled: !!(row && row.smtp_host && row.smtp_from),
    initBindPolicy: row?.init_bind_policy || 'optional',
    smtpHost: row?.smtp_host ?? '',
    smtpPort: Number(row?.smtp_port ?? 465),
    smtpSecure: row?.smtp_secure ?? true,
    smtpRequireTls: row?.smtp_require_tls ?? false,
    smtpUser: row?.smtp_user ?? '',
    smtpFrom: row?.smtp_from ?? '',
    smtpFromName: row?.smtp_from_name ?? '',
    adminEmails: row?.admin_emails ?? '',
    hasPass: !!(row?.smtp_pass_enc ?? ''),
  });
}

async function handleClearConfig(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'settings.edit');
  if (!actor) return;
  await authSql()`UPDATE email_config SET smtp_host='', smtp_port=465, smtp_secure=TRUE, smtp_require_tls=FALSE, smtp_user='', smtp_pass_enc='', smtp_from='', smtp_from_name='', admin_emails='', updated_at=${Date.now()} WHERE id=1`;
  await writeAudit(actor, 'email.config.clear', 'settings', '');
  res.json({ ok: true, enabled: false });
}

async function handleSendStatus(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (!validateEmailFormat(email)) {
    fail(res, 400, 'EMAIL_FORMAT_INVALID', '邮箱格式无效');
    return;
  }
  const codeRows = assertRows(
    await authSql()`SELECT id, used FROM email_verification_codes WHERE email=${email} AND purpose='login' ORDER BY id DESC LIMIT 1`,
    rowShape<{ id: DatabaseInt8; used: boolean }>({
      id: isDatabaseInt8,
      used: (v): v is boolean => typeof v === 'boolean',
    }),
    'email_verification_codes',
  );
  const code = codeRows[0];
  if (!code) {
    res.json({ ok: true, status: 'none' });
    return;
  }
  const outboxRows = assertRows(
    await authSql()`SELECT status, last_error FROM email_outbox WHERE code_id=${code.id} ORDER BY id DESC LIMIT 1`,
    rowShape<{ status: string; last_error: string }>({ status: isString, last_error: isString }),
    'email_outbox',
  );
  const outbox = outboxRows[0];
  let status: 'sent' | 'failed' | 'pending';
  if (code.used) status = 'sent';
  else if (outbox && outbox.status === 'sent') status = 'sent';
  else if (outbox && outbox.status === 'failed') status = 'failed';
  else status = 'pending';
  res.json({ ok: true, status, lastError: outbox?.last_error || null });
}

export function normalizeInitBindPolicy(value: unknown): 'optional' | 'force' | 'skip' {
  return value === 'force' || value === 'skip' ? value : 'optional';
}

export async function handleEmailAuth(req: VercelRequest, res: VercelResponse, action: string): Promise<void> {
  requestId(req, res);
  try {
    if (action === 'email-config' || action === 'email-config-full') {
      if (action === 'email-config-full') return handleConfigFull(req, res);
      if (action === 'email-config') {
        const row = await loadEmailConfigRow();
        let ownEmail: string | null = null;
        try {
          const actor = await getActor(extractBearer(req.headers.authorization));
          if (actor) {
            const rows = assertRows(
              await authSql()`SELECT email FROM app_users WHERE id=${actor.id} LIMIT 1`,
              rowShape<{ email: string | null }>({
                email: (value): value is string | null => value == null || isString(value),
              }),
              'app_users',
            );
            ownEmail = rows[0]?.email ?? null;
          }
        } catch {
          /* 未登录或令牌失效时不返回邮箱 */
        }
        res.json({
          ok: true,
          enabled: !!(row && row.smtp_host && row.smtp_from),
          initBindPolicy: row?.init_bind_policy || 'optional',
          email: ownEmail,
        });
        return;
      }
    }
    if (req.method !== 'POST') {
      fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      return;
    }
    switch (action) {
      case 'email-send-code':
        return handleSendCode(req, res);
      case 'email-send-status':
        return handleSendStatus(req, res);
      case 'email-login':
        return handleEmailLogin(req, res);
      case 'email-bind-request':
        return handleBindRequest(req, res);
      case 'email-bind-confirm':
        return handleBindConfirm(req, res);
      case 'email-unbind':
        return handleUnbind(req, res);
      case 'email-save-config':
        return handleSaveConfig(req, res);
      case 'email-test-config':
        return handleTestConfig(req, res);
      case 'email-clear-config':
        return handleClearConfig(req, res);
      default:
        fail(res, 400, 'UNKNOWN_ACTION', '未知操作');
    }
  } catch (error) {
    sendDatabaseError(req, res, error, 'write');
  }
}
