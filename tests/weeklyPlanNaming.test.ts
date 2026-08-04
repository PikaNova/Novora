import assert from "node:assert/strict";
import test from "node:test";
import { planTitleForClass } from "../src/utils/settings/weekly.js";

test("planTitleForClass: new plans use the target class name without a generic suffix", () => {
  assert.equal(planTitleForClass("1班"), "1班");
  assert.equal(planTitleForClass(" 高一 A 班 "), "高一 A 班");
});

test("planTitleForClass: missing class names retain a safe fallback", () => {
  assert.equal(planTitleForClass(undefined), "班级");
});
