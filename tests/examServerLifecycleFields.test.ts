import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveServerLifecycleFields } from '../api/_exams/examSnapshotPatch.js';

/**
 * 回归背景：教室端/插件/心跳读的是权威快照 `exam_data.majors`，而客户端保存是整份覆盖，
 * 它本地那份副本里没有后台动作写入的运行期字段 —— 一次普通编辑就能把「暂停 / 延长 / 发布 /
 * 结束 / 归档」抹掉，表现为「后台点了，教室端毫无变化」。这里把字段钉成服务端独占。
 */

const serverMajor = {
  id: 'major-1',
  name: '大型考试',
  items: [{ id: 'i1', name: '数学', startTime: '2026-08-01T09:00', endTime: '2026-08-01T11:00', enabled: true }],
  startAt: 100,
  endAt: 200,
  publishedAt: 111,
  actualStartAt: 222,
  pausedAt: 333,
  pausedMs: 5000,
  endedAt: 444,
  archivedAt: 555,
  stopRequestedAt: 666,
};

test('服务端运行期字段：客户端整份保存不能覆盖也不能抹掉', () => {
  const stale = {
    id: 'major-1',
    name: '大型考试（客户端改名）',
    items: serverMajor.items,
    // 客户端本地副本：只有它自己知道的东西，生命周期字段全缺
  };
  const [merged] = preserveServerLifecycleFields([serverMajor], [stale]) as Array<Record<string, unknown>>;
  assert.equal(merged.name, '大型考试（客户端改名）', '普通字段照常接受客户端提交');
  for (const field of [
    'publishedAt',
    'actualStartAt',
    'pausedAt',
    'pausedMs',
    'endedAt',
    'archivedAt',
    'stopRequestedAt',
  ]) {
    assert.equal(merged[field], (serverMajor as Record<string, unknown>)[field], `${field} 必须以服务端为准`);
  }
  // 结束时间：本地副本没带、科目又没改，视为陈旧副本 → 保留服务端的值
  // （否则一次普通保存就会把"延长"抹掉；新建考试/重排时间见下面两条用例）
  assert.equal(merged.endAt, serverMajor.endAt, '本地副本缺 endAt 时保留服务端的结束时间');
});

test('服务端运行期字段：客户端不能把服务端清掉的字段又加回来', () => {
  const cleared = { ...serverMajor, pausedAt: undefined, pausedMs: undefined, archivedAt: undefined };
  const stale = { ...serverMajor, pausedAt: 999, pausedMs: 88888, archivedAt: 777 };
  const [merged] = preserveServerLifecycleFields([cleared], [stale]) as Array<Record<string, unknown>>;
  assert.equal(merged.pausedAt, undefined, '继续考试后不能被旧副本重新置为暂停');
  assert.equal(merged.pausedMs, undefined);
  assert.equal(merged.archivedAt, undefined, '取消归档后不能被旧副本重新归档');
});

test('服务端运行期字段：服务端还不认识的考试原样通过（新建草稿/快速考试）', () => {
  const fresh = { id: 'brand-new', name: '新考试', items: [], publishedAt: 123 };
  const [merged] = preserveServerLifecycleFields([serverMajor], [fresh]) as Array<Record<string, unknown>>;
  assert.deepEqual(merged, fresh);
});

test('服务端 endAt：被后台延长/顺延过之后，陈旧副本不能把它改回去', () => {
  // 服务端：科目窗口 09:00–11:00，后台延长到 11:30
  const server = {
    id: 'major-1',
    name: '大型考试',
    items: [{ id: 'i1', name: '数学', startTime: '2026-08-01T09:00', endTime: '2026-08-01T11:00', enabled: true }],
    endAt: new Date('2026-08-01T11:30').getTime(),
    publishedAt: 1,
  };
  const stale = { ...server, endAt: new Date('2026-08-01T11:00').getTime() };
  const [kept] = preserveServerLifecycleFields([server], [stale]) as Array<Record<string, unknown>>;
  assert.equal(kept.endAt, server.endAt, '陈旧副本不能把延长冲掉');

  // 这一次提交改了科目时间：说明用户在重排，按客户端提交的窗口来
  const rescheduled = {
    ...server,
    items: [{ id: 'i1', name: '数学', startTime: '2026-08-01T09:00', endTime: '2026-08-01T10:30', enabled: true }],
    endAt: new Date('2026-08-01T10:30').getTime(),
  };
  const [accepted] = preserveServerLifecycleFields([server], [rescheduled]) as Array<Record<string, unknown>>;
  assert.equal(accepted.endAt, rescheduled.endAt);
});

test('服务端 endAt：没被延长过时，客户端照常可以写窗口（新建考试）', () => {
  const server = {
    id: 'major-1',
    name: '大型考试',
    items: [{ id: 'i1', name: '数学', startTime: '2026-08-01T09:00', endTime: '2026-08-01T11:00', enabled: true }],
    endAt: null,
  };
  const submitted = { ...server, endAt: new Date('2026-08-01T11:00').getTime() };
  const [merged] = preserveServerLifecycleFields([server], [submitted]) as Array<Record<string, unknown>>;
  assert.equal(merged.endAt, submitted.endAt);
});
