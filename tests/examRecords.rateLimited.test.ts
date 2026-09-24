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
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  get length(): number {
    return this.values.size;
  }
}

const testGlobals = globalThis as typeof globalThis & {
  localStorage?: MemoryStorage;
  fetch?: typeof fetch;
  __APP_VERSION__?: string;
  __COMMIT_SHA__?: string;
};
testGlobals.localStorage = new MemoryStorage();
testGlobals.__APP_VERSION__ = 'test';
testGlobals.__COMMIT_SHA__ = 'test';

const { runExamRecordAction } = await import('../src/services/examRecords.js');

/**
 * 服务端全局写槽繁忙时的应答：429 + Retry-After。
 * 带一个很小的 retryAfterMs，让用例不必真的等一秒。
 */
function rateLimitedResponse(retryAfterMs: number): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      code: 'RATE_LIMITED',
      error: '其他设备正在保存数据，系统将很快自动重试。',
      retryable: true,
      retryAfterMs,
    }),
    { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterMs / 1_000) } },
  );
}

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function idempotencyKeyOf(init: RequestInit | undefined): string {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers['Idempotency-Key'] ?? '';
}

// 「保存并发布」是连写：保存占用写槽后，紧接着的发布请求会拿到 429。
// 客户端必须照服务端提示自动重试，而不是把失败直接抛给用户。
test('考试动作被写槽挡掉后自动重试并成功', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  testGlobals.fetch = async () => {
    calls += 1;
    return calls === 1 ? rateLimitedResponse(5) : okResponse();
  };

  try {
    const result = await runExamRecordAction({ id: 'exam-1', action: 'publish' });
    assert.equal(result.idempotent, false);
    assert.equal(calls, 2);
  } finally {
    testGlobals.fetch = originalFetch;
  }
});

// 重试同一次动作必须复用幂等键，否则第二次真的会再执行一遍（延长两倍时长、复制出两场考试）。
test('自动重试沿用同一个幂等键', async () => {
  const originalFetch = globalThis.fetch;
  const keys: string[] = [];
  let calls = 0;
  testGlobals.fetch = async (_url, init) => {
    calls += 1;
    keys.push(idempotencyKeyOf(init));
    return calls === 1 ? rateLimitedResponse(5) : okResponse();
  };

  try {
    await runExamRecordAction({ id: 'exam-1', action: 'extend', minutes: 10 });
    assert.equal(calls, 2);
    assert.ok(keys[0], 'extend 必须带幂等键');
    assert.equal(keys[1], keys[0]);
  } finally {
    testGlobals.fetch = originalFetch;
  }
});

// 写槽一直被别的写请求占着时，重试到上限就把服务端的原因交回调用方展示。
test('重试超过上限后抛出服务端的限流原因', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  testGlobals.fetch = async () => {
    calls += 1;
    return rateLimitedResponse(5);
  };

  try {
    await assert.rejects(
      () => runExamRecordAction({ id: 'exam-1', action: 'publish' }),
      (error: { code?: string; message?: string }) => {
        assert.equal(error.code, 'RATE_LIMITED');
        assert.match(String(error.message), /正在保存数据/);
        return true;
      },
    );
    assert.equal(calls, 4);
  } finally {
    testGlobals.fetch = originalFetch;
  }
});
