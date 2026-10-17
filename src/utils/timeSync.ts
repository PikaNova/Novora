import { getAppSettings, updateTimeSyncSettings } from './appSettings';
import { journal } from './runtimeJournal.js';
import { runtimeId } from '../shared/runtimeLog.js';
import { logger } from './logger';
import { monotonicNowMs, calibratedNowMs, hasTimeCalibration, applyTimeCalibration, nowMs } from './timeSource';

export type TimeSyncProvider = 'httpDate' | 'timeApi' | 'ntp';

export interface TimeSyncSampleResult {
  offsetMs: number;
  rttMs: number;
  serverEpochMs: number;
  measuredAt: number;
}

export interface TimeSyncRunResult extends TimeSyncSampleResult {
  samples: TimeSyncSampleResult[];
}

const LEASE_KEY = 'novora_time_sync_lease_v1';
const LEASE_MS = 45_000;
const REQUEST_KEY = 'novora_time_sync_request_v1';
const CALIBRATION_KEY = 'novora_time_calibration_v1';
const isClassroom = () => location.pathname === '/' || location.pathname === '/exam';
const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function holdsLease(): boolean {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(LEASE_KEY);
    const current = raw ? (JSON.parse(raw) as { id?: string; expiresAt?: number }) : null;
    if (current?.id && current.id !== instanceId && Number(current.expiresAt) > now) return false;
    localStorage.setItem(LEASE_KEY, JSON.stringify({ id: instanceId, expiresAt: now + LEASE_MS }));
    const confirmed = JSON.parse(localStorage.getItem(LEASE_KEY) || '{}') as { id?: string };
    return confirmed.id === instanceId;
  } catch {
    logger.warn('校时租约不可用: 暂停写入共享校时结果');
    return false;
  }
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
  if (Number(resp.headers.get('Age') || 0) > 0) throw new Error('Cached time response');
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

