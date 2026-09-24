import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronRight, ClipboardList } from 'lucide-react';
import { formatClockHm } from '../../utils/examCenterStatus';
import { getShanghaiDateKey } from '../../utils/weeklySchedule';
import {
  SCHEDULE_ROW_KIND_LABELS,
  SCHEDULE_ROW_STATUS_LABELS,
  type ScheduleConflict,
  type ScheduleGroup,
  type ScheduleRow,
  type ScheduleBoardStats,
} from '../../utils/scheduleTimeline';
import '../../styles/exam-schedule.css';

export type ScheduleSubjectRow = { id: string; name: string; startAt: number; endAt: number };

export type ScheduleBoardProps = {
  groups: ScheduleGroup[];
  conflicts: ScheduleConflict[];
  stats: ScheduleBoardStats;
  /** 展开某场考试时显示的科目清单（按记录 id 取）。 */
  subjectsByRecordId: Record<string, ScheduleSubjectRow[]>;
  windowLabel: string;
  loading: boolean;
  error: string;
  compact: boolean;
  can: (permission: string) => boolean;
  onOpenDetail: (recordId: string) => void;
  onEditRecord?: (recordId: string) => void;
  onOpenWeeklyPlan?: () => void;
  onDeleteDraft?: (recordId: string) => void;
};

/** 时间列：同一天只写钟点，跨天补一个「次日」。 */
function timeLabelOf(row: ScheduleRow): string {
  if (row.startAt == null || row.endAt == null) return '时间待定';
  const start = formatClockHm(row.startAt);
  const end = formatClockHm(row.endAt);
  const crossDay = getShanghaiDateKey(row.startAt) !== getShanghaiDateKey(row.endAt);
  return crossDay ? `${start} – 次日 ${end}` : `${start}–${end}`;
}

function rowHasConflict(row: ScheduleRow): boolean {
  return row.conflictKeys.length > 0;
}

