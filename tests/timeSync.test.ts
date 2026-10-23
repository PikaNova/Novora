import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppSettings, updateTimeSyncSettings } from '../src/utils/appSettings.js';
import { nowMs } from '../src/utils/timeSource.js';
import { syncTime, startTimeSyncManager } from '../src/utils/timeSync.js';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
const events = new EventTarget();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: Object.assign(events, { setInterval: () => 1, clearInterval: () => {} }),
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
});
Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: { href: 'https://novora.test/exam', pathname: '/exam' },
});
const locationState = location as unknown as { pathname: string };
const originalFetch = globalThis.fetch;
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

test('failed API samples never fall back to a cached home page', async () => {
  updateTimeSyncSettings({ provider: 'timeApi', timeApiUrl: '/api/time' });
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    throw new Error('offline');
  };
  await assert.rejects(syncTime(), /Insufficient/);
  assert.equal(urls.length, 3);
  assert.ok(
    urls.every((url) => new URL(url).pathname === '/api/time' && new URL(url).searchParams.has('novoraTimeSync')),
  );
});

test('cached HTTP Date is rejected', async () => {
  updateTimeSyncSettings({ provider: 'httpDate', httpDateUrl: '/' });
  globalThis.fetch = async () => new Response('', { headers: { Date: new Date().toUTCString(), Age: '3600' } });
  await assert.rejects(syncTime(), /Insufficient/);
});

test('classroom calibrates once and failed refresh keeps its live clock', async () => {
  updateTimeSyncSettings({ enabled: true, autoSyncEnabled: false, provider: 'timeApi' });
  const serverNow = Date.now() + 10_800_000;
  globalThis.fetch = async () => new Response(JSON.stringify({ epochMs: serverNow }));
  const stop = startTimeSyncManager();
  await settle();
  assert.ok(Math.abs(nowMs() - serverNow) < 2000);
  assert.equal(getAppSettings().general.timeSync.calibrationSource, 'timeApi');
  assert.ok(!('lastSyncMonotonicMs' in getAppSettings().general.timeSync));
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  events.dispatchEvent(new Event('online'));
  await settle();
  assert.ok(Math.abs(nowMs() - serverNow) < 2000);
  stop();
});

test('administration pages cannot write network calibration', async () => {
  locationState.pathname = '/settings';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}');
  };
  const stop = startTimeSyncManager();
  await settle();
  assert.equal(calls, 0);
  stop();
  locationState.pathname = '/exam';
});

test('manual settings-page sync calibrates and reports failures', async () => {
  locationState.pathname = '/settings/runtime';
  updateTimeSyncSettings({ enabled: true, autoSyncEnabled: false, provider: 'timeApi', timeApiUrl: '/api/time' });
  let shouldFail = false;
  globalThis.fetch = async () => {
    if (shouldFail) throw new Error('offline');
    return new Response(JSON.stringify({ epochMs: Date.now() + 5000 }));
  };
  const stop = startTimeSyncManager();
  events.dispatchEvent(new Event('timeSync:syncNow'));
  await settle();
  assert.equal(getAppSettings().general.timeSync.lastError, '');
  assert.equal(getAppSettings().general.timeSync.calibrationSource, 'timeApi');

  shouldFail = true;
  events.dispatchEvent(new Event('timeSync:syncNow'));
  await settle();
  assert.equal(getAppSettings().general.timeSync.lastError?.includes('Insufficient'), true);
  stop();
  locationState.pathname = '/exam';
  globalThis.fetch = originalFetch;
});

test('another classroom lease prevents overlapping writes', async () => {
  values.set('novora_time_sync_lease_v1', JSON.stringify({ id: 'other-window', expiresAt: Date.now() + 45000 }));
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}');
  };
  const stop = startTimeSyncManager();
  await settle();
  assert.equal(calls, 0);
  stop();
  globalThis.fetch = originalFetch;
});
