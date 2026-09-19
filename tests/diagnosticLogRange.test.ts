import assert from 'node:assert/strict';
import test from 'node:test';

// 设置页的两条发送链路都靠这些纯函数决定「发哪些日志」：
// - 按时间发送：DateTimeField 的 YYYY-MM-DDTHH:mm 必须能无损地变成毫秒区间；
// - 错误日志：一次点击要拿到本机保留期内的全部日志，不能再依赖「上次上传」这类隐式状态。
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

const testGlobals = globalThis as unknown as {
  localStorage: MemoryStorage;
  window: { localStorage: MemoryStorage };
  fetch: typeof fetch;
  __APP_VERSION__: string;
  __COMMIT_SHA__: string;
};

const storage = new MemoryStorage();
testGlobals.localStorage = storage;
testGlobals.window = { localStorage: storage };
testGlobals.__APP_VERSION__ = 'test';
testGlobals.__COMMIT_SHA__ = 'test';

const { logger } = await import('../src/utils/logger.js');
const {
  allRetainedEntries,
  defaultDiagnosticRange,
  entriesInRange,
  sendDiagnosticLogs,
  timestampFromField,
  timestampToField,
} = await import('../src/services/diagnosticLogs.js');

test('timestampFromField accepts only a complete local date-time', () => {
  const at = timestampFromField('2026-09-18T20:05');
  assert.equal(at, new Date(2026, 8, 18, 20, 5, 0, 0).getTime());
  assert.equal(timestampToField(at!), '2026-09-18T20:05');

  // 缺字段、非零填充、越界时分、真实不存在的日期（Date 会自动进位）都必须是 null，
  // 否则界面会把「2026-02-30」当成合法区间发给服务端。
  for (const invalid of [
    '',
    '2026-09-18',
    '2026-9-18T20:05',
    '2026-09-18T20',
    '2026-09-18T25:00',
    '2026-02-30T10:00',
  ]) {
    assert.equal(timestampFromField(invalid), null, `${invalid} should be rejected`);
  }
});

test('defaultDiagnosticRange covers the last 24 hours, rounded to the minute', () => {
  const now = new Date(2026, 8, 18, 20, 5, 40, 500).getTime();
  const range = defaultDiagnosticRange(now);
  const from = timestampFromField(range.from);
  const to = timestampFromField(range.to);
  assert.equal(to, new Date(2026, 8, 18, 20, 5, 0, 0).getTime());
  assert.equal(to! - from!, 24 * 60 * 60 * 1000);
  assert.equal(range.from, '2026-09-17T20:05');
  assert.equal(range.to, '2026-09-18T20:05');
});

test('entriesInRange filters the local window while allRetainedEntries keeps everything', () => {
  logger.info('diagnostic range probe');
  const now = Date.now();

  const all = allRetainedEntries(now);
  assert.ok(all.length >= 1);
  assert.equal(all.at(-1)?.message, 'diagnostic range probe');
  assert.deepEqual(entriesInRange(0, now).length, all.length);
  assert.equal(entriesInRange(now + 1, now + 1000).length, 0);
});

test('the one-click error bundle ships every retained entry and leaves no hidden upload marker', async () => {
  logger.warn('bundle probe');
  const entries = allRetainedEntries();
  assert.ok(entries.length >= 2);

  const captured: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  testGlobals.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ok: true, bundleId: 'bundle-full', status: 'sent' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const result = await sendDiagnosticLogs({
      mode: 'error',
      fromTs: entries[0].at,
      toTs: Date.now(),
      entries,
    });
    assert.equal(result.bundleId, 'bundle-full');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].mode, 'error');
    assert.equal(captured[0].fromTs, entries[0].at);
    assert.equal((captured[0].entries as unknown[]).length, entries.length);
  } finally {
    testGlobals.fetch = originalFetch;
  }

  // 「全量日志不要静默发送」：发送不再留下任何「上次上传」游标，
  // 下一次发送什么完全由管理员在界面上选择的时间区间决定。
  assert.deepEqual(
    storage.keys().filter((key) => key.includes('last_upload')),
    [],
  );
});
