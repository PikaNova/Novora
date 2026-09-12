import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeArchivedMajors } from '../api/_exams/permissions.js';
import type { ExamPayload } from '../api/_exams/payload.js';

function current(majors: Array<Record<string, unknown>>): ExamPayload {
  return { majors } as unknown as ExamPayload;
}

const archivedMajor = {
  id: 'archived-1',
  name: '归档考试',
  items: [],
  order: 0,
  source: 'regular',
  archivedAt: 1_700_000_000_000,
};

const liveMajor = { id: 'live-1', name: '进行中考试', items: [], order: 1, source: 'regular' };

function idsOf(body: Record<string, unknown>): string[] {
  const majors = Array.isArray(body.majors) ? (body.majors as Array<Record<string, unknown>>) : [];
  return majors.map((major) => String(major.id));
}

test('freezeArchivedMajors: 已归档考试的修改被回退到服务端版本', () => {
  const result = freezeArchivedMajors(current([archivedMajor, liveMajor]), {
    majors: [{ ...archivedMajor, name: '被改名的归档考试' }, liveMajor],
  });
  assert.deepEqual(result.frozenIds, ['archived-1']);
  const majors = result.body.majors as Array<Record<string, unknown>>;
  assert.equal(majors[0].name, '归档考试', '归档条目必须回退');
  assert.equal(majors[1].name, '进行中考试');
});

test('freezeArchivedMajors: 未归档考试照常保存，冻结列表为空', () => {
  const result = freezeArchivedMajors(current([archivedMajor, liveMajor]), {
    majors: [{ ...archivedMajor }, { ...liveMajor, name: '改过名字的正式考试' }],
  });
  assert.deepEqual(result.frozenIds, []);
  const majors = result.body.majors as Array<Record<string, unknown>>;
  assert.equal(majors[0].name, '归档考试');
  assert.equal(majors[1].name, '改过名字的正式考试');
});

test('freezeArchivedMajors: 原样提交（outbox 重放）不会被标记为冻结', () => {
  const result = freezeArchivedMajors(current([archivedMajor]), {
    majors: [{ ...archivedMajor }],
  });
  assert.deepEqual(result.frozenIds, []);
  assert.deepEqual(idsOf(result.body), ['archived-1']);
});

test('freezeArchivedMajors: 归档考试被移出快照时会被补回', () => {
  const result = freezeArchivedMajors(current([archivedMajor, liveMajor]), {
    majors: [liveMajor],
  });
  assert.deepEqual(result.frozenIds, ['archived-1']);
  assert.deepEqual(idsOf(result.body).sort(), ['archived-1', 'live-1']);
});

test('freezeArchivedMajors: 没有归档考试或没有 majors 字段时原样返回', () => {
  const untouched = { majors: [{ ...liveMajor, name: '改名' }] };
  assert.deepEqual(freezeArchivedMajors(current([liveMajor]), untouched), {
    body: untouched,
    frozenIds: [],
  });
  const noMajors = { items: [] };
  assert.deepEqual(freezeArchivedMajors(current([archivedMajor]), noMajors), {
    body: noMajors,
    frozenIds: [],
  });
});
