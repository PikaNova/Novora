export type MinimalIdRecord = { id?: unknown };

export function computeRemovedScopeIds(
  priorGrades: ReadonlyArray<MinimalIdRecord>,
  priorClasses: ReadonlyArray<MinimalIdRecord>,
  nextGrades: unknown,
  nextClasses: unknown,
): { removedGradeIds: string[]; removedClassIds: string[] } {
  const removedGradeIds = Array.isArray(nextGrades)
    ? priorGrades
        .map((item) => String(item?.id ?? ""))
        .filter((id) => id && !(nextGrades as MinimalIdRecord[]).some((item) => String(item?.id ?? "") === id))
    : [];
  const removedClassIds = Array.isArray(nextClasses)
    ? priorClasses
        .map((item) => String(item?.id ?? ""))
        .filter((id) => id && !(nextClasses as MinimalIdRecord[]).some((item) => String(item?.id ?? "") === id))
    : [];
  return { removedGradeIds, removedClassIds };
}
