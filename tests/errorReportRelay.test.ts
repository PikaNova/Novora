import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * 学校端 /api/error-report 只做转发，但它会用共享契约再清洗一次；只要有一处字段没接上，
 * 客户端辛苦采集的网络/同步/事件序列就会在服务端被静默丢掉。
 */

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

const calls: CapturedCall[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  calls.push({ url, init });
  if (url.includes('resource=config')) return jsonResponse({ config: {} });
  if (url.includes('issue-client-token')) {
    return jsonResponse({ ok: true, token: 'test-token', expiresAt: Date.now() + 10 * 60 * 1000 });
  }
  return jsonResponse({ ok: true }, 202);
}) as typeof fetch;

const { handleErrorReport: handler } = await import('../api/_telemetry/errorReport.js');

function createResponse() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
    setHeader(key: string, value: string) {
      res.headers[key] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}

function relayedBody(): Record<string, unknown> {
  const relay = calls.filter((call) => call.url.endsWith('/api/error-report')).pop();
  assert.ok(relay, 'expected the school server to relay the report upstream');
  return JSON.parse(String(relay.init?.body)) as Record<string, unknown>;
}

test('school server relays the v2 diagnostic snapshot instead of dropping it', async () => {
  calls.length = 0;
  const res = createResponse();
  await handler(
    {
      method: 'POST',
      headers: { 'user-agent': 'test-agent' },
      body: {
        schemaVersion: 2,
        instanceId: 'instance-1',
        message: 'sync failed',
        errorName: 'ApiError',
        type: 'sync',
        level: 'error',
        appVersion: '2.8.0',
        commitSha: 'abc1234',
        errorCode: 'SYNC_FAILED',
        userMessage: '数据暂未同步，请稍后重试',
        errorEventId: 'err_fp_3k4j5l_1a2b3c4d',
        occurredAt: 1_710_000_000_000,
        route: '/exam',
        networkState: { online: false, effectiveType: '3g', offlineForMs: 12_000 },
        syncState: { pendingCount: 3, syncing: true, slow: false },
        breadcrumbs: [
          { at: 1_709_999_999_000, event: 'route', detail: '/exam', level: 'info' },
          { at: 1_709_999_999_500, event: 'api.fail', detail: '/api/exams · 503 · 820ms', level: 'error' },
        ],
        context: { mode: 'major-only', plansTotal: 4, scopeGroups: 18 },
      },
    } as never,
    res as never,
  );

  assert.equal(res.statusCode, 200);
  const body = relayedBody();
  assert.equal(body.commitSha, 'abc1234');
  assert.equal(body.errorCode, 'SYNC_FAILED');
  assert.equal(body.userMessage, '数据暂未同步，请稍后重试');
  assert.equal(body.errorEventId, 'err_fp_3k4j5l_1a2b3c4d');
  assert.equal(body.occurredAt, 1_710_000_000_000);
  assert.deepEqual(body.networkState, { online: false, effectiveType: '3g', offlineForMs: 12_000 });
  assert.deepEqual(body.syncState, { pendingCount: 3, syncing: true, slow: false });
  assert.equal((body.breadcrumbs as unknown[]).length, 2);
  assert.deepEqual(body.context, { mode: 'major-only', plansTotal: 4, scopeGroups: 18 });
});

test('school server still filters business content and credentials out of snapshots', async () => {
  calls.length = 0;
  const res = createResponse();
  await handler(
    {
      method: 'POST',
      headers: {},
      body: {
        instanceId: 'instance-1',
        message: 'failed',
        appVersion: '2.8.0',
        networkState: { online: true, token: 'secret-token', studentName: '张三' },
        breadcrumbs: [{ at: 1_710_000_000_000, event: 'api.fail', detail: 'Authorization: Bearer abc123' }],
        context: { mode: 'major-only', examTitle: '期中考试' },
      },
    } as never,
    res as never,
  );

  const body = relayedBody();
  assert.deepEqual(body.networkState, { online: true });
  assert.deepEqual(body.context, { mode: 'major-only' });
  const crumbs = body.breadcrumbs as Array<Record<string, unknown>>;
  assert.equal(crumbs.length, 1);
  assert.equal(crumbs[0].detail, '<redacted>');
});

test('school server relays device id and attribution fields instead of dropping them', async () => {
  calls.length = 0;
  const res = createResponse();
  await handler(
    {
      method: 'POST',
      headers: {},
      body: {
        instanceId: 'instance-1',
        message: '保存失败',
        appVersion: '2.8.0',
        deviceId: 'device-42',
        errorCode: 'DATABASE_WRITE_FAILED',
        errorSource: 'database',
        severity: 'critical',
        operatorMessage: '写入被回滚，检查并发编辑',
        suggestedAction: '查看 baseUpdatedAt 与 syncState',
        retryable: true,
        requestId: 'req_abc',
        traceId: 'trace_abc',
        migrationVersion: 'exams-v4',
      },
    } as never,
    res as never,
  );

  const body = relayedBody();
  assert.equal(body.deviceId, 'device-42');
  assert.equal(body.errorSource, 'database');
  assert.equal(body.severity, 'critical');
  assert.equal(body.operatorMessage, '写入被回滚，检查并发编辑');
  assert.equal(body.suggestedAction, '查看 baseUpdatedAt 与 syncState');
  assert.equal(body.retryable, true);
  assert.equal(body.requestId, 'req_abc');
  assert.equal(body.traceId, 'trace_abc');
  assert.equal(body.migrationVersion, 'exams-v4');
});

test('school server drops unknown attribution enums instead of inventing new ones', async () => {
  calls.length = 0;
  const res = createResponse();
  await handler(
    {
      method: 'POST',
      headers: {},
      body: {
        instanceId: 'instance-1',
        message: 'boom',
        appVersion: '2.8.0',
        errorSource: 'k8s',
        severity: 'catastrophic',
      },
    } as never,
    res as never,
  );

  const body = relayedBody();
  assert.equal(body.errorSource, null);
  assert.equal(body.severity, null);
});

test('school server never samples error reports out', async () => {
  calls.length = 0;
  // 历史配置里存过 errorSampleRate=0；错误上报必须仍按 100% 转发。
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (url.includes('resource=config')) {
      return jsonResponse({ config: { errorSampleRate: 0, sampleRate: 0 } });
    }
    if (url.includes('issue-client-token')) {
      return jsonResponse({ ok: true, token: 'test-token', expiresAt: Date.now() + 10 * 60 * 1000 });
    }
    return jsonResponse({ ok: true }, 202);
  }) as typeof fetch;
  try {
    const res = createResponse();
    await handler(
      {
        method: 'POST',
        headers: {},
        body: { instanceId: 'instance-1', message: '失败', appVersion: '2.8.0' },
      } as never,
      res as never,
    );
    assert.equal(res.statusCode, 200);
    assert.notEqual((res.body as Record<string, unknown>).skipped, true);
    assert.ok(calls.some((call) => call.url.endsWith('/api/error-report')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
