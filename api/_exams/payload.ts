// api/_exams/payload.ts
// exam_data 行到 API payload 的映射。从原 api/exams.ts 抽出。

import type { ExamRow } from './types.js';
import { parseExamPayload, type ExamPayload as SharedExamPayload } from '../../src/shared/examContracts.js';
import { parseExamRevisions } from '../../src/shared/examSaveDiff.js';

export const arrayValue = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export type ApiExamPayload = SharedExamPayload &
  Required<Pick<SharedExamPayload, 'weeklyPlans' | 'grades' | 'classes'>>;

export function examPayload(row: ExamRow): ApiExamPayload {
  const payload = parseExamPayload({
    ok: true,
    items: row.items,
    title: row.title ?? '',
    majors: row.majors,
    activeMajorId: row.active_major_id ?? '',
    alerts: row.alerts ?? null,
    weeklyPlans: row.weekly_plans,
    scheduleMode: row.schedule_mode ?? 'major-only',
    activeWeeklyPlanId: row.active_weekly_plan_id ?? '',
    activeWeeklyPlanIdByClassId: row.active_weekly_plan_by_class,
    grades: row.grades,
    classes: row.classes,
    initialization: row.initialization,
    weeklyConflictPolicy: row.weekly_conflict_policy ?? null,
    designPolicy: row.design_policy,
    majorBatchPresets: row.major_batch_presets,
    metadata: row.exam_metadata,
    lifecycle: row.lifecycle,
    revisions: parseExamRevisions(row.revisions),
    updatedAt: Number(row.updated_at ?? 0),
  });
  return {
    ...payload,
    ok: true,
    weeklyPlans: payload.weeklyPlans ?? [],
    grades: payload.grades ?? [],
    classes: payload.classes ?? [],
    revisions: payload.revisions ?? {},
    majorBatchPresets: payload.majorBatchPresets ?? { subjectGroups: [], timeGroups: [], updatedAt: 0 },
  };
}

// 供 permissions/plugin 等子模块引用的 payload 类型别名。
export type { ApiExamPayload as ExamPayload };
