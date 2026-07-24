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
}

export function genGradeId(): string {
  return `grade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function genClassId(): string {
  return `class_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
