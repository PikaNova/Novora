import type { VercelRequest, VercelResponse } from '@vercel/node';
import { telemetryConfig } from './_telemetryConfig.js';
import { handleAnnouncementImages } from './_content/announcementImages.js';
import { resolveSubRoute } from './_routeMatch.js';

// 公告代理：转发到作者端遥测台的公开公告接口。
// 作者端统一发布，各「考试看板」实例通过本代理拉取已发布公告（避免浏览器直连跨域）。
//
// 域名集中在 ./_telemetryConfig.ts（与 /api/telemetry 共用）；随 GitHub 更新/重新部署自动应用。
//
// /api/announcement-images（公告图片同源代理）也由本入口承载：公告正文里存的是它的绝对路径，
// 所以这个 URL 必须一直可用，改成 rewrite 别名并合并进本文件只是为了少占一个 Vercel Function。
const ANNOUNCE_URL = telemetryConfig.announceUrl;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 图片代理与公告列表共用本入口，判据按可靠性排序：
  // 1) 本地/内网部署保留原始 URL，末段仍是 announcement-images（此时缺 id 也要按图片协议回 400）；
  // 2) Vercel 上是 rewrite 别名，路径已被换成 /api/announcements，只能靠带没带 id 区分；
  // 3) 显式 ?sys=images 作为补充（与作者端口径一致）。
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  const pathname = String(req.url ?? '')
    .split('?')[0]
    .replace(/\/+$/, '');
  const wantsImages =
    pathname.endsWith('/announcement-images') ||
    resolveSubRoute(req, 'sys', ['images']) === 'images' ||
    (rawId !== undefined && String(rawId) !== '');
  if (wantsImages) {
    await handleAnnouncementImages(req, res);
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  try {
    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = Math.min(Math.max(Number(rawLimit) || 20, 1), 50);
    const r = await fetch(`${ANNOUNCE_URL}?limit=${limit}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) {
      res.status(502).json({ ok: false, error: 'upstream_failed', status: r.status, announcements: [] });
      return;
    }
    const data = await r.json();
    const imgOrigin = new URL(ANNOUNCE_URL).origin;
    // 图片改走同源代理：把绝对遥测台地址改回相对路径（相对路径不变）
    const toSameOrigin = (c: unknown) =>
      typeof c === 'string' ? c.split(`](${imgOrigin}/api/announcement-images`).join('](/api/announcement-images') : c;
    const list = Array.isArray(data?.announcements)
      ? data.announcements.map((a: Record<string, unknown>) => ({ ...a, content: toSameOrigin(a.content) }))
      : [];
    res.json({ ok: true, announcements: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message, announcements: [] });
  }
}
