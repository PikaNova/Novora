import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDeviceBinding,
  parseDeviceCommand,
  parseDeviceSetupConflict,
  parsePluginBindingInfo,
} from '../src/shared/deviceContracts.js';
import { parseExamPayload } from '../src/shared/examContracts.js';

test('device command contract: accepts a valid command and rejects malformed payloads', () => {
  const command = parseDeviceCommand({
    id: 'cmd-1',
    action: 'extend',
    minutes: 5,
    createdAt: 1000,
  });
  assert.deepEqual(command, { id: 'cmd-1', action: 'extend', minutes: 5, createdAt: 1000 });
  assert.equal(parseDeviceCommand(null), null);
  assert.equal(parseDeviceCommand({ id: '', action: 'pause', createdAt: 1000 }), null);
  assert.equal(parseDeviceCommand({ id: 'cmd-1', action: 'shutdown', createdAt: 1000 }), null);
  assert.equal(parseDeviceCommand({ id: 'cmd-1', action: 'pause', createdAt: 'not-a-number' }), null);
});

test('device binding contract: validates binding, conflict, and plugin rows', () => {
  assert.deepEqual(parseDeviceBinding({ gradeId: 'g1', classId: 'c1', revoked: false, isManagement: true }), {
    gradeId: 'g1',
    classId: 'c1',
    revoked: false,
    isManagement: true,
  });
  assert.equal(parseDeviceBinding({ gradeId: 1, classId: 'c1', revoked: false }), null);
  assert.deepEqual(parseDeviceSetupConflict({ instanceId: 'device-1', status: 'idle', lastSeenAt: 10, online: true }), {
    instanceId: 'device-1',
    status: 'idle',
    lastSeenAt: 10,
    online: true,
  });
  assert.equal(parseDeviceSetupConflict({ instanceId: 'device-1' }), null);
  assert.deepEqual(
    parsePluginBindingInfo({
      pluginInstanceId: 'plugin-1',
      viewerInstanceId: 'device-1',
      gradeId: 'g1',
      classId: 'c1',
      paired: true,
      viewerLastSeenAt: 20,
      updatedAt: 30,
    }),
    {
      pluginInstanceId: 'plugin-1',
      viewerInstanceId: 'device-1',
      gradeId: 'g1',
      classId: 'c1',
      paired: true,
      pluginLastSeenAt: 30,
      viewerLastSeenAt: 20,
    },
  );
  assert.equal(parsePluginBindingInfo({ viewerInstanceId: 'device-1' }), null);
});

test('exam payload contract: drops malformed records and normalizes valid domains', () => {
  const payload = parseExamPayload({
    ok: true,
    items: [
      { id: 'invalid', name: 'No time' },
      { id: 'item-2', name: '数学', startTime: '2026-08-30T09:00', endTime: '2026-08-30T10:00' },
    ],
    majors: [
      { name: 'Missing id' },
      {
        id: 'major-1',
        name: '期中',
        items: [{ id: 'item-2', name: '数学', startTime: '2026-08-30T09:00', endTime: '2026-08-30T10:00' }],
      },
    ],
    activeMajorId: 'major-1',
    title: '期中',
    alerts: { enabled: false },
    scheduleMode: 'weekly-only',
    grades: [{ id: 'g1', name: '高一' }],
    classes: [
      { id: 'bad-class', gradeId: 'missing-grade', name: '坏班级' },
      { id: 'c1', gradeId: 'g1', name: '1班' },
    ],
    updatedAt: '200',
  });

  assert.deepEqual(
    payload.items.map((item) => item.id),
    ['item-2'],
  );
  assert.deepEqual(
    payload.majors.map((major) => major.id),
    ['major-1'],
  );
  assert.equal(payload.alerts?.enabled, false);
  assert.equal(payload.scheduleMode, 'weekly-only');
  assert.deepEqual(
    (payload.grades ?? []).map((grade) => grade.name),
    ['高一'],
  );
  assert.deepEqual(
    (payload.classes ?? []).map((schoolClass) => schoolClass.id),
    ['c1'],
  );
  assert.equal(payload.updatedAt, 200);
});

test('exam payload contract: 修订号只跟随服务端字段出现，"没有该字段"与"全为 0"必须可区分', () => {
  // 老服务端不返回 revisions：解析结果不能凭空造出 {}，否则客户端会以为「各域都是 0」，
  // 从而不再退回整行版本比较（那是跨版本部署时的唯一保护）。
  assert.equal('revisions' in parseExamPayload({ items: [], updatedAt: 0 }), false);
  assert.deepEqual(parseExamPayload({ revisions: { major: 2, weekly: '3' }, updatedAt: 0 }).revisions, {
    major: 2,
    weekly: 3,
  });
  assert.deepEqual(parseExamPayload({ revisions: {}, updatedAt: 0 }).revisions, {});
  assert.deepEqual(parseExamPayload({ revisions: 'nope', updatedAt: 0 }).revisions, {});
});
