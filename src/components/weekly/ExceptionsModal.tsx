import React from "react";
import AdminModalPortal from "../AdminModalPortal";
import HelpTip from "../HelpTip";
import { DateTimeField } from "../touch-datetime-picker";
import { OFFICIAL_HOLIDAYS } from "../../data/officialHolidays";
import type { WeeklyPlan } from "../../types/exam";
import { useBackdropDismiss } from "../../hooks/useBackdropDismiss";

interface ExceptionsModalProps {
  backdropProps: ReturnType<typeof useBackdropDismiss>;
  exceptionsOpen: boolean;
  setExceptionsOpen: (value: boolean) => void;
  activePlan: WeeklyPlan;
  weeklyPlans: WeeklyPlan[];
  onSavePlans: (
    plans: WeeklyPlan[],
    activeId: string | null,
    classId: string,
    immediate?: boolean,
    activeByClass?: Record<string, string | null>,
  ) => void;
  selectedClassId: string;
  newExcludeDate: string;
  setNewExcludeDate: (value: string) => void;
  addExcludedDate: () => void;
  removeExcludedDate: (date: string) => void;
  removeOverride: (overrideId: string) => void;
}

export default function ExceptionsModal({
  backdropProps,
  exceptionsOpen,
  setExceptionsOpen,
  activePlan,
  weeklyPlans,
  onSavePlans,
  selectedClassId,
  newExcludeDate,
  setNewExcludeDate,
  addExcludedDate,
  removeExcludedDate,
  removeOverride,
}: ExceptionsModalProps) {
  if (!exceptionsOpen) return null;

  return (
    <AdminModalPortal
      className="admin-modal-overlay"
      {...backdropProps(() => setExceptionsOpen(false))}
    >
      <div
        className="admin-modal admin-modal--wide"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="admin-modal__title">例外日期管理</h2>
        <p className="admin-modal__body">
          整日排除的日期当天完全不生成周测；下方“单次调整”是“取消本次 /
          临时调课 / 本周仍然进行”产生的记录，可在此撤销。
        </p>
        <div className="weekly-exception-layout">
          <section>
            <h3>整日排除</h3>
        <label className="admin-toggle-label">
          <input
            type="checkbox"
            checked={activePlan.excludeOfficialHolidays === true}
            onChange={(e) =>
              onSavePlans(
                weeklyPlans.map((p) =>
                  p.id === activePlan.id
                    ? { ...p, excludeOfficialHolidays: e.target.checked }
                    : p,
                ),
                activePlan.id,
                selectedClassId,
                true,
              )
            }
          />
          自动排除 2026 年法定节假日{" "}
          <HelpTip title="法定节假日">
            启用后，日历预览和实际大屏都会跳过内置节假日。后续年度可通过更新节假日数据表扩展，无需修改计划。
          </HelpTip>
        </label>
        {activePlan.excludeOfficialHolidays && (
          <p className="admin-major-card__hint weekly-holiday-summary">
            {OFFICIAL_HOLIDAYS.map(
              (item) =>
                `${item.name} ${item.start.slice(5)}~${item.end.slice(5)}`,
            ).join(" · ")}
          </p>
        )}
        <div className="admin-form">
          <label className="admin-label">
            添加整日排除
            <DateTimeField
              className="admin-date-time-field"
              value={newExcludeDate}
              onChange={setNewExcludeDate}
              mode="date"
              title="选择排除日期"
              showFieldPreview={false}
            />
          </label>
          <button
            className="admin-btn admin-btn--primary"
            onClick={addExcludedDate}
          >
            添加排除日
          </button>
        </div>
        {activePlan.excludedDates.length > 0 ? (
          <ul
            className="admin-list"
            style={{ listStyle: "none", padding: 0, margin: "10px 0" }}
          >
            {activePlan.excludedDates.map((date) => (
              <li className="admin-item" key={date}>
                <div className="admin-item__info">
                  <span className="admin-item__name">{date}</span>
                </div>
                <div className="admin-item__actions">
                  <button
                    className="admin-item-btn admin-item-btn--delete"
                    onClick={() => removeExcludedDate(date)}
                  >
                    移除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-collapsed-hint">暂无整日排除</p>
        )}
          </section>
          <section>
        <h3>单次调整记录</h3>
        {activePlan.overrides.length > 0 ? (
          <ul
            className="admin-list"
            style={{ listStyle: "none", padding: 0, margin: "10px 0" }}
          >
            {activePlan.overrides.map((ov) => (
              <li className="admin-item" key={ov.id}>
                <div className="admin-item__info">
                  <span className="admin-item__name">
                    {ov.date} ·{" "}
                    {ov.action === "cancel"
                      ? "取消本次"
                      : ov.forceRunDuringMajorExam
                        ? "强制仍然进行"
                        : "临时调课"}
                    {ov.name ? `（${ov.name}）` : ""}
                  </span>
                  {ov.reason && (
                    <div
                      className="admin-item__times"
                      style={{ opacity: 0.7 }}
                    >
                      {ov.reason}
                    </div>
                  )}
                </div>
                <div className="admin-item__actions">
                  <button
                    className="admin-item-btn admin-item-btn--delete"
                    onClick={() => removeOverride(ov.id)}
                  >
                    撤销
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-collapsed-hint">暂无单次调整</p>
        )}
          </section>
        </div>
        <div className="admin-form-actions">
          <button
            className="admin-btn admin-btn--primary"
            onClick={() => setExceptionsOpen(false)}
          >
            完成
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
