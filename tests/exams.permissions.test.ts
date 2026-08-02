import assert from 'node:assert/strict';
import test from 'node:test';
import { isolateQuickMajorCreate, sanitizeStaleSnapshot, validateMutation, allScope } from '../api/_exams/permissions.js';
import type { AdminActor, AdminScope, Permission } from '../api/_auth.js';
import type { ExamPayload } from '../api/_exams/payload.js';

function makeActor(overrides: Partial<AdminActor> = {}): AdminActor {
  return {
    id: 1,
    username: 'actor',
    displayName: 'Actor',
    roleId: 'custom',
    roleName: 'Custom',
    permissions: [],
    scopes: [],
    mustChangePassword: false,
    ...overrides,
  };
}

function scope(partial: Partial<AdminScope>): AdminScope {
  return { type: 'grade', gradeId: '', classId: '', ...partial };
}

function makeCurrent(overrides: Partial<ExamPayload> = {}): ExamPayload {
  return {
    ok: true,
    items: [],
    title: '',
    majors: [],
    activeMajorId: '',
    alerts: null,
    weeklyPlans: [],
    scheduleMode: 'major-only',
    activeWeeklyPlanId: '',
    activeWeeklyPlanIdByClassId: {},
    grades: [],
    classes: [],
    initialization: {},
    weeklyConflictPolicy: null,
    designPolicy: { rules: [], updatedAt: 0 },
    updatedAt: 0,
    ...overrides,
  } as ExamPayload;
}

test('allScope: true for wildcard permission or an explicit all-type scope, false otherwise', () => {
  assert.equal(allScope(makeActor({ permissions: ['*'] })), true);
  assert.equal(allScope(makeActor({ scopes: [scope({ type: 'all' })] })), true);
  assert.equal(allScope(makeActor({ scopes: [scope({ type: 'grade', gradeId: 'g1' })] })), false);
});

test('validateMutation: a body with no real changes from current requires no permissions', () => {
  const actor = makeActor();
  const current = makeCurrent();
  const result = validateMutation(actor, current, {});
  assert.deepEqual(result, { ok: true, actions: [] });
});

test('validateMutation: adding a formal major without major.create is denied', () => {
  const actor = makeActor({ scopes: [scope({ type: 'all' })] }); // all-scope but missing the permission itself
  const current = makeCurrent();
  const newMajor = { id: 'm1', name: '新考试', items: [], order: 0, targetGradeIds: [], targetClassIds: [] };
  const result = validateMutation(actor, current, { majors: [newMajor] });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.permission, 'major.create');
    assert.match(result.error, /新建大型考试/);
  }
});

test('validateMutation: adding a school-wide major succeeds for an all-scope actor with major.create + major.edit', () => {
  // Setting activeMajorId/title to the newly-added major also counts as an edit of the
  // "active major" selection, so major.edit is required in addition to major.create.
  const actor = makeActor({ permissions: ['major.create', 'major.edit'], scopes: [scope({ type: 'all' })] });
  const current = makeCurrent();
  const newMajor = { id: 'm1', name: '新考试', items: [], order: 0, targetGradeIds: [], targetClassIds: [] };
  const result = validateMutation(actor, current, { majors: [newMajor], title: '新考试', activeMajorId: 'm1' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.actions.includes('major.create'));
    assert.ok(result.actions.includes('major.edit'));
  }
});

test('validateMutation: adding a major without also switching the active major only needs major.create', () => {
  const actor = makeActor({ permissions: ['major.create'], scopes: [scope({ type: 'all' })] });
  const current = makeCurrent();
  const newMajor = { id: 'm1', name: '新考试', items: [], order: 0, targetGradeIds: [], targetClassIds: [] };
  // title/activeMajorId left as their current empty-string defaults -> no active-major switch.
  const result = validateMutation(actor, current, { majors: [newMajor] });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.actions.includes('major.create'));
    assert.ok(!result.actions.includes('major.edit'));
  }
});

