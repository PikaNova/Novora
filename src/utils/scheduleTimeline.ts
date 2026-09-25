import type { SchoolClass, SchoolGrade } from '../types/school';
import type { ExamRecordDisplayStatus } from '../shared/examRecordContracts';
import type { ExamSession } from './examCenterStatus';
import { IMMINENT_WINDOW_MS } from './examCenterStatus';
import { addDaysToDateKey, getShanghaiDateKey } from './weeklySchedule';
import { getZonedParts, parseZonedTime } from './zonedTime';
import type { ScheduleWindowKey } from './examListFilterMemory';

/**
 * 「考试安排」页的行模型。
 *
 * 这页要把三种来源放进同一条时间轴：
 * - 大型考试 / 快速考试：来自 `exam_records`（快照投影），整场一行，展开看科目；
 * - 周测：来自周期规则展开出的实例，**某天某科一行**，被大型考试按冲突策略暂停的实例
 *   仍然出现在轴上（状态为「已被大型考试暂停」），否则用户会以为当天真的要考；
 * - 草稿：还没排期的考试，归入「未排期」分组，不参与冲突判定。
 */

export type ScheduleRowKind = 'major' | 'quick' | 'weekly' | 'draft';

export type ScheduleRowStatus = 'draft' | 'scheduled' | 'imminent' | 'ongoing' | 'ended' | 'suppressed';

export type ScheduleRow = {
  key: string;
  kind: ScheduleRowKind;
  status: ScheduleRowStatus;
  /** 考试记录 id（大型/快速/草稿）；周测为空。 */
  recordId: string | null;
  /** 周测计划 id；其它为空。 */
  planId: string | null;
  title: string;
  /** 周测的科目名；大型考试为空（科目在 items 里展开看）。 */
  subject: string;
  scopeLabel: string;
  gradeIds: string[];
  classIds: string[];
  startAt: number | null;
  endAt: number | null;
  itemCount: number;
  /** 未排期：草稿（未发布）与「已发布但没有任何科目时间」都归到「未排期」分组。 */
  unscheduled: boolean;
  /** 大型考试按天合并时，这一行包含的科目数（用于展开区提示）。 */
  daySubjectCount: number;
  /** 周测行的来源信息：行内「取消本次 / 改时间 / 仍然进行」写计划 overrides 要用。 */
  weekly?: ExamSession['weekly'];
  /** 与其它行发生的冲突 key；展示时用来加标记。 */
  conflictKeys: string[];
};

export type ScheduleGroup = {
  /** 'YYYY-MM-DD' 或 'unscheduled'。 */
  key: string;
  label: string;
  dateKey: string | null;
  rows: ScheduleRow[];
  /** 「未排期」分组内再分「草稿（未发布）」与「已发布·待排期」两段。 */
  subgroups?: Array<{ key: string; label: string; rows: ScheduleRow[] }>;
  /** 这一天的冲突组数（不是涉及的行数）。 */
  conflictCount: number;
};

export type ScheduleConflict = {
  key: string;
  aKey: string;
  bKey: string;
  /** 冲突发生在哪一天（上海日历日）。 */
  dateKey: string;
  /** 重叠时长（毫秒），用于挑「更严重」的那条做提示。 */
  overlapMs: number;
  scopeLabel: string;
};

export type ScheduleBoardStats = {
  total: number;
  conflicted: number;
  suppressedWeekly: number;
  unscheduled: number;
  todayCount: number;
};

/** 只取行模型需要的记录字段，避免和列表服务耦合。 */
export type ScheduleRecordLike = {
  id: string;
  name: string;
  displayStatus: ExamRecordDisplayStatus;
  itemCount: number;
  startAt: number | null;
  endAt: number | null;
  targetGradeIds: string[];
  targetClassIds: string[];
  source: 'regular' | 'quick';
};

