import assert from 'node:assert/strict';
import test from 'node:test';
import type { AlertsSettings, ExamItem, MajorExam } from '../src/types/index.js';
import type { SchoolClass, SchoolGrade } from '../src/types/school.js';
import { DEFAULT_INITIALIZATION } from '../src/utils/settings/school.js';
import {
  changedExamDomains,
  EXAM_REVISION_DOMAINS,
  EXAM_REVISION_DOMAIN_FIELDS,
  EXAM_SAVE_DOMAINS,
  fullExamSaveBody,
  hasExamSaveDomain,
  mergeExamRevisions,
  parseExamRevisions,
  presentExamSaveDomains,
  revisionDomainsFor,
  type ExamSaveSnapshot,
} from '../src/shared/examSaveDiff.js';

const item: ExamItem = {
  id: 'item-1',
  name: '语文',
  startTime: '08:00',
  endTime: '09:00',
  enabled: true,
  order: 0,
};

const major: MajorExam = { id: 'major-1', name: '期中考试', items: [item], order: 0 };

const grade: SchoolGrade = { id: 'grade-1', name: '高一', order: 0, enabled: true };
const schoolClass: SchoolClass = {
  id: 'class-1',
  gradeId: 'grade-1',
  name: '1 班',
  order: 0,
  enabled: true,
};

const alerts = { enabled: true, durationSec: 8, states: {}, custom: [] } as unknown as AlertsSettings;

function snapshot(overrides: Partial<ExamSaveSnapshot> = {}): ExamSaveSnapshot {
  return {
    items: [item],
    title: '期中考试',
    majors: [major],
    activeMajorId: 'major-1',
    alerts: null,
    scheduleMode: 'major-only',
    weeklyPlans: [],
    activeWeeklyPlanId: null,
    activeWeeklyPlanIdByClassId: {},
    grades: [grade],
    classes: [schoolClass],
    initialization: DEFAULT_INITIALIZATION,
    weeklyConflictPolicy: null,
    ...overrides,
  };
}

test('presentExamSaveDomains: 只认真正出现过的域，baseUpdatedAt 之类的元数据不算', () => {
  assert.deepEqual(presentExamSaveDomains({ classes: [], baseUpdatedAt: 1 }), ['classes']);
  assert.deepEqual(presentExamSaveDomains({ alerts: null }), ['alerts']);
  assert.deepEqual(presentExamSaveDomains({}), []);
  assert.deepEqual(presentExamSaveDomains(null), []);
  assert.equal(hasExamSaveDomain({ baseUpdatedAt: 1 }), false);
  assert.equal(hasExamSaveDomain({ classes: [] }), true);
});

test('只改班级名时，提交里只有 classes（不再连带 majors / weeklyPlans）', () => {
  const base = snapshot();
  const diff = changedExamDomains({ ...base, classes: [{ ...schoolClass, name: '2 班' }] }, base);
  assert.deepEqual(diff.domains, ['classes']);
  assert.deepEqual(Object.keys(diff.body), ['classes']);
});

test('只改周测时，提交里只有 weeklyPlans', () => {
  const base = snapshot();
  const plan = { id: 'plan-1', name: '第 1 周', gradeId: 'grade-1', classId: 'class-1' };
  const diff = changedExamDomains({ ...base, weeklyPlans: [plan as never], activeWeeklyPlanId: 'plan-1' }, base);
  assert.deepEqual(diff.domains, ['weeklyPlans', 'activeWeeklyPlanId']);
});

test('大型考试变更时，镜像字段与 majors 同组提交', () => {
  const base = snapshot();
  const nextMajor: MajorExam = { ...major, name: '期末考试' };
  const diff = changedExamDomains(
    { ...base, majors: [nextMajor], items: nextMajor.items, title: nextMajor.name },
    base,
  );
  assert.deepEqual(diff.domains, ['majors', 'items', 'title', 'activeMajorId']);
  assert.equal(diff.body.title, '期末考试');
});

test('与服务端基线完全一致时，变化域为空（客户端据此跳过请求）', () => {
  const base = snapshot();
  const diff = changedExamDomains({ ...base }, base);
  assert.deepEqual(diff.domains, []);
  assert.deepEqual(diff.body, {});
});

test('未携带的域不会被当成“要清空”，显式 null 才是清空', () => {
  const base = snapshot({ alerts });
  // 未携带 alerts：视为不改，提交里不出现该域（否则会把云端提醒静默清空）。
  const omitted = changedExamDomains({ ...base, alerts: undefined }, base);
  assert.equal(omitted.domains.includes('alerts'), false);
  assert.equal('alerts' in omitted.body, false);
  // 显式 null：确实要清空。
  const cleared = changedExamDomains({ ...base, alerts: null }, base);
  assert.deepEqual(cleared.domains, ['alerts']);
  assert.equal(cleared.body.alerts, null);
});

test('多个域同时变化时，域名顺序稳定（便于日志与断言）', () => {
  const base = snapshot();
  const diff = changedExamDomains(
    { ...base, grades: [{ ...grade, name: '高二' }], classes: [{ ...schoolClass, name: '3 班' }] },
    base,
  );
  assert.deepEqual(diff.domains, ['grades', 'classes']);
});

test('fullExamSaveBody: 拿不到基线时退回整份提交，保持改动前的语义', () => {
  const body = fullExamSaveBody(snapshot({ alerts: undefined }));
  assert.equal(body.alerts, null);
  assert.deepEqual(presentExamSaveDomains(body), [
    'majors',
    'items',
    'title',
    'activeMajorId',
    'alerts',
    'scheduleMode',
    'weeklyPlans',
    'activeWeeklyPlanId',
    'activeWeeklyPlanIdByClassId',
    'grades',
    'classes',
    'initialization',
    'weeklyConflictPolicy',
  ]);
});

