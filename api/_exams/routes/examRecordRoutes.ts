import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  SCHEMA_MIGRATION_LOCK_ID,
  type AdminActor,
  ensureAuthTables,
  hasPermission,
  requireActor,
  writeAudit,
} from '../../_auth.js';
import { acquireWriteSlotOrReject, database, ensureTableOnce, missingRelation } from '../db.js';
import { buildExamRecordProjection, projectCurrentExamRecords } from '../examRecordProjection.js';
import { operationLogKey } from '../operationLog.js';
import { asRecord } from '../../../src/shared/typeGuards.js';
import type { MajorExam } from '../../../src/types/index.js';
import {
  EXAM_RECORD_ACTION_PERMISSIONS,
  isExamRecordStatus,
  transitionExamRecordStatus,
  type ExamRecordAction,
  type ExamRecordDisplayStatus,
  type ExamRecordStatus,
} from '../../../src/shared/examRecordContracts.js';
import { addDaysToDateKey, getShanghaiDateKey } from '../../../src/utils/weeklySchedule.js';
import { parseZonedTime } from '../../../src/utils/zonedTime.js';
import {
  planExamOperation,
  type ExamOperationAction,
  type ExamOperationPatch,
} from '../../../src/shared/examLifecycleOperations.js';

type RecordRow = {
  id?: unknown;
  runtime_major_id?: unknown;
  name?: unknown;
  description?: unknown;
  status?: unknown;
  items?: unknown;
  item_count?: unknown;
  target_grade_ids?: unknown;
  target_class_ids?: unknown;
  source?: unknown;
  temporary?: unknown;
  priority_over_schedule?: unknown;
  config?: unknown;
  created_by?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  start_at?: unknown;
  end_at?: unknown;
  actual_start_at?: unknown;
  actual_end_at?: unknown;
  paused_at?: unknown;
  paused_ms?: unknown;
  published_at?: unknown;
  ended_at?: unknown;
  archived_at?: unknown;
  version?: unknown;
  sort_order?: unknown;
};

type SnapshotRow = { majors?: unknown; active_major_id?: unknown; updated_at?: unknown };

/** 路由层动作 = 状态机动作 + 只改时间字段的生命周期操作。 */
type RecordOperationAction = Extract<ExamOperationAction, 'start' | 'pause' | 'resume' | 'extend'>;
type RecordRouteAction = ExamRecordAction | RecordOperationAction;

const OPERATION_ACTIONS: readonly string[] = ['start', 'pause', 'resume', 'extend'];

function isOperationAction(value: string): value is RecordOperationAction {
  return OPERATION_ACTIONS.includes(value);
}

