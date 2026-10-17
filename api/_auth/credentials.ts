// api/_auth/credentials.ts
// 账号自助维护：改自己的密码 / 用户名，以及首次登录的强制改密规则。
// 管理员改动他人账号不走这里，仍在 api/users.ts。
import { assertRows, isString, rowShape } from '../_validation.js';
import { authSql, ensureAuthTables, invalidateLegacySharedToken } from './db.js';
import { userById } from './identities.js';
import { makePasswordHash, matches } from './passwords.js';

export async function changeOwnPassword(
  actorId: number,
  currentPassword: string,
  nextPassword: string,
): Promise<{ ok: boolean; error?: string; field?: string }> {
  if (nextPassword.length < 8) return { ok: false, error: '新密码至少需要 8 位' };
  const row = await userById(actorId);
  if (!row) return { ok: false, error: '账号不存在' };
  if (!row.must_change_password && !(await matches(currentPassword, row.password_hash, row.password_salt)))
    return { ok: false, error: '当前密码不正确' };
  if (row.must_change_password && row.role_id === 'class_admin')
    return { ok: false, error: '班级管理员首次登录必须同时设置新的用户名和密码' };
  const { hash, salt } = await makePasswordHash(nextPassword);
  await invalidateLegacySharedToken();
  await authSql()`UPDATE app_users SET password_hash=${hash}, password_salt=${salt}, must_change_password=FALSE, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${actorId}`;
  return { ok: true };
}

export async function changeOwnUsername(
  actorId: number,
  currentPassword: string,
  nextUsername: string,
): Promise<{ ok: boolean; error?: string; oldUsername?: string; field?: string }> {
  const username = nextUsername.trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username))
    return { ok: false, error: '用户名需为 3-40 位字母、数字、点、横线或下划线' };
  const row = await userById(actorId);
  if (!row || !(await matches(currentPassword, row.password_hash, row.password_salt)))
    return { ok: false, error: '当前密码不正确' };
  try {
    await invalidateLegacySharedToken();
    await authSql()`UPDATE app_users SET username=${username}, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${actorId}`;
    return { ok: true, oldUsername: row.username };
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : String(error)))
      return { ok: false, error: '用户名已存在' };
    throw error;
  }
}

async function initBindPolicyForced(): Promise<boolean> {
  try {
    await ensureAuthTables();
    const rows = assertRows(
      await authSql()`SELECT init_bind_policy FROM email_config WHERE id=1`,
      rowShape<{ init_bind_policy: string }>({ init_bind_policy: isString }),
      'email_config',
    );
    return rows[0]?.init_bind_policy === 'force';
  } catch {
    return false;
  }
}

export async function changeOwnCredentials(
  actorId: number,
  currentPassword: string,
  nextUsername: string,
  nextPassword: string,
): Promise<{ ok: boolean; error?: string; oldUsername?: string; username?: string; field?: string }> {
  const username = nextUsername.trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username))
    return { ok: false, error: '用户名需为 3-40 位字母、数字、点、横线或下划线' };
  const row = await userById(actorId);
  if (!row || !(await matches(currentPassword, row.password_hash, row.password_salt)))
    return { ok: false, error: '当前密码不正确' };
  if (
    row.must_change_password &&
    row.role_id === 'class_admin' &&
    username.toLowerCase() === row.username.toLowerCase()
  )
    return { ok: false, error: '班级管理员首次登录必须设置新的用户名' };
  if (row.must_change_password && nextPassword.length < 8)
    return { ok: false, error: '首次登录必须设置至少 8 位的新密码' };
  if (row.must_change_password && !row.email && (await initBindPolicyForced()))
    return { ok: false, error: '当前系统要求初始化时必须先绑定邮箱，请返回登录页完成绑定' };
  if (nextPassword && nextPassword.length < 8) return { ok: false, error: '新密码至少需要 8 位' };
  if (!nextPassword && username.toLowerCase() === row.username.toLowerCase())
    return { ok: false, error: '用户名和密码均未修改' };
  const password = nextPassword
    ? await makePasswordHash(nextPassword)
    : { hash: row.password_hash, salt: row.password_salt };
  try {
    await invalidateLegacySharedToken();
    await authSql()`UPDATE app_users SET username=${username}, password_hash=${password.hash}, password_salt=${password.salt},
      must_change_password=${nextPassword ? false : row.must_change_password}, token_version=token_version+1, updated_at=${Date.now()} WHERE id=${actorId}`;
    return { ok: true, oldUsername: row.username, username };
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : String(error)))
      return { ok: false, error: '用户名已存在' };
    throw error;
  }
}
