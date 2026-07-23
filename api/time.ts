import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const now = Date.now();
  res.json({ ok: true, epochMs: now, epochSeconds: now / 1000, iso: new Date(now).toISOString() });
}
