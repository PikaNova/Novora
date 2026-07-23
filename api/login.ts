import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isPasswordRequired, checkPassword, generateToken } from './_auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method === 'GET') { res.json({ ok: true, required: await isPasswordRequired() }); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }
  const { password } = req.body ?? {};
  if (!await isPasswordRequired()) { res.json({ ok: true, token: null }); return; }
  if (!await checkPassword(String(password ?? ''))) { res.status(401).json({ ok: false, error: 'Invalid password' }); return; }
  const { token, expiresAt } = await generateToken();
  res.json({ ok: true, token, expiresAt });
}
