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
import { advanceExamLifecycle } from '../examAutoLifecycle.js';
import { applyOperationPatchToMajor } from '../examSnapshotPatch.js';
import { buildExamRecordProjection, projectCurrentExamRecords } from '../examRecordProjection.js';
import { operationLogKey } from '../operationLog.js';
import { asRecord } from '../../../src/shared/typeGuards.js';
import type { MajorExam } from '../../../src/types/index.js';
import {
  EXAM_RECORD_ACTION_PERMISSIONS,
  examRecordDisplayStatus,
  isExamRecordStatus,
  transitionExamRecordStatus,
  type ExamRecordAction,
  type ExamRecordActionName,
  type ExamRecordDisplayStatus,
  type ExamRecordStatus,
} from '../../../src/shared/examRecordContracts.js';
import { addDaysToDateKey, getShanghaiDateKey } from '../../../src/utils/weeklySchedule.js';
import { formatDateTimeInZone, parseZonedTime } from '../../../src/utils/zonedTime.js';
import { DEVICE_ONLINE_WINDOW_MS } from '../../../src/shared/deviceContracts.js';
import {
  planExamOperation,
  planStopRequest,
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
  /** 读列表 / 读单条时顺带取出的创建人显示名（详情抽屉展示用）。 */
  created_by_name?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  start_at?: unknown;
  end_at?: unknown;
  actual_start_at?: unknown;
  actual_end_at?: unknown;
  paused_at?: unknown;
  paused_ms?: unknown;
  stop_requested_at?: unknown;
  published_at?: unknown;
  ended_at?: unknown;
  archived_at?: unknown;
  version?: unknown;
  sort_order?: unknown;
  /** 列表里带出的最近一次操作（P1-⑤「时间已调整」提示用）。 */
  last_op_action?: unknown;
  last_op_reason?: unknown;
  last_op_at?: unknown;
};

type SnapshotRow = { majors?: unknown; active_major_id?: unknown; updated_at?: unknown };

/** 路由层动作 = 状态机动作 + 只改时间字段的生命周期操作 + 停止申请/强制结束。 */
type RecordOperationAction = Extract<ExamOperationAction, 'pause' | 'resume' | 'extend'>;
type RecordRouteAction = ExamRecordAction | RecordOperationAction | 'request_stop' | 'force_end';

const OPERATION_ACTIONS: readonly string[] = ['pause', 'resume', 'extend'];

function isOperationAction(value: string): value is RecordOperationAction {
  return OPERATION_ACTIONS.includes(value);
}

