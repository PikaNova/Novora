import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import AdminWizardSteps, { AdminWorkflowClose } from "../AdminWizardSteps";
import InlineSelect from "../InlineSelect";
import SubjectIcon from "../SubjectIcon";
import TimeRangePickerModal from "../TimeRangePickerModal";
import { COMMON_EXAM_SUBJECTS } from "../../data/subjects";
import type { IsoWeekday, WeeklyWeekMode, WeeklyWeekType } from "../../types/exam";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";
import type { ItemEdit } from "../../hooks/weekly/useWeeklyItemModal";
import { WEEKDAY_LABEL, WEEKDAY_ORDER } from "./weeklyShared";

const COMMON_WEEKLY_SUBJECTS = COMMON_EXAM_SUBJECTS;
const CUSTOM_WEEKLY_SUBJECT = "__custom_weekly_subject__";

interface ItemFormModalProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  editing: ItemEdit | null;
  setEditing: React.Dispatch<React.SetStateAction<ItemEdit | null>>;
  itemWizardStep: number;
  setItemWizardStep: React.Dispatch<React.SetStateAction<number>>;
  editError: string;
  setEditError: (value: string) => void;
  customWeeklySubjectActive: boolean;
  setCustomWeeklySubjectActive: (value: boolean) => void;
  weeklyTimeFlowOpen: boolean;
  setWeeklyTimeFlowOpen: (value: boolean) => void;
  openWeeklyTimeFlow: () => void;
  cancelWeeklyTimeFlow: () => void;
  commitItemModal: () => void;
  planWeekMode: WeeklyWeekMode;
}

