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
    items: [{ id: 'i1', name: '语文', startTime: '2026-08-30T09:00', endTime: '2026-08-30T10:30', enabled: true }],
    title: '期中考试',
    majors: [{ id: 'm1', name: '期中考试', items: [] }],
    active_major_id: 'm1',
    alerts: { enabled: true },
    weekly_plans: [{ id: 'w1' }],
    schedule_mode: 'weekly-only',
    active_weekly_plan_id: 'w1',
    active_weekly_plan_by_class: { c1: 'w1' },
    weekly_conflict_policy: { enabled: true, scope: 'whole-day' },
    grades: [{ id: 'g1', name: '高一', order: 0, enabled: true }],
    classes: [{ id: 'c1', gradeId: 'g1', name: '1班', order: 0, enabled: true }],
    initialization: { completedAt: 123 },
    design_policy: { rules: [], updatedAt: 5 },
    major_batch_presets: {
      subjectGroups: [
        {
          id: 'subjects-1',
          name: '理科组',
          subjects: ['物理'],
          custom: true,
          updatedAt: 1700000000100,
        },
      ],
      timeGroups: [
        {
          id: 'times-1',
          name: '上午场',
          slots: [{ start: '09:00', end: '10:30' }],
          custom: true,
          updatedAt: 1700000000100,
        },
      ],
      updatedAt: 1700000000100,
    },
    revisions: { major: 2, classes: 5 },
    updated_at: 1700000000000,
  };
  const payload = examPayload(row);
  assert.equal(payload.ok, true);
  assert.equal(payload.items[0]?.id, 'i1');
  assert.equal(payload.title, '期中考试');
  assert.equal(payload.majors[0]?.id, 'm1');
  assert.equal(payload.activeMajorId, 'm1');
  assert.equal(payload.alerts?.enabled, true);
  assert.equal(payload.weeklyPlans[0]?.id, 'w1');
  assert.equal(payload.scheduleMode, 'weekly-only');
  assert.equal(payload.activeWeeklyPlanId, 'w1');
  assert.deepEqual(payload.activeWeeklyPlanIdByClassId, { c1: 'w1' });
  assert.deepEqual(payload.grades, [{ id: 'g1', name: '高一', order: 0, enabled: true }]);
  assert.deepEqual(payload.classes, [{ id: 'c1', gradeId: 'g1', name: '1班', order: 0, enabled: true }]);
  assert.equal(payload.initialization?.completedAt, 123);
  assert.deepEqual(payload.weeklyConflictPolicy, {
    enabled: true,
    scope: 'whole-day',
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  });
  assert.deepEqual(payload.designPolicy, { rules: [], updatedAt: 5 });
  assert.deepEqual(payload.majorBatchPresets, {
    subjectGroups: [
      {
        id: 'subjects-1',
        name: '理科组',
        subjects: ['物理'],
        custom: true,
        updatedAt: 1700000000100,
        order: 0,
      },
    ],
    timeGroups: [
      {
        id: 'times-1',
        name: '上午场',
        slots: [{ start: '09:00', end: '10:30', dayOffset: 0 }],
        custom: true,
        updatedAt: 1700000000100,
        order: 0,
      },
    ],
    updatedAt: 1700000000100,
  });
  assert.equal(payload.updatedAt, 1700000000000);
  assert.deepEqual(payload.revisions, { major: 2, classes: 5 });
});

test('examPayload: fills in safe defaults for a bare/empty row', () => {
  const payload = examPayload({});
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.items, []);
  assert.equal(payload.title, '');
  assert.deepEqual(payload.majors, []);
  assert.equal(payload.activeMajorId, '');
  assert.equal(payload.alerts, null);
  assert.deepEqual(payload.weeklyPlans, []);
  assert.equal(payload.scheduleMode, 'major-only');
  assert.equal(payload.activeWeeklyPlanId, '');
  assert.deepEqual(payload.activeWeeklyPlanIdByClassId, {});
  assert.deepEqual(payload.grades, []);
  assert.deepEqual(payload.classes, []);
  assert.equal(payload.initialization?.completedAt, 0);
  assert.equal(payload.weeklyConflictPolicy, null);
  assert.deepEqual(payload.designPolicy, { rules: [], updatedAt: 0 });
  assert.deepEqual(payload.majorBatchPresets, { subjectGroups: [], timeGroups: [], updatedAt: 0 });
  assert.deepEqual(payload.revisions, {});
  assert.equal(payload.updatedAt, 0);
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
  assert.equal(payload.initialization?.completedAt, 0);
});
