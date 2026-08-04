import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  handlePluginApi,
  handlePluginPairStart,
  handlePluginPairInfo,
  handlePluginViewerHeartbeat,
} from '../api/_exams/routes/pluginRoutes.js';
import {
  handleDeviceBindings,
  handleDeviceBindingOptions,
} from '../api/_exams/routes/deviceAdminRoutes.js';
import {
  handleDeviceBinding,
  handleDeviceHeartbeat,
} from '../api/_exams/routes/deviceSelfRoutes.js';

// 这些测试只覆盖各路由处理函数中"命中数据库之前"就会返回的纯校验分支
// （方法校验、必填字段/格式校验），因为测试沙箱没有真实数据库可用。
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/novora_test';

function makeRes() {
  const calls: { statusCode?: number; body?: any; headers: Record<string, unknown> } = {
    statusCode: undefined,
    body: undefined,
    headers: {},
  };
  const res: VercelResponse = {
    setHeader(name: string, value: any) {
      calls.headers[name] = value;
      return res;
    },
    getHeader(_name: string) {
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

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'GET',
    headers: {},
    query: {},
    body: {},
    cookies: {},
    ...overrides,
  } as VercelRequest;
}

test('handlePluginApi: GET returns ClassIsland API metadata', async () => {
  const { res, calls } = makeRes();
  await handlePluginApi(makeReq({ method: 'GET' }), res);
  assert.equal(calls.statusCode, 200);
  assert.equal(calls.body.ok, true);
  assert.equal(typeof calls.body.apiVersion, 'number');
});

test('handlePluginApi: non-GET is rejected with 405 before touching the database', async () => {
  const { res, calls } = makeRes();
  await handlePluginApi(makeReq({ method: 'POST' }), res);
  assert.equal(calls.statusCode, 405);
  assert.equal(calls.body.ok, false);
});

test('handlePluginPairStart: non-POST is rejected with 405 before touching the database', async () => {
  const { res, calls } = makeRes();
  await handlePluginPairStart(makeReq({ method: 'GET' }), res);
  assert.equal(calls.statusCode, 405);
});

test('handlePluginPairStart: malformed plugin credentials are rejected with 400', async () => {
  const { res, calls } = makeRes();
  await handlePluginPairStart(
    makeReq({ method: 'POST', body: { pluginInstanceId: 'short', clientSecret: 'nope' } }),
    res,
  );
  assert.equal(calls.statusCode, 400);
  assert.equal(calls.body.ok, false);
});

test('handlePluginPairInfo: non-GET is rejected with 405', async () => {
  const { res, calls } = makeRes();
  await handlePluginPairInfo(makeReq({ method: 'POST' }), res);
  assert.equal(calls.statusCode, 405);
});

test('handlePluginPairInfo: an invalid pairing token format is rejected with 400', async () => {
  const { res, calls } = makeRes();
  await handlePluginPairInfo(makeReq({ method: 'GET', query: { token: 'not-a-valid-token' } }), res);
  assert.equal(calls.statusCode, 400);
});

test('handlePluginViewerHeartbeat: non-POST is rejected with 405', async () => {
  const { res, calls } = makeRes();
  await handlePluginViewerHeartbeat(makeReq({ method: 'GET' }), res);
  assert.equal(calls.statusCode, 405);
});

test('handlePluginViewerHeartbeat: an invalid plugin instance id is rejected with 400', async () => {
  const { res, calls } = makeRes();
  await handlePluginViewerHeartbeat(
    makeReq({ method: 'POST', body: { pluginInstanceId: 'x' } }),
    res,
  );
  assert.equal(calls.statusCode, 400);
});

test('handleDeviceBindings: non-GET is rejected with 405 before touching the database', async () => {
  const { res, calls } = makeRes();
  await handleDeviceBindings(makeReq({ method: 'POST' }), res);
  assert.equal(calls.statusCode, 405);
});

test('handleDeviceBindingOptions: non-GET is rejected with 405', async () => {
  const { res, calls } = makeRes();
  await handleDeviceBindingOptions(makeReq({ method: 'POST' }), res);
  assert.equal(calls.statusCode, 405);
});

test('handleDeviceBindingOptions: GET without instanceId is rejected with 400', async () => {
  const { res, calls } = makeRes();
  await handleDeviceBindingOptions(makeReq({ method: 'GET', query: {} }), res);
  assert.equal(calls.statusCode, 400);
});

test('handleDeviceBinding: missing instanceId on GET is rejected with 400', async () => {
  const { res, calls } = makeRes();
  await handleDeviceBinding(makeReq({ method: 'GET', query: {} }), res);
  assert.equal(calls.statusCode, 400);
});

test('handleDeviceBinding: missing instanceId on POST is rejected with 400', async () => {
  const { res, calls } = makeRes();
  await handleDeviceBinding(makeReq({ method: 'POST', body: {} }), res);
  assert.equal(calls.statusCode, 400);
});

test('handleDeviceHeartbeat: missing instanceId is rejected with 400', async () => {
  const { res, calls } = makeRes();
  await handleDeviceHeartbeat(makeReq({ method: 'POST', body: {} }), res);
  assert.equal(calls.statusCode, 400);
});
