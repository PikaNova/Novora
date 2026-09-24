import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildScheduleBoard,
  buildClassGrid,
  findScheduleConflicts,
  makeScheduleRowFilter,
  resolveScheduleWindow,
  scheduleDayLabel,
  scheduleWindowDays,
  scopeLabelOf,
  type ScheduleRecordLike,
  type ScheduleRow,
} from '../src/utils/scheduleTimeline.js';
import type { ExamSession } from '../src/utils/examCenterStatus.js';
import { parseZonedTime } from '../src/utils/zonedTime.js';
import type { SchoolClass, SchoolGrade } from '../src/types/school.js';

const DAY = '2026-09-24';
const at = (time: string, day = DAY) => parseZonedTime(`${day}T${time}:00`);

const grades: SchoolGrade[] = [
  { id: 'g1', name: '初二', enabled: true } as SchoolGrade,
  { id: 'g2', name: '初三', enabled: true } as SchoolGrade,
];
const classes: SchoolClass[] = [
  { id: 'c1', gradeId: 'g1', name: '1 班', enabled: true } as SchoolClass,
  { id: 'c2', gradeId: 'g1', name: '2 班', enabled: true } as SchoolClass,
  { id: 'c3', gradeId: 'g2', name: '3 班', enabled: true } as SchoolClass,
];

function session(patch: Partial<ExamSession> & { key: string; startAt: number; endAt: number }): ExamSession {
  return {
    key: patch.key,
    kind: patch.kind ?? 'major',
    examName: patch.examName ?? '初二第一次月考',
    subject: patch.subject ?? '语文',
    sourceId: patch.sourceId ?? 'm1',
    recordId: patch.recordId === undefined ? 'm1' : patch.recordId,
    startAt: patch.startAt,
    endAt: patch.endAt,
    examEndAt: patch.examEndAt ?? patch.endAt,
    pausedAt: patch.pausedAt ?? null,
    pausedMs: patch.pausedMs ?? 0,
    endedAt: patch.endedAt ?? null,
    scope: patch.scope ?? {
      kind: 'grade',
      label: '初二',
      gradeIds: ['g1'],
      classIds: ['c1', 'c2'],
      classCount: 2,
    },
  };
}

function record(patch: Partial<ScheduleRecordLike> & { id: string }): ScheduleRecordLike {
  return {
    id: patch.id,
    name: patch.name ?? '初二第一次月考',
    displayStatus: patch.displayStatus ?? 'published',
    itemCount: patch.itemCount ?? 3,
    startAt: patch.startAt ?? null,
    endAt: patch.endAt ?? null,
    targetGradeIds: patch.targetGradeIds ?? ['g1'],
    targetClassIds: patch.targetClassIds ?? [],
    source: patch.source ?? 'regular',
  };
}

test('行模型：大型考试整场一行、周测带科目、草稿进待排期', () => {
  const board = buildScheduleBoard({
    sessions: [
      session({ key: 'major|m1|i1', startAt: at('10:00'), endAt: at('11:00') }),
      session({
        key: 'weekly|sig|0',
        kind: 'weekly',
        examName: '初二数学周测',
        subject: '数学',
        recordId: null,
        sourceId: 'p1',
        startAt: at('14:00'),
        endAt: at('15:00'),
        scope: { kind: 'class', label: '1 班', gradeIds: ['g1'], classIds: ['c1'], classCount: 1 },
      }),
    ],
    drafts: [
      record({
        id: 'draft-1',
        name: '初三期中考试（草稿）',
        displayStatus: 'draft',
        itemCount: 0,
        targetGradeIds: ['g2'],
      }),
    ],
    records: [record({ id: 'm1', displayStatus: 'published', itemCount: 6, startAt: at('10:00'), endAt: at('11:00') })],
    grades,
    classes,
    now: at('09:00'),
  });

  assert.equal(board.rows.length, 3);
  const major = board.rows.find((row) => row.kind === 'major');
  assert.equal(major?.title, '初二第一次月考');
  assert.equal(major?.subject, '');
  assert.equal(major?.itemCount, 6);
  assert.equal(major?.status, 'scheduled');
  assert.equal(major?.scopeLabel, '初二');

  const weekly = board.rows.find((row) => row.kind === 'weekly');
  assert.equal(weekly?.subject, '数学');
  assert.equal(weekly?.planId, 'p1');
  assert.equal(weekly?.recordId, null);
  assert.equal(weekly?.scopeLabel, '1 班');

  // 草稿没有开始时间 → 归入「待排期」且排在最后。
  assert.equal(board.groups.at(-1)?.key, 'unscheduled');
  assert.deepEqual(
    board.groups.at(-1)?.rows.map((row) => row.title),
    ['初三期中考试（草稿）'],
  );
  assert.equal(board.stats.unscheduled, 1);
});

