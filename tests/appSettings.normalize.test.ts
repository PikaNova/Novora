import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAlerts, normalizeExam } from '../src/utils/appSettings.js';
import {
  normalizeGrades,
  normalizeClasses,
  normalizeSelectedGradeId,
  normalizeSelectedClassId,
  normalizeInitialization,
} from '../src/utils/settings/school.js';
import {
  normalizeWeeklyPlan,
  normalizeConflictPolicy,
  resolveActiveWeeklyPlanIdByClass,
} from '../src/utils/settings/weekly.js';
import { normalizeDesignPolicy } from '../src/utils/settings/design.js';
import { normalizeMajorBatchSettings } from '../src/utils/settings/majorBatch.js';

// ---------- normalizeAlerts ----------

test('normalizeAlerts: fills in every default when raw is missing', () => {
  const alerts = normalizeAlerts(undefined);
  assert.equal(alerts.enabled, true);
  assert.equal(alerts.durationSec, 8);
  assert.equal(alerts.silentMode, 'all');
  assert.deepEqual(alerts.custom, []);
  assert.equal(alerts.updatedAt, 0);
  assert.equal(Object.keys(alerts.states).length, 6);
  assert.equal(alerts.states['15min'].title, '距开考 15 分钟');
});

test('normalizeAlerts: clamps durationSec into the 3-20 range', () => {
  assert.equal(normalizeAlerts({ durationSec: 100 }).durationSec, 20);
  assert.equal(normalizeAlerts({ durationSec: 1 }).durationSec, 3);
  assert.equal(normalizeAlerts({ durationSec: 'not-a-number' }).durationSec, 8);
  assert.equal(normalizeAlerts({ durationSec: 12 }).durationSec, 12);
});

test('normalizeAlerts: merges partial per-state overrides onto defaults instead of replacing them', () => {
  const alerts = normalizeAlerts({ states: { start: { enabled: false } } });
  assert.equal(alerts.states.start.enabled, false);
  // untouched fields on the same state key are preserved from the default
  assert.equal(alerts.states.start.title, '开始考试');
  // untouched state keys are completely unaffected
  assert.equal(alerts.states['5min'].enabled, true);
});

test('normalizeAlerts: sanitizes custom reminders and rejects invalid enum-like fields', () => {
  const alerts = normalizeAlerts({
    custom: [
      { id: 'c1', name: '自定义A', enabled: false, anchor: 'afterStart', offsetMin: 30, tone: 'ended', label: '提示', title: 'T', subtext: 'S' },
      { anchor: 'not-a-real-anchor', offsetMin: -5, tone: 'not-a-real-tone' },
      null,
      false,
    ],
  });
  assert.equal(alerts.custom.length, 2);
  assert.equal(alerts.custom[0].id, 'c1');
  assert.equal(alerts.custom[0].anchor, 'afterStart');
  assert.equal(alerts.custom[0].offsetMin, 30);
  assert.equal(alerts.custom[0].tone, 'ended');
  // second entry: invalid anchor/tone fall back to defaults, negative offset clamps to 0
  assert.equal(alerts.custom[1].anchor, 'beforeStart');
  assert.equal(alerts.custom[1].tone, '15min');
  assert.equal(alerts.custom[1].offsetMin, 0);
  assert.equal(alerts.custom[1].name, '自定义提醒2');
});

test('normalizeAlerts: rejects unknown silentMode values', () => {
  assert.equal(normalizeAlerts({ silentMode: 'keyOnly' }).silentMode, 'keyOnly');
  assert.equal(normalizeAlerts({ silentMode: 'bogus' }).silentMode, 'all');
});

// ---------- normalizeExam ----------

test('normalizeExam: builds a single default major when raw is missing', () => {
  const exam = normalizeExam(undefined);
  assert.equal(exam.majors.length, 1);
  assert.equal(exam.majors[0].name, '2026年高考');
  assert.equal(exam.activeMajorId, exam.majors[0].id);
  assert.equal(exam.title, '2026年高考');
  assert.deepEqual(exam.items, []);
  assert.equal(exam.scheduleMode, 'major-only');
});

test('normalizeExam: migrates legacy title/items-only data into a single wrapped major', () => {
  const exam = normalizeExam({
    title: '期中考试',
    items: [{ id: 'x1', name: '语文', startTime: '2026-01-01T08:00', endTime: '2026-01-01T10:00' }],
  });
  assert.equal(exam.majors.length, 1);
  assert.equal(exam.majors[0].name, '期中考试');
  assert.equal(exam.activeMajorId, exam.majors[0].id);
  assert.equal(exam.title, '期中考试');
  assert.equal(exam.items.length, 1);
  assert.equal(exam.items[0].name, '语文');
});

