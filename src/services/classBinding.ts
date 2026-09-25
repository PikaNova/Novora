import { getInstanceId } from './telemetry';
import { fetchWithTimeout } from './fetchWithTimeout';
import { runQueued } from './syncQueue';
import { authHeaders } from './auth/session';
import {
  parseDeviceBinding,
  parseDeviceBindingInfo,
  parseDeviceCommand,
  parseDeviceSetupConflict,
  parsePluginBindingInfo,
  type DeviceBinding,
  type DeviceBindingInfo,
  type DeviceCommand,
  type DeviceHeartbeatInput,
  type DeviceSetupConflict,
  type PluginBindingInfo,
} from '../shared/deviceContracts';
import { parseExamVersion } from '../shared/examContracts';

const API_URL = '/api/exams';
const CLASS_CHOICE_KEY = 'exam_board_class_choice_confirmed';
const BINDING_CACHE_KEY = 'exam_board_device_binding_cache';
const DEVICE_PURPOSE_KEY = 'exam_board_device_purpose_confirmed';
const PENDING_MANAGEMENT_SETUP_KEY = 'novora_pending_management_setup';
let heartbeatInFlight = false;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function errorMessage(value: unknown, fallback: string): string {
  const message = asRecord(value).error;
  return typeof message === 'string' && message ? message : fallback;
}

export type { DeviceBinding, DeviceBindingInfo, DeviceCommand, DeviceSetupConflict, PluginBindingInfo };

async function sendWithRateLimitRetry(send: () => Promise<Response>): Promise<{ response: Response; data: unknown }> {
  let response = await send();
  let data = await response.json().catch(() => null);
  if (response.status === 429 && asRecord(data).code === 'RATE_LIMITED') {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    response = await send();
    data = await response.json().catch(() => null);
  }
  return { response, data };
}

export type DeviceBindingSaveResult =
  { ok: true; replaced: boolean } | { ok: false; conflict?: DeviceSetupConflict; error: string };
export type DeviceRoleUpdateResult =
  | { ok: true; binding: DeviceBinding; replaced: boolean }
  | { ok: false; conflict?: DeviceSetupConflict; error: string };

export function markPendingManagementSetup(): void {
  try {
    sessionStorage.setItem(PENDING_MANAGEMENT_SETUP_KEY, 'true');
  } catch {
    /* ignore */
  }
}

export function clearPendingManagementSetup(): void {
  try {
    sessionStorage.removeItem(PENDING_MANAGEMENT_SETUP_KEY);
  } catch {
    /* ignore */
  }
}

export function hasPendingManagementSetup(): boolean {
  try {
    return sessionStorage.getItem(PENDING_MANAGEMENT_SETUP_KEY) === 'true';
  } catch {
    return false;
  }
}

export async function fetchOccupiedClassIds(): Promise<string[]> {
  const response = await fetchWithTimeout(
    `${API_URL}?action=device-binding-options&instanceId=${encodeURIComponent(getInstanceId())}`,
    { cache: 'no-store' },
    12_000,
  );
  const data = await response.json().catch(() => null);
  const source = asRecord(data);
  if (!response.ok) throw new Error(errorMessage(source, '班级绑定状态加载失败'));
  return Array.isArray(source.occupiedClassIds)
    ? source.occupiedClassIds.filter((value: unknown): value is string => typeof value === 'string')
    : [];
}
export async function setupManagedDevice(input: {
  bindManagement: boolean;
  gradeId?: string;
  classId?: string;
  replaceExisting?: boolean;
}): Promise<{ conflict?: DeviceSetupConflict }> {
  const { response, data } = await sendWithRateLimitRetry(() =>
    runQueued(
      () =>
        fetchWithTimeout(
          API_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ action: 'managed-device-setup', instanceId: getInstanceId(), ...input }),
          },
          20_000,
        ),
      { priority: 'high' },
    ),
  );
  const source = asRecord(data);
  if (response.status === 409 && source.code === 'CLASS_DEVICE_EXISTS')
    return { conflict: parseDeviceSetupConflict(source.existing) ?? undefined };
  if (!response.ok) throw new Error(errorMessage(source, '设备登记失败'));
  if (input.bindManagement) {
    cacheDeviceBinding({ gradeId: '', classId: '', revoked: false, isManagement: true });
    clearPendingManagementSetup();
    markDevicePurposeConfirmed();
    clearClassChoiceConfirmation();
  } else if (input.gradeId && input.classId) {
    cacheDeviceBinding({ gradeId: input.gradeId, classId: input.classId, revoked: false, isManagement: false });
    clearPendingManagementSetup();
    markClassChoiceConfirmed();
    markDevicePurposeConfirmed();
  }
  return {};
}

