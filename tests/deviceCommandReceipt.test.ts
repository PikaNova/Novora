import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDeviceCommandReceipt } from '../src/utils/deviceCommandReceipt.js';
import type { DeviceCommand } from '../src/services/classBinding.js';

function command(input: { action: DeviceCommand['action']; id?: string; minutes?: number }): DeviceCommand {
  return {
    id: input.id ?? 'command-1',
    action: input.action,
    createdAt: Date.now(),
    ...(input.minutes === undefined ? {} : { minutes: input.minutes }),
  };
}

test('device command receipt: each command is consumed exactly once', () => {
  const first = resolveDeviceCommandReceipt(command({ action: 'pause' }), '');
  assert.equal(first?.command.id, 'command-1');
  assert.equal(first?.message, '后台已暂停本机临时考试。');
  assert.equal(resolveDeviceCommandReceipt(command({ action: 'pause' }), 'command-1'), null);
});

test('device command receipt: a newer command supersedes the acknowledged id', () => {
  assert.equal(
    resolveDeviceCommandReceipt(command({ action: 'extend', id: 'command-1', minutes: 5 }), 'command-1'),
    null,
  );
  const second = resolveDeviceCommandReceipt(command({ action: 'extend', id: 'command-2', minutes: 5 }), 'command-1');
  assert.equal(second?.command.id, 'command-2');
  assert.equal(second?.message, '后台已延长 5 分钟本机临时考试。');
});

test('device command receipt: malformed commands are not acknowledged', () => {
  assert.equal(resolveDeviceCommandReceipt(null, ''), null);
  assert.equal(resolveDeviceCommandReceipt(command({ action: 'shutdown' as DeviceCommand['action'] }), ''), null);
  assert.equal(
    resolveDeviceCommandReceipt({ ...command({ action: 'pause' }), createdAt: Number.NaN } as DeviceCommand, ''),
    null,
  );
});
