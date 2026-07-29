import type { ExamItem, MajorExam, AlertsSettings } from '../types';
import type { DesignPolicy, ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import type { ExamSettings } from '../utils/appSettings';
import { ApiError, apiErrorFromResponse, networkApiError } from './apiError';
import { fetchWithTimeout } from './fetchWithTimeout';
import { saveDesignPolicyDraft, clearDesignPolicyDraft } from './designPolicyDraft';
import { notify } from './notify';

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
  designPolicy?: DesignPolicy;
  binding?: { gradeId: string; classId: string; revoked: boolean; isManagement?: boolean } | null;
  updatedAt: number;
}

const API_URL = '/api/exams';
const LOGIN_URL = '/api/login';
const TOKEN_KEY = 'admin_auth_token';
const TOKEN_EXPIRES_KEY = 'admin_auth_token_expires';
const ADMIN_USER_KEY = 'admin_user_context';
const GRADE_ADMIN_FIRST_LOGIN_KEY = 'novora_grade_admin_first_login';
const CLOUD_VERSION_KEY = 'exam_cloud_updated_at';
const CLOUD_SNAPSHOT_KEY = 'exam_cloud_snapshot';
const CLOUD_ETAG_KEY = 'exam_cloud_etag';
let lastExamApiError: ApiError | null = null;
let lastAuthApiError: ApiError | null = null;
let generatedRecoveryKey: string | null = null;

export function getLastExamApiError(): ApiError | null { return lastExamApiError; }
export function getLastAuthApiError(): ApiError | null { return lastAuthApiError; }
export function takeGeneratedRecoveryKey(): string | null {
  const value = generatedRecoveryKey;
  generatedRecoveryKey = null;
  return value;
}

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
    designPolicy: data?.designPolicy && typeof data.designPolicy === 'object'
      ? (data.designPolicy as DesignPolicy)
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

// ── 统一的网络错误分类 ────────────────────────────────────────────
function classifyFetchError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof TypeError && /fetch|network|load/i.test(err.message)) {
    return networkApiError();
  }
  console.error('[examService] unexpected error:', err);
  return new ApiError({
    status: 0,
    code: 'UNEXPECTED_ERROR',
    message: '发生了意外错误，请刷新页面后重试。',
    retryable: false,
  });
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

    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers, cache: isBootstrap ? 'no-store' : 'no-cache' },
      15_000,
    );

    if (res.status === 304) {
      const snap = getCloudSnapshot();
      if (snap) return snap;
      const full = await fetchWithTimeout(API_URL, { method: 'GET', cache: 'no-cache' }, 15_000);
      if (!full.ok) { lastExamApiError = await apiErrorFromResponse(full, '读取考试与班级数据失败'); return null; }
      const fullEtag = full.headers.get('ETag'); if (fullEtag) localStorage.setItem(CLOUD_ETAG_KEY, fullEtag);
      const fullData = await full.json();
      if (!fullData?.ok) {
        lastExamApiError = new ApiError({ status: 500, code: 'INVALID_RESPONSE', message: '服务器返回了无效的数据，请刷新后重试。', retryable: true });
        return null;
      }
      const fullPayload = toPayload(fullData);
      rememberCloudSnapshot(fullPayload);
      return fullPayload;
    }

    if (!res.ok) { lastExamApiError = await apiErrorFromResponse(res, '读取考试与班级数据失败'); return null; }
    const freshEtag = res.headers.get('ETag'); if (freshEtag) localStorage.setItem(CLOUD_ETAG_KEY, freshEtag);
    const data = await res.json();
    if (!data?.ok) {
      lastExamApiError = new ApiError({ status: 500, code: 'INVALID_RESPONSE', message: '服务器返回了无效的数据，请刷新后重试。', retryable: true });
      return null;
    }
    const payload = toPayload(data);
    rememberCloudSnapshot(payload);
    lastExamApiError = null;
    return payload;
  } catch (err) {
    lastExamApiError = classifyFetchError(err);
    return null;
  }
}

