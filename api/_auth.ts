import { neon } from '@neondatabase/serverless';
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_TTL = 24 * 60 * 60 * 1000;

type AuthRow = { password_hash: string; password_salt: string; token_secret: string; token_version: number };
let sqlClient: ReturnType<typeof neon> | null = null;
let setupPromise: Promise<void> | null = null;

function sql() {
  if (sqlClient) return sqlClient;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  sqlClient = neon(url);
  return sqlClient;
}

async function ensureAuthTable(): Promise<void> {
  if (!setupPromise) setupPromise = (async () => {
    await sql()`CREATE TABLE IF NOT EXISTS app_auth (
      id INTEGER PRIMARY KEY DEFAULT 1,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      token_secret TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      initialized_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      CHECK (id = 1)
    )`;
  })().catch(error => { setupPromise = null; throw error; });
  return setupPromise;
}

async function config(): Promise<AuthRow | null> {
  try {
    await ensureAuthTable();
    // Neon 的模板查询声明可能是“行数组或完整结果对象”的联合类型；本查询始终使用默认行数组模式。
    const rows = (await sql()`SELECT password_hash, password_salt, token_secret, token_version FROM app_auth WHERE id = 1`) as unknown as AuthRow[];
    return rows[0] ?? null;
  } catch { return null; }
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await scrypt(password, salt, 64) as Buffer;
  return key.toString('base64url');
}

async function matches(password: string, row: AuthRow): Promise<boolean> {
  const actual = Buffer.from(await hashPassword(password, row.password_salt));
  const expected = Buffer.from(row.password_hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function bootstrap(password: string): Promise<AuthRow | null> {
  if (!BOOTSTRAP_PASSWORD || password !== BOOTSTRAP_PASSWORD) return null;
  try {
    await ensureAuthTable();
    const existing = await config();
    if (existing) return existing;
    const salt = randomBytes(16).toString('base64url');
    const hash = await hashPassword(password, salt);
    const tokenSecret = randomBytes(32).toString('base64url');
    const at = Date.now();
    await sql()`INSERT INTO app_auth (id, password_hash, password_salt, token_secret, token_version, initialized_at, updated_at)
      VALUES (1, ${hash}, ${salt}, ${tokenSecret}, 1, ${at}, ${at}) ON CONFLICT (id) DO NOTHING`;
    return await config();
  } catch { return null; }
}

export async function isPasswordRequired(): Promise<boolean> {
  return !!(await config()) || !!BOOTSTRAP_PASSWORD;
}

/** 首次使用旧环境变量密码登录时自动迁移为 Neon 内的安全密码哈希。 */
export async function checkPassword(password: string): Promise<boolean> {
  const row = await config();
  if (row) return matches(String(password ?? ''), row);
  return !!(await bootstrap(String(password ?? '')));
}

function signature(expiresAt: number, version: number, secret: string): string {
  return createHmac('sha256', secret).update(`${expiresAt}.${version}`).digest('base64url');
}

export async function generateToken(): Promise<{ token: string; expiresAt: number }> {
  const row = await config();
  if (!row) throw new Error('Authentication is not initialized');
  const expiresAt = Date.now() + TOKEN_TTL;
  const token = Buffer.from(`${expiresAt}.${row.token_version}.${signature(expiresAt, row.token_version, row.token_secret)}`).toString('base64url');
  return { token, expiresAt };
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await config();
  if (!row) return false;
  try {
    const [expText, versionText, received] = Buffer.from(token, 'base64url').toString().split('.');
    const expiresAt = Number(expText); const version = Number(versionText);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt || version !== row.token_version || !received) return false;
    const expected = signature(expiresAt, version, row.token_secret);
    const a = Buffer.from(received); const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

/** 密码存入 Neon；令牌版本递增，所有旧设备立即需要重新登录。 */
export async function changePassword(currentPassword: string, nextPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (nextPassword.length < 8) return { ok: false, error: '新密码至少需要 8 位' };
  if (!await checkPassword(currentPassword)) return { ok: false, error: '当前密码不正确' };
  const row = await config();
  if (!row) return { ok: false, error: '认证尚未初始化，请使用环境变量密码登录一次' };
  const salt = randomBytes(16).toString('base64url');
  const hash = await hashPassword(nextPassword, salt);
  const at = Date.now();
  await sql()`UPDATE app_auth SET password_hash = ${hash}, password_salt = ${salt}, token_version = ${row.token_version + 1}, updated_at = ${at} WHERE id = 1`;
  return { ok: true };
}

export function extractBearer(authHeader: string | undefined): string | undefined {
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
}
