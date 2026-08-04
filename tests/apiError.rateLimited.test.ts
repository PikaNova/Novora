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

const { apiErrorFromResponse, getSyncNotifyTitle } =
  await import("../src/services/apiError.js");

test("RATE_LIMITED keeps the server message and is retryable", async () => {
  const message = "\u5176\u4ed6\u8bbe\u5907\u6b63\u5728\u4fdd\u5b58\u6570\u636e\u3002";
  const response = new Response(JSON.stringify({
    ok: false,
    code: "RATE_LIMITED",
    error: message,
    retryable: true,
  }), { status: 429, headers: { "Content-Type": "application/json" } });

  const error = await apiErrorFromResponse(response, "Save failed");
  assert.equal(error.code, "RATE_LIMITED");
  assert.equal(error.retryable, true);
  assert.equal(error.message, message);
});

test("RATE_LIMITED has a specific fallback message and notification title", async () => {
  const response = new Response(JSON.stringify({ code: "RATE_LIMITED", retryable: true }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });
  const error = await apiErrorFromResponse(response, "Save failed");
  assert.equal(error.code, "RATE_LIMITED");
  assert.notEqual(error.message, "Save failed");
  assert.equal(getSyncNotifyTitle("RATE_LIMITED"), "多设备同步繁忙");
});
