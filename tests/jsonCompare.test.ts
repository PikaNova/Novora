import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeForCompare, sameJson } from "../src/shared/jsonCompare.js";

test("sameJson ignores object key order at every object depth", () => {
  assert.equal(
    sameJson(
      { outer: { a: 1, b: { c: 2, d: 3 } }, list: [{ x: 1, y: 2 }] },
      { list: [{ y: 2, x: 1 }], outer: { b: { d: 3, c: 2 }, a: 1 } },
    ),
    true,
  );
});

test("sameJson preserves array order and detects real differences", () => {
  assert.equal(sameJson([1, 2, 3], [3, 2, 1]), false);
  assert.equal(sameJson({ a: 1 }, { a: 2 }), false);
});

test("sameJson treats null and undefined as equivalent JSON null", () => {
  assert.equal(sameJson(null, undefined), true);
});

test("canonicalizeForCompare sorts object keys without reordering arrays", () => {
  const result = canonicalizeForCompare([{ b: 1, a: 2 }, { d: 3, c: 4 }]);
  assert.deepEqual((result as Array<Record<string, unknown>>).map(Object.keys), [
    ["a", "b"],
    ["c", "d"],
  ]);
});
