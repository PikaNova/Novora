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

// 福建 2026 高考“3+1+2”模式：语数英为必考，首选二选一，再选四选二。
export const COMPULSORY_SUBJECTS = ['语文', '数学', '英语'];
export const TRACK_FIRST_CHOICE_SUBJECTS = ['物理', '历史'];
export const TRACK_SECOND_CHOICE_SUBJECTS = ['化学', '生物', '地理', '政治'];
export const ALL_TRACK_SUBJECTS = [...TRACK_FIRST_CHOICE_SUBJECTS, ...TRACK_SECOND_CHOICE_SUBJECTS];

// 用于列表/标签展示：未设置时显示“不限选科”。
export function classTrackLabel(track?: string[] | null): string {
  if (!track || !track.length) return '不限选科';
  return track.join('+');
}

// 判断某个科目的单科考试是否适用于某个班级：必考科目对所有班级适用；
// 班级未设置选科时视为不限制（适用所有选科）；否则需命中该班级的选科组合。
export function subjectAppliesToClass(subject: string, schoolClass: Pick<SchoolClass, 'track'>): boolean {
  if (COMPULSORY_SUBJECTS.includes(subject)) return true;
  if (!schoolClass.track || !schoolClass.track.length) return true;
  return schoolClass.track.includes(subject);
}

export function genGradeId(): string {
  return `grade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function genClassId(): string {
  return `class_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
