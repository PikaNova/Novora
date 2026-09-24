/**
 * 学校公告的真实库集成测试（T-286-03 二期：展示样式、正文图片、撤回）。
 *
 * 覆盖三类断言：样式与状态口径、图片上传/取回/校验、撤回后教室端不再收到。
 * 只跑在 runner 注入的 disposable 库（INTEGRATION_DATABASE_URL）上。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, ensureAuthTables } from '../../api/_auth.js';
import { database, ensureTableOnce } from '../../api/_exams/db.js';
import { handleExamAnnouncementRoute } from '../../api/_exams/routes/examAnnouncementRoutes.js';
import { __resetRateLimiterForTests } from '../../api/_rateLimiter.js';
import examsHandler from '../../api/exams.js';

type Login = { id: number; token: string };

const adminPassword = process.env.ADMIN_PASSWORD ?? '';
/** 1×1 的透明 PNG；服务端只校验 MIME 与大小，这里用真实文件更贴近现场。 */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let admin: Login;

function makeRes() {
  const calls: { statusCode?: number; body: Record<string, unknown>; headers: Record<string, unknown> } = {
    body: {},
    headers: {},
  };
  const res: VercelResponse = {
    setHeader(name: string, value: unknown) {
      calls.headers[name] = value;
      return res;
    },
    getHeader(name: string) {
      return calls.headers[name];
    },
    status(code: number) {
      calls.statusCode = code;
      return res;
    },
    json(body: unknown) {
      calls.statusCode ??= 200;
      calls.body = body as Record<string, unknown>;
      return res;
    },
    send(body: unknown) {
      calls.statusCode ??= 200;
      calls.body = body as Record<string, unknown>;
      return res;
    },
    end() {
      calls.statusCode ??= 200;
      return res;
    },
  } as unknown as VercelResponse;
  return { res, calls };
}

function makeReq(
  method: 'GET' | 'POST',
  options: { token?: string; query?: Record<string, string>; body?: Record<string, unknown> } = {},
): VercelRequest {
  return {
    method,
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    query: options.query ?? {},
    cookies: {},
    body: options.body ?? {},
  } as unknown as VercelRequest;
}

function rows(calls: { body: Record<string, unknown> }): Array<Record<string, unknown>> {
  return Array.isArray(calls.body.data) ? (calls.body.data as Array<Record<string, unknown>>) : [];
}