const ACTION_BY_NAME: Record<string, RecordRouteAction> = {
  'record-publish': 'publish',
  'record-end': 'end',
  'record-archive': 'archive',
  'record-unarchive': 'unarchive',
  'record-copy': 'copy',
  'record-start': 'start',
  'record-pause': 'pause',
  'record-resume': 'resume',
  'record-extend': 'extend',
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function queryList(value: unknown): string[] {
  return text(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 500);
}

function recordStatus(row: RecordRow): ExamRecordStatus | null {
  return isExamRecordStatus(row.status) ? row.status : null;
}

function displayStatus(row: RecordRow, now: number): ExamRecordDisplayStatus {
  const status = recordStatus(row) ?? 'draft';
  if (status !== 'published') return status;
  const startAt = nullableNumber(row.start_at);
  const endAt = nullableNumber(row.end_at);
  return startAt != null && endAt != null && startAt <= now && now < endAt ? 'ongoing' : status;
}

function recordJson(row: RecordRow, now: number): Record<string, unknown> {
  return {
    id: text(row.id),
    runtimeMajorId: text(row.runtime_major_id) || text(row.id),
    name: text(row.name),
    description: text(row.description),
    status: recordStatus(row) ?? 'draft',
    displayStatus: displayStatus(row, now),
    items: Array.isArray(row.items) ? row.items : [],
    itemCount: Number.isFinite(Number(row.item_count))
      ? Math.max(0, Math.trunc(Number(row.item_count)))
      : Array.isArray(row.items)
        ? row.items.length
        : 0,
    targetGradeIds: stringList(row.target_grade_ids),
    targetClassIds: stringList(row.target_class_ids),
    source: row.source === 'quick' ? 'quick' : 'regular',
    temporary: row.temporary === true,
    priorityOverSchedule: row.priority_over_schedule === true,
    config: row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? row.config : {},
    createdBy: nullableNumber(row.created_by),
    createdAt: number(row.created_at),
    updatedAt: number(row.updated_at),
    startAt: nullableNumber(row.start_at),
    endAt: nullableNumber(row.end_at),
    actualStartAt: nullableNumber(row.actual_start_at),
    actualEndAt: nullableNumber(row.actual_end_at),
    pausedAt: nullableNumber(row.paused_at),
    pausedMs: nullableNumber(row.paused_ms) ?? 0,
    publishedAt: nullableNumber(row.published_at),
    endedAt: nullableNumber(row.ended_at),
    archivedAt: nullableNumber(row.archived_at),
    version: number(row.version, 1),
    sortOrder: number(row.sort_order),
  };
}

function actorCanAccessRecord(actor: AdminActor, row: RecordRow): boolean {
  if (hasPermission(actor, '*')) return true;
  const gradeIds = stringList(row.target_grade_ids);
  const classIds = stringList(row.target_class_ids);
  if (!gradeIds.length && !classIds.length) return actor.scopes.some((scope) => scope.type === 'all');
  return actor.scopes.some(
    (scope) =>
      scope.type === 'all' ||
      (scope.type === 'grade' && gradeIds.includes(scope.gradeId)) ||
      (scope.type === 'class' && classIds.includes(scope.classId)),
  );
}

/** 把数据库行转成 `planExamOperation` 需要的形状（它只关心状态与时间字段）。 */
function planInput(row: RecordRow) {
  return {
    status: recordStatus(row) ?? 'draft',
    actualStartAt: nullableNumber(row.actual_start_at),
    actualEndAt: nullableNumber(row.actual_end_at),
    endAt: nullableNumber(row.end_at),
    pausedAt: nullableNumber(row.paused_at),
    pausedMs: number(row.paused_ms),
  };
}

function error(res: VercelResponse, status: number, code: string, message: string): void {
  res.status(status).json({ ok: false, code, error: message });
}

function normalizePage(value: unknown): number {
  return Math.max(1, Math.min(10_000, Math.trunc(number(value, 1))));
}

function normalizePageSize(value: unknown): number {
  return Math.max(1, Math.min(100, Math.trunc(number(value, 20))));
}

/**
 * 考试中心的四个板块口径。产品语义放在服务端，客户端只传板块名，
 * 避免"当前/安排/历史"的边界在前后端各写一份而漂移。
 *
 * - current：正在进行 / 暂停中 / 今天之内即将开始 / 时间窗已过但仍未结束（待处理）
 * - schedule：已发布且尚未开始，且不在今天（含未定时间）；今天之内的归「当前考试」
 * - draft：草稿
 * - history：已结束（includeArchived=1 时并入已归档）
 */
const RECORD_LIST_PRESETS = ['current', 'schedule', 'draft', 'history'] as const;

function isRecordListPreset(value: string): value is (typeof RECORD_LIST_PRESETS)[number] {
  return (RECORD_LIST_PRESETS as readonly string[]).includes(value);
}

async function handleRecordList(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const actor = await requireActor(req, res, 'major.read');
  if (!actor) return;
  await ensureTableOnce();
  const sql = database();
  const page = normalizePage(req.query?.page);
  const pageSize = normalizePageSize(req.query?.pageSize);
  const requestedStatus = text(req.query?.status);
  const search = text(req.query?.q).trim().slice(0, 120).toLowerCase();
  const gradeId = text(req.query?.gradeId).trim().slice(0, 128);
  const classIds = queryList(req.query?.classIds);
  const sourceFilter = text(req.query?.source).trim();
  const timeFilter = text(req.query?.time).trim();
  const createdByFilter = text(req.query?.createdBy).trim();
  const statusFilter = requestedStatus && requestedStatus !== 'all' ? requestedStatus : '';
  const presetFilter = text(req.query?.preset).trim();
  const includeArchived = text(req.query?.includeArchived).trim() === '1';
  if (presetFilter && !isRecordListPreset(presetFilter)) {
    error(res, 400, 'INVALID_PRESET', '无效的考试板块');
    return;
  }
  if (statusFilter && statusFilter !== 'ongoing' && !isExamRecordStatus(statusFilter)) {
    error(res, 400, 'INVALID_STATUS', '无效的考试状态');
    return;
  }
  if (sourceFilter && sourceFilter !== 'regular' && sourceFilter !== 'quick') {
    error(res, 400, 'INVALID_SOURCE', '无效的考试来源');
    return;
  }
  if (timeFilter && timeFilter !== 'upcoming' && timeFilter !== 'past') {
    error(res, 400, 'INVALID_TIME_FILTER', '无效的考试时间筛选');
    return;
  }
  const createdByValue = createdByFilter ? Number(createdByFilter) : null;
  if (createdByFilter && (createdByValue == null || !Number.isSafeInteger(createdByValue) || createdByValue < 0)) {
    error(res, 400, 'INVALID_CREATED_BY', '无效的创建人编号');
    return;
  }
  const now = Date.now();
  // "今天之内"按上海自然日算：客户端只看得到板块名，边界由服务端算。
  const todayEnd = parseZonedTime(`${addDaysToDateKey(getShanghaiDateKey(now), 1)}T00:00:00`);
  const hasAllScope = hasPermission(actor, '*') || actor.scopes.some((scope) => scope.type === 'all');
  const gradeScopeIds = actor.scopes.filter((scope) => scope.type === 'grade').map((scope) => scope.gradeId);
  const classScopeIds = actor.scopes.filter((scope) => scope.type === 'class').map((scope) => scope.classId);
  const searchPattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const offset = (page - 1) * pageSize;
  // 筛选与分页全部下推到 SQL：以前是整表 SELECT 回函数后内存过滤，记录一多就要把
  // 整张表搬过来。这里用一个 CTE 同时取「命中总数」和当前页，越界页的 total 也准确。
  const resultRows = (await sql`
    WITH filtered AS (
      SELECT id, runtime_major_id, name, description, status, items,
        COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END), 0) AS item_count,
        target_grade_ids, target_class_ids, source, temporary, priority_over_schedule,
        config, created_by, created_at, updated_at, start_at, end_at,
        actual_start_at, actual_end_at, paused_at, paused_ms, published_at, ended_at, archived_at,
        version, sort_order
      FROM exam_records
      WHERE
        (${hasAllScope}::boolean
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(target_grade_ids) = 'array' THEN target_grade_ids ELSE '[]'::jsonb END
            ) AS scope_value(value)
            WHERE scope_value.value = ANY(${gradeScopeIds}::text[])
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(target_class_ids) = 'array' THEN target_class_ids ELSE '[]'::jsonb END
            ) AS scope_value(value)
            WHERE scope_value.value = ANY(${classScopeIds}::text[])
          ))
        AND (${statusFilter}::text = '' OR (
          CASE
            WHEN status = 'published' AND start_at IS NOT NULL AND end_at IS NOT NULL
              AND start_at <= ${now}::bigint AND ${now}::bigint < end_at
            THEN 'ongoing'
            ELSE status
          END = ${statusFilter}))
        AND (${search}::text = '' OR name ILIKE ${searchPattern}::text OR id ILIKE ${searchPattern}::text)
        AND (${gradeId}::text = ''
          OR (jsonb_array_length(CASE WHEN jsonb_typeof(target_grade_ids) = 'array' THEN target_grade_ids ELSE '[]'::jsonb END) = 0
              AND jsonb_array_length(CASE WHEN jsonb_typeof(target_class_ids) = 'array' THEN target_class_ids ELSE '[]'::jsonb END) = 0)
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(target_grade_ids) = 'array' THEN target_grade_ids ELSE '[]'::jsonb END
            ) AS grade_value(value)
            WHERE grade_value.value = ${gradeId}
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(target_class_ids) = 'array' THEN target_class_ids ELSE '[]'::jsonb END
            ) AS class_value(value)
            WHERE class_value.value = ANY(${classIds}::text[])
          ))
        AND (${sourceFilter}::text = '' OR source = ${sourceFilter})
        AND (${createdByValue}::bigint IS NULL OR created_by = ${createdByValue}::bigint)
        AND (${timeFilter}::text = ''
          OR (${timeFilter} = 'upcoming' AND start_at IS NOT NULL AND start_at >= ${now}::bigint)
          OR (${timeFilter} = 'past' AND end_at IS NOT NULL AND end_at < ${now}::bigint))
        AND (${presetFilter}::text = '' OR (
          CASE ${presetFilter}::text
            WHEN 'current' THEN (
              status = 'published' AND (
                paused_at IS NOT NULL
                OR (start_at IS NOT NULL AND end_at IS NOT NULL
                    AND start_at <= ${now}::bigint AND ${now}::bigint < end_at)
                OR (start_at IS NOT NULL AND start_at >= ${now}::bigint AND start_at < ${todayEnd}::bigint)
                OR (end_at IS NOT NULL AND end_at <= ${now}::bigint)
              )
            )
            WHEN 'schedule' THEN (
              status = 'published' AND (start_at IS NULL OR start_at >= ${todayEnd}::bigint)
            )
            WHEN 'draft' THEN status = 'draft'
            WHEN 'history' THEN status = 'ended' OR (${includeArchived}::boolean AND status = 'archived')
            ELSE TRUE
          END
        ))
    ),
    paged AS (
      SELECT * FROM filtered
      ORDER BY
        (CASE ${presetFilter}::text
          WHEN 'current' THEN (
            CASE
              WHEN paused_at IS NOT NULL THEN 0
              WHEN start_at IS NOT NULL AND end_at IS NOT NULL
                AND start_at <= ${now}::bigint AND ${now}::bigint < end_at THEN 0
              WHEN end_at IS NOT NULL AND end_at <= ${now}::bigint THEN 1
              ELSE 2
            END
          )
          ELSE 0
        END),
        (CASE WHEN ${presetFilter}::text IN ('current', 'schedule') THEN start_at END) ASC NULLS LAST,
        (CASE WHEN ${presetFilter}::text = 'history' THEN COALESCE(ended_at, actual_end_at, updated_at) END) DESC NULLS LAST,
        updated_at DESC, sort_order ASC, id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    )
    SELECT
      (SELECT COUNT(*)::int FROM filtered) AS total_count,
      COALESCE(
        (SELECT jsonb_agg(p.* ORDER BY p.updated_at DESC, p.sort_order ASC, p.id ASC) FROM paged p),
        '[]'::jsonb
      ) AS page_rows
  `) as unknown as Array<{ total_count?: unknown; page_rows?: unknown }>;
  const total = Math.max(0, Math.trunc(number(resultRows[0]?.total_count)));
  const pageRows = Array.isArray(resultRows[0]?.page_rows) ? (resultRows[0].page_rows as RecordRow[]) : [];
  const data = pageRows.map((row) => recordJson(row, now));
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    ok: true,
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

type OperationRow = {
  action?: unknown;
  source_record_id?: unknown;
  result_record_id?: unknown;
  actor_id?: unknown;
  actor_username?: unknown;
  actor_display_name?: unknown;
  from_status?: unknown;
  to_status?: unknown;
  reason?: unknown;
  created_at?: unknown;
};

function operationJson(row: OperationRow): Record<string, unknown> {
  return {
    action: text(row.action),
    actorId: nullableNumber(row.actor_id),
    actorName: text(row.actor_display_name) || text(row.actor_username),
    fromStatus: text(row.from_status),
    toStatus: text(row.to_status),
    reason: text(row.reason),
    resultRecordId: text(row.result_record_id),
    createdAt: number(row.created_at),
  };
}

/**
 * 考试详情页要用的操作记录：只返回调用方有权访问的那场考试的操作日志。
 * 同时回放审计与操作日志两条链路，页面按「谁在什么时候把状态从哪改到哪」展示。
 */
async function handleRecordOperations(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const actor = await requireActor(req, res, 'major.read');
  if (!actor) return;
  const recordId = text(req.query?.recordId ?? req.query?.id)
    .trim()
    .slice(0, 128);
  if (!recordId) {
    error(res, 400, 'INVALID_RECORD_ID', '缺少考试记录 ID');
    return;
  }
  await ensureTableOnce();
  await ensureAuthTables();
  const sql = database();
  const rows = (await sql`SELECT * FROM exam_records WHERE id=${recordId}`) as unknown as RecordRow[];
  if (!rows[0] || !actorCanAccessRecord(actor, rows[0])) {
    error(res, 404, 'RECORD_NOT_FOUND', '考试记录不存在或无权访问');
    return;
  }
  const limit = Math.max(1, Math.min(200, Math.trunc(number(req.query?.limit, 50))));
  const operationRows = (await sql`
    SELECT operations.action, operations.source_record_id, operations.result_record_id,
      operations.actor_id, users.username AS actor_username, users.display_name AS actor_display_name,
      operations.from_status, operations.to_status, operations.reason, operations.created_at
    FROM exam_record_operations AS operations
    LEFT JOIN app_users AS users ON users.id = operations.actor_id
    WHERE operations.source_record_id = ${recordId}
    ORDER BY operations.created_at DESC, operations.idempotency_key DESC
    LIMIT ${limit}
  `) as unknown as OperationRow[];
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    ok: true,
    data: operationRows.map((row) => operationJson(row)),
    recordId,
  });
}

