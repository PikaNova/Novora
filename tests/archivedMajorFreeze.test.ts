import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeArchivedMajors } from '../api/_exams/permissions.js';
import type { ExamPayload } from '../api/_exams/payload.js';
import { parseExamPayload } from '../src/shared/examContracts.js';
import { normalizeExam } from '../src/utils/appSettings.js';

function current(majors: Array<Record<string, unknown>>): ExamPayload {
  return { majors } as unknown as ExamPayload;
}

const archivedMajor = {
  id: 'archived-1',
  name: '归档考试',
  items: [],
  order: 0,
  source: 'regular',
  archivedAt: 1_700_000_000_000,
};

const liveMajor = { id: 'live-1', name: '进行中考试', items: [], order: 1, source: 'regular' };

function idsOf(body: Record<string, unknown>): string[] {
  const majors = Array.isArray(body.majors) ? (body.majors as Array<Record<string, unknown>>) : [];
  return majors.map((major) => String(major.id));
}

test('freezeArchivedMajors: 已归档考试的修改被回退到服务端版本', () => {
  const result = freezeArchivedMajors(current([archivedMajor, liveMajor]), {
    majors: [{ ...archivedMajor, name: '被改名的归档考试' }, liveMajor],
  });
  assert.deepEqual(result.frozenIds, ['archived-1']);
  // 冻结条目要连同服务端版本回传：客户端据此把本地副本纠回来，否则会出现
  // 「本机显示改好了/删掉了，刷新又变回来」。
  assert.deepEqual(result.frozenMajors, [archivedMajor]);
  const majors = result.body.majors as Array<Record<string, unknown>>;
  assert.equal(majors[0].name, '归档考试', '归档条目必须回退');
  assert.equal(majors[1].name, '进行中考试');
});

test('freezeArchivedMajors: 未归档考试照常保存，冻结列表为空', () => {
  const result = freezeArchivedMajors(current([archivedMajor, liveMajor]), {
    majors: [{ ...archivedMajor }, { ...liveMajor, name: '改过名字的正式考试' }],
  });
  assert.deepEqual(result.frozenIds, []);
  assert.deepEqual(result.frozenMajors, []);
  const majors = result.body.majors as Array<Record<string, unknown>>;
  assert.equal(majors[0].name, '归档考试');
  assert.equal(majors[1].name, '改过名字的正式考试');
});

test('freezeArchivedMajors: 原样提交（outbox 重放）不会被标记为冻结', () => {
  const result = freezeArchivedMajors(current([archivedMajor]), {
    majors: [{ ...archivedMajor }],
  });
  assert.deepEqual(result.frozenIds, []);
  assert.deepEqual(idsOf(result.body), ['archived-1']);
});

test('freezeArchivedMajors: 只有排序字段变了不算"被改过"（前端每次保存都会重排 order）', () => {
  const withItems = {
    ...archivedMajor,
    order: 4,
    items: [
      { id: 'i1', name: '数学', startTime: '2026-06-07T09:00', endTime: '2026-06-07T11:00', enabled: true, order: 0 },
      { id: 'i2', name: '语文', startTime: '2026-06-07T14:00', endTime: '2026-06-07T16:00', enabled: true, order: 1 },
    ],
  };
  const resorted = {
    ...withItems,
    order: 5,
    items: withItems.items.map((item, index) => ({ ...item, order: index + 1 })),
  };
  const result = freezeArchivedMajors(current([withItems]), { majors: [resorted] });
  assert.deepEqual(result.frozenIds, [], '纯排序变化（新增/删除别的考试导致的重新编号）不该报成"已归档：修改没有生效"');
  assert.deepEqual(result.frozenMajors, []);
});

test('freezeArchivedMajors: 真正的内容改动仍然被拦下（改名 / 删科目）', () => {
  const renamed = freezeArchivedMajors(current([archivedMajor]), {
    majors: [{ ...archivedMajor, name: '改过的名字' }],
  });
  assert.deepEqual(renamed.frozenIds, ['archived-1']);

  const withItems = {
    ...archivedMajor,
    items: [
      { id: 'i1', name: '数学', startTime: '2026-06-07T09:00', endTime: '2026-06-07T11:00', enabled: true, order: 0 },
      { id: 'i2', name: '语文', startTime: '2026-06-07T14:00', endTime: '2026-06-07T16:00', enabled: true, order: 1 },
    ],
  };
  const trimmed = freezeArchivedMajors(current([withItems]), {
    majors: [{ ...withItems, items: [withItems.items[0]] }],
  });
  assert.deepEqual(trimmed.frozenIds, ['archived-1'], '删掉科目仍是真实改动');
});

