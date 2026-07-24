import type { ExamItem } from '../types';
import type {
  WeeklyConflictPolicy,
  WeeklyOccurrence,
  MajorScheduleBlock,
  ScheduleConflict,
  ResolvedSchedule,
  ScheduleMode,
} from '../types/exam';
import { DEFAULT_WEEKLY_CONFLICT_POLICY } from '../types/exam';
import { parseZonedTime } from './timeSource';
import { sortExamItemsByTime } from './examSchedule';
import { getShanghaiDateKey, resolveWeeklyOccurrences } from './weeklySchedule';
import type { ResolveWeeklyOptions } from './weeklySchedule';

/**
 * 大型考试 <-> 周测 冲突判断，以及统一调度出口。
 *
 * 核心原则（设计 §6）：自动模式下大型考试优先；冲突只把“本次周测实例”标记暂停，
 * 从不修改周期规则；被暂停的周测不进入大屏 / 首页 / 提醒队列。
 */

const MINUTE_MS = 60_000;

/** 左闭右开区间 [start, end) 的时间重叠判断（毫秒）。 */
export function isTimeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** 带前后缓冲的重叠判断：把大型考试时段按缓冲向两侧扩张后再判重叠。 */
export function isOverlapWithBuffer(
  major: ExamItem,
  weekly: ExamItem,
  beforeMinutes: number,
  afterMinutes: number,
): boolean {
  const majorStart = parseZonedTime(major.startTime) - beforeMinutes * MINUTE_MS;
  const majorEnd = parseZonedTime(major.endTime) + afterMinutes * MINUTE_MS;
  const weeklyStart = parseZonedTime(weekly.startTime);
  const weeklyEnd = parseZonedTime(weekly.endTime);
  if (![majorStart, majorEnd, weeklyStart, weeklyEnd].every(Number.isFinite)) return false;
  return isTimeOverlap(weeklyStart, weeklyEnd, majorStart, majorEnd);
}

/** 取一组大型考试科目覆盖的上海日历日区间（第一门开始日 ~ 最后一门结束日）。 */
export function getMajorPeriod(items: ExamItem[]): { startKey: string; endKey: string } | null {
  const starts: string[] = [];
  const ends: string[] = [];
  for (const m of items) {
    const s = parseZonedTime(m.startTime);
    const e = parseZonedTime(m.endTime);
    if (Number.isFinite(s)) starts.push(getShanghaiDateKey(s));
    if (Number.isFinite(e)) ends.push(getShanghaiDateKey(e));
  }
  if (!starts.length || !ends.length) return null;
  starts.sort();
  ends.sort();
  return { startKey: starts[0], endKey: ends[ends.length - 1] };
}

/** 单个大型考试科目覆盖到的上海日历日集合（含跨日）。 */
function majorItemCoversDate(major: ExamItem, dateKey: string): boolean {
  const s = parseZonedTime(major.startTime);
  const e = parseZonedTime(major.endTime);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  return dateKey >= getShanghaiDateKey(s) && dateKey <= getShanghaiDateKey(e);
}

type Detected = { type: ScheduleConflict['type']; majorItem?: ExamItem };

const SCOPE_RANK: Record<ScheduleConflict['type'], number> = {
  'time-overlap': 1,
  'buffer-overlap': 1,
  'whole-day': 2,
  'whole-major-period': 3,
};

/** 判断某个周测实例是否与一个大型考试块冲突（按该块的策略）。 */
function detectAgainstBlock(occ: WeeklyOccurrence, block: MajorScheduleBlock): Detected | null {
  const pol = block.policy ?? DEFAULT_WEEKLY_CONFLICT_POLICY;
  if (!pol.enabled || !block.items.length) return null;

  if (pol.scope === 'whole-major-period') {
    const period = getMajorPeriod(block.items);
    if (period && occ.date >= period.startKey && occ.date <= period.endKey) {
      return { type: 'whole-major-period', majorItem: block.items[0] };
    }
    return null;
  }

  if (pol.scope === 'whole-day') {
    const hit = block.items.find(m => majorItemCoversDate(m, occ.date));
    return hit ? { type: 'whole-day', majorItem: hit } : null;
  }

  // time-overlap（可带缓冲）
  const buffered = pol.bufferBeforeMinutes > 0 || pol.bufferAfterMinutes > 0;
  const hit = block.items.find(m => isOverlapWithBuffer(m, occ, pol.bufferBeforeMinutes, pol.bufferAfterMinutes));
  return hit ? { type: buffered ? 'buffer-overlap' : 'time-overlap', majorItem: hit } : null;
}

function buildConflict(occ: WeeklyOccurrence, block: MajorScheduleBlock, detected: Detected, forced: boolean): ScheduleConflict {
  const m = detected.majorItem;
  return {
    id: `conflict_${occ.occurrenceId}_${block.id}`,
    type: detected.type,
    majorExamId: block.id,
    majorItemId: m?.id,
    weeklyPlanId: occ.weeklyPlanId,
    weeklyItemId: occ.weeklyItemId,
    weeklyOccurrenceId: occ.occurrenceId,
    date: occ.date,
    majorName: block.name,
    weeklyName: occ.name,
    majorStartTime: m?.startTime ?? '',
    majorEndTime: m?.endTime ?? '',
    weeklyStartTime: occ.startTime,
    weeklyEndTime: occ.endTime,
    resolution: forced ? 'weekly-forced' : 'major-wins',
    message: forced
      ? `管理员已确认「${occ.name}」在 ${occ.date} 大型考试期间仍然进行`
      : `「${occ.name}」与大型考试「${block.name}」冲突，已暂停本次（${occ.date}）`,
  };
}

