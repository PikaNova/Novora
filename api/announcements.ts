import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthorConfig } from './_authorClient.js';
import { resolveTelemetryUrls } from './_telemetryConfig.js';
import { handleAnnouncementImages } from './_content/announcementImages.js';
import { resolveSubRoute } from './_routeMatch.js';
import { createAnnouncementCache } from './_content/announcementCache.js';

// 公告代理：转发到作者端遥测台的公开公告接口。
// 作者端统一发布，各「考试看板」实例通过本代理拉取已发布公告（避免浏览器直连跨域）。
//
// 域名集中在 ./_telemetryConfig.ts（与 /api/telemetry 共用）；随 GitHub 更新/重新部署自动应用。
//
// /api/announcement-images（公告图片同源代理）也由本入口承载：公告正文里存的是它的绝对路径，
// 所以这个 URL 必须一直可用，改成 rewrite 别名并合并进本文件只是为了少占一个 Vercel Function。

/** 上游按状态码拒绝属于代理故障，要如实回 502，不能塌成 500 让客户端按本地错误处理。 */
class AnnouncementUpstreamError extends Error {
  constructor(readonly status: number) {
    super(`公告源 HTTP ${status}`);
    this.name = 'AnnouncementUpstreamError';
  }
}

const readAnnouncements = createAnnouncementCache();

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
    const config = await getAuthorConfig();
    const announceUrl = resolveTelemetryUrls({
      updateBaseUrl: config.updateBaseUrl,
      ingestBaseUrl: config.ingestBaseUrl,
      contentBaseUrl: config.contentBaseUrl,
    }).announceUrl;
    // 发布窗口在代理侧过滤、按调用方 limit 截断，所以上游固定取满 50 条：
    // 同一热实例里不同 limit 的请求因此共用一次上游调用，而不是各拉一遍。
    const upstreamItems = await readAnnouncements(announceUrl, async () => {
      const r = await fetch(`${announceUrl}?limit=50`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new AnnouncementUpstreamError(r.status);
      const data = await r.json();
      if (data?.ok !== true || !Array.isArray(data.announcements)) throw new Error('公告源响应无效');
      return data.announcements as Record<string, unknown>[];
    });
    const imgOrigin = new URL(announceUrl).origin;
    // 图片改走同源代理：把绝对遥测台地址改回相对路径（相对路径不变）
    const toSameOrigin = (c: unknown) =>
      typeof c === 'string' ? c.split(`](${imgOrigin}/api/announcement-images`).join('](/api/announcement-images') : c;
    const now = Date.now();
    const list = upstreamItems
      .filter(
        (a) =>
          (a.publish_at == null || Number(a.publish_at) <= now) &&
          (a.unpublish_at == null || Number(a.unpublish_at) > now),
      )
      .slice(0, limit)
      .map((a) => ({ ...a, content: toSameOrigin(a.content) }));
    res.json({ ok: true, announcements: list });
  } catch (e) {
    if (e instanceof AnnouncementUpstreamError) {
      res.status(502).json({ ok: false, error: 'upstream_failed', status: e.status, announcements: [] });
      return;
    }
    res.status(500).json({ ok: false, error: (e as Error).message, announcements: [] });
  }
}
