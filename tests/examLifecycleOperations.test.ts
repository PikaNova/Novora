import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveEndAt, planAutoStart, planExamOperation } from '../src/shared/examLifecycleOperations.js';
import { getZonedParts, parseZonedTime } from '../src/utils/zonedTime.js';

const AT = 1_700_000_000_000;
const base = {
  status: 'published' as const,
  startAt: AT - 3_600_000,
  actualStartAt: null,
  actualEndAt: null,
  endAt: AT + 3_600_000,
  pausedAt: null,
  pausedMs: 0,
};

// 「开考」不再由人工发起：到点由系统自动开考（见 tests/examLifecycleAuto.test.ts 的 planAutoStart），
// 所以这里不再有 start 的用例。

test('pause：已开考的直接暂停，已在暂停 / 非发布态拒绝', () => {
  const started = { ...base, actualStartAt: AT - 60_000 };
  assert.deepEqual(planExamOperation(started, { action: 'pause', at: AT }), { ok: true, patch: { pausedAt: AT } });
  assert.equal(planExamOperation({ ...started, pausedAt: AT - 1 }, { action: 'pause', at: AT }).ok, false);
  assert.equal(planExamOperation({ ...started, status: 'ended' as const }, { action: 'pause', at: AT }).ok, false);
});

test('pause：手动暂停不等系统的到点校验 —— 未开考的也允许，并补记开考时间', () => {
  // 计划开始时间已过：补记计划时间（等于把漏掉的自动开考补上），开考时间仍然准确。
  assert.deepEqual(planExamOperation(base, { action: 'pause', at: AT }), {
    ok: true,
    patch: { actualStartAt: base.startAt, pausedAt: AT },
  });
  // 还没到点就手动暂停：记此刻为开考时间（提前开考 + 立即暂停）。
  const future = { ...base, startAt: AT + 600_000 };
  assert.deepEqual(planExamOperation(future, { action: 'pause', at: AT }), {
    ok: true,
    patch: { actualStartAt: AT, pausedAt: AT },
  });
  // 连计划开始时间都没有：同样按此刻开考，不再报「考试还未开考」。
  assert.deepEqual(planExamOperation({ ...base, startAt: null }, { action: 'pause', at: AT }), {
    ok: true,
    patch: { actualStartAt: AT, pausedAt: AT },
  });
  // 补记开考时间后不会和自动开考打架：自动开考看到已开考就跳过。
  const planned = planExamOperation(base, { action: 'pause', at: AT });
  const startedAt = planned.ok ? planned.patch.actualStartAt : undefined;
  assert.deepEqual(planAutoStart({ ...base, actualStartAt: startedAt as number }, base.startAt + 1), {
    ok: false,
    reason: 'already-started',
  });
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

test('extend：只延长当前进行中的子考试，其他子考试时间保持不变', () => {
  const localIso = (value: number) => {
    const parts = getZonedParts(value);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:00`;
  };
  const items = [
    {
      id: 'current',
      name: '数学',
      startTime: localIso(AT - 30 * 60_000),
      endTime: localIso(AT + 15 * 60_000),
      enabled: true,
      order: 0,
    },
    {
      id: 'later',
      name: '英语',
      startTime: localIso(AT + 60 * 60_000),
      endTime: localIso(AT + 2 * 60 * 60_000),
      enabled: true,
      order: 1,
    },
  ];
  const result = planExamOperation(
    { ...base, endAt: parseZonedTime(items[1].endTime), items },
    { action: 'extend', at: AT, extendMinutes: 10 },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.patch.items?.[0]?.endTime, localIso(AT + 25 * 60_000));
  assert.equal(result.patch.items?.[1]?.endTime, items[1].endTime);
  assert.equal(
    result.patch.endAt,
    parseZonedTime(items[1].endTime),
    '后续子考试仍是整场结束时间，不应被当前科目延长影响',
  );
});

test('extend：保留子考试时间格式，不能因其他子考试解析异常缩短整场结束时间', () => {
  const items = [
    {
      id: 'current',
      name: '数学',
      startTime: new Date(AT - 30 * 60_000).toISOString(),
      endTime: new Date(AT + 15 * 60_000).toISOString(),
      enabled: true,
      order: 0,
    },
    { id: 'later', name: '英语', startTime: 'invalid', endTime: 'invalid', enabled: true, order: 1 },
  ];
  const result = planExamOperation({ ...base, items }, { action: 'extend', at: AT, extendMinutes: 10 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.patch.items?.[0]?.endTime, new Date(AT + 25 * 60_000).toISOString());
  assert.deepEqual(result.patch.items?.[1], items[1]);
  assert.equal(result.patch.endAt, base.endAt, '整场已有结束时间较晚时不能因其他科目时间格式缩短');
});

test('end：结算暂停时长并置为已结束', () => {
  const paused = { ...base, actualStartAt: AT - 600_000, pausedAt: AT - 60_000, pausedMs: 10_000 };
  assert.deepEqual(planExamOperation(paused, { action: 'end', at: AT }), {
    ok: true,
    // 结束顺带清掉历史数据里「申请停止」留下的时间戳（那套流程已经下线）。
    patch: { status: 'ended', actualEndAt: AT, pausedAt: null, pausedMs: 70_000, stopRequestedAt: null },
  });
  assert.equal(planExamOperation({ ...base, status: 'archived' as const }, { action: 'end', at: AT }).ok, false);
});

test('effectiveEndAt：暂停时长顺延倒计时基准', () => {
  assert.equal(effectiveEndAt({ endAt: AT, pausedMs: 0 }), AT);
  assert.equal(effectiveEndAt({ endAt: AT, pausedMs: 90_000 }), AT + 90_000);
  assert.equal(effectiveEndAt({ endAt: null, pausedMs: 90_000 }), null);
});
