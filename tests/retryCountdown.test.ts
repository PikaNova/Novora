import assert from 'node:assert/strict';
import test from 'node:test';
import { computeLockedUntil, computeRemainingSeconds, formatRetryMessage } from '../src/utils/retryCountdown.js';

const NOW = 1_700_000_000_000;

test('retry countdown converts a relative delay to an absolute time', () => {
  assert.equal(computeLockedUntil(5_000, NOW), NOW + 5_000);
  assert.equal(computeLockedUntil(-1, NOW), NOW);
});

test('retry countdown rounds partial seconds up and ends at zero', () => {
  assert.equal(computeRemainingSeconds(NOW + 1_001, NOW), 2);
  assert.equal(computeRemainingSeconds(NOW + 999, NOW), 1);
  assert.equal(computeRemainingSeconds(NOW, NOW), 0);
  assert.equal(computeRemainingSeconds(NOW - 1, NOW), 0);
});

test('retry countdown message is empty when the retry window is over', () => {
  assert.equal(formatRetryMessage(0, 'Operation is busy'), '');
  assert.equal(formatRetryMessage(12, 'Operation is busy'), 'Operation is busy，请 12 秒后再试');
});
