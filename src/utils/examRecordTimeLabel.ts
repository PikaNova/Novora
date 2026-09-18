import { addDaysToDateKey, getShanghaiDateKey } from './weeklySchedule';
import { formatClockInZone } from './zonedTime';

/** 9/19 这种短日期（去前导零）。 */
function shortDate(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
}

/** 今天 / 明天 / 9/19——列表时间列的前缀。 */
export function examTimePrefix(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return '今天';
  if (dateKey === addDaysToDateKey(todayKey, 1)) return '明天';
  return shortDate(dateKey);
}

/**
 * 考试记录的时间列文案。列表里每行都写完整的「9/19 08:30 - 9/19 10:30」太占地方，
 * 这里收敛成：今天 08:30–10:30 / 明天 09:00–11:00 / 9/19 08:30–10:30；
 * 只有跨天时才把结束日期补出来：9/19 22:00 – 9/20 00:30。
 */
export function examTimeRange(startAt: number | null, endAt: number | null, now: number = Date.now()): string {
  if (!startAt || !Number.isFinite(startAt)) return '时间待定';
  const todayKey = getShanghaiDateKey(now);
  const startKey = getShanghaiDateKey(startAt);
  const startClock = formatClockInZone(startAt).slice(0, 5);
  const start = `${examTimePrefix(startKey, todayKey)} ${startClock}`;
  if (!endAt || !Number.isFinite(endAt)) return start;
  const endClock = formatClockInZone(endAt).slice(0, 5);
  const endKey = getShanghaiDateKey(endAt);
  if (endKey === startKey) return `${start}–${endClock}`;
  return `${start} – ${shortDate(endKey)} ${endClock}`;
}
