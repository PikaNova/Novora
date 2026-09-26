// 保存请求的「域」定义与变化域计算。
//
// 背景：`exam_data` 是单行快照，历史上每次保存都提交整份数据。客户端与服务端共用本模块，
// 目的是让提交变成「只携带改动的域」，同时保证两侧对「哪些字段算一个域」的判断完全一致——
// 一旦不一致，就会出现服务端把没携带的域当成“要清空”，或客户端漏发某个改动域。
//
// 约定：
// - `EXAM_SAVE_DOMAINS` 与 `api/_exams/routes/examDataRoutes.ts` 的写入列一一对应。
// - 判定「是否携带」用 `hasOwnProperty`，从而区分「没带这个域」与「显式传 null（清空）」。
// - `items`/`title` 是 `majors[activeMajorId]` 的镜像，必须与 `majors`、`activeMajorId` 同进同退。

import type { AlertsSettings, ExamItem, MajorExam } from '../types/index.js';
import type { ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../types/exam.js';
import type { SchoolClass, SchoolGrade } from '../types/school.js';
import type { InitializationState } from '../utils/settings/school.js';
import { sameJson } from './jsonCompare.js';

/** 可以单独携带的保存域；顺序固定，便于日志与测试稳定比较。 */
export const EXAM_SAVE_DOMAINS = [
  'majors',
  'items',
  'title',
  'activeMajorId',
  'alerts',
  'scheduleMode',
  'weeklyPlans',
  'activeWeeklyPlanId',
  'activeWeeklyPlanIdByClassId',
  'grades',
  'classes',
  'initialization',
  'weeklyConflictPolicy',
] as const;

export type ExamSaveDomain = (typeof EXAM_SAVE_DOMAINS)[number];

/**
 * 冲突判定的粒度：一个修订域 = 一组「总是一起改」的保存域。
 *
 * 之所以不是每个保存域一个版本号：`items`/`title` 本来就跟着 `majors` 走，周测计划与
 * 「哪份计划生效」也是一次编辑动作里一起改的。按修订域分版本，才能让「改班级」与「改周测」
 * 互不冲突，同时不把版本号拆得过碎。
 */
export const EXAM_REVISION_DOMAINS = [
  'major',
  'alerts',
  'weekly',
  'schedule',
  'grades',
  'classes',
  'initialization',
] as const;

export type ExamRevisionDomain = (typeof EXAM_REVISION_DOMAINS)[number];

/** 修订域 → 保存域；每个保存域必须且只能属于一个修订域（有测试锁定完整性）。 */
export const EXAM_REVISION_DOMAIN_FIELDS: Record<ExamRevisionDomain, readonly ExamSaveDomain[]> = {
  major: ['majors', 'items', 'title', 'activeMajorId'],
  alerts: ['alerts'],
  weekly: ['weeklyPlans', 'activeWeeklyPlanId', 'activeWeeklyPlanIdByClassId'],
  schedule: ['scheduleMode', 'weeklyConflictPolicy'],
  grades: ['grades'],
  classes: ['classes'],
  initialization: ['initialization'],
};

/** 保存域 → 它所属的修订域。 */
export function revisionDomainOf(domain: ExamSaveDomain): ExamRevisionDomain {
  for (const revisionDomain of EXAM_REVISION_DOMAINS) {
    if (EXAM_REVISION_DOMAIN_FIELDS[revisionDomain].includes(domain)) return revisionDomain;
  }
  /* 覆盖率由测试保证，这里只是类型兜底。 */
  return 'major';
}

/** 一组保存域涉及到的修订域（去重，顺序稳定）。 */
export function revisionDomainsFor(domains: readonly ExamSaveDomain[]): ExamRevisionDomain[] {
  const wanted = new Set(domains.map(revisionDomainOf));
  return EXAM_REVISION_DOMAINS.filter((domain) => wanted.has(domain));
}

/** 容错解析服务端返回的修订号表；非法值一律丢弃，缺省按 0 处理。 */
export function parseExamRevisions(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const revision = Number(raw);
    if (!Number.isFinite(revision) || revision < 0) continue;
    parsed[key] = Math.floor(revision);
  }
  return parsed;
}

/**
 * 合并修订号表：`only` 给出「本次真正提交过、因此可以采信服务端新值」的修订域。
 *
 * 只提交了一部分域时，其余域的本地内容仍然基于旧版本，它们的修订号必须保持旧值——
 * 否则会出现「本地还是旧内容，却拿着新版本号通过并发校验」的静默覆盖。
 */
export function mergeExamRevisions(
  current: Record<string, number> | undefined,
  incoming: unknown,
  only: readonly ExamRevisionDomain[],
): Record<string, number> {
  const merged = { ...(current ?? {}) };
  const next = parseExamRevisions(incoming);
  for (const domain of only) {
    if (typeof next[domain] === 'number') merged[domain] = next[domain];
  }
  return merged;
}

/** 提交体里实际出现过的域（`hasOwnProperty` 语义）。 */
export function presentExamSaveDomains(body: Record<string, unknown> | null | undefined): ExamSaveDomain[] {
  if (!body || typeof body !== 'object') return [];
  return EXAM_SAVE_DOMAINS.filter((domain) => Object.prototype.hasOwnProperty.call(body, domain));
}

/** 是否至少携带了一个可写域；服务端据此拒绝空提交。 */
export function hasExamSaveDomain(body: Record<string, unknown> | null | undefined): boolean {
  return presentExamSaveDomains(body).length > 0;
}

