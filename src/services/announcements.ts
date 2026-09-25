// 公告客户端服务：从 /api/announcements 拉取作者端统一发布的公告。
// 内容以 Markdown 存储，展示时由 renderMarkdown 渲染。
import { supportsEdgeCache } from './examService';

export type Announcement = {
  id: number;
  title: string;
  content: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  type?: 'announcement' | 'document';
  url?: string;
  buttonLabel?: string;
  summary?: string;
};

let cache: { at: number; data: Announcement[] } | null = null;
const TTL = 60 * 1000;

export async function fetchAnnouncements(force = false): Promise<Announcement[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  try {
    // 强制刷新时变更查询串并禁用浏览器缓存，确保运行中的大屏能及时发现作者端公告更新。
    // 例外：服务端启用了共享边缘缓存时不再加时间戳，否则每台设备每分钟都是一个唯一 URL，
    // 边缘缓存永远命中不了，反而把请求全压回函数。此时靠 s-maxage 控制新鲜度。
    const bustCache = force && !supportsEdgeCache();
    const suffix = bustCache ? `&t=${Date.now()}` : '';
    const r = await fetch(`/api/announcements?limit=30${suffix}`, {
      headers: { Accept: 'application/json' },
      cache: bustCache ? 'no-store' : 'default',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const list: Announcement[] = Array.isArray(d?.announcements) ? d.announcements : [];
    // 客户端再次统一排序：置顶公告组在前，各组均按更新时间从新到旧。
    list.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(b.updated_at) - Number(a.updated_at) ||
        Number(b.created_at) - Number(a.created_at),
    );
    cache = { at: Date.now(), data: list };
    return list;
  } catch {
    // 拉取失败时返回缓存（若有）或空列表，不阻断页面
    return cache?.data ?? [];
  }
}
