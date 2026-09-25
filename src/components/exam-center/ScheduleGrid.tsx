import { useState, type CSSProperties } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatClockHm } from '../../utils/examCenterStatus';
import { SCHEDULE_ROW_KIND_LABELS, type ScheduleClassGridRow, type ScheduleRow } from '../../utils/scheduleTimeline';
import '../../styles/exam-schedule.css';

export type ScheduleGridProps = {
  grid: ScheduleClassGridRow[];
  /** 列头文案：'今天' / '明天' / '周一 9/29'，与时间窗一致。 */
  dayLabels: string[];
  days: string[];
  loading: boolean;
  error: string;
  onOpenDetail: (recordId: string) => void;
  onOpenWeeklyPlan?: () => void;
};

function CellChip({ row, onClick }: { row: ScheduleRow; onClick: () => void }) {
  const conflicted = row.conflictKeys.length > 0;
  return (
    <button
      type="button"
      className={`exam-grid__chip is-${row.status}${conflicted ? ' has-conflict' : ''}`}
      onClick={onClick}
      title={`${row.title}${row.subject ? ` · ${row.subject}` : ''}`}
    >
      <span className="exam-grid__chip-time">{row.startAt ? formatClockHm(row.startAt) : '待定'}</span>
      <span className="exam-grid__chip-title">{row.subject || row.title}</span>
      {conflicted && <AlertTriangle size={11} aria-hidden="true" />}
    </button>
  );
}

/**
 * 班级 × 日期网格：回答「哪个班在哪天有考试、有没有撞车」。
 * 与日程轴共用同一批行，所以筛选、冲突判定、周测抑制口径完全一致。
 */
export default function ScheduleGrid({
  grid,
  dayLabels,
  days,
  loading,
  error,
  onOpenDetail,
  onOpenWeeklyPlan,
}: ScheduleGridProps) {
  const [expanded, setExpanded] = useState('');

  if (error) return <div className="exam-schedule__banner is-error">{error}</div>;
  if (loading && grid.length === 0) {
    return (
      <div className="exam-grid is-loading" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <div className="exam-grid__row is-skeleton" key={index}>
            <span className="exam-schedule__skeleton-line" style={{ width: 72 }} />
            {days.map((day) => (
              <span className="exam-schedule__skeleton-line" key={day} style={{ width: 56 }} />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (grid.length === 0) {
    return (
      <div className="exam-schedule__empty">
        <strong>这个时间窗内没有影响到班级的考试</strong>
        <span>换个时间窗，或先在「日程」视图里看看整体安排。</span>
      </div>
    );
  }

  const open = (row: ScheduleRow) => {
    if (row.recordId) onOpenDetail(row.recordId);
    else onOpenWeeklyPlan?.();
  };

  return (
    <div
      className="exam-grid"
      role="table"
      aria-label="按班级的考试网格"
      style={{ '--exam-grid-days': days.length } as CSSProperties}
    >
      <div className="exam-grid__row is-head" role="row">
        <span className="exam-grid__class-head" role="columnheader">
          班级
        </span>
        {days.map((day, index) => (
          <span className="exam-grid__day-head" role="columnheader" key={day}>
            {dayLabels[index] ?? day.slice(5)}
          </span>
        ))}
      </div>
      {grid.map((row) => (
        <div className="exam-grid__group" key={row.classId}>
          <div className="exam-grid__row" role="row">
            <button
              type="button"
              className="exam-grid__class"
              aria-expanded={expanded === row.classId}
              onClick={() => setExpanded((current) => (current === row.classId ? '' : row.classId))}
            >
              <strong>{row.className}</strong>
              <em>{row.gradeName}</em>
              <span>{row.total} 场</span>
            </button>
            {row.cells.map((cell) => (
              <div className="exam-grid__cell" role="cell" key={cell.dateKey}>
                {cell.rows.slice(0, 2).map((item) => (
                  <CellChip key={item.key} row={item} onClick={() => open(item)} />
                ))}
                {cell.rows.length > 2 && (
                  <button
                    type="button"
                    className="exam-grid__more"
                    onClick={() => setExpanded((current) => (current === row.classId ? '' : row.classId))}
                  >
                    +{cell.rows.length - 2}
                  </button>
                )}
              </div>
            ))}
          </div>
          {expanded === row.classId && (
            <ul className="exam-grid__detail">
              {row.cells.flatMap((cell) =>
                cell.rows.map((item) => (
                  <li key={`${row.classId}-${item.key}`}>
                    <span className="exam-grid__detail-day">{cell.dateKey.slice(5).replace('-', '/')}</span>
                    <span className="exam-grid__detail-time">
                      {item.startAt ? formatClockHm(item.startAt) : '待定'}
                      {item.endAt ? `–${formatClockHm(item.endAt)}` : ''}
                    </span>
                    <strong>{item.title}</strong>
                    {item.subject && <span>{item.subject}</span>}
                    <em>{SCHEDULE_ROW_KIND_LABELS[item.kind]}</em>
                    {item.conflictKeys.length > 0 && <span className="is-warn">时间重叠</span>}
                  </li>
                )),
              )}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
