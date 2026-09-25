/** Add deterministic positive jitter so many clients do not poll in the same second. */
export function jitteredIntervalMs(intervalMs: number, random: () => number = Math.random): number {
  const base = Math.max(0, Math.floor(intervalMs));
  const jitter = Math.floor(random() * (base * 0.15 + 1));
  return base + jitter;
}
