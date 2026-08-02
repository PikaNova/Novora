export type QuickMajorLike = {
  source?: "regular" | "quick";
  temporary?: boolean;
  createdBy?: number;
  targetClassIds?: string[];
  targetGradeIds?: string[];
};

export type ScopedEntity = { id: string };

/**
 * A scoped co-manager may control a quick temporary exam only when its entire
 * explicit delivery scope belongs to that manager. An unscoped exam is never
 * eligible for this limited co-management path.
 */
export function isQuickTemporaryMajorFullyInScope(
  major: QuickMajorLike | null | undefined,
  canAccessClassId: (classId: string) => boolean,
  canAccessGradeId: (gradeId: string) => boolean,
): boolean {
  if (!major || major.source !== "quick" || major.temporary !== true) return false;
  const classIds = major.targetClassIds ?? [];
  if (classIds.length) return classIds.every(canAccessClassId);
  const gradeIds = major.targetGradeIds ?? [];
  return gradeIds.length > 0 && gradeIds.every(canAccessGradeId);
}

export function isOwnQuickTemporaryMajor(
  major: QuickMajorLike | null | undefined,
  adminUserId: number | null | undefined,
): boolean {
  if (!major || adminUserId == null) return false;
  if (major.source !== "quick" || major.temporary !== true) return false;
  return major.createdBy === adminUserId;
}
