import type { ExamItem } from '../types';
import { parseZonedTime } from './timeSource';

const NEARBY_EXAM_WINDOW_MS = 30 * 60_000;
export const EXAM_SYNC_ACTIVE_INTERVAL_MS = 30_000;
export const EXAM_SYNC_IDLE_INTERVAL_MS = 60_000;

export function examSyncIntervalMs(items: ExamItem[], now: number): number {
  const activeOrNearby = items.some((item) => {
    if (!item.enabled) return false;
    const start = parseZonedTime(item.startTime);
    const end = parseZonedTime(item.endTime);
    return Number.isFinite(start) && Number.isFinite(end) && end > now && start - now <= NEARBY_EXAM_WINDOW_MS;
  });
  return activeOrNearby ? EXAM_SYNC_ACTIVE_INTERVAL_MS : EXAM_SYNC_IDLE_INTERVAL_MS;
}
