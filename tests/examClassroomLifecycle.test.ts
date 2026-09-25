import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectiveSchedule } from '../src/utils/scheduleConflict.js';

/**
 * 教室端（大屏 / 首页 / 提醒 / 13 套设计）统一消费 `resolveEffectiveSchedule().activeItems`。
 * 后台动作必须落到这个出口上才算"生效"：
 * - 延长：`endAt` 变大 → 原本结束最晚的那一科顺延；
 * - 暂停/继续：`pausedMs` 累计暂停时长 → 顺延同一科；`pausedAt` 非空 → 教室端冻结倒计时；
 * - 结束 / 归档：`endedAt` / `archivedAt` 非空 → 立刻从时间线消失。
 */

function major(
  items: Array<{ name: string; startTime: string; endTime: string }>,
  patch: Record<string, unknown> = {},
) {
  return {
    id: 'major-1',
    name: '大型考试',
    targetGradeIds: ['g1'],
    items: items.map((item, index) => ({
      id: `item-${index}`,
      name: item.name,
      startTime: item.startTime,
      endTime: item.endTime,
      enabled: true,
      order: index,
    })),
    ...patch,
  };
}

function resolve(majors: unknown[], nowIso = '2026-08-01T08:00') {
  return resolveEffectiveSchedule(
    {
      scheduleMode: 'major-only',
      activeMajorId: 'major-1',
      activeWeeklyPlanId: null,
      selectedGradeId: 'g1',
      selectedClassId: 'c1',
      weeklyPlans: [],
      majors: majors as never,
    },
    new Date(nowIso).getTime(),
  );
}

const twoSubjects = [
  { name: '数学', startTime: '2026-08-01T09:00', endTime: '2026-08-01T11:00' },
  { name: '语文', startTime: '2026-08-01T14:00', endTime: '2026-08-01T16:00' },
];

test('教室端：延长考试把"结束最晚的那一科"顺延到新的结束时刻', () => {
  const base = resolve([major(twoSubjects)]);
  assert.deepEqual(
    base.activeItems.map((item) => `${item.name}:${item.endTime}`),
    ['数学:2026-08-01T11:00', '语文:2026-08-01T16:00'],
  );

  // 后台延长 30 分钟：endAt 从 16:00 变成 16:30（真实结束时刻 = endAt + pausedMs）
  const extended = resolve([major(twoSubjects, { endAt: new Date('2026-08-01T16:30').getTime(), pausedMs: 0 })]);
  assert.deepEqual(
    extended.activeItems.map((item) => `${item.name}:${item.endTime}`),
    ['数学:2026-08-01T11:00', '语文:2026-08-01T16:30'],
    '只有原本结束最晚的那一科顺延，其它科目不动',
  );
});

test('教室端：暂停顺延（endAt + pausedMs）照样顺延最后一科', () => {
  const pausedThenResumed = resolve([
    major(twoSubjects, { endAt: new Date('2026-08-01T16:00').getTime(), pausedMs: 25 * 60_000 }),
  ]);
  assert.equal(pausedThenResumed.activeItems[1]?.endTime, '2026-08-01T16:25');
});

test('教室端：暂停中的考试带上 pausedAt/pausedMs，供大屏冻结倒计时', () => {
  const pausedAt = new Date('2026-08-01T15:00').getTime();
  const paused = resolve([
    major(twoSubjects, { endAt: new Date('2026-08-01T16:00').getTime(), pausedAt, pausedMs: 0 }),
  ]);
  const current = paused.activeItems[1] as { pausedAt?: number | null; pausedMs?: number };
  assert.equal(current.pausedAt, pausedAt);
  assert.equal(current.pausedMs, 0);
});

test('教室端：已结束 / 已归档的考试立刻从时间线消失', () => {
  assert.equal(resolve([major(twoSubjects, { endedAt: Date.now() })]).activeItems.length, 0);
  assert.equal(resolve([major(twoSubjects, { archivedAt: Date.now() })]).activeItems.length, 0);
  assert.equal(resolve([major(twoSubjects)]).activeItems.length, 2, '没结束没归档的照常展示');
});

test('教室端：复制出来的草稿不会凭空多出一场考试', () => {
  assert.equal(resolve([major(twoSubjects, { draft: true })]).activeItems.length, 0);
});
