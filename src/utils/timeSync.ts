import { getAppSettings, updateTimeSyncSettings } from './appSettings';
import { logger } from './logger';

export type TimeSyncProvider = 'httpDate' | 'timeApi' | 'ntp';

export interface TimeSyncSampleResult {
  offsetMs: number; rttMs: number; serverEpochMs: number; measuredAt: number;
}

export interface TimeSyncRunResult extends TimeSyncSampleResult {
  samples: TimeSyncSampleResult[];
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const resp = await fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit', signal });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  if (!text) throw new Error('Empty response');
  return JSON.parse(text);
}

function parseTimeApiBody(body: unknown): number {
  if (typeof body !== 'object' || body == null) throw new Error('Not an object');
  const obj = body as Record<string, unknown>;
  const epochMs = typeof obj.epochMs === 'number' ? obj.epochMs : null;
  if (epochMs != null) return Math.trunc(epochMs);
  const epochSec = typeof obj.epochSeconds === 'number' ? obj.epochSeconds : null;
  if (epochSec != null) return Math.trunc(epochSec * 1000);
  const datetime = typeof obj.datetime === 'string' ? Date.parse(obj.datetime) : NaN;
  if (Number.isFinite(datetime)) return datetime;
  throw new Error('No recognizable time field');
}

async function measureOnce(opts: { provider: TimeSyncProvider; url: string; timeoutMs: number }): Promise<TimeSyncSampleResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const t0 = Date.now();
    if (opts.provider === 'httpDate') {
      const resp = await fetch(opts.url, { method: 'GET', cache: 'no-store', credentials: 'omit', signal: controller.signal });
      const dateHeader = resp.headers.get('Date');
      const t1 = Date.now();
      if (!dateHeader) throw new Error('Missing Date header');
      const serverEpochMs = Date.parse(dateHeader);
      if (!Number.isFinite(serverEpochMs)) throw new Error('Invalid Date header');
      const rttMs = Math.max(0, t1 - t0);
      return { offsetMs: Math.round(serverEpochMs - (t0 + t1) / 2), rttMs, serverEpochMs, measuredAt: t1 };
    }
    const body = await fetchJson(opts.url, controller.signal);
    const t1 = Date.now();
    const serverEpochMs = parseTimeApiBody(body);
    const rttMs = Math.max(0, t1 - t0);
    return { offsetMs: Math.round(serverEpochMs - (t0 + t1) / 2), rttMs, serverEpochMs, measuredAt: t1 };
  } finally { clearTimeout(timeout); }
}

export function getTimeSyncSettings() { return getAppSettings().general.timeSync; }

export async function syncTime(): Promise<TimeSyncRunResult> {
  const s = getTimeSyncSettings();
  const primaryUrl = (s.provider === 'httpDate' ? s.httpDateUrl : s.timeApiUrl).trim();
  if (!primaryUrl) throw new Error('No sync URL configured');
  // Parallel sampling avoids turning three trans-Pacific RTTs into a sequential wait.
  // The median rejects a single delayed response without discarding a stable last-known offset.
  const collect = async (provider: TimeSyncProvider, url: string, count: number) => {
    const settled = await Promise.allSettled(Array.from({ length: count }, () => measureOnce({ provider, url, timeoutMs: 5_000 })));
    return settled.filter((r): r is PromiseFulfilledResult<TimeSyncSampleResult> => r.status === 'fulfilled').map(r => r.value);
  };
  let samples = await collect(s.provider, primaryUrl, 3);
  // Redundant same-origin fallback: when /api/time is unavailable, use Vercel's Date header.
  if (samples.length === 0 && s.provider === 'timeApi') {
    const fallbackUrl = s.httpDateUrl.trim() || '/';
    samples = await collect('httpDate', fallbackUrl, 2);
  }
  if (samples.length === 0) throw new Error('All time sources unavailable; keeping last successful offset');
  const fastest = [...samples].sort((a, b) => a.rttMs - b.rttMs).slice(0, Math.min(3, samples.length));
  return { offsetMs: median(fastest.map(x => x.offsetMs)), rttMs: fastest[0].rttMs, serverEpochMs: fastest[0].serverEpochMs, measuredAt: fastest[0].measuredAt, samples };
}
let managerStop: (() => void) | null = null;

export function startTimeSyncManager(): () => void {
  if (managerStop) return managerStop;
  let timer: number | null = null;
  let syncing = false;
  let stopped = false;

  const schedule = () => {
    if (timer) { window.clearInterval(timer); timer = null; }
    const s = getTimeSyncSettings();
    if (!s.enabled || !s.autoSyncEnabled) return;
    const ms = clampInt(s.autoSyncIntervalSec, 10, 7 * 24 * 3600) * 1000;
    timer = window.setInterval(() => void persist('auto'), ms);
  };

  const persist = async (reason: string) => {
    if (stopped || syncing) return;
    const s = getTimeSyncSettings();
    if (!s.enabled) return;
    syncing = true;
    try {
      const r = await syncTime();
      updateTimeSyncSettings({ offsetMs: r.offsetMs, lastSyncAt: Date.now(), lastRttMs: r.rttMs, lastError: '' });
      window.dispatchEvent(new CustomEvent('timeSync:updated'));
      logger.info(`校时成功(${reason}): offset=${r.offsetMs}ms rtt=${r.rttMs}ms`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Preserve lastSyncAt and offsetMs after a failed attempt: the monotonic local clock keeps running on the last good calibration.
      updateTimeSyncSettings({ lastError: msg });
      window.dispatchEvent(new CustomEvent('timeSync:updated'));
      logger.warn(`校时失败(${reason}): ${msg}`);
    } finally { syncing = false; }
  };

  const onSyncNow = () => void persist('manual');
  const onReschedule = () => schedule();
  const onOnline = () => void persist('online');
  const onVisible = () => { if (document.visibilityState === 'visible') void persist('visible'); };
  window.addEventListener('timeSync:syncNow', onSyncNow as EventListener);
  window.addEventListener('timeSync:reschedule', onReschedule as EventListener);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  schedule();
  void persist('init');

  managerStop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) { window.clearInterval(timer); timer = null; }
    window.removeEventListener('timeSync:syncNow', onSyncNow as EventListener);
    window.removeEventListener('timeSync:reschedule', onReschedule as EventListener);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    managerStop = null;
  };
  return managerStop;
}
