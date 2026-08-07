import React, { useMemo, useState } from "react";
import type { ExamItem } from "../types";
import type {
  ScheduleMode,
  WeeklyPlan,
  WeeklyConflictPolicy,
} from "../types/exam";
import {
  resolveWeeklyOccurrences,
  addDaysToDateKey,
  getShanghaiDateKey,
  getWeekTypeForDate,
  isoWeekdayOfDateKey,
} from "../utils/weeklySchedule";
import { resolveMajorWeeklyConflicts } from "../utils/scheduleConflict";
import { useBackdropDismiss } from "../hooks/useBackdropDismiss";
import { getOfficialHolidayName } from "../data/officialHolidays";
import { type PrintScheduleDocument } from "./SchedulePrintPreview";
import { type ClassPickerOption } from "./ClassMultiPicker";
import { CalendarDays } from "lucide-react";
import Mascot from "./Mascot";
import {
  useWeeklyPlanModal,
  type LastDeleted,
} from "../hooks/weekly/useWeeklyPlanModal";
import { useWeeklyItemModal } from "../hooks/weekly/useWeeklyItemModal";
import { useWeeklyImport } from "../hooks/weekly/useWeeklyImport";
import { useWeeklyExceptions } from "../hooks/weekly/useWeeklyExceptions";
import {
  useWeeklyBatchOps,
  lastLabelSegment,
} from "../hooks/weekly/useWeeklyBatchOps";
import {
  WEEKDAY_ORDER,
  weeklyPlanDetailName,
  type PreviewOcc,
} from "./weekly/weeklyShared";
import PlanFormModal from "./weekly/PlanFormModal";
import WeeklySidebar from "./weekly/WeeklySidebar";
import WeeklyItemsList from "./weekly/WeeklyItemsList";
import WeeklyCalendarPreview, {
  type WeeklyCalendarDay,
} from "./weekly/WeeklyCalendarPreview";
import ItemFormModal from "./weekly/ItemFormModal";
import ImportJsonModal from "./weekly/ImportJsonModal";
import ConflictPolicyModal from "./weekly/ConflictPolicyModal";
import ExceptionsModal from "./weekly/ExceptionsModal";
import CopyPlanModal from "./weekly/CopyPlanModal";
import ConflictResolutionModal from "./weekly/ConflictResolutionModal";
import RescheduleModal from "./weekly/RescheduleModal";
import PrintPickerModal from "./weekly/PrintPickerModal";
import DeletePlanModals from "./weekly/DeletePlanModals";

export interface WeeklyPanelProps {
  weeklyPlans: WeeklyPlan[];
  activeWeeklyPlanId: string | null;
  activeWeeklyPlanIdByClassId: Record<string, string | null>;
  selectedGradeId: string;
  selectedClassId: string;
  selectedClassName: string;
  classOptions: Array<{ id: string; gradeId: string; label: string }>;
  scheduleMode: ScheduleMode;
  weeklyConflictPolicy: WeeklyConflictPolicy;
  majorItems: ExamItem[];
  majorName: string;
  onSavePlans: (
    plans: WeeklyPlan[],
    activeId: string | null,
    classId: string,
    immediate?: boolean,
    activeByClass?: Record<string, string | null>,
  ) => void;
  onConflictPolicyChange: (
    policy: WeeklyConflictPolicy,
    immediate?: boolean,
  ) => void;
  onSelectScope?: (gradeId: string, classId: string) => void;
  allowBatchApply?: boolean;
  canEditConflictPolicy?: boolean;
}