export interface SaveExamsInput {
  items: ExamItem[];
  action?: 'initialize';
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

export type SaveExamsResult = number | 'unauthorized' | { kind: 'conflict'; remote: ExamPayload | null } | { kind: 'error'; error: ApiError } | null;

const CLOUD_EXAM_WRITE_INTERVAL_MS = 1_000;
let examWriteChain: Promise<void> = Promise.resolve();
let lastExamWriteAt = 0;
let pendingExamWrites = 0;

function wait(ms: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
}

function examQueueLabel(input: SaveExamsInput) {
  if (input.action === 'initialize') return '初始化数据';
  if (input.weeklyPlans !== undefined || input.grades !== undefined || input.classes !== undefined)
    return '周测/班级数据';
  return '考试数据';
}

function notifyExamQueue(label: string, pending: number, running: boolean) {
  notify(
    running ? 'warning' : 'success',
    running
      ? `正在提交：${label}。还有 ${pending} 项待提交，请等待完成后再关闭页面。`
      : `${label}已提交到云端。`,
    running ? '云端提交中' : '云端提交完成',
    { id: 'cloud-queue-exam', variant: running ? 'queue' : undefined, durationMs: running ? 12_000 : 2600 },
  );
}

async function runQueuedExamWrite<T>(label: string, task: () => Promise<T>): Promise<T> {
  pendingExamWrites += 1;
  notifyExamQueue(label, pendingExamWrites, true);
  const run = examWriteChain.then(async () => {
    pendingExamWrites = Math.max(0, pendingExamWrites - 1);
    notifyExamQueue(label, pendingExamWrites, true);
    const elapsed = Date.now() - lastExamWriteAt;
    if (elapsed < CLOUD_EXAM_WRITE_INTERVAL_MS)
      await wait(CLOUD_EXAM_WRITE_INTERVAL_MS - elapsed);
    try {
      const result = await task();
      lastExamWriteAt = Date.now();
      return result;
    } finally {
      notifyExamQueue(label, pendingExamWrites, pendingExamWrites > 0);
    }
  });
  examWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function saveExamsToServerNow(input: SaveExamsInput): Promise<SaveExamsResult> {
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
    if (input.action) requestBody.action = input.action;
    if (input.scheduleMode !== undefined) requestBody.scheduleMode = input.scheduleMode;
    if (input.weeklyPlans !== undefined) requestBody.weeklyPlans = input.weeklyPlans;
    if (input.activeWeeklyPlanId !== undefined) requestBody.activeWeeklyPlanId = input.activeWeeklyPlanId;
    if (input.activeWeeklyPlanIdByClassId !== undefined) requestBody.activeWeeklyPlanIdByClassId = input.activeWeeklyPlanIdByClassId;
    if (input.grades !== undefined) requestBody.grades = input.grades;
    if (input.classes !== undefined) requestBody.classes = input.classes;
    if (input.initialization !== undefined) requestBody.initialization = input.initialization;
    if (input.weeklyConflictPolicy !== undefined) requestBody.weeklyConflictPolicy = input.weeklyConflictPolicy;

    const res = await fetchWithTimeout(
      API_URL,
      { method: 'POST', headers, body: JSON.stringify(requestBody) },
      20_000,
    );

    if (res.status === 401) { lastExamApiError = await apiErrorFromResponse(res, '登录状态已失效'); logoutAdmin(); return 'unauthorized'; }
    if (res.status === 409) {
      const data = await res.json().catch(() => null);
      if (data?.code === 'DATA_CONFLICT' || data?.remote) return { kind: 'conflict', remote: data?.remote ? toPayload(data.remote) : null };
      const replay = new Response(JSON.stringify(data), { status: res.status, headers: res.headers });
      const error = await apiErrorFromResponse(replay, '云端拒绝了本次保存');
      lastExamApiError = error;
      return { kind: 'error', error };
    }
    // V3：403 专门处理——区分「PASSWORD_CHANGE_REQUIRED」与「PERMISSION_DENIED」，
    // 避免前端统一展示为笼统的「权限不足」。真实错误文本已在 apiErrorFromResponse 中优先取服务端原始文本。
    if (!res.ok) {
      const error = await apiErrorFromResponse(res, '考试数据同步失败');
      lastExamApiError = error;
      return { kind: 'error', error };
    }
    const data = await res.json();
    if (!data?.ok) return null;
    if (input.action === 'initialize' && typeof data.recoveryKey === 'string') generatedRecoveryKey = data.recoveryKey;
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
      designPolicy: getCloudSnapshot()?.designPolicy,
      updatedAt,
    });
    lastExamApiError = null;
    return updatedAt;
  } catch (err) {
    const error = classifyFetchError(err);
    const wrappedError = (error.code === 'NETWORK_UNAVAILABLE' || error.code === 'NETWORK_TIMEOUT')
      ? new ApiError({ ...error, message: '无法连接服务器，本机修改已保留，联网后会自动重试。' })
      : error;
    lastExamApiError = wrappedError;
    return { kind: 'error', error: wrappedError };
  }
}

export async function saveExamsToServer(input: SaveExamsInput): Promise<SaveExamsResult> {
  return runQueuedExamWrite(examQueueLabel(input), () => saveExamsToServerNow(input));
}

/** V3：失败时写入 localStorage 草稿，下次打开管理页可提示恢复。 */
export async function saveDesignPolicy(designPolicy: DesignPolicy): Promise<DesignPolicy> {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  try {
    const response = await fetchWithTimeout(
      API_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'design-policy', designPolicy }),
      },
      20_000,
    );
    if (!response.ok) {
      const error = await apiErrorFromResponse(response, '考试端设计规则保存失败');
      saveDesignPolicyDraft(designPolicy, error.message);
      throw error;
    }
    const data = await response.json();
    if (!data?.designPolicy) throw new Error('服务器未返回设计规则');
    const saved = data.designPolicy as DesignPolicy;
    clearDesignPolicyDraft();
    const snapshot = getCloudSnapshot();
    if (snapshot) rememberCloudSnapshot({ ...snapshot, designPolicy: saved, updatedAt: Number(data.updatedAt ?? saved.updatedAt) });
    else localStorage.setItem(CLOUD_VERSION_KEY, String(data.updatedAt ?? saved.updatedAt));
    return saved;
  } catch (err) {
    if (!(err instanceof ApiError)) {
      const wrapped = classifyFetchError(err);
      saveDesignPolicyDraft(designPolicy, wrapped.message);
      throw wrapped;
    }
    throw err;
  }
}

