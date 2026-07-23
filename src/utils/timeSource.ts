import { getAppSettings } from './appSettings';

export const DISPLAY_TIME_ZONE = 'Asia/Shanghai';

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

export interface ZonedParts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number; weekday: number;
}

const WEEKDAY_MAP: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

export function getZonedParts(ms: number, timeZone = DISPLAY_TIME_ZONE): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', weekday:'short',
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(get('year'), 10), month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10), hour, minute: parseInt(get('minute'), 10),
    second: parseInt(get('second'), 10), weekday: WEEKDAY_MAP[get('weekday')] ?? 0,
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatClockInZone(ms: number, timeZone = DISPLAY_TIME_ZONE): string {
  const p = getZonedParts(ms, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

export function formatDateTimeInZone(ms: number, timeZone = DISPLAY_TIME_ZONE): string {
  if (!Number.isFinite(ms)) return '—';
  const p = getZonedParts(ms, timeZone);
  return `${p.year}/${pad2(p.month)}/${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function parseZonedTime(isoLocal: string, timeZone = DISPLAY_TIME_ZONE): number {
  if (!isoLocal) return NaN;
  const utcGuess = new Date(`${isoLocal}Z`).getTime();
  if (Number.isNaN(utcGuess)) return NaN;
  const p = getZonedParts(utcGuess, timeZone);
  const asUtcFromParts = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return utcGuess - (asUtcFromParts - utcGuess);
}
