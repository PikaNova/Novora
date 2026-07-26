import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectiveSchedule } from '../src/utils/scheduleConflict.js';

const regular = {
  id: 'regular', name: '正式期中考试', targetGradeIds: ['g1'], items: [
    { id: 'regular-1', name: '数学', startTime: '2026-08-01T09:00', endTime: '2026-08-01T11:00', enabled: true, order: 0 },
  ],
};

function resolve(priorityOverSchedule: boolean) {
  return resolveEffectiveSchedule({
    scheduleMode: 'major-only', activeMajorId: 'regular', activeWeeklyPlanId: null,
    selectedGradeId: 'g1', selectedClassId: 'c1', weeklyPlans: [],
    majors: [regular, {
      id: 'quick', name: '临时统一考试', targetGradeIds: ['g1'], temporary: true, priorityOverSchedule, items: [
        { id: 'quick-1', name: '化学', startTime: '2026-08-01T09:30', endTime: '2026-08-01T10:30', enabled: true, order: 0 },
      ],
    }],
  }, new Date('2026-08-01T08:00').getTime());
}

test('quick unified exams retain formal major exams by default', () => {
  assert.deepEqual(resolve(false).activeItems.map(item => item.name), ['数学', '化学']);
});

test('high-priority quick unified exams replace only overlapping formal major exams', () => {
  assert.deepEqual(resolve(true).activeItems.map(item => item.name), ['化学']);
});
