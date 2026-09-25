/**
 * 学校公告的真实库集成测试（T-286-03 二期：展示样式、正文图片、撤回）。
 *
 * 覆盖三类断言：样式与状态口径、图片上传/取回/校验、撤回后教室端不再收到。
 * 只跑在 runner 注入的 disposable 库（INTEGRATION_DATABASE_URL）上。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BUILTIN_ROLES, authenticateUser, authSql, ensureAuthTables, makePasswordHash } from '../../api/_auth.js';
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

async function deviceList(instanceId: string, extra: Record<string, string> = {}) {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(
    makeReq('GET', { query: { resource: 'device-announcements', instanceId, ...extra } }),
    res,
  );
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

/** 教室端回执上报（走真实的设备绑定校验）。 */
async function ack(instanceId: string, seen: Array<{ id: string; seenMs: number }>) {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(
    makeReq('POST', { body: { action: 'announce-ack', instanceId, seen } }),
    res,
    'announce-ack',
  );
  return calls;
}

/** 管理端回执明细。 */
async function receipts(token: string, id: string) {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(makeReq('GET', { token, query: { resource: 'announcement-receipts', id } }), res);
  return calls;
}

/** 管理端：提醒未读教室。 */
async function remind(token: string, id: string, scope: 'unseen' | 'all' = 'unseen') {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(
    makeReq('POST', { token, body: { action: 'announce-remind', id, scope } }),
    res,
    'announce-remind',
  );
  return calls;
}

/** 管理端：近 N 天统计。 */
async function fetchStats(token: string, days = 7) {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(
    makeReq('GET', { token, query: { resource: 'announcement-stats', days: String(days) } }),
    res,
  );
  return calls;
}

/** 管理端：模板列表。 */
async function listTemplates(token: string) {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(makeReq('GET', { token, query: { resource: 'announcement-templates' } }), res);
  return calls;
}

/** 管理端：模板保存 / 删除。 */
async function templateAction(token: string, action: string, body: Record<string, unknown>) {
  const { res, calls } = makeRes();
  await handleExamAnnouncementRoute(makeReq('POST', { token, body: { action, ...body } }), res, action);
  return calls;
}

async function bindDevice(instanceId: string, gradeId: string, classId: string, revoked = false) {
  await database()`
    INSERT INTO device_instances (instance_id, grade_id, class_id, revoked, is_management, client_version, last_seen_at, updated_at)
    VALUES (${instanceId}, ${gradeId}, ${classId}, ${revoked}, FALSE, '2.8.0', ${Date.now()}, ${Date.now()})
    ON CONFLICT (instance_id) DO UPDATE SET grade_id = EXCLUDED.grade_id, class_id = EXCLUDED.class_id, revoked = EXCLUDED.revoked
  `;
}

