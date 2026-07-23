import type { MajorExam } from '../types';
import type { WeeklyPlan } from '../types/exam';

export function collectClassTags(weeklyPlans: WeeklyPlan[], majors: MajorExam[]): string[] {
  const tags = new Set<string>();
  weeklyPlans.forEach(plan => { const tag = (plan.classTag || '').trim(); if (tag) tags.add(tag); });
  majors.forEach(major => major.targetClasses?.forEach(value => { const tag = value.trim(); if (tag) tags.add(tag); }));
  return Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
