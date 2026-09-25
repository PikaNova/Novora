import {
  EXAM_RECORD_STATUSES,
  EXAM_RECORD_STATUS_LABELS,
  type ExamRecordActionName,
  type ExamRecordDisplayStatus,
  type ExamRecordStatus,
} from '../shared/examRecordContracts.js';
import { ApiError, apiErrorFromResponse, networkApiError } from './apiError';
import { logger } from '../utils/logger';
import { fetchWithTimeout } from './fetchWithTimeout';
import { authHeaders as sessionAuthHeaders } from './auth/session';
import { runQueued } from './syncQueue';

/** 动作名 → `/api/exams` 的 action 参数。 */
export const EXAM_RECORD_ACTION_ROUTES: Record<ExamRecordActionName, string> = {
  publish: 'record-publish',
  pause: 'record-pause',
  resume: 'record-resume',
  extend: 'record-extend',
  end: 'record-end',
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
  /** 创建人显示名；服务端读不到用户时是空串，界面回退成 #id。 */
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  startAt: number | null;
  endAt: number | null;
  actualStartAt: number | null;
  actualEndAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  publishedAt: number | null;
  endedAt: number | null;
  archivedAt: number | null;
  /** 最近一次操作：列表据此显示「时间已调整」，文案里带新旧时间。 */
  lastOperation: { action: string; reason: string; at: number } | null;
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

/**
 * 允许的状态以共享契约为准，别再手抄一份。
 * 以前这里写死 `['draft','published','ended','archived','ongoing']`，服务端加上派生的
 * 「停止中」之后没同步：带停止申请的记录在**列表**里被静默丢掉，**详情**直接报
 * 「考试详情数据不完整」。现在两种状态都从契约里取，加状态不会再漏。
 */
const RECORD_STATUSES: readonly ExamRecordStatus[] = EXAM_RECORD_STATUSES;
const DISPLAY_STATUSES = new Set<string>(Object.keys(EXAM_RECORD_STATUS_LABELS));

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
  /**
   * 展示状态只决定标签，**认不出来也不能把整条记录丢掉**：以前这里写死一份列表，
   * 服务端加了派生状态就出现「列表少行、详情报数据不完整」。现在退回持久状态。
   */
  const resolvedDisplayStatus: ExamRecordDisplayStatus =
    typeof displayStatus === 'string' && DISPLAY_STATUSES.has(displayStatus)
      ? (displayStatus as ExamRecordDisplayStatus)
      : (status as ExamRecordStatus);
  return {
    id,
    name: textValue(row.name),
    status: status as ExamRecordStatus,
    displayStatus: resolvedDisplayStatus,
    targetGradeIds: stringList(row.targetGradeIds),
    targetClassIds: stringList(row.targetClassIds),
    source: row.source === 'quick' ? 'quick' : 'regular',
    itemCount: typeof row.itemCount === 'number' && Number.isFinite(row.itemCount) ? row.itemCount : 0,
    createdBy: numberOrNull(row.createdBy),
    createdByName: textValue(row.createdByName),
    createdAt: numberOrNull(row.createdAt) ?? 0,
    updatedAt: numberOrNull(row.updatedAt) ?? 0,
    startAt: numberOrNull(row.startAt),
    endAt: numberOrNull(row.endAt),
    actualStartAt: numberOrNull(row.actualStartAt),
    actualEndAt: numberOrNull(row.actualEndAt),
    pausedAt: numberOrNull(row.pausedAt),
    pausedMs: numberOrNull(row.pausedMs) ?? 0,
    publishedAt: numberOrNull(row.publishedAt),
    endedAt: numberOrNull(row.endedAt),
    archivedAt: numberOrNull(row.archivedAt),
    lastOperation: parseLastOperation(row.lastOperation),
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
    // 走统一封装：同一个查询在一屏里被多处分头拉取时只发一次网络请求
    // （高延迟链路上每条请求都是几百毫秒，合并后等待时间只付一次）。
    response = await fetchWithTimeout(`/api/exams?${params.toString()}`, {
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
  const parsed = rows.map(parseRecordEntry);
  const dropped = rows.length - parsed.filter((entry) => entry !== null).length;
  if (dropped > 0) {
    // 别再静默丢行：以前客户端状态白名单比服务端少一项（缺「停止中」），
    // 结果是这类记录在列表里凭空消失，页面上完全看不出原因。
    logger.warn('[exam-records] 列表里有记录没通过客户端校验，已丢弃', {
      dropped,
      total: rows.length,
      statuses: rows
        .map((row) => {
          const record = (row ?? {}) as Record<string, unknown>;
          return `${String(record.status ?? '?')}/${String(record.displayStatus ?? '?')}`;
        })
        .filter((_, index) => parsed[index] === null)
        .slice(0, 5),
    });
  }
  return {
    data: parsed.filter((entry): entry is ExamRecordListEntry => entry !== null),
    page: typeof payload.page === 'number' ? payload.page : query.page,
    pageSize: typeof payload.pageSize === 'number' ? payload.pageSize : query.pageSize,
    total: typeof payload.total === 'number' ? payload.total : 0,
    totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 0,
  };
}

/**
 * 按 id 读单场考试记录（考试详情抽屉的数据来源）。
 *
 * 详情抽屉不能依赖「调用方列表里恰好有这一行」：日程轴/班级网格的行来自本地快照，
 * 可能属于别的板块（进行中的考试属「当前考试」、已结束的属「历史考试」），
 * 列表页取不到就出现「点详情毫无反应」。改成按 id 现取，任何入口都打得开。
 */
export async function fetchExamRecord(recordId: string): Promise<ExamRecordListEntry> {
  const params = new URLSearchParams({ resource: 'record', recordId });
  let response: Response;
  try {
    response = await fetchWithTimeout(`/api/exams?${params.toString()}`, {
      headers: authHeaders(),
      cache: 'no-store',
    });
  } catch {
    throw networkApiError();
  }
  if (!response.ok) throw await apiErrorFromResponse(response, '考试详情读取失败');
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null;
  if (!payload?.ok) throw await apiErrorFromResponse(response, '考试详情读取失败');
  const entry = parseRecordEntry(payload.data);
  if (!entry) {
    throw new ApiError({
      status: 502,
      code: 'INVALID_RECORD_PAYLOAD',
      message: '考试详情数据不完整，请返回列表刷新后重试。',
      retryable: true,
    });
  }
  return entry;
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
    response = await fetchWithTimeout(`/api/exams?${params.toString()}`, {
      headers: authHeaders(),
      cache: 'no-store',
    });
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

/** 最近一次操作（服务端列表接口顺带带出）；畸形数据当作没有，不影响列表。 */
function parseLastOperation(raw: unknown): { action: string; reason: string; at: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const action = textValue(row.action);
  if (!action) return null;
  return { action, reason: textValue(row.reason), at: numberOrNull(row.at) ?? 0 };
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', ...sessionAuthHeaders(extra) };
}

export type ExamRecordActionRequest = {
  id: string;
  action: ExamRecordActionName;
  minutes?: number;
  reason?: string;
  /** 重试时传入上一次的键，避免重复执行。 */
  idempotencyKey?: string;
};

/**
 * 全局写槽（服务端 `GLOBAL_WRITE_MIN_INTERVAL_MS = 900`）同时只放行一个写请求。
 * 向导「保存并发布」是两次连写：先写考试窗口快照，紧接着发发布动作，第二个请求
 * 几乎必然落在前一个请求刚占用的窗口里。
 *
 * 所以记录动作也走 **同一个业务写队列**（`runQueued`，`MIN_BUSINESS_INTERVAL_MS = 900`）：
 * 保存与发布被排成 900ms 间隔的两次写，不再互相踩。下面这套 429 重试保留为兜底——
 * 另一个标签页 / 另一台设备同时写时仍会撞窗口，而 429 发生在任何写语句之前，
 * 照服务端提示等一会儿重发既安全、也不会把动作执行两遍；需要幂等键的动作沿用同一个键。
 */
const RATE_LIMITED_MAX_ATTEMPTS = 4;
const RATE_LIMITED_FALLBACK_WAIT_MS = 900;
const RATE_LIMITED_MAX_WAIT_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 服务端 Retry-After 优先；没带就按写槽窗口的量级兜底，单次最多等 5s。 */
function writeSlotRetryWaitMs(retryAfterMs: number | undefined): number {
  const suggested = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : RATE_LIMITED_FALLBACK_WAIT_MS;
  return Math.min(RATE_LIMITED_MAX_WAIT_MS, suggested);
}

/** 执行一次考试记录动作；写槽繁忙时自动重试；失败抛 ApiError，调用方用 formatApiError 展示。 */
export async function runExamRecordAction(input: ExamRecordActionRequest): Promise<{ idempotent: boolean }> {
  const idempotencyKey =
    input.idempotencyKey || (requiresIdempotencyKey(input.action) ? newIdempotencyKey(input.action, input.id) : '');
  const body: Record<string, unknown> = {
    action: EXAM_RECORD_ACTION_ROUTES[input.action],
    id: input.id,
  };
  if (input.minutes != null) body.minutes = input.minutes;
  if (input.reason) body.reason = input.reason;

  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      // 走队列：和「保存考试」「设备/插件写入」共享同一个 900ms 最小间隔，
      // 高优先级保证用户点的动作排在后台批量保存前面。
      response = await runQueued(
        () =>
          fetch('/api/exams', {
            method: 'POST',
            headers: authHeaders(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            body: JSON.stringify(body),
            cache: 'no-store',
          }),
        { priority: 'high', label: EXAM_RECORD_ACTION_LABELS[input.action] ?? '考试操作' },
      );
    } catch {
      throw networkApiError();
    }
    if (!response.ok) {
      const error = await apiErrorFromResponse(response, '考试操作失败');
      if (error.code === 'RATE_LIMITED' && attempt < RATE_LIMITED_MAX_ATTEMPTS) {
        await sleep(writeSlotRetryWaitMs(error.retryAfterMs));
        continue;
      }
      throw error;
    }
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; idempotent?: boolean } | null;
    if (!payload?.ok) throw await apiErrorFromResponse(response, '考试操作失败');
    return { idempotent: payload.idempotent === true };
  }
}

/** 读取一场考试的操作记录（详情页时间线用）。 */
export async function fetchExamRecordOperations(recordId: string): Promise<ExamRecordOperationEntry[]> {
  const params = new URLSearchParams({ resource: 'record-operations', recordId });
  let response: Response;
  try {
    response = await fetchWithTimeout(`/api/exams?${params.toString()}`, {
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