export default function ItemFormModal({
  backdropProps,
  editing,
  setEditing,
  itemWizardStep,
  setItemWizardStep,
  editError,
  setEditError,
  customWeeklySubjectActive,
  setCustomWeeklySubjectActive,
  weeklyTimeFlowOpen,
  setWeeklyTimeFlowOpen,
  openWeeklyTimeFlow,
  cancelWeeklyTimeFlow,
  commitItemModal,
  planWeekMode,
}: ItemFormModalProps) {
  const weeklyTimeFlowAnchorRef = React.useRef<HTMLButtonElement | null>(null);
  if (!editing) return null;

  return (
    <>
      <AdminModalPortal
        className="admin-modal-overlay"
        {...backdropProps(() => {
          setWeeklyTimeFlowOpen(false);
          setEditing(null);
        })}
      >
        <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(e) => e.stopPropagation()}>
          <h2 className="admin-modal__title admin-workflow-head">
            {editing.id ? "编辑周测" : "添加周测"}
          </h2>
          <AdminWorkflowClose onClick={() => { setWeeklyTimeFlowOpen(false); setEditing(null); setEditError(""); }} />
          {editError && <div className="admin-error">{editError}</div>}
          <div className="admin-workflow-layout">
            <AdminWizardSteps
              active={itemWizardStep}
              steps={[
                { label: "选择科目", hint: "常用或自定义科目" },
                { label: "时间规则", hint: "周次、时间和备注" },
                { label: "确认保存", hint: "检查本次周测" },
              ]}
              summary={<><span>当前周测</span><strong>{editing.name || "尚未选择科目"}</strong><span>{WEEKDAY_LABEL[editing.weekday]} · {editing.startTime || "--:--"} - {editing.endTime || "--:--"}</span></>}
            />
            <div className="admin-workflow-content" key={itemWizardStep}>
            {itemWizardStep === 0 && <div className="admin-workflow-pane">
            <label className="admin-label">
              名称
              <InlineSelect
                className="admin-major-subject-select"
                ariaLabel="选择周测科目"
                value={customWeeklySubjectActive || (editing.name && !COMMON_WEEKLY_SUBJECTS.includes(editing.name)) ? CUSTOM_WEEKLY_SUBJECT : editing.name}
                placeholder="选择常用科目"
                options={[
                  { value: "", label: "选择常用科目" },
                  ...COMMON_WEEKLY_SUBJECTS.map((subject) => ({ value: subject, label: <><SubjectIcon subject={subject} size={16} />{subject}</> })),
                  { value: CUSTOM_WEEKLY_SUBJECT, label: <><SubjectIcon subject="其他" size={16} />其他 / 自定义</> },
                ]}
                onChange={(value) => {
                  if (value === CUSTOM_WEEKLY_SUBJECT) {
                    setCustomWeeklySubjectActive(true);
                    return;
                  }
                  setCustomWeeklySubjectActive(false);
                  setEditing((p) => p && { ...p, name: value });
                }}
              />
              {(customWeeklySubjectActive || (editing.name && !COMMON_WEEKLY_SUBJECTS.includes(editing.name))) && <input className="admin-input" autoFocus value={editing.name} onChange={(e) => setEditing((p) => p && { ...p, name: e.target.value })} placeholder="填写自定义科目名称" maxLength={40} />}
            </label>
            </div>}
            {itemWizardStep === 1 && <div className="admin-workflow-pane admin-workflow-pane--two-column">
            <label className="admin-label">
              星期
              <InlineSelect
                className="admin-input"
                value={String(editing.weekday)}
                onChange={(value) =>
                  setEditing(
                    (p) =>
                      p && { ...p, weekday: Number(value) as IsoWeekday },
                  )
                }
                options={WEEKDAY_ORDER.map((wd) => ({
                  value: String(wd),
                  label: WEEKDAY_LABEL[wd],
                }))}
              />
            </label>
            {planWeekMode === "ab" && (
              <label className="admin-label">
                适用周次
                <InlineSelect
                  className="admin-input"
                  value={editing.weekType ?? "all"}
                  onChange={(value) =>
                    setEditing(
                      (p) => p && { ...p, weekType: value as WeeklyWeekType },
                    )
                  }
                  options={[
                    { value: "all", label: "A/B 周都进行" },
                    { value: "a", label: "仅 A 周" },
                    { value: "b", label: "仅 B 周" },
                  ]}
                />
              </label>
            )}
            <div className="admin-major-endtime weekly-time-setting">
              <span>时间设置</span>
              <button
                type="button"
                className="admin-major-endtime__trigger"
                ref={weeklyTimeFlowAnchorRef}
                onClick={openWeeklyTimeFlow}
              >
                <strong>{editing.startTime || "--:--"} - {editing.endTime || "--:--"}</strong>
                <small>在同一界面设置开始、结束时间和常用时长</small>
              </button>
            </div>
            <label className="admin-label">
              地点 / 备注（可选）
              <input
                className="admin-input"
                value={editing.location ?? ""}
                onChange={(e) =>
                  setEditing((p) => p && { ...p, location: e.target.value })
                }
                placeholder="如：本班教室"
              />
            </label>
            <label className="admin-toggle-label">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) =>
                  setEditing((p) => p && { ...p, enabled: e.target.checked })
                }
              />
              启用此周测
            </label>
            </div>}
            {itemWizardStep === 2 && <div className="admin-workflow-pane">
              <div className="admin-workflow-review">
                <span>考试科目<strong>{editing.name || "未选择"}</strong></span>
                <span>进行时间<strong>{WEEKDAY_LABEL[editing.weekday]} {editing.startTime} - {editing.endTime}{editing.endNextDay ? "（次日）" : ""}</strong></span>
                <span>适用周次<strong>{planWeekMode === "ab" ? editing.weekType === "a" ? "仅 A 周" : editing.weekType === "b" ? "仅 B 周" : "A/B 周都进行" : "每个生效周"}</strong></span>
                <span>地点备注<strong>{editing.location || "无"}</strong></span>
                <span>启用状态<strong>{editing.enabled ? "启用" : "停用"}</strong></span>
              </div>
            </div>}
            </div>
          </div>
          <div className="admin-modal__actions">
            <button className="admin-btn" onClick={itemWizardStep === 0 ? () => { setWeeklyTimeFlowOpen(false); setEditing(null); setCustomWeeklySubjectActive(false); setEditError(""); } : () => setItemWizardStep((value) => value - 1)}>{itemWizardStep === 0 ? "取消" : "上一步"}</button>
            {itemWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => {
                if (itemWizardStep === 0 && !editing.name.trim()) {
                  setEditError("请先选择或填写周测科目。");
                  return;
                }
                if (itemWizardStep === 1) {
                  const start = editing.startTime || "";
                  const end = editing.endTime || "";
                  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
                    setEditError("请设置有效的开始和结束时间。");
                    return;
                  }
                  if (!editing.endNextDay && end <= start) {
                    setEditError("结束时间必须晚于开始时间（跨日请勾选次日结束）。");
                    return;
                  }
                }
                setEditError("");
                setItemWizardStep((value) => value + 1);
              }}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={commitItemModal}>确认并保存</button>}
          </div>
        </div>
      </AdminModalPortal>
      <TimeRangePickerModal
        open={weeklyTimeFlowOpen}
        startValue={editing.startTime}
        endValue={editing.endTime}
        subject={editing.name || "周测"}
        contextLabel={WEEKDAY_LABEL[editing.weekday]}
        initialCrossDay={!!editing.endNextDay}
        anchorRef={weeklyTimeFlowAnchorRef}
        onPreviewChange={(startTime, endTime, endNextDay) => {
          setEditing((item) => item ? { ...item, startTime, endTime, endNextDay } : item);
        }}
        onPreviewCancel={(startTime, endTime, endNextDay) => {
          setEditing((item) => item ? { ...item, startTime, endTime, endNextDay } : item);
        }}
        onCancel={cancelWeeklyTimeFlow}
        onConfirm={(startTime, endTime, endNextDay) => {
          setEditing((item) => item ? { ...item, startTime, endTime, endNextDay } : item);
          setWeeklyTimeFlowOpen(false);
        }}
      />
    </>
  );
}
