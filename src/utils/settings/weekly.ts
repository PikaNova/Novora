/** Weekly-test plan normalization and selection settings. */

import type {
  IsoWeekday,
  WeeklyConflictPolicy,
  WeeklyExamItem,
  WeeklyExamOverride,
  WeeklyPlan,
  WeeklyWeekType,
} from '../../types/exam.js';
import { ALL_CONFLICT_SCOPES, DEFAULT_WEEKLY_CONFLICT_POLICY } from '../../types/exam.js';
import type { SchoolClass } from '../../types/school.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function genWeeklyPlanId(): string {
  return `weekly_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function genWeeklyItemId(): string {
  return `wk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function genWeeklyOverrideId(sourceItemId: string, date: string): string {
  return `ov_${sourceItemId}_${date}`;
}

function clampRepeat(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(8, Math.max(1, Math.round(n)));
}

function padHM(t: string): string {
  const [h = '0', m = '0'] = String(t).split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

export function normalizeWeeklyPlan(raw: unknown, index = 0): WeeklyPlan {
  const src = (raw ?? {}) as Partial<WeeklyPlan>;
  const items: WeeklyExamItem[] = (Array.isArray(src.items) ? src.items : [])
    .filter(Boolean)
    .map((item, itemIndex) => normalizeWeeklyItem(item, itemIndex));
  return {
    id: src.id || genWeeklyPlanId(),
    name: (src.name && String(src.name).trim()) || `周测计划${index + 1}`,
    enabled: src.enabled !== false,
    timezone: 'Asia/Shanghai',
    activeFrom: DATE_RE.test(src.activeFrom || '') ? (src.activeFrom as string) : '',
    activeUntil: DATE_RE.test(src.activeUntil || '') ? (src.activeUntil as string) : null,
    repeatEveryWeeks: clampRepeat(src.repeatEveryWeeks as number),
    anchorDate: DATE_RE.test(src.anchorDate || '') ? (src.anchorDate as string) : (src.activeFrom || ''),
    weekMode: src.weekMode === 'ab' ? 'ab' : 'single',
    excludeOfficialHolidays: src.excludeOfficialHolidays === true,
    items,
    excludedDates: (Array.isArray(src.excludedDates) ? src.excludedDates : []).filter(date => DATE_RE.test(date)),
    overrides: (Array.isArray(src.overrides) ? src.overrides : []).filter(Boolean) as WeeklyExamOverride[],
    order: typeof src.order === 'number' ? src.order : index,
    gradeId: typeof src.gradeId === 'string' ? src.gradeId : '',
    classId: typeof src.classId === 'string' ? src.classId : '',
  };
}

function normalizeWeeklyItem(raw: unknown, index: number): WeeklyExamItem {
  const src = (raw ?? {}) as Partial<WeeklyExamItem>;
  const weekday = ([1, 2, 3, 4, 5, 6, 7] as number[]).includes(src.weekday as number)
    ? (src.weekday as IsoWeekday)
    : 1;
  return {
    id: src.id || genWeeklyItemId(),
    name: (src.name && String(src.name).trim()) || `周测${index + 1}`,
    weekday,
    startTime: padHM(src.startTime || '19:00'),
    endTime: padHM(src.endTime || '20:00'),
    endNextDay: !!src.endNextDay,
    enabled: src.enabled !== false,
    order: typeof src.order === 'number' ? src.order : index,
    location: src.location,
    note: src.note,
    weekType: (['all', 'a', 'b'] as WeeklyWeekType[]).includes(src.weekType as WeeklyWeekType) ? src.weekType : 'all',
  };
}

export function normalizeConflictPolicy(raw: unknown): WeeklyConflictPolicy {
  const src = (raw ?? {}) as Partial<WeeklyConflictPolicy>;
  const scope = ALL_CONFLICT_SCOPES.includes(src.scope as never)
    ? (src.scope as WeeklyConflictPolicy['scope'])
    : DEFAULT_WEEKLY_CONFLICT_POLICY.scope;
  return {
    enabled: src.enabled !== false,
    scope,
    bufferBeforeMinutes: Number.isFinite(src.bufferBeforeMinutes) ? Math.max(0, Math.round(src.bufferBeforeMinutes as number)) : 0,
    bufferAfterMinutes: Number.isFinite(src.bufferAfterMinutes) ? Math.max(0, Math.round(src.bufferAfterMinutes as number)) : 0,
  };
}

export function resolveActiveWeeklyPlanIdByClass(
  classes: SchoolClass[],
  weeklyPlans: WeeklyPlan[],
  raw: unknown,
): Record<string, string | null> {
  const rawByClass = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const result: Record<string, string | null> = {};
  for (const item of classes) {
    const value = rawByClass[item.id];
    result[item.id] = typeof value === 'string' && weeklyPlans.some(plan => plan.id === value && plan.classId === item.id)
      ? value
      : (weeklyPlans.find(plan => plan.classId === item.id)?.id ?? null);
  }
  return result;
}
