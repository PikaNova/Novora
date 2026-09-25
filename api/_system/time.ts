// 时间校准接口的实现：对外仍是 GET /api/time，由 api/system.ts 按 ?sys=time 分发
// （vercel.json rewrite），本地/内网部署则由 server/routes.ts 映射到同一个入口。
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_cors.js';

export function handleTime(req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Cache-Control', 'no-store, no-cache');
  if (!applyCors(req, res, { methods: ['GET'], public: true })) return;
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  const now = Date.now();
  res.json({ ok: true, epochMs: now, epochSeconds: now / 1000, iso: new Date(now).toISOString() });
}