test('状态：记录层状态优先于时间推断', () => {
  const sessions = [
    session({ key: 'k1', startAt: at('10:00'), endAt: at('11:00') }),
    session({ key: 'k2', startAt: at('12:00'), endAt: at('13:00'), recordId: 'm2' }),
    session({ key: 'k3', startAt: at('15:00'), endAt: at('16:00'), recordId: 'm3' }),
  ];
  const board = buildScheduleBoard({
    sessions,
    records: [
      record({ id: 'm1', displayStatus: 'stopping', startAt: at('10:00'), endAt: at('11:00') }),
      record({ id: 'm2', displayStatus: 'ongoing', startAt: at('12:00'), endAt: at('13:00') }),
      record({ id: 'm3', displayStatus: 'ended', startAt: at('15:00'), endAt: at('16:00') }),
    ],
    grades,
    classes,
    now: at('12:30'),
  });
  assert.deepEqual(
    board.rows.map((row) => row.status),
    ['stopping', 'ongoing', 'ended'],
  );
});

test('被大型考试暂停的周测：单独一行、标暂停、不参与冲突', () => {
  const suppressed = session({
    key: 'weekly|sig|0',
    kind: 'weekly',
    examName: '初二数学周测',
    subject: '数学',
    recordId: null,
    sourceId: 'p1',
    startAt: at('10:30'),
    endAt: at('11:30'),
  });
  const board = buildScheduleBoard({
    sessions: [session({ key: 'major|m1|i1', startAt: at('10:00'), endAt: at('12:00') })],
    suppressedWeekly: [suppressed],
    grades,
    classes,
    now: at('09:00'),
  });
  assert.equal(board.rows.length, 2);
  const paused = board.rows.find((row) => row.status === 'suppressed');
  assert.equal(paused?.title, '初二数学周测');
  assert.equal(board.conflicts.length, 0, '被暂停的周测当天不考，不该再报冲突');
  assert.equal(board.stats.suppressedWeekly, 1);
});

