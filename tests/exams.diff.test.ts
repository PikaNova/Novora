import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeForCompare,
  sameJson,
  changedRecords,
  recordDiff,
  cleanActiveWeeklyPlanByClass,
} from '../api/_exams/diff.js';

test('canonicalizeForCompare: sorts object keys recursively so key order does not matter', () => {
  const a = canonicalizeForCompare({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalizeForCompare({ a: { c: 3, d: 2 }, b: 1 });
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

test('canonicalizeForCompare: recurses into arrays without reordering them', () => {
  const result = canonicalizeForCompare([
    { b: 1, a: 2 },
    { d: 4, c: 3 },
  ]);
  assert.deepEqual(result, [
    { a: 2, b: 1 },
    { c: 3, d: 4 },
  ]);
});

test('sameJson: treats key-order-different objects as equal, and null/undefined as equivalent', () => {
  assert.equal(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(sameJson(undefined, null), true);
  assert.equal(sameJson({ a: 1 }, { a: 2 }), false);
  assert.equal(sameJson([1, 2], [1, 2]), true);
  assert.equal(sameJson([1, 2], [2, 1]), false);
});

test('recordDiff: classifies records as added/removed/updated by id, ignoring key order', () => {
  const before = [
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' },
    { id: 'c', name: '丙' },
  ];
  const after = [
    { id: 'a', name: '甲' }, // unchanged
    { name: '乙', id: 'b', extra: 1 }, // updated (same id, different shape)
    { id: 'd', name: '丁' }, // added
    // 'c' removed
  ];
  const diff = recordDiff(before, after);
  assert.deepEqual(diff.added, [{ id: 'd', name: '丁' }]);
  assert.deepEqual(diff.removed, [{ id: 'c', name: '丙' }]);
  assert.deepEqual(diff.updated, [{ name: '乙', id: 'b', extra: 1 }]);
});

test('recordDiff: treats non-array inputs as empty', () => {
  const diff = recordDiff(undefined as unknown as Array<{ id?: unknown }>, [{ id: 'a' }]);
  assert.deepEqual(diff.added, [{ id: 'a' }]);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.updated, []);
});

test('changedRecords: returns both the before and after version of every changed id', () => {
  const before = [
    { id: 'a', v: 1 },
    { id: 'b', v: 1 },
  ];
  const after = [
    { id: 'a', v: 1 },
    { id: 'b', v: 2 },
    { id: 'c', v: 1 },
  ];
  const changed = changedRecords(before, after);
  // 'a' unchanged -> excluded. 'b' updated -> both versions included. 'c' added -> only the after version exists.
  assert.deepEqual(changed, [
    { id: 'b', v: 1 },
    { id: 'b', v: 2 },
    { id: 'c', v: 1 },
  ]);
});

test('changedRecords: a pure removal only contributes the before version', () => {
  const before = [{ id: 'a', v: 1 }];
  const after: Array<{ id?: unknown }> = [];
  assert.deepEqual(changedRecords(before, after), [{ id: 'a', v: 1 }]);
});

test('cleanActiveWeeklyPlanByClass: drops mappings for classes that no longer exist', () => {
  const classMap = new Map([
    ['c1', { id: 'c1' }],
    ['c2', { id: 'c2' }],
  ]);
  const result = cleanActiveWeeklyPlanByClass({ c1: 'w1', c2: 'w2', deleted: 'w3' }, classMap);
  assert.deepEqual(result, { c1: 'w1', c2: 'w2' });
});

test('cleanActiveWeeklyPlanByClass: returns an empty object for missing/non-object input', () => {
  const classMap = new Map([['c1', { id: 'c1' }]]);
  assert.deepEqual(cleanActiveWeeklyPlanByClass(undefined, classMap), {});
  assert.deepEqual(cleanActiveWeeklyPlanByClass(null as unknown as Record<string, string | null>, classMap), {});
});
