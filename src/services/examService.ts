import type { ExamItem, MajorExam, AlertsSettings } from '../types';
import type { ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import type { ExamSettings } from '../utils/appSettings';

export interface ExamPayload {
  items: ExamItem[];
  title: string;
  majors: MajorExam[];
  activeMajorId: string;
  alerts: AlertsSettings | null;
  scheduleMode?: ScheduleMode;
  weeklyPlans?: WeeklyPlan[];
  activeWeeklyPlanId?: string | null;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  grades?: SchoolGrade[];
  classes?: SchoolClass[];
  initialization?: ExamSettings['initialization'];
  weeklyConflictPolicy?: WeeklyConflictPolicy | null;
  binding?: { gradeId: string; classId: string; revoked: boolean } | null;
  updatedAt: number;
}

const API_URL = '/api/exams';
const LOGIN_URL = '/api/login';
const TOKEN_KEY = 'admin_auth_token';
const TOKEN_EXPIRES_KEY = 'admin_auth_token_expires';
const ADMIN_USER_KEY = 'admin_user_context';
const CLOUD_VERSION_KEY = 'exam_cloud_updated_at';
const CLOUD_SNAPSHOT_KEY = 'exam_cloud_snapshot';
const CLOUD_ETAG_KEY = 'exam_cloud_etag';

function toPayload(data: any): ExamPayload {
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    title: typeof data?.title === 'string' ? data.title : '',
    majors: Array.isArray(data?.majors) ? data.majors : [],
    activeMajorId: typeof data?.activeMajorId === 'string' ? data.activeMajorId : '',
    alerts: data?.alerts && typeof data.alerts === 'object' ? data.alerts : null,
    scheduleMode: typeof data?.scheduleMode === 'string' ? (data.scheduleMode as ScheduleMode) : undefined,
    weeklyPlans: Array.isArray(data?.weeklyPlans) ? (data.weeklyPlans as WeeklyPlan[]) : undefined,
    activeWeeklyPlanId: typeof data?.activeWeeklyPlanId === 'string'
      ? data.activeWeeklyPlanId
      : (data?.activeWeeklyPlanId === null ? null : undefined),
    activeWeeklyPlanIdByClassId: data?.activeWeeklyPlanIdByClassId && typeof data.activeWeeklyPlanIdByClassId === 'object'
      ? data.activeWeeklyPlanIdByClassId as Record<string, string | null>
      : undefined,
    grades: Array.isArray(data?.grades) ? data.grades : undefined,
    classes: Array.isArray(data?.classes) ? data.classes : undefined,
    initialization: data?.initialization && typeof data.initialization === 'object' ? data.initialization : undefined,
    weeklyConflictPolicy: data?.weeklyConflictPolicy && typeof data.weeklyConflictPolicy === 'object'
      ? (data.weeklyConflictPolicy as WeeklyConflictPolicy)
      : undefined,
    binding: data?.binding && typeof data.binding === 'object' ? data.binding : null,
    updatedAt: Number(data?.updatedAt ?? 0),
  };
}

function rememberCloudSnapshot(payload: ExamPayload): void {
  try {
    localStorage.setItem(CLOUD_VERSION_KEY, String(payload.updatedAt));
    localStorage.setItem(CLOUD_SNAPSHOT_KEY, JSON.stringify(payload));
  } catch { /* 离线/隐私模式下仍可正常使用当前会话数据 */ }
}

/** 最近一次成功读取或保存的云端完整快照，是三方合并的共同基线。 */
export function getCloudSnapshot(): ExamPayload | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLOUD_SNAPSHOT_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? toPayload(parsed) : null;
  } catch { return null; }
}

