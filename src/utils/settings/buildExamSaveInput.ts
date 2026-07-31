import { getAppSettings } from "../appSettings";
import { getCloudSnapshot } from "../../services/examService";

// 将当前 exam 状态组装成 SaveExamsInput（少写重复套话）。
export function buildExamSaveInput(overrides?: Record<string, unknown>) {
  const exam = getAppSettings().exam;
  return {
    items: exam.items,
    title: exam.title,
    majors: exam.majors,
    activeMajorId: exam.activeMajorId,
    alerts: getAppSettings().alerts,
    scheduleMode: exam.scheduleMode,
    weeklyPlans: exam.weeklyPlans,
    activeWeeklyPlanId: exam.activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId: exam.activeWeeklyPlanIdByClassId,
    grades: exam.grades,
    classes: exam.classes,
    weeklyConflictPolicy: exam.weeklyConflictPolicy,
    baseUpdatedAt: getCloudSnapshot()?.updatedAt ?? 0,
    ...overrides,
  };
}
