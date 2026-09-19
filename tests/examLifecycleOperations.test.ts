import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveEndAt, planExamOperation } from '../src/shared/examLifecycleOperations.js';

const AT = 1_700_000_000_000;
const base = {
  status: 'published' as const,
  actualStartAt: null,
  actualEndAt: null,
  endAt: AT + 3_600_000,
  pausedAt: null,
  pausedMs: 0,
};

// 「开考」不再由人工发起：到点由系统自动开考（见 tests/examLifecycleAuto.test.ts 的 planAutoStart），
// 所以这里不再有 start 的用例。

test('pause：未开考 / 已在暂停 / 非发布态均拒绝', () => {
  const started = { ...base, actualStartAt: AT - 60_000 };
  assert.deepEqual(planExamOperation(started, { action: 'pause', at: AT }), { ok: true, patch: { pausedAt: AT } });
  assert.equal(planExamOperation(base, { action: 'pause', at: AT }).ok, false);
  assert.equal(planExamOperation({ ...started, pausedAt: AT - 1 }, { action: 'pause', at: AT }).ok, false);
  assert.equal(planExamOperation({ ...started, status: 'ended' as const }, { action: 'pause', at: AT }).ok, false);
});

test('resume：本次暂停时长累加进 pausedMs', () => {
  const paused = { ...base, actualStartAt: AT - 600_000, pausedAt: AT - 120_000, pausedMs: 30_000 };
  assert.deepEqual(planExamOperation(paused, { action: 'resume', at: AT }), {
    ok: true,
    patch: { pausedAt: null, pausedMs: 150_000 },
  });
  assert.equal(planExamOperation(base, { action: 'resume', at: AT }).ok, false);
});

test('extend：按分钟顺延，越界或缺结束时间都拒绝', () => {
  assert.deepEqual(planExamOperation(base, { action: 'extend', at: AT, extendMinutes: 5 }), {
    ok: true,
    patch: { endAt: base.endAt + 300_000 },
  });
  for (const minutes of [0, -5, 601, undefined]) {
    assert.equal(
      planExamOperation(base, { action: 'extend', at: AT, extendMinutes: minutes as number }).ok,
      false,
      `extendMinutes=${minutes} 应被拒绝`,
    );
  }
  assert.equal(planExamOperation({ ...base, endAt: null }, { action: 'extend', at: AT, extendMinutes: 5 }).ok, false);
});

test('end：结算暂停时长并置为已结束', () => {
  const paused = { ...base, actualStartAt: AT - 600_000, pausedAt: AT - 60_000, pausedMs: 10_000 };
  assert.deepEqual(planExamOperation(paused, { action: 'end', at: AT }), {
    ok: true,
    patch: { status: 'ended', actualEndAt: AT, pausedAt: null, pausedMs: 70_000 },
  });
  assert.equal(planExamOperation({ ...base, status: 'archived' as const }, { action: 'end', at: AT }).ok, false);
});

test('effectiveEndAt：暂停时长顺延倒计时基准', () => {
  assert.equal(effectiveEndAt({ endAt: AT, pausedMs: 0 }), AT);
  assert.equal(effectiveEndAt({ endAt: AT, pausedMs: 90_000 }), AT + 90_000);
  assert.equal(effectiveEndAt({ endAt: null, pausedMs: 90_000 }), null);
});
