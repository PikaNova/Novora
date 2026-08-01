import assert from "node:assert/strict";
import test from "node:test";
import { syncMajorStateRef } from "../src/hooks/admin/adminPageUtils.js";
import type { MajorExam } from "../src/types/index.js";

const original: MajorExam = {
  id: "major-original",
  name: "Original",
  items: [],
  order: 0,
};

const added: MajorExam = {
  id: "major-added",
  name: "Added after initial load",
  items: [],
  order: 1,
};

test("syncMajorStateRef: a later cross-domain save reads the newly created major", () => {
  const stateRef = {
    current: { majors: [original], activeMajorId: original.id },
  };

  syncMajorStateRef(stateRef, [original, added], added.id);

  const weeklySavePayload = {
    majors: stateRef.current.majors,
    activeMajorId: stateRef.current.activeMajorId,
    weeklyPlans: [{ id: "weekly-1" }],
  };
  assert.deepEqual(weeklySavePayload.majors, [original, added]);
  assert.equal(weeklySavePayload.activeMajorId, added.id);
});