function majorForRecord(row: RecordRow): Record<string, unknown> {
  return {
    id: text(row.id),
    name: text(row.name),
    items: Array.isArray(row.items) ? row.items : [],
    order: number(row.sort_order),
    targetGradeIds: stringList(row.target_grade_ids),
    targetClassIds: stringList(row.target_class_ids),
    source: row.source === 'quick' ? 'quick' : 'regular',
    temporary: row.temporary === true,
    priorityOverSchedule: row.priority_over_schedule === true,
    ...(nullableNumber(row.created_by) == null ? {} : { createdBy: nullableNumber(row.created_by) }),
    ...(nullableNumber(row.created_at) == null ? {} : { createdAt: nullableNumber(row.created_at) }),
    ...(nullableNumber(row.start_at) == null ? {} : { startAt: nullableNumber(row.start_at) }),
    ...(nullableNumber(row.end_at) == null ? {} : { endAt: nullableNumber(row.end_at) }),
    ...(nullableNumber(row.actual_start_at) == null ? {} : { actualStartAt: nullableNumber(row.actual_start_at) }),
    ...(nullableNumber(row.actual_end_at) == null ? {} : { actualEndAt: nullableNumber(row.actual_end_at) }),
    ...(nullableNumber(row.published_at) == null ? {} : { publishedAt: nullableNumber(row.published_at) }),
    ...(nullableNumber(row.ended_at) == null ? {} : { endedAt: nullableNumber(row.ended_at) }),
    ...(nullableNumber(row.archived_at) == null ? {} : { archivedAt: nullableNumber(row.archived_at) }),
  };
}

