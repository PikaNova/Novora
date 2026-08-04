import assert from 'node:assert/strict';
import test from 'node:test';
import { examPayload, arrayValue, objectValue } from '../api/_exams/payload.js';
import type { ExamRow } from '../api/_exams/types.js';

test('arrayValue: passes arrays through and defaults everything else to []', () => {
  assert.deepEqual(arrayValue([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(arrayValue(null), []);
  assert.deepEqual(arrayValue(undefined), []);
  assert.deepEqual(arrayValue('not-an-array'), []);
  assert.deepEqual(arrayValue({ 0: 'a' }), []);
});

test('objectValue: passes plain objects through and defaults arrays/primitives/null to {}', () => {
  assert.deepEqual(objectValue({ a: 1 }), { a: 1 });
  assert.deepEqual(objectValue(null), {});
  assert.deepEqual(objectValue(undefined), {});
  assert.deepEqual(objectValue([1, 2]), {});
  assert.deepEqual(objectValue('x'), {});
});

test('examPayload: maps every snake_case DB column to its camelCase API field with real values', () => {
  const row: ExamRow = {
    items: [{ id: 'i1' }],
    title: '期中考试',
    majors: [{ id: 'm1' }],
    active_major_id: 'm1',
    alerts: { enabled: true },
    weekly_plans: [{ id: 'w1' }],
    schedule_mode: 'weekly-only',
    active_weekly_plan_id: 'w1',
    active_weekly_plan_by_class: { c1: 'w1' },
    weekly_conflict_policy: { enabled: true, scope: 'whole-day' },
    grades: [{ id: 'g1' }],
    classes: [{ id: 'c1' }],
    initialization: { completedAt: 123 },
    design_policy: { rules: [], updatedAt: 5 },
    updated_at: 1700000000000,
  };
  const payload = examPayload(row);
  assert.deepEqual(payload, {
    ok: true,
    items: [{ id: 'i1' }],
    title: '期中考试',
    majors: [{ id: 'm1' }],
    activeMajorId: 'm1',
    alerts: { enabled: true },
    weeklyPlans: [{ id: 'w1' }],
    scheduleMode: 'weekly-only',
    activeWeeklyPlanId: 'w1',
    activeWeeklyPlanIdByClassId: { c1: 'w1' },
    grades: [{ id: 'g1' }],
    classes: [{ id: 'c1' }],
    initialization: { completedAt: 123 },
    weeklyConflictPolicy: { enabled: true, scope: 'whole-day' },
    designPolicy: { rules: [], updatedAt: 5 },
    updatedAt: 1700000000000,
  });
});

test('examPayload: fills in safe defaults for a bare/empty row', () => {
  const payload = examPayload({});
  assert.deepEqual(payload, {
    ok: true,
    items: [],
    title: '',
    majors: [],
    activeMajorId: '',
    alerts: null,
    weeklyPlans: [],
    scheduleMode: 'major-only',
    activeWeeklyPlanId: '',
    activeWeeklyPlanIdByClassId: {},
    grades: [],
    classes: [],
    initialization: {},
    weeklyConflictPolicy: null,
    designPolicy: {},
    updatedAt: 0,
  });
});

test('examPayload: coerces a string updated_at (as returned by some drivers for BIGINT) into a number', () => {
  const payload = examPayload({ updated_at: '1700000000123' });
  assert.equal(payload.updatedAt, 1700000000123);
  assert.equal(typeof payload.updatedAt, 'number');
});

test('examPayload: non-array/non-object stray values still fall back to safe defaults', () => {
  const payload = examPayload({
    items: 'not-an-array' as unknown as unknown[],
    majors: null,
    initialization: [1, 2] as unknown as Record<string, unknown>,
  });
  assert.deepEqual(payload.items, []);
  assert.deepEqual(payload.majors, []);
  assert.deepEqual(payload.initialization, {});
});
