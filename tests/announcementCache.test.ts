import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnnouncementCache } from '../api/_content/announcementCache.js';
import announcementHandler from '../api/announcements.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const UPSTREAM = 'https://ann-cache-a.test/api/public-announcements';

test('concurrent callers share one author request; cached reads do not refetch', async () => {
  const read = createAnnouncementCache();
  let calls = 0;
  let finish!: (value: Record<string, unknown>[]) => void;
  const load = () => {
    calls++;
    return new Promise<Record<string, unknown>[]>((resolve) => {
      finish = resolve;
    });
  };
  const results = [read(UPSTREAM, load), read(UPSTREAM, load), read(UPSTREAM, load)];
  assert.equal(calls, 1);
  finish([{ id: 1 }]);
  await Promise.all(results);
  assert.deepEqual(await read(UPSTREAM, load), [{ id: 1 }]);
  assert.equal(calls, 1);
});

test('a different upstream address is a different cache entry, never reused', async () => {
  const read = createAnnouncementCache();
  const seen: string[] = [];
  const loader = (url: string) => async () => {
    seen.push(url);
    return [{ id: seen.length }];
  };
  await read(UPSTREAM, loader('a'));
  assert.deepEqual(await read('https://ann-cache-b.test/api/public-announcements', loader('b')), [{ id: 2 }]);
  // 作者端把公告域名切走时必须立刻打新地址；沿用旧地址会让换域名拖到 TTL 到期。
  assert.deepEqual(seen, ['a', 'b']);
});

test('failed author request releases the shared flight and does not cache an empty list', async () => {
  const read = createAnnouncementCache();
  await assert.rejects(
    read(UPSTREAM, async () => {
      throw new Error('offline');
    }),
    /offline/,
  );
  assert.deepEqual(await read(UPSTREAM, async () => [{ id: 2 }]), [{ id: 2 }]);
});

test('expired cache refreshes and a successful empty list replaces withdrawn announcements', async () => {
  const read = createAnnouncementCache(1);
  await read(UPSTREAM, async () => [{ id: 1 }]);
  assert.deepEqual(await read(UPSTREAM, async () => [], Date.now() + 10), []);
});

type Recorded = { status?: number; body: Record<string, unknown> };

function makeResponse(sink: Recorded[]): VercelResponse {
  let status: number | undefined;
  return {
    setHeader() {
      return this;
    },
    status(value: number) {
      status = value;
      return this;
    },
    json(body: Record<string, unknown>) {
      sink.push({ status, body });
      return this;
    },
  } as unknown as VercelResponse;
}

/** 只数公告列表请求：作者配置请求走同一个前缀，计入会把「共享一次」的断言变成噪声。 */
function countAnnouncementCalls(fetches: string[]): number {
  return fetches.filter((url) => !url.includes('resource=config')).length;
}

test('announcement proxy shares upstream requests across limits and excludes expired notices', async () => {
  const original = globalThis.fetch;
  const announceUrl = 'https://ann-share.test/api/public-announcements';
  process.env.TELEMETRY_ANNOUNCE_URL = announceUrl;
  const fetches: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    fetches.push(url);
    if (url.includes('resource=config'))
      return new Response(JSON.stringify({ ok: true, config: {} }), {
        headers: { 'Content-Type': 'application/json' },
      });
    return new Response(
      JSON.stringify({
        ok: true,
        announcements: [
          { id: 1, content: 'active', unpublish_at: Date.now() + 60_000 },
          { id: 2, content: 'expired', unpublish_at: Date.now() - 1 },
          { id: 3, content: 'scheduled', publish_at: Date.now() + 60_000 },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
  const responses: Recorded[] = [];
  try {
    await Promise.all(
      [20, 30].map((limit) =>
        announcementHandler(
          { method: 'GET', url: '/api/announcements', query: { limit: String(limit) } } as unknown as VercelRequest,
          makeResponse(responses),
        ),
      ),
    );
    assert.equal(countAnnouncementCalls(fetches), 1, '不同 limit 必须共用一次上游请求');
    assert.equal(responses.length, 2);
    for (const { status, body } of responses) {
      assert.equal(status, undefined, '成功路径不应显式设置状态码');
      assert.deepEqual(
        (body.announcements as Array<{ id: number }>).map((x) => x.id),
        [1],
      );
    }
  } finally {
    globalThis.fetch = original;
    delete process.env.TELEMETRY_ANNOUNCE_URL;
  }
});

test('upstream rejection still reports 502 upstream_failed instead of a local 500', async () => {
  const original = globalThis.fetch;
  // 换一个公告地址：上一个用例已经把成功结果缓存住，同址会直接命中缓存而打不到这个 mock。
  process.env.TELEMETRY_ANNOUNCE_URL = 'https://ann-502.test/api/public-announcements';
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('resource=config'))
      return new Response(JSON.stringify({ ok: true, config: {} }), {
        headers: { 'Content-Type': 'application/json' },
      });
    return new Response(JSON.stringify({ ok: false }), { status: 403 });
  }) as typeof fetch;
  const responses: Recorded[] = [];
  try {
    await announcementHandler(
      { method: 'GET', url: '/api/announcements', query: {} } as unknown as VercelRequest,
      makeResponse(responses),
    );
    assert.equal(responses.length, 1);
    assert.equal(responses[0].status, 502);
    assert.deepEqual(responses[0].body, { ok: false, error: 'upstream_failed', status: 403, announcements: [] });
  } finally {
    globalThis.fetch = original;
    delete process.env.TELEMETRY_ANNOUNCE_URL;
  }
});