test('normalizeExam: sorts multiple majors by order and mirrors the active one', () => {
  const exam = normalizeExam({
    activeMajorId: 'm2',
    majors: [
      { id: 'm2', name: '二模', order: 1, items: [{ id: 'i1', name: '数学', startTime: '2026-05-01T09:00', endTime: '2026-05-01T11:00' }] },
      { id: 'm1', name: '一模', order: 0, items: [] },
    ],
  });
  assert.deepEqual(exam.majors.map(m => m.id), ['m1', 'm2']);
  assert.deepEqual(exam.majors.map(m => m.order), [0, 1]);
  assert.equal(exam.activeMajorId, 'm2');
  assert.equal(exam.title, '二模');
  assert.equal(exam.items[0].name, '数学');
});

test('normalizeExam: falls back to the first major when activeMajorId does not match any major', () => {
  const exam = normalizeExam({
    activeMajorId: 'does-not-exist',
    majors: [
      { id: 'a', name: 'A', items: [] },
      { id: 'b', name: 'B', items: [] },
    ],
  });
  assert.equal(exam.activeMajorId, 'a');
  assert.equal(exam.title, 'A');
});

test('normalizeExam: rejects an invalid scheduleMode', () => {
  assert.equal(normalizeExam({ scheduleMode: 'not-a-real-mode' }).scheduleMode, 'major-only');
  assert.equal(normalizeExam({ scheduleMode: 'weekly-only' }).scheduleMode, 'weekly-only');
});

test('normalizeExam: cross-normalizes grades/classes/selection and weekly plan selection together', () => {
  const exam = normalizeExam({
    grades: [{ id: 'g1', name: '高一' }],
    classes: [{ id: 'c1', gradeId: 'g1', name: '1班' }],
    selectedGradeId: 'g1',
    selectedClassId: 'c1',
    weeklyPlans: [{ id: 'w1', name: '周测A', gradeId: 'g1', classId: 'c1', activeFrom: '2026-01-01' }],
    activeWeeklyPlanId: 'w1',
  });
  assert.equal(exam.grades[0].id, 'g1');
  assert.equal(exam.classes[0].id, 'c1');
  assert.equal(exam.selectedGradeId, 'g1');
  assert.equal(exam.selectedClassId, 'c1');
  assert.equal(exam.weeklyPlans[0].id, 'w1');
  assert.equal(exam.activeWeeklyPlanId, 'w1');
  assert.equal(exam.activeWeeklyPlanIdByClassId['c1'], 'w1');
});

test('normalizeExam: drops an activeWeeklyPlanId that does not match any plan, then falls back to the first plan', () => {
  const exam = normalizeExam({
    activeWeeklyPlanId: 'does-not-exist',
    weeklyPlans: [{ id: 'w1', name: '周测A' }],
  });
  assert.equal(exam.activeWeeklyPlanId, 'w1');
});

// ---------- settings/school ----------

test('normalizeGrades: filters falsy entries and fills defaults', () => {
  const grades = normalizeGrades([{ id: 'g1', name: '高一' }, null, { id: 'g2', name: '高二', order: 5, enabled: false }]);
  assert.deepEqual(grades, [
    { id: 'g1', name: '高一', order: 0, enabled: true },
    { id: 'g2', name: '高二', order: 5, enabled: false },
  ]);
  assert.deepEqual(normalizeGrades(undefined), []);
});

test('normalizeClasses: drops classes whose gradeId does not match a known grade', () => {
  const grades = normalizeGrades([{ id: 'g1', name: '高一' }]);
  const classes = normalizeClasses(
    [
      { id: 'c1', gradeId: 'g1', name: '1班' },
      { id: 'c2', gradeId: 'g-missing', name: 'X班' },
    ],
    grades,
  );
  assert.equal(classes.length, 1);
  assert.equal(classes[0].id, 'c1');
});

test('normalizeClasses: normalizes the track subject list (dedup + alias)', () => {
  const grades = normalizeGrades([{ id: 'g1', name: '高一' }]);
  const classes = normalizeClasses([{ id: 'c1', gradeId: 'g1', name: '1班', track: ['物理', '英语', '物理'] }], grades);
  assert.deepEqual(classes[0].track, ['物理', '外语']);
});

test('normalizeSelectedGradeId / normalizeSelectedClassId: only accept ids that exist and match', () => {
  const grades = normalizeGrades([{ id: 'g1', name: '高一' }]);
  const classes = normalizeClasses([{ id: 'c1', gradeId: 'g1', name: '1班' }], grades);
  assert.equal(normalizeSelectedGradeId('g1', grades), 'g1');
  assert.equal(normalizeSelectedGradeId('g-missing', grades), '');
  assert.equal(normalizeSelectedClassId('c1', classes, 'g1'), 'c1');
  assert.equal(normalizeSelectedClassId('c1', classes, 'g-wrong'), '');
});

