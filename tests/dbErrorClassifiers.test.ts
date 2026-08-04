import assert from 'node:assert/strict';
import test from 'node:test';
import { missingRelation, updatedAtIntegerOverflow } from '../api/_exams/db.js';

test('missingRelation recognizes a missing relation error', () => {
  assert.equal(missingRelation(new Error('relation "exam_data" does not exist')), true);
});

test('missingRelation recognizes undefined table errors', () => {
  assert.equal(missingRelation(new Error('undefined_table: exam_data')), true);
});

test('missingRelation recognizes undefined column errors', () => {
  assert.equal(missingRelation(new Error('undefined_column: design_policy')), true);
});

test('missingRelation is case-insensitive', () => {
  assert.equal(missingRelation(new Error('RELATION "exam_data" DOES NOT EXIST')), true);
});

test('missingRelation rejects unrelated errors', () => {
  assert.equal(missingRelation(new Error('connection timed out')), false);
});

test('missingRelation stringifies non-Error values', () => {
  assert.equal(missingRelation('relation "exam_data" does not exist'), true);
  assert.equal(missingRelation('some other failure'), false);
});

test('updatedAtIntegerOverflow requires the Postgres code and matching text', () => {
  const error = Object.assign(new Error('value "9999999999999" is out of range for type integer'), { code: '22003' });
  assert.equal(updatedAtIntegerOverflow(error), true);
});

test('updatedAtIntegerOverflow rejects a matching code with unrelated text', () => {
  assert.equal(updatedAtIntegerOverflow(Object.assign(new Error('some other numeric error'), { code: '22003' })), false);
});

test('updatedAtIntegerOverflow rejects a matching text with another code', () => {
  assert.equal(updatedAtIntegerOverflow(Object.assign(new Error('value is out of range for type integer'), { code: '42601' })), false);
});

test('updatedAtIntegerOverflow rejects errors without a code', () => {
  assert.equal(updatedAtIntegerOverflow(new Error('out of range for type integer')), false);
});
