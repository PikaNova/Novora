import type { MajorExam } from '../../src/types/index.js';
import type { SqlTx } from '../_dbAdapter.js';
import type { ExamRecordStatus } from '../../src/shared/examRecordContracts.js';
import { examWindowFromItems } from '../../src/utils/examWindow.js';

export type ExamRecordProjection = {
  id: string;
  runtimeMajorId: string;
  name: string;
  description: string;
  status: ExamRecordStatus;
  items: unknown[];
  targetGradeIds: string[];
  targetClassIds: string[];
  source: 'regular' | 'quick';
  temporary: boolean;
  priorityOverSchedule: boolean;
  config: Record<string, unknown>;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
  startAt: number | null;
  endAt: number | null;
  actualStartAt: number | null;
  actualEndAt: number | null;
  pausedAt?: number | null;
  pausedMs?: number;
  publishedAt: number | null;
  endedAt: number | null;
  archivedAt: number | null;
  version: number;
  sortOrder: number;
};

type MajorExtras = MajorExam & {
  /**
   * 复制出来的考试在快照上带 `draft: true`，投影据此强制留在草稿，
   * 直到管理员真的执行「发布」——发布动作会删掉这个标记。
   */
  draft?: unknown;
  description?: unknown;
  config?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  actualStartAt?: unknown;
  actualEndAt?: unknown;
  pausedAt?: unknown;
  pausedMs?: unknown;
  publishedAt?: unknown;
  archivedAt?: unknown;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function idList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function config(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function initialStatus(major: MajorExtras): ExamRecordStatus {
  if (major.endedAt != null || finiteNumber(major.actualEndAt) != null) return 'ended';
  // 复制考试强制进草稿：即使科目时间齐全也不自动发布。
  if (major.draft === true) return 'draft';
  // 快速考试一直是直发。
  if (major.source === 'quick' || major.temporary === true) return 'published';
  // 创建即发布：科目时间完整的整场大型考试直接进入「已发布」，不再需要人点发布按钮。
  // 还没填时间的（例如刚建完、向导里还没来得及填科目）仍留 draft，
  // 免得造出「已发布但没有时间」、永远停在「待开始」的考试。
  // 时间窗优先看快照上显式写的 startAt/endAt（向导确认时会写），其次用科目推断。
  const window = examWindowFromItems(Array.isArray(major.items) ? major.items : []);
  const startAt = finiteNumber(major.startAt) ?? window.start;
  const endAt = finiteNumber(major.endAt) ?? window.end;
  return startAt != null && endAt != null ? 'published' : 'draft';
}

export function buildExamRecordProjection(
  major: MajorExam,
  index: number,
  now: number,
  snapshotUpdatedAt: number,
): ExamRecordProjection {
  const source = major as MajorExtras;
  const createdAt = finiteNumber(source.createdAt) ?? now;
  const endedAt = finiteNumber(source.endedAt);
  return {
    id: text(source.id),
    runtimeMajorId: text(source.id),
    name: text(source.name),
    description: text(source.description),
    status: initialStatus(source),
    items: Array.isArray(source.items) ? source.items : [],
    targetGradeIds: idList(source.targetGradeIds),
    targetClassIds: idList(source.targetClassIds),
    source: source.source === 'quick' ? 'quick' : 'regular',
    temporary: source.temporary === true,
    priorityOverSchedule: source.priorityOverSchedule === true,
    config: config(source.config),
    createdBy: finiteNumber(source.createdBy),
    createdAt,
    updatedAt: snapshotUpdatedAt > 0 ? snapshotUpdatedAt : now,
    startAt: finiteNumber(source.startAt),
    endAt: finiteNumber(source.endAt),
    actualStartAt: finiteNumber(source.actualStartAt),
    actualEndAt: finiteNumber(source.actualEndAt),
    pausedAt: finiteNumber(source.pausedAt),
    pausedMs: finiteNumber(source.pausedMs) ?? 0,
    publishedAt: finiteNumber(source.publishedAt),
    endedAt,
    archivedAt: finiteNumber(source.archivedAt),
    version: 1,
    sortOrder: typeof source.order === 'number' && Number.isFinite(source.order) ? source.order : index,
  };
}

/**
 * Upserts the projection without deleting records absent from the current snapshot.
 *
 * 状态合并规则：`archived` 优先保留，因为已归档的考试在快照里仍然带着 `endedAt`，
 * 若先判 EXCLUDED 就会被投影立刻改回 `ended`，归档动作等于无效；只有 unarchive
 * 会在同一事务里显式把状态写回 `ended`，那时 `exam_records.status` 已不是 archived。
 */
export function projectExamRecords(
  transaction: SqlTx,
  majors: MajorExam[],
  now: number,
  snapshotUpdatedAt: number,
): Array<Promise<Array<Record<string, unknown>>>> {
  const records = majors
    .map((major, index) => buildExamRecordProjection(major, index, now, snapshotUpdatedAt))
    .filter((record) => record.id.length > 0);
  return records.map(
    (record) => transaction`
        INSERT INTO exam_records (
          id, runtime_major_id, name, description, status, items,
          target_grade_ids, target_class_ids, source, temporary,
          priority_over_schedule, config, created_by, created_at, updated_at,
          start_at, end_at, actual_start_at, actual_end_at, paused_at, paused_ms, published_at,
          ended_at, archived_at, version, sort_order
        ) VALUES (
          ${record.id}, ${record.runtimeMajorId}, ${record.name}, ${record.description}, ${record.status},
          ${JSON.stringify(record.items)}::jsonb, ${JSON.stringify(record.targetGradeIds)}::jsonb,
          ${JSON.stringify(record.targetClassIds)}::jsonb, ${record.source}, ${record.temporary},
          ${record.priorityOverSchedule}, ${JSON.stringify(record.config)}::jsonb, ${record.createdBy},
          ${record.createdAt}, ${record.updatedAt}, ${record.startAt}, ${record.endAt},
          ${record.actualStartAt}, ${record.actualEndAt}, ${record.pausedAt ?? null}, ${record.pausedMs ?? 0}, ${record.publishedAt}, ${record.endedAt},
          ${record.archivedAt}, ${record.version}, ${record.sortOrder}
        )
        ON CONFLICT (id) DO UPDATE SET
          runtime_major_id = EXCLUDED.runtime_major_id,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          items = EXCLUDED.items,
          target_grade_ids = EXCLUDED.target_grade_ids,
          target_class_ids = EXCLUDED.target_class_ids,
          source = EXCLUDED.source,
          temporary = EXCLUDED.temporary,
          priority_over_schedule = EXCLUDED.priority_over_schedule,
          config = EXCLUDED.config,
          status = CASE
            WHEN exam_records.status = 'archived' THEN 'archived'
            WHEN EXCLUDED.status = 'ended' THEN 'ended'
            WHEN exam_records.status = 'draft' AND EXCLUDED.status = 'published' THEN 'published'
            ELSE exam_records.status
          END,
          created_by = COALESCE(exam_records.created_by, EXCLUDED.created_by),
          created_at = LEAST(exam_records.created_at, EXCLUDED.created_at),
          updated_at = EXCLUDED.updated_at,
          sort_order = EXCLUDED.sort_order
      `,
  );
}

/** Rebuilds current snapshot records inside the same transaction as a snapshot update. */
export function projectCurrentExamRecords(transaction: SqlTx): Promise<Array<Record<string, unknown>>> {
  return transaction`
    WITH records AS (
      SELECT item.major, item.ordinality::int - 1 AS sort_order, ed.updated_at AS snapshot_updated_at
      FROM exam_data ed
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ed.majors) = 'array' THEN ed.majors ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS item(major, ordinality)
      WHERE ed.id = 1
    )
    INSERT INTO exam_records (
      id, runtime_major_id, name, description, status, items,
      target_grade_ids, target_class_ids, source, temporary,
      priority_over_schedule, config, created_by, created_at, updated_at,
      start_at, end_at, actual_start_at, actual_end_at, published_at,
      ended_at, archived_at, version, sort_order
    )
    SELECT
      major->>'id', major->>'id', COALESCE(major->>'name', ''), COALESCE(major->>'description', ''),
      CASE
        WHEN COALESCE(major->>'endedAt', '') <> '' OR COALESCE(major->>'actualEndAt', '') <> '' THEN 'ended'
        -- 复制考试强制进草稿（快照上的 draft 标记由发布动作清除）。
        WHEN COALESCE(major->>'draft', 'false') = 'true' THEN 'draft'
        WHEN major->>'source' = 'quick' OR major->>'temporary' = 'true' THEN 'published'
        -- 创建即发布：科目时间完整（显式窗口或科目推算）的整场大型考试直接已发布；
        -- 还没填时间的仍留草稿，避免造出「已发布但没时间」的考试。
        -- 这里的判定必须与 buildExamRecordProjection 的 initialStatus 保持一致。
        WHEN COALESCE(major->>'startAt', '') ~ '^-?[0-9]+$'
             AND COALESCE(major->>'endAt', '') ~ '^-?[0-9]+$' THEN 'published'
        WHEN COALESCE(major->'items', '[]'::jsonb) @> '[{"enabled":true}]'::jsonb THEN (
          -- 有启用科目时按科目时间推算窗口（任一启用科目起止齐全即可发布）
          CASE WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(major->'items') = 'array' THEN major->'items' ELSE '[]'::jsonb END
            ) AS exam_item(value)
            WHERE COALESCE((exam_item.value->>'enabled')::boolean, FALSE)
              AND COALESCE(exam_item.value->>'startTime', '') <> ''
              AND COALESCE(exam_item.value->>'endTime', '') <> ''
          ) THEN 'published' ELSE 'draft' END
        )
        ELSE 'draft'
      END,
      CASE WHEN jsonb_typeof(major->'items') = 'array' THEN major->'items' ELSE '[]'::jsonb END,
      CASE WHEN jsonb_typeof(major->'targetGradeIds') = 'array' THEN major->'targetGradeIds' ELSE '[]'::jsonb END,
      CASE WHEN jsonb_typeof(major->'targetClassIds') = 'array' THEN major->'targetClassIds' ELSE '[]'::jsonb END,
      CASE WHEN major->>'source' = 'quick' THEN 'quick' ELSE 'regular' END,
      COALESCE(major->>'temporary', 'false') = 'true',
      COALESCE(major->>'priorityOverSchedule', 'false') = 'true',
      CASE WHEN jsonb_typeof(major->'config') = 'object' THEN major->'config' ELSE '{}'::jsonb END,
      CASE WHEN major->>'createdBy' ~ '^-?[0-9]+$' THEN (major->>'createdBy')::bigint END,
      CASE WHEN major->>'createdAt' ~ '^-?[0-9]+$' THEN (major->>'createdAt')::bigint ELSE snapshot_updated_at END,
      snapshot_updated_at,
      CASE WHEN major->>'startAt' ~ '^-?[0-9]+$' THEN (major->>'startAt')::bigint END,
      CASE WHEN major->>'endAt' ~ '^-?[0-9]+$' THEN (major->>'endAt')::bigint END,
      CASE WHEN major->>'actualStartAt' ~ '^-?[0-9]+$' THEN (major->>'actualStartAt')::bigint END,
      CASE WHEN major->>'actualEndAt' ~ '^-?[0-9]+$' THEN (major->>'actualEndAt')::bigint END,
      CASE WHEN major->>'publishedAt' ~ '^-?[0-9]+$' THEN (major->>'publishedAt')::bigint END,
      CASE WHEN major->>'endedAt' ~ '^-?[0-9]+$' THEN (major->>'endedAt')::bigint END,
      CASE WHEN major->>'archivedAt' ~ '^-?[0-9]+$' THEN (major->>'archivedAt')::bigint END,
      1, sort_order
    FROM records
    WHERE NULLIF(major->>'id', '') IS NOT NULL
    ON CONFLICT (id) DO UPDATE SET
      runtime_major_id = EXCLUDED.runtime_major_id,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      items = EXCLUDED.items,
      target_grade_ids = EXCLUDED.target_grade_ids,
      target_class_ids = EXCLUDED.target_class_ids,
      source = EXCLUDED.source,
      temporary = EXCLUDED.temporary,
      priority_over_schedule = EXCLUDED.priority_over_schedule,
      config = EXCLUDED.config,
      status = CASE
        WHEN exam_records.status = 'archived' THEN 'archived'
        WHEN EXCLUDED.status = 'ended' THEN 'ended'
        WHEN exam_records.status = 'draft' AND EXCLUDED.status = 'published' THEN 'published'
        ELSE exam_records.status
      END,
      updated_at = EXCLUDED.updated_at,
      start_at = EXCLUDED.start_at,
      end_at = EXCLUDED.end_at,
      -- 运行时字段只有记录层知道（系统自动开考、申请停止都只写 exam_records），
      -- 快照里通常没有这些值：只能向上补，不能被快照的 NULL 冲掉，否则一次普通保存
      -- 就会把「已开考 / 停止中」抹掉（表现为同一条记录出现两次 auto_start）。
      actual_start_at = COALESCE(EXCLUDED.actual_start_at, exam_records.actual_start_at),
      actual_end_at = COALESCE(EXCLUDED.actual_end_at, exam_records.actual_end_at),
      published_at = COALESCE(EXCLUDED.published_at, exam_records.published_at),
      ended_at = COALESCE(EXCLUDED.ended_at, exam_records.ended_at),
      -- 快照里没有 archivedAt（例如旧客户端整行覆盖保存）时保留已有值：
      -- 否则会出现 status='archived' 但 archived_at 为空的矛盾状态。反归档由动作路由显式置 NULL。
      archived_at = COALESCE(EXCLUDED.archived_at, exam_records.archived_at),
      sort_order = EXCLUDED.sort_order
  `;
}
