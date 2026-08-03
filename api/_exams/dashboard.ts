// api/_exams/dashboard.ts
// 数据大屏聚合逻辑（纯函数，不依赖数据库连接）：
// 供 api/_exams/routes/dashboardRoutes.ts 使用，并被 tests/dashboard.test.ts 直接单测。
import {
  canAccessClass,
  canAccessGrade,
  hasAllScope,
  type PermissionSubject,
} from "../../src/shared/permissionRules.js";
import { getShanghaiDateKey, weekIndexOfDateKey } from "../../src/utils/weeklySchedule.js";
import { parseZonedTime } from "../../src/utils/zonedTime.js";

export type DashboardGrade = { id: string; name: string; enabled?: boolean };
export type DashboardClass = { id: string; gradeId: string; name: string; enabled?: boolean };
export type DashboardItem = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  enabled?: boolean;
  targetGradeIds?: string[];
  targetClassIds?: string[];
};
export type DashboardMajor = {
  id: string;
  name: string;
  items: DashboardItem[];
  targetGradeIds?: string[];
  targetClassIds?: string[];
  endedAt?: number | null;
};
export type DashboardDevice = {
  instance_id: string;
  grade_id?: string | null;
  class_id?: string | null;
  revoked?: boolean;
  is_management?: boolean;
  last_seen_at?: number | string | null;
  current_exam?: string | null;
  exam_start?: number | string | null;
  exam_end?: number | string | null;
  status?: string | null;
};

export type ScopedItem = {
  id: string;
  subject: string;
  majorName: string;
  startTime: string;
  endTime: string;
  majorEndedAt: number | null;
  gradeNames: string[];
  classNames: string[];
  isSchoolWide: boolean;
};

export type DashboardStats = {
  total: number;
  ongoing: number;
  upcoming: number;
  ended: number;
  today: number;
  thisWeek: number;
  onlineDevices: number;
  inExamDevices: number;
};

export type DashboardEntry = {
  id: string;
  subject: string;
  majorName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  scopeLabel: string;
};

export type DistributionRow = { label: string; count: number; percent: number };

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const itemDateKey = (item: DashboardItem | ScopedItem): string => item.startTime.slice(0, 10);

const itemStartMs = (item: DashboardItem | ScopedItem): number => parseZonedTime(item.startTime);
const itemEndMs = (item: DashboardItem | ScopedItem): number => parseZonedTime(item.endTime);

export function actorVisibleGradeIds(
  actor: PermissionSubject,
  grades: DashboardGrade[],
): string[] {
  if (hasAllScope(actor)) return grades.map(grade => grade.id);
  const ids = new Set<string>();
  for (const scope of actor.scopes) {
    if ((scope.type === "grade" || scope.type === "class") && scope.gradeId) {
      ids.add(scope.gradeId);
    }
  }
  return [...ids];
}

export function actorVisibleClassIds(
  actor: PermissionSubject,
  classes: DashboardClass[],
): string[] {
  if (hasAllScope(actor)) return classes.map(item => item.id);
  const gradeScopes = new Set<string>();
  const classIds = new Set<string>();
  for (const scope of actor.scopes) {
    if (scope.type === "grade" && scope.gradeId) gradeScopes.add(scope.gradeId);
    if (scope.type === "class" && scope.classId) classIds.add(scope.classId);
  }
  for (const schoolClass of classes) {
    if (gradeScopes.has(schoolClass.gradeId)) classIds.add(schoolClass.id);
  }
  return [...classIds];
}

/** 场次有效年级目标；undefined 表示全校（沿用大型考试范围或空 = 全部年级）。 */
function effectiveGradeIds(
  major: DashboardMajor,
  item: DashboardItem,
): string[] | undefined {
  if (item.targetGradeIds?.length) return item.targetGradeIds;
  if (major.targetGradeIds?.length) return major.targetGradeIds;
  return undefined;
}

/** 场次有效班级目标；undefined 表示所选年级全部班级。 */
function effectiveClassIds(
  major: DashboardMajor,
  item: DashboardItem,
): string[] | undefined {
  if (item.targetClassIds?.length) return item.targetClassIds;
  if (major.targetClassIds?.length) return major.targetClassIds;
  return undefined;
}