function copiedMajor(
  source: Record<string, unknown>,
  name: string,
  actorId: number,
  now: number,
): Record<string, unknown> {
  const items = Array.isArray(source.items)
    ? source.items.map((rawItem) => {
        const item = asRecord(rawItem);
        return { ...item, id: randomUUID(), enabled: true };
      })
    : [];
  return {
    id: randomUUID(),
    name,
    items,
    order: number(source.order) + 1,
    targetGradeIds: stringList(source.targetGradeIds),
    targetClassIds: stringList(source.targetClassIds),
    source: 'regular',
    temporary: false,
    priorityOverSchedule: false,
    createdBy: actorId,
    createdAt: now,
  };
}

/** 生命周期操作只改时间字段，快照里的同名字段要一起写，否则下一次投影会把改动冲掉。 */
function applyOperationPatchToMajor(major: Record<string, unknown>, patch: ExamOperationPatch): void {
  if (patch.actualStartAt !== undefined) major.actualStartAt = patch.actualStartAt;
  if (patch.actualEndAt !== undefined) major.actualEndAt = patch.actualEndAt;
  if (patch.endAt !== undefined) major.endAt = patch.endAt;
  if (Object.prototype.hasOwnProperty.call(patch, 'pausedAt')) {
    if (patch.pausedAt == null) delete major.pausedAt;
    else major.pausedAt = patch.pausedAt;
  }
  if (patch.pausedMs !== undefined) major.pausedMs = patch.pausedMs;
}

