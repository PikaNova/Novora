// 诊断包出站队列的纯策略：重试次数、退避与单次消费上限。
// 不依赖数据库或网络，便于单元测试固定这些边界；队列实现（_diagnosticQueue.ts）
// 必须复用这里，避免管理员端点与 Cron worker 各写一套退避规则。

export const MAX_RETRY_ATTEMPTS = 3;
/** 领取租约：worker 崩溃后，超时的 sending 记录会被下一次运行回收。 */
export const RETRY_CLAIM_TIMEOUT_MS = 10 * 60_000;
export const RETRY_BASE_DELAY_MS = 60_000;
export const RETRY_MAX_DELAY_MS = 60 * 60_000;
export const DEFAULT_DRAIN_LIMIT = 10;
export const MAX_DRAIN_LIMIT = 25;

/** 第 n 次失败后的等待时间：60s、120s、240s…封顶 1 小时。 */
export function retryDelayMs(attempts: number): number {
  const safeAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (safeAttempts - 1));
}

/** 单次 drain 的条数上限，防止一次请求被滥用成批量外发。 */
export function clampDrainLimit(value: unknown): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_DRAIN_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_DRAIN_LIMIT);
}

/** 发送失败后是否还值得重排；达到上限或已成功时返回 null。 */
export function nextAttemptAfterFailure(ok: boolean, attempts: number, now: number): number | null {
  if (ok || attempts >= MAX_RETRY_ATTEMPTS) return null;
  return now + retryDelayMs(attempts);
}