/** 内置角色（其它集成文件会清空 app_roles，这里照着重建）。 */
async function seedRoles() {
  const sql = authSql();
  const now = Date.now();
  for (const role of BUILTIN_ROLES) {
    await sql`
      INSERT INTO app_roles (id, name, description, permissions, built_in, created_at, updated_at)
      VALUES (${role.id}, ${role.name}, ${role.description}, ${JSON.stringify(role.permissions)}::jsonb, TRUE, ${now}, ${now})
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

/** 写入学校结构（回执接口用它把 classId 映射回 gradeId，从而判断账号范围）。 */
async function seedSchoolStructure() {
  const grades = [
    { id: 'g1', name: '高一' },
    { id: 'g2', name: '高二' },
  ];
  const classes = [
    { id: 'c1', gradeId: 'g1', name: '1班' },
    { id: 'c2', gradeId: 'g1', name: '2班' },
    { id: 'c9', gradeId: 'g2', name: '9班' },
  ];
  await database()`
    UPDATE exam_data SET grades = ${JSON.stringify(grades)}::jsonb, classes = ${JSON.stringify(classes)}::jsonb WHERE id = 1
  `;
}

beforeEach(async () => {
  assert.ok(adminPassword.length >= 16, 'the integration runner must inject a strong temporary password');
  await ensureTableOnce();
  await ensureAuthTables();
  // 鉴权表也要清：其它集成文件会改角色/令牌，留着会让下面的 admin 登录失败（同一 disposable 库共享）。
  await database()`
    TRUNCATE TABLE
      exam_announcements,
      exam_announcement_images,
      exam_announcement_receipts,
      device_instances,
      app_audit_logs,
      app_user_scopes,
      app_users,
      app_roles,
      app_auth,
      write_throttle
    RESTART IDENTITY CASCADE
  `;
  await database()`INSERT INTO write_throttle (id, next_allowed_at) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`;
  await seedRoles();
  const login = await authenticateUser('admin', adminPassword);
  assert.ok(login, 'the integration runner must bootstrap the disposable super administrator');
  admin = { id: login.actor.id, token: login.token };
  __resetRateLimiterForTests();
});

after(async () => {
  await database()`TRUNCATE TABLE exam_announcements, exam_announcement_images, exam_announcement_receipts RESTART IDENTITY CASCADE`;
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

// ===== 回执（设备口径，2026-09-25 定稿）：拉到算送达，看满 3 秒算已读 =====

test('回执：设备拉到算送达，上报后算已读，重复上报累加时长', async () => {
  await bindDevice('recv-dev-1', 'g1', 'c1');
  const sent = await send(admin.token, {
    title: '回执统计',
    body: '看满三秒才算已读',
    scopeType: 'class',
    scopeIds: ['c1'],
    expiresInMinutes: 0,
  });
  const id = String(objectOf(sent).id);

  // 还没拉取：应达 1 台，送达 0、已读 0
  const before = await list(admin.token, { status: 'active' });
  assert.equal(rows(before)[0].targetCount, 1);
  assert.equal(rows(before)[0].deliveredCount, 0);
  assert.equal(rows(before)[0].seenCount, 0);

  // 设备轮询拉到公告 → 送达
  const delivered = await deviceList('recv-dev-1');
  assert.equal(rows(delivered).length, 1);
  const afterDelivery = await receipts(admin.token, id);
  const deliverySummary = afterDelivery.body.summary as Record<string, number>;
  assert.equal(deliverySummary.target, 1);
  assert.equal(deliverySummary.delivered, 1);
  assert.equal(deliverySummary.seen, 0);
  const deliveredRow = (afterDelivery.body.receipts as Array<Record<string, unknown>>)[0];
  assert.ok(Number(deliveredRow.deliveredAt) > 0, '拉到即应记录送达时间');
  assert.equal(deliveredRow.firstSeenAt, null);

  // 大屏看满 3 秒上报 → 已读
  const first = await ack('recv-dev-1', [{ id, seenMs: 5000 }]);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.recorded, 1);
  const afterSeen = await receipts(admin.token, id);
  const seenSummary = afterSeen.body.summary as Record<string, number>;
  assert.equal(seenSummary.seen, 1);
  const seenRow = (afterSeen.body.receipts as Array<Record<string, unknown>>)[0];
  assert.equal(Number(seenRow.seenCount), 1);
  assert.equal(Number(seenRow.seenMs), 5000);
  assert.ok(Number(seenRow.firstSeenAt) > 0, '首次已读时间应被记录');
  assert.equal(String(seenRow.clientVersion), '2.8.0', '客户端版本取自设备心跳，不用设备重复上报');

  // 同一台设备再看一次：同一行累加，不新增行
  await ack('recv-dev-1', [{ id, seenMs: 3000 }]);
  const accumulated = await receipts(admin.token, id);
  const accumulatedRow = (accumulated.body.receipts as Array<Record<string, unknown>>)[0];
  assert.equal(Number(accumulatedRow.seenCount), 2);
  assert.equal(Number(accumulatedRow.seenMs), 8000);
  assert.equal((accumulated.body.receipts as unknown[]).length, 1);

  // 列表里的回执计数跟着更新
  const listed = await list(admin.token, { status: 'active' });
  assert.equal(rows(listed)[0].deliveredCount, 1);
  assert.equal(rows(listed)[0].seenCount, 1);
  assert.equal(rows(listed)[0].targetCount, 1);
});

test('回执：未绑定/已撤销设备与未知公告都不会写脏数据', async () => {
  const unknownDevice = await ack('ghost-device', [{ id: 'ann_missing', seenMs: 3000 }]);
  assert.equal(unknownDevice.statusCode, 404);
  assert.equal(unknownDevice.body.code, 'DEVICE_NOT_FOUND');

  await bindDevice('recv-dev-2', 'g1', 'c1');
  const unknownAnnouncement = await ack('recv-dev-2', [{ id: 'ann_missing', seenMs: 3000 }]);
  assert.equal(unknownAnnouncement.statusCode, 200);
  assert.equal(unknownAnnouncement.body.recorded, 0);
  const empty = (await database()`SELECT COUNT(*)::int AS count FROM exam_announcement_receipts`) as unknown as Array<{
    count: number;
  }>;
  assert.equal(Number(empty[0].count), 0);

  await bindDevice('recv-dev-3', 'g1', 'c1', true);
  const revoked = await ack('recv-dev-3', [{ id: 'ann_missing', seenMs: 3000 }]);
  assert.equal(revoked.statusCode, 404);
});

test('回执：应达设备只算公告范围内的绑定设备，越权账号读不到别人的回执', async () => {
  await seedSchoolStructure();
  await bindDevice('scope-dev-c1', 'g1', 'c1');
  await bindDevice('scope-dev-c2', 'g1', 'c2');
  await bindDevice('scope-dev-g2', 'g2', 'c9');
  const sent = await send(admin.token, {
    title: '只给 c1',
    body: '范围口径',
    scopeType: 'class',
    scopeIds: ['c1'],
    expiresInMinutes: 0,
  });
  const id = String(objectOf(sent).id);

  const adminView = await receipts(admin.token, id);
  assert.equal((adminView.body.summary as Record<string, number>).target, 1);
  assert.equal((adminView.body.receipts as Array<Record<string, unknown>>)[0].instanceId, 'scope-dev-c1');

  // 年级 g2 的年级管理员：看不到发给 g1 班级的公告，按"不存在"处理
  const otherGrade = await createScopedUser('scope-admin-g2', 'grade_admin', [{ type: 'grade', gradeId: 'g2' }]);
  const denied = await receipts(otherGrade.token, id);
  assert.equal(denied.statusCode, 404);

  // 同年级的年级管理员能看到明细，但只看到自己范围内的设备
  const ownGrade = await createScopedUser('scope-admin-g1', 'grade_admin', [{ type: 'grade', gradeId: 'g1' }]);
  const allowed = await receipts(ownGrade.token, id);
  assert.equal(allowed.statusCode, 200);
  assert.equal((allowed.body.summary as Record<string, number>).target, 1);
});

/** 建一个指定角色与数据范围的账号（真实登录，拿到真 token）。 */
async function createScopedUser(
  username: string,
  roleId: string,
  scopes: Array<{ type: 'all' | 'grade' | 'class'; gradeId?: string; classId?: string }>,
): Promise<Login> {
  const password = await makePasswordHash(`${username}-password`);
  const now = Date.now();
  const sql = authSql();
  const rows = (await sql`
    INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
    VALUES (${username}, ${username}, ${password.hash}, ${password.salt}, ${roleId}, 'active', FALSE, 1, ${now}, ${now})
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  let id = Number(rows[0]?.id);
  if (!id) {
    // 同一个 disposable 库被重复跑（或在同一进程里重跑单个文件）时复用已有账号，
    // 并把数据范围重置成这次要验证的口径。
    const existing = (await sql`
      SELECT id FROM app_users WHERE LOWER(username) = LOWER(${username}) LIMIT 1
    `) as unknown as Array<{ id: number }>;
    id = Number(existing[0]?.id);
    await sql`DELETE FROM app_user_scopes WHERE user_id = ${id}`;
  }
  assert.ok(id > 0, 'test user must be created');
  for (const scope of scopes) {
    await sql`
      INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id)
      VALUES (${id}, ${scope.type}, ${scope.gradeId ?? ''}, ${scope.classId ?? ''})
    `;
  }
  const login = await authenticateUser(username, `${username}-password`);
  assert.ok(login, 'scoped user must authenticate through the real auth path');
  return { id, token: login.token };
}

// ===== 二期：搜索、模板、未读强提醒、跨公告统计 =====

test('搜索：关键字命中标题或正文，% 不会被当成通配符', async () => {
  await send(admin.token, { title: '期末考试延长', body: '请留意', scopeType: 'all', expiresInMinutes: 0 });
  await send(admin.token, { title: '其它通知', body: '期末考试当天停课', scopeType: 'all', expiresInMinutes: 0 });
  await send(admin.token, { title: '100% 完成', body: '百分号测试', scopeType: 'all', expiresInMinutes: 0 });

  const byTitle = await list(admin.token, { status: 'all', q: '延长' });
  assert.equal(rows(byTitle).length, 1);
  assert.equal(rows(byTitle)[0].title, '期末考试延长');

  const byBody = await list(admin.token, { status: 'all', q: '停课' });
  assert.equal(rows(byBody).length, 1);
  assert.equal(rows(byBody)[0].title, '其它通知');

  // `%` 被转义：只命中真的含百分号的那条，而不是把所有公告都匹配出来。
  const byPercent = await list(admin.token, { status: 'all', q: '%' });
  assert.equal(rows(byPercent).length, 1);
  assert.equal(rows(byPercent)[0].title, '100% 完成');
});

test('模板：保存后能列出、能被删除，空模板被拒绝', async () => {
  const saved = await templateAction(admin.token, 'announce-template-save', {
    title: '考试延时',
    body: '## 延时\n\n- 延长 15 分钟',
    style: 'poster',
    level: 'urgent',
  });
  assert.equal(saved.statusCode, 200);
  const templateId = String((saved.body.data as Record<string, unknown>).id);
  assert.ok(templateId.startsWith('tpl_'));

  const listed = await listTemplates(admin.token);
  assert.equal(listed.statusCode, 200);
  const templateRows = listed.body.data as Array<Record<string, unknown>>;
  assert.equal(templateRows.length, 1);
  assert.equal(templateRows[0].title, '考试延时');
  assert.equal(templateRows[0].style, 'poster');
  assert.equal(templateRows[0].level, 'urgent');

  const empty = await templateAction(admin.token, 'announce-template-save', { title: '', body: '' });
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.body.code, 'EMPTY_TEMPLATE');

  const removed = await templateAction(admin.token, 'announce-template-delete', { id: templateId });
  assert.equal(removed.statusCode, 200);
  const afterDelete = await listTemplates(admin.token);
  assert.equal((afterDelete.body.data as unknown[]).length, 0);
});

