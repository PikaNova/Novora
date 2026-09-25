/**
 * 教室端与学校公告有关的本地标记（都放 localStorage，读失败一律按"没有记录"处理）。
 *
 * 三件事：
 * 1. 这条公告已经自动弹过（普通公告发布后弹一次，但不能每 60 秒轮询到就再弹）；
 * 2. 管理端发过的"未读强提醒"处理到哪一条了（按 remindAt 比较，只处理更新的提醒）；
 * 3. 本机已经上报过已读的公告（强提醒时跳过已经看过的，不打扰教室）。
 *
 * 换设备/清缓存会重新弹一次，属可接受行为（大屏是固定设备，缓存不常清）。
 */
export const SCHOOL_ANNOUNCEMENT_SHOWN_KEY = 'exam_board_school_announcement_shown_v1';
export const SCHOOL_ANNOUNCEMENT_REMIND_KEY = 'exam_board_school_announcement_remind_v1';
export const SCHOOL_ANNOUNCEMENT_SEEN_LOCAL_KEY = 'exam_board_school_announcement_seen_local_v1';
/** 每张表最多记住多少条，防止无上限增长（每条只有 id + 时间戳）。 */
const ENTRY_LIMIT = 500;

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 隐私模式/受限浏览器会抛异常，当作没有存储。
    return null;
  }
}

function readMap(key: string, target: StorageLike | null): Record<string, number> {
  if (!target) return {};
  try {
    const raw = target.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (id) out[id] = Math.trunc(Number(value) || 0);
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(key: string, entries: Record<string, number>, target: StorageLike | null): void {
  if (!target) return;
  try {
    const trimmed = Object.entries(entries)
      .sort((left, right) => right[1] - left[1])
      .slice(0, ENTRY_LIMIT);
    target.setItem(key, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    /* 写不进去就算了：下次轮询会再处理一次，不影响回执 */
  }
}

/** 读取已经弹过的公告 id（读失败按"都没弹过"处理，宁可多弹一次也不漏）。 */
export function readShownAnnouncementIds(target: StorageLike | null = storage()): Set<string> {
  return new Set(Object.keys(readMap(SCHOOL_ANNOUNCEMENT_SHOWN_KEY, target)));
}

/** 标记这些公告已经弹过。 */
export function markAnnouncementsShown(ids: readonly string[], target: StorageLike | null = storage()): void {
  if (!target || !ids.length) return;
  const next = readMap(SCHOOL_ANNOUNCEMENT_SHOWN_KEY, target);
  const at = Date.now();
  for (const id of ids) if (id) next[id] = at;
  writeMap(SCHOOL_ANNOUNCEMENT_SHOWN_KEY, next, target);
}

/** 从设备刚拉到的公告里挑出"还没弹过"的（保持服务端给的顺序：紧急在前）。 */
export function pickUnshownAnnouncements<T extends { id: string }>(list: readonly T[], shown: Set<string>): T[] {
  return list.filter((item) => !shown.has(item.id));
}

/** 已经处理过的强提醒（{公告 id: 已处理的 remindAt}）。 */
export function readReminderMarks(target: StorageLike | null = storage()): Record<string, number> {
  return readMap(SCHOOL_ANNOUNCEMENT_REMIND_KEY, target);
}

/** 记录强提醒已弹出（存 remindAt，便于下次只处理更新的提醒）。 */
export function markRemindersHandled(
  entries: ReadonlyArray<{ id: string; remindAt: number }>,
  target: StorageLike | null = storage(),
): void {
  if (!target || !entries.length) return;
  const next = readReminderMarks(target);
  for (const entry of entries) {
    if (!entry.id) continue;
    next[entry.id] = Math.max(next[entry.id] ?? 0, entry.remindAt);
  }
  writeMap(SCHOOL_ANNOUNCEMENT_REMIND_KEY, next, target);
}

/** 本机已经上报过已读的公告 id。 */
export function readLocallySeenIds(target: StorageLike | null = storage()): Set<string> {
  return new Set(Object.keys(readMap(SCHOOL_ANNOUNCEMENT_SEEN_LOCAL_KEY, target)));
}

export function markAnnouncementsSeenLocally(ids: readonly string[], target: StorageLike | null = storage()): void {
  if (!target || !ids.length) return;
  const next = readMap(SCHOOL_ANNOUNCEMENT_SEEN_LOCAL_KEY, target);
  const at = Date.now();
  for (const id of ids) if (id) next[id] = at;
  writeMap(SCHOOL_ANNOUNCEMENT_SEEN_LOCAL_KEY, next, target);
}
