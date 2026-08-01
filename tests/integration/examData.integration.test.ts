import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BUILTIN_ROLES, authenticateUser, authSql, ensureAuthTables, makePasswordHash } from '../../api/_auth.js';
import { database, ensureTableOnce } from '../../api/_exams/db.js';
import { examPayload } from '../../api/_exams/payload.js';
import { handleExamDataPost } from '../../api/_exams/routes/examDataRoutes.js';
import type { ExamRow } from '../../api/_exams/types.js';

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
    json(body: unknown) { calls.body = body; return res; },
    send(body: unknown) { calls.body = body; return res; },
    end() { return res; },
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

async function clearDatabase() {
  const sql = database();
  await sql`
    TRUNCATE TABLE
      app_audit_logs,
      app_user_scopes,
      app_users,
      app_roles,
      app_auth,
      device_instances,
      classisland_plugin_instances,
      exam_data
    RESTART IDENTITY CASCADE
  `;
  await sql`
    INSERT INTO exam_data (id, items, title, updated_at)
    VALUES (1, '[]', '', 0)
  `;
}

async function seedRoles() {
  const sql = authSql();
  const now = Date.now();
  for (const role of BUILTIN_ROLES) {
    await sql`
      INSERT INTO app_roles (id, name, description, permissions, built_in, created_at, updated_at)
      VALUES (${role.id}, ${role.name}, ${role.description}, ${JSON.stringify(role.permissions)}::jsonb, TRUE, ${now}, ${now})
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

async function createUser(username: string, roleId: 'grade_admin' | 'class_admin', scopes: Scope[]): Promise<Login> {
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

beforeEach(async () => {
  assert.ok(adminPassword.length >= 16, 'the integration runner must inject a strong temporary password');
  admin = await resetDatabase();
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

test('database write: deleting grades and classes removes only their matching authorization scopes', async () => {
  await seedExam({
    grades: [{ id: 'g1', name: 'Grade one' }, { id: 'g2', name: 'Grade two' }],
    classes: [{ id: 'c1', gradeId: 'g1', name: 'Class one' }, { id: 'c2', gradeId: 'g2', name: 'Class two' }],
  });
  await createUser('removed-grade', 'grade_admin', [{ type: 'grade', gradeId: 'g1' }]);
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

test('database write: concurrent writes from one version yield one success and one conflict', async () => {
  await seedExam({});
  const base = await readPayload();

  const [first, second] = await Promise.all([
    post(admin.token, bodyFrom(base, { title: 'Concurrent first' })),
    post(admin.token, bodyFrom(base, { title: 'Concurrent second' })),
  ]);

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  const persisted = await readPayload();
  assert.ok(['Concurrent first', 'Concurrent second'].includes(persisted.title));
});
