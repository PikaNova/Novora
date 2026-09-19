import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExamCenterView,
  collectExamSessions,
  formatCountdown,
  formatRelativeDay,
  formatShortCountdown,
  type ExamLifecycleRecord,
} from '../src/utils/examCenterStatus.js';
import { parseZonedTime } from '../src/utils/zonedTime.js';
import type { ExamItem, MajorExam } from '../src/types/index.js';
import type { SchoolClass, SchoolGrade } from '../src/types/school.js';
import type { WeeklyPlan } from '../src/types/exam.js';

/** 2026-09-18 是周五。 */
const DAY = '2026-09-18';
const at = (time: string) => parseZonedTime(`${DAY}T${time}:00`);

function item(patch: Partial<ExamItem> & { id: string; name: string; start: string; end: string }): ExamItem {
  return {
    id: patch.id,
    name: patch.name,
    startTime: `${DAY}T${patch.start}:00`,
    endTime: `${DAY}T${patch.end}:00`,
    enabled: patch.enabled !== false,
    order: patch.order ?? 0,
  };
}

function major(patch: Partial<MajorExam> & { id: string; name: string; items: ExamItem[] }): MajorExam {
  return {
    id: patch.id,
    name: patch.name,
    items: patch.items,
    order: patch.order ?? 0,
    targetGradeIds: patch.targetGradeIds,
    targetClassIds: patch.targetClassIds,
    temporary: patch.temporary,
    source: patch.source,
    ...(patch.endedAt === undefined ? {} : { endedAt: patch.endedAt }),
  };
}

function schoolClass(id: string, gradeId: string, name: string): SchoolClass {
  return { id, gradeId, name, enabled: true } as SchoolClass;
}

function grade(id: string, name: string): SchoolGrade {
  return { id, name, enabled: true } as SchoolGrade;
}

function weeklyPlan(patch: Partial<WeeklyPlan> & { id: string; classId: string; gradeId: string }): WeeklyPlan {
  return {
    id: patch.id,
    name: patch.name ?? '初二数学周测',
    enabled: patch.enabled !== false,
    timezone: 'Asia/Shanghai',
    activeFrom: patch.activeFrom ?? '2026-09-01',
    activeUntil: patch.activeUntil ?? null,
    repeatEveryWeeks: 1,
    anchorDate: patch.anchorDate ?? '2026-09-01',
    weekMode: 'single',
    items: patch.items ?? [],
    excludedDates: [],
    overrides: [],
    order: 0,
    gradeId: patch.gradeId,
    classId: patch.classId,
  };
}

function weeklyItem(
  patch: Partial<WeeklyPlan['items'][number]> & { id: string; name: string },
): WeeklyPlan['items'][number] {
  return {
    id: patch.id,
    name: patch.name,
    weekday: patch.weekday ?? 5,
    startTime: patch.startTime ?? '14:00',
    endTime: patch.endTime ?? '15:00',
    enabled: patch.enabled !== false,
    order: patch.order ?? 0,
  };
}

function record(id: string, patch: Partial<ExamLifecycleRecord> = {}): ExamLifecycleRecord {
  return {
    id,
    displayStatus: patch.displayStatus ?? 'published',
    pausedAt: patch.pausedAt ?? null,
    pausedMs: patch.pausedMs ?? 0,
    endedAt: patch.endedAt ?? null,
    archivedAt: patch.archivedAt ?? null,
    endAt: patch.endAt ?? null,
  };
}

const grades = [grade('g1', '初二'), grade('g2', '初三')];
const classes = [schoolClass('c1', 'g1', '1 班'), schoolClass('c2', 'g1', '2 班'), schoolClass('c3', 'g2', '3 班')];