export async function fetchExamsFromServer(bootstrapInstanceId?: string): Promise<ExamPayload | null> {
  try {
    const headers: Record<string, string> = {};
    const isBootstrap = !!bootstrapInstanceId;
    const etag = isBootstrap ? null : localStorage.getItem(CLOUD_ETAG_KEY);
    if (etag) headers['If-None-Match'] = etag;
    const url = isBootstrap
      ? `${API_URL}?action=bootstrap&instanceId=${encodeURIComponent(bootstrapInstanceId)}`
      : API_URL;
    // no-cache validates at the edge but does not force a database round-trip when the ETag is unchanged.
    const res = await fetch(url, { method: 'GET', headers, cache: isBootstrap ? 'no-store' : 'no-cache' });
    if (res.status === 304) {
      // 304 = 云端数据自上次拉取后未变更，本身即“已同步”成功状态。
      const snap = getCloudSnapshot();
      if (snap) return snap;
      // 极少数情况下本地基线快照丢失（隐私模式/配额清理/跨版本），但服务端已确认未变更；
      // 去掉条件头重新完整拉取一次，避免把“已同步”误判为同步失败。
      const full = await fetch(API_URL, { method: 'GET', cache: 'no-cache' });
      if (!full.ok) return null;
      const fullEtag = full.headers.get('ETag'); if (fullEtag) localStorage.setItem(CLOUD_ETAG_KEY, fullEtag);
      const fullData = await full.json();
      if (!fullData?.ok) return null;
      const fullPayload = toPayload(fullData);
      rememberCloudSnapshot(fullPayload);
      return fullPayload;
    }
    if (!res.ok) return null;
    const freshEtag = res.headers.get('ETag'); if (freshEtag) localStorage.setItem(CLOUD_ETAG_KEY, freshEtag);
    const data = await res.json();
    if (!data?.ok) return null;
    const payload = toPayload(data);
    // 原代码在 return 后写缓存，实际从未执行；现在读取成功即同时写入版本和完整基线快照。
    rememberCloudSnapshot(payload);
    return payload;
  } catch { return null; }
}

export interface SaveExamsInput {
  items: ExamItem[];
  baseUpdatedAt?: number;
  title?: string;
  majors?: MajorExam[];
  activeMajorId?: string;
  alerts?: AlertsSettings | null;
  scheduleMode?: ScheduleMode;
  weeklyPlans?: WeeklyPlan[];
  activeWeeklyPlanId?: string | null;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  grades?: SchoolGrade[];
  classes?: SchoolClass[];
  initialization?: ExamSettings['initialization'];
  weeklyConflictPolicy?: WeeklyConflictPolicy | null;
}

export type SaveExamsResult = number | 'unauthorized' | { kind: 'conflict'; remote: ExamPayload | null } | null;

/**
 * 将数据推送至服务器。
 * 返回值：成功返回 updatedAt；冲突时携带服务端完整快照，供后台执行三方合并；鉴权失败返回 'unauthorized'。
 */
export async function saveExamsToServer(input: SaveExamsInput): Promise<SaveExamsResult> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const requestBody: Record<string, unknown> = {
      items: input.items,
      title: input.title ?? '',
      majors: input.majors ?? [],
      activeMajorId: input.activeMajorId ?? '',
      alerts: input.alerts ?? null,
      baseUpdatedAt: input.baseUpdatedAt ?? Number(localStorage.getItem(CLOUD_VERSION_KEY) ?? 0),
    };
    // 仅在显式提供时才发送周测字段；缺省时服务端保留既有值，避免后台保存把周测数据覆盖为空。
    if (input.scheduleMode !== undefined) requestBody.scheduleMode = input.scheduleMode;
    if (input.weeklyPlans !== undefined) requestBody.weeklyPlans = input.weeklyPlans;
    if (input.activeWeeklyPlanId !== undefined) requestBody.activeWeeklyPlanId = input.activeWeeklyPlanId;
    if (input.activeWeeklyPlanIdByClassId !== undefined) requestBody.activeWeeklyPlanIdByClassId = input.activeWeeklyPlanIdByClassId;
    if (input.grades !== undefined) requestBody.grades = input.grades;
    if (input.classes !== undefined) requestBody.classes = input.classes;
    if (input.initialization !== undefined) requestBody.initialization = input.initialization;
    if (input.weeklyConflictPolicy !== undefined) requestBody.weeklyConflictPolicy = input.weeklyConflictPolicy;
    const res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(requestBody) });
    if (res.status === 401) { logoutAdmin(); return 'unauthorized'; }
    if (res.status === 409) {
      const data = await res.json().catch(() => null);
      return { kind: 'conflict', remote: data?.remote ? toPayload(data.remote) : null };
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.ok) return null;
    const updatedAt = Number(data.updatedAt ?? Date.now());
    rememberCloudSnapshot({
      items: input.items,
      title: input.title ?? '',
      majors: input.majors ?? [],
      activeMajorId: input.activeMajorId ?? '',
      alerts: input.alerts ?? null,
      scheduleMode: input.scheduleMode,
      weeklyPlans: input.weeklyPlans,
      activeWeeklyPlanId: input.activeWeeklyPlanId,
      activeWeeklyPlanIdByClassId: input.activeWeeklyPlanIdByClassId,
      grades: input.grades,
      classes: input.classes,
      initialization: input.initialization,
      weeklyConflictPolicy: input.weeklyConflictPolicy,
      updatedAt,
    });
    return updatedAt;
  } catch { return null; }
}

