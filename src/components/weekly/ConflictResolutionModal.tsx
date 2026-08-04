import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import type { WeeklyConflictPolicy } from "../../types/exam";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import { fmtDT, SCOPE_LABEL, type PreviewOcc } from "./weeklyShared";

interface ConflictResolutionModalProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  conflictTarget: PreviewOcc | null;
  setConflictTarget: (value: PreviewOcc | null) => void;
  majorName: string;
  weeklyConflictPolicy: WeeklyConflictPolicy;
  forceRunOccurrence: () => void;
  keepSuppressed: () => void;
}

export default function ConflictResolutionModal({
  backdropProps,
  conflictTarget,
  setConflictTarget,
  majorName,
  weeklyConflictPolicy,
  forceRunOccurrence,
  keepSuppressed,
}: ConflictResolutionModalProps) {
  if (!conflictTarget) return null;

  return (
    <AdminModalPortal
      className="admin-modal-overlay"
      {...backdropProps(() => setConflictTarget(null))}
    >
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title">处理冲突</h2>
        <p className="admin-modal__body">
          「{conflictTarget.name}」与大型考试「
          {conflictTarget.conflict?.majorName ?? majorName}
          」冲突，已按策略暂停本次（{conflictTarget.date}）。
        </p>
        <p className="admin-major-card__hint">
          大型考试：
          {conflictTarget.conflict
            ? `${fmtDT(conflictTarget.conflict.majorStartTime)} – ${fmtDT(conflictTarget.conflict.majorEndTime)}`
            : "—"}
        </p>
        <p className="admin-major-card__hint">
          本次周测：{conflictTarget.date} {conflictTarget.startTime}–
          {conflictTarget.endTime}
        </p>
        <p className="admin-major-card__hint">
          暂停范围：{SCOPE_LABEL[weeklyConflictPolicy.scope]}
        </p>
        <div className="admin-modal__actions">
          <button
            className="admin-btn admin-btn--primary"
            onClick={forceRunOccurrence}
          >
            本周仍然进行
          </button>
          <button className="admin-btn" onClick={keepSuppressed}>
            保持暂停
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
