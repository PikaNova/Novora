import { useEffect, useState } from 'react';
import { computeRemainingSeconds } from '../utils/retryCountdown';

export function useRetryCountdown(lockedUntil: number | null): number {
  const [remaining, setRemaining] = useState(() => lockedUntil ? computeRemainingSeconds(lockedUntil) : 0);

  useEffect(() => {
    if (!lockedUntil) {
      setRemaining(0);
      return;
    }
    setRemaining(computeRemainingSeconds(lockedUntil));
    const timer = window.setInterval(() => setRemaining(computeRemainingSeconds(lockedUntil)), 500);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  return remaining;
}
