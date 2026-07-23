import type { ExamItem } from '../types';

const PRESET_EXAMS: Omit<ExamItem, 'id' | 'order'>[] = [
  { name: '语文', startTime: '2026-06-07T09:00:00', endTime: '2026-06-07T11:30:00', enabled: true },
  { name: '数学', startTime: '2026-06-07T15:00:00', endTime: '2026-06-07T17:00:00', enabled: true },
  { name: '英语', startTime: '2026-06-08T15:00:00', endTime: '2026-06-08T17:00:00', enabled: true },
];

export function buildPresetExams(): ExamItem[] {
  return PRESET_EXAMS.map((exam, i) => ({
    ...exam,
    id: `preset_${i}_${exam.startTime.replace(/[^0-9]/g, '')}`,
    order: i,
  }));
}
