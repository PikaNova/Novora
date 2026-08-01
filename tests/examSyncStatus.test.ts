import assert from "node:assert/strict";
import test from "node:test";
import {
  labelForExamSync,
  needsUrgentAttention,
  statusForExamSync,
} from "../src/utils/examSyncStatus.js";

test("max retries overrides the pending label", () => {
  assert.equal(labelForExamSync("max-retries", true), "同步失败，点击重试");
});

test("max retries prefers the concrete sync error", () => {
  assert.equal(
    statusForExamSync("max-retries", 0, true, "请求超时"),
    "请求超时",
  );
  assert.equal(needsUrgentAttention("max-retries"), true);
  assert.equal(needsUrgentAttention("error"), false);
});
