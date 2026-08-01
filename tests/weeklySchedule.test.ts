import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDaysToDateKey,
  createEmptyWeeklyPlan,
  getShanghaiDateKey,
  getWeekTypeForDate,
  isoWeekdayOfDateKey,
  resolveWeeklyOccurrences,
  validateWeeklyPlan,
  weekIndexOfDateKey,
} from '../src/utils/weeklySchedule.js';
import type { WeeklyExamItem, WeeklyExamOverride, WeeklyPlan } from '../src/types/exam.js';

function shanghaiNoonMsFor(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day, 4, 0, 0);
}

function item(overrides: Partial<WeeklyExamItem> & { id: string; weekday: WeeklyExamItem['weekday'] }): WeeklyExamItem {
  return {
    name: 'Item',
    startTime: '19:00',
    endTime: '20:00',
    enabled: true,
    order: 0,
    ...overrides,
  };
}

function plan(overrides: Partial<WeeklyPlan> = {}): WeeklyPlan {
  return {
    id: 'plan-1',
    name: 'Plan',
    enabled: true,
    timezone: 'Asia/Shanghai',
    activeFrom: '2020-01-01',
    activeUntil: null,
    repeatEveryWeeks: 1,
    anchorDate: '2026-01-05',
    weekMode: 'single',
    excludeOfficialHolidays: false,
    items: [],
    excludedDates: [],
    overrides: [],
    order: 0,
    gradeId: '',
    classId: '',
    ...overrides,
  };
}

test('weeklySchedule: maps instants to the correct Shanghai date', () => {
  assert.equal(getShanghaiDateKey(Date.UTC(2024, 0, 1, 20, 0, 0)), '2024-01-02');
  assert.equal(getShanghaiDateKey(Date.UTC(2024, 0, 1, 4, 0, 0)), '2024-01-01');
});

test('weeklySchedule: adds days across month, leap-day, and year boundaries', () => {
  assert.equal(addDaysToDateKey('2024-01-31', 1), '2024-02-01');
  assert.equal(addDaysToDateKey('2024-02-28', 1), '2024-02-29');
  assert.equal(addDaysToDateKey('2024-01-01', -1), '2023-12-31');
});

test('weeklySchedule: maps ISO weekdays from Monday through Sunday', () => {
  assert.equal(isoWeekdayOfDateKey('2026-01-05'), 1);
  assert.equal(isoWeekdayOfDateKey('2026-01-04'), 7);
});

test('weeklySchedule: uses Monday-Sunday calendar-week groups', () => {
  const monday = weekIndexOfDateKey('2026-01-05');
  assert.equal(weekIndexOfDateKey('2026-01-04'), monday - 1);
  assert.equal(weekIndexOfDateKey('2026-01-11'), monday);
  assert.equal(weekIndexOfDateKey('2026-01-12'), monday + 1);
});

test('weeklySchedule: alternates A/B week types from the anchor week', () => {
  const anchor = { anchorDate: '2026-01-05' };
  assert.equal(getWeekTypeForDate(anchor, '2026-01-05'), 'a');
  assert.equal(getWeekTypeForDate(anchor, '2026-01-12'), 'b');
  assert.equal(getWeekTypeForDate(anchor, '2026-01-19'), 'a');
});

test('resolveWeeklyOccurrences: produces an eligible occurrence for today', () => {
  const result = resolveWeeklyOccurrences(
    plan({ items: [item({ id: 'i1', weekday: 1 })] }),
    shanghaiNoonMsFor('2026-01-05'),
    { daysBack: 0, daysForward: 0 },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'i1@2026-01-05');
  assert.equal(result[0].startTime, '2026-01-05T19:00:00');
  assert.equal(result[0].endTime, '2026-01-05T20:00:00');
  assert.equal(result[0].kind, 'weekly');
  assert.equal(result[0].forced, false);
});

