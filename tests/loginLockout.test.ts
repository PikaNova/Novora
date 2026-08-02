import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLoginLockout, type LoginAttemptRow } from "../api/_auth.js";

const WINDOW_MS = 15 * 60 * 1000;
const NOW = 1_700_000_000_000;

function failuresDesc(count: number): LoginAttemptRow[] {
  return Array.from({ length: count }, (_, index) => ({
    action: "auth.login.failed",
    created_at: NOW - index * 1_000,
  }));
}

test("login lockout allows fewer than five failures", () => {
  assert.deepEqual(evaluateLoginLockout(failuresDesc(4), NOW), { locked: false, retryAfterMs: 0 });
});

test("login lockout blocks five consecutive recent failures", () => {
  const result = evaluateLoginLockout(failuresDesc(5), NOW);
  assert.equal(result.locked, true);
  assert.equal(result.retryAfterMs, WINDOW_MS - 4_000);
});

test("a recent successful login resets the consecutive failure window", () => {
  const attempts: LoginAttemptRow[] = [
    { action: "auth.login.failed", created_at: NOW - 1_000 },
    { action: "auth.login", created_at: NOW - 2_000 },
    ...failuresDesc(3).map((attempt, index) => ({ ...attempt, created_at: NOW - (index + 3) * 1_000 })),
  ];
  assert.equal(evaluateLoginLockout(attempts, NOW).locked, false);
});

test("login lockout expires exactly at the time-window boundary", () => {
  const attempts = failuresDesc(5);
  attempts[4].created_at = NOW - WINDOW_MS;
  assert.deepEqual(evaluateLoginLockout(attempts, NOW), { locked: false, retryAfterMs: 0 });
});

test("only the newest five attempts determine the lockout", () => {
  const attempts = [...failuresDesc(5), { action: "auth.login", created_at: NOW - 6_000 }];
  assert.equal(evaluateLoginLockout(attempts, NOW).locked, true);
});

test("login lockout supports explicit test thresholds", () => {
  assert.equal(evaluateLoginLockout(failuresDesc(3), NOW, { maxFailures: 3, windowMs: 60_000 }).locked, true);
});
