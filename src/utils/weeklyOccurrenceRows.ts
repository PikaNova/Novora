import type { WeeklyPlan } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { parseZonedTime } from './zonedTime';
import { resolveWeeklyOccurrences } from './weeklySchedule';

/**
 * 「考试安排」里与大型考试混排的周测实例（只读）。
 *
 * 周测在库里是周期性课表，不是单场考试记录；这里把它按日期展开成可展示的行，
 * 让"今天/本周要考什么"在一张列表里看全。编辑仍然回到周测计划编辑器，
 * 不在这里直接改，避免和周测那套（周次、A/B 周、例外、冲突）出现第二套语义。
 */
export type WeeklyOccurrenceRow = {
  key: string;
  planId: string;
  classId: string;
  className: string;
  gradeName: string;
  /** 'YYYY-MM-DD'（上海日历日） */
  dateKey: string;
  name: string;
  startClock: string;
  endClock: string;
  startAt: number;
  endAt: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DDTHH:mm' → 'YYYY-MM-DDTHH:mm:ss'（parseZonedTime 需要秒位）。 */
function withSeconds(value: string): string {
  return value.length === 16 ? `${value}:00` : value;
}

export function buildWeeklyOccurrenceRows(input: {
  plans: WeeklyPlan[];
  activePlanIdByClassId?: Record<string, string | null>;
  classes: SchoolClass[];
  grades: SchoolGrade[];
  now: number;
  daysBack?: number;
  daysForward?: number;
}): WeeklyOccurrenceRow[] {
  const { plans, activePlanIdByClassId = {}, classes, grades, now } = input;
  const daysBack = input.daysBack ?? 0;
  const daysForward = input.daysForward ?? 7;
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  // 每个班只取生效中的那套计划：优先用"按班生效"映射，没有映射的班退回它自己的启用计划。
  const effective = new Map<string, WeeklyPlan>();
  for (const [classId, planId] of Object.entries(activePlanIdByClassId)) {
    const plan = planId ? byId.get(planId) : undefined;
    if (plan) effective.set(classId, plan);
  }
  for (const plan of plans) {
    if (!plan.enabled || !plan.classId) continue;
    if (!effective.has(plan.classId)) effective.set(plan.classId, plan);
  }

  const rows: WeeklyOccurrenceRow[] = [];
  for (const [classId, plan] of effective) {
    const klass = classes.find((item) => item.id === classId);
    const gradeName = grades.find((grade) => grade.id === (klass?.gradeId ?? plan.gradeId))?.name ?? '';
    for (const occurrence of resolveWeeklyOccurrences(plan, now, { daysBack, daysForward })) {
      if (!occurrence.enabled) continue;
      // 注意：resolveWeeklyOccurrences 给出的 startTime/endTime 已经是
      // 完整本地时间（'2026-09-18T10:30'），跨天的那条日期已经在第二天。
      const startIso = occurrence.startTime || '';
      const endIso = occurrence.endTime || '';
      if (!startIso || !endIso) continue;
      const startAt = parseZonedTime(withSeconds(startIso));
      let endAt = parseZonedTime(withSeconds(endIso));
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) continue;
      // 兜底：异常数据导致结束不晚于开始时，按第二天处理，避免出现负时长。
      if (endAt <= startAt) endAt += DAY_MS;
      const startClock = startIso.slice(11, 16);
      const endClock = endIso.slice(11, 16);
      rows.push({
        key: `${plan.id}:${occurrence.occurrenceId}`,
        planId: plan.id,
        classId,
        className: klass?.name ?? classId,
        gradeName,
        dateKey: occurrence.date,
        name: occurrence.name,
        startClock,
        endClock,
        startAt,
        endAt,
      });
    }
  }
  return rows.sort((left, right) => left.startAt - right.startAt || left.classId.localeCompare(right.classId));
}
