/** Persisted metadata for one MajorExam. The snapshot in exam_data remains authoritative. */
import type { ExamItem } from '../types/index.js';

export type ExamRecordStatus = 'draft' | 'published' | 'ended' | 'archived';

/** Status shown by management views; ongoing is derived from the time window. */
export type ExamRecordDisplayStatus = ExamRecordStatus | 'ongoing';
export type ExamRecordAction = 'publish' | 'end' | 'archive' | 'unarchive' | 'copy';

/** 只改时间字段的生命周期操作，与上面的状态机动作互补。 */
export type ExamRecordOperationActionName = 'start' | 'pause' | 'resume' | 'extend';

/** 管理界面可以对一场考试发起的全部动作。 */
export type ExamRecordActionName = ExamRecordAction | ExamRecordOperationActionName;

/** 每个动作需要的权限：服务端裁决与前端按钮可见性共用同一份映射，避免两边漂移。 */
export const EXAM_RECORD_ACTION_PERMISSIONS = {
  publish: 'major.edit',
  start: 'major.edit',
  pause: 'major.edit',
  resume: 'major.edit',
  extend: 'major.edit',
  end: 'major.edit',
  unarchive: 'major.edit',
  archive: 'major.delete',
  copy: 'major.create',
} as const satisfies Record<ExamRecordActionName, string>;

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

/** 管理界面统一使用的展示文案；ongoing 是派生的「进行中」。 */
export const EXAM_RECORD_STATUS_LABELS: Record<ExamRecordDisplayStatus, string> = {
  draft: '草稿',
  published: '待开始',
  ongoing: '进行中',
  ended: '已结束',
  archived: '历史归档',
};

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

/** 管理界面判断「何时该出现哪个按钮」用的最小上下文。 */
export type ExamRecordActionContext = {
  status: ExamRecordDisplayStatus;
  actualStartAt: number | null;
  pausedAt: number | null;
};

/**
 * 某个展示状态下可执行的动作，按「先做的在前」排序。
 *
 * 这里只决定按钮是否出现，真正的裁决仍在服务端：`planExamOperation` 与状态机
 * 会拒掉非法动作并返回 409。界面上先收口是为了少给用户一条必然报错的路径，
 * 不是为了把校验搬到前端。
 */
export function availableExamRecordActions(context: ExamRecordActionContext): ExamRecordActionName[] {
  if (context.status === 'draft') return ['publish', 'copy'];
  if (context.status === 'ended') return ['archive', 'copy'];
  if (context.status === 'archived') return ['unarchive', 'copy'];
  const live: ExamRecordActionName[] =
    context.actualStartAt == null
      ? ['start', 'extend', 'end', 'copy']
      : context.pausedAt != null
        ? ['resume', 'end', 'copy']
        : ['pause', 'extend', 'end', 'copy'];
  return live;
}
