import assert from 'node:assert/strict';
import test from 'node:test';
import { threeWayMergeExam } from '../src/utils/examMerge.js';
import type { MergeableExamPayload } from '../src/utils/examMerge.js';
import type { MajorExam } from '../src/types/index.js';
import { DEFAULT_INITIALIZATION } from '../src/utils/settings/school.js';

function major(overrides: Partial<MajorExam> & { id: string; name: string }): MajorExam {
  return { items: [], order: 0, ...overrides };
}

function payload(overrides: Partial<MergeableExamPayload> = {}): MergeableExamPayload {
  return {
    items: [],
    title: '',
    majors: [],
    activeMajorId: '',
    alerts: null,
    updatedAt: 0,
    ...overrides,
  };
}

test('threeWayMergeExam: adopts a field changed on only one side', () => {
  const policy = { enabled: true, scope: 'whole-day' as const, bufferBeforeMinutes: 5, bufferAfterMinutes: 5 };
  const result = threeWayMergeExam(
    payload({ weeklyConflictPolicy: null }),
    payload({ weeklyConflictPolicy: null }),
    payload({ weeklyConflictPolicy: policy }),
  );

  assert.deepEqual(result.payload.weeklyConflictPolicy, policy);
  assert.equal(result.conflictCount, 0);
});

test('threeWayMergeExam: keeps different new majors and preserves a local edit', () => {
  const baseMajor = major({ id: 'm1', name: 'Base exam' });
  const result = threeWayMergeExam(
    payload({ majors: [baseMajor], activeMajorId: 'm1' }),
    payload({
      majors: [major({ id: 'm1', name: 'Local rename' }), major({ id: 'm2', name: 'Local new' })],
      activeMajorId: 'm2',
    }),
    payload({ majors: [baseMajor, major({ id: 'm3', name: 'Remote new' })], activeMajorId: 'm1' }),
  );

  assert.deepEqual(result.payload.majors.map(item => item.id), ['m1', 'm2', 'm3']);
  assert.equal(result.payload.majors.find(item => item.id === 'm1')?.name, 'Local rename');
  assert.equal(result.payload.activeMajorId, 'm2');
  assert.equal(result.payload.title, 'Local new');
  assert.equal(result.conflictCount, 0);
});

test('threeWayMergeExam: falls back after deletion of the active major', () => {
  const kept = major({ id: 'm1', name: 'Keep' });
  const deleted = major({ id: 'm2', name: 'Delete' });
  const result = threeWayMergeExam(
    payload({ majors: [kept, deleted], activeMajorId: 'm2' }),
    payload({ majors: [kept], activeMajorId: 'm2' }),
    payload({ majors: [kept, deleted], activeMajorId: 'm2' }),
  );

  assert.deepEqual(result.payload.majors.map(item => item.id), ['m1']);
  assert.equal(result.payload.activeMajorId, 'm1');
  assert.equal(result.payload.title, 'Keep');
});

test('threeWayMergeExam: retains a conflicting local scalar and counts it', () => {
  const result = threeWayMergeExam(
    payload({ activeWeeklyPlanId: null }),
    payload({ activeWeeklyPlanId: 'local-plan' }),
    payload({ activeWeeklyPlanId: 'remote-plan' }),
  );

  assert.equal(result.payload.activeWeeklyPlanId, 'local-plan');
  assert.equal(result.conflictCount, 1);
});

test('threeWayMergeExam: supplies defaults for omitted optional fields', () => {
  const result = threeWayMergeExam(payload(), payload(), payload());

  assert.deepEqual(result.payload.weeklyPlans, []);
  assert.deepEqual(result.payload.activeWeeklyPlanIdByClassId, {});
  assert.deepEqual(result.payload.grades, []);
  assert.deepEqual(result.payload.classes, []);
  assert.deepEqual(result.payload.initialization, DEFAULT_INITIALIZATION);
  assert.equal(result.payload.scheduleMode, 'major-only');
  assert.equal(result.payload.weeklyConflictPolicy, null);
});

test('threeWayMergeExam: always uses the remote updatedAt version', () => {
  const result = threeWayMergeExam(
    payload({ updatedAt: 1 }),
    payload({ updatedAt: 2 }),
    payload({ updatedAt: 3 }),
  );

  assert.equal(result.payload.updatedAt, 3);
});

test('threeWayMergeExam: does not count reordered object keys as a conflict', () => {
  const policy = { enabled: true, scope: 'whole-day' as const, bufferBeforeMinutes: 5, bufferAfterMinutes: 5 };
  const reordered = { bufferAfterMinutes: 5, scope: 'whole-day' as const, bufferBeforeMinutes: 5, enabled: true };
  const result = threeWayMergeExam(
    payload({ weeklyConflictPolicy: policy }),
    payload({ weeklyConflictPolicy: reordered }),
    payload({ weeklyConflictPolicy: policy }),
  );
  assert.equal(result.conflictCount, 0);
});
