import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import HelpTip from "../HelpTip";
import InlineSelect from "../InlineSelect";
import { ALL_CONFLICT_SCOPES, type WeeklyConflictPolicy } from "../../types/exam";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import { SCOPE_LABEL } from "./weeklyShared";

interface ConflictPolicyModalProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  policyOpen: boolean;
  setPolicyOpen: (value: boolean) => void;
  weeklyConflictPolicy: WeeklyConflictPolicy;
  onConflictPolicyChange: (policy: WeeklyConflictPolicy, immediate?: boolean) => void;
}

export default function ConflictPolicyModal({
  backdropProps,
  policyOpen,
  setPolicyOpen,
  weeklyConflictPolicy,
  onConflictPolicyChange,
}: ConflictPolicyModalProps) {
  if (!policyOpen) return null;

  return (
    <AdminModalPortal
      className="admin-modal-overlay"
      {...backdropProps(() => setPolicyOpen(false))}
    >
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title">大型考试冲突处理</h2>
        <div className="admin-form">
          <label className="admin-toggle-label">
            <input
              type="checkbox"
              checked={weeklyConflictPolicy.enabled}
              onChange={(e) =>
                onConflictPolicyChange(
                  { ...weeklyConflictPolicy, enabled: e.target.checked },
                  true,
                )
              }
            />
            启用冲突自动处理（仅自动模式下生效）
          </label>
          <label className="admin-label">
            <span className="with-help-tip">
              暂停范围
              <HelpTip title="冲突暂停范围">
                “时间重叠”最精细；“当天”会暂停大型考试日期内的全部周测；“整个考期”会暂停从第一科开始到最后一科结束期间的周测。
              </HelpTip>
            </span>
            <InlineSelect
              className="admin-input"
              value={weeklyConflictPolicy.scope}
              onChange={(value) =>
                onConflictPolicyChange(
                  {
                    ...weeklyConflictPolicy,
                    scope: value as WeeklyConflictPolicy["scope"],
                  },
                  true,
                )
              }
              options={ALL_CONFLICT_SCOPES.map((scope) => ({
                value: scope,
                label: SCOPE_LABEL[scope],
              }))}
            />
          </label>
          {weeklyConflictPolicy.scope === "time-overlap" && (
            <>
              <label className="admin-label">
                开考前缓冲（分钟）
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  max={180}
                  value={weeklyConflictPolicy.bufferBeforeMinutes}
                  onChange={(e) =>
                    onConflictPolicyChange(
                      {
                        ...weeklyConflictPolicy,
                        bufferBeforeMinutes: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      },
                      true,
                    )
                  }
                />
              </label>
              <label className="admin-label">
                结束后缓冲（分钟）
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  max={180}
                  value={weeklyConflictPolicy.bufferAfterMinutes}
                  onChange={(e) =>
                    onConflictPolicyChange(
                      {
                        ...weeklyConflictPolicy,
                        bufferAfterMinutes: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      },
                      true,
                    )
                  }
                />
              </label>
            </>
          )}
          <div className="admin-form-actions">
            <button
              className="admin-btn admin-btn--primary"
              onClick={() => setPolicyOpen(false)}
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </AdminModalPortal>
  );
}
