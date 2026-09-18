import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, Plus, RefreshCw, Search } from 'lucide-react';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { fetchExamRecords, type ExamRecordListEntry, type ExamRecordPreset } from '../services/examRecords';
import { formatApiError } from '../services/apiError';
import { EXAM_RECORD_STATUS_LABELS } from '../shared/examRecordContracts.js';
import { addDaysToDateKey, getShanghaiDateKey } from '../utils/weeklySchedule';
import { buildWeeklyOccurrenceRows } from '../utils/weeklyOccurrenceRows';
import { groupHistoryEntries, groupScheduleEntries } from '../utils/examListGrouping';
import { readExamListFilters, writeExamListFilters } from '../utils/examListFilterMemory';
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
  const classNames = record.targetClassIds.map((id) => classes.find((item) => item.id === id)?.name ?? id).slice(0, 2);
  const labels = [...gradeNames, ...classNames];
  return `${labels.join('、')}${record.targetGradeIds.length + record.targetClassIds.length > labels.length ? ' 等' : ''}`;
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
  const [pageSize] = useState(12);
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
    writeExamListFilters(preset, { query, gradeId, source, createdBy, showArchived, draftsOpen, createOpen });
  }, [preset, query, gradeId, source, createdBy, showArchived, draftsOpen, createOpen]);

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
  const detailRecord = detailId ? (records.find((item) => item.id === detailId) ?? null) : null;
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

  // 分组表头与记录行拍平成一条渲染流：安排页是 今天/明天/本周内/更晚，历史页是自然月。
  const rowItems = useMemo(() => {
    type Row =
      { kind: 'group'; key: string; label: string } | { kind: 'record'; key: string; record: ExamRecordListEntry };
    const rows: Row[] = [];
    if (preset === 'schedule') {
      for (const group of groupScheduleEntries(records, Date.now())) {
        rows.push({ kind: 'group', key: `g-${group.key}`, label: group.label });
        for (const record of group.items) rows.push({ kind: 'record', key: record.id, record });
      }
      return rows;
    }
    if (preset === 'history') {
      for (const group of groupHistoryEntries(records)) {
        rows.push({ kind: 'group', key: `g-${group.key}`, label: group.label });
        for (const record of group.items) rows.push({ kind: 'record', key: record.id, record });
      }
      return rows;
    }
    return records.map((record) => ({ kind: 'record' as const, key: record.id, record }));
  }, [preset, records]);

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
        {record.startAt ? `${formatTime(record.startAt)} - ${formatTime(record.endAt)}` : '时间待定'}
      </span>
      <span className="exam-records-count" role="cell">
        {record.itemCount} 科 · {record.source === 'quick' ? '快速' : '正式'}
      </span>
      <span className="exam-records-creator" role="cell">
        {record.createdBy == null ? '系统' : `#${record.createdBy}`}
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
            className="set-input"
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
        <label>
          <span>来源</span>
          <InlineSelect
            className="set-input"
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
      {loading ? (
        <div className="exam-records-feedback">正在读取考试记录…</div>
      ) : records.length === 0 ? (
        <div className="exam-records-empty">
          <ClipboardList size={30} aria-hidden="true" />
          <strong>{copy.empty}</strong>
          <span>可以调整筛选条件，或用右上角「创建考试」新建一场。</span>
        </div>
      ) : (
        <section className="exam-records-table-wrap" aria-label="考试记录">
          <div className="exam-records-table" role="table">
            <div className="exam-records-table__row is-head" role="row">
              <span role="columnheader">考试</span>
              <span role="columnheader">状态</span>
              <span role="columnheader">适用范围</span>
              <span role="columnheader">时间</span>
              <span role="columnheader">科目</span>
              <span role="columnheader">创建人</span>
              <span role="columnheader">操作</span>
            </div>
            {rowItems.map((row) =>
              row.kind === 'group' ? (
                <div className="exam-records-table__group" role="row" key={row.key}>
                  {row.label}
                </div>
              ) : (
                renderRecordRow(row.record)
              ),
            )}
          </div>
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
            <ul className="exam-records-weekly__list">
              {weeklyRows.map((row) => (
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
                  </li>
                ))}
              </ul>
            ))}
        </section>
      )}

      <footer className="exam-records-pagination">
        <span>共 {total} 场</span>
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
