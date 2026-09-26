import assert from 'node:assert/strict';
import test from 'node:test';
// 先装浏览器常量/存储，再引服务（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';

const { EXAM_RECORD_STATUS_LABELS } = await import('../src/shared/examRecordContracts.js');
const { fetchExamRecord, fetchExamRecords } = await import('../src/services/examRecords.js');

/**
 * 客户端状态白名单必须跟共享契约一致。
 *
 * 踩过的坑：服务端加了一个客户端白名单里没有的派生状态（历史上是 `stopping`），
 * 于是这类记录在列表里被静默丢掉、详情页直接报「考试详情数据不完整」。
 * 现在的口径：**认不出来的展示状态只回退成持久状态，绝不丢记录**——
 * 服务端将来再加派生状态（或读缓存里留着旧值）也不会重演这个事故。
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function recordRow(overrides: Record<string, unknown>): Record<string, unknown> {
  const now = 1_790_000_000_000;
  return {
    id: 'record-1',
    name: '考试',
    status: 'published',
    displayStatus: 'published',
    items: [],
    itemCount: 1,
    targetGradeIds: [],
    targetClassIds: [],
    source: 'regular',
    temporary: false,
    priorityOverSchedule: false,
    config: {},
    createdBy: 1,
    createdByName: '超管',
    createdAt: now,
    updatedAt: now,
    startAt: now,
    endAt: now + 3_600_000,
    actualStartAt: null,
    actualEndAt: null,
    pausedAt: null,
    pausedMs: 0,
    publishedAt: now,
    endedAt: null,
    archivedAt: null,
    version: 1,
    sortOrder: 0,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

test('考试列表：契约里的每种展示状态都要能解析，一种都不能被静默丢掉', async () => {
  const rows = Object.keys(EXAM_RECORD_STATUS_LABELS).map((displayStatus, index) =>
    recordRow({ id: `record-${displayStatus}`, displayStatus, sortOrder: index }),
  );
  globalThis.fetch = (async () =>
    jsonResponse({ ok: true, data: rows, page: 1, pageSize: 50, total: rows.length, totalPages: 1 })) as typeof fetch;
  try {
    const page = await fetchExamRecords({ page: 1, pageSize: 50 });
    assert.equal(page.data.length, rows.length, '每种展示状态的记录都要保留，不能有丢行');
    assert.deepEqual(
      page.data.map((entry) => entry.displayStatus).sort(),
      rows.map((row) => String(row.displayStatus)).sort(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('考试详情：认不出的展示状态（如旧服务端的 stopping）回退成持久状态，不能报「数据不完整」', async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      ok: true,
      data: recordRow({ id: 'legacy-record', displayStatus: 'stopping' }),
    })) as typeof fetch;
  try {
    const record = await fetchExamRecord('legacy-record');
    assert.equal(record.id, 'legacy-record');
    assert.equal(record.displayStatus, 'published', '认不出来就回退成持久状态');
    assert.equal(record.status, 'published');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('考试详情：服务端返回快照（旧构建没有 resource=record）时给出可读报错', async () => {
  // 这正是线上那次：请求 resource=record，却拿回整份快照。
  globalThis.fetch = (async () =>
    jsonResponse({ ok: true, items: [], title: '', majors: [], activeMajorId: '', updatedAt: 1 })) as typeof fetch;
  try {
    await assert.rejects(
      () => fetchExamRecord('major_missing'),
      (error: { code?: string }) => error.code === 'INVALID_RECORD_PAYLOAD',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
