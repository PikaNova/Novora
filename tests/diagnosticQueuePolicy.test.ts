import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DRAIN_LIMIT,
  DEFAULT_RETENTION_DAYS,
  MAX_DRAIN_LIMIT,
  MAX_RETENTION_DAYS,
  MAX_RETRY_ATTEMPTS,
  MIN_RETENTION_DAYS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  clampDrainLimit,
  clampRetentionDays,
  nextAttemptAfterFailure,
  retentionExpiresAt,
  retryDelayMs,
} from '../api/_diagnosticQueuePolicy.js';

test('retryDelayMs: backs off 60s, 120s, 240s and then caps at one hour', () => {
  assert.equal(retryDelayMs(1), RETRY_BASE_DELAY_MS);
  assert.equal(retryDelayMs(2), 120_000);
  assert.equal(retryDelayMs(3), 240_000);
  assert.equal(retryDelayMs(20), RETRY_MAX_DELAY_MS);
  // 防御性：非法或过小的次数按首次退避处理，不会得到 0 或负数。
  assert.equal(retryDelayMs(0), RETRY_BASE_DELAY_MS);
  assert.equal(retryDelayMs(Number.NaN), RETRY_BASE_DELAY_MS);
  assert.equal(retryDelayMs(-5), RETRY_BASE_DELAY_MS);
});

test('nextAttemptAfterFailure: stops after the third failure and clears after success', () => {
  const now = 1_700_000_000_000;
  assert.equal(nextAttemptAfterFailure(false, 1, now), now + 60_000);
  assert.equal(nextAttemptAfterFailure(false, 2, now), now + 120_000);
  assert.equal(nextAttemptAfterFailure(false, MAX_RETRY_ATTEMPTS, now), null);
  assert.equal(nextAttemptAfterFailure(false, MAX_RETRY_ATTEMPTS + 5, now), null);
  assert.equal(nextAttemptAfterFailure(true, 1, now), null);
});

test('clampDrainLimit: keeps a single drain bounded and safe', () => {
  assert.equal(clampDrainLimit(undefined), DEFAULT_DRAIN_LIMIT);
  assert.equal(clampDrainLimit('3'), 3);
  assert.equal(clampDrainLimit(0), 1);
  assert.equal(clampDrainLimit(-10), 1);
  assert.equal(clampDrainLimit(999), MAX_DRAIN_LIMIT);
  assert.equal(clampDrainLimit('abc'), DEFAULT_DRAIN_LIMIT);
});

test('clampRetentionDays: keeps the saved retention policy inside 1-30 days', () => {
  assert.equal(clampRetentionDays(7), 7);
  assert.equal(clampRetentionDays('14'), 14);
  assert.equal(clampRetentionDays(0), MIN_RETENTION_DAYS);
  assert.equal(clampRetentionDays(-3), MIN_RETENTION_DAYS);
  assert.equal(clampRetentionDays(999), MAX_RETENTION_DAYS);
  assert.equal(clampRetentionDays('abc'), DEFAULT_RETENTION_DAYS);
  assert.equal(clampRetentionDays(undefined), DEFAULT_RETENTION_DAYS);
});

test('retentionExpiresAt: expiry follows the saved retention policy, not a fixed 30 days', () => {
  const createdAt = 1_700_000_000_000;
  const day = 86_400_000;
  assert.equal(retentionExpiresAt(createdAt, 7), createdAt + 7 * day);
  assert.equal(retentionExpiresAt(createdAt, 1), createdAt + 1 * day);
  assert.equal(retentionExpiresAt(createdAt, 30), createdAt + 30 * day);
  // 越界或非法输入按夹取/回落处理，绝不会得到恰好 30 天的“默认行为”。
  assert.equal(retentionExpiresAt(createdAt, 0), createdAt + 1 * day);
  assert.equal(retentionExpiresAt(createdAt, null), createdAt + DEFAULT_RETENTION_DAYS * day);
  assert.notEqual(retentionExpiresAt(createdAt, 7), createdAt + 30 * day);
});
