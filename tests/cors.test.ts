import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../api/_cors.js';

function responseDouble() {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown;
  let ended = false;
  const response = {
    getHeader(name: string) { return headers.get(name); },
    setHeader(name: string, value: string | number | readonly string[]) { headers.set(name, String(value)); return response; },
    status(code: number) { statusCode = code; return response; },
    json(value: unknown) { body = value; return response; },
    end() { ended = true; return response; },
  };
  return { response: response as unknown as VercelResponse, headers, state: () => ({ statusCode, body, ended }) };
}

function request(method: string, origin?: string): VercelRequest {
  return { method, headers: { host: 'novora.example', origin, 'x-forwarded-proto': 'https' } } as unknown as VercelRequest;
}

test('allows same-origin requests and varies cached responses by Origin', () => {
  const target = responseDouble();
  assert.equal(applyCors(request('GET', 'https://novora.example'), target.response, { methods: ['GET'] }), true);
  assert.equal(target.headers.get('Access-Control-Allow-Origin'), 'https://novora.example');
  assert.equal(target.headers.get('Vary'), 'Origin');
});

test('rejects untrusted origins', () => {
  const target = responseDouble();
  assert.equal(applyCors(request('POST', 'https://evil.example'), target.response, { methods: ['POST'] }), false);
  assert.equal(target.state().statusCode, 403);
  assert.deepEqual(target.state().body, { ok: false, code: 'ORIGIN_NOT_ALLOWED', error: 'Request origin is not allowed' });
});

test('supports public endpoints and preflight requests', () => {
  const publicTarget = responseDouble();
  assert.equal(applyCors(request('GET', 'https://any.example'), publicTarget.response, { methods: ['GET'], public: true }), true);
  assert.equal(publicTarget.headers.get('Access-Control-Allow-Origin'), '*');

  const preflightTarget = responseDouble();
  assert.equal(applyCors(request('OPTIONS', 'https://novora.example'), preflightTarget.response, { methods: ['POST'] }), false);
  assert.deepEqual(preflightTarget.state(), { statusCode: 204, body: undefined, ended: true });
});
