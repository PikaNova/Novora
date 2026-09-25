// api/_auth/recovery.ts
// 恢复密钥、超级管理员抢修，以及「新库自动建出默认超级管理员」的引导流程。
// 这是运维入口，与日常登录/鉴权分离：改动只影响恢复路径。
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { assertRows } from '../_validation.js';
import { writeAudit } from './audit.js';
import { authSql, config, ensureAuthTables, invalidateAuthConfigCache, invalidateLegacySharedToken } from './db.js';
import {
  BOOTSTRAP_PASSWORD,
  LEGACY_ADMIN_RECOVERY_KEY,
  REPAIR_RATE_LIMIT_MAX_ATTEMPTS,
  REPAIR_RATE_LIMIT_WINDOW_MS,
} from './env.js';
import { makePasswordHash, matches } from './passwords.js';
import {
  isAuthIdRow,
  isCountOldestRow,
  isCountRow,
  isIdUsernameRow,
  isRecoveryHashRow,
  isRecoveryHashSaltRow,
  isUserIdRow,
  type AuthRow,
} from './shapes.js';

export async function isAdminRecoveryConfigured(): Promise<boolean> {
  await ensureAuthTables();
  const rows = assertRows(
    await authSql()`SELECT recovery_key_hash FROM app_auth WHERE id=1`,
    isRecoveryHashRow,
    'app_auth',
  );
  return !!rows[0]?.recovery_key_hash || LEGACY_ADMIN_RECOVERY_KEY.length >= 16;
}

async function recoveryKeyMatches(recoveryKey: string): Promise<boolean> {
  const recoveryRows = assertRows(
    await authSql()`SELECT recovery_key_hash, recovery_key_salt FROM app_auth WHERE id=1`,
    isRecoveryHashSaltRow,
    'app_auth',
  );
  const stored = recoveryRows[0];
  if (stored?.recovery_key_hash && stored.recovery_key_salt) {
    return matches(recoveryKey, stored.recovery_key_hash, stored.recovery_key_salt);
  }
  if (LEGACY_ADMIN_RECOVERY_KEY.length >= 16) {
    const supplied = Buffer.from(recoveryKey);
    const expected = Buffer.from(LEGACY_ADMIN_RECOVERY_KEY);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  return false;
}

export async function recoverSuperAdmin(
  username: string,
  recoveryKey: string,
  nextPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminRecoveryConfigured())) return { ok: false, error: '当前项目尚未生成超级管理员恢复密钥' };
  if (nextPassword.length < 8) return { ok: false, error: '新密码至少需要 8 位' };
  await ensureAuthTables();
  const keyMatches = await recoveryKeyMatches(recoveryKey);
  const rows = assertRows(
    await authSql()`SELECT id, username FROM app_users
    WHERE LOWER(username)=LOWER(${username.trim().slice(0, 80)}) AND role_id='super_admin' AND status='active' LIMIT 1`,
    isIdUsernameRow,
    'app_users',
  );
  if (!keyMatches || !rows[0]) return { ok: false, error: '恢复信息不正确' };
  const password = await makePasswordHash(nextPassword);
  await invalidateLegacySharedToken();
  await authSql()`UPDATE app_users SET password_hash=${password.hash}, password_salt=${password.salt},
    must_change_password=TRUE, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${rows[0].id}`;
  await writeAudit(null, 'user.password.recover', 'user', String(rows[0].id), { username: rows[0].username });
  return { ok: true };
}

