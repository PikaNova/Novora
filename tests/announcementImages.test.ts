import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAnnouncementImages } from '../api/_content/announcementImages.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const IMAGES_URL = 'https://images-proxy.test/api/announcement-images';

type Recorded = { status?: number; headers: Record<string, string>; body?: unknown };

function makeResponse(sink: Recorded[]): VercelResponse {
  let status: number | undefined;
  const headers: Record<string, string> = {};
  return {
    setHeader(name: string, value: string) {
      headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    status(value: number) {
      status = value;
      return this;
    },
    json(body: unknown) {
      sink.push({ status, headers, body });
      return this;
    },
    send(body: unknown) {
      sink.push({ status, headers, body });
      return this;
    },
  } as unknown as VercelResponse;
}

function request(id = '12'): VercelRequest {
  return { method: 'GET', query: { id } } as unknown as VercelRequest;
}

function fakeUpstream(options: { contentType: string; body?: Uint8Array; contentLength?: string }): Response {
  return {
    ok: true,
    headers: new Headers({
      'Content-Type': options.contentType,
      ...(options.contentLength ? { 'Content-Length': options.contentLength } : {}),
    }),
    arrayBuffer: async () => options.body ?? new Uint8Array(0),
  } as unknown as Response;
}

async function withFetch(
  handler: (input: string | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  process.env.TELEMETRY_IMAGES_URL = IMAGES_URL;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    if (String(input).includes('resource=config'))
      return new Response(JSON.stringify({ ok: true, config: {} }), {
        headers: { 'Content-Type': 'application/json' },
      });
    return handler(input, init);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
    delete process.env.TELEMETRY_IMAGES_URL;
  }
}

test('image proxy forwards an image with a timeout and cache headers', async () => {
  const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  let sawSignal = false;
  await withFetch(
    async (_input, init) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return fakeUpstream({ contentType: 'image/png', body, contentLength: '4' });
    },
    async () => {
      const responses: Recorded[] = [];
      await handleAnnouncementImages(request(), makeResponse(responses));
      assert.equal(responses.length, 1);
      assert.equal(responses[0].status, 200);
      assert.equal(responses[0].headers['content-type'], 'image/png');
      assert.match(responses[0].headers['cache-control'], /max-age=86400/);
      assert.deepEqual(Buffer.from(responses[0].body as Uint8Array), Buffer.from(body));
    },
  );
  assert.equal(sawSignal, true, 'upstream fetch must carry the timeout signal');
});

test('image proxy rejects a non-image upstream response', async () => {
  await withFetch(
    async () => fakeUpstream({ contentType: 'text/html; charset=utf-8', body: new Uint8Array([1]) }),
    async () => {
      const responses: Recorded[] = [];
      await handleAnnouncementImages(request(), makeResponse(responses));
      assert.equal(responses[0].status, 502);
      assert.deepEqual(responses[0].body, { ok: false, error: 'upstream_invalid_type' });
    },
  );
});

test('image proxy rejects an oversized upstream response before buffering it', async () => {
  await withFetch(
    async () =>
      fakeUpstream({
        contentType: 'image/png',
        contentLength: String(10 * 1024 * 1024 + 1),
      }),
    async () => {
      const responses: Recorded[] = [];
      await handleAnnouncementImages(request(), makeResponse(responses));
      assert.equal(responses[0].status, 502);
      assert.deepEqual(responses[0].body, { ok: false, error: 'upstream_too_large' });
    },
  );
});

test('image proxy rejects an oversized body when the upstream omits content-length', async () => {
  await withFetch(
    async () =>
      fakeUpstream({
        contentType: 'image/png',
        body: new Uint8Array(10 * 1024 * 1024 + 1),
      }),
    async () => {
      const responses: Recorded[] = [];
      await handleAnnouncementImages(request(), makeResponse(responses));
      assert.equal(responses[0].status, 502);
      assert.deepEqual(responses[0].body, { ok: false, error: 'upstream_too_large' });
    },
  );
});

test('image proxy reports an upstream timeout as 504', async () => {
  await withFetch(
    async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    },
    async () => {
      const responses: Recorded[] = [];
      await handleAnnouncementImages(request(), makeResponse(responses));
      assert.equal(responses[0].status, 504);
      assert.deepEqual(responses[0].body, { ok: false, error: 'upstream_timeout' });
    },
  );
});
