import type { ExamItem, MajorExam } from '../types';
import type {
  MajorScheduleBlock,
  ScheduleMode,
  WeeklyConflictPolicy,
  WeeklyOccurrence,
  WeeklyPlan,
} from '../types/exam';
import { subjectAppliesToClass, type SchoolClass, type SchoolGrade } from '../types/school';
import type { ExamRecordDisplayStatus } from '../shared/examRecordContracts';
import { resolveMajorWeeklyConflicts } from './scheduleConflict';
import { addDaysToDateKey, resolveWeeklyOccurrences } from './weeklySchedule';
import { getZonedParts, parseZonedTime } from './zonedTime';

/**
 * 「当前考试」态势页的推导层。
 *
 * 页面要回答「学校现在正在发生什么考试」，而同一时刻可能同时存在多场
 * （全校大型考试 + 某年级周测 + 临时统一考试），因此这里不做「只挑一场」的简化。
 *
 * 为什么不是逐班级调用 `resolveEffectiveSchedule`：那份解析器为了判断冲突会对候选科目
 * 做两两比较，每次比较都要重新解析时间（Intl），而周测计划是「每班一份」的，
 * 逐班调用在 300 个班 + 40 场考试的量级下会把主线程卡住。这里改为：
 *   1. 大型考试：直接按「年级 / 班级 / 选科」算出每个科目实际影响的班级集合，
 *      再用同口径的优先级规则处理重叠（更具体的安排生效，临时考试按 rank 修正）。
 *   2. 周测：按「计划内容」分组（同内容的多个班级计划合成一条），整组只解析一次周测实例，
 *      再复用 `resolveMajorWeeklyConflicts` 做大型考试冲突抑制。
 * 这样既能展示「同一时间多场考试」，也不会随班级数爆炸。
 *
 * 拆成两段是为了性能：`collectExamSessions` 只在数据或日期变化时算；
 * `buildExamCenterView` 只做时间比较，可以每秒调用撑起倒计时。
 */

export type ExamSessionKind = 'major' | 'weekly' | 'temporary';

export type ExamSessionStatus = 'upcoming' | 'imminent' | 'running' | 'paused' | 'overdue' | 'ended';

export type ExamSessionScopeKind = 'school' | 'grade' | 'class';

export type ExamSessionScope = {
  kind: ExamSessionScopeKind;
  label: string;
  gradeIds: string[];
  classIds: string[];
  /** 实际会被这场考试影响的班级数（按当前可见范围内统计）。 */
  classCount: number;
};

export type ExamSession = {
  /** 去重键：一场考试的同一科目只出现一次，参与范围由 scope 表达。 */
  key: string;
  kind: ExamSessionKind;
  /** 考试名：大型考试名 / 周测计划名。 */
  examName: string;
  /** 科目名，例如「数学」。 */
  subject: string;
  /** 来源 id：大型考试 id 或周测计划 id。 */
  sourceId: string;
  /** 记录层 id（用于打开详情抽屉）；周测没有记录层。 */
  recordId: string | null;
  startAt: number;
  endAt: number;
  /**
   * 这场考试（含全部科目）的窗口结束时刻。
   * 「时间已过但没结束」只按整场考试判断：同一场考试里先考完的科目是正常结束，
   * 不能因为整场还没结束就被标成待处理。
   */
  examEndAt: number;
  pausedAt: number | null;
  pausedMs: number;
  endedAt: number | null;
  scope: ExamSessionScope;
};

export type ExamSessionView = ExamSession & {
  status: ExamSessionStatus;
  lifecycle: ExamRecordDisplayStatus | null;
  /** 计入暂停顺延后的实际结束时刻。 */
  effectiveEndAt: number;
  remainingMs: number;
  elapsedMs: number;
  totalMs: number;
  /** 0–1，暂停期间冻结。 */
  progress: number;
};

