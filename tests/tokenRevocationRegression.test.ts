import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLegacySharedTokenVersionCurrent,
  isTokenNotExpired,
  isUserTokenVersionCurrent,
} from '../api/_auth.js';

const NOW = 1_700_000_000_000;

test('token expiry remains valid at the exact expiry boundary only', () => {
  assert.equal(isTokenNotExpired(NOW, NOW), true);
  assert.equal(isTokenNotExpired(NOW - 1, NOW), false);
  assert.equal(isTokenNotExpired(Number.NaN, NOW), false);
});

test('legacy shared tokens reject a stale global compatibility version', () => {
  assert.equal(isLegacySharedTokenVersionCurrent(3, 3), true);
  assert.equal(isLegacySharedTokenVersionCurrent(3, 4), false);
});

test('user tokens reject deleted, disabled, and version-bumped accounts', () => {
  assert.equal(isUserTokenVersionCurrent(null, 1), false);
  assert.equal(isUserTokenVersionCurrent({ status: 'disabled', token_version: 1 }, 1), false);
  assert.equal(isUserTokenVersionCurrent({ status: 'active', token_version: 2 }, 1), false);
  assert.equal(isUserTokenVersionCurrent({ status: 'active', token_version: 2 }, 2), true);
});
