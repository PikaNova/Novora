import InlineSelect from "../InlineSelect";
import HelpTip from "../HelpTip";
import { DateTimeField } from "../touch-datetime-picker";
import { Switch } from "./Switch";
import { OFFICIAL_HOLIDAYS } from "../../data/officialHolidays";
import type { WeeklyWeekMode } from "../../types/exam";
import type { AdminUserContext } from "../../services/examService";
import { useWeeklyCalendarSettings } from "../../hooks/settings/useWeeklyCalendarSettings";

export default function WeeklyCalendarSection({
  canEditWeekly,
  adminUser,
}: {
  canEditWeekly: boolean;
  adminUser: AdminUserContext | null;
}) {
  const {
    grades,
    classes,
    calendarGradeId,
    setCalendarGradeId,
    calendarClassId,
    setCalendarClassId,
    selectCalendarClass,
    classPlans,
    calendarPlan,
    setCalendarPlanId,
    calendarSave,
    calendarSaving,
    saveCalendarPlan,
  } = useWeeklyCalendarSettings(canEditWeekly, adminUser);

  return (
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">周测日历</h2>
          </div>
          <p className="set-card__lead">
            配置学期周次和法定节假日。学期开始日期所在周按 A
            周计算，下一周自动切换为 B 周。
          </p>
          <div className="set-fieldset">
            <div className="set-row">
              <label className="set-label">年级</label>
              <InlineSelect
                className="set-input"
                value={calendarGradeId}
                onChange={(value) => {
                  setCalendarGradeId(value);
                  setCalendarClassId("");
                }}
                options={[
                  { value: "", label: "请选择年级" },
                  ...grades.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
              />
            </div>
            <div className="set-row">
              <label className="set-label">班级</label>
              <InlineSelect
                className="set-input"
                value={calendarClassId}
                onChange={selectCalendarClass}
                options={[
                  { value: "", label: "请选择班级" },
                  ...classes.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
              />
            </div>
            {classPlans.length > 1 && (
              <div className="set-row">
                <label className="set-label">周测计划</label>
                <InlineSelect
                  className="set-input"
                  value={calendarPlan?.id ?? ""}
                  onChange={setCalendarPlanId}
                  options={classPlans.map((plan) => ({
                    value: plan.id,
                    label: plan.name,
                  }))}
                />
              </div>
            )}
            {calendarPlan ? (
              <>
                <div className="set-row">
                  <label className="set-label">
                    <span className="with-help-tip">
                      学期开始日期
                      <HelpTip title="A/B 周基准">
                        该日期所在周固定为 A 周，后续自然周按 A、B
                        交替推算。修改日期会立即反映到日历预览。
                      </HelpTip>
                    </span>
                  </label>
                  <DateTimeField
                    className="set-date-time-field"
                    disabled={!canEditWeekly || calendarSaving}
                    value={calendarPlan.anchorDate}
                    onChange={(value) => void saveCalendarPlan({ anchorDate: value })}
                    mode="date"
                    title="选择学期开始日期"
                    showFieldPreview={false}
                  />
                </div>
                <div className="set-row">
                  <label className="set-label">周次模式</label>
                  <InlineSelect
                    className="set-input"
                    disabled={!canEditWeekly || calendarSaving}
                    value={calendarPlan.weekMode ?? "single"}
                    onChange={(value) =>
                      void saveCalendarPlan({
                        weekMode: value as WeeklyWeekMode,
                      })
                    }
                    options={[
                      { value: "single", label: "统一周表" },
                      { value: "ab", label: "A/B 周交替" },
                    ]}
                  />
                </div>
                <div className="set-row">
                  <label className="set-label">法定节假日自动排除</label>
                  <Switch
                    checked={calendarPlan.excludeOfficialHolidays === true}
                    disabled={!canEditWeekly || calendarSaving}
                    onChange={(value) =>
                      void saveCalendarPlan({ excludeOfficialHolidays: value })
                    }
                  />
                </div>
                {calendarPlan.excludeOfficialHolidays && (
                  <p className="set-note set-holiday-list">
                    已启用：
                    {OFFICIAL_HOLIDAYS.map(
                      (item) =>
                        `${item.name} ${item.start.slice(5)}~${item.end.slice(5)}`,
                    ).join(" · ")}
                  </p>
                )}
                {calendarSave && (
                  <p className="set-note" aria-live="polite">
                    {calendarSave}
                  </p>
                )}
              </>
            ) : (
              <div className="set-note set-note--warn">
                当前班级还没有周测计划，请先到管理后台的“周测”页创建计划。
              </div>
            )}
          </div>
        </section>
  );
}
