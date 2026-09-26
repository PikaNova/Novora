// api/_auth/tokens.ts
// 令牌的签发与校验规则（管理员令牌、访客令牌，以及旧版兼容版本判定）。
// 令牌格式本身定义在这里：新增一种凭据应新建模块，而不是继续往本文件加分支。
import { createHmac } from 'node:crypto';
import { GUEST_TOKEN_TTL, TOKEN_TTL } from './env.js';
import { config, ensureAuthTables } from './db.js';

export function signature(userId: number, expiresAt: number, version: number, secret: string): string {
  return createHmac('sha256', secret).update(`${userId}.${expiresAt}.${version}`).digest('base64url');
}

export async function issueTokenForUser(row: {
  id: number | bigint | string;
  token_version: number;
}): Promise<{ token: string; expiresAt: number } | null> {
  await ensureAuthTables();
  const auth = await config();
  if (!auth) return null;
  const userId = Number(row.id);
  const expiresAt = Date.now() + TOKEN_TTL;
  const token = Buffer.from(
    `${userId}.${expiresAt}.${row.token_version}.${signature(userId, expiresAt, row.token_version, auth.token_secret)}`,
  ).toString('base64url');
  return { token, expiresAt };
}

export function guestSignature(
  instanceId: string,
  gradeId: string,
  classId: string,
  expiresAt: number,
  version: number,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`guest.${instanceId}.${gradeId}.${classId}.${expiresAt}.${version}`)
    .digest('base64url');
}

export async function issueGuestToken(
  instanceId: string,
  gradeId: string,
  classId: string,
): Promise<{ token: string; expiresAt: number } | null> {
  await ensureAuthTables();
  const auth = await config();
  if (!auth) return null;
  const expiresAt = Date.now() + GUEST_TOKEN_TTL;
  const version = auth.token_version;
  const sig = guestSignature(instanceId, gradeId, classId, expiresAt, version, auth.token_secret);
  const token = Buffer.from(`g.${instanceId}.${gradeId}.${classId}.${expiresAt}.${version}.${sig}`).toString(
    'base64url',
  );
  return { token, expiresAt };
}

export function isTokenNotExpired(expiresAt: number, now: number): boolean {
  return Number.isFinite(expiresAt) && now <= expiresAt;
}

export function isLegacySharedTokenVersionCurrent(tokenVersion: number, currentAuthTokenVersion: number): boolean {
  return tokenVersion === currentAuthTokenVersion;
}

export function isUserTokenVersionCurrent(
  row: { status: string; token_version: number } | null | undefined,
  tokenVersion: number,
): boolean {
  return row?.status === 'active' && row.token_version === tokenVersion;
}

export function extractBearer(authHeader: string | undefined): string | undefined {
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
}
