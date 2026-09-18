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
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, Plus, RefreshCw, Search } from 'lucide-react';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { fetchExamRecords, type ExamRecordListEntry, type ExamRecordPreset } from '../services/examRecords';
import { formatApiError } from '../services/apiError';
import { EXAM_RECORD_STATUS_LABELS } from '../shared/examRecordContracts.js';
import { addDaysToDateKey, getShanghaiDateKey } from '../utils/weeklySchedule';
import { buildWeeklyOccurrenceRows } from '../utils/weeklyOccurrenceRows';
import { groupHistoryEntries, groupScheduleEntries } from '../utils/examListGrouping';
import {
  readExamListCollapsed,
  readExamListFilters,
  writeExamListCollapsed,
  writeExamListFilters,
} from '../utils/examListFilterMemory';
import { examTimeRange } from '../utils/examRecordTimeLabel';
import type { WeeklyPlan } from '../types/exam';
import ExamRecordDetailDrawer from './ExamRecordDetailDrawer';
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
  const [viewMode, setViewMode] = useState<'exam' | 'class'>(rememberedFilters?.viewMode ?? 'exam');
  const [expandedClassId, setExpandedClassId] = useState('');
  const [weeklyExpanded, setWeeklyExpanded] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchExamRecords({
        page,
        pageSize,
        preset,
        includeArchived: preset === 'history' && showArchived,
        q: query.trim() || undefined,
        gradeId: gradeId || undefined,
        classIds: gradeId ? classes.filter((item) => item.gradeId === gradeId).map((item) => item.id) : undefined,
        source: source || undefined,
        createdBy: createdBy.trim() || undefined,
      });
      setRecords(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (caught) {
      setRecords([]);
      setTotal(0);
      setTotalPages(0);
      setError(formatApiError(caught, '考试列表读取失败'));
    } finally {
      setLoading(false);
    }
  }, [classes, createdBy, gradeId, page, pageSize, preset, query, showArchived, source]);

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
  ]);

  // 考试安排的草稿区：默认折叠，展开时单独拉一次，草稿不参与主列表分页。
  useEffect(() => {
    if (preset !== 'schedule' || !draftsOpen) return;
    let active = true;
    setDraftsLoading(true);
    void fetchExamRecords({
      page: 1,
      pageSize: 50,
      preset: 'draft',
      q: query.trim() || undefined,
      gradeId: gradeId || undefined,
      classIds: gradeId ? classes.filter((item) => item.gradeId === gradeId).map((item) => item.id) : undefined,
      source: source || undefined,
      createdBy: createdBy.trim() || undefined,
    })
      .then((result) => {
        if (active) setDrafts(result.data);
      })
      .catch(() => {
        if (active) setDrafts([]);
      })
      .finally(() => {
        if (active) setDraftsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [classes, createdBy, draftsOpen, gradeId, preset, query, refreshKey, source]);

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
          <button
            className="admin-btn admin-btn--ghost exam-records-panel__refresh"
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
            aria-label="刷新考试列表"
            title="刷新考试列表"
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
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
              onChange={(value) => setViewMode(value as 'exam' | 'class')}
              options={[
                { value: 'exam', label: '按考试' },
                { value: 'class', label: '按班级' },
              ]}
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
          className={`exam-records-table-wrap${loading ? ' is-refreshing' : ''}${
            density === 'compact' ? ' is-compact' : ''
          }`}
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
                        <ChevronRight size={14} aria-hidden="true" className={row.collapsed ? undefined : 'is-open'} />
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

      {preset === 'schedule' && (
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
                        className="admin-btn admin-btn--ghost"
                        type="button"
                        onClick={() => onEditRecord(record)}
                        title="在编辑器里继续填这场草稿"
                      >
                        编辑
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
        />
      )}
    </main>
  );
}
