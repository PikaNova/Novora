import type { AlertsSettings, ExamItem, MajorExam } from '../types/index.js';
import type { DesignPolicy, ScheduleMode, WeeklyPlan, WeeklyConflictPolicy } from '../types/exam.js';
import { ALL_SCHEDULE_MODES } from '../types/exam.js';
import type { SchoolClass, SchoolGrade } from '../types/school.js';
import { normalizeExamItems } from '../utils/examSchedule.js';
import {
  normalizeClasses,
  normalizeGrades,
  normalizeInitialization,
  type InitializationState,
} from '../utils/settings/school.js';
import { normalizeConflictPolicy, normalizeWeeklyPlan } from '../utils/settings/weekly.js';
import { normalizeDesignPolicy } from '../utils/settings/design.js';
import { normalizeMajorBatchSettings, type MajorBatchSettings } from '../utils/settings/majorBatch.js';
import { normalizeAlerts } from '../utils/appSettings.js';
import { asRecord } from './typeGuards.js';
import { parseDeviceBinding, type DeviceBinding } from './deviceContracts.js';

export interface ExamPayload {
  ok?: boolean;
  items: ExamItem[];
  title: string;
  majors: MajorExam[];
  activeMajorId: string;
  alerts: AlertsSettings | null;
  scheduleMode?: ScheduleMode;
  weeklyPlans?: WeeklyPlan[];
  activeWeeklyPlanId?: string | null;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  grades?: SchoolGrade[];
  classes?: SchoolClass[];
  initialization?: InitializationState;
  weeklyConflictPolicy?: WeeklyConflictPolicy | null;
  designPolicy?: DesignPolicy;
  majorBatchPresets?: MajorBatchSettings & { updatedAt: number };
  metadata?: Record<string, unknown>;
  lifecycle?: Record<string, unknown>;
  binding?: DeviceBinding | null;
  updatedAt: number;
}

export function examEtag(updatedAt: unknown): string {
  const value = Number(updatedAt);
  return `"exam-${Number.isFinite(value) ? value : 0}"`;
}

