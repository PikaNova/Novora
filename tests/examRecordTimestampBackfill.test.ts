import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planRecordTimestampFills,
  planSnapshotWindowFills,
  snapshotWindowOf,
  withSnapshotWindowFills,
  type BackfillMajorLike,
} from '../src/utils/examRecordTimestampBackfill.js';

const START = '2026-09-29T08:30:00';
const END = '2026-09-29T10:00:00';
const START_MS = new Date(START).getTime();
const END_MS = new Date(END).getTime();

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'i1',
  name: '语文',
  enabled: true,
  startTime: START,
  endTime: END,
  ...overrides,
});

test('窗口：显式 startAt/endAt 优先，缺了才用科目推算', () => {
  assert.deepEqual(snapshotWindowOf({ startAt: 1, endAt: 2, items: [item()] }), { startAt: 1, endAt: 2 });
  assert.deepEqual(snapshotWindowOf({ items: [item()] }), { startAt: START_MS, endAt: END_MS });
  // 只缺一半时，缺的那一半按科目推算。
  assert.deepEqual(snapshotWindowOf({ startAt: 1, items: [item()] }), { startAt: 1, endAt: END_MS });
  assert.deepEqual(snapshotWindowOf({ items: [item({ enabled: false })] }), { startAt: null, endAt: null });
  assert.deepEqual(snapshotWindowOf({}), { startAt: null, endAt: null });
});

test('快照回填计划：只列缺窗口且科目能算出窗口的考试', () => {
  const majors: BackfillMajorLike[] = [
    { id: 'has-window', name: '都有', startAt: 1, endAt: 2, items: [item()] },
    { id: 'needs-window', name: '下周二样本', items: [item()] },
    { id: 'no-times', name: '没时间', items: [item({ startTime: '', endTime: '' })] },
    { id: 'no-items', name: '没科目' },
    { name: '没有 id', items: [item()] },
  ];
  assert.deepEqual(planSnapshotWindowFills(majors), [
    { majorId: 'needs-window', majorName: '下周二样本', startAt: START_MS, endAt: END_MS },
  ]);
});

test('快照回填：写回命中的考试，其它原样，且不改原数组', () => {
  const majors: BackfillMajorLike[] = [
    { id: 'a', name: 'A', items: [item()] },
    { id: 'b', name: 'B', startAt: 5, endAt: 6 },
  ];
  const fills = planSnapshotWindowFills(majors);
  const next = withSnapshotWindowFills(majors, fills);
  assert.deepEqual(next[0], { id: 'a', name: 'A', items: [item()], startAt: START_MS, endAt: END_MS });
  assert.deepEqual(next[1], majors[1]);
  assert.deepEqual(majors[0], { id: 'a', name: 'A', items: [item()] }, '原数组不被就地修改');
});

test('记录时间列：只补空列，按日志里最早的一次', () => {
  const fills = planRecordTimestampFills(
    [
      {
        id: 'r1',
        published_at: null,
        ended_at: null,
        archived_at: null,
        actual_start_at: null,
        start_at: null,
        end_at: null,
      },
    ],
    [
      { action: 'publish', result_record_id: 'r1', created_at: 300 },
      { action: 'publish', result_record_id: 'r1', created_at: 100 },
      { action: 'auto_start', result_record_id: 'r1', created_at: 400 },
      { action: 'force_end', result_record_id: 'r1', created_at: 700 },
      { action: 'auto_archive', result_record_id: 'r1', created_at: 900 },
      { action: 'copy', result_record_id: 'r1', created_at: 50 },
      { action: 'publish', result_record_id: 'other', created_at: 10 },
    ],
    new Map([['r1', { startAt: START_MS, endAt: END_MS }]]),
  );
  assert.deepEqual(fills, [
    {
      id: 'r1',
      publishedAt: 100,
      actualStartAt: 400,
      endedAt: 700,
      archivedAt: 900,
      startAt: START_MS,
      endAt: END_MS,
    },
  ]);
});

test('记录时间列：已有值不动、无对应日志不补、无窗口不补，且幂等', () => {
  const record = {
    id: 'r2',
    published_at: 111,
    ended_at: null,
    archived_at: null,
    actual_start_at: null,
    start_at: 222,
    end_at: 333,
  };
  const fills = planRecordTimestampFills(
    [record],
    [
      { action: 'publish', result_record_id: 'r2', created_at: 999 },
      { action: 'auto_start', result_record_id: 'r2', created_at: 555 },
    ],
  );
  assert.deepEqual(fills, [{ id: 'r2', actualStartAt: 555 }]);

  // 再跑一遍：这次把上一步补出来的值当作已有值，应该没有新的改动。
  const after = { ...record, actual_start_at: 555 };
  assert.deepEqual(
    planRecordTimestampFills([after], [{ action: 'auto_start', result_record_id: 'r2', created_at: 555 }]),
    [],
  );
});
