import assert from 'node:assert/strict';
import test from 'node:test';
import type { PendingExamSync } from '../src/services/examOutbox.js';
import type { ExamPayload } from '../src/services/examService.js';

const testGlobals = globalThis as typeof globalThis & {
  __APP_VERSION__?: string;
  __COMMIT_SHA__?: string;
};
testGlobals.__APP_VERSION__ = 'test';
testGlobals.__COMMIT_SHA__ = 'test';

const { __detectGhostSaveForTests: detectGhostSave } = await import('../src/services/examOutbox.js');

const BASE_UPDATED_AT = 1_000_000;
const NOW = 2_000_000;

function makePayload(overrides: Partial<ExamPayload> = {}): ExamPayload {
  return {
    items: [],
    title: 'Example',
    majors: [],
    activeMajorId: '',
    alerts: null,
    updatedAt: BASE_UPDATED_AT,
    ...overrides,
  };
}

function makePending(overrides: Partial<PendingExamSync> = {}): PendingExamSync {
  return {
    payload: makePayload(),
    baseSnapshot: makePayload({ updatedAt: BASE_UPDATED_AT }),
    savedAt: NOW,
    ...overrides,
  };
}

test('ghost save matches an identical remote payload inside the window', () => {
  assert.equal(detectGhostSave(makePending(), makePayload({ updatedAt: NOW - 1_000 }), NOW), true);
});

test('ghost save matches at 119 seconds', () => {
  assert.equal(detectGhostSave(makePending(), makePayload({ updatedAt: NOW - 119_000 }), NOW), true);
});

test('ghost save keeps the exact 120-second boundary inclusive', () => {
  assert.equal(detectGhostSave(makePending(), makePayload({ updatedAt: NOW - 120_000 }), NOW), true);
});

test('ghost save rejects at 120.001 seconds', () => {
  assert.equal(detectGhostSave(makePending(), makePayload({ updatedAt: NOW - 120_001 }), NOW), false);
});

test('ghost save rejects at 121 seconds', () => {
  assert.equal(detectGhostSave(makePending(), makePayload({ updatedAt: NOW - 121_000 }), NOW), false);
});

test('ghost save requires a remote version newer than the base snapshot', () => {
  assert.equal(
    detectGhostSave(makePending(), makePayload({ updatedAt: BASE_UPDATED_AT }), BASE_UPDATED_AT + 1_000),
    false,
  );
});

test('ghost save accepts a remote version one millisecond after the base', () => {
  assert.equal(
    detectGhostSave(makePending(), makePayload({ updatedAt: BASE_UPDATED_AT + 1 }), BASE_UPDATED_AT + 1_000),
    true,
  );
});

test('ghost save does not use time alone when content differs', () => {
  const pending = makePending({ payload: makePayload({ title: 'Local' }) });
  const remote = makePayload({ updatedAt: NOW - 1_000, title: 'Remote' });
  assert.equal(detectGhostSave(pending, remote, NOW), false);
});

test('ghost save treats a missing base snapshot as version zero', () => {
  const pending = makePending({ baseSnapshot: null });
  const remote = makePayload({ updatedAt: NOW - 1_000 });
  assert.equal(detectGhostSave(pending, remote, NOW), true);
});

test('ghost save ignores object key order in serialized records', () => {
  const pending = makePending({
    payload: makePayload({
      items: [{ id: '1', subject: 'Math', startAt: 100, endAt: 200 }] as unknown as ExamPayload['items'],
    }),
  });
  const remote = makePayload({
    items: [{ endAt: 200, startAt: 100, subject: 'Math', id: '1' }] as unknown as ExamPayload['items'],
    updatedAt: NOW - 1_000,
  });
  assert.equal(detectGhostSave(pending, remote, NOW), true);
});
