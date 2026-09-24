import type { ExamRecordActionName, ExamRecordDisplayStatus, ExamRecordStatus } from '../shared/examRecordContracts.js';
import { apiErrorFromResponse, networkApiError } from './apiError';

/** 动作名 → `/api/exams` 的 action 参数。 */
export const EXAM_RECORD_ACTION_ROUTES: Record<ExamRecordActionName, string> = {
  publish: 'record-publish',
  pause: 'record-pause',
  resume: 'record-resume',
  extend: 'record-extend',
  end: 'record-end',
  request_stop: 'record-request-stop',
  force_end: 'record-force-end',
  archive: 'record-archive',
  unarchive: 'record-unarchive',
  copy: 'record-copy',
};

export const EXAM_RECORD_ACTION_LABELS: Record<ExamRecordActionName, string> = {
  publish: '发布',
  pause: '暂停',
  resume: '继续',
  extend: '延长',
  end: '结束',
  request_stop: '申请停止',
  force_end: '强制结束',
  archive: '归档',
  unarchive: '取消归档',
  copy: '复制',
};

/** copy 与 extend 会改变可观察结果，服务端强制要求幂等键。 */
export function requiresIdempotencyKey(action: ExamRecordActionName): boolean {
  return action === 'copy' || action === 'extend';
}

/**
 * 生成一次用户意图的幂等键。重试同一次操作时必须复用同一个键，
 * 否则网络抖动重发会真的执行两次（延长两倍时长、复制出两场考试）。
 */
