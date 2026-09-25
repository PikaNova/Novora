import assert from 'node:assert/strict';
import test from 'node:test';

const { threeWayMergeExam } = await import('../src/utils/examMerge.js');

/**
 * 三方合并里的「删除」语义。
 *
 * 线上现象：年级管理员删掉一场考试，保存反复 409（并发冲突）之后，被删的那场又回到推送里
 * ——服务端一直收到 8 场，用户看到的就是「删不掉」。删除是**显式意图**，
 * 只要本机删了、且远端不是"别人也刚改过同一个 id"，就必须保留删除。
 */

/** 直接用函数签名推导荷载类型，省得猜导出名。 */
type Payload = Parameters<typeof threeWayMergeExam>[0];
type Major = Payload['majors'][number];

const major = (id: string, name: string, extra: Partial<Major> = {}): Major => ({
  id,
  name,
  items: [],
  order: 0,
  targetGradeIds: [],
  targetClassIds: [],
  ...extra,
});

const payload = (majors: Major[], activeMajorId = majors[0]?.id ?? ''): Payload => ({
  items: [],
  title: majors.find((m) => m.id === activeMajorId)?.name ?? '',
  majors,
  activeMajorId,
  alerts: null,
  updatedAt: 1,
});

const ids = (result: { payload: Payload }) =>
  result.payload.majors.map((item) => String((item as { id?: unknown }).id)).sort();

test('三方合并：本机删掉的考试，远端没动过 → 保持删除', () => {
  const base = payload([major('a', 'A'), major('b', 'B')]);
  const local = payload([major('a', 'A')]);
  const remote = payload([major('a', 'A'), major('b', 'B')]);
  assert.deepEqual(ids(threeWayMergeExam(base, local, remote)), ['a']);
});

test('三方合并：本机删掉的考试，远端也改过它 → 仍然保持删除（删除是显式意图）', () => {
  const base = payload([major('a', 'A'), major('b', 'B')]);
  const local = payload([major('a', 'A')]);
  const remote = payload([major('a', 'A'), major('b', 'B 远端改名了')]);
  assert.deepEqual(ids(threeWayMergeExam(base, local, remote)), ['a']);
});

test('三方合并：远端新增的考试要保留，本机删除的不能复活', () => {
  const base = payload([major('a', 'A'), major('b', 'B')]);
  const local = payload([major('a', 'A')]);
  const remote = payload([major('a', 'A'), major('b', 'B'), major('c', 'C')]);
  assert.deepEqual(ids(threeWayMergeExam(base, local, remote)), ['a', 'c']);
});

test('三方合并：本机也改过其它考试时，删除与改动互不影响', () => {
  const base = payload([major('a', 'A'), major('b', 'B')]);
  const local = payload([major('a', 'A 本机改名')]);
  const remote = payload([major('a', 'A'), major('b', 'B 远端改名')]);
  assert.deepEqual(ids(threeWayMergeExam(base, local, remote)), ['a']);
});
