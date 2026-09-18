import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildErrorReportFingerprint,
  sanitizeErrorReportBreadcrumbs,
  sanitizeErrorReportContext,
  sanitizeErrorReportPath,
  sanitizeErrorReportPayload,
  sanitizeErrorReportRecord,
  sanitizeErrorReportText,
} from '../src/shared/errorReportContracts.js';

test('error report text removes credentials, personal identifiers, and control characters', () => {
  const result = sanitizeErrorReportText(
    'Authorization: Bearer abc123 password=secret email test@example.com phone 13800138000\u0000',
  );
  assert.equal(result, '<redacted> <redacted> email <redacted> phone <redacted>');
});

test('error report context uses an operational allowlist', () => {
  const result = sanitizeErrorReportContext({
    requestId: 'req-1',
    operation: 'read',
    retryable: true,
    mode: 'major-only',
    plansTotal: 3,
    lastSeenAt: 1_710_000_000_000,
    userName: '张三',
    examTitle: '期中考试',
    token: 'secret',
    huge: 'x'.repeat(500),
  });
  assert.deepEqual(result, {
    requestId: 'req-1',
    operation: 'read',
    retryable: true,
    mode: 'major-only',
    plansTotal: 3,
  });
});

test('diagnostic records keep operational keys and drop sensitive ones', () => {
  const record = sanitizeErrorReportRecord({
    online: false,
    effectiveType: '3g',
    rttMs: 320,
    pendingCount: 2,
    syncing: true,
    studentName: '张三',
    questionText: '第一题',
    authorization: 'Bearer abc',
    nested: { a: 1 },
    note: 'x'.repeat(400),
  });
  assert.deepEqual(record, {
    online: false,
    effectiveType: '3g',
    rttMs: 320,
    pendingCount: 2,
    syncing: true,
    note: 'x'.repeat(200),
  });
  assert.equal(sanitizeErrorReportRecord(null), null);
  assert.equal(sanitizeErrorReportRecord('text'), null);
  assert.equal(sanitizeErrorReportRecord({ token: 'abc', password: 'p' }), null);
  // 毫秒时间戳（约 1.7e12）属于运维必需数值，不能被当成异常大数丢掉。
  assert.deepEqual(sanitizeErrorReportRecord({ at: 1_710_000_000_000 }), { at: 1_710_000_000_000 });
});

test('diagnostic records cap key count and oversized numbers', () => {
  const wide: Record<string, number> = {};
  for (let index = 0; index < 40; index += 1) wide[`field${index}`] = index;
  assert.equal(Object.keys(sanitizeErrorReportRecord(wide) || {}).length, 16);
  assert.deepEqual(sanitizeErrorReportRecord({ huge: 1e16 }), null);
});

test('breadcrumbs keep a bounded timeline and filter each row', () => {
  const rows = sanitizeErrorReportBreadcrumbs([
    { at: 1_710_000_000_000, event: 'route', detail: '/settings', action: 'x', a: 1, b: 2, c: 3, d: 4, e: 5 },
    { at: 1_710_000_001_000, event: 'sync.start', studentId: 's1' },
  ]);
  assert.equal(rows?.length, 2);
  // 单行最多 8 个键，超出的字段（e）被丢弃；敏感键（studentId）整键丢弃。
  assert.deepEqual(rows?.[0], {
    at: 1_710_000_000_000,
    event: 'route',
    detail: '/settings',
    action: 'x',
    a: 1,
    b: 2,
    c: 3,
    d: 4,
  });
  assert.deepEqual(rows?.[1], { at: 1_710_000_001_000, event: 'sync.start' });

  const many = Array.from({ length: 50 }, (_, index) => ({ at: 1_710_000_000_000 + index, event: 'step' }));
  assert.equal(sanitizeErrorReportBreadcrumbs(many)?.length, 20);
  assert.equal(sanitizeErrorReportBreadcrumbs('nope'), null);
});

test('error report paths drop query data and normalize dynamic identifiers', () => {
  assert.equal(
    sanitizeErrorReportPath(
      'https://school.example/api/exams/123/records/550e8400-e29b-41d4-a716-446655440000?token=secret',
    ),
    '/api/exams/<number>/records/<uuid>',
  );
});

test('error report fingerprints remain stable across dynamic message values', () => {
  const first = buildErrorReportFingerprint({
    type: 'api',
    errorName: 'ApiError',
    message: 'record 123 failed',
    route: '/exam/123',
  });
  const second = buildErrorReportFingerprint({
    type: 'api',
    errorName: 'ApiError',
    message: 'record 456 failed',
    route: '/exam/456',
  });
  assert.equal(first, second);
});

test('sanitized payload contains only software diagnostics', () => {
  const payload = sanitizeErrorReportPayload({
    instanceId: 'instance-1',
    deviceId: 'device-1',
    type: 'api',
    level: 'critical',
    message: 'request failed for exam title 期中考试',
    appVersion: '2.7.5',
    context: { operation: 'read', examTitle: '期中考试' },
    schoolName: '示例学校',
  } as never);
  assert.ok(payload);
  assert.equal(payload.schoolName, '示例学校');
  assert.equal(payload.host, null);
  assert.equal(payload.userAgent, null);
  assert.equal(payload.province, null);
  assert.equal(payload.tz, null);
  assert.equal(payload.lang, null);
  assert.deepEqual(payload.context, { operation: 'read' });
  assert.equal(payload.level, 'critical');
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.commitSha, null);
  assert.equal(payload.errorCode, null);
  assert.equal(payload.networkState, null);
  assert.equal(payload.syncState, null);
  assert.equal(payload.breadcrumbs, null);
});

test('payload carries the v2 diagnostic snapshot', () => {
  const payload = sanitizeErrorReportPayload({
    instanceId: 'instance-1',
    type: 'sync',
    message: 'sync failed',
    appVersion: '2.7.6',
    commitSha: 'abc1234',
    errorCode: 'SYNC_FAILED',
    userMessage: '数据暂未同步，请稍后重试',
    errorEventId: 'err_fp_3k4j5l_1a2b3c4d',
    occurredAt: 1_710_000_000_000,
    networkState: { online: false, offlineForMs: 12_000, retryCount: 2 },
    syncState: { pendingCount: 3, syncing: true },
    breadcrumbs: [
      { at: 1_709_999_999_000, event: 'route', detail: '/exam' },
      { at: 1_709_999_999_500, event: 'api.fail', detail: '/api/exams · 503 · 820ms' },
    ],
  } as never);
  assert.ok(payload);
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.commitSha, 'abc1234');
  assert.equal(payload.errorCode, 'SYNC_FAILED');
  assert.equal(payload.userMessage, '数据暂未同步，请稍后重试');
  // 事件 ID 必须原样保留：作者端靠它把错误和诊断包关联起来。
  assert.equal(payload.errorEventId, 'err_fp_3k4j5l_1a2b3c4d');
  assert.equal(payload.occurredAt, 1_710_000_000_000);
  assert.deepEqual(payload.networkState, { online: false, offlineForMs: 12_000, retryCount: 2 });
  assert.deepEqual(payload.syncState, { pendingCount: 3, syncing: true });
  assert.equal(payload.breadcrumbs?.length, 2);
});
