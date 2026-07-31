import type { MutableRefObject } from "react";
import type { MajorExam } from "../../types";
import type { WeeklyState } from "./useWeeklyScheduleSync";
import { genClassId, genGradeId } from "../../types/school";
import { updateExamSettings } from "../../utils/appSettings";
import { notify } from "../../services/notify";

// Owns grade/class roster CRUD (add/remove grade, add/remove class(es),
// per-class track assignment). This is a thin forward-consumer of the
// weekly-schedule domain (grades/classes/weeklyPlans live in
// useWeeklyScheduleSync) and the major-exam domain (majors' targetGradeIds/
// targetClassIds must be pruned when a grade/class is deleted), so it needs
// both hooks' state and setters passed in.
export function useSchoolStructureActions(params: {
  weeklyStateRef: MutableRefObject<WeeklyState>;
  commitWeekly: (
    weekly: Partial<WeeklyState>,
    immediate?: boolean,
    syncLabel?: string,
  ) => void;
  grades: WeeklyState["grades"];
  classes: WeeklyState["classes"];
  weeklyPlans: WeeklyState["weeklyPlans"];
  selectedGradeId: string;
  selectedClassId: string;
  changeSelectedGrade: (gradeId: string) => void;
  changeSelectedClass: (classId: string) => void;
  majors: MajorExam[];
  setMajors: (ms: MajorExam[]) => void;
  activeMajorId: string;
  stateRef: MutableRefObject<{ majors: MajorExam[]; activeMajorId: string }>;
}) {
  const {
    weeklyStateRef,
    commitWeekly,
    grades,
    classes,
    weeklyPlans,
    selectedGradeId,
    selectedClassId,
    changeSelectedGrade,
    changeSelectedClass,
    majors,
    setMajors,
    activeMajorId,
    stateRef,
  } = params;

  const addGrade = (name: string) => {
    const item = {
      id: genGradeId(),
      name,
      order: grades.length,
      enabled: true,
    };
    commitWeekly({ grades: [...grades, item] }, true);
    if (!selectedGradeId) changeSelectedGrade(item.id);
  };
  const addClass = (gradeId: string, name: string) => {
    const item = {
      id: genClassId(),
      gradeId,
      name,
      order: classes.filter((value) => value.gradeId === gradeId).length,
      enabled: true,
    };
    commitWeekly(
      {
        classes: [...classes, item],
        activeWeeklyPlanIdByClassId: {
          ...weeklyStateRef.current.activeWeeklyPlanIdByClassId,
          [item.id]: null,
        },
      },
      true,
    );
  };
  const addClasses = (gradeId: string, names: string[]) => {
    if (!names.length) return;
    const start = classes.filter((value) => value.gradeId === gradeId).length;
    const created = names.map((name, index) => ({
      id: genClassId(),
      gradeId,
      name,
      order: start + index,
      enabled: true,
    }));
    const nextActive = {
      ...weeklyStateRef.current.activeWeeklyPlanIdByClassId,
      ...Object.fromEntries(created.map((item) => [item.id, null])),
    };
    commitWeekly(
      { classes: [...classes, ...created], activeWeeklyPlanIdByClassId: nextActive },
      true,
    );
    notify("success", `已创建 ${created.length} 个班级。`);
  };
  const removeClass = (classId: string) => {
    const nextMap = { ...weeklyStateRef.current.activeWeeklyPlanIdByClassId };
    delete nextMap[classId];
    const nextPlans = weeklyPlans.filter((plan) => plan.classId !== classId);
    const nextMajors = majors.map((major) => ({
      ...major,
      targetClassIds: major.targetClassIds?.filter((id) => id !== classId),
    }));
    if (selectedClassId === classId) changeSelectedClass("");
    setMajors(nextMajors);
    stateRef.current = { majors: nextMajors, activeMajorId };
    updateExamSettings({ majors: nextMajors });
    const removedClass = classes.find((item) => item.id === classId);
    commitWeekly(
      { classes: classes.filter((item) => item.id !== classId), weeklyPlans: nextPlans, activeWeeklyPlanIdByClassId: nextMap },
      true,
      removedClass ? `删除班级「${removedClass.name}」` : "删除班级",
    );
  };
  const removeClasses = (classIds: string[]) => {
    const removing = new Set(classIds);
    const nextMap = { ...weeklyStateRef.current.activeWeeklyPlanIdByClassId };
    removing.forEach((id) => delete nextMap[id]);
    const nextMajors = majors.map((major) => ({
      ...major,
      targetClassIds: major.targetClassIds?.filter((id) => !removing.has(id)),
    }));
    if (removing.has(selectedClassId)) changeSelectedClass("");
    setMajors(nextMajors);
    stateRef.current = { majors: nextMajors, activeMajorId };
    updateExamSettings({ majors: nextMajors });
    const removedNames = classes.filter((item) => removing.has(item.id)).map((item) => item.name);
    commitWeekly(
      {
        classes: classes.filter((item) => !removing.has(item.id)),
        weeklyPlans: weeklyPlans.filter((plan) => !removing.has(plan.classId)),
        activeWeeklyPlanIdByClassId: nextMap,
      },
      true,
      `批量删除 ${removing.size} 个班级（${removedNames.slice(0, 5).join("、")}${removedNames.length > 5 ? "等" : ""}）`,
    );
    notify("success", `已删除 ${removing.size} 个班级及其关联计划。`);
  };
  const removeGrade = (gradeId: string) => {
    const classIds = new Set(
      classes.filter((item) => item.gradeId === gradeId).map((item) => item.id),
    );
    const nextMap = { ...weeklyStateRef.current.activeWeeklyPlanIdByClassId };
    classIds.forEach((id) => delete nextMap[id]);
    const nextMajors = majors.map((major) => ({
      ...major,
      targetGradeIds: major.targetGradeIds?.filter((id) => id !== gradeId),
      targetClassIds: major.targetClassIds?.filter((id) => !classIds.has(id)),
    }));
    if (selectedGradeId === gradeId) changeSelectedGrade("");
    setMajors(nextMajors);
    stateRef.current = { majors: nextMajors, activeMajorId };
    updateExamSettings({ majors: nextMajors });
    const removedGrade = grades.find((item) => item.id === gradeId);
    commitWeekly(
      {
        grades: grades.filter((item) => item.id !== gradeId),
        classes: classes.filter((item) => item.gradeId !== gradeId),
        weeklyPlans: weeklyPlans.filter((plan) => !classIds.has(plan.classId)),
        activeWeeklyPlanIdByClassId: nextMap,
      },
      true,
      removedGrade ? `删除年级「${removedGrade.name}」` : "删除年级",
    );
  };
  const updateClassesTrack = (classIds: string[], track: string[]) => {
    const idSet = new Set(classIds);
    const nextClasses = classes.map((item) =>
      idSet.has(item.id) ? { ...item, track: track.length ? track : undefined } : item,
    );
    commitWeekly(
      { classes: nextClasses },
      true,
      classIds.length > 1 ? `设置 ${classIds.length} 个班级选科` : "设置班级选科",
    );
  };

  return {
    addGrade,
    addClass,
    addClasses,
    removeClass,
    removeClasses,
    removeGrade,
    updateClassesTrack,
  };
}
