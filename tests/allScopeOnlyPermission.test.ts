import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_SCOPE_ONLY_PERMISSIONS, allScopeOnlyPermissionError } from '../src/shared/permissionRules.js';

test('all-scope-only permissions allow wildcard roles', () => {
  assert.equal(allScopeOnlyPermissionError(['*'], [{ type: 'grade', gradeId: 'g1', classId: '' }]), '');
});

test('ordinary permissions can be assigned to a class scope', () => {
  assert.equal(allScopeOnlyPermissionError(['major.read', 'weekly.edit'], [{ type: 'class', gradeId: 'g1', classId: 'c1' }]), '');
});

test('each all-scope-only permission allows an all-school account', () => {
  for (const permission of ALL_SCOPE_ONLY_PERMISSIONS) {
    assert.equal(allScopeOnlyPermissionError([permission], [{ type: 'all', gradeId: '', classId: '' }]), '');
  }
});

test('each all-scope-only permission rejects grade and class assignments', () => {
  for (const permission of ALL_SCOPE_ONLY_PERMISSIONS) {
    assert.notEqual(allScopeOnlyPermissionError([permission], [{ type: 'grade', gradeId: 'g1', classId: '' }]), '');
    assert.notEqual(allScopeOnlyPermissionError([permission], [{ type: 'class', gradeId: 'g1', classId: 'c1' }]), '');
  }
});

test('all-scope-only permissions reject an empty scope list and name only offending permissions', () => {
  const error = allScopeOnlyPermissionError(['settings.edit', 'initialization.run', 'major.read'], []);
  assert.match(error, /settings\.edit/);
  assert.match(error, /initialization\.run/);
  assert.doesNotMatch(error, /major\.read/);
});
