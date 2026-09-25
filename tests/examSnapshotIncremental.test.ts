import assert from 'node:assert/strict';
import test from 'node:test';
// 先装浏览器常量/存储，再引服务（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';
import { AUTH_TOKEN_KEY } from '../src/services/auth/session.js';
import {
  __resetSnapshotFlightForTests,
  __setSnapshotReuseWindowForTests,
  fetchExamsFromServer,
} from '../src/services/examService.js';
import { EXAM_REVISION_DOMAINS } from '../src/shared/examSaveDiff.js';

/**
 * 增量读：整份快照 ~135KB，改一个域也会让文档版本前进，客户端随即重下整份。
 * 现在客户端带着「我手上各域的修订号」去问，服务端只回真的变了的域，
 * 客户端与本地缓存叠加——这一组用例锁住「问了什么」和「叠加结果对不对」。
 */

const REVISIONS = {
  major: 5,
  alerts: 1,
  weekly: 1,
  schedule: 1,
  grades: 1,
  classes: 1,
  initialization: 1,
};

function fullPayload(updatedAt = 100, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    items: [{ id: 'i1', name: '数学' }],
    title: '测试',
    majors: [{ id: 'm1', name: '大型考试' }],
    activeMajorId: 'm1',
    alerts: { enabled: true, updatedAt: 1 },
    weeklyPlans: [],
    scheduleMode: 'major-only',
    activeWeeklyPlanId: '',
    activeWeeklyPlanIdByClassId: { c1: null },
    weeklyConflictPolicy: { mode: 'auto' },
    grades: [{ id: 'g1', name: '高一' }],
    classes: [{ id: 'c1', gradeId: 'g1', name: '高一1班' }],
    initialization: { completedAt: 1 },
    designPolicy: { mode: 'standard' },
    majorBatchPresets: { subjectGroups: [] },
    metadata: {},
    lifecycle: { quiet: false },
    revisions: { ...REVISIONS },
    updatedAt,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.etag ? { ETag: init.etag } : {}) },
  });
}

function signIn(): void {
  localStorage.setItem(AUTH_TOKEN_KEY, 'test-token');
}

const ORIGINAL_FETCH = globalThis.fetch;

test('首次读取没有缓存：整份拉取，不走增量', async () => {
  signIn();
  localStorage.clear();
  __resetSnapshotFlightForTests();
  __setSnapshotReuseWindowForTests(0);
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return jsonResponse(fullPayload());
  }) as typeof fetch;
  try {
    const payload = await fetchExamsFromServer();
    assert.equal(payload?.classes?.length, 1);
    assert.equal(urls.length, 1);
    assert.equal(urls[0].includes('since='), false, '没有缓存时不能问增量');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('有完整缓存：带 since 只取变化的域，并与缓存叠加', async () => {
  signIn();
  localStorage.clear();
  __resetSnapshotFlightForTests();
  __setSnapshotReuseWindowForTests(0);
  const urls: string[] = [];
  let call = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    call += 1;
    if (call === 1) return jsonResponse(fullPayload());
    // 第二次：只有 alerts 域变了，服务端按域回增量
    return jsonResponse({
      ok: true,
      partial: true,
      alerts: { enabled: false, updatedAt: 2 },
      revisions: { ...REVISIONS, alerts: 2 },
      updatedAt: 200,
    });
  }) as typeof fetch;

  try {
    await fetchExamsFromServer();
    const merged = await fetchExamsFromServer();
    assert.ok(merged);
    assert.equal(urls.length, 2);
    assert.ok(urls[1].includes('since='), '有缓存时要用增量读');
    const since = JSON.parse(
      decodeURIComponent(new URL(`http://x${urls[1].slice(urls[1].indexOf('/api'))}`).searchParams.get('since') ?? ''),
    ) as Record<string, number>;
    assert.deepEqual(since, REVISIONS, '把本地各域修订号原样带上去');
    assert.equal(merged.alerts?.enabled, false, '变化的域用服务端值');
    assert.equal(merged.classes?.length, 1, '没变的域保持缓存内容（不被空数组覆盖）');
    assert.equal(merged.majors?.length, 1, '科目不在变化域里，仍要保留');
    assert.deepEqual(merged.revisions, { ...REVISIONS, alerts: 2 });
    assert.equal(merged.updatedAt, 200);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('增量响应回来时缓存没了：立刻退一次整份读取，不把半份数据当快照', async () => {
  signIn();
  localStorage.clear();
  __resetSnapshotFlightForTests();
  __setSnapshotReuseWindowForTests(0);
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    if (call === 1) return jsonResponse(fullPayload());
    if (call === 2) {
      // 模拟"读取过程中本地存储被清空"：增量载荷到达时已经没有可叠加的缓存
      localStorage.removeItem('exam_cloud_snapshot');
      return jsonResponse({
        ok: true,
        partial: true,
        alerts: { enabled: false, updatedAt: 2 },
        revisions: { ...REVISIONS, alerts: 2 },
        updatedAt: 200,
      });
    }
    return jsonResponse(fullPayload(300));
  }) as typeof fetch;
  try {
    await fetchExamsFromServer();
    const payload = await fetchExamsFromServer();
    assert.equal(call, 3, '第 3 次是整份重取');
    assert.equal(payload?.updatedAt, 300);
    assert.equal(payload?.classes?.length, 1, '整份重取拿到的仍是完整快照');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('缓存里缺任一域修订号（老缓存）：退回整份，不用增量', async () => {
  signIn();
  localStorage.clear();
  __resetSnapshotFlightForTests();
  __setSnapshotReuseWindowForTests(0);
  const urls: string[] = [];
  let call = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    call += 1;
    if (call === 1) return jsonResponse(fullPayload());
    // 第二次响应故意不带 revisions（模拟老服务端/老缓存），于是缓存不再"完整"
    return jsonResponse(fullPayload(150, { revisions: undefined }));
  }) as typeof fetch;
  try {
    await fetchExamsFromServer();
    await fetchExamsFromServer();
    assert.ok(urls[1].includes('since='), '第二次仍带 since');
    await fetchExamsFromServer();
    assert.equal(urls[2].includes('since='), false, '缓存不再完整后要退回整份读取');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('修订域清单与增量读的覆盖范围一致（拿不到域清单就没法判"这个域没变"）', () => {
  assert.ok(EXAM_REVISION_DOMAINS.length > 0);
  for (const domain of EXAM_REVISION_DOMAINS)
    assert.equal(typeof REVISIONS[domain as keyof typeof REVISIONS], 'number');
});
