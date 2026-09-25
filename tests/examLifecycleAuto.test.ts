import assert from 'node:assert/strict';
import test from 'node:test';
import { examRecordDisplayStatus } from '../src/shared/examRecordContracts.js';
import { planAutoEnd, planAutoStart } from '../src/shared/examLifecycleOperations.js';

const M = 60_000;
const START = new Date('2026-09-19T09:00:00+08:00').getTime();
const END = START + 90 * M;

const base = {
  status: 'published' as const,
  startAt: START,
  endAt: END,
  actualStartAt: null,
  actualEndAt: null,
  pausedAt: null,
  pausedMs: 0,
};

test('planAutoStart: 到点由系统开考，写入的是计划时间而不是 now', () => {
  const late = START + 7 * M; // 后台晚 7 分钟才有人打开页面
  const plan = planAutoStart(base, late);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && plan.patch, { actualStartAt: START });
});

test('planAutoStart: 未到点 / 已开考 / 非 published / 没有计划时间都跳过（幂等）', () => {
  assert.deepEqual(planAutoStart(base, START - 1), { ok: false, reason: 'not-due' });
  assert.deepEqual(planAutoStart({ ...base, actualStartAt: START }, START + M), {
    ok: false,
    reason: 'already-started',
  });
  assert.deepEqual(planAutoStart({ ...base, status: 'draft' }, START + M), { ok: false, reason: 'not-live' });
  assert.deepEqual(planAutoStart({ ...base, startAt: null }, START + M), { ok: false, reason: 'missing-time' });
  // 同一次到点重复调用：第一次成功，第二次因为已开考而跳过。
  const first = planAutoStart(base, START);
  assert.equal(first.ok, true);
  assert.equal(planAutoStart({ ...base, actualStartAt: START }, START + M).ok, false);
});

// 「申请停止 → 等系统判定」已经去掉：手动结束由 planExamOperation('end') 直接落 ended，
// 系统这边只剩下「到点收场」（见 examRecordLifecycle 集成用例）。

test('planAutoEnd: 没开考就不收场（手动结束不在这里，到点才由系统收场）', () => {
  assert.deepEqual(planAutoEnd(base, END + M), { ok: false, reason: 'not-started' });
  assert.deepEqual(planAutoEnd({ ...base, status: 'draft' }, END + M), { ok: false, reason: 'not-live' });
  assert.deepEqual(planAutoEnd({ ...base, actualStartAt: START, endAt: null }, END + M), {
    ok: false,
    reason: 'missing-time',
  });
  // 到点之前不收场，重复调用得到同样的跳过结果（幂等）。
  assert.deepEqual(planAutoEnd({ ...base, actualStartAt: START }, END - 1), { ok: false, reason: 'not-due' });
});

test('planAutoEnd: 到点收场，且按到点时刻结算', () => {
  const plan = planAutoEnd({ ...base, actualStartAt: START }, END + 5 * M);
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.reason, 'timeup');
  assert.deepEqual(plan.ok && plan.patch, {
    status: 'ended',
    actualEndAt: END,
    pausedAt: null,
    pausedMs: 0,
    stopRequestedAt: null,
  });
});

test('planAutoEnd: 暂停过的考试按 endAt + pausedMs 判定，并结转暂停时长', () => {
  const pausedMs = 12 * M;
  const requested = {
    ...base,
    actualStartAt: START,
    pausedMs,
    pausedAt: END - 3 * M,
  };
  const plan = planAutoEnd(requested, END + pausedMs + M);
  assert.equal(plan.ok && plan.reason, 'timeup');
  assert.equal(plan.ok && plan.patch.actualEndAt, END + pausedMs);
  // 暂停从 END-3 分钟一直持续到收场时刻 END+12 分钟，共 15 分钟：
  // 累计暂停 = 已结转的 12 分钟 + 本次 15 分钟 = 27 分钟。
  const pauseDuration = END + pausedMs - (END - 3 * M);
  assert.equal(plan.ok && plan.patch.pausedMs, pausedMs + pauseDuration);
  assert.equal(plan.ok && plan.patch.pausedMs, 27 * M);
});

test('examRecordDisplayStatus: 待开始 / 进行中 / 已结束 / 归档 / 草稿', () => {
  const now = START + 5 * M;
  assert.equal(examRecordDisplayStatus({ ...base }, now), 'published');
  assert.equal(examRecordDisplayStatus({ ...base, actualStartAt: START }, now), 'ongoing');
  assert.equal(examRecordDisplayStatus({ ...base, status: 'ended' }, now), 'ended');
  assert.equal(examRecordDisplayStatus({ ...base, status: 'archived' }, now), 'archived');
  assert.equal(examRecordDisplayStatus({ ...base, status: 'draft' }, now), 'draft');
});
