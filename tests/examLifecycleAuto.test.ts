import assert from 'node:assert/strict';
import test from 'node:test';
import { examRecordDisplayStatus } from '../src/shared/examRecordContracts.js';
import { planAutoEnd, planAutoStart, planStopRequest } from '../src/shared/examLifecycleOperations.js';

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
  stopRequestedAt: null,
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

test('planStopRequest: 手动结束只留申请，重复申请跳过', () => {
  const at = START + 10 * M;
  assert.deepEqual(planStopRequest(base, at), { ok: true, patch: { stopRequestedAt: at } });
  assert.deepEqual(planStopRequest({ ...base, stopRequestedAt: at }, at + M), {
    ok: false,
    reason: 'already-requested',
  });
  assert.deepEqual(planStopRequest({ ...base, status: 'ended' }, at), { ok: false, reason: 'not-live' });
});

test('planAutoEnd: 没申请停止就不判定', () => {
  const plan = planAutoEnd(base, END + M, { allDevicesReported: true, noDeviceGraceExpired: true });
  assert.deepEqual(plan, { ok: false, reason: 'no-stop-request' });
});

test('planAutoEnd: 还没开考就申请停止 = 取消，立即结束', () => {
  const requested = { ...base, stopRequestedAt: START - 5 * M };
  const plan = planAutoEnd(requested, START - 4 * M, { allDevicesReported: false, noDeviceGraceExpired: false });
  assert.equal(plan.ok && plan.reason, 'cancelled');
  assert.equal(plan.ok && plan.patch.status, 'ended');
  assert.equal(plan.ok && plan.patch.actualEndAt, START - 4 * M);
});

test('planAutoEnd: 到点优先——设备没回执也结束，且按到点时刻结算', () => {
  const requested = { ...base, actualStartAt: START, stopRequestedAt: START + 20 * M };
  const plan = planAutoEnd(requested, END + 5 * M, { allDevicesReported: false, noDeviceGraceExpired: false });
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

test('planAutoEnd: 到点前先看全员回执，再看无人宽限', () => {
  const requested = { ...base, actualStartAt: START, stopRequestedAt: START + 20 * M };
  const early = END - 10 * M;
  const byReceipts = planAutoEnd(requested, early, { allDevicesReported: true, noDeviceGraceExpired: false });
  assert.equal(byReceipts.ok && byReceipts.reason, 'receipts');
  assert.equal(byReceipts.ok && byReceipts.patch.actualEndAt, early);
  const byTimeout = planAutoEnd(requested, early, { allDevicesReported: false, noDeviceGraceExpired: true });
  assert.equal(byTimeout.ok && byTimeout.reason, 'no-device-timeout');
  const notYet = planAutoEnd(requested, early, { allDevicesReported: false, noDeviceGraceExpired: false });
  assert.deepEqual(notYet, { ok: false, reason: 'not-finished' });
});

test('planAutoEnd: 暂停过的考试按 endAt + pausedMs 判定，并结转暂停时长', () => {
  const pausedMs = 12 * M;
  const requested = {
    ...base,
    actualStartAt: START,
    stopRequestedAt: START + 30 * M,
    pausedMs,
    pausedAt: END - 3 * M,
  };
  const plan = planAutoEnd(requested, END + pausedMs + M, { allDevicesReported: false, noDeviceGraceExpired: false });
  assert.equal(plan.ok && plan.reason, 'timeup');
  assert.equal(plan.ok && plan.patch.actualEndAt, END + pausedMs);
  // 暂停从 END-3 分钟一直持续到判定结束时刻 END+12 分钟，共 15 分钟：
  // 累计暂停 = 已结转的 12 分钟 + 本次 15 分钟 = 27 分钟。
  const pauseDuration = END + pausedMs - (END - 3 * M);
  assert.equal(plan.ok && plan.patch.pausedMs, pausedMs + pauseDuration);
  assert.equal(plan.ok && plan.patch.pausedMs, 27 * M);
});

test('examRecordDisplayStatus: 待开始 / 进行中 / 停止中 / 已结束 / 归档 / 草稿', () => {
  const now = START + 5 * M;
  assert.equal(examRecordDisplayStatus({ ...base }, now), 'published');
  assert.equal(examRecordDisplayStatus({ ...base, actualStartAt: START }, now), 'ongoing');
  assert.equal(examRecordDisplayStatus({ ...base, actualStartAt: START, stopRequestedAt: now }, now), 'stopping');
  assert.equal(examRecordDisplayStatus({ ...base, status: 'ended' }, now), 'ended');
  assert.equal(examRecordDisplayStatus({ ...base, status: 'archived' }, now), 'archived');
  assert.equal(examRecordDisplayStatus({ ...base, status: 'draft' }, now), 'draft');
});
