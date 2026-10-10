type SqlLike = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export type ScheduleCreationKind = 'weekly' | 'temporary';

export type MajorExamLock = {
  locked: true;
  kind: ScheduleCreationKind;
  majorExamId: string;
  majorExamName: string;
  startAt: number;
  endAt: number | null;
  targetGradeIds: string[];
  targetClassIds: string[];
};

export function overlapsScope(
  lock: Pick<MajorExamLock, 'targetGradeIds' | 'targetClassIds'>,
  targetGradeIds: readonly string[] = [],
  targetClassIds: readonly string[] = [],
): boolean {
  if (!lock.targetGradeIds.length && !lock.targetClassIds.length) return true;
  if (!targetGradeIds.length && !targetClassIds.length) return true;
  return (
    lock.targetClassIds.some((id) => targetClassIds.includes(id)) ||
    lock.targetGradeIds.some((id) => targetGradeIds.includes(id))
  );
}

/**
 * 共享的服务端创建锁。大型考试已实际开考且未结束时，阻止新的周测/临时考试。
 * 传入 transaction tagged query 时可在写事务中使用，确保检查与写入处于同一把锁内。
 */
export async function findMajorExamLock(
  sql: SqlLike,
  kind: ScheduleCreationKind,
  targetGradeIds: readonly string[] = [],
  targetClassIds: readonly string[] = [],
  now = Date.now(),
): Promise<MajorExamLock | null> {
  const rows = (await sql`
    SELECT id, name, start_at, end_at, target_grade_ids, target_class_ids
    FROM exam_records
    WHERE source = 'regular'
      AND status IN ('published', 'paused')
      AND start_at IS NOT NULL AND start_at <= ${now}
      AND (end_at IS NULL OR end_at > ${now})
    ORDER BY start_at ASC, id ASC
    LIMIT 20
  `) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const lock = {
      locked: true as const,
      kind,
      majorExamId: String(row.id ?? ''),
      majorExamName: String(row.name ?? '大型考试'),
      startAt: Number(row.start_at ?? now),
      endAt: row.end_at == null ? null : Number(row.end_at),
      targetGradeIds: Array.isArray(row.target_grade_ids) ? row.target_grade_ids.map(String) : [],
      targetClassIds: Array.isArray(row.target_class_ids) ? row.target_class_ids.map(String) : [],
    };
    if (overlapsScope(lock, targetGradeIds, targetClassIds)) return lock;
  }
  return null;
}

export function creationBlockedResponse(lock: MajorExamLock) {
  return {
    code: 'MAJOR_EXAM_IN_PROGRESS',
    error: lock.kind === 'weekly' ? '大型考试进行中，暂不可新建周测' : '大型考试进行中，暂不可创建临时考试',
    majorExam: {
      id: lock.majorExamId,
      name: lock.majorExamName,
      startAt: lock.startAt,
      endAt: lock.endAt,
    },
  };
}
