import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLoginFailureAlerts } from '../api/_auth.js';

const NOW = 1_700_000_000_000;
const WINDOW_MS = 15 * 60 * 1_000;

function failures(username: string, count: number, newestAgoMs = 0) {
  return Array.from({ length: count }, (_, index) => ({
    username,
    action: 'auth.login.failed',
    created_at: NOW - newestAgoMs - index * 1_000,
  }));
}

test('login failure alerts require at least three recent consecutive failures', () => {
  assert.deepEqual(evaluateLoginFailureAlerts(failures('admin', 2), NOW), []);
  const alerts = evaluateLoginFailureAlerts(failures('admin', 3), NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.username, 'admin');
  assert.equal(alerts[0]?.failureCount, 3);
});

test('a successful login clears the previous failure streak', () => {
  const rows = [
    ...failures('admin', 2),
    { username: 'admin', action: 'auth.login', created_at: NOW - 3_000 },
    ...failures('admin', 3, 4_000),
  ];
  assert.deepEqual(evaluateLoginFailureAlerts(rows, NOW), []);
});

test('expired failures do not hide three newer failures in the same streak', () => {
  const rows = [
    ...failures('admin', 3),
    { username: 'admin', action: 'auth.login.failed', created_at: NOW - WINDOW_MS - 1 },
  ];
  const alerts = evaluateLoginFailureAlerts(rows, NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.failureCount, 3);
});

test('alerts group usernames case-insensitively and retain the newest spelling', () => {
  const rows = [
    { username: 'Admin', action: 'auth.login.failed', created_at: NOW },
    { username: 'admin', action: 'auth.login.failed', created_at: NOW - 1_000 },
    { username: 'ADMIN', action: 'auth.login.failed', created_at: NOW - 2_000 },
  ];
  const alerts = evaluateLoginFailureAlerts(rows, NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.username, 'Admin');
});

test('alerts sort the most recently failed username first', () => {
  const alerts = evaluateLoginFailureAlerts([
    ...failures('newer', 3),
    ...failures('older', 3, 10_000),
  ], NOW);
  assert.deepEqual(alerts.map(alert => alert.username), ['newer', 'older']);
});
