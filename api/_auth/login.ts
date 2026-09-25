// api/_auth/login.ts
// 口令登录、失败次数锁定与失败告警。风控策略数值在 ./env.ts。
import { assertRows } from '../_validation.js';
import { authSql, ensureAuthTables } from './db.js';
import { LOGIN_ALERT_MIN_FAILURES, LOGIN_LOCKOUT_MAX_FAILURES, LOGIN_LOCKOUT_WINDOW_MS } from './env.js';
import { actorFromUserRow } from './identities.js';
import { matches } from './passwords.js';
import { ensureDefaultSuperAdmin } from './recovery.js';
import type { LoginFailureAlert } from '../../src/shared/authContracts.js';
import {
  isLoginAttemptRow,
  isLoginAttemptWithUsernameRow,
  isUserRow,
  type AdminActor,
  type LoginAttemptRow,
} from './shapes.js';
import { issueTokenForUser } from './tokens.js';

export type { LoginAttemptRow };
export type { LoginFailureAlert };

export function evaluateLoginLockout(
  recentAttemptsDesc: LoginAttemptRow[],
  now: number,
  options: { maxFailures?: number; windowMs?: number } = {},
): { locked: boolean; retryAfterMs: number } {
  const maxFailures = options.maxFailures ?? LOGIN_LOCKOUT_MAX_FAILURES;
  const windowMs = options.windowMs ?? LOGIN_LOCKOUT_WINDOW_MS;
  if (recentAttemptsDesc.length < maxFailures) return { locked: false, retryAfterMs: 0 };
  const window = recentAttemptsDesc.slice(0, maxFailures);
  if (window.some((attempt) => attempt.action === 'auth.login')) return { locked: false, retryAfterMs: 0 };
  const oldest = window[maxFailures - 1];
  const unlockAt = Number(oldest.created_at) + windowMs;
  if (now >= unlockAt) return { locked: false, retryAfterMs: 0 };
  return { locked: true, retryAfterMs: unlockAt - now };
}

export async function checkLoginLockout(username: string): Promise<{ locked: boolean; retryAfterMs: number }> {
  await ensureAuthTables();
  const name = (username.trim() || 'admin').slice(0, 80);
  const rows = assertRows(
    await authSql()`SELECT action, created_at FROM app_audit_logs
    WHERE LOWER(username)=LOWER(${name}) AND action IN ('auth.login','auth.login.failed')
    ORDER BY created_at DESC LIMIT ${LOGIN_LOCKOUT_MAX_FAILURES}`,
    isLoginAttemptRow,
    'app_audit_logs',
  );
  return evaluateLoginLockout(rows, Date.now());
}

export function evaluateLoginFailureAlerts(
  recentAttemptsDesc: Array<LoginAttemptRow & { username: string }>,
  now: number,
  options: { minFailures?: number; windowMs?: number } = {},
): LoginFailureAlert[] {
  const minFailures = options.minFailures ?? LOGIN_ALERT_MIN_FAILURES;
  const windowMs = options.windowMs ?? LOGIN_LOCKOUT_WINDOW_MS;
  const byUsername = new Map<string, Array<LoginAttemptRow & { username: string }>>();
  for (const row of recentAttemptsDesc) {
    const key = row.username.toLowerCase();
    const bucket = byUsername.get(key);
    if (bucket) bucket.push(row);
    else byUsername.set(key, [row]);
  }
  const alerts: LoginFailureAlert[] = [];
  for (const rows of byUsername.values()) {
    const successIndex = rows.findIndex((row) => row.action === 'auth.login');
    const failures = rows
      .slice(0, successIndex === -1 ? rows.length : successIndex)
      .filter((row) => row.action === 'auth.login.failed' && now - Number(row.created_at) <= windowMs);
    if (failures.length < minFailures) continue;
    const newest = failures[0];
    const oldest = failures[failures.length - 1];
    alerts.push({
      username: rows[0].username,
      failureCount: failures.length,
      windowStart: Number(oldest.created_at),
      latestFailureAt: Number(newest.created_at),
    });
  }
  return alerts.sort((a, b) => b.latestFailureAt - a.latestFailureAt);
}

export async function getRecentLoginFailureAlerts(): Promise<LoginFailureAlert[]> {
  await ensureAuthTables();
  const rows = assertRows(
    await authSql()`SELECT username, action, created_at FROM app_audit_logs
    WHERE action IN ('auth.login', 'auth.login.failed') ORDER BY created_at DESC LIMIT 500`,
    isLoginAttemptWithUsernameRow,
    'app_audit_logs',
  );
  return evaluateLoginFailureAlerts(rows, Date.now());
}

async function recordFailedLoginAttempt(username: string): Promise<void> {
  try {
    await ensureAuthTables();
    await authSql()`INSERT INTO app_audit_logs (user_id, username, action, resource_type, resource_id, grade_id, class_id, detail, created_at)
      VALUES (NULL, ${username}, 'auth.login.failed', 'user', '', '', '', NULL, ${Date.now()})`;
  } catch {
    // Audit availability must not obscure the ordinary invalid-credentials response.
  }
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<{ actor: AdminActor; token: string; expiresAt: number; firstLogin: boolean } | null> {
  await ensureDefaultSuperAdmin(password);
  const name = (username.trim() || 'admin').slice(0, 80);
  const rows = assertRows(
    await authSql()`SELECT u.id, u.username, u.display_name, u.password_hash, u.password_salt, u.role_id,
      r.name AS role_name, r.permissions, u.status, u.must_change_password, u.token_version, u.email, u.last_login_at
    FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE LOWER(u.username)=LOWER(${name}) LIMIT 1`,
    isUserRow,
    'app_users/app_roles',
  );
  const row = rows[0];
  if (!row || row.status !== 'active' || !(await matches(password, row.password_hash, row.password_salt))) {
    await recordFailedLoginAttempt(name);
    return null;
  }
  const issued = await issueTokenForUser(row);
  if (!issued) return null;
  const firstLogin = row.last_login_at == null;
  await authSql()`UPDATE app_users SET last_login_at=${Date.now()} WHERE id=${row.id}`;
  return { actor: await actorFromUserRow(row), token: issued.token, expiresAt: issued.expiresAt, firstLogin };
}
