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

const { getAppSettings, updateTimeSyncSettings } = await import('../src/utils/appSettings.js');
const { isTimeSyncReady, monotonicNowMs, nowMs } = await import('../src/utils/timeSource.js');

test('nowMs uses the monotonic session clock plus a fresh network offset', () => {
  localStorage.removeItem(APP_SETTINGS_KEY);
  const before = monotonicNowMs();
  updateTimeSyncSettings({
    enabled: true,
    offsetMs: 120_000,
    lastSyncAt: Date.now(),
    lastSyncServerAt: before + 120_000,
    lastSyncMonotonicMs: before,
  });

  const corrected = nowMs();
  assert.ok(corrected - monotonicNowMs() > 119_000);
  assert.equal(isTimeSyncReady(), true);
});

test('expired monotonic calibration is rejected instead of silently showing green', () => {
  const stale = monotonicNowMs() - 3 * 60 * 60 * 1000;
  updateTimeSyncSettings({
    enabled: true,
    offsetMs: 120_000,
    lastSyncAt: Date.now(),
    lastSyncMonotonicMs: stale,
  });

  assert.equal(isTimeSyncReady(), false);
  assert.ok(Math.abs(nowMs() - monotonicNowMs()) < 2_000);
  assert.equal(getAppSettings().general.timeSync.lastSyncMonotonicMs, stale);
});
