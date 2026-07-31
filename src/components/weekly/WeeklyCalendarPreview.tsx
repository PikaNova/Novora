import React from "react";
import type { IsoWeekday } from "../../types/exam";
import { useWeeklyExceptions } from "../../hooks/weekly/useWeeklyExceptions";
import { WEEKDAY_LABEL, type PreviewOcc } from "./weeklyShared";

type ExceptionsState = ReturnType<typeof useWeeklyExceptions<PreviewOcc>>;

export interface WeeklyCalendarDay {
  date: string;
  weekday: IsoWeekday;
  entries: PreviewOcc[];
  officialHoliday: string | null;
  manuallyExcluded: boolean;
  weekType: "a" | "b" | null;
}

interface WeeklyCalendarPreviewProps {
  calendarWeeks: WeeklyCalendarDay[][];
  preview: PreviewOcc[];
  allowBatchApply: boolean;
  selectedClassId: string;
  setPrintClassIds: (ids: string[]) => void;
  setPrintPickerOpen: (value: boolean) => void;
  setPrintOpen: (value: boolean) => void;
  setConflictTarget: ExceptionsState["setConflictTarget"];
  openReschedule: (entry: PreviewOcc) => void;
  cancelOccurrence: (entry: PreviewOcc) => void | Promise<void>;
}

export default function WeeklyCalendarPreview({
  calendarWeeks,
  preview,
  allowBatchApply,
  selectedClassId,
  setPrintClassIds,
  setPrintPickerOpen,
  setPrintOpen,
  setConflictTarget,
  openReschedule,
  cancelOccurrence,
}: WeeklyCalendarPreviewProps) {
  return (
    <>
      <div className="admin-list-header" style={{ marginTop: 22 }}>
        <h2 className="admin-list-title">未来两周预览</h2>
        <span className="admin-list-count">{preview.length} 场</span>
        <button
          className="admin-btn"
          onClick={() => {
            if (allowBatchApply) {
              setPrintClassIds([selectedClassId]);
              setPrintPickerOpen(true);
            } else setPrintOpen(true);
          }}
        >
          A4 预览与下载 PDF
        </button>
      </div>
      <div
        className="weekly-calendar-scroll"
        tabIndex={0}
        aria-label="横向滚动查看未来两周"
      >
        <div
          className="weekly-calendar"
          role="grid"
          aria-label="未来两周周测日历"
        >
          {calendarWeeks.map((week, weekIndex) => (
            <div
              className="weekly-calendar__week"
              key={`week-${weekIndex}`}
              role="row"
              style={{ gridTemplateColumns: `repeat(${week.length}, minmax(112px, 1fr))` }}
            >
              {week.map((day) => (
                <section
                  className={`weekly-calendar__day${day.entries.length ? " has-events" : ""}${day.officialHoliday || day.manuallyExcluded ? " is-holiday" : ""}`}
                  key={day.date}
                  role="gridcell"
                >
                  <header>
                    <strong>
                      {WEEKDAY_LABEL[day.weekday]}
                      {day.weekType ? ` · ${day.weekType.toUpperCase()}周` : ""}
                    </strong>
                    <span>{day.date.slice(5)}</span>
                  </header>
                  <div className="weekly-calendar__events">
                    {(day.officialHoliday || day.manuallyExcluded) && (
                      <span className="weekly-calendar__holiday">
                        {day.officialHoliday || "已排除"}
                      </span>
                    )}
                    {day.entries.length === 0 ? (
                      <span className="weekly-calendar__empty">
                        {day.officialHoliday || day.manuallyExcluded
                          ? "周测已暂停"
                          : "无安排"}
                      </span>
                    ) : (
                      day.entries.map((entry) => (
                        <article
                          className={`weekly-calendar__event${entry.suppressed ? " is-suppressed" : ""}${entry.forced ? " is-forced" : ""}`}
                          key={`${entry.date}-${entry.weeklyItemId}`}
                        >
                          <button
                            className="weekly-calendar__event-main"
                            onClick={() =>
                              entry.suppressed
                                ? setConflictTarget(entry)
                                : openReschedule(entry)
                            }
                            title={entry.message || "点击临时调整"}
                          >
                            <b>{entry.name}</b>
                            <span>
                              {entry.startTime}–{entry.endTime}
                            </span>
                          </button>
                          <button
                            className="weekly-calendar__remove"
                            aria-label={`取消 ${entry.name}`}
                            title="取消本次"
                            onClick={() => void cancelOccurrence(entry)}
                          >
                            ×
                          </button>
                        </article>
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>
          ))}
        </div>
      </div>
      {preview.length === 0 && (
        <div className="admin-collapsed-hint">
          未来两周内暂无周测实例（可能计划已停用、不在生效期或没有启用的周测项）
        </div>
      )}
    </>
  );
}
