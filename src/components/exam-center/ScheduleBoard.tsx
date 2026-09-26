import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronRight, ClipboardList, Info } from 'lucide-react';
import AdminModalPortal from '../AdminModalPortal';
import { DateTimeField } from '../touch-datetime-picker';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
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
  canEditRecord?: (recordId: string) => boolean;
  onOpenWeeklyPlan?: () => void;
  onDeleteDraft?: (recordId: string) => void;
  /** 行内复制：由上层调用考试动作（复制出新草稿），面板不自己发请求。 */
  onCopyRecord?: (recordId: string) => void;
  /** 取数被截断时的提示（「全部」档只取回前若干场，或两周内超过一页上限）。 */
  truncated?: { shown: number; total: number } | null;
  /** 提示里的「缩小时间窗」：由面板切到更小的窗口。 */
  onNarrowWindow?: () => void;
  /** 周测行内动作：取消本次 / 改时间 / 冲突仍然进行（写进计划的 overrides）。 */
  onCancelWeeklyOccurrence?: (row: ScheduleRow) => void;
  onRescheduleWeeklyOccurrence?: (
    row: ScheduleRow,
    next: { startClock: string; endClock: string; targetDate: string },
  ) => void;
  onForceWeeklyOccurrence?: (row: ScheduleRow) => void;
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
  canEditRecord,
  onOpenWeeklyPlan,
  onDeleteDraft,
  onCopyRecord,
  onCancelWeeklyOccurrence,
  onForceWeeklyOccurrence,
  onRequestReschedule,
}: {
  row: ScheduleRow;
  subjects: ScheduleSubjectRow[];
  can: (permission: string) => boolean;
  onOpenDetail: (recordId: string) => void;
  onEditRecord?: (recordId: string) => void;
  canEditRecord?: (recordId: string) => boolean;
  onOpenWeeklyPlan?: () => void;
  onDeleteDraft?: (recordId: string) => void;
  onCopyRecord?: (recordId: string) => void;
  onCancelWeeklyOccurrence?: (row: ScheduleRow) => void;
  onForceWeeklyOccurrence?: (row: ScheduleRow) => void;
  onRequestReschedule: (row: ScheduleRow) => void;
}) {
  const [open, setOpen] = useState(false);
  // 所有行都可展开：周测行的「取消本次 / 改时间 / 仍然进行 / 去周测计划」就在展开区里，
  // 早先只允许大型/快速/草稿展开，等于周测行完全没有入口。
  const canExpand = true;
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
          {/* 草稿行的「类型」和「状态」都是「草稿」，只留右边那个状态徽标，免得同一行并排两个草稿。 */}
          {row.kind !== 'draft' && <span className="exam-schedule__kind">{SCHEDULE_ROW_KIND_LABELS[row.kind]}</span>}
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
              {row.kind === 'weekly'
                ? '周测由周期规则生成：这里的动作只影响这一次，周期本身在「周测计划」里改。'
                : row.kind === 'draft'
                  ? '这场考试还没有科目与时间，进编辑器补全后才能发布。'
                  : '没有启用中的科目。'}
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
            {/* 周测行内动作：学校最常做的就是"这天不考了"或"临时调课"。 */}
            {row.kind === 'weekly' &&
              row.weekly &&
              onCancelWeeklyOccurrence &&
              can('weekly.edit') &&
              row.status !== 'suppressed' && (
                <button
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  type="button"
                  onClick={() => onCancelWeeklyOccurrence(row)}
                >
                  取消本次
                </button>
              )}
            {row.kind === 'weekly' && row.weekly && can('weekly.edit') && row.status !== 'suppressed' && (
              <button
                className="admin-btn admin-btn--ghost admin-btn--sm"
                type="button"
                onClick={() => onRequestReschedule(row)}
              >
                改时间
              </button>
            )}
            {row.kind === 'weekly' &&
              row.weekly &&
              onForceWeeklyOccurrence &&
              can('weekly.edit') &&
              row.status === 'suppressed' && (
                <button
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  type="button"
                  onClick={() => onForceWeeklyOccurrence(row)}
                  title="大型考试当天照常进行这次周测"
                >
                  仍然进行
                </button>
              )}
            {row.recordId && onEditRecord && row.kind !== 'weekly' && canEditRecord?.(row.recordId) !== false && (
              <button
                className="admin-btn admin-btn--ghost admin-btn--sm"
                type="button"
                onClick={() => onEditRecord(row.recordId as string)}
              >
                编辑
              </button>
            )}
            {row.recordId && onCopyRecord && can('major.create') && row.kind !== 'draft' && row.kind !== 'weekly' && (
              <button
                className="admin-btn admin-btn--ghost admin-btn--sm"
                type="button"
                onClick={() => onCopyRecord(row.recordId as string)}
              >
                复制
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
  canEditRecord,
  onOpenWeeklyPlan,
  onDeleteDraft,
  onCopyRecord,
  truncated,
  onNarrowWindow,
  onCancelWeeklyOccurrence,
  onRescheduleWeeklyOccurrence,
  onForceWeeklyOccurrence,
}: ScheduleBoardProps) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [rescheduleRow, setRescheduleRow] = useState<ScheduleRow | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({ targetDate: '', startClock: '', endClock: '' });
  const [rescheduleError, setRescheduleError] = useState('');
  const backdropProps = useBackdropDismiss();
  const visibleConflicts = useMemo(() => conflicts.slice(0, 3), [conflicts]);
  const toggle = (key: string) =>
    setCollapsed((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  const requestReschedule = (row: ScheduleRow) => {
    setRescheduleError('');
    setRescheduleForm({
      targetDate: row.weekly?.dateKey ?? '',
      startClock: row.weekly?.startClock ?? '',
      endClock: row.weekly?.endClock ?? '',
    });
    setRescheduleRow(row);
  };
  const submitReschedule = () => {
    if (!rescheduleRow || !onRescheduleWeeklyOccurrence) return;
    const { targetDate, startClock, endClock } = rescheduleForm;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setRescheduleError('请选择调课后的日期');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(startClock) || !/^\d{2}:\d{2}$/.test(endClock)) {
      setRescheduleError('请填写开始与结束时间');
      return;
    }
    if (endClock <= startClock) {
      setRescheduleError('结束时间要晚于开始时间');
      return;
    }
    onRescheduleWeeklyOccurrence(rescheduleRow, { targetDate, startClock, endClock });
    setRescheduleRow(null);
  };

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

      {truncated && truncated.total > truncated.shown && (
        <div className="exam-schedule__notice" role="status">
          <Info size={14} aria-hidden="true" />
          <span>
            共 {truncated.total} 场，当前只取回前 {truncated.shown} 场；缩小时间窗就能看全。
          </span>
          {onNarrowWindow && (
            <button className="admin-btn admin-btn--ghost admin-btn--sm" type="button" onClick={onNarrowWindow}>
              缩小时间窗
            </button>
          )}
        </div>
      )}

      <div className="exam-schedule__stats">
        <span>共 {stats.total} 场</span>
        {stats.todayCount > 0 && <span>今天 {stats.todayCount} 场</span>}
        {stats.conflicted > 0 && <span className="is-warn">{stats.conflicted} 场时间重叠</span>}
        {stats.suppressedWeekly > 0 && <span>{stats.suppressedWeekly} 场周测被暂停</span>}
        {stats.unscheduled > 0 && <span>{stats.unscheduled} 场未排期</span>}
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
                            canEditRecord={canEditRecord}
                            onOpenWeeklyPlan={onOpenWeeklyPlan}
                            onDeleteDraft={onDeleteDraft}
                            onCopyRecord={onCopyRecord}
                            onCancelWeeklyOccurrence={onCancelWeeklyOccurrence}
                            onForceWeeklyOccurrence={onForceWeeklyOccurrence}
                            onRequestReschedule={requestReschedule}
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
                          canEditRecord={canEditRecord}
                          onOpenWeeklyPlan={onOpenWeeklyPlan}
                          onDeleteDraft={onDeleteDraft}
                          onCopyRecord={onCopyRecord}
                          onCancelWeeklyOccurrence={onCancelWeeklyOccurrence}
                          onForceWeeklyOccurrence={onForceWeeklyOccurrence}
                          onRequestReschedule={requestReschedule}
                        />
                      ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {rescheduleRow && (
        <AdminModalPortal className="admin-modal-overlay" {...backdropProps(() => setRescheduleRow(null))}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <h2 className="admin-modal__title">临时调整这次周测</h2>
            <p className="admin-modal__body">
              「{rescheduleRow.title}
              {rescheduleRow.subject ? ` · ${rescheduleRow.subject}` : ''}」原本在 {rescheduleRow.weekly?.dateKey}{' '}
              {rescheduleRow.weekly?.startClock}–{rescheduleRow.weekly?.endClock}
              ；这里只改这一次，周期规则不动。
            </p>
            <label className="weekly-field">
              <span>日期</span>
              <DateTimeField
                className="admin-date-time-field"
                value={rescheduleForm.targetDate}
                onChange={(value) => setRescheduleForm((form) => ({ ...form, targetDate: value }))}
                mode="date"
                title="选择调整后的日期"
                showFieldPreview={false}
              />
            </label>
            <div className="exam-schedule__time-fields">
              <label className="weekly-field">
                <span>开始</span>
                <DateTimeField
                  className="admin-date-time-field"
                  value={rescheduleForm.startClock}
                  onChange={(value) => setRescheduleForm((form) => ({ ...form, startClock: value }))}
                  mode="time"
                  title="选择开始时间"
                  showFieldPreview={false}
                />
              </label>
              <label className="weekly-field">
                <span>结束</span>
                <DateTimeField
                  className="admin-date-time-field"
                  value={rescheduleForm.endClock}
                  onChange={(value) => setRescheduleForm((form) => ({ ...form, endClock: value }))}
                  mode="time"
                  title="选择结束时间"
                  showFieldPreview={false}
                />
              </label>
            </div>
            {rescheduleError && <p className="admin-error">{rescheduleError}</p>}
            <div className="admin-modal__actions">
              <button className="admin-btn" type="button" onClick={() => setRescheduleRow(null)}>
                取消
              </button>
              <button className="admin-btn admin-btn--primary" type="button" onClick={submitReschedule}>
                保存这次调整
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
    </section>
  );
}
