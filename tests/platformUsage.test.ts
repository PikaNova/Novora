import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, encryptSecret, secretHint } from '../api/_platformUsage/crypto.js';
import { detectPlatformEnvironment, isNeonConnectionString } from '../api/_platformUsage/environment.js';
import { collectNeonUsage, NEON_FREE_LIMITS, neonDeclarativeMetrics } from '../api/_platformUsage/neon.js';
import { remainingCooldownSeconds, statusFromMetrics, type PlatformMetric } from '../api/_platformUsage/types.js';
import {
  buildVercelMetrics,
  collectVercelUsage,
  describeShape,
  sumBuckets,
  vercelDeclarativeMetrics,
  VERCEL_METRICS,
  VERCEL_USAGE_TYPES,
} from '../api/_platformUsage/vercel.js';

const NEON_URL = 'postgresql://u:p@ep-cool-1234.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const LOCAL_URL = 'postgres://novora:novora@127.0.0.1:5432/novora';

test('环境识别: Vercel + Neon 两个开关独立，本地部署一律不启用', () => {
  const onVercel = detectPlatformEnvironment({ VERCEL: '1' }, NEON_URL);
  assert.equal(onVercel.runtime, 'vercel');
  assert.equal(onVercel.database, 'neon');
  assert.equal(onVercel.vercel, true);
  assert.equal(onVercel.neon, true);
  assert.equal(onVercel.local, false);

  const vercelOnly = detectPlatformEnvironment({ VERCEL: '1' }, LOCAL_URL);
  assert.equal(vercelOnly.vercel, true);
  assert.equal(vercelOnly.neon, false);

  // 关键约束：本地跑同一套代码、即使 DATABASE_URL 指向 Neon，也不启用任何面板。
  const localWithNeon = detectPlatformEnvironment({}, NEON_URL);
  assert.equal(localWithNeon.local, true);
  assert.equal(localWithNeon.vercel, false);
  assert.equal(localWithNeon.neon, false);

  const localWithPostgres = detectPlatformEnvironment({}, LOCAL_URL);
  assert.equal(localWithPostgres.local, true);
  assert.equal(localWithPostgres.vercel, false);
  assert.equal(localWithPostgres.neon, false);
  assert.equal(localWithPostgres.database, 'postgres');

  const unknownDatabase = detectPlatformEnvironment({ VERCEL: '1' }, undefined);
  assert.equal(unknownDatabase.database, 'unknown');
  assert.equal(unknownDatabase.neon, false);
});

test('Neon 连接串识别与 dbAdapter 判据一致', () => {
  assert.equal(isNeonConnectionString(NEON_URL), true);
  assert.equal(isNeonConnectionString('postgres://u:p@host/db?channel_binding=require'), true);
  assert.equal(isNeonConnectionString(LOCAL_URL), false);
  assert.equal(isNeonConnectionString(''), false);
  assert.equal(isNeonConnectionString(undefined), false);
});

test('凭据加密: 可逆、随机 IV、错误密钥或被篡改时拒绝解密', () => {
  const secret = 'unit-test-secret';
  const encrypted = encryptSecret('napi_abcdefghijklmnop', secret);
  assert.notEqual(encrypted, 'napi_abcdefghijklmnop');
  assert.equal(decryptSecret(encrypted, secret), 'napi_abcdefghijklmnop');

  // 相同明文两次加密的密文必须不同（随机 IV）。
  assert.notEqual(encryptSecret('same', secret), encryptSecret('same', secret));

  assert.equal(decryptSecret(encrypted, 'another-secret'), null);
  assert.equal(decryptSecret('v1.not-base64!!.x.y', secret), null);
  assert.equal(decryptSecret('', secret), null);

  const parts = encrypted.split('.');
  const tampered = [parts[0], parts[1], parts[2], Buffer.from('tampered').toString('base64url')].join('.');
  assert.equal(decryptSecret(tampered, secret), null);
});

test('凭据提示只保留尾 4 位', () => {
  assert.equal(secretHint('napi_1234567890abcd'), '••••abcd');
  assert.equal(secretHint('   '), '');
  assert.ok(!secretHint('napi_1234567890abcd').includes('123456'));
});

test('Neon 免费额度常量与官方文档一致', () => {
  assert.equal(NEON_FREE_LIMITS.computeCuHours, 100);
  assert.equal(NEON_FREE_LIMITS.storageBytes, 500_000_000);
  assert.equal(NEON_FREE_LIMITS.transferBytes, 5_000_000_000);
  assert.deepEqual(
    neonDeclarativeMetrics().map((metric) => [metric.key, metric.limit, metric.unit, metric.percent]),
    [
      ['storage', 0.5, 'GB', null],
      ['compute', 100, 'CU-hrs', null],
      ['egress', 5, 'GB', null],
    ],
  );
});