export async function isLoginRequired(): Promise<boolean> {
  try {
    const res = await fetch(LOGIN_URL, { method: 'GET', headers: { 'Cache-Control': 'no-store' } });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.required;
  } catch { return false; }
}

export type AdminScope = { type: 'all' | 'grade' | 'class'; gradeId: string; classId: string };
export type AdminUserContext = {
  id: number;
  username: string;
  displayName: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  scopes: AdminScope[];
  mustChangePassword: boolean;
};

export function getAdminUser(): AdminUserContext | null {
  try {
    const user = JSON.parse(localStorage.getItem(ADMIN_USER_KEY) || 'null');
    return user && typeof user === 'object' && Array.isArray(user.permissions) ? user as AdminUserContext : null;
  } catch { return null; }
}

export function adminCan(permission: string, user = getAdminUser()): boolean {
  return !!user && (user.permissions.includes('*') || user.permissions.includes(permission));
}

export function adminCanGrade(gradeId: string, user = getAdminUser()): boolean {
  return !!user && (user.permissions.includes('*') || user.scopes.some(scope => scope.type === 'all' || scope.gradeId === gradeId));
}

export function adminCanClass(gradeId: string, classId: string, user = getAdminUser()): boolean {
  return !!user && (user.permissions.includes('*') || user.scopes.some(scope => scope.type === 'all' || scope.type === 'grade' && scope.gradeId === gradeId || scope.type === 'class' && scope.classId === classId));
}

export async function refreshAdminUser(): Promise<AdminUserContext | null> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const res = await fetch(`${LOGIN_URL}?action=me`, { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' } });
    if (!res.ok) { if (res.status === 401) logoutAdmin(); return null; }
    const data = await res.json();
    if (!data?.user) return null;
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
    return data.user as AdminUserContext;
  } catch { return getAdminUser(); }
}

export async function loginAdmin(username: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return false;
    if (data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(TOKEN_EXPIRES_KEY, String(data.expiresAt ?? 0));
    }
    if (data.user) localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
    return true;
  } catch { return false; }
}

export function hasValidLocalToken(): boolean {
  const token = localStorage.getItem(TOKEN_KEY);
  const expires = Number(localStorage.getItem(TOKEN_EXPIRES_KEY) ?? 0);
  if (!token) return false;
  if (expires && Date.now() > expires) { logoutAdmin(); return false; }
  return true;
}

export async function changeAdminPassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(TOKEN_KEY); if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch('/api/admin-password', { method: 'POST', headers, body: JSON.stringify({ currentPassword, newPassword }) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return { ok: false, error: data?.error || '修改失败' };
    logoutAdmin(); return { ok: true };
  } catch { return { ok: false, error: '网络错误，请恢复联网后重试' }; }
}

export function logoutAdmin(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRES_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
}
