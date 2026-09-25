import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * 学校端「检查更新」必须优先读作者端发布清单：GitHub 只答版本号，
 * 答不了「拉哪个镜像、digest 是多少、当前 schema 是否达标」，而国内学校网络
 * 通常也直连不通 GitHub。这里锁住顺序与错误语义。
 */

const AUTHOR_MANIFEST_URL = 'https://telemetry.pikachu2026.space/api/releases/latest.json';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const calls: string[] = [];
let authorHandler: () => Response = () => jsonResponse({ ok: false }, 502);
let githubHandler: () => Response = () => jsonResponse({ ok: false }, 500);

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  calls.push(url);
  if (url.startsWith(AUTHOR_MANIFEST_URL)) return authorHandler();
  return githubHandler();
}) as typeof fetch;

const { handleUpdateCheck: handler } = await import('../api/_system/updateCheck.js');

function createRequest() {
  return { method: 'GET', headers: {}, query: { current: '2.7.5' } };
}

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

test('author release manifest wins and carries image / digest / minSchema', async () => {
  calls.length = 0;
  authorHandler = () =>
    jsonResponse({
      ok: true,
      origin: 'registry',
      version: '2.7.6',
      channel: 'stable',
      image: 'ghcr.io/pikanova/novora:2.7.6',
      digest: `sha256:${'a'.repeat(64)}`,
      minSchema: '13',
      notes: '更新说明',
      publishedAt: '2026-09-12T10:00:00.000Z',
      releaseUrl: 'https://github.com/PikaNova/Novora/releases/tag/v2.7.6',
      warnings: [],
    });
  githubHandler = () => {
    throw new Error('GitHub 不应该被调用');
  };

  const res = createResponse();
  await handler(createRequest() as never, res as never);

  const body = res.body as Record<string, unknown>;
  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.latest, '2.7.6');
  assert.equal(body.hasUpdate, true);
  assert.equal(body.origin, 'registry');
  assert.equal(body.source, 'registry');
  assert.equal(body.image, 'ghcr.io/pikanova/novora:2.7.6');
  assert.equal(body.digest, `sha256:${'a'.repeat(64)}`);
  assert.equal(body.minSchema, '13');
  assert.equal(body.schemaReady, false);
  assert.equal(calls.length, 1);
});

test('author manifest failure falls back to GitHub with an explicit warning', async () => {
  calls.length = 0;
  authorHandler = () => jsonResponse({ ok: false, error: '作者端库故障' }, 502);
  githubHandler = () =>
    jsonResponse({ tag_name: 'v2.7.6', body: 'release notes', published_at: '2026-09-12T10:00:00.000Z' });

  const res = createResponse();
  await handler(createRequest() as never, res as never);

  const body = res.body as Record<string, unknown>;
  assert.equal(res.statusCode, 200);
  assert.equal(body.latest, '2.7.6');
  assert.equal(body.origin, 'github');
  assert.equal(body.image, null);
  assert.equal(body.digest, null);
  assert.ok((body.warnings as string[]).length > 0);
  assert.ok((body.warnings as string[])[0].includes('作者端'));
});

test('both sources unavailable returns an error instead of "already latest"', async () => {
  calls.length = 0;
  authorHandler = () => jsonResponse({ ok: false }, 502);
  githubHandler = () => jsonResponse({ message: 'rate limited' }, 403);

  // 换一个仓库名绕开上一条用例填充的 GitHub 结果缓存（缓存键是 owner/repo）。
  const originalRepo = process.env.GITHUB_REPO;
  process.env.GITHUB_REPO = 'PikaNova/Novora-offline-check';
  try {
    const res = createResponse();
    await handler(createRequest() as never, res as never);

    const body = res.body as Record<string, unknown>;
    assert.equal(res.statusCode, 502);
    assert.equal(body.ok, false);
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
  } finally {
    if (originalRepo == null) delete process.env.GITHUB_REPO;
    else process.env.GITHUB_REPO = originalRepo;
  }
});
