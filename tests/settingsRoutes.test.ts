import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveResetCategories,
  sanitizeDesignPolicyRules,
} from '../api/_exams/routes/settingsRoutes.js';

test('sanitizeDesignPolicyRules returns an empty list for non-array input', () => {
  assert.deepEqual(sanitizeDesignPolicyRules(undefined), []);
  assert.deepEqual(sanitizeDesignPolicyRules(null), []);
  assert.deepEqual(sanitizeDesignPolicyRules('not-an-array'), []);
});

test('sanitizeDesignPolicyRules normalizes a school rule', () => {
  assert.deepEqual(sanitizeDesignPolicyRules([
    { id: 'school', scope: 'school', scopeId: 'ignored', designId: 'classic' },
  ]), [{ id: 'school', scope: 'school', scopeId: '*', designId: 'classic' }]);
});

test('sanitizeDesignPolicyRules preserves a valid scoped rule', () => {
  assert.deepEqual(sanitizeDesignPolicyRules([
    { id: 'grade', scope: 'grade', scopeId: 'grade-1', designId: 'classic' },
  ]), [{ id: 'grade', scope: 'grade', scopeId: 'grade-1', designId: 'classic' }]);
});

test('sanitizeDesignPolicyRules drops scoped rules without a scope id', () => {
  assert.deepEqual(sanitizeDesignPolicyRules([{ scope: 'class', scopeId: '', designId: 'classic' }]), []);
});

test('sanitizeDesignPolicyRules drops rules without a design id', () => {
  assert.deepEqual(sanitizeDesignPolicyRules([{ scope: 'grade', scopeId: 'grade-1', designId: '' }]), []);
});

test('sanitizeDesignPolicyRules drops rules with an unsupported scope', () => {
  assert.deepEqual(sanitizeDesignPolicyRules([{ scope: 'district', scopeId: 'district-1', designId: 'classic' }]), []);
});

test('sanitizeDesignPolicyRules keeps only the last school rule', () => {
  const result = sanitizeDesignPolicyRules([
    { id: 'school-1', scope: 'school', designId: 'classic' },
    { id: 'grade-1', scope: 'grade', scopeId: 'grade-1', designId: 'modern' },
    { id: 'school-2', scope: 'school', designId: 'dark' },
  ]);
  assert.deepEqual(result, [{ id: 'school-2', scope: 'school', scopeId: '*', designId: 'dark' }]);
});

test('sanitizeDesignPolicyRules limits raw rules to 500 entries', () => {
  const manyRules = Array.from({ length: 501 }, (_, index) => ({
    id: `r${index}`, scope: 'device', scopeId: `device-${index}`, designId: 'classic',
  }));
  assert.equal(sanitizeDesignPolicyRules(manyRules).length, 500);
});

test('sanitizeDesignPolicyRules generates ids and trims field lengths', () => {
  const result = sanitizeDesignPolicyRules([
    { scope: 'device', scopeId: `  ${'x'.repeat(200)}  `, designId: `  ${'y'.repeat(200)}  ` },
  ]);
  assert.deepEqual(result, [{
    id: 'design-0', scope: 'device', scopeId: 'x'.repeat(128), designId: 'y'.repeat(80),
  }]);
});

test('resolveResetCategories returns no flags for empty categories', () => {
  const none = { resetMajor: false, resetWeekly: false, resetSchool: false, resetSettings: false, resetDevices: false };
  assert.deepEqual(resolveResetCategories([]), none);
});

test('resolveResetCategories ignores unknown categories', () => {
  const none = { resetMajor: false, resetWeekly: false, resetSchool: false, resetSettings: false, resetDevices: false };
  assert.deepEqual(resolveResetCategories(['unknown']), none);
});

test('resolveResetCategories expands all categories', () => {
  assert.deepEqual(resolveResetCategories(['all']), {
    resetMajor: true, resetWeekly: true, resetSchool: true, resetSettings: true, resetDevices: true,
  });
});

test('resolveResetCategories maps a major reset', () => {
  assert.deepEqual(resolveResetCategories(['major']), {
    resetMajor: true, resetWeekly: false, resetSchool: false, resetSettings: false, resetDevices: false,
  });
});

test('resolveResetCategories combines weekly and settings resets', () => {
  assert.deepEqual(resolveResetCategories(['weekly', 'settings']), {
    resetMajor: false, resetWeekly: true, resetSchool: false, resetSettings: true, resetDevices: false,
  });
});

test('resolveResetCategories maps a device reset without school reset', () => {
  assert.deepEqual(resolveResetCategories(['devices']), {
    resetMajor: false, resetWeekly: false, resetSchool: false, resetSettings: false, resetDevices: true,
  });
});

test('resolveResetCategories cascades school reset to devices', () => {
  assert.deepEqual(resolveResetCategories(['school']), {
    resetMajor: false, resetWeekly: false, resetSchool: true, resetSettings: false, resetDevices: true,
  });
});
