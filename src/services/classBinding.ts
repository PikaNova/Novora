import { getInstanceId } from './telemetry';

const API_URL = '/api/exams';
const CLASS_CHOICE_KEY = 'exam_board_class_choice_confirmed';
const BINDING_CACHE_KEY = 'exam_board_device_binding_cache';
const DEVICE_PURPOSE_KEY = 'exam_board_device_purpose_confirmed';
const PENDING_MANAGEMENT_SETUP_KEY = 'novora_pending_management_setup';
const ADMIN_TOKEN_KEY = 'admin_auth_token';

export interface DeviceBinding {
  gradeId: string;
  classId: string;
  revoked: boolean;
  isManagement?: boolean;
}

export interface DeviceBindingInfo extends DeviceBinding {
  instanceId: string;
  isManagement?: boolean;
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
}

export type DeviceSetupConflict = { instanceId: string; status: string; lastSeenAt: number; online: boolean };
export type DeviceBindingSaveResult = { ok: true; replaced: boolean } | { ok: false; conflict?: DeviceSetupConflict; error: string };
export type DeviceRoleUpdateResult = { ok: true; binding: DeviceBinding; replaced: boolean } | { ok: false; conflict?: DeviceSetupConflict; error: string };

export function markPendingManagementSetup(): void {
  try { sessionStorage.setItem(PENDING_MANAGEMENT_SETUP_KEY, 'true'); } catch { /* ignore */ }
}

export function clearPendingManagementSetup(): void {
  try { sessionStorage.removeItem(PENDING_MANAGEMENT_SETUP_KEY); } catch { /* ignore */ }
}

export function hasPendingManagementSetup(): boolean {
  try { return sessionStorage.getItem(PENDING_MANAGEMENT_SETUP_KEY) === 'true'; } catch { return false; }
}

export async function fetchOccupiedClassIds(): Promise<string[]> {
  const response = await fetch(`${API_URL}?action=device-binding-options&instanceId=${encodeURIComponent(getInstanceId())}`, { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || '班级绑定状态加载失败');
  return Array.isArray(data?.occupiedClassIds) ? data.occupiedClassIds.filter((value: unknown): value is string => typeof value === 'string') : [];
}
export async function setupManagedDevice(input: { bindManagement: boolean; gradeId?: string; classId?: string; replaceExisting?: boolean }): Promise<{ conflict?: DeviceSetupConflict }> {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ action: 'managed-device-setup', instanceId: getInstanceId(), ...input }) });
  const data = await response.json().catch(() => null);
  if (response.status === 409 && data?.code === 'CLASS_DEVICE_EXISTS') return { conflict: data.existing as DeviceSetupConflict };
  if (!response.ok) throw new Error(data?.error || '设备登记失败');
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

export async function updateDeviceRole(input: { instanceId: string; targetRole: 'management' | 'class-terminal'; gradeId?: string; classId?: string; replaceExisting?: boolean }): Promise<DeviceRoleUpdateResult> {
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ action: 'device-role-update', ...input }) });
    const data = await response.json().catch(() => null);
    if (response.status === 409 && data?.code === 'CLASS_DEVICE_EXISTS') return { ok: false, conflict: data.existing as DeviceSetupConflict, error: data.error || '该班级已有考试端' };
    if (!response.ok) return { ok: false, error: data?.error || '设备角色转换失败' };
    const binding: DeviceBinding = { gradeId: data?.binding?.gradeId ?? '', classId: data?.binding?.classId ?? '', revoked: false, isManagement: data?.binding?.isManagement === true };
    if (input.instanceId === getInstanceId()) {
      cacheDeviceBinding(binding);
      clearPendingManagementSetup();
      markDevicePurposeConfirmed();
      if (binding.isManagement) clearClassChoiceConfirmation();
      else markClassChoiceConfirmed();
    }
    return { ok: true, binding, replaced: data?.replaced === true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '设备角色转换失败，请检查网络后重试' }; }
}

export interface PluginBindingInfo {
  pluginInstanceId: string;
  viewerInstanceId: string;
  gradeId: string;
  classId: string;
  paired: boolean;
  pluginLastSeenAt: number;
  viewerLastSeenAt: number;
}

export interface DeviceCommand { id: string; action: 'pause' | 'resume' | 'extend' | 'end'; minutes?: number; createdAt: number }

export function hasConfirmedClassChoice(): boolean {
  try { return localStorage.getItem(CLASS_CHOICE_KEY) === 'true'; } catch { return false; }
}

export function markClassChoiceConfirmed(): void {
  try { localStorage.setItem(CLASS_CHOICE_KEY, 'true'); } catch { /* ignore */ }
}

export function clearClassChoiceConfirmation(): void {
  try { localStorage.removeItem(CLASS_CHOICE_KEY); } catch { /* ignore */ }
}

export function hasConfirmedDevicePurpose(): boolean {
  try { return localStorage.getItem(DEVICE_PURPOSE_KEY) === 'true'; } catch { return false; }
}

export function markDevicePurposeConfirmed(): void {
  try { localStorage.setItem(DEVICE_PURPOSE_KEY, 'true'); } catch { /* ignore */ }
}