test('resolveWeeklyOccurrences: ignores missing or disabled plans and items', () => {
  const now = shanghaiNoonMsFor('2026-01-05');
  const enabledItem = item({ id: 'i1', weekday: 1 });

  assert.deepEqual(resolveWeeklyOccurrences(plan({ items: [enabledItem], enabled: false }), now), []);
  assert.deepEqual(resolveWeeklyOccurrences(null, now), []);
  assert.deepEqual(resolveWeeklyOccurrences(undefined, now), []);
  assert.deepEqual(
    resolveWeeklyOccurrences(plan({ items: [item({ id: 'i1', weekday: 1, enabled: false })] }), now, { daysBack: 0, daysForward: 0 }),
    [],
  );
});

test('resolveWeeklyOccurrences: applies the active date range and excluded dates', () => {
  const now = shanghaiNoonMsFor('2026-01-05');
  const monday = item({ id: 'i1', weekday: 1 });

  assert.deepEqual(resolveWeeklyOccurrences(plan({ items: [monday], activeFrom: '2026-01-06' }), now, { daysBack: 0, daysForward: 0 }), []);
  assert.deepEqual(resolveWeeklyOccurrences(plan({ items: [monday], activeUntil: '2026-01-04' }), now, { daysBack: 0, daysForward: 0 }), []);
  assert.deepEqual(resolveWeeklyOccurrences(plan({ items: [monday], excludedDates: ['2026-01-05'] }), now, { daysBack: 0, daysForward: 0 }), []);
});

test('resolveWeeklyOccurrences: excludes built-in official holidays', () => {
  const result = resolveWeeklyOccurrences(
    plan({
      items: [item({ id: 'i1', weekday: 4 })],
      anchorDate: '2026-10-01',
      excludeOfficialHolidays: true,
    }),
    shanghaiNoonMsFor('2026-10-01'),
    { daysBack: 0, daysForward: 0 },
  );

  assert.deepEqual(result, []);
});

test('resolveWeeklyOccurrences: aligns repeat intervals with the anchor week', () => {
  const result = resolveWeeklyOccurrences(
    plan({ items: [item({ id: 'i1', weekday: 1 })], repeatEveryWeeks: 2 }),
    shanghaiNoonMsFor('2026-01-05'),
    { daysBack: 0, daysForward: 14 },
  );

  assert.deepEqual(result.map(occurrence => occurrence.date), ['2026-01-05', '2026-01-19']);
});

test('resolveWeeklyOccurrences: uses A/B filtering instead of repeat intervals', () => {
  const result = resolveWeeklyOccurrences(
    plan({
      weekMode: 'ab',
      items: [
        item({ id: 'a1', weekday: 1, weekType: 'a' }),
        item({ id: 'b1', weekday: 1, weekType: 'b' }),
      ],
    }),
    shanghaiNoonMsFor('2026-01-05'),
    { daysBack: 0, daysForward: 7 },
  );

  assert.deepEqual(result.map(occurrence => [occurrence.date, occurrence.weeklyItemId]), [
    ['2026-01-05', 'a1'],
    ['2026-01-12', 'b1'],
  ]);
});

test('resolveWeeklyOccurrences: applies cancel overrides only on their date', () => {
  const override: WeeklyExamOverride = { id: 'ov1', sourceItemId: 'i1', date: '2026-01-05', action: 'cancel' };
  const weeklyPlan = plan({ items: [item({ id: 'i1', weekday: 1 })], overrides: [override] });

  assert.deepEqual(resolveWeeklyOccurrences(weeklyPlan, shanghaiNoonMsFor('2026-01-05'), { daysBack: 0, daysForward: 0 }), []);
  assert.equal(resolveWeeklyOccurrences(weeklyPlan, shanghaiNoonMsFor('2026-01-12'), { daysBack: 0, daysForward: 0 }).length, 1);
});

