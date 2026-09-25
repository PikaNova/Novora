import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyPlan } from '../src/types/exam.js';
import type { SchoolClass, SchoolGrade } from '../src/types/school.js';
import { parseZonedTime } from '../src/utils/zonedTime.js';
import { getShanghaiDateKey, isoWeekdayOfDateKey } from '../src/utils/weeklySchedule.js';
import { buildWeeklyOccurrenceRows } from '../src/utils/weeklyOccurrenceRows.js';

const NOW = parseZonedTime('2026-09-18T09:00:00');
const TODAY = getShanghaiDateKey(NOW);
const TODAY_WEEKDAY = isoWeekdayOfDateKey(TODAY);

const grades: SchoolGrade[] = [{ id: 'g1', name: '初二' }] as SchoolGrade[];
const classes: SchoolClass[] = [{ id: 'c1', gradeId: 'g1', name: '1班' }] as SchoolClass[];

function plan(patch: Partial<WeeklyPlan> = {}): WeeklyPlan {
  return {
    id: 'p1',
    name: '初二数学周测',
    enabled: true,
    timezone: 'Asia/Shanghai',
    activeFrom: '2026-08-01',
    activeUntil: null,
    repeatEveryWeeks: 1,
    anchorDate: '2026-08-31',
    weekMode: 'single',
    excludeOfficialHolidays: false,
    items: [
      {
        id: 'w1',
        name: '初二数学周测',
        weekday: TODAY_WEEKDAY,
        startTime: '10:30',
        endTime: '11:30',
        enabled: true,
        order: 0,
      },
    ],
    excludedDates: [],
    overrides: [],
    order: 0,
    gradeId: 'g1',
    classId: 'c1',
    ...patch,
  } as WeeklyPlan;
}

test('buildWeeklyOccurrenceRows: 把周测展开成今天的实例行并带上班级/年级名', () => {
  const rows = buildWeeklyOccurrenceRows({ plans: [plan()], classes, grades, now: NOW, daysForward: 0 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dateKey, TODAY);
  assert.equal(rows[0].startClock, '10:30');
  assert.equal(rows[0].endClock, '11:30');
  assert.equal(rows[0].className, '1班');
  assert.equal(rows[0].gradeName, '初二');
  assert.ok(rows[0].endAt > rows[0].startAt);
});

test('buildWeeklyOccurrenceRows: 停用的计划与停用的周测项都不产出实例', () => {
  assert.deepEqual(
    buildWeeklyOccurrenceRows({ plans: [plan({ enabled: false })], classes, grades, now: NOW, daysForward: 0 }),
    [],
  );
  const disabledItem = plan();
  disabledItem.items = disabledItem.items.map((item) => ({ ...item, enabled: false }));
  assert.deepEqual(buildWeeklyOccurrenceRows({ plans: [disabledItem], classes, grades, now: NOW, daysForward: 0 }), []);
});

test('buildWeeklyOccurrenceRows: 跨天周测的结束时间推到第二天，保证 endAt > startAt', () => {
  const late = plan();
  late.items = late.items.map((item) => ({ ...item, startTime: '23:00', endTime: '00:30', endNextDay: true }));
  const rows = buildWeeklyOccurrenceRows({ plans: [late], classes, grades, now: NOW, daysForward: 0 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].endAt - rows[0].startAt, 90 * 60 * 1000);
});

test('buildWeeklyOccurrenceRows: 多班多计划按开始时间排序', () => {
  const classes2: SchoolClass[] = [
    { id: 'c1', gradeId: 'g1', name: '1班' },
    { id: 'c2', gradeId: 'g1', name: '2班' },
  ] as SchoolClass[];
  const early = plan({ id: 'p-early', classId: 'c1' });
  early.items = early.items.map((item) => ({ ...item, startTime: '08:00', endTime: '08:40' }));
  const late = plan({ id: 'p-late', classId: 'c2' });
  late.items = late.items.map((item) => ({ ...item, startTime: '14:00', endTime: '14:40' }));
  const rows = buildWeeklyOccurrenceRows({
    plans: [late, early],
    activePlanIdByClassId: { c1: 'p-early', c2: 'p-late' },
    classes: classes2,
    grades,
    now: NOW,
    daysForward: 0,
  });
  assert.deepEqual(
    rows.map((row) => row.className),
    ['1班', '2班'],
  );
});
