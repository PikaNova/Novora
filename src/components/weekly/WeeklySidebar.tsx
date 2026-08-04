import React from "react";
import { CircleHelp } from "lucide-react";
import InlineSelect from "../InlineSelect";
import HelpTip from "../HelpTip";
import type {
  WeeklyConflictPolicy,
  WeeklyExamItem,
  WeeklyPlan,
} from "../../types/exam";
import { useWeeklyBatchOps, type WeeklyCopyModal } from "../../hooks/weekly/useWeeklyBatchOps";
import { SCOPE_LABEL } from "./weeklyShared";

type BatchOpsState = ReturnType<typeof useWeeklyBatchOps>;

interface WeeklySidebarProps {
  selectedClassName: string;
  scopedPlans: WeeklyPlan[];
  activePlan: WeeklyPlan;
  items: WeeklyExamItem[];
  switchPlan: (planId: string) => void;
  openNewPlan: () => void;
  openPlanSettings: () => void;
  setDeletePlanOpen: (value: boolean) => void;
  togglePlanEnabled: () => void;
  allowBatchApply: boolean;
  setCopyModal: BatchOpsState["setCopyModal"];
  weeklyConflictPolicy: WeeklyConflictPolicy;
  setPolicyOpen: (value: boolean) => void;
  setExceptionsOpen: (value: boolean) => void;
  canEditConflictPolicy?: boolean;
}

export default function WeeklySidebar({
  selectedClassName,
  scopedPlans,
  activePlan,
  items,
  switchPlan,
  openNewPlan,
  openPlanSettings,
  setDeletePlanOpen,
  togglePlanEnabled,
  allowBatchApply,
  setCopyModal,
  weeklyConflictPolicy,
  setPolicyOpen,
  setExceptionsOpen,
  canEditConflictPolicy = false,
}: WeeklySidebarProps) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-major-card">
        <div className="admin-major-card__head">
          <label className="admin-label" style={{ opacity: 0.9 }}>
            {selectedClassName} · 周测计划
          </label>
          <span className="admin-major-card__count">
            共 {scopedPlans.length} 个
          </span>
        </div>
        <div className="admin-major-card__active">
          <span
            className="admin-major-card__active-name"
            title={activePlan.name}
          >
            {activePlan.name}
            {!activePlan.enabled ? "（已停用）" : ""}
          </span>
          <span className="admin-major-card__active-meta">
            {items.length} 条周测 · {items.filter((i) => i.enabled).length}{" "}
            条启用 ·{" "}
            {activePlan.weekMode === "ab"
              ? "A/B 周"
              : activePlan.repeatEveryWeeks === 1
                ? "每周"
                : `每 ${activePlan.repeatEveryWeeks} 周`}
          </span>
        </div>
        {scopedPlans.length > 1 && (
          <label className="admin-major-card__switch">
            <span className="admin-major-card__switch-k">切换计划</span>
            <InlineSelect
              className="admin-input admin-major-select"
              value={activePlan.id}
              onChange={switchPlan}
              options={scopedPlans.map((p) => ({
                value: p.id,
                label: `${p.name}（${p.items.length} 条）`,
              }))}
            />
          </label>
        )}
        <div className="admin-major-card__btns">
          <button
            className="admin-btn admin-btn--primary"
            onClick={openNewPlan}
          >
            + 新建
          </button>
            <button
              className="admin-btn"
              onClick={openPlanSettings}
            >
            计划设置
          </button>
          <button
            className="admin-btn admin-btn--danger"
            onClick={() => setDeletePlanOpen(true)}
          >
            删除
          </button>
        </div>
        <div className="admin-major-card__btns">
          <button
            className="admin-btn"
            style={{ flex: 1 }}
            onClick={togglePlanEnabled}
          >
            {activePlan.enabled ? "停用此计划" : "启用此计划"}
          </button>
          {allowBatchApply && (
            <span className="with-help-tip" style={{ flex: 1 }}>
              <button
                className="admin-btn"
                style={{ flex: 1 }}
                onClick={() =>
                  setCopyModal({
                    sourcePlanId: activePlan.id,
                    targetClassIds: [],
                    name: activePlan.name.replace(/（复制）$/u, ""),
                  })
                }
              >
                批量应用
              </button>
              <HelpTip title="批量应用">
                应用后每个目标班级都会得到独立计划，之后修改某个班级不会影响其他班级。
              </HelpTip>
            </span>
          )}
        </div>
        <p className="admin-major-card__hint">
          生效期：{activePlan.activeFrom}
          {" ~ "}
          {activePlan.activeUntil || "长期"}
        </p>
      </div>

      {canEditConflictPolicy && (
        <div className="admin-form-card">
          <h2 className="admin-form-card__title">大型考试冲突处理</h2>
          <p className="admin-major-card__hint" style={{ margin: "0 0 10px" }}>
            仅在运行模式为“自动”时生效：
            {SCOPE_LABEL[weeklyConflictPolicy.scope]}
          </p>
          <button
            className="admin-btn"
            style={{ width: "100%" }}
            onClick={() => setPolicyOpen(true)}
          >
            冲突处理设置
          </button>
        </div>
      )}

      <div className="admin-form-card">
        <h2 className="admin-form-card__title">例外日期</h2>
        <p className="admin-major-card__hint" style={{ margin: "0 0 10px" }}>
          整日排除 {activePlan.excludedDates.length} 天 · 单次调整{" "}
          {activePlan.overrides.length} 条
        </p>
        <button
          className="admin-btn"
          style={{ width: "100%" }}
          onClick={() => setExceptionsOpen(true)}
        >
          例外日期管理
        </button>
      </div>

      <div className="admin-tips">
        <p className="admin-tips__title">
          <CircleHelp size={16} />
          使用说明
        </p>
        <ul>
          <li>周测按星期固定重复，与具体日期无关</li>
          <li>运行模式为“自动”时，大型考试期间会按策略自动暂停周测</li>
          <li>删除计划、周测项或单次实例后可立即撤销</li>
        </ul>
      </div>
    </aside>
  );
}
