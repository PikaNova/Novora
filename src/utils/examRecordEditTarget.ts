import type { MajorExam } from '../types';
import type { SchoolClass } from '../types/school';

/**
 * 这场考试是否出现在某个年级的视图里：显式指定年级时按年级判定，只指定班级时按班级所属年级判定，
 * 全校考试对所有年级可见；年级为空时一律不可见。
 *
 * 考试中心的「当前年级」是列表与编辑器的共同范围，规则只有这一份
 * （`useMajorScheduleActions` 里的同名判定转调这里，避免两处漂移）。
 */
export function majorAppliesToGrade(major: MajorExam, gradeId: string, classes: readonly SchoolClass[]): boolean {
  if (!gradeId) return false;
  if (major.targetGradeIds?.length) return major.targetGradeIds.includes(gradeId);
  if (major.targetClassIds?.length) {
    return major.targetClassIds.some((classId) =>
      classes.some((item) => item.id === classId && item.gradeId === gradeId),
    );
  }
  return true;
}

/**
 * 这场考试自己落在哪个年级：优先显式年级，其次第一个指定班级所属的年级；
 * 全校考试给不出唯一答案，返回 ''。
 */
export function gradeIdOwningMajor(major: MajorExam, classes: readonly SchoolClass[]): string {
  const explicitGradeId = major.targetGradeIds?.[0];
  if (explicitGradeId) return explicitGradeId;
  const firstClassId = major.targetClassIds?.[0];
  if (firstClassId) return classes.find((item) => item.id === firstClassId)?.gradeId ?? '';
  return '';
}

export type ExamEditTarget = {
  /** 编辑器要展示的那场考试。 */
  majorId: string;
  /** 非空表示当前年级看不到它，得先切到这个年级；null 表示当前年级直接可见。 */
  gradeId: string | null;
};

/**
 * 详情抽屉点「编辑考试」时的落点。
 *
 * 编辑器展示的是「当前年级范围内、按 editingMajorId 命中的那一场」，所以这里必须同时给出两个坐标：
 * 哪一场（majorId）、需不需要先切年级。少了这一步，编辑器会退回「当前范围的第一场」，
 * 用户看到的就是「这根本不是我点的那场考试」（dev 巡检里反馈过的那一类问题）。
 *
 * 快照 `exam_data.majors` 里找不到这个 id（已被删除、或不是大型考试）时返回 null，
 * 由调用方给出提示，而不是把人扔进另一场考试。
 */
export function resolveExamEditTarget(input: {
  majors: readonly MajorExam[];
  recordId: string;
  currentGradeId: string;
  classes: readonly SchoolClass[];
}): ExamEditTarget | null {
  const major = input.majors.find((item) => item.id === input.recordId);
  if (!major) return null;
  if (majorAppliesToGrade(major, input.currentGradeId, input.classes)) {
    return { majorId: major.id, gradeId: null };
  }
  const owningGradeId = gradeIdOwningMajor(major, input.classes);
  return {
    majorId: major.id,
    gradeId: owningGradeId && owningGradeId !== input.currentGradeId ? owningGradeId : null,
  };
}