export type ExamCenterView = {
  now: number;
  dayKey: string;
  /** 正在进行（含暂停），按结束时间升序 —— 同一时间多场考试时这里会有多条。 */
  running: ExamSessionView[];
  /** 时间已过但记录层仍未结束，需要人工处理。 */
  overdue: ExamSessionView[];
  /** 接下来要考试的场次（含明天及以后），按开始时间升序。 */
  upcoming: ExamSessionView[];
  /** 最近一场已结束的考试。 */
  previous: ExamSessionView | null;
  /** 主视觉：优先进行中的第一场，其次待处理、下一场、上一场。 */
  headline: ExamSessionView | null;
  /** 今天之内（含跨零点）的场次数量。 */
  todayCount: number;
  hasAnyExamToday: boolean;
  /** 记录层读不到时为 true，页面据此提示状态可能滞后。 */
  lifecycleUnknown: boolean;
};

/** 记录层里与展示相关的最小字段；直接吃 `ExamRecordListEntry`，但不与其耦合。 */
export type ExamLifecycleRecord = {
  id: string;
  displayStatus: ExamRecordDisplayStatus;
  pausedAt: number | null;
  pausedMs: number;
  endedAt: number | null;
  archivedAt: number | null;
  endAt: number | null;
};

export type CollectExamSessionsInput = {
  majors: MajorExam[];
  weeklyPlans: WeeklyPlan[];
  classes: SchoolClass[];
  grades?: SchoolGrade[];
  scheduleMode: ScheduleMode;
  weeklyConflictPolicy: WeeklyConflictPolicy;
  activeWeeklyPlanId: string | null;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  subjectTrackModeEnabled?: boolean;
  /** 上海日历日 'YYYY-MM-DD'；决定「今天」是哪一天。 */
  dayKey: string;
};

/** 向前多看一点，跨零点的考试结束时仍能正确归到「上一场」。 */
const WINDOW_BACK_MS = 6 * 60 * 60 * 1000;
/** 向后展开一周，用来支撑「下一场：明天 10:00」。 */
const WINDOW_FORWARD_DAYS = 7;
/** 即将开始的判定阈值。 */
export const IMMINENT_WINDOW_MS = 15 * 60 * 1000;
/** 单次展开的班级上限，防止超大范围学校把主线程拖住。 */
const MAX_CLASSES = 400;

type MajorCandidate = {
  major: MajorExam;
  item: ExamItem;
  kind: ExamSessionKind;
  startAt: number;
  endAt: number;
  /** 年级/班级/全校的权重与临时考试修正；越大越优先。 */
  priorityRank: number;
  classIds: string[];
  classIdSet: Set<string>;
};

/**
 * 同一「时间结构」的多个班级计划合成一组：学校给每个班各建一份计划是常态，
 * 而态势页要看到的是「这个时间点有哪些班的同一科在考」，不是几百张同名卡片。
 */
type WeeklyGroup = {
  signature: string;
  plan: WeeklyPlan;
  /** 组内出现过的计划名；多于一个时页面用「等 N 个计划」表述。 */
  planNames: string[];
  classIds: string[];
  gradeIds: string[];
};

function majorKind(major: MajorExam): ExamSessionKind {
  if (major.temporary === true) return 'temporary';
  return major.source === 'quick' ? 'temporary' : 'major';
}

