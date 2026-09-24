import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, Plus, Search } from 'lucide-react';
import type { SchoolClass, SchoolGrade } from '../types/school';
import type { MajorExam } from '../types';
import { fetchExamRecords, type ExamRecordListEntry, type ExamRecordPreset } from '../services/examRecords';
import { runExamRecordAction } from '../services/examRecords';
import { confirmDialog } from '../services/appDialog';
import { notify } from '../services/notify';
import { formatApiError } from '../services/apiError';
import { EXAM_RECORD_STATUS_LABELS, EXAM_RECORD_TIME_CHANGE_ACTIONS } from '../shared/examRecordContracts.js';
import { addDaysToDateKey, getShanghaiDateKey } from '../utils/weeklySchedule';
import { buildWeeklyOccurrenceRows } from '../utils/weeklyOccurrenceRows';
import { groupHistoryEntries, groupScheduleEntries } from '../utils/examListGrouping';
import {
  readExamListCollapsed,
  readExamListFilters,
  writeExamListCollapsed,
  writeExamListFilters,
  type ScheduleWindowKey,
} from '../utils/examListFilterMemory';
import { collectScheduleSessions } from '../utils/examCenterStatus';
import {
  buildClassGrid,
  buildScheduleBoard,
  makeScheduleRowFilter,
  resolveScheduleWindow,
  scheduleDayLabel,
  scheduleWindowDays,
  SCHEDULE_WINDOW_KEYS,
} from '../utils/scheduleTimeline';
import { examTimeRange } from '../utils/examRecordTimeLabel';
import {
  DEFAULT_WEEKLY_CONFLICT_POLICY,
  type ScheduleMode,
  type WeeklyConflictPolicy,
  type WeeklyPlan,
} from '../types/exam';
import { parseZonedTime } from '../utils/zonedTime';
import ExamRecordDetailDrawer from './ExamRecordDetailDrawer';
import ScheduleBoard, { type ScheduleSubjectRow } from './exam-center/ScheduleBoard';
import ScheduleGrid from './exam-center/ScheduleGrid';
import RefreshButton from './admin/RefreshButton';
import InlineSelect from './InlineSelect';
import '../styles/exam-records.css';

type RecordSource = 'regular' | 'quick';

type Props = {
  grades: SchoolGrade[];
  classes: SchoolClass[];
  /** 板块口径：current 当前考试 / schedule 考试安排 / history 历史考试。 */
  preset: Extract<ExamRecordPreset, 'current' | 'schedule' | 'history'>;
  /** 权限判定交给上层，动作按钮只显示当前账号真的能执行的项。 */
  can: (permission: string) => boolean;
  /** 顶部「+ 创建考试」；由上层按类型路由到已有的创建流程。 */
  onCreate?: (kind: 'major' | 'quick' | 'weekly') => void;
  /** 周测并入「考试安排」：这里只读展示未来 7 天的周测实例，编辑仍回周测计划编辑器。 */
  weeklyPlans?: WeeklyPlan[];
  weeklyPlanIdByClassId?: Record<string, string | null>;
  onOpenWeeklyEditor?: () => void;
  /** 详情抽屉里的「编辑考试」：由上层定位到这场考试再进编辑器，面板自己不猜落点。 */
  onEditRecord?: (record: ExamRecordListEntry) => void;
  /** 删除草稿：返回 true 表示确实删了（面板据此立刻重拉草稿列表）。 */
  onDeleteDraft?: (record: ExamRecordListEntry) => Promise<boolean>;
  /** 「考试安排」日程轴：本地快照 + 周测规则，用来展开场次、抑制冲突并列出科目。 */
  majors?: MajorExam[];
  scheduleMode?: ScheduleMode;
  weeklyConflictPolicy?: WeeklyConflictPolicy;
  activeWeeklyPlanId?: string | null;
  activeWeeklyPlanIdByClassId?: Record<string, string | null>;
  subjectTrackModeEnabled?: boolean;
  /** 周测行的「取消本次 / 改时间 / 冲突仍然进行」：写进对应班级计划的 overrides。 */
  onWeeklyOccurrenceAction?: (input: WeeklyOccurrenceActionInput) => void;
};

export type WeeklyOccurrenceActionInput = {
  planIds: string[];
  itemId: string;
  dateKey: string;
  startClock: string;
  endClock: string;
  action: 'cancel' | 'reschedule' | 'force';
  targetDate?: string;
  newStart?: string;
  newEnd?: string;
};

const PRESET_COPY: Record<Props['preset'], { title: string; description: string; empty: string }> = {
  current: {
    title: '当前考试',
    description: '正在进行的、今天稍后要开始的，以及时间已过但仍未结束的考试。',
    empty: '当前没有需要关注的考试。',
  },
  schedule: {
    title: '考试安排',
    description: '明天及以后已发布的考试；未定时间的安排和草稿排在下面。',
    empty: '还没有安排中的考试。',
  },
  history: {
    title: '历史考试',
    description: '已经结束的考试；归档默认隐藏，需要时在下方打开。',
    empty: '还没有历史考试。',
  },
};