export type BuildScheduleBoardInput = {
  /** 时间窗内的大型/快速/周测场次（已做冲突抑制与去重）。 */
  sessions: ExamSession[];
  /** 被大型考试暂停的周测实例（`collectScheduleSessions().suppressed`）。 */
  suppressedWeekly?: ExamSession[];
  /** 未定时间的草稿（`preset=draft` 的结果）。 */
  drafts?: readonly ScheduleRecordLike[];
  /** 时间窗内取回的真实记录，用于把生命周期状态贴到行上（可能缺少部分行）。 */
  records?: readonly ScheduleRecordLike[] | null;
  grades?: SchoolGrade[];
  classes?: SchoolClass[];
  now: number;
  /**
   * 行级筛选（搜索 / 年级）。在算冲突与统计之前应用，保证「筛选后看到的这堆安排」
   * 自己是一致的：冲突提示与统计都只针对当前结果集。
   */
  rowFilter?: (row: ScheduleRow) => boolean;
};

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const UNSCHEDULED_KEY = 'unscheduled';

export const SCHEDULE_ROW_STATUS_LABELS: Record<ScheduleRowStatus, string> = {
  draft: '草稿',
  scheduled: '待开始',
  imminent: '即将开始',
  ongoing: '进行中',
  ended: '已结束',
  suppressed: '已被大型考试暂停',
};

export const SCHEDULE_ROW_KIND_LABELS: Record<ScheduleRowKind, string> = {
  major: '大型考试',
  quick: '快速发布',
  weekly: '周测',
  draft: '草稿',
};

/** 时间窗档位 → 采集起点、展开天数、服务端 from/to。 */
export type ResolvedScheduleWindow = {
  key: ScheduleWindowKey;
  label: string;
  /** 采集起点日（上海日历日）；「明天」档从明天零点开始。 */
  dayKey: string;
  daysForward: number;
  from: number | null;
  to: number | null;
};

const WINDOW_LABELS: Record<ScheduleWindowKey, string> = {
  today: '今天',
  tomorrow: '明天',
  week: '本周',
  fortnight: '未来两周',
  all: '全部',
};

export const SCHEDULE_WINDOW_KEYS: readonly ScheduleWindowKey[] = ['today', 'tomorrow', 'week', 'fortnight', 'all'];

/**
 * 「全部」不设上限地展开会把整库搬回来，这里给一个足够大的天数（按两周一个考期估算）；
 * 真正的兜底是服务端分页（表格视图）与页面上「缩小时间窗」的提示。
 */
const ALL_WINDOW_DAYS = 60;

export function resolveScheduleWindow(key: ScheduleWindowKey, now: number): ResolvedScheduleWindow {
  const todayKey = getShanghaiDateKey(now);
  const dayStart = (dateKey: string) => parseZonedTime(`${dateKey}T00:00:00`);
  const days = key === 'fortnight' ? 14 : key === 'week' ? 7 : key === 'all' ? ALL_WINDOW_DAYS : 1;
  const baseKey = key === 'tomorrow' ? addDaysToDateKey(todayKey, 1) : todayKey;
  const bounded = key !== 'all';
  return {
    key,
    label: WINDOW_LABELS[key],
    dayKey: baseKey,
    daysForward: days,
    from: bounded ? dayStart(baseKey) : null,
    to: bounded ? dayStart(addDaysToDateKey(baseKey, days)) : null,
  };
}

/** 时间窗内的日期列表（用于班级周网格），最多 maxDays 天，避免 14 列撑爆窄屏。 */
export function scheduleWindowDays(window: ResolvedScheduleWindow, maxDays = 7): string[] {
  const days = Math.max(1, Math.min(Math.trunc(window.daysForward), Math.max(1, maxDays)));
  return Array.from({ length: days }, (_, index) => addDaysToDateKey(window.dayKey, index));
}

