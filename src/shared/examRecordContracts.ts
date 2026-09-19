/** Persisted metadata for one MajorExam. The snapshot in exam_data remains authoritative. */
import type { ExamItem } from '../types/index.js';

export type ExamRecordStatus = 'draft' | 'published' | 'ended' | 'archived';

/**
 * Status shown by management views. `ongoing` 与 `stopping` 都是派生的：
 * 前者表示已经开考（系统按计划时间自动写 actualStartAt），
 * 后者表示管理员已申请停止、等系统判定是否真正结束。
 */
export type ExamRecordDisplayStatus = ExamRecordStatus | 'ongoing' | 'stopping';
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
  /**
   * 管理员申请停止的时刻；null 表示没有待判定的停止申请。
   * 有了它，手动「结束」就变成「申请停止」——真正落 ended 由系统判定（到点优先，
   * 其次全员回执，最后无在线设备的宽限兜底）。
   */
  stopRequestedAt?: number | null;
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
  stopping: '停止中',
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
  // 已申请停止：等系统判定，管理员只能强制结束（逃生门）或复制。
  if (context.status === 'stopping') return ['end', 'copy'];
  const live: ExamRecordActionName[] =
    context.actualStartAt == null
      ? ['start', 'extend', 'end', 'copy']
      : context.pausedAt != null
        ? ['resume', 'end', 'copy']
        : ['pause', 'extend', 'end', 'copy'];
  return live;
}

/**
 * 展示状态派生：管理界面「进行中 / 停止中」都由实际时间字段推出来，不落库。
 *
 * 与旧实现的区别：以前用「计划时间窗是否覆盖 now」判断进行中，于是会出现
 * 「界面显示进行中、但实际开考时间是空」的不一致。现在改为看 actualStartAt——
 * 系统按计划时间自动开考会写它，没到点就是「待开始」；申请停止后优先显示「停止中」。
 */
export function examRecordDisplayStatus(
  record: Pick<ExamRecord, 'status' | 'actualStartAt' | 'stopRequestedAt'>,
  _now: number,
): ExamRecordDisplayStatus {
  if (record.status !== 'published') return record.status;
  if (record.stopRequestedAt != null) return 'stopping';
  if (record.actualStartAt != null) return 'ongoing';
  return 'published';
}