export function itemAppliesToActor(
  actor: PermissionSubject,
  major: DashboardMajor,
  item: DashboardItem,
  grades: DashboardGrade[],
  classes: DashboardClass[],
): boolean {
  if (hasAllScope(actor)) return true;
  const gradePool = effectiveGradeIds(major, item) ?? grades.map(grade => grade.id);
  const gradeVisible = gradePool.some(gradeId => canAccessGrade(actor, gradeId));
  if (!gradeVisible) return false;
  const classTargets = effectiveClassIds(major, item);
  if (!classTargets?.length) return true;
  const classById = new Map(classes.map(schoolClass => [schoolClass.id, schoolClass]));
  return classTargets.some(classId => {
    const schoolClass = classById.get(classId);
    return schoolClass ? canAccessClass(actor, schoolClass.gradeId, classId) : false;
  });
}

export function collectScopedItems(
  majors: DashboardMajor[],
  grades: DashboardGrade[],
  classes: DashboardClass[],
  actor: PermissionSubject,
): ScopedItem[] {
  const gradeById = new Map(grades.map(grade => [grade.id, grade]));
  const classById = new Map(classes.map(schoolClass => [schoolClass.id, schoolClass]));
  const result: ScopedItem[] = [];
  for (const major of majors) {
    if (!Array.isArray(major.items)) continue;
    for (const item of major.items) {
      if (item.enabled === false) continue;
      if (!itemAppliesToActor(actor, major, item, grades, classes)) continue;
      const effGrades = effectiveGradeIds(major, item);
      const effClasses = effectiveClassIds(major, item);
      const gradeNames = (effGrades ?? grades.map(grade => grade.id))
        .map(gradeId => gradeById.get(gradeId)?.name ?? "")
        .filter(Boolean);
      const classNames = (effClasses ?? [])
        .map(classId => classById.get(classId)?.name ?? "")
        .filter(Boolean);
      result.push({
        id: item.id,
        subject: item.name,
        majorName: major.name,
        startTime: item.startTime,
        endTime: item.endTime,
        majorEndedAt: typeof major.endedAt === "number" ? major.endedAt : null,
        gradeNames,
        classNames,
        isSchoolWide: effGrades === undefined,
      });
    }
  }
  return result;
}

function isMajorEnded(item: ScopedItem, now: number): boolean {
  return item.majorEndedAt !== null && item.majorEndedAt <= now;
}

export function aggregateStats(items: ScopedItem[], now: number): Omit<DashboardStats, "onlineDevices" | "inExamDevices"> {
  const todayKey = getShanghaiDateKey(now);
  const thisWeekIndex = weekIndexOfDateKey(todayKey);
  let total = 0;
  let ongoing = 0;
  let upcoming = 0;
  let ended = 0;
  let today = 0;
  let thisWeek = 0;
  for (const item of items) {
    total += 1;
    const startMs = itemStartMs(item);
    const endMs = itemEndMs(item);
    const majorEnded = isMajorEnded(item, now);
    if (!majorEnded && startMs <= now && now < endMs) ongoing += 1;
    else if (!majorEnded && startMs > now) upcoming += 1;
    else ended += 1;
    const dateKey = itemDateKey(item);
    if (dateKey === todayKey) today += 1;
    if (weekIndexOfDateKey(dateKey) === thisWeekIndex) thisWeek += 1;
  }
  return { total, ongoing, upcoming, ended, today, thisWeek };
}

function entryFromItem(item: ScopedItem): DashboardEntry {
  const durationMinutes = Math.max(0, Math.round((itemEndMs(item) - itemStartMs(item)) / 60_000));
  const scopeLabel = item.isSchoolWide
    ? "全校"
    : [item.gradeNames.join("、"), item.classNames.join("、")].filter(Boolean).join(" · ");
  return {
    id: item.id,
    subject: item.subject,
    majorName: item.majorName,
    startTime: item.startTime,
    endTime: item.endTime,
    durationMinutes,
    scopeLabel: scopeLabel || "全校",
  };
}

