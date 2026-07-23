import type { VercelRequest, VercelResponse } from '@vercel/node';
import { changePassword, extractBearer, verifyToken } from './_auth.js';

/** 已登录管理员修改密码；密码哈希保存在客户端自己的 Neon 数据库中。 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }
  if (!await verifyToken(extractBearer(req.headers.authorization))) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
  const { currentPassword, newPassword } = req.body ?? {};
  const result = await changePassword(String(currentPassword ?? ''), String(newPassword ?? ''));
  if (!result.ok) { res.status(400).json(result); return; }
  res.status(200).json({ ok: true, message: 'Password changed. Please sign in again.' });
}
