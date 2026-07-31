import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import AdminWizardSteps, { AdminWorkflowClose } from "../AdminWizardSteps";
import AiImportGuide from "../AiImportGuide";
import ClassMultiPicker, { type ClassPickerOption } from "../ClassMultiPicker";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import type { WeeklyImportStep, WeeklyImportSummary } from "../../hooks/weekly/useWeeklyImport";
import { WEEKDAY_LABEL } from "./weeklyShared";

interface ImportJsonModalProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  importOpen: boolean;
  closeImport: () => void;
  importStep: WeeklyImportStep;
  setImportStep: (step: WeeklyImportStep) => void;
  importText: string;
  setImportText: (value: string) => void;
  importError: string;
  validateImportJson: () => void;
  importSummary: WeeklyImportSummary | null;
  importExcludedIndexes: number[];
  setImportExcludedIndexes: React.Dispatch<React.SetStateAction<number[]>>;
  importJson: () => void;
  importClassIds: string[];
  setImportClassIds: (ids: string[]) => void;
  allowBatchApply: boolean;
  pickerOptions: ClassPickerOption[];
  selectedGradeId: string;
  selectedClassId: string;
  selectedClassName: string;
  classOptions: Array<{ id: string; gradeId: string; label: string }>;
  activePlanName: string;
}

export default function ImportJsonModal({
  backdropProps,
  importOpen,
  closeImport,
  importStep,
  setImportStep,
  importText,
  setImportText,
  importError,
  validateImportJson,
  importSummary,
  importExcludedIndexes,
  setImportExcludedIndexes,
  importJson,
  importClassIds,
  setImportClassIds,
  allowBatchApply,
  pickerOptions,
  selectedGradeId,
  selectedClassId,
  selectedClassName,
  classOptions,
  activePlanName,
}: ImportJsonModalProps) {
  if (!importOpen) return null;

  return (
    <AdminModalPortal
      className="admin-modal-overlay"
      {...backdropProps(() => closeImport())}
    >
      <div
        className="admin-modal admin-modal--wide admin-modal--workflow weekly-import-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="admin-modal__title admin-workflow-head">导入周测 JSON</h2>
        <AdminWorkflowClose onClick={() => closeImport()} />
        <div className="admin-workflow-layout">
          <AdminWizardSteps
            active={importStep === "paste" ? 0 : importStep === "preview" ? 1 : 2}
            steps={[{ label: "粘贴校验", hint: "识别周测 JSON" }, { label: "预览结果", hint: "检查安排与风险" }, { label: "选择班级", hint: "确认应用范围" }]}
            summary={<><span>导入内容</span><strong>{importSummary?.planName || "待校验 JSON"}</strong><span>{importSummary ? `${importSummary.itemCount} 项周测安排` : "尚未识别"}</span></>}
          />
          <div className="admin-workflow-content" key={importStep}>
        {importStep === "paste" ? (
          <>
            <p className="admin-modal__body">
              先粘贴 JSON 并校验内容，下一步再选择应用班级。
            </p>
            <AiImportGuide
              kind="weekly"
              context={`${classOptions.find((item) => item.id === selectedClassId)?.label || selectedClassName}，计划“${activePlanName}”`}
            />
            {importError && <div className="admin-error">{importError}</div>}
            <textarea
              className="admin-textarea weekly-import-modal__textarea"
              rows={9}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{"items":[{"name":"周测","weekday":1,"startTime":"19:00","endTime":"20:00","enabled":true}]}'
            />
            <div className="admin-modal__actions">
              <button className="admin-btn admin-btn--primary" onClick={validateImportJson}>
                校验 JSON，下一步
              </button>
              <button className="admin-btn" onClick={() => closeImport()}>
                取消
              </button>
            </div>
          </>
        ) : importStep === "preview" ? (
          <div className="admin-workflow-pane">
            <h3 className="admin-modal__title">预览导入结果</h3>
            {importSummary?.warnings.length ? <div className="admin-error">{importSummary.warnings.join("；")}</div> : <p className="admin-major-card__hint">格式校验通过。取消勾选可跳过不需要导入的单项。</p>}
            <div className="admin-import-preview">
              {importSummary?.items.map((item, index) => (
                <label key={`${item.name}-${index}`} className={importExcludedIndexes.includes(index) ? "is-skipped" : ""}>
                  <input type="checkbox" checked={!importExcludedIndexes.includes(index)} onChange={(event) => setImportExcludedIndexes((value) => event.target.checked ? value.filter((itemIndex) => itemIndex !== index) : [...value, index])} />
                  <span><strong>{item.name}</strong><small>{WEEKDAY_LABEL[item.weekday]} · {item.startTime} - {item.endTime}</small>{item.warning && <em>{item.warning}</em>}</span>
                </label>
              ))}
            </div>
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={() => setImportStep("paste")}>上一步</button>
              <button className="admin-btn admin-btn--primary" disabled={(importSummary?.itemCount || 0) === importExcludedIndexes.length} onClick={() => setImportStep("targets")}>下一步，选择班级</button>
              <button className="admin-btn" onClick={() => closeImport()}>取消</button>
            </div>
          </div>
        ) : (
          <>
            <h3 className="admin-modal__title">选择应用班级</h3>
            <div className="weekly-import-modal__summary">
              <strong>{importSummary?.planName || "周测 JSON"}</strong>
              <span>已识别 {importSummary?.itemCount ?? 0} 项周测安排</span>
            </div>
            {allowBatchApply ? (
              <div className="admin-label">
                应用到班级
                <ClassMultiPicker
                  options={pickerOptions}
                  gradeId={selectedGradeId}
                  selectedIds={importClassIds}
                  onChange={setImportClassIds}
                />
              </div>
            ) : (
              <p className="admin-modal__body">将应用到当前班级：{selectedClassName}</p>
            )}
            {importError && <div className="admin-error">{importError}</div>}
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={() => setImportStep("preview")}>
                上一步
              </button>
              <button className="admin-btn admin-btn--primary" onClick={importJson}>
                确认导入到 {importClassIds.length || 1} 个班级
              </button>
              <button className="admin-btn" onClick={() => closeImport()}>
                取消
              </button>
            </div>
          </>
        )}
          </div>
        </div>
      </div>
    </AdminModalPortal>
  );
}
