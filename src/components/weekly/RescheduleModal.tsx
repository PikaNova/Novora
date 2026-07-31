import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import { DateTimeField } from "../touch-datetime-picker";
import TimeRangePickerModal from "../TimeRangePickerModal";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import { useWeeklyExceptions } from "../../hooks/weekly/useWeeklyExceptions";
import type { PreviewOcc } from "./weeklyShared";

type ExceptionsState = ReturnType<typeof useWeeklyExceptions<PreviewOcc>>;

interface RescheduleModalProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  rescheduleTarget: ExceptionsState["rescheduleTarget"];
  setRescheduleTarget: ExceptionsState["setRescheduleTarget"];
  rescheduleError: string;
  setRescheduleError: (value: string) => void;
  rescheduleTimeOpen: boolean;
  setRescheduleTimeOpen: (value: boolean) => void;
  commitReschedule: () => void;
}

export default function RescheduleModal({
  backdropProps,
  rescheduleTarget,
  setRescheduleTarget,
  rescheduleError,
  setRescheduleError,
  rescheduleTimeOpen,
  setRescheduleTimeOpen,
  commitReschedule,
}: RescheduleModalProps) {
  if (!rescheduleTarget) return null;

  return (
    <>
      <AdminModalPortal
        className="admin-modal-overlay"
        {...backdropProps(() => setRescheduleTarget(null))}
      >
        <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
          <h2 className="admin-modal__title">临时调课（仅此一次）</h2>
          {rescheduleError && (
            <div className="admin-error">{rescheduleError}</div>
          )}
          <div className="admin-form">
            <label className="admin-label">
              名称
              <input
                className="admin-input"
                value={rescheduleTarget.name}
                onChange={(e) =>
                  setRescheduleTarget(
                    (p) => p && { ...p, name: e.target.value },
                  )
                }
              />
            </label>
            <label className="admin-label">
              调整至日期
              <DateTimeField
                className="admin-date-time-field"
                value={rescheduleTarget.date}
                onChange={(value) => setRescheduleTarget((p) => p && { ...p, date: value })}
                mode="date"
                title="选择调整日期"
                showFieldPreview={false}
              />
            </label>
            <div className="admin-major-endtime">
              <span>时间设置</span>
              <button type="button" className="admin-major-endtime__trigger" onClick={() => setRescheduleTimeOpen(true)}>
                <strong>{rescheduleTarget.startTime} - {rescheduleTarget.endTime}</strong>
                <small>一次设置本次调课的开始与结束时间</small>
              </button>
            </div>
            <p className="admin-major-card__hint">
              仅调整这一次实例，不影响周期规则本身。
            </p>
            <div className="admin-form-actions">
              <button
                className="admin-btn admin-btn--primary"
                onClick={commitReschedule}
              >
                确认并保存
              </button>
              <button
                className="admin-btn admin-btn--ghost"
                onClick={() => {
                  setRescheduleTarget(null);
                  setRescheduleError("");
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </AdminModalPortal>
      <TimeRangePickerModal
        open={rescheduleTimeOpen}
        startValue={rescheduleTarget.startTime}
        endValue={rescheduleTarget.endTime}
        subject={rescheduleTarget.name || "临时调课"}
        contextLabel={rescheduleTarget.date}
        allowCrossDay={false}
        onPreviewChange={(startTime, endTime) => {
          setRescheduleTarget((value) => value ? { ...value, startTime, endTime } : value);
        }}
        onPreviewCancel={(startTime, endTime) => {
          setRescheduleTarget((value) => value ? { ...value, startTime, endTime } : value);
        }}
        onCancel={() => setRescheduleTimeOpen(false)}
        onConfirm={(startTime, endTime) => {
          setRescheduleTarget((value) => value ? { ...value, startTime, endTime } : value);
          setRescheduleTimeOpen(false);
        }}
      />
    </>
  );
}