// A 段出口条件：常见编辑动作的提交字节数要比整份提交少一半以上。
// 注意周测目前仍是「整个数组一起提交」（改一个格子只能省 15% 左右），那属于阶段 C
// 的记录级写范围，因此这里只锁定已经按域切开的三类动作。
test('提交瘦身：常见编辑动作的请求体至少比整份提交小 80%', () => {
  const scale = (count: number, make: (index: number) => unknown) =>
    Array.from({ length: count }, (_, index) => make(index));

  const grades = scale(3, (index) => ({
    id: `g${index}`,
    name: `高${index + 1}`,
    order: index,
    enabled: true,
  })) as SchoolGrade[];
  const classes = grades.flatMap((grade, g) =>
    scale(12, (index) => ({
      id: `c${g}-${index}`,
      gradeId: grade.id,
      name: `${index + 1} 班`,
      order: index,
      enabled: true,
    })),
  ) as SchoolClass[];
  const majors = scale(3, (index) => ({
    id: `m${index}`,
    name: `第 ${index + 1} 次月考`,
    items: scale(8, (itemIndex) => ({
      id: `m${index}-i${itemIndex}`,
      name: `科目 ${itemIndex}`,
      startTime: '08:00',
      endTime: '09:00',
      enabled: true,
      order: itemIndex,
    })),
    order: index,
  })) as MajorExam[];
  const weeklyPlans = scale(12, (index) => ({
    id: `w${index}`,
    name: `第 ${index + 1} 周周测`,
    gradeId: grades[index % grades.length].id,
    classId: classes[index % classes.length].id,
    items: scale(10, (itemIndex) => ({
      id: `w${index}-i${itemIndex}`,
      name: `周测科目 ${itemIndex}`,
      startTime: '15:00',
      endTime: '15:45',
      enabled: true,
      order: itemIndex,
    })),
  }));

  const base = snapshot({
    majors,
    items: majors[0].items,
    title: majors[0].name,
    activeMajorId: majors[0].id,
    grades,
    classes,
    weeklyPlans: weeklyPlans as never,
  });

  const fullBytes = Buffer.byteLength(JSON.stringify(fullExamSaveBody(base)), 'utf8');
  const savingRatio = (input: ExamSaveSnapshot) => {
    const active = input.majors.find((major) => major.id === input.activeMajorId) ?? input.majors[0];
    const diff = changedExamDomains({ ...input, items: active.items, title: active.name }, base);
    return 1 - Buffer.byteLength(JSON.stringify(diff.body), 'utf8') / fullBytes;
  };

  const renamedClass = classes.map((item, index) => (index === 0 ? { ...item, name: '1 班（改）' } : item));
  assert.ok(savingRatio({ ...base, classes: renamedClass }) > 0.8, '改班级名应至少省下 80% 的字节');

  const retimed = base.majors.map((major, index) =>
    index === 0
      ? { ...major, items: major.items.map((item, i) => (i === 0 ? { ...item, startTime: '10:00' } : item)) }
      : major,
  );
  assert.ok(savingRatio({ ...base, majors: retimed }) > 0.8, '改考试时间应至少省下 80% 的字节');

  assert.ok(savingRatio({ ...base, scheduleMode: 'weekly-only' }) > 0.95, '只改运行模式应几乎不产生请求体');
});

test('修订域覆盖每一个保存域，且不重复归属', () => {
  const covered = EXAM_REVISION_DOMAINS.flatMap((domain) => EXAM_REVISION_DOMAIN_FIELDS[domain]);
  assert.deepEqual([...covered].sort(), [...EXAM_SAVE_DOMAINS].sort());
  assert.equal(new Set(covered).size, covered.length, '同一个保存域不能属于两个修订域');
});

test('revisionDomainsFor: 按修订域归组并保持稳定顺序', () => {
  assert.deepEqual(revisionDomainsFor(['classes']), ['classes']);
  assert.deepEqual(revisionDomainsFor(['title', 'majors', 'items', 'activeMajorId']), ['major']);
  assert.deepEqual(revisionDomainsFor(['weeklyPlans', 'activeWeeklyPlanId', 'classes', 'alerts']), [
    'alerts',
    'weekly',
    'classes',
  ]);
  assert.deepEqual(revisionDomainsFor([]), []);
});

test('parseExamRevisions: 只接受非负数字，非法值一律丢弃', () => {
  assert.deepEqual(parseExamRevisions({ major: 3, weekly: '4', classes: -1, grades: 'x' }), {
    major: 3,
    weekly: 4,
  });
  assert.deepEqual(parseExamRevisions(null), {});
  assert.deepEqual(parseExamRevisions([1, 2]), {});
  assert.deepEqual(parseExamRevisions('{"major":1}'), {});
});

test('mergeExamRevisions: 只采信本次提交过的域，其余保持旧修订号', () => {
  const current = { major: 2, classes: 5, weekly: 1 };
  const incoming = { major: 3, classes: 6, weekly: 2 };
  // 本次只提交了 classes：major/weekly 的本地内容仍基于旧版本，不能跟着换新号。
  assert.deepEqual(mergeExamRevisions(current, incoming, ['classes']), { major: 2, classes: 6, weekly: 1 });
  // 服务端没返回某个域时也保持旧值。
  assert.deepEqual(mergeExamRevisions(current, { classes: 6 }, ['classes', 'weekly']), {
    major: 2,
    classes: 6,
    weekly: 1,
  });
  assert.deepEqual(mergeExamRevisions(undefined, { major: 1 }, ['major']), { major: 1 });
});
