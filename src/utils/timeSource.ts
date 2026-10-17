import { getAppSettings } from './appSettings';
import { logger } from './logger';
import type { TimeSyncSettings } from './settings/timeSync';
export {
  DISPLAY_TIME_ZONE,
  formatClockInZone,
  formatDateTimeInZone,
  getZonedParts,
  parseZonedTime,
  type ZonedParts,
} from './zonedTime';

/**
 * Date.now() can jump when the device clock is corrected.  performance.now()
 * is monotonic, so anchor it once and use that timeline for all live clocks.
 * Live network calibrations are anchored in memory on this timeline; shared
 * settings never supply a page-relative offset after initialization.
 */
const sessionEpochAtMonotonicZero = Date.now() - (typeof performance !== 'undefined' ? performance.now() : 0);

export function monotonicNowMs(): number {
  return sessionEpochAtMonotonicZero + (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

export function isNetworkTimeEnabled(): boolean {
  try {
    return !!getAppSettings().general?.timeSync?.enabled;
  } catch {
    return false;
  }
}

// Calibration anchors are private to this page. Shared storage contains only
// portable server/wall-clock timestamps, never another page's offset timeline.
let calibration: { epochMs: number; baseMs: number; receivedMs: number; revision: number } | null = null;
let initialized = false;
let staleLogged = false;

export function applyTimeCalibration(epochMs: number, revision: number, ageMs = 0): void {
  if (!Number.isFinite(epochMs) || !Number.isFinite(revision) || epochMs <= 0 || epochMs > 8.64e15) return;
  if (calibration && revision <= calibration.revision) return;
  const baseMs = monotonicNowMs();
  const previous = calibration ? calibration.epochMs + baseMs - calibration.baseMs : baseMs;
  calibration = { epochMs, baseMs, receivedMs: baseMs - Math.max(0, ageMs), revision };
  staleLogged = false;
  logger.info(
    '时钟校准: ' +
      JSON.stringify({
        previous,
        epochMs,
        deltaMs: epochMs - previous,
        revision,
        page: typeof location === 'undefined' ? '' : location.pathname,
      }),
  );
}

function settings(): TimeSyncSettings | null {
  try {
    return getAppSettings().general.timeSync;
  } catch {
    return null;
  }
}

function initialize(ts: TimeSyncSettings): void {
  if (initialized || calibration) return;
  initialized = true;
  // A restart can only extrapolate from a wall-clock timestamp. Never reuse
  // a persisted page offset against the new session's monotonic origin.
  const ageMs = Date.now() - ts.lastSyncAt;
  if (Number.isFinite(ts.lastSyncServerAt) && Number(ts.lastSyncServerAt) > 0 && ageMs >= 0) {
    applyTimeCalibration(Number(ts.lastSyncServerAt) + ageMs, ts.calibrationRevision || ts.lastSyncAt, ageMs);
  }
}

export function hasTimeCalibration(): boolean {
  return calibration !== null;
}
export function calibratedNowMs(): number {
  const base = monotonicNowMs();
  return calibration ? calibration.epochMs + base - calibration.baseMs : base;
}

export function isTimeSyncReady(): boolean {
  const ts = settings();
  if (!ts) return false;
  initialize(ts);
  if (!ts.enabled) return true;
  const intervalMs = Math.max(10, Number(ts.autoSyncIntervalSec) || 900) * 1000;
  const maxAgeMs = ts.autoSyncEnabled === false ? 7_200_000 : Math.max(600_000, intervalMs * 2);
  const fresh = !!calibration && monotonicNowMs() - calibration.receivedMs <= maxAgeMs;
  if (calibration && !fresh && !staleLogged) {
    staleLogged = true;
    logger.warn('校时过期: 继续沿用最后可靠时钟');
  }
  return fresh;
}

export function nowMs(): number {
  const ts = settings();
  if (ts) initialize(ts);
  const base = ts?.enabled ? calibratedNowMs() : monotonicNowMs();
  const manualOffset = ts?.enabled && Number.isFinite(ts.manualOffsetMs) ? ts.manualOffsetMs : 0;
  const broadcastOffset = ts && Number.isFinite(ts.broadcastOffsetMs) ? Number(ts.broadcastOffsetMs) : 0;
  return base + manualOffset + broadcastOffset;
}

export function nowWithoutBroadcastOffsetMs(): number {
  const ts = settings();
  if (ts) initialize(ts);
  const base = ts?.enabled ? calibratedNowMs() : monotonicNowMs();
  return base + (ts?.enabled && Number.isFinite(ts.manualOffsetMs) ? ts.manualOffsetMs : 0);
}

// One page-wide ticker feeds classroom consumers, including notifications.
const listeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
export function subscribeClock(listener: () => void): () => void {
  listeners.add(listener);
  if (!clockTimer)
    clockTimer = setInterval(() => {
      for (const notify of listeners) notify();
    }, 500);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