test('读数状态阈值: 80% 警告、95% 严重、100% 超限', () => {
  const metric = (percent: number | null): PlatformMetric => ({
    key: 'k',
    label: 'l',
    used: percent ?? 0,
    limit: 100,
    unit: 'u',
    percent,
  });
  assert.equal(statusFromMetrics([metric(0)]), 'ok');
  assert.equal(statusFromMetrics([metric(79.9)]), 'ok');
  assert.equal(statusFromMetrics([metric(80)]), 'warning');
  assert.equal(statusFromMetrics([metric(94.9)]), 'warning');
  assert.equal(statusFromMetrics([metric(95)]), 'critical');
  assert.equal(statusFromMetrics([metric(120)]), 'critical');
  // 没有上限的指标不参与判定。
  assert.equal(statusFromMetrics([metric(null)]), 'ok');
  // 取最差的一条。
  assert.equal(statusFromMetrics([metric(10), metric(96)]), 'critical');
});

test('刷新冷却: 由上次刷新时间推算剩余秒数，向上取整', () => {
  const now = 1_000_000;
  assert.equal(remainingCooldownSeconds(null, now), 0);
  assert.equal(remainingCooldownSeconds(undefined, now), 0);
  assert.equal(remainingCooldownSeconds(0, now), 0);
  // 刚刷新过：整整一分钟。
  assert.equal(remainingCooldownSeconds(now, now), 60);
  assert.equal(remainingCooldownSeconds(now - 30_000, now), 30);
  // 不足一秒也要算 1 秒，避免按钮提前可用、点了又吃一个 429。
  assert.equal(remainingCooldownSeconds(now - 59_001, now), 1);
  assert.equal(remainingCooldownSeconds(now - 60_000, now), 0);
  assert.equal(remainingCooldownSeconds(now - 120_000, now), 0);
});

// 2026-10-01 真实账号返回的字段名与量级（120 天窗口的实际汇总值）。
const REQUESTS_BUCKETS = [
  {
    date: '2026-09-30T00:00:00Z',
    request_hit_count: 281_708,
    request_miss_count: 1_120_230,
    bandwidth_outgoing_bytes: 3_441_000_000,
    bandwidth_incoming_bytes: 1_792_000_000,
    function_invocation_successful_count: 1_087_960,
    function_execution_successful_gb_hours: 29.333,
    monitoring_metric_count: 5,
  },
];
const BUILDS_BUCKETS = [
  {
    date: '2026-09-13T00:00:00Z',
    build_completed_count: 3,
    build_failed_count: 1,
    build_build_seconds: 600,
    build_queued_seconds: 60,
  },
];

test('Vercel 分桶求和: 逐桶累加，数值字符串也认，缺失与非数值按 0', () => {
  assert.equal(sumBuckets([{ a: 1 }, { a: 2 }, { a: 3 }], ['a']), 6);
  assert.equal(sumBuckets([{ a: 1 }, { a: '2' }], ['a']), 3);
  assert.equal(sumBuckets([{ a: 1, b: 2 }], ['a', 'b']), 3);
  assert.equal(sumBuckets([{ a: null }, {}, 'junk', { a: 'nope' }], ['a']), 0);
  assert.equal(sumBuckets(undefined, ['a']), 0);
  assert.equal(sumBuckets({ a: 1 }, ['a']), 0);
});

test('Vercel 读数: 列出接口能提供的全部指标', () => {
  const metrics = buildVercelMetrics({ requests: REQUESTS_BUCKETS, builds: BUILDS_BUCKETS });
  assert.deepEqual(
    metrics.map((metric) => [metric.key, metric.used, metric.limit, metric.unit, metric.percent]),
    [
      ['cdn_requests', 1_401_938, null, '次', null],
      ['bandwidth_outgoing', 3.441, null, 'GB', null],
      ['bandwidth_incoming', 1.792, null, 'GB', null],
      ['function_invocations', 1_087_960, null, '次', null],
      ['function_gb_hours', 29.333, null, 'GB-hrs', null],
      ['monitoring_metrics', 5, null, '次', null],
      ['builds', 4, null, '次', null],
      ['build_minutes', 11, null, '分钟', null],
    ],
  );
  // 分桶序列要保留下来（预测靠它），单位换算也必须与 used 一致。
  assert.deepEqual(metrics.find((metric) => metric.key === 'bandwidth_outgoing')?.series, [
    { date: '2026-09-30T00:00:00Z', value: 3.441 },
  ]);
  assert.deepEqual(metrics.find((metric) => metric.key === 'cdn_requests')?.series, [
    { date: '2026-09-30T00:00:00Z', value: 1_401_938 },
  ]);
  // 这个端点不返回额度上限，任何指标都不该凭空出现百分比。
  assert.equal(
    metrics.every((metric) => metric.limit === null && metric.percent === null),
    true,
  );
});

