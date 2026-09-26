import assert from 'node:assert/strict';
import test from 'node:test';
import { parseZonedTime } from '../src/utils/zonedTime.js';
import {
  groupHistoryEntries,
  groupScheduleEntries,
  monthLabelOf,
  scheduleBucketKey,
} from '../src/utils/examListGrouping.js';

const NOW = parseZonedTime('2026-09-18T09:00:00'); // 周五
const at = (local: string) => parseZonedTime(local);

test('scheduleBucketKey：今天 / 明天 / 本周内 / 更晚 / 无时间', () => {
  assert.equal(scheduleBucketKey(at('2026-09-18T08:00:00'), NOW), 'today');
  assert.equal(scheduleBucketKey(at('2026-09-18T23:00:00'), NOW), 'today');
  assert.equal(scheduleBucketKey(at('2026-09-17T10:00:00'), NOW), 'today', '已过的仍归今天之前一段');
  assert.equal(scheduleBucketKey(at('2026-09-19T08:00:00'), NOW), 'tomorrow');
  assert.equal(scheduleBucketKey(at('2026-09-20T08:00:00'), NOW), 'thisWeek', '周日仍属本周');
  assert.equal(scheduleBucketKey(at('2026-09-22T08:00:00'), NOW), 'later', '下周二跨周');
  assert.equal(scheduleBucketKey(null, NOW), 'later', '未定时间归更晚');
});

test('groupScheduleEntries：按四段切分且空段不产出，段内保持原顺序', () => {
  const entries = [
    { id: 'a', startAt: at('2026-09-18T08:00:00') },
    { id: 'b', startAt: at('2026-09-19T08:00:00') },
    { id: 'c', startAt: at('2026-09-20T08:00:00') },
    { id: 'd', startAt: at('2026-09-22T08:00:00') },
    { id: 'e', startAt: null },
  ];
  const groups = groupScheduleEntries(entries, NOW);
  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((item) => item.id)]),
    [
      ['今天', ['a']],
      ['明天', ['b']],
      ['本周内', ['c']],
      ['更晚', ['d', 'e']],
    ],
  );
});

test('groupScheduleEntries：只有一段时不会造出空分组', () => {
  const groups = groupScheduleEntries([{ startAt: at('2026-09-18T09:30:00') }], NOW);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, '今天');
});

test('monthLabelOf / groupHistoryEntries：按结束时间落月并合并同月', () => {
  assert.equal(monthLabelOf(at('2026-09-15T10:00:00')), '2026年9月');
  assert.equal(monthLabelOf(null), '');
  const groups = groupHistoryEntries([
    { id: 'x', endedAt: at('2026-09-15T10:00:00'), actualEndAt: null },
    { id: 'y', endedAt: at('2026-09-02T10:00:00'), actualEndAt: at('2026-09-02T11:00:00') },
    { id: 'z', endedAt: at('2026-08-28T10:00:00'), actualEndAt: null },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((item) => item.id)]),
    [
      ['2026年9月', ['x', 'y']],
      ['2026年8月', ['z']],
    ],
  );
});
