import { useCallback, useEffect, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, RefreshCw, Search } from 'lucide-react';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { fetchExamRecords, type ExamRecordListEntry } from '../services/examRecords';
import { formatApiError } from '../services/apiError';
import { EXAM_RECORD_STATUS_LABELS, type ExamRecordDisplayStatus } from '../shared/examRecordContracts.js';
import ExamRecordDetailDrawer from './ExamRecordDetailDrawer';
import '../styles/exam-records.css';

type RecordSource = 'regular' | 'quick';

type Props = {
  grades: SchoolGrade[];
  classes: SchoolClass[];
  /** 权限判定交给上层，动作按钮只显示当前账号真的能执行的项。 */
  can: (permission: string) => boolean;
};

const STATUS_OPTIONS: Array<{ value: '' | ExamRecordDisplayStatus; label: string }> = [
  { value: '', label: '全部状态' },
  ...(['draft', 'published', 'ongoing', 'ended', 'archived'] as ExamRecordDisplayStatus[]).map((status) => ({
    value: status,
    label: EXAM_RECORD_STATUS_LABELS[status],
  })),
];

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

export default function ExamRecordsPanel({ grades, classes, can }: Props) {
  const [records, setRecords] = useState<ExamRecordListEntry[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | ExamRecordDisplayStatus>('');
  const [gradeId, setGradeId] = useState('');
  const [source, setSource] = useState<'' | RecordSource>('');
  const [timeScope, setTimeScope] = useState<'all' | 'upcoming' | 'past'>('all');
  const [createdBy, setCreatedBy] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailId, setDetailId] = useState('');

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchExamRecords({
        page,
        pageSize,
        q: query.trim() || undefined,
        status: status || undefined,
        gradeId: gradeId || undefined,
        classIds: gradeId ? classes.filter((item) => item.gradeId === gradeId).map((item) => item.id) : undefined,
        source: source || undefined,
        time: timeScope === 'all' ? undefined : timeScope,
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
  }, [classes, createdBy, gradeId, page, pageSize, query, source, status, timeScope]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords, refreshKey]);

  /** 筛选项变化一律回到第一页；DOM 事件的值会被放宽成 string，这里集中收窄一次。 */
  const filterHandler =
    <T extends string>(setter: Dispatch<SetStateAction<T>>) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setter(event.target.value as T);
      setPage(1);
    };

  // 详情始终取列表里的最新一行：动作完成后列表刷新，抽屉里的状态与时间会跟着更新。
  const detailRecord = detailId ? (records.find((item) => item.id === detailId) ?? null) : null;

  return (
    <main className="exam-records-panel">
      <header className="exam-records-panel__header">
        <div>
          <span className="exam-records-panel__eyebrow">考试管理</span>
          <h2>全部考试</h2>
          <p>按状态、范围和时间快速定位考试记录。</p>
        </div>
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
      </header>

      <section className="exam-records-filters" aria-label="考试筛选">
        <label className="exam-records-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">搜索考试</span>
          <input value={query} onChange={filterHandler(setQuery)} placeholder="搜索名称或编号" type="search" />
        </label>
        <label>
          <span>状态</span>
          <select value={status} onChange={filterHandler(setStatus)}>
            {STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>年级</span>
          <select value={gradeId} onChange={filterHandler(setGradeId)}>
            <option value="">全部年级</option>
            {grades.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>来源</span>
          <select value={source} onChange={filterHandler(setSource)}>
            <option value="">全部来源</option>
            <option value="regular">正式考试</option>
            <option value="quick">快速考试</option>
          </select>
        </label>
        <label>
          <span>时间</span>
          <select value={timeScope} onChange={filterHandler(setTimeScope)}>
            <option value="all">全部时间</option>
            <option value="upcoming">即将开始</option>
            <option value="past">已结束</option>
          </select>
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

      {error && <div className="exam-records-feedback is-error">{error}</div>}
      {loading ? (
        <div className="exam-records-feedback">正在读取考试记录…</div>
      ) : records.length === 0 ? (
        <div className="exam-records-empty">
          <ClipboardList size={30} aria-hidden="true" />
          <strong>没有匹配的考试</strong>
          <span>调整筛选条件，或先在大型考试页面创建考试。</span>
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
            {records.map((record) => (
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
            ))}
          </div>
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
        />
      )}
    </main>
  );
}
