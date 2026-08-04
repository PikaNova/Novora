import { useEffect, useState } from 'react';
import { computeRemainingSeconds } from '../utils/retryCountdown';

export function useRetryCountdown(lockedUntil: number | null): number {
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!lockedUntil) return;
    const timer = globalThis.setInterval(() => forceRender(value => value + 1), 500);
    return () => globalThis.clearInterval(timer);
  }, [lockedUntil]);

  return lockedUntil ? computeRemainingSeconds(lockedUntil) : 0;
}
