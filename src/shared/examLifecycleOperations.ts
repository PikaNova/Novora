/**
 * 考试生命周期「操作」纯函数：start / pause / resume / extend / end。
 * 与状态机（publish/end/archive/unarchive）互补：这里只算该写哪些字段，
 * 权限、写槽、审计与落库仍在路由层，便于单测覆盖在途状态的各种边界。
 */
import type { ExamRecord } from './examRecordContracts.js';

export type ExamOperationAction = 'start' | 'pause' | 'resume' | 'extend' | 'end';

export type ExamOperationPatch = {
  status?: ExamRecord['status'];
  actualStartAt?: number;
  actualEndAt?: number;
  endAt?: number;
  pausedAt?: number | null;
  pausedMs?: number;
};

export type ExamOperationPlan =
  { ok: true; patch: ExamOperationPatch } | { ok: false; code: 'ILLEGAL_STATE' | 'MISSING_ARGUMENT'; error: string };

export const MAX_EXTEND_MINUTES = 600;

type PlanInput = Pick<ExamRecord, 'status' | 'actualStartAt' | 'actualEndAt' | 'endAt' | 'pausedAt' | 'pausedMs'>;

export function planExamOperation(
  record: PlanInput,
  input: { action: ExamOperationAction; at: number; extendMinutes?: number },
): ExamOperationPlan {
  const pausedAt = record.pausedAt ?? null;
  const pausedMs = record.pausedMs ?? 0;
  const live = record.status === 'published';
  const at = input.at;

  switch (input.action) {
    case 'start':
      if (!live) return illegal('只有已发布的考试可以开考');
      if (record.actualStartAt != null) return illegal('本场考试已经开考');
      return { ok: true, patch: { actualStartAt: at } };
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
