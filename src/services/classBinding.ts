import { getInstanceId } from './telemetry';

const API_URL = '/api/exams';
const CLASS_CHOICE_KEY = 'exam_board_class_choice_confirmed';
const CLASS_BINDING_CACHE_KEY = 'exam_board_class_binding_cache';
const ADMIN_TOKEN_KEY = 'admin_auth_token';

export interface ClassBindingInfo {
  instanceId: string;
  classTag: string;
  updatedAt: number;
}

export function hasConfirmedClassChoice(): boolean {
  try { return localStorage.getItem(CLASS_CHOICE_KEY) === 'true'; } catch { return false; }
}

export function markClassChoiceConfirmed(): void {
  try { localStorage.setItem(CLASS_CHOICE_KEY, 'true'); } catch { /* local settings remain usable in memory */ }
}

export function getClassBindingInstanceId(): string {
  return getInstanceId();
}

export function getCachedBoundClassTag(): string | null | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(CLASS_BINDING_CACHE_KEY) || 'null');
    if (!cached || cached.instanceId !== getInstanceId()) return undefined;
    return typeof cached.classTag === 'string' ? cached.classTag : (cached.classTag === null ? null : undefined);
  } catch { return undefined; }
}

export function cacheBoundClassTag(classTag: string | null): void {
  try {
    localStorage.setItem(CLASS_BINDING_CACHE_KEY, JSON.stringify({ instanceId: getInstanceId(), classTag, checkedAt: Date.now() }));
  } catch { /* local settings remain usable in memory */ }
}

export async function fetchBoundClassTag(): Promise<string | null> {
  try {
    const instanceId = encodeURIComponent(getInstanceId());
    const response = await fetch(`${API_URL}?action=class-binding&instanceId=${instanceId}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    const classTag = data?.ok && typeof data.classTag === 'string' ? data.classTag : null;
    cacheBoundClassTag(classTag);
    return classTag;
  } catch { return null; }
}

export async function saveBoundClassTag(classTag: string): Promise<boolean> {
  markClassChoiceConfirmed();
  cacheBoundClassTag(classTag.trim());
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'class-binding', instanceId: getInstanceId(), classTag: classTag.trim() }),
    });
    return response.ok;
  } catch { return false; }
}

export async function fetchClassBindings(): Promise<{ bindings: ClassBindingInfo[]; truncated: boolean }> {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
  const response = await fetch(`${API_URL}?action=class-bindings`, {
    cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(response.status === 401 ? '登录状态已失效，请重新进入管理后台' : '设备情况加载失败');
  const data = await response.json().catch(() => null);
  if (!data?.ok || !Array.isArray(data.bindings)) throw new Error('设备情况数据格式错误');
  return {
    bindings: data.bindings.filter((item: unknown): item is ClassBindingInfo => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Partial<ClassBindingInfo>;
      return typeof value.instanceId === 'string' && typeof value.classTag === 'string' && typeof value.updatedAt === 'number';
    }),
    truncated: data.truncated === true,
  };
}