export async function updateDeviceRole(input: {
  instanceId: string;
  targetRole: 'management' | 'class-terminal';
  gradeId?: string;
  classId?: string;
  replaceExisting?: boolean;
}): Promise<DeviceRoleUpdateResult> {
  try {
    const { response, data } = await sendWithRateLimitRetry(() =>
      runQueued(
        () =>
          fetchWithTimeout(
            API_URL,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body: JSON.stringify({ action: 'device-role-update', ...input }),
            },
            20_000,
          ),
        { priority: 'high' },
      ),
    );
    const source = asRecord(data);
    const conflict =
      response.status === 409 && source.code === 'CLASS_DEVICE_EXISTS'
        ? parseDeviceSetupConflict(source.existing)
        : null;
    if (conflict)
      return {
        ok: false,
        conflict,
        error: errorMessage(source, '该班级已有考试端'),
      };
    if (!response.ok) return { ok: false, error: errorMessage(source, '设备角色转换失败') };
    const binding = parseDeviceBinding(source.binding);
    if (!binding) return { ok: false, error: '服务器返回了无效的设备绑定' };
    if (input.instanceId === getInstanceId()) {
      cacheDeviceBinding(binding);
      clearPendingManagementSetup();
      markDevicePurposeConfirmed();
      if (binding.isManagement) clearClassChoiceConfirmation();
      else markClassChoiceConfirmed();
    }
    return { ok: true, binding, replaced: source.replaced === true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '设备角色转换失败，请检查网络后重试' };
  }
}

export function hasConfirmedClassChoice(): boolean {
  try {
    return localStorage.getItem(CLASS_CHOICE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markClassChoiceConfirmed(): void {
  try {
    localStorage.setItem(CLASS_CHOICE_KEY, 'true');
  } catch {
    /* ignore */
  }
}

export function clearClassChoiceConfirmation(): void {
  try {
    localStorage.removeItem(CLASS_CHOICE_KEY);
  } catch {
    /* ignore */
  }
}

export function hasConfirmedDevicePurpose(): boolean {
  try {
    return localStorage.getItem(DEVICE_PURPOSE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markDevicePurposeConfirmed(): void {
  try {
    localStorage.setItem(DEVICE_PURPOSE_KEY, 'true');
  } catch {
    /* ignore */
  }
}

export function clearDevicePurposeConfirmation(): void {
  try {
    localStorage.removeItem(DEVICE_PURPOSE_KEY);
  } catch {
    /* ignore */
  }
}

export function getClassBindingInstanceId(): string {
  return getInstanceId();
}

export function getCachedDeviceBinding(): DeviceBinding | null | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(BINDING_CACHE_KEY) || 'null');
    if (!cached || cached.instanceId !== getInstanceId()) return undefined;
    return cached.binding === null ? null : (cached.binding as DeviceBinding);
  } catch {
    return undefined;
  }
}

export function cacheDeviceBinding(binding: DeviceBinding | null): void {
  try {
    localStorage.setItem(
      BINDING_CACHE_KEY,
      JSON.stringify({ instanceId: getInstanceId(), binding, checkedAt: Date.now() }),
    );
  } catch {
    /* ignore */
  }
  if (binding?.revoked) {
    clearClassChoiceConfirmation();
    clearDevicePurposeConfirmation();
  }
}

export async function saveDeviceBinding(
  gradeId: string,
  classId: string,
  replaceExisting = false,
): Promise<DeviceBindingSaveResult> {
  try {
    const { response, data } = await sendWithRateLimitRetry(() =>
      runQueued(
        () =>
          fetchWithTimeout(
            API_URL,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'device-binding',
                instanceId: getInstanceId(),
                gradeId,
                classId,
                replaceExisting,
              }),
            },
            20_000,
          ),
        { priority: 'high' },
      ),
    );
    const source = asRecord(data);
    const conflict =
      response.status === 409 && source.code === 'CLASS_DEVICE_EXISTS'
        ? parseDeviceSetupConflict(source.existing)
        : null;
    if (conflict)
      return {
        ok: false,
        conflict,
        error: errorMessage(source, '该班级已绑定其他考试端'),
      };
    if (!response.ok) return { ok: false, error: errorMessage(source, '班级绑定失败') };
    cacheDeviceBinding({ gradeId, classId, revoked: false, isManagement: false });
    clearPendingManagementSetup();
    markClassChoiceConfirmed();
    markDevicePurposeConfirmed();
    return { ok: true, replaced: replaceExisting };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '班级绑定失败，请检查网络后重试' };
  }
}