function ScheduleRowView({
  row,
  subjects,
  can,
  onOpenDetail,
  onEditRecord,
  onOpenWeeklyPlan,
  onDeleteDraft,
}: {
  row: ScheduleRow;
  subjects: ScheduleSubjectRow[];
  can: (permission: string) => boolean;
  onOpenDetail: (recordId: string) => void;
  onEditRecord?: (recordId: string) => void;
  onOpenWeeklyPlan?: () => void;
  onDeleteDraft?: (recordId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const canExpand = row.kind === 'major' || row.kind === 'quick' || row.kind === 'draft';
  // 大型考试按天合并成一行：展开区只列「这一天的」科目，跨天考试的另一天各自展开。
  const daySubjects = useMemo(() => {
    if (row.startAt == null) return subjects;
    const dayKey = getShanghaiDateKey(row.startAt);
    const sameDay = subjects.filter((item) => getShanghaiDateKey(item.startAt) === dayKey);
    return sameDay.length ? sameDay : subjects;
  }, [row.startAt, subjects]);
  return (
    <li className={`exam-schedule__item is-${row.status}${rowHasConflict(row) ? ' has-conflict' : ''}`}>
      <button
        type="button"
        className="exam-schedule__row"
        aria-expanded={canExpand ? open : undefined}
        onClick={() => canExpand && setOpen((value) => !value)}
      >
        <span className="exam-schedule__time">
          <CalendarClock size={14} aria-hidden="true" />
          {timeLabelOf(row)}
        </span>
        <span className="exam-schedule__main">
          <strong title={row.title}>{row.title}</strong>
          {row.kind === 'weekly' && <span className="exam-schedule__subject">{row.subject}</span>}
          <span className="exam-schedule__kind">{SCHEDULE_ROW_KIND_LABELS[row.kind]}</span>
          {row.daySubjectCount > 1 && <span className="exam-schedule__subjects-count">{row.daySubjectCount} 科</span>}
          {rowHasConflict(row) && (
            <span className="exam-schedule__conflict-flag">
              <AlertTriangle size={12} aria-hidden="true" />
              时间重叠
            </span>
          )}
          {row.status === 'suppressed' && <span className="exam-schedule__suppressed-flag">当天不考</span>}
        </span>
        <span className="exam-schedule__scope">{row.scopeLabel}</span>
        <span className={`exam-schedule__status is-${row.status}`}>{SCHEDULE_ROW_STATUS_LABELS[row.status]}</span>
        {canExpand && (
          <ChevronRight size={14} aria-hidden="true" className={`exam-schedule__chevron${open ? ' is-open' : ''}`} />
        )}
      </button>
      {open && (
        <div className="exam-schedule__detail">
          {daySubjects.length === 0 ? (
            <p className="exam-schedule__detail-empty">
              {row.kind === 'draft' ? '这场考试还没有科目与时间，进编辑器补全后才能发布。' : '没有启用中的科目。'}
            </p>
          ) : (
            <ul className="exam-schedule__subjects">
              {daySubjects.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <em>
                    {formatClockHm(item.startAt)}–{formatClockHm(item.endAt)}
                  </em>
                </li>
              ))}
            </ul>
          )}
          <div className="exam-schedule__actions">
            {row.recordId && (
              <button
                className="admin-btn admin-btn--ghost admin-btn--sm"
                type="button"
                onClick={() => onOpenDetail(row.recordId as string)}
              >
                详情
              </button>
            )}
            {row.kind === 'weekly' && onOpenWeeklyPlan && (
              <button className="admin-btn admin-btn--ghost admin-btn--sm" type="button" onClick={onOpenWeeklyPlan}>
                去周测计划
              </button>
            )}
            {row.recordId && onEditRecord && can('major.edit') && row.kind !== 'weekly' && (
              <button
                className="admin-btn admin-btn--ghost admin-btn--sm"
                type="button"
                onClick={() => onEditRecord(row.recordId as string)}
              >
                编辑
              </button>
            )}
            {row.kind === 'draft' && row.recordId && onDeleteDraft && can('major.delete') && (
              <button
                className="admin-btn admin-btn--danger admin-btn--sm"
                type="button"
                onClick={() => onDeleteDraft(row.recordId as string)}
              >
                删除草稿
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export default function ScheduleBoard({
  groups,
  conflicts,
  stats,
  subjectsByRecordId,
  windowLabel,
  loading,
  error,
  compact,
  can,
  onOpenDetail,
  onEditRecord,
  onOpenWeeklyPlan,
  onDeleteDraft,
}: ScheduleBoardProps) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const visibleConflicts = useMemo(() => conflicts.slice(0, 3), [conflicts]);
  const toggle = (key: string) =>
    setCollapsed((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  if (error) return <div className="exam-schedule__banner is-error">{error}</div>;
  // 首屏用骨架行占位（与真实行同高），刷新时不再整块替换——元素只会在原地更新，不会消失再出现。
  if (loading && groups.length === 0) {
    return (
      <section className="exam-schedule is-loading" aria-busy="true" aria-label="考试安排时间轴">
        <div className="exam-schedule__stats">
          <span className="is-placeholder">读取中…</span>
        </div>
        <div className="exam-schedule__days">
          <section className="exam-schedule__day">
            <div className="exam-schedule__day-head is-skeleton">
              <span className="exam-schedule__skeleton-line" style={{ width: 72 }} />
              <span className="exam-schedule__skeleton-line" style={{ width: 40 }} />
            </div>
            <ul className="exam-schedule__list">
              {[0, 1, 2].map((index) => (
                <li className="exam-schedule__item" key={index}>
                  <div className="exam-schedule__row is-skeleton">
                    <span className="exam-schedule__skeleton-line" style={{ width: 96 }} />
                    <span className="exam-schedule__skeleton-line" style={{ width: 180 }} />
                    <span className="exam-schedule__skeleton-line" style={{ width: 64 }} />
                    <span className="exam-schedule__skeleton-line" style={{ width: 56 }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    );
  }
  if (groups.length === 0)
    return (
      <div className="exam-schedule__empty">
        <ClipboardList size={30} aria-hidden="true" />
        <strong>{windowLabel}没有考试安排</strong>
        <span>换个时间窗看看，或用右上角「创建考试」新建一场。</span>
      </div>
    );

  return (
    <section className={`exam-schedule${compact ? ' is-compact' : ''}`} aria-label="考试安排时间轴">
      {conflicts.length > 0 && (
        <div className="exam-schedule__conflict-banner" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>
              {windowLabel}有 {conflicts.length} 组时间冲突
            </strong>
            <ul>
              {visibleConflicts.map((conflict) => (
                <li key={conflict.key}>
                  {conflict.dateKey.slice(5)} · {conflict.scopeLabel} · 重叠{' '}
                  {Math.max(1, Math.round(conflict.overlapMs / 60_000))} 分钟
                </li>
              ))}
              {conflicts.length > visibleConflicts.length && (
                <li>还有 {conflicts.length - visibleConflicts.length} 组…</li>
              )}
            </ul>
          </div>
        </div>
      )}

      <div className="exam-schedule__stats">
        <span>共 {stats.total} 场</span>
        {stats.todayCount > 0 && <span>今天 {stats.todayCount} 场</span>}
        {stats.conflicted > 0 && <span className="is-warn">{stats.conflicted} 场时间重叠</span>}
        {stats.suppressedWeekly > 0 && <span>{stats.suppressedWeekly} 场周测被暂停</span>}
        {stats.unscheduled > 0 && <span>{stats.unscheduled} 场待排期</span>}
      </div>

      <div className="exam-schedule__days">
        {groups.map((group) => {
          const isCollapsed = collapsed.includes(group.key);
          return (
            <section className="exam-schedule__day" key={group.key} id={`schedule-day-${group.key}`}>
              <button
                type="button"
                className="exam-schedule__day-head"
                aria-expanded={!isCollapsed}
                onClick={() => toggle(group.key)}
              >
                <ChevronRight size={14} aria-hidden="true" className={isCollapsed ? undefined : 'is-open'} />
                <strong>{group.label}</strong>
                {group.dateKey && group.label !== '今天' && group.label !== '明天' && (
                  <span className="exam-schedule__day-date">{group.dateKey.slice(5).replace('-', '/')}</span>
                )}
                <em>{group.rows.length} 场</em>
                {group.conflictCount > 0 && (
                  <span className="exam-schedule__day-conflict">{group.conflictCount} 组冲突</span>
                )}
              </button>
              {!isCollapsed && (
                <ul className="exam-schedule__list">
                  {/* 未排期分组里再分「草稿（未发布）」与「已发布·待排期」两段，避免两种语义混排。 */}
                  {group.subgroups?.length
                    ? group.subgroups.flatMap((subgroup) => [
                        <li className="exam-schedule__subgroup" key={`sub-${subgroup.key}`}>
                          {subgroup.label}
                          <em>{subgroup.rows.length}</em>
                        </li>,
                        ...subgroup.rows.map((row) => (
                          <ScheduleRowView
                            key={row.key}
                            row={row}
                            subjects={row.recordId ? (subjectsByRecordId[row.recordId] ?? []) : []}
                            can={can}
                            onOpenDetail={onOpenDetail}
                            onEditRecord={onEditRecord}
                            onOpenWeeklyPlan={onOpenWeeklyPlan}
                            onDeleteDraft={onDeleteDraft}
                          />
                        )),
                      ])
                    : group.rows.map((row) => (
                        <ScheduleRowView
                          key={row.key}
                          row={row}
                          subjects={row.recordId ? (subjectsByRecordId[row.recordId] ?? []) : []}
                          can={can}
                          onOpenDetail={onOpenDetail}
                          onEditRecord={onEditRecord}
                          onOpenWeeklyPlan={onOpenWeeklyPlan}
                          onDeleteDraft={onDeleteDraft}
                        />
                      ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
