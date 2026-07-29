/**
 * 设计规则草稿缓存（补丁项 #13）
 *
 * saveDesignPolicy 失败时将 designPolicy 写入 localStorage，
 * 下次在管理页打开时提示用户是否恢复。
 */

import type { DesignPolicy } from '../types/exam';

const DRAFT_KEY = 'design_policy_pending_draft';

export interface DesignPolicyDraft {
  designPolicy: DesignPolicy;
  savedAt: number;
  errorMessage: string;
}

export function saveDesignPolicyDraft(designPolicy: DesignPolicy, errorMessage: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ designPolicy, savedAt: Date.now(), errorMessage }));
  } catch { /* 隐私模式下忽略 */ }
}

export function getDesignPolicyDraft(): DesignPolicyDraft | null {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return v && typeof v === 'object' && v.designPolicy ? v as DesignPolicyDraft : null;
  } catch { return null; }
}

export function clearDesignPolicyDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}
