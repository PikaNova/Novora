import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTemporaryItem, saveTemporaryExam } from '../src/services/temporaryExam.js';

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size;
  },
};
(globalThis as unknown as { window: Window }).window = {
  dispatchEvent: () => true,
} as unknown as Window;

test('temporary exams are visible only to the class that created them', () => {
  storage.clear();
  const now = Date.now();
  saveTemporaryExam({
    id: 'temp-c1',
    classId: 'c1',
    subject: '语文',
    startTime: new Date(now - 60_000).toISOString(),
    endTime: new Date(now + 30 * 60_000).toISOString(),
    priorityOverFormal: false,
    status: 'running',
    createdAt: now,
  });

  assert.equal(resolveTemporaryItem([], now, 'c1')?.id, 'temp-c1');
  assert.equal(resolveTemporaryItem([], now, 'c2'), null);
  assert.equal(resolveTemporaryItem([], now, ''), null);
});

test('legacy temporary exams without a class binding are not displayed', () => {
  storage.clear();
  const now = Date.now();
  saveTemporaryExam({
    id: 'legacy-temp',
    subject: '语文',
    startTime: new Date(now - 60_000).toISOString(),
    endTime: new Date(now + 30 * 60_000).toISOString(),
    priorityOverFormal: false,
    status: 'running',
    createdAt: now,
  });

  assert.equal(resolveTemporaryItem([], now, 'c1'), null);
});
