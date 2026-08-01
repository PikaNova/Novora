import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSyncQueueSnapshot,
  subscribeSyncQueue,
  beginBatch,
  endBatch,
  scheduleDebounced,
  runQueued,
  __resetSyncQueueForTests,
} from '../src/services/syncQueue.js';

// Drains the entire microtask queue by yielding to a real macrotask (setImmediate is not
// mocked). This is more robust than a fixed count of `await Promise.resolve()` hops, since
// the dispatch loop's internal await chains (task() -> run() -> resolve() -> post-run
// cleanup) can be several microtask ticks deep and that depth isn't a stable constant.
function flush(times = 2) {
  return new Promise<void>((resolve) => {
    let remaining = times;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else setImmediate(step);
    };
    setImmediate(step);
  });
}

test('scheduleDebounced: flushes once after the debounce delay elapses, and not before', (t) => {
  __resetSyncQueueForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let calls = 0;
  scheduleDebounced('k1', () => { calls += 1; }, { debounceMs: 500 });
  scheduleDebounced('k1', () => { calls += 1; }, { debounceMs: 500 });
  assert.equal(calls, 0);
  t.mock.timers.tick(499);
  assert.equal(calls, 0, 're-triggering the same key should not have flushed yet');
  t.mock.timers.tick(1);
  assert.equal(calls, 1, 'only the latest flush callback should run, exactly once');
});

test('scheduleDebounced: forces a flush after maxWaitMs even with continuous re-triggering', (t) => {
  __resetSyncQueueForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let calls = 0;
  const opts = { debounceMs: 500, maxWaitMs: 1200 };
  scheduleDebounced('k2', () => { calls += 1; }, opts);
  t.mock.timers.tick(400);
  scheduleDebounced('k2', () => { calls += 1; }, opts);
  t.mock.timers.tick(400);
  scheduleDebounced('k2', () => { calls += 1; }, opts);
  assert.equal(calls, 0);
  t.mock.timers.tick(400); // total 1200ms since the first trigger == maxWaitMs
  assert.equal(calls, 1, 'maxWaitMs should force a flush even though the debounce window keeps resetting');
});

test('beginBatch/endBatch: defers a debounced flush that fires during a batch until endBatch is called', (t) => {
  __resetSyncQueueForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let calls = 0;
  beginBatch();
  scheduleDebounced('k3', () => { calls += 1; }, { debounceMs: 200 });
  t.mock.timers.tick(200);
  assert.equal(calls, 0, 'flush must be deferred while the batch is open');
  endBatch();
  assert.equal(calls, 1, 'flush should run as soon as the batch closes');
});

test('beginBatch/endBatch: nested batches only flush once the outermost batch closes', (t) => {
  __resetSyncQueueForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let calls = 0;
  beginBatch();
  beginBatch();
  scheduleDebounced('k4', () => { calls += 1; }, { debounceMs: 100 });
  t.mock.timers.tick(100);
  endBatch();
  assert.equal(calls, 0, 'inner endBatch should not flush while an outer batch is still open');
  endBatch();
  assert.equal(calls, 1);
});

test('runQueued: a high-priority task queued while another task is in flight jumps ahead of an earlier-queued normal task', async (t) => {
  __resetSyncQueueForTests();
  // `now` seeds the mocked clock at the real current time so the first task's
  // MIN_BUSINESS_INTERVAL_MS gate check (Date.now() - lastBusinessSendAt, where
  // lastBusinessSendAt starts at 0) behaves like production instead of starting at epoch 0.
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const order: string[] = [];
  const aDone = runQueued(async () => { order.push('A'); }, { priority: 'normal' });
  const bDone = runQueued(async () => { order.push('B-normal'); }, { priority: 'normal' });
  const cDone = runQueued(async () => { order.push('C-high'); }, { priority: 'high' });
  await flush();
  assert.deepEqual(order, ['A'], 'the first task runs immediately since nothing preceded it');
  t.mock.timers.tick(900); // MIN_BUSINESS_INTERVAL_MS gate between tasks
  await flush();
  assert.deepEqual(order, ['A', 'C-high'], 'the high-priority task should be picked over the already-queued normal one');
  t.mock.timers.tick(900);
  await flush();
  await Promise.all([aDone, bDone, cDone]);
  assert.deepEqual(order, ['A', 'C-high', 'B-normal']);
});

