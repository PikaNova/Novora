import assert from 'node:assert/strict';
import test from 'node:test';
import { quickMajorTransitions } from '../api/_exams/quickMajorTransitions.js';

const quick = (patch: Record<string, unknown> = {}) => ({
  id: 'quick-1',
  name: '快速考试',
  source: 'quick',
  temporary: true,
  startAt: 1_000,
  endAt: 2_000,
  endedAt: null,
  ...patch,
});

const regular = (patch: Record<string, unknown> = {}) => ({
  id: 'regular-1',
  name: '正式考试',
  source: 'regular',
  startAt: 1_000,
  endAt: 2_000,
  ...patch,
});

test('quickMajorTransitions: 新建快速考试记为发布', () => {
  assert.deepEqual(quickMajorTransitions([], [quick()]), [
    { recordId: 'quick-1', action: 'publish', fromStatus: 'draft', toStatus: 'published' },
  ]);
});

test('quickMajorTransitions: 提前结束记为 end', () => {
  assert.deepEqual(quickMajorTransitions([quick()], [quick({ endedAt: 3_000 })]), [
    { recordId: 'quick-1', action: 'end', fromStatus: 'published', toStatus: 'ended' },
  ]);
});

test('quickMajorTransitions: 延长结束时间记为 extend', () => {
  const transitions = quickMajorTransitions([quick()], [quick({ endAt: 2_600 })]);
  assert.deepEqual(transitions, [
    { recordId: 'quick-1', action: 'extend', fromStatus: 'published', toStatus: 'published' },
  ]);
});

test('quickMajorTransitions: 转正式记为 promote，并保留当时的持久状态', () => {
  assert.deepEqual(quickMajorTransitions([quick()], [quick({ source: 'regular', temporary: false })]), [
    { recordId: 'quick-1', action: 'promote', fromStatus: 'published', toStatus: 'published' },
  ]);
  assert.deepEqual(quickMajorTransitions([quick({ endedAt: 3_000 })], [quick({ source: 'regular', endedAt: 3_000 })]), [
    { recordId: 'quick-1', action: 'promote', fromStatus: 'ended', toStatus: 'ended' },
  ]);
});

test('quickMajorTransitions: 结束与转正式同时发生时两条都记', () => {
  const transitions = quickMajorTransitions(
    [quick()],
    [quick({ source: 'regular', temporary: false, endedAt: 3_000 })],
  );
  assert.deepEqual(
    transitions.map((item) => item.action),
    ['end', 'promote'],
  );
});

test('quickMajorTransitions: 与快速考试无关的改动不产生日志', () => {
  assert.deepEqual(quickMajorTransitions([quick()], [quick({ name: '改名' })]), []);
  assert.deepEqual(quickMajorTransitions([regular()], [regular({ name: '改名' })]), []);
  assert.deepEqual(quickMajorTransitions([regular()], [regular({ endedAt: 3_000 })]), []);
  // 缩短结束时间不算延长
  assert.deepEqual(quickMajorTransitions([quick()], [quick({ endAt: 1_500 })]), []);
  // 重复保存同一份快照不应重复记日志
  assert.deepEqual(quickMajorTransitions([quick({ endedAt: 3_000 })], [quick({ endedAt: 3_000 })]), []);
});

test('quickMajorTransitions: 非法输入被忽略而不是抛错', () => {
  assert.deepEqual(quickMajorTransitions(null, undefined), []);
  assert.deepEqual(quickMajorTransitions([{ name: '缺 id' }], [null, 1, 'x']), []);
  assert.deepEqual(quickMajorTransitions([quick()], [{ id: 'quick-1', source: 'quick', endAt: '2 600' }]), []);
});