test('resolveWeeklyOccurrences: applies replacement schedule and forced status', () => {
  const override: WeeklyExamOverride = {
    id: 'ov1',
    sourceItemId: 'i1',
    date: '2026-01-05',
    action: 'replace',
    targetDate: '2026-01-06',
    name: 'Rescheduled',
    startTime: '21:00',
    endTime: '22:30',
    endNextDay: true,
    forceRunDuringMajorExam: true,
  };
  const [occurrence] = resolveWeeklyOccurrences(
    plan({ items: [item({ id: 'i1', weekday: 1 })], overrides: [override] }),
    shanghaiNoonMsFor('2026-01-05'),
    { daysBack: 0, daysForward: 0 },
  );

  assert.equal(occurrence.id, 'i1@2026-01-05');
  assert.equal(occurrence.date, '2026-01-06');
  assert.equal(occurrence.startTime, '2026-01-06T21:00:00');
  assert.equal(occurrence.endTime, '2026-01-07T22:30:00');
  assert.equal(occurrence.forced, true);
});

test('createEmptyWeeklyPlan: uses safe defaults based on the current Shanghai date', () => {
  const result = createEmptyWeeklyPlan(shanghaiNoonMsFor('2026-01-05'));

  assert.equal(result.activeFrom, '2026-01-05');
  assert.equal(result.anchorDate, '2026-01-05');
  assert.equal(result.activeUntil, null);
  assert.equal(result.enabled, true);
  assert.equal(result.weekMode, 'single');
  assert.equal(result.repeatEveryWeeks, 1);
  assert.deepEqual(result.items, []);
  assert.ok(result.id.startsWith('weekly_'));
});

test('validateWeeklyPlan: accepts a well-formed plan', () => {
  assert.deepEqual(validateWeeklyPlan(plan({ items: [item({ id: 'i1', weekday: 1 })] })), []);
});

test('validateWeeklyPlan: reports invalid dates and repeat intervals', () => {
  assert.ok(validateWeeklyPlan(plan({ activeFrom: 'not-a-date' })).some(issue => issue.code === 'plan.activeFrom' && issue.level === 'error'));
  assert.ok(validateWeeklyPlan(plan({ activeFrom: '2026-01-10', activeUntil: '2026-01-01' })).some(issue => issue.code === 'plan.activeUntil' && issue.level === 'error'));
  assert.ok(validateWeeklyPlan(plan({ repeatEveryWeeks: 20 })).some(issue => issue.code === 'plan.repeatEveryWeeks' && issue.level === 'warn'));
});

test('validateWeeklyPlan: reports invalid items and duplicate schedules', () => {
  assert.ok(validateWeeklyPlan(plan({ items: [item({ id: 'i1', weekday: 9 as WeeklyExamItem['weekday'] })] })).some(issue => issue.code === 'item.weekday'));
  assert.ok(validateWeeklyPlan(plan({ items: [item({ id: 'i1', weekday: 1, startTime: '25:00' })] })).some(issue => issue.code === 'item.time'));
  assert.ok(validateWeeklyPlan(plan({ items: [item({ id: 'i1', weekday: 1, startTime: '20:00', endTime: '19:00' })] })).some(issue => issue.code === 'item.range'));
  assert.equal(validateWeeklyPlan(plan({ items: [item({ id: 'i1', weekday: 1, startTime: '20:00', endTime: '19:00', endNextDay: true })] })).some(issue => issue.code === 'item.range'), false);
  assert.ok(validateWeeklyPlan(plan({ items: [item({ id: 'i1', weekday: 1, name: 'Same' }), item({ id: 'i2', weekday: 1, name: 'Same' })] })).some(issue => issue.code === 'item.duplicate'));
});

test('validateWeeklyPlan: reports overrides that reference a missing item', () => {
  const issues = validateWeeklyPlan(plan({
    items: [item({ id: 'i1', weekday: 1 })],
    overrides: [{ id: 'ov1', sourceItemId: 'missing', date: '2026-01-05', action: 'cancel' }],
  }));

  assert.ok(issues.some(issue => issue.code === 'override.orphan'));
});
