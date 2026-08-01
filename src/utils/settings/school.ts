/** Grade, class, and initialization-wizard settings. */

import type { SchoolClass, SchoolGrade } from '../../types/school.js';
import { normalizeSubjectList } from '../../data/subjects.js';

export interface InitializationState {
  completedAt: number;
  wizardVersion: number;
  demoDataImported: boolean;
  province: string;
  schoolName: string;
  schoolFullName: string;
  subjectTrackModeEnabled: boolean;
}

export const DEFAULT_INITIALIZATION: InitializationState = {
  completedAt: 0,
  wizardVersion: 2,
  demoDataImported: false,
  province: '',
  schoolName: '',
  schoolFullName: '',
  subjectTrackModeEnabled: true,
};

export function normalizeGrades(raw: unknown): SchoolGrade[] {
  const list = (Array.isArray(raw) ? raw : []) as Array<Partial<SchoolGrade>>;
  return list.filter(Boolean).map((grade, index) => ({
    id: String(grade.id),
    name: String(grade.name),
    order: Number.isFinite(grade.order) ? (grade.order as number) : index,
    enabled: grade.enabled !== false,
  }));
}

export function normalizeClasses(raw: unknown, grades: SchoolGrade[]): SchoolClass[] {
  const list = (Array.isArray(raw) ? raw : []) as Array<Partial<SchoolClass>>;
  return list
    .filter(Boolean)
    .map((item, index) => ({
      id: String(item.id),
      gradeId: String(item.gradeId),
      name: String(item.name),
      order: Number.isFinite(item.order) ? (item.order as number) : index,
      enabled: item.enabled !== false,
      track: Array.isArray(item.track) ? normalizeSubjectList(item.track.map(String)) : undefined,
    }))
    .filter(item => grades.some(grade => grade.id === item.gradeId));
}

export function normalizeSelectedGradeId(raw: unknown, grades: SchoolGrade[]): string {
  return grades.some(grade => grade.id === raw) ? String(raw) : '';
}

export function normalizeSelectedClassId(raw: unknown, classes: SchoolClass[], selectedGradeId: string): string {
  return classes.some(item => item.id === raw && item.gradeId === selectedGradeId) ? String(raw) : '';
}

export function normalizeInitialization(raw: unknown): InitializationState {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<InitializationState>;
  return {
    completedAt: Number(src.completedAt ?? 0),
    wizardVersion: Math.max(1, Number(src.wizardVersion ?? 1)),
    demoDataImported: src.demoDataImported === true,
    province: String(src.province ?? '').trim(),
    schoolName: String(src.schoolName ?? '').trim(),
    schoolFullName: String(src.schoolFullName ?? src.schoolName ?? '').trim(),
    subjectTrackModeEnabled: src.subjectTrackModeEnabled !== false,
  };
}
