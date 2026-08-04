export function computeLockedUntil(retryAfterMs: number, now = Date.now()): number {
  return now + Math.max(0, retryAfterMs);
}

export function computeRemainingSeconds(lockedUntil: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((lockedUntil - now) / 1_000));
}

export function formatRetryMessage(remainingSeconds: number, prefix: string): string {
  return remainingSeconds > 0 ? `${prefix}，请 ${remainingSeconds} 秒后再试` : '';
}

/**
 * API errors can cross independently-loaded client chunks, where `instanceof`
 * is not reliable. Recognize the server contract rather than its prototype.
 */
export function loginLockoutRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; retryAfterMs?: unknown };
  if (value.code !== 'LOGIN_LOCKED' || typeof value.retryAfterMs !== 'number' || !Number.isFinite(value.retryAfterMs)) return null;
  return value.retryAfterMs > 0 ? value.retryAfterMs : null;
}