test('normalizeInitialization: trims strings and defaults missing fields', () => {
  const init = normalizeInitialization(undefined);
  assert.equal(init.completedAt, 0);
  assert.equal(init.demoDataImported, false);
  assert.equal(init.province, '');
  assert.equal(init.subjectTrackModeEnabled, true);

  const custom = normalizeInitialization({
    completedAt: 100,
    wizardVersion: 3,
    demoDataImported: true,
    province: ' 广东 ',
    schoolName: ' 一中 ',
    subjectTrackModeEnabled: false,
  });
  assert.equal(custom.completedAt, 100);
  assert.equal(custom.wizardVersion, 3);
  assert.equal(custom.demoDataImported, true);
  assert.equal(custom.province, '广东');
  assert.equal(custom.schoolName, '一中');
  // schoolFullName falls back to schoolName when missing
  assert.equal(custom.schoolFullName, '一中');
  assert.equal(custom.subjectTrackModeEnabled, false);
});

// ---------- settings/weekly ----------

test('normalizeWeeklyPlan: fills defaults and names the plan by its 1-based index', () => {
  const plan = normalizeWeeklyPlan(undefined, 0);
  assert.match(plan.id, /^weekly_/);
  assert.equal(plan.name, '周测计划1');
  assert.equal(plan.enabled, true);
  assert.equal(plan.timezone, 'Asia/Shanghai');
  assert.equal(plan.activeFrom, '');
  assert.equal(plan.activeUntil, null);
  assert.equal(plan.repeatEveryWeeks, 1);
  assert.equal(plan.weekMode, 'single');
  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.excludedDates, []);
});

test('normalizeWeeklyPlan: normalizes times, clamps repeat interval, and preserves item order', () => {
  const plan = normalizeWeeklyPlan(
    {
      id: 'w1',
      name: '   ',
      enabled: false,
      activeFrom: '2026-01-01',
      activeUntil: '2026-06-30',
      repeatEveryWeeks: 20,
      anchorDate: 'bad-date',
      weekMode: 'ab',
      excludeOfficialHolidays: true,
      items: [
        { id: 'i2', name: '化学', weekday: 3, startTime: '9:5', endTime: '10:30' },
        { id: 'i1', name: '数学', weekday: 1, startTime: '19:00', endTime: '20:00' },
      ],
      excludedDates: ['2026-02-01', 'bad-date'],
      gradeId: 'g1',
      classId: 'c1',
      order: 2,
    },
    4,
  );
  // blank name after trim falls back to the index-based default (index 4 -> plan 5)
  assert.equal(plan.name, '周测计划5');
  assert.equal(plan.enabled, false);
  assert.equal(plan.repeatEveryWeeks, 8);
  // invalid anchorDate falls back to activeFrom
  assert.equal(plan.anchorDate, '2026-01-01');
  assert.equal(plan.weekMode, 'ab');
  // item order from the input array is preserved (no implicit re-sort by weekday/time)
  assert.deepEqual(plan.items.map(i => i.id), ['i2', 'i1']);
  assert.equal(plan.items[0].startTime, '09:05');
  assert.equal(plan.items[1].startTime, '19:00');
  assert.deepEqual(plan.excludedDates, ['2026-02-01']);
  assert.equal(plan.gradeId, 'g1');
  assert.equal(plan.classId, 'c1');
  // explicit numeric order on the input wins over the positional index argument
  assert.equal(plan.order, 2);
});

test('normalizeWeeklyPlan item defaults: invalid weekday/weekType fall back', () => {
  const plan = normalizeWeeklyPlan({ items: [{ weekday: 9, startTime: '8:0', endTime: '9:0' }] }, 0);
  const item = plan.items[0];
  assert.equal(item.weekday, 1);
  assert.equal(item.startTime, '08:00');
  assert.equal(item.endTime, '09:00');
  assert.equal(item.weekType, 'all');
  assert.equal(item.name, '周测1');
});

test('normalizeConflictPolicy: clamps buffers and rejects an unknown scope', () => {
  const defaults = normalizeConflictPolicy(undefined);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.scope, 'whole-day');
  assert.equal(defaults.bufferBeforeMinutes, 0);

  const custom = normalizeConflictPolicy({ enabled: false, scope: 'time-overlap', bufferBeforeMinutes: 15.6, bufferAfterMinutes: -5 });
  assert.equal(custom.enabled, false);
  assert.equal(custom.scope, 'time-overlap');
  assert.equal(custom.bufferBeforeMinutes, 16);
  assert.equal(custom.bufferAfterMinutes, 0);

  assert.equal(normalizeConflictPolicy({ scope: 'not-a-real-scope' }).scope, 'whole-day');
});

