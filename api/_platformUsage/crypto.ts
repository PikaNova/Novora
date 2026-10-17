// 平台凭据的对称加密。
//
// 产品要求凭据由管理员在前端录入、不使用环境变量，因此密文与密钥都会落在同一个
// 数据库里。这里用 app_auth.token_secret 派生密钥：这能挡住数据库快照/只读导出
// 之类的旁路泄露，但挡不住已经拿到完整数据库读写权限的攻击者。该限制在接口返回
// 与文档中如实说明，不宣称更强的保证。
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

const KEY_SALT = 'novora-platform-usage-v1';
const KEY_LENGTH = 32;

let cachedKey: { secret: string; key: Buffer } | null = null;

export function deriveKey(secret: string): Buffer {
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = scryptSync(secret, KEY_SALT, KEY_LENGTH);
  cachedKey = { secret, key };
  return key;
}

/** 加密明文，返回 `v1.<iv>.<tag>.<ciphertext>`（各段 base64url）。 */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** 解密失败（密钥轮换、密文被篡改、格式不符）统一返回 null。 */
export function decryptSecret(payload: string, secret: string): string | null {
  const parts = String(payload ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** 只回显尾 4 位，用于「已配置」提示；不泄露完整凭据。 */
export function secretHint(plain: string): string {
  const trimmed = String(plain ?? '').trim();
  if (!trimmed) return '';
  return `••••${trimmed.slice(-4)}`;
}

/** 稳定指纹：用于审计与排错时区分「换了哪把钥匙」，不可逆。 */
export function stableFingerprint(value: string): string {
  return createHash('sha256')
    .update(String(value ?? ''))
    .digest('hex')
    .slice(0, 12);
}
