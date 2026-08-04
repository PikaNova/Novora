import { useState } from "react";
import type { WeeklyExamOverride, WeeklyPlan } from "../../types/exam";
import { genWeeklyOverrideId } from "../../utils/weeklySchedule";
import { DATE_RE, HM_RE, padHM } from "../../utils/settings/weekly";
import { confirmDialog } from "../../services/appDialog";
import { notify } from "../../services/notify";
import type { LastDeleted } from "./useWeeklyPlanModal";

export interface WeeklyRescheduleTarget<TConflict> {
  occ: TConflict;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** \u4f9d\u8d56\u5468\u6d4b\u5355\u6b21\u4f8b\u5916\u7684\u6700\u5c0f\u5b57\u6bb5\u96c6\u5408\uff1a\u5355\u6b21\u53d6\u6d88/\u8c03\u8bfe/\u5f3a\u5236\u8fdb\u884c\u90fd\u9700\u8981\u8fd9\u4e9b\u5b57\u6bb5\u3002 */
export interface WeeklyOccurrenceLike {
  weeklyItemId: string;
  date: string;
  name: string;
  startTime: string;
  endTime: string;
}

interface UseWeeklyExceptionsArgs {
  weeklyPlans: WeeklyPlan[];
  activePlan: WeeklyPlan | null;
  selectedClassId: string;
  onSavePlans: (
    plans: WeeklyPlan[],
    activeId: string | null,
    classId: string,
    immediate?: boolean,
  ) => void;
  setLastDeleted: React.Dispatch<React.SetStateAction<LastDeleted>>;
}

/** \u5355\u6b21\u4f8b\u5916\uff08\u53d6\u6d88/\u8c03\u8bfe/\u51b2\u7a81\u5f3a\u5236\u8fdb\u884c\uff09\u7684\u72b6\u6001\u4e0e\u5904\u7406\u51fd\u6570\u3002\u4ece WeeklyPanel.tsx \u8fc1\u5165\uff0c\u4fdd\u6301\u4e0e\u539f\u6709\u903b\u8f91\u5b8c\u5168\u4e00\u81f4\u3002 */
export function useWeeklyExceptions<TConflict extends WeeklyOccurrenceLike>({
  weeklyPlans,
  activePlan,
  selectedClassId,
  onSavePlans,
  setLastDeleted,
}: UseWeeklyExceptionsArgs) {
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [newExcludeDate, setNewExcludeDate] = useState("");
  const [conflictTarget, setConflictTarget] = useState<TConflict | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<
    WeeklyRescheduleTarget<TConflict> | null
  >(null);
  const [rescheduleError, setRescheduleError] = useState("");
  const [rescheduleTimeOpen, setRescheduleTimeOpen] = useState(false);

  const upsertOverride = (next: WeeklyExamOverride) => {
    if (!activePlan) return;
    const exists = activePlan.overrides.some((o) => o.id === next.id);
    const overrides = exists
      ? activePlan.overrides.map((o) => (o.id === next.id ? next : o))
      : [...activePlan.overrides, next];
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id ? { ...p, overrides } : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  };

  const removeOverride = (id: string) => {
    if (!activePlan) return;
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id
        ? { ...p, overrides: p.overrides.filter((o) => o.id !== id) }
        : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  };

  const addExcludedDate = () => {
    if (!activePlan) return;
    if (
      !DATE_RE.test(newExcludeDate) ||
      activePlan.excludedDates.includes(newExcludeDate)
    )
      return;
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id
        ? { ...p, excludedDates: [...p.excludedDates, newExcludeDate].sort() }
        : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
    setNewExcludeDate("");
  };

  const removeExcludedDate = (date: string) => {
    if (!activePlan) return;
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id
        ? { ...p, excludedDates: p.excludedDates.filter((d) => d !== date) }
        : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  };

  const cancelOccurrence = async (o: TConflict) => {
    if (
      !(await confirmDialog({
        title: "\u53d6\u6d88\u672c\u6b21\u5468\u6d4b",
        message: `\u786e\u5b9a\u53d6\u6d88\u300c${o.name}\u300d${o.date} \u8fd9\u4e00\u6b21\u5417\uff1f\n\u6b64\u64cd\u4f5c\u4ec5\u5f71\u54cd\u8fd9\u4e00\u6b21\uff0c\u4e0d\u5f71\u54cd\u5468\u671f\u89c4\u5219\u3002`,
        tone: "warning",
        confirmLabel: "\u786e\u8ba4\u53d6\u6d88",
      }))
    )
      return;
    const overrideId = genWeeklyOverrideId(o.weeklyItemId, o.date);
    upsertOverride({
      id: overrideId,
      sourceItemId: o.weeklyItemId,
      date: o.date,
      action: "cancel",
      reason: "\u7ba1\u7406\u5458\u5355\u6b21\u53d6\u6d88",
    });
    setLastDeleted({
      kind: "occurrence",
      overrideId,
      name: `${o.date} ${o.name}`,
    });
  };

  const openReschedule = (o: TConflict) => {
    setRescheduleTarget({
      occ: o,
      name: o.name,
      date: o.date,
      startTime: o.startTime,
      endTime: o.endTime,
    });
    setRescheduleError("");
  };

  const commitReschedule = () => {
    if (!rescheduleTarget) return;
    const { occ, name, date, startTime, endTime } = rescheduleTarget;
    if (!name.trim()) {
      setRescheduleError("\u8bf7\u8f93\u5165\u540d\u79f0");
      return;
    }
    if (!DATE_RE.test(date)) {
      setRescheduleError("\u8bf7\u586b\u5199\u6b63\u786e\u65e5\u671f");
      return;
    }
    if (!HM_RE.test(startTime) || !HM_RE.test(endTime)) {
      setRescheduleError("\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u65f6\u95f4\uff08HH:mm\uff09");
      return;
    }
    if (padHM(endTime) <= padHM(startTime)) {
      setRescheduleError("\u7ed3\u675f\u65f6\u95f4\u5fc5\u987b\u665a\u4e8e\u5f00\u59cb\u65f6\u95f4\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9\u3002");
      return;
    }
    upsertOverride({
      id: genWeeklyOverrideId(occ.weeklyItemId, occ.date),
      sourceItemId: occ.weeklyItemId,
      date: occ.date,
      targetDate: date,
      action: "replace",
      name: name.trim(),
      startTime: padHM(startTime),
      endTime: padHM(endTime),
      reason: "\u7ba1\u7406\u5458\u4e34\u65f6\u8c03\u8bfe",
    });
    notify(
      "success",
      date === occ.date ? "\u672c\u6b21\u5468\u6d4b\u65f6\u95f4\u5df2\u8c03\u6574\u3002" : `\u672c\u6b21\u5468\u6d4b\u5df2\u8c03\u81f3 ${date}\u3002`,
    );
    setRescheduleTarget(null);
  };

  const keepSuppressed = () => {
    setConflictTarget(null);
  };

  const forceRunOccurrence = () => {
    if (!conflictTarget) return;
    upsertOverride({
      id: genWeeklyOverrideId(conflictTarget.weeklyItemId, conflictTarget.date),
      sourceItemId: conflictTarget.weeklyItemId,
      date: conflictTarget.date,
      action: "replace",
      forceRunDuringMajorExam: true,
      reason: "\u7ba1\u7406\u5458\u786e\u8ba4\u4ecd\u7136\u8fdb\u884c",
    });
    setConflictTarget(null);
  };

  const unforceOccurrence = (o: TConflict) => {
    removeOverride(genWeeklyOverrideId(o.weeklyItemId, o.date));
  };

  return {
    exceptionsOpen,
    setExceptionsOpen,
    newExcludeDate,
    setNewExcludeDate,
    conflictTarget,
    setConflictTarget,
    rescheduleTarget,
    setRescheduleTarget,
    rescheduleError,
    setRescheduleError,
    rescheduleTimeOpen,
    setRescheduleTimeOpen,
    upsertOverride,
    removeOverride,
    addExcludedDate,
    removeExcludedDate,
    cancelOccurrence,
    openReschedule,
    commitReschedule,
    keepSuppressed,
    forceRunOccurrence,
    unforceOccurrence,
  };
}
