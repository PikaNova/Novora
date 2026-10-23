import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_SETTINGS_KEY } from '../src/utils/appSettings.js';

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;

const { updateTimeSyncSettings } = await import('../src/utils/appSettings.js');
const originalNow = Date.now;
let wall = Date.parse('2026-10-10T09:00:00+08:00');
Date.now = () => wall;
const { isTimeSyncReady, monotonicNowMs, nowMs, nowWithoutBroadcastOffsetMs, applyTimeCalibration } =
  await import('../src/utils/timeSource.js');
let revision = 1;

test('server calibration corrects a three-hour device error', () => {
  localStorage.removeItem(APP_SETTINGS_KEY);
  updateTimeSyncSettings({ enabled: true, lastSyncAt: 0 });
  const base = monotonicNowMs();
  applyTimeCalibration(base + 10_800_000, revision++);
  assert.ok(Math.abs(nowMs() - monotonicNowMs() - 10_800_000) < 20);
  assert.equal(isTimeSyncReady(), true);
});

test('expired calibration changes status without reverting by three hours', () => {
  applyTimeCalibration(monotonicNowMs() + 10_800_000, revision++, 3_600_000);
  assert.equal(isTimeSyncReady(), false);
  assert.ok(Math.abs(nowMs() - monotonicNowMs() - 10_800_000) < 20);
});

test('another window shared offset cannot overwrite the page clock', () => {
  updateTimeSyncSettings({
    enabled: true,
    offsetMs: 0,
    lastSyncAt: wall + 10_800_000,
    lastSyncServerAt: wall + 10_800_000,
  });
  assert.ok(Math.abs(nowMs() - monotonicNowMs() - 10_800_000) < 20);
});

test('system time corrections do not alter an anchored clock or freshness', () => {
  applyTimeCalibration(monotonicNowMs() + 10_800_000, revision++);
  const before = nowMs();
  wall += 10_800_000;
  assert.ok(Math.abs(nowMs() - before) < 20);
  assert.equal(isTimeSyncReady(), true);
});

test('out-of-order cross-window calibration is ignored', () => {
  const before = nowMs();
  applyTimeCalibration(monotonicNowMs(), 1);
  assert.ok(Math.abs(nowMs() - before) < 20);
});

test('global broadcast offset shifts the client clock even when network calibration is disabled', () => {
  updateTimeSyncSettings({ enabled: true, manualOffsetMs: 0, broadcastOffsetMs: 3200 });
  const unoffset = nowWithoutBroadcastOffsetMs();
  let before = nowMs();
  updateTimeSyncSettings({ broadcastOffsetMs: 8200 });
  assert.ok(Math.abs(nowMs() - before - 5000) < 20);
  assert.ok(Math.abs(nowWithoutBroadcastOffsetMs() - unoffset) < 20);

  updateTimeSyncSettings({ enabled: false, broadcastOffsetMs: -2500 });
  before = nowMs();
  updateTimeSyncSettings({ broadcastOffsetMs: 0 });
  assert.ok(Math.abs(nowMs() - before - 2500) < 20);
  updateTimeSyncSettings({ enabled: true, manualOffsetMs: 0, broadcastOffsetMs: 0 });
});

test('manual correction remains explicit and is not lost during outages', () => {
  updateTimeSyncSettings({ manualOffsetMs: 60_000, lastError: 'offline' });
  assert.ok(Math.abs(nowMs() - monotonicNowMs() - 10_860_000) < 20);
  updateTimeSyncSettings({ manualOffsetMs: 0 });
  Date.now = originalNow;
});