test('freezeArchivedMajors: 归档考试被移出快照时会被补回', () => {
  const result = freezeArchivedMajors(current([archivedMajor, liveMajor]), {
    majors: [liveMajor],
  });
  assert.deepEqual(result.frozenIds, ['archived-1']);
  // 「本地删了、服务端仍在」这条路径同样要把服务端版本带回去，客户端才能提示 + 回灌。
  assert.deepEqual(result.frozenMajors, [archivedMajor]);
  assert.deepEqual(idsOf(result.body).sort(), ['archived-1', 'live-1']);
});

test('freezeArchivedMajors: 没有归档考试或没有 majors 字段时原样返回', () => {
  const untouched = { majors: [{ ...liveMajor, name: '改名' }] };
  assert.deepEqual(freezeArchivedMajors(current([liveMajor]), untouched), {
    body: untouched,
    frozenIds: [],
    frozenMajors: [],
  });
  const noMajors = { items: [] };
  assert.deepEqual(freezeArchivedMajors(current([archivedMajor]), noMajors), {
    body: noMajors,
    frozenIds: [],
    frozenMajors: [],
  });
});

/**
 * 端到端回归：服务端快照 → 客户端解析/规范化 → 原样推回。
 *
 * 这就是用户看到的「编辑考试时经常回报：已归档：这次修改没有生效」。它由两处叠加造成：
 *   1. 客户端 normalizeExam 用固定字段表重建 major，把 archivedAt / pausedAt / pausedMs /
 *      endAt / actualStartAt… 丢掉，推回来时归档考试看起来"被改过"；
 *   2. 服务端用整对象深比较，连 order 重编号都算改动。
 * 这条用例把两步串起来跑，任何一步退回去都会红。
 */
test('freezeArchivedMajors: 客户端解析+规范化后原样推回不会被判成"已归档被改过"', () => {
  const storedArchived = {
    id: 'archived-rt',
    name: '已结束的周测',
    order: 3,
    source: 'regular',
    temporary: false,
    priorityOverSchedule: false,
    targetGradeIds: ['g1'],
    targetClassIds: [],
    createdAt: 1_700_000_000_000,
    createdBy: 1,
    startAt: 1_700_000_000_000,
    endAt: 1_700_003_600_000,
    actualStartAt: 1_700_000_060_000,
    actualEndAt: 1_700_003_300_000,
    publishedAt: 1_699_999_000_000,
    pausedAt: null,
    pausedMs: 0,
    endedAt: 1_700_003_300_000,
    archivedAt: 1_700_010_000_000,
    items: [
      { id: 'i1', name: '数学', startTime: '2026-06-07T09:00', endTime: '2026-06-07T11:00', enabled: true, order: 0 },
      { id: 'i2', name: '语文', startTime: '2026-06-07T14:00', endTime: '2026-06-07T16:00', enabled: true, order: 1 },
    ],
  };
  const storedLive = { id: 'live-rt', name: '进行中考试', order: 4, source: 'regular', items: [] };
  const serverBody = { majors: [storedArchived, storedLive] };

  // 1) 客户端拿到服务端快照（形状由 parseExamPayload 决定）
  const parsed = parseExamPayload(serverBody);
  // 2) 读写设置时都会走 normalizeExam，再整份推回服务端
  const clientMajors = normalizeExam({ majors: parsed.majors }).majors;

  const result = freezeArchivedMajors(current(serverBody.majors), { majors: clientMajors });
  assert.deepEqual(result.frozenIds, [], '原样推回不该被报成"已归档：这次修改没有生效"');
  assert.deepEqual(result.frozenMajors, []);
  const majors = result.body.majors as Array<Record<string, unknown>>;
  assert.equal(majors[0].archivedAt, storedArchived.archivedAt, '归档标记必须还在');
  assert.equal(majors[0].endedAt, storedArchived.endedAt, '结束时间必须还在');

  // 反向对照：旧 normalizeExam 会把这些字段丢掉，那种提交必须仍然被拦下
  // （否则这条回归用例只是"永远绿"，没有区分能力）。
  const stripped = clientMajors.map((major) => {
    const {
      archivedAt: _archivedAt,
      pausedAt: _pausedAt,
      pausedMs: _pausedMs,
      startAt: _startAt,
      endAt: _endAt,
      actualStartAt: _actualStartAt,
      actualEndAt: _actualEndAt,
      ...rest
    } = major as unknown as Record<string, unknown>;
    return rest;
  });
  assert.deepEqual(
    freezeArchivedMajors(current(serverBody.majors), { majors: stripped }).frozenIds,
    ['archived-rt'],
    '丢掉生命周期字段的提交必须被判成真实改动',
  );
});
