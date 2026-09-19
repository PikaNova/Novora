import assert from 'node:assert/strict';
import test from 'node:test';
import { availableExamRecordActions, type ExamRecordActionContext } from '../src/shared/examRecordContracts.js';

function context(patch: Partial<ExamRecordActionContext>): ExamRecordActionContext {
  return { status: 'draft', actualStartAt: null, pausedAt: null, ...patch };
}

test('availableExamRecordActions: 草稿只能发布或复制', () => {
  assert.deepEqual(availableExamRecordActions(context({})), ['publish', 'copy']);
});

test('availableExamRecordActions: 已发布未开考时先给开考，不能给暂停或继续', () => {
  for (const status of ['published', 'ongoing'] as const) {
    const actions = availableExamRecordActions(context({ status }));
    // 手动结束已经变成「申请停止」；「开考」不再由人工发起（到点由系统自动开考）。
    assert.deepEqual(actions, ['request_stop', 'extend', 'copy']);
    assert.equal(actions.includes('pause'), false);
    assert.equal(actions.includes('resume'), false);
  }
});

test('availableExamRecordActions: 开考后给暂停，暂停中只给继续和申请停止', () => {
  const running = availableExamRecordActions(context({ status: 'ongoing', actualStartAt: 1_000 }));
  assert.deepEqual(running, ['pause', 'extend', 'request_stop', 'copy']);
  assert.equal(running.includes('force_end'), false, '只有停止中才给强制结束');

  const paused = availableExamRecordActions(context({ status: 'ongoing', actualStartAt: 1_000, pausedAt: 2_000 }));
  assert.deepEqual(paused, ['resume', 'request_stop', 'copy']);
  assert.equal(paused.includes('pause'), false);
  assert.equal(paused.includes('extend'), false, '暂停中不提供延长，避免把时长算到暂停区间');
});

test('availableExamRecordActions: 结束与归档状态互斥且都可复制', () => {
  assert.deepEqual(availableExamRecordActions(context({ status: 'ended' })), ['archive', 'copy']);
  assert.deepEqual(availableExamRecordActions(context({ status: 'archived' })), ['unarchive', 'copy']);
});

test('availableExamRecordActions: 未开考的已发布考试不会因为暂停字段而给出继续按钮', () => {
  const actions = availableExamRecordActions(context({ status: 'published', actualStartAt: null, pausedAt: 1_000 }));
  assert.deepEqual(actions, ['request_stop', 'extend', 'copy']);
});

test('availableExamRecordActions: 停止中只给强制结束与复制（等系统判定）', () => {
  const actions = availableExamRecordActions(context({ status: 'stopping', actualStartAt: 1_000 }));
  assert.deepEqual(actions, ['force_end', 'copy']);
  assert.equal(actions.includes('request_stop'), false, '已经申请过，不再重复申请');
});
