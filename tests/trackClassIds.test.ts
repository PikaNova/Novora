import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_MATCHING_TRACK_CLASS_ID,
  classesInMajorScope,
  computeAutoTrackClassIds,
  recomputeMajorsTrackClassIds,
} from "../src/utils/trackClassIds.js";
import type { MajorExam } from "../src/types/index.js";
import type { SchoolClass } from "../src/types/school.js";

const CHEMISTRY = "\u5316\u5b66";
const POLITICS = "\u601d\u60f3\u653f\u6cbb";
const HISTORY = "\u5386\u53f2";
const GEOGRAPHY = "\u5730\u7406";

function schoolClass(overrides: Partial<SchoolClass> & { id: string }): SchoolClass {
  return { gradeId: "g1", name: overrides.id, order: 0, enabled: true, ...overrides };
}

function major(overrides: Partial<MajorExam> = {}): MajorExam {
  return { id: "m1", name: "Formal", items: [], order: 0, ...overrides };
}

function item(id: string, name: string, targetClassIds?: string[]) {
  return {
    id,
    name,
    startTime: "2026-08-03T08:00:00+08:00",
    endTime: "2026-08-03T09:30:00+08:00",
    enabled: true,
    order: 0,
    targetClassIds,
  };
}

test("classesInMajorScope excludes disabled and out-of-scope classes", () => {
  const result = classesInMajorScope(
    major({ targetClassIds: ["c2"] }),
    [schoolClass({ id: "c1" }), schoolClass({ id: "c2" }), schoolClass({ id: "c3", enabled: false })],
  );
  assert.deepEqual(result.map((value) => value.id), ["c2"]);
});

test("computeAutoTrackClassIds uses current tracks within the formal major scope", () => {
  const classes = [
    schoolClass({ id: "c1", track: [HISTORY, CHEMISTRY, GEOGRAPHY] }),
    schoolClass({ id: "c2", track: ["\u7269\u7406", CHEMISTRY, "\u751f\u7269"] }),
  ];
  assert.deepEqual(computeAutoTrackClassIds(major(), CHEMISTRY, classes, true), ["c1", "c2"]);
  assert.deepEqual(computeAutoTrackClassIds(major(), POLITICS, classes, true), [NO_MATCHING_TRACK_CLASS_ID]);
});

test("computeAutoTrackClassIds does not apply when track mode is disabled or the subject is not elective", () => {
  const classes = [schoolClass({ id: "c1", track: [HISTORY, CHEMISTRY, GEOGRAPHY] })];
  assert.equal(computeAutoTrackClassIds(major(), CHEMISTRY, classes, false), undefined);
  assert.equal(computeAutoTrackClassIds(major(), "\u8bed\u6587", classes, true), undefined);
});

test("recomputeMajorsTrackClassIds removes a stale elective class target", () => {
  const classes = [schoolClass({ id: "c1", track: [HISTORY, CHEMISTRY, GEOGRAPHY] })];
  const current = [major({ items: [item("politics", POLITICS, ["c1"]), item("chemistry", CHEMISTRY, ["c1"]) ] })];
  const result = recomputeMajorsTrackClassIds(current, classes, true);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].itemId, "politics");
  assert.deepEqual(result.majors[0].items[0].targetClassIds, [NO_MATCHING_TRACK_CLASS_ID]);
  assert.equal(result.majors[0].items[1], current[0].items[1]);
});

test("recomputeMajorsTrackClassIds clears formal elective scopes when track mode turns off", () => {
  const current = [major({ items: [item("chemistry", CHEMISTRY, ["c1"]) ] })];
  const result = recomputeMajorsTrackClassIds(current, [schoolClass({ id: "c1", track: [CHEMISTRY] })], false);
  assert.equal(result.changes.length, 1);
  assert.equal(result.majors[0].items[0].targetClassIds, undefined);
});

test("recomputeMajorsTrackClassIds leaves manually scoped quick temporary majors unchanged", () => {
  const current = [major({ source: "quick", temporary: true, targetClassIds: ["c1"], items: [item("chemistry", CHEMISTRY)] })];
  const result = recomputeMajorsTrackClassIds(current, [schoolClass({ id: "c1", track: [HISTORY, GEOGRAPHY, POLITICS] })], true);
  assert.equal(result.changes.length, 0);
  assert.equal(result.majors[0], current[0]);
});

test("recomputeMajorsTrackClassIds is a no-op when current targets already match", () => {
  const current = [major({ items: [item("chemistry", CHEMISTRY, ["c1"]) ] })];
  const result = recomputeMajorsTrackClassIds(current, [schoolClass({ id: "c1", track: [CHEMISTRY] })], true);
  assert.equal(result.changes.length, 0);
  assert.equal(result.majors[0], current[0]);
});
