import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTransitionDeviceCommand,
  describeDeviceLastCommand,
  isDeviceCommandExpired,
  isDeviceExamPaused,
  isDeviceInExam,
  isDeviceTemporaryExam,
  parseDeviceLastCommand,
  transitionDeviceCommand,
  type DeviceCommand,
} from '../src/shared/deviceContracts.js';

const base: DeviceCommand = {
  id: 'cmd-1',
  action: 'pause',
  createdAt: 100,
  status: 'pending',
  expiresAt: 1_000,
};

test('device command state machine accepts the delivery lifecycle', () => {
  assert.equal(canTransitionDeviceCommand('pending', 'claimed'), true);
  assert.equal(canTransitionDeviceCommand('claimed', 'acknowledged'), true);
  const claimed = transitionDeviceCommand(base, 'claimed', 200);
  assert.equal(claimed?.status, 'claimed');
  assert.equal(claimed?.claimedAt, 200);
  const acknowledged = claimed && transitionDeviceCommand(claimed, 'acknowledged', 300);
  assert.equal(acknowledged?.acknowledgedAt, 300);
});

test('设备列表里能看出指令的执行结果（别只留一句"已发送"）', () => {
  assert.deepEqual(describeDeviceLastCommand({ id: 'c1', action: 'end', status: 'acknowledged', createdAt: 1 }), {
    actionLabel: '结束',
    statusLabel: '已执行',
    tone: 'ok',
    retryable: false,
  });
  const pending = describeDeviceLastCommand(
    { id: 'c2', action: 'pause', status: 'pending', createdAt: 1, expiresAt: 9_999 },
    10,
  );
  assert.equal(pending.statusLabel, '待设备认领（离线期间会一直保留）');
  const expired = describeDeviceLastCommand(
    { id: 'c3', action: 'pause', status: 'pending', createdAt: 1, expiresAt: 5 },
    10,
  );
  assert.equal(expired.statusLabel, '已过期未执行（可重发）');
  assert.equal(expired.retryable, true);
  const failed = describeDeviceLastCommand({
    id: 'c4',
    action: 'end',
    status: 'failed',
    createdAt: 1,
    failureReason: '本机没有临时考试',
  });
  assert.equal(failed.statusLabel, '执行失败：本机没有临时考试');
});

test('设备状态词汇：能区分"本机临时考试"与"中心考试"以及是否暂停', () => {
  assert.equal(isDeviceTemporaryExam('temporary-running'), true);
  assert.equal(isDeviceTemporaryExam('temporary-paused'), true);
  assert.equal(isDeviceTemporaryExam('exam-running'), false, '中心考试不再靠名字去认');
  assert.equal(isDeviceExamPaused('temporary-paused'), true);
  assert.equal(isDeviceExamPaused('exam-paused'), true);
  assert.equal(isDeviceExamPaused('exam-running'), false);
  assert.equal(isDeviceInExam('exam-paused'), true);
  assert.equal(isDeviceInExam('exam-running'), true);
  assert.equal(isDeviceInExam('waiting'), false);
  assert.equal(isDeviceInExam('idle'), false);
});

test('解析设备列表里的最近指令：非法数据不会串到 UI 上', () => {
  assert.equal(parseDeviceLastCommand(null), null);
  assert.equal(parseDeviceLastCommand({ id: 'c1', action: 'unknown-action', createdAt: 1 }), null);
  assert.equal(parseDeviceLastCommand({ id: '', action: 'pause', createdAt: 1 }), null);
  assert.deepEqual(parseDeviceLastCommand({ id: 'c1', action: 'extend', status: 'claimed', createdAt: 7 }), {
    id: 'c1',
    action: 'extend',
    status: 'claimed',
    createdAt: 7,
  });
});

test('device command state machine rejects duplicate terminal transitions', () => {
  assert.equal(transitionDeviceCommand({ ...base, status: 'acknowledged' }, 'acknowledged', 200), null);
  assert.equal(transitionDeviceCommand({ ...base, status: 'failed' }, 'claimed', 200), null);
  assert.equal(transitionDeviceCommand(base, 'acknowledged', 200)?.status, 'acknowledged');
  assert.equal(transitionDeviceCommand(base, 'expired', 200)?.status, 'expired');
});

test('expired commands are identified at the boundary', () => {
  assert.equal(isDeviceCommandExpired(base, 999), false);
  assert.equal(isDeviceCommandExpired(base, 1_000), true);
  assert.equal(isDeviceCommandExpired({ expiresAt: undefined }, 10), false);
});

test('failed commands retain a bounded reason', () => {
  const failed = transitionDeviceCommand(base, 'failed', 200, 'network timeout');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.failureReason, 'network timeout');
  assert.ok((transitionDeviceCommand(base, 'failed', 200, 'x'.repeat(600))?.failureReason?.length ?? 0) <= 500);
});
