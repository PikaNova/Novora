import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canGrantModuleLevel,
  computeDelegablePermissionSet,
  computeUserManagementPermissionFlags,
  computeUserManagementScopeAccess,
} from '../src/services/userManagementAccess.js';

const gradeAdminPermissions = [
  'major.quick_create',
  'user.read',
  'user.create',
  'user.edit',
  'user.reset_password',
  'user.delete',
];
const grades = [{ id: 'g1', name: 'Grade 1', order: 0, enabled: true }];
const classes = [{ id: 'c1', gradeId: 'g1', name: 'Class 1', order: 0, enabled: true }];
const roles = [
  { id: 'class_admin', permissions: ['major.quick_create'] },
  { id: 'super_admin', permissions: ['*'] },
];

test('grade admin can delegate class admin after receiving quick create', () => {
  const current = {
    permissions: gradeAdminPermissions,
    scopes: [{ type: 'grade' as const, gradeId: 'g1', classId: '' }],
  };
  const access = computeUserManagementScopeAccess(current, roles, grades, classes);
  assert.deepEqual(
    access.delegableRoles.map((role) => role.id),
    ['class_admin'],
  );
  assert.deepEqual(
    access.visibleClasses.map((item) => item.id),
    ['c1'],
  );
});

test('user management flags use the shared permission implementation', () => {
  const flags = computeUserManagementPermissionFlags({ permissions: ['*'], scopes: [] });
  assert.equal(Object.values(flags).every(Boolean), true);
  assert.equal(Object.values(computeUserManagementPermissionFlags(null)).some(Boolean), false);
});

// 与服务端 canDelegatePermissions 同口径：前端不该让人勾出服务端必然拒绝的权限组合。
const MAJOR_MODULE = { read: ['major.read', 'major.export'], manage: ['major.create', 'major.edit'] };

test('可委托权限集合：超管是 null（全部），其余按自己的权限取集合', () => {
  assert.equal(computeDelegablePermissionSet({ permissions: ['*'], scopes: [] }), null);
  assert.deepEqual(
    [...(computeDelegablePermissionSet({ permissions: ['major.read', 'user.read'], scopes: [] }) ?? [])],
    ['major.read', 'user.read'],
  );
  assert.deepEqual([...(computeDelegablePermissionSet(null) ?? [])], []);
});

test('模块级别可授出性：缺管理权限时只放行到「仅查看」', () => {
  const delegable = new Set(['major.read', 'major.export']);
  assert.equal(canGrantModuleLevel(delegable, MAJOR_MODULE, 'none'), true);
  assert.equal(canGrantModuleLevel(delegable, MAJOR_MODULE, 'read'), true);
  assert.equal(canGrantModuleLevel(delegable, MAJOR_MODULE, 'manage'), false, '缺 major.create/major.edit');
});

test('模块级别可授出性：超管（null）三个级别都放行', () => {
  for (const level of ['none', 'read', 'manage'] as const) {
    assert.equal(canGrantModuleLevel(null, MAJOR_MODULE, level), true);
  }
});
