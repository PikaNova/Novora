import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExamItem } from '../src/types/index.js';
import {
  DEVICE_HEARTBEAT_ACTIVE_INTERVAL_MS,
  DEVICE_HEARTBEAT_IDLE_INTERVAL_MS,
  DEVICE_HEARTBEAT_REFRESH_MS,
  DEVICE_ONLINE_WINDOW_MS,
  deviceHeartbeatIntervalMs,
} from '../src/shared/deviceContracts.js';
import { jitteredIntervalMs } from '../src/shared/polling.js';
import { examSyncIntervalMs } from '../src/utils/examPolling.js';
import { examEtag } from '../src/shared/examContracts.js';

function exam(startTime: string, endTime: string, enabled = true): ExamItem {
  return { id: '1', name: '语文', startTime, endTime, enabled, order: 1 };
}

test('jittered polling stays within a bounded positive window', () => {
  assert.equal(
    jitteredIntervalMs(60_000, () => 0),
    60_000,
  );
  assert.ok(jitteredIntervalMs(60_000, () => 0.999) <= 69_000);
  assert.ok(jitteredIntervalMs(60_000, () => 0.999) > 60_000);
  assert.equal(
    jitteredIntervalMs(0, () => 0.999),
    0,
  );
});

test('exam sync uses the active interval only for running or nearby exams', () => {
  const now = new Date('2026-09-05T08:00:00+08:00').getTime();
  const running = examSyncIntervalMs([exam('2026-09-05T07:30:00', '2026-09-05T09:30:00')], now);
  const nearby = examSyncIntervalMs([exam('2026-09-05T08:20:00', '2026-09-05T09:30:00')], now);
  const idle = examSyncIntervalMs([exam('2026-09-05T09:31:00', '2026-09-05T10:30:00')], now);
  const disabled = examSyncIntervalMs([exam('2026-09-05T08:10:00', '2026-09-05T09:30:00', false)], now);
  assert.equal(running, 30_000);
  assert.equal(nearby, 30_000);
  assert.equal(idle, 60_000);
  assert.equal(disabled, 60_000);
});

test('device heartbeats are slower while idle and keep the shared online window', () => {
  assert.equal(deviceHeartbeatIntervalMs({}), DEVICE_HEARTBEAT_IDLE_INTERVAL_MS);
  assert.equal(deviceHeartbeatIntervalMs({ temporaryActive: true }), DEVICE_HEARTBEAT_ACTIVE_INTERVAL_MS);
  assert.equal(deviceHeartbeatIntervalMs({ hasCurrentExam: true }), DEVICE_HEARTBEAT_ACTIVE_INTERVAL_MS);
  assert.equal(deviceHeartbeatIntervalMs({ hasNextExam: true }), DEVICE_HEARTBEAT_ACTIVE_INTERVAL_MS);
  assert.equal(DEVICE_ONLINE_WINDOW_MS, 180_000);
});

test('heartbeat write skipping never pushes an online device past the online window', () => {
  // 心跳可以跳过“内容没变”的重复写入，但 last_seen_at 的刷新间隔必须留在线窗口之内，
  // 否则设备还活着却会被仪表盘判成离线。
  assert.ok(DEVICE_HEARTBEAT_REFRESH_MS > 0);
  assert.ok(
    DEVICE_HEARTBEAT_REFRESH_MS * 2 < DEVICE_ONLINE_WINDOW_MS,
    'refresh interval must leave room for a missed heartbeat inside the online window',
  );
});

test('exam ETag is derived only from the snapshot version', () => {
  assert.equal(examEtag(123), '"exam-123"');
  assert.equal(examEtag('123'), '"exam-123"');
  assert.equal(examEtag(undefined), '"exam-0"');
  assert.equal(examEtag(Number.NaN), '"exam-0"');
});
