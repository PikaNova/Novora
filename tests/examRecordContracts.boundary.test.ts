import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXAM_RECORD_STATUSES,
  isExamRecordStatus,
  transitionExamRecordStatus,
} from '../src/shared/examRecordContracts.js';
import { buildExamRecordProjection } from '../api/_exams/examRecordProjection.js';
import type { MajorExam } from '../src/types/index.js';

test('exam record status guard accepts only persisted states', () => {
  assert.deepEqual([...EXAM_RECORD_STATUSES], ['draft', 'published', 'ended', 'archived']);

  for (const status of EXAM_RECORD_STATUSES) {
    assert.equal(isExamRecordStatus(status), true, `expected ${status} to be accepted`);
  }

  for (const value of ['ongoing', 'DRAFT', '', null, 1, {}, ['draft']]) {
    assert.equal(isExamRecordStatus(value), false, `expected ${String(value)} to be rejected`);
  }
});

test('exam record transitions allow only the documented lifecycle edges', () => {
  assert.equal(transitionExamRecordStatus('draft', 'publish'), 'published');
  assert.equal(transitionExamRecordStatus('published', 'end'), 'ended');
  assert.equal(transitionExamRecordStatus('ended', 'archive'), 'archived');
  assert.equal(transitionExamRecordStatus('archived', 'unarchive'), 'ended');

  const actions = ['publish', 'end', 'archive', 'unarchive'] as const;
  const statuses = [...EXAM_RECORD_STATUSES];
  for (const status of statuses) {
    for (const action of actions) {
      const isAllowed =
        (status === 'draft' && action === 'publish') ||
        (status === 'published' && action === 'end') ||
        (status === 'ended' && action === 'archive') ||
        (status === 'archived' && action === 'unarchive');
      assert.equal(transitionExamRecordStatus(status, action) !== null, isAllowed, `${status} -> ${action}`);
    }
  }
});

test('projection normalizes malformed optional fields without mutating the major', () => {
  const major = {
    id: 'boundary-major',
    name: '边界考试',
    items: [],
    order: Number.NaN,
    targetGradeIds: ['g1', '', 42, 'g2'],
    targetClassIds: 'not-an-array',
    source: 'other',
    temporary: 'true',
    priorityOverSchedule: 1,
    createdAt: Number.POSITIVE_INFINITY,
    createdBy: Number.NaN,
    endedAt: null,
  } as unknown as MajorExam;
  const before = structuredClone(major);

  const record = buildExamRecordProjection(major, 4, 500, 0);

  assert.deepEqual(major, before);
  assert.equal(record.id, 'boundary-major');
  assert.equal(record.name, '边界考试');
  assert.equal(record.status, 'draft');
  assert.equal(record.source, 'regular');
  assert.equal(record.temporary, false);
  assert.equal(record.priorityOverSchedule, false);
  assert.equal(record.createdAt, 500);
  assert.equal(record.createdBy, null);
  assert.equal(record.updatedAt, 500);
  assert.equal(record.sortOrder, 4);
  assert.deepEqual(record.targetGradeIds, ['g1', 'g2']);
  assert.deepEqual(record.targetClassIds, []);
});

test('projection maps quick and ended records to the expected persisted states', () => {
  const quick = buildExamRecordProjection(
    {
      id: 'quick-boundary',
      name: '临时考试',
      items: [],
      order: 0,
      source: 'quick',
      temporary: true,
    },
    0,
    200,
    150,
  );
  const ended = buildExamRecordProjection(
    {
      id: 'ended-boundary',
      name: '已结束',
      items: [],
      order: 1,
      endedAt: 180,
    },
    1,
    200,
    200,
  );

  assert.equal(quick.status, 'published');
  assert.equal(ended.status, 'ended');
  assert.equal(ended.endedAt, 180);
});
