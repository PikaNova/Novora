// 批量添加考试的领域类型与纯逻辑：与 UI 组件解耦，便于独立复用与测试。
import type { MajorBatchSubjectGroup, MajorBatchTimeGroup, MajorBatchTimeSlot } from '../../utils/appSettings';
import { addDaysToDateKey } from '../../utils/weeklySchedule';

export type BatchDraftItem = {
  id: string;
  name: string;
  date: string;
  start: string;
  end: string;
  enabled: boolean;
  allowCrossDay: boolean;
  targetClassIds?: string[];
};

export type TemplateCategory = 'gaokao' | 'school' | 'custom';

export type SubjectTemplate = {
  id: string;
  name: string;
  description: string;
  subjects: string[];
  custom?: boolean;
  source?: 'school' | 'local';
  category: TemplateCategory;
  /** 该模板允许勾选的最大科目总数（例如 3+1+2 固定为 6 门）；不设置表示不限制。 */
  maxTotal?: number;
};

export type DayPattern = {
  id: string;
  name: string;
  description: string;
  slots: MajorBatchTimeSlot[];
  custom?: boolean;
  source?: 'school' | 'local';
  category: TemplateCategory;
};

export const GAOKAO_THREE_DAY_PATTERN_ID = 'gaokao-three-day';

export function makeDraftId() {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeExamId() {
  return `exam_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function todayKey() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 10);
}

export function addDays(dateKey: string, days: number) {
  return addDaysToDateKey(dateKey, days);
}

export function toLocalIso(date: string, time: string, nextDay = false) {
  const targetDate = nextDay ? addDays(date, 1) : date;
  return `${targetDate}T${time}`;
}

export function fmtDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

export function rangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return new Date(leftStart) < new Date(rightEnd) && new Date(leftEnd) > new Date(rightStart);
}

export function slotDayOffset(slot: MajorBatchTimeSlot) {
  return Math.max(0, Math.round(Number(slot.dayOffset ?? 0)));
}

export function patternDaySpan(pattern: DayPattern) {
  const maxOffset = pattern.slots.reduce((max, slot) => Math.max(max, slotDayOffset(slot)), 0);
  return maxOffset + 1;
}

export function arrangedSubjectsForPattern(subjects: string[], pattern: DayPattern): string[] {
  if (pattern.id !== GAOKAO_THREE_DAY_PATTERN_ID) return subjects;
  const selected = new Set(subjects);
  const arranged: string[] = [];
  const pushIfSelected = (subject: string) => {
    if (selected.has(subject)) arranged.push(subject);
  };
  pushIfSelected('语文');
  pushIfSelected('数学');
  if (selected.has('物理') && selected.has('历史')) arranged.push('物理/历史');
  else if (selected.has('物理')) arranged.push('物理');
  else if (selected.has('历史')) arranged.push('历史');
  pushIfSelected('外语');
  pushIfSelected('化学');
  pushIfSelected('地理');
  pushIfSelected('思想政治');
  pushIfSelected('生物');
  const covered = new Set(['语文', '数学', '物理', '历史', '外语', '化学', '地理', '思想政治', '生物']);
  for (const subject of subjects) {
    if (!covered.has(subject) && !arranged.includes(subject)) arranged.push(subject);
  }
  return arranged;
}

export function buildDraftItems(subjects: string[], startDate: string, pattern: DayPattern): BatchDraftItem[] {
  const explicitDays = pattern.slots.some((slot) => slotDayOffset(slot) > 0);
  const daySpan = explicitDays ? patternDaySpan(pattern) : 1;
  const arrangedSubjects = arrangedSubjectsForPattern(subjects, pattern);
  return arrangedSubjects.map((subject, index) => {
    const slot = pattern.slots[index % pattern.slots.length];
    const cycleOffset = Math.floor(index / pattern.slots.length) * daySpan;
    const dayOffset = explicitDays ? cycleOffset + slotDayOffset(slot) : Math.floor(index / pattern.slots.length);
    return {
      id: makeDraftId(),
      name: subject,
      date: addDays(startDate, dayOffset),
      start: slot.start,
      end: slot.end,
      enabled: true,
      allowCrossDay: false,
    };
  });
}

export function durationText(startIso: string, endIso: string) {
  const minutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return '时间无效';
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
  }
  return `${minutes}分钟`;
}

export function customSubjectToTemplate(item: MajorBatchSubjectGroup): SubjectTemplate {
  return {
    id: item.id,
    name: item.name,
    description: `${item.subjects.length} 个科目，已保存为常用组`,
    subjects: item.subjects,
    custom: true,
    source: 'school',
    category: 'school',
  };
}

export function customTimeToPattern(item: MajorBatchTimeGroup): DayPattern {
  return {
    id: item.id,
    name: item.name,
    description: `${item.slots.length} 个场次，已保存为常用时间组`,
    slots: item.slots,
    custom: true,
    source: 'school',
    category: 'school',
  };
}
