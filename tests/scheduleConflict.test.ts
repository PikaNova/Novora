import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTimeOverlap,
  isOverlapWithBuffer,
  getMajorPeriod,
  resolveMajorWeeklyConflicts,
} from '../src/utils/scheduleConflict.js';
import { DEFAULT_WEEKLY_CONFLICT_POLICY } from '../src/types/exam.js';
import type { ExamItem } from '../src/types/index.js';
import type { MajorScheduleBlock, WeeklyConflictPolicy, WeeklyOccurrence } from '../src/types/exam.js';

function examItem(overrides: Partial<ExamItem> = {}): ExamItem {
  return {
    id: 'item-1',
    name: '\u8bed\u6587',
    startTime: '2025-01-15T09:00:00',
    endTime: '2025-01-15T10:00:00',
    enabled: true,
    order: 0,
    ...overrides,
  };
}

function occurrence(overrides: Partial<WeeklyOccurrence> = {}): WeeklyOccurrence {
  return {
    id: 'occ-1',
    name: '\u5468\u4e00\u65e9\u81ea\u4e60',
    startTime: '2025-01-15T09:00:00',
    endTime: '2025-01-15T09:30:00',
    enabled: true,
    order: 0,
    kind: 'weekly',
    occurrenceId: 'occ-1',
    weeklyPlanId: 'plan-1',
    weeklyItemId: 'wi-1',
    date: '2025-01-15',
    forced: false,
    ...overrides,
  };
}

function majorBlock(overrides: Partial<MajorScheduleBlock> = {}): MajorScheduleBlock {
  return {
    id: 'major-1',
    name: '\u671f\u4e2d\u8003\u8bd5',
    items: [examItem()],
    policy: DEFAULT_WEEKLY_CONFLICT_POLICY,
    ...overrides,
  };
}

function policy(overrides: Partial<WeeklyConflictPolicy> = {}): WeeklyConflictPolicy {
  return { ...DEFAULT_WEEKLY_CONFLICT_POLICY, ...overrides };
}

// ---- isTimeOverlap ----

test('isTimeOverlap: overlapping ranges return true', () => {
  assert.equal(isTimeOverlap(0, 100, 50, 150), true);
});

test('isTimeOverlap: disjoint ranges return false', () => {
  assert.equal(isTimeOverlap(0, 100, 200, 300), false);
});

test('isTimeOverlap: touching boundary (aEnd === bStart) is not an overlap (half-open interval)', () => {
  assert.equal(isTimeOverlap(0, 100, 100, 200), false);
});

test('isTimeOverlap: one range fully containing another returns true', () => {
  assert.equal(isTimeOverlap(0, 1000, 100, 200), true);
});

// ---- isOverlapWithBuffer ----

test('isOverlapWithBuffer: no buffer, non-overlapping times returns false', () => {
  const major = examItem({ startTime: '2025-01-15T10:00:00', endTime: '2025-01-15T11:00:00' });
  const weekly = examItem({ startTime: '2025-01-15T11:10:00', endTime: '2025-01-15T11:20:00' });
  assert.equal(isOverlapWithBuffer(major, weekly, 0, 0), false);
});

test('isOverlapWithBuffer: an after-buffer can turn a near-miss into an overlap', () => {
  const major = examItem({ startTime: '2025-01-15T10:00:00', endTime: '2025-01-15T11:00:00' });
  const weekly = examItem({ startTime: '2025-01-15T11:10:00', endTime: '2025-01-15T11:20:00' });
  assert.equal(isOverlapWithBuffer(major, weekly, 0, 15), true);
});

test('isOverlapWithBuffer: a before-buffer can turn a near-miss into an overlap', () => {
  const major = examItem({ startTime: '2025-01-15T10:00:00', endTime: '2025-01-15T11:00:00' });
  const weekly = examItem({ startTime: '2025-01-15T09:50:00', endTime: '2025-01-15T09:58:00' });
  assert.equal(isOverlapWithBuffer(major, weekly, 15, 0), true);
});

test('isOverlapWithBuffer: returns false when a time cannot be parsed', () => {
  const major = examItem({ startTime: '', endTime: '2025-01-15T11:00:00' });
  const weekly = examItem();
  assert.equal(isOverlapWithBuffer(major, weekly, 0, 0), false);
});

// ---- getMajorPeriod ----