test('冲突：同一天、范围有交集、时间重叠才算', () => {
  const rows: ScheduleRow[] = [
    {
      key: 'a',
      kind: 'major',
      status: 'scheduled',
      recordId: 'a',
      planId: null,
      title: '初二月考',
      subject: '',
      scopeLabel: '初二',
      gradeIds: ['g1'],
      classIds: [],
      startAt: at('10:00'),
      endAt: at('11:00'),
      itemCount: 1,
      unscheduled: false,
      daySubjectCount: 1,
      conflictKeys: [],
    },
    {
      key: 'b',
      kind: 'weekly',
      status: 'scheduled',
      recordId: null,
      planId: 'p1',
      title: '初二数学周测',
      subject: '数学',
      scopeLabel: '初二',
      gradeIds: ['g1'],
      classIds: ['c1'],
      startAt: at('10:30'),
      endAt: at('11:30'),
      itemCount: 0,
      unscheduled: false,
      daySubjectCount: 1,
      conflictKeys: [],
    },
    {
      key: 'c',
      kind: 'major',
      status: 'scheduled',
      recordId: 'c',
      planId: null,
      title: '初三模拟考',
      subject: '',
      scopeLabel: '初三',
      gradeIds: ['g2'],
      classIds: [],
      startAt: at('10:30'),
      endAt: at('11:30'),
      itemCount: 1,
      unscheduled: false,
      daySubjectCount: 1,
      conflictKeys: [],
    },
    {
      key: 'd',
      kind: 'major',
      status: 'scheduled',
      recordId: 'd',
      planId: null,
      title: '初二下午场',
      subject: '',
      scopeLabel: '初二',
      gradeIds: ['g1'],
      classIds: [],
      startAt: at('11:00'),
      endAt: at('12:00'),
      itemCount: 1,
      unscheduled: false,
      daySubjectCount: 1,
      conflictKeys: [],
    },
  ];

  const conflicts = findScheduleConflicts(rows);
  // a×b 重叠；b×d 也重叠（11:00–11:30）；a 与 d 首尾相接（11:00）不算重叠；
  // c 是初三范围，和其它几行都没有范围交集。
  assert.deepEqual(
    conflicts.map((item) => [item.aKey, item.bKey]),
    [
      ['a', 'b'],
      ['b', 'd'],
    ],
  );
});

test('按日分组：今天/明天/日期，待排期永远最后', () => {
  const board = buildScheduleBoard({
    sessions: [
      session({ key: 'k1', startAt: at('08:00'), endAt: at('09:00') }),
      session({
        key: 'k2',
        startAt: at('08:00', '2026-09-25'),
        endAt: at('09:00', '2026-09-25'),
        recordId: 'm2',
      }),
      session({
        key: 'k3',
        startAt: at('08:00', '2026-09-28'),
        endAt: at('09:00', '2026-09-28'),
        recordId: 'm3',
      }),
    ],
    drafts: [record({ id: 'd1', displayStatus: 'draft' })],
    grades,
    classes,
    now: at('07:00'),
  });
  assert.deepEqual(
    board.groups.map((group) => group.label),
    ['今天', '明天', '周一 9/28', '未排期'],
  );
  assert.equal(scheduleDayLabel('2026-09-24', at('07:00')), '今天');
  assert.equal(scheduleDayLabel('2026-09-28', at('07:00')), '周一 9/28');
});

test('适用范围文案：全校 / 年级 / 班级多时报数量', () => {
  assert.equal(scopeLabelOf([], [], grades, classes), '全校');
  assert.equal(scopeLabelOf(['g1'], [], grades, classes), '初二');
  assert.equal(scopeLabelOf(['g1'], ['c1'], grades, classes), '初二、1 班');
  assert.equal(scopeLabelOf([], ['c1', 'c2', 'c3'], grades, classes), '3 个班');
});

test('统计：今日场次、冲突行数、待排期数', () => {
  const board = buildScheduleBoard({
    sessions: [
      session({ key: 'k1', startAt: at('10:00'), endAt: at('11:00') }),
      session({ key: 'k2', startAt: at('10:30'), endAt: at('11:30'), recordId: 'm2' }),
      session({
        key: 'k3',
        startAt: at('10:00', '2026-09-25'),
        endAt: at('11:00', '2026-09-25'),
        recordId: 'm3',
      }),
    ],
    drafts: [record({ id: 'd1', displayStatus: 'draft' })],
    grades,
    classes,
    now: at('09:00'),
  });
  assert.equal(board.stats.total, 4);
  assert.equal(board.stats.todayCount, 2);
  assert.equal(board.stats.conflicted, 2);
  assert.equal(board.stats.unscheduled, 1);
});

