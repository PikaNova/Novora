import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAppSettings,
  updateAppSettings,
  updateExamSettings,
  updateAlertsSettings,
  updateMotionMode,
  updateTimeSyncSettings,
  APP_SETTINGS_KEY,
} from '../src/utils/appSettings.js';

// getAppSettings/updateAppSettings read and write through the browser `localStorage` API and
// (best-effort) mirror into IndexedDB via mirrorAppSettings(). Neither exists in this Node test
// runner, so we install a minimal in-memory localStorage polyfill before running assertions.
// mirrorAppSettings() itself already no-ops when `indexedDB` is undefined, and
// updateAppSettings() already guards its `window.dispatchEvent` call behind a `typeof window`
// check, so no further polyfilling is required for those.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
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
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;

function resetStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage.clear();
}

test('getAppSettings: returns raw defaults when storage is empty (no stored data to normalize)', () => {
  resetStorage();
  const settings = getAppSettings();
  assert.equal(settings.version, 4);
  assert.equal(settings.hasVisited, false);
  // With empty storage, getAppSettings short-circuits to the DEFAULT_SETTINGS constant
  // as-is (it never runs normalizeExam), so majors stays the raw empty default here.
  // The single-major migration wrapping only happens once real data flows through
  // normalizeExam, as covered by the merge and update tests below.
  assert.equal(settings.exam.majors.length, 0);
  assert.equal(settings.exam.title, '2026年高考');
  assert.equal(settings.alerts.enabled, true);
});

test('getAppSettings: merges stored partial settings onto defaults and re-normalizes nested domains', () => {
  resetStorage();
  localStorage.setItem(
    APP_SETTINGS_KEY,
    JSON.stringify({
      hasVisited: true,
      general: { motionMode: 'best-performance' },
      exam: { title: '期中考试', items: [] },
      alerts: { enabled: false, durationSec: 100 },
    }),
  );
  const settings = getAppSettings();
  assert.equal(settings.hasVisited, true);
  assert.equal(settings.general.motionMode, 'best-performance');
  // untouched general fields keep their defaults
  assert.equal(settings.general.timeSync.provider, 'timeApi');
  assert.equal(settings.exam.title, '期中考试');
  assert.equal(settings.exam.majors[0].name, '期中考试');
  assert.equal(settings.alerts.enabled, false);
  // durationSec is re-clamped by normalizeAlerts on every read
  assert.equal(settings.alerts.durationSec, 20);
});

test('getAppSettings: falls back to defaults without throwing when stored JSON is corrupted', () => {
  resetStorage();
  localStorage.setItem(APP_SETTINGS_KEY, '{not-valid-json');
  const settings = getAppSettings();
  assert.equal(settings.version, 4);
  // The catch branch also returns the raw DEFAULT_SETTINGS constant, not a normalized copy.
  assert.equal(settings.exam.majors.length, 0);
});

test('updateAppSettings: persists a shallow merge and re-normalizes the alerts domain', () => {
  resetStorage();
  updateAppSettings({ hasVisited: true });
  updateAppSettings({ alerts: { durationSec: 2 } as never });
  const stored = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY)!);
  assert.equal(stored.hasVisited, true);
  assert.equal(stored.alerts.durationSec, 3); // clamped to the 3s minimum
  assert.equal(getAppSettings().alerts.durationSec, 3);
});

test('updateAppSettings: accepts an updater function seeded with the current settings', () => {
  resetStorage();
  updateAppSettings({ hasVisited: false });
  updateAppSettings(current => ({ hasVisited: !current.hasVisited }));
  assert.equal(getAppSettings().hasVisited, true);
});

test('updateExamSettings: merges into the exam domain and re-normalizes selection against grades', () => {
  resetStorage();
  updateExamSettings({ title: '一模考试', selectedGradeId: 'grade-that-does-not-exist' });
  const settings = getAppSettings();
  assert.equal(settings.exam.majors[0].name, '一模考试');
  // selectedGradeId is dropped because it doesn't match any known grade
  assert.equal(settings.exam.selectedGradeId, '');
});

test('updateAlertsSettings: merges into the alerts domain and re-validates enum-like fields', () => {
  resetStorage();
  updateAlertsSettings({ silentMode: 'not-a-real-mode' as never, durationSec: 50 });
  const settings = getAppSettings();
  assert.equal(settings.alerts.silentMode, 'all');
  assert.equal(settings.alerts.durationSec, 20);
});

test('updateMotionMode: updates only the motion mode, leaving other general settings untouched', () => {
  resetStorage();
  updateAppSettings({ general: undefined });
  updateMotionMode('best-effects');
  const settings = getAppSettings();
  assert.equal(settings.general.motionMode, 'best-effects');
  assert.equal(settings.general.timeSync.provider, 'timeApi');
});

test('updateTimeSyncSettings: supports both a partial patch and an updater function', () => {
  resetStorage();
  updateTimeSyncSettings({ enabled: false });
  assert.equal(getAppSettings().general.timeSync.enabled, false);
  updateTimeSyncSettings(current => ({ manualOffsetMs: current.manualOffsetMs + 100 }));
  assert.equal(getAppSettings().general.timeSync.manualOffsetMs, 100);
});
