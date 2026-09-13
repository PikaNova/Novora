import type { ExamItem } from '../types';

/**
 * 由启用科目的时间汇总考试窗口：最早的开始、最晚的结束。
 *
 * 大型考试此前从不写 `startAt/endAt`，导致记录层拿不到考试窗口
 * （「当前考试」为空、暂停/延长无法计算）。新建向导发布前用它写入窗口。
 * 只统计「启用且起止时间完整」的科目，停用或缺时间的科目不参与。
 */
export function examWindowFromItems(items: ExamItem[]): { start: number | null; end: number | null } {
  const timed = items.filter((item) => item.enabled && item.startTime && item.endTime);
  const starts = timed.map((item) => new Date(item.startTime).getTime()).filter(Number.isFinite);
  const ends = timed.map((item) => new Date(item.endTime).getTime()).filter(Number.isFinite);
  if (!starts.length || !ends.length) return { start: null, end: null };
  return { start: Math.min(...starts), end: Math.max(...ends) };
}
