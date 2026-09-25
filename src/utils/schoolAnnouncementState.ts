/**
 * 教室端"这条学校公告已经自动弹过"的本地标记。
 *
 * 用途只有一个：普通公告发布后自动弹一次（用户口径 2026-09-25），但**不能每 60 秒
 * 轮询到就再弹一次**。标记存在本机 localStorage：换设备/清缓存会重新弹一次，属可接受行为。
 */
export const SCHOOL_ANNOUNCEMENT_SHOWN_KEY = 'exam_board_school_announcement_shown_v1';
/** 最多记住多少条，防止无上限增长（每条只有 id + 时间戳）。 */
const SHOWN_LIMIT = 500;

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 隐私模式/受限浏览器会抛异常，当作没有存储。
    return null;
  }
}

/** 读取已经弹过的公告 id（读失败按"都没弹过"处理，宁可多弹一次也不漏）。 */
export function readShownAnnouncementIds(target: StorageLike | null = storage()): Set<string> {
  if (!target) return new Set();
  try {
    const raw = target.getItem(SCHOOL_ANNOUNCEMENT_SHOWN_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set();
    return new Set(Object.keys(parsed as Record<string, unknown>));
  } catch {
    return new Set();
  }
}

/** 标记这些公告已经弹过（保留最近 SHOWN_LIMIT 条）。 */
export function markAnnouncementsShown(ids: readonly string[], target: StorageLike | null = storage()): void {
  if (!target || !ids.length) return;
  try {
    const raw = target.getItem(SCHOOL_ANNOUNCEMENT_SHOWN_KEY);
    const parsed: Record<string, number> =
      raw && typeof raw === 'string' ? ((JSON.parse(raw) as Record<string, number> | null) ?? {}) : {};
    const next: Record<string, number> = parsed && typeof parsed === 'object' ? { ...parsed } : {};
    const at = Date.now();
    for (const id of ids) if (id) next[id] = at;
    const entries = Object.entries(next)
      .sort((left, right) => right[1] - left[1])
      .slice(0, SHOWN_LIMIT);
    target.setItem(SCHOOL_ANNOUNCEMENT_SHOWN_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* 写不进去就算了：下次轮询会再弹一次，不影响回执 */
  }
}

/** 从设备刚拉到的公告里挑出"还没弹过"的（保持服务端给的顺序：紧急在前）。 */
export function pickUnshownAnnouncements<T extends { id: string }>(list: readonly T[], shown: Set<string>): T[] {
  return list.filter((item) => !shown.has(item.id));
}