/** 一次保存请求里客户端会携带的全部数据（与服务端 payload 对齐）。 */
export interface ExamSaveSnapshot {
  items: ExamItem[];
  title: string;
  majors: MajorExam[];
  activeMajorId: string;
  alerts?: AlertsSettings | null;
  scheduleMode?: ScheduleMode;
  weeklyPlans?: WeeklyPlan[];
  activeWeeklyPlanId?: string | null;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  grades?: SchoolGrade[];
  classes?: SchoolClass[];
  initialization?: InitializationState;
  weeklyConflictPolicy?: WeeklyConflictPolicy | null;
}

export interface ExamSaveDiff {
  /** 只包含发生变化的域；域值即要提交的内容。 */
  body: Record<string, unknown>;
  /** 变化的域名，顺序与 `EXAM_SAVE_DOMAINS` 一致。 */
  domains: ExamSaveDomain[];
}

/**
 * 计算相对基线快照的变化域。
 *
 * - 未携带（`undefined`）的域一律视为「本次不改」；显式的 `null` 才是清空。
 * - `items`/`title`/`majors`/`activeMajorId` 作为一个整体判定：只要其中一个变化就四个一起提交，
 *   因为服务端对受限账号也会从 `majors[activeMajorId]` 重新派生镜像字段。
 */
export function changedExamDomains(input: ExamSaveSnapshot, base: ExamSaveSnapshot): ExamSaveDiff {
  const body: Record<string, unknown> = {};
  const domains: ExamSaveDomain[] = [];
  const add = (domain: ExamSaveDomain, value: unknown) => {
    body[domain] = value;
    domains.push(domain);
  };

  const majors = input.majors ?? [];
  const items = input.items ?? [];
  const title = input.title ?? '';
  const activeMajorId = input.activeMajorId ?? '';
  const majorGroupChanged =
    !sameJson(majors, base.majors ?? []) ||
    !sameJson(items, base.items ?? []) ||
    title !== (base.title ?? '') ||
    activeMajorId !== (base.activeMajorId ?? '');
  if (majorGroupChanged) {
    add('majors', majors);
    add('items', items);
    add('title', title);
    add('activeMajorId', activeMajorId);
  }

  if (input.alerts !== undefined && !sameJson(input.alerts ?? null, base.alerts ?? null)) {
    add('alerts', input.alerts ?? null);
  }
  if (input.scheduleMode !== undefined && input.scheduleMode !== base.scheduleMode) {
    add('scheduleMode', input.scheduleMode);
  }
  if (input.weeklyPlans !== undefined && !sameJson(input.weeklyPlans, base.weeklyPlans ?? [])) {
    add('weeklyPlans', input.weeklyPlans);
  }
  if (
    input.activeWeeklyPlanId !== undefined &&
    (input.activeWeeklyPlanId ?? null) !== (base.activeWeeklyPlanId ?? null)
  ) {
    add('activeWeeklyPlanId', input.activeWeeklyPlanId);
  }
  if (
    input.activeWeeklyPlanIdByClassId !== undefined &&
    !sameJson(input.activeWeeklyPlanIdByClassId, base.activeWeeklyPlanIdByClassId ?? {})
  ) {
    add('activeWeeklyPlanIdByClassId', input.activeWeeklyPlanIdByClassId);
  }
  if (input.grades !== undefined && !sameJson(input.grades, base.grades ?? [])) {
    add('grades', input.grades);
  }
  if (input.classes !== undefined && !sameJson(input.classes, base.classes ?? [])) {
    add('classes', input.classes);
  }
  if (input.initialization !== undefined && !sameJson(input.initialization, base.initialization)) {
    add('initialization', input.initialization);
  }
  if (
    input.weeklyConflictPolicy !== undefined &&
    !sameJson(input.weeklyConflictPolicy ?? null, base.weeklyConflictPolicy ?? null)
  ) {
    add('weeklyConflictPolicy', input.weeklyConflictPolicy);
  }

  return { body, domains };
}

/**
 * 整份提交体（基线快照不可用时使用）。
 *
 * `alerts` 沿用历史语义：未提供时按 `null` 提交；`items`/`title` 未提供时归一为空值。
 * 只有「拿不到可比的基线」时才会走到这里，保证行为与改动前完全一致。
 */
export function fullExamSaveBody(input: ExamSaveSnapshot): Record<string, unknown> {
  const body: Record<string, unknown> = {
    items: input.items ?? [],
    title: input.title ?? '',
    majors: input.majors ?? [],
    activeMajorId: input.activeMajorId ?? '',
    alerts: input.alerts ?? null,
  };
  if (input.scheduleMode !== undefined) body.scheduleMode = input.scheduleMode;
  if (input.weeklyPlans !== undefined) body.weeklyPlans = input.weeklyPlans;
  if (input.activeWeeklyPlanId !== undefined) body.activeWeeklyPlanId = input.activeWeeklyPlanId;
  if (input.activeWeeklyPlanIdByClassId !== undefined)
    body.activeWeeklyPlanIdByClassId = input.activeWeeklyPlanIdByClassId;
  if (input.grades !== undefined) body.grades = input.grades;
  if (input.classes !== undefined) body.classes = input.classes;
  if (input.initialization !== undefined) body.initialization = input.initialization;
  if (input.weeklyConflictPolicy !== undefined) body.weeklyConflictPolicy = input.weeklyConflictPolicy;
  return body;
}
