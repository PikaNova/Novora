import type { AlertsSettings, ExamItem, MajorExam } from '../types';
import type { ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import type { ExamSettings } from '../utils/appSettings';
import type { ExamPayload } from './examService';
import { saveExamsToServer } from './examService';
import { threeWayMergeExam } from '../utils/examMerge';
import { recordSyncConflict } from './offlineStore';
import { ApiError } from './apiError';

const OUTBOX_KEY = 'exam_pending_sync';

/**
 * 单个 fingerprint 最大自动重试次数。超过后将 nextRetryAt 设为 Infinity 并停止自动重试。
 * 不可重试的错误（如 ALREADY_INITIALIZED、PERMISSION_DENIED）会跳过此限制直接达到 Infinity。
 */
const MAX_AUTO_RETRIES = 10;

/** 网络类错误与服务器错误的分级重试基准时间 */
const NETWORK_RETRY_BASE_MS = 3_000; // 网络类：3s 起步
const RATE_LIMIT_RETRY_BASE_MS = 1_000;
const RATE_LIMIT_RETRY_CAP_MS = 8_000;

const isNetworkError = (error: ApiError) =>
  error.code === 'NETWORK_UNAVAILABLE' ||
  error.code === 'NETWORK_TIMEOUT' ||
  error.code === 'DATABASE_UNAVAILABLE' ||
  error.code === 'DATABASE_TIMEOUT';

const isRateLimitedError = (error: ApiError) => error.code === 'RATE_LIMITED';

export interface PendingExamSync {
  payload: {
    items: ExamItem[];
    title: string;
    majors: MajorExam[];
    activeMajorId: string;
    alerts: AlertsSettings | null;
    scheduleMode?: ScheduleMode;
    weeklyPlans?: WeeklyPlan[];
    activeWeeklyPlanId?: string | null;
    activeWeeklyPlanIdByClassId?: Record<string, string | null>;
    grades?: SchoolGrade[];
    classes?: SchoolClass[];
    initialization?: ExamSettings['initialization'];
    weeklyConflictPolicy?: WeeklyConflictPolicy | null;
  };
  /**
   * 编辑发生前最后一个已知云端完整快照，用于恢复网络后的三方合并。
   */
  baseSnapshot: ExamPayload | null;
  savedAt: number;
  retryCount?: number;
  lastAttemptAt?: number;
  lastError?: string;
  /**
   * 下次允许自动重试的时间戳（ms）。
   * `Infinity` 表示需用户手动触发（force=true）。
   */
  nextRetryAt?: number;
}

export type FlushResult =
  | { kind: 'none' }
  | { kind: 'saved'; payload: PendingExamSync['payload']; updatedAt: number }
  | { kind: 'offline' | 'deferred' | 'error' | 'unauthorized' | 'max-retries' };

export function getPendingExamSync(): PendingExamSync | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(OUTBOX_KEY) || 'null',
    ) as PendingExamSync | null;
    if (
      !value ||
      !value.payload ||
      !Array.isArray(value.payload.items) ||
      !Array.isArray(value.payload.majors)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function queuePendingExamSync(pending: PendingExamSync): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(pending));
  } catch {
    /* 隐私模式下仍保留 AppSettings 本地数据 */
  }
}