/** 与列表页一致的口径：全校 / 年级 / 班级，班级多时只报数量。 */
export function scopeLabelOf(
  gradeIds: string[],
  classIds: string[],
  grades: SchoolGrade[],
  classes: SchoolClass[],
): string {
  if (!gradeIds.length && !classIds.length) return '全校';
  const gradeNames = gradeIds.map((id) => grades.find((grade) => grade.id === id)?.name ?? id).slice(0, 2);
  if (classIds.length > 2) return [...gradeNames, `${classIds.length} 个班`].join('、');
  const classNames = classIds.map((id) => classes.find((item) => item.id === id)?.name ?? id);
  return [...gradeNames, ...classNames].join('、') || '全校';
}

function timeStatusOf(startAt: number | null, endAt: number | null, now: number): ScheduleRowStatus {
  if (startAt == null || endAt == null) return 'scheduled';
  if (now >= startAt && now < endAt) return 'ongoing';
  if (now >= endAt) return 'ended';
  return startAt - now <= IMMINENT_WINDOW_MS ? 'imminent' : 'scheduled';
}

function statusFromRecord(
  displayStatus: ExamRecordDisplayStatus,
  startAt: number | null,
  endAt: number | null,
  now: number,
): ScheduleRowStatus {
  if (displayStatus === 'draft') return 'draft';
  if (displayStatus === 'ongoing') return 'ongoing';
  if (displayStatus === 'ended' || displayStatus === 'archived') return 'ended';
  // published：再按时间细分出「即将开始」，让近场更醒目。
  const byTime = timeStatusOf(startAt, endAt, now);
  return byTime === 'ongoing' ? 'scheduled' : byTime;
}

function sessionToRow(
  session: ExamSession,
  recordsById: Map<string, ScheduleRecordLike>,
  now: number,
  suppressed: boolean,
): ScheduleRow {
  const record = session.recordId ? recordsById.get(session.recordId) : undefined;
  const kind: ScheduleRowKind = session.kind === 'weekly' ? 'weekly' : session.kind === 'temporary' ? 'quick' : 'major';
  const status: ScheduleRowStatus = suppressed
    ? 'suppressed'
    : record
      ? statusFromRecord(record.displayStatus, session.startAt, session.endAt, now)
      : timeStatusOf(session.startAt, session.endAt, now);
  return {
    key: session.key,
    kind,
    status,
    recordId: session.recordId,
    planId: session.kind === 'weekly' ? session.sourceId : null,
    title: session.examName,
    subject: session.kind === 'weekly' ? session.subject : '',
    scopeLabel: session.scope.label,
    gradeIds: session.scope.gradeIds,
    classIds: session.scope.classIds,
    startAt: session.startAt,
    endAt: session.endAt,
    itemCount: record?.itemCount ?? 0,
    unscheduled: false,
    daySubjectCount: 1,
    ...(session.weekly ? { weekly: session.weekly } : {}),
    conflictKeys: [],
  };
}

function draftToRow(record: ScheduleRecordLike, grades: SchoolGrade[], classes: SchoolClass[]): ScheduleRow {
  return {
    key: `draft|${record.id}`,
    kind: 'draft',
    status: 'draft',
    recordId: record.id,
    planId: null,
    title: record.name,
    subject: '',
    scopeLabel: scopeLabelOf(record.targetGradeIds, record.targetClassIds, grades, classes),
    gradeIds: record.targetGradeIds,
    classIds: record.targetClassIds,
    startAt: record.startAt,
    endAt: record.endAt,
    itemCount: record.itemCount,
    // 草稿（未发布）无论有没有时间都进「未排期」：它还不是一份对外生效的安排。
    unscheduled: true,
    daySubjectCount: record.itemCount,
    conflictKeys: [],
  };
}

/**
 * 大型考试按「整场一行（按天）」合并：同一场考试同一天的多个科目只占一行，
 * 时间取当天首科的开始到末科的结束，科目清单留给展开区。
 * 周测不合并——「数学周测」和「语文周测」本来就是两件事。
 */
