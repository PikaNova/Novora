import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * 端到端：客户端 reportError 实际发出的请求体里必须带上诊断快照。
 * 只测 sanitize 函数不够——漏接一个字段，作者端看到的就还是「只有一句报错」。
 */

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
  get length(): number {
    return this.values.size;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
}

const globals = globalThis as typeof globalThis & {
  localStorage?: MemoryStorage;
  window?: unknown;
  fetch?: typeof fetch;
  __APP_VERSION__?: string;
  __COMMIT_SHA__?: string;
};

globals.localStorage = new MemoryStorage();
globals.__APP_VERSION__ = '2.8.0';
globals.__COMMIT_SHA__ = 'abc1234';
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: globals.localStorage,
    setTimeout: (handler: () => void, delay?: number) => setTimeout(handler, delay),
    addEventListener: () => {},
    matchMedia: () => ({ matches: false }),
  },
  configurable: true,
});
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, userAgent: 'test-agent', language: 'zh-CN', serviceWorker: { controller: null } },
  configurable: true,
});
Object.defineProperty(globalThis, 'location', {
  value: { host: 'dev.example', pathname: '/exam' },
  configurable: true,
});

// 上报本身要求用户已同意遥测，并需要稳定的实例 ID。
globals.localStorage.setItem('telemetry_consent', 'granted');
globals.localStorage.setItem('telemetry_instance_id', 'instance-1');

const sent: Array<Record<string, unknown>> = [];
globals.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('error-report') && init?.body) sent.push(JSON.parse(String(init.body)));
  return new Response(JSON.stringify({ ok: true }), { status: 202 });
}) as typeof fetch;

const { reportError } = await import('../src/services/errorReport.js');
const { __resetDiagnosticsForTests, noteApiResult, recordDiagnosticEvent } =
  await import('../src/utils/diagnostics.js');

test('reportError ships the diagnostic snapshot with the report', async () => {
  __resetDiagnosticsForTests();
  recordDiagnosticEvent('route', '/exam');
  noteApiResult({ endpoint: '/api/exams', status: 503, durationMs: 820, ok: false });

  await reportError({
    message: 'request failed',
    errorName: 'ApiError',
    errorCode: 'SYNC_FAILED',
    userMessage: '数据暂未同步，请稍后重试',
    route: '/exam',
    action: 'save',
    apiEndpoint: '/api/exams',
    httpStatus: 503,
    context: { operation: 'save', attempt: 2 },
  });

  assert.equal(sent.length, 1, 'expected exactly one report request');
  const body = sent[0];
  assert.equal(body.schemaVersion, 2);
  assert.equal(body.instanceId, 'instance-1');
  assert.equal(body.commitSha, 'abc1234');
  assert.equal(body.appVersion, '2.8.0');
  assert.equal(body.errorCode, 'SYNC_FAILED');
  assert.equal(body.userMessage, '数据暂未同步，请稍后重试');
  assert.match(String(body.errorEventId), /^err_fp_[a-z0-9]+_[a-z0-9]+$/);
  assert.equal(typeof body.occurredAt, 'number');

  const network = body.networkState as Record<string, unknown>;
  assert.equal(network.online, true);
  assert.equal(network.failedRequests, 1);
  assert.equal(network.lastApiStatus, 503);

  const sync = body.syncState as Record<string, unknown>;
  assert.equal(sync.pendingCount, 0);
  assert.equal(sync.syncing, false);

  const breadcrumbs = body.breadcrumbs as Array<Record<string, unknown>>;
  // 快照在 buildPayload 阶段采集，因此不含紧随其后的 error.report 标记（它留给后续上报）。
  assert.deepEqual(
    breadcrumbs.map((row) => row.event),
    ['route', 'api.fail'],
  );

  const context = body.context as Record<string, unknown>;
  assert.equal(context.operation, 'save');
  assert.equal(context.attempt, 2);
  assert.equal(context.pendingReports, 0);
  assert.equal(context.captureEnabled, true);
  assert.equal(context.mode, 'major-only');
});