/** 仅清除指定那一次保存，避免旧请求完成时误删后续编辑形成的新待办。 */
export function clearPendingExamSync(savedAt?: number): void {
  const current = getPendingExamSync();
  if (savedAt != null && current?.savedAt !== savedAt) return;
  try {
    localStorage.removeItem(OUTBOX_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 记录一次重试失败并更新 outbox。
 *
 * 退避策略：
 * - 不可重试错误（retryable=false）：直接设为 Infinity，需用户介入
 * - 网络类错误：3s*2^(n-1)，上限 30s（网络恢复即可重试）
 * - 服务器错误：5s*2^(n-1)，上限 60s
 * - 超过 MAX_AUTO_RETRIES：设为 Infinity。
 */
function markPendingFailure(
  pending: PendingExamSync,
  error: ApiError | string,
): void {
  const message = error instanceof ApiError ? error.message : error;
  const isRetryable =
    error instanceof ApiError ? error.retryable : true;
  const isNetwork =
    error instanceof ApiError && isNetworkError(error);
  const isRateLimited =
    error instanceof ApiError && isRateLimitedError(error);
  const retryCount = (pending.retryCount ?? 0) + 1;

  // 不可重试错误直接进入 max-retries 状态
  if (!isRetryable) {
    queuePendingExamSync({
      ...pending,
      retryCount,
      lastAttemptAt: Date.now(),
      lastError: `${message}（错误不可自动重试，请手动处理）`,
      nextRetryAt: Infinity,
    });
    return;
  }

  if (retryCount > MAX_AUTO_RETRIES) {
    queuePendingExamSync({
      ...pending,
      retryCount,
      lastAttemptAt: Date.now(),
      lastError: `已自动重试 ${MAX_AUTO_RETRIES} 次，${message}。请手动刷新页面或联系管理员。`,
      nextRetryAt: Infinity,
    });
    return;
  }

  // 限流错误：1s*2^(n-1)，上限 8s（服务端窗口很短）
  // 网络错误：3s*2^(n-1)，上限 30s（恢复后快速重试）
  // 服务器错误：5s*2^(n-1)，上限 60s
  const base = isRateLimited
    ? RATE_LIMIT_RETRY_BASE_MS
    : isNetwork
      ? NETWORK_RETRY_BASE_MS
      : 5_000;
  const cap = isRateLimited ? RATE_LIMIT_RETRY_CAP_MS : isNetwork ? 30_000 : 60_000;
  const waitMs = Math.min(cap, base * Math.pow(2, retryCount - 1));
  queuePendingExamSync({
    ...pending,
    retryCount,
    lastAttemptAt: Date.now(),
    lastError: message,
    nextRetryAt: Date.now() + waitMs,
  });
}

/**
 * 检测“幽灵保存”：POST 已在服务端应用，但响应在传输中丢失。
 *
 * 典型场景：
 * 1. POST 成功，但响应因冷启动延迟 / 网络抖动未到达客户端
 * 2. 客户端保留旧 outbox，下次 flush 发送旧 baseUpdatedAt
 * 3. 服务端返回 409，携带 remote
 * 4. 此时如果 remote 内容与本地 payload 完全相同，
 *    说明是幽灵保存，直接视为成功而非触发三方合并。
 *
 * 只比较本次待同步 payload 明确携带的字段：
 * 周测、班级等字段可能与大型考试 items/title 独立变化，不能只用大型考试镜像字段判断成功。
 */
function detectGhostSave(
  pending: PendingExamSync,
  remote: ExamPayload,
): boolean {
  const base = pending.baseSnapshot?.updatedAt ?? 0;
  // remote 的 updatedAt 必须大于 base
  if (remote.updatedAt <= base) return false;
  // 且在最近 120s 内（超过则是其他人修改）
  if (Date.now() - remote.updatedAt > 120_000) return false;
  const sameJson = (left: unknown, right: unknown) =>
    JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  const sameRequired = [
    sameJson(pending.payload.items, remote.items),
    pending.payload.title === remote.title,
    sameJson(pending.payload.majors, remote.majors),
    pending.payload.activeMajorId === remote.activeMajorId,
    sameJson(pending.payload.alerts, remote.alerts),
  ];
  if (pending.payload.scheduleMode !== undefined)
    sameRequired.push(pending.payload.scheduleMode === remote.scheduleMode);
  if (pending.payload.weeklyPlans !== undefined)
    sameRequired.push(sameJson(pending.payload.weeklyPlans, remote.weeklyPlans));
  if (pending.payload.activeWeeklyPlanId !== undefined)
    sameRequired.push(
      pending.payload.activeWeeklyPlanId === remote.activeWeeklyPlanId,
    );
  if (pending.payload.activeWeeklyPlanIdByClassId !== undefined)
    sameRequired.push(
      sameJson(
        pending.payload.activeWeeklyPlanIdByClassId,
        remote.activeWeeklyPlanIdByClassId,
      ),
    );
  if (pending.payload.grades !== undefined)
    sameRequired.push(sameJson(pending.payload.grades, remote.grades));
  if (pending.payload.classes !== undefined)
    sameRequired.push(sameJson(pending.payload.classes, remote.classes));
  if (pending.payload.initialization !== undefined)
    sameRequired.push(
      sameJson(pending.payload.initialization, remote.initialization),
    );
  if (pending.payload.weeklyConflictPolicy !== undefined)
    sameRequired.push(
      sameJson(
        pending.payload.weeklyConflictPolicy,
        remote.weeklyConflictPolicy,
      ),
    );
  return sameRequired.every(Boolean);
}

/** 恢复网络后冲刷本地离线编辑；若云端也变更则自动三方合并并重试。 */
export async function flushPendingExamSync(
  force = false,
): Promise<FlushResult> {
  const pending = getPendingExamSync();
  if (!pending) return { kind: 'none' };
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return { kind: 'offline' };

  if (!force && pending.nextRetryAt === Infinity)
    return { kind: 'max-retries' };
  if (
    !force &&
    pending.nextRetryAt &&
    pending.nextRetryAt > Date.now()
  )
    return { kind: 'deferred' };

  const first = await saveExamsToServer({
    ...pending.payload,
    baseUpdatedAt: pending.baseSnapshot?.updatedAt ?? 0,
  });

  // ── 保存成功 ─────────────────────────────────────────────────────────────────────
  if (typeof first === 'number') {
    clearPendingExamSync(pending.savedAt);
    return { kind: 'saved', payload: pending.payload, updatedAt: first };
  }

  // ── 鉴权失效 ──────────────────────────────────────────────────────────────────────
  if (first === 'unauthorized') return { kind: 'unauthorized' };

  // ── 冲突：可能是幽灵保存，也可能是真实冲突 ──────────────────────────────────────────
  if (
    first &&
    typeof first === 'object' &&
    first.kind === 'conflict'
  ) {
    if (first.remote && detectGhostSave(pending, first.remote)) {
      // 服务端数据与本地一致，上次 POST 已成功但响应未到达（幽灵保存）
      console.info(
        '[examOutbox] ghost save detected: remote matches local, accepting remote updatedAt',
      );
      clearPendingExamSync(pending.savedAt);
      return {
        kind: 'saved',
        payload: pending.payload,
        updatedAt: first.remote.updatedAt,
      };
    }
    // 真实冲突：继续到三方合并流程
  } else {
    // null 或 { kind: 'error' }
    const apiError =
      first && typeof first === 'object' && first.kind === 'error'
        ? first.error
        : null;
    markPendingFailure(
      pending,
      apiError ??
        new ApiError({
          status: 503,
          code: 'DATABASE_UNAVAILABLE',
          message: '云端暂不可用，本地数据已保留。',
          retryable: true,
        }),
    );
    return { kind: 'error' };
  }

  // ── 三方合并 ────────────────────────────────────────────────────────────────────────
  const remote = first.remote!;
  let merged: ReturnType<typeof threeWayMergeExam>;
  try {
    merged = threeWayMergeExam(
      pending.baseSnapshot ?? remote,
      {
        ...pending.payload,
        updatedAt: pending.baseSnapshot?.updatedAt ?? 0,
      },
      remote,
    );
  } catch (mergeErr) {
    console.error('[examOutbox] three-way merge failed', mergeErr);
    markPendingFailure(
      pending,
      new ApiError({
        status: 0,
        code: 'MERGE_FAILED',
        message: '本地数据合并失败，将在下次重试。',
        retryable: true,
      }),
    );
    return { kind: 'error' };
  }

  if (merged.conflictCount)
    void recordSyncConflict(merged.conflictCount, pending.payload, remote);

  const mergedPayload: PendingExamSync['payload'] = {
    ...merged.payload,
    scheduleMode:
      pending.payload.scheduleMode ?? remote.scheduleMode,
    weeklyPlans:
      pending.payload.weeklyPlans ?? remote.weeklyPlans,
    activeWeeklyPlanId:
      pending.payload.activeWeeklyPlanId !== undefined
        ? pending.payload.activeWeeklyPlanId
        : remote.activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId:
      pending.payload.activeWeeklyPlanIdByClassId ??
      remote.activeWeeklyPlanIdByClassId,
    grades: pending.payload.grades ?? remote.grades,
    classes: pending.payload.classes ?? remote.classes,
    initialization:
      pending.payload.initialization ?? remote.initialization,
    weeklyConflictPolicy:
      pending.payload.weeklyConflictPolicy ??
      remote.weeklyConflictPolicy,
  };

  const mergedPending: PendingExamSync = {
    payload: mergedPayload,
    baseSnapshot: remote,
    savedAt: Date.now(),
  };
  queuePendingExamSync(mergedPending);

  const retry = await saveExamsToServer({
    ...mergedPayload,
    baseUpdatedAt: remote.updatedAt,
  });
  if (typeof retry !== 'number') {
    if (retry === 'unauthorized') return { kind: 'unauthorized' };
    const retryError =
      retry && typeof retry === 'object' && retry.kind === 'error'
        ? retry.error
        : null;
    markPendingFailure(
      mergedPending,
      retryError ??
        new ApiError({
          status: 0,
          code: 'DATABASE_WRITE_FAILED',
          message: '合并后上传失败，将在下次重试。',
          retryable: true,
        }),
    );
    return { kind: 'error' };
  }
  clearPendingExamSync(mergedPending.savedAt);
  return { kind: 'saved', payload: mergedPayload, updatedAt: retry };
}
