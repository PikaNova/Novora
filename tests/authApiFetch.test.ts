/**
 * apiFetch / authHeaders（src/services/auth/）的行为钉子。
 *
 * 这里只钉两件容易改坏的事：①带会话的请求自动补 Authorization；②带着令牌却被回 401 时
 * 清掉会话（而没带令牌的 401 不许误伤）；另外锁住 authHeaders(extra) 的契约——
 * 没登录时 extra 也必须照样带出去（幂等键曾经因为这条被吞掉过）。
 */
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
  __BUILD_TIME__?: string;
};
testGlobals.localStorage = new MemoryStorage();
testGlobals.__APP_VERSION__ = 'test';
testGlobals.__COMMIT_SHA__ = 'test';
testGlobals.__BUILD_TIME__ = new Date(0).toISOString();

const session = await import('../src/services/auth/session.js');
const { apiFetch } = await import('../src/services/auth/client.js');

const originalFetch = globalThis.fetch;
const FUTURE = () => Date.now() + 60_000;

function authorizationOf(init: RequestInit | undefined): string {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers.Authorization ?? '';
}

test('authHeaders 带会话时补 Authorization，并把 extra 一起带出', () => {
  session.clearAuthSession();
  assert.deepEqual(session.authHeaders(), {});
  assert.deepEqual(session.authHeaders({ 'Idempotency-Key': 'k1' }), { 'Idempotency-Key': 'k1' });

  session.storeAuthSession('token-abc', FUTURE(), null);
  assert.equal(session.authHeaders()['Authorization'], 'Bearer token-abc');
});

test('apiFetch 自动补 Authorization', async () => {
  session.storeAuthSession('token-abc', FUTURE(), null);
  let seen = '';
  testGlobals.fetch = async (_url, init) => {
    seen = authorizationOf(init);
    return new Response('{}', { status: 200 });
  };
  try {
    await apiFetch('/api/exams?action=dashboard');
    assert.equal(seen, 'Bearer token-abc');
  } finally {
    testGlobals.fetch = originalFetch;
  }
});

test('带着令牌却被回 401 时清掉会话', async () => {
  session.storeAuthSession('token-abc', FUTURE(), null);
  testGlobals.fetch = async () => new Response('{}', { status: 401 });
  try {
    const response = await apiFetch('/api/exams');
    assert.equal(response.status, 401);
    assert.equal(session.getAuthToken(), '', '凭据失效必须清会话');
  } finally {
    testGlobals.fetch = originalFetch;
  }
});

test('本来就没会话时，401 不误伤也不会带 Authorization', async () => {
  session.clearAuthSession();
  let seen = 'sentinel';
  testGlobals.fetch = async (_url, init) => {
    seen = authorizationOf(init);
    return new Response('{}', { status: 401 });
  };
  try {
    await apiFetch('/api/public-read');
    assert.equal(seen, '', '没有会话时不该带 Authorization');
    assert.equal(session.getAuthToken(), '');
  } finally {
    testGlobals.fetch = originalFetch;
  }
});

test('过期的本地会话视为无效并清掉', () => {
  session.storeAuthSession('token-abc', Date.now() - 1_000, null);
  assert.equal(session.hasValidLocalSession(), false);
  assert.equal(session.getAuthToken(), '');
});
