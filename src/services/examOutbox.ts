import type { AlertsSettings, ExamItem, MajorExam } from '../types';
import type { ExamPayload } from './examService';
import { saveExamsToServer } from './examService';
import { threeWayMergeExam } from '../utils/examMerge';
import { recordSyncConflict } from './offlineStore';

const OUTBOX_KEY = 'exam_pending_sync';

export interface PendingExamSync {
  payload: {
    items: ExamItem[];
    title: string;
    majors: MajorExam[];
    activeMajorId: string;
    alerts: AlertsSettings | null;
  };
  /** 编辑发生前最后一个已知云端完整快照，用于恢复网络后的三方合并。 */
  baseSnapshot: ExamPayload | null;
  savedAt: number;
  retryCount?: number;
  lastAttemptAt?: number;
  lastError?: string;
  nextRetryAt?: number;
}

export type FlushResult =
  | { kind: 'none' }
  | { kind: 'saved'; payload: PendingExamSync['payload']; updatedAt: number }
  | { kind: 'offline' | 'deferred' | 'error' | 'unauthorized' };

export function getPendingExamSync(): PendingExamSync | null {
  try {
    const value = JSON.parse(localStorage.getItem(OUTBOX_KEY) || 'null') as PendingExamSync | null;
    if (!value || !value.payload || !Array.isArray(value.payload.items) || !Array.isArray(value.payload.majors)) return null;
    return value;
  } catch { return null; }
}

export function queuePendingExamSync(pending: PendingExamSync): void {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(pending)); } catch { /* 隐私模式下仍保留 AppSettings 本地数据 */ }
}

/** 仅清除指定那一次保存，避免旧请求完成时误删后续编辑形成的新待办。 */
export function clearPendingExamSync(savedAt?: number): void {
  const current = getPendingExamSync();
  if (savedAt != null && current?.savedAt !== savedAt) return;
  try { localStorage.removeItem(OUTBOX_KEY); } catch { /* ignore */ }
}

function markPendingFailure(pending: PendingExamSync, message: string): void {
  const retryCount = (pending.retryCount ?? 0) + 1;
  const waitMs = Math.min(60000, [5000, 15000, 30000][Math.min(retryCount - 1, 2)]);
  queuePendingExamSync({ ...pending, retryCount, lastAttemptAt: Date.now(), lastError: message, nextRetryAt: Date.now() + waitMs });
}

/** 恢复网络后冲刷本机离线编辑；若云端也变更则自动三方合并并重试。 */
export async function flushPendingExamSync(force = false): Promise<FlushResult> {
  const pending = getPendingExamSync();
  if (!pending) return { kind: 'none' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { kind: 'offline' };
  if (!force && pending.nextRetryAt && pending.nextRetryAt > Date.now()) return { kind: 'deferred' };

  const first = await saveExamsToServer({ ...pending.payload, baseUpdatedAt: pending.baseSnapshot?.updatedAt ?? 0 });
  if (typeof first === 'number') {
    clearPendingExamSync(pending.savedAt);
    return { kind: 'saved', payload: pending.payload, updatedAt: first };
  }
  if (first === 'unauthorized') return { kind: 'unauthorized' };
  if (first == null || !first.remote) { markPendingFailure(pending, '云端暂不可用'); return { kind: 'error' }; }

  const merged = threeWayMergeExam(pending.baseSnapshot ?? first.remote, { ...pending.payload, updatedAt: pending.baseSnapshot?.updatedAt ?? 0 }, first.remote);
  if (merged.conflictCount) void recordSyncConflict(merged.conflictCount, pending.payload, first.remote);
  const mergedPending: PendingExamSync = {
    payload: merged.payload,
    baseSnapshot: first.remote,
    savedAt: Date.now(),
  };
  queuePendingExamSync(mergedPending);
  const retry = await saveExamsToServer({ ...merged.payload, baseUpdatedAt: first.remote.updatedAt });
  if (typeof retry !== 'number') {
    if (retry === 'unauthorized') return { kind: 'unauthorized' };
    markPendingFailure(mergedPending, '合并后上传失败');
    return { kind: 'error' };
  }
  clearPendingExamSync(mergedPending.savedAt);
  return { kind: 'saved', payload: merged.payload, updatedAt: retry };
}
