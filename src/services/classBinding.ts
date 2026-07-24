import { getInstanceId } from './telemetry';

const API_URL = '/api/exams';
const CLASS_CHOICE_KEY = 'exam_board_class_choice_confirmed';
const BINDING_CACHE_KEY = 'exam_board_device_binding_cache';
const ADMIN_TOKEN_KEY = 'admin_auth_token';

export interface DeviceBinding {
  gradeId: string;
  classId: string;
  revoked: boolean;
}

export interface DeviceBindingInfo extends DeviceBinding {
  instanceId: string;
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
  if (binding?.revoked) clearClassChoiceConfirmation();
}

export async function saveDeviceBinding(gradeId: string, classId: string): Promise<boolean> {
  const binding = { gradeId, classId, revoked: false };
  markClassChoiceConfirmed();
  cacheDeviceBinding(binding);
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'device-binding', instanceId: getInstanceId(), gradeId, classId }) });
    return response.ok;
  } catch { return false; }
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchDeviceBindings(): Promise<{ bindings: DeviceBindingInfo[]; truncated: boolean }> {
  const response = await fetch(`${API_URL}?action=device-bindings`, { cache: 'no-store', headers: authHeaders() });
  if (!response.ok) throw new Error(response.status === 401 ? '登录状态已失效，请重新进入管理后台' : response.status === 403 ? '当前账号无权查看设备' : '设备管理加载失败');
  const data = await response.json();
  return { bindings: Array.isArray(data.bindings) ? data.bindings : [], truncated: data.truncated === true };
}

export async function revokeDevice(instanceId: string): Promise<void> {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ action: 'device-revoke', instanceId }) });
  if (!response.ok) throw new Error(response.status === 401 ? '登录状态已失效' : response.status === 403 ? '当前账号无权删除此设备' : '删除设备失败');
}

export async function sendDeviceCommand(instanceId: string, commandAction: DeviceCommand['action'], minutes?: number): Promise<void> {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ action: 'device-command', instanceId, commandAction, minutes }) });
  if (!response.ok) throw new Error(response.status === 401 ? '登录状态已失效' : response.status === 403 ? '当前账号无权管理此设备' : '临时考试指令发送失败');
}

export async function sendDeviceHeartbeat(input: Omit<DeviceBindingInfo, 'instanceId' | 'gradeId' | 'classId' | 'revoked' | 'lastSeenAt' | 'updatedAt'> & { acknowledgedCommandId?: string }): Promise<{ revoked: boolean; command: DeviceCommand | null }> {
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'device-heartbeat', instanceId: getInstanceId(), ...input }) });
    if (!response.ok) return { revoked: false, command: null };
    const data = await response.json();
    if (data.revoked === true) {
      cacheDeviceBinding({ gradeId: '', classId: '', revoked: true });
      window.dispatchEvent(new CustomEvent('exam-board:device-revoked'));
      return { revoked: true, command: null };
    }
    const command = data.command && typeof data.command.id === 'string' ? data.command as DeviceCommand : null;
    return { revoked: false, command };
  } catch { return { revoked: false, command: null }; }
}