export default function WeeklyPanel({
  weeklyPlans,
  activeWeeklyPlanId,
  activeWeeklyPlanIdByClassId,
  selectedGradeId,
  selectedClassId,
  selectedClassName,
  classOptions,
  scheduleMode,
  weeklyConflictPolicy,
  majorItems,
  majorName,
  onSavePlans,
  onConflictPolicyChange,
  onSelectScope,
  allowBatchApply = true,
  canEditConflictPolicy = false,
}: WeeklyPanelProps) {
  const backdropProps = useBackdropDismiss();
  const scopedPlans = weeklyPlans.filter((p) => p.classId === selectedClassId);
  const classActiveId = selectedClassId
    ? activeWeeklyPlanIdByClassId[selectedClassId]
    : activeWeeklyPlanId;
  const activePlan =
    scopedPlans.find((p) => p.id === classActiveId) ?? scopedPlans[0] ?? null;
  const items = activePlan?.items ?? [];
  const pickerOptions = useMemo<ClassPickerOption[]>(
    () =>
      classOptions.map((item) => ({
        id: item.id,
        gradeId: item.gradeId,
        gradeName: item.label.split(" · ")[0] || "未知年级",
        className: lastLabelSegment(item.label),
      })),
    [classOptions],
  );

  // ━━ 拆分为五个领域 hook（WeeklyPanel 仅负责编排与渲染） ━━
  const [lastDeleted, setLastDeleted] = useState<LastDeleted>(null);

  const planModal$ = useWeeklyPlanModal({
    weeklyPlans, activeWeeklyPlanIdByClassId, selectedGradeId, selectedClassId,
    selectedClassName, pickerOptions, activePlan, onSavePlans, onSelectScope, setLastDeleted,
  });
  const {
    planModal, setPlanModal, planWizardStep, setPlanWizardStep,
    planError, setPlanError, deletePlanOpen, setDeletePlanOpen,
    policyOpen, setPolicyOpen,
    openNewPlan, openPlanSettings, commitPlanModal, removePlan, togglePlanEnabled, switchPlan,
  } = planModal$;

  const itemModal$ = useWeeklyItemModal({
    weeklyPlans, activePlan, selectedClassId, items, onSavePlans, setLastDeleted,
  });
  const {
    editing, setEditing, itemWizardStep, setItemWizardStep,
    customWeeklySubjectActive, setCustomWeeklySubjectActive,
    editError, setEditError, weeklyTimeFlowOpen, setWeeklyTimeFlowOpen,
    deleteTarget, setDeleteTarget,
    openWeeklyTimeFlow, cancelWeeklyTimeFlow, commitItemModal, removeItem, toggleItemEnabled,
  } = itemModal$;

  const import$ = useWeeklyImport({
    weeklyPlans, activePlan, items, selectedClassId, pickerOptions,
    activeWeeklyPlanIdByClassId, onSavePlans,
  });
  const {
    importOpen, importText, setImportText,
    importError, importClassIds, setImportClassIds,
    importStep, setImportStep, importSummary,
    importExcludedIndexes, setImportExcludedIndexes,
    openImport, closeImport, validateImportJson, importJson, exportJson,
  } = import$;

  const exceptions$ = useWeeklyExceptions<PreviewOcc>({
    weeklyPlans, activePlan, selectedClassId, onSavePlans, setLastDeleted,
  });
  const {
    exceptionsOpen, setExceptionsOpen, newExcludeDate, setNewExcludeDate,
    conflictTarget, setConflictTarget, rescheduleTarget, setRescheduleTarget,
    rescheduleError, setRescheduleError, rescheduleTimeOpen, setRescheduleTimeOpen,
    removeOverride, addExcludedDate, removeExcludedDate,
    cancelOccurrence, openReschedule, commitReschedule, keepSuppressed,
    forceRunOccurrence,
  } = exceptions$;

  const batchOps$ = useWeeklyBatchOps({
    weeklyPlans, classOptions, activeWeeklyPlanIdByClassId, activePlan,
    selectedClassId, onSavePlans, setLastDeleted,
  });
  const {
    copyModal, setCopyModal, copyWizardStep, setCopyWizardStep,
    batchDeleteOpen, setBatchDeleteOpen, batchDeleteStep, setBatchDeleteStep,
    batchDeletePlanIds, setBatchDeletePlanIds,
    printOpen, setPrintOpen, printPickerOpen, setPrintPickerOpen,
    printPickerStep, setPrintPickerStep, printClassIds, setPrintClassIds,
    commitCopyPlan, removeSelectedPlans,
  } = batchOps$;
  const planPickerOptions = useMemo<ClassPickerOption[]>(
    () =>
      weeklyPlans.map((plan) => {
        const target = classOptions.find((item) => item.id === plan.classId);
        const [gradeName = "未知年级", className = "未知班级"] =
          target?.label.split(" · ") ?? [];
        const planDetail = weeklyPlanDetailName(
          plan.name,
          gradeName,
          className,
        );
        return {
          id: plan.id,
          gradeId: plan.gradeId,
          gradeName,
          className: `${className} · ${planDetail}（${plan.items.length} 条）`,
        };
      }),
    [classOptions, weeklyPlans],
  );
  const preview = useMemo((): PreviewOcc[] => {
    if (!activePlan) return [];
    const today = getShanghaiDateKey(Date.now());
    const daysBack = isoWeekdayOfDateKey(today) - 1;
    const occ = resolveWeeklyOccurrences(activePlan, Date.now(), {
      daysBack,
      daysForward: 13 + (7 - isoWeekdayOfDateKey(today)),
    });
    if (scheduleMode === "automatic" && majorItems.length) {
      const { suppressedWeekly, conflicts } = resolveMajorWeeklyConflicts(
        [
          {
            id: "major",
            name: majorName,
            items: majorItems,
            policy: weeklyConflictPolicy,
          },
        ],
        occ,
      );
      const suppressedIds = new Set(
        suppressedWeekly.map((o) => o.occurrenceId),
      );
      const conflictById = new Map(
        conflicts.map((c) => [c.weeklyOccurrenceId, c]),
      );
      return occ.map((o) => {
        const c = conflictById.get(o.occurrenceId);
        return {
          date: o.date,
          weekday: isoWeekdayOfDateKey(o.date),
          name: o.name,
          startTime: o.startTime.slice(11, 16),
          endTime: o.endTime.slice(11, 16),
          suppressed: suppressedIds.has(o.occurrenceId),
          forced: o.forced,
          weeklyItemId: o.weeklyItemId,
          message: c?.message,
          conflict: c
            ? {
                majorName: c.majorName,
                majorStartTime: c.majorStartTime,
                majorEndTime: c.majorEndTime,
                scope: c.type,
              }
            : undefined,
        };
      });
    }
    return occ.map((o) => ({
      date: o.date,
      weekday: isoWeekdayOfDateKey(o.date),
      name: o.name,
      startTime: o.startTime.slice(11, 16),
      endTime: o.endTime.slice(11, 16),
      suppressed: false,
      forced: o.forced,
      weeklyItemId: o.weeklyItemId,
    }));
  }, [activePlan, scheduleMode, majorItems, majorName, weeklyConflictPolicy]);

  const calendarWeeks = useMemo<WeeklyCalendarDay[][]>(() => {
    const today = getShanghaiDateKey(Date.now());
    const first = addDaysToDateKey(today, -(isoWeekdayOfDateKey(today) - 1));
    const allDays = Array.from({ length: 14 }, (_, index) => {
      const date = addDaysToDateKey(first, index);
      const officialHoliday = activePlan?.excludeOfficialHolidays
        ? getOfficialHolidayName(date)
        : null;
      const manuallyExcluded = !!activePlan?.excludedDates.includes(date);
      return {
        date,
        weekday: isoWeekdayOfDateKey(date),
        entries: preview.filter((item) => item.date === date),
        officialHoliday,
        manuallyExcluded,
        weekType:
          activePlan?.weekMode === "ab"
            ? getWeekTypeForDate(activePlan, date)
            : null,
      };
    });
    const showSaturday = allDays.some(
      (day) => day.weekday === 6 && day.entries.length > 0,
    );
    const showSunday = allDays.some(
      (day) => day.weekday === 7 && day.entries.length > 0,
    );
    const visibleDay = (day: (typeof allDays)[number]) =>
      day.weekday <= 5 || (day.weekday === 6 ? showSaturday : showSunday);
    return [0, 1].map((weekIndex) =>
      allDays.slice(weekIndex * 7, weekIndex * 7 + 7).filter(visibleDay),
    );
  }, [preview, activePlan]);
  const printSchedules = useMemo<PrintScheduleDocument[]>(
    () =>
      printClassIds.flatMap((classId) => {
        const planId = activeWeeklyPlanIdByClassId[classId];
        const plan =
          weeklyPlans.find(
            (item) => item.classId === classId && item.id === planId,
          ) ??
          weeklyPlans.find((item) => item.classId === classId && item.enabled);
        const target = pickerOptions.find((item) => item.id === classId);
        if (!plan || !target) return [];
        const occurrences = resolveWeeklyOccurrences(plan, Date.now(), {
          daysBack: 7,
          daysForward: 28,
        });
        return [
          {
            gradeName: target.gradeName,
            className: target.className,
            entries: occurrences.map((item) => ({
              date: item.date,
              name: item.name,
              startTime: item.startTime.slice(11, 16),
              endTime: item.endTime.slice(11, 16),
              note: item.forced ? "冲突时保留" : "",
            })),
          },
        ];
      }),
    [activeWeeklyPlanIdByClassId, pickerOptions, printClassIds, weeklyPlans],
  );

  if (!selectedGradeId || !selectedClassId) {
    return (
      <>
        <aside className="admin-sidebar">
          <div className="admin-tips">
            <p className="admin-tips__title">
              <CalendarDays size={16} />
              周测
            </p>
            <ul>
              <li>周测计划始终归属于一个具体班级。</li>
              <li>点击右侧按钮后，在新建界面依次选择年级和班级。</li>
            </ul>
          </div>
        </aside>
        <main className="admin-main">
          <div className="admin-list-header">
            <h2 className="admin-list-title">周测考试安排</h2>
            <button className="admin-btn" disabled title="请先选择年级与班级">
              A4 预览与下载 PDF
            </button>
          </div>
          <div className="admin-empty">
            <Mascot className="mascot-empty" size={64} alt="" />
            <div className="admin-empty__icon">
              <CalendarDays />
            </div>
            <p>请先选择年级与班级</p>
            <span className="admin-major-card__hint">
              也可以直接新建计划，并在新建界面选择适用班级。
            </span>
            <button
              className="admin-btn admin-btn--primary"
              style={{ marginTop: 12 }}
              onClick={openNewPlan}
            >
              选择班级并新建周测计划
            </button>
          </div>
        </main>
        <PlanFormModal
          backdropProps={backdropProps}
          planModal={planModal}
          setPlanModal={setPlanModal}
          planWizardStep={planWizardStep}
          setPlanWizardStep={setPlanWizardStep}
          planError={planError}
          setPlanError={setPlanError}
          commitPlanModal={commitPlanModal}
          classOptions={classOptions}
          pickerOptions={pickerOptions}
          allowBatchApply={allowBatchApply}
        />
      </>
    );
  }

  if (!activePlan) {
    return (
      <>
        <aside className="admin-sidebar">
          <div className="admin-tips">
            <p className="admin-tips__title">
              <CalendarDays size={16} />
              周测
            </p>
            <ul>
              <li>周测是每周固定重复的小测（如每周一/三/五晚自习测验）。</li>
              <li>先创建一个周测计划，再往里添加具体的周测项。</li>
              <li>大型考试期间可自动暂停周测（运行模式选“自动”）。</li>
            </ul>
          </div>
        </aside>
        <main className="admin-main">
          <div className="admin-list-header">
            <h2 className="admin-list-title">周测考试安排</h2>
            <button
              className="admin-btn"
              disabled
              title="当前班级还没有周测计划"
            >
              A4 预览与下载 PDF
            </button>
          </div>
          <div className="admin-empty">
            <Mascot className="mascot-empty" size={64} alt="" />
            <div className="admin-empty__icon">
              <CalendarDays />
            </div>
            <p>还没有周测计划</p>
            <button
              className="admin-btn admin-btn--primary"
              style={{ marginTop: 12 }}
              onClick={openNewPlan}
            >
              + 新建周测计划
            </button>
          </div>
        </main>
        <PlanFormModal
          backdropProps={backdropProps}
          planModal={planModal}
          setPlanModal={setPlanModal}
          planWizardStep={planWizardStep}
          setPlanWizardStep={setPlanWizardStep}
          planError={planError}
          setPlanError={setPlanError}
          commitPlanModal={commitPlanModal}
          classOptions={classOptions}
          pickerOptions={pickerOptions}
          allowBatchApply={allowBatchApply}
        />
      </>
    );
  }

  function restoreLastDeleted() {
    if (!lastDeleted) return;
    if (lastDeleted.kind === "plan") {
      const plans = [...weeklyPlans];
      plans.splice(Math.max(0, lastDeleted.index), 0, lastDeleted.plan);
      onSavePlans(
        plans.map((p, i) => ({ ...p, order: i })),
        lastDeleted.plan.id,
        lastDeleted.plan.classId,
        true,
      );
    } else if (lastDeleted.kind === "plans") {
      const plans = [...weeklyPlans];
      for (const item of [...lastDeleted.plans].sort(
        (left, right) => left.index - right.index,
      ))
        plans.splice(Math.min(item.index, plans.length), 0, item.plan);
      const restored = plans.map((plan, order) => ({ ...plan, order }));
      onSavePlans(
        restored,
        lastDeleted.activeByClass[selectedClassId] ?? null,
        selectedClassId,
        true,
        lastDeleted.activeByClass,
      );
    } else if (lastDeleted.kind === "item") {
      const plans = weeklyPlans.map((plan) => {
        if (plan.id !== lastDeleted.planId) return plan;
        const nextItems = [...plan.items];
        nextItems.splice(Math.max(0, lastDeleted.index), 0, lastDeleted.item);
        return {
          ...plan,
          items: nextItems.map((item, index) => ({ ...item, order: index })),
        };
      });
      onSavePlans(plans, lastDeleted.planId, selectedClassId, true);
    } else {
      removeOverride(lastDeleted.overrideId);
    }
    setLastDeleted(null);
  }

  const grouped = WEEKDAY_ORDER.map((wd) => ({
    wd,
    list: items
      .filter((i) => i.weekday === wd)
      .sort((a, b) => a.order - b.order),
  }));

  return (
    <>
      <WeeklySidebar
        selectedClassName={selectedClassName}
        scopedPlans={scopedPlans}
        activePlan={activePlan}
        items={items}
        switchPlan={switchPlan}
        openNewPlan={openNewPlan}
        openPlanSettings={openPlanSettings}
        setDeletePlanOpen={setDeletePlanOpen}
        togglePlanEnabled={togglePlanEnabled}
        allowBatchApply={allowBatchApply}
        setCopyModal={setCopyModal}
        weeklyConflictPolicy={weeklyConflictPolicy}
        canEditConflictPolicy={canEditConflictPolicy}
        setPolicyOpen={setPolicyOpen}
        setExceptionsOpen={setExceptionsOpen}
      />
      <main className="admin-main">
        <WeeklyItemsList
          activePlan={activePlan}
          items={items}
          grouped={grouped}
          lastDeleted={lastDeleted}
          restoreLastDeleted={restoreLastDeleted}
          openImport={openImport}
          exportJson={exportJson}
          allowBatchApply={allowBatchApply}
          setBatchDeletePlanIds={setBatchDeletePlanIds}
          setBatchDeleteOpen={setBatchDeleteOpen}
          setCustomWeeklySubjectActive={setCustomWeeklySubjectActive}
          setEditing={setEditing}
          setEditError={setEditError}
          toggleItemEnabled={toggleItemEnabled}
          setDeleteTarget={setDeleteTarget}
        />
        <WeeklyCalendarPreview
          calendarWeeks={calendarWeeks}
          preview={preview}
          allowBatchApply={allowBatchApply}
          selectedClassId={selectedClassId}
          setPrintClassIds={setPrintClassIds}
          setPrintPickerOpen={setPrintPickerOpen}
          setPrintOpen={setPrintOpen}
          setConflictTarget={setConflictTarget}
          openReschedule={openReschedule}
          cancelOccurrence={cancelOccurrence}
        />
      </main>

      <PlanFormModal
        backdropProps={backdropProps}
        planModal={planModal}
        setPlanModal={setPlanModal}
        planWizardStep={planWizardStep}
        setPlanWizardStep={setPlanWizardStep}
        planError={planError}
        setPlanError={setPlanError}
        commitPlanModal={commitPlanModal}
        classOptions={classOptions}
        pickerOptions={pickerOptions}
        allowBatchApply={allowBatchApply}
      />
      <DeletePlanModals
        backdropProps={backdropProps}
        deletePlanOpen={deletePlanOpen}
        setDeletePlanOpen={setDeletePlanOpen}
        activePlan={activePlan}
        itemsCount={items.length}
        removePlan={removePlan}
        allowBatchApply={allowBatchApply}
        batchDeleteOpen={batchDeleteOpen}
        setBatchDeleteOpen={setBatchDeleteOpen}
        batchDeleteStep={batchDeleteStep}
        setBatchDeleteStep={setBatchDeleteStep}
        batchDeletePlanIds={batchDeletePlanIds}
        setBatchDeletePlanIds={setBatchDeletePlanIds}
        planPickerOptions={planPickerOptions}
        removeSelectedPlans={removeSelectedPlans}
        deleteTarget={deleteTarget}
        setDeleteTarget={setDeleteTarget}
        removeItem={removeItem}
      />
      <ItemFormModal
        backdropProps={backdropProps}
        editing={editing}
        setEditing={setEditing}
        itemWizardStep={itemWizardStep}
        setItemWizardStep={setItemWizardStep}
        editError={editError}
        setEditError={setEditError}
        customWeeklySubjectActive={customWeeklySubjectActive}
        setCustomWeeklySubjectActive={setCustomWeeklySubjectActive}
        weeklyTimeFlowOpen={weeklyTimeFlowOpen}
        setWeeklyTimeFlowOpen={setWeeklyTimeFlowOpen}
        openWeeklyTimeFlow={openWeeklyTimeFlow}
        cancelWeeklyTimeFlow={cancelWeeklyTimeFlow}
        commitItemModal={commitItemModal}
        planWeekMode={activePlan.weekMode ?? "single"}
      />
      <ImportJsonModal
        backdropProps={backdropProps}
        importOpen={importOpen}
        closeImport={closeImport}
        importStep={importStep}
        setImportStep={setImportStep}
        importText={importText}
        setImportText={setImportText}
        importError={importError}
        validateImportJson={validateImportJson}
        importSummary={importSummary}
        importExcludedIndexes={importExcludedIndexes}
        setImportExcludedIndexes={setImportExcludedIndexes}
        importJson={importJson}
        importClassIds={importClassIds}
        setImportClassIds={setImportClassIds}
        allowBatchApply={allowBatchApply}
        pickerOptions={pickerOptions}
        selectedGradeId={selectedGradeId}
        selectedClassId={selectedClassId}
        selectedClassName={selectedClassName}
        classOptions={classOptions}
        activePlanName={activePlan.name}
      />
      <ConflictPolicyModal
        backdropProps={backdropProps}
        policyOpen={policyOpen}
        setPolicyOpen={setPolicyOpen}
        weeklyConflictPolicy={weeklyConflictPolicy}
        onConflictPolicyChange={onConflictPolicyChange}
      />
      <ExceptionsModal
        backdropProps={backdropProps}
        exceptionsOpen={exceptionsOpen}
        setExceptionsOpen={setExceptionsOpen}
        activePlan={activePlan}
        weeklyPlans={weeklyPlans}
        onSavePlans={onSavePlans}
        selectedClassId={selectedClassId}
        newExcludeDate={newExcludeDate}
        setNewExcludeDate={setNewExcludeDate}
        addExcludedDate={addExcludedDate}
        removeExcludedDate={removeExcludedDate}
        removeOverride={removeOverride}
      />
      <CopyPlanModal
        backdropProps={backdropProps}
        allowBatchApply={allowBatchApply}
        copyModal={copyModal}
        setCopyModal={setCopyModal}
        copyWizardStep={copyWizardStep}
        setCopyWizardStep={setCopyWizardStep}
        weeklyPlans={weeklyPlans}
        classOptions={classOptions}
        pickerOptions={pickerOptions}
        commitCopyPlan={commitCopyPlan}
      />
      <ConflictResolutionModal
        backdropProps={backdropProps}
        conflictTarget={conflictTarget}
        setConflictTarget={setConflictTarget}
        majorName={majorName}
        weeklyConflictPolicy={weeklyConflictPolicy}
        forceRunOccurrence={forceRunOccurrence}
        keepSuppressed={keepSuppressed}
      />
      <RescheduleModal
        backdropProps={backdropProps}
        rescheduleTarget={rescheduleTarget}
        setRescheduleTarget={setRescheduleTarget}
        rescheduleError={rescheduleError}
        setRescheduleError={setRescheduleError}
        rescheduleTimeOpen={rescheduleTimeOpen}
        setRescheduleTimeOpen={setRescheduleTimeOpen}
        commitReschedule={commitReschedule}
      />
      <PrintPickerModal
        backdropProps={backdropProps}
        printPickerOpen={printPickerOpen}
        setPrintPickerOpen={setPrintPickerOpen}
        printPickerStep={printPickerStep}
        setPrintPickerStep={setPrintPickerStep}
        printClassIds={printClassIds}
        setPrintClassIds={setPrintClassIds}
        pickerOptions={pickerOptions}
        selectedGradeId={selectedGradeId}
        printSchedules={printSchedules}
        printOpen={printOpen}
        setPrintOpen={setPrintOpen}
        preview={preview}
        classOptions={classOptions}
        selectedClassId={selectedClassId}
        selectedClassName={selectedClassName}
      />
    </>
  );
}
