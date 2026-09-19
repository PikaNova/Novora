/**
 * 考试生命周期「操作」纯函数：start / pause / resume / extend / end。
 * 与状态机（publish/end/archive/unarchive）互补：这里只算该写哪些字段，
 * 权限、写槽、审计与落库仍在路由层，便于单测覆盖在途状态的各种边界。
 */
import type { ExamRecord } from './examRecordContracts.js';

/**
 * 管理员可发起的时间字段操作：暂停 / 继续 / 延长 / 结束。
 * 「开考」不在这里——它由系统按计划时间自动完成（见 planAutoStart）。
 */
export type ExamOperationAction = 'pause' | 'resume' | 'extend' | 'end';

export type ExamOperationPatch = {
  status?: ExamRecord['status'];
  actualStartAt?: number;
  actualEndAt?: number;
  endAt?: number;
  pausedAt?: number | null;
  pausedMs?: number;
  stopRequestedAt?: number | null;
};

export type ExamOperationPlan =
  { ok: true; patch: ExamOperationPatch } | { ok: false; code: 'ILLEGAL_STATE' | 'MISSING_ARGUMENT'; error: string };

export const MAX_EXTEND_MINUTES = 600;

type PlanInput = Pick<
  ExamRecord,
  'status' | 'actualStartAt' | 'actualEndAt' | 'endAt' | 'pausedAt' | 'pausedMs' | 'stopRequestedAt'
>;

export function planExamOperation(
  record: PlanInput,
  input: { action: ExamOperationAction; at: number; extendMinutes?: number },
): ExamOperationPlan {
  const pausedAt = record.pausedAt ?? null;
  const pausedMs = record.pausedMs ?? 0;
  const live = record.status === 'published';
  const at = input.at;

  switch (input.action) {
    case 'pause':
      if (!live) return illegal('只有进行中的考试可以暂停');
      if (record.actualStartAt == null) return illegal('考试还未开考');
      if (pausedAt != null) return illegal('考试已在暂停中');
      return { ok: true, patch: { pausedAt: at } };
    case 'resume':
      if (!live) return illegal('只有进行中的考试可以继续');
      if (pausedAt == null) return illegal('考试当前不在暂停中');
      return { ok: true, patch: { pausedAt: null, pausedMs: pausedMs + Math.max(0, at - pausedAt) } };
    case 'extend': {
      if (!live) return illegal('只有已发布的考试可以延长');
      const minutes = Math.floor(Number(input.extendMinutes));
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_EXTEND_MINUTES)
        return { ok: false, code: 'MISSING_ARGUMENT', error: `延长分钟数需在 1-${MAX_EXTEND_MINUTES} 之间` };
      if (record.endAt == null) return illegal('考试没有结束时间，无法延长');
      return { ok: true, patch: { endAt: record.endAt + minutes * 60_000 } };
    }
    default:
      // end：结束的同时结算暂停时长，避免把暂停时间算进实际用时。
      if (record.status !== 'published' && record.status !== 'draft') return illegal('当前状态不能结束');
      return {
        ok: true,
        patch: {
          status: 'ended',
          actualEndAt: at,
          pausedAt: null,
          pausedMs: pausedAt == null ? pausedMs : pausedMs + Math.max(0, at - pausedAt),
        },
      };
  }
}

/** 倒计时基准：暂停期间不消耗考试时间。 */
export function effectiveEndAt(record: { endAt: number | null; pausedMs?: number }): number | null {
  if (record.endAt == null) return null;
  return record.endAt + (record.pausedMs ?? 0);
}

function illegal(error: string): ExamOperationPlan {
  return { ok: false, code: 'ILLEGAL_STATE', error };
}

/* ────────────────────────── 系统自动推进 ──────────────────────────
 * 生命周期约定（2026-09-19 定稿）：
 *   创建即发布 → 到点由系统自动开考 → 管理员只能「申请停止」→ 系统判定后才真正结束。
 * 下面三个规划器是纯函数，由读接口与设备心跳**惰性**调用（不依赖 Cron）：
 *   - 幂等：重复调用得到同样的跳过结果，不会重复写库、不会重复记审计；
 *   - 只算该写什么字段，权限/落库/审计仍在路由层。
 */

/** 自动推进被跳过的原因（都是正常情况，不是错误）。 */
export type ExamAutoSkipReason =
  | 'not-live'
  | 'missing-time'
  | 'not-due'
  | 'already-started'
  | 'already-requested'
  | 'no-stop-request'
  | 'not-finished';

