import type { SchoolClass, SchoolGrade } from '../types/school';

export function sortedGrades(grades: SchoolGrade[]): SchoolGrade[] {
  return [...grades].filter(item => item.enabled).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'));
}

export function sortedClasses(classes: SchoolClass[], gradeId?: string): SchoolClass[] {
  return [...classes].filter(item => item.enabled && (!gradeId || item.gradeId === gradeId)).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'));
}

export function classDisplayName(grades: SchoolGrade[], classes: SchoolClass[], classId: string): string {
  const schoolClass = classes.find(item => item.id === classId);
  if (!schoolClass) return '未绑定';
  const grade = grades.find(item => item.id === schoolClass.gradeId);
  return `${grade?.name ?? '未知年级'} · ${schoolClass.name}`;
}
