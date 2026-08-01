export type QuickMajorLike = {
  source?: "regular" | "quick";
  temporary?: boolean;
  createdBy?: number;
  targetClassIds?: string[];
  targetGradeIds?: string[];
};

export type ScopedEntity = { id: string };

export function isOwnQuickTemporaryMajor(
  major: QuickMajorLike | null | undefined,
  adminUserId: number | null | undefined,
  visibleClasses: ReadonlyArray<ScopedEntity>,
  visibleGrades: ReadonlyArray<ScopedEntity>,
): boolean {
  if (!major || adminUserId == null) return false;
  if (major.source !== "quick" || major.temporary !== true) return false;
  if (major.createdBy === adminUserId) return true;
  if (major.targetClassIds?.some((classId) => visibleClasses.some((item) => item.id === classId))) return true;
  return !!major.targetGradeIds?.some((gradeId) => visibleGrades.some((item) => item.id === gradeId));
}
