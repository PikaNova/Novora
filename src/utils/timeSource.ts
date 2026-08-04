import { getAppSettings } from './appSettings';
export {
  DISPLAY_TIME_ZONE,
  formatClockInZone,
  formatDateTimeInZone,
  getZonedParts,
  parseZonedTime,
  type ZonedParts,
} from './zonedTime';

export function isNetworkTimeEnabled(): boolean {
  try { return !!getAppSettings().general?.timeSync?.enabled; } catch { return false; }
}

function isNetworkOffsetFresh(ts: {
  autoSyncEnabled?: boolean;
  autoSyncIntervalSec?: number;
  lastSyncAt?: number;
  offsetMs?: number;
}): boolean {
  if (!Number.isFinite(ts.offsetMs) || !Number.isFinite(ts.lastSyncAt) || !ts.lastSyncAt) return false;
  const intervalMs = Math.max(10, Number(ts.autoSyncIntervalSec) || 900) * 1000;
  const maxAgeMs = ts.autoSyncEnabled === false
    ? 2 * 60 * 60 * 1000
    : Math.max(10 * 60 * 1000, intervalMs * 2);
  return Date.now() - ts.lastSyncAt <= maxAgeMs;
}

export function isTimeSyncReady(): boolean {
  try {
    const ts = getAppSettings().general?.timeSync;
    if (!ts?.enabled) return true;
    return isNetworkOffsetFresh(ts);
  } catch { return false; }
}

export function nowMs(): number {
  const base = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.timeOrigin + performance.now()
    : Date.now();
  try {
    const ts = getAppSettings().general?.timeSync;
    if (ts?.enabled) {
      const net = isNetworkOffsetFresh(ts) ? ts.offsetMs : 0;
      const man = Number.isFinite(ts.manualOffsetMs) ? ts.manualOffsetMs : 0;
      return base + net + man;
    }
  } catch {}
  return base;
}
