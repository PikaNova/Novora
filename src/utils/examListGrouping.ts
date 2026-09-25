import { addDaysToDateKey, getShanghaiDateKey, weekIndexOfDateKey } from './weeklySchedule';

/**
 * 考试中心列表的分组规则（纯函数，便于单测）：
 * - 考试安排按 今天 / 明天 / 本周内 / 更晚 分组，突出"接下来要考什么"；
 * - 历史考试按自然月分组，便于按期翻阅。
 * 分组只影响展示，不改变取数与排序。
 */

export type ScheduleBucketKey = 'today' | 'tomorrow' | 'thisWeek' | 'later';

export type ScheduleBucket = { key: ScheduleBucketKey; label: string };

const BUCKETS: Record<ScheduleBucketKey, string> = {
  today: '今天',
  tomorrow: '明天',
  thisWeek: '本周内',
  later: '更晚',
};

/** 依据开始时间的上海日历日判断落在哪个时间桶；没有时间的归入「更晚」。 */
export function scheduleBucketKey(startAt: number | null, now: number): ScheduleBucketKey {
  if (startAt == null || !Number.isFinite(startAt)) return 'later';
  const todayKey = getShanghaiDateKey(now);
  const dateKey = getShanghaiDateKey(startAt);
  if (dateKey <= todayKey) return 'today';
  if (dateKey === addDaysToDateKey(todayKey, 1)) return 'tomorrow';
  // 同一自然周（ISO 周）内算「本周内」，跨周就是「更晚」。
  return weekIndexOfDateKey(dateKey) === weekIndexOfDateKey(todayKey) ? 'thisWeek' : 'later';
}

export function scheduleBucketLabel(key: ScheduleBucketKey): string {
  return BUCKETS[key];
}

/** 把已按开始时间升序排好的条目切成 今天/明天/本周内/更晚 四段，空段不产出。 */
export function groupScheduleEntries<T extends { startAt: number | null }>(
  entries: T[],
  now: number,
): Array<ScheduleBucket & { items: T[] }> {
  const order: ScheduleBucketKey[] = ['today', 'tomorrow', 'thisWeek', 'later'];
  const map = new Map<ScheduleBucketKey, T[]>();
  for (const entry of entries) {
    const key = scheduleBucketKey(entry.startAt, now);
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return order.filter((key) => map.has(key)).map((key) => ({ key, label: BUCKETS[key], items: map.get(key) as T[] }));
}

/** '2026年9月'；时间缺失时返回空串（由调用方决定兜底文案）。 */
export function monthLabelOf(at: number | null): string {
  if (at == null || !Number.isFinite(at)) return '';
  const key = getShanghaiDateKey(at);
  const [year, month] = key.split('-');
  return `${year}年${Number(month)}月`;
}

/** 把历史条目按自然月分段，保持传入顺序（接口已按结束时间倒序）。 */
export function groupHistoryEntries<T extends { endedAt: number | null; actualEndAt: number | null }>(
  entries: T[],
): Array<{ key: string; label: string; items: T[] }> {
  const groups: Array<{ key: string; label: string; items: T[] }> = [];
  for (const entry of entries) {
    const label = monthLabelOf(entry.actualEndAt ?? entry.endedAt) || '未记录时间';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(entry);
    else groups.push({ key: label, label, items: [entry] });
  }
  return groups;
}
