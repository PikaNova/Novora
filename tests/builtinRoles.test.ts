import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_ROLES, ALL_PERMISSIONS } from '../api/_auth.js';

const allPermissionSet = new Set<string>(ALL_PERMISSIONS as readonly string[]);

function roleById(id: string) {
  const role = BUILTIN_ROLES.find((candidate) => candidate.id === id);
  assert.ok(role, `expected a built-in role with id "${id}"`);
  return role!;
}

test('BUILTIN_ROLES: contains exactly the four expected built-in roles', () => {
  assert.deepEqual(
    BUILTIN_ROLES.map((role) => role.id).sort(),
    ['class_admin', 'grade_admin', 'super_admin', 'viewer'],
  );
});

test('BUILTIN_ROLES: every declared permission is valid', () => {
  for (const role of BUILTIN_ROLES) {
    for (const permission of role.permissions) {
      assert.ok(
        permission === '*' || allPermissionSet.has(permission),
        `role "${role.id}" declares unknown permission "${permission}"`,
      );
    }
  }
});

test('BUILTIN_ROLES: no role lists a permission twice', () => {
  for (const role of BUILTIN_ROLES) {
    assert.equal(new Set(role.permissions).size, role.permissions.length, `role "${role.id}" has duplicate permissions`);
  }
});

test('BUILTIN_ROLES: super_admin uses only the wildcard', () => {
  assert.deepEqual(roleById('super_admin').permissions, ['*']);
});

test('BUILTIN_ROLES: grade_admin can delegate every class_admin permission', () => {
  const gradeAdminPermissions = new Set(roleById('grade_admin').permissions);
  const missing = roleById('class_admin').permissions.filter((permission) => !gradeAdminPermissions.has(permission));
  assert.deepEqual(missing, [], `grade_admin cannot delegate: ${missing.join(', ')}`);
});

test('BUILTIN_ROLES: grade_admin permissions match the approved contract', () => {
  const expected = [
    'overview.read',
    'major.read', 'major.create', 'major.quick_create', 'major.edit', 'major.delete', 'major.import', 'major.export',
    'weekly.read', 'weekly.create', 'weekly.edit', 'weekly.delete', 'weekly.copy', 'weekly.override', 'weekly.import', 'weekly.export',
    'school.read', 'school.class_manage',
    'device.read', 'device.bind', 'device.revoke',
    'schedule.term_edit', 'schedule.ab_week_edit', 'schedule.holiday_edit',
    'alerts.read',
    'settings.read', 'settings.major_batch_edit',
    'user.read', 'user.create', 'user.edit', 'user.disable', 'user.delete', 'user.reset_password',
  ].sort();
  assert.deepEqual([...roleById('grade_admin').permissions].sort(), expected);
});

test('BUILTIN_ROLES: class_admin permissions match the approved contract', () => {
  const expected = [
    'major.read', 'major.quick_create',
    'weekly.read', 'weekly.create', 'weekly.edit', 'weekly.delete', 'weekly.copy', 'weekly.override', 'weekly.import', 'weekly.export',
    'school.read',
    'device.read', 'device.bind', 'device.revoke',
    'alerts.read',
  ].sort();
  assert.deepEqual([...roleById('class_admin').permissions].sort(), expected);
});

test('BUILTIN_ROLES: viewer is limited to read/export permissions', () => {
  const viewer = roleById('viewer');
  assert.deepEqual([...viewer.permissions].sort(), ['major.read', 'school.read', 'weekly.export', 'weekly.read'].sort());
  for (const permission of viewer.permissions) {
    assert.ok(/\.(read|export)$/.test(permission), `viewer should only hold read/export permissions, found "${permission}"`);
  }
});

test('BUILTIN_ROLES: every role has display metadata', () => {
  for (const role of BUILTIN_ROLES) {
    assert.ok(role.id.trim(), 'role id must not be empty');
    assert.ok(role.name.trim(), `role "${role.id}" must have a name`);
    assert.ok(role.description.trim(), `role "${role.id}" must have a description`);
  }
});
