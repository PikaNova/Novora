import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  get length(): number { return this.values.size; }
}

(globalThis as any).localStorage = new MemoryStorage();
(globalThis as any).__APP_VERSION__ = "test";
(globalThis as any).__COMMIT_SHA__ = "test";

const { revokeDevice } = await import("../src/services/classBinding.js");
const { __resetSyncQueueForTests } = await import("../src/services/syncQueue.js");

function rateLimitedResponse(): Response {
  return new Response(JSON.stringify({
    code: "RATE_LIMITED",
    error: "Another device is saving.",
    retryable: true,
  }), { status: 429, headers: { "Content-Type": "application/json" } });
}

test("device writes retry once after RATE_LIMITED", async () => {
  __resetSyncQueueForTests();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    calls += 1;
    return calls === 1
      ? rateLimitedResponse()
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    await assert.doesNotReject(() => revokeDevice("device-1"));
    assert.equal(calls, 2);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test("device writes keep the server message after a second RATE_LIMITED", async () => {
  __resetSyncQueueForTests();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    calls += 1;
    return rateLimitedResponse();
  };

  try {
    await assert.rejects(() => revokeDevice("device-1"), /Another device is saving/);
    assert.equal(calls, 2);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});