test('validateMutation: a grade-scoped major.create actor cannot target a grade outside their scope', () => {
  const actor = makeActor({ permissions: ['major.create'], scopes: [scope({ type: 'grade', gradeId: 'g1' })] });
  const current = makeCurrent();
  const newMajor = { id: 'm1', name: '新考试', items: [], order: 0, targetGradeIds: ['g2'], targetClassIds: [] };
  const result = validateMutation(actor, current, { majors: [newMajor] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /无权管理的年级/);
});

test('validateMutation: the same actor CAN target their own grade', () => {
  const actor = makeActor({ permissions: ['major.create'], scopes: [scope({ type: 'grade', gradeId: 'g1' })] });
  const current = makeCurrent();
  const newMajor = { id: 'm1', name: '新考试', items: [], order: 0, targetGradeIds: ['g1'], targetClassIds: [] };
  const result = validateMutation(actor, current, { majors: [newMajor] });
  assert.equal(result.ok, true);
});

test('validateMutation: removing a major requires major.delete', () => {
  const existing = { id: 'm1', name: '旧考试', items: [], order: 0, targetGradeIds: [], targetClassIds: [] };
  const actor = makeActor({ scopes: [scope({ type: 'all' })] });
  const current = makeCurrent({ majors: [existing], activeMajorId: 'm1' });
  const result = validateMutation(actor, current, { majors: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.permission, 'major.delete');
});

test('validateMutation: quick_create lets an actor manage their own quick/temporary major without major.create/edit/delete', () => {
  const actor = makeActor({
    id: 7,
    permissions: ['major.quick_create'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const current = makeCurrent({ classes: [{ id: 'c1', gradeId: 'g1', name: '1班' }] });
  const quickMajor = {
    id: 'm1',
    name: '临时测验',
    items: [{ id: 'i1', name: '语文' }],
    order: 0,
    targetGradeIds: [],
    targetClassIds: ['c1'],
    source: 'quick',
    temporary: true,
    createdBy: 7,
  };
  const result = validateMutation(actor, current, {
    majors: [quickMajor],
    items: quickMajor.items,
    title: quickMajor.name,
    activeMajorId: 'm1',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.actions.includes('major.quick_create'));
});

test('isolateQuickMajorCreate: keeps only a class admin\'s new quick major from a stale full snapshot', () => {
  const actor = makeActor({
    id: 7,
    permissions: ['major.quick_create'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const formal = { id: 'formal', name: 'formal', items: [], targetGradeIds: ['g1'], targetClassIds: [] };
  const quick = {
    id: 'quick', name: 'quick', items: [{ id: 'i1', name: 'math' }],
    targetGradeIds: ['g1'], targetClassIds: ['c1'], source: 'quick',
    temporary: true, createdBy: 7,
  };
  const current = makeCurrent({ majors: [formal], classes: [{ id: 'c1', gradeId: 'g1' }] });
  const isolated = isolateQuickMajorCreate(actor, current, {
    majors: [{ ...formal, name: 'stale formal change' }, quick],
    items: quick.items,
    title: quick.name,
    activeMajorId: quick.id,
  });
  assert.deepEqual(isolated.majors, [formal, quick]);
  const result = validateMutation(actor, current, isolated);
  assert.equal(result.ok, true);
});

test('isolateQuickMajorCreate: rebuilds a quick-major deletion from the server snapshot', () => {
  const actor = makeActor({
    id: 7,
    permissions: ['major.quick_create'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const formal = { id: 'formal', name: 'formal', items: [], targetGradeIds: ['g1'], targetClassIds: [] };
  const retained = { id: 'retained', name: 'retained', items: [], targetGradeIds: ['g1'], targetClassIds: ['c1'], source: 'quick', temporary: true, createdBy: 8 };
  const removed = { id: 'removed', name: 'removed', items: [], targetGradeIds: ['g1'], targetClassIds: ['c1'], source: 'quick', temporary: true, createdBy: 7 };
  const current = makeCurrent({ majors: [formal, retained, removed], activeMajorId: 'formal', title: 'formal', classes: [{ id: 'c1', gradeId: 'g1' }] });
  const isolated = isolateQuickMajorCreate(actor, current, {
    majors: [{ ...formal, name: 'stale client formal' }],
    items: [],
    title: 'formal',
    activeMajorId: 'formal',
  });
  assert.deepEqual(isolated.majors, [formal, retained]);
  assert.equal(validateMutation(actor, current, isolated).ok, true);
});

test('sanitizeStaleSnapshot: keeps own weekly changes but restores other classes from the server', () => {
  const actor = makeActor({
    permissions: ['weekly.edit'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const own = { id: 'own', gradeId: 'g1', classId: 'c1', name: 'own server' };
  const outside = { id: 'outside', gradeId: 'g2', classId: 'c2', name: 'outside server' };
  const current = makeCurrent({
    weeklyPlans: [own, outside],
    grades: [{ id: 'g1' }, { id: 'g2' }],
    classes: [{ id: 'c1', gradeId: 'g1' }, { id: 'c2', gradeId: 'g2' }],
  });
  const sanitized = sanitizeStaleSnapshot(actor, current, {
    weeklyPlans: [{ ...own, name: 'own client' }, { ...outside, name: 'outside stale' }],
    grades: [{ id: 'g1', name: 'stale' }],
    classes: [{ id: 'c1', gradeId: 'g1', name: 'stale' }],
  });
  assert.deepEqual(sanitized.weeklyPlans, [{ ...own, name: 'own client' }, outside]);
  assert.deepEqual(sanitized.grades, current.grades);
  assert.deepEqual(sanitized.classes, current.classes);
});

test('sanitizeStaleSnapshot: grade admins retain only class changes in their grade', () => {
  const actor = makeActor({
    permissions: ['school.class_manage'],
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
  });
  const own = { id: 'c1', gradeId: 'g1', name: 'own server' };
  const outside = { id: 'c2', gradeId: 'g2', name: 'outside server' };
  const current = makeCurrent({ classes: [own, outside] });
  const sanitized = sanitizeStaleSnapshot(actor, current, {
    classes: [{ ...own, name: 'own client' }, { ...outside, name: 'outside stale' }],
  });
  assert.deepEqual(sanitized.classes, [{ ...own, name: 'own client' }, outside]);
});
test('validateMutation: quick_create does NOT cover a quick major with no target classes', () => {
  const actor = makeActor({
    id: 7,
    permissions: ['major.quick_create'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const current = makeCurrent();
  const quickMajor = {
    id: 'm1',
    name: '临时测验',
    items: [],
    order: 0,
    targetGradeIds: [],
    targetClassIds: [], // no target classes -> falls back to requiring major.create
    source: 'quick',
    temporary: true,
    createdBy: 7,
  };
  const result = validateMutation(actor, current, { majors: [quickMajor], activeMajorId: 'm1' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.permission, 'major.create');
});

test('validateMutation: quick_create does NOT cover a quick major owned by a different actor', () => {
  const actor = makeActor({
    id: 7,
    permissions: ['major.quick_create'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const current = makeCurrent({ classes: [{ id: 'c1', gradeId: 'g1', name: '1班' }] });
  const quickMajor = {
    id: 'm1',
    name: '临时测验',
    items: [],
    order: 0,
    targetGradeIds: [],
    targetClassIds: ['c1'],
    source: 'quick',
    temporary: true,
    createdBy: 999, // different actor
  };
  const result = validateMutation(actor, current, { majors: [quickMajor], activeMajorId: 'm1' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.permission, 'major.create');
});

test('validateMutation: quick_create lets a class co-manager end an in-scope temporary quick major', () => {
  const actor = makeActor({
    id: 8,
    permissions: ['major.quick_create'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const quick = {
    id: 'quick', name: 'quick', order: 0, targetGradeIds: ['g1'], targetClassIds: ['c1'],
    source: 'quick', temporary: true, createdBy: 7, endedAt: null,
    items: [{ id: 'i1', name: 'math', enabled: true }],
  };
  const ended = {
    ...quick,
    endedAt: 1_000,
    items: quick.items.map((item) => ({ ...item, enabled: false })),
  };
  const current = makeCurrent({
    majors: [quick], items: quick.items, title: quick.name, activeMajorId: quick.id,
    classes: [{ id: 'c1', gradeId: 'g1', name: '1' }],
  });
  const result = validateMutation(actor, current, {
    majors: [ended], items: ended.items, title: ended.name, activeMajorId: ended.id,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.actions.includes('major.quick_create'));
});

test('validateMutation: scoped quick co-management cannot alter a temporary exam beyond ending it', () => {
  const actor = makeActor({
    id: 8,
    permissions: ['major.quick_create'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const quick = {
    id: 'quick', name: 'quick', order: 0, targetGradeIds: ['g1'], targetClassIds: ['c1'],
    source: 'quick', temporary: true, createdBy: 7, endedAt: null,
    items: [{ id: 'i1', name: 'math', enabled: true }],
  };
  const changed = { ...quick, name: 'renamed', endedAt: 1_000, items: [{ ...quick.items[0], enabled: false }] };
  const current = makeCurrent({
    majors: [quick], items: quick.items, title: quick.name, activeMajorId: quick.id,
    classes: [{ id: 'c1', gradeId: 'g1', name: '1' }],
  });
  const result = validateMutation(actor, current, {
    majors: [changed], items: changed.items, title: changed.name, activeMajorId: changed.id,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.permission, 'major.edit');
});

test('validateMutation: a class co-manager cannot end a temporary quick major that also targets another class', () => {
  const actor = makeActor({
    id: 8,
    permissions: ['major.quick_create'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const quick = {
    id: 'quick', name: 'quick', order: 0, targetGradeIds: ['g1'], targetClassIds: ['c1', 'c2'],
    source: 'quick', temporary: true, createdBy: 7, endedAt: null,
    items: [{ id: 'i1', name: 'math', enabled: true }],
  };
  const ended = { ...quick, endedAt: 1_000, items: [{ ...quick.items[0], enabled: false }] };
  const current = makeCurrent({
    majors: [quick], items: quick.items, title: quick.name, activeMajorId: quick.id,
    classes: [{ id: 'c1', gradeId: 'g1', name: '1' }, { id: 'c2', gradeId: 'g1', name: '2' }],
  });
  const result = validateMutation(actor, current, {
    majors: [ended], items: ended.items, title: ended.name, activeMajorId: ended.id,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.permission, 'major.edit');
});

test('validateMutation: adding one weekly plan needs weekly.create; adding 2+ also needs weekly.copy', () => {
  const current = makeCurrent({ classes: [{ id: 'c1', gradeId: 'g1', name: '1班' }] });
  const plan = (id: string) => ({ id, gradeId: 'g1', classId: 'c1' });

  const noPermission = makeActor({ scopes: [scope({ type: 'all' })] });
  const denied = validateMutation(noPermission, current, { weeklyPlans: [plan('w1')] });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.permission, 'weekly.create');

  const createOnly = makeActor({ permissions: ['weekly.create'], scopes: [scope({ type: 'all' })] });
  const singleOk = validateMutation(createOnly, current, { weeklyPlans: [plan('w1')] });
  assert.equal(singleOk.ok, true);

  const missingCopy = validateMutation(createOnly, current, { weeklyPlans: [plan('w1'), plan('w2')] });
  assert.equal(missingCopy.ok, false);
  if (!missingCopy.ok) assert.equal(missingCopy.permission, 'weekly.copy');

  const withCopy = makeActor({ permissions: ['weekly.create', 'weekly.copy'], scopes: [scope({ type: 'all' })] });
  const bothOk = validateMutation(withCopy, current, { weeklyPlans: [plan('w1'), plan('w2')] });
  assert.equal(bothOk.ok, true);
});

test('validateMutation: a class-scoped actor cannot create a weekly plan for a class outside their scope', () => {
  const actor = makeActor({ permissions: ['weekly.create'], scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })] });
  const current = makeCurrent({ classes: [{ id: 'c1', gradeId: 'g1' }, { id: 'c2', gradeId: 'g1' }] });
  const result = validateMutation(actor, current, { weeklyPlans: [{ id: 'w1', gradeId: 'g1', classId: 'c2' }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /班级管理范围/);
});

test('validateMutation: a class-scoped actor can edit only their own weekly plan and activation', () => {
  const actor = makeActor({
    permissions: ['weekly.edit'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const current = makeCurrent({
    classes: [{ id: 'c1', gradeId: 'g1' }, { id: 'c2', gradeId: 'g1' }],
    weeklyPlans: [
      { id: 'w1', gradeId: 'g1', classId: 'c1', name: 'before' },
      { id: 'w2', gradeId: 'g1', classId: 'c2', name: 'other' },
    ],
    activeWeeklyPlanIdByClassId: { c1: 'w1', c2: 'w2' },
  });
  const result = validateMutation(actor, current, {
    weeklyPlans: [
      { id: 'w1', gradeId: 'g1', classId: 'c1', name: 'after' },
      { id: 'w2', gradeId: 'g1', classId: 'c2', name: 'other' },
    ],
    activeWeeklyPlanIdByClassId: { c1: 'w1', c2: 'w2' },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.actions.includes('weekly.edit'));
});
test('validateMutation: changing the active weekly plan mapping needs weekly.edit and drops stale class ids', () => {
  const actor = makeActor({ permissions: ['weekly.edit'], scopes: [scope({ type: 'all' })] });
  const current = makeCurrent({
    classes: [{ id: 'c1', gradeId: 'g1' }],
    activeWeeklyPlanIdByClassId: { c1: 'w1' },
  });
  const body: Record<string, unknown> = {
    activeWeeklyPlanIdByClassId: { c1: 'w2', deletedClass: 'w9' },
  };
  const result = validateMutation(actor, current, body);
  assert.equal(result.ok, true);
  // validateMutation mutates body in place to strip mappings for classes that no longer exist.
  assert.deepEqual(body.activeWeeklyPlanIdByClassId, { c1: 'w2' });
});

test('validateMutation: grade structure changes require school.grade_manage AND all-scope', () => {
  const current = makeCurrent({ grades: [{ id: 'g1', name: '高一' }] });
  const newGrades = [{ id: 'g1', name: '高一' }, { id: 'g2', name: '高二' }];

  const missingPermission = validateMutation(makeActor({ scopes: [scope({ type: 'all' })] }), current, { grades: newGrades });
  assert.equal(missingPermission.ok, false);
  if (!missingPermission.ok) assert.equal(missingPermission.permission, 'school.grade_manage');

  const notAllScope = validateMutation(
    makeActor({ permissions: ['school.grade_manage'], scopes: [scope({ type: 'grade', gradeId: 'g1' })] }),
    current,
    { grades: newGrades },
  );
  assert.equal(notAllScope.ok, false);
  if (!notAllScope.ok) assert.match(notAllScope.error, /只有全校范围管理员可以增删年级/);

  const allowed = validateMutation(
    makeActor({ permissions: ['school.grade_manage'], scopes: [scope({ type: 'all' })] }),
    current,
    { grades: newGrades },
  );
  assert.equal(allowed.ok, true);
});

test('validateMutation: class structure changes require school.class_manage and per-class grade access', () => {
  const current = makeCurrent({ classes: [{ id: 'c1', gradeId: 'g1' }] });
  const newClasses = [{ id: 'c1', gradeId: 'g1' }, { id: 'c2', gradeId: 'g2' }];

  const wrongGrade = validateMutation(
    makeActor({ permissions: ['school.class_manage'], scopes: [scope({ type: 'grade', gradeId: 'g1' })] }),
    current,
    { classes: newClasses },
  );
  assert.equal(wrongGrade.ok, false);
  if (!wrongGrade.ok) assert.match(wrongGrade.error, /年级管理范围/);

  const rightGrade = validateMutation(
    makeActor({ permissions: ['school.class_manage'], scopes: [scope({ type: 'all' })] }),
    current,
    { classes: newClasses },
  );
  assert.equal(rightGrade.ok, true);
});

test('validateMutation: schedule mode and conflict policy changes require the matching permission AND all-scope', () => {
  const current = makeCurrent({ scheduleMode: 'major-only' });

  const noPerm = validateMutation(makeActor({ scopes: [scope({ type: 'all' })] }), current, { scheduleMode: 'weekly-only' });
  assert.equal(noPerm.ok, false);
  if (!noPerm.ok) assert.equal(noPerm.permission, 'schedule.mode_edit');

  const gradeScopeOnly = validateMutation(
    makeActor({ permissions: ['schedule.mode_edit'], scopes: [scope({ type: 'grade', gradeId: 'g1' })] }),
    current,
    { scheduleMode: 'weekly-only' },
  );
  assert.equal(gradeScopeOnly.ok, false);
  if (!gradeScopeOnly.ok) assert.match(gradeScopeOnly.error, /运行模式/);

  const allowed = validateMutation(
    makeActor({ permissions: ['schedule.mode_edit'], scopes: [scope({ type: 'all' })] }),
    current,
    { scheduleMode: 'weekly-only' },
  );
  assert.equal(allowed.ok, true);

  const conflictPolicyDenied = validateMutation(
    makeActor({ permissions: ['schedule.conflict_edit'], scopes: [scope({ type: 'grade', gradeId: 'g1' })] }),
    makeCurrent({ weeklyConflictPolicy: { enabled: true, scope: 'whole-day', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } }),
    { weeklyConflictPolicy: { enabled: false, scope: 'whole-day', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } },
  );
  assert.equal(conflictPolicyDenied.ok, false);
});

test('validateMutation: alerts changes only need alerts.edit, with no scope restriction', () => {
  const current = makeCurrent({ alerts: { enabled: true } });
  const denied = validateMutation(makeActor(), current, { alerts: { enabled: false } });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.permission, 'alerts.edit');

  const allowed = validateMutation(makeActor({ permissions: ['alerts.edit'] }), current, { alerts: { enabled: false } });
  assert.equal(allowed.ok, true);
});

test('validateMutation: toggling only subjectTrackModeEnabled is a lightweight settings.edit change, not a full initialization run', () => {
  const current = makeCurrent({ initialization: { schoolName: '某中学', subjectTrackModeEnabled: true } });
  const body = { initialization: { schoolName: '某中学', subjectTrackModeEnabled: false } };

  const denied = validateMutation(makeActor(), current, body);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.permission, 'settings.edit');

  const allowed = validateMutation(makeActor({ permissions: ['settings.edit'] }), current, body);
  assert.equal(allowed.ok, true);
});

test('validateMutation: changing other initialization fields requires initialization.run AND all-scope', () => {
  const current = makeCurrent({ initialization: { schoolName: '某中学' } });
  const body = { initialization: { schoolName: '新学校名称' } };

  const noPerm = validateMutation(makeActor({ scopes: [scope({ type: 'all' })] }), current, body);
  assert.equal(noPerm.ok, false);
  if (!noPerm.ok) assert.equal(noPerm.permission, 'initialization.run');

  const notAllScope = validateMutation(
    makeActor({ permissions: ['initialization.run'], scopes: [scope({ type: 'grade', gradeId: 'g1' })] }),
    current,
    body,
  );
  assert.equal(notAllScope.ok, false);
  if (!notAllScope.ok) assert.match(notAllScope.error, /超级管理员/);

  const allowed = validateMutation(
    makeActor({ permissions: ['initialization.run'], scopes: [scope({ type: 'all' })] }),
    current,
    body,
  );
  assert.equal(allowed.ok, true);
});
