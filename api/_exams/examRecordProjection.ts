import type { MajorExam } from '../../src/types/index.js';
import type { SqlTx } from '../_dbAdapter.js';
import type { ExamRecordStatus } from '../../src/shared/examRecordContracts.js';

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
  publishedAt: number | null;
  endedAt: number | null;
  archivedAt: number | null;
  version: number;
  sortOrder: number;
};

type MajorExtras = MajorExam & {
  description?: unknown;
  config?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  actualStartAt?: unknown;
  actualEndAt?: unknown;
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
  return major.source === 'quick' || major.temporary === true ? 'published' : 'draft';
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
    publishedAt: finiteNumber(source.publishedAt),
    endedAt,
    archivedAt: finiteNumber(source.archivedAt),
    version: 1,
    sortOrder: typeof source.order === 'number' && Number.isFinite(source.order) ? source.order : index,
  };
}

/** Upserts the projection without deleting records absent from the current snapshot. */
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
          start_at, end_at, actual_start_at, actual_end_at, published_at,
          ended_at, archived_at, version, sort_order
        ) VALUES (
          ${record.id}, ${record.runtimeMajorId}, ${record.name}, ${record.description}, ${record.status},
          ${JSON.stringify(record.items)}::jsonb, ${JSON.stringify(record.targetGradeIds)}::jsonb,
          ${JSON.stringify(record.targetClassIds)}::jsonb, ${record.source}, ${record.temporary},
          ${record.priorityOverSchedule}, ${JSON.stringify(record.config)}::jsonb, ${record.createdBy},
          ${record.createdAt}, ${record.updatedAt}, ${record.startAt}, ${record.endAt},
          ${record.actualStartAt}, ${record.actualEndAt}, ${record.publishedAt}, ${record.endedAt},
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
        WHEN major->>'source' = 'quick' OR major->>'temporary' = 'true' THEN 'published'
        ELSE 'draft'
      END,
      CASE WHEN jsonb_typeof(major->'items') = 'array' THEN major->'items' ELSE '[]'::jsonb END,
      CASE WHEN jsonb_typeof(major->'targetGradeIds') = 'array' THEN major->'targetGradeIds' ELSE '[]'::jsonb END,
      CASE WHEN jsonb_typeof(major->'targetClassIds') = 'array' THEN major->'targetClassIds' ELSE '[]'::jsonb END,
      CASE WHEN major->>'source' = 'quick' THEN 'quick' ELSE 'regular' END,
      major->>'temporary' = 'true', major->>'priorityOverSchedule' = 'true',
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
        WHEN EXCLUDED.status = 'ended' THEN 'ended'
        WHEN exam_records.status = 'draft' AND EXCLUDED.status = 'published' THEN 'published'
        ELSE exam_records.status
      END,
      updated_at = EXCLUDED.updated_at,
      start_at = EXCLUDED.start_at,
      end_at = EXCLUDED.end_at,
      actual_start_at = EXCLUDED.actual_start_at,
      actual_end_at = EXCLUDED.actual_end_at,
      published_at = EXCLUDED.published_at,
      ended_at = EXCLUDED.ended_at,
      archived_at = EXCLUDED.archived_at,
      sort_order = EXCLUDED.sort_order
  `;
}
