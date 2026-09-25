import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeIdOwningMajor, majorAppliesToGrade, resolveExamEditTarget } from '../src/utils/examRecordEditTarget.js';
import type { MajorExam } from '../src/types/index.js';
import type { SchoolClass } from '../src/types/school.js';

function major(patch: Partial<MajorExam>): MajorExam {
  return { id: 'm1', name: '期中考试', items: [], order: 0, ...patch };
}

const classes: SchoolClass[] = [
  { id: 'g1-1', gradeId: 'g1', name: '1 班', order: 0, enabled: true },
  { id: 'g2-1', gradeId: 'g2', name: '1 班', order: 0, enabled: true },
];

test('majorAppliesToGrade: 指定年级、指定班级、全校三种口径', () => {
  assert.equal(majorAppliesToGrade(major({ targetGradeIds: ['g1'] }), 'g1', classes), true);
  assert.equal(majorAppliesToGrade(major({ targetGradeIds: ['g1'] }), 'g2', classes), false);
  assert.equal(majorAppliesToGrade(major({ targetClassIds: ['g2-1'] }), 'g2', classes), true);
  assert.equal(majorAppliesToGrade(major({ targetClassIds: ['g2-1'] }), 'g1', classes), false);
  assert.equal(majorAppliesToGrade(major({}), 'g1', classes), true);
  // 年级为空（上下文栏还没选）时一律不可见，避免拿"全部考试"当范围。
  assert.equal(majorAppliesToGrade(major({}), '', classes), false);
});

test('gradeIdOwningMajor: 优先显式年级，其次第一个指定班级的年级，全校给空', () => {
  assert.equal(gradeIdOwningMajor(major({ targetGradeIds: ['g1', 'g2'] }), classes), 'g1');
  assert.equal(gradeIdOwningMajor(major({ targetClassIds: ['g2-1'] }), classes), 'g2');
  assert.equal(gradeIdOwningMajor(major({}), classes), '');
});

test('resolveExamEditTarget: 当前年级看得到就不动年级', () => {
  const target = resolveExamEditTarget({
    majors: [major({ id: 'a', targetGradeIds: ['g1', 'g2'] })],
    recordId: 'a',
    currentGradeId: 'g2',
    classes,
  });
  assert.deepEqual(target, { majorId: 'a', gradeId: null });
});

test('resolveExamEditTarget: 当前年级看不到就切到它自己所属的年级', () => {
  const target = resolveExamEditTarget({
    majors: [major({ id: 'b', targetGradeIds: ['g1'] })],
    recordId: 'b',
    currentGradeId: 'g2',
    classes,
  });
  assert.deepEqual(target, { majorId: 'b', gradeId: 'g1' });
});

test('resolveExamEditTarget: 只指定班级的考试按班级所属年级定位', () => {
  const target = resolveExamEditTarget({
    majors: [major({ id: 'c', targetClassIds: ['g1-1'] })],
    recordId: 'c',
    currentGradeId: 'g2',
    classes,
  });
  assert.deepEqual(target, { majorId: 'c', gradeId: 'g1' });
});

test('resolveExamEditTarget: 全校考试在任何年级都直接打开', () => {
  const target = resolveExamEditTarget({
    majors: [major({ id: 'd' })],
    recordId: 'd',
    currentGradeId: 'g2',
    classes,
  });
  assert.deepEqual(target, { majorId: 'd', gradeId: null });
});

test('resolveExamEditTarget: 快照里没有这个 id 时返回 null，不要把用户带进另一场考试', () => {
  assert.equal(
    resolveExamEditTarget({
      majors: [major({ id: 'exists' })],
      recordId: 'deleted-draft',
      currentGradeId: 'g1',
      classes,
    }),
    null,
  );
  assert.equal(resolveExamEditTarget({ majors: [], recordId: 'any', currentGradeId: 'g1', classes }), null);
});
