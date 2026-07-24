export const DISPLAY_TIME_ZONE = 'Asia/Shanghai';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const pad2 = (value: number) => String(value).padStart(2, '0');

export function getZonedParts(ms: number, timeZone = DISPLAY_TIME_ZONE): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(new Date(ms));
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  let hour = Number.parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return {
    year: Number.parseInt(get('year'), 10),
    month: Number.parseInt(get('month'), 10),
    day: Number.parseInt(get('day'), 10),
    hour,
    minute: Number.parseInt(get('minute'), 10),
    second: Number.parseInt(get('second'), 10),
    weekday: WEEKDAY_MAP[get('weekday')] ?? 0,
  };
}

export function formatClockInZone(ms: number, timeZone = DISPLAY_TIME_ZONE): string {
  const parts = getZonedParts(ms, timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

export function formatDateTimeInZone(ms: number, timeZone = DISPLAY_TIME_ZONE): string {
  if (!Number.isFinite(ms)) return '-';
  const parts = getZonedParts(ms, timeZone);
  return `${parts.year}/${pad2(parts.month)}/${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function parseZonedTime(isoLocal: string, timeZone = DISPLAY_TIME_ZONE): number {
  if (!isoLocal) return Number.NaN;
  const utcGuess = new Date(`${isoLocal}Z`).getTime();
  if (Number.isNaN(utcGuess)) return Number.NaN;
  const parts = getZonedParts(utcGuess, timeZone);
  const asUtcFromParts = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return utcGuess - (asUtcFromParts - utcGuess);
}
