import React from "react";
import { CalendarDays } from "lucide-react";
import SubjectIcon from "../SubjectIcon";
import type { IsoWeekday, WeeklyExamItem, WeeklyPlan } from "../../types/exam";
import type { ItemEdit } from "../../hooks/weekly/useWeeklyItemModal";
import type { LastDeleted } from "../../hooks/weekly/useWeeklyPlanModal";
import { WEEKDAY_LABEL, WEEK_TYPE_LABEL } from "./weeklyShared";

interface WeeklyItemsListProps {
  activePlan: WeeklyPlan;
  items: WeeklyExamItem[];
  grouped: Array<{ wd: IsoWeekday; list: WeeklyExamItem[] }>;
  lastDeleted: LastDeleted | null;
  restoreLastDeleted: () => void;
  openImport: () => void;
  exportJson: () => void;
  allowBatchApply: boolean;
  setBatchDeletePlanIds: (ids: string[]) => void;
  setBatchDeleteOpen: (value: boolean) => void;
  setCustomWeeklySubjectActive: (value: boolean) => void;
  setEditing: React.Dispatch<React.SetStateAction<ItemEdit | null>>;
  setEditError: (value: string) => void;
  toggleItemEnabled: (item: WeeklyExamItem) => void;
  setDeleteTarget: (item: WeeklyExamItem | null) => void;
}

export default function WeeklyItemsList({
  activePlan,
  items,
  grouped,
  lastDeleted,
  restoreLastDeleted,
  openImport,
  exportJson,
  allowBatchApply,
  setBatchDeletePlanIds,
  setBatchDeleteOpen,
  setCustomWeeklySubjectActive,
  setEditing,
  setEditError,
  toggleItemEnabled,
  setDeleteTarget,
}: WeeklyItemsListProps) {
  return (
    <>
      <div className="admin-list-header">
        <h2 className="admin-list-title">{activePlan.name} · 周测</h2>
        <span className="admin-list-count">{items.length} 项</span>
        <div className="weekly-list-actions">
          <button
            className="admin-btn"
            onClick={openImport}
          >
            导入周测 JSON
          </button>
          <button className="admin-btn" onClick={exportJson}>
            导出周测 JSON
          </button>
          {allowBatchApply && (
            <button
              className="admin-btn admin-btn--danger"
              onClick={() => {
                setBatchDeletePlanIds([]);
                setBatchDeleteOpen(true);
              }}
            >
              批量删除计划
            </button>
          )}
          <button
            className="admin-btn admin-btn--primary"
            onClick={() => {
              setCustomWeeklySubjectActive(false);
              setEditing({
                name: "",
                weekday: 1,
                startTime: "19:00",
                endTime: "20:00",
                endNextDay: false,
                enabled: true,
                weekType: "all",
              });
              setEditError("");
            }}
          >
            + 添加周测
          </button>
        </div>
      </div>

      {lastDeleted && (
        <div className="admin-undo">
          <span>
            {lastDeleted.kind === "plans"
              ? `已批量删除 ${lastDeleted.plans.length} 个周测计划`
              : `已删除「${lastDeleted.kind === "plan" ? lastDeleted.plan.name : lastDeleted.kind === "item" ? lastDeleted.item.name : lastDeleted.name}」`}
          </span>
          <button
            className="admin-btn admin-btn--ghost"
            onClick={restoreLastDeleted}
          >
            撤销删除
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty__icon">
            <CalendarDays />
          </div>
          <p>当前计划暂无周测，点击“添加周测”开始</p>
        </div>
      ) : (
        <div className="weekly-groups">
          {grouped
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <div className="weekly-group" key={g.wd}>
                <h3 className="weekly-group__title">{WEEKDAY_LABEL[g.wd]}</h3>
                <ul
                  className="admin-list"
                  style={{ listStyle: "none", padding: 0, margin: 0 }}
                >
                  {g.list.map((item) => (
                    <li
                      className={`admin-item${!item.enabled ? " admin-item--disabled" : ""}`}
                      key={item.id}
                    >
                      <div className="admin-item__order">
                        <span className="admin-item__order-num">
                          {WEEKDAY_LABEL[item.weekday]}
                        </span>
                      </div>
                      <div className="admin-item__info">
                        <div className="admin-item__name-row">
                          <span className="admin-item__name">
                            <SubjectIcon subject={item.name} size={16} />
                            {item.name}
                          </span>
                          {activePlan.weekMode === "ab" && (
                            <span className="admin-item__status weekly-week-badge">
                              {WEEK_TYPE_LABEL[item.weekType ?? "all"]}
                            </span>
                          )}
                          {!item.enabled && (
                            <span
                              className="admin-item__status"
                              style={{
                                color: "#6c757d",
                                background: "rgba(108,117,125,.1)",
                              }}
                            >
                              已停用
                            </span>
                          )}
                        </div>
                        <div className="admin-item__times">
                          <span>{item.startTime}</span>
                          <span className="admin-item__times-sep">–</span>
                          <span>
                            {item.endTime}
                            {item.endNextDay ? "（次日）" : ""}
                          </span>
                          {item.location && (
                            <span className="admin-item__duration">
                              {item.location}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="admin-item__actions">
                        <button
                          type="button"
                          className={`admin-item-btn admin-item-btn--toggle ${item.enabled ? "admin-item-btn--disable" : "admin-item-btn--enable"}`}
                          onClick={() => toggleItemEnabled(item)}
                        >
                          {item.enabled ? "停用" : "启用"}
                        </button>
                        <button
                          className="admin-item-btn"
                          onClick={() => {
                            setCustomWeeklySubjectActive(false);
                            setEditing({ ...item });
                            setEditError("");
                          }}
                        >
                          编辑
                        </button>
                        <button
                          className="admin-item-btn admin-item-btn--delete"
                          onClick={() => setDeleteTarget(item)}
                        >
                          删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </>
  );
}