export async function repairSuperAdmin(
  username: string,
  recoveryKey: string,
  nextPassword: string,
): Promise<{ ok: boolean; error?: string; created?: boolean; retryAfterMs?: number }> {
  if (!(await isAdminRecoveryConfigured())) return { ok: false, error: '当前项目尚未生成超级管理员恢复密钥' };
  if (nextPassword.length < 8) return { ok: false, error: '新密码至少需要 8 位' };
  const name = username.trim().slice(0, 80);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(name))
    return { ok: false, error: '用户名需为 3-40 位字母、数字、点、横线或下划线' };
  await ensureAuthTables();

  const sql = authSql();
  const now = Date.now();
  const since = now - REPAIR_RATE_LIMIT_WINDOW_MS;
  const recentFailures = assertRows(
    await sql`SELECT COUNT(*)::int AS count, COALESCE(MIN(created_at), 0) AS oldest FROM app_audit_logs
    WHERE action='user.super_admin.repair.failed' AND created_at > ${since}`,
    isCountOldestRow,
    'app_audit_logs',
  );
  if (Number(recentFailures[0]?.count) >= REPAIR_RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfterMs = Math.max(1_000, Number(recentFailures[0]?.oldest ?? 0) + REPAIR_RATE_LIMIT_WINDOW_MS - now);
    return { ok: false, error: `恢复尝试过于频繁，请 ${Math.ceil(retryAfterMs / 1000)} 秒后再试`, retryAfterMs };
  }

  const keyMatches = await recoveryKeyMatches(recoveryKey);
  if (!keyMatches) {
    await writeAudit(null, 'user.super_admin.repair.failed', 'user', '', { username: name });
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { ok: false, error: '恢复信息不正确' };
  }

  const password = await makePasswordHash(nextPassword);
  const existing = assertRows(
    await sql`SELECT id FROM app_users WHERE LOWER(username)=LOWER(${name}) LIMIT 1`,
    isUserIdRow,
    'app_users',
  );
  let userId: number;
  let created = false;
  if (existing[0]) {
    userId = Number(existing[0].id);
    await invalidateLegacySharedToken();
    await sql`UPDATE app_users SET role_id='super_admin', status='active', password_hash=${password.hash}, password_salt=${password.salt},
      must_change_password=TRUE, token_version=token_version+1, updated_at=${now} WHERE id=${userId}`;
  } else {
    const insertedRows = assertRows(
      await sql`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
      VALUES (${name}, '超级管理员', ${password.hash}, ${password.salt}, 'super_admin', 'active', TRUE, 1, ${now}, ${now}) RETURNING id`,
      isUserIdRow,
      'app_users',
    );
    userId = Number(insertedRows[0].id);
    created = true;
  }
  await sql`DELETE FROM app_user_scopes WHERE user_id=${userId}`;
  await sql`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id) VALUES (${userId}, 'all', '', '') ON CONFLICT DO NOTHING`;
  await writeAudit(null, 'user.super_admin.repair', 'user', String(userId), { username: name, created });
  return { ok: true, created };
}

/** 首次学校初始化时生成一次；数据库只保存加盐哈希，明文只返回给当前超级管理员。 */
export async function ensureGeneratedRecoveryKey(): Promise<string | null> {
  await ensureAuthTables();
  const rows = assertRows(
    await authSql()`SELECT recovery_key_hash FROM app_auth WHERE id=1`,
    isRecoveryHashRow,
    'app_auth',
  );
  if (rows[0]?.recovery_key_hash || LEGACY_ADMIN_RECOVERY_KEY.length >= 16) return null;
  const recoveryKey = `NVR-${randomBytes(24).toString('base64url')}`;
  const encoded = await makePasswordHash(recoveryKey);
  const updated = assertRows(
    await authSql()`UPDATE app_auth SET recovery_key_hash=${encoded.hash}, recovery_key_salt=${encoded.salt}, updated_at=${Date.now()}
    WHERE id=1 AND recovery_key_hash IS NULL RETURNING id`,
    isAuthIdRow,
    'app_auth',
  );
  return updated[0] ? recoveryKey : null;
}

async function bootstrapAuth(password: string): Promise<AuthRow | null> {
  if (!BOOTSTRAP_PASSWORD) return null;
  const supplied = Buffer.from(password);
  const expected = Buffer.from(BOOTSTRAP_PASSWORD);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  await ensureAuthTables();
  const existing = await config();
  if (existing) return existing;
  const { hash, salt } = await makePasswordHash(password);
  const tokenSecret = randomBytes(32).toString('base64url');
  const at = Date.now();
  await authSql()`INSERT INTO app_auth (id, password_hash, password_salt, token_secret, token_version, initialized_at, updated_at)
    VALUES (1, ${hash}, ${salt}, ${tokenSecret}, 1, ${at}, ${at}) ON CONFLICT (id) DO NOTHING`;
  invalidateAuthConfigCache();
  return await config();
}

export async function ensureDefaultSuperAdmin(password: string): Promise<void> {
  await ensureAuthTables();
  const users = assertRows(await authSql()`SELECT COUNT(*)::int AS count FROM app_users`, isCountRow, 'app_users');
  if (Number(users[0]?.count) > 0) return;
  // 库里已经没有任何用户（新库或被清空）时，模块级缓存可能还指向已被删除的 app_auth 行。
  // 不失效就会用「幽灵配置」建出管理员，但随后取 token_secret 时又读到 null，
  // 表现为密码正确却登录失败（真实库集成用例会在清库后稳定复现）。
  invalidateAuthConfigCache();
  let auth = await config();
  if (!auth) auth = await bootstrapAuth(password);
  if (!auth || !(await matches(password, auth.password_hash, auth.password_salt))) return;
  const at = Date.now();
  await authSql()`INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
    VALUES ('admin', '超级管理员', ${auth.password_hash}, ${auth.password_salt}, 'super_admin', 'active', FALSE, 1, ${at}, ${at})
    ON CONFLICT DO NOTHING`;
  const rows = assertRows(
    await authSql()`SELECT id FROM app_users WHERE LOWER(username)='admin' LIMIT 1`,
    isUserIdRow,
    'app_users',
  );
  if (rows[0])
    await authSql()`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id) VALUES (${rows[0].id}, 'all', '', '') ON CONFLICT DO NOTHING`;
}