test('Vercel 占位读数: 同样列全指标，但全部按 0 显示且不给百分比', () => {
  const metrics = vercelDeclarativeMetrics();
  assert.equal(metrics.length, VERCEL_METRICS.length);
  assert.deepEqual(
    metrics.map((metric) => [metric.key, metric.used, metric.limit, metric.percent]),
    VERCEL_METRICS.map((def) => [def.key, 0, null, null]),
  );
  // 面板上那些拿不到的指标不能出现在这里，否则等于编数据。
  const labels = metrics.map((metric) => metric.label).join(' ');
  for (const absent of ['Functions Storage', 'Deployment Storage', 'Active CPU', 'ISR', 'Blob']) {
    assert.equal(labels.includes(absent), false, `${absent} 不应出现在读数里`);
  }
});

test('Vercel 解析失败时回显结构骨架，只含键名不含数值', () => {
  assert.equal(
    describeShape({ data: { activeCpu: 2, note: 'x' }, list: [1, 2] }),
    '{ data: { activeCpu: number, note: string }, list: [number] }',
  );
  assert.equal(describeShape(null), 'null');
  assert.equal(describeShape([]), '[]');
});

/** 用一次性的 fetch 替身驱动适配器；每次调用都返回全新的 Response（响应体只能读一次）。 */
async function withStubbedFetch<T>(
  handler: (url: string) => { status: number; body: unknown },
  run: () => Promise<T>,
): Promise<{ result: T; calls: string[] }> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

/** 按 type 返回不同响应体：requests 与 builds 各一次请求。 */
function typeAware(url: string): { status: number; body: unknown } {
  const isBuilds = /[?&]type=builds/.test(url);
  return {
    status: 200,
    body: {
      granularity: 'day',
      lastUpdate: '2026-10-01T00:00:00Z',
      data: isBuilds ? BUILDS_BUCKETS : REQUESTS_BUCKETS,
    },
  };
}

test('Vercel 请求: 两类各一次且都带 type/from/to；team_ 走 teamId，其它走 slug', async () => {
  const plain = await withStubbedFetch(typeAware, () =>
    collectVercelUsage({ token: 't', now: Date.parse('2026-10-01T12:00:00Z') }),
  );
  assert.equal(plain.calls.length, VERCEL_USAGE_TYPES.length);
  for (const type of VERCEL_USAGE_TYPES) {
    assert.ok(
      plain.calls.some((url) => url.includes(`type=${type}`)),
      `缺少 type=${type} 的请求`,
    );
  }
  for (const url of plain.calls) {
    assert.match(url, /[?&]from=/);
    assert.match(url, /[?&]to=/);
    assert.equal(/[?&](teamId|slug)=/.test(url), false);
  }

  const byId = await withStubbedFetch(typeAware, () => collectVercelUsage({ token: 't', teamId: 'team_abc123' }));
  for (const url of byId.calls) {
    assert.match(url, /[?&]teamId=team_abc123/);
    assert.equal(/[?&]slug=/.test(url), false);
  }

  const bySlug = await withStubbedFetch(typeAware, () =>
    collectVercelUsage({ token: 't', teamId: 'jinzhiyuan0327s-projects' }),
  );
  for (const url of bySlug.calls) {
    assert.match(url, /[?&]slug=jinzhiyuan0327s-projects/);
    assert.equal(/[?&]teamId=/.test(url), false);
  }
  // slug 形态下给出团队用量页地址，而不是通用的 dashboard 地址。
  assert.equal(bySlug.result.consoleUrl, 'https://vercel.com/jinzhiyuan0327s-projects/~/usage');
});

test('Vercel 端到端: 两类响应合并成完整指标清单', async () => {
  const { result } = await withStubbedFetch(typeAware, () =>
    collectVercelUsage({ token: 't', now: Date.parse('2026-10-01T12:00:00Z') }),
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.observedAt, Date.parse('2026-10-01T12:00:00Z'));
  assert.equal(result.metrics.length, VERCEL_METRICS.length);
  const byKey = new Map(result.metrics.map((metric) => [metric.key, metric]));
  assert.equal(byKey.get('cdn_requests')?.used, 1_401_938);
  assert.equal(byKey.get('bandwidth_outgoing')?.used, 3.441);
  assert.equal(byKey.get('build_minutes')?.used, 11);
  assert.match(result.message, /不提供额度上限/);
});