export interface MajorWeeklyResolution {
  activeWeekly: WeeklyOccurrence[];
  suppressedWeekly: WeeklyOccurrence[];
  conflicts: ScheduleConflict[];
}

/**
 * 对每个周测实例，逐一比对所有启用的大型考试块；任意冲突即算冲突，
 * 多块冲突时取“更严格”的 scope 作为冲突类型（whole-major-period > whole-day > time-overlap）。
 * forceRunDuringMajorExam 的实例不被暂停，但仍记录一条 weekly-forced 冲突。
 */
export function resolveMajorWeeklyConflicts(
  majorBlocks: MajorScheduleBlock[],
  weeklyOccurrences: WeeklyOccurrence[],
): MajorWeeklyResolution {
  const activeWeekly: WeeklyOccurrence[] = [];
  const suppressedWeekly: WeeklyOccurrence[] = [];
  const conflicts: ScheduleConflict[] = [];

  for (const occ of weeklyOccurrences) {
    let strongest: { block: MajorScheduleBlock; detected: Detected } | null = null;
    for (const block of majorBlocks) {
      const detected = detectAgainstBlock(occ, block);
      if (!detected) continue;
      if (!strongest || SCOPE_RANK[detected.type] > SCOPE_RANK[strongest.detected.type]) {
        strongest = { block, detected };
      }
    }

    if (!strongest) {
      activeWeekly.push(occ);
      continue;
    }

    conflicts.push(buildConflict(occ, strongest.block, strongest.detected, occ.forced));
    if (occ.forced) activeWeekly.push(occ);
    else suppressedWeekly.push(occ);
  }

  return { activeWeekly, suppressedWeekly, conflicts };
}

export interface ResolveScheduleInput {
  scheduleMode: ScheduleMode;
  activeMajorId: string | null;
  activeWeeklyPlanId: string | null;
  majors: Array<{ id: string; name: string; items: ExamItem[]; targetGradeIds?: string[]; targetClassIds?: string[] }>;
  weeklyPlans: Array<Parameters<typeof resolveWeeklyOccurrences>[0]>;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  selectedGradeId?: string;
  selectedClassId?: string;
  weeklyConflictPolicy?: WeeklyConflictPolicy;
}

/**
 * 统一调度出口：把大型考试 + 当前周测计划解析成最终的标准 ExamItem 时间线。
 * 上层（大屏 / 首页 / 提醒 / 13 套设计）只消费返回的 activeItems。
 */
export function resolveEffectiveSchedule(
  data: ResolveScheduleInput,
  now: number,
  options?: ResolveWeeklyOptions,
): ResolvedSchedule {
  const selectedGradeId = (data.selectedGradeId || '').trim();
  const selectedClassId = (data.selectedClassId || '').trim();
  const applicableMajors = data.majors.filter(major => {
    const gradeApplies = !major.targetGradeIds?.length || (!!selectedGradeId && major.targetGradeIds.includes(selectedGradeId));
    const classApplies = !major.targetClassIds?.length || (!!selectedClassId && major.targetClassIds.includes(selectedClassId));
    return gradeApplies && classApplies;
  });
  const candidates = applicableMajors.flatMap(major => {
    const priority = major.targetClassIds?.length ? 2 : major.targetGradeIds?.length ? 1 : 0;
    return major.items.filter(item => item.enabled).map(item => ({ ...item, kind: 'major' as const, majorExamId: major.id, majorName: major.name, scopePriority: priority }));
  });
  // 同时存在全校、年级和班级安排时，仅在实际时间重叠处使用更具体的安排。
  const majorItems = sortExamItemsByTime(candidates.filter(item => !candidates.some(other => other.scopePriority > item.scopePriority && isTimeOverlap(parseZonedTime(item.startTime), parseZonedTime(item.endTime), parseZonedTime(other.startTime), parseZonedTime(other.endTime)))).map(({ scopePriority: _scopePriority, ...item }) => item));

  const classPlanId = selectedClassId
    ? data.activeWeeklyPlanIdByClassId?.[selectedClassId]
    : data.activeWeeklyPlanId;
  const activePlan = data.weeklyPlans.find(p => p && p.id === classPlanId && p.classId === selectedClassId)
    ?? data.weeklyPlans.find(p => p && p.classId === selectedClassId)
    ?? data.weeklyPlans.find(p => p && p.id === classPlanId)
    ?? null;
  const weeklyOccurrences = resolveWeeklyOccurrences(activePlan, now, options);

  if (data.scheduleMode === 'major-only') {
    return { activeItems: majorItems, suppressedWeeklyItems: [], conflicts: [] };
  }
  if (data.scheduleMode === 'weekly-only') {
    return { activeItems: sortExamItemsByTime(weeklyOccurrences), suppressedWeeklyItems: [], conflicts: [] };
  }

  // automatic
  const policy = data.weeklyConflictPolicy ?? DEFAULT_WEEKLY_CONFLICT_POLICY;
  const visibleIds = new Set(majorItems.map(item => item.majorExamId));
  const majorBlocks: MajorScheduleBlock[] = applicableMajors
    .filter(major => visibleIds.has(major.id))
    .map(major => ({ id: major.id, name: major.name, items: majorItems.filter(item => item.majorExamId === major.id), policy }));

  const { activeWeekly, suppressedWeekly, conflicts } = resolveMajorWeeklyConflicts(majorBlocks, weeklyOccurrences);
  return {
    activeItems: sortExamItemsByTime([...majorItems, ...activeWeekly]),
    suppressedWeeklyItems: suppressedWeekly,
    conflicts,
  };
}
