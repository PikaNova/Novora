/**
 * 快速考试的生命周期转换识别。
 *
 * 正式考试的生命周期由 `record-*` 动作显式写入 `exam_record_operations`；快速考试仍然走
 * **本地优先 + outbox** 的普通保存管道（客户端直接改快照），所以服务端在保存事务里对比
 * 「旧快照 vs 新快照」，把发布 / 提前结束 / 延长 / 转正式这几类转换补记成操作日志，
 * 保证离线路径同样留下操作者与前后状态，且不改变离线能力。
 */
import type { ExamRecordStatus } from '../../src/shared/examRecordContracts.js';

export type QuickMajorTransition = {
  recordId: string;
  action: 'publish' | 'end' | 'extend' | 'promote';
  fromStatus: ExamRecordStatus;
  toStatus: ExamRecordStatus;
};

type MajorLike = {
  id: string;
  source?: 'regular' | 'quick';
  endedAt?: number | null;
  endAt?: number | null;
};

function majorList(value: unknown): MajorLike[] {
  if (!Array.isArray(value)) return [];
  const majors: MajorLike[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const major = raw as Record<string, unknown>;
    const id = typeof major.id === 'string' ? major.id : '';
    if (!id) continue;
    majors.push({
      id,
      source: major.source === 'quick' ? 'quick' : major.source === 'regular' ? 'regular' : undefined,
      endedAt: typeof major.endedAt === 'number' && Number.isFinite(major.endedAt) ? major.endedAt : null,
      endAt: typeof major.endAt === 'number' && Number.isFinite(major.endAt) ? major.endAt : null,
    });
  }
  return majors;
}

function statusOf(major: MajorLike): ExamRecordStatus {
  return major.endedAt != null ? 'ended' : 'published';
}

/**
 * 只处理快速考试（`source === 'quick'`）：正式考试的转换必须走 `record-*` 动作，
 * 否则同一次转换会被记两遍。返回的顺序固定为 发布 → 结束 → 转正式 → 延长。
 */
export function quickMajorTransitions(prior: unknown, next: unknown): QuickMajorTransition[] {
  const previous = new Map(majorList(prior).map((major) => [major.id, major]));
  const transitions: QuickMajorTransition[] = [];
  for (const major of majorList(next)) {
    const before = previous.get(major.id);
    const wasQuick = before?.source === 'quick';
    const isQuick = major.source === 'quick';
    if (!wasQuick && !isQuick) continue;
    if (!before || !wasQuick) {
      // 新出现的快速考试（含由正式考试改判为快速考试）：记为发布。
      transitions.push({ recordId: major.id, action: 'publish', fromStatus: 'draft', toStatus: 'published' });
      continue;
    }
    if (before.endedAt == null && major.endedAt != null) {
      transitions.push({ recordId: major.id, action: 'end', fromStatus: 'published', toStatus: 'ended' });
    }
    if (!isQuick) {
      transitions.push({
        recordId: major.id,
        action: 'promote',
        fromStatus: statusOf(major),
        toStatus: statusOf(major),
      });
    }
    if (before.endAt != null && major.endAt != null && major.endAt > before.endAt) {
      transitions.push({
        recordId: major.id,
        action: 'extend',
        fromStatus: statusOf(major),
        toStatus: statusOf(major),
      });
    }
  }
  return transitions;
}
