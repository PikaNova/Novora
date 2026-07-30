import {
  COMPULSORY_EXAM_SUBJECTS,
  TRACK_EXAM_SUBJECTS,
  TRACK_FIRST_CHOICE_EXAM_SUBJECTS,
  TRACK_SECOND_CHOICE_EXAM_SUBJECTS,
  isCompulsorySubject,
  normalizeSubjectList,
  normalizeSubjectName,
} from '../data/subjects.js';

export interface SchoolGrade {
  id: string;
  name: string;
  order: number;
  enabled: boolean;
}

export interface SchoolClass {
  id: string;
  gradeId: string;
  name: string;
  order: number;
  enabled: boolean;
  // 选择性科目组合（不含语数英等必考科目），未设置时视为不限制（适用于所有单科考试）
  track?: string[];
}

// 福建 2026 高考“3+1+2”模式：语数外为必考，首选二选一，再选四选二。
export const COMPULSORY_SUBJECTS = [...COMPULSORY_EXAM_SUBJECTS];
export const TRACK_FIRST_CHOICE_SUBJECTS = [...TRACK_FIRST_CHOICE_EXAM_SUBJECTS];
export const TRACK_SECOND_CHOICE_SUBJECTS = [...TRACK_SECOND_CHOICE_EXAM_SUBJECTS];
export const ALL_TRACK_SUBJECTS = [...TRACK_EXAM_SUBJECTS];

// 用于列表/标签展示：未设置时显示“不限选科”。
export function classTrackLabel(track?: string[] | null): string {
  const normalized = normalizeSubjectList(track);
  if (!normalized.length) return '不限选科';
  return normalized.join('+');
}

// 判断某个科目的单科考试是否适用于某个班级：必考科目对所有班级适用；
// 班级未设置选科时视为不限制（适用所有选科）；否则需命中该班级的选科组合。
export function subjectAppliesToClass(subject: string, schoolClass: Pick<SchoolClass, 'track'>): boolean {
  const normalizedSubject = normalizeSubjectName(subject);
  if (isCompulsorySubject(normalizedSubject)) return true;
  if (!schoolClass.track || !schoolClass.track.length) return true;
  const track = normalizeSubjectList(schoolClass.track);
  if (normalizedSubject.includes('/')) {
    return normalizedSubject.split('/').some((item) => track.includes(normalizeSubjectName(item)));
  }
  return track.includes(normalizedSubject);
}

export function genGradeId(): string {
  return `grade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function genClassId(): string {
  return `class_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
