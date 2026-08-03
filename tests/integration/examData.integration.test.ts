import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BUILTIN_ROLES, authenticateUser, authSql, ensureAuthTables, getActor, makePasswordHash } from '../../api/_auth.js';
import { acquireGlobalWriteSlot, database, ensureTableOnce } from '../../api/_exams/db.js';
import { examPayload } from '../../api/_exams/payload.js';
import { handleDeviceRevoke, handleManagedDeviceSetup } from '../../api/_exams/routes/deviceAdminRoutes.js';
import { handleExamDataPost } from '../../api/_exams/routes/examDataRoutes.js';
import { handleResetData } from '../../api/_exams/routes/settingsRoutes.js';
import { __resetRateLimiterForTests, readRateLimitSetting } from '../../api/_rateLimiter.js';
import type { ExamRow } from '../../api/_exams/types.js';
import examsHandler from '../../api/exams.js';
import usersHandler from '../../api/users.js';

type Scope = { type: 'all' | 'grade' | 'class'; gradeId?: string; classId?: string };
type Login = { id: number; token: string };

const adminPassword = process.env.ADMIN_PASSWORD ?? '';
let admin: Login;

function makeRes() {
  const calls: { statusCode?: number; body?: any; headers: Record<string, unknown> } = { headers: {} };
  const res: VercelResponse = {
    setHeader(name: string, value: unknown) { calls.headers[name] = value; return res; },
    getHeader(name: string) { return calls.headers[name]; },
    status(code: number) { calls.statusCode = code; return res; },
    json(body: unknown) { calls.statusCode ??= 200; calls.body = body; return res; },
    send(body: unknown) { calls.statusCode ??= 200; calls.body = body; return res; },
    end() { calls.statusCode ??= 200; return res; },
  } as unknown as VercelResponse;
  return { res, calls };
}

function makeReq(token: string, body: Record<string, unknown>): VercelRequest {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    query: {},
    cookies: {},
    body,
  } as unknown as VercelRequest;
}

function makeTopLevelReq(
  method: string,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): VercelRequest {
  return {
    method,
    headers,
    query: {},
    cookies: {},
    body,
  } as unknown as VercelRequest;
}

