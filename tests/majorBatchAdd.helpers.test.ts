import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays,
  customSubjectToTemplate,
  customTimeToPattern,
  toLocalIso,
} from '../src/components/major-batch/majorBatchAdd.helpers.js';

test('school subject presets are exposed as school templates', () => {
  const template = customSubjectToTemplate({
    id: 'subjects-1',
    name: '理科组',
    subjects: ['物理', '化学'],
    custom: true,
    updatedAt: 1,
    order: 0,
  });

  assert.equal(template.source, 'school');
  assert.equal(template.category, 'school');
  assert.deepEqual(template.subjects, ['物理', '化学']);
});

test('school time presets are exposed as school patterns', () => {
  const pattern = customTimeToPattern({
    id: 'times-1',
    name: '上午场',
    slots: [{ start: '08:00', end: '10:00', dayOffset: 0 }],
    custom: true,
    updatedAt: 1,
    order: 0,
  });

  assert.equal(pattern.source, 'school');
  assert.equal(pattern.category, 'school');
  assert.deepEqual(pattern.slots, [{ start: '08:00', end: '10:00', dayOffset: 0 }]);
});

test('addDays advances the calendar date key in any host timezone', () => {
  assert.equal(addDays('2026-10-23', 1), '2026-10-24');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-10-23', -1), '2026-10-22');
});

test('a cross-day end time rolls into the next date key', () => {
  const start = toLocalIso('2026-10-23', '23:00');
  const end = toLocalIso('2026-10-23', '01:00', true);
  assert.equal(end, '2026-10-24T01:00');
  assert.ok(new Date(start).getTime() < new Date(end).getTime());
});
