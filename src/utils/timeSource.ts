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

export function isTimeSyncReady(): boolean {
  try {
    const ts = getAppSettings().general?.timeSync;
    if (!ts?.enabled) return true;
    return ts.lastSyncAt > 0 && Number.isFinite(ts.offsetMs);
  } catch { return false; }
}

export function nowMs(): number {
  const base = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.timeOrigin + performance.now()
    : Date.now();
  try {
    const ts = getAppSettings().general?.timeSync;
    if (ts?.enabled) {
      const net = Number.isFinite(ts.offsetMs) ? ts.offsetMs : 0;
      const man = Number.isFinite(ts.manualOffsetMs) ? ts.manualOffsetMs : 0;
      return base + net + man;
    }
  } catch {}
  return base;
}