test('Vercel 失败态: 403 凭据问题、400 带出平台原话、空列表与未知结构各有提示', async () => {
  const forbidden = await withStubbedFetch(
    () => ({ status: 403, body: { error: { message: 'forbidden' } } }),
    () => collectVercelUsage({ token: 'bad' }),
  );
  assert.equal(forbidden.result.status, 'credential_error');

  const badRequest = await withStubbedFetch(
    () => ({ status: 400, body: { error: { message: 'Invalid request: missing required property `type`.' } } }),
    () => collectVercelUsage({ token: 't' }),
  );
  assert.equal(badRequest.result.status, 'error');
  assert.match(badRequest.result.message, /missing required property/);

  const empty = await withStubbedFetch(
    () => ({ status: 200, body: { granularity: 'day', lastUpdate: '2026-10-01T00:00:00Z', data: [] } }),
    () => collectVercelUsage({ token: 't' }),
  );
  assert.equal(empty.result.status, 'unsupported');
  assert.match(empty.result.message, /用量列表为空/);

  const unknown = await withStubbedFetch(
    () => ({ status: 200, body: { granularity: 'day', rows: [] } }),
    () => collectVercelUsage({ token: 't' }),
  );
  assert.equal(unknown.result.status, 'error');
  assert.match(unknown.result.message, /rows/);
});

/** Neon 侧的分路响应：按路径返回组织、项目列表、项目详情与分支。 */
function neonRouter(routes: { orgs?: unknown; projects?: unknown; detail?: unknown; branches?: unknown }) {
  return (url: string) => {
    const parsed = new URL(url);
    const target = parsed.pathname + parsed.search;
    if (target.includes('/users/me/organizations')) {
      return { status: 200, body: { organizations: routes.orgs ?? [] } };
    }
    if (target.includes('/projects?')) return { status: 200, body: { projects: routes.projects ?? [] } };
    if (target.includes('/branches')) return { status: 200, body: { branches: routes.branches ?? [] } };
    return { status: 200, body: { project: routes.detail ?? {} } };
  };
}

test('Neon 多组织: 报错时直接把候选组织列出来，而不是只说「请指定」', async () => {
  const { result } = await withStubbedFetch(
    neonRouter({
      orgs: [
        { id: 'org-gentle-sun-57375728', name: "Vercel: jinzhiyuan0327's projects", plan: 'free' },
        { id: 'org-super-dream-44126879', name: 'jinzhiyuan0327@163.com', plan: 'free' },
      ],
    }),
    () => collectNeonUsage({ apiKey: 'k' }),
  );
  assert.equal(result.status, 'error');
  assert.match(result.message, /org-gentle-sun-57375728/);
  assert.match(result.message, /org-super-dream-44126879/);
  assert.match(result.message, /请在设置里填写组织 ID/);
});

test('Neon 免费版: 只报能读到的存储，Compute 与流量不摆 0 出来', async () => {
  const { result } = await withStubbedFetch(
    neonRouter({
      orgs: [{ id: 'org-super-dream-44126879', name: 'jinzhiyuan0327@163.com', plan: 'free' }],
      projects: [{ id: 'shy-wave-87367033', name: 'novora-future' }],
      detail: {
        name: 'novora-future',
        consumption_period_start: '2026-10-01T00:00:00Z',
        consumption_period_end: '2026-11-01T00:00:00Z',
        // 免费版实测：这些恒为 0。
        compute_time_seconds: 0,
        data_transfer_bytes: 0,
        synthetic_storage_size: 33_480_704,
      },
      branches: [{ id: 'br-1', name: 'production', logical_size: 33_480_704 }],
    }),
    () => collectNeonUsage({ apiKey: 'k', now: Date.parse('2026-10-01T12:00:00Z') }),
  );

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.metrics, [
    {
      key: 'storage',
      label: 'Storage（分支逻辑大小）',
      used: 0.033,
      limit: 0.5,
      unit: 'GB',
      percent: 6.6,
      note: '项目：novora-future',
    },
  ]);
  assert.match(result.message, /恒为 0/);
  assert.equal(result.periodStart, '2026-10-01T00:00:00Z');
  assert.equal(result.consoleUrl, 'https://console.neon.tech/app/projects/shy-wave-87367033');
});
