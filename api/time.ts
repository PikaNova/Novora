import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_cors.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, no-cache');
  if (!applyCors(req, res, { methods: ['GET'], public: true })) return;
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }
  const now = Date.now();
  res.json({ ok: true, epochMs: now, epochSeconds: now / 1000, iso: new Date(now).toISOString() });
}
