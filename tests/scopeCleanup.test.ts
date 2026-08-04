import assert from "node:assert/strict";
import test from "node:test";
import { computeRemovedScopeIds } from "../api/_exams/scopeCleanup.js";

test("scope cleanup leaves omitted structure fields unchanged", () => {
  assert.deepEqual(
    computeRemovedScopeIds([{ id: "g1" }], [{ id: "c1" }], undefined, undefined),
    { removedGradeIds: [], removedClassIds: [] },
  );
});

test("scope cleanup reports only ids removed from supplied lists", () => {
  assert.deepEqual(
    computeRemovedScopeIds(
      [{ id: "g1" }, { id: "g2" }],
      [{ id: "c1" }, { id: "c2" }],
      [{ id: "g1", name: "renamed" }],
      [{ id: "c2" }],
    ),
    { removedGradeIds: ["g2"], removedClassIds: ["c1"] },
  );
});

test("scope cleanup ignores empty ids", () => {
  assert.deepEqual(
    computeRemovedScopeIds([{ id: "" }, {}], [{ id: null }], [], []),
    { removedGradeIds: [], removedClassIds: [] },
  );
});
