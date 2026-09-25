import assert from 'node:assert/strict';
import test from 'node:test';
import { safeLoginDestination } from '../src/utils/safeNavigation.js';

test('allows only supported authenticated destinations', () => {
  assert.equal(safeLoginDestination('/admin'), '/admin');
  assert.equal(safeLoginDestination('/admin?tab=users#account'), '/admin?tab=users#account');
  assert.equal(safeLoginDestination('/settings?section=network'), '/settings?section=network');
  // 后台/设置的子页也是合法落点：刷新到子页再登录时应该回到原处。
  assert.equal(safeLoginDestination('/admin/devices'), '/admin/devices');
  assert.equal(safeLoginDestination('/admin/exam/schedule?password=1'), '/admin/exam/schedule?password=1');
  assert.equal(safeLoginDestination('/settings/exam'), '/settings/exam');
});

test('falls back for external, protocol-relative, malformed, and unsupported destinations', () => {
  const unsafe = [
    null,
    '',
    'https://evil.example',
    '//evil.example/admin',
    '/\\evil.example/admin',
    '/%5cevil.example/admin',
    '/%255cevil.example/admin',
    '%2f%2fevil.example/admin',
    '%252f%252fevil.example/admin',
    '/admin/%2e%2e/other',
    '/other',
    '/administrator/admin',
    '/adminx/1',
    '/admin\n',
    ' /admin',
  ];
  for (const value of unsafe) assert.equal(safeLoginDestination(value), '/admin', String(value));
});
