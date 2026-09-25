// api/_auth/passwords.ts
// 口令哈希与格式校验。唯一一处 scrypt 调用点：换算法/加参数只动这里。
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function makePasswordHash(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('base64url');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return { hash: key.toString('base64url'), salt };
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return key.toString('base64url');
}

export async function matches(password: string, hash: string, salt: string): Promise<boolean> {
  const actual = Buffer.from(await hashPassword(password, salt));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}