function objectOf(calls: { body: Record<string, unknown> }): Record<string, unknown> {
  const value = calls.body.data;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function send(token: string, body: Record<string, unknown>, action = 'announce-send') {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(makeReq('POST', { token, body, query: { action } }), res, action);
  return calls;
}

async function list(token: string, query: Record<string, string>) {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(makeReq('GET', { token, query: { resource: 'announcements', ...query } }), res);
  return calls;
}

async function deviceList(instanceId: string) {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(makeReq('GET', { query: { resource: 'device-announcements', instanceId } }), res);
  return calls;
}

/** 经顶层 /api/exams 入口调用图片接口，顺带验证动作确实被路由表放行。 */
async function uploadImageThroughEntry(token: string, body: Record<string, unknown>) {
  __resetRateLimiterForTests();
  const { res, calls } = makeRes();
  await examsHandler(
    makeReq('POST', {
      token,
      query: { resource: 'announcement-image' },
      body: { action: 'announce-image-upload', ...body },
    }),
    res,
  );
  return calls;
}

async function fetchImage(id: string) {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(makeReq('GET', { query: { resource: 'announcement-image', id } }), res);
  return calls;
}

beforeEach(async () => {
  assert.ok(adminPassword.length >= 16, 'the integration runner must inject a strong temporary password');
  await ensureTableOnce();
  await ensureAuthTables();
  await database()`TRUNCATE TABLE exam_announcements, exam_announcement_images, device_instances RESTART IDENTITY CASCADE`;
  const login = await authenticateUser('admin', adminPassword);
  assert.ok(login, 'the integration runner must bootstrap the disposable super administrator');
  admin = { id: login.actor.id, token: login.token };
  __resetRateLimiterForTests();
});

after(async () => {
  await database()`TRUNCATE TABLE exam_announcements, exam_announcement_images RESTART IDENTITY CASCADE`;
});

test('公告：发送时保存展示样式，未知样式回落成标准卡片', async () => {
  const sent = await send(admin.token, {
    title: '本场考试延长 15 分钟',
    body: '## 注意\n\n- 交卷时间顺延',
    level: 'normal',
    style: 'poster',
    scopeType: 'all',
    expiresInMinutes: 120,
  });
  assert.equal(sent.statusCode, 200);
  assert.equal(objectOf(sent).style, 'poster');
  assert.equal(objectOf(sent).status, 'active');

  const fallback = await send(admin.token, {
    title: '样式异常',
    body: '样式字段不认识时按标准卡片处理',
    style: 'neon',
    scopeType: 'all',
    expiresInMinutes: 30,
  });
  assert.equal(objectOf(fallback).style, 'card');

  const active = await list(admin.token, { status: 'active' });
  assert.equal(rows(active).length, 2);
  const styles = rows(active)
    .map((row) => row.style)
    .sort();
  assert.deepEqual(styles, ['card', 'poster']);

  const revoked = await list(admin.token, { status: 'revoked' });
  assert.equal(rows(revoked).length, 0);
});

test('公告：列表按级别与范围筛选，越界样式字段不影响其它记录', async () => {
  await send(admin.token, { title: '紧急', body: '停考', level: 'urgent', scopeType: 'all' });
  await send(admin.token, { title: '班级通知', body: 'a', level: 'normal', scopeType: 'class', scopeIds: ['c1'] });

  const urgent = await list(admin.token, { level: 'urgent' });
  assert.equal(rows(urgent).length, 1);
  assert.equal(rows(urgent)[0].title, '紧急');

  const classScoped = await list(admin.token, { scope: 'class' });
  assert.equal(rows(classScoped).length, 1);
  assert.equal(rows(classScoped)[0].scopeType, 'class');

  const everything = await list(admin.token, { scope: 'any', status: 'all' });
  assert.equal(rows(everything).length, 2);
});

test('公告：图片上传后可按 id 取回，非法类型与超限都被拒绝', async () => {
  const uploaded = await uploadImageThroughEntry(admin.token, {
    filename: 'spot.png',
    mimeType: 'image/png',
    base64: PNG_BASE64,
  });
  assert.equal(uploaded.statusCode, 200);
  const image = uploaded.body.image as Record<string, unknown>;
  assert.ok(Number(image.id) > 0, 'upload must return the stored image id');
  assert.match(String(image.url), /^\/api\/exams\?resource=announcement-image&id=\d+$/);

  const fetched = await fetchImage(String(image.id));
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.headers['Content-Type'], 'image/png');
  assert.ok((fetched.body as unknown as Buffer).length > 0, 'GET must return the stored bytes');

  const badType = await uploadImageThroughEntry(admin.token, {
    filename: 'x.svg',
    mimeType: 'image/svg+xml',
    base64: PNG_BASE64,
  });
  assert.equal(badType.statusCode, 400);
  assert.equal(badType.body.code, 'INVALID_IMAGE_TYPE');

  const tooBig = await uploadImageThroughEntry(admin.token, {
    filename: 'huge.png',
    mimeType: 'image/png',
    base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'),
  });
  assert.equal(tooBig.statusCode, 400);
  assert.equal(tooBig.body.code, 'INVALID_IMAGE_SIZE');

  const missing = await fetchImage('999999');
  assert.equal(missing.statusCode, 404);
});

test('公告：撤回后教室端不再收到，记录仍可在列表里追溯', async () => {
  await database()`
    INSERT INTO device_instances (instance_id, grade_id, class_id, revoked, is_management, updated_at)
    VALUES ('sann-device-1', 'g1', 'c1', FALSE, FALSE, ${Date.now()})
  `;
  const sent = await send(admin.token, {
    title: '明天停课',
    body: '请同学按时离校',
    level: 'urgent',
    style: 'bulletin',
    scopeType: 'class',
    scopeIds: ['c1'],
    expiresInMinutes: 0,
  });
  const id = String(objectOf(sent).id);

  const before = await deviceList('sann-device-1');
  assert.equal(rows(before).length, 1);
  assert.equal(rows(before)[0].style, 'bulletin');
  assert.equal(rows(before)[0].status, 'active');

  const revoked = await send(admin.token, { id }, 'announce-revoke');
  assert.equal(revoked.statusCode, 200);
  assert.equal(objectOf(revoked).status, 'revoked');

  const after = await deviceList('sann-device-1');
  assert.equal(rows(after).length, 0);

  const history = await list(admin.token, { status: 'revoked' });
  assert.equal(rows(history).length, 1);
  assert.equal(rows(history)[0].id, id);
});
