import { asFiniteNumber, asRecord } from './typeGuards.js';

export const DEVICE_ONLINE_WINDOW_MS = 180_000;
export const DEVICE_HEARTBEAT_ACTIVE_INTERVAL_MS = 30_000;
export const DEVICE_HEARTBEAT_IDLE_INTERVAL_MS = 60_000;
/**
 * 心跳刷新 last_seen_at 的最小间隔：内容未变时跳过重复写入（省掉一次 UPDATE 的
 * WAL 与死元组），同时保证在线窗口判定不会因为省写入而误判离线。
 * 必须小于 DEVICE_ONLINE_WINDOW_MS，否则在线设备会被误判。
 */
export const DEVICE_HEARTBEAT_REFRESH_MS = 60_000;

export type DeviceCommandAction = 'pause' | 'resume' | 'extend' | 'end';
export type DeviceCommandStatus = 'pending' | 'claimed' | 'acknowledged' | 'failed' | 'expired';

export interface DeviceBinding {
  gradeId: string;
  classId: string;
  revoked: boolean;
  isManagement?: boolean;
}

export function deviceHeartbeatIntervalMs(input: {
  temporaryActive?: boolean;
  hasCurrentExam?: boolean;
  hasNextExam?: boolean;
}): number {
  return input.temporaryActive || input.hasCurrentExam || input.hasNextExam
    ? DEVICE_HEARTBEAT_ACTIVE_INTERVAL_MS
    : DEVICE_HEARTBEAT_IDLE_INTERVAL_MS;
}

export interface DeviceCommand {
  id: string;
  action: DeviceCommandAction;
  minutes?: number;
  createdAt: number;
  status?: DeviceCommandStatus;
  idempotencyKey?: string;
  expiresAt?: number;
  claimedAt?: number;
  acknowledgedAt?: number;
  failureReason?: string;
}

export const DEVICE_COMMAND_STATUSES = new Set<DeviceCommandStatus>([
  'pending',
  'claimed',
  'acknowledged',
  'failed',
  'expired',
]);

export function isDeviceCommandStatus(value: unknown): value is DeviceCommandStatus {
  return typeof value === 'string' && DEVICE_COMMAND_STATUSES.has(value as DeviceCommandStatus);
}

const DEVICE_COMMAND_TRANSITIONS: Record<DeviceCommandStatus, readonly DeviceCommandStatus[]> = {
  pending: ['claimed', 'acknowledged', 'failed', 'expired'],
  claimed: ['acknowledged', 'failed', 'expired'],
  acknowledged: [],
  failed: [],
  expired: [],
};

