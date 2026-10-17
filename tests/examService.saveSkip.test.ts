import assert from 'node:assert/strict';
import test from 'node:test';
// 先装浏览器常量/存储，再引服务（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';
import { AUTH_TOKEN_KEY } from '../src/services/auth/session.js';
import { getLastExamSaveSummary, saveExamsToServer } from '../src/services/examService.js';
import { __resetSyncQueueForTests } from '../src/services/syncQueue.js';
import type { MajorExam } from '../src/types/index.js';

/**
 * 「同一份内容不要重复推」的**安全口径**：只与**服务端基线**逐域比对。
 *
 * 反例说明为什么要谨慎：曾经试过一版「按内容指纹在若干秒内不再推」，结果把
 * outbox 重放、冲突重试、归档冻结回灌这几条**必须重推**的路径一起挡掉了
 * （`tests/examOutbox.pipeline.test.ts`、`tests/examFrozenArchivedMajors.test.ts` 立刻报红）。
 * 所以这里锁住现在这条口径：能逐域比对且确实没变，才不发请求。
 */

/**
 * 形状按「客户端归一化后」的 major 写：服务端基线快照会被 parseExamPayload 归一化，
 * 缺字段的裸 fixture 会与基线判成"不一样"，那样测的就不是去重而是字段补全。
 */
const major = {
  id: 'm1',
  name: '大型考试',
  items: [],
  order: 0,
  source: 'regular',
  targetGradeIds: [],
  targetClassIds: [],
  temporary: false,
  priorityOverSchedule: false,
  endedAt: null,
} as unknown as MajorExam;
const payload = { items: [], title: '测试1', majors: [major], activeMajorId: 'm1', alerts: null };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const ORIGINAL_FETCH = globalThis.fetch;

test('与基线逐域一致：不发请求，按"已保存"记账', async () => {
  localStorage.clear();
  localStorage.setItem(AUTH_TOKEN_KEY, 'test-token');
  __resetSyncQueueForTests();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse({ ok: true, updatedAt: 100 + calls, revisions: { major: calls, alerts: calls } });
  }) as typeof fetch;
  try {
    const updatedAt = await saveExamsToServer(payload);
    assert.equal(calls, 1, '第一次照常提交');
    assert.equal(getLastExamSaveSummary()?.skipped, false);

    // 同一份内容、同一个基线版本：服务端那份就是它，没必要再推一次。
    const again = await saveExamsToServer({ ...payload, baseUpdatedAt: Number(updatedAt) as number });
    assert.equal(calls, 1, '同内容同基线不该再发请求');
    assert.equal(getLastExamSaveSummary()?.skipped, true);
    assert.deepEqual(getLastExamSaveSummary()?.domains, []);
    assert.equal(again, updatedAt, '按已保存处理，返回同一个版本号');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    __resetSyncQueueForTests();
  }
});

test('有一域变了：只提交那一域（仍然只发一次请求）', async () => {
  localStorage.clear();
  localStorage.setItem(AUTH_TOKEN_KEY, 'test-token');
  __resetSyncQueueForTests();
  const bodies: Array<Record<string, unknown>> = [];
  let calls = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return jsonResponse({ ok: true, updatedAt: 100 + calls, revisions: { major: calls, alerts: calls } });
  }) as typeof fetch;
  try {
    const updatedAt = await saveExamsToServer(payload);
    const renamed = { ...payload, majors: [{ ...major, name: '改过名字' } as MajorExam] };
    await saveExamsToServer({ ...renamed, baseUpdatedAt: Number(updatedAt) as number });
    assert.equal(calls, 2);
    assert.deepEqual(getLastExamSaveSummary()?.domains?.sort(), ['activeMajorId', 'items', 'majors', 'title']);
    assert.deepEqual(Object.keys(bodies[1] ?? {}).sort(), [
      'activeMajorId',
      'baseRevisions',
      'baseUpdatedAt',
      'items',
      'majors',
      'title',
    ]);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    __resetSyncQueueForTests();
  }
});