test('大型考试按天合并：同一场 3 科只占一行，时间跨首科到末科', () => {
  const board = buildScheduleBoard({
    sessions: [
      session({ key: 'major|m1|i1', subject: '语文', startAt: at('08:00'), endAt: at('09:30') }),
      session({ key: 'major|m1|i2', subject: '数学', startAt: at('10:00'), endAt: at('11:30') }),
      session({ key: 'major|m1|i3', subject: '英语', startAt: at('14:00'), endAt: at('15:30') }),
    ],
    records: [record({ id: 'm1', itemCount: 3, startAt: at('08:00'), endAt: at('15:30') })],
    grades,
    classes,
    now: at('07:00'),
  });
  assert.equal(board.rows.length, 1, '同一场考试同一天只应占一行');
  const row = board.rows[0];
  assert.equal(row.key, 'major|m1|2026-09-24');
  assert.equal(row.startAt, at('08:00'));
  assert.equal(row.endAt, at('15:30'));
  assert.equal(row.daySubjectCount, 3);
  assert.equal(row.unscheduled, false);
});

test('记录层是草稿、快照却带时间：只出草稿一行，进未排期', () => {
  const draftRecord = record({ id: 'm1', displayStatus: 'draft', itemCount: 3 });
  const board = buildScheduleBoard({
    sessions: [
      session({ key: 'major|m1|i1', subject: '语文', startAt: at('08:00'), endAt: at('09:30') }),
      session({ key: 'major|m1|i2', subject: '数学', startAt: at('10:00'), endAt: at('11:30') }),
      session({ key: 'major|m1|i3', subject: '英语', startAt: at('14:00'), endAt: at('15:30') }),
    ],
    drafts: [draftRecord],
    records: [draftRecord],
    grades,
    classes,
    now: at('07:00'),
  });
  assert.equal(board.rows.length, 1, '草稿不能同时出现在日期分组和未排期里');
  assert.equal(board.rows[0].kind, 'draft');
  assert.equal(board.rows[0].unscheduled, true);
  assert.deepEqual(
    board.groups.map((group) => group.key),
    ['unscheduled'],
  );
  assert.equal(board.stats.todayCount, 0, '草稿不算今天的场次');
});

test('已发布但没有任何科目时间：补进未排期的「已发布·待排期」子段', () => {
  const publishedNoTime = record({ id: 'm9', name: '高一月考', displayStatus: 'published', itemCount: 0 });
  const board = buildScheduleBoard({
    sessions: [],
    drafts: [record({ id: 'd1', name: '初一摸底（草稿）', displayStatus: 'draft', itemCount: 0 })],
    records: [publishedNoTime],
    grades,
    classes,
    now: at('07:00'),
  });
  const group = board.groups.find((item) => item.key === 'unscheduled');
  assert.ok(group);
  assert.deepEqual(
    group?.subgroups?.map((subgroup) => subgroup.label),
    ['草稿（未发布）', '已发布·待排期'],
  );
  assert.deepEqual(
    group?.subgroups?.map((subgroup) => subgroup.rows.length),
    [1, 1],
  );
  assert.equal(board.rows.find((row) => row.recordId === 'm9')?.status, 'scheduled');
  assert.equal(board.stats.unscheduled, 2);
});

test('时间窗：今天/明天/本周/未来两周/全部 的边界与 from/to', () => {
  const now = at('09:00');
  const today = resolveScheduleWindow('today', now);
  assert.equal(today.dayKey, '2026-09-24');
  assert.equal(today.daysForward, 1);
  assert.equal(today.from, at('00:00'));
  assert.equal(today.to, at('00:00', '2026-09-25'));

  // 「明天」档从明天零点开始，今天的考试不会被带进来。
  const tomorrow = resolveScheduleWindow('tomorrow', now);
  assert.equal(tomorrow.dayKey, '2026-09-25');
  assert.equal(tomorrow.from, at('00:00', '2026-09-25'));
  assert.equal(tomorrow.to, at('00:00', '2026-09-26'));

  assert.equal(resolveScheduleWindow('week', now).daysForward, 7);
  assert.equal(resolveScheduleWindow('fortnight', now).daysForward, 14);

  const all = resolveScheduleWindow('all', now);
  assert.equal(all.from, null);
  assert.equal(all.to, null);
  assert.ok(all.daysForward >= 30);
});

