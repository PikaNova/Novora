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
  'status' | 'startAt' | 'actualStartAt' | 'actualEndAt' | 'endAt' | 'pausedAt' | 'pausedMs'
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
    case 'pause': {
      if (!live) return illegal('只有进行中的考试可以暂停');
      if (pausedAt != null) return illegal('考试已在暂停中');
      /**
       * 手动暂停**不等系统的到点校验**：管理员按下暂停就该停。
       *
       * 自动开考（planAutoStart）是惰性的——靠读接口 / 设备心跳触发，没人打开页面时
       * `actualStartAt` 会一直是空，于是「暂停」按钮根本不出现、接口也报「考试还未开考」。
       * 处理方式：没开考就先补开考时间，保持「暂停中必然已开考」这条不变量成立：
       *   - 计划开始时间已过 → 补记计划时间（等于把漏掉的自动开考补上，开考时间仍然准）；
       *   - 还没到点 → 记此刻（提前开考，随后立即暂停）。
       */
      const patch: ExamOperationPatch = { pausedAt: at };
      if (record.actualStartAt == null) {
        patch.actualStartAt = record.startAt != null && record.startAt <= at ? record.startAt : at;
      }
      return { ok: true, patch };
    }
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
          // 历史数据里可能还有「申请停止」留下的时间戳，结束就一并清掉。
          stopRequestedAt: null,
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
 *   创建即发布 → 到点由系统自动开考 → 到点由系统自动结束；管理员随时可以手动结束。
 *
 * 2026-09-25 修订：去掉「申请停止 → 等系统判定」这一层。手动结束直接落 ended，
 * 不再等设备回执，也不再等无设备宽限；留在系统这一侧的只有「到点收场」。
 * 下面三个规划器是纯函数，由读接口与设备心跳**惰性**调用（不依赖 Cron）：
 *   - 幂等：重复调用得到同样的跳过结果，不会重复写库、不会重复记审计；
 *   - 只算该写什么字段，权限/落库/审计仍在路由层。
 */

/** 自动推进被跳过的原因（都是正常情况，不是错误）。 */
export type ExamAutoSkipReason = 'not-live' | 'not-started' | 'missing-time' | 'not-due' | 'already-started';

/** 系统真正结束一场考试的原因，落进操作日志便于事后解释。 */
export type ExamAutoEndReason = 'timeup';

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
 * 系统收场：只有「已经开考且到点」才自动结束——下课的钟不需要人来敲。
 *
 * 结束同时结算暂停时长，避免把暂停算进实际用时（与手动 end 同一套口径）；
 * 到点时刻结束（`dueAt`），而不是发现它的那一刻，晚开页面也不会把结束时间记晚。
 */
export function planAutoEnd(
  record: Pick<ExamRecord, 'status' | 'actualStartAt' | 'endAt' | 'pausedAt' | 'pausedMs'>,
  at: number,
): ExamAutoPlan {
  if (record.status !== 'published') return { ok: false, reason: 'not-live' };
  if (record.actualStartAt == null) return { ok: false, reason: 'not-started' };
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
  if (dueAt == null) return { ok: false, reason: 'missing-time' };
  if (at < dueAt) return { ok: false, reason: 'not-due' };
  return { ok: true, patch: settle(dueAt), reason: 'timeup' };
}
