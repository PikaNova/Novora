import type { ExamItem, MajorExam } from "../types/index.js";
import type { SchoolClass } from "../types/school.js";
import { subjectAppliesToClass } from "../types/school.js";
import { isTrackSubject, normalizeSubjectName } from "../data/subjects.js";

export const NO_MATCHING_TRACK_CLASS_ID = "__no_matching_track_class__";

type ScopedClass = Pick<SchoolClass, "id" | "gradeId" | "enabled" | "track">;
type ScopedMajor = Pick<MajorExam, "targetClassIds" | "targetGradeIds">;

export function classesInMajorScope<T extends ScopedClass>(
  major: ScopedMajor,
  classes: readonly T[],
): T[] {
  return classes.filter((item) => {
    if (!item.enabled) return false;
    if (major.targetClassIds?.length) return major.targetClassIds.includes(item.id);
    if (major.targetGradeIds?.length) return major.targetGradeIds.includes(item.gradeId);
    return true;
  });
}

export function computeAutoTrackClassIds(
  major: ScopedMajor,
  subject: string,
  classes: readonly ScopedClass[],
  subjectTrackModeEnabled: boolean,
): string[] | undefined {
  const normalizedSubject = normalizeSubjectName(subject);
  if (!subjectTrackModeEnabled || !isTrackSubject(normalizedSubject)) return undefined;
  const ids = classesInMajorScope(major, classes)
    .filter((item) => subjectAppliesToClass(normalizedSubject, item))
    .map((item) => item.id);
  return ids.length ? ids : [NO_MATCHING_TRACK_CLASS_ID];
}

function sameIds(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === (b?.length ?? 0);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export type TrackClassIdsChange = {
  majorId: string;
  majorName: string;
  itemId: string;
  itemName: string;
  before: string[] | undefined;
  after: string[] | undefined;
};

/**
 * Rebuild automatically generated elective-item class scopes from the current
 * class tracks. A quick temporary major remains manually scoped at its major
 * level, so it is deliberately excluded from this operation.
 */
export function recomputeMajorsTrackClassIds(
  majors: readonly MajorExam[],
  classes: readonly ScopedClass[],
  subjectTrackModeEnabled: boolean,
): { majors: MajorExam[]; changes: TrackClassIdsChange[] } {
  const changes: TrackClassIdsChange[] = [];
  const nextMajors = majors.map((major) => {
    if (major.source === "quick" || major.temporary) return major;

    let majorChanged = false;
    const nextItems: ExamItem[] = major.items.map((item) => {
      if (!isTrackSubject(normalizeSubjectName(item.name))) return item;
      const nextTargetClassIds = computeAutoTrackClassIds(
        major,
        item.name,
        classes,
        subjectTrackModeEnabled,
      );
      if (sameIds(item.targetClassIds, nextTargetClassIds)) return item;
      majorChanged = true;
      changes.push({
        majorId: major.id,
        majorName: major.name,
        itemId: item.id,
        itemName: item.name,
        before: item.targetClassIds,
        after: nextTargetClassIds,
      });
      return { ...item, targetClassIds: nextTargetClassIds };
    });
    return majorChanged ? { ...major, items: nextItems } : major;
  });
  return { majors: nextMajors, changes };
}
