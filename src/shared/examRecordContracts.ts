/** Persisted metadata for one MajorExam. The snapshot in exam_data remains authoritative. */
import type { ExamItem } from '../types/index.js';

export type ExamRecordStatus = 'draft' | 'published' | 'ended' | 'archived';

/** Status shown by management views; ongoing is derived from the time window. */
export type ExamRecordDisplayStatus = ExamRecordStatus | 'ongoing';
export type ExamRecordAction = 'publish' | 'end' | 'archive' | 'unarchive' | 'copy';

export interface ExamRecord {
  id: string;
  runtimeMajorId: string;
  name: string;
  description: string;
  status: ExamRecordStatus;
  items: ExamItem[];
  targetGradeIds: string[];
  targetClassIds: string[];
  source: 'regular' | 'quick';
  temporary: boolean;
  priorityOverSchedule: boolean;
  config: Record<string, unknown>;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
  startAt: number | null;
  endAt: number | null;
  actualStartAt: number | null;
  actualEndAt: number | null;
  /** 暂停起始时刻；null 表示当前不在暂停中。 */
  pausedAt?: number | null;
  /** 累计已暂停时长（毫秒）；倒计时按 endAt + pausedMs 计算。 */
  pausedMs?: number;
  publishedAt: number | null;
  endedAt: number | null;
  archivedAt: number | null;
  version: number;
}

export const EXAM_RECORD_STATUSES: readonly ExamRecordStatus[] = ['draft', 'published', 'ended', 'archived'];

const TRANSITIONS: Readonly<
  Record<Exclude<ExamRecordAction, 'copy'>, Readonly<Record<ExamRecordStatus, ExamRecordStatus | null>>>
> = {
  publish: { draft: 'published', published: null, ended: null, archived: null },
  end: { draft: null, published: 'ended', ended: null, archived: null },
  archive: { draft: null, published: null, ended: 'archived', archived: null },
  unarchive: { draft: null, published: null, ended: null, archived: 'ended' },
};

export function isExamRecordStatus(value: unknown): value is ExamRecordStatus {
  return typeof value === 'string' && EXAM_RECORD_STATUSES.includes(value as ExamRecordStatus);
}

export function transitionExamRecordStatus(
  current: ExamRecordStatus,
  action: Exclude<ExamRecordAction, 'copy'>,
): ExamRecordStatus | null {
  return TRANSITIONS[action][current];
}
