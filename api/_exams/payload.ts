// api/_exams/payload.ts
// exam_data 行到 API payload 的映射。从原 api/exams.ts 抽出。

import type { ExamRow } from "./types.js";

export const arrayValue = (value: unknown): any[] =>
  Array.isArray(value) ? value : [];
export const objectValue = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export function examPayload(row: ExamRow) {
  return {
    ok: true,
    items: arrayValue(row.items),
    title: row.title ?? "",
    majors: arrayValue(row.majors),
    activeMajorId: row.active_major_id ?? "",
    alerts: row.alerts ?? null,
    weeklyPlans: arrayValue(row.weekly_plans),
    scheduleMode: row.schedule_mode ?? "major-only",
    activeWeeklyPlanId: row.active_weekly_plan_id ?? "",
    activeWeeklyPlanIdByClassId: objectValue(row.active_weekly_plan_by_class),
    grades: arrayValue(row.grades),
    classes: arrayValue(row.classes),
    initialization: objectValue(row.initialization),
    weeklyConflictPolicy: row.weekly_conflict_policy ?? null,
    designPolicy: objectValue(row.design_policy),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

// 供 permissions/plugin 等子模块引用的 payload 类型别名。
export type ExamPayload = ReturnType<typeof examPayload>;
