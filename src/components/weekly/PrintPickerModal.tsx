import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import AdminWizardSteps, { AdminWorkflowClose } from "../AdminWizardSteps";
import ClassMultiPicker, { type ClassPickerOption } from "../ClassMultiPicker";
import SchedulePrintPreview, { type PrintScheduleDocument } from "../SchedulePrintPreview";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import type { PreviewOcc } from "./weeklyShared";

interface PrintPickerModalProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  printPickerOpen: boolean;
  setPrintPickerOpen: (value: boolean) => void;
  printPickerStep: number;
  setPrintPickerStep: (value: number) => void;
  printClassIds: string[];
  setPrintClassIds: (ids: string[]) => void;
  pickerOptions: ClassPickerOption[];
  selectedGradeId: string;
  printSchedules: PrintScheduleDocument[];
  printOpen: boolean;
  setPrintOpen: (value: boolean) => void;
  preview: PreviewOcc[];
  classOptions: Array<{ id: string; gradeId: string; label: string }>;
  selectedClassId: string;
  selectedClassName: string;
}

export default function PrintPickerModal({
  backdropProps,
  printPickerOpen,
  setPrintPickerOpen,
  printPickerStep,
  setPrintPickerStep,
  printClassIds,
  setPrintClassIds,
  pickerOptions,
  selectedGradeId,
  printSchedules,
  printOpen,
  setPrintOpen,
  preview,
  classOptions,
  selectedClassId,
  selectedClassName,
}: PrintPickerModalProps) {
  return (
    <>
      {printPickerOpen && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setPrintPickerOpen(false))}
        >
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">批量预览与下载 PDF</h2>
            <AdminWorkflowClose onClick={() => { setPrintPickerOpen(false); setPrintClassIds([]); }} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps active={printPickerStep} steps={[{ label: "选择班级", hint: "勾选需要导出的范围" }, { label: "确认文档", hint: "核对页数和排版" }]} summary={<><span>导出范围</span><strong>{printSchedules.length} 个班级</strong><span>每班一周一张 A4</span></>} />
              <div className="admin-workflow-content" key={printPickerStep}>
                {printPickerStep === 0 && <div className="admin-workflow-pane"><p className="admin-modal__body">选择需要导出的班级。</p><ClassMultiPicker options={pickerOptions} gradeId={selectedGradeId} selectedIds={printClassIds} onChange={setPrintClassIds} /></div>}
                {printPickerStep === 1 && <div className="admin-workflow-pane"><div className="admin-workflow-review"><span>班级数量<strong>{printSchedules.length} 个</strong></span><span>文档结构<strong>按班级分组</strong></span><span>分页规则<strong>每个班级一周一张 A4 页面</strong></span></div></div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={() => printPickerStep ? setPrintPickerStep(0) : setPrintPickerOpen(false)}>{printPickerStep ? "上一步" : "取消"}</button>
              {printPickerStep === 0 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={!printSchedules.length} onClick={() => setPrintPickerStep(1)}>下一步，确认文档</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => { setPrintPickerOpen(false); setPrintOpen(true); }}>预览 {printSchedules.length} 个班级</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {printOpen && (
        <SchedulePrintPreview
          entries={preview}
          gradeName={
            classOptions
              .find((item) => item.id === selectedClassId)
              ?.label.split(" · ")[0] || "当前年级"
          }
          className={selectedClassName}
          schedules={printClassIds.length ? printSchedules : undefined}
          onClose={() => {
            setPrintOpen(false);
            setPrintClassIds([]);
          }}
        />
      )}
    </>
  );
}
