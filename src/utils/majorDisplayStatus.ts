import type { ExamItem, MajorExam } from "../types";
import type { SchoolClass } from "../types/school";

export type QuickMajorDisplayTone = "temporary" | "formal" | "pending" | "clear";

export interface QuickMajorDisplayStatus {
  tone: QuickMajorDisplayTone;
  label: string;
  detail: string;
  conflict: boolean;
}

const byStartTime = (left: ExamItem, right: ExamItem) =>
  new Date(left.startTime).getTime() - new Date(right.startTime).getTime();

function itemWindow(item: ExamItem) {
  return {
    start: new Date(item.startTime).getTime(),
    end: new Date(item.endTime).getTime(),
  };
}

function overlaps(left: ExamItem, right: ExamItem) {
  const a = itemWindow(left);
  const b = itemWindow(right);
  if (![a.start, a.end, b.start, b.end].every(Number.isFinite)) return false;
  return a.start < b.end && a.end > b.start;
}

function isRunning(item: ExamItem, now: number) {
  const { start, end } = itemWindow(item);
  return Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end;
}

function intersects(left?: string[], right?: string[]) {
  if (!left?.length || !right?.length) return true;
  return left.some((id) => right.includes(id));
}

function classMatchesGrades(classIds: string[] | undefined, gradeIds: string[] | undefined, classes?: SchoolClass[]) {
  if (!classIds?.length || !gradeIds?.length) return true;
  if (!classes?.length) return true;
  return classIds.some((classId) => {
    const cls = classes.find((item) => item.id === classId);
    return !!cls && gradeIds.includes(cls.gradeId);
  });
}

export function majorScopesOverlap(left: MajorExam, right: MajorExam, classes?: SchoolClass[]) {
  const gradeOverlap = intersects(left.targetGradeIds, right.targetGradeIds);
  const classOverlap = intersects(left.targetClassIds, right.targetClassIds);
  const leftClassRightGrade = classMatchesGrades(left.targetClassIds, right.targetGradeIds, classes);
  const rightClassLeftGrade = classMatchesGrades(right.targetClassIds, left.targetGradeIds, classes);
  return gradeOverlap && classOverlap && leftClassRightGrade && rightClassLeftGrade;
}

export function getQuickMajorMainItem(major: MajorExam, now: number) {
  const enabledItems = major.items.filter((item) => item.enabled).sort(byStartTime);
  return (
    enabledItems.find((item) => isRunning(item, now)) ??
    enabledItems.find((item) => new Date(item.endTime).getTime() >= now) ??
    null
  );
}

export function getQuickMajorDisplayStatus(
  quickMajor: MajorExam,
  majors: MajorExam[],
  now: number,
  classes?: SchoolClass[],
): QuickMajorDisplayStatus | null {
  if (!quickMajor.temporary || quickMajor.endedAt) return null;
  const quickItem = getQuickMajorMainItem(quickMajor, now);
  if (!quickItem) return null;

  const overlappingFormalItems = majors
    .filter((major) => major.id !== quickMajor.id && !major.temporary && majorScopesOverlap(quickMajor, major, classes))
    .flatMap((major) =>
      major.items
        .filter((item) => item.enabled && overlaps(quickItem, item))
        .map((item) => ({ major, item })),
    )
    .sort((left, right) => byStartTime(left.item, right.item));

  const currentFormal = overlappingFormalItems.find(({ item }) => isRunning(item, now));
  const quickRunning = isRunning(quickItem, now);

  if (currentFormal) {
    if (quickMajor.priorityOverSchedule) {
      return {
        tone: "temporary",
        label: "当前显示：临时统一考试",
        detail: `已启用优先覆盖，覆盖正式大型考试「${currentFormal.major.name}」`,
        conflict: true,
      };
    }
    return {
      tone: "formal",
      label: `当前显示：正式大型考试「${currentFormal.major.name}」`,
      detail: `临时统一考试「${quickMajor.name}」与正式考试冲突，未勾选优先覆盖`,
      conflict: true,
    };
  }

  if (quickRunning) {
    return {
      tone: overlappingFormalItems.length ? "temporary" : "clear",
      label: `当前显示：临时统一考试「${quickItem.name}」`,
      detail: overlappingFormalItems.length
        ? "当前时段未与正式大型考试重叠，重叠时段会按优先级自动切换"
        : "当前没有检测到正式大型考试冲突",
      conflict: overlappingFormalItems.length > 0,
    };
  }

  if (overlappingFormalItems.length) {
    const winner = quickMajor.priorityOverSchedule
      ? "临时统一考试"
      : `正式大型考试「${overlappingFormalItems[0].major.name}」`;
    return {
      tone: "pending",
      label: `冲突预告：重叠时段将显示${winner}`,
      detail: `临时统一考试「${quickMajor.name}」尚未进入当前冲突时段`,
      conflict: true,
    };
  }

  return {
    tone: "pending",
    label: "等待显示：临时统一考试",
    detail: `下一场：${quickItem.name}`,
    conflict: false,
  };
}
