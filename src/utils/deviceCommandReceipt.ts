import type { DeviceCommand } from '../shared/deviceContracts';

export type DeviceCommandReceipt = {
  command: DeviceCommand;
  tone: 'success' | 'warning';
  message: string;
};

const DEVICE_COMMAND_ACTIONS = new Set(['pause', 'resume', 'extend', 'end']);

export function resolveDeviceCommandReceipt(
  command: DeviceCommand | null | undefined,
  acknowledgedCommandId: string,
): DeviceCommandReceipt | null {
  if (
    !command ||
    command.id === acknowledgedCommandId ||
    !DEVICE_COMMAND_ACTIONS.has(command.action) ||
    typeof command.createdAt !== 'number' ||
    !Number.isFinite(command.createdAt)
  )
    return null;

  const actionLabel =
    command.action === 'pause'
      ? '暂停'
      : command.action === 'resume'
        ? '继续'
        : command.action === 'extend'
          ? `延长 ${command.minutes || 5} 分钟`
          : '结束';

  return {
    command,
    tone: command.action === 'end' ? 'warning' : 'success',
    message: `后台已${actionLabel}本机临时考试。`,
  };
}
