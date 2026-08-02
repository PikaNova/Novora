import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasPermission,
  hasAllScope,
  canAccessGrade,
  canAccessClass,
  hasGradeLevelAccess,
  type PermissionSubject,
} from '../src/shared/permissionRules.js';

function subject(overrides: Partial<PermissionSubject> = {}): PermissionSubject {
  return { permissions: [], scopes: [], ...overrides };
}

test('hasPermission: null/undefined subject is always denied', () => {
  assert.equal(hasPermission(null, 'major.read'), false);
  assert.equal(hasPermission(undefined, 'major.read'), false);
});

test('hasPermission: wildcard permission grants everything', () => {
  const s = subject({ permissions: ['*'] });
  assert.equal(hasPermission(s, 'major.read'), true);
  assert.equal(hasPermission(s, 'deployment.trigger'), true);
});

test('hasPermission: matches only the exact declared permission', () => {
  const s = subject({ permissions: ['major.read', 'weekly.edit'] });
  assert.equal(hasPermission(s, 'major.read'), true);
  assert.equal(hasPermission(s, 'weekly.edit'), true);
  assert.equal(hasPermission(s, 'major.edit'), false);
});

test('hasAllScope: null/undefined subject is denied', () => {
  assert.equal(hasAllScope(null), false);
  assert.equal(hasAllScope(undefined), false);
});

test('hasAllScope: wildcard permission counts as all-scope', () => {
  assert.equal(hasAllScope(subject({ permissions: ['*'] })), true);
});

test('hasAllScope: requires an explicit all-type scope entry, grade/class scopes do not count', () => {
  assert.equal(hasAllScope(subject({ scopes: [{ type: 'all', gradeId: '', classId: '' }] })), true);
  assert.equal(hasAllScope(subject({ scopes: [{ type: 'grade', gradeId: 'g1', classId: '' }] })), false);
  assert.equal(hasAllScope(subject({ scopes: [{ type: 'class', gradeId: 'g1', classId: 'c1' }] })), false);
  assert.equal(hasAllScope(subject()), false);
});

test('canAccessGrade: null subject is denied', () => {
  assert.equal(canAccessGrade(null, 'g1'), false);
});

test('canAccessGrade: all-scope subject can access any grade', () => {
  const s = subject({ scopes: [{ type: 'all', gradeId: '', classId: '' }] });
  assert.equal(canAccessGrade(s, 'g1'), true);
  assert.equal(canAccessGrade(s, 'g-does-not-exist'), true);
});

test('canAccessGrade: grade-scope subject matches only its own gradeId', () => {
  const s = subject({ scopes: [{ type: 'grade', gradeId: 'g1', classId: '' }] });
  assert.equal(canAccessGrade(s, 'g1'), true);
  assert.equal(canAccessGrade(s, 'g2'), false);
});

test('canAccessGrade: class-scope subject also grants access to its own gradeId', () => {
  const s = subject({ scopes: [{ type: 'class', gradeId: 'g1', classId: 'c1' }] });
  assert.equal(canAccessGrade(s, 'g1'), true);
  assert.equal(canAccessGrade(s, 'g2'), false);
});

test('hasGradeLevelAccess: only all-school and matching grade scopes can delegate a grade', () => {
  assert.equal(hasGradeLevelAccess(null, 'g1'), false);
  assert.equal(hasGradeLevelAccess(subject({ permissions: ['*'] }), 'g1'), true);
  assert.equal(hasGradeLevelAccess(subject({ scopes: [{ type: 'all', gradeId: '', classId: '' }] }), 'g1'), true);
  assert.equal(hasGradeLevelAccess(subject({ scopes: [{ type: 'grade', gradeId: 'g1', classId: '' }] }), 'g1'), true);
  assert.equal(hasGradeLevelAccess(subject({ scopes: [{ type: 'grade', gradeId: 'g2', classId: '' }] }), 'g1'), false);
});

test('hasGradeLevelAccess: a class scope cannot delegate its parent grade', () => {
  const classScoped = subject({ scopes: [{ type: 'class', gradeId: 'g1', classId: 'c1' }] });
  assert.equal(canAccessGrade(classScoped, 'g1'), true);
  assert.equal(hasGradeLevelAccess(classScoped, 'g1'), false);
});

test('canAccessClass: null subject is denied', () => {
  assert.equal(canAccessClass(null, 'g1', 'c1'), false);
});

test('canAccessClass: all-scope subject can access any class', () => {
  const s = subject({ scopes: [{ type: 'all', gradeId: '', classId: '' }] });
  assert.equal(canAccessClass(s, 'g1', 'c1'), true);
});

test('canAccessClass: grade-scope subject can access every class under that grade', () => {
  const s = subject({ scopes: [{ type: 'grade', gradeId: 'g1', classId: '' }] });
  assert.equal(canAccessClass(s, 'g1', 'c1'), true);
  assert.equal(canAccessClass(s, 'g1', 'c-anything'), true);
  assert.equal(canAccessClass(s, 'g2', 'c1'), false);
});

test('canAccessClass: class-scope subject must match both gradeId and classId', () => {
  const s = subject({ scopes: [{ type: 'class', gradeId: 'g1', classId: 'c1' }] });
  assert.equal(canAccessClass(s, 'g1', 'c1'), true);
  assert.equal(canAccessClass(s, 'some-other-grade', 'c1'), false);
  assert.equal(canAccessClass(s, 'g1', 'c2'), false);
});

test('canAccessClass: unrelated scopes are denied', () => {
  const s = subject({ scopes: [{ type: 'grade', gradeId: 'g2', classId: '' }] });
  assert.equal(canAccessClass(s, 'g1', 'c1'), false);
  assert.equal(canAccessClass(subject(), 'g1', 'c1'), false);
});
