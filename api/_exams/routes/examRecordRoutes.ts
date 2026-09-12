import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SCHEMA_MIGRATION_LOCK_ID, type AdminActor, hasPermission, requireActor, writeAudit } from '../../_auth.js';
import { acquireWriteSlotOrReject, database, ensureTableOnce, missingRelation } from '../db.js';
import { buildExamRecordProjection, projectCurrentExamRecords } from '../examRecordProjection.js';
import { asRecord } from '../../../src/shared/typeGuards.js';
import type { MajorExam } from '../../../src/types/index.js';
import {
  isExamRecordStatus,
  transitionExamRecordStatus,
  type ExamRecordAction,
  type ExamRecordDisplayStatus,
  type ExamRecordStatus,
} from '../../../src/shared/examRecordContracts.js';

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

const ACTION_BY_NAME: Record<string, ExamRecordAction> = {
  'record-publish': 'publish',
  'record-end': 'end',
  'record-archive': 'archive',
  'record-unarchive': 'unarchive',
  'record-copy': 'copy',
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

function error(res: VercelResponse, status: number, code: string, message: string): void {
  res.status(status).json({ ok: false, code, error: message });
}

function normalizePage(value: unknown): number {
  return Math.max(1, Math.min(10_000, Math.trunc(number(value, 1))));
}

function normalizePageSize(value: unknown): number {
  return Math.max(1, Math.min(100, Math.trunc(number(value, 20))));
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
  const rows = (await sql`
    SELECT id, runtime_major_id, name, description, status,
      COALESCE(jsonb_array_length(items), 0) AS item_count,
      target_grade_ids, target_class_ids, source, temporary, priority_over_schedule,
      config, created_by, created_at, updated_at, start_at, end_at,
      actual_start_at, actual_end_at, paused_at, paused_ms, published_at, ended_at, archived_at,
      version, sort_order
    FROM exam_records
    ORDER BY updated_at DESC, sort_order ASC, id ASC
  `) as unknown as RecordRow[];
  const now = Date.now();
  const filtered = rows.filter((row) => {
    if (!actorCanAccessRecord(actor, row)) return false;
    if (statusFilter && displayStatus(row, now) !== statusFilter) return false;
    if (search && !`${text(row.name)} ${text(row.id)}`.toLowerCase().includes(search)) return false;
    const targetGradeIds = stringList(row.target_grade_ids);
    const targetClassIds = stringList(row.target_class_ids);
    const schoolWide = targetGradeIds.length === 0 && targetClassIds.length === 0;
    if (
      gradeId &&
      !schoolWide &&
      !targetGradeIds.includes(gradeId) &&
      !classIds.some((id) => targetClassIds.includes(id))
    )
      return false;
    if (sourceFilter && (row.source === 'quick' ? 'quick' : 'regular') !== sourceFilter) return false;
    if (createdByValue != null && nullableNumber(row.created_by) !== createdByValue) return false;
    const startAt = nullableNumber(row.start_at);
    const endAt = nullableNumber(row.end_at);
    if (timeFilter === 'upcoming' && (startAt == null || startAt < now)) return false;
    if (timeFilter === 'past' && (endAt == null || endAt >= now)) return false;
    return true;
  });
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize).map((row) => recordJson(row, now));
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    ok: true,
    data,
    page,
    pageSize,
    total: filtered.length,
    totalPages: Math.ceil(filtered.length / pageSize),
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

async function handleRecordAction(req: VercelRequest, res: VercelResponse, action: ExamRecordAction): Promise<void> {
  if (req.method !== 'POST') {
    error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }
  const permission = action === 'copy' ? 'major.create' : action === 'archive' ? 'major.delete' : 'major.edit';
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
  if (action === 'copy' && !idempotencyKey) {
    error(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', '复制考试必须提供 Idempotency-Key');
    return;
  }
  if (!(await acquireWriteSlotOrReject(req, res))) return;
  let result: { record: Record<string, unknown>; idempotent?: boolean };
  try {
    const existingOperation =
      action === 'copy' && idempotencyKey
        ? (
            (await sql`SELECT source_record_id, result_record_id FROM exam_record_operations WHERE idempotency_key=${idempotencyKey} AND action='copy'`) as unknown as Array<{
              source_record_id?: unknown;
              result_record_id?: unknown;
            }>
          )[0]
        : undefined;
    if (existingOperation?.result_record_id) {
      const sourceRows = (await sql`SELECT * FROM exam_records WHERE id=${recordId}`) as unknown as RecordRow[];
      if (!sourceRows[0] || !actorCanAccessRecord(actor, sourceRows[0])) {
        throw new Error('RECORD_NOT_FOUND_OR_FORBIDDEN');
      }
      if (text(existingOperation.source_record_id) !== recordId) throw new Error('IDEMPOTENCY_KEY_REUSED');
      const existingRows =
        (await sql`SELECT * FROM exam_records WHERE id=${String(existingOperation.result_record_id)}`) as unknown as RecordRow[];
      if (existingRows[0] && actorCanAccessRecord(actor, existingRows[0])) {
        result = { record: recordJson(existingRows[0], now), idempotent: true };
      } else {
        throw new Error('RECORD_NOT_FOUND_OR_FORBIDDEN');
      }
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
              INSERT INTO exam_record_operations (idempotency_key, action, source_record_id, result_record_id, created_at)
              SELECT ${idempotencyKey}, 'copy', ${recordId}, ${String(nextMajor.id)}, ${now}
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
        const nextStatus = transitionExamRecordStatus(currentStatus, action);
        if (!nextStatus) throw new Error('INVALID_STATUS_TRANSITION');
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
        const transitionResults = await sql.transaction((transaction) => [
          transaction`SELECT pg_advisory_xact_lock(${SCHEMA_MIGRATION_LOCK_ID})`,
          transaction`
            WITH updated AS (
              UPDATE exam_data SET majors=${JSON.stringify(majors)}::jsonb, updated_at=${now}
              WHERE id=1 AND updated_at=${expectedVersion}::BIGINT
              RETURNING id
            )
            UPDATE exam_records SET status=${nextStatus},
              published_at=CASE WHEN ${action === 'publish'} THEN ${now} ELSE published_at END,
              ended_at=CASE WHEN ${action === 'end'} THEN ${now} ELSE ended_at END,
              archived_at=CASE WHEN ${action === 'archive'} THEN ${now} WHEN ${action === 'unarchive'} THEN NULL ELSE archived_at END,
              updated_at=${now}, version=version+1
            WHERE id=${recordId} AND EXISTS (SELECT 1 FROM updated)
            RETURNING *
          `,
          projectCurrentExamRecords(transaction),
        ]);
        const updatedRows = (transitionResults[1] ?? []) as unknown as RecordRow[];
        if (!updatedRows[0]) throw new Error('DATA_CONFLICT');
        result = { record: recordJson(updatedRows[0], now) };
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
  });
  res.status(200).json({ ok: true, data: result.record, idempotent: result.idempotent === true });
}

export async function handleExamRecordRoute(req: VercelRequest, res: VercelResponse, actionName = ''): Promise<void> {
  if (req.method === 'GET' && text(req.query?.resource) === 'records') {
    await handleRecordList(req, res);
    return;
  }
  const action = ACTION_BY_NAME[actionName || text(req.body?.action)];
  if (!action) {
    error(res, 400, 'UNKNOWN_RECORD_ACTION', '未知的考试记录操作');
    return;
  }
  await handleRecordAction(req, res, action);
}
