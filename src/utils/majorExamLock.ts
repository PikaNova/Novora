import type { ExamItem } from '../types';

export type MajorExamLockView = {
  locked: boolean;
  name: string;
  endAt: number | null;
};

export function getMajorExamLock(items: readonly ExamItem[], now = Date.now()): MajorExamLockView {
  const active = items
    .filter((item) => item.enabled && item.kind !== 'weekly' && item.kind !== 'temporary')
    .map((item) => ({ item, start: new Date(item.startTime).getTime(), end: new Date(item.endTime).getTime() }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now)
    .sort((a, b) => a.end - b.end)[0];
  return active
    ? { locked: true, name: active.item.name || '大型考试', endAt: active.end }
    : { locked: false, name: '', endAt: null };
}

export function majorExamLockMessage(lock: MajorExamLockView, kind: 'weekly' | 'temporary') {
  const target = kind === 'weekly' ? '周测' : '临时考试';
  const suffix = lock.endAt ? `，预计 ${new Date(lock.endAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 后恢复` : '';
  return `大型考试“${lock.name}”进行中，暂不可创建${target}${suffix}`;
}
