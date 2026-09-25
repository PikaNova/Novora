import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
  get length(): number {
    return this.values.size;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
}

const testGlobals = globalThis as typeof globalThis & {
  localStorage?: MemoryStorage;
  navigator?: { onLine: boolean };
  fetch?: typeof fetch;
  __APP_VERSION__?: string;
  __COMMIT_SHA__?: string;
};
testGlobals.localStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
testGlobals.__APP_VERSION__ = 'test';
testGlobals.__COMMIT_SHA__ = 'test';

const {
  fetchExamsFromServer,
  invalidateExamSnapshotReuse,
  __resetSnapshotFlightForTests,
  __setSnapshotReuseWindowForTests,
} = await import('../src/services/examService.js');

type RecordedCall = { url: string; init?: RequestInit };

function installFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function snapshotResponse(title: string): Response {
  return new Response(JSON.stringify({ ok: true, title, majors: [], items: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json', ETag: '"etag-1"' },
  });
}

test('快照单飞：并发调用只发一次网络，且都拿到同一份结果', async () => {
  testGlobals.localStorage?.clear();
  __resetSnapshotFlightForTests();
  const { calls, restore } = installFetch(async () => snapshotResponse('并发快照'));
  try {
    const results = await Promise.all([
      fetchExamsFromServer(),
      fetchExamsFromServer(),
      fetchExamsFromServer(),
      fetchExamsFromServer(),
    ]);
    assert.equal(calls.length, 1, '四个并发调用只应该打一次网络');
    for (const payload of results) assert.equal(payload?.title, '并发快照');
  } finally {
    restore();
  }
});

test('快照单飞：304 之后的完整回读也只发一次', async () => {
  testGlobals.localStorage?.clear();
  __resetSnapshotFlightForTests();
  let round = 0;
  const { calls, restore } = installFetch(async () => {
    round += 1;
    // 第一次条件请求返回 304，本地又没有缓存快照 → 必须回读一次完整快照。
    if (round === 1) return new Response(null, { status: 304 });
    return snapshotResponse('完整快照');
  });
  try {
    const results = await Promise.all([fetchExamsFromServer(), fetchExamsFromServer(), fetchExamsFromServer()]);
    assert.equal(calls.length, 2, '条件请求 + 一次完整回读，而不是每个调用方各来一遍');
    for (const payload of results) assert.equal(payload?.title, '完整快照');
  } finally {
    restore();
  }
});

test('快照单飞：bootstrap 带设备身份，不与普通快照合并', async () => {
  testGlobals.localStorage?.clear();
  __resetSnapshotFlightForTests();
  const { calls, restore } = installFetch(async () => snapshotResponse('快照'));
  try {
    await Promise.all([fetchExamsFromServer(), fetchExamsFromServer('instance-1')]);
    assert.equal(calls.length, 2, 'bootstrap 有自己的身份与 URL，必须单独发');
    assert.ok(
      calls.some((call) => call.url.includes('action=bootstrap')),
      'bootstrap 请求要真的发出去',
    );
  } finally {
    restore();
  }
});

test('快照单飞：共享的是「在途」而不是缓存，结束后的新调用照常发', async () => {
  testGlobals.localStorage?.clear();
  __resetSnapshotFlightForTests();
  __setSnapshotReuseWindowForTests(0);
  const { calls, restore } = installFetch(async () => snapshotResponse('快照'));
  try {
    await fetchExamsFromServer();
    await fetchExamsFromServer();
    assert.equal(calls.length, 2, '单飞不能变成缓存，后续调用必须重新取');
  } finally {
    restore();
    __setSnapshotReuseWindowForTests(1_000);
  }
});

test('快照复用窗口：窗口内的错峰调用不再发条件请求', async () => {
  testGlobals.localStorage?.clear();
  __resetSnapshotFlightForTests();
  __setSnapshotReuseWindowForTests(500);
  const { calls, restore } = installFetch(async () => snapshotResponse('窗口快照'));
  try {
    const first = await fetchExamsFromServer();
    const second = await fetchExamsFromServer();
    assert.equal(calls.length, 1, '窗口内应该复用刚取到的快照');
    assert.equal(first?.title, '窗口快照');
    assert.equal(second?.title, '窗口快照');
  } finally {
    restore();
    __setSnapshotReuseWindowForTests(1_000);
  }
});

test('快照复用窗口：窗口过期照常重取，写入会立刻作废窗口', async () => {
  testGlobals.localStorage?.clear();
  __resetSnapshotFlightForTests();
  __setSnapshotReuseWindowForTests(60);
  const { calls, restore } = installFetch(async () => snapshotResponse('快照'));
  try {
    await fetchExamsFromServer();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await fetchExamsFromServer();
    assert.equal(calls.length, 2, '窗口过期后必须重新取');

    // 写入路径会调用它；作废之后即使还在窗口内也要重新取。
    invalidateExamSnapshotReuse();
    await fetchExamsFromServer();
    assert.equal(calls.length, 3, '写入后不能复用写之前的快照');
  } finally {
    restore();
    __setSnapshotReuseWindowForTests(1_000);
  }
});
