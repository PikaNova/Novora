import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAppSettings, updateExamSettings } from "../../utils/appSettings";
import {
  saveExamsToServer,
  getCloudSnapshot,
  adminCanClass,
  adminCanGrade,
  type AdminUserContext,
} from "../../services/examService";
import { sortedClasses, sortedGrades } from "../../utils/classSettings";
import { formatApiError } from "../../services/apiError";
import { notify } from "../../services/notify";
import type { WeeklyPlan } from "../../types/exam";

export function useWeeklyCalendarSettings(
  canEditWeekly: boolean,
  adminUser: AdminUserContext | null,
) {
  const navigate = useNavigate();
  const initialExam = useMemo(() => getAppSettings().exam, []);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>(
    initialExam.weeklyPlans,
  );
  const [calendarGradeId, setCalendarGradeId] = useState(
    initialExam.selectedGradeId || initialExam.grades[0]?.id || "",
  );
  const [calendarClassId, setCalendarClassId] = useState(
    initialExam.selectedClassId,
  );
  const [calendarPlanId, setCalendarPlanId] = useState(
    () =>
      initialExam.activeWeeklyPlanIdByClassId[initialExam.selectedClassId] ??
      initialExam.activeWeeklyPlanId ??
      "",
  );
  const [calendarSave, setCalendarSave] = useState("");
  const [calendarSaving, setCalendarSaving] = useState(false);
  const calendarSavingRef = useRef(false);

  const grades = useMemo(
    () =>
      sortedGrades(initialExam.grades).filter((grade) =>
        adminUser ? adminCanGrade(grade.id, adminUser) : true,
      ),
    [adminUser, initialExam],
  );
  const classes = useMemo(
    () =>
      sortedClasses(initialExam.classes, calendarGradeId).filter((item) =>
        adminUser ? adminCanClass(item.gradeId, item.id, adminUser) : true,
      ),
    [adminUser, initialExam, calendarGradeId],
  );
  const classPlans = weeklyPlans.filter(
    (plan) => plan.classId === calendarClassId,
  );
  const calendarPlan =
    classPlans.find((plan) => plan.id === calendarPlanId) ??
    classPlans[0] ??
    null;

  const selectCalendarClass = (classId: string) => {
    setCalendarClassId(classId);
    const exam = getAppSettings().exam;
    setCalendarPlanId(
      exam.activeWeeklyPlanIdByClassId[classId] ??
        weeklyPlans.find((plan) => plan.classId === classId)?.id ??
        "",
    );
  };

  const saveCalendarPlan = async (updates: Partial<WeeklyPlan>) => {
    if (!calendarPlan || !canEditWeekly || calendarSavingRef.current) return;
    calendarSavingRef.current = true;
    setCalendarSaving(true);
    const nextPlans = weeklyPlans.map((plan) =>
      plan.id === calendarPlan.id ? { ...plan, ...updates } : plan,
    );
    setWeeklyPlans(nextPlans);
    updateExamSettings({ weeklyPlans: nextPlans, updatedAt: Date.now() });
    setCalendarSave("正在保存到云端…");
    const exam = getAppSettings().exam;
    const input = {
      items: exam.items,
      title: exam.title,
      majors: exam.majors,
      activeMajorId: exam.activeMajorId,
      alerts: getAppSettings().alerts,
      scheduleMode: exam.scheduleMode,
      weeklyPlans: nextPlans,
      activeWeeklyPlanId: exam.activeWeeklyPlanId,
      activeWeeklyPlanIdByClassId: exam.activeWeeklyPlanIdByClassId,
      grades: exam.grades,
      classes: exam.classes,
      weeklyConflictPolicy: exam.weeklyConflictPolicy,
    };
    try {
      let persistedPlans = nextPlans;
      let result = await saveExamsToServer({
        ...input,
        baseUpdatedAt: getCloudSnapshot()?.updatedAt ?? 0,
      });
      if (
        result &&
        typeof result === "object" &&
        result.kind === "conflict" &&
        result.remote
      ) {
        const remote = result.remote;
        const mergedPlans = (remote.weeklyPlans ?? nextPlans).map((plan) =>
          plan.id === calendarPlan.id ? { ...plan, ...updates } : plan,
        );
        if (!mergedPlans.some((plan) => plan.id === calendarPlan.id))
          mergedPlans.push({ ...calendarPlan, ...updates });
        persistedPlans = mergedPlans;
        result = await saveExamsToServer({
          ...input,
          items: remote.items,
          title: remote.title,
          majors: remote.majors,
          activeMajorId: remote.activeMajorId,
          alerts: remote.alerts,
          scheduleMode: remote.scheduleMode ?? input.scheduleMode,
          weeklyPlans: mergedPlans,
          activeWeeklyPlanId:
            remote.activeWeeklyPlanId ?? input.activeWeeklyPlanId,
          activeWeeklyPlanIdByClassId:
            remote.activeWeeklyPlanIdByClassId ??
            input.activeWeeklyPlanIdByClassId,
          grades: remote.grades ?? input.grades,
          classes: remote.classes ?? input.classes,
          weeklyConflictPolicy:
            remote.weeklyConflictPolicy ?? input.weeklyConflictPolicy,
          baseUpdatedAt: remote.updatedAt,
        });
      }
      if (result === "unauthorized") {
        navigate("/login?next=/settings", { replace: true });
        return;
      }
      if (typeof result === "number") {
        setWeeklyPlans(persistedPlans);
        updateExamSettings({ weeklyPlans: persistedPlans, updatedAt: result });
        setCalendarSave("已保存到云端");
        notify("success", "周测日历设置已保存到云端。");
      } else {
        const message =
          result && result.kind === "error"
            ? formatApiError(result.error, "周测日历保存失败")
            : "周测日历保存失败，请刷新后重试。";
        setCalendarSave(message);
        notify("error", message, "保存失败");
      }
    } finally {
      calendarSavingRef.current = false;
      setCalendarSaving(false);
    }
  };

  return {
    grades,
    classes,
    calendarGradeId,
    setCalendarGradeId,
    calendarClassId,
    setCalendarClassId,
    selectCalendarClass,
    classPlans,
    calendarPlan,
    calendarPlanId,
    setCalendarPlanId,
    calendarSave,
    calendarSaving,
    saveCalendarPlan,
  };
}
