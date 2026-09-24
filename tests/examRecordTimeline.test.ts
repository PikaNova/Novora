import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExamRecordTimeline, type ExamTimelineRecordLike } from '../src/utils/examRecordTimeline.js';

const CREATED = 1_789_733_080_643;
const PUBLISHED = 1_789_733_084_055;

function record(overrides: Partial<ExamTimelineRecordLike> = {}): ExamTimelineRecordLike {
  return {
    createdAt: CREATED,
    publishedAt: null,
    actualStartAt: null,
    actualEndAt: null,
    endedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

const at = (stages: ReturnType<typeof buildExamRecordTimeline>, key: string) =>
  stages.find((stage) => stage.key === key)?.at ?? null;

test('发布：记录层 published_at 为空时用操作日志兜底', () => {
  const stages = buildExamRecordTimeline(record(), [
    { action: 'publish', createdAt: PUBLISHED, actorName: '超级管理员' },
  ]);
  assert.equal(at(stages, 'published'), PUBLISHED);
  assert.equal(at(stages, 'created'), CREATED);
});

test('发布：记录层有值时以记录层为准，不受日志影响', () => {
  const stages = buildExamRecordTimeline(record({ publishedAt: PUBLISHED + 10_000 }), [
    { action: 'publish', createdAt: PUBLISHED },
  ]);
  assert.equal(at(stages, 'published'), PUBLISHED + 10_000);
});

test('发布：多次发布日志取最早一次', () => {
  const stages = buildExamRecordTimeline(record(), [
    { action: 'publish', createdAt: PUBLISHED + 60_000 },
    { action: 'publish', createdAt: PUBLISHED },
  ]);
  assert.equal(at(stages, 'published'), PUBLISHED);
});

test('开考/结束/归档：记录层为空时分别用 auto_start / end 系列 / archive 系列兜底', () => {
  const stages = buildExamRecordTimeline(record(), [
    { action: 'auto_start', createdAt: 1_789_740_000_000 },
    { action: 'force_end', createdAt: 1_789_750_000_000 },
    { action: 'auto_archive', createdAt: 1_789_760_000_000 },
  ]);
  assert.equal(at(stages, 'started'), 1_789_740_000_000);
  assert.equal(at(stages, 'ended'), 1_789_750_000_000);
  assert.equal(at(stages, 'archived'), 1_789_760_000_000);
});

test('结束阶段优先 actualEndAt，其次 endedAt，最后日志', () => {
  const ended = buildExamRecordTimeline(record({ endedAt: 1_789_745_000_000 }), [
    { action: 'end', createdAt: 1_789_750_000_000 },
  ]);
  assert.equal(at(ended, 'ended'), 1_789_745_000_000);
  const actual = buildExamRecordTimeline(record({ endedAt: 1_789_745_000_000, actualEndAt: 1_789_746_000_000 }), []);
  assert.equal(at(actual, 'ended'), 1_789_746_000_000);
  assert.equal(at(buildExamRecordTimeline(record(), []), 'ended'), null);
});

test('暂停/继续按发生顺序展开成独立阶段，并带上操作者', () => {
  const stages = buildExamRecordTimeline(record(), [
    { action: 'resume', createdAt: 1_789_745_000_000, actorName: '超级管理员' },
    { action: 'pause', createdAt: 1_789_744_000_000, actorName: '系统' },
  ]);
  const pauses = stages.filter((stage) => stage.label === '暂停' || stage.label === '继续');
  assert.deepEqual(
    pauses.map((stage) => [stage.label, stage.at, stage.note]),
    [
      ['暂停', 1_789_744_000_000, '系统'],
      ['继续', 1_789_745_000_000, '超级管理员'],
    ],
  );
});