function mergeMajorRows(rows: ScheduleRow[], recordsById: Map<string, ScheduleRecordLike>): ScheduleRow[] {
  const merged: ScheduleRow[] = [];
  const indexByKey = new Map<string, number>();
  for (const row of rows) {
    const mergeable = row.kind === 'major' || row.kind === 'quick';
    if (!mergeable || row.recordId == null || row.startAt == null || row.endAt == null) {
      merged.push(row);
      continue;
    }
    const key = `${row.kind}|${row.recordId}|${getShanghaiDateKey(row.startAt)}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex == null) {
      indexByKey.set(key, merged.length);
      merged.push({ ...row, key, daySubjectCount: 1 });
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      startAt: Math.min(existing.startAt as number, row.startAt),
      endAt: Math.max(existing.endAt as number, row.endAt),
      daySubjectCount: existing.daySubjectCount + 1,
      itemCount: Math.max(existing.itemCount, recordsById.get(row.recordId)?.itemCount ?? existing.itemCount),
    };
  }
  return merged;
}

/** 两行的适用范围是否有交集（全校与任何范围都算有交集）。 */
function scopesOverlap(left: ScheduleRow, right: ScheduleRow): boolean {
  if (!left.gradeIds.length && !left.classIds.length) return true;
  if (!right.gradeIds.length && !right.classIds.length) return true;
  if (left.gradeIds.some((id) => right.gradeIds.includes(id))) return true;
  if (left.classIds.some((id) => right.classIds.includes(id))) return true;
  return false;
}

/**
 * 冲突判定：同一天、范围有交集、时间真正重叠。
 * 被暂停的周测与草稿不参与（前者当天不考，后者没时间）。
 */
export function findScheduleConflicts(rows: readonly ScheduleRow[]): ScheduleConflict[] {
  const candidates = rows.filter(
    (row) =>
      row.status !== 'suppressed' &&
      row.status !== 'draft' &&
      row.startAt != null &&
      row.endAt != null &&
      row.endAt > row.startAt,
  );
  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i];
      const right = candidates[j];
      const startAt = Math.max(left.startAt as number, right.startAt as number);
      const endAt = Math.min(left.endAt as number, right.endAt as number);
      if (endAt <= startAt) continue;
      if (!scopesOverlap(left, right)) continue;
      conflicts.push({
        key: `${left.key}~${right.key}`,
        aKey: left.key,
        bKey: right.key,
        dateKey: getShanghaiDateKey(startAt),
        overlapMs: endAt - startAt,
        scopeLabel: left.scopeLabel === right.scopeLabel ? left.scopeLabel : `${left.scopeLabel} / ${right.scopeLabel}`,
      });
    }
  }
  return conflicts.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || b.overlapMs - a.overlapMs);
}

/** 日期头的文案：今天 / 明天 / 周四 9/25。 */
export function scheduleDayLabel(dateKey: string, now: number): string {
  const todayKey = getShanghaiDateKey(now);
  if (dateKey === todayKey) return '今天';
  if (dateKey === addDaysToDateKey(todayKey, 1)) return '明天';
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = WEEKDAY_LABELS[getZonedParts(Date.UTC(year, month - 1, day, 4, 0, 0)).weekday] ?? '';
  return `${weekday} ${month}/${day}`;
}

export function buildScheduleBoard(input: BuildScheduleBoardInput): {
  rows: ScheduleRow[];
  groups: ScheduleGroup[];
  conflicts: ScheduleConflict[];
  stats: ScheduleBoardStats;
} {
  const { sessions, suppressedWeekly = [], drafts = [], records, grades = [], classes = [], now } = input;
  const recordsById = new Map<string, ScheduleRecordLike>();
  for (const record of records ?? []) recordsById.set(record.id, record);

  // 记录层说「草稿」的考试只以草稿行出现在未排期里：dev 上就存在「记录层是草稿、
  // 快照里却带着科目时间」的历史数据，不去重的话同一场考试会同时出现在日期分组和未排期里。
  const draftIds = new Set<string>();
  for (const draft of drafts) draftIds.add(draft.id);
  for (const record of records ?? []) if (record.displayStatus === 'draft') draftIds.add(record.id);

  const sessionRows = sessions
    .filter((session) => !(session.recordId && draftIds.has(session.recordId)))
    .map((session) => sessionToRow(session, recordsById, now, false));
  const mergedRows = mergeMajorRows(sessionRows, recordsById);

  // 已发布但一个科目时间都没有的考试：以前既不在 sessions 也不在 drafts 里，等于从轴上消失。
  const coveredIds = new Set<string>();
  for (const row of mergedRows) if (row.recordId) coveredIds.add(row.recordId);
  const unscheduledPublished: ScheduleRow[] = (records ?? [])
    .filter(
      (record) =>
        record.displayStatus !== 'draft' &&
        record.displayStatus !== 'ended' &&
        record.displayStatus !== 'archived' &&
        record.startAt == null &&
        !coveredIds.has(record.id),
    )
    .map((record) => ({
      key: `unscheduled|${record.id}`,
      kind: record.source === 'quick' ? 'quick' : 'major',
      status: statusFromRecord(record.displayStatus, record.startAt, record.endAt, now),
      recordId: record.id,
      planId: null,
      title: record.name,
      subject: '',
      scopeLabel: scopeLabelOf(record.targetGradeIds, record.targetClassIds, grades, classes),
      gradeIds: record.targetGradeIds,
      classIds: record.targetClassIds,
      startAt: null,
      endAt: null,
      itemCount: record.itemCount,
      unscheduled: true,
      daySubjectCount: record.itemCount,
      conflictKeys: [],
    }));

  const allRows: ScheduleRow[] = [
    ...mergedRows,
    ...suppressedWeekly.map((session) => sessionToRow(session, recordsById, now, true)),
    ...drafts.map((record) => draftToRow(record, grades, classes)),
    ...unscheduledPublished,
  ];
  const rows = input.rowFilter ? allRows.filter(input.rowFilter) : allRows;

  const conflicts = findScheduleConflicts(rows);
  const conflictedKeys = new Set<string>();
  for (const conflict of conflicts) {
    conflictedKeys.add(conflict.aKey);
    conflictedKeys.add(conflict.bKey);
  }
  for (const row of rows) {
    row.conflictKeys = conflicts
      .filter((item) => item.aKey === row.key || item.bKey === row.key)
      .map((item) => item.key);
  }

  const groupMap = new Map<string, ScheduleRow[]>();
  for (const row of rows) {
    const key = row.unscheduled || row.startAt == null ? UNSCHEDULED_KEY : getShanghaiDateKey(row.startAt);
    const list = groupMap.get(key);
    if (list) list.push(row);
    else groupMap.set(key, [row]);
  }
  const groups: ScheduleGroup[] = [...groupMap.entries()]
    .map(([key, groupRows]) => ({
      key,
      label: key === UNSCHEDULED_KEY ? '未排期' : scheduleDayLabel(key, now),
      dateKey: key === UNSCHEDULED_KEY ? null : key,
      rows: groupRows.sort(
        (left, right) =>
          (left.startAt ?? Number.MAX_SAFE_INTEGER) - (right.startAt ?? Number.MAX_SAFE_INTEGER) ||
          left.title.localeCompare(right.title),
      ),
      conflictCount: conflicts.filter((item) => item.dateKey === key).length,
    }))
    .map((group) =>
      group.key === UNSCHEDULED_KEY
        ? {
            ...group,
            subgroups: [
              { key: 'draft', label: '草稿（未发布）', rows: group.rows.filter((row) => row.kind === 'draft') },
              { key: 'published', label: '已发布·待排期', rows: group.rows.filter((row) => row.kind !== 'draft') },
            ].filter((subgroup) => subgroup.rows.length > 0),
          }
        : group,
    )
    // 有日期的在前（按时间升序），「未排期」永远排在最后。
    .sort((left, right) => {
      if (left.dateKey == null) return 1;
      if (right.dateKey == null) return -1;
      return left.dateKey.localeCompare(right.dateKey);
    });

  const todayKey = getShanghaiDateKey(now);
  return {
    rows,
    groups,
    conflicts,
    stats: {
      total: rows.length,
      conflicted: conflictedKeys.size,
      suppressedWeekly: rows.filter((row) => row.status === 'suppressed').length,
      unscheduled: rows.filter((row) => row.unscheduled).length,
      todayCount: rows.filter(
        (row) => !row.unscheduled && row.startAt != null && getShanghaiDateKey(row.startAt) === todayKey,
      ).length,
    },
  };
}

/**
 * 行级筛选：搜索命中考试名或周测科目；年级按「适用范围是否落到这个年级」判断
 * （全校考试对任何年级都算命中，与列表页服务端口径一致）。
 */
export function makeScheduleRowFilter(input: {
  query?: string;
  gradeId?: string;
  /** 班级 id → 年级 id，用来判断"班级限定"的行是否落到某个年级。 */
  classGradeIds?: Map<string, string> | Record<string, string>;
}): (row: ScheduleRow) => boolean {
  const query = (input.query ?? '').trim().toLowerCase();
  const gradeId = (input.gradeId ?? '').trim();
  const classGrade =
    input.classGradeIds instanceof Map ? input.classGradeIds : new Map(Object.entries(input.classGradeIds ?? {}));
  return (row) => {
    if (query) {
      const haystack = `${row.title} ${row.subject}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (!gradeId) return true;
    // 全校范围（年级与班级都为空）对所有年级都成立。
    if (!row.gradeIds.length && !row.classIds.length) return true;
    if (row.gradeIds.includes(gradeId)) return true;
    return row.classIds.some((classId) => classGrade.get(classId) === gradeId);
  };
}

