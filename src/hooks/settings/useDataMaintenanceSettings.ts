import { useState } from "react";
import {
  getAppSettings,
  updateExamSettings,
  APP_SETTINGS_KEY,
} from "../../utils/appSettings";
import {
  saveExamsToServer,
  getCloudSnapshot,
  resetCloudData as _resetCloudDataService,
  type ResetCategory,
} from "../../services/examService";
import { formatApiError } from "../../services/apiError";
import { notify } from "../../services/notify";
import type { WeeklyPlan } from "../../types/exam";
import {
  addDaysToDateKey,
  createEmptyWeeklyPlan,
  getShanghaiDateKey,
} from "../../utils/weeklySchedule";

export function useDataMaintenanceSettings(canResetDatabase: boolean) {
  const [resetCategories, setResetCategories] = useState<string[]>([]);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resettingCloud, setResettingCloud] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  const toggleResetCategory = (category: string, checked: boolean) =>
    setResetCategories((current) => {
      if (category === "all") return checked ? ["all"] : [];
      return checked
        ? [...new Set([...current.filter((item) => item !== "all"), category])]
        : current.filter((item) => item !== category);
    });

  const resetCloudData = async () => {
    if (
      !canResetDatabase ||
      resetPhrase !== "重置数据库" ||
      !resetCategories.length
    ) {
      notify("warning", "请选择重置范围并输入“重置数据库”。");
      return;
    }
    setResettingCloud(true);
    try {
      await _resetCloudDataService(resetCategories as ResetCategory[]);
      notify("success", "所选云端数据已重置，即将重新载入初始化状态。");
      localStorage.removeItem(APP_SETTINGS_KEY);
      localStorage.removeItem("exam_pending_sync");
      window.setTimeout(() => window.location.assign("/"), 900);
    } catch (error) {
      notify("error", formatApiError(error, "重置失败"), "数据库操作失败");
      setResettingCloud(false);
    }
  };

  const updateDemoData = async (enable: boolean) => {
    const exam = getAppSettings().exam;
    if (!exam.grades[0] || !exam.classes[0]) {
      notify("warning", "请先完成学校、年级和班级初始化。");
      return;
    }
    setDemoBusy(true);
    const tomorrow = addDaysToDateKey(getShanghaiDateKey(Date.now()), 1);
    const demoMajor = {
      id: "demo_v2_major",
      name: "演示大型考试",
      order: exam.majors.length,
      targetGradeIds: [exam.grades[0].id],
      items: [
        {
          id: "demo_v2_exam_1",
          name: "语文",
          startTime: `${tomorrow}T08:30:00`,
          endTime: `${tomorrow}T10:30:00`,
          enabled: true,
          order: 0,
        },
        {
          id: "demo_v2_exam_2",
          name: "数学",
          startTime: `${tomorrow}T14:00:00`,
          endTime: `${tomorrow}T16:00:00`,
          enabled: true,
          order: 1,
        },
      ],
    };
    const basePlan = createEmptyWeeklyPlan(Date.now(), "演示周测计划");
    const demoPlan: WeeklyPlan = {
      ...basePlan,
      id: "demo_v2_weekly",
      gradeId: exam.classes[0].gradeId,
      classId: exam.classes[0].id,
      order: exam.weeklyPlans.length,
      weekMode: "ab",
      excludeOfficialHolidays: true,
      items: [
        {
          id: "demo_v2_weekly_1",
          name: "数学周测",
          weekday: 3,
          startTime: "19:00",
          endTime: "20:00",
          enabled: true,
          order: 0,
          weekType: "a",
        },
      ],
    };
    const majors = enable
      ? [
          ...exam.majors.filter((item) => !item.id.startsWith("demo_v2_")),
          demoMajor,
        ]
      : exam.majors.filter((item) => !item.id.startsWith("demo_v2_"));
    const weeklyPlansNext = enable
      ? [
          ...exam.weeklyPlans.filter((item) => !item.id.startsWith("demo_v2_")),
          demoPlan,
        ]
      : exam.weeklyPlans.filter((item) => !item.id.startsWith("demo_v2_"));
    const activeMajorId = majors.some((item) => item.id === exam.activeMajorId)
      ? exam.activeMajorId
      : majors[0]?.id || "";
    const activeWeeklyPlanIdByClassId = {
      ...exam.activeWeeklyPlanIdByClassId,
      [demoPlan.classId]: enable
        ? demoPlan.id
        : (weeklyPlansNext.find((item) => item.classId === demoPlan.classId)
            ?.id ?? null),
    };
    const initialization = { ...exam.initialization, demoDataImported: enable };
    const input = {
      items: majors.find((item) => item.id === activeMajorId)?.items || [],
      title: majors.find((item) => item.id === activeMajorId)?.name || "",
      majors,
      activeMajorId,
      alerts: getAppSettings().alerts,
      scheduleMode: exam.scheduleMode,
      weeklyPlans: weeklyPlansNext,
      activeWeeklyPlanId: exam.activeWeeklyPlanId,
      activeWeeklyPlanIdByClassId,
      grades: exam.grades,
      classes: exam.classes,
      weeklyConflictPolicy: exam.weeklyConflictPolicy,
      initialization,
    };
    try {
      const result = await saveExamsToServer({
        ...input,
        baseUpdatedAt: getCloudSnapshot()?.updatedAt ?? 0,
      });
      if (typeof result !== "number") {
        if (result && result !== "unauthorized" && result.kind === "error")
          throw result.error;
        throw new Error("演示数据同步失败，请刷新后重试");
      }
      updateExamSettings({ ...input, updatedAt: result });
      notify(
        "success",
        enable ? "演示考试与周测数据已导入。" : "演示数据已移除。",
      );
    } catch (error) {
      notify(
        "error",
        error instanceof Error ? error.message : "演示数据操作失败",
      );
    } finally {
      setDemoBusy(false);
    }
  };

  return {
    resetCategories,
    resetPhrase,
    setResetPhrase,
    resettingCloud,
    demoBusy,
    toggleResetCategory,
    resetCloudData,
    updateDemoData,
  };
}