test('runQueued: queuing a new task with the same key and a supersededValue cancels the earlier pending one', async (t) => {
  __resetSyncQueueForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const ran: string[] = [];
  // Occupies the in-flight slot so the same-key tasks below stay queued (not yet shifted) when the second one arrives.
  const primeDone = runQueued(async () => { ran.push('prime'); });
  const firstDone = runQueued(async () => { ran.push('first'); return 'first-result'; }, {
    key: 'save',
    supersededValue: 'superseded',
  });
  const secondDone = runQueued(async () => { ran.push('second'); return 'second-result'; }, {
    key: 'save',
    supersededValue: 'superseded',
  });
  await flush();
  t.mock.timers.tick(900);
  await flush();
  const [, firstResult, secondResult] = await Promise.all([primeDone, firstDone, secondDone]);
  assert.equal(firstResult, 'superseded', 'the superseded task should resolve with supersededValue instead of running');
  assert.equal(secondResult, 'second-result');
  assert.deepEqual(ran, ['prime', 'second'], 'the canceled "first" task body should never actually execute');
});

test('getSyncQueueSnapshot / subscribeSyncQueue: reflect syncing state and label while a task is in flight, and notify listeners on change', async (t) => {
  __resetSyncQueueForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const snapshots: Array<ReturnType<typeof getSyncQueueSnapshot>> = [];
  const unsubscribe = subscribeSyncQueue((snap) => snapshots.push(snap));
  assert.equal(snapshots.length, 1, 'subscribing should immediately deliver the current snapshot');
  assert.equal(snapshots[0].syncing, false);

  let resolveTask: () => void = () => {};
  const done = runQueued(() => new Promise<void>((resolve) => { resolveTask = resolve; }), { label: 'saving' });
  assert.equal(getSyncQueueSnapshot().syncing, true);
  assert.equal(getSyncQueueSnapshot().currentLabel, 'saving');
  assert.ok(snapshots.length > 1, 'the listener should have been notified when the task started');

  resolveTask();
  await done;
  await flush();
  assert.equal(getSyncQueueSnapshot().pendingCount, 0);
  assert.equal(getSyncQueueSnapshot().syncing, false);
  unsubscribe();
});

test('slow-task detection: marks the snapshot slow after SLOW_THRESHOLD_MS and clears it once the task completes', async (t) => {
  __resetSyncQueueForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  let resolveTask: () => void = () => {};
  const done = runQueued(() => new Promise<void>((resolve) => { resolveTask = resolve; }));
  assert.equal(getSyncQueueSnapshot().slow, false);
  t.mock.timers.tick(4000); // SLOW_THRESHOLD_MS
  assert.equal(getSyncQueueSnapshot().slow, true);
  resolveTask();
  await done;
  await flush();
  assert.equal(getSyncQueueSnapshot().slow, false, 'slow flag should clear once the task finishes');
});

test('wave tracking: counts the first task in a burst, but a known race resets progress to 0 before a second queued task starts', async (t) => {
  // KNOWN BUG (found while writing this test, not fixed here): between shifting a task off
  // businessQueue and setting inFlight=1, the task sits in neither the queue nor "in flight"
  // while it waits out the MIN_BUSINESS_INTERVAL_MS (900ms) rate-limit gate. Because
  // WAVE_GRACE_MS (800ms) is shorter than that gate, scheduleWaveClose()'s "nothing pending"
  // check can fire during that window and wrongly reset waveTotal/waveCompleted to 0 before
  // the second task even starts — this reproduces on every back-to-back 2-task burst, not just
  // a rare edge case. Pinning the test to this actual behavior per team decision (log real
  // behavior now, evaluate a fix separately) rather than asserting the "ideal" counts.
  __resetSyncQueueForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const aDone = runQueued(async () => {});
  const bDone = runQueued(async () => {});
  await flush();
  assert.equal(getSyncQueueSnapshot().waveTotal, 2);
  assert.equal(getSyncQueueSnapshot().waveCompleted, 1);

  t.mock.timers.tick(900);
  await flush();
  await Promise.all([aDone, bDone]);
  await flush();
  // Actual (buggy) end state: the WAVE_GRACE_MS timer resets both counters to 0 while task
  // "b" is still waiting out the rate-limit gate, so "b" completing only bumps waveCompleted
  // to 1 again, and waveTotal never gets re-incremented for it.
  assert.equal(getSyncQueueSnapshot().waveTotal, 0);
  assert.equal(getSyncQueueSnapshot().waveCompleted, 1);
});
