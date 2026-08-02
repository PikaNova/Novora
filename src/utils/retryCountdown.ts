export function computeLockedUntil(retryAfterMs: number, now = Date.now()): number {
  return now + Math.max(0, retryAfterMs);
}

export function computeRemainingSeconds(lockedUntil: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((lockedUntil - now) / 1_000));
}

export function formatRetryMessage(remainingSeconds: number, prefix: string): string {
  return remainingSeconds > 0 ? `${prefix}，请 ${remainingSeconds} 秒后再试` : '';
}