export async function isLoginRequired(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(LOGIN_URL, { method: 'GET', headers: { 'Cache-Control': 'no-store' } }, 10_000);
    if (!res.ok) { lastAuthApiError = await apiErrorFromResponse(res, '无法读取登录配置'); return true; }
    const data = await res.json();
    lastAuthApiError = null;
    return !!data?.required;
  } catch (err) {
    lastAuthApiError = classifyFetchError(err);
    return true;
  }
}

export async function getAdminRecoveryStatus(): Promise<boolean> {
  const res = await fetchWithTimeout(
    `${LOGIN_URL}?action=recovery-status`,
    { headers: { 'Cache-Control': 'no-store' } },
    10_000,
  );
  if (!res.ok) throw await apiErrorFromResponse(res, '无法读取账户恢复配置');
  const data = await res.json();
  return data?.configured === true;
}

export async function recoverSuperAdminAccount(username: string, recoveryKey: string, newPassword: string): Promise<void> {
  const res = await fetchWithTimeout(
    LOGIN_URL,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recover-super-admin', username, recoveryKey, newPassword }),
    },
    15_000,
  );
  if (!res.ok) throw await apiErrorFromResponse(res, '超级管理员账户恢复失败');
}

export async function repairSuperAdminAccount(username: string, recoveryKey: string, newPassword: string): Promise<{ created: boolean }> {
  const res = await fetchWithTimeout(
    LOGIN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repair-super-admin', username, recoveryKey, newPassword }),
    },
    15_000,
  );
  const data = await res.clone().json().catch(() => null);
  if (!res.ok || data?.ok !== true) throw await apiErrorFromResponse(res, '超级管理员账户修复失败');
  return { created: data.created === true };
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

export function shouldPromptGradeAdminSetup(user: AdminUserContext | null): boolean {
  if (!user || user.roleId !== 'grade_admin' || user.mustChangePassword) return false;
  try { return localStorage.getItem(GRADE_ADMIN_FIRST_LOGIN_KEY) === String(user.id); } catch { return false; }
}

export function clearGradeAdminSetupPrompt(): void {
  try { localStorage.removeItem(GRADE_ADMIN_FIRST_LOGIN_KEY); } catch { /* storage optional */ }
}

export function adminCan(permission: string, user = getAdminUser()): boolean {
  return !!user && (user.permissions.includes('*') || user.permissions.includes(permission));
}

export function adminCanGrade(gradeId: string, user = getAdminUser()): boolean {
  return !!user && (user.permissions.includes('*') || user.scopes.some(scope => scope.type === 'all' || scope.gradeId === gradeId));
}

export function adminCanClass(gradeId: string, classId: string, user = getAdminUser()): boolean {
  return !!user && (user.permissions.includes('*') || user.scopes.some(scope =>
    scope.type === 'all' || scope.type === 'grade' && scope.gradeId === gradeId || scope.type === 'class' && scope.classId === classId));
}

/** V3：登录/进入管理页时主动刷新一次真实权限，消除前端 localStorage 缓存与服务端实际角色的漂移（见权限排查报告原因 5）。 */
export async function refreshAdminUser(): Promise<AdminUserContext | null> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const res = await fetchWithTimeout(
      `${LOGIN_URL}?action=me`,
      { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' } },
      10_000,
    );
    if (!res.ok) { if (res.status === 401) logoutAdmin(); return null; }
    const data = await res.json();
    if (!data?.user) return null;
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
    return data.user as AdminUserContext;
  } catch { return getAdminUser(); }
}

export async function loginAdmin(username: string, password: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      LOGIN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      },
      15_000,
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      lastAuthApiError = await apiErrorFromResponse(new Response(JSON.stringify(data), { status: res.status, headers: res.headers }), '登录失败');
      return false;
    }
    if (data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(TOKEN_EXPIRES_KEY, String(data.expiresAt ?? 0));
    }
    if (data.user) {
      localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
      if (data.firstLogin === true && data.user.roleId === 'grade_admin') localStorage.setItem(GRADE_ADMIN_FIRST_LOGIN_KEY, String(data.user.id));
    }
    lastAuthApiError = null;
    return true;
  } catch (err) {
    lastAuthApiError = classifyFetchError(err);
    return false;
  }
}

export function hasValidLocalToken(): boolean {
  const token = localStorage.getItem(TOKEN_KEY);
  const expires = Number(localStorage.getItem(TOKEN_EXPIRES_KEY) ?? 0);
  if (!token) return false;
  if (expires && Date.now() > expires) { logoutAdmin(); return false; }
  return true;
}

export function logoutAdmin(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRES_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
}