test('未读强提醒：写入 remindAt 并同步到教室端，撤回后不再允许提醒', async () => {
  await bindDevice('remind-dev-1', 'g1', 'c1');
  const sent = await send(admin.token, {
    title: '再提醒一次',
    body: '只进列表',
    scopeType: 'class',
    scopeIds: ['c1'],
    silent: true,
    expiresInMinutes: 0,
  });
  const id = String(objectOf(sent).id);
  assert.equal(objectOf(sent).silent, true, '静默发布要落库');

  const before = await deviceList('remind-dev-1');
  assert.equal(rows(before)[0].silent, true);
  assert.equal(rows(before)[0].remindAt, null);

  const reminded = await remind(admin.token, id, 'unseen');
  assert.equal(reminded.statusCode, 200);
  const after = await deviceList('remind-dev-1');
  assert.ok(Number(rows(after)[0].remindAt) > 0, '教室端要能看到新的提醒时间');
  assert.equal(rows(after)[0].remindScope, 'unseen');

  await send(admin.token, { id }, 'announce-revoke');
  const denied = await remind(admin.token, id);
  assert.equal(denied.statusCode, 404);
});

test('统计：汇总应达/送达/已读、覆盖设备与回执率最低的公告', async () => {
  await seedSchoolStructure();
  await bindDevice('stat-dev-1', 'g1', 'c1');
  await bindDevice('stat-dev-2', 'g1', 'c2');
  const sent = await send(admin.token, {
    title: '统计用公告',
    body: '两台设备应达',
    scopeType: 'grade',
    scopeIds: ['g1'],
    expiresInMinutes: 0,
  });
  const id = String(objectOf(sent).id);

  await deviceList('stat-dev-1');
  await deviceList('stat-dev-2');
  await ack('stat-dev-1', [{ id, seenMs: 4000 }]);

  const stats = (await fetchStats(admin.token, 7)).body.stats as Record<string, unknown>;
  assert.equal(stats.days, 7);
  assert.equal(stats.announcements, 1);
  assert.equal(stats.target, 2);
  assert.equal(stats.delivered, 2);
  assert.equal(stats.seen, 1);
  assert.equal(stats.devices, 2);
  const daily = stats.daily as Array<Record<string, unknown>>;
  assert.equal(daily.length, 7, '每天都应有一格（没有公告的那天是 0）');
  assert.equal(
    daily.reduce((sum, day) => sum + Number(day.announcements), 0),
    1,
  );
  const lowest = stats.lowest as Array<Record<string, unknown>>;
  assert.equal(lowest.length, 1);
  assert.equal(lowest[0].id, id);
  assert.equal(lowest[0].target, 2);
  assert.equal(lowest[0].seen, 1);
});

