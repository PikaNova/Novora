import assert from "node:assert/strict";
import test from "node:test";
import {
  duration,
  fmtAnnTime,
  fmtLocal,
  makeId,
  phase,
  syncMajorStateRef,
  toISO,
  toLocalInput,
} from "../src/hooks/admin/adminPageUtils.js";
import type { ExamItem, MajorExam } from "../src/types/index.js";

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

test("makeId: produces the expected timestamp and random suffix shape", () => {
  assert.match(makeId(), /^exam_\d+_[a-z0-9]{1,5}$/);
});

test("makeId: consecutive calls produce unique values", () => {
  assert.equal(new Set(Array.from({ length: 20 }, () => makeId())).size, 20);
});

test("fmtLocal: converts ISO text to minute precision", () => {
  assert.equal(fmtLocal("2024-01-15T08:30:00.000Z"), "2024-01-15 08:30");
});

test("fmtLocal: returns empty text for missing input", () => {
  assert.equal(fmtLocal(undefined as unknown as string), "");
  assert.equal(fmtLocal(null as unknown as string), "");
  assert.equal(fmtLocal(""), "");
});

test("toISO: converts a display separator to T", () => {
  assert.equal(toISO("2024-01-15 08:30"), "2024-01-15T08:30");
});

test("toISO: trims trailing whitespace", () => {
  assert.equal(toISO("2024-01-15 08:30  "), "2024-01-15T08:30");
});

test("toLocalInput and toISO round-trip a minute timestamp", () => {
  const time = Date.UTC(2024, 0, 15, 8, 30, 0);
  const localInput = toLocalInput(time);
  assert.match(localInput, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(new Date(toISO(localInput.replace("T", " "))).getTime(), time);
});

test("duration: formats sub-hour durations", () => {
  assert.equal(duration("2024-01-15T08:00:00Z", "2024-01-15T08:30:00Z"), "30m");
});

test("duration: formats exact hour durations", () => {
  assert.equal(duration("2024-01-15T08:00:00Z", "2024-01-15T09:00:00Z"), "1h");
});

test("duration: formats mixed hour and minute durations", () => {
  assert.equal(duration("2024-01-15T08:00:00Z", "2024-01-15T09:30:00Z"), "1h30m");
});

test("duration: rejects non-positive durations", () => {
  assert.equal(duration("2024-01-15T09:00:00Z", "2024-01-15T08:00:00Z"), "");
  assert.equal(duration("2024-01-15T08:00:00Z", "2024-01-15T08:00:00Z"), "");
});

test("duration: rejects unparseable dates", () => {
  assert.equal(duration("not-a-date", "2024-01-15T08:00:00Z"), "");
});

function makeExamItem(overrides: Partial<ExamItem> = {}): ExamItem {
  return {
    id: "item-1",
    name: "Language",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    enabled: true,
    order: 0,
    ...overrides,
  };
}

test("phase: identifies waiting items", () => {
  assert.equal(phase(makeExamItem({
    startTime: new Date(Date.now() + 60_000).toISOString(),
    endTime: new Date(Date.now() + 120_000).toISOString(),
  })), "waiting");
});

test("phase: identifies ongoing items", () => {
  assert.equal(phase(makeExamItem({
    startTime: new Date(Date.now() - 60_000).toISOString(),
    endTime: new Date(Date.now() + 60_000).toISOString(),
  })), "ongoing");
});

test("phase: identifies ended items", () => {
  assert.equal(phase(makeExamItem({
    startTime: new Date(Date.now() - 120_000).toISOString(),
    endTime: new Date(Date.now() - 60_000).toISOString(),
  })), "ended");
});

test("fmtAnnTime: returns empty text for zero or NaN", () => {
  assert.equal(fmtAnnTime(0), "");
  assert.equal(fmtAnnTime(Number.NaN), "");
});

test("fmtAnnTime: returns a 24-hour locale date-time string", () => {
  const formatted = fmtAnnTime(Date.UTC(2024, 10, 14, 22, 13, 20));
  assert.match(formatted, /^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}:\d{2}$/);
  assert.doesNotMatch(formatted, /AM|PM/);
});
