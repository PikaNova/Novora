import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLASSISLAND_API_CAPABILITIES,
  CLASSISLAND_API_VERSION,
  actorScopeLabel,
  classIslandApiMeta,
  classLabel,
  equalHash,
  pluginCredentials,
  resolvePluginExams,
  sha256,
} from '../api/_exams/plugin.js';
import type { AdminActor } from '../api/_auth.js';
import type { ExamPayload } from '../api/_exams/payload.js';

function makeActor(overrides: Partial<AdminActor> = {}): AdminActor {
  return {
    id: 1,
    username: 'actor',
    displayName: 'Actor',
    roleId: 'grade_admin',
    roleName: 'Grade admin',
    permissions: [],
    scopes: [],
    mustChangePassword: false,
    ...overrides,
  } as AdminActor;
}

function makePayload(overrides: Partial<ExamPayload> = {}): ExamPayload {
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
    grades: [{ id: 'grade-1', name: 'Grade 3' }],
    classes: [{ id: 'class-1', name: 'Class 1' }],
    initialization: {},
    weeklyConflictPolicy: null,
    designPolicy: { rules: [], updatedAt: 0 },
    updatedAt: 0,
    ...overrides,
  } as unknown as ExamPayload;
}

function payloadWithMajor(item: Record<string, unknown>): ExamPayload {
  return makePayload({
    activeMajorId: 'major-1',
    majors: [{ id: 'major-1', name: 'Midterm', order: 0, items: [item] }] as any,
  });
}

test('sha256 returns the known digest for a fixed input', () => {
  assert.equal(sha256('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('sha256 returns different digests for different inputs', () => {
  assert.notEqual(sha256('a'), sha256('b'));
});

test('equalHash accepts identical non-empty digests', () => {
  const digest = sha256('secret');
  assert.equal(equalHash(digest, digest), true);
});

test('equalHash rejects different same-length digests', () => {
  assert.equal(equalHash(sha256('secret'), sha256('other')), false);
});

test('equalHash rejects different lengths without throwing', () => {
  assert.doesNotThrow(() => equalHash('ab', 'abcd'));
  assert.equal(equalHash('ab', 'abcd'), false);
});

test('equalHash rejects two empty strings', () => {
  assert.equal(equalHash('', ''), false);
});

test('pluginCredentials accepts valid trimmed credentials', () => {
  assert.deepEqual(pluginCredentials({
    pluginInstanceId: '  device-001-abcdef  ',
    clientSecret: `  ${'a'.repeat(32)}  `,
  }), { instanceId: 'device-001-abcdef', secret: 'a'.repeat(32) });
});

test('pluginCredentials rejects a short instance id', () => {
  assert.equal(pluginCredentials({ pluginInstanceId: 'short', clientSecret: 'a'.repeat(32) }), null);
});

test('pluginCredentials rejects a non-hex secret', () => {
  assert.equal(pluginCredentials({ pluginInstanceId: 'device-001-abcdef', clientSecret: 'not-hex!!' }), null);
});

test('pluginCredentials rejects missing fields', () => {
  assert.equal(pluginCredentials({}), null);
});

test('pluginCredentials accepts uppercase hexadecimal secrets', () => {
  assert.deepEqual(pluginCredentials({
    pluginInstanceId: 'device-001-abcdef',
    clientSecret: 'A'.repeat(32),
  }), { instanceId: 'device-001-abcdef', secret: 'A'.repeat(32) });
});

test('classIslandApiMeta reports the declared version and capabilities', () => {
  const meta = classIslandApiMeta();
  assert.equal(meta.apiVersion, CLASSISLAND_API_VERSION);
  assert.equal(meta.minApiVersion, 1);
  assert.deepEqual(meta.capabilities, CLASSISLAND_API_CAPABILITIES);
});

test('classLabel joins matched grade and class names', () => {
  assert.equal(classLabel(makePayload(), 'grade-1', 'class-1'), 'Grade 3 Class 1');
});

test('classLabel falls back to the matched half', () => {
  const payload = makePayload();
  assert.equal(classLabel(payload, 'grade-1', 'missing'), 'Grade 3');
  assert.equal(classLabel(payload, 'missing', 'class-1'), 'Class 1');
});

test('classLabel returns empty when neither id matches', () => {
  assert.equal(classLabel(makePayload(), 'missing-grade', 'missing-class'), '');
});

test('actorScopeLabel treats wildcard permission as all scope', () => {
  const payload = makePayload();
  const label = actorScopeLabel(makeActor({ permissions: ['*'] }), payload);
  assert.ok(label.length > 0);
  assert.equal(label, actorScopeLabel(makeActor({ scopes: [{ type: 'all' } as any] }), payload));
});

test('actorScopeLabel resolves a grade scope name', () => {
  assert.equal(actorScopeLabel(
    makeActor({ scopes: [{ type: 'grade', gradeId: 'grade-1' } as any] }),
    makePayload(),
  ), 'Grade 3');
});

test('actorScopeLabel includes both names for a class scope', () => {
  const label = actorScopeLabel(
    makeActor({ scopes: [{ type: 'class', gradeId: 'grade-1', classId: 'class-1' } as any] }),
    makePayload(),
  );
  assert.ok(label.includes('Grade'));
  assert.ok(label.includes('Class 1'));
});

test('actorScopeLabel uses a non-empty fallback when scopes are absent', () => {
  const label = actorScopeLabel(makeActor(), makePayload());
  assert.ok(label.length > 0);
  assert.notEqual(label, 'Grade 3');
});

test('actorScopeLabel supports multiple scopes', () => {
  const label = actorScopeLabel(makeActor({ scopes: [
    { type: 'grade', gradeId: 'grade-1' } as any,
    { type: 'class', gradeId: 'grade-1', classId: 'class-1' } as any,
  ] }), makePayload());
  assert.ok(label.includes('Grade 3'));
  assert.ok(label.includes('Class 1'));
});

test('resolvePluginExams includes an enabled active major item', () => {
  const result = resolvePluginExams(payloadWithMajor({
    id: 'item-1', name: 'Language', startTime: '2099-01-01T09:00',
    endTime: '2099-01-01T11:00', enabled: true, order: 0,
  }), 'grade-1', 'class-1');
  assert.equal(result.length, 1);
  assert.equal(result[0]!.name, 'Language');
  assert.equal(result[0]!.kind, 'major');
  assert.equal(result[0]!.sourceName, 'Midterm');
});

test('resolvePluginExams excludes disabled items in the active window', () => {
  const result = resolvePluginExams(payloadWithMajor({
    id: 'item-1', name: 'Language', startTime: '2099-01-01T09:00',
    endTime: '2099-01-01T11:00', enabled: false, order: 0,
  }), 'grade-1', 'class-1');
  assert.equal(result.length, 0);
});

test('resolvePluginExams excludes items that ended more than two minutes ago', () => {
  const result = resolvePluginExams(payloadWithMajor({
    id: 'item-1', name: 'Language', startTime: '2020-01-01T09:00',
    endTime: '2020-01-01T11:00', enabled: true, order: 0,
  }), 'grade-1', 'class-1');
  assert.equal(result.length, 0);
});