export async function fetchDeviceBindings(): Promise<{
  bindings: DeviceBindingInfo[];
  plugins: PluginBindingInfo[];
  truncated: boolean;
}> {
  const response = await fetchWithTimeout(
    `${API_URL}?action=device-bindings&currentInstanceId=${encodeURIComponent(getInstanceId())}`,
    { cache: 'no-store', headers: authHeaders() },
    15_000,
  );
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? '登录状态已失效，请重新进入管理后台'
        : response.status === 403
          ? '当前账号无权查看设备'
          : '设备管理加载失败',
    );
  const data = asRecord(await response.json().catch(() => null));
  return {
    bindings: (Array.isArray(data.bindings) ? data.bindings : [])
      .map(parseDeviceBindingInfo)
      .filter((item): item is DeviceBindingInfo => item !== null),
    plugins: (Array.isArray(data.plugins) ? data.plugins : [])
      .map(parsePluginBindingInfo)
      .filter((item): item is PluginBindingInfo => item !== null),
    truncated: data.truncated === true,
  };
}

export async function revokeDevice(instanceId: string, pluginInstanceIds: string[] = []): Promise<void> {
  const { response, data } = await sendWithRateLimitRetry(() =>
    runQueued(
      () =>
        fetchWithTimeout(
          API_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ action: 'device-revoke', instanceId, pluginInstanceIds }),
          },
          20_000,
        ),
      { priority: 'high' },
    ),
  );
  const source = asRecord(data);
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? '登录状态已失效'
        : response.status === 403
          ? '当前账号无权删除此设备'
          : errorMessage(source, '删除设备失败'),
    );
}

export async function sendDeviceCommand(
  instanceId: string,
  commandAction: DeviceCommand['action'],
  minutes?: number,
): Promise<void> {
  const { response, data } = await sendWithRateLimitRetry(() =>
    runQueued(
      () =>
        fetchWithTimeout(
          API_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ action: 'device-command', instanceId, commandAction, minutes }),
          },
          20_000,
        ),
      { priority: 'high' },
    ),
  );
  const source = asRecord(data);
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? '登录状态已失效'
        : response.status === 403
          ? '当前账号无权管理此设备'
          : errorMessage(source, '临时考试指令发送失败'),
    );
}

export async function sendDeviceHeartbeat(input: DeviceHeartbeatInput): Promise<{
  revoked: boolean;
  binding: DeviceBinding | null;
  command: DeviceCommand | null;
  /** 服务端当前快照版本号；只有启用了该优化的部署（Vercel）才会返回。 */
  version?: number;
}> {
  if (heartbeatInFlight) return { revoked: false, binding: null, command: null };
  heartbeatInFlight = true;
  try {
    const response = await fetchWithTimeout(
      API_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'device-heartbeat', instanceId: getInstanceId(), ...input }),
      },
      8_000,
    );
    if (!response.ok) return { revoked: false, binding: null, command: null };
    const data = asRecord(await response.json().catch(() => null));
    if (data.revoked === true) {
      if (hasPendingManagementSetup()) return { revoked: true, binding: null, command: null };
      cacheDeviceBinding({ gradeId: '', classId: '', revoked: true, isManagement: false });
      window.dispatchEvent(new CustomEvent('exam-board:device-revoked'));
      return {
        revoked: true,
        binding: { gradeId: '', classId: '', revoked: true, isManagement: false },
        command: null,
      };
    }
    const binding = data.binding == null ? null : parseDeviceBinding(data.binding);
    if (binding) {
      const previous = getCachedDeviceBinding();
      const changed =
        !previous ||
        previous.revoked ||
        previous.gradeId !== binding.gradeId ||
        previous.classId !== binding.classId ||
        previous.isManagement !== binding.isManagement;
      if (changed) {
        cacheDeviceBinding(binding);
        markDevicePurposeConfirmed();
        if (binding.isManagement) clearClassChoiceConfirmation();
        else if (binding.classId) markClassChoiceConfirmed();
        window.dispatchEvent(new CustomEvent('exam-board:binding-updated', { detail: binding }));
      }
    }
    const command = parseDeviceCommand(data.command);
    const version = parseExamVersion(data.version);
    return { revoked: false, binding, command, ...(version > 0 ? { version } : {}) };
  } catch {
    return { revoked: false, binding: null, command: null };
  } finally {
    heartbeatInFlight = false;
  }
}
