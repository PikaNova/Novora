import type { SchoolClass, SchoolGrade } from '../types/school.js';

export interface DeviceScopeActor {
  permissions: readonly string[];
  scopes: Array<{ type: 'all' | 'grade' | 'class'; gradeId?: string; classId?: string }>;
}

export interface DeviceScope {
  allScope: boolean;
  grades: SchoolGrade[];
  classes: SchoolClass[];
  gradeIds: Set<string>;
  classIds: Set<string>;
}

export function resolveDeviceScope(
  grades: SchoolGrade[],
  classes: SchoolClass[],
  actor: DeviceScopeActor | null,
): DeviceScope {
  const allScope = !actor || actor.permissions.includes('*') || actor.scopes.some((scope) => scope.type === 'all');
  const visibleClasses = allScope
    ? classes
    : classes.filter((item) => actor!.scopes.some((scope) =>
      scope.type === 'grade' ? scope.gradeId === item.gradeId : scope.type === 'class' && scope.classId === item.id,
    ));
  const classIds = new Set(visibleClasses.map((item) => item.id));
  const gradeIds = new Set(visibleClasses.map((item) => item.gradeId));
  return {
    allScope,
    grades: grades.filter((grade) => gradeIds.has(grade.id)),
    classes: visibleClasses,
    gradeIds,
    classIds,
  };
}

export function deviceIsInScope(
  item: { gradeId?: string; classId?: string },
  scope: DeviceScope,
): boolean {
  if (scope.allScope) return true;
  if (item.classId) return scope.classIds.has(item.classId);
  return !!item.gradeId && scope.gradeIds.has(item.gradeId);
}