/** 班级 × 日期网格：为「按班级」视图准备单元格。 */
export type ScheduleClassGridRow = {
  classId: string;
  className: string;
  gradeId: string;
  gradeName: string;
  total: number;
  cells: Array<{ dateKey: string; rows: ScheduleRow[] }>;
};

/** 一行是否落到某个班级（全校 → 所有班；年级 → 该年级的班；班级 → 点名）。 */
export function rowCoversClass(row: ScheduleRow, schoolClass: Pick<SchoolClass, 'id' | 'gradeId'>): boolean {
  if (!row.gradeIds.length && !row.classIds.length) return true;
  if (row.classIds.includes(schoolClass.id)) return true;
  return row.gradeIds.includes(schoolClass.gradeId);
}

export function buildClassGrid(input: {
  rows: readonly ScheduleRow[];
  classes: readonly SchoolClass[];
  grades?: readonly SchoolGrade[];
  /** 'YYYY-MM-DD'，按顺序排列。 */
  days: readonly string[];
}): ScheduleClassGridRow[] {
  const { rows, classes, grades = [], days } = input;
  return classes
    .map((schoolClass) => {
      const cells = days.map((dateKey) => ({
        dateKey,
        rows: rows
          .filter((row) => row.startAt != null && getShanghaiDateKey(row.startAt) === dateKey)
          .filter((row) => rowCoversClass(row, schoolClass))
          .sort((left, right) => (left.startAt ?? 0) - (right.startAt ?? 0)),
      }));
      return {
        classId: schoolClass.id,
        className: schoolClass.name,
        gradeId: schoolClass.gradeId,
        gradeName: grades.find((grade) => grade.id === schoolClass.gradeId)?.name ?? '',
        total: cells.reduce((sum, cell) => sum + cell.rows.length, 0),
        cells,
      };
    })
    .filter((row) => row.total > 0)
    .sort(
      (left, right) =>
        left.gradeId.localeCompare(right.gradeId) || left.className.localeCompare(right.className, 'zh-Hans-CN'),
    );
}