/** 快照版本号转成整数，非法值一律归零。 */
export function parseExamVersion(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/**
 * 版本化快照的查询串。版本号同时是边缘缓存的键：数据没变就一直是同一个 URL，
 * 因此可以把整份快照长期缓存，只有写入后版本变化才会产生新的 URL。
 */
export function examSnapshotQuery(version: unknown): string {
  return `resource=snapshot&v=${parseExamVersion(version)}`;
}

/**
 * 是否用“长期可缓存的版本化快照”回应这次读取。只有 Vercel 部署、且请求里的版本
 * 与当前版本一致时成立；版本过期时按老路径返回且不缓存，避免把新内容缓存到旧版本 URL 下。
 */
export function isCurrentSnapshotRequest(input: {
  edgeDeployment: boolean;
  requestedVersion: unknown;
  currentVersion: unknown;
}): boolean {
  if (!input.edgeDeployment) return false;
  const requested = parseExamVersion(input.requestedVersion);
  return requested > 0 && requested === parseExamVersion(input.currentVersion);
}

/** The complete exam fields that admin save hooks compose before a version is assigned. */
export type ExamSavePayload = Omit<ExamPayload, 'updatedAt' | 'ok' | 'binding' | 'metadata' | 'lifecycle'>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function idText(value: unknown): string {
  return text(value).trim();
}

function order(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function idList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((item) => text(item).trim()).filter(Boolean) : undefined;
}

function parseExamItem(raw: unknown, index: number): ExamItem | null {
  const source = asRecord(raw);
  const id = idText(source.id);
  const name = text(source.name);
  const startTime = text(source.startTime);
  const endTime = text(source.endTime);
  if (!id || !startTime || !endTime) return null;
  const kind =
    source.kind === 'major' || source.kind === 'weekly' || source.kind === 'temporary' ? source.kind : undefined;
  return {
    ...(source as Record<string, unknown>),
    id,
    name,
    startTime,
    endTime,
    enabled: source.enabled !== false,
    order: order(source.order, index),
    targetGradeIds: idList(source.targetGradeIds),
    targetClassIds: idList(source.targetClassIds),
    ...(kind === undefined ? {} : { kind }),
    majorExamId: text(source.majorExamId) || undefined,
    majorName: text(source.majorName) || undefined,
  };
}

function parseMajorExam(raw: unknown, index: number): MajorExam | null {
  const source = asRecord(raw);
  const id = idText(source.id);
  if (!id) return null;
  const items = (Array.isArray(source.items) ? source.items : [])
    .map((item, itemIndex) => parseExamItem(item, itemIndex))
    .filter((item): item is ExamItem => item !== null);
  const sourceKind = source.source === 'quick' || source.source === 'regular' ? source.source : undefined;
  return {
    ...(source as Record<string, unknown>),
    id,
    name: text(source.name) || `考试${index + 1}`,
    items: normalizeExamItems(items),
    order: order(source.order, index),
    targetGradeIds: idList(source.targetGradeIds),
    targetClassIds: idList(source.targetClassIds),
    ...(sourceKind === undefined ? {} : { source: sourceKind }),
    temporary: source.temporary === true || sourceKind === 'quick',
    priorityOverSchedule: source.priorityOverSchedule === true,
    createdAt: typeof source.createdAt === 'number' && Number.isFinite(source.createdAt) ? source.createdAt : undefined,
    createdBy: typeof source.createdBy === 'number' && Number.isFinite(source.createdBy) ? source.createdBy : undefined,
    endedAt: typeof source.endedAt === 'number' && Number.isFinite(source.endedAt) ? source.endedAt : null,
  };
}

function parseWeeklyPlans(raw: unknown): WeeklyPlan[] {
  return (Array.isArray(raw) ? raw : []).map((item, index) => normalizeWeeklyPlan(item, index));
}

function parsePlanMap(raw: unknown): Record<string, string | null> | undefined {
  const source = asRecord(raw);
  const result: Record<string, string | null> = {};
  for (const [classId, planId] of Object.entries(source)) {
    result[classId] = typeof planId === 'string' ? planId : null;
  }
  return result;
}

function parseGrades(raw: unknown): SchoolGrade[] {
  return normalizeGrades(raw).map((grade) => ({
    ...grade,
    name: grade.name === 'undefined' ? '未命名年级' : grade.name,
  }));
}

function parseClasses(raw: unknown, grades: SchoolGrade[]): SchoolClass[] {
  return normalizeClasses(raw, grades).map(({ track, ...schoolClass }) => ({
    ...schoolClass,
    name: schoolClass.name === 'undefined' ? '未命名班级' : schoolClass.name,
    ...(Array.isArray(track) ? { track } : {}),
  }));
}

function parseMajorBatchPresets(raw: unknown): (MajorBatchSettings & { updatedAt: number }) | undefined {
  if (raw == null) return undefined;
  return { ...normalizeMajorBatchSettings(raw), updatedAt: Number(asRecord(raw).updatedAt ?? 0) || 0 };
}

export function parseExamPayload(raw: unknown): ExamPayload {
  const source = asRecord(raw);
  const grades = parseGrades(source.grades);
  const classes = parseClasses(source.classes, grades);
  const scheduleMode = ALL_SCHEDULE_MODES.includes(source.scheduleMode as ScheduleMode)
    ? (source.scheduleMode as ScheduleMode)
    : undefined;
  const activeWeeklyPlanId =
    typeof source.activeWeeklyPlanId === 'string'
      ? source.activeWeeklyPlanId
      : source.activeWeeklyPlanId === null
        ? null
        : undefined;
  return {
    ok: source.ok === true ? true : undefined,
    items: normalizeExamItems(
      (Array.isArray(source.items) ? source.items : [])
        .map((item, index) => parseExamItem(item, index))
        .filter((item): item is ExamItem => item !== null),
    ),
    title: text(source.title),
    majors: (Array.isArray(source.majors) ? source.majors : [])
      .map((item, index) => parseMajorExam(item, index))
      .filter((item): item is MajorExam => item !== null),
    activeMajorId: text(source.activeMajorId),
    alerts: source.alerts == null ? null : normalizeAlerts(source.alerts),
    scheduleMode,
    weeklyPlans: parseWeeklyPlans(source.weeklyPlans),
    activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId: parsePlanMap(source.activeWeeklyPlanIdByClassId),
    grades,
    classes,
    initialization: normalizeInitialization(source.initialization),
    weeklyConflictPolicy:
      source.weeklyConflictPolicy == null ? null : normalizeConflictPolicy(source.weeklyConflictPolicy),
    designPolicy: normalizeDesignPolicy(source.designPolicy),
    majorBatchPresets: parseMajorBatchPresets(source.majorBatchPresets),
    ...(source.metadata === undefined ? {} : { metadata: asRecord(source.metadata) }),
    ...(source.lifecycle === undefined ? {} : { lifecycle: asRecord(source.lifecycle) }),
    binding: source.binding == null ? null : parseDeviceBinding(source.binding),
    updatedAt: Number(source.updatedAt ?? 0) || 0,
  };
}
