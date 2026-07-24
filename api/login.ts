import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, extractBearer, getActor, isPasswordRequired, writeAudit } from './_auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method === 'GET') {
    const action = String(req.query?.action ?? 'status');
    if (action === 'me') {
      const actor = await getActor(extractBearer(req.headers.authorization));
      if (!actor) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      res.json({ ok: true, user: actor }); return;
    }
    res.json({ ok: true, required: await isPasswordRequired(), multiUser: true, defaultUsername: 'admin' }); return;
  }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }
  const { username, password } = req.body ?? {};
  if (!await isPasswordRequired()) { res.json({ ok: true, token: null }); return; }
  const login = await authenticateUser(String(username ?? 'admin'), String(password ?? ''));
  if (!login) { await new Promise(resolve => setTimeout(resolve, 350)); res.status(401).json({ ok: false, error: '用户名或密码不正确' }); return; }
  await writeAudit(login.actor, 'auth.login', 'user', String(login.actor.id));
  res.json({ ok: true, token: login.token, expiresAt: login.expiresAt, user: login.actor });
}