// ===== 教室端历史公告（公告按钮里的「历史」分页）=====

test('教室端历史：只回本机范围内的已过期/已撤回，并带上本机已读时间', async () => {
  await bindDevice('hist-dev-1', 'g1', 'c1');
  const expired = String(
    objectOf(
      await send(admin.token, {
        title: '已经过期',
        body: 'x',
        scopeType: 'class',
        scopeIds: ['c1'],
        expiresInMinutes: 120,
      }),
    ).id,
  );
  const revoked = String(
    objectOf(await send(admin.token, { title: '后来撤回', body: 'y', scopeType: 'class', scopeIds: ['c1'] })).id,
  );
  const active = String(
    objectOf(
      await send(admin.token, {
        title: '仍然生效',
        body: 'z',
        scopeType: 'class',
        scopeIds: ['c1'],
        expiresInMinutes: 120,
      }),
    ).id,
  );
  const foreign = String(
    objectOf(
      await send(admin.token, {
        title: '别的班',
        body: 'w',
        scopeType: 'class',
        scopeIds: ['c9'],
        expiresInMinutes: 120,
      }),
    ).id,
  );

  // 把两条改成"过期"，再撤回一条。
  await database()`
    UPDATE exam_announcements SET expires_at = ${Date.now() - 60_000} WHERE id IN (${expired}, ${foreign})
  `;
  await send(admin.token, { id: revoked }, 'announce-revoke');

  const history = await deviceList('hist-dev-1', { history: '1' });
  const ids = rows(history)
    .map((row) => String(row.id))
    .sort();
  assert.deepEqual(ids, [expired, revoked].sort(), '历史里只该有本班范围内已过期/已撤回的两条');
  const current = await deviceList('hist-dev-1');
  assert.deepEqual(
    rows(current).map((row) => String(row.id)),
    [active],
    '当前列表不受历史影响',
  );

  const expiredRow = rows(history).find((row) => row.id === expired);
  const revokedRow = rows(history).find((row) => row.id === revoked);
  assert.equal(expiredRow?.status, 'expired');
  assert.equal(revokedRow?.status, 'revoked');
  assert.equal(expiredRow?.seenAt, null, '没看过就是 null');
  assert.equal(rows(current)[0].seenAt, null);

  // 本机看过历史里的那条之后，历史与当前列表都会带上 seenAt。
  await ack('hist-dev-1', [{ id: revoked, seenMs: 5000 }]);
  const afterSeen = await deviceList('hist-dev-1', { history: '1' });
  assert.ok(Number(rows(afterSeen).find((row) => row.id === revoked)?.seenAt) > 0);

  // 未绑定的设备拿不到历史（沿用设备绑定校验）。
  const ghost = await deviceList('ghost-device', { history: '1' });
  assert.equal(ghost.statusCode, 404);
});
