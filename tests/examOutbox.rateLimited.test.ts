import assert from "node:assert/strict";
import test from "node:test";
import type { PendingExamSync } from "../src/services/examOutbox.js";

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
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true },
  configurable: true,
});
(globalThis as any).__APP_VERSION__ = "test";
(globalThis as any).__COMMIT_SHA__ = "test";

const { queuePendingExamSync, getPendingExamSync, flushPendingExamSync } =
  await import("../src/services/examOutbox.js");
const { __resetSyncQueueForTests } = await import("../src/services/syncQueue.js");

function setTestOwner(): void {
  (globalThis as any).localStorage.setItem("admin_user_context", JSON.stringify({
    id: 1,
    username: "test-admin",
    displayName: "Test admin",
    roleId: "super_admin",
    roleName: "Super admin",
    permissions: ["*"],
    scopes: [{ type: "all", gradeId: "", classId: "" }],
    mustChangePassword: false,
  }));
}

function pending(retryCount?: number): PendingExamSync {
  return {
    payload: { items: [], title: "", majors: [], activeMajorId: "", alerts: null },
    baseSnapshot: null,
    savedAt: Date.now(),
    retryCount,
  };
}

function rateLimitedResponse(): Response {
  return new Response(JSON.stringify({
    code: "RATE_LIMITED",
    error: "Another device is saving.",
    retryable: true,
  }), { status: 429, headers: { "Content-Type": "application/json" } });
}

test("RATE_LIMITED uses a one-second first retry instead of the normal server delay", async () => {
  __resetSyncQueueForTests();
  (globalThis as any).localStorage.clear();
  setTestOwner();
  queuePendingExamSync(pending());
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => rateLimitedResponse();

  try {
    const before = Date.now();
    assert.equal((await flushPendingExamSync()).kind, "error");
    const saved = getPendingExamSync();
    assert.ok(saved);
    assert.equal(saved.retryCount, 1);
    const delay = (saved.nextRetryAt ?? 0) - before;
    assert.ok(delay > 0 && delay <= 1_200, `expected about 1s, got ${delay}ms`);
  } finally {
    (globalThis as any).fetch = originalFetch;
    (globalThis as any).localStorage.clear();
  }
});

test("RATE_LIMITED retry growth is capped at eight seconds", async () => {
  __resetSyncQueueForTests();
  (globalThis as any).localStorage.clear();
  setTestOwner();
  queuePendingExamSync(pending(3));
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => rateLimitedResponse();

  try {
    const before = Date.now();
    await flushPendingExamSync();
    const saved = getPendingExamSync();
    assert.ok(saved);
    assert.equal(saved.retryCount, 4);
    const delay = (saved.nextRetryAt ?? 0) - before;
    assert.ok(delay > 6_000 && delay <= 8_200, `expected 8s cap, got ${delay}ms`);
  } finally {
    (globalThis as any).fetch = originalFetch;
    (globalThis as any).localStorage.clear();
  }
});