async function handleRecordAction(req: VercelRequest, res: VercelResponse, action: RecordRouteAction): Promise<void> {
  if (req.method !== 'POST') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const permission = EXAM_RECORD_ACTION_PERMISSIONS[action];
  const actor = await requireActor(req, res, permission);
  if (!actor) return;
  const recordId = text(req.body?.id).trim().slice(0, 128);
  if (!recordId) {
    error(res, 400, 'INVALID_RECORD_ID', '缺少考试记录 ID');
    return;
  }
  const sql = database();
  const now = Date.now();
  const idempotencyKey = text(req.headers['idempotency-key'] ?? req.body?.idempotencyKey)
    .trim()
    .slice(0, 128);
  // copy 与 extend 会改变可观察的业务结果，必须由调用方提供幂等键；
  // 其余动作没有幂等键时用合成键写操作日志（主键非空）。
  const requiresIdempotencyKey = action === 'copy' || action === 'extend';
  if (requiresIdempotencyKey && !idempotencyKey) {
    error(
      res,
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      action === 'copy' ? '复制考试必须提供 Idempotency-Key' : '延长考试必须提供 Idempotency-Key',
    );
    return;
  }
  const reason = text(req.body?.reason).trim().slice(0, 200);
  if (!(await acquireWriteSlotOrReject(req, res))) return;
  let result: { record: Record<string, unknown>; idempotent?: boolean };
  try {
    const existingOperation = idempotencyKey
      ? (
          (await sql`SELECT action, source_record_id, result_record_id FROM exam_record_operations WHERE idempotency_key=${idempotencyKey}`) as unknown as Array<{
            action?: unknown;
            source_record_id?: unknown;
            result_record_id?: unknown;
          }>
        )[0]
      : undefined;
    if (existingOperation) {
      if (text(existingOperation.action) !== action) throw new Error('IDEMPOTENCY_KEY_REUSED');
      if (text(existingOperation.source_record_id) !== recordId) throw new Error('IDEMPOTENCY_KEY_REUSED');
      const sourceRows = (await sql`SELECT * FROM exam_records WHERE id=${recordId}`) as unknown as RecordRow[];
      if (!sourceRows[0] || !actorCanAccessRecord(actor, sourceRows[0]))
        throw new Error('RECORD_NOT_FOUND_OR_FORBIDDEN');
      const replayId = text(existingOperation.result_record_id) || recordId;
      const replayRows = (await sql`SELECT * FROM exam_records WHERE id=${replayId}`) as unknown as RecordRow[];
      if (!replayRows[0] || !actorCanAccessRecord(actor, replayRows[0]))
        throw new Error('RECORD_NOT_FOUND_OR_FORBIDDEN');
      result = { record: recordJson(replayRows[0], now), idempotent: true };
    } else {
      const recordRows = (await sql`SELECT * FROM exam_records WHERE id=${recordId}`) as unknown as RecordRow[];
      const record = recordRows[0];
      if (!record || !actorCanAccessRecord(actor, record)) throw new Error('RECORD_NOT_FOUND_OR_FORBIDDEN');
      const currentStatus = recordStatus(record);
      if (!currentStatus) throw new Error('INVALID_PERSISTED_STATUS');
      if (action === 'copy') {
        const copyName = text(req.body?.name).trim().slice(0, 200) || `${text(record.name)}（复制）`;
        const nextMajor = copiedMajor(majorForRecord(record), copyName, actor.id, now);
        const snapshotRows =
          (await sql`SELECT majors, updated_at FROM exam_data WHERE id=1`) as unknown as SnapshotRow[];
        const snapshot = snapshotRows[0] ?? {};
        const majors = Array.isArray(snapshot.majors) ? [...snapshot.majors, nextMajor] : [nextMajor];
        const expectedVersion = number(req.body?.baseUpdatedAt, number(snapshot.updated_at));
        const copyProjection = buildExamRecordProjection(
          nextMajor as unknown as MajorExam,
          majors.length - 1,
          now,
          now,
        );
        const copyResults = await sql.transaction((transaction) => [
          transaction`SELECT pg_advisory_xact_lock(${SCHEMA_MIGRATION_LOCK_ID})`,
          transaction`
            WITH updated AS (
              UPDATE exam_data SET majors=${JSON.stringify(majors)}::jsonb, updated_at=${now}
              WHERE id=1 AND updated_at=${expectedVersion}::BIGINT
              RETURNING id
            ), claimed AS (
              INSERT INTO exam_record_operations (
                idempotency_key, action, source_record_id, result_record_id,
                actor_id, from_status, to_status, reason, created_at
              )
              SELECT ${idempotencyKey}, 'copy', ${recordId}, ${String(nextMajor.id)},
                ${actor.id}, ${currentStatus}, 'draft', ${reason}, ${now}
              FROM updated
              ON CONFLICT (idempotency_key) DO NOTHING
              RETURNING result_record_id
            )
            INSERT INTO exam_records (
              id, runtime_major_id, name, description, status, items,
              target_grade_ids, target_class_ids, source, temporary, priority_over_schedule,
              config, created_by, created_at, updated_at, start_at, end_at,
              actual_start_at, actual_end_at, paused_at, paused_ms, published_at, ended_at, archived_at, version, sort_order
            )
            SELECT ${copyProjection.id}, ${copyProjection.runtimeMajorId}, ${copyProjection.name}, ${copyProjection.description}, 'draft',
              ${JSON.stringify(copyProjection.items)}::jsonb, ${JSON.stringify(copyProjection.targetGradeIds)}::jsonb,
              ${JSON.stringify(copyProjection.targetClassIds)}::jsonb, ${copyProjection.source}, ${copyProjection.temporary},
              ${copyProjection.priorityOverSchedule}, ${JSON.stringify(copyProjection.config)}::jsonb, ${copyProjection.createdBy},
              ${copyProjection.createdAt}, ${copyProjection.updatedAt}, ${copyProjection.startAt}, ${copyProjection.endAt},
              ${copyProjection.actualStartAt}, ${copyProjection.actualEndAt}, ${copyProjection.publishedAt}, ${copyProjection.endedAt},
              ${copyProjection.archivedAt}, 1, ${copyProjection.sortOrder}
            FROM claimed
            RETURNING *
          `,
        ]);
        const copiedRows = (copyResults[1] ?? []) as unknown as RecordRow[];
        if (!copiedRows[0]) throw new Error('DATA_CONFLICT');
        result = { record: recordJson(copiedRows[0], now) };
      } else {
        let nextStatus: ExamRecordStatus;
        let patch: ExamOperationPatch;
        if (isOperationAction(action)) {
          const plan = planExamOperation(planInput(record), {
            action,
            at: now,
            extendMinutes: Number(req.body?.minutes ?? req.body?.extendMinutes),
          });
          // 用 `in` 收窄：tsconfig.api.json 未开 strictNullChecks，布尔的判别属性不会被收窄。
          if ('code' in plan) {
            error(res, 409, plan.code, plan.error);
            return;
          }
          // start / pause / resume / extend 不改变持久状态，只改时间字段。
          nextStatus = currentStatus;
          patch = plan.patch;
        } else {
          const transitioned = transitionExamRecordStatus(currentStatus, action);
          if (!transitioned) throw new Error('INVALID_STATUS_TRANSITION');
          nextStatus = transitioned;
          if (action === 'end') {
            // 结束动作顺带结算在途暂停时长，暂停期间不计入考试用时。
            const plan = planExamOperation(planInput(record), { action: 'end', at: now });
            if (!plan.ok) throw new Error('INVALID_STATUS_TRANSITION');
            patch = plan.patch;
          } else {
            patch = { status: nextStatus };
          }
        }
        const snapshotRows =
          (await sql`SELECT majors, updated_at FROM exam_data WHERE id=1`) as unknown as SnapshotRow[];
        const snapshot = snapshotRows[0] ?? {};
        const expectedVersion = number(req.body?.baseUpdatedAt, number(snapshot.updated_at));
        const majors = Array.isArray(snapshot.majors) ? snapshot.majors.map((raw) => ({ ...asRecord(raw) })) : [];
        const majorIndex = majors.findIndex((major) => text(major.id) === recordId);
        if (majorIndex < 0) throw new Error('RECORD_NOT_IN_SNAPSHOT');
        const major = majors[majorIndex];
        if (action === 'publish') {
          major.publishedAt = now;
          delete major.archivedAt;
        } else if (action === 'end') major.endedAt = now;
        else if (action === 'archive') major.archivedAt = now;
        else if (action === 'unarchive') delete major.archivedAt;
        applyOperationPatchToMajor(major, patch);
        const hasPausedAt = Object.prototype.hasOwnProperty.call(patch, 'pausedAt');
        const pausedAtValue = patch.pausedAt ?? null;
        const operationKey = idempotencyKey || operationLogKey(recordId, action, now);
        const transitionResults = await sql.transaction((transaction) => [
          transaction`SELECT pg_advisory_xact_lock(${SCHEMA_MIGRATION_LOCK_ID})`,
          transaction`
            WITH updated AS (
              UPDATE exam_data SET majors=${JSON.stringify(majors)}::jsonb, updated_at=${now}
              WHERE id=1 AND updated_at=${expectedVersion}::BIGINT
              RETURNING id
            ), logged AS (
              INSERT INTO exam_record_operations (
                idempotency_key, action, source_record_id, result_record_id,
                actor_id, from_status, to_status, reason, created_at
              )
              SELECT ${operationKey}, ${action}, ${recordId}, ${recordId},
                ${actor.id}, ${currentStatus}, ${nextStatus}, ${reason}, ${now}
              FROM updated
              ON CONFLICT (idempotency_key) DO NOTHING
              RETURNING idempotency_key
            )
            UPDATE exam_records SET status=${nextStatus},
              published_at=CASE WHEN ${action === 'publish'} THEN ${now} ELSE published_at END,
              ended_at=CASE WHEN ${action === 'end'} THEN ${now} ELSE ended_at END,
              archived_at=CASE WHEN ${action === 'archive'} THEN ${now} WHEN ${action === 'unarchive'} THEN NULL ELSE archived_at END,
              actual_start_at=COALESCE(${patch.actualStartAt ?? null}::BIGINT, actual_start_at),
              actual_end_at=COALESCE(${patch.actualEndAt ?? null}::BIGINT, actual_end_at),
              end_at=COALESCE(${patch.endAt ?? null}::BIGINT, end_at),
              paused_at=CASE WHEN ${hasPausedAt} THEN ${pausedAtValue}::BIGINT ELSE paused_at END,
              paused_ms=COALESCE(${patch.pausedMs ?? null}::BIGINT, paused_ms),
              updated_at=${now}, version=version+1
            WHERE id=${recordId} AND EXISTS (SELECT 1 FROM logged)
            RETURNING *
          `,
          projectCurrentExamRecords(transaction),
        ]);
        const updatedRows = (transitionResults[1] ?? []) as unknown as RecordRow[];
        if (updatedRows[0]) {
          result = { record: recordJson(updatedRows[0], now) };
        } else if (idempotencyKey) {
          // 幂等键竞争失败：另一个同键请求已经写成功，回放它的结果。
          const replayRows = (await sql`SELECT * FROM exam_records WHERE id=${recordId}`) as unknown as RecordRow[];
          if (!replayRows[0]) throw new Error('DATA_CONFLICT');
          result = { record: recordJson(replayRows[0], now), idempotent: true };
        } else {
          throw new Error('DATA_CONFLICT');
        }
      }
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (message === 'RECORD_NOT_FOUND_OR_FORBIDDEN') {
      error(res, 404, 'RECORD_NOT_FOUND', '考试记录不存在或无权访问');
      return;
    }
    if (message === 'IDEMPOTENCY_KEY_REUSED') {
      error(res, 409, 'IDEMPOTENCY_KEY_REUSED', '幂等键已用于另一场考试');
      return;
    }
    if (message === 'INVALID_PERSISTED_STATUS' || message === 'INVALID_STATUS_TRANSITION') {
      error(res, 409, 'INVALID_STATUS_TRANSITION', '当前考试状态不允许执行此操作');
      return;
    }
    if (message === 'RECORD_NOT_IN_SNAPSHOT') {
      error(res, 409, 'RECORD_NOT_IN_SNAPSHOT', '考试运行投影已不在当前快照中');
      return;
    }
    if (message === 'DATA_CONFLICT') {
      error(res, 409, 'DATA_CONFLICT', '云端数据已发生变化，请刷新后重试');
      return;
    }
    if (missingRelation(caught)) {
      await ensureTableOnce();
      error(res, 503, 'SCHEMA_RETRY_REQUIRED', '数据库结构正在初始化，请重试');
      return;
    }
    throw caught;
  }
  await writeAudit(actor, `exam.record.${action}`, 'exam_record', recordId, {
    status: result.record.status,
    idempotent: result.idempotent === true,
    ...(reason ? { reason } : {}),
  });
  res.status(200).json({ ok: true, data: result.record, idempotent: result.idempotent === true });
}

export async function handleExamRecordRoute(req: VercelRequest, res: VercelResponse, actionName = ''): Promise<void> {
  if (req.method === 'GET' && text(req.query?.resource) === 'records') {
    await handleRecordList(req, res);
    return;
  }
  if (req.method === 'GET' && text(req.query?.resource) === 'record-operations') {
    await handleRecordOperations(req, res);
    return;
  }
  const action = ACTION_BY_NAME[actionName || text(req.body?.action)];
  if (!action) {
    error(res, 400, 'UNKNOWN_RECORD_ACTION', '未知的考试记录操作');
    return;
  }
  await handleRecordAction(req, res, action);
}
