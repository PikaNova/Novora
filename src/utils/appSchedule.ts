import type { ExamItem } from '../types';
import type { ResolvedSchedule } from '../types/exam';
import { getAppSettings } from './appSettings';
import { nowMs } from './timeSource';
import { resolveEffectiveSchedule } from './scheduleConflict';

/**
 * 展示端统一入口：把当前 AppSettings.exam 映射为 resolveEffectiveSchedule 的输入，
 * 算出“大型考试 + 生效周测”合并后的标准时间线。
 *
 * major-only 默认模式下，返回结果与旧版 exam.items（激活大型考试镜像）等价，零行为变更。
 */
export function getResolvedSchedule(now: number = nowMs()): ResolvedSchedule {
  const exam = getAppSettings().exam;
  return resolveEffectiveSchedule(
    {
      scheduleMode: exam.scheduleMode,
      activeMajorId: exam.activeMajorId || null,
      activeWeeklyPlanId: exam.activeWeeklyPlanId ?? null,
      majors: exam.majors,
      weeklyPlans: exam.weeklyPlans,
      weeklyConflictPolicy: exam.weeklyConflictPolicy,
    },
    now,
  );
}

/** 最终参与展示 / 提醒 的标准考试时间线（已含生效周测，按时间排序）。 */
export function getResolvedExamItems(now: number = nowMs()): ExamItem[] {
  return getResolvedSchedule(now).activeItems;
}
