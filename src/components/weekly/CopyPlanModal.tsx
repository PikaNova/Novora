import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import AdminWizardSteps, { AdminWorkflowClose } from "../AdminWizardSteps";
import InlineSelect from "../InlineSelect";
import ClassMultiPicker, { type ClassPickerOption } from "../ClassMultiPicker";
import type { WeeklyPlan } from "../../types/exam";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import { useWeeklyBatchOps } from "../../hooks/weekly/useWeeklyBatchOps";
import { weeklyPlanDetailName } from "./weeklyShared";

type BatchOpsState = ReturnType<typeof useWeeklyBatchOps>;

interface CopyPlanModalProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  allowBatchApply: boolean;
  copyModal: BatchOpsState["copyModal"];
  setCopyModal: BatchOpsState["setCopyModal"];
  copyWizardStep: number;
  setCopyWizardStep: React.Dispatch<React.SetStateAction<number>>;
  weeklyPlans: WeeklyPlan[];
  classOptions: Array<{ id: string; gradeId: string; label: string }>;
  pickerOptions: ClassPickerOption[];
  commitCopyPlan: BatchOpsState["commitCopyPlan"];
}

export default function CopyPlanModal({
  backdropProps,
  allowBatchApply,
  copyModal,
  setCopyModal,
  copyWizardStep,
  setCopyWizardStep,
  weeklyPlans,
  classOptions,
  pickerOptions,
  commitCopyPlan,
}: CopyPlanModalProps) {
  if (!allowBatchApply || !copyModal) return null;

  return (
    <AdminModalPortal
      className="admin-modal-overlay"
      {...backdropProps(() => setCopyModal(null))}
    >
      <div
        className="admin-modal admin-modal--wide admin-modal--workflow"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="admin-modal__title admin-workflow-head">批量应用周测计划</h2>
        <AdminWorkflowClose onClick={() => setCopyModal(null)} />
        <div className="admin-workflow-layout">
          <AdminWizardSteps active={copyWizardStep} steps={[{ label: "选择计划", hint: "确定源计划和标题" }, { label: "应用班级", hint: "批量选择目标班级" }]} summary={<><span>源计划</span><strong>{weeklyPlans.find((plan) => plan.id === copyModal.sourcePlanId)?.name || "未选择"}</strong><span>{copyModal.targetClassIds.length} 个目标班级</span></>} />
          <div className="admin-workflow-content" key={copyWizardStep}>
          {copyWizardStep === 0 && <div className="admin-workflow-pane"><label className="admin-label">
          源计划
          <InlineSelect
            className="admin-input"
            value={copyModal.sourcePlanId}
            onChange={(value) => {
              const source = weeklyPlans.find((plan) => plan.id === value);
              setCopyModal(
                (current) =>
                  current && {
                    ...current,
                    sourcePlanId: value,
                    name:
                      source?.name.replace(/（复制）$/u, "") ||
                      current.name,
                  },
              );
            }}
            options={[...weeklyPlans]
              .sort((a, b) => {
                const ac =
                  classOptions.find((item) => item.id === a.classId)
                    ?.label || "";
                const bc =
                  classOptions.find((item) => item.id === b.classId)
                    ?.label || "";
                return (
                  ac.localeCompare(bc, "zh-CN") ||
                  a.name.localeCompare(b.name, "zh-CN")
                );
              })
              .map((plan) => {
                const target = classOptions.find(
                  (item) => item.id === plan.classId,
                );
                const [gradeName = "未知年级", className = "未知班级"] =
                  target?.label.split(" · ") ?? [];
                const detail = weeklyPlanDetailName(
                  plan.name,
                  gradeName,
                  className,
                );
                return {
                  value: plan.id,
                  label: `${gradeName} · ${className} · ${detail}`,
                };
              })}
          />
        </label>
        <label className="admin-label">
          应用后的计划标题
          <input
            className="admin-input"
            value={copyModal.name}
            onChange={(event) =>
              setCopyModal(
                (current) =>
                  current && { ...current, name: event.target.value },
              )
            }
            placeholder="请输入计划标题"
          />
        </label></div>}
        {copyWizardStep === 1 && <div className="admin-workflow-pane"><div className="admin-label">
          应用到班级
          <ClassMultiPicker
            options={pickerOptions.filter(
              (item) =>
                item.id !==
                weeklyPlans.find(
                  (plan) => plan.id === copyModal.sourcePlanId,
                )?.classId,
            )}
            selectedIds={copyModal.targetClassIds}
            onChange={(ids) =>
              setCopyModal(
                (current) => current && { ...current, targetClassIds: ids },
              )
            }
          />
        </div>
        <p className="admin-major-card__hint">
          每个目标班级会创建一份已启用的独立计划，之后可分别编辑。
        </p></div>}
          </div>
        </div>
        <div className="admin-modal__actions">
          <button className="admin-btn" onClick={() => copyWizardStep ? setCopyWizardStep(0) : setCopyModal(null)}>{copyWizardStep ? "上一步" : "取消"}</button>
          {copyWizardStep === 0 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={!copyModal.sourcePlanId || !copyModal.name.trim()} onClick={() => setCopyWizardStep(1)}>下一步，选择班级</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={commitCopyPlan} disabled={!copyModal.targetClassIds.length}>应用到 {copyModal.targetClassIds.length} 个班级</button>}
        </div>
      </div>
    </AdminModalPortal>
  );
}
