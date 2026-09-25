import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOwnQuickTemporaryMajor,
  isQuickTemporaryMajorFullyInScope,
  type QuickMajorLike,
} from '../src/utils/majorOwnership.js';

const quickMajor = (overrides: Partial<QuickMajorLike> = {}): QuickMajorLike => ({
  source: 'quick',
  temporary: true,
  createdBy: 7,
  targetClassIds: [],
  targetGradeIds: [],
  ...overrides,
});

test('quick temporary major accepts its creator', () => {
  assert.equal(isOwnQuickTemporaryMajor(quickMajor(), 7), true);
});

test('quick temporary major reserves full editing ownership for its creator', () => {
  assert.equal(isOwnQuickTemporaryMajor(quickMajor({ createdBy: 9, targetClassIds: ['c1'] }), 7), false);
});

test('quick temporary major allows a co-manager to end only a fully scoped exam', () => {
  const canAccessClass = (id: string) => id === 'c1';
  const canAccessGrade = (id: string) => id === 'g1';
  assert.equal(
    isQuickTemporaryMajorFullyInScope(
      quickMajor({ createdBy: 9, targetClassIds: ['c1'] }),
      canAccessClass,
      canAccessGrade,
    ),
    true,
  );
  assert.equal(
    isQuickTemporaryMajorFullyInScope(
      quickMajor({ createdBy: 9, targetGradeIds: ['g1'] }),
      canAccessClass,
      canAccessGrade,
    ),
    true,
  );
  assert.equal(
    isQuickTemporaryMajorFullyInScope(
      quickMajor({ createdBy: 9, targetClassIds: ['c1', 'c2'] }),
      canAccessClass,
      canAccessGrade,
    ),
    false,
  );
});

test('regular, non-temporary, and out-of-scope majors remain denied', () => {
  assert.equal(isOwnQuickTemporaryMajor(quickMajor({ source: 'regular' }), 7), false);
  assert.equal(isOwnQuickTemporaryMajor(quickMajor({ temporary: false }), 7), false);
  assert.equal(isOwnQuickTemporaryMajor(quickMajor({ createdBy: 9, targetClassIds: ['other'] }), 7), false);
});
