import type { ExamItem } from '../types';
import { parseZonedTime } from './timeSource';

/** 考试时间线只由真实时间决定，旧 order 字段仅为兼容保存。 */
export function sortExamItemsByTime<T extends ExamItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aTime = parseZonedTime(a.startTime);
    const bTime = parseZonedTime(b.startTime);
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    const aEnd = parseZonedTime(a.endTime); const bEnd = parseZonedTime(b.endTime);
    if (Number.isFinite(aEnd) && Number.isFinite(bEnd) && aEnd !== bEnd) return aEnd - bEnd;
    return a.id.localeCompare(b.id);
  });
}
export function normalizeExamItems(items: ExamItem[]): ExamItem[] { return sortExamItemsByTime(items).map((item, order) => ({ ...item, order })); }
