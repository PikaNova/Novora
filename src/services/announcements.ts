// 公告客户端服务：从 /api/announcements 拉取作者端统一发布的公告。
// 内容以 Markdown 存储，展示时由 renderMarkdown 渲染。

export type Announcement = {
  id: number;
  title: string;
  content: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
};

let cache: { at: number; data: Announcement[] } | null = null;
const TTL = 60 * 1000;

export async function fetchAnnouncements(force = false): Promise<Announcement[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  try {
    // 强制刷新时变更查询串并禁用浏览器缓存，确保运行中的大屏能及时发现作者端公告更新。
    const suffix = force ? `&t=${Date.now()}` : '';
    const r = await fetch(`/api/announcements?limit=30${suffix}`, {
      headers: { Accept: 'application/json' },
      cache: force ? 'no-store' : 'default',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const list: Announcement[] = Array.isArray(d?.announcements) ? d.announcements : [];
    // 客户端再次统一排序：置顶公告组在前，各组均按更新时间从新到旧。
    list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.updated_at) - Number(a.updated_at) || Number(b.created_at) - Number(a.created_at));
    cache = { at: Date.now(), data: list };
    return list;
  } catch {
    // 拉取失败时返回缓存（若有）或空列表，不阻断页面
    return cache?.data ?? [];
  }
}