async function measureOnce(opts: {
  provider: TimeSyncProvider;
  url: string;
  timeoutMs: number;
}): Promise<TimeSyncSampleResult> {
  const operationId = runtimeId('sample');
  journal('time.sample_start', { source: opts.provider }, 'debug', 'time', '开始获取校时样本', operationId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const t0 = monotonicNowMs();
    const url = new URL(opts.url, location.href);
    url.searchParams.set('novoraTimeSync', Math.random().toString(36).slice(2));
    if (opts.provider === 'httpDate') {
      const resp = await fetch(url.href, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!resp.ok || Number(resp.headers.get('Age') || 0) > 0) throw new Error('Cached or failed time response');
      const dateHeader = resp.headers.get('Date');
      const t1 = monotonicNowMs();
      if (!dateHeader) throw new Error('Missing Date header');
      const serverEpochMs = Date.parse(dateHeader);
      if (!Number.isFinite(serverEpochMs)) throw new Error('Invalid Date header');
      const rttMs = Math.max(0, t1 - t0);
      journal(
        'time.sample_received',
        { source: opts.provider, rttMs, serverEpochMs },
        'debug',
        'time',
        '收到校时样本',
        operationId,
      );
      return { offsetMs: Math.round(serverEpochMs - (t0 + t1) / 2), rttMs, serverEpochMs, measuredAt: t1 };
    }
    const body = await fetchJson(url.href, controller.signal);
    const t1 = monotonicNowMs();
    const serverEpochMs = parseTimeApiBody(body);
    if (!Number.isFinite(serverEpochMs) || serverEpochMs <= 0 || serverEpochMs > 8.64e15)
      throw new Error('Invalid server epoch');
    const rttMs = Math.max(0, t1 - t0);
    journal(
      'time.sample_received',
      { source: opts.provider, rttMs, serverEpochMs },
      'debug',
      'time',
      '收到校时样本',
      operationId,
    );
    return { offsetMs: Math.round(serverEpochMs - (t0 + t1) / 2), rttMs, serverEpochMs, measuredAt: t1 };
  } catch (error) {
    journal(
      'time.sample_failed',
      { source: opts.provider },
      'warn',
      'time',
      error instanceof Error ? error.message : '校时样本获取失败',
      operationId,
    );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function getTimeSyncSettings() {
  return getAppSettings().general.timeSync;
}

export async function syncTime(): Promise<TimeSyncRunResult> {
  const s = getTimeSyncSettings();
  if (s.provider === 'ntp') throw new Error('浏览器无法直连 NTP，请使用时间接口或 HTTP Date');
  const primaryUrl = (s.provider === 'httpDate' ? s.httpDateUrl : s.timeApiUrl).trim();
  if (!primaryUrl) throw new Error('No sync URL configured');
  // Parallel sampling avoids turning three trans-Pacific RTTs into a sequential wait.
  // The median rejects a single delayed response without discarding a stable last-known offset.
  const collect = async (provider: TimeSyncProvider, url: string, count: number) => {
    const settled = await Promise.allSettled(
      Array.from({ length: count }, () => measureOnce({ provider, url, timeoutMs: 5_000 })),
    );
    return settled
      .filter((r): r is PromiseFulfilledResult<TimeSyncSampleResult> => r.status === 'fulfilled')
      .map((r) => r.value);
  };
  const samples = await collect(s.provider, primaryUrl, 3);
  if (samples.length < 2) throw new Error('Insufficient independent time samples; keeping last reliable clock');
  const offsets = samples.map((sample) => sample.offsetMs);
  if (Math.max(...offsets) - Math.min(...offsets) > 2_000) throw new Error('Inconsistent time samples');
  const fastest = [...samples].sort((a, b) => a.rttMs - b.rttMs).slice(0, Math.min(3, samples.length));
  return {
    offsetMs: median(fastest.map((x) => x.offsetMs)),
    rttMs: fastest[0].rttMs,
    serverEpochMs: fastest[0].serverEpochMs,
    measuredAt: fastest[0].measuredAt,
    samples,
  };
}
let managerStop: (() => void) | null = null;
let manualSync: (() => Promise<boolean | null>) | null = null;

export async function runManualTimeSync(): Promise<boolean> {
  if (!manualSync) return false;
  return new Promise((resolve) => {
    const before = getTimeSyncSettings();
    const revision = before.calibrationRevision || before.lastSyncAt;
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener('timeSync:updated', check);
      resolve(value);
    };
    const check = () => {
      const latest = getTimeSyncSettings();
      if ((latest.calibrationRevision || latest.lastSyncAt) > revision) finish(!latest.lastError);
      else if (latest.lastError) finish(false);
    };
    const timeout = window.setTimeout(() => finish(false), 30_000);
    window.addEventListener('timeSync:updated', check);
    manualSync?.().then(
      (result) => {
        if (result !== null) finish(result);
        else check();
      },
      () => finish(false),
    );
  });
}

export function startTimeSyncManager(): () => void {
  if (managerStop) return managerStop;
  let timer: number | null = null;
  let syncing = false;
  let stopped = false;

  const schedule = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    const s = getTimeSyncSettings();
    if (!s.enabled || !s.autoSyncEnabled) return;
    const ms = clampInt(s.autoSyncIntervalSec, 10, 7 * 24 * 3600) * 1000;
    timer = window.setInterval(() => void persist('auto'), ms);
  };

  const receiveCalibration = () => {
    try {
      const raw = localStorage.getItem(CALIBRATION_KEY);
      if (!raw) return;
      const message = JSON.parse(raw) as {
        epochMs: number;
        sentAt: number;
        revision: number;
        instanceId: string;
        source: string;
      };
      if (message.instanceId === instanceId || !message.source || !message.instanceId) return;
      const elapsed = Date.now() - message.sentAt;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > LEASE_MS) return;
      applyTimeCalibration(message.epochMs + elapsed, message.revision, elapsed);
      window.dispatchEvent(new CustomEvent('timeSync:updated'));
    } catch {
      /* Invalid messages must not change the live clock. */
    }
  };

  const perform = async (reason: string) => {
    const manualControlPage =
      reason === 'manual' && (location.pathname.startsWith('/settings') || location.pathname.startsWith('/admin'));
    const canWriteCalibration = isClassroom() || manualControlPage;
    if (!canWriteCalibration || !getTimeSyncSettings().enabled) return false;
    if (!manualControlPage && !holdsLease()) return null;
    const s = getTimeSyncSettings();
    try {
      let r = await syncTime();
      if (hasTimeCalibration() && Math.abs(monotonicNowMs() + r.offsetMs - calibratedNowMs()) > 300_000) {
        logger.warn(
          '校时大幅变化: 等待独立确认 ' +
            JSON.stringify({ instanceId, previous: nowMs(), offsetMs: r.offsetMs, source: s.provider }),
        );
        const confirmation = await syncTime();
        if (Math.abs(confirmation.offsetMs - r.offsetMs) > 2_000)
          throw new Error('Large clock correction was not confirmed');
        r = confirmation;
      }
      if (stopped || !canWriteCalibration) return null;
      if (!manualControlPage && !holdsLease()) return null;
      const sentAt = Date.now();
      const previousRevision = getTimeSyncSettings().calibrationRevision || 0;
      const revision = Math.max(sentAt, previousRevision + 1);
      const epochMs = monotonicNowMs() + r.offsetMs;
      applyTimeCalibration(epochMs, revision);
      updateTimeSyncSettings({
        offsetMs: r.offsetMs,
        lastSyncAt: sentAt,
        lastSyncServerAt: epochMs,
        calibrationRevision: revision,
        calibrationSource: s.provider,
        calibrationInstanceId: instanceId,
        lastRttMs: r.rttMs,
        lastError: '',
      });
      localStorage.setItem(
        CALIBRATION_KEY,
        JSON.stringify({ epochMs, sentAt, revision, instanceId, source: s.provider }),
      );
      window.dispatchEvent(new CustomEvent('timeSync:updated'));
      logger.info(
        '校时成功(' +
          reason +
          '): ' +
          JSON.stringify({
            instanceId,
            page: location.pathname,
            source: s.provider,
            epochMs,
            offsetMs: r.offsetMs,
            rttMs: r.rttMs,
            revision,
          }),
      );
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (stopped || !canWriteCalibration) return null;
      if (!manualControlPage && !holdsLease()) return null;
      updateTimeSyncSettings({ lastError: msg });
      window.dispatchEvent(new CustomEvent('timeSync:updated'));
      logger.warn('校时失败(' + reason + '): 保留可靠时间; ' + msg);
      return false;
    }
  };

  const persist = async (reason: string) => {
    if (stopped || syncing || !getTimeSyncSettings().enabled) return false;
    if (
      !isClassroom() &&
      !(reason === 'manual' && (location.pathname.startsWith('/settings') || location.pathname.startsWith('/admin')))
    )
      return false;
    syncing = true;
    let result: boolean | null = false;
    try {
      // Web Locks serializes lease acquisition and in-flight writes across tabs.
      if (navigator.locks) {
        await navigator.locks.request('novora-time-sync', { ifAvailable: true }, async (lock) => {
          if (lock) result = await perform(reason);
          else result = null;
        });
      } else {
        result = await perform(reason);
      }
    } finally {
      syncing = false;
    }
    return result;
  };

  const onSyncNow = () => {
    localStorage.setItem(REQUEST_KEY, instanceId + ':' + Date.now());
    void persist('manual');
  };
  manualSync = async () => {
    for (let attempt = 0; syncing && attempt < 40; attempt++)
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    if (syncing) return null;
    return persist('manual');
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === CALIBRATION_KEY) receiveCalibration();
    if (event.key === REQUEST_KEY) void persist('requested');
  };
  window.addEventListener('storage', onStorage);
  // Renew only from a classroom page; a newly opened classroom can take over
  // when the previous owner is closed, navigates to administration or sleeps.
  const leaseTimer = window.setInterval(() => {
    if (!isClassroom() || !getTimeSyncSettings().enabled) return;
    try {
      const lease = JSON.parse(localStorage.getItem(LEASE_KEY) || '{}') as { id?: string; expiresAt?: number };
      if (lease.id === instanceId && Number(lease.expiresAt) > Date.now()) holdsLease();
      else if (!lease.id || Number(lease.expiresAt) <= Date.now()) void persist('takeover');
    } catch {
      void persist('takeover');
    }
  }, 10_000);
  receiveCalibration();

  const onReschedule = () => {
    schedule();
    localStorage.setItem(REQUEST_KEY, instanceId + ':' + Date.now());
    void persist('settings');
  };
  const onOnline = () => void persist('online');
  const onVisible = () => {
    if (document.visibilityState === 'visible') void persist('visible');
  };
  window.addEventListener('timeSync:syncNow', onSyncNow as EventListener);
  window.addEventListener('timeSync:reschedule', onReschedule as EventListener);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  schedule();
  void persist('init');

  managerStop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    window.removeEventListener('timeSync:syncNow', onSyncNow as EventListener);
    window.removeEventListener('timeSync:reschedule', onReschedule as EventListener);
    window.clearInterval(leaseTimer);
    window.removeEventListener('storage', onStorage);
    try {
      const lease = JSON.parse(localStorage.getItem(LEASE_KEY) || '{}') as { id?: string };
      if (lease.id === instanceId) localStorage.removeItem(LEASE_KEY);
    } catch {
      /* Best effort lease release. */
    }
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    managerStop = null;
    manualSync = null;
  };
  return managerStop;
}
