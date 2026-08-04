import assert from 'node:assert/strict';
import test from 'node:test';
import { canDelegateScopes, filterVisibleUsers } from '../api/users.js';
import type { AdminActor, AdminScope, Permission } from '../api/_auth.js';

function actor(overrides: Partial<AdminActor> = {}): AdminActor {
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

test('a class-scoped administrator cannot delegate a grade scope in their own grade', () => {
  const classActor = actor({
    permissions: ['user.create'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  assert.equal(canDelegateScopes(classActor, [scope({ type: 'grade', gradeId: 'g1' })]), false);
  assert.equal(canDelegateScopes(classActor, [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })]), true);
  assert.equal(canDelegateScopes(classActor, [scope({ type: 'class', gradeId: 'g1', classId: 'c2' })]), false);
});

test('a grade-scoped administrator can delegate only their own grade', () => {
  const gradeActor = actor({
    permissions: ['user.create'],
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
  });
  assert.equal(canDelegateScopes(gradeActor, [scope({ type: 'grade', gradeId: 'g1' })]), true);
  assert.equal(canDelegateScopes(gradeActor, [scope({ type: 'grade', gradeId: 'g2' })]), false);
});

test('a class-scoped administrator cannot see a grade-scoped account in their grade', () => {
  const classActor = actor({
    permissions: ['user.read'],
    scopes: [scope({ type: 'class', gradeId: 'g1', classId: 'c1' })],
  });
  const candidate = {
    id: 2,
    permissions: ['user.read'] as Permission[],
    scopes: [scope({ type: 'grade', gradeId: 'g1' })],
  };
  assert.deepEqual(filterVisibleUsers(classActor, [candidate]), []);
});