export function newIdempotencyKey(action: ExamRecordActionName, recordId: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${action}-${recordId}-${Date.now().toString(36)}-${random}`;
}

export type ExamRecordOperationEntry = {
  action: string;
  actorId: number | null;
  actorName: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  resultRecordId: string;
  createdAt: number;
};

/** 列表与详情页共用的记录形状（字段全部来自数据库，前端不推断）。 */
export type ExamRecordListEntry = {
  id: string;
  name: string;
  status: ExamRecordStatus;
  displayStatus: ExamRecordDisplayStatus;
  targetGradeIds: string[];
  targetClassIds: string[];
  source: 'regular' | 'quick';
  itemCount: number;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
  startAt: number | null;
  endAt: number | null;
  actualStartAt: number | null;
  actualEndAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  /** 管理员申请停止的时刻；非空表示「停止中」，等系统判定是否真正结束。 */
  stopRequestedAt: number | null;
  publishedAt: number | null;
  endedAt: number | null;
  archivedAt: number | null;
};

export type ExamRecordListQuery = {
  page: number;
  pageSize: number;
  /** 考试中心的板块口径；由服务端解释边界，客户端不再自行拼状态条件。 */
  preset?: ExamRecordPreset;
  includeArchived?: boolean;
  q?: string;
  status?: string;
  gradeId?: string;
  classIds?: string[];
  source?: string;
  time?: string;
  createdBy?: string;
  /** 时间窗（毫秒）。给了窗口就只取窗内的考试，用于「考试安排」一次看全一周。 */
  from?: number;
  to?: number;
  /** 时间窗取数时，是否把「未定时间」（start_at 为空）的记录也带上。 */
  includeUnscheduled?: boolean;
};

export type ExamRecordPreset = 'current' | 'schedule' | 'draft' | 'history';

export type ExamRecordListPage = {
  data: ExamRecordListEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const RECORD_STATUSES: readonly ExamRecordStatus[] = ['draft', 'published', 'ended', 'archived'];
const DISPLAY_STATUSES: readonly ExamRecordDisplayStatus[] = [...RECORD_STATUSES, 'ongoing'];

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseRecordEntry(raw: unknown): ExamRecordListEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = textValue(row.id);
  const status = row.status;
  const displayStatus = row.displayStatus;
  if (!id) return null;
  if (typeof status !== 'string' || !RECORD_STATUSES.includes(status as ExamRecordStatus)) return null;
  if (typeof displayStatus !== 'string' || !DISPLAY_STATUSES.includes(displayStatus as ExamRecordDisplayStatus))
    return null;
  return {
    id,
    name: textValue(row.name),
    status: status as ExamRecordStatus,
    displayStatus: displayStatus as ExamRecordDisplayStatus,
    targetGradeIds: stringList(row.targetGradeIds),
    targetClassIds: stringList(row.targetClassIds),
    source: row.source === 'quick' ? 'quick' : 'regular',
    itemCount: typeof row.itemCount === 'number' && Number.isFinite(row.itemCount) ? row.itemCount : 0,
    createdBy: numberOrNull(row.createdBy),
    createdAt: numberOrNull(row.createdAt) ?? 0,
    updatedAt: numberOrNull(row.updatedAt) ?? 0,
    startAt: numberOrNull(row.startAt),
    endAt: numberOrNull(row.endAt),
    actualStartAt: numberOrNull(row.actualStartAt),
    actualEndAt: numberOrNull(row.actualEndAt),
    pausedAt: numberOrNull(row.pausedAt),
    pausedMs: numberOrNull(row.pausedMs) ?? 0,
    stopRequestedAt: numberOrNull(row.stopRequestedAt),
    publishedAt: numberOrNull(row.publishedAt),
    endedAt: numberOrNull(row.endedAt),
    archivedAt: numberOrNull(row.archivedAt),
  };
}

/** 读取考试记录列表；畸形的单条记录会被丢弃，避免一条坏数据毁掉整页。 */
export async function fetchExamRecords(query: ExamRecordListQuery): Promise<ExamRecordListPage> {
  const params = new URLSearchParams({
    resource: 'records',
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.preset) params.set('preset', query.preset);
  if (query.includeArchived) params.set('includeArchived', '1');
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.gradeId) {
    params.set('gradeId', query.gradeId);
    if (query.classIds?.length) params.set('classIds', query.classIds.join(','));
  }
  if (query.source) params.set('source', query.source);
  if (query.time) params.set('time', query.time);
  if (query.createdBy) params.set('createdBy', query.createdBy);
  if (query.from && query.to) {
    params.set('from', String(query.from));
    params.set('to', String(query.to));
    if (query.includeUnscheduled) params.set('includeUnscheduled', '1');
  }

  let response: Response;
  try {
    response = await fetch(`/api/exams?${params.toString()}`, {
      headers: authHeaders(),
      cache: 'no-store',
    });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '考试列表读取失败');
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: unknown;
    page?: unknown;
    pageSize?: unknown;
    total?: unknown;
    totalPages?: unknown;
  } | null;
  if (!payload?.ok) throw await apiErrorFromResponse(response, '考试列表读取失败');
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return {
    data: rows.map(parseRecordEntry).filter((entry): entry is ExamRecordListEntry => entry !== null),
    page: typeof payload.page === 'number' ? payload.page : query.page,
    pageSize: typeof payload.pageSize === 'number' ? payload.pageSize : query.pageSize,
    total: typeof payload.total === 'number' ? payload.total : 0,
    totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 0,
  };
}

/**
 * 发布前检查（T-286-01）结果。按产品口径：只用来提示，不阻断发布，
 * 所以前端只消费 warnings 与 devices 两项。
 */
export type ExamRecordPrecheck = {
  recordId: string;
  status: ExamRecordStatus;
  scope: { gradeIds: string[]; classIds: string[]; allScope: boolean };
  devices: { bound: number; online: number; stale: number };
  items: { total: number; enabled: number; missingTime: number };
  warnings: string[];
};

/** 发布前检查：科目时间完整性 + 目标范围设备在线情况。 */
export async function fetchExamRecordPrecheck(recordId: string): Promise<ExamRecordPrecheck> {
  const params = new URLSearchParams({ resource: 'record-precheck', id: recordId });
  let response: Response;
  try {
    response = await fetch(`/api/exams?${params.toString()}`, { headers: authHeaders(), cache: 'no-store' });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '发布前检查失败');
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
  if (!payload?.ok) throw await apiErrorFromResponse(response, '发布前检查失败');
  const raw = (payload.data ?? {}) as Record<string, unknown>;
  const devices = (raw.devices ?? {}) as Record<string, unknown>;
  const scope = (raw.scope ?? {}) as Record<string, unknown>;
  const items = (raw.items ?? {}) as Record<string, unknown>;
  const numberOrZero = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    recordId: textValue(raw.recordId) || recordId,
    status: (RECORD_STATUSES.includes(raw.status as ExamRecordStatus) ? raw.status : 'draft') as ExamRecordStatus,
    scope: {
      gradeIds: Array.isArray(scope.gradeIds)
        ? scope.gradeIds.filter((id): id is string => typeof id === 'string')
        : [],
      classIds: Array.isArray(scope.classIds)
        ? scope.classIds.filter((id): id is string => typeof id === 'string')
        : [],
      allScope: scope.allScope === true,
    },
    devices: {
      bound: numberOrZero(devices.bound),
      online: numberOrZero(devices.online),
      stale: numberOrZero(devices.stale),
    },
    items: {
      total: numberOrZero(items.total),
      enabled: numberOrZero(items.enabled),
      missingTime: numberOrZero(items.missingTime),
    },
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter((line): line is string => typeof line === 'string')
      : [],
  };
}

function authToken(): string {
  return typeof localStorage === 'undefined' ? '' : localStorage.getItem('admin_auth_token') || '';
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = authToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export type ExamRecordActionRequest = {
  id: string;
  action: ExamRecordActionName;
  minutes?: number;
  reason?: string;
  /** 重试时传入上一次的键，避免重复执行。 */
  idempotencyKey?: string;
};

/** 执行一次考试记录动作；失败抛 ApiError，调用方用 formatApiError 展示。 */
export async function runExamRecordAction(input: ExamRecordActionRequest): Promise<{ idempotent: boolean }> {
  const idempotencyKey =
    input.idempotencyKey || (requiresIdempotencyKey(input.action) ? newIdempotencyKey(input.action, input.id) : '');
  const body: Record<string, unknown> = {
    action: EXAM_RECORD_ACTION_ROUTES[input.action],
    id: input.id,
  };
  if (input.minutes != null) body.minutes = input.minutes;
  if (input.reason) body.reason = input.reason;

  let response: Response;
  try {
    response = await fetch('/api/exams', {
      method: 'POST',
      headers: authHeaders(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '考试操作失败');
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; idempotent?: boolean } | null;
  if (!payload?.ok) throw await apiErrorFromResponse(response, '考试操作失败');
  return { idempotent: payload.idempotent === true };
}

/** 读取一场考试的操作记录（详情页时间线用）。 */
export async function fetchExamRecordOperations(recordId: string): Promise<ExamRecordOperationEntry[]> {
  const params = new URLSearchParams({ resource: 'record-operations', recordId });
  let response: Response;
  try {
    response = await fetch(`/api/exams?${params.toString()}`, {
      headers: authHeaders(),
      cache: 'no-store',
    });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '读取操作记录失败');
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
  if (!payload?.ok) throw await apiErrorFromResponse(response, '读取操作记录失败');
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      action: typeof row.action === 'string' ? row.action : '',
      actorId: typeof row.actorId === 'number' ? row.actorId : null,
      actorName: typeof row.actorName === 'string' ? row.actorName : '',
      fromStatus: typeof row.fromStatus === 'string' ? row.fromStatus : '',
      toStatus: typeof row.toStatus === 'string' ? row.toStatus : '',
      reason: typeof row.reason === 'string' ? row.reason : '',
      resultRecordId: typeof row.resultRecordId === 'string' ? row.resultRecordId : '',
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    };
  });
}
