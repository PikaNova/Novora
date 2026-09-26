import assert from 'node:assert/strict';
import test from 'node:test';
import { availableExamRecordActions, type ExamRecordActionContext } from '../src/shared/examRecordContracts.js';

function context(patch: Partial<ExamRecordActionContext>): ExamRecordActionContext {
  return { status: 'draft', actualStartAt: null, pausedAt: null, ...patch };
}

test('availableExamRecordActions: 草稿只能发布或复制', () => {
  assert.deepEqual(availableExamRecordActions(context({})), ['publish', 'copy']);
});

test('availableExamRecordActions: 已发布未开考的给暂停与结束（都不等系统），但不给继续', () => {
  for (const status of ['published', 'ongoing'] as const) {
    const actions = availableExamRecordActions(context({ status }));
    // 「开考」不再由人工发起（到点由系统自动开考）；「暂停」「结束」都不等系统：
    // 暂停不能因为还没开考就消失，结束也不必等系统判定（2026-09-25 去掉申请停止）。
    assert.deepEqual(actions, ['pause', 'extend', 'end', 'copy']);
    assert.equal(actions.includes('pause'), true);
    assert.equal(actions.includes('resume'), false);
  }
});

test('availableExamRecordActions: 开考后给暂停与结束，暂停中只给继续与结束', () => {
  const running = availableExamRecordActions(context({ status: 'ongoing', actualStartAt: 1_000 }));
  assert.deepEqual(running, ['pause', 'extend', 'end', 'copy']);
  assert.equal(running.at(-2), 'end', '结束是破坏性动作，排在同组最后、紧挨复制');

  const paused = availableExamRecordActions(context({ status: 'ongoing', actualStartAt: 1_000, pausedAt: 2_000 }));
  assert.deepEqual(paused, ['resume', 'end', 'copy']);
  assert.equal(paused.includes('pause'), false);
  assert.equal(paused.includes('extend'), false, '暂停中不提供延长，避免把时长算到暂停区间');
});

test('availableExamRecordActions: 结束与归档状态互斥且都可复制', () => {
  assert.deepEqual(availableExamRecordActions(context({ status: 'ended' })), ['archive', 'copy']);
  assert.deepEqual(availableExamRecordActions(context({ status: 'archived' })), ['unarchive', 'copy']);
});

test('availableExamRecordActions: 只要在暂停中就只给继续，不会再给一次暂停', () => {
  const actions = availableExamRecordActions(context({ status: 'published', actualStartAt: null, pausedAt: 1_000 }));
  assert.deepEqual(actions, ['resume', 'end', 'copy']);
  assert.equal(actions.includes('pause'), false);
});

test('availableExamRecordActions: 没有任何状态再产出「申请停止 / 强制结束」', () => {
  const statuses = ['draft', 'published', 'ongoing', 'ended', 'archived'] as const;
  for (const status of statuses) {
    for (const actualStartAt of [null, 1_000]) {
      const actions = availableExamRecordActions(context({ status, actualStartAt }));
      assert.equal(actions.includes('request_stop' as never), false, `${status} 不该再有申请停止`);
      assert.equal(actions.includes('force_end' as never), false, `${status} 不该再有强制结束`);
    }
  }
});
