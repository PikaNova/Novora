import { examWindowFromItems } from './examWindow.js';
import type { ExamItem } from '../types/index.js';

/**
 * 老记录补数据的两件事（都是历史缺列，不是状态机的问题）：
 *
 * 1. 快照里没有显式考试窗口、但启用科目能算出窗口的：把窗口写回快照，
 *    记录层的 `start_at/end_at` 才有值（详情「计划时间」与时间轴落位都靠它）。
 *    现在的发布动作会自己写窗口，所以这只影响 09-18 前后的老数据。
 * 2. `exam_records` 里 published_at / ended_at / archived_at / actual_start_at
 *    为空、但操作日志里有对应动作的：按日志里最早的一次补上。
 */

export type BackfillMajorLike = {
  id?: unknown;
  name?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  items?: unknown;
};

export type SnapshotWindowFill = {
  majorId: string;
  majorName: string;
  startAt: number;
  endAt: number;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 快照里显式窗口优先；没有就用启用科目推算（与投影的状态判定同一套口径）。 */
export function snapshotWindowOf(major: BackfillMajorLike): { startAt: number | null; endAt: number | null } {
  const startAt = finiteNumber(major.startAt);
  const endAt = finiteNumber(major.endAt);
  if (startAt != null && endAt != null) return { startAt, endAt };
  const window = examWindowFromItems(Array.isArray(major.items) ? (major.items as ExamItem[]) : []);
  return { startAt: startAt ?? window.start, endAt: endAt ?? window.end };
}

export function planSnapshotWindowFills(majors: readonly BackfillMajorLike[]): SnapshotWindowFill[] {
  const fills: SnapshotWindowFill[] = [];
  for (const major of majors) {
    const majorId = typeof major.id === 'string' ? major.id : '';
    if (!majorId) continue;
    const explicitStart = finiteNumber(major.startAt);
    const explicitEnd = finiteNumber(major.endAt);
    if (explicitStart != null && explicitEnd != null) continue;
    const window = snapshotWindowOf(major);
    if (window.startAt == null || window.endAt == null) continue;
    fills.push({
      majorId,
      majorName: typeof major.name === 'string' ? major.name : '',
      startAt: window.startAt,
      endAt: window.endAt,
    });
  }
  return fills;
}

/** 把补出来的窗口写回快照数组，未命中的考试原样返回。 */
export function withSnapshotWindowFills(
  majors: readonly BackfillMajorLike[],
  fills: readonly SnapshotWindowFill[],
): BackfillMajorLike[] {
  const byId = new Map(fills.map((fill) => [fill.majorId, fill]));
  return majors.map((major) => {
    const fill = byId.get(typeof major.id === 'string' ? major.id : '');
    if (!fill) return major;
    return { ...major, startAt: fill.startAt, endAt: fill.endAt };
  });
}

export type BackfillRecordLike = {
  id: string;
  published_at: number | null;
  ended_at: number | null;
  archived_at: number | null;
  actual_start_at: number | null;
  start_at: number | null;
  end_at: number | null;
};

export type BackfillOperationLike = {
  action: string;
  result_record_id: string;
  created_at: number;
};

export type RecordTimestampFill = {
  id: string;
  publishedAt?: number;
  endedAt?: number;
  archivedAt?: number;
  actualStartAt?: number;
  startAt?: number;
  endAt?: number;
};

const OPERATION_SOURCES: Array<{
  column: keyof Pick<BackfillRecordLike, 'published_at' | 'ended_at' | 'archived_at' | 'actual_start_at'>;
  field: keyof Pick<RecordTimestampFill, 'publishedAt' | 'endedAt' | 'archivedAt' | 'actualStartAt'>;
  actions: string[];
}> = [
  { column: 'published_at', field: 'publishedAt', actions: ['publish'] },
  { column: 'actual_start_at', field: 'actualStartAt', actions: ['auto_start'] },
  { column: 'ended_at', field: 'endedAt', actions: ['end', 'auto_end', 'force_end'] },
  { column: 'archived_at', field: 'archivedAt', actions: ['archive', 'auto_archive'] },
];

/**
 * 记录层时间列的回填计划。只补空列，已有值一律不动；
 * 同一列对应多个动作时（例如 end/auto_end/force_end）取最早的一次。
 */
export function planRecordTimestampFills(
  records: readonly BackfillRecordLike[],
  operations: readonly BackfillOperationLike[],
  /** 补完之后的考试窗口（按记录 id），用于补 start_at / end_at。 */
  windows: ReadonlyMap<string, { startAt: number | null; endAt: number | null }> = new Map(),
): RecordTimestampFill[] {
  const earliestByAction = new Map<string, Map<string, number>>();
  for (const operation of operations) {
    if (!operation.result_record_id || !Number.isFinite(operation.created_at)) continue;
    const byAction = earliestByAction.get(operation.result_record_id) ?? new Map<string, number>();
    const current = byAction.get(operation.action);
    if (current == null || operation.created_at < current) byAction.set(operation.action, operation.created_at);
    earliestByAction.set(operation.result_record_id, byAction);
  }

  const fills: RecordTimestampFill[] = [];
  for (const record of records) {
    const fill: RecordTimestampFill = { id: record.id };
    const byAction = earliestByAction.get(record.id);
    if (byAction) {
      for (const source of OPERATION_SOURCES) {
        if (record[source.column] != null) continue;
        const hits = source.actions
          .map((action) => byAction.get(action))
          .filter((value): value is number => value != null);
        if (!hits.length) continue;
        fill[source.field] = Math.min(...hits);
      }
    }
    const window = windows.get(record.id);
    if (window) {
      if (record.start_at == null && window.startAt != null) fill.startAt = window.startAt;
      if (record.end_at == null && window.endAt != null) fill.endAt = window.endAt;
    }
    if (Object.keys(fill).length > 1) fills.push(fill);
  }
  return fills;
}
