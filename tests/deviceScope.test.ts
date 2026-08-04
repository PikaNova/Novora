import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceIsInScope, resolveDeviceScope } from '../src/utils/deviceScope.js';

const grades = [
  { id: 'g1', name: 'Grade 1', order: 0, enabled: true },
  { id: 'g2', name: 'Grade 2', order: 1, enabled: true },
];
const classes = [
  { id: 'c1', gradeId: 'g1', name: 'Class 1', order: 0, enabled: true },
  { id: 'c2', gradeId: 'g1', name: 'Class 2', order: 1, enabled: true },
  { id: 'c3', gradeId: 'g2', name: 'Class 3', order: 0, enabled: true },
];

test('device scope: a grade administrator receives only their grade and its classes', () => {
  const scope = resolveDeviceScope(grades, classes, {
    permissions: ['device.read'],
    scopes: [{ type: 'grade', gradeId: 'g1' }],
  });
  assert.deepEqual(scope.grades.map((item) => item.id), ['g1']);
  assert.deepEqual(scope.classes.map((item) => item.id), ['c1', 'c2']);
  assert.equal(deviceIsInScope({ gradeId: 'g2', classId: 'c3' }, scope), false);
});

test('device scope: a class administrator receives only their assigned class', () => {
  const scope = resolveDeviceScope(grades, classes, {
    permissions: ['device.read'],
    scopes: [{ type: 'class', gradeId: 'g1', classId: 'c2' }],
  });
  assert.deepEqual(scope.grades.map((item) => item.id), ['g1']);
  assert.deepEqual(scope.classes.map((item) => item.id), ['c2']);
  assert.equal(deviceIsInScope({ gradeId: 'g1', classId: 'c1' }, scope), false);
});

test('device scope: an all-scope administrator retains every grade, class, and device', () => {
  const scope = resolveDeviceScope(grades, classes, {
    permissions: ['device.read'],
    scopes: [{ type: 'all' }],
  });
  assert.equal(scope.allScope, true);
  assert.equal(scope.grades.length, 2);
  assert.equal(scope.classes.length, 3);
  assert.equal(deviceIsInScope({ gradeId: 'g2', classId: 'c3' }, scope), true);
});
