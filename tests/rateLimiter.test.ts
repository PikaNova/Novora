import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetRateLimiterForTests,
  checkRateLimit,
  consumeRateLimit,
  getRateLimitKey,
  isWriteTierExemptAction,
  readRateLimitSetting,
} from "../api/_rateLimiter.js";

test("entry limiter rejects requests after the fixed-window threshold", () => {
  __resetRateLimiterForTests();
  const options = { windowMs: 10_000, maxRequests: 2, now: () => 100 };
  assert.equal(checkRateLimit("user-a", options), true);
  assert.equal(checkRateLimit("user-a", options), true);
  assert.equal(checkRateLimit("user-a", options), false);
});

test("entry limiter resets exactly at the next fixed-window boundary", () => {
  __resetRateLimiterForTests();
  let now = 100;
  const options = { windowMs: 10_000, maxRequests: 1, now: () => now };
  assert.equal(checkRateLimit("user-a", options), true);
  assert.equal(checkRateLimit("user-a", options), false);
  now += 10_000;
  assert.equal(checkRateLimit("user-a", options), true);
});

test("entry limiter returns the remaining delay after a rejection", () => {
  __resetRateLimiterForTests();
  let now = 100;
  const options = { windowMs: 10_000, maxRequests: 1, now: () => now };
  assert.equal(consumeRateLimit("user-a", options).allowed, true);
  now += 750;
  const decision = consumeRateLimit("user-a", options);
  assert.equal(decision.allowed, false);
  assert.equal(decision.retryAfterMs, 9_250);
});

test("entry limiter tracks different sources independently", () => {
  __resetRateLimiterForTests();
  const options = { windowMs: 10_000, maxRequests: 1, now: () => 100 };
  assert.equal(checkRateLimit("user-a", options), true);
  assert.equal(checkRateLimit("user-a", options), false);
  assert.equal(checkRateLimit("user-b", options), true);
});

test("entry limiter retains a bounded number of source buckets", () => {
  __resetRateLimiterForTests();
  const options = { windowMs: 10_000, maxRequests: 1, now: () => 100 };
  for (let index = 0; index <= 5_000; index += 1) {
    assert.equal(checkRateLimit(`source-${index}`, options), true);
  }
  assert.equal(checkRateLimit("new-source", options), true);
});

test("entry limiter keeps a recently used active source ahead of an older active source", () => {
  __resetRateLimiterForTests();
  const options = { windowMs: 10_000, maxRequests: 1, now: () => 100 };
  for (let index = 0; index < 5_000; index += 1) {
    assert.equal(checkRateLimit(`source-${index}`, options), true);
  }
  assert.equal(checkRateLimit("source-0", options), false);

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(checkRateLimit("source-new", options), true);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(checkRateLimit("source-0", options), false);
  assert.equal(checkRateLimit("source-1", options), true);
});

test("entry limit settings accept only positive finite values", () => {
  assert.equal(readRateLimitSetting("12.9", 10), 12);
  assert.equal(readRateLimitSetting("0", 10), 10);
  assert.equal(readRateLimitSetting("-2", 10), 10);
  assert.equal(readRateLimitSetting("Infinity", 10), 10);
  assert.equal(readRateLimitSetting(undefined, 10), 10);
});

test("entry limiter hashes bearer tokens before using them as keys", () => {
  const key = getRateLimitKey({
    headers: { authorization: "Bearer sensitive-token" },
    method: "POST",
    body: { instanceId: "device-a" },
  });
  assert.match(key, /^token:[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /sensitive-token/);
});

test("entry limiter falls back from device identity to the client IP", () => {
  assert.equal(getRateLimitKey({
    headers: {}, method: "POST", body: { instanceId: "device-a" },
  }), "device:device-a");
  assert.equal(getRateLimitKey({
    headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }, method: "GET",
  }), "ip:1.2.3.4");
});

test("only polling and heartbeat requests bypass the entry write tier", () => {
  assert.equal(isWriteTierExemptAction("device-heartbeat"), true);
  assert.equal(isWriteTierExemptAction("plugin-pair-status"), true);
  assert.equal(isWriteTierExemptAction("plugin-bootstrap"), true);
  assert.equal(isWriteTierExemptAction("plugin-viewer-heartbeat"), true);
  assert.equal(isWriteTierExemptAction("plugin-pair-start"), false);
  assert.equal(isWriteTierExemptAction("plugin-pair-confirm"), false);
  assert.equal(isWriteTierExemptAction("device-binding"), false);
});
