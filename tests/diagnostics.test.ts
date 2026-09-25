import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __resetDiagnosticsForTests,
  collectAppContext,
  collectNetworkState,
  collectSyncState,
  getDiagnosticBreadcrumbs,
  noteApiResult,
  recordDiagnosticEvent,
  recordUserAction,
} from '../src/utils/diagnostics.js';

test('breadcrumbs keep order, shape and a bounded length', () => {
  __resetDiagnosticsForTests();
  recordDiagnosticEvent('route', '/settings');
  recordDiagnosticEvent('api.fail', '/api/exams · 503 · 820ms', 'error');
  recordDiagnosticEvent('sync.start', '3 项待提交');

  const rows = getDiagnosticBreadcrumbs();
  assert.deepEqual(
    rows.map((row) => row.event),
    ['route', 'api.fail', 'sync.start'],
  );
  assert.equal(rows[0].detail, '/settings');
  assert.equal(rows[1].level, 'error');
  assert.ok(Number.isFinite(rows[0].at));

  for (let index = 0; index < 80; index += 1) recordDiagnosticEvent(`step.${index}`);
  assert.equal(getDiagnosticBreadcrumbs().length, 40);
});

test('breadcrumb events are clipped and empty events are ignored', () => {
  __resetDiagnosticsForTests();
  recordDiagnosticEvent('x'.repeat(200), 'y'.repeat(500));
  const row = getDiagnosticBreadcrumbs()[0];
  assert.equal(String(row.event).length, 60);
  assert.equal(String(row.detail).length, 160);

  __resetDiagnosticsForTests();
  recordDiagnosticEvent('   ');
  assert.equal(getDiagnosticBreadcrumbs().length, 0);
});

test('api failures and slow responses are counted and deduplicated', () => {
  __resetDiagnosticsForTests();
  noteApiResult({ endpoint: '/api/exams', status: 503, durationMs: 820, ok: false });
  noteApiResult({ endpoint: '/api/exams', status: 503, durationMs: 900, ok: false });
  noteApiResult({ endpoint: '/api/telemetry', status: 200, durationMs: 9_000, ok: true });
  noteApiResult({ endpoint: '/api/exams', status: 200, durationMs: 120, ok: true });

  const network = collectNetworkState();
  assert.equal(network.failedRequests, 2);
  assert.equal(network.slowRequests, 1);
  assert.equal(network.lastApiStatus, 200);
  assert.equal(network.lastApiMs, 120);

  // 同 endpoint + status 十秒内只写一条事件；慢请求单独记一条。
  const events = getDiagnosticBreadcrumbs().map((row) => row.event);
  assert.deepEqual(events, ['api.fail', 'api.slow']);
});

test('successful writes become user-action breadcrumbs, reads stay out', () => {
  __resetDiagnosticsForTests();
  noteApiResult({ endpoint: '/api/exams', status: 200, durationMs: 320, ok: true, method: 'POST' });
  noteApiResult({ endpoint: '/api/exams', status: 200, durationMs: 90, ok: true, method: 'GET' });
  noteApiResult({ endpoint: '/api/users', status: 204, durationMs: 40, ok: true, method: 'DELETE' });

  const rows = getDiagnosticBreadcrumbs();
  assert.deepEqual(
    rows.map((row) => row.event),
    ['api.write', 'api.write'],
  );
  assert.equal(rows[0].detail, 'POST /api/exams · 200 · 320ms');
  assert.equal(rows[1].detail, 'DELETE /api/users · 204 · 40ms');
  assert.equal(rows[0].level, 'info');

  // 两秒内重复的同一次写请求只留一条，轮询与重试不会刷掉有用的时间线。
  noteApiResult({ endpoint: '/api/exams', status: 200, durationMs: 150, ok: true, method: 'POST' });
  assert.equal(getDiagnosticBreadcrumbs().length, 2);

  recordUserAction('保存周测');
  const withAction = getDiagnosticBreadcrumbs();
  assert.equal(withAction.at(-1)?.event, 'ui.action');
  assert.equal(withAction.at(-1)?.detail, '保存周测');
});

test('snapshots survive missing browser APIs', () => {
  __resetDiagnosticsForTests();
  const network = collectNetworkState();
  assert.equal(typeof network.online, 'boolean');
  assert.equal(typeof network.sinceLoadMs, 'number');

  const sync = collectSyncState();
  assert.ok(sync);
  assert.equal(typeof sync.pendingCount, 'number');
  assert.equal(sync.syncing, false);

  const context = collectAppContext();
  assert.equal(typeof context.captureEnabled, 'boolean');
  assert.equal(typeof context.stage, 'string');
  assert.ok(!('schoolName' in context), 'snapshot must not carry business fields');
});