function collect(majors: MajorExam[], weeklyPlans: WeeklyPlan[] = [], mode: 'automatic' | 'major-only' = 'automatic') {
  return collectExamSessions({
    majors,
    weeklyPlans,
    classes,
    grades,
    scheduleMode: mode,
    weeklyConflictPolicy: { enabled: true, scope: 'whole-day', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    activeWeeklyPlanId: null,
    activeWeeklyPlanIdByClassId: Object.fromEntries(weeklyPlans.map((plan) => [plan.classId, plan.id])),
    dayKey: DAY,
  });
}

test('同一时间多场考试：并行场次全部保留，并各自带参与班级数', () => {
  const sessions = collect([
    major({
      id: 'm-g1',
      name: '初二期中考试',
      targetGradeIds: ['g1'],
      items: [item({ id: 'i1', name: '数学', start: '10:00', end: '11:00' })],
    }),
    major({
      id: 'm-g3',
      name: '初三模拟考试',
      targetClassIds: ['c3'],
      items: [item({ id: 'i2', name: '英语', start: '10:30', end: '11:30' })],
    }),
  ]);
  assert.equal(sessions.length, 2);

  const view = buildExamCenterView(sessions, [record('m-g1'), record('m-g3')], at('10:40'), DAY);
  assert.equal(view.running.length, 2, '同一时刻两场考试都应判定为进行中');
  assert.deepEqual(view.running.map((session) => session.subject).sort(), ['数学', '英语']);
  // 主视觉取先结束的一场，保证「还有多久」最先提醒。
  assert.equal(view.headline?.sourceId, 'm-g1');
  assert.equal(view.headline?.scope.classCount, 2);
  assert.equal(view.headline?.scope.label, '初二');
  assert.equal(view.running[1].scope.label, '3 班');
});

test('暂停中：倒计时冻结并按累计暂停时长顺延结束时间', () => {
  const sessions = collect([
    major({ id: 'm1', name: '初二期中考试', items: [item({ id: 'i1', name: '数学', start: '10:00', end: '11:00' })] }),
  ]);
  const view = buildExamCenterView(
    sessions,
    [record('m1', { displayStatus: 'ongoing', pausedAt: at('10:20'), pausedMs: 10 * 60_000 })],
    at('10:30'),
    DAY,
  );
  const session = view.running[0];
  assert.equal(session.status, 'paused');
  assert.equal(session.effectiveEndAt, at('11:10'));
  assert.equal(session.remainingMs, 40 * 60_000);
  // 暂停的 10 分钟不计入已进行时间。
  assert.equal(session.elapsedMs, 20 * 60_000);
});

test('时间已过但记录层未结束：归入待处理而不是已结束', () => {
  const sessions = collect([
    major({ id: 'm1', name: '初二期中考试', items: [item({ id: 'i1', name: '数学', start: '10:00', end: '11:00' })] }),
  ]);
  const pending = buildExamCenterView(sessions, [record('m1')], at('11:30'), DAY);
  assert.equal(pending.overdue.length, 1);
  assert.equal(pending.overdue[0].status, 'overdue');
  assert.equal(pending.previous, null);

  const closed = buildExamCenterView(sessions, [record('m1', { displayStatus: 'ended' })], at('11:30'), DAY);
  assert.equal(closed.overdue.length, 0);
  assert.equal(closed.previous?.status, 'ended');
});

test('上一场 / 下一场：跨天时下一场给出明天的安排', () => {
  const tomorrow = { ...item({ id: 'i2', name: '英语', start: '09:00', end: '10:00' }) };
  tomorrow.startTime = '2026-09-19T09:00:00';
  tomorrow.endTime = '2026-09-19T10:00:00';
  const tomorrowEnd = parseZonedTime('2026-09-19T10:00:00');
  const sessions = collect([
    major({
      id: 'm1',
      name: '初二期中考试',
      items: [item({ id: 'i1', name: '数学', start: '10:00', end: '11:00' }), tomorrow],
    }),
  ]);
  const view = buildExamCenterView(sessions, [record('m1', { endAt: tomorrowEnd })], at('12:00'), DAY);
  assert.equal(view.previous?.subject, '数学');
  assert.equal(view.upcoming[0]?.subject, '英语');
  assert.equal(formatRelativeDay(view.upcoming[0].startAt, DAY), '明天');
});

test('周测按班级展开，并在整日冲突策略下被大型考试暂停', () => {
  const majors = [
    major({
      id: 'm1',
      name: '初二期中考试',
      targetGradeIds: ['g1'],
      items: [item({ id: 'i1', name: '数学', start: '08:00', end: '12:00' })],
    }),
  ];
  const plans = [
    weeklyPlan({ id: 'p1', gradeId: 'g1', classId: 'c1', items: [weeklyItem({ id: 'w1', name: '数学' })] }),
  ];

  const suppressed = buildExamCenterView(collect(majors, plans), null, at('09:00'), DAY);
  assert.equal(suppressed.running.length, 1, '整日暂停策略下当天周测不应出现');
  assert.equal(suppressed.running[0].kind, 'major');

  const overlapping = collectExamSessions({
    majors,
    weeklyPlans: plans,
    classes,
    grades,
    scheduleMode: 'automatic',
    weeklyConflictPolicy: { enabled: true, scope: 'time-overlap', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    activeWeeklyPlanId: null,
    activeWeeklyPlanIdByClassId: { c1: 'p1' },
    dayKey: DAY,
  });
  const view = buildExamCenterView(overlapping, null, at('14:30'), DAY);
  assert.equal(view.running.length, 1);
  assert.equal(view.running[0].kind, 'weekly');
  assert.equal(view.running[0].examName, '初二数学周测');
  assert.equal(view.running[0].subject, '数学');
  assert.equal(view.running[0].scope.classCount, 1);
});

test('记录层读不到时仍然展示本地时间线，并标记状态未知', () => {
  const sessions = collect([
    major({ id: 'm1', name: '初二期中考试', items: [item({ id: 'i1', name: '数学', start: '10:00', end: '11:00' })] }),
  ]);
  const view = buildExamCenterView(sessions, null, at('10:30'), DAY);
  assert.equal(view.lifecycleUnknown, true);
  assert.equal(view.running.length, 1);
  assert.equal(view.running[0].lifecycle, null);
});

test('今天没有考试时给出空视图而不是抛错', () => {
  const view = buildExamCenterView([], [], at('10:00'), DAY);
  assert.equal(view.headline, null);
  assert.equal(view.todayCount, 0);
  assert.equal(view.hasAnyExamToday, false);
});

test('同内容的周测计划合并成一条，不随班级数膨胀', () => {
  const manyClasses = Array.from({ length: 60 }, (_, index) =>
    schoolClass(`c${index}`, index < 30 ? 'g1' : 'g2', `${index} 班`),
  );
  const plans = manyClasses.map((schoolClass) =>
    weeklyPlan({
      id: `p-${schoolClass.id}`,
      gradeId: schoolClass.gradeId,
      classId: schoolClass.id,
      items: [weeklyItem({ id: 'w1', name: '数学' })],
    }),
  );
  const sessions = collectExamSessions({
    majors: [],
    weeklyPlans: plans,
    classes: manyClasses,
    grades: [grade('g1', '初二'), grade('g2', '初三')],
    scheduleMode: 'automatic',
    weeklyConflictPolicy: { enabled: true, scope: 'time-overlap', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    activeWeeklyPlanId: null,
    activeWeeklyPlanIdByClassId: Object.fromEntries(plans.map((plan) => [plan.classId, plan.id])),
    dayKey: DAY,
  });
  assert.equal(sessions.length, 1, '60 个班级共用同一份周测内容时只应出现一条');
  assert.equal(sessions[0].scope.classCount, 60);
  assert.deepEqual(sessions[0].scope.gradeIds.sort(), ['g1', 'g2']);

  const started = performance.now();
  collectExamSessions({
    majors: Array.from({ length: 30 }, (_, index) => ({
      id: `m${index}`,
      name: `考试 ${index}`,
      order: index,
      targetGradeIds: [`g${index % 2 === 0 ? 1 : 2}`],
      items: Array.from({ length: 6 }, (_, itemIndex) =>
        item({
          id: `i${index}-${itemIndex}`,
          name: `科目${itemIndex}`,
          start: `${String(8 + itemIndex).padStart(2, '0')}:00`,
          end: `${String(9 + itemIndex).padStart(2, '0')}:00`,
        }),
      ),
    })),
    weeklyPlans: plans,
    classes: manyClasses,
    grades: [grade('g1', '初二'), grade('g2', '初三')],
    scheduleMode: 'automatic',
    weeklyConflictPolicy: { enabled: true, scope: 'whole-day', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    activeWeeklyPlanId: null,
    activeWeeklyPlanIdByClassId: Object.fromEntries(plans.map((plan) => [plan.classId, plan.id])),
    dayKey: DAY,
  });
  // 300 个班 + 40 场考试的真实量级下必须保持在交互可接受的耗时内。
  assert.ok(performance.now() - started < 1_000, '一次收集不应超过 1 秒');
});

test('倒计时与日期文案格式', () => {
  assert.equal(formatCountdown(42 * 60_000 + 18_000), '00:42:18');
  assert.equal(formatCountdown(2 * 3600_000 + 5 * 60_000), '02:05:00');
  assert.equal(formatCountdown(0), '00:00:00');
  // 跨天的等待不能截断成 99:59:59：按天给出，秒位不再显示。
  assert.equal(formatCountdown(23 * 3600_000 + 59 * 60_000 + 59_000), '23:59:59');
  assert.equal(formatCountdown(24 * 3600_000), '1 天 00:00');
  assert.equal(formatCountdown(4 * 86_400_000 + 21 * 3600_000 + 43 * 60_000), '4 天 21:43');
  assert.equal(formatCountdown(120 * 3600_000), '5 天 00:00');
  assert.equal(formatShortCountdown(2 * 3600_000 + 55 * 60_000), '2 小时 55 分');
  assert.equal(formatShortCountdown(25 * 3600_000), '1 天 1 小时');
  assert.equal(formatRelativeDay(at('10:00'), DAY), '今天');
  assert.equal(formatRelativeDay(at('10:00') + 24 * 3600_000, DAY), '明天');
});
