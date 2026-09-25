import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleDeviceCommand, handleDeviceRevoke } from '../api/_exams/routes/deviceAdminRoutes.js';
import { handleDeviceBinding } from '../api/_exams/routes/deviceSelfRoutes.js';

process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/novora_test';

function makeRes() {
  const calls: { statusCode?: number; body?: unknown } = {};
  const res: VercelResponse = {
    setHeader() {
      return res;
    },
    getHeader() {
      return undefined;
    },
    status(code: number) {
      calls.statusCode = code;
      return res;
    },
    json(body: unknown) {
      calls.body = body;
      return res;
    },
    send(body: unknown) {
      calls.body = body;
      return res;
    },
    end() {},
  } as unknown as VercelResponse;
  return { res, calls };
}

function makeReq(body: Record<string, unknown>): VercelRequest {
  return { method: 'POST', headers: {}, query: {}, body, cookies: {} } as VercelRequest;
}

test('invalid device commands return 400 before a write slot can be acquired', async () => {
  const { res, calls } = makeRes();
  await handleDeviceCommand(makeReq({ instanceId: 'device-1', commandAction: 'invalid' }), res);
  assert.equal(calls.statusCode, 400);
});

test('empty device revoke returns 400 before a write slot can be acquired', async () => {
  const { res, calls } = makeRes();
  await handleDeviceRevoke(makeReq({}), res);
  assert.equal(calls.statusCode, 400);
});

test('incomplete self-binding returns 400 before a write slot can be acquired', async () => {
  const { res, calls } = makeRes();
  await handleDeviceBinding(makeReq({ instanceId: 'device-1' }), res);
  assert.equal(calls.statusCode, 400);
});
