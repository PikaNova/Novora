import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExamRecordProjection } from '../api/_exams/examRecordProjection.js';
import { transitionExamRecordStatus } from '../src/shared/examRecordContracts.js';

test('buildExamRecordProjection maps a regular major to a draft record', () => {
  const record = buildExamRecordProjection(
    {
      id: 'm1',
      name: '期中考试',
      items: [],
      order: 3,
      targetGradeIds: ['g1'],
      targetClassIds: ['c1'],
      createdAt: 100,
      createdBy: 7,
    },
    0,
    200,
    150,
  );
  assert.equal(record.status, 'draft');
  assert.equal(record.runtimeMajorId, 'm1');
  assert.equal(record.createdAt, 100);
  assert.equal(record.updatedAt, 150);
  assert.equal(record.createdBy, 7);
  assert.deepEqual(record.targetGradeIds, ['g1']);
  assert.equal(record.temporary, false);
  assert.equal(record.priorityOverSchedule, false);
});

test('buildExamRecordProjection marks quick and ended majors with lifecycle defaults', () => {
  const quick = buildExamRecordProjection(
    { id: 'quick', name: '临时考试', items: [], order: 0, source: 'quick', temporary: true },
    0,
    200,
    0,
  );
  const ended = buildExamRecordProjection(
    { id: 'ended', name: '已结束', items: [], order: 0, endedAt: 180 },
    0,
    200,
    200,
  );
  assert.equal(quick.status, 'published');
  assert.equal(quick.source, 'quick');
  assert.equal(ended.status, 'ended');
  assert.equal(ended.endedAt, 180);
});

test('buildExamRecordProjection keeps a copied major in draft even when its window is complete', () => {
  // 复制考试带 draft 标记：科目时间齐全也不能被「创建即发布」自动推成已发布。
  const items = [
    {
      id: 'i1',
      name: '语文',
      startTime: '2026-10-08T08:30:00',
      endTime: '2026-10-08T10:30:00',
      enabled: true,
      order: 0,
    },
  ];
  const copied = buildExamRecordProjection(
    { id: 'copy', name: '第二次月考（复制）', items, order: 1, draft: true },
    0,
    200,
    200,
  );
  const normal = buildExamRecordProjection({ id: 'normal', name: '第一次月考', items, order: 2 }, 0, 200, 200);
  assert.equal(copied.status, 'draft');
  assert.equal(normal.status, 'published');
});

test('transitionExamRecordStatus accepts only the v2.8 lifecycle edges', () => {
  assert.equal(transitionExamRecordStatus('draft', 'publish'), 'published');
  assert.equal(transitionExamRecordStatus('published', 'end'), 'ended');
  assert.equal(transitionExamRecordStatus('ended', 'archive'), 'archived');
  assert.equal(transitionExamRecordStatus('archived', 'unarchive'), 'ended');
  assert.equal(transitionExamRecordStatus('draft', 'end'), null);
  assert.equal(transitionExamRecordStatus('published', 'archive'), null);
  assert.equal(transitionExamRecordStatus('archived', 'publish'), null);
});
