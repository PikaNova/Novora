import type { ExamItem } from '../types';
import type { ResolvedSchedule, ScheduleMode } from '../types/exam';
import { getAppSettings } from './appSettings';
import { nowMs } from './timeSource';
import { resolveEffectiveSchedule } from './scheduleConflict';
import { resolveTemporaryItem } from '../services/temporaryExam';
import type { ResolveWeeklyOptions } from './weeklySchedule';

/**
 * 展示端统一入口：把当前 AppSettings.exam 映射为 resolveEffectiveSchedule 的输入，
 * 算出“大型考试 + 生效周测”合并后的标准时间线。
 *
 * major-only 默认模式下，返回结果与旧版 exam.items（激活大型考试镜像）等价，零行为变更。
 */
export function getResolvedSchedule(now: number = nowMs(), options?: ResolveWeeklyOptions, modeOverride?: ScheduleMode): ResolvedSchedule {
  const exam = getAppSettings().exam;
  const selectedClass = exam.classes.find(item => item.id === exam.selectedClassId && item.gradeId === exam.selectedGradeId && item.enabled !== false);
  const selectedGrade = exam.grades.find(item => item.id === exam.selectedGradeId && item.enabled !== false);
  if (!selectedGrade || !selectedClass) {
    return { activeItems: [], suppressedWeeklyItems: [], conflicts: [] };
  }
  return resolveEffectiveSchedule(
    {
      scheduleMode: modeOverride ?? exam.scheduleMode,
      activeMajorId: exam.activeMajorId || null,
      activeWeeklyPlanId: exam.activeWeeklyPlanId ?? null,
      activeWeeklyPlanIdByClassId: exam.activeWeeklyPlanIdByClassId,
      selectedGradeId: exam.selectedGradeId,
      selectedClassId: exam.selectedClassId,
      selectedClassTrack: selectedClass.track,
      majors: exam.majors,
      weeklyPlans: exam.weeklyPlans,
      weeklyConflictPolicy: exam.weeklyConflictPolicy,
    },
    now,
    options,
  );
}

/** 最终参与展示 / 提醒 的标准考试时间线（已含生效周测，按时间排序）。 */
export function getResolvedExamItems(now: number = nowMs(), options?: ResolveWeeklyOptions, modeOverride?: ScheduleMode): ExamItem[] {
  const formal = getResolvedSchedule(now, options, modeOverride).activeItems;
  const temporary = resolveTemporaryItem(formal, now);
  if (!temporary) return formal;
  const priority = (temporary as ExamItem & { kind?: string }).kind === 'temporary' && getTemporaryExamPriority();
  const visibleFormal = priority ? formal.filter(item => new Date(item.endTime).getTime() <= new Date(temporary.startTime).getTime() || new Date(item.startTime).getTime() >= new Date(temporary.endTime).getTime()) : formal;
  return [temporary, ...visibleFormal];
}

function getTemporaryExamPriority() {
  try { return JSON.parse(localStorage.getItem('exam_board_temporary_exam_v2') || 'null')?.priorityOverFormal === true; } catch { return false; }
}
