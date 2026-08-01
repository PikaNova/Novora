import assert from "node:assert/strict";
import test from "node:test";
import {
  isOwnQuickTemporaryMajor,
  type QuickMajorLike,
} from "../src/utils/majorOwnership.js";

const classes = [{ id: "c1" }];
const grades = [{ id: "g1" }];
const quickMajor = (overrides: Partial<QuickMajorLike> = {}): QuickMajorLike => ({
  source: "quick",
  temporary: true,
  createdBy: 7,
  targetClassIds: [],
  targetGradeIds: [],
  ...overrides,
});

test("quick temporary major accepts its creator", () => {
  assert.equal(isOwnQuickTemporaryMajor(quickMajor(), 7, classes, grades), true);
});

test("quick temporary major supports a co-manager in its visible class or grade", () => {
  assert.equal(
    isOwnQuickTemporaryMajor(quickMajor({ createdBy: 9, targetClassIds: ["c1"] }), 7, classes, grades),
    true,
  );
  assert.equal(
    isOwnQuickTemporaryMajor(quickMajor({ createdBy: 9, targetGradeIds: ["g1"] }), 7, classes, grades),
    true,
  );
});

test("regular, non-temporary, and out-of-scope majors remain denied", () => {
  assert.equal(isOwnQuickTemporaryMajor(quickMajor({ source: "regular" }), 7, classes, grades), false);
  assert.equal(isOwnQuickTemporaryMajor(quickMajor({ temporary: false }), 7, classes, grades), false);
  assert.equal(
    isOwnQuickTemporaryMajor(quickMajor({ createdBy: 9, targetClassIds: ["other"] }), 7, classes, grades),
    false,
  );
});