function itemWindow(item: ExamItem): { start: number; end: number } | null {
  const start = parseZonedTime(item.startTime);
  const end = parseZonedTime(item.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

function joinNames(names: string[], limit: number): string {
  const visible = names.slice(0, limit);
  return `${visible.join('、')}${names.length > visible.length ? ' 等' : ''}`;
}

function buildScope(
  kind: ExamSessionScopeKind,
  gradeIds: string[],
  classIds: string[],
  grades: SchoolGrade[],
  classes: SchoolClass[],
  classCount: number,
): ExamSessionScope {
  const gradeNames = gradeIds.map((id) => grades.find((grade) => grade.id === id)?.name ?? id).filter(Boolean);
  const classNames = classIds.map((id) => classes.find((item) => item.id === id)?.name ?? id).filter(Boolean);
  const label =
    kind === 'school'
      ? '全校'
      : kind === 'grade'
        ? joinNames(gradeNames, 3) || '年级'
        : joinNames(classNames, 2) || '班级';
  return { kind, label, gradeIds, classIds, classCount };
}

/** 班级集合求交：至少一边已经建好 Set 时走这里，避免重复构造。 */
function intersectsCandidate(candidate: MajorCandidate, otherIds: Set<string>): boolean {
  if (!otherIds.size || !candidate.classIds.length) return false;
  if (candidate.classIds.length <= otherIds.size) return candidate.classIds.some((id) => otherIds.has(id));
  for (const id of otherIds) if (candidate.classIdSet.has(id)) return true;
  return false;
}

/**
 * 周测的「时间结构」：刻意忽略各项 id 与计划名，只保留会影响展开结果的部分。
 * 这样「每班一份、内容相同」的计划可以共用一次展开与一次冲突判断。
 */
function planTimingSignature(plan: WeeklyPlan): string {
  return JSON.stringify([
    (plan.items ?? [])
      .map((item) => [
        item.name,
        item.weekday,
        item.startTime,
        item.endTime,
        item.endNextDay ? 1 : 0,
        item.enabled === false ? 0 : 1,
        item.weekType ?? 'all',
        item.order ?? 0,
      ])
      .sort((left, right) => (left as number[]).join(',').localeCompare((right as number[]).join(','))),
    (plan.overrides ?? [])
      .map((item) => [
        item.date,
        item.targetDate ?? '',
        item.action,
        item.startTime ?? '',
        item.endTime ?? '',
        item.endNextDay ? 1 : 0,
        item.forceRunDuringMajorExam ? 1 : 0,
        item.name ?? '',
      ])
      .sort((left, right) => (left as number[]).join(',').localeCompare((right as number[]).join(','))),
    [...(plan.excludedDates ?? [])].sort(),
    plan.weekMode ?? 'single',
    plan.anchorDate,
    plan.repeatEveryWeeks,
    plan.activeFrom,
    plan.activeUntil,
    plan.excludeOfficialHolidays === true,
  ]);
}

type OccurrenceTiming = {
  start: number;
  end: number;
  /** 上海日历日与本地 ISO 文案；冲突判断复用周测解析器的口径，需要原样回填。 */
  date: string;
  startIso: string;
  endIso: string;
  name: string;
  forced: boolean;
};

/** 把缓存下来的时间结构还原成周测实例，交给 `resolveMajorWeeklyConflicts` 判断冲突。 */
function toOccurrences(planId: string, timings: OccurrenceTiming[]): WeeklyOccurrence[] {
  return timings.map((timing, index) => ({
    id: `${planId}#${index}`,
    occurrenceId: `${planId}#${index}`,
    name: timing.name,
    startTime: timing.startIso,
    endTime: timing.endIso,
    enabled: true,
    order: index,
    kind: 'weekly',
    weeklyPlanId: planId,
    weeklyItemId: `${planId}#${index}`,
    date: timing.date,
    forced: timing.forced,
  }));
}

function readPausedAt(major: MajorExam | undefined): number | null {
  const value = major?.pausedAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readPausedMs(major: MajorExam | undefined): number {
  const value = major?.pausedMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function readEndedAt(major: MajorExam | undefined): number | null {
  if (!major) return null;
  for (const value of [major.archivedAt, major.actualEndAt, major.endedAt]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/** 把「同一时间结构的周测计划」按班级归组；返回的 classIds 是这组实际覆盖的班级。 */
function groupWeeklyPlans(
  weeklyPlans: WeeklyPlan[],
  visibleClasses: SchoolClass[],
  activeWeeklyPlanId: string | null,
  activeWeeklyPlanIdByClassId?: Record<string, string | null>,
): WeeklyGroup[] {
  const planById = new Map(weeklyPlans.map((plan) => [plan.id, plan]));
  const groups = new Map<string, WeeklyGroup>();
  for (const schoolClass of visibleClasses) {
    const configured = activeWeeklyPlanIdByClassId?.[schoolClass.id];
    const planId = configured !== undefined ? configured : activeWeeklyPlanId;
    const plan =
      (planId ? planById.get(planId) : undefined) ??
      weeklyPlans.find((entry) => entry.classId === schoolClass.id && entry.enabled !== false) ??
      null;
    if (!plan || plan.enabled === false) continue;
    const signature = planTimingSignature(plan);
    const existing = groups.get(signature);
    if (existing) {
      if (!existing.classIds.includes(schoolClass.id)) existing.classIds.push(schoolClass.id);
      if (!existing.gradeIds.includes(schoolClass.gradeId)) existing.gradeIds.push(schoolClass.gradeId);
      if (plan.name && !existing.planNames.includes(plan.name)) existing.planNames.push(plan.name);
      continue;
    }
    groups.set(signature, {
      signature,
      plan,
      planNames: plan.name ? [plan.name] : [],
      classIds: [schoolClass.id],
      gradeIds: [schoolClass.gradeId],
    });
  }
  return [...groups.values()];
}

/**
 * 收集今天（以及未来一周）的考试场次。
 *
 * 每个科目只产生一条记录，参与范围写在 `scope` 里；同一时刻的多场考试会同时保留。
 */
export function collectExamSessions(input: CollectExamSessionsInput): ExamSession[] {
  const {
    majors,
    weeklyPlans,
    classes,
    grades = [],
    scheduleMode,
    weeklyConflictPolicy,
    activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId,
    subjectTrackModeEnabled,
    dayKey,
  } = input;

  const dayStart = parseZonedTime(`${dayKey}T00:00:00`);
  if (!Number.isFinite(dayStart)) return [];
  const windowStart = dayStart - WINDOW_BACK_MS;
  const windowEnd = parseZonedTime(`${addDaysToDateKey(dayKey, WINDOW_FORWARD_DAYS)}T00:00:00`);
  // 周测解析需要一天内稳定的 now；用当天正午，避免恰好压在零点边界上。
  const anchor = dayStart + 12 * 60 * 60 * 1000;

  const visibleClasses = classes.filter((item) => item.enabled !== false).slice(0, MAX_CLASSES);
  const classById = new Map(visibleClasses.map((item) => [item.id, item]));

  // 同一场考试的科目通常共享作用范围，按范围签名缓存，避免几百个班级被反复过滤。
  const scopeCache = new Map<string, string[]>();
  /** 一场考试的某个科目实际会影响哪些班级（年级限定 → 班级限定 → 选科）。 */
  const classesForItem = (major: MajorExam, item: ExamItem): string[] => {
    const majorGrades = major.targetGradeIds ?? [];
    const majorClasses = major.targetClassIds ?? [];
    const itemGrades = item.targetGradeIds ?? [];
    const itemClasses = item.targetClassIds ?? [];
    const cacheKey = [
      majorGrades.join(','),
      majorClasses.join(','),
      itemGrades.join(','),
      itemClasses.join(','),
      itemClasses.length ? '' : item.name,
    ].join('|');
    const cached = scopeCache.get(cacheKey);
    if (cached) return cached;
    const resolved = visibleClasses
      .filter((schoolClass) => {
        if (majorClasses.length) return majorClasses.includes(schoolClass.id);
        if (majorGrades.length) return majorGrades.includes(schoolClass.gradeId);
        return true;
      })
      .filter((schoolClass) => !itemGrades.length || itemGrades.includes(schoolClass.gradeId))
      .filter((schoolClass) => !itemClasses.length || itemClasses.includes(schoolClass.id))
      // 选科过滤：科目自带班级限定时以它为准（那正是选科结果落库的形态）。
      .filter(
        (schoolClass) =>
          subjectTrackModeEnabled !== true || !!itemClasses.length || subjectAppliesToClass(item.name, schoolClass),
      )
      .map((schoolClass) => schoolClass.id);
    scopeCache.set(cacheKey, resolved);
    return resolved;
  };

  const candidates: MajorCandidate[] = [];
  for (const major of majors) {
    const kind = majorKind(major);
    for (const item of major.items) {
      if (item.enabled === false) continue;
      const window = itemWindow(item);
      if (!window) continue;
      if (window.end <= windowStart || window.start >= windowEnd) continue;
      const classIds = classesForItem(major, item);
      // 没有任何可见班级会被影响时不必出现在态势页上。
      if (!classIds.length) continue;
      const scopeRank = major.targetClassIds?.length ? 2 : major.targetGradeIds?.length ? 1 : 0;
      candidates.push({
        major,
        item,
        kind,
        startAt: window.start,
        endAt: window.end,
        priorityRank: scopeRank + (major.temporary ? (major.priorityOverSchedule ? 100 : -100) : 0),
        classIds,
        classIdSet: new Set(classIds),
      });
    }
  }

  // 同一时段重叠时更具体的安排生效（与服务端 resolveEffectiveSchedule 的口径一致）。
  const liveCandidates = candidates.filter(
    (candidate) => candidate.major.endedAt == null && candidate.major.archivedAt == null,
  );
  const visibleCandidates = liveCandidates.filter(
    (candidate) =>
      !liveCandidates.some(
        (other) =>
          other.priorityRank > candidate.priorityRank &&
          other.startAt < candidate.endAt &&
          other.endAt > candidate.startAt &&
          intersectsCandidate(other, candidate.classIdSet),
      ),
  );

  const sessions: ExamSession[] = [];
  const examEndBySource = new Map<string, number>();
  const pushMajorSession = (candidate: MajorCandidate) => {
    const { major, item } = candidate;
    const declaredEnd = major.endAt;
    const examEnd = Math.max(
      examEndBySource.get(major.id) ?? 0,
      typeof declaredEnd === 'number' && Number.isFinite(declaredEnd) ? declaredEnd : 0,
      candidate.endAt,
    );
    examEndBySource.set(major.id, examEnd);
    const gradeIds = [...new Set(candidate.classIds.map((id) => classById.get(id)?.gradeId ?? '').filter(Boolean))];
    sessions.push({
      key: `${candidate.kind}|${major.id}|${item.id}`,
      kind: candidate.kind,
      examName: major.name,
      subject: item.name,
      sourceId: major.id,
      recordId: major.id,
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      examEndAt: examEnd,
      pausedAt: readPausedAt(major),
      pausedMs: readPausedMs(major),
      endedAt: readEndedAt(major),
      scope: buildScope(
        major.targetClassIds?.length ? 'class' : major.targetGradeIds?.length ? 'grade' : 'school',
        major.targetGradeIds?.length ? major.targetGradeIds : gradeIds,
        major.targetClassIds ?? [],
        grades,
        classes,
        candidate.classIds.length,
      ),
    });
  };
  for (const candidate of visibleCandidates) pushMajorSession(candidate);
  // 已结束 / 已归档的考试即使被更具体的安排覆盖，也要保留给「上一场」。
  for (const candidate of candidates) {
    const ended = candidate.major.endedAt != null || candidate.major.archivedAt != null;
    if (ended && !visibleCandidates.includes(candidate)) pushMajorSession(candidate);
  }
  // 同一场考试的窗口结束时刻取全部科目里最晚的。
  for (const session of sessions) {
    session.examEndAt = Math.max(examEndBySource.get(session.sourceId) ?? 0, session.endAt);
  }

  if (scheduleMode !== 'major-only') {
    // 周测展开与冲突判断只取决于「时间结构 + 覆盖到的大型考试」，与是哪个班的计划无关；
    // 按这两个键缓存，几百个班级计划就只用算一次（否则同一份 Intl 解析要重复几百遍）。
    const timingCache = new Map<string, OccurrenceTiming[]>();
    const conflictCache = new Map<string, boolean[]>();
    for (const group of groupWeeklyPlans(
      weeklyPlans,
      visibleClasses,
      activeWeeklyPlanId,
      activeWeeklyPlanIdByClassId,
    )) {
      const timingSignature = planTimingSignature(group.plan);
      let timings = timingCache.get(timingSignature);
      if (!timings) {
        timings = resolveWeeklyOccurrences(group.plan, anchor, { daysBack: 0, daysForward: WINDOW_FORWARD_DAYS })
          .map((occurrence) => ({
            start: parseZonedTime(occurrence.startTime),
            end: parseZonedTime(occurrence.endTime),
            date: occurrence.date,
            startIso: occurrence.startTime,
            endIso: occurrence.endTime,
            name: occurrence.name,
            forced: occurrence.forced === true,
          }))
          .filter(
            (item) =>
              Number.isFinite(item.start) &&
              Number.isFinite(item.end) &&
              item.end > windowStart &&
              item.start < windowEnd,
          );
        timingCache.set(timingSignature, timings);
      }
      if (!timings.length) continue;
      // 冲突判断按「这份内容实际覆盖的班级范围」挑出相关的大型考试科目。
      const related =
        scheduleMode === 'automatic' && weeklyConflictPolicy?.enabled !== false
          ? liveCandidates.filter((candidate) => group.classIds.some((classId) => candidate.classIdSet.has(classId)))
          : [];
      let activeFlags: boolean[];
      if (!related.length) {
        activeFlags = timings.map(() => true);
      } else {
        const cacheKey = `${timings.map((item) => `${item.start}|${item.end}|${item.forced ? 1 : 0}`).join(';')}::${related
          .map((candidate) => `${candidate.startAt}|${candidate.endAt}`)
          .sort()
          .join(';')}`;
        const cached = conflictCache.get(cacheKey);
        if (cached) {
          activeFlags = cached;
        } else {
          const blocks: MajorScheduleBlock[] = related.reduce<MajorScheduleBlock[]>((list, candidate) => {
            const existing = list.find((block) => block.id === candidate.major.id);
            if (existing) existing.items.push(candidate.item);
            else
              list.push({
                id: candidate.major.id,
                name: candidate.major.name,
                items: [candidate.item],
                policy: weeklyConflictPolicy,
              });
            return list;
          }, []);
          const occurrences = toOccurrences(group.plan.id, timings);
          const suppressed = new Set(
            resolveMajorWeeklyConflicts(blocks, occurrences).suppressedWeekly.map((item) => item.id),
          );
          activeFlags = occurrences.map((item) => !suppressed.has(item.id));
          conflictCache.set(cacheKey, activeFlags);
        }
      }
      for (const [index, timing] of timings.entries()) {
        if (!activeFlags[index]) continue;
        sessions.push({
          key: `weekly|${group.signature}|${index}`,
          kind: 'weekly',
          examName:
            group.planNames.length > 1
              ? `${group.planNames[0]} 等 ${group.planNames.length} 个周测计划`
              : (group.planNames[0] ?? group.plan.name),
          subject: timing.name,
          sourceId: group.plan.id,
          recordId: null,
          startAt: timing.start,
          endAt: timing.end,
          examEndAt: timing.end,
          pausedAt: null,
          pausedMs: 0,
          endedAt: null,
          scope: buildScope('class', group.gradeIds, group.classIds, grades, classes, group.classIds.length),
        });
      }
    }
  }

  return sessions.sort((left, right) => left.startAt - right.startAt || left.subject.localeCompare(right.subject));
}

function sessionStatus(
  session: ExamSession,
  record: ExamLifecycleRecord | undefined,
  now: number,
): { status: ExamSessionStatus; effectiveEndAt: number } {
  const lifecycle = record?.displayStatus ?? null;
  const effectiveEndAt = session.endAt + session.pausedMs;
  if (session.endedAt != null) return { status: 'ended', effectiveEndAt };
  if (lifecycle === 'ended' || lifecycle === 'archived') return { status: 'ended', effectiveEndAt };
  // 暂停期间倒计时冻结，因此优先级高于「时间是否走完」。
  if (session.pausedAt != null) return { status: 'paused', effectiveEndAt };
  if (now >= session.startAt && now < effectiveEndAt) return { status: 'running', effectiveEndAt };
  if (now >= effectiveEndAt) {
    // 只有整场考试的窗口都走完、记录层却仍是 published 时才算「待处理」；
    // 同一场考试里先考完的科目属于正常结束。
    const examWindowEnd = Math.max(session.examEndAt, record?.endAt ?? 0);
    const open = lifecycle === 'published' || lifecycle === 'ongoing';
    return { status: now >= examWindowEnd && open ? 'overdue' : 'ended', effectiveEndAt };
  }
  return { status: session.startAt - now <= IMMINENT_WINDOW_MS ? 'imminent' : 'upcoming', effectiveEndAt };
}

export function buildExamCenterView(
  sessions: ExamSession[],
  records: readonly ExamLifecycleRecord[] | null,
  now: number,
  dayKey: string,
): ExamCenterView {
  const recordById = new Map<string, ExamLifecycleRecord>();
  for (const record of records ?? []) recordById.set(record.id, record);
  const dayStart = parseZonedTime(`${dayKey}T00:00:00`);
  const dayEnd = Number.isFinite(dayStart) ? parseZonedTime(`${addDaysToDateKey(dayKey, 1)}T00:00:00`) : Number.NaN;

  const views: ExamSessionView[] = sessions.map((session) => {
    const record = session.recordId ? recordById.get(session.recordId) : undefined;
    const lifecycle = record?.displayStatus ?? null;
    const pausedAt = session.pausedAt ?? record?.pausedAt ?? null;
    const pausedMs = Math.max(session.pausedMs, record?.pausedMs ?? 0);
    const withPause = { ...session, pausedAt, pausedMs };
    const { status, effectiveEndAt } = sessionStatus(withPause, record, now);
    const totalMs = Math.max(0, effectiveEndAt - session.startAt);
    const elapsedRaw = now - session.startAt;
    const elapsedMs = Math.min(Math.max(0, elapsedRaw - pausedMs), totalMs);
    const remainingMs = Math.max(0, effectiveEndAt - now);
    const progress = totalMs > 0 ? Math.min(1, Math.max(0, elapsedMs / totalMs)) : status === 'ended' ? 1 : 0;
    return { ...withPause, status, lifecycle, effectiveEndAt, remainingMs, elapsedMs, totalMs, progress };
  });

  const running = views
    .filter((session) => session.status === 'running' || session.status === 'paused')
    .sort((left, right) => left.effectiveEndAt - right.effectiveEndAt);
  const overdue = views
    .filter((session) => session.status === 'overdue')
    .sort((left, right) => left.effectiveEndAt - right.effectiveEndAt);
  const upcoming = views
    .filter((session) => session.status === 'upcoming' || session.status === 'imminent')
    .sort((left, right) => left.startAt - right.startAt);
  const previous =
    views
      .filter((session) => session.status === 'ended')
      .sort((left, right) => right.effectiveEndAt - left.effectiveEndAt)[0] ?? null;
  const todaySessions = views.filter(
    (session) => Number.isFinite(dayEnd) && session.startAt < dayEnd && session.effectiveEndAt > dayStart,
  );

  return {
    now,
    dayKey,
    running,
    overdue,
    upcoming,
    previous,
    headline: running[0] ?? overdue[0] ?? upcoming[0] ?? previous,
    todayCount: todaySessions.length,
    hasAnyExamToday: todaySessions.length > 0,
    lifecycleUnknown: records === null,
  };
}

/** 倒计时：HH:MM:SS，超过 99 小时截断，避免极端数据把排版撑坏。 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00:00';
  const totalSeconds = Math.min(Math.floor(ms / 1000), 99 * 3600 + 3599);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

/** 紧凑倒计时：用于「下一场」这类次级位置。 */
export function formatShortCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 分钟';
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} 天 ${hours % 24} 小时`;
  }
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

export function formatClockHm(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const parts = getZonedParts(ms);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function formatClockHms(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--:--';
  const parts = getZonedParts(ms);
  return [parts.hour, parts.minute, parts.second].map((value) => String(value).padStart(2, '0')).join(':');
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function formatDayLabel(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const parts = getZonedParts(ms);
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日 ${WEEKDAY_LABELS[parts.weekday] ?? ''}`.trim();
}

/** 相对「今天」的日期说法；跨天时用于「明天 10:00」这类文案。 */
export function formatRelativeDay(ms: number, todayKey: string): string {
  const parts = getZonedParts(ms);
  const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  if (key === todayKey) return '今天';
  if (key === addDaysToDateKey(todayKey, 1)) return '明天';
  if (key === addDaysToDateKey(todayKey, -1)) return '昨天';
  return `${parts.month} 月 ${parts.day} 日`;
}

export const EXAM_SESSION_STATUS_LABELS: Record<ExamSessionStatus, string> = {
  upcoming: '未开始',
  imminent: '即将开始',
  running: '进行中',
  paused: '已暂停',
  overdue: '待处理',
  ended: '已结束',
};

export const EXAM_SESSION_KIND_LABELS: Record<ExamSessionKind, string> = {
  major: '大型考试',
  weekly: '周测',
  temporary: '临时统一考试',
};