export function buildUpcoming(items: ScopedItem[], now: number, limit = 5): DashboardEntry[] {
  return items
    .filter(item => !isMajorEnded(item, now) && itemStartMs(item) > now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, limit)
    .map(entryFromItem);
}

export function buildOngoing(items: ScopedItem[], now: number, limit = 5): DashboardEntry[] {
  return items
    .filter(item => !isMajorEnded(item, now) && itemStartMs(item) <= now && now < itemEndMs(item))
    .sort((a, b) => a.endTime.localeCompare(b.endTime))
    .slice(0, limit)
    .map(entryFromItem);
}

export function buildRecentEnded(items: ScopedItem[], now: number, limit = 5): DashboardEntry[] {
  return items
    .filter(item => isMajorEnded(item, now) || itemEndMs(item) <= now)
    .sort((a, b) => b.endTime.localeCompare(a.endTime))
    .slice(0, limit)
    .map(entryFromItem);
}

export function buildSubjectDistribution(
  items: ScopedItem[],
  now: number,
  windowDays = 7,
): DistributionRow[] {
  const windowEnd = now + windowDays * 86_400_000;
  const counts = new Map<string, number>();
  for (const item of items) {
    const startMs = itemStartMs(item);
    if (itemEndMs(item) > now && startMs <= windowEnd) {
      counts.set(item.subject, (counts.get(item.subject) ?? 0) + 1);
    }
  }
  return toDistributionRows(counts);
}

export function buildGradeDistribution(
  items: ScopedItem[],
  grades: DashboardGrade[],
  visibleGradeIds?: string[],
): DistributionRow[] {
  const pool = visibleGradeIds && visibleGradeIds.length
    ? grades.filter(grade => visibleGradeIds.includes(grade.id))
    : grades;
  const gradeById = new Map(grades.map(grade => [grade.id, grade]));
  const counts = new Map<string, number>();
  for (const item of items) {
    const targets = item.isSchoolWide
      ? pool.map(grade => grade.id)
      : item.gradeNames.length
        ? pool.filter(grade => item.gradeNames.includes(grade.name)).map(grade => grade.id)
        : pool.map(grade => grade.id);
    for (const gradeId of targets) counts.set(gradeId, (counts.get(gradeId) ?? 0) + 1);
  }
  return toDistributionRows(counts, id => gradeById.get(id)?.name ?? id);
}

function toDistributionRows(
  counts: Map<string, number>,
  labelOf: (key: string) => string = key => key,
): DistributionRow[] {
  const rows = [...counts.entries()]
    .map(([key, count]) => ({ label: labelOf(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const max = rows.length ? rows[0].count : 0;
  return rows.map(row => ({ ...row, percent: max ? Math.round((row.count / max) * 100) : 0 }));
}

export function scopedDevices(
  devices: DashboardDevice[],
  actor: PermissionSubject,
  classes: DashboardClass[],
): DashboardDevice[] {
  const visibleClassIds = new Set(actorVisibleClassIds(actor, classes));
  return devices.filter(device => {
    if (device.revoked === true || device.is_management === true) return false;
    if (!device.grade_id || !device.class_id) return false;
    return hasAllScope(actor) || visibleClassIds.has(device.class_id);
  });
}

export function classifyDevices(
  devices: DashboardDevice[],
  now: number,
  onlineWindowMs = 90_000,
): { onlineDevices: number; inExamDevices: number } {
  let onlineDevices = 0;
  let inExamDevices = 0;
  for (const device of devices) {
    const lastSeen = num(device.last_seen_at);
    const online = lastSeen > 0 && now - lastSeen <= onlineWindowMs;
    if (!online) continue;
    onlineDevices += 1;
    if (device.current_exam) inExamDevices += 1;
  }
  return { onlineDevices, inExamDevices };
}

export function dashboardScopeLabel(
  actor: PermissionSubject,
  grades: DashboardGrade[],
): string {
  if (hasAllScope(actor)) return "全校数据大屏";
  const gradeIds = actorVisibleGradeIds(actor, grades);
  const names = grades
    .filter(grade => gradeIds.includes(grade.id))
    .map(grade => grade.name)
    .filter(Boolean);
  return names.length ? names.join("、") + "数据大屏" : "数据大屏";
}
