import assert from 'node:assert/strict';
import test from 'node:test';
import { examWindowFromItems } from '../src/utils/examWindow.js';
import type { ExamItem } from '../src/types/index.js';

function item(patch: Partial<ExamItem>): ExamItem {
  return { id: 'i', name: '语文', startTime: '', endTime: '', enabled: true, order: 0, ...patch };
}

test('examWindowFromItems: 取启用科目的最早开始与最晚结束', () => {
  const window = examWindowFromItems([
    item({ id: 'a', startTime: '2026-06-07T09:00', endTime: '2026-06-07T11:30' }),
    item({ id: 'b', startTime: '2026-06-07T15:00', endTime: '2026-06-07T17:00' }),
    item({ id: 'c', startTime: '2026-06-08T09:00', endTime: '2026-06-08T10:15' }),
  ]);
  assert.equal(window.start, new Date('2026-06-07T09:00').getTime());
  assert.equal(window.end, new Date('2026-06-08T10:15').getTime());
});

test('examWindowFromItems: 停用或缺时间的科目不参与计算', () => {
  const window = examWindowFromItems([
    item({ id: 'on', startTime: '2026-06-07T09:00', endTime: '2026-06-07T11:00' }),
    item({ id: 'off', enabled: false, startTime: '2026-06-01T08:00', endTime: '2026-06-01T09:00' }),
    item({ id: 'no-time', startTime: '', endTime: '' }),
  ]);
  assert.equal(window.start, new Date('2026-06-07T09:00').getTime());
  assert.equal(window.end, new Date('2026-06-07T11:00').getTime());
});

test('examWindowFromItems: 没有可用科目时间时返回 null，发布因此被拦住', () => {
  assert.deepEqual(examWindowFromItems([]), { start: null, end: null });
  assert.deepEqual(examWindowFromItems([item({ enabled: false })]), { start: null, end: null });
  assert.deepEqual(examWindowFromItems([item({ startTime: '2026-06-07T09:00' })]), {
    start: null,
    end: null,
  });
});
