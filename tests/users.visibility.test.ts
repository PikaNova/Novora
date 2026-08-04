import assert from 'node:assert/strict';
import test from 'node:test';
import { canReadAuditLog, filterVisibleUsers } from '../api/users.js';
import type { AdminActor, AdminScope, Permission } from '../api/_auth.js';

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

type Candidate = { id: number; scopes: AdminScope[]; permissions: Permission[] };

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return { id: 0, scopes: [], permissions: [], ...overrides };
}

test('scoped admin cannot see a same-grade account with non-delegable permissions', () => {
  const actor = makeActor({
    permissions: ['user.read', 'user.create'],
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
  });
  const target = candidate({
    id: 2,
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
    permissions: ['user.read', 'user.create', 'user.delete'],
  });
  assert.deepEqual(filterVisibleUsers(actor, [target]), []);
});

test('scoped admin sees a same-grade account with a delegable permission subset', () => {
  const actor = makeActor({
    permissions: ['user.read', 'user.create', 'user.edit'],
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
  });
  const target = candidate({
    id: 3,
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
    permissions: ['user.read'],
  });
  assert.deepEqual(filterVisibleUsers(actor, [target]).map(user => user.id), [3]);
});

test('scoped admin cannot see an out-of-scope account', () => {
  const actor = makeActor({
    permissions: ['user.read'],
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
  });
  const target = candidate({
    id: 4,
    scopes: [scope({ type: 'grade', gradeId: 'g2' })],
    permissions: ['user.read'],
  });
  assert.deepEqual(filterVisibleUsers(actor, [target]), []);
});

test('scoped admin cannot see an account with all-school scope', () => {
  const actor = makeActor({
    permissions: ['user.read'],
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
  });
  const target = candidate({ id: 5, scopes: [scope({ type: 'all' })] });
  assert.deepEqual(filterVisibleUsers(actor, [target]), []);
});

test('scoped admin without a scope cannot see accounts', () => {
  const actor = makeActor({ permissions: ['user.read'] });
  const target = candidate({
    id: 6,
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
    permissions: ['user.read'],
  });
  assert.deepEqual(filterVisibleUsers(actor, [target]), []);
});

test('unscoped callers retain the full user list for internal use', () => {
  const users = [candidate({ id: 7 }), candidate({ id: 8 })];
  assert.deepEqual(filterVisibleUsers(undefined, users).map(user => user.id), [7, 8]);
});

test('wildcard-permission administrator sees every account', () => {
  const actor = makeActor({ permissions: ['*'], scopes: [scope({ type: 'all' })] });
  const users = [
    candidate({ id: 9, scopes: [scope({ type: 'grade', gradeId: 'g1' })], permissions: ['*'] }),
    candidate({ id: 10, scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })] }),
  ];
  assert.deepEqual(filterVisibleUsers(actor, users).map(user => user.id), [9, 10]);
});

test('audit reads are denied to grade and class scoped actors', () => {
  const gradeActor = makeActor({
    permissions: ['audit.read'],
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
  });
  const classActor = makeActor({
    permissions: ['audit.read'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  assert.equal(canReadAuditLog(gradeActor), false);
  assert.equal(canReadAuditLog(classActor), false);
});

test('audit reads are allowed for wildcard or all-scope actors', () => {
  const wildcardActor = makeActor({ permissions: ['*'] });
  const allScopeActor = makeActor({
    permissions: ['audit.read'],
    scopes: [scope({ type: 'all' })],
  });
  assert.equal(canReadAuditLog(wildcardActor), true);
  assert.equal(canReadAuditLog(allScopeActor), true);
});
