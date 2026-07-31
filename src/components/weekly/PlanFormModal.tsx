import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import AdminWizardSteps, { AdminWorkflowClose } from "../AdminWizardSteps";
import InlineSelect from "../InlineSelect";
import { DateTimeField } from "../touch-datetime-picker";
import ClassMultiPicker, { type ClassPickerOption } from "../ClassMultiPicker";
import type { WeeklyWeekMode } from "../../types/exam";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import type { PlanModal } from "../../hooks/weekly/useWeeklyPlanModal";

interface PlanFormModalProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  planModal: PlanModal;
  setPlanModal: React.Dispatch<React.SetStateAction<PlanModal>>;
  planWizardStep: number;
  setPlanWizardStep: React.Dispatch<React.SetStateAction<number>>;
  planError: string;
  setPlanError: (value: string) => void;
  commitPlanModal: () => void;
  classOptions: Array<{ id: string; gradeId: string; label: string }>;
  pickerOptions: ClassPickerOption[];
  allowBatchApply: boolean;
}

export default function PlanFormModal({
  backdropProps,
  planModal,
  setPlanModal,
  planWizardStep,
  setPlanWizardStep,
  planError,
  setPlanError,
  commitPlanModal,
  classOptions,
  pickerOptions,
  allowBatchApply,
}: PlanFormModalProps) {
  if (!planModal) return null;

  const closePlanModal = () => {
    setPlanModal(null);
    setPlanError("");
  };
  const nextPlanStep = () => {
    if (planWizardStep === 0) {
      if (!planModal.name.trim()) {
        setPlanError("请填写计划名称。");
        return;
      }
      if (planModal.mode === "add" && (!planModal.gradeId || !planModal.classIds.length)) {
        setPlanError("请先选择适用年级和班级。");
        return;
      }
    }
    setPlanError("");
    setPlanWizardStep((value) => Math.min(2, value + 1));
  };
  return (
    <AdminModalPortal
      className="admin-modal-overlay"
      {...backdropProps(closePlanModal)}
    >
      <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-modal__title admin-workflow-head">
          {planModal.mode === "add" ? "新建周测计划" : "周测计划设置"}
        </h2>
        <AdminWorkflowClose onClick={closePlanModal} />
        {planError && <div className="admin-error">{planError}</div>}
        <div className="admin-workflow-layout">
          <AdminWizardSteps
            active={planWizardStep}
            steps={[
              { label: "适用范围", hint: "年级、班级和名称" },
              { label: "计划规则", hint: "日期、周次和节假日" },
              { label: "确认保存", hint: "检查计划配置" },
            ]}
            summary={<><span>当前计划</span><strong>{planModal.name || "尚未命名"}</strong><span>{planModal.mode === "add" ? `${planModal.classIds.length} 个班级` : "当前班级"}</span></>}
          />
          <div className="admin-workflow-content" key={planWizardStep}>
            {planWizardStep === 0 && <div className="admin-workflow-pane">
              {planModal.mode === "add" && <>
              <label className="admin-label">
                适用年级
                <InlineSelect
                  className="admin-input"
                  value={planModal.gradeId}
                  onChange={(value) =>
                    setPlanModal(
                      (p) =>
                        p && { ...p, gradeId: value, classIds: [], name: "" },
                    )
                  }
                  options={[
                    { value: "", label: "请选择年级" },
                    ...[
                      ...new Map(
                        classOptions.map((item) => [
                          item.gradeId,
                          item.label.split(" · ")[0],
                        ]),
                      ),
                    ].map(([id, label]) => ({ value: id, label })),
                  ]}
                />
              </label>
              <div className="admin-label">
                适用班级
                <ClassMultiPicker
                  options={pickerOptions}
                  gradeId={planModal.gradeId}
                  selectedIds={planModal.classIds}
                  onChange={(ids) =>
                    setPlanModal(
                      (p) =>
                        p && {
                          ...p,
                          classIds: ids,
                          name:
                            p.name ||
                            (ids.length === 1
                              ? `${pickerOptions.find((item) => item.id === ids[0])?.className || ""}周测计划`
                              : "周测计划"),
                        },
                    )
                  }
                  disabled={!planModal.gradeId}
                  single={!allowBatchApply}
                />
              </div>
              </>}
              <label className="admin-label">
                计划名称
                <input
                  className="admin-input"
                  autoFocus={planModal.mode !== "add"}
                  value={planModal.name}
                  onChange={(e) => setPlanModal((p) => p && { ...p, name: e.target.value })}
                  placeholder="如：高三周测 / 晚自习周测"
                />
              </label>
            </div>}
            {planWizardStep === 1 && <div className="admin-workflow-pane admin-workflow-pane--two-column">
            <label className="admin-label">
            生效日期
            <DateTimeField
              className="admin-date-time-field"
              value={planModal.activeFrom}
              onChange={(value) => setPlanModal((p) => p && { ...p, activeFrom: value })}
              mode="date"
              title="选择生效日期"
              showFieldPreview={false}
            />
          </label>
          <label className="admin-label">
            学期开始日期（A 周锚点）
            <DateTimeField
              className="admin-date-time-field"
              value={planModal.anchorDate}
              onChange={(value) => setPlanModal((p) => p && { ...p, anchorDate: value })}
              mode="date"
              title="选择学期开始日期"
              showFieldPreview={false}
            />
          </label>
          <label className="admin-label">
            周次模式
            <InlineSelect
              className="admin-input"
              value={planModal.weekMode}
              onChange={(value) =>
                setPlanModal(
                  (p) => p && { ...p, weekMode: value as WeeklyWeekMode },
                )
              }
              options={[
                { value: "single", label: "统一周表" },
                { value: "ab", label: "A/B 周交替" },
              ]}
            />
          </label>
          <label className="admin-toggle-label">
            <input
              type="checkbox"
              checked={planModal.forever}
              onChange={(e) =>
                setPlanModal((p) => p && { ...p, forever: e.target.checked })
              }
            />
            长期有效（不设结束日期）
          </label>
          {!planModal.forever && (
            <label className="admin-label">
              结束日期
              <DateTimeField
                className="admin-date-time-field"
                value={planModal.activeUntil}
                onChange={(value) => setPlanModal((p) => p && { ...p, activeUntil: value })}
                mode="date"
                title="选择结束日期"
                showFieldPreview={false}
              />
            </label>
          )}
          {planModal.weekMode === "single" && (
            <label className="admin-label">
              重复周期
              <InlineSelect
                className="admin-input"
                value={String(planModal.repeatEveryWeeks)}
                onChange={(value) =>
                  setPlanModal(
                    (p) => p && { ...p, repeatEveryWeeks: Number(value) },
                  )
                }
                options={[1, 2, 3, 4].map((value) => ({
                  value: String(value),
                  label:
                    value === 1
                      ? "每周"
                      : `每 ${value} 周（隔 ${value - 1} 周）`,
                }))}
              />
            </label>
          )}
          <label className="admin-toggle-label">
            <input
              type="checkbox"
              checked={planModal.excludeOfficialHolidays}
              onChange={(e) =>
                setPlanModal(
                  (p) =>
                    p && { ...p, excludeOfficialHolidays: e.target.checked },
                )
              }
            />
            自动排除 2026 年法定节假日
          </label>
            </div>}
            {planWizardStep === 2 && <div className="admin-workflow-pane">
              <div className="admin-workflow-review">
                <span>计划名称<strong>{planModal.name}</strong></span>
                <span>应用范围<strong>{planModal.mode === "add" ? `${planModal.classIds.length} 个班级` : "当前班级"}</strong></span>
                <span>生效日期<strong>{planModal.activeFrom} 至 {planModal.forever ? "长期" : planModal.activeUntil || "未设置"}</strong></span>
                <span>周次规则<strong>{planModal.weekMode === "ab" ? "A/B 周交替" : planModal.repeatEveryWeeks === 1 ? "每周" : `每 ${planModal.repeatEveryWeeks} 周`}</strong></span>
                <span>节假日<strong>{planModal.excludeOfficialHolidays ? "自动排除" : "不自动排除"}</strong></span>
              </div>
              <p className="admin-major-card__hint">保存后仍可在计划设置中修改规则；批量创建的计划会分别归属于各班级。</p>
            </div>}
          </div>
        </div>
        <div className="admin-modal__actions">
          <button className="admin-btn" onClick={planWizardStep === 0 ? closePlanModal : () => setPlanWizardStep((value) => value - 1)}>{planWizardStep === 0 ? "取消" : "上一步"}</button>
          {planWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={nextPlanStep}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={commitPlanModal}>保存到 {planModal.mode === "add" ? planModal.classIds.length : 1} 个班级</button>}
        </div>
      </div>
    </AdminModalPortal>
  );
}
