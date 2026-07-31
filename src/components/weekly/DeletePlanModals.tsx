import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import AdminWizardSteps, { AdminWorkflowClose } from "../AdminWizardSteps";
import ClassMultiPicker, { type ClassPickerOption } from "../ClassMultiPicker";
import type { WeeklyExamItem, WeeklyPlan } from "../../types/exam";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";

interface DeletePlanModalsProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  deletePlanOpen: boolean;
  setDeletePlanOpen: (value: boolean) => void;
  activePlan: WeeklyPlan;
  itemsCount: number;
  removePlan: () => void;
  allowBatchApply: boolean;
  batchDeleteOpen: boolean;
  setBatchDeleteOpen: (value: boolean) => void;
  batchDeleteStep: number;
  setBatchDeleteStep: (value: number) => void;
  batchDeletePlanIds: string[];
  setBatchDeletePlanIds: (ids: string[]) => void;
  planPickerOptions: ClassPickerOption[];
  removeSelectedPlans: () => Promise<void>;
  deleteTarget: WeeklyExamItem | null;
  setDeleteTarget: (item: WeeklyExamItem | null) => void;
  removeItem: (item: WeeklyExamItem) => void;
}

export default function DeletePlanModals({
  backdropProps,
  deletePlanOpen,
  setDeletePlanOpen,
  activePlan,
  itemsCount,
  removePlan,
  allowBatchApply,
  batchDeleteOpen,
  setBatchDeleteOpen,
  batchDeleteStep,
  setBatchDeleteStep,
  batchDeletePlanIds,
  setBatchDeletePlanIds,
  planPickerOptions,
  removeSelectedPlans,
  deleteTarget,
  setDeleteTarget,
  removeItem,
}: DeletePlanModalsProps) {
  return (
    <>
      {deletePlanOpen && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setDeletePlanOpen(false))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">删除周测计划</h2>
            <p className="admin-modal__body">
              确定删除「{activePlan.name}」及其全部 {itemsCount}{" "}
              条周测？删除后可在页面顶部立即撤销。
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--danger"
                onClick={removePlan}
              >
                删除
              </button>
              <button
                className="admin-btn"
                onClick={() => setDeletePlanOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {allowBatchApply && batchDeleteOpen && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => {
            setBatchDeleteOpen(false);
            setBatchDeletePlanIds([]);
          })}
        >
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">批量删除周测计划</h2>
            <AdminWorkflowClose onClick={() => { setBatchDeleteOpen(false); setBatchDeletePlanIds([]); }} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps active={batchDeleteStep} steps={[{ label: "选择计划", hint: "按年级筛选并勾选" }, { label: "确认删除", hint: "核对影响范围" }]} summary={<><span>已选择</span><strong>{batchDeletePlanIds.length} 个计划</strong><span>删除后可整批撤销</span></>} />
              <div className="admin-workflow-content" key={batchDeleteStep}>
                {batchDeleteStep === 0 && <div className="admin-workflow-pane"><p className="admin-modal__body">按年级和班级选择要删除的具体计划。</p><ClassMultiPicker options={planPickerOptions} selectedIds={batchDeletePlanIds} onChange={setBatchDeletePlanIds} noun="计划" emptyText="当前范围内没有可删除的周测计划" /></div>}
                {batchDeleteStep === 1 && <div className="admin-workflow-pane"><div className="admin-workflow-review"><span>删除数量<strong>{batchDeletePlanIds.length} 个周测计划</strong></span><span>删除后处理<strong>自动切换各班剩余计划；无剩余则清空</strong></span><span>恢复方式<strong>页面顶部支持整批撤销</strong></span></div><p className="admin-major-card__hint">请确认所选年级和班级无误后再删除。</p></div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={() => { if (batchDeleteStep) setBatchDeleteStep(0); else { setBatchDeleteOpen(false); setBatchDeletePlanIds([]); } }}>{batchDeleteStep ? "上一步" : "取消"}</button>
              {batchDeleteStep === 0 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={!batchDeletePlanIds.length} onClick={() => setBatchDeleteStep(1)}>下一步，确认范围</button> : <button className="admin-btn admin-btn--danger admin-workflow-actions-spacer" onClick={() => void removeSelectedPlans()}>删除 {batchDeletePlanIds.length} 个计划</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {deleteTarget && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setDeleteTarget(null))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">确认删除</h2>
            <p className="admin-modal__body">
              确定删除「{deleteTarget.name}」？删除后可立即撤销。
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--danger"
                onClick={() => removeItem(deleteTarget)}
              >
                删除
              </button>
              <button
                className="admin-btn"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
    </>
  );
}
