import assert from 'node:assert/strict';
import test from 'node:test';
import { examTimePrefix, examTimeRange } from '../src/utils/examRecordTimeLabel.js';

/** 2026-09-19 10:00（上海）作参考点。 */
const NOW = new Date('2026-09-19T02:00:00Z').getTime();
const at = (iso: string) => new Date(iso).getTime();

test('examTimePrefix: 今天 / 明天 / 短日期', () => {
  assert.equal(examTimePrefix('2026-09-19', '2026-09-19'), '今天');
  assert.equal(examTimePrefix('2026-09-20', '2026-09-19'), '明天');
  assert.equal(examTimePrefix('2026-09-25', '2026-09-19'), '9/25');
  assert.equal(examTimePrefix('2026-10-03', '2026-09-19'), '10/3');
});

test('examTimeRange: 同一天只写一次日期', () => {
  assert.equal(examTimeRange(at('2026-09-19T00:30:00Z'), at('2026-09-19T02:30:00Z'), NOW), '今天 08:30–10:30');
  assert.equal(examTimeRange(at('2026-09-20T01:00:00Z'), at('2026-09-20T03:00:00Z'), NOW), '明天 09:00–11:00');
  assert.equal(examTimeRange(at('2026-09-25T00:00:00Z'), at('2026-09-25T01:30:00Z'), NOW), '9/25 08:00–09:30');
});

test('examTimeRange: 跨天时补出结束日期', () => {
  assert.equal(examTimeRange(at('2026-09-19T14:00:00Z'), at('2026-09-19T16:30:00Z'), NOW), '今天 22:00 – 9/20 00:30');
});

test('examTimeRange: 缺时间与只有开始时间', () => {
  assert.equal(examTimeRange(null, null, NOW), '时间待定');
  assert.equal(examTimeRange(at('2026-09-19T00:30:00Z'), null, NOW), '今天 08:30');
});
