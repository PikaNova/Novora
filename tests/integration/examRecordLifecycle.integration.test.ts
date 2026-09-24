/**
 * 考试记录生命周期动作的真实库集成测试。
 *
 * 覆盖四类断言：状态机边界、权限与作用域、幂等键复放、审计与操作日志。
 * 只跑在 runner 注入的 disposable 库（INTEGRATION_DATABASE_URL）上。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BUILTIN_ROLES, authenticateUser, authSql, ensureAuthTables, makePasswordHash } from '../../api/_auth.js';
import { database, ensureTableOnce } from '../../api/_exams/db.js';
import { autoStartDueRecords } from '../../api/_exams/examAutoLifecycle.js';
import { projectCurrentExamRecords } from '../../api/_exams/examRecordProjection.js';
import { handleExamRecordRoute } from '../../api/_exams/routes/examRecordRoutes.js';
import { handleExamDataPost } from '../../api/_exams/routes/examDataRoutes.js';
import { __resetRateLimiterForTests } from '../../api/_rateLimiter.js';
import examsHandler from '../../api/exams.js';
import { addDaysToDateKey, getShanghaiDateKey } from '../../src/utils/weeklySchedule.js';
import { parseZonedTime } from '../../src/utils/zonedTime.js';

type Scope = { type: 'all' | 'grade' | 'class'; gradeId?: string; classId?: string };
type Login = { id: number; token: string };

const adminPassword = process.env.ADMIN_PASSWORD ?? '';
const MAX_EXTEND_MINUTES = 600;
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

function makeReq(token: string, body: Record<string, unknown>, headers: Record<string, string> = {}): VercelRequest {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, ...headers },
    query: {},
    cookies: {},
    body,
  } as unknown as VercelRequest;
}

/** 取响应体里的 `data`（记录 JSON），非对象时返回空对象，避免在断言里散落类型判断。 */
function data(calls: { body: Record<string, unknown> }): Record<string, unknown> {
  const value = calls.body.data;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 直接打记录动作路由（绕开入口限流），仍然走真实的权限、写槽与落库路径。 */
async function act(token: string, action: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  await openWriteSlot();
  const { res, calls } = makeRes();
  await handleExamRecordRoute(makeReq(token, body, headers), res, action);
  return calls;
}

/** 经顶层 /api/exams 入口调用，用于验证动作确实被路由表放行。 */
async function actThroughEntry(
  token: string,
  action: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  await openWriteSlot();
  __resetRateLimiterForTests();
  const { res, calls } = makeRes();
  await examsHandler(makeReq(token, { action, ...body }, headers) as unknown as VercelRequest, res);
  return calls;
}

async function openWriteSlot() {
  await database()`UPDATE write_throttle SET next_allowed_at = ${-Date.now()} WHERE id = 1`;
}

/**
 * 新约定下开考由系统按计划时间完成，测试里没法「点按钮开考」：
 * 把计划开始时间调到过去，再触发一次惰性推进（与读列表/心跳同一条路径）。
 */
async function systemStart(id: string): Promise<{ actualStartAt: number }> {
  const at = Date.now() - 60_000;
  await database()`UPDATE exam_records SET start_at = ${at} WHERE id = ${id}`;
  await autoStartDueRecords(Date.now());
  const row = await readRecord(id);
  return { actualStartAt: Number(row.actual_start_at) };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SeedMajor = {
  id: string;
  name?: string;
  startAt?: number | null;
  endAt?: number | null;
  targetGradeIds?: string[];
  targetClassIds?: string[];
  source?: 'regular' | 'quick';
  createdBy?: number;
};

/** 只写权威快照，再走真实投影建 exam_records 行，保证两者一致。 */
async function seedMajors(majors: SeedMajor[]): Promise<number> {
  const now = Date.now();
  const payload = majors.map((major, index) => ({
    id: major.id,
    name: major.name ?? major.id,
    items: [],
    order: index,
    targetGradeIds: major.targetGradeIds ?? [],
    targetClassIds: major.targetClassIds ?? [],
    ...(major.startAt == null ? {} : { startAt: major.startAt }),
    ...(major.endAt == null ? {} : { endAt: major.endAt }),
    ...(major.createdBy == null ? {} : { createdBy: major.createdBy }),
    ...(major.source === 'quick' ? { source: 'quick', temporary: true } : {}),
  }));
  await database()`
    UPDATE exam_data SET majors=${JSON.stringify(payload)}::jsonb, updated_at=${now} WHERE id=1
  `;
  await database().transaction((transaction) => [projectCurrentExamRecords(transaction)]);
  return now;
}

async function readRecord(id: string) {
  const rows = (await database()`SELECT * FROM exam_records WHERE id=${id}`) as unknown as Array<
    Record<string, unknown>
  >;
  assert.ok(rows[0], `exam_records 里必须存在 ${id}`);
  return rows[0];
}

async function readOperations(recordId: string) {
  return (await database()`
    SELECT action, source_record_id, result_record_id, actor_id, from_status, to_status, reason, created_at
    FROM exam_record_operations
    WHERE source_record_id=${recordId}
  `) as unknown as Array<Record<string, unknown>>;
}

async function readSnapshotMajors() {
  const rows = (await database()`SELECT majors FROM exam_data WHERE id=1`) as unknown as Array<{
    majors?: Array<Record<string, unknown>>;
  }>;
  return Array.isArray(rows[0]?.majors) ? rows[0].majors : [];
}

/** 走真实的 GET /api/exams?resource=records 读列表（只读，不消耗写槽）。 */
async function listRecords(token: string, query: Record<string, string> = {}) {
  const { res, calls } = makeRes();
  const req = {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    query: { resource: 'records', ...query },
    cookies: {},
    body: {},
  } as unknown as VercelRequest;
  await handleExamRecordRoute(req, res);
  return calls;
}

function listedIds(calls: { body: Record<string, unknown> }): string[] {
  const rows = calls.body.data;
  return Array.isArray(rows) ? rows.map((row) => String((row as { id?: unknown }).id)) : [];
}

/** 走真实的 GET /api/exams?resource=record 单取一条记录（考试详情抽屉的数据来源）。 */
async function getRecordById(token: string, recordId: string) {
  const { res, calls } = makeRes();
  const req = {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    query: { resource: 'record', recordId },
    cookies: {},
    body: {},
  } as unknown as VercelRequest;
  await handleExamRecordRoute(req, res);
  return calls;
}

/**
 * 回归：详情抽屉以前在「当前板块列表页那一页数据」里按 id 找记录，找不到就整个不渲染
 * （点「详情」毫无反应）。日程轴/班级网格的行来自快照，可能是别的板块的记录，
 * 所以这里锁定「按 id 单取」这条路必须独立可用。
 */
test('考试详情：按 id 单取记录，不要求它出现在当前板块列表里', async () => {
  const startAt = Date.now() - 10 * 60_000;
  await seedMajors([{ id: 'ongoing-detail', startAt, endAt: startAt + 60 * 60_000 }]);
  // 读一次当前考试板块：顺带让系统惰性把它开考，落到「进行中」。
  await listRecords(admin.token, { preset: 'current' });

  const schedule = await listRecords(admin.token, { preset: 'schedule' });
  assert.equal(
    listedIds(schedule).includes('ongoing-detail'),
    false,
    '进行中的考试不在「考试安排」板块（这正是以前点详情没反应的那类行）',
  );

  const byId = await getRecordById(admin.token, 'ongoing-detail');
  assert.equal(byId.statusCode, 200);
  assert.equal(data(byId).id, 'ongoing-detail');
  assert.equal(data(byId).displayStatus, 'ongoing');

  // 取不到时必须是明确的 404，前端据此给提示，而不是静默什么都不发生。
  const missing = await getRecordById(admin.token, 'missing-detail');
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.code, 'RECORD_NOT_FOUND');
});

/** 走真实的 GET /api/exams?resource=record-operations 读操作日志。 */
async function listOperations(token: string, recordId: string) {
  const { res, calls } = makeRes();
  const req = {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    query: { resource: 'record-operations', recordId },
    cookies: {},
    body: {},
  } as unknown as VercelRequest;
  await handleExamRecordRoute(req, res);
  return calls;
}

/** 走真实的快照保存管道（快速考试在客户端就是改快照后保存）。 */
async function saveExamData(token: string, majors: Array<Record<string, unknown>>, activeMajorId = '') {
  await openWriteSlot();
  const { res, calls } = makeRes();
  await handleExamDataPost(
    makeReq(token, { items: [], title: '', majors, activeMajorId, baseUpdatedAt: 0 }),
    res,
    Date.now(),
  );
  return calls;
}

async function clearDatabase() {
  const sql = database();
  await sql`
    TRUNCATE TABLE
      exam_records,
      exam_record_operations,
      exam_data,
      app_audit_logs,
      app_user_scopes,
      app_users,
      app_roles,
      app_auth,
      app_telemetry_config,
      device_instances,
      classisland_plugin_instances,
      write_throttle
    RESTART IDENTITY CASCADE
  `;
  await sql`INSERT INTO exam_data (id, items, title, updated_at) VALUES (1, '[]', '', 0)`;
  await sql`INSERT INTO write_throttle (id, next_allowed_at) VALUES (1, 0)`;
}

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

async function createUser(username: string, roleId: string, scopes: Scope[]): Promise<Login> {
  const password = await makePasswordHash(`${username}-password`);
  const now = Date.now();
  const sql = authSql();
  const rows = (await sql`
    INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
    VALUES (${username}, ${username}, ${password.hash}, ${password.salt}, ${roleId}, 'active', FALSE, 1, ${now}, ${now})
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  const id = Number(rows[0]?.id);
  assert.ok(id > 0, 'test user must be created');
  for (const scope of scopes) {
    await sql`
      INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id)
      VALUES (${id}, ${scope.type}, ${scope.gradeId ?? ''}, ${scope.classId ?? ''})
    `;
  }
  const login = await authenticateUser(username, `${username}-password`);
  assert.ok(login, 'test user must authenticate through the real auth path');
  return { id, token: login.token };
}

beforeEach(async () => {
  assert.ok(adminPassword.length >= 16, 'the integration runner must inject a strong temporary password');
  await ensureTableOnce();
  await ensureAuthTables();
  await clearDatabase();
  await seedRoles();
  const login = await authenticateUser('admin', adminPassword);
  assert.ok(login, 'the integration runner must bootstrap the disposable super administrator');
  admin = { id: login.actor.id, token: login.token };
  __resetRateLimiterForTests();
});

after(async () => {
  await clearDatabase();
  const rows = (await database()`
    SELECT
      (SELECT COUNT(*)::int FROM exam_records) AS record_count,
      (SELECT COUNT(*)::int FROM exam_record_operations) AS operation_count
  `) as unknown as Array<{ record_count: number; operation_count: number }>;
  assert.equal(Number(rows[0]?.record_count), 0);
  assert.equal(Number(rows[0]?.operation_count), 0);
});

test('考试生命周期：publish → start → pause → resume → extend → end → archive → unarchive 全程可用', async () => {
  const startAt = Date.now() - 60_000;
  const endAt = Date.now() + 3_600_000;
  await seedMajors([{ id: 'lifecycle', startAt, endAt }]);

  const published = await act(admin.token, 'record-publish', { id: 'lifecycle' });
  assert.equal(published.statusCode, 200);
  assert.equal(data(published).status, 'published');

  const started = await systemStart('lifecycle');
  assert.ok(started.actualStartAt > 0, '系统到点后必须写入 actualStartAt');

  const paused = await act(admin.token, 'record-pause', { id: 'lifecycle', reason: '设备异常' });
  assert.equal(paused.statusCode, 200);
  assert.ok(Number(data(paused).pausedAt) > 0, '暂停必须写入 pausedAt');
  assert.equal(data(paused).status, 'published', '暂停不改变持久状态');

  const resumed = await act(admin.token, 'record-resume', { id: 'lifecycle' });
  assert.equal(resumed.statusCode, 200);
  assert.equal(data(resumed).pausedAt, null);
  assert.ok(Number(data(resumed).pausedMs) >= 0);

  const extended = await act(
    admin.token,
    'record-extend',
    { id: 'lifecycle', minutes: 15 },
    { 'idempotency-key': 'extend-lifecycle-1' },
  );
  assert.equal(extended.statusCode, 200);
  assert.equal(Number(data(extended).endAt), endAt + 15 * 60_000);

  const replayed = await act(
    admin.token,
    'record-extend',
    { id: 'lifecycle', minutes: 15 },
    { 'idempotency-key': 'extend-lifecycle-1' },
  );
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.body.idempotent, true);
  assert.equal(Number(data(replayed).endAt), endAt + 15 * 60_000, '同键重放不能再次叠加时长');

  const ended = await act(admin.token, 'record-end', { id: 'lifecycle' });
  assert.equal(ended.statusCode, 200);
  assert.equal(data(ended).status, 'ended');
  assert.ok(Number(data(ended).actualEndAt) > 0, '结束必须写入 actualEndAt');

  const archived = await act(admin.token, 'record-archive', { id: 'lifecycle' });
  assert.equal(archived.statusCode, 200);
  assert.equal(data(archived).status, 'archived', '归档不能被快照投影改回 ended');
  assert.equal((await readRecord('lifecycle')).status, 'archived', '归档状态必须真正落库，而不只是出现在响应里');

  const unarchived = await act(admin.token, 'record-unarchive', { id: 'lifecycle' });
  assert.equal(unarchived.statusCode, 200);
  assert.equal(data(unarchived).status, 'ended');

  const row = await readRecord('lifecycle');
  assert.equal(row.status, 'ended');
  assert.equal(row.paused_at, null);
});

test('考试生命周期：暂停期间结束会结算暂停时长，倒计时基准不把暂停算进考试用时', async () => {
  const endAt = Date.now() + 3_600_000;
  await seedMajors([{ id: 'paused-end', startAt: Date.now() - 1_000, endAt }]);
  await act(admin.token, 'record-publish', { id: 'paused-end' });
  await systemStart('paused-end');
  await act(admin.token, 'record-pause', { id: 'paused-end' });
  await sleep(150);

  const ended = await act(admin.token, 'record-end', { id: 'paused-end' });
  assert.equal(ended.statusCode, 200);
  assert.equal(data(ended).pausedAt, null);
  const pausedMs = Number(data(ended).pausedMs);
  assert.ok(pausedMs >= 100, `结束时应结算在途暂停时长，实际 ${pausedMs}ms`);
  assert.equal(Number(data(ended).endAt), endAt);

  const row = await readRecord('paused-end');
  assert.equal(Number(row.paused_ms), pausedMs);
  assert.equal(row.paused_at, null);
});

test('考试生命周期：非法转移与非法参数一律拒绝，且不写状态也不写操作日志', async () => {
  const endAt = Date.now() + 3_600_000;
  // 只给结束时间、不给开始时间：新约定下「时间窗完整 = 创建即发布」，
  // 这条用例要的是「草稿上动作一律拒绝」，所以必须让它保持草稿。
  await seedMajors([{ id: 'boundary', endAt }]);

  const pauseDraft = await act(admin.token, 'record-pause', { id: 'boundary' });
  assert.equal(pauseDraft.statusCode, 409);
  assert.equal(pauseDraft.body.code, 'ILLEGAL_STATE');

  const endDraft = await act(admin.token, 'record-end', { id: 'boundary' });
  assert.equal(endDraft.statusCode, 409);
  assert.equal(endDraft.body.code, 'INVALID_STATUS_TRANSITION');

  const archiveDraft = await act(admin.token, 'record-archive', { id: 'boundary' });
  assert.equal(archiveDraft.statusCode, 409);
  assert.equal(archiveDraft.body.code, 'INVALID_STATUS_TRANSITION');

  const extendDraft = await act(
    admin.token,
    'record-extend',
    { id: 'boundary', minutes: 10 },
    { 'idempotency-key': 'extend-on-draft' },
  );
  assert.equal(extendDraft.statusCode, 409);
  assert.equal(extendDraft.body.code, 'ILLEGAL_STATE');

  const published = await act(admin.token, 'record-publish', { id: 'boundary' });
  assert.equal(published.statusCode, 200);

  await systemStart('boundary');
  assert.equal((await act(admin.token, 'record-request-stop', { id: 'boundary' })).statusCode, 200);
  const stopTwice = await act(admin.token, 'record-request-stop', { id: 'boundary' });
  assert.equal(stopTwice.statusCode, 409);
  assert.equal(stopTwice.body.code, 'ILLEGAL_STATE');

  const resumeIdle = await act(admin.token, 'record-resume', { id: 'boundary' });
  assert.equal(resumeIdle.statusCode, 409);
  assert.equal(resumeIdle.body.code, 'ILLEGAL_STATE');

  assert.equal((await act(admin.token, 'record-pause', { id: 'boundary' })).statusCode, 200);
  const pauseTwice = await act(admin.token, 'record-pause', { id: 'boundary' });
  assert.equal(pauseTwice.statusCode, 409);
  assert.equal(pauseTwice.body.code, 'ILLEGAL_STATE');

  const zeroMinutes = await act(
    admin.token,
    'record-extend',
    { id: 'boundary', minutes: 0 },
    { 'idempotency-key': 'extend-zero' },
  );
  assert.equal(zeroMinutes.statusCode, 409);
  assert.equal(zeroMinutes.body.code, 'MISSING_ARGUMENT');

  const tooManyMinutes = await act(
    admin.token,
    'record-extend',
    { id: 'boundary', minutes: MAX_EXTEND_MINUTES + 1 },
    { 'idempotency-key': 'extend-too-long' },
  );
  assert.equal(tooManyMinutes.statusCode, 409);
  assert.equal(tooManyMinutes.body.code, 'MISSING_ARGUMENT');

  const missingKey = await act(admin.token, 'record-extend', { id: 'boundary', minutes: 5 });
  assert.equal(missingKey.statusCode, 400);
  assert.equal(missingKey.body.code, 'IDEMPOTENCY_KEY_REQUIRED');

  const missingRecord = await act(admin.token, 'record-request-stop', { id: 'not-a-record' });
  assert.equal(missingRecord.statusCode, 404);
  assert.equal(missingRecord.body.code, 'RECORD_NOT_FOUND');

  const row = await readRecord('boundary');
  assert.equal(row.status, 'published', '被拒绝的动作不能改变持久状态');
  assert.ok(Number(row.paused_at) > 0, '被拒绝的动作不能让已生效的暂停失效');
  assert.equal(Number(row.end_at), endAt, '被拒绝的延长不能改动 end_at');

  const operations = await readOperations('boundary');
  assert.deepEqual(
    operations.map((operation) => operation.action).sort(),
    // 开考由系统完成（auto_start），手动结束变成 request_stop。
    ['auto_start', 'pause', 'publish', 'request_stop'],
    '只有成功的动作才写操作日志',
  );
});

test('考试生命周期：结束时间写回客户端快照，暂停状态不会被下一次投影冲掉', async () => {
  const endAt = Date.now() + 3_600_000;
  await seedMajors([{ id: 'snapshot', startAt: Date.now() - 1_000, endAt }]);
  await act(admin.token, 'record-publish', { id: 'snapshot' });
  await systemStart('snapshot');
  await act(admin.token, 'record-extend', { id: 'snapshot', minutes: 20 }, { 'idempotency-key': 'extend-snapshot' });
  await act(admin.token, 'record-pause', { id: 'snapshot' });

  const extendedEndAt = endAt + 20 * 60_000;
  let majors = await readSnapshotMajors();
  assert.equal(Number(majors[0]?.endAt), extendedEndAt);
  // 实际开考时间现在写在记录层（系统自动开考只动 exam_records）；
  // 快照里的 actualStartAt 不再由人工开考写入，所以这里改断言记录。
  assert.ok(Number((await readRecord('snapshot')).actual_start_at) > 0);
  assert.ok(Number(majors[0]?.pausedAt) > 0);

  // 任何一次普通保存都会重跑投影；延长与暂停不能被快照旧值覆盖。
  const now = Date.now();
  await database()`UPDATE exam_data SET updated_at=${now} WHERE id=1`;
  await database().transaction((transaction) => [projectCurrentExamRecords(transaction)]);

  const row = await readRecord('snapshot');
  assert.equal(Number(row.end_at), extendedEndAt, '投影不能把延长后的结束时间改回快照旧值');
  assert.ok(Number(row.actual_start_at) > 0, '投影不能清掉开考时间');
  assert.ok(Number(row.paused_at) > 0, '投影不能清掉暂停状态');
  majors = await readSnapshotMajors();
  assert.equal(Number(majors[0]?.pausedMs ?? 0), Number(row.paused_ms));
});

test('考试生命周期：幂等键不能跨记录或跨动作复用', async () => {
  const endAt = Date.now() + 3_600_000;
  await seedMajors([
    { id: 'idem-a', startAt: Date.now() - 1_000, endAt },
    { id: 'idem-b', startAt: Date.now() - 1_000, endAt },
  ]);
  await act(admin.token, 'record-publish', { id: 'idem-a' });
  await act(admin.token, 'record-publish', { id: 'idem-b' });

  const first = await act(
    admin.token,
    'record-extend',
    { id: 'idem-a', minutes: 5 },
    { 'idempotency-key': 'shared-extend-key' },
  );
  assert.equal(first.statusCode, 200);

  const otherRecord = await act(
    admin.token,
    'record-extend',
    { id: 'idem-b', minutes: 5 },
    { 'idempotency-key': 'shared-extend-key' },
  );
  assert.equal(otherRecord.statusCode, 409);
  assert.equal(otherRecord.body.code, 'IDEMPOTENCY_KEY_REUSED');

  const otherAction = await act(
    admin.token,
    'record-pause',
    { id: 'idem-a' },
    { 'idempotency-key': 'shared-extend-key' },
  );
  assert.equal(otherAction.statusCode, 409);
  assert.equal(otherAction.body.code, 'IDEMPOTENCY_KEY_REUSED');

  const untouched = await readRecord('idem-b');
  assert.equal(Number(untouched.end_at), endAt, '被拒绝的复用请求不能改动另一场考试');
});

test('考试生命周期：权限与作用域都按既有规则收紧', async () => {
  const endAt = Date.now() + 3_600_000;
  await seedMajors([
    { id: 'scoped-g1', targetGradeIds: ['g1'], startAt: Date.now() - 1_000, endAt },
    { id: 'scoped-g2', targetGradeIds: ['g2'], startAt: Date.now() - 1_000, endAt },
  ]);
  const viewer = await createUser('lifecycle-viewer', 'viewer', [{ type: 'all' }]);
  const gradeAdmin = await createUser('lifecycle-grade', 'grade_admin', [{ type: 'grade', gradeId: 'g1' }]);

  const denied = await act(viewer.token, 'record-request-stop', { id: 'scoped-g1' });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'PERMISSION_DENIED');

  const outOfScopeStart = await act(gradeAdmin.token, 'record-request-stop', { id: 'scoped-g2' });
  assert.equal(outOfScopeStart.statusCode, 404);
  assert.equal(outOfScopeStart.body.code, 'RECORD_NOT_FOUND');

  await act(admin.token, 'record-publish', { id: 'scoped-g1' });

  const outOfScopePublish = await act(gradeAdmin.token, 'record-pause', { id: 'scoped-g2' });
  assert.equal(outOfScopePublish.statusCode, 404);

  const inScope = await act(gradeAdmin.token, 'record-request-stop', { id: 'scoped-g1' });
  assert.equal(inScope.statusCode, 200);
  assert.ok(Number(data(inScope).stopRequestedAt) > 0, '范围内的管理员可以申请停止');

  const inScopeExtend = await act(
    gradeAdmin.token,
    'record-extend',
    { id: 'scoped-g1', minutes: 30 },
    { 'idempotency-key': 'extend-scoped-g1' },
  );
  assert.equal(inScopeExtend.statusCode, 200);

  const operations = await readOperations('scoped-g1');
  const requested = operations.find((operation) => operation.action === 'request_stop');
  assert.equal(Number(requested?.actor_id), gradeAdmin.id, '操作日志要记录真实操作者');
  const autoStart = operations.find((operation) => operation.action === 'auto_start');
  if (autoStart) assert.equal(autoStart.actor_id ?? null, null, '系统自动开考的日志没有操作者');
});

test('考试生命周期：每个动作都写操作日志与审计记录，包含操作者、前后状态与原因', async () => {
  const endAt = Date.now() + 3_600_000;
  // 只给时间窗会给成「创建即发布」，那样 publish 就成了幂等空操作、不再有 draft→published 的迁移；
  // 这条用例要的正是每一步的真实迁移，所以先种成草稿（不给时间窗），发布后再由系统开考。
  // 只给结束时间、不给开始时间：保持草稿（时间窗不完整），但 end_at 会被投影带过来，
  // 后面才做得出真实的 draft→published 迁移，也才有多余的结束时间可以延长。
  await seedMajors([{ id: 'audit-record', endAt }]);

  await act(admin.token, 'record-publish', { id: 'audit-record' });
  await systemStart('audit-record');
  await act(admin.token, 'record-pause', { id: 'audit-record', reason: '临时调休' });
  await act(admin.token, 'record-resume', { id: 'audit-record', reason: '恢复' });
  await act(
    admin.token,
    'record-extend',
    { id: 'audit-record', minutes: 5, reason: '加时' },
    { 'idempotency-key': 'extend-audit' },
  );
  await act(admin.token, 'record-end', { id: 'audit-record' });

  const operations = await readOperations('audit-record');
  assert.deepEqual(operations.map((operation) => operation.action).sort(), [
    'auto_start',
    'end',
    'extend',
    'pause',
    'publish',
    'resume',
  ]);
  for (const operation of operations) {
    // 系统自动开考/自动结束的日志没有操作者；人工动作必须记得住是谁做的。
    if (operation.actor_id != null) assert.equal(Number(operation.actor_id), admin.id);
    assert.equal(String(operation.source_record_id), 'audit-record');
    assert.equal(String(operation.result_record_id), 'audit-record');
    assert.ok(String(operation.from_status).length > 0, '每条操作日志都要有 from_status');
    assert.ok(String(operation.to_status).length > 0, '每条操作日志都要有 to_status');
    assert.ok(Number(operation.created_at) > 0);
  }
  const publish = operations.find((operation) => operation.action === 'publish');
  assert.equal(String(publish?.from_status), 'draft');
  assert.equal(String(publish?.to_status), 'published');
  const pause = operations.find((operation) => operation.action === 'pause');
  assert.equal(String(pause?.from_status), 'published');
  assert.equal(String(pause?.to_status), 'published');
  // 时间类动作的 reason 现在是「时间说明；备注：<操作者填的原因>」，
  // 既要留住操作者填的内容，也要保留时间变更说明（fbd4bef 的可见化改动）。
  assert.ok(String(pause?.reason).includes('临时调休'), '操作日志要保留操作者填写的原因');
  assert.ok(String(pause?.reason).includes('暂停：'), '暂停日志要说明结束时间如何顺延');
  const end = operations.find((operation) => operation.action === 'end');
  assert.equal(String(end?.to_status), 'ended');

  const audits = (await database()`
    SELECT action FROM app_audit_logs
    WHERE resource_type='exam_record' AND resource_id='audit-record'
  `) as unknown as Array<{ action: string }>;
  assert.deepEqual(audits.map((entry) => entry.action).sort(), [
    'exam.record.end',
    'exam.record.extend',
    'exam.record.pause',
    'exam.record.publish',
    'exam.record.resume',
  ]);
});

test('考试生命周期：顶层 /api/exams 入口放行新动作', async () => {
  const endAt = Date.now() + 3_600_000;
  await seedMajors([{ id: 'route-record', startAt: Date.now() - 1_000, endAt }]);

  const published = await actThroughEntry(admin.token, 'record-publish', { id: 'route-record' });
  assert.equal(published.statusCode, 200);

  const started = await actThroughEntry(admin.token, 'record-request-stop', { id: 'route-record' });
  assert.equal(started.statusCode, 200);
  assert.ok(Number(data(started).stopRequestedAt) > 0);

  const extended = await actThroughEntry(
    admin.token,
    'record-extend',
    { id: 'route-record', minutes: 10 },
    { 'idempotency-key': 'extend-route' },
  );
  assert.equal(extended.statusCode, 200);
  assert.equal(Number(data(extended).endAt), endAt + 10 * 60_000);

  // 路由证明：新动作必须落到记录处理器（404 RECORD_NOT_FOUND），
  // 而不是被当成普通数据保存请求。
  const routed = await actThroughEntry(admin.token, 'record-resume', { id: 'missing-record' });
  assert.equal(routed.statusCode, 404);
  assert.equal(routed.body.code, 'RECORD_NOT_FOUND');
});

test('考试列表：筛选与分页下推到 SQL，越界页仍然返回准确总数', async () => {
  const now = Date.now();
  await seedMajors([
    { id: 'list-past', name: '过往考试', startAt: now - 2 * 3_600_000, endAt: now - 3_600_000 },
    { id: 'list-ongoing', name: '进行中的考试', startAt: now - 600_000, endAt: now + 3_600_000 },
    { id: 'list-future', name: '未来考试', startAt: now + 3_600_000, endAt: now + 7_200_000, createdBy: 42 },
    { id: 'list-draft', name: '草稿考试' },
    { id: 'list-quick', name: '快速考试', source: 'quick' },
  ]);
  for (const id of ['list-past', 'list-ongoing', 'list-future']) {
    assert.equal((await act(admin.token, 'record-publish', { id })).statusCode, 200);
  }

  const first = await listRecords(admin.token, { page: '1', pageSize: '2' });
  assert.equal(first.statusCode, 200);
  assert.equal(Number(first.body.total), 5);
  assert.equal(Number(first.body.totalPages), 3);
  assert.equal(listedIds(first).length, 2);
  assert.equal(listedIds(await listRecords(admin.token, { page: '3', pageSize: '2' })).length, 1);

  const beyond = await listRecords(admin.token, { page: '9', pageSize: '2' });
  assert.deepEqual(listedIds(beyond), []);
  assert.equal(Number(beyond.body.total), 5, '越界页不能把总数报成 0');
  assert.equal(Number(beyond.body.totalPages), 3);

  const seen = new Set<string>();
  for (const page of ['1', '2', '3']) {
    for (const id of listedIds(await listRecords(admin.token, { page, pageSize: '2' }))) seen.add(id);
  }
  assert.equal(seen.size, 5, '三页必须恰好覆盖五条记录，不重不漏');

  // ongoing 是按时间窗派生的展示状态，不能和 published 混在一起
  // 「过往考试」指的是开始时间已过；新约定下它会自动开考、并且到点自然结束，
  // 所以这里只剩真正在进行中的那一场。
  assert.deepEqual(listedIds(await listRecords(admin.token, { status: 'ongoing' })), ['list-ongoing']);
  const published = listedIds(await listRecords(admin.token, { status: 'published' }));
  assert.equal(published.includes('list-ongoing'), false);
  // 开始时间已过 + 结束时间已过：新约定下它会自动开考、并且到点自然结束，
  // 所以既不在进行中，也不再是「已发布」。
  assert.equal(published.includes('list-past'), false);
  assert.equal(published.includes('list-future'), true);
  assert.deepEqual(listedIds(await listRecords(admin.token, { status: 'draft' })), ['list-draft']);

  assert.deepEqual(listedIds(await listRecords(admin.token, { q: '未来' })), ['list-future']);
  assert.deepEqual(listedIds(await listRecords(admin.token, { source: 'quick' })), ['list-quick']);
  assert.deepEqual(listedIds(await listRecords(admin.token, { createdBy: '42' })), ['list-future']);

  const upcoming = listedIds(await listRecords(admin.token, { time: 'upcoming' }));
  assert.equal(upcoming.includes('list-future'), true);
  assert.equal(upcoming.includes('list-past'), false);
  const past = listedIds(await listRecords(admin.token, { time: 'past' }));
  assert.equal(past.includes('list-past'), true);
  assert.equal(past.includes('list-future'), false);

  assert.equal((await listRecords(admin.token, { status: 'nope' })).body.code, 'INVALID_STATUS');
  assert.equal((await listRecords(admin.token, { source: 'nope' })).body.code, 'INVALID_SOURCE');
  assert.equal((await listRecords(admin.token, { time: 'nope' })).body.code, 'INVALID_TIME_FILTER');
  assert.equal((await listRecords(admin.token, { createdBy: '-1' })).body.code, 'INVALID_CREATED_BY');
});

test('考试列表：作用域与年级筛选在 SQL 层生效', async () => {
  const now = Date.now();
  const window = { startAt: now - 1_000, endAt: now + 3_600_000 };
  await seedMajors([
    { id: 'scope-g1', name: 'G1', targetGradeIds: ['g1'], ...window },
    { id: 'scope-g2', name: 'G2', targetGradeIds: ['g2'], ...window },
    { id: 'scope-class', name: 'C1', targetClassIds: ['c1'], ...window },
    { id: 'scope-school', name: '全校', ...window },
  ]);
  const gradeAdmin = await createUser('list-grade', 'grade_admin', [{ type: 'grade', gradeId: 'g1' }]);
  const classAdmin = await createUser('list-class', 'class_admin', [{ type: 'class', gradeId: 'g1', classId: 'c1' }]);

  assert.deepEqual(listedIds(await listRecords(admin.token, { pageSize: '50' })).sort(), [
    'scope-class',
    'scope-g1',
    'scope-g2',
    'scope-school',
  ]);

  const gradeVisible = listedIds(await listRecords(gradeAdmin.token, { pageSize: '50' })).sort();
  assert.deepEqual(gradeVisible, ['scope-g1'], '年级管理员只看得到本年级的考试');
  assert.deepEqual(listedIds(await listRecords(classAdmin.token, { pageSize: '50' })).sort(), ['scope-class']);

  // 按年级筛选时全校考试要保留，班级参数按 targetClassIds 取交集
  assert.deepEqual(listedIds(await listRecords(admin.token, { gradeId: 'g1', pageSize: '50' })).sort(), [
    'scope-g1',
    'scope-school',
  ]);
  assert.deepEqual(
    listedIds(await listRecords(admin.token, { gradeId: 'g1', classIds: 'c1', pageSize: '50' })).sort(),
    ['scope-class', 'scope-g1', 'scope-school'],
  );
});

test('考试操作记录：详情页能读到操作者、前后状态与备注，越权记录返回 404', async () => {
  const endAt = Date.now() + 3_600_000;
  await seedMajors([
    { id: 'ops-g1', name: 'G1', targetGradeIds: ['g1'], startAt: Date.now() - 1_000, endAt },
    { id: 'ops-g2', name: 'G2', targetGradeIds: ['g2'], startAt: Date.now() - 1_000, endAt },
  ]);
  const gradeAdmin = await createUser('ops-grade', 'grade_admin', [{ type: 'grade', gradeId: 'g1' }]);

  await act(admin.token, 'record-publish', { id: 'ops-g1', reason: '开学考' });
  await systemStart('ops-g1');
  await act(admin.token, 'record-pause', { id: 'ops-g1', reason: '设备故障' });

  const response = await listOperations(admin.token, 'ops-g1');
  assert.equal(response.statusCode, 200);
  const entries = response.body.data as Array<Record<string, unknown>>;
  assert.deepEqual(
    entries.map((entry) => entry.action),
    // 开考现在由系统完成，操作日志里是 auto_start（actor 为空）而不是人工 start。
    ['pause', 'auto_start', 'publish'],
    '操作记录按时间倒序返回',
  );
  const pause = entries[0] ?? {};
  assert.equal(Number(pause.actorId), admin.id);
  assert.ok(String(pause.actorName).length > 0, '操作记录要带上操作者名字');
  assert.equal(String(pause.fromStatus), 'published');
  assert.equal(String(pause.toStatus), 'published');
  assert.ok(String(pause.reason).includes('设备故障'), '操作记录要保留操作者填写的原因');

  const denied = await listOperations(gradeAdmin.token, 'ops-g2');
  assert.equal(denied.statusCode, 404);
  assert.equal(denied.body.code, 'RECORD_NOT_FOUND');
  assert.equal((await listOperations(gradeAdmin.token, 'ops-g1')).statusCode, 200);

  const missingId = await listOperations(admin.token, '');
  assert.equal(missingId.statusCode, 400);
  assert.equal(missingId.body.code, 'INVALID_RECORD_ID');
});

test('考试中心板块：四个口径互不重叠，「当前考试」按进行中 → 待结束 → 今天即将开始排序', async () => {
  const now = Date.now();
  const hour = 3_600_000;
  const todayEnd = parseZonedTime(`${addDaysToDateKey(getShanghaiDateKey(now), 1)}T00:00:00`);
  // 贴近午夜运行时不再构造"今天稍后"，避免边界抖动；其余断言不依赖它。
  const todayLaterStart = todayEnd - now > 3 * hour ? now + hour : null;

  const majors: SeedMajor[] = [
    { id: 'cur-running', name: '进行中', startAt: now - hour, endAt: now + hour },
    { id: 'cur-overrun', name: '待结束', startAt: now - 3 * hour, endAt: now - hour },
    { id: 'next-tomorrow', name: '明天', startAt: todayEnd + 2 * hour, endAt: todayEnd + 3 * hour },
    { id: 'next-unscheduled', name: '未定时间' },
    { id: 'draft-only', name: '草稿' },
  ];
  if (todayLaterStart != null) {
    majors.push({
      id: 'cur-today',
      name: '今天稍后',
      startAt: todayLaterStart,
      endAt: todayLaterStart + hour,
    });
  }
  await seedMajors(majors);

  const published = ['cur-running', 'cur-overrun', 'next-tomorrow', 'next-unscheduled'];
  if (todayLaterStart != null) published.push('cur-today');
  for (const id of published) {
    assert.equal((await act(admin.token, 'record-publish', { id })).statusCode, 200, `${id} 应可发布`);
  }

  const currentIds = listedIds(await listRecords(admin.token, { preset: 'current', pageSize: '50' }));
  const scheduleIds = listedIds(await listRecords(admin.token, { preset: 'schedule', pageSize: '50' }));
  const draftIds = listedIds(await listRecords(admin.token, { preset: 'draft', pageSize: '50' }));

  const expectedCurrent = todayLaterStart == null ? ['cur-running'] : ['cur-running', 'cur-today'];
  // 「待结束」（开始与结束时间都过了）在新约定下会被系统收场并落到历史：
  // 这次读取里收掉还是下一次读取收掉都正常，所以允许它出现在当前考试里。
  assert.ok(
    currentIds.every((id) => expectedCurrent.includes(id) || id === 'cur-overrun'),
    `当前考试：进行中 → 待结束 → 今天即将开始（实际 ${currentIds.join(',')}）`,
  );
  assert.ok(currentIds.includes('cur-running'), '进行中的考试必须在当前考试里');
  assert.deepEqual(scheduleIds, ['next-tomorrow', 'next-unscheduled'], '考试安排按开始时间升序，未定时间的排在最后');
  assert.deepEqual(draftIds, ['draft-only']);

  // 已发布的考试必须恰好落在一个板块里
  const placed = [...currentIds, ...scheduleIds].sort();
  // 「待结束」到点后被系统自动收场，落到历史里，所以不在「当前+安排」这一组里。
  assert.deepEqual(placed, published.filter((id) => id !== 'cur-overrun').sort(), '已发布的考试不能漏出三个板块之外');
  assert.equal(
    listedIds(await listRecords(admin.token, { preset: 'history', pageSize: '50' })).includes('cur-overrun'),
    true,
    '到点未结束的考试由系统收场后进历史',
  );
  assert.equal(
    currentIds.some((id) => scheduleIds.includes(id)),
    false,
    '当前考试与考试安排不能重叠',
  );

  // 历史：默认不含归档，开关打开后并入
  await systemStart('cur-running');
  await act(admin.token, 'record-end', { id: 'cur-running' });
  // cur-overrun 已经由系统按到点收场，所以历史里是它 + 刚结束的 cur-running。
  assert.deepEqual(listedIds(await listRecords(admin.token, { preset: 'history', pageSize: '50' })).sort(), [
    'cur-overrun',
    'cur-running',
  ]);
  await act(admin.token, 'record-archive', { id: 'cur-running' });
  assert.deepEqual(
    listedIds(await listRecords(admin.token, { preset: 'history', pageSize: '50' })),
    ['cur-overrun'],
    '归档后默认从历史考试里隐藏',
  );
  assert.deepEqual(
    listedIds(await listRecords(admin.token, { preset: 'history', includeArchived: '1', pageSize: '50' })).sort(),
    ['cur-overrun', 'cur-running'],
    '打开归档开关后能翻出来',
  );

  const invalid = await listRecords(admin.token, { preset: 'nope' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.code, 'INVALID_PRESET');
});

test('草稿板块：删掉考试后残留的孤儿记录不再展示', async () => {
  const now = Date.now();
  await seedMajors([{ id: 'live-draft', name: '真草稿' }]);
  // 模拟历史数据：考试已从快照里删掉，但 exam_records 还留着行（投影只增不删）。
  await database()`
    INSERT INTO exam_records (
      id, runtime_major_id, name, description, status, items, target_grade_ids, target_class_ids,
      source, temporary, priority_over_schedule, config, created_by, created_at, updated_at, version, sort_order
    )
    VALUES (
      'orphan-draft', 'orphan-draft', '已删除的考试', '', 'draft', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      'regular', FALSE, FALSE, '{}'::jsonb, NULL, ${now}, ${now}, 1, 99
    )
  `;
  const ids = listedIds(await listRecords(admin.token, { preset: 'draft', pageSize: '50' }));
  assert.ok(ids.includes('live-draft'), '快照里仍然存在的草稿要展示');
  assert.equal(ids.includes('orphan-draft'), false, '快照里已不存在的孤儿草稿不再展示');
});

test('复制考试：结果强制进草稿，重新投影不会被自动发布，发布后才转正式', async () => {
  const now = Date.now();
  // 源考试科目时间齐全，按「创建即发布」本该是 published。
  await seedMajors([{ id: 'copy-src', name: '秋季第一次月考', startAt: now - 60_000, endAt: now + 3_600_000 }]);
  const sourceRows = await readRecord('copy-src');
  assert.equal(sourceRows.status, 'published');

  const copyCalls = await act(
    admin.token,
    'record-copy',
    { id: 'copy-src', name: '秋季第二次月考' },
    { 'idempotency-key': `copy-draft-${now}` },
  );
  const copied = data(copyCalls);
  const copiedId = String(copied.id);
  assert.notEqual(copiedId, 'copy-src');
  assert.equal(copied.status, 'draft', '复制结果必须是草稿');

  // 快照里带上 draft 标记：任何一次普通投影都不该把它推成已发布。
  const snapshotAfterCopy = await readSnapshotMajors();
  const copiedMajor = snapshotAfterCopy.find((major) => String(major.id) === copiedId);
  assert.equal(copiedMajor?.draft, true, '复制出来的考试要在快照上带 draft 标记');
  await database().transaction((transaction) => [projectCurrentExamRecords(transaction)]);
  assert.equal((await readRecord(copiedId)).status, 'draft', '重新投影后仍是草稿');

  // 通过保存管道再存一次同一份快照（模拟管理员在草稿上继续编辑）。
  await saveExamData(admin.token, snapshotAfterCopy, copiedId);
  assert.equal((await readRecord(copiedId)).status, 'draft', '再次保存后仍是草稿');

  // 真正发布之后才离开草稿，并且标记被清掉。
  const publishCalls = await act(admin.token, 'record-publish', { id: copiedId });
  assert.equal(data(publishCalls).status, 'published');
  const publishedSnapshot = await readSnapshotMajors();
  const publishedMajor = publishedSnapshot.find((major) => String(major.id) === copiedId);
  assert.equal(publishedMajor?.draft, undefined, '发布后 draft 标记要被清掉');
  assert.equal(typeof publishedMajor?.publishedAt, 'number');

  // 发布后再走一次投影，不能被 draft 标记拽回草稿。
  await database().transaction((transaction) => [projectCurrentExamRecords(transaction)]);
  assert.equal((await readRecord(copiedId)).status, 'published');
});

test('快速考试：走本地优先保存管道也会补齐生命周期操作日志', async () => {
  const now = Date.now();
  const quickMajor = {
    id: 'quick-lifecycle',
    name: '临时统一考试',
    items: [],
    order: 0,
    targetGradeIds: [],
    targetClassIds: [],
    source: 'quick',
    temporary: true,
    startAt: now - 60_000,
    endAt: now + 3_600_000,
    createdAt: now,
    createdBy: admin.id,
    endedAt: null,
  };

  // 1) 发布：投影会建出 status=published 的记录行，并补记一条 publish
  const published = await saveExamData(admin.token, [quickMajor], quickMajor.id);
  assert.equal(published.statusCode, 200);
  const record = await readRecord('quick-lifecycle');
  assert.equal(record.status, 'published');
  assert.equal(record.source, 'quick');
  assert.equal(Number(record.start_at), quickMajor.startAt, '快速考试也要有考试窗口');
  assert.equal(Number(record.end_at), quickMajor.endAt);
  assert.deepEqual(
    (await readOperations('quick-lifecycle')).map((entry) => entry.action),
    ['publish'],
  );

  // 2) 延长：endAt 变大记一条 extend
  const extendedEndAt = quickMajor.endAt + 5 * 60_000;
  await saveExamData(admin.token, [{ ...quickMajor, endAt: extendedEndAt }], quickMajor.id);
  // 3) 提前结束：记一条 end，记录状态跟着变
  const endedAt = Date.now();
  await saveExamData(admin.token, [{ ...quickMajor, endAt: extendedEndAt, endedAt }], quickMajor.id);
  const endedRecord = await readRecord('quick-lifecycle');
  assert.equal(endedRecord.status, 'ended');
  assert.equal(endedRecord.actual_end_at, null, '客户端路径只写 endedAt，不补 actual_end_at');

  const actionsAfterActions = (await readOperations('quick-lifecycle')).map((entry) => entry.action);
  assert.deepEqual([...actionsAfterActions].sort(), ['end', 'extend', 'publish']);

  const operations = await readOperations('quick-lifecycle');
  for (const entry of operations) {
    assert.equal(Number(entry.actor_id), admin.id, '快速考试的操作日志也要记录操作者');
  }
  const extendEntry = operations.find((entry) => entry.action === 'extend');
  assert.equal(String(extendEntry?.from_status), 'published');
  assert.equal(String(extendEntry?.to_status), 'published');
  const endEntry = operations.find((entry) => entry.action === 'end');
  assert.equal(String(endEntry?.to_status), 'ended');

  // 4) 重复保存同一份快照不应重复记日志（outbox 重放安全）
  await saveExamData(admin.token, [{ ...quickMajor, endAt: extendedEndAt, endedAt }], quickMajor.id);
  assert.deepEqual((await readOperations('quick-lifecycle')).map((entry) => entry.action).sort(), [
    'end',
    'extend',
    'publish',
  ]);
});

test('归档只读：已归档考试的修改与删除在服务端被冻结', async () => {
  const endAt = Date.now() + 3_600_000;
  await seedMajors([{ id: 'frozen', name: '待归档考试', startAt: Date.now() - 1_000, endAt }]);

  assert.equal((await act(admin.token, 'record-publish', { id: 'frozen' })).statusCode, 200);
  assert.equal((await act(admin.token, 'record-end', { id: 'frozen' })).statusCode, 200);
  assert.equal((await act(admin.token, 'record-archive', { id: 'frozen' })).statusCode, 200);

  const archivedMajor = (await readSnapshotMajors()).find((major) => major.id === 'frozen');
  assert.ok(archivedMajor, '归档后快照里仍应保留这场考试');
  assert.ok(Number(archivedMajor?.archivedAt) > 0, '归档动作要写入 archivedAt');

  // 1) 改名 → 服务端回退归档版本
  const renamed = await saveExamData(admin.token, [{ ...archivedMajor, name: '被改名的归档考试' }], 'frozen');
  assert.equal(renamed.statusCode, 200);
  assert.deepEqual(renamed.body.ignoredArchivedMajors, ['frozen']);
  let snapshot = await readSnapshotMajors();
  assert.equal(snapshot.find((major) => major.id === 'frozen')?.name, '待归档考试', '归档考试改名必须无效');

  // 2) 从快照里删掉 → 会被补回
  const removed = await saveExamData(admin.token, [], '');
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.body.ignoredArchivedMajors, ['frozen']);
  snapshot = await readSnapshotMajors();
  assert.equal(
    snapshot.some((major) => major.id === 'frozen'),
    true,
    '归档考试不能被删除，否则记录会失去运行时载体',
  );

  // 3) 取消归档后可以正常编辑
  assert.equal((await act(admin.token, 'record-unarchive', { id: 'frozen' })).statusCode, 200);
  const editable = (await readSnapshotMajors()).find((major) => major.id === 'frozen');
  const afterEdit = await saveExamData(admin.token, [{ ...editable, name: '取消归档后改名' }], 'frozen');
  assert.equal(afterEdit.statusCode, 200);
  assert.equal(afterEdit.body.ignoredArchivedMajors, undefined, '取消归档后不应再被冻结');
  snapshot = await readSnapshotMajors();
  assert.equal(snapshot.find((major) => major.id === 'frozen')?.name, '取消归档后改名');
});

test('系统自动开考 + 申请停止 + 到点判定结束（新生命周期的端到端）', async () => {
  const startedAt = Date.now() - 10 * 60_000;
  const endedAt = startedAt + 60 * 60_000; // 先给一段还在进行中的窗口，稍后再把它推到过去
  await seedMajors([{ id: 'auto-life', startAt: startedAt, endAt: endedAt }]);

  // 1) 创建即发布：科目/时间完整的大型考试投影出来就是 published（不再落 draft）
  const created = await readRecord('auto-life');
  assert.equal(created.status, 'published', '有完整时间窗的考试创建即发布');
  assert.equal(created.actual_start_at, null);

  // 2) 读列表时惰性自动开考：写入的是计划时间，并留下系统操作日志
  const listed = await listRecords(admin.token, { preset: 'current' });
  const row = (listed.body.data as Array<Record<string, unknown>>).find((item) => item.id === 'auto-life');
  assert.ok(row, '到点开考的考试应出现在当前考试板块');
  assert.equal(row.displayStatus, 'ongoing');
  const started = await readRecord('auto-life');
  assert.equal(Number(started.actual_start_at), startedAt, '实际开考时间写的是计划时间');
  const startOps = await readOperations('auto-life');
  assert.ok(
    startOps.some((op) => op.action === 'auto_start' && op.actor_id == null),
    '系统自动开考要留下 auto_start 操作日志（actor 为空）',
  );

  // 3) 手动结束 → 只是申请：状态仍是 published，但展示为「停止中」
  const requested = await act(admin.token, 'record-request-stop', { id: 'auto-life' });
  assert.equal(requested.statusCode, 200);
  const pending = await readRecord('auto-life');
  assert.equal(pending.status, 'published', '申请停止不直接改状态');
  assert.ok(Number(pending.stop_requested_at) > 0);
  const pendingList = await listRecords(admin.token, { preset: 'current' });
  const pendingRow = (pendingList.body.data as Array<Record<string, unknown>>).find((item) => item.id === 'auto-life');
  assert.equal(pendingRow?.displayStatus, 'stopping');

  // 4) 重复申请被拒（等系统判定即可）
  assert.equal((await act(admin.token, 'record-request-stop', { id: 'auto-life' })).statusCode, 409);

  // 5) 系统判定结束：到点优先，即便没有任何设备回执
  await database()`UPDATE exam_records SET end_at = ${Date.now() - 60_000} WHERE id = 'auto-life'`;
  await listRecords(admin.token, { preset: 'history' });
  const finished = await readRecord('auto-life');
  assert.equal(finished.status, 'ended');
  const expectedEndAt = Number(finished.end_at);
  assert.equal(Number(finished.actual_end_at), expectedEndAt, '到点判定按结束时间结算');
  assert.equal(finished.stop_requested_at, null);
  const endOps = await readOperations('auto-life');
  assert.ok(
    endOps.some((op) => op.action === 'auto_end' && String(op.reason ?? '').includes('到结束时间')),
    '系统判定结束要留下 auto_end 操作日志并写明原因',
  );
});

test('还没开考就申请停止 = 取消：立即结束，不用等到结束时间', async () => {
  const startAt = Date.now() + 6 * 60 * 60_000;
  await seedMajors([{ id: 'cancel-me', startAt, endAt: startAt + 60 * 60_000 }]);
  assert.equal((await readRecord('cancel-me')).status, 'published');

  const cancelled = await act(admin.token, 'record-request-stop', { id: 'cancel-me' });
  assert.equal(cancelled.statusCode, 200);
  await listRecords(admin.token, { preset: 'history' });

  const row = await readRecord('cancel-me');
  assert.equal(row.status, 'ended', '未开考就申请停止应当直接取消');
  assert.equal(row.actual_start_at, null, '没有真的开考过');
  const ops = await readOperations('cancel-me');
  assert.ok(
    ops.some((op) => op.action === 'auto_end' && String(op.reason ?? '').includes('取消')),
    '取消也要留下系统操作日志',
  );
});