test('行级筛选：搜索命中考试名或周测科目，年级按适用范围判断', () => {
  const board = buildScheduleBoard({
    sessions: [
      session({ key: 'major|m1|i1', subject: '语文', startAt: at('10:00'), endAt: at('11:00') }),
      session({
        key: 'weekly|sig|0',
        kind: 'weekly',
        examName: '初三数学周测',
        subject: '数学',
        recordId: null,
        startAt: at('14:00'),
        endAt: at('15:00'),
        scope: { kind: 'grade', label: '初三', gradeIds: ['g2'], classIds: ['c3'], classCount: 1 },
      }),
    ],
    grades,
    classes,
    now: at('07:00'),
  });
  const classGradeIds = new Map([
    ['c1', 'g1'],
    ['c2', 'g1'],
    ['c3', 'g2'],
  ]);

  const byQuery = makeScheduleRowFilter({ query: '数学', classGradeIds });
  assert.deepEqual(
    board.rows.filter(byQuery).map((row) => row.title),
    ['初三数学周测'],
  );

  const byGrade = makeScheduleRowFilter({ gradeId: 'g2', classGradeIds });
  assert.deepEqual(
    board.rows.filter(byGrade).map((row) => row.title),
    ['初三数学周测'],
  );

  // 全校范围的考试对任何年级筛选都成立。
  const schoolWide = buildScheduleBoard({
    sessions: [
      session({
        key: 'major|m2|i1',
        examName: '全校统考',
        startAt: at('10:00'),
        endAt: at('11:00'),
        scope: { kind: 'school', label: '全校', gradeIds: [], classIds: [], classCount: 3 },
      }),
    ],
    grades,
    classes,
    now: at('07:00'),
  });
  assert.equal(schoolWide.rows.filter(makeScheduleRowFilter({ gradeId: 'g2' })).length, 1);
});

test('班级网格：全校/年级/班级三种范围分别落到正确的班', () => {
  const days = ['2026-09-24', '2026-09-25'];
  const board = buildScheduleBoard({
    sessions: [
      session({
        key: 'major|m1|i1',
        examName: '全校统考',
        startAt: at('08:00'),
        endAt: at('09:00'),
        scope: { kind: 'school', label: '全校', gradeIds: [], classIds: [], classCount: 3 },
      }),
      session({
        key: 'major|m2|i1',
        examName: '初二月考',
        startAt: at('10:00'),
        endAt: at('11:00'),
        recordId: 'm2',
        scope: { kind: 'grade', label: '初二', gradeIds: ['g1'], classIds: ['c1', 'c2'], classCount: 2 },
      }),
      session({
        key: 'major|m3|i1',
        examName: '3 班专项',
        startAt: at('10:00', '2026-09-25'),
        endAt: at('11:00', '2026-09-25'),
        recordId: 'm3',
        scope: { kind: 'class', label: '3 班', gradeIds: ['g2'], classIds: ['c3'], classCount: 1 },
      }),
    ],
    grades,
    classes,
    now: at('07:00'),
  });
  const grid = buildClassGrid({ rows: board.rows, classes, grades, days });
  assert.deepEqual(
    grid.map((row) => [row.className, row.total]),
    [
      ['1 班', 2],
      ['2 班', 2],
      ['3 班', 2],
    ],
  );
  const class3 = grid.find((row) => row.className === '3 班');
  assert.deepEqual(
    class3?.cells.map((cell) => cell.rows.map((item) => item.title)),
    [['全校统考'], ['3 班专项']],
  );
  const class1 = grid.find((row) => row.className === '1 班');
  assert.deepEqual(
    class1?.cells.map((cell) => cell.rows.map((item) => item.title)),
    [['全校统考', '初二月考'], []],
  );
  // 网格列：时间窗最多 7 天。
  assert.equal(scheduleWindowDays(resolveScheduleWindow('fortnight', at('07:00')), 7).length, 7);
  assert.equal(scheduleWindowDays(resolveScheduleWindow('today', at('07:00')), 7).length, 1);
});
