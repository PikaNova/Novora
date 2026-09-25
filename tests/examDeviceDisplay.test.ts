import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExamDeviceSummary,
  deviceShowsOtherExam,
  filterExamDevices,
  isDeviceOnline,
} from '../src/utils/examDeviceDisplay.js';
import { DEVICE_ONLINE_WINDOW_MS, type DeviceBindingInfo } from '../src/shared/deviceContracts.js';
import type { SchoolClass } from '../src/types/school.js';

const NOW = 1_790_000_000_000;

function device(input: Partial<DeviceBindingInfo> & { instanceId: string }): DeviceBindingInfo {
  return {
    instanceId: input.instanceId,
    gradeId: input.gradeId ?? 'g1',
    classId: input.classId ?? 'c1',
    revoked: input.revoked ?? false,
    page: '',
    clientVersion: '',
    status: '',
    currentExam: input.currentExam ?? '',
    currentSubject: '',
    examStart: '',
    examEnd: '',
    lastSeenAt: input.lastSeenAt ?? NOW,
    updatedAt: input.updatedAt ?? NOW,
  };
}

function schoolClass(id: string, name: string, gradeId = 'g1'): SchoolClass {
  return { id, name, gradeId, order: 0, enabled: true };
}

test('设备在线判定窗口：180 秒内算在线', () => {
  assert.equal(isDeviceOnline(device({ instanceId: 'a', lastSeenAt: NOW - DEVICE_ONLINE_WINDOW_MS }), NOW), true);
  assert.equal(isDeviceOnline(device({ instanceId: 'b', lastSeenAt: NOW - DEVICE_ONLINE_WINDOW_MS - 1 }), NOW), false);
});

test('显示别的考试：只有非空且不等于本场才算异常', () => {
  assert.equal(deviceShowsOtherExam(device({ instanceId: 'a', currentExam: '上一场' }), '本场'), true);
  assert.equal(deviceShowsOtherExam(device({ instanceId: 'b', currentExam: '本场' }), '本场'), false);
  assert.equal(deviceShowsOtherExam(device({ instanceId: 'c', currentExam: '' }), '本场'), false);
});

test('汇总：先排序再截断——显示异常 → 在线 → 离线，组内按最近在线倒序', () => {
  const summary = buildExamDeviceSummary({
    devices: [
      device({ instanceId: 'offline-newest', lastSeenAt: NOW - 10 * 60_000, classId: 'c1' }),
      device({ instanceId: 'online-idle', lastSeenAt: NOW - 5_000, classId: 'c2' }),
      device({ instanceId: 'online-other-exam', lastSeenAt: NOW - 60_000, classId: 'c3', currentExam: '上一场' }),
      device({ instanceId: 'online-other-older', lastSeenAt: NOW - 120_000, classId: 'c4', currentExam: '上一场' }),
      device({ instanceId: 'revoked', revoked: true, classId: 'c5' }),
      device({ instanceId: 'out-of-scope', gradeId: 'g9', classId: 'c9' }),
    ],
    classes: [],
    targetGradeIds: ['g1'],
    targetClassIds: [],
    examName: '本场考试',
    now: NOW,
  });
  assert.deepEqual(
    summary.devices.map((item) => item.instanceId),
    ['online-other-exam', 'online-other-older', 'online-idle', 'offline-newest'],
    '异常在前、离线在最后；同组按 lastSeenAt 倒序',
  );
  assert.equal(summary.online, 3);
  assert.equal(summary.offline, 1);
  assert.equal(summary.showingOther, 2);
});

test('汇总：全校范围包含所有未撤销设备，班级范围按目标班级过滤', () => {
  const devices = [
    device({ instanceId: 'a', gradeId: 'g1', classId: 'c1' }),
    device({ instanceId: 'b', gradeId: 'g2', classId: 'c2' }),
  ];
  assert.equal(
    buildExamDeviceSummary({
      devices,
      classes: [],
      targetGradeIds: [],
      targetClassIds: [],
      examName: '全校考试',
      now: NOW,
    }).devices.length,
    2,
  );
  assert.deepEqual(
    buildExamDeviceSummary({
      devices,
      classes: [],
      targetGradeIds: [],
      targetClassIds: ['c2'],
      examName: '某班考试',
      now: NOW,
    }).devices.map((item) => item.instanceId),
    ['b'],
  );
});

test('汇总：未绑定设备的班级按名字列出，已绑定的不算', () => {
  const summary = buildExamDeviceSummary({
    devices: [device({ instanceId: 'a', classId: 'c1' })],
    classes: [schoolClass('c1', '1班'), schoolClass('c2', '2班'), schoolClass('c3', '3班')],
    targetGradeIds: ['g1'],
    targetClassIds: [],
    examName: '本场',
    now: NOW,
  });
  assert.equal(summary.unboundClasses, 2);
  assert.deepEqual(summary.unboundClassNames, ['2班', '3班']);
});

test('筛选：在线/离线/全部', () => {
  const devices = [
    device({ instanceId: 'online', lastSeenAt: NOW }),
    device({ instanceId: 'offline', lastSeenAt: NOW - 10 * 60_000 }),
  ];
  assert.deepEqual(
    filterExamDevices(devices, 'online', NOW).map((item) => item.instanceId),
    ['online'],
  );
  assert.deepEqual(
    filterExamDevices(devices, 'offline', NOW).map((item) => item.instanceId),
    ['offline'],
  );
  assert.equal(filterExamDevices(devices, 'all', NOW).length, 2);
});
