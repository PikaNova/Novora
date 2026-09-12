import assert from 'node:assert/strict';
import test from 'node:test';

// The diagnostic log section talks to permission-protected endpoints, so every request must
// carry the same admin bearer token as the rest of the admin API. These tests pin that contract:
// a regression here surfaces in the UI as "登录状态已失效" even while the session is still valid.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

const testGlobals = globalThis as unknown as {
  localStorage: MemoryStorage;
  window: { localStorage: MemoryStorage };
  fetch: typeof fetch;
  __APP_VERSION__: string;
  __COMMIT_SHA__: string;
};

const storage = new MemoryStorage();
testGlobals.localStorage = storage;
testGlobals.window = { localStorage: storage };
testGlobals.__APP_VERSION__ = 'test';
testGlobals.__COMMIT_SHA__ = 'test';

const { loadDiagnosticSettings, saveDiagnosticSettings, sendDiagnosticLogs } =
  await import('../src/services/diagnosticLogs.js');

type CapturedRequest = { url: string; authorization: string | null };

function stubFetch(payload: Record<string, unknown>): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  testGlobals.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured.push({ url: String(input), authorization: headers.get('authorization') });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return captured;
}

function loginAs(token: string): void {
  storage.clear();
  storage.setItem('admin_auth_token', token);
}

test('manual diagnostic upload carries the admin bearer token', async () => {
  loginAs('token-under-test');
  const originalFetch = globalThis.fetch;
  const captured = stubFetch({ ok: true, bundleId: 'bundle-1', status: 'sent' });
  try {
    await sendDiagnosticLogs({ mode: 'date', fromTs: 1, toTs: 2, entries: [] });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, '/api/diagnostic-logs');
    assert.equal(captured[0].authorization, 'Bearer token-under-test');
  } finally {
    testGlobals.fetch = originalFetch;
  }
});

test('diagnostic settings reads and writes carry the admin bearer token', async () => {
  loginAs('settings-token');
  const originalFetch = globalThis.fetch;
  const captured = stubFetch({ ok: true, settings: {} });
  try {
    await loadDiagnosticSettings();
    await saveDiagnosticSettings({ captureOnError: true, beforeSeconds: 60, afterSeconds: 30, retentionDays: 7 });
    assert.equal(captured.length, 2);
    for (const request of captured) {
      assert.equal(request.url, '/api/diagnostic-logs?resource=settings');
      assert.equal(request.authorization, 'Bearer settings-token');
    }
  } finally {
    testGlobals.fetch = originalFetch;
  }
});
