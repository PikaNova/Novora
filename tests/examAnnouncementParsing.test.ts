import assert from 'node:assert/strict';
import test from 'node:test';
// 先装浏览器常量/存储，再引服务（ESM 按 import 顺序求值）。
import './helpers/browserGlobals.js';

const { ANNOUNCEMENT_LEVELS, ANNOUNCEMENT_SCOPE_TYPES, ANNOUNCEMENT_STATUSES } =
  await import('../src/shared/examAnnouncementContracts.js');
const { fetchDeviceExamAnnouncements } = await import('../src/services/examAnnouncements.js');

/**
 * 公告解析的契约一致性。
 *
 * 踩过的坑（考试记录那条线）：客户端手抄的枚举白名单比服务端少一项，
 * 服务端一返回新值，客户端就静默处理成别的语义。
 * 公告这边更危险：范围写错等于把定向公告当全校广播发出去。
 * 所以这里保证契约里的每个取值都能原样解析回来。
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function announcementRow(overrides: Record<string, unknown>): Record<string, unknown> {
  const now = 1_790_000_000_000;
  return {
    id: 'ann-1',
    title: '公告',
    body: '正文',
    level: 'normal',
    style: 'card',
    status: 'active',
    examId: null,
    scopeType: 'all',
    scopeIds: [],
    createdBy: 1,
    createdAt: now,
    expiresAt: now + 3_600_000,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

async function parseAll(rows: Array<Record<string, unknown>>) {
  globalThis.fetch = (async () => jsonResponse({ ok: true, data: rows })) as typeof fetch;
  try {
    return await fetchDeviceExamAnnouncements('device-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('公告范围：契约里的每种范围都原样解析，不会被改写成全校', async () => {
  const rows = ANNOUNCEMENT_SCOPE_TYPES.map((scopeType, index) =>
    announcementRow({
      id: `ann-${scopeType}`,
      scopeType,
      scopeIds: scopeType === 'all' ? [] : ['g1'],
      sortOrder: index,
    }),
  );
  const parsed = await parseAll(rows);
  assert.deepEqual(
    parsed.map((item) => item.scopeType).sort(),
    [...ANNOUNCEMENT_SCOPE_TYPES].sort(),
    '每种范围都要保留原值',
  );
});

test('公告级别与状态：契约里的每种取值都原样解析', async () => {
  const rows = [
    ...ANNOUNCEMENT_LEVELS.map((level, index) =>
      announcementRow({ id: `ann-level-${level}`, level, sortOrder: index }),
    ),
    ...ANNOUNCEMENT_STATUSES.map((status, index) =>
      announcementRow({ id: `ann-status-${status}`, status, sortOrder: 10 + index }),
    ),
  ];
  const parsed = await parseAll(rows);
  assert.deepEqual(
    [...new Set(parsed.map((item) => item.level))].sort(),
    [...ANNOUNCEMENT_LEVELS].sort(),
    '级别不能丢值',
  );
  assert.deepEqual(
    [...new Set(parsed.map((item) => item.status))].sort(),
    [...ANNOUNCEMENT_STATUSES].sort(),
    '状态要原样保留，不要被 expiresAt 兜底覆盖',
  );
});

test('公告范围：服务端出现客户端不认识的新值时不静默改语义（回落到全校并保留可读性）', async () => {
  const parsed = await parseAll([announcementRow({ id: 'ann-building', scopeType: 'building', scopeIds: ['b1'] })]);
  assert.equal(parsed.length, 1, '不认识的取值也要保留公告本身，不能整条丢掉');
  assert.equal(parsed[0].scopeType, 'all', '未知范围回落成全校（并会打 warn，便于发现契约漂移）');
});