const ACTION_BY_NAME: Record<string, RecordRouteAction> = {
  'record-publish': 'publish',
  'record-end': 'end',
  'record-archive': 'archive',
  'record-unarchive': 'unarchive',
  'record-copy': 'copy',
  'record-pause': 'pause',
  'record-resume': 'resume',
  'record-extend': 'extend',
  'record-request-stop': 'request_stop',
  'record-force-end': 'force_end',
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
  // 派生规则收在 shared：按 actualStartAt 判断进行中（系统自动开考会写它），
  // 申请停止后优先显示「停止中」。以前按计划时间窗判断，会出现
  // 「界面显示进行中、但实际开考时间是空」的不一致。
  return examRecordDisplayStatus(
    {
      status: recordStatus(row) ?? 'draft',
      actualStartAt: nullableNumber(row.actual_start_at),
      stopRequestedAt: nullableNumber(row.stop_requested_at),
    },
    now,
  );
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
    // 创建人姓名：详情抽屉要显示「谁建的」，而不是一个 #id。读不到用户（老数据 / 用户已删）时给空串，
    // 由前端回退成 #id。
    createdByName: text(row.created_by_name),
    createdAt: number(row.created_at),
    updatedAt: number(row.updated_at),
    startAt: nullableNumber(row.start_at),
    endAt: nullableNumber(row.end_at),
    actualStartAt: nullableNumber(row.actual_start_at),
    actualEndAt: nullableNumber(row.actual_end_at),
    pausedAt: nullableNumber(row.paused_at),
    pausedMs: nullableNumber(row.paused_ms) ?? 0,
    stopRequestedAt: nullableNumber(row.stop_requested_at),
    publishedAt: nullableNumber(row.published_at),
    endedAt: nullableNumber(row.ended_at),
    archivedAt: nullableNumber(row.archived_at),
    // P1-⑤：最近一次操作（列表用来显示「时间已调整」，鼠标悬停看具体新旧时间）。
    lastOperation: text(row.last_op_action)
      ? {
          action: text(row.last_op_action),
          reason: text(row.last_op_reason),
          at: number(row.last_op_at),
        }
      : null,
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
    stopRequestedAt: nullableNumber(row.stop_requested_at),
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
  // 时间窗：考试安排页一次取整窗（本周/未来两周），窗口内不再分页，避免同一分组被切成两页。
  const fromRaw = text(req.query?.from).trim();
  const toRaw = text(req.query?.to).trim();
  const fromValue = Number(fromRaw);
  const toValue = Number(toRaw);
  const hasWindow =
    fromRaw !== '' &&
    toRaw !== '' &&
    Number.isFinite(fromValue) &&
    Number.isFinite(toValue) &&
    fromValue > 0 &&
    toValue > fromValue;
  // 未定时间的考试（start_at 为空）不属于任何一天，按需单独带出来放进「待排期」。
  const includeUnscheduled = text(req.query?.includeUnscheduled).trim() === '1';
  if ((fromRaw !== '' || toRaw !== '') && !hasWindow) {
    error(res, 400, 'INVALID_WINDOW', '无效的时间窗');
    return;
  }
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
  // 读列表前先推进系统自动流程：到点的自动开考、申请停止的判定是否该结束。
  await advanceExamLifecycle(now);
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
        actual_start_at, actual_end_at, paused_at, paused_ms, stop_requested_at, published_at, ended_at, archived_at,
        version, sort_order
        -- 创建人姓名用相关子查询取，不 JOIN app_users：那张表也有 created_at/updated_at/靠前的同名列，
        -- 一旦并进来，上面这些裸列名就会再次变成二义（42702）。
        , (SELECT COALESCE(NULLIF(creator.display_name, ''), creator.username, '')
           FROM app_users AS creator WHERE creator.id = exam_records.created_by) AS created_by_name
        , last_op.action AS last_op_action, last_op.reason AS last_op_reason, last_op.op_created_at AS last_op_at
      FROM exam_records
      -- 列表里的「时间已调整」提示读最近一次操作（extend/pause/resume/auto_* 等）
      LEFT JOIN LATERAL (
        -- 输出列不能叫 created_at：外层 exam_records 也有同名列，
        -- 一旦重名，SELECT 列表里的裸 created_at 就会 42702 歧义报错。
        SELECT action, reason, created_at AS op_created_at
        FROM exam_record_operations
        WHERE source_record_id = exam_records.id
        -- 必须限定到本子查询的表：外层 exam_records 也有 created_at，裸写会 42702 歧义报错。
        ORDER BY exam_record_operations.created_at DESC
        LIMIT 1
      ) AS last_op ON TRUE
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
            -- 与 examRecordDisplayStatus 保持同一口径：申请停止优先显示「停止中」，
            -- 进行中看的是实际开考时间（系统自动开考会写它），不再按计划时间窗推断。
            WHEN status = 'published' AND stop_requested_at IS NOT NULL THEN 'stopping'
            WHEN status = 'published' AND actual_start_at IS NOT NULL THEN 'ongoing'
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
        AND (${hasWindow}::boolean = FALSE
          OR (start_at IS NOT NULL AND start_at >= ${fromValue}::bigint AND start_at < ${toValue}::bigint)
          OR (${includeUnscheduled}::boolean AND start_at IS NULL))
        AND (${presetFilter}::text = '' OR (
          CASE ${presetFilter}::text
            WHEN 'current' THEN (
              status = 'published' AND (
                -- 停止中（等系统判定）与已经开考（含暂停中）都算「当前」；
                -- 开考看的是实际开考时间——系统按计划时间自动写，不再按计划窗口推断。
                stop_requested_at IS NOT NULL
                OR actual_start_at IS NOT NULL
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
        -- 记录层是快照的单向投影，而投影只增不删：考试从快照里被删掉后，exam_records 会留下孤儿行。
        -- 因此任何板块、任何筛选都只展示"快照里仍然存在"的考试（以前只有草稿板块这么过滤，
        -- 于是删掉的考试会继续留在当前/安排/历史/全部这些视图里）。数据侧清理见
        -- scripts/purge-orphan-exam-records.cjs。
        AND EXISTS (
          SELECT 1 FROM exam_data AS snapshot
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(snapshot.majors) = 'array' THEN snapshot.majors ELSE '[]'::jsonb END
          ) AS major(value)
          WHERE snapshot.id = 1 AND major.value->>'id' = exam_records.id
        )
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
/**
 * 按考试范围统计绑定设备与最近在线设备。
 * 发布前检查（T-286-01）与发布记录（T-286-02）共用这一份口径，避免两处各算一套。
 */
async function deviceScopeStats(
  sql: ReturnType<typeof database>,
  gradeIds: string[],
  classIds: string[],
  now: number,
): Promise<{ bound: number; online: number; stale: number; allScope: boolean }> {
  const allScope = gradeIds.length === 0 && classIds.length === 0;
  const rows = (await sql`
    SELECT
      count(*)::int AS bound,
      count(*) FILTER (WHERE last_seen_at >= ${now - DEVICE_ONLINE_WINDOW_MS})::int AS online
    FROM device_instances
    WHERE revoked = FALSE
      AND (${allScope}::boolean OR grade_id = ANY(${gradeIds}::text[]) OR class_id = ANY(${classIds}::text[]))
  `) as unknown as Array<{ bound?: unknown; online?: unknown }>;
  const bound = number(rows[0]?.bound, 0);
  const online = number(rows[0]?.online, 0);
  return { bound, online, stale: Math.max(0, bound - online), allScope };
}

/**
 * 投影一致性自检（设计 §3.2 遗留项）。
 * `exam_data.majors` 是权威，`exam_records` 是单向投影；这里用**同一个投影函数**重算一遍
 * 应得的结果，和库里实际的行逐字段比对，回答三个问题：
 *   ① 快照里有、投影里没有的（漏投影）  ② 投影里有、快照里已经没有的（孤儿行）
 *   ③ 两边都有但关键字段对不上的（漂移）
 * 只读接口，不改数据；返回最多 20 条示例，避免大库把响应撑爆。
 */
async function handleRecordConsistency(req: VercelRequest, res: VercelResponse): Promise<void> {
  const actor = await requireActor(req, res, 'major.read');
  if (!actor) return;
  await ensureTableOnce();
  const sql = database();
  const now = Date.now();
  const snapshotRows = (await sql`SELECT majors, updated_at FROM exam_data WHERE id=1`) as unknown as SnapshotRow[];
  const snapshot = snapshotRows[0] ?? {};
  const snapshotUpdatedAt = number(snapshot.updated_at, now);
  const majors = Array.isArray(snapshot.majors) ? snapshot.majors.map((raw) => ({ ...asRecord(raw) })) : [];
  const recordRows = (await sql`SELECT * FROM exam_records`) as unknown as RecordRow[];

  const recordById = new Map<string, RecordRow>();
  for (const row of recordRows) recordById.set(text(row.id), row);

  const missingProjection: string[] = [];
  const drifted: Array<{ id: string; fields: string[] }> = [];
  let runtimeAheadCount = 0;
  const snapshotIds = new Set<string>();
  const compareKeys: Array<[string, keyof ReturnType<typeof buildExamRecordProjection>]> = [
    ['name', 'name'],
    ['status', 'status'],
    ['startAt', 'startAt'],
    ['endAt', 'endAt'],
    ['archivedAt', 'archivedAt'],
  ];
  majors.forEach((major, index) => {
    const id = text(major.id);
    if (!id) return;
    snapshotIds.add(id);
    const row = recordById.get(id);
    if (!row) {
      missingProjection.push(id);
      return;
    }
    const expected = buildExamRecordProjection(major as unknown as MajorExam, index, now, snapshotUpdatedAt);
    const fields: string[] = [];
    for (const [label, key] of compareKeys) {
      const actual =
        key === 'name'
          ? text(row.name)
          : key === 'status'
            ? text(row.status)
            : key === 'startAt'
              ? nullableNumber(row.start_at)
              : key === 'endAt'
                ? nullableNumber(row.end_at)
                : nullableNumber(row.archived_at);
      const wanted = expected[key] as string | number | null;
      // 运行时推进会让投影**领先**快照：draft→published→ended→archived 是单向的，
      // 系统开考/判定结束/自动归档都只在前者留下痕迹（快照的 endedAt/archivedAt 随后补齐）。
      // 这类单独计数，不算漂移；只有"投影落后或字段对不上"才是真漂移。
      if (key === 'status') {
        const rank: Record<string, number> = { draft: 0, published: 1, ended: 2, archived: 3 };
        const actualRank = rank[String(actual)] ?? -1;
        const wantedRank = rank[String(wanted)] ?? -1;
        if (actualRank > wantedRank) {
          runtimeAheadCount += 1;
          continue;
        }
      }
      if (key === 'archivedAt' && actual != null && wanted == null) {
        runtimeAheadCount += 1;
        continue;
      }
      if (actual !== wanted) fields.push(label);
    }
    if (fields.length) drifted.push({ id, fields });
  });
  const orphaned = recordRows.map((row) => text(row.id)).filter((id) => id && !snapshotIds.has(id));

  res.status(200).json({
    ok: true,
    data: {
      checkedAt: now,
      majorsCount: majors.length,
      recordsCount: recordRows.length,
      missingProjectionCount: missingProjection.length,
      orphanedCount: orphaned.length,
      driftedCount: drifted.length,
      runtimeAheadCount,
      missingProjection: missingProjection.slice(0, 20),
      orphaned: orphaned.slice(0, 20),
      drifted: drifted.slice(0, 20),
    },
  });
}

/**
 * P1-⑤ 时间变更提示：把「这次操作把哪个时间从多少改到了多少」写成一句人话。
 * 这句话进操作日志（详情页的新旧对比与审计都读它），列表页据此显示「时间已调整」。
 */
function describeTimeChange(
  action: ExamRecordActionName,
  before: { endAt: number | null },
  patch: ExamOperationPatch,
  now: number,
  extendMinutes: number,
): string {
  const fmt = (value: number | null | undefined) => (value == null ? '—' : formatDateTimeInZone(value));
  if (action === 'extend') {
    return `延长 ${extendMinutes} 分钟：结束 ${fmt(before.endAt)} → ${fmt(patch.endAt ?? before.endAt)}`;
  }
  if (action === 'pause') return '暂停：结束时间按实际暂停时长顺延';
  if (action === 'resume') {
    const pausedMs = patch.pausedMs ?? 0;
    const nextEnd = before.endAt == null ? null : before.endAt + pausedMs;
    return `继续：累计暂停 ${Math.round(pausedMs / 60_000)} 分钟，结束 ${fmt(before.endAt)} → ${fmt(nextEnd)}`;
  }
  if (action === 'end' || action === 'force_end') return `结束：实际结束 ${fmt(patch.actualEndAt ?? now)}`;
  if (action === 'request_stop') return `申请停止：${formatDateTimeInZone(now)} 提交，等系统判定`;
  return '';
}

/**
 * 发布前检查（T-286-01）。用户口径：**只做提示，不阻断发布**——
 * 返回科目时间完整性与目标范围设备在线情况，前端把 warnings 显示出来即可。
 */
async function handleRecordPrecheck(req: VercelRequest, res: VercelResponse): Promise<void> {
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
  const record = rows[0];
  const gradeIds = stringList(record.target_grade_ids);
  const classIds = stringList(record.target_class_ids);
  const now = Date.now();
  const devices = await deviceScopeStats(sql, gradeIds, classIds, now);
  const items = Array.isArray(record.items) ? (record.items as unknown[]).map((raw) => asRecord(raw)) : [];
  const enabled = items.filter((item) => item.enabled !== false);
  const missingTime = enabled.filter((item) => !text(item.startTime) || !text(item.endTime)).length;

  const warnings: string[] = [];
  if (!enabled.length) warnings.push('没有启用的科目');
  if (missingTime > 0) warnings.push(`${missingTime} 个启用科目缺少起止时间`);
  if (!devices.bound) warnings.push('目标范围还没有绑定设备，发布后教室端不会收到');
  else if (!devices.online) warnings.push(`目标范围 ${devices.bound} 台设备最近都没有心跳，发布后要等设备上线才会收到`);
  else if (devices.stale > 0)
    warnings.push(`目标范围 ${devices.bound} 台设备里有 ${devices.stale} 台最近没有心跳，它们上线后才会收到`);

  res.status(200).json({
    ok: true,
    data: {
      recordId,
      status: recordStatus(record) ?? 'draft',
      scope: { gradeIds, classIds, allScope: devices.allScope },
      devices: { bound: devices.bound, online: devices.online, stale: devices.stale },
      items: { total: items.length, enabled: enabled.length, missingTime },
      warnings,
    },
  });
}

/**
 * 按 id 读单场考试记录（考试详情抽屉自己取数用）。
 *
 * 为什么需要它：详情抽屉以前是在「当前板块列表页那一页数据」里按 id 找记录，找不到就
 * 整个抽屉不渲染——表现是点「详情」毫无反应。而「考试安排」的日程轴/班级网格的行来自
 * 本地快照，覆盖 current/history 等其它板块（例如进行中的考试属「当前考试」），
 * 于是这些行永远点不开。现在抽屉按 id 直接向服务端要这一条，跟行来自哪个板块无关。
 */
async function handleRecordGet(req: VercelRequest, res: VercelResponse): Promise<void> {
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
  // 与列表同一个口径：读之前先推进系统流程（到点自动开考、申请停止的判定），
  // 否则详情里的状态可能比列表慢一拍。
  await advanceExamLifecycle(Date.now());
  const sql = database();
  const rows = (await sql`
    SELECT exam_records.*,
      (SELECT COALESCE(NULLIF(creator.display_name, ''), creator.username, '')
         FROM app_users AS creator WHERE creator.id = exam_records.created_by) AS created_by_name
    FROM exam_records WHERE id=${recordId}
      -- 与列表同一个口径：只认快照里还在的考试，删掉的考试不该还能被详情抽屉打开
      -- （exam_records 里的孤儿行只是投影残留，见 scripts/purge-orphan-exam-records.cjs）。
      AND EXISTS (
        SELECT 1 FROM exam_data AS snapshot
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(snapshot.majors) = 'array' THEN snapshot.majors ELSE '[]'::jsonb END
        ) AS major(value)
        WHERE snapshot.id = 1 AND major.value->>'id' = exam_records.id
      )
  `) as unknown as RecordRow[];
  if (!rows[0] || !actorCanAccessRecord(actor, rows[0])) {
    error(res, 404, 'RECORD_NOT_FOUND', '考试记录不存在或无权访问');
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({ ok: true, data: recordJson(rows[0], Date.now()) });
}

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
  // 打开详情页时同样推进一次：保证「实际开考时间」「是否已结束」在详情里立刻可见。
  const detailNow = Date.now();
  await advanceExamLifecycle(detailNow);
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
    // 复制结果一律先落草稿：投影认这个标记，管理员改完再点「发布」才生效。
    draft: true,
    createdBy: actorId,
    createdAt: now,
  };
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
  // 发布记录（T-286-02）：这次发布投给了哪些范围、命中多少设备，随审计一起落库。
  let publishScope: Record<string, unknown> | undefined;
  // P1-⑤：操作日志里的说明文案 = 时间变更说明（+ 用户备注），详情页据此展示新旧对比。
  let logReason = reason;
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
      if (action === 'publish') {
        const scopeGradeIds = stringList(record.target_grade_ids);
        const scopeClassIds = stringList(record.target_class_ids);
        const stats = await deviceScopeStats(sql, scopeGradeIds, scopeClassIds, now);
        publishScope = {
          gradeIds: scopeGradeIds,
          classIds: scopeClassIds,
          allScope: stats.allScope,
          devicesBound: stats.bound,
          devicesOnline: stats.online,
        };
      }
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
              -- 复制出来的是全新草稿：暂停状态不继承，否则复制体一出生就带着暂停时长。
              ${copyProjection.actualStartAt}, ${copyProjection.actualEndAt}, NULL, 0,
              ${copyProjection.publishedAt}, ${copyProjection.endedAt},
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
        } else if (action === 'request_stop') {
          // 手动结束只留申请：真正落 ended 由系统判定（到点优先 → 全员回执 → 无设备宽限）。
          const plan = planStopRequest(planInput(record), now);
          if (!plan.ok) {
            const message =
              plan.reason === 'already-requested' ? '这场考试已经申请停止了，等系统判定即可' : '当前状态不能申请停止';
            error(res, 409, 'ILLEGAL_STATE', message);
            return;
          }
          nextStatus = currentStatus;
          patch = plan.patch;
        } else if (action === 'force_end') {
          // 逃生门：停止申请迟迟没有被系统判定时，管理员可以强行结束。
          if (currentStatus !== 'published') throw new Error('INVALID_STATUS_TRANSITION');
          const pausedAtValue = nullableNumber(record.paused_at);
          const pausedMsValue = number(record.paused_ms);
          nextStatus = 'ended';
          patch = {
            status: 'ended',
            actualEndAt: now,
            pausedAt: null,
            pausedMs: pausedAtValue == null ? pausedMsValue : pausedMsValue + Math.max(0, now - pausedAtValue),
            stopRequestedAt: null,
          };
        } else {
          // publish 幂等：新约定下考试创建即已发布，向导确认时再点一次「保存并发布」
          // 不应该因为「已经发布」而报错。
          const alreadyPublished = action === 'publish' && currentStatus === 'published';
          const transitioned = alreadyPublished ? currentStatus : transitionExamRecordStatus(currentStatus, action);
          if (!transitioned) throw new Error('INVALID_STATUS_TRANSITION');
          nextStatus = transitioned;
          if (action === 'end') {
            // 结束动作顺带结算在途暂停时长，暂停期间不计入考试用时。
            const plan = planExamOperation(planInput(record), { action: 'end', at: now });
            if (!plan.ok) throw new Error('INVALID_STATUS_TRANSITION');
            patch = plan.patch;
          } else if (alreadyPublished) {
            patch = {};
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
          // 复制考试带 draft 标记，发布时必须清掉，否则投影会把它按回草稿。
          delete major.draft;
        } else if (action === 'end') major.endedAt = now;
        else if (action === 'archive') major.archivedAt = now;
        else if (action === 'unarchive') delete major.archivedAt;
        applyOperationPatchToMajor(major, patch);
        // P1-⑤：把时间变更写成一句人话（旧 → 新）落进操作日志；用户备注附在后面。
        const timeNote = describeTimeChange(
          action,
          { endAt: nullableNumber(record.end_at) },
          patch,
          now,
          Math.floor(Number(req.body?.minutes ?? req.body?.extendMinutes)),
        );
        logReason = [timeNote, reason ? `备注：${reason}` : ''].filter(Boolean).join('；').slice(0, 400);
        const hasPausedAt = Object.prototype.hasOwnProperty.call(patch, 'pausedAt');
        const pausedAtValue = patch.pausedAt ?? null;
        const hasStopRequestedAt = Object.prototype.hasOwnProperty.call(patch, 'stopRequestedAt');
        const stopRequestedAtValue = patch.stopRequestedAt ?? null;
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
                ${actor.id}, ${currentStatus}, ${nextStatus}, ${logReason}, ${now}
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
              stop_requested_at=CASE WHEN ${hasStopRequestedAt} THEN ${stopRequestedAtValue}::BIGINT ELSE stop_requested_at END,
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
    ...(logReason ? { reason: logReason } : {}),
    ...(publishScope ? { publishScope } : {}),
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
  if (req.method === 'GET' && text(req.query?.resource) === 'record') {
    await handleRecordGet(req, res);
    return;
  }
  if (req.method === 'GET' && text(req.query?.resource) === 'record-precheck') {
    await handleRecordPrecheck(req, res);
    return;
  }
  if (req.method === 'GET' && text(req.query?.resource) === 'record-consistency') {
    await handleRecordConsistency(req, res);
    return;
  }
  const action = ACTION_BY_NAME[actionName || text(req.body?.action)];
  if (!action) {
    error(res, 400, 'UNKNOWN_RECORD_ACTION', '未知的考试记录操作');
    return;
  }
  await handleRecordAction(req, res, action);
}
