import type {
  WeeklyPlan,
  WeeklyExamItem,
  WeeklyExamOverride,
  WeeklyOccurrence,
  IsoWeekday,
  ScheduleValidationIssue,
} from '../types/exam';
import { getZonedParts, DISPLAY_TIME_ZONE } from './timeSource';

/**
 * 周测周期规则 -> 实际实例 的纯函数集合。
 *
 * 所有日历运算都基于 Asia/Shanghai 日历日。由于中国无夏令时，这里以
 * “UTC 当天正午”作为某个上海日历日的稳定代表点做加减，规避时区/DST 抖动。
 */

const pad2 = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

/** 取某毫秒时刻对应的上海日历日 'YYYY-MM-DD'。 */
export function getShanghaiDateKey(ms: number, timeZone = DISPLAY_TIME_ZONE): string {
  const p = getZonedParts(ms, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** 'YYYY-MM-DD' -> 该上海日历日的“UTC 正午”毫秒（稳定代表点）。 */
function dateKeyToAnchorMs(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

/** 在上海日历日上加减天数，返回新的 'YYYY-MM-DD'。 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const dt = new Date(dateKeyToAnchorMs(dateKey) + days * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 某个上海日历日的 ISO 星期（1=周一 … 7=周日）。 */
export function isoWeekdayOfDateKey(dateKey: string): IsoWeekday {
  const day = new Date(dateKeyToAnchorMs(dateKey)).getUTCDay(); // 0=Sun..6=Sat
  return (day === 0 ? 7 : day) as IsoWeekday;
}

/** 以周一为界的整数周序号，用于隔周 / 每 N 周对齐。 */
export function weekIndexOfDateKey(dateKey: string): number {
  const iso = isoWeekdayOfDateKey(dateKey);
  const mondayMs = dateKeyToAnchorMs(dateKey) - (iso - 1) * DAY_MS;
  return Math.floor(mondayMs / (7 * DAY_MS));
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** 规范化 'H:mm' / 'HH:mm' -> 'HH:mm'。 */
function padHM(t: string): string {
  const [h = '0', m = '0'] = String(t).split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/** 生成裸本地 ISO 时间串（与既有 ExamItem.startTime 完全同格式，由 parseZonedTime 按上海解释）。 */
function toLocalIso(dateKey: string, hm: string): string {
  return `${dateKey}T${padHM(hm)}:00`;
}

function isBetweenKeys(key: string, from: string, until: string | null): boolean {
  if (key < from) return false;
  if (until && key > until) return false;
  return true;
}

function clampRepeat(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(8, Math.max(1, Math.round(n)));
}

export interface ResolveWeeklyOptions {
  /** 向前回看的天数（默认 1，用于“刚过去”的实例仍可参与结束态逻辑）。 */
  daysBack?: number;
  /** 向后展开的天数（默认 14）。 */
  daysForward?: number;
}

/**
 * 把一个周测计划展开为“前 daysBack 天 ~ 未来 daysForward 天”的实际实例。
 * 已应用：生效范围、每周/隔周/每 N 周、ISO 星期匹配、整日排除、单次取消/临时修改、跨日结束、强制保留标记。
 * 未做：与大型考试的冲突判断（交给 scheduleConflict）。
 */
export function resolveWeeklyOccurrences(
  plan: WeeklyPlan | null | undefined,
  now: number,
  options: ResolveWeeklyOptions = {},
): WeeklyOccurrence[] {
  if (!plan || !plan.enabled) return [];
  const daysBack = options.daysBack ?? 1;
  const daysForward = options.daysForward ?? 14;
  const repeat = clampRepeat(plan.repeatEveryWeeks);
  const anchorWeek = weekIndexOfDateKey(plan.anchorDate || getShanghaiDateKey(now));
  const todayKey = getShanghaiDateKey(now);
  const excluded = new Set(Array.isArray(plan.excludedDates) ? plan.excludedDates : []);
  const overrides = Array.isArray(plan.overrides) ? plan.overrides : [];
  const items = Array.isArray(plan.items) ? plan.items : [];

  const out: WeeklyOccurrence[] = [];
  for (let offset = -daysBack; offset <= daysForward; offset++) {
    const dateKey = addDaysToDateKey(todayKey, offset);
    if (!isBetweenKeys(dateKey, plan.activeFrom, plan.activeUntil)) continue;
    if (mod(weekIndexOfDateKey(dateKey) - anchorWeek, repeat) !== 0) continue;
    if (excluded.has(dateKey)) continue; // 整日排除
    const iso = isoWeekdayOfDateKey(dateKey);

    for (const item of items) {
      if (!item.enabled || item.weekday !== iso) continue;
      const ov = overrides.find(o => o.sourceItemId === item.id && o.date === dateKey);
      if (ov?.action === 'cancel') continue; // 单次取消
      out.push(buildOccurrence(plan.id, item, dateKey, ov));
    }
  }
  return out;
}

function buildOccurrence(
  planId: string,
  item: WeeklyExamItem,
  dateKey: string,
  ov: WeeklyExamOverride | undefined,
): WeeklyOccurrence {
  const replace = ov?.action === 'replace' ? ov : undefined;
  const name = replace?.name ?? item.name;
  const startHM = replace?.startTime ?? item.startTime;
  const endHM = replace?.endTime ?? item.endTime;
  const endNextDay = replace?.endNextDay ?? item.endNextDay ?? false;
  const forced = !!replace?.forceRunDuringMajorExam;
  const endDateKey = endNextDay ? addDaysToDateKey(dateKey, 1) : dateKey;
  const occurrenceId = `${item.id}@${dateKey}`;
  return {
    id: occurrenceId,
    occurrenceId,
    name,
    startTime: toLocalIso(dateKey, startHM),
    endTime: toLocalIso(endDateKey, endHM),
    enabled: true,
    order: item.order,
    kind: 'weekly',
    weeklyPlanId: planId,
    weeklyItemId: item.id,
    date: dateKey,
    forced,
  };
}

// ------------------------- 规范化 / 构造 / 校验 -------------------------

export function genWeeklyPlanId(): string {
  return `weekly_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
export function genWeeklyItemId(): string {
  return `wk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
export function genWeeklyOverrideId(sourceItemId: string, date: string): string {
  return `ov_${sourceItemId}_${date}`;
}

/** 创建一个空的周测计划（锚点默认取今天所在周）。 */
export function createEmptyWeeklyPlan(now: number, name = '周测计划'): WeeklyPlan {
  const todayKey = getShanghaiDateKey(now);
  return {
    id: genWeeklyPlanId(),
    name,
    enabled: true,
    timezone: 'Asia/Shanghai',
    activeFrom: todayKey,
    activeUntil: null,
    repeatEveryWeeks: 1,
    anchorDate: todayKey,
    items: [],
    excludedDates: [],
    overrides: [],
    order: 0,
    classTag: '',
  };
}

const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 规范化任意新旧/外部导入的周测计划，补齐字段并纠正非法值。 */
export function normalizeWeeklyPlan(raw: unknown, index = 0): WeeklyPlan {
  const src = (raw ?? {}) as Partial<WeeklyPlan>;
  const items: WeeklyExamItem[] = (Array.isArray(src.items) ? src.items : [])
    .filter(Boolean)
    .map((it, i) => normalizeWeeklyItem(it, i));
  return {
    id: src.id || genWeeklyPlanId(),
    name: (src.name && String(src.name).trim()) || `周测计划${index + 1}`,
    enabled: src.enabled !== false,
    timezone: 'Asia/Shanghai',
    activeFrom: DATE_RE.test(src.activeFrom || '') ? (src.activeFrom as string) : '',
    activeUntil: DATE_RE.test(src.activeUntil || '') ? (src.activeUntil as string) : null,
    repeatEveryWeeks: clampRepeat(src.repeatEveryWeeks as number),
    anchorDate: DATE_RE.test(src.anchorDate || '') ? (src.anchorDate as string) : (src.activeFrom || ''),
    items,
    excludedDates: (Array.isArray(src.excludedDates) ? src.excludedDates : []).filter(d => DATE_RE.test(d)),
    overrides: (Array.isArray(src.overrides) ? src.overrides : []).filter(Boolean) as WeeklyExamOverride[],
    order: typeof src.order === 'number' ? src.order : index,
    classTag: typeof src.classTag === 'string' ? src.classTag.trim() : '',
  };
}

function normalizeWeeklyItem(raw: unknown, index: number): WeeklyExamItem {
  const s = (raw ?? {}) as Partial<WeeklyExamItem>;
  const weekday = ([1, 2, 3, 4, 5, 6, 7] as number[]).includes(s.weekday as number)
    ? (s.weekday as IsoWeekday)
    : 1;
  return {
    id: s.id || genWeeklyItemId(),
    name: (s.name && String(s.name).trim()) || `周测${index + 1}`,
    weekday,
    startTime: padHM(s.startTime || '19:00'),
    endTime: padHM(s.endTime || '20:00'),
    endNextDay: !!s.endNextDay,
    enabled: s.enabled !== false,
    order: typeof s.order === 'number' ? s.order : index,
    location: s.location,
    note: s.note,
  };
}

/**
 * 结构校验（对应设计 §12 的可静态判定项）。
 * 返回 error/warn 列表；不含需要交互确认的“同天重叠提示”等运行时项。
 */
export function validateWeeklyPlan(plan: WeeklyPlan): ScheduleValidationIssue[] {
  const issues: ScheduleValidationIssue[] = [];
  if (!DATE_RE.test(plan.activeFrom)) {
    issues.push({ level: 'error', code: 'plan.activeFrom', message: '计划生效日期无效' });
  }
  if (plan.activeUntil && DATE_RE.test(plan.activeUntil) && plan.activeUntil < plan.activeFrom) {
    issues.push({ level: 'error', code: 'plan.activeUntil', message: '结束日期不得早于生效日期' });
  }
  if (clampRepeat(plan.repeatEveryWeeks) !== plan.repeatEveryWeeks) {
    issues.push({ level: 'warn', code: 'plan.repeatEveryWeeks', message: '重复周期建议限制为 1–8 周' });
  }

  const seen = new Map<string, string>();
  for (const item of plan.items) {
    if (![1, 2, 3, 4, 5, 6, 7].includes(item.weekday)) {
      issues.push({ level: 'error', code: 'item.weekday', message: `「${item.name}」星期必须为 1–7`, itemId: item.id });
    }
    if (!HM_RE.test(item.startTime) || !HM_RE.test(item.endTime)) {
      issues.push({ level: 'error', code: 'item.time', message: `「${item.name}」时间必须为 HH:mm`, itemId: item.id });
    } else if (!item.endNextDay && item.endTime <= item.startTime) {
      issues.push({ level: 'error', code: 'item.range', message: `「${item.name}」结束时间必须晚于开始时间`, itemId: item.id });
    }
    const dup = `${item.weekday}|${item.startTime}|${item.endTime}|${item.name}`;
    if (seen.has(dup)) {
      issues.push({ level: 'warn', code: 'item.duplicate', message: `「${item.name}」存在完全重复的周测项`, itemId: item.id });
    } else {
      seen.set(dup, item.id);
    }
  }

  const itemIds = new Set(plan.items.map(i => i.id));
  for (const ov of plan.overrides) {
    if (!itemIds.has(ov.sourceItemId)) {
      issues.push({ level: 'warn', code: 'override.orphan', message: `例外记录引用了不存在的周测项（${ov.sourceItemId}）` });
    }
  }
  return issues;
}
