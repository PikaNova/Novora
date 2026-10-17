import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRuntimeEvent } from '../src/shared/runtimeLog.js';

const values = new Map<string, string>();
const store = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};
Object.assign(globalThis, {
  localStorage: store,
  window: { localStorage: store },
  __APP_VERSION__: 'test',
  __COMMIT_SHA__: 'test',
});
const {
  journal,
  readRuntimeEvents,
  flushRuntimeEvents,
  captureRuntimeWindow,
  getRuntimeWindows,
  readRuntimeWindow,
  finishRuntimeWindows,
  subscribeRuntimeEvents,
} = await import('../src/utils/runtimeJournal.js');
const { runtimeBatches, runtimeSecret } = await import('../src/services/runtimeLogClient.js');

test('runtime events sanitize credentials and business values before persistence', async () => {
  const event = journal(
    'sync.failed',
    { token: 'sensitive', password: 'sensitive', result: 'Bearer abc123', dataVersion: 1700000000000 },
    'error',
    'sync',
    'password=hidden schoolName=Hidden',
  );
  assert.ok(event);
  assert.equal(event.context.token, undefined);
  assert.equal(event.context.password, undefined);
  assert.equal(event.context.result, '<redacted>');
  assert.equal(event.context.dataVersion, 1700000000000);
  assert.ok(!JSON.stringify(event).includes('Hidden'));
  assert.ok(!JSON.stringify(event).includes('abc123'));
  await flushRuntimeEvents();
  const loaded = await readRuntimeEvents();
  assert.ok(loaded.some((row) => row.eventId === event.eventId));
  assert.equal(sanitizeRuntimeEvent({ ...event, eventId: 'invalid id' }), null);
  assert.equal(sanitizeRuntimeEvent({ ...event, sequence: NaN }), null);
});
test('corrupt recovery data and failing observers never break business logging', async () => {
  values.set('novora_runtime_recovery_v2', '{}');
  const unsubscribe = subscribeRuntimeEvents(() => {
    throw new Error('observer failed');
  });
  assert.doesNotThrow(() => journal('display.state', {}, 'info', 'display'));
  unsubscribe();
  await flushRuntimeEvents();
  assert.ok((await readRuntimeEvents()).length);
});
test('error capture survives page exit and keeps sequence ordering across clock jumps', async () => {
  const original = Date.now;
  const at = original();
  try {
    Date.now = () => at;
    const before = journal('page.before', {}, 'info', 'page')!;
    captureRuntimeWindow('error_capture', 300, 600);
    Date.now = () => at - 10000;
    const after = journal('page.after', {}, 'info', 'page')!;
    finishRuntimeWindows();
    const window = getRuntimeWindows().find((row) => row.errorEventId === 'error_capture')!;
    assert.equal(window.complete, true);
    const rows = await readRuntimeWindow(window);
    assert.ok(rows.find((row) => row.eventId === before.eventId));
    assert.ok(rows.find((row) => row.eventId === after.eventId));
    assert.ok(
      rows.indexOf(before) < rows.indexOf(after) ||
        rows.findIndex((row) => row.eventId === before.eventId) <
          rows.findIndex((row) => row.eventId === after.eventId),
    );
  } finally {
    Date.now = original;
  }
});
test('automatic upload batches stay within the server limits', async () => {
  for (let index = 0; index < 260; index++) journal('sync.probe', { index }, 'info', 'sync');
  const rows = await readRuntimeEvents();
  const batches = runtimeBatches(rows.filter((row) => row.code === 'sync.probe'));
  assert.equal(batches.flat().length, rows.filter((row) => row.code === 'sync.probe').length);
  assert.ok(
    batches.every(
      (batch) => batch.length <= 250 && new TextEncoder().encode(JSON.stringify(batch)).length < 512 * 1024,
    ),
  );
});
test('device log credential is generated once and remains stable', () => {
  const secret = runtimeSecret();
  assert.match(secret!, /^[a-f0-9]{64}$/);
  assert.equal(runtimeSecret(), secret);
});
test.after(async () => {
  finishRuntimeWindows();
  await flushRuntimeEvents();
});