function formatTime(value: number | null): string {
  if (!value || !Number.isFinite(value)) return '未设置时间';
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function scopeLabel(record: ExamRecordListEntry, grades: SchoolGrade[], classes: SchoolClass[]): string {
  if (!record.targetGradeIds.length && !record.targetClassIds.length) return '全校';
  const gradeNames = record.targetGradeIds.map((id) => grades.find((grade) => grade.id === id)?.name ?? id).slice(0, 2);
  // 班级一多就不再逐个列名字：列里出现「高二 · 12 个班」比一长串班名好扫，点详情看全量。
  if (record.targetClassIds.length > 2) {
    return [...gradeNames, `${record.targetClassIds.length} 个班`].join('、');
  }
  const classNames = record.targetClassIds.map((id) => classes.find((item) => item.id === id)?.name ?? id);
  const labels = [...gradeNames, ...classNames];
  const total = record.targetGradeIds.length + record.targetClassIds.length;
  return `${labels.join('、')}${total > labels.length ? ' 等' : ''}`;
}

/** 今天 / 明天 / M-D，用于周测行的日期前缀。 */
function weeklyDateLabel(dateKey: string, now: number): string {
  const today = getShanghaiDateKey(now);
  if (dateKey === today) return '今天';
  if (dateKey === addDaysToDateKey(today, 1)) return '明天';
  return dateKey.slice(5);
}

export default function ExamRecordsPanel({
  grades,
  classes,
  preset,
  can,
  onCreate,
  weeklyPlans,
  weeklyPlanIdByClassId,
  onOpenWeeklyEditor,
  onEditRecord,
  onDeleteDraft,
  majors,
  scheduleMode,
  weeklyConflictPolicy,
  activeWeeklyPlanId,
  activeWeeklyPlanIdByClassId,
  subjectTrackModeEnabled,
  onWeeklyOccurrenceAction,
}: Props) {
  // 切板块或去编辑器会卸载本面板：筛选条件从内存快照读回，见 utils/examListFilterMemory。
  const [rememberedFilters] = useState(() => readExamListFilters(preset));
  const [records, setRecords] = useState<ExamRecordListEntry[]>([]);
  const [query, setQuery] = useState(rememberedFilters?.query ?? '');
  const [gradeId, setGradeId] = useState(rememberedFilters?.gradeId ?? '');
  const [source, setSource] = useState<'' | RecordSource>(rememberedFilters?.source ?? '');
  const [createdBy, setCreatedBy] = useState(rememberedFilters?.createdBy ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(rememberedFilters?.pageSize ?? 25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailId, setDetailId] = useState('');
  const [showArchived, setShowArchived] = useState(rememberedFilters?.showArchived ?? false);
  const [drafts, setDrafts] = useState<ExamRecordListEntry[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(rememberedFilters?.draftsOpen ?? false);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(rememberedFilters?.createOpen ?? false);
  const [moreOpen, setMoreOpen] = useState(rememberedFilters?.moreOpen ?? false);
  const [density, setDensity] = useState<'comfortable' | 'compact'>(rememberedFilters?.density ?? 'comfortable');
  const [viewMode, setViewMode] = useState<'timeline' | 'exam' | 'class'>(
    rememberedFilters?.viewMode ?? (preset === 'schedule' ? 'timeline' : 'exam'),
  );
  const [scheduleWindow, setScheduleWindow] = useState<ScheduleWindowKey>(rememberedFilters?.scheduleWindow ?? 'week');
  const [expandedClassId, setExpandedClassId] = useState('');
  const [weeklyExpanded, setWeeklyExpanded] = useState(false);

  /**
   * 父级（AdminPage）每 10 秒重渲染一次，`visibleClasses` 这类派生数组每次都是新引用；
   * 直接把它们放进 useCallback/useEffect 依赖，会让列表与草稿每 10 秒重新请求一次——
   * 用户看到的就是「页面自己在刷新、元素消失又回来」。这里改用内容签名做依赖，
   * 班级列表通过 ref 读取最新值（不参与依赖）。
   */
  const classIdsByGrade = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of classes) {
      const list = map.get(item.gradeId);
      if (list) list.push(item.id);
      else map.set(item.gradeId, [item.id]);
    }
    return map;
  }, [classes]);

  // 「考试安排」的时间窗：今天 / 明天 / 本周 / 未来两周 / 全部。
  const window = useMemo(
    () => resolveScheduleWindow(scheduleWindow, Date.now()),
    // 时间窗只跟档位走；重新挂载（切板块回来）也会重算一次「今天」。
    [scheduleWindow],
  );
  // 日程轴与班级网格共用同一套取数与行模型（时间窗、草稿、冲突），只有呈现方式不同。
  const boardActive = preset === 'schedule' && viewMode !== 'exam';
  const boardTimeline = preset === 'schedule' && viewMode === 'timeline';

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchExamRecords({
        // 日程轴按时间窗一次取全：窗口内不再分页，避免同一个日期分组被切到两页。
        page: boardActive ? 1 : page,
        pageSize: boardActive ? 100 : pageSize,
        preset,
        includeArchived: preset === 'history' && showArchived,
        q: query.trim() || undefined,
        gradeId: gradeId || undefined,
        classIds: gradeId ? classIdsByGrade.get(gradeId) : undefined,
        source: source || undefined,
        createdBy: createdBy.trim() || undefined,
        ...(boardActive && window.from && window.to
          ? { from: window.from, to: window.to, includeUnscheduled: true }
          : {}),
      });
      setRecords(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (caught) {
      // 刷新失败保留上一批数据：清空会让整张列表消失再回来（列表与文案都由这些状态驱动）。
      setError(formatApiError(caught, '考试列表读取失败'));
    } finally {
      setLoading(false);
    }
  }, [
    boardActive,
    classIdsByGrade,
    createdBy,
    gradeId,
    page,
    pageSize,
    preset,
    query,
    showArchived,
    source,
    window.from,
    window.to,
  ]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords, refreshKey]);

  // 记住筛选条件与几个展开状态：切板块、进编辑器再回来时，列表还在原来的口径上。
  // 分页刻意不记，回来时从第一页开始。
  useEffect(() => {
    writeExamListFilters(preset, {
      query,
      gradeId,
      source,
      createdBy,
      showArchived,
      draftsOpen,
      createOpen,
      moreOpen,
      pageSize,
      density,
      viewMode,
      scheduleWindow,
    });
  }, [
    preset,
    query,
    gradeId,
    source,
    createdBy,
    showArchived,
    draftsOpen,
    createOpen,
    moreOpen,
    pageSize,
    density,
    viewMode,
    scheduleWindow,
  ]);

  // 考试安排的草稿：表格视图里是可折叠的一块，日程轴里是「待排期」分组，两种都要拉一次。
  useEffect(() => {
    if (preset !== 'schedule' || !(draftsOpen || boardActive)) return;
    let active = true;
    setDraftsLoading(true);
    void fetchExamRecords({
      page: 1,
      pageSize: 50,
      preset: 'draft',
      q: query.trim() || undefined,
      gradeId: gradeId || undefined,
      classIds: gradeId ? classIdsByGrade.get(gradeId) : undefined,
      source: source || undefined,
      createdBy: createdBy.trim() || undefined,
    })
      .then((result) => {
        if (active) setDrafts(result.data);
      })
      .catch(() => {
        // 同上：草稿取数失败时保留上一批，避免「未排期」分组闪一下又回来。
      })
      .finally(() => {
        if (active) setDraftsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [boardActive, classIdsByGrade, createdBy, draftsOpen, gradeId, preset, query, refreshKey, source]);

  /** 筛选项变化一律回到第一页；DOM 事件的值会被放宽成 string，这里集中收窄一次。 */
  const filterHandler =
    <T extends string>(setter: Dispatch<SetStateAction<T>>) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setter(event.target.value as T);
      setPage(1);
    };

  // 详情始终取列表里的最新一行：动作完成后列表刷新，抽屉里的状态与时间会跟着更新。
  // 草稿区是另一次 preset=draft 请求的结果，不在 records 里，所以这里必须一起找——
  // 只查 records 的话点草稿什么都不会发生（抽屉打不开），也就是「草稿无法再次编辑」。
  const detailRecord = detailId
    ? (records.find((item) => item.id === detailId) ?? drafts.find((item) => item.id === detailId) ?? null)
    : null;
  /** 收在「更多筛选」里、但当前有生效值的条数（给折叠状态的按钮做提示）。 */
  const hiddenFilterCount = (source ? 1 : 0) + (createdBy.trim() ? 1 : 0);
  const copy = PRESET_COPY[preset];
  // 周测只读实例：未来 7 天，按开始时间排序；编辑仍走周测计划编辑器。
  const weeklyRows = useMemo(() => {
    if (preset !== 'schedule' || !weeklyPlans?.length) return [];
    return buildWeeklyOccurrenceRows({
      plans: weeklyPlans,
      activePlanIdByClassId: weeklyPlanIdByClassId,
      classes,
      grades,
      now: Date.now(),
      daysForward: 7,
    });
  }, [preset, weeklyPlans, weeklyPlanIdByClassId, classes, grades]);

  // 日程轴的数据来源：本地快照展开出「大型考试 / 快速发布 / 周测」场次（周测已按时间结构合并，
  // 被大型考试按冲突策略暂停的实例单独返回），再和记录层的生命周期状态、草稿合流成一条轴。
  const collected = useMemo(() => {
    if (!boardActive || !majors?.length) return { sessions: [], suppressed: [] };
    return collectScheduleSessions({
      majors,
      weeklyPlans: weeklyPlans ?? [],
      classes,
      grades,
      scheduleMode: scheduleMode ?? 'automatic',
      weeklyConflictPolicy: weeklyConflictPolicy ?? DEFAULT_WEEKLY_CONFLICT_POLICY,
      activeWeeklyPlanId: activeWeeklyPlanId ?? null,
      activeWeeklyPlanIdByClassId,
      subjectTrackModeEnabled,
      dayKey: window.dayKey,
      daysForward: window.daysForward,
      windowBackMs: 0,
    });
  }, [
    boardActive,
    majors,
    weeklyPlans,
    classes,
    grades,
    scheduleMode,
    weeklyConflictPolicy,
    activeWeeklyPlanId,
    activeWeeklyPlanIdByClassId,
    subjectTrackModeEnabled,
    window.dayKey,
    window.daysForward,
  ]);

  // 搜索与年级对整条轴生效：行的来源既有服务端记录（已经过滤过）也有本地周测实例，
  // 统一在这里再过一遍，冲突与统计才和「眼前这批安排」保持一致。
  const classGradeIds = useMemo(() => new Map(classes.map((item) => [item.id, item.gradeId])), [classes]);
  const board = useMemo(
    () =>
      boardActive
        ? buildScheduleBoard({
            sessions: collected.sessions,
            suppressedWeekly: collected.suppressed,
            drafts,
            records,
            grades,
            classes,
            now: Date.now(),
            rowFilter: makeScheduleRowFilter({ query, gradeId, classGradeIds }),
          })
        : null,
    [boardActive, collected, drafts, records, grades, classes, query, gradeId, classGradeIds],
  );

  /** 班级网格的日期列（最多 7 天）与列头文案。 */
  const gridDays = useMemo(() => (boardActive ? scheduleWindowDays(window, 7) : []), [boardActive, window]);
  const gridDayLabels = useMemo(() => gridDays.map((day) => scheduleDayLabel(day, Date.now())), [gridDays]);
  const classGrid = useMemo(
    () => (board && gridDays.length ? buildClassGrid({ rows: board.rows, classes, grades, days: gridDays }) : []),
    [board, gridDays, classes, grades],
  );

  /** 展开某场考试时列出的科目清单（取本地快照里启用且有时间的科目）。 */
  const subjectsByRecordId = useMemo(() => {
    const map: Record<string, ScheduleSubjectRow[]> = {};
    for (const major of majors ?? []) {
      map[major.id] = major.items
        .filter((item) => item.enabled !== false)
        .map((item) => ({
          id: item.id,
          name: item.name,
          startAt: parseZonedTime(item.startTime),
          endAt: parseZonedTime(item.endTime),
        }))
        .filter((row) => Number.isFinite(row.startAt) && Number.isFinite(row.endAt))
        .sort((left, right) => left.startAt - right.startAt);
    }
    return map;
  }, [majors]);

  // 分组：安排页是 今天/明天/本周内/更晚，历史页是自然月（当前考试不分段）。
  const groupedRows = useMemo(() => {
    if (preset === 'schedule') return groupScheduleEntries(records, Date.now());
    if (preset === 'history') return groupHistoryEntries(records);
    return null;
  }, [preset, records]);

  // 分组默认只展开最近两组（安排页=今天/明天，历史页=最近一个月），其余折叠；
  // 用户折叠过就按用户记的来（和筛选条件一样存在内存里，切板块回来还在）。
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => readExamListCollapsed(preset) ?? []);
  const collapsedInitRef = useRef(false);
  useEffect(() => {
    if (collapsedInitRef.current || !groupedRows?.length) return;
    collapsedInitRef.current = true;
    if (readExamListCollapsed(preset) !== null) return;
    setCollapsedGroups(groupedRows.slice(preset === 'schedule' ? 2 : 1).map((group) => group.key));
  }, [groupedRows, preset]);
  useEffect(() => {
    if (!collapsedInitRef.current) return;
    writeExamListCollapsed(preset, collapsedGroups);
  }, [preset, collapsedGroups]);
  const toggleGroup = (groupKey: string) =>
    setCollapsedGroups((current) =>
      current.includes(groupKey) ? current.filter((key) => key !== groupKey) : [...current, groupKey],
    );

  /** 删除草稿：确认并真的删掉之后，立刻重拉一次（草稿区与主列表都会跟着更新）。 */
  const requestDeleteDraft = async (record: ExamRecordListEntry) => {
    if (!onDeleteDraft) return;
    const deleted = await onDeleteDraft(record);
    if (deleted) setRefreshKey((value) => value + 1);
  };

  /**
   * 行内复制：以这场考试的科目生成一场新草稿。复制走记录层动作（带幂等键），
   * 成功后立刻重拉——副本会落在「未排期」里，不需要用户再去找。
   */
  const requestCopyRecord = async (recordId: string) => {
    const record = records.find((item) => item.id === recordId) ?? drafts.find((item) => item.id === recordId);
    const name = record?.name || recordId;
    const confirmed = await confirmDialog({
      title: '复制这场考试',
      message: `会以「${name}」的科目生成一场新的草稿考试，原考试不受影响。`,
      tone: 'info',
      confirmLabel: '复制',
    });
    if (!confirmed) return;
    try {
      await runExamRecordAction({ id: recordId, action: 'copy' });
      notify('success', '已生成副本，可在「未排期」里继续完善。', '已复制考试');
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      notify('error', formatApiError(caught, '复制失败'), '复制失败');
    }
  };

  // 分组表头与记录行拍平成一条渲染流；折叠的分组只留表头。
  const rowItems = useMemo(() => {
    type Row =
      | { kind: 'group'; key: string; groupKey: string; label: string; count: number; collapsed: boolean }
      | { kind: 'record'; key: string; record: ExamRecordListEntry };
    if (!groupedRows) return records.map((record) => ({ kind: 'record' as const, key: record.id, record }));
    const rows: Row[] = [];
    for (const group of groupedRows) {
      const collapsed = collapsedGroups.includes(group.key);
      rows.push({
        kind: 'group',
        key: `g-${group.key}`,
        groupKey: group.key,
        label: group.label,
        count: group.items.length,
        collapsed,
      });
      if (!collapsed) for (const record of group.items) rows.push({ kind: 'record', key: record.id, record });
    }
    return rows;
  }, [collapsedGroups, groupedRows, records]);

  /**
   * 按班级视图：以班级为行，回答「这个班有哪些考试、最近一场什么时候」。
   * 口径：只看当前筛选结果的**当前页**记录（服务端分页），够用来排当天冲突；
   * 全校考试对每个班都算命中。
   */
  const classRows = useMemo(() => {
    if (viewMode !== 'class') return [];
    const covers = (record: ExamRecordListEntry, klass: SchoolClass) =>
      record.targetClassIds.includes(klass.id) ||
      record.targetGradeIds.includes(klass.gradeId) ||
      (!record.targetClassIds.length && !record.targetGradeIds.length);
    return classes
      .map((klass) => ({
        id: klass.id,
        name: klass.name,
        gradeName: grades.find((grade) => grade.id === klass.gradeId)?.name ?? '',
        items: records
          .filter((record) => covers(record, klass))
          .sort((a, b) => (a.startAt ?? Number.MAX_SAFE_INTEGER) - (b.startAt ?? Number.MAX_SAFE_INTEGER)),
      }))
      .filter((row) => row.items.length > 0)
      .sort(
        (a, b) => (a.items[0].startAt ?? Number.MAX_SAFE_INTEGER) - (b.items[0].startAt ?? Number.MAX_SAFE_INTEGER),
      );
  }, [viewMode, classes, grades, records]);

  const renderRecordRow = (record: ExamRecordListEntry) => (
    <div className="exam-records-table__row" role="row" key={record.id}>
      <div className="exam-records-name" role="cell">
        <strong title={record.name || record.id}>{record.name || '未命名考试'}</strong>
        <code>{record.id}</code>
      </div>
      <span className={`exam-records-status is-${record.displayStatus}`} role="cell">
        {EXAM_RECORD_STATUS_LABELS[record.displayStatus]}
      </span>
      <span className="exam-records-scope" role="cell">
        {scopeLabel(record, grades, classes)}
      </span>
      <span className="exam-records-time" role="cell">
        <CalendarClock size={14} aria-hidden="true" />
        {examTimeRange(record.startAt, record.endAt)}
        {/* P1-⑤：最近一次生命周期操作动过时间就提示一下，鼠标悬停看「旧 → 新」原文。 */}
        {record.lastOperation &&
          EXAM_RECORD_TIME_CHANGE_ACTIONS.includes(
            record.lastOperation.action as (typeof EXAM_RECORD_TIME_CHANGE_ACTIONS)[number],
          ) &&
          Date.now() - record.lastOperation.at < 24 * 60 * 60 * 1000 && (
            <em className="exam-records-time-note" title={record.lastOperation.reason || '时间已调整'}>
              时间已调整
            </em>
          )}
      </span>
      <span className="exam-records-count" role="cell">
        {record.itemCount} 科 · {record.source === 'quick' ? '快速' : '正式'}
      </span>
      <span className="exam-records-row-actions" role="cell">
        <button
          className="admin-btn admin-btn--ghost"
          type="button"
          onClick={() => setDetailId(record.id)}
          aria-label={`查看 ${record.name || record.id} 详情`}
        >
          详情
        </button>
      </span>
    </div>
  );

  return (
    <main className="exam-records-panel">
      <header className="exam-records-panel__header">
        <div>
          <span className="exam-records-panel__eyebrow">考试中心</span>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="exam-records-panel__actions">
          <RefreshButton
            className="admin-btn admin-btn--ghost exam-records-panel__refresh"
            busy={loading}
            onRefresh={() => setRefreshKey((value) => value + 1)}
            title="刷新考试列表"
          />
          {onCreate && (
            <div className="exam-records-create">
              <button
                className="admin-btn admin-btn--primary exam-records-panel__create"
                type="button"
                aria-expanded={createOpen}
                onClick={() => setCreateOpen((value) => !value)}
              >
                <Plus size={16} aria-hidden="true" />
                创建考试
              </button>
              {createOpen && (
                <div className="exam-records-create__menu" role="menu" aria-label="选择考试类型">
                  {(
                    [
                      ['major', '大型考试', '有起止的正式考试，先存草稿再完善'],
                      ['quick', '快速发布', '立刻统一下发到班级，保存即生效'],
                      ['weekly', '周测计划', '周期性的课表安排'],
                    ] as const
                  ).map(([kind, label, hint]) => (
                    <button
                      key={kind}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setCreateOpen(false);
                        onCreate(kind);
                      }}
                    >
                      <strong>{label}</strong>
                      <span>{hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* 时间窗：日程轴的取数范围；「全部」退回按需分页的表格口径。 */}
      {preset === 'schedule' && viewMode !== 'class' && (
        <nav className="exam-records-window" aria-label="时间窗">
          {SCHEDULE_WINDOW_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`exam-records-window__item${scheduleWindow === key ? ' is-active' : ''}`}
              aria-current={scheduleWindow === key ? 'true' : undefined}
              onClick={() => {
                setScheduleWindow(key);
                setPage(1);
              }}
            >
              {resolveScheduleWindow(key, Date.now()).label}
            </button>
          ))}
        </nav>
      )}

      <section className="exam-records-filters" aria-label="考试筛选">
        <label className="exam-records-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">搜索考试</span>
          <input value={query} onChange={filterHandler(setQuery)} placeholder="搜索名称或编号" type="search" />
        </label>
        <label>
          <span>年级</span>
          <InlineSelect
            value={gradeId}
            onChange={(value) => {
              setGradeId(value);
              setPage(1);
            }}
            options={[
              { value: '', label: '全部年级' },
              ...grades.map((grade) => ({ value: grade.id, label: grade.name })),
            ]}
          />
        </label>
        {/* 来源与创建人默认收进「更多筛选」；收起时若有生效值，按钮上带数量提示。 */}
        {moreOpen && (
          <>
            <label>
              <span>来源</span>
              <InlineSelect
                value={source}
                onChange={(value) => {
                  setSource(value as '' | RecordSource);
                  setPage(1);
                }}
                options={[
                  { value: '', label: '全部来源' },
                  { value: 'regular', label: '正式考试' },
                  { value: 'quick', label: '快速考试' },
                ]}
              />
            </label>
            <label>
              <span>创建人</span>
              <input
                className="exam-records-creator-input"
                value={createdBy}
                onChange={(event) => {
                  setCreatedBy(event.target.value.replace(/[^0-9]/g, ''));
                  setPage(1);
                }}
                placeholder="创建人编号"
                inputMode="numeric"
              />
            </label>
          </>
        )}
        <div className="exam-records-filters__tools">
          <button
            className="admin-btn admin-btn--ghost exam-records-filters__more"
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((value) => !value)}
          >
            {moreOpen ? '收起筛选' : '更多筛选'}
            {!moreOpen && hiddenFilterCount > 0 ? `（${hiddenFilterCount}）` : ''}
          </button>
          <label className="exam-records-filters__compact">
            <span>视图</span>
            <InlineSelect
              value={viewMode}
              onChange={(value) => {
                setViewMode(value as 'timeline' | 'exam' | 'class');
                setPage(1);
              }}
              options={
                preset === 'schedule'
                  ? [
                      { value: 'timeline', label: '日程' },
                      { value: 'class', label: '按班级' },
                      { value: 'exam', label: '表格' },
                    ]
                  : [
                      { value: 'exam', label: '按考试' },
                      { value: 'class', label: '按班级' },
                    ]
              }
            />
          </label>
          <label className="exam-records-filters__compact">
            <span>密度</span>
            <InlineSelect
              value={density}
              onChange={(value) => setDensity(value as 'comfortable' | 'compact')}
              options={[
                { value: 'comfortable', label: '舒适' },
                { value: 'compact', label: '紧凑' },
              ]}
            />
          </label>
        </div>
      </section>

      {preset === 'history' && (
        <label className="exam-records-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => {
              setShowArchived(event.target.checked);
              setPage(1);
            }}
          />
          显示已归档的考试
        </label>
      )}

      {preset === 'schedule' && viewMode === 'class' ? (
        <ScheduleGrid
          grid={classGrid}
          days={gridDays}
          dayLabels={gridDayLabels}
          loading={loading}
          error={error}
          onOpenDetail={(recordId) => setDetailId(recordId)}
          onOpenWeeklyPlan={onOpenWeeklyEditor}
        />
      ) : boardTimeline && board ? (
        <ScheduleBoard
          groups={board.groups}
          conflicts={board.conflicts}
          stats={board.stats}
          subjectsByRecordId={subjectsByRecordId}
          windowLabel={window.label}
          loading={loading}
          error={error}
          compact={density === 'compact'}
          can={can}
          onOpenDetail={(recordId) => setDetailId(recordId)}
          onEditRecord={
            onEditRecord
              ? (recordId) => {
                  const found =
                    records.find((item) => item.id === recordId) ?? drafts.find((item) => item.id === recordId);
                  if (found) onEditRecord(found);
                }
              : undefined
          }
          onOpenWeeklyPlan={onOpenWeeklyEditor}
          onCopyRecord={(recordId) => void requestCopyRecord(recordId)}
          // 「全部」/两周档可能超过一次取数上限（100 条）：说清楚只显示了多少，并给一个收窄入口。
          truncated={boardActive && total > records.length ? { shown: records.length, total } : null}
          onNarrowWindow={
            scheduleWindow === 'all'
              ? () => setScheduleWindow('fortnight')
              : scheduleWindow === 'fortnight'
                ? () => setScheduleWindow('week')
                : undefined
          }
          onCancelWeeklyOccurrence={
            onWeeklyOccurrenceAction
              ? (row) =>
                  row.weekly &&
                  onWeeklyOccurrenceAction({
                    planIds: row.weekly.planIds,
                    itemId: row.weekly.itemId,
                    dateKey: row.weekly.dateKey,
                    startClock: row.weekly.startClock,
                    endClock: row.weekly.endClock,
                    action: 'cancel',
                  })
              : undefined
          }
          onForceWeeklyOccurrence={
            onWeeklyOccurrenceAction
              ? (row) =>
                  row.weekly &&
                  onWeeklyOccurrenceAction({
                    planIds: row.weekly.planIds,
                    itemId: row.weekly.itemId,
                    dateKey: row.weekly.dateKey,
                    startClock: row.weekly.startClock,
                    endClock: row.weekly.endClock,
                    action: 'force',
                  })
              : undefined
          }
          onRescheduleWeeklyOccurrence={
            onWeeklyOccurrenceAction
              ? (row, next) =>
                  row.weekly &&
                  onWeeklyOccurrenceAction({
                    planIds: row.weekly.planIds,
                    itemId: row.weekly.itemId,
                    dateKey: row.weekly.dateKey,
                    startClock: row.weekly.startClock,
                    endClock: row.weekly.endClock,
                    action: 'reschedule',
                    targetDate: next.targetDate,
                    newStart: next.startClock,
                    newEnd: next.endClock,
                  })
              : undefined
          }
          onDeleteDraft={
            onDeleteDraft
              ? (recordId) => {
                  const found =
                    drafts.find((item) => item.id === recordId) ?? records.find((item) => item.id === recordId);
                  if (found) void requestDeleteDraft(found);
                }
              : undefined
          }
        />
      ) : (
        <>
          {error && <div className="exam-records-feedback is-error">{error}</div>}
          {/* 刷新时保留上一批数据：只有「第一次加载、手上还没有任何行」才用占位替换列表。
              否则关闭创建向导 / 点刷新都会让列表瞬间变空（巡检 P1-1：用户以为考试没了）。 */}
          {loading && records.length === 0 ? (
            <div className="exam-records-feedback">正在读取考试记录…</div>
          ) : records.length === 0 ? (
            <div className="exam-records-empty">
              <ClipboardList size={30} aria-hidden="true" />
              <strong>{copy.empty}</strong>
              <span>可以调整筛选条件，或用右上角「创建考试」新建一场。</span>
            </div>
          ) : (
            <section
              className={`exam-records-table-wrap${density === 'compact' ? ' is-compact' : ''}`}
              aria-label={viewMode === 'class' ? '按班级查看' : '考试记录'}
            >
              {viewMode === 'class' ? (
                <div className="exam-records-table exam-records-classview">
                  <div className="exam-records-table__row is-head" role="row">
                    <span role="columnheader">班级</span>
                    <span role="columnheader">年级</span>
                    <span role="columnheader">考试</span>
                    <span role="columnheader">最近一场</span>
                    <span role="columnheader">操作</span>
                  </div>
                  {classRows.length === 0 ? (
                    <p className="exam-records-drafts__hint">当前页里没有影响到班级的考试。</p>
                  ) : (
                    classRows.map((row) => (
                      <div className="exam-records-classrow" key={row.id}>
                        <div className="exam-records-table__row" role="row">
                          <strong className="exam-records-classrow__name">{row.name}</strong>
                          <span role="cell">{row.gradeName}</span>
                          <span className="exam-records-count" role="cell">
                            {row.items.length} 场
                          </span>
                          <span className="exam-records-time" role="cell">
                            <CalendarClock size={14} aria-hidden="true" />
                            {examTimeRange(row.items[0].startAt, row.items[0].endAt)}
                          </span>
                          <span className="exam-records-row-actions" role="cell">
                            <button
                              className="admin-btn admin-btn--ghost"
                              type="button"
                              aria-expanded={expandedClassId === row.id}
                              onClick={() => setExpandedClassId((current) => (current === row.id ? '' : row.id))}
                            >
                              {expandedClassId === row.id ? '收起' : '展开'}
                            </button>
                          </span>
                        </div>
                        {expandedClassId === row.id && (
                          <ul className="exam-records-classrow__list">
                            {row.items.map((item) => (
                              <li key={item.id}>
                                <strong>{item.name || item.id}</strong>
                                <span>{examTimeRange(item.startAt, item.endAt)}</span>
                                <em>{EXAM_RECORD_STATUS_LABELS[item.displayStatus]}</em>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <>
                  <div className="exam-records-table" role="table">
                    <div className="exam-records-table__row is-head" role="row">
                      <span role="columnheader">考试</span>
                      <span role="columnheader">状态</span>
                      <span role="columnheader">适用范围</span>
                      <span role="columnheader">时间</span>
                      <span role="columnheader">科目</span>
                      <span role="columnheader">操作</span>
                    </div>
                    {rowItems.map((row) =>
                      row.kind === 'group' ? (
                        <div className="exam-records-table__group" role="row" key={row.key}>
                          <button
                            className="exam-records-group-toggle"
                            type="button"
                            aria-expanded={!row.collapsed}
                            onClick={() => toggleGroup(row.groupKey)}
                          >
                            <ChevronRight
                              size={14}
                              aria-hidden="true"
                              className={row.collapsed ? undefined : 'is-open'}
                            />
                            {row.label}
                            <em>{row.count}</em>
                          </button>
                        </div>
                      ) : (
                        renderRecordRow(row.record)
                      ),
                    )}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}

      {preset === 'schedule' && !boardTimeline && (
        <section className="exam-records-weekly" aria-label="周测安排">
          <header className="exam-records-weekly__head">
            <h3>周测（未来 7 天）</h3>
            {onOpenWeeklyEditor && (
              <button className="admin-btn admin-btn--ghost" type="button" onClick={onOpenWeeklyEditor}>
                打开周测计划
              </button>
            )}
          </header>
          {weeklyRows.length === 0 ? (
            <p className="exam-records-weekly__hint">未来 7 天没有周测安排。</p>
          ) : (
            <>
              <ul className="exam-records-weekly__list">
                {(weeklyExpanded ? weeklyRows : weeklyRows.slice(0, 5)).map((row) => (
                  <li key={row.key}>
                    <span className="exam-records-weekly__when">{weeklyDateLabel(row.dateKey, Date.now())}</span>
                    <strong>{row.name}</strong>
                    <span>
                      {row.gradeName}
                      {row.className}
                    </span>
                    <em>
                      {row.startClock}–{row.endClock}
                    </em>
                  </li>
                ))}
              </ul>
              {weeklyRows.length > 5 && (
                <button
                  className="admin-btn admin-btn--ghost exam-records-weekly__more"
                  type="button"
                  onClick={() => setWeeklyExpanded((value) => !value)}
                >
                  {weeklyExpanded ? '收起' : `还有 ${weeklyRows.length - 5} 条`}
                </button>
              )}
            </>
          )}
        </section>
      )}

      {preset === 'schedule' && (
        <section className="exam-records-drafts" aria-label="草稿考试">
          <button
            className="admin-btn admin-btn--ghost exam-records-drafts__toggle"
            type="button"
            aria-expanded={draftsOpen}
            onClick={() => setDraftsOpen((value) => !value)}
          >
            <ChevronRight size={16} aria-hidden="true" className={draftsOpen ? 'is-open' : undefined} />
            草稿{drafts.length && draftsOpen ? `（${drafts.length}）` : ''}
          </button>
          {draftsOpen &&
            (draftsLoading ? (
              <p className="exam-records-drafts__hint">正在读取草稿…</p>
            ) : drafts.length === 0 ? (
              <p className="exam-records-drafts__hint">没有草稿。新建考试默认先存为草稿，会出现在这里。</p>
            ) : (
              <ul className="exam-records-drafts__list">
                {drafts.map((record) => (
                  <li key={record.id}>
                    <button type="button" onClick={() => setDetailId(record.id)}>
                      <strong>{record.name || record.id}</strong>
                      <span>{record.itemCount} 科</span>
                      <span>{record.startAt ? formatTime(record.startAt) : '时间待定'}</span>
                      <em>草稿</em>
                    </button>
                    {/* 草稿最常见的下一步就是接着填科目/时间，直接给一个到编辑器的入口，
                        不必先开详情抽屉再点「编辑考试」。 */}
                    {onEditRecord && (
                      <button
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        type="button"
                        onClick={() => onEditRecord(record)}
                        title="在编辑器里继续填这场草稿"
                      >
                        编辑
                      </button>
                    )}
                    {onDeleteDraft && (
                      <button
                        className="admin-btn admin-btn--danger admin-btn--sm"
                        type="button"
                        onClick={() => void requestDeleteDraft(record)}
                        title="删除这场草稿"
                      >
                        删除
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ))}
        </section>
      )}

      <footer className="exam-records-pagination">
        <span>共 {total} 场</span>
        <label className="exam-records-pagination__size">
          <span>每页</span>
          <InlineSelect
            value={String(pageSize)}
            onChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
            options={[
              { value: '12', label: '12 条' },
              { value: '25', label: '25 条' },
              { value: '50', label: '50 条' },
            ]}
            ariaLabel="每页条数"
          />
        </label>
        <div>
          <button
            className="admin-btn admin-btn--ghost"
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
            aria-label="上一页"
            title="上一页"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong>{totalPages ? `${page} / ${totalPages}` : '1 / 1'}</strong>
          <button
            className="admin-btn admin-btn--ghost"
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={!totalPages || page >= totalPages || loading}
            aria-label="下一页"
            title="下一页"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </footer>

      {detailRecord && (
        <ExamRecordDetailDrawer
          record={detailRecord}
          grades={grades}
          classes={classes}
          can={can}
          onClose={() => setDetailId('')}
          onChanged={() => setRefreshKey((value) => value + 1)}
          onEdit={onEditRecord ? () => onEditRecord(detailRecord) : undefined}
          onDiscard={
            onDeleteDraft
              ? () => {
                  const target = detailRecord;
                  setDetailId('');
                  void requestDeleteDraft(target);
                }
              : undefined
          }
        />
      )}
    </main>
  );
}
