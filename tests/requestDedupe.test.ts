import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * fetchWithTimeout 会经过 diagnostics → telemetry，而 telemetry 在模块顶层读
 * Vite 注入的 __APP_VERSION__。测试里必须先把这些全局补齐，再动态导入被测模块
 * （仓库现有测试用的是同一套写法）。
 */
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
  __APP_VERSION__?: string;
  __COMMIT_SHA__?: string;
};
testGlobals.localStorage ??= new MemoryStorage();
testGlobals.__APP_VERSION__ = '2.8.0';
testGlobals.__COMMIT_SHA__ = 'test-sha';
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: testGlobals.localStorage,
    setTimeout: (handler: () => void, delay?: number) => setTimeout(handler, delay),
    clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout),
    addEventListener: () => {},
    matchMedia: () => ({ matches: false }),
  },
  configurable: true,
});

const { clearRequestDedupe, fetchWithTimeout } = await import('../src/services/fetchWithTimeout.js');

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('request dedupe: 并发相同 GET 只发一次，且每个等待者都能读到 body', async () => {
  clearRequestDedupe();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { calls, restore } = installFetch(async () => {
    await gate;
    return jsonResponse({ ok: true, n: 1 });
  });
  try {
    const pending = Array.from({ length: 4 }, () =>
      fetchWithTimeout('/api/exams?resource=records&page=1&pageSize=100'),
    );
    release();
    const responses = await Promise.all(pending);
    assert.equal(calls.length, 1, '四个并发相同 GET 只应该打一次网络');
    const bodies = await Promise.all(responses.map((response) => response.json()));
    for (const body of bodies) assert.deepEqual(body, { ok: true, n: 1 });
  } finally {
    restore();
    clearRequestDedupe();
  }
});

test('request dedupe: 不同 URL 或不同鉴权不合并', async () => {
  clearRequestDedupe();
  const { calls, restore } = installFetch(async () => jsonResponse({ ok: true }));
  try {
    await Promise.all([
      fetchWithTimeout('/api/exams?a=1', { headers: { authorization: 'Bearer admin-token' } }),
      fetchWithTimeout('/api/exams?a=2', { headers: { authorization: 'Bearer admin-token' } }),
      fetchWithTimeout('/api/exams?a=1', { headers: { authorization: 'Bearer device-token' } }),
    ]);
    assert.equal(calls.length, 3, 'URL 或身份不同必须各发一次');
  } finally {
    restore();
    clearRequestDedupe();
  }
});

test('request dedupe: 写请求永不被合并', async () => {
  clearRequestDedupe();
  const { calls, restore } = installFetch(async () => jsonResponse({ ok: true }));
  try {
    await Promise.all(
      Array.from({ length: 4 }, () => fetchWithTimeout('/api/exams', { method: 'POST', body: '{}' }, 20_000)),
    );
    assert.equal(calls.length, 4, 'POST 必须每次真发');
  } finally {
    restore();
    clearRequestDedupe();
  }
});

test('request dedupe: 失败整批共享错误，且不会把失败结果留在窗口里', async () => {
  clearRequestDedupe();
  let attempt = 0;
  const { calls, restore } = installFetch(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('boom');
    return jsonResponse({ ok: true, attempt });
  });
  try {
    const first = await Promise.allSettled([
      fetchWithTimeout('/api/exams?resource=records&page=1', {}, 5_000),
      fetchWithTimeout('/api/exams?resource=records&page=1', {}, 5_000),
    ]);
    assert.equal(calls.length, 1, '并发失败也只发一次');
    assert.equal(first.filter((item) => item.status === 'rejected').length, 2, '等待者都要拿到失败');

    // 失败不保留：下一次必须重新发。
    const retry = await fetchWithTimeout('/api/exams?resource=records&page=1', {}, 5_000);
    assert.equal(retry.status, 200);
    assert.equal(calls.length, 2, '失败的批次不能被复用');
  } finally {
    restore();
    clearRequestDedupe();
  }
});

test('request dedupe: 显式关闭合并不生效', async () => {
  clearRequestDedupe();
  const { calls, restore } = installFetch(async () => jsonResponse({ ok: true }));
  try {
    await Promise.all([
      fetchWithTimeout('/api/time', { dedupe: false }),
      fetchWithTimeout('/api/time', { dedupe: false }),
      fetchWithTimeout('/api/time', { dedupe: false }),
    ]);
    assert.equal(calls.length, 3, '校时这类需要多个独立样本的请求要显式关闭合并');
  } finally {
    restore();
    clearRequestDedupe();
  }
});

test('request dedupe: dedupeWindowMs 内复用结果，窗口过后重新发', async () => {
  clearRequestDedupe();
  const { calls, restore } = installFetch(async () => jsonResponse({ ok: true }));
  try {
    await fetchWithTimeout('/api/exams?resource=records&page=1', { dedupeWindowMs: 120 });
    await fetchWithTimeout('/api/exams?resource=records&page=1', { dedupeWindowMs: 120 });
    assert.equal(calls.length, 1, '窗口内的第二次调用应该复用');

    await new Promise((resolve) => setTimeout(resolve, 200));
    await fetchWithTimeout('/api/exams?resource=records&page=1', { dedupeWindowMs: 120 });
    assert.equal(calls.length, 2, '窗口过后必须重新发');
  } finally {
    restore();
    clearRequestDedupe();
  }
});