async function clearDatabase() {
  const sql = database();
  await sql`
    TRUNCATE TABLE
      app_audit_logs,
      app_user_scopes,
      app_users,
      app_roles,
      app_auth,
      app_telemetry_config,
      device_instances,
      classisland_plugin_instances,
      write_throttle,
      exam_data
    RESTART IDENTITY CASCADE
  `;
  await sql`
    INSERT INTO exam_data (id, items, title, updated_at)
    VALUES (1, '[]', '', 0)
  `;
  await sql`
    INSERT INTO write_throttle (id, next_allowed_at)
    VALUES (1, 0)
  `;
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

async function resetDatabase(): Promise<Login> {
  await ensureTableOnce();
  await ensureAuthTables();
  await clearDatabase();
  await seedRoles();
  const login = await authenticateUser('admin', adminPassword);
  assert.ok(login, 'the integration runner must bootstrap the disposable super administrator');
  return { id: login.actor.id, token: login.token };
}

async function createUser(username: string, roleId: string, scopes: Scope[]): Promise<Login> {
  const password = await makePasswordHash(`${username}-password`);
  const now = Date.now();
  const sql = authSql();
  const rows = await sql`
    INSERT INTO app_users (username, display_name, password_hash, password_salt, role_id, status, must_change_password, token_version, created_at, updated_at)
    VALUES (${username}, ${username}, ${password.hash}, ${password.salt}, ${roleId}, 'active', FALSE, 1, ${now}, ${now})
    RETURNING id
  ` as unknown as Array<{ id: number }>;
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

async function seedExam(input: { grades?: any[]; classes?: any[]; majors?: any[]; weeklyPlans?: any[] }) {
  const sql = database();
  const updatedAt = Date.now();
  await sql`
    UPDATE exam_data
    SET items = '[]'::jsonb,
        title = 'Seed exam',
        majors = ${JSON.stringify(input.majors ?? [])}::jsonb,
        active_major_id = ${(input.majors?.[0]?.id ?? '')},
        alerts = NULL,
        weekly_plans = ${JSON.stringify(input.weeklyPlans ?? [])}::jsonb,
        schedule_mode = 'major-only',
        active_weekly_plan_id = '',
        active_weekly_plan_by_class = '{}'::jsonb,
        weekly_conflict_policy = NULL,
        grades = ${JSON.stringify(input.grades ?? [])}::jsonb,
        classes = ${JSON.stringify(input.classes ?? [])}::jsonb,
        initialization = '{}'::jsonb,
        updated_at = ${updatedAt}
    WHERE id = 1
  `;
}

async function readPayload() {
  const rows = await database()`
    SELECT items, title, majors, active_major_id, alerts, weekly_plans, schedule_mode,
           active_weekly_plan_id, active_weekly_plan_by_class, weekly_conflict_policy,
           grades, classes, initialization, design_policy, updated_at
    FROM exam_data WHERE id = 1
  ` as unknown as ExamRow[];
  return examPayload(rows[0] ?? {});
}

function bodyFrom(payload: ReturnType<typeof examPayload>, patch: Record<string, unknown> = {}) {
  return {
    items: payload.items,
    title: payload.title,
    majors: payload.majors,
    activeMajorId: payload.activeMajorId,
    alerts: payload.alerts,
    weeklyPlans: payload.weeklyPlans,
    scheduleMode: payload.scheduleMode,
    activeWeeklyPlanId: payload.activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId: payload.activeWeeklyPlanIdByClassId,
    weeklyConflictPolicy: payload.weeklyConflictPolicy,
    grades: payload.grades,
    classes: payload.classes,
    initialization: payload.initialization,
    baseUpdatedAt: payload.updatedAt,
    ...patch,
  };
}

async function post(token: string, body: Record<string, unknown>) {
  const { res, calls } = makeRes();
  await handleExamDataPost(makeReq(token, body), res, Date.now());
  return calls;
}

async function postReset(token: string, categories: string[]) {
  const { res, calls } = makeRes();
  await handleResetData(makeReq(token, { categories }), res);
  return calls;
}

async function postDeviceRevoke(token: string, instanceId: string) {
  const { res, calls } = makeRes();
  await handleDeviceRevoke(makeReq(token, { instanceId }), res);
  return calls;
}

async function postUser(token: string, body: Record<string, unknown>) {
  const { res, calls } = makeRes();
  await usersHandler(makeReq(token, { resource: 'users', ...body }), res);
  return calls;
}

async function getAudit(token: string) {
  const { res, calls } = makeRes();
  const req = { ...makeReq(token, {}), method: 'GET', query: { resource: 'audit' } } as unknown as VercelRequest;
  await usersHandler(req, res);
  return calls;
}

beforeEach(async () => {
  assert.ok(adminPassword.length >= 16, 'the integration runner must inject a strong temporary password');
  admin = await resetDatabase();
  __resetRateLimiterForTests();
});

after(async () => {
  await clearDatabase();
  const rows = await database()`
    SELECT
      (SELECT COUNT(*)::int FROM exam_data) AS exam_count,
      (SELECT COUNT(*)::int FROM app_users) AS user_count,
      (SELECT COUNT(*)::int FROM app_user_scopes) AS scope_count
  ` as unknown as Array<{ exam_count: number; user_count: number; scope_count: number }>;
  assert.equal(Number(rows[0]?.exam_count), 1);
  assert.equal(Number(rows[0]?.user_count), 0);
  assert.equal(Number(rows[0]?.scope_count), 0);
});

test('database write: deleting grades and classes removes matching scopes and their former access', async () => {
  await seedExam({
    grades: [{ id: 'g1', name: 'Grade one' }, { id: 'g2', name: 'Grade two' }],
    classes: [{ id: 'c1', gradeId: 'g1', name: 'Class one' }, { id: 'c2', gradeId: 'g2', name: 'Class two' }],
  });
  const removedGrade = await createUser('removed-grade', 'grade_admin', [{ type: 'grade', gradeId: 'g1' }]);
  await createUser('removed-class', 'class_admin', [{ type: 'class', gradeId: 'g1', classId: 'c1' }]);
  await createUser('kept-grade', 'grade_admin', [{ type: 'grade', gradeId: 'g2' }]);
  await createUser('kept-class', 'class_admin', [{ type: 'class', gradeId: 'g2', classId: 'c2' }]);

  const current = await readPayload();
  const response = await post(admin.token, bodyFrom(current, {
    grades: [{ id: 'g2', name: 'Grade two' }],
    classes: [{ id: 'c2', gradeId: 'g2', name: 'Class two' }],
  }));

  assert.equal(response.statusCode, 200);
  const scopes = await authSql()`SELECT scope_type, grade_id, class_id FROM app_user_scopes` as unknown as Array<{ scope_type: string; grade_id: string; class_id: string }>;
  assert.equal(scopes.some(scope => scope.grade_id === 'g1' || scope.class_id === 'c1'), false);
  assert.equal(scopes.some(scope => scope.scope_type === 'grade' && scope.grade_id === 'g2'), true);
  assert.equal(scopes.some(scope => scope.scope_type === 'class' && scope.class_id === 'c2'), true);
  assert.equal(scopes.some(scope => scope.scope_type === 'all'), true);

  const afterDeletion = await readPayload();
  const denied = await post(removedGrade.token, bodyFrom(afterDeletion, {
    majors: [{ id: 'removed-grade-major', name: 'No remaining scope', items: [], order: 0, targetGradeIds: ['g1'], targetClassIds: [] }],
    activeMajorId: 'removed-grade-major',
  }));
  assert.equal(denied.statusCode, 403);
});

test('database write: stale out-of-scope data cannot block or overwrite an owned quick-exam change', async () => {
  const formal = { id: 'formal', name: 'Formal server', items: [], order: 0, targetGradeIds: ['g1'], targetClassIds: [] };
  const ownWeekly = { id: 'own-weekly', gradeId: 'g1', classId: 'c1', name: 'Own server' };
  const otherWeekly = { id: 'other-weekly', gradeId: 'g2', classId: 'c2', name: 'Other old' };
  await seedExam({
    grades: [{ id: 'g1' }, { id: 'g2' }],
    classes: [{ id: 'c1', gradeId: 'g1' }, { id: 'c2', gradeId: 'g2' }],
    majors: [formal],
    weeklyPlans: [ownWeekly, otherWeekly],
  });
  const classAdmin = await createUser('class-owner', 'class_admin', [{ type: 'class', gradeId: 'g1', classId: 'c1' }]);
  const stale = await readPayload();

  const newer = await readPayload();
  const superWrite = await post(admin.token, bodyFrom(newer, {
    weeklyPlans: newer.weeklyPlans.map(plan => plan.id === 'other-weekly' ? { ...plan, name: 'Other current' } : plan),
  }));
  assert.equal(superWrite.statusCode, 200);
  const current = await readPayload();

  const quick = {
    id: 'quick-owned', name: 'Quick owned', items: [{ id: 'quick-item', name: 'Math' }], order: 1,
    targetGradeIds: ['g1'], targetClassIds: ['c1'], source: 'quick', temporary: true, createdBy: classAdmin.id,
  };
  const create = await post(classAdmin.token, bodyFrom(stale, {
    majors: [{ ...formal, name: 'Stale formal edit' }, quick],
    items: quick.items,
    title: quick.name,
    activeMajorId: quick.id,
    baseUpdatedAt: current.updatedAt,
  }));
  assert.equal(create.statusCode, 200);
  let persisted = await readPayload();
  assert.equal(persisted.majors.find(major => major.id === 'formal')?.name, 'Formal server');
  assert.equal(persisted.weeklyPlans.find(plan => plan.id === 'other-weekly')?.name, 'Other current');
  assert.ok(persisted.majors.some(major => major.id === quick.id));

  const beforeDelete = await readPayload();
  const remove = await post(classAdmin.token, bodyFrom(beforeDelete, {
    majors: [{ ...formal, name: 'Another stale formal edit' }],
    items: [],
    title: formal.name,
    activeMajorId: formal.id,
    weeklyPlans: stale.weeklyPlans,
  }));
  assert.equal(remove.statusCode, 200);
  persisted = await readPayload();
  assert.equal(persisted.majors.some(major => major.id === quick.id), false);
  assert.equal(persisted.majors.find(major => major.id === formal.id)?.name, 'Formal server');
  assert.equal(persisted.weeklyPlans.find(plan => plan.id === 'other-weekly')?.name, 'Other current');
});

test('database write: a class administrator cannot modify a formal exam in scope', async () => {
  const formal = { id: 'formal', name: 'Formal server', items: [], order: 0, targetGradeIds: ['g1'], targetClassIds: ['c1'] };
  await seedExam({ grades: [{ id: 'g1' }], classes: [{ id: 'c1', gradeId: 'g1' }], majors: [formal] });
  const classAdmin = await createUser('class-denied', 'class_admin', [{ type: 'class', gradeId: 'g1', classId: 'c1' }]);
  const current = await readPayload();

  const response = await post(classAdmin.token, bodyFrom(current, {
    majors: [{ ...formal, name: 'Forbidden formal change' }],
    title: 'Forbidden formal change',
  }));

  assert.equal(response.statusCode, 403);
  assert.equal(response.body?.code, 'PERMISSION_DENIED');
  const persisted = await readPayload();
  assert.equal(persisted.majors.find(major => major.id === formal.id)?.name, 'Formal server');
});

test('database write: concurrent writes yield exactly one success and one rejection (429 slot or 409 stale)', async () => {
  await seedExam({});
  const base = await readPayload();

  const [first, second] = await Promise.all([
    post(admin.token, bodyFrom(base, { title: 'Concurrent first' })),
    post(admin.token, bodyFrom(base, { title: 'Concurrent second' })),
  ]);

  const statuses = [first.statusCode, second.statusCode].sort();
  assert.equal(statuses[0], 200, 'exactly one concurrent writer must succeed');
  assert.ok(statuses[1] === 429 || statuses[1] === 409, `expected the second writer to be rejected (429 slot or 409 stale), got ${statuses[1]}`);
  const rejected = [first, second].find(response => response.statusCode === statuses[1]);
  if (statuses[1] === 429) assert.equal(rejected?.body?.code, 'RATE_LIMITED');
  if (statuses[1] === 409) assert.equal(rejected?.body?.code, 'DATA_CONFLICT');
  const persisted = await readPayload();
  assert.ok(['Concurrent first', 'Concurrent second'].includes(persisted.title));
});

test('database device route: a grade administrator cannot revoke a device in another grade', async () => {
  await seedExam({
    grades: [{ id: 'g1' }, { id: 'g2' }],
    classes: [{ id: 'c1', gradeId: 'g1' }, { id: 'c2', gradeId: 'g2' }],
  });
  const gradeAdmin = await createUser('device-scope-admin', 'grade_admin', [{ type: 'grade', gradeId: 'g1' }]);
  await database()`INSERT INTO device_instances (instance_id, grade_id, class_id, revoked, updated_at)
    VALUES ('other-grade-device', 'g2', 'c2', FALSE, ${Date.now()})`;

  const response = await postDeviceRevoke(gradeAdmin.token, 'other-grade-device');
  assert.equal(response.statusCode, 403);
  const rows = await database()`SELECT revoked FROM device_instances WHERE instance_id='other-grade-device'` as unknown as Array<{ revoked: boolean }>;
  assert.equal(rows[0]?.revoked, false);
});

test('database reset route: a scoped actor with reset permission cannot reset school data', async () => {
  await seedExam({ grades: [{ id: 'g1' }], classes: [{ id: 'c1', gradeId: 'g1' }] });
  const now = Date.now();
  await authSql()`INSERT INTO app_roles (id, name, description, permissions, built_in, created_at, updated_at)
    VALUES ('scoped_reset', 'Scoped reset', '', ${JSON.stringify(['initialization.run'])}::jsonb, FALSE, ${now}, ${now})`;
  const scopedActor = await createUser('scoped-reset-admin', 'scoped_reset', [{ type: 'grade', gradeId: 'g1' }]);

  const response = await postReset(scopedActor.token, ['school']);
  assert.equal(response.statusCode, 403);
  const persisted = await readPayload();
  assert.equal(persisted.grades.some(grade => grade.id === 'g1'), true);
});

test('database users route: role changes invalidate the old token', async () => {
  const target = await createUser('role-change-target', 'grade_admin', [{ type: 'grade', gradeId: 'g1' }]);
  const response = await postUser(admin.token, {
    action: 'update',
    id: target.id,
    displayName: 'Role change target',
    roleId: 'viewer',
    status: 'active',
    scopes: [{ type: 'grade', gradeId: 'g1' }],
  });
  assert.equal(response.statusCode, 200);
  assert.equal(await getActor(target.token), null);
});

test('database audit route: an all-scope administrator receives recent login failure alerts', async () => {
  const now = Date.now();
  for (const offset of [0, 1_000, 2_000]) {
    await authSql()`INSERT INTO app_audit_logs (user_id, username, action, resource_type, resource_id, grade_id, class_id, detail, created_at)
      VALUES (NULL, 'login-alert-target', 'auth.login.failed', 'user', '', '', '', NULL, ${now - offset})`;
  }
  const response = await getAudit(admin.token);
  assert.equal(response.statusCode, 200);
  const alerts = Array.isArray(response.body?.loginFailureAlerts) ? response.body.loginFailureAlerts : [];
  assert.equal(alerts.some((alert: { username?: string; failureCount?: number }) => alert.username === 'login-alert-target' && alert.failureCount === 3), true);
});

test('database transaction: a later foreign-key failure rolls back the earlier write', async () => {
  const target = await createUser('rollback-target', 'grade_admin', [{ type: 'grade', gradeId: 'g1' }]);

  await assert.rejects(() => authSql().transaction(transaction => [
    transaction`UPDATE app_users SET display_name='must-rollback' WHERE id=${target.id}`,
    transaction`INSERT INTO app_user_scopes (user_id, scope_type, grade_id, class_id)
      VALUES (999999999, 'grade', 'missing-user-scope', '')`,
  ]));

  const rows = await authSql()`SELECT display_name FROM app_users WHERE id=${target.id}` as unknown as Array<{ display_name: string }>;
  assert.equal(rows[0]?.display_name, 'rollback-target');
});

test('database reset route: a full reset clears exam and device state together', async () => {
  await seedExam({
    grades: [{ id: 'g1' }],
    classes: [{ id: 'c1', gradeId: 'g1' }],
    majors: [{ id: 'm1', name: 'Exam', items: [], order: 0, targetGradeIds: ['g1'], targetClassIds: ['c1'] }],
    weeklyPlans: [{ id: 'w1', gradeId: 'g1', classId: 'c1', name: 'Weekly' }],
  });
  const now = Date.now();
  await database()`INSERT INTO device_instances (instance_id, grade_id, class_id, revoked, updated_at)
    VALUES ('reset-device', 'g1', 'c1', FALSE, ${now})`;
  await database()`INSERT INTO classisland_plugin_instances (plugin_instance_id, client_secret_hash, viewer_instance_id, paired, created_at, updated_at)
    VALUES ('reset-plugin', 'hash', 'reset-device', TRUE, ${now}, ${now})`;

  const response = await postReset(admin.token, ['all']);
  assert.equal(response.statusCode, 200);
  const payload = await readPayload();
  assert.deepEqual(payload.majors, []);
  assert.deepEqual(payload.grades, []);
  assert.deepEqual(payload.classes, []);
  assert.deepEqual(payload.weeklyPlans, []);
  const devices = await database()`SELECT COUNT(*)::int AS count FROM device_instances` as unknown as Array<{ count: number }>;
  const plugins = await database()`SELECT COUNT(*)::int AS count FROM classisland_plugin_instances` as unknown as Array<{ count: number }>;
  assert.equal(Number(devices[0]?.count), 0);
  assert.equal(Number(plugins[0]?.count), 0);
});

test('database device route: replacing a class device revokes and unpairs the old binding', async () => {
  const first = makeRes();
  await handleManagedDeviceSetup(makeReq(admin.token, {
    instanceId: 'device-a', gradeId: 'g1', classId: 'c1',
  }), first.res);
  assert.equal(first.calls.statusCode, 200);
  const now = Date.now();
  await database()`INSERT INTO classisland_plugin_instances (plugin_instance_id, client_secret_hash, viewer_instance_id, grade_id, class_id, paired, created_at, updated_at)
    VALUES ('plugin-a', 'hash', 'device-a', 'g1', 'c1', TRUE, ${now}, ${now})`;

  const second = makeRes();
  await handleManagedDeviceSetup(makeReq(admin.token, {
    instanceId: 'device-b', gradeId: 'g1', classId: 'c1', replaceExisting: true,
  }), second.res);
  assert.equal(second.calls.statusCode, 200);
  const devices = await database()`SELECT instance_id, revoked, grade_id, class_id FROM device_instances ORDER BY instance_id` as unknown as Array<{ instance_id: string; revoked: boolean; grade_id: string; class_id: string }>;
  assert.deepEqual(devices, [
    { instance_id: 'device-a', revoked: true, grade_id: '', class_id: '' },
    { instance_id: 'device-b', revoked: false, grade_id: 'g1', class_id: 'c1' },
  ]);
  const plugins = await database()`SELECT paired, grade_id, class_id FROM classisland_plugin_instances WHERE plugin_instance_id='plugin-a'` as unknown as Array<{ paired: boolean; grade_id: string; class_id: string }>;
  assert.deepEqual(plugins, [{ paired: false, grade_id: '', class_id: '' }]);
});


test('database write: the global write slot admits exactly one concurrent acquirer', async () => {
  const results = await Promise.all([acquireGlobalWriteSlot(), acquireGlobalWriteSlot()]);
  assert.equal(results.filter(Boolean).length, 1);
});

test('top-level handler: OPTIONS bypasses the rate limiter', async () => {
  const responses = Array.from({ length: 40 }, () => makeRes());
  await Promise.all(responses.map(({ res }) => examsHandler(
    makeTopLevelReq('OPTIONS', {}, { origin: 'https://example.com', 'x-forwarded-for': '203.0.113.10' }),
    res,
  )));
  assert.equal(responses.every(({ calls }) => calls.statusCode === 204), true);

  const next = makeRes();
  await examsHandler(makeTopLevelReq('GET'), next.res);
  assert.equal(next.calls.statusCode, 200);
});

test('top-level handler: concurrent reads return the same current snapshot', async () => {
  await seedExam({ majors: [{ id: 'm1', name: 'Shared', items: [], order: 0, targetGradeIds: [], targetClassIds: [] }] });
  let responses = Array.from({ length: 5 }, () => makeRes());
  await Promise.all(responses.map(({ res }) => examsHandler(makeTopLevelReq('GET', {}, { 'x-forwarded-for': '203.0.113.11' }), res)));
  if (!responses.every(({ calls }) => calls.statusCode === 200)) {
    // Neon pooler can surface a transient transport 500 under parallel load; retry the batch once.
    responses = Array.from({ length: 5 }, () => makeRes());
    await Promise.all(responses.map(({ res }) => examsHandler(makeTopLevelReq('GET', {}, { 'x-forwarded-for': '203.0.113.11' }), res)));
  }
  assert.deepEqual(responses.map(({ calls }) => calls.statusCode), [200, 200, 200, 200, 200], 'concurrent read statuses');
  const parsed = responses.map(({ calls }) => JSON.parse(calls.body));
  const updatedAts = new Set(parsed.map(body => body.updatedAt));
  assert.equal(updatedAts.size, 1, 'concurrent reads must return the same updatedAt');
  assert.deepEqual(parsed.map(body => body.majors?.map((major: { id: string }) => major.id)), [['m1'], ['m1'], ['m1'], ['m1'], ['m1']], 'concurrent read major ids');
});

test('top-level handler: concurrent reset requests complete safely (one throttled when the 900ms slot window is not exceeded)', async () => {
  await seedExam({ majors: [{ id: 'm1', name: 'Reset', items: [], order: 0, targetGradeIds: [], targetClassIds: [] }] });
  const headers = { authorization: `Bearer ${admin.token}` };
  const first = makeRes();
  const second = makeRes();
  await Promise.all([
    examsHandler(makeTopLevelReq('POST', { action: 'reset-data', categories: ['major'] }, headers), first.res),
    examsHandler(makeTopLevelReq('POST', { action: 'reset-data', categories: ['major'] }, headers), second.res),
  ]);
  const statuses = [first.calls.statusCode, second.calls.statusCode].sort();
  assert.ok(statuses.every(code => code === 200 || code === 429), `unexpected statuses ${statuses.join(',')}`);
  assert.ok(statuses.includes(200), 'at least one reset must succeed');
  if (statuses.includes(429)) {
    assert.equal([first, second].find(({ calls }) => calls.statusCode === 429)?.calls.body?.code, 'RATE_LIMITED');
  }
});

test('top-level handler: the general entry limit rejects the request over its budget', async () => {
  const maximum = readRateLimitSetting(process.env.ENTRY_RATE_LIMIT_MAX_REQUESTS, 30);
  const responses = Array.from({ length: maximum + 1 }, () => makeRes());
  for (const { res } of responses) await examsHandler(makeTopLevelReq('GET', {}, { 'x-forwarded-for': '203.0.113.12' }), res);
  assert.equal(responses.slice(0, maximum).every(({ calls }) => calls.statusCode === 200), true);
  assert.equal(responses[maximum].calls.statusCode, 429);
  assert.equal(responses[maximum].calls.body?.code, 'RATE_LIMITED');
});