export function clearDevicePurposeConfirmation(): void {
  try { localStorage.removeItem(DEVICE_PURPOSE_KEY); } catch { /* ignore */ }
}

export function getClassBindingInstanceId(): string { return getInstanceId(); }

export function getCachedDeviceBinding(): DeviceBinding | null | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(BINDING_CACHE_KEY) || 'null');
    if (!cached || cached.instanceId !== getInstanceId()) return undefined;
    return cached.binding === null ? null : cached.binding as DeviceBinding;
  } catch { return undefined; }
}

export function cacheDeviceBinding(binding: DeviceBinding | null): void {
  try { localStorage.setItem(BINDING_CACHE_KEY, JSON.stringify({ instanceId: getInstanceId(), binding, checkedAt: Date.now() })); } catch { /* ignore */ }
  if (binding?.revoked) {
    clearClassChoiceConfirmation();
    clearDevicePurposeConfirmation();
  }
}

export async function saveDeviceBinding(gradeId: string, classId: string, replaceExisting = false): Promise<DeviceBindingSaveResult> {
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'device-binding', instanceId: getInstanceId(), gradeId, classId, replaceExisting }) });
    const data = await response.json().catch(() => null);
    if (response.status === 409 && data?.code === 'CLASS_DEVICE_EXISTS') return { ok: false, conflict: data.existing as DeviceSetupConflict, error: data.error || '该班级已绑定其他考试端' };
    if (!response.ok) return { ok: false, error: data?.error || '班级绑定失败' };
    cacheDeviceBinding({ gradeId, classId, revoked: false, isManagement: false });
    clearPendingManagementSetup();
    markClassChoiceConfirmed();
    markDevicePurposeConfirmed();
    return { ok: true, replaced: replaceExisting };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '班级绑定失败，请检查网络后重试' }; }
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchDeviceBindings(): Promise<{ bindings: DeviceBindingInfo[]; plugins: PluginBindingInfo[]; truncated: boolean }> {
  const response = await fetch(`${API_URL}?action=device-bindings&currentInstanceId=${encodeURIComponent(getInstanceId())}`, { cache: 'no-store', headers: authHeaders() });
  if (!response.ok) throw new Error(response.status === 401 ? '登录状态已失效，请重新进入管理后台' : response.status === 403 ? '当前账号无权查看设备' : '设备管理加载失败');
  const data = await response.json();
  return { bindings: Array.isArray(data.bindings) ? data.bindings : [], plugins: Array.isArray(data.plugins) ? data.plugins : [], truncated: data.truncated === true };
}

export async function revokeDevice(instanceId: string, pluginInstanceIds: string[] = []): Promise<void> {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ action: 'device-revoke', instanceId, pluginInstanceIds }) });
  if (!response.ok) throw new Error(response.status === 401 ? '登录状态已失效' : response.status === 403 ? '当前账号无权删除此设备' : '删除设备失败');
}

export async function sendDeviceCommand(instanceId: string, commandAction: DeviceCommand['action'], minutes?: number): Promise<void> {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ action: 'device-command', instanceId, commandAction, minutes }) });
  if (!response.ok) throw new Error(response.status === 401 ? '登录状态已失效' : response.status === 403 ? '当前账号无权管理此设备' : '临时考试指令发送失败');
}

export async function sendDeviceHeartbeat(input: Omit<DeviceBindingInfo, 'instanceId' | 'gradeId' | 'classId' | 'revoked' | 'lastSeenAt' | 'updatedAt'> & { acknowledgedCommandId?: string }): Promise<{ revoked: boolean; binding: DeviceBinding | null; command: DeviceCommand | null }> {
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'device-heartbeat', instanceId: getInstanceId(), ...input }) });
    if (!response.ok) return { revoked: false, binding: null, command: null };
    const data = await response.json();
    if (data.revoked === true) {
      if (hasPendingManagementSetup()) return { revoked: true, binding: null, command: null };
      cacheDeviceBinding({ gradeId: '', classId: '', revoked: true, isManagement: false });
      window.dispatchEvent(new CustomEvent('exam-board:device-revoked'));
      return { revoked: true, binding: { gradeId: '', classId: '', revoked: true, isManagement: false }, command: null };
    }
    const binding = data.binding ? { gradeId: String(data.binding.gradeId ?? ''), classId: String(data.binding.classId ?? ''), revoked: false, isManagement: data.binding.isManagement === true } satisfies DeviceBinding : null;
    if (binding) {
      const previous = getCachedDeviceBinding();
      const changed = !previous || previous.revoked || previous.gradeId !== binding.gradeId || previous.classId !== binding.classId || previous.isManagement !== binding.isManagement;
      if (changed) {
        cacheDeviceBinding(binding);
        markDevicePurposeConfirmed();
        if (binding.isManagement) clearClassChoiceConfirmation();
        else if (binding.classId) markClassChoiceConfirmed();
        window.dispatchEvent(new CustomEvent('exam-board:binding-updated', { detail: binding }));
      }
    }
    const command = data.command && typeof data.command.id === 'string' ? data.command as DeviceCommand : null;
    return { revoked: false, binding, command };
  } catch { return { revoked: false, binding: null, command: null }; }
}
