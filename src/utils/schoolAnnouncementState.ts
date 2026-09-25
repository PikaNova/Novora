import {
  pickRemindableAnnouncements,
  shouldAutoOpenAnnouncement,
  type AnnouncementLevel,
  type AnnouncementRemindScope,
} from '../shared/examAnnouncementContracts.js';

/**
 * 教室端与学校公告有关的本地标记（都放 localStorage，读失败一律按"没有记录"处理）。
 *
 * 三件事：
 * 1. 这条公告已经自动弹过（普通公告发布后弹一次，但不能每 60 秒轮询到就再弹）；
 * 2. 管理端发过的"未读强提醒"处理到哪一条了（按 remindAt 比较，只处理更新的提醒）；
 * 3. 本机已经上报过已读的公告（强提醒时跳过已经看过的，不打扰教室；紧急公告也用它
 *    判断"这条已经真正看过了"，见 pickAutoOpenAnnouncements）。
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

/** 自动弹出决策需要的公告字段（只取这份规则用得到的部分，便于单测）。 */
export type AutoOpenAnnouncementLike = {
  id: string;
  level: AnnouncementLevel;
  silent?: boolean;
  remindAt: number | null;
  remindScope: AnnouncementRemindScope;
};

/** 自动弹出决策需要的本机状态（由调用方从 localStorage 读出后注入，便于单测）。 */
export type AutoOpenAnnouncementState = {
  /** 本机已经自动弹过的公告 id。 */
  shown: ReadonlySet<string>;
  /** 本机已经上报过已读的公告 id。 */
  seenLocally: ReadonlySet<string>;
  /** 强提醒处理进度（{公告 id: 已处理的 remindAt}）。 */
  reminderMarks: Record<string, number>;
  /** 当前时刻；只有"发布时选了只进列表"会否决自动弹出。 */
  now?: Date;
};

/**
 * 这次轮询要自动弹哪些学校公告（用户口径 2026-09-26：**公告随时随地都要确保弹出**）。
 *
 * 候选两类：
 * - 管理端在回执里发的"未读强提醒"（提醒时间比本机记的处理进度新；scope='unseen' 时跳过已读的教室）；
 * - 本机还没弹过的公告。
 *
 * 两条容易搞错的边界，特意写在这里：
 * - **紧急公告不认"弹过一次"**：只有本机真正上报过已读（`seenLocally`）才算弹够了。大屏重启、
 *   整页刷新、被浏览器/PWA 更新顶掉之后，紧急公告会自己再弹回来——这正是"确保弹出"的含义；
 *   普通公告仍然只弹一次，不打扰课堂。
 * - **考试进行中、夜间都不再是压制理由**：此函数没有、也不该有"当前是否有考试"这类入参。
 *
 * 返回 `silent`（发布时选了"只进列表"）让调用方记账：这些公告只进列表，不自动弹。
 */
export function pickAutoOpenAnnouncements<T extends AutoOpenAnnouncementLike>(
  list: readonly T[],
  state: AutoOpenAnnouncementState,
): { autoOpen: T[]; silent: T[] } {
  const { shown, seenLocally, reminderMarks, now = new Date() } = state;
  const reminders = pickRemindableAnnouncements(list, reminderMarks).filter(
    (item) => item.remindScope === 'all' || !seenLocally.has(item.id),
  );
  const fresh = list.filter((item) =>
    // 普通公告：弹过一次就不再打扰课堂。
    // 紧急公告：只认"本机已经上报过已读"，弹过一次不算——大屏重启、整页刷新、被浏览器更新
    // 顶掉之后要自己弹回来，这才是"确保弹出"。
    item.level === 'urgent' ? !seenLocally.has(item.id) : !shown.has(item.id),
  );
  const candidates: T[] = [];
  const seen = new Set<string>();
  for (const item of [...reminders, ...fresh]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    candidates.push(item);
  }
  return {
    autoOpen: candidates.filter((item) => shouldAutoOpenAnnouncement(item, now)),
    silent: candidates.filter((item) => item.silent === true),
  };
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
