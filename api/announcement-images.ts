import type { VercelRequest, VercelResponse } from '@vercel/node';
import { telemetryConfig } from './_telemetryConfig.js';

// 同源图片代理：把公告正文里的 /api/announcement-images?id=.. 转发到作者端遥测台的同名接口。
// 目的：让浏览器始终「同源」加载公告图片 —— 不受客户端域名变化影响（换域名后不再裂图），
// 且响应可被浏览器/CDN 缓存。域名集中在 ./_telemetryConfig.ts，随更新/重新部署自动切换。
const IMAGES_BASE = `${telemetryConfig.baseUrl}/api/announcement-images`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = String(rawId ?? '');
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ ok: false, error: 'invalid_id' });
    return;
  }
  try {
    const upstream = await fetch(`${IMAGES_BASE}?id=${encodeURIComponent(id)}`, {
      headers: { Accept: 'image/*' },
    });
    if (!upstream.ok) {
      res.status(502).json({ ok: false, error: 'upstream_failed', status: upstream.status });
      return;
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