/** 系统真正结束一场考试的原因，落进操作日志便于事后解释。 */
export type ExamAutoEndReason = 'timeup' | 'receipts' | 'no-device-timeout' | 'cancelled';

export type ExamAutoPlan =
  { ok: true; patch: ExamOperationPatch; reason?: ExamAutoEndReason } | { ok: false; reason: ExamAutoSkipReason };

/**
 * 自动开考：到计划开始时间，由系统补上实际开考时间。
 * 写入的是**计划时间**而不是 now——后台晚几分钟才有人打开页面时，开考时间仍然准确。
 */
export function planAutoStart(
  record: Pick<ExamRecord, 'status' | 'actualStartAt' | 'startAt'>,
  at: number,
): ExamAutoPlan {
  if (record.status !== 'published') return { ok: false, reason: 'not-live' };
  if (record.actualStartAt != null) return { ok: false, reason: 'already-started' };
  if (record.startAt == null) return { ok: false, reason: 'missing-time' };
  if (at < record.startAt) return { ok: false, reason: 'not-due' };
  return { ok: true, patch: { actualStartAt: record.startAt } };
}

/**
 * 申请停止：手动「结束」不再直接落 ended，只留一个待判定的申请。
 * 仍然要求考试是 published（draft/ended/archived 不能申请）。
 */
export function planStopRequest(record: Pick<ExamRecord, 'status' | 'stopRequestedAt'>, at: number): ExamAutoPlan {
  if (record.status !== 'published') return { ok: false, reason: 'not-live' };
  if (record.stopRequestedAt != null) return { ok: false, reason: 'already-requested' };
  return { ok: true, patch: { stopRequestedAt: at } };
}

export type ExamFinishSignals = {
  /** 本场范围内的绑定设备是否都已回执「本场结束」。 */
  allDevicesReported: boolean;
  /** 没有在线设备、且已经超过宽限期（无人监考兜底）。 */
  noDeviceGraceExpired: boolean;
};

/**
 * 系统判定结束：只在管理员申请停止之后才判定，优先级为
 *   ① 到点：now ≥ effectiveEndAt（end_at + paused_ms，暂停时间长出来的时间要补回来）
 *   ② 全员回执   ③ 无在线设备、宽限到期
 * 到点优先：即便还有设备没回执，时间到就结束。
 */
export function planAutoEnd(
  record: Pick<
    ExamRecord,
    'status' | 'actualStartAt' | 'endAt' | 'pausedAt' | 'pausedMs' | 'stopRequestedAt' | 'actualEndAt'
  >,
  at: number,
  signals: ExamFinishSignals,
): ExamAutoPlan {
  if (record.status !== 'published') return { ok: false, reason: 'not-live' };
  const pausedAt = record.pausedAt ?? null;
  const pausedMs = record.pausedMs ?? 0;
  // 结束同时结算暂停时长，避免把暂停算进实际用时（与手动 end 同一套口径）。
  const settle = (endedAt: number): ExamOperationPatch => ({
    status: 'ended',
    actualEndAt: endedAt,
    pausedAt: null,
    pausedMs: pausedAt == null ? pausedMs : pausedMs + Math.max(0, endedAt - pausedAt),
    stopRequestedAt: null,
  });
  const dueAt = effectiveEndAt(record);
  // 没有停止申请时：只有「已经开考且到点」才自动结束——下课的钟不需要人来敲。
  if (record.stopRequestedAt == null) {
    if (record.actualStartAt != null && dueAt != null && at >= dueAt) {
      return { ok: true, patch: settle(dueAt), reason: 'timeup' };
    }
    return { ok: false, reason: 'no-stop-request' };
  }
  // 还没开考就申请停止 = 取消这场考试：没有任何在途的考试需要等，直接结束。
  if (record.actualStartAt == null) return { ok: true, patch: settle(at), reason: 'cancelled' };
  if (dueAt != null && at >= dueAt) return { ok: true, patch: settle(dueAt), reason: 'timeup' };
  if (signals.allDevicesReported) return { ok: true, patch: settle(at), reason: 'receipts' };
  if (signals.noDeviceGraceExpired) return { ok: true, patch: settle(at), reason: 'no-device-timeout' };
  return { ok: false, reason: 'not-finished' };
}