test('resolveActiveWeeklyPlanIdByClass: keeps a valid stored choice and derives a fallback otherwise', () => {
  const grades = normalizeGrades([{ id: 'g1', name: '高一' }]);
  const classes = normalizeClasses(
    [
      { id: 'c1', gradeId: 'g1', name: '1班' },
      { id: 'c2', gradeId: 'g1', name: '2班' },
    ],
    grades,
  );
  const w1 = normalizeWeeklyPlan({ id: 'w1', classId: 'c1', gradeId: 'g1' }, 0);
  const w2 = normalizeWeeklyPlan({ id: 'w2', classId: 'c2', gradeId: 'g1' }, 1);

  assert.deepEqual(resolveActiveWeeklyPlanIdByClass(classes, [w1, w2], { c1: 'w1' }), { c1: 'w1', c2: 'w2' });
  // stored id that doesn't belong to that class is ignored, falls back to the matching plan
  assert.deepEqual(resolveActiveWeeklyPlanIdByClass(classes, [w1, w2], { c1: 'w2' }), { c1: 'w1', c2: 'w2' });
  // no plans at all -> every class resolves to null
  assert.deepEqual(resolveActiveWeeklyPlanIdByClass(classes, [], {}), { c1: null, c2: null });
});

// ---------- settings/design ----------

test('normalizeDesignPolicy: defaults to an empty rule list', () => {
  assert.deepEqual(normalizeDesignPolicy(undefined), { rules: [], updatedAt: 0 });
});

test('normalizeDesignPolicy: keeps only the newest school-wide rule when one exists, overriding narrower rules', () => {
  const policy = normalizeDesignPolicy({
    rules: [
      { id: 'r1', scope: 'grade', scopeId: 'g1', designId: 'd1' },
      { id: 'r2', scope: 'school', scopeId: '*', designId: 'd2' },
      { id: 'r3', scope: 'school', scopeId: '*', designId: 'd3' },
    ],
  });
  assert.deepEqual(policy.rules, [{ id: 'r3', scope: 'school', scopeId: '*', designId: 'd3' }]);
});

test('normalizeDesignPolicy: filters out malformed rules missing a string designId', () => {
  const policy = normalizeDesignPolicy({
    rules: [
      { id: 'bad', scope: 'grade', scopeId: 'g1', designId: 5 },
      { id: 'r1', scope: 'class', scopeId: 'c1', designId: 'd1' },
    ],
  });
  assert.equal(policy.rules.length, 1);
  assert.equal(policy.rules[0].id, 'r1');
});

// ---------- settings/majorBatch ----------

test('normalizeMajorBatchSettings: defaults to empty groups', () => {
  assert.deepEqual(normalizeMajorBatchSettings(undefined), { subjectGroups: [], timeGroups: [] });
});

test('normalizeMajorBatchSettings: dedupes subjects, drops empty-subject groups, and filters invalid time slots', () => {
  const settings = normalizeMajorBatchSettings({
    subjectGroups: [
      { id: 's1', name: '理科组', subjects: ['物理', '化学', '物理'], updatedAt: 10, order: 1 },
      // a missing/blank name still falls back to an auto-generated name (`自定义科目组 N`),
      // so this group is KEPT -- only a truly empty subjects list gets dropped below.
      { name: '', subjects: ['生物'] },
      { name: '空科目组', subjects: [] },
    ],
    timeGroups: [
      { id: 't1', name: '标准时间', slots: [{ start: '08:00', end: '10:00' }, { start: 'bad', end: '11:00' }], updatedAt: 5, order: 0 },
    ],
  });
  assert.equal(settings.subjectGroups.length, 2);
  assert.equal(settings.subjectGroups[0].id, 's1');
  assert.deepEqual(settings.subjectGroups[0].subjects, ['物理', '化学']);
  assert.equal(settings.subjectGroups[0].order, 0);
  // second (auto-named) group keeps its deduped subjects and is re-indexed after the empty one is dropped
  assert.equal(settings.subjectGroups[1].name, '自定义科目组 2');
  assert.deepEqual(settings.subjectGroups[1].subjects, ['生物']);
  assert.equal(settings.subjectGroups[1].order, 1);

  assert.equal(settings.timeGroups.length, 1);
  assert.equal(settings.timeGroups[0].slots.length, 1);
  assert.deepEqual(settings.timeGroups[0].slots[0], { start: '08:00', end: '10:00', dayOffset: 0 });
});