export function canTransitionDeviceCommand(from: DeviceCommandStatus, to: DeviceCommandStatus): boolean {
  return DEVICE_COMMAND_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionDeviceCommand(
  command: DeviceCommand,
  to: DeviceCommandStatus,
  now = Date.now(),
  failureReason?: string,
): DeviceCommand | null {
  const from = command.status ?? 'pending';
  if (!canTransitionDeviceCommand(from, to)) return null;
  return {
    ...command,
    status: to,
    ...(to === 'claimed' ? { claimedAt: now } : {}),
    ...(to === 'acknowledged' ? { acknowledgedAt: now } : {}),
    ...(to === 'failed' ? { failureReason: failureReason?.slice(0, 500) || '设备执行失败' } : {}),
  };
}

export function isDeviceCommandExpired(command: Pick<DeviceCommand, 'expiresAt'>, now = Date.now()): boolean {
  return typeof command.expiresAt === 'number' && Number.isFinite(command.expiresAt) && command.expiresAt <= now;
}

/** 设备心跳请求体（不含 action/instanceId，由发送方附加）。 */
export type DeviceHeartbeatInput = {
  page?: string;
  clientVersion?: string;
  status?: string;
  currentExam?: string;
  currentSubject?: string;
  examStart?: string;
  examEnd?: string;
  acknowledgedCommandId?: string;
  failedCommandId?: string;
  commandFailureReason?: string;
};

/**
 * 设备上报的运行状态。以前"本机临时考试"和"中心考试"都挤在 `exam-running` 里，
 * 后台只能靠考试名里是否含「临时考试」来猜——现在按状态区分：
 * - `temporary-running` / `temporary-paused`：本机临时考试（只在这台设备上）
 * - `exam-running` / `exam-paused`：中心（大型/快速/统一临时）考试，暂停时是 paused
 * - `waiting`：下一场还没开始；`idle`：没有考试
 */
export type DeviceRuntimeStatus =
  'idle' | 'waiting' | 'exam-running' | 'exam-paused' | 'temporary-running' | 'temporary-paused';

const DEVICE_EXAM_ACTIVE_STATUSES = new Set(['exam-running', 'exam-paused', 'temporary-running', 'temporary-paused']);
const DEVICE_TEMPORARY_STATUSES = new Set(['temporary-running', 'temporary-paused']);

/** 这台设备当前是否正处在某场考试里（含暂停）。 */
export function isDeviceInExam(status: string | null | undefined): boolean {
  return DEVICE_EXAM_ACTIVE_STATUSES.has(String(status ?? ''));
}

/** 是不是「本机临时考试」（只影响这台设备的那种）。 */
export function isDeviceTemporaryExam(status: string | null | undefined): boolean {
  return DEVICE_TEMPORARY_STATUSES.has(String(status ?? ''));
}

/** 这台设备的考试是否处于暂停。 */
export function isDeviceExamPaused(status: string | null | undefined): boolean {
  return status === 'exam-paused' || status === 'temporary-paused';
}

export interface DeviceBindingInfo extends DeviceBinding {
  instanceId: string;
  managementRoleName?: string;
  managementScopeLabel?: string;
  page: string;
  clientVersion: string;
  status: string;
  currentExam: string;
  currentSubject: string;
  examStart: string;
  examEnd: string;
  lastSeenAt: number;
  updatedAt: number;
  /** 这台设备最近一条后台指令（含状态）：后台据此显示"待认领 / 已执行 / 已过期 / 失败"。 */
  lastCommand?: DeviceLastCommand;
}

export type DeviceLastCommand = {
  id: string;
  action: DeviceCommandAction;
  status: DeviceCommandStatus;
  createdAt: number;
  expiresAt?: number;
  failureReason?: string;
};

export function parseDeviceLastCommand(value: unknown): DeviceLastCommand | null {
  const source = asRecord(value);
  const id = text(source.id);
  const action = source.action;
  if (!id || typeof action !== 'string' || !isDeviceCommandAction(action)) return null;
  const status = isDeviceCommandStatus(source.status) ? source.status : 'pending';
  const createdAt = timestamp(source.createdAt);
  if (!createdAt) return null;
  const expiresAt = timestamp(source.expiresAt);
  const failureReason = text(source.failureReason);
  return {
    id,
    action: action as DeviceCommandAction,
    status,
    createdAt,
    ...(expiresAt ? { expiresAt } : {}),
    ...(failureReason ? { failureReason } : {}),
  };
}

export const DEVICE_COMMAND_ACTION_LABELS: Record<DeviceCommandAction, string> = {
  pause: '暂停',
  resume: '继续',
  extend: '延长 5 分钟',
  end: '结束',
};

/**
 * 设备列表里那条指令的人话说明。
 * 关键点：**过期/失败要说出来**——以前后台发完只留一句"已发送"，指令过期或被设备拒绝都没人知道。
 */
export function describeDeviceLastCommand(
  command: DeviceLastCommand,
  now = Date.now(),
): { actionLabel: string; statusLabel: string; tone: 'ok' | 'warn' | 'muted'; retryable: boolean } {
  const actionLabel = DEVICE_COMMAND_ACTION_LABELS[command.action] ?? command.action;
  if (command.status === 'acknowledged') {
    return { actionLabel, statusLabel: '已执行', tone: 'ok', retryable: false };
  }
  if (command.status === 'failed') {
    return {
      actionLabel,
      statusLabel: `执行失败：${command.failureReason || '设备未说明原因'}`,
      tone: 'warn',
      retryable: true,
    };
  }
  if (command.status === 'expired' || (command.expiresAt != null && command.expiresAt <= now)) {
    return { actionLabel, statusLabel: '已过期未执行（可重发）', tone: 'warn', retryable: true };
  }
  if (command.status === 'claimed') {
    return { actionLabel, statusLabel: '设备已认领，等待执行结果', tone: 'muted', retryable: false };
  }
  return { actionLabel, statusLabel: '待设备认领（离线期间会一直保留）', tone: 'muted', retryable: false };
}

export type DeviceCommandRow = {
  instance_id?: unknown;
  id?: unknown;
  action?: unknown;
  status?: unknown;
  created_at?: unknown;
  expires_at?: unknown;
  failure_reason?: unknown;
};

export interface PluginBindingInfo {
  pluginInstanceId: string;
  viewerInstanceId: string;
  gradeId: string;
  classId: string;
  paired: boolean;
  pluginLastSeenAt: number;
  viewerLastSeenAt: number;
}

export interface DeviceSetupConflict {
  instanceId: string;
  status: string;
  lastSeenAt: number;
  online: boolean;
}

export type DeviceInstanceRow = {
  instance_id?: unknown;
  grade_id?: unknown;
  class_id?: unknown;
  revoked?: unknown;
  is_management?: unknown;
  management_actor_id?: unknown;
  management_role_name?: unknown;
  management_scope_label?: unknown;
  page?: unknown;
  client_version?: unknown;
  status?: unknown;
  current_exam?: unknown;
  current_subject?: unknown;
  exam_start?: unknown;
  exam_end?: unknown;
  temporary_command?: unknown;
  last_seen_at?: unknown;
  updated_at?: unknown;
};

export type PluginInstanceRow = {
  plugin_instance_id?: unknown;
  grade_id?: unknown;
  class_id?: unknown;
  viewer_instance_id?: unknown;
  paired?: unknown;
  viewer_last_seen_at?: unknown;
  updated_at?: unknown;
};

const DEVICE_COMMAND_ACTIONS = new Set<DeviceCommandAction>(['pause', 'resume', 'extend', 'end']);

export function isDeviceCommandAction(value: unknown): value is DeviceCommandAction {
  return typeof value === 'string' && DEVICE_COMMAND_ACTIONS.has(value as DeviceCommandAction);
}

export function parseDeviceCommand(value: unknown): DeviceCommand | null {
  const source = asRecord(value);
  const id = typeof source.id === 'string' ? source.id : '';
  const createdAt = asFiniteNumber(source.createdAt);
  if (!id || !isDeviceCommandAction(source.action) || createdAt === undefined) return null;
  const minutes = asFiniteNumber(source.minutes);
  const expiresAt = asFiniteNumber(source.expiresAt);
  const claimedAt = asFiniteNumber(source.claimedAt);
  const acknowledgedAt = asFiniteNumber(source.acknowledgedAt);
  return {
    id,
    action: source.action,
    createdAt,
    ...(minutes === undefined ? {} : { minutes }),
    ...(isDeviceCommandStatus(source.status) ? { status: source.status } : {}),
    ...(typeof source.idempotencyKey === 'string' ? { idempotencyKey: source.idempotencyKey } : {}),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(claimedAt === undefined ? {} : { claimedAt }),
    ...(acknowledgedAt === undefined ? {} : { acknowledgedAt }),
    ...(typeof source.failureReason === 'string' ? { failureReason: source.failureReason } : {}),
  };
}

export function parseDeviceBinding(value: unknown): DeviceBinding | null {
  const source = asRecord(value);
  if (typeof source.gradeId !== 'string' || typeof source.classId !== 'string' || typeof source.revoked !== 'boolean')
    return null;
  return {
    gradeId: source.gradeId,
    classId: source.classId,
    revoked: source.revoked,
    isManagement: source.isManagement === true,
  };
}

export function parseDeviceSetupConflict(value: unknown): DeviceSetupConflict | null {
  const source = asRecord(value);
  const lastSeenAt = asFiniteNumber(source.lastSeenAt);
  if (
    typeof source.instanceId !== 'string' ||
    typeof source.status !== 'string' ||
    lastSeenAt === undefined ||
    typeof source.online !== 'boolean'
  )
    return null;
  return {
    instanceId: source.instanceId,
    status: source.status,
    lastSeenAt,
    online: source.online,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function timestamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseDeviceBindingInfo(value: unknown): DeviceBindingInfo | null {
  const source = asRecord(value);
  const binding = parseDeviceBinding(source);
  const instanceId = text(source.instanceId);
  if (!binding || !instanceId) return null;
  return {
    ...binding,
    instanceId,
    managementRoleName: text(source.managementRoleName) || undefined,
    managementScopeLabel: text(source.managementScopeLabel) || undefined,
    page: text(source.page),
    clientVersion: text(source.clientVersion),
    status: text(source.status),
    currentExam: text(source.currentExam),
    currentSubject: text(source.currentSubject),
    examStart: text(source.examStart),
    examEnd: text(source.examEnd),
    lastSeenAt: timestamp(source.lastSeenAt),
    updatedAt: timestamp(source.updatedAt),
    ...(parseDeviceLastCommand(source.lastCommand) ? { lastCommand: parseDeviceLastCommand(source.lastCommand)! } : {}),
  };
}

export function parsePluginBindingInfo(value: unknown): PluginBindingInfo | null {
  const source = asRecord(value);
  const pluginInstanceId = text(source.pluginInstanceId);
  if (!pluginInstanceId) return null;
  return {
    pluginInstanceId,
    viewerInstanceId: text(source.viewerInstanceId),
    gradeId: text(source.gradeId),
    classId: text(source.classId),
    paired: source.paired === true,
    pluginLastSeenAt: timestamp(source.updatedAt),
    viewerLastSeenAt: timestamp(source.viewerLastSeenAt),
  };
}