test('getMajorPeriod: single item returns its own date as both start and end key', () => {
  const period = getMajorPeriod([examItem({ startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T10:00:00' })]);
  assert.deepEqual(period, { startKey: '2025-01-15', endKey: '2025-01-15' });
});

test('getMajorPeriod: spans from the earliest start date to the latest end date across items', () => {
  const items = [
    examItem({ id: 'a', startTime: '2025-01-17T09:00:00', endTime: '2025-01-17T10:00:00' }),
    examItem({ id: 'b', startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T10:00:00' }),
    examItem({ id: 'c', startTime: '2025-01-16T09:00:00', endTime: '2025-01-19T10:00:00' }),
  ];
  assert.deepEqual(getMajorPeriod(items), { startKey: '2025-01-15', endKey: '2025-01-19' });
});

test('getMajorPeriod: empty item list returns null', () => {
  assert.equal(getMajorPeriod([]), null);
});

// ---- resolveMajorWeeklyConflicts ----

test('resolveMajorWeeklyConflicts: whole-day scope suppresses any weekly occurrence on the same date', () => {
  const block = majorBlock({ policy: policy({ scope: 'whole-day' }) });
  const occ = occurrence({ date: '2025-01-15' });
  const result = resolveMajorWeeklyConflicts([block], [occ]);
  assert.deepEqual(result.activeWeekly, []);
  assert.equal(result.suppressedWeekly.length, 1);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, 'whole-day');
  assert.equal(result.conflicts[0].resolution, 'major-wins');
});

test('resolveMajorWeeklyConflicts: whole-day scope does not affect occurrences on a different date', () => {
  const block = majorBlock({ policy: policy({ scope: 'whole-day' }) });
  const occ = occurrence({ date: '2025-01-16' });
  const result = resolveMajorWeeklyConflicts([block], [occ]);
  assert.deepEqual(result.suppressedWeekly, []);
  assert.equal(result.activeWeekly.length, 1);
  assert.equal(result.conflicts.length, 0);
});

test('resolveMajorWeeklyConflicts: time-overlap scope only flags occurrences whose actual times overlap', () => {
  const block = majorBlock({
    items: [examItem({ startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T10:00:00' })],
    policy: policy({ scope: 'time-overlap' }),
  });
  const overlapping = occurrence({ id: 'occ-a', occurrenceId: 'occ-a', startTime: '2025-01-15T09:30:00', endTime: '2025-01-15T10:30:00' });
  const nonOverlapping = occurrence({ id: 'occ-b', occurrenceId: 'occ-b', startTime: '2025-01-15T14:00:00', endTime: '2025-01-15T14:30:00' });
  const result = resolveMajorWeeklyConflicts([block], [overlapping, nonOverlapping]);
  assert.equal(result.suppressedWeekly.length, 1);
  assert.equal(result.suppressedWeekly[0].occurrenceId, 'occ-a');
  assert.equal(result.activeWeekly.length, 1);
  assert.equal(result.activeWeekly[0].occurrenceId, 'occ-b');
  assert.equal(result.conflicts[0].type, 'time-overlap');
});

test('resolveMajorWeeklyConflicts: time-overlap scope with a buffer reports type "buffer-overlap"', () => {
  const block = majorBlock({
    items: [examItem({ startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T10:00:00' })],
    policy: policy({ scope: 'time-overlap', bufferAfterMinutes: 15 }),
  });
  const occ = occurrence({ startTime: '2025-01-15T10:05:00', endTime: '2025-01-15T10:20:00' });
  const result = resolveMajorWeeklyConflicts([block], [occ]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, 'buffer-overlap');
  assert.equal(result.suppressedWeekly.length, 1);
});

test('resolveMajorWeeklyConflicts: whole-major-period scope suppresses occurrences on any date within the exam period, even with no exam item that day', () => {
  const block = majorBlock({
    items: [
      examItem({ id: 'a', startTime: '2025-01-13T09:00:00', endTime: '2025-01-13T10:00:00' }),
      examItem({ id: 'b', startTime: '2025-01-17T09:00:00', endTime: '2025-01-17T10:00:00' }),
    ],
    policy: policy({ scope: 'whole-major-period' }),
  });
  const occ = occurrence({ date: '2025-01-15' }); // no exam that day, but within the period
  const result = resolveMajorWeeklyConflicts([block], [occ]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, 'whole-major-period');
  assert.equal(result.suppressedWeekly.length, 1);
});

test('resolveMajorWeeklyConflicts: a forced occurrence stays active but still records a weekly-forced conflict', () => {
  const block = majorBlock({ policy: policy({ scope: 'whole-day' }) });
  const occ = occurrence({ date: '2025-01-15', forced: true });
  const result = resolveMajorWeeklyConflicts([block], [occ]);
  assert.equal(result.activeWeekly.length, 1);
  assert.deepEqual(result.suppressedWeekly, []);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].resolution, 'weekly-forced');
});

test('resolveMajorWeeklyConflicts: a disabled policy never produces a conflict', () => {
  const block = majorBlock({ policy: policy({ scope: 'whole-day', enabled: false }) });
  const occ = occurrence({ date: '2025-01-15' });
  const result = resolveMajorWeeklyConflicts([block], [occ]);
  assert.equal(result.activeWeekly.length, 1);
  assert.equal(result.conflicts.length, 0);
});

test('resolveMajorWeeklyConflicts: with multiple conflicting blocks, the strongest scope (whole-major-period > whole-day > time-overlap) wins', () => {
  const dayBlock = majorBlock({
    id: 'day-block',
    name: '\u65e5\u5e38\u6d4b\u9a8c',
    items: [examItem({ startTime: '2025-01-15T09:00:00', endTime: '2025-01-15T10:00:00' })],
    policy: policy({ scope: 'whole-day' }),
  });
  const periodBlock = majorBlock({
    id: 'period-block',
    name: '\u671f\u672b\u8003\u8bd5\u5468',
    items: [
      examItem({ id: 'p1', startTime: '2025-01-13T09:00:00', endTime: '2025-01-13T10:00:00' }),
      examItem({ id: 'p2', startTime: '2025-01-17T09:00:00', endTime: '2025-01-17T10:00:00' }),
    ],
    policy: policy({ scope: 'whole-major-period' }),
  });
  const occ = occurrence({ date: '2025-01-15' });
  const result = resolveMajorWeeklyConflicts([dayBlock, periodBlock], [occ]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, 'whole-major-period');
  assert.equal(result.conflicts[0].majorExamId, 'period-block');
});
