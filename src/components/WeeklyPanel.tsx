import React, { useEffect, useMemo, useState } from "react";
import type { ExamItem } from "../types";
import type {
  ScheduleMode,
  WeeklyPlan,
  WeeklyExamItem,
  WeeklyExamOverride,
  WeeklyConflictPolicy,
  IsoWeekday,
  WeeklyWeekMode,
  WeeklyWeekType,
} from "../types/exam";
import { ALL_CONFLICT_SCOPES } from "../types/exam";
import {
  createEmptyWeeklyPlan,
  genWeeklyItemId,
  genWeeklyOverrideId,
  resolveWeeklyOccurrences,
  addDaysToDateKey,
  getShanghaiDateKey,
  getWeekTypeForDate,
  genWeeklyPlanId,
  isoWeekdayOfDateKey,
  normalizeWeeklyPlan,
} from "../utils/weeklySchedule";
import { resolveMajorWeeklyConflicts } from "../utils/scheduleConflict";
import { useBackdropDismiss } from "../hooks/useBackdropDismiss";
import {
  getOfficialHolidayName,
  OFFICIAL_HOLIDAYS,
} from "../data/officialHolidays";
import HelpTip from "./HelpTip";
import SubjectIcon from "./SubjectIcon";
import SchedulePrintPreview, {
  type PrintScheduleDocument,
} from "./SchedulePrintPreview";
import { confirmDialog } from "../services/appDialog";
import { notify } from "../services/notify";
import AiImportGuide from "./AiImportGuide";
import ClassMultiPicker, { type ClassPickerOption } from "./ClassMultiPicker";
import AdminWizardSteps, { AdminWorkflowClose } from "./AdminWizardSteps";
import InlineSelect from "./InlineSelect";
import { DateTimeField } from "./touch-datetime-picker";
import { CalendarDays, CircleHelp } from "lucide-react";
import TimeRangePickerModal from "./TimeRangePickerModal";

const WEEKDAY_LABEL: Record<IsoWeekday, string> = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日",
};
const WEEKDAY_ORDER: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const COMMON_WEEKLY_SUBJECTS = [
  "语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理", "信息技术", "体育", "音乐", "美术",
];
const CUSTOM_WEEKLY_SUBJECT = "__custom_weekly_subject__";
const SCOPE_LABEL: Record<WeeklyConflictPolicy["scope"], string> = {
  "time-overlap": "仅实际时间重叠时暂停周测",
  "whole-day": "大型考试当天暂停全部周测（推荐）",
  "whole-major-period": "大型考试整个考期暂停全部周测",
};

type ItemEdit = Omit<WeeklyExamItem, "id" | "order"> & { id?: string };
type PlanModal = {
  mode: "add" | "settings";
  name: string;
  gradeId: string;
  classIds: string[];
  activeFrom: string;
  activeUntil: string;
  anchorDate: string;
  forever: boolean;
  repeatEveryWeeks: number;
  weekMode: WeeklyWeekMode;
  excludeOfficialHolidays: boolean;
} | null;
type PreviewOcc = {
  date: string;
  weekday: IsoWeekday;
  name: string;
  startTime: string;
  endTime: string;
  suppressed: boolean;
  forced: boolean;
  weeklyItemId: string;
  message?: string;
  conflict?: {
    majorName: string;
    majorStartTime: string;
    majorEndTime: string;
    scope: string;
  };
};
function fmtDT(iso?: string) {
  return iso ? iso.slice(0, 16).replace("T", " ") : "—";
}
function lastLabelSegment(label: string): string {
  const parts = label.split(" · ");
  return parts[parts.length - 1] || label;
}

function weeklyPlanDetailName(
  planName: string,
  gradeName: string,
  className: string,
): string {
  const original = planName.trim();
  let detail = original;
  const prefixes = [`${gradeName} · ${className}`, className].filter(Boolean);

  // Older copied plans may already contain their grade/class prefix. Strip
  // every repeated prefix because the picker renders ownership separately.
  for (let pass = 0; pass < 4; pass += 1) {
    const prefix = prefixes.find((candidate) => {
      if (!detail.startsWith(candidate)) return false;
      const remainder = detail.slice(candidate.length);
      return /^[\s·\-—_/]+/u.test(remainder);
    });
    if (!prefix) break;
    detail = detail.slice(prefix.length).replace(/^[\s·\-—_/]+/u, "").trim();
  }

  return detail || original;
}

function makeItemId() {
  return genWeeklyItemId();
}
function padHM(v: string) {
  const [h = "0", m = "0"] = v.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}
function sortWeeklyItems(list: WeeklyExamItem[]): WeeklyExamItem[] {
  return [...list]
    .sort(
      (a, b) =>
        a.weekday - b.weekday ||
        a.startTime.localeCompare(b.startTime) ||
        a.endTime.localeCompare(b.endTime) ||
        a.name.localeCompare(b.name, "zh-CN"),
    )
    .map((item, order) => ({ ...item, order }));
}
const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_TYPE_LABEL: Record<WeeklyWeekType, string> = {
  all: "每周",
  a: "A 周",
  b: "B 周",
};
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
}: WeeklyPanelProps) {
  const backdropProps = useBackdropDismiss();
  const scopedPlans = weeklyPlans.filter((p) => p.classId === selectedClassId);
  const classActiveId = selectedClassId
    ? activeWeeklyPlanIdByClassId[selectedClassId]
    : activeWeeklyPlanId;
  const activePlan =
    scopedPlans.find((p) => p.id === classActiveId) ?? scopedPlans[0] ?? null;
  const items = activePlan?.items ?? [];

  const [planModal, setPlanModal] = useState<PlanModal>(null);
  const [planWizardStep, setPlanWizardStep] = useState(0);
  const [planError, setPlanError] = useState("");
  const [deletePlanOpen, setDeletePlanOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [editing, setEditing] = useState<ItemEdit | null>(null);
  const [itemWizardStep, setItemWizardStep] = useState(0);
  const [customWeeklySubjectActive, setCustomWeeklySubjectActive] = useState(false);
  const [editError, setEditError] = useState("");
  const [weeklyTimeFlowOpen, setWeeklyTimeFlowOpen] = useState(false);
  const [weeklyTimeFlowInitialStart, setWeeklyTimeFlowInitialStart] = useState("");
  const [weeklyTimeFlowInitialEnd, setWeeklyTimeFlowInitialEnd] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WeeklyExamItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importClassIds, setImportClassIds] = useState<string[]>([]);
  const [importStep, setImportStep] = useState<"paste" | "targets">("paste");
  const [importSummary, setImportSummary] = useState<{
    itemCount: number;
    planName?: string;
  } | null>(null);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [newExcludeDate, setNewExcludeDate] = useState("");
  const [conflictTarget, setConflictTarget] = useState<PreviewOcc | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<{
    occ: PreviewOcc;
    name: string;
    date: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const [rescheduleError, setRescheduleError] = useState("");
  const [rescheduleTimeOpen, setRescheduleTimeOpen] = useState(false);
  const [copyModal, setCopyModal] = useState<{
    sourcePlanId: string;
    targetClassIds: string[];
    name: string;
  } | null>(null);
  const [copyWizardStep, setCopyWizardStep] = useState(0);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleteStep, setBatchDeleteStep] = useState(0);
  const [batchDeletePlanIds, setBatchDeletePlanIds] = useState<string[]>([]);
  const [printOpen, setPrintOpen] = useState(false);
  const [printPickerOpen, setPrintPickerOpen] = useState(false);
  const [printPickerStep, setPrintPickerStep] = useState(0);
  const [printClassIds, setPrintClassIds] = useState<string[]>([]);
  useEffect(() => {
    if (planModal) setPlanWizardStep(0);
  }, [planModal?.mode]);
  useEffect(() => {
    if (editing) setItemWizardStep(0);
  }, [editing !== null]);
  useEffect(() => {
    if (copyModal) setCopyWizardStep(0);
  }, [copyModal !== null]);
  useEffect(() => {
    if (batchDeleteOpen) setBatchDeleteStep(0);
  }, [batchDeleteOpen]);
  useEffect(() => {
    if (printPickerOpen) setPrintPickerStep(0);
  }, [printPickerOpen]);
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
  const [lastDeleted, setLastDeleted] = useState<
    | { kind: "plan"; plan: WeeklyPlan; index: number }
    | {
        kind: "plans";
        plans: Array<{ plan: WeeklyPlan; index: number }>;
        activeByClass: Record<string, string | null>;
      }
    | { kind: "item"; item: WeeklyExamItem; index: number; planId: string }
    | { kind: "occurrence"; overrideId: string; name: string }
    | null
  >(null);

  const openWeeklyTimeFlow = () => {
    if (!editing) return;
    setWeeklyTimeFlowInitialStart(editing.startTime);
    setWeeklyTimeFlowInitialEnd(editing.endTime);
    setWeeklyTimeFlowOpen(true);
  };

  const cancelWeeklyTimeFlow = () => {
    setEditing((item) =>
      item
        ? {
            ...item,
            startTime: weeklyTimeFlowInitialStart,
            endTime: weeklyTimeFlowInitialEnd,
          }
        : item,
    );
    setWeeklyTimeFlowOpen(false);
  };

  const openNewPlan = () => {
    const today = getShanghaiDateKey(Date.now());
    setPlanModal({
      mode: "add",
      name:
        selectedClassName && selectedClassId
          ? `${selectedClassName}周测计划`
          : "",
      gradeId: selectedGradeId,
      classIds: selectedClassId ? [selectedClassId] : [],
      activeFrom: today,
      activeUntil: "",
      anchorDate: today,
      forever: true,
      repeatEveryWeeks: 1,
      weekMode: "single",
      excludeOfficialHolidays: false,
    });
    setPlanError("");
  };

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

  const calendarWeeks = useMemo(() => {
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
        {planModal && renderPlanModal()}
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
        {planModal && renderPlanModal()}
      </>
    );
  }

  function commitPlanModal() {
    if (!planModal) return;
    const name = planModal.name.trim();
    if (!name) {
      setPlanError("请输入计划名称");
      return;
    }
    if (!planModal.gradeId || !planModal.classIds.length) {
      setPlanError("请至少选择一个适用班级");
      return;
    }
    if (!DATE_RE.test(planModal.activeFrom)) {
      setPlanError("请填写生效日期");
      return;
    }
    if (!DATE_RE.test(planModal.anchorDate)) {
      setPlanError("请填写学期开始日期");
      return;
    }
    if (
      !planModal.forever &&
      planModal.activeUntil &&
      planModal.activeUntil < planModal.activeFrom
    ) {
      setPlanError("结束日期不得早于生效日期");
      return;
    }
    const repeat = Math.min(
      8,
      Math.max(1, Math.round(planModal.repeatEveryWeeks) || 1),
    );
    if (planModal.mode === "add") {
      const created = planModal.classIds.map((classId, offset) => {
        const target = pickerOptions.find((item) => item.id === classId)!;
        const className = target?.className || "班级";
        const planName =
          planModal.classIds.length > 1
            ? name.includes(selectedClassName) && selectedClassName
              ? name.replace(selectedClassName, className)
              : `${className} · ${name}`
            : name;
        return {
          ...createEmptyWeeklyPlan(Date.now() + offset, planName),
          gradeId: target.gradeId,
          classId,
          activeFrom: planModal.activeFrom,
          activeUntil: planModal.forever ? null : planModal.activeUntil || null,
          anchorDate: planModal.anchorDate,
          repeatEveryWeeks: repeat,
          weekMode: planModal.weekMode,
          excludeOfficialHolidays: planModal.excludeOfficialHolidays,
          order: weeklyPlans.length + offset,
        };
      });
      const activeByClass = {
        ...activeWeeklyPlanIdByClassId,
        ...Object.fromEntries(created.map((plan) => [plan.classId, plan.id])),
      };
      onSavePlans(
        [...weeklyPlans, ...created],
        created[0].id,
        created[0].classId,
        true,
        activeByClass,
      );
      onSelectScope?.(created[0].gradeId, created[0].classId);
      notify(
        "success",
        created.length > 1
          ? `已为 ${created.length} 个班级创建独立周测计划。`
          : "周测计划已创建。",
      );
    } else {
      const plans = weeklyPlans.map((p) =>
        p.id === activePlan.id
          ? {
              ...p,
              name,
              activeFrom: planModal.activeFrom,
              activeUntil: planModal.forever
                ? null
                : planModal.activeUntil || null,
              anchorDate: planModal.anchorDate,
              repeatEveryWeeks: repeat,
              weekMode: planModal.weekMode,
              excludeOfficialHolidays: planModal.excludeOfficialHolidays,
            }
          : p,
      );
      onSavePlans(plans, activePlan.id, selectedClassId, true);
    }
    setPlanModal(null);
    setPlanError("");
  }

  function removePlan() {
    const index = weeklyPlans.findIndex((p) => p.id === activePlan.id);
    const rest = weeklyPlans
      .filter((p) => p.id !== activePlan.id)
      .map((p, i) => ({ ...p, order: i }));
    const nextId = rest.find((p) => p.classId === selectedClassId)?.id ?? null;
    setLastDeleted({ kind: "plan", plan: activePlan, index });
    onSavePlans(rest, nextId, selectedClassId, true);
    setDeletePlanOpen(false);
  }

  async function removeSelectedPlans() {
    if (!batchDeletePlanIds.length) return;
    const selected = new Set(batchDeletePlanIds);
    const removed = weeklyPlans.flatMap((plan, index) =>
      selected.has(plan.id) ? [{ plan, index }] : [],
    );
    if (!removed.length) return;
    if (
      !(await confirmDialog({
        title: `删除 ${removed.length} 个周测计划`,
        message:
          "所选计划及其中的全部周测、例外日期和临时调整都会删除。此操作可在页面顶部整批撤销。",
        tone: "danger",
        confirmLabel: "批量删除",
      }))
    )
      return;
    const remaining = weeklyPlans
      .filter((plan) => !selected.has(plan.id))
      .map((plan, order) => ({ ...plan, order }));
    const nextActiveByClass = { ...activeWeeklyPlanIdByClassId };
    for (const classId of new Set(removed.map((item) => item.plan.classId))) {
      if (selected.has(nextActiveByClass[classId] ?? ""))
        nextActiveByClass[classId] =
          remaining.find((plan) => plan.classId === classId)?.id ?? null;
    }
    setLastDeleted({
      kind: "plans",
      plans: removed,
      activeByClass: { ...activeWeeklyPlanIdByClassId },
    });
    onSavePlans(
      remaining,
      nextActiveByClass[selectedClassId] ?? null,
      selectedClassId,
      true,
      nextActiveByClass,
    );
    setBatchDeleteOpen(false);
    setBatchDeletePlanIds([]);
    notify("success", `已删除 ${removed.length} 个周测计划。`);
  }

  function togglePlanEnabled() {
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id ? { ...p, enabled: !p.enabled } : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  function switchPlan(id: string) {
    if (id === activePlan.id) return;
    onSavePlans(weeklyPlans, id, selectedClassId, true);
  }

  function commitItemModal() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      setEditError("请输入周测名称");
      return;
    }
    if (!HM_RE.test(editing.startTime) || !HM_RE.test(editing.endTime)) {
      setEditError("请输入正确的时间（HH:mm）");
      return;
    }
    const start = padHM(editing.startTime);
    const end = padHM(editing.endTime);
    if (!editing.endNextDay && end <= start) {
      setEditError("结束时间必须晚于开始时间；跨日安排请在“时间设置”中勾选启用跨日考试。");
      return;
    }
    let nextItems: WeeklyExamItem[];
    if (editing.id) {
      nextItems = items.map((x) =>
        x.id === editing.id
          ? {
              ...x,
              ...editing,
              startTime: start,
              endTime: end,
              id: x.id,
              order: x.order,
            }
          : x,
      );
    } else {
      nextItems = [
        ...items,
        {
          id: makeItemId(),
          order: items.length ? Math.max(...items.map((x) => x.order)) + 1 : 0,
          name,
          weekday: editing.weekday,
          startTime: start,
          endTime: end,
          endNextDay: editing.endNextDay,
          enabled: editing.enabled,
          location: editing.location,
          note: editing.note,
          weekType: editing.weekType ?? "all",
        },
      ];
    }
    nextItems = sortWeeklyItems(nextItems);
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id ? { ...p, items: nextItems } : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
    setEditing(null);
    setEditError("");
  }

  function removeItem(item: WeeklyExamItem) {
    const index = items.findIndex((x) => x.id === item.id);
    const nextItems = items.filter((x) => x.id !== item.id);
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id ? { ...p, items: nextItems } : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
    setLastDeleted({ kind: "item", item, index, planId: activePlan.id });
    setDeleteTarget(null);
  }

  function upsertOverride(next: WeeklyExamOverride) {
    const exists = activePlan.overrides.some((o) => o.id === next.id);
    const overrides = exists
      ? activePlan.overrides.map((o) => (o.id === next.id ? next : o))
      : [...activePlan.overrides, next];
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id ? { ...p, overrides } : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  function removeOverride(id: string) {
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id
        ? { ...p, overrides: p.overrides.filter((o) => o.id !== id) }
        : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  function addExcludedDate() {
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
  }

  function removeExcludedDate(date: string) {
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id
        ? { ...p, excludedDates: p.excludedDates.filter((d) => d !== date) }
        : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  async function cancelOccurrence(o: PreviewOcc) {
    if (
      !(await confirmDialog({
        title: "取消本次周测",
        message: `确定取消「${o.name}」${o.date} 这一次吗？\n此操作仅影响这一次，不影响周期规则。`,
        tone: "warning",
        confirmLabel: "确认取消",
      }))
    )
      return;
    const overrideId = genWeeklyOverrideId(o.weeklyItemId, o.date);
    upsertOverride({
      id: overrideId,
      sourceItemId: o.weeklyItemId,
      date: o.date,
      action: "cancel",
      reason: "管理员单次取消",
    });
    setLastDeleted({
      kind: "occurrence",
      overrideId,
      name: `${o.date} ${o.name}`,
    });
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

  function openReschedule(o: PreviewOcc) {
    setRescheduleTarget({
      occ: o,
      name: o.name,
      date: o.date,
      startTime: o.startTime,
      endTime: o.endTime,
    });
    setRescheduleError("");
  }

  function commitReschedule() {
    if (!rescheduleTarget) return;
    const { occ, name, date, startTime, endTime } = rescheduleTarget;
    if (!name.trim()) {
      setRescheduleError("请输入名称");
      return;
    }
    if (!DATE_RE.test(date)) {
      setRescheduleError("请填写正确日期");
      return;
    }
    if (!HM_RE.test(startTime) || !HM_RE.test(endTime)) {
      setRescheduleError("请输入正确的时间（HH:mm）");
      return;
    }
    if (padHM(endTime) <= padHM(startTime)) {
      setRescheduleError("结束时间必须晚于开始时间，请重新选择。");
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
      reason: "管理员临时调课",
    });
    notify(
      "success",
      date === occ.date ? "本次周测时间已调整。" : `本次周测已调至 ${date}。`,
    );
    setRescheduleTarget(null);
  }

  function keepSuppressed() {
    setConflictTarget(null);
  }

  function forceRunOccurrence() {
    if (!conflictTarget) return;
    upsertOverride({
      id: genWeeklyOverrideId(conflictTarget.weeklyItemId, conflictTarget.date),
      sourceItemId: conflictTarget.weeklyItemId,
      date: conflictTarget.date,
      action: "replace",
      forceRunDuringMajorExam: true,
      reason: "管理员确认仍然进行",
    });
    setConflictTarget(null);
  }

  function unforceOccurrence(o: PreviewOcc) {
    removeOverride(genWeeklyOverrideId(o.weeklyItemId, o.date));
  }

  function toggleItemEnabled(item: WeeklyExamItem) {
    const nextItems = items.map((x) =>
      x.id === item.id ? { ...x, enabled: !x.enabled } : x,
    );
    const plans = weeklyPlans.map((p) =>
      p.id === activePlan.id ? { ...p, items: nextItems } : p,
    );
    onSavePlans(plans, activePlan.id, selectedClassId, true);
  }

  function closeImport(clearText = false) {
    setImportOpen(false);
    setImportError("");
    setImportClassIds([]);
    setImportStep("paste");
    setImportSummary(null);
    if (clearText) setImportText("");
  }

  function validateImportJson() {
    setImportError("");
    try {
      const source = JSON.parse(importText);
      const importedPlan =
        source?.plan && typeof source.plan === "object" ? source.plan : source;
      const list = Array.isArray(importedPlan)
        ? importedPlan
        : importedPlan?.items;
      if (!Array.isArray(list)) {
        throw new Error("JSON 必须是周测数组，或包含 items 数组");
      }
      const invalidIndex = list.findIndex((raw: unknown) => {
        const item = raw as Record<string, unknown>;
        return (
          !item?.name ||
          !HM_RE.test(String(item.startTime ?? "")) ||
          !HM_RE.test(String(item.endTime ?? ""))
        );
      });
      if (invalidIndex >= 0) {
        throw new Error(
          `第 ${invalidIndex + 1} 项需要有效的 name、startTime 和 endTime`,
        );
      }
      setImportSummary({
        itemCount: list.length,
        planName:
          typeof importedPlan?.name === "string"
            ? importedPlan.name
            : undefined,
      });
      setImportStep("targets");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "JSON 格式错误");
    }
  }

  function importJson() {
    setImportError("");
    try {
      const source = JSON.parse(importText);
      const targets = importClassIds.length
        ? importClassIds
        : [selectedClassId];
      if (!targets.length) throw new Error("请至少选择一个目标班级");
      if (source?.plan && typeof source.plan === "object") {
        const imported = normalizeWeeklyPlan(source.plan, weeklyPlans.length);
        const importedPlans = targets.map((classId, offset) => {
          const target = pickerOptions.find((item) => item.id === classId)!;
          const idMap = new Map(
            imported.items.map((item) => [item.id, makeItemId()]),
          );
          return {
            ...imported,
            id: genWeeklyPlanId(),
            name: `${target.className} · ${imported.name.replace(/（导入）$/u, "")}`,
            gradeId: target.gradeId,
            classId,
            order: weeklyPlans.length + offset,
            items: imported.items.map((item, index) => ({
              ...item,
              id: idMap.get(item.id)!,
              order: index,
            })),
            overrides: imported.overrides
              .filter((item) => idMap.has(item.sourceItemId))
              .map((item) => ({
                ...item,
                id: genWeeklyOverrideId(
                  idMap.get(item.sourceItemId)!,
                  item.date,
                ),
                sourceItemId: idMap.get(item.sourceItemId)!,
              })),
          };
        });
        const nextActive = {
          ...activeWeeklyPlanIdByClassId,
          ...Object.fromEntries(
            importedPlans.map((plan) => [plan.classId, plan.id]),
          ),
        };
        onSavePlans(
          [...weeklyPlans, ...importedPlans],
          importedPlans[0].id,
          importedPlans[0].classId,
          true,
          nextActive,
        );
        closeImport(true);
        notify("success", `已向 ${importedPlans.length} 个班级导入独立计划。`);
        return;
      }
      const list = Array.isArray(source) ? source : source.items;
      if (!Array.isArray(list))
        throw new Error("JSON 必须是周测数组，或包含 items 数组");
      const nextItems: WeeklyExamItem[] = list.map(
        (raw: unknown, index: number) => {
          const row = raw as Record<string, unknown>;
          const weekday = ([1, 2, 3, 4, 5, 6, 7] as number[]).includes(
            row.weekday as number,
          )
            ? (row.weekday as IsoWeekday)
            : 1;
          if (!row.name || !row.startTime || !row.endTime)
            throw new Error(
              `第 ${index + 1} 项缺少 name、startTime 或 endTime`,
            );
          return {
            id: String(row.id ?? makeItemId()),
            name: String(row.name),
            weekday,
            startTime: padHM(String(row.startTime)),
            endTime: padHM(String(row.endTime)),
            endNextDay: !!row.endNextDay,
            enabled: row.enabled !== false,
            order: typeof row.order === "number" ? row.order : index,
            location:
              typeof row.location === "string" ? row.location : undefined,
            note: typeof row.note === "string" ? row.note : undefined,
            weekType: (["all", "a", "b"] as WeeklyWeekType[]).includes(
              row.weekType as WeeklyWeekType,
            )
              ? (row.weekType as WeeklyWeekType)
              : "all",
          };
        },
      );
      const targetPlanIds = new Set(
        targets
          .map(
            (classId) =>
              activeWeeklyPlanIdByClassId[classId] ??
              weeklyPlans.find((plan) => plan.classId === classId)?.id,
          )
          .filter(Boolean),
      );
      if (targetPlanIds.size !== targets.length)
        throw new Error("部分目标班级尚无周测计划，请先批量新建计划");
      const plans = weeklyPlans.map((plan) =>
        targetPlanIds.has(plan.id)
          ? {
              ...plan,
              items: sortWeeklyItems(
                nextItems.map((item, index) => ({
                  ...item,
                  id: makeItemId(),
                  order: index,
                })),
              ),
            }
          : plan,
      );
      onSavePlans(plans, activePlan.id, selectedClassId, true);
      closeImport(true);
      notify("success", `已向 ${targets.length} 个班级导入周测项目。`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "JSON 格式错误");
    }
  }

  function exportJson() {
    const file = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 1,
            plan: activePlan,
            items,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json;charset=utf-8" },
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activePlan.name || "weekly"}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function commitCopyPlan() {
    if (!copyModal?.targetClassIds.length) return;
    const source = weeklyPlans.find(
      (plan) => plan.id === copyModal.sourcePlanId,
    );
    if (!source) return;
    const copyName =
      copyModal.name.trim() || source.name.replace(/（复制）$/u, "");
    const copies = copyModal.targetClassIds.map((classId, offset) => {
      const target = classOptions.find((item) => item.id === classId)!;
      const idMap = new Map(
        source.items.map((item) => [item.id, makeItemId()]),
      );
      const sourceClass = classOptions.find(
        (item) => item.id === source.classId,
      );
      const sourceClassName = sourceClass
        ? lastLabelSegment(sourceClass.label)
        : "";
      const targetClassName = lastLabelSegment(target.label);
      const targetName =
        sourceClassName && copyName.includes(sourceClassName)
          ? copyName.replace(sourceClassName, targetClassName)
          : `${targetClassName} · ${copyName}`;
      return {
        ...source,
        id: genWeeklyPlanId(),
        gradeId: target.gradeId,
        classId,
        name: targetName,
        enabled: true,
        order: weeklyPlans.length + offset,
        items: source.items.map((item, index) => ({
          ...item,
          id: idMap.get(item.id)!,
          order: index,
        })),
        overrides: source.overrides
          .filter((item) => idMap.has(item.sourceItemId))
          .map((item) => ({
            ...item,
            sourceItemId: idMap.get(item.sourceItemId)!,
            id: genWeeklyOverrideId(idMap.get(item.sourceItemId)!, item.date),
          })),
      };
    });
    const nextActiveByClass = {
      ...activeWeeklyPlanIdByClassId,
      ...Object.fromEntries(copies.map((plan) => [plan.classId, plan.id])),
    };
    onSavePlans(
      [...weeklyPlans, ...copies],
      activePlan.id,
      selectedClassId,
      true,
      nextActiveByClass,
    );
    notify(
      "success",
      `计划已应用到 ${copies.length} 个班级，并设为各班当前启用计划。`,
    );
    setCopyModal(null);
  }

  const grouped = WEEKDAY_ORDER.map((wd) => ({
    wd,
    list: items
      .filter((i) => i.weekday === wd)
      .sort((a, b) => a.order - b.order),
  }));

  function renderPlanModal() {
    if (!planModal) return null;
    const closePlanModal = () => {
      setPlanModal(null);
      setPlanError("");
    };
    const nextPlanStep = () => {
      if (planWizardStep === 0) {
        if (!planModal.name.trim()) {
          setPlanError("请填写计划名称。");
          return;
        }
        if (planModal.mode === "add" && (!planModal.gradeId || !planModal.classIds.length)) {
          setPlanError("请先选择适用年级和班级。");
          return;
        }
      }
      setPlanError("");
      setPlanWizardStep((value) => Math.min(2, value + 1));
    };
    return (
      <div
        className="admin-modal-overlay"
        {...backdropProps(closePlanModal)}
      >
        <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(e) => e.stopPropagation()}>
          <h2 className="admin-modal__title admin-workflow-head">
            {planModal.mode === "add" ? "新建周测计划" : "周测计划设置"}
          </h2>
          <AdminWorkflowClose onClick={closePlanModal} />
          {planError && <div className="admin-error">{planError}</div>}
          <div className="admin-workflow-layout">
            <AdminWizardSteps
              active={planWizardStep}
              steps={[
                { label: "适用范围", hint: "年级、班级和名称" },
                { label: "计划规则", hint: "日期、周次和节假日" },
                { label: "确认保存", hint: "检查计划配置" },
              ]}
              summary={<><span>当前计划</span><strong>{planModal.name || "尚未命名"}</strong><span>{planModal.mode === "add" ? `${planModal.classIds.length} 个班级` : "当前班级"}</span></>}
            />
            <div className="admin-workflow-content" key={planWizardStep}>
              {planWizardStep === 0 && <div className="admin-workflow-pane">
                {planModal.mode === "add" && <>
                <label className="admin-label">
                  适用年级
                  <InlineSelect
                    className="admin-input"
                    value={planModal.gradeId}
                    onChange={(value) =>
                      setPlanModal(
                        (p) =>
                          p && { ...p, gradeId: value, classIds: [], name: "" },
                      )
                    }
                    options={[
                      { value: "", label: "请选择年级" },
                      ...[
                        ...new Map(
                          classOptions.map((item) => [
                            item.gradeId,
                            item.label.split(" · ")[0],
                          ]),
                        ),
                      ].map(([id, label]) => ({ value: id, label })),
                    ]}
                  />
                </label>
                <div className="admin-label">
                  适用班级
                  <ClassMultiPicker
                    options={pickerOptions}
                    gradeId={planModal.gradeId}
                    selectedIds={planModal.classIds}
                    onChange={(ids) =>
                      setPlanModal(
                        (p) =>
                          p && {
                            ...p,
                            classIds: ids,
                            name:
                              p.name ||
                              (ids.length === 1
                                ? `${pickerOptions.find((item) => item.id === ids[0])?.className || ""}周测计划`
                                : "周测计划"),
                          },
                      )
                    }
                    disabled={!planModal.gradeId}
                    single={!allowBatchApply}
                  />
                </div>
                </>}
                <label className="admin-label">
                  计划名称
                  <input
                    className="admin-input"
                    autoFocus={planModal.mode !== "add"}
                    value={planModal.name}
                    onChange={(e) => setPlanModal((p) => p && { ...p, name: e.target.value })}
                    placeholder="如：高三周测 / 晚自习周测"
                  />
                </label>
              </div>}
              {planWizardStep === 1 && <div className="admin-workflow-pane admin-workflow-pane--two-column">
              <label className="admin-label">
              生效日期
              <DateTimeField
                className="admin-date-time-field"
                value={planModal.activeFrom}
                onChange={(value) => setPlanModal((p) => p && { ...p, activeFrom: value })}
                mode="date"
                title="选择生效日期"
                showFieldPreview={false}
              />
            </label>
            <label className="admin-label">
              学期开始日期（A 周锚点）
              <DateTimeField
                className="admin-date-time-field"
                value={planModal.anchorDate}
                onChange={(value) => setPlanModal((p) => p && { ...p, anchorDate: value })}
                mode="date"
                title="选择学期开始日期"
                showFieldPreview={false}
              />
            </label>
            <label className="admin-label">
              周次模式
              <InlineSelect
                className="admin-input"
                value={planModal.weekMode}
                onChange={(value) =>
                  setPlanModal(
                    (p) => p && { ...p, weekMode: value as WeeklyWeekMode },
                  )
                }
                options={[
                  { value: "single", label: "统一周表" },
                  { value: "ab", label: "A/B 周交替" },
                ]}
              />
            </label>
            <label className="admin-toggle-label">
              <input
                type="checkbox"
                checked={planModal.forever}
                onChange={(e) =>
                  setPlanModal((p) => p && { ...p, forever: e.target.checked })
                }
              />
              长期有效（不设结束日期）
            </label>
            {!planModal.forever && (
              <label className="admin-label">
                结束日期
                <DateTimeField
                  className="admin-date-time-field"
                  value={planModal.activeUntil}
                  onChange={(value) => setPlanModal((p) => p && { ...p, activeUntil: value })}
                  mode="date"
                  title="选择结束日期"
                  showFieldPreview={false}
                />
              </label>
            )}
            {planModal.weekMode === "single" && (
              <label className="admin-label">
                重复周期
                <InlineSelect
                  className="admin-input"
                  value={String(planModal.repeatEveryWeeks)}
                  onChange={(value) =>
                    setPlanModal(
                      (p) => p && { ...p, repeatEveryWeeks: Number(value) },
                    )
                  }
                  options={[1, 2, 3, 4].map((value) => ({
                    value: String(value),
                    label:
                      value === 1
                        ? "每周"
                        : `每 ${value} 周（隔 ${value - 1} 周）`,
                  }))}
                />
              </label>
            )}
            <label className="admin-toggle-label">
              <input
                type="checkbox"
                checked={planModal.excludeOfficialHolidays}
                onChange={(e) =>
                  setPlanModal(
                    (p) =>
                      p && { ...p, excludeOfficialHolidays: e.target.checked },
                  )
                }
              />
              自动排除 2026 年法定节假日
            </label>
              </div>}
              {planWizardStep === 2 && <div className="admin-workflow-pane">
                <div className="admin-workflow-review">
                  <span>计划名称<strong>{planModal.name}</strong></span>
                  <span>应用范围<strong>{planModal.mode === "add" ? `${planModal.classIds.length} 个班级` : "当前班级"}</strong></span>
                  <span>生效日期<strong>{planModal.activeFrom} 至 {planModal.forever ? "长期" : planModal.activeUntil || "未设置"}</strong></span>
                  <span>周次规则<strong>{planModal.weekMode === "ab" ? "A/B 周交替" : planModal.repeatEveryWeeks === 1 ? "每周" : `每 ${planModal.repeatEveryWeeks} 周`}</strong></span>
                  <span>节假日<strong>{planModal.excludeOfficialHolidays ? "自动排除" : "不自动排除"}</strong></span>
                </div>
                <p className="admin-major-card__hint">保存后仍可在计划设置中修改规则；批量创建的计划会分别归属于各班级。</p>
              </div>}
            </div>
          </div>
          <div className="admin-modal__actions">
            <button className="admin-btn" onClick={planWizardStep === 0 ? closePlanModal : () => setPlanWizardStep((value) => value - 1)}>{planWizardStep === 0 ? "取消" : "上一步"}</button>
            {planWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={nextPlanStep}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={commitPlanModal}>保存到 {planModal.mode === "add" ? planModal.classIds.length : 1} 个班级</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
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
              onClick={() => {
                setPlanModal({
                  mode: "settings",
                  name: activePlan.name,
                  gradeId: activePlan.gradeId,
                  classIds: [activePlan.classId],
                  activeFrom: activePlan.activeFrom,
                  activeUntil: activePlan.activeUntil ?? "",
                  anchorDate: activePlan.anchorDate,
                  forever: !activePlan.activeUntil,
                  repeatEveryWeeks: activePlan.repeatEveryWeeks,
                  weekMode: activePlan.weekMode ?? "single",
                  excludeOfficialHolidays:
                    activePlan.excludeOfficialHolidays === true,
                });
                setPlanError("");
              }}
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
              <>
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
              </>
            )}
          </div>
          <p className="admin-major-card__hint">
            生效期：{activePlan.activeFrom}
            {" ~ "}
            {activePlan.activeUntil || "长期"}
          </p>
        </div>

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
      <main className="admin-main">
        <div className="admin-list-header">
          <h2 className="admin-list-title">{activePlan.name} · 周测</h2>
          <span className="admin-list-count">{items.length} 项</span>
          <div className="weekly-list-actions">
            <button
              className="admin-btn"
              onClick={() => {
                setImportText("");
                setImportError("");
                setImportSummary(null);
                setImportStep("paste");
                setImportClassIds(selectedClassId ? [selectedClassId] : []);
                setImportOpen(true);
              }}
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

        <div className="admin-list-header" style={{ marginTop: 22 }}>
          <h2 className="admin-list-title">未来两周预览</h2>
          <span className="admin-list-count">{preview.length} 场</span>
          <button
            className="admin-btn"
            onClick={() => {
              if (allowBatchApply) {
                setPrintClassIds([selectedClassId]);
                setPrintPickerOpen(true);
              } else setPrintOpen(true);
            }}
          >
            A4 预览与下载 PDF
          </button>
        </div>
        <div
          className="weekly-calendar-scroll"
          tabIndex={0}
          aria-label="横向滚动查看未来两周"
        >
          <div
            className="weekly-calendar"
            role="grid"
            aria-label="未来两周周测日历"
          >
            {calendarWeeks.map((week, weekIndex) => (
              <div
                className="weekly-calendar__week"
                key={`week-${weekIndex}`}
                role="row"
                style={{ gridTemplateColumns: `repeat(${week.length}, minmax(112px, 1fr))` }}
              >
                {week.map((day) => (
                  <section
                    className={`weekly-calendar__day${day.entries.length ? " has-events" : ""}${day.officialHoliday || day.manuallyExcluded ? " is-holiday" : ""}`}
                    key={day.date}
                    role="gridcell"
                  >
                    <header>
                      <strong>
                        {WEEKDAY_LABEL[day.weekday]}
                        {day.weekType ? ` · ${day.weekType.toUpperCase()}周` : ""}
                      </strong>
                      <span>{day.date.slice(5)}</span>
                    </header>
                    <div className="weekly-calendar__events">
                      {(day.officialHoliday || day.manuallyExcluded) && (
                        <span className="weekly-calendar__holiday">
                          {day.officialHoliday || "已排除"}
                        </span>
                      )}
                      {day.entries.length === 0 ? (
                        <span className="weekly-calendar__empty">
                          {day.officialHoliday || day.manuallyExcluded
                            ? "周测已暂停"
                            : "无安排"}
                        </span>
                      ) : (
                        day.entries.map((entry) => (
                          <article
                            className={`weekly-calendar__event${entry.suppressed ? " is-suppressed" : ""}${entry.forced ? " is-forced" : ""}`}
                            key={`${entry.date}-${entry.weeklyItemId}`}
                          >
                            <button
                              className="weekly-calendar__event-main"
                              onClick={() =>
                                entry.suppressed
                                  ? setConflictTarget(entry)
                                  : openReschedule(entry)
                              }
                              title={entry.message || "点击临时调整"}
                            >
                              <b>{entry.name}</b>
                              <span>
                                {entry.startTime}–{entry.endTime}
                              </span>
                            </button>
                            <button
                              className="weekly-calendar__remove"
                              aria-label={`取消 ${entry.name}`}
                              title="取消本次"
                              onClick={() => void cancelOccurrence(entry)}
                            >
                              ×
                            </button>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                ))}
              </div>
            ))}
          </div>
        </div>
        {preview.length === 0 && (
          <div className="admin-collapsed-hint">
            未来两周内暂无周测实例（可能计划已停用、不在生效期或没有启用的周测项）
          </div>
        )}
      </main>

      {planModal && renderPlanModal()}
      {deletePlanOpen && (
        <div
          className="admin-modal-overlay"
          {...backdropProps(() => setDeletePlanOpen(false))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">删除周测计划</h2>
            <p className="admin-modal__body">
              确定删除「{activePlan.name}」及其全部 {items.length}{" "}
              条周测？删除后可在页面顶部立即撤销。
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--danger"
                onClick={removePlan}
              >
                删除
              </button>
              <button
                className="admin-btn"
                onClick={() => setDeletePlanOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      {allowBatchApply && batchDeleteOpen && (
        <div
          className="admin-modal-overlay"
          {...backdropProps(() => {
            setBatchDeleteOpen(false);
            setBatchDeletePlanIds([]);
          })}
        >
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">批量删除周测计划</h2>
            <AdminWorkflowClose onClick={() => { setBatchDeleteOpen(false); setBatchDeletePlanIds([]); }} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps active={batchDeleteStep} steps={[{ label: "选择计划", hint: "按年级筛选并勾选" }, { label: "确认删除", hint: "核对影响范围" }]} summary={<><span>已选择</span><strong>{batchDeletePlanIds.length} 个计划</strong><span>删除后可整批撤销</span></>} />
              <div className="admin-workflow-content" key={batchDeleteStep}>
                {batchDeleteStep === 0 && <div className="admin-workflow-pane"><p className="admin-modal__body">按年级和班级选择要删除的具体计划。</p><ClassMultiPicker options={planPickerOptions} selectedIds={batchDeletePlanIds} onChange={setBatchDeletePlanIds} noun="计划" emptyText="当前范围内没有可删除的周测计划" /></div>}
                {batchDeleteStep === 1 && <div className="admin-workflow-pane"><div className="admin-workflow-review"><span>删除数量<strong>{batchDeletePlanIds.length} 个周测计划</strong></span><span>删除后处理<strong>自动切换各班剩余计划；无剩余则清空</strong></span><span>恢复方式<strong>页面顶部支持整批撤销</strong></span></div><p className="admin-major-card__hint">请确认所选年级和班级无误后再删除。</p></div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={() => { if (batchDeleteStep) setBatchDeleteStep(0); else { setBatchDeleteOpen(false); setBatchDeletePlanIds([]); } }}>{batchDeleteStep ? "上一步" : "取消"}</button>
              {batchDeleteStep === 0 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={!batchDeletePlanIds.length} onClick={() => setBatchDeleteStep(1)}>下一步，确认范围</button> : <button className="admin-btn admin-btn--danger admin-workflow-actions-spacer" onClick={() => void removeSelectedPlans()}>删除 {batchDeletePlanIds.length} 个计划</button>}
            </div>
          </div>
        </div>
      )}
      {editing && (
        <div
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
              {activePlan.weekMode === "ab" && (
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
                  <span>适用周次<strong>{activePlan.weekMode === "ab" ? editing.weekType === "a" ? "仅 A 周" : editing.weekType === "b" ? "仅 B 周" : "A/B 周都进行" : "每个生效周"}</strong></span>
                  <span>地点备注<strong>{editing.location || "无"}</strong></span>
                  <span>启用状态<strong>{editing.enabled ? "启用" : "停用"}</strong></span>
                </div>
              </div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={itemWizardStep === 0 ? () => { setWeeklyTimeFlowOpen(false); setEditing(null); setCustomWeeklySubjectActive(false); setEditError(""); } : () => setItemWizardStep((value) => value - 1)}>{itemWizardStep === 0 ? "取消" : "上一步"}</button>
              {itemWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => { if (itemWizardStep === 0 && !editing.name.trim()) { setEditError("请先选择或填写周测科目。"); return; } setEditError(""); setItemWizardStep((value) => value + 1); }}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={commitItemModal}>确认并保存</button>}
            </div>
          </div>
        </div>
      )}
      {editing && <TimeRangePickerModal
        open={weeklyTimeFlowOpen}
        startValue={editing.startTime}
        endValue={editing.endTime}
        subject={editing.name || "周测"}
        contextLabel={WEEKDAY_LABEL[editing.weekday]}
        initialCrossDay={!!editing.endNextDay}
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
      />}
      {deleteTarget && (
        <div
          className="admin-modal-overlay"
          {...backdropProps(() => setDeleteTarget(null))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">确认删除</h2>
            <p className="admin-modal__body">
              确定删除「{deleteTarget.name}」？删除后可立即撤销。
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--danger"
                onClick={() => removeItem(deleteTarget)}
              >
                删除
              </button>
              <button
                className="admin-btn"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      {importOpen && (
        <div
          className="admin-modal-overlay"
          {...backdropProps(() => closeImport())}
        >
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow weekly-import-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">导入周测 JSON</h2>
            <AdminWorkflowClose onClick={() => closeImport()} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps
                active={importStep === "paste" ? 0 : 1}
                steps={[{ label: "粘贴校验", hint: "识别周测 JSON" }, { label: "选择班级", hint: "确认应用范围" }]}
                summary={<><span>导入内容</span><strong>{importSummary?.planName || "待校验 JSON"}</strong><span>{importSummary ? `${importSummary.itemCount} 项周测安排` : "尚未识别"}</span></>}
              />
              <div className="admin-workflow-content" key={importStep}>
            {importStep === "paste" ? (
              <>
                <p className="admin-modal__body">
                  先粘贴 JSON 并校验内容，下一步再选择应用班级。
                </p>
                <AiImportGuide
                  kind="weekly"
                  context={`${classOptions.find((item) => item.id === selectedClassId)?.label || selectedClassName}，计划“${activePlan.name}”`}
                />
                {importError && <div className="admin-error">{importError}</div>}
                <textarea
                  className="admin-textarea weekly-import-modal__textarea"
                  rows={9}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder='{"items":[{"name":"周测","weekday":1,"startTime":"19:00","endTime":"20:00","enabled":true}]}'
                />
                <div className="admin-modal__actions">
                  <button className="admin-btn admin-btn--primary" onClick={validateImportJson}>
                    校验 JSON，下一步
                  </button>
                  <button className="admin-btn" onClick={() => closeImport()}>
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="admin-modal__title">选择应用班级</h3>
                <div className="weekly-import-modal__summary">
                  <strong>{importSummary?.planName || "周测 JSON"}</strong>
                  <span>已识别 {importSummary?.itemCount ?? 0} 项周测安排</span>
                </div>
                {allowBatchApply ? (
                  <div className="admin-label">
                    应用到班级
                    <ClassMultiPicker
                      options={pickerOptions}
                      gradeId={selectedGradeId}
                      selectedIds={importClassIds}
                      onChange={setImportClassIds}
                    />
                  </div>
                ) : (
                  <p className="admin-modal__body">将应用到当前班级：{selectedClassName}</p>
                )}
                {importError && <div className="admin-error">{importError}</div>}
                <div className="admin-modal__actions">
                  <button className="admin-btn" onClick={() => setImportStep("paste")}>
                    上一步
                  </button>
                  <button className="admin-btn admin-btn--primary" onClick={importJson}>
                    确认导入到 {importClassIds.length || 1} 个班级
                  </button>
                  <button className="admin-btn" onClick={() => closeImport()}>
                    取消
                  </button>
                </div>
              </>
            )}
              </div>
            </div>
          </div>
        </div>
      )}
      {policyOpen && (
        <div
          className="admin-modal-overlay"
          {...backdropProps(() => setPolicyOpen(false))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">大型考试冲突处理</h2>
            <div className="admin-form">
              <label className="admin-toggle-label">
                <input
                  type="checkbox"
                  checked={weeklyConflictPolicy.enabled}
                  onChange={(e) =>
                    onConflictPolicyChange(
                      { ...weeklyConflictPolicy, enabled: e.target.checked },
                      true,
                    )
                  }
                />
                启用冲突自动处理（仅自动模式下生效）
              </label>
              <label className="admin-label">
                暂停范围{" "}
                <HelpTip title="冲突暂停范围">
                  “时间重叠”最精细；“当天”会暂停大型考试日期内的全部周测；“整个考期”会暂停从第一科开始到最后一科结束期间的周测。
                </HelpTip>
                <InlineSelect
                  className="admin-input"
                  value={weeklyConflictPolicy.scope}
                  onChange={(value) =>
                    onConflictPolicyChange(
                      {
                        ...weeklyConflictPolicy,
                        scope: value as WeeklyConflictPolicy["scope"],
                      },
                      true,
                    )
                  }
                  options={ALL_CONFLICT_SCOPES.map((scope) => ({
                    value: scope,
                    label: SCOPE_LABEL[scope],
                  }))}
                />
              </label>
              {weeklyConflictPolicy.scope === "time-overlap" && (
                <>
                  <label className="admin-label">
                    开考前缓冲（分钟）
                    <input
                      className="admin-input"
                      type="number"
                      min={0}
                      max={180}
                      value={weeklyConflictPolicy.bufferBeforeMinutes}
                      onChange={(e) =>
                        onConflictPolicyChange(
                          {
                            ...weeklyConflictPolicy,
                            bufferBeforeMinutes: Math.max(
                              0,
                              Number(e.target.value) || 0,
                            ),
                          },
                          true,
                        )
                      }
                    />
                  </label>
                  <label className="admin-label">
                    结束后缓冲（分钟）
                    <input
                      className="admin-input"
                      type="number"
                      min={0}
                      max={180}
                      value={weeklyConflictPolicy.bufferAfterMinutes}
                      onChange={(e) =>
                        onConflictPolicyChange(
                          {
                            ...weeklyConflictPolicy,
                            bufferAfterMinutes: Math.max(
                              0,
                              Number(e.target.value) || 0,
                            ),
                          },
                          true,
                        )
                      }
                    />
                  </label>
                </>
              )}
              <div className="admin-form-actions">
                <button
                  className="admin-btn admin-btn--primary"
                  onClick={() => setPolicyOpen(false)}
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {exceptionsOpen && (
        <div
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
        </div>
      )}
      {allowBatchApply && copyModal && (
        <div
          className="admin-modal-overlay"
          {...backdropProps(() => setCopyModal(null))}
        >
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">批量应用周测计划</h2>
            <AdminWorkflowClose onClick={() => setCopyModal(null)} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps active={copyWizardStep} steps={[{ label: "选择计划", hint: "确定源计划和标题" }, { label: "应用班级", hint: "批量选择目标班级" }]} summary={<><span>源计划</span><strong>{weeklyPlans.find((plan) => plan.id === copyModal.sourcePlanId)?.name || "未选择"}</strong><span>{copyModal.targetClassIds.length} 个目标班级</span></>} />
              <div className="admin-workflow-content" key={copyWizardStep}>
              {copyWizardStep === 0 && <div className="admin-workflow-pane"><label className="admin-label">
              源计划
              <InlineSelect
                className="admin-input"
                value={copyModal.sourcePlanId}
                onChange={(value) => {
                  const source = weeklyPlans.find((plan) => plan.id === value);
                  setCopyModal(
                    (current) =>
                      current && {
                        ...current,
                        sourcePlanId: value,
                        name:
                          source?.name.replace(/（复制）$/u, "") ||
                          current.name,
                      },
                  );
                }}
                options={[...weeklyPlans]
                  .sort((a, b) => {
                    const ac =
                      classOptions.find((item) => item.id === a.classId)
                        ?.label || "";
                    const bc =
                      classOptions.find((item) => item.id === b.classId)
                        ?.label || "";
                    return (
                      ac.localeCompare(bc, "zh-CN") ||
                      a.name.localeCompare(b.name, "zh-CN")
                    );
                  })
                  .map((plan) => {
                    const target = classOptions.find(
                      (item) => item.id === plan.classId,
                    );
                    const [gradeName = "未知年级", className = "未知班级"] =
                      target?.label.split(" · ") ?? [];
                    const detail = weeklyPlanDetailName(
                      plan.name,
                      gradeName,
                      className,
                    );
                    return {
                      value: plan.id,
                      label: `${gradeName} · ${className} · ${detail}`,
                    };
                  })}
              />
            </label>
            <label className="admin-label">
              应用后的计划标题
              <input
                className="admin-input"
                value={copyModal.name}
                onChange={(event) =>
                  setCopyModal(
                    (current) =>
                      current && { ...current, name: event.target.value },
                  )
                }
                placeholder="请输入计划标题"
              />
            </label></div>}
            {copyWizardStep === 1 && <div className="admin-workflow-pane"><div className="admin-label">
              应用到班级
              <ClassMultiPicker
                options={pickerOptions.filter(
                  (item) =>
                    item.id !==
                    weeklyPlans.find(
                      (plan) => plan.id === copyModal.sourcePlanId,
                    )?.classId,
                )}
                selectedIds={copyModal.targetClassIds}
                onChange={(ids) =>
                  setCopyModal(
                    (current) => current && { ...current, targetClassIds: ids },
                  )
                }
              />
            </div>
            <p className="admin-major-card__hint">
              每个目标班级会创建一份已启用的独立计划，之后可分别编辑。
            </p></div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={() => copyWizardStep ? setCopyWizardStep(0) : setCopyModal(null)}>{copyWizardStep ? "上一步" : "取消"}</button>
              {copyWizardStep === 0 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={!copyModal.sourcePlanId || !copyModal.name.trim()} onClick={() => setCopyWizardStep(1)}>下一步，选择班级</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={commitCopyPlan} disabled={!copyModal.targetClassIds.length}>应用到 {copyModal.targetClassIds.length} 个班级</button>}
            </div>
          </div>
        </div>
      )}
      {conflictTarget && (
        <div
          className="admin-modal-overlay"
          {...backdropProps(() => setConflictTarget(null))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">处理冲突</h2>
            <p className="admin-modal__body">
              「{conflictTarget.name}」与大型考试「
              {conflictTarget.conflict?.majorName ?? majorName}
              」冲突，已按策略暂停本次（{conflictTarget.date}）。
            </p>
            <p className="admin-major-card__hint">
              大型考试：
              {conflictTarget.conflict
                ? `${fmtDT(conflictTarget.conflict.majorStartTime)} – ${fmtDT(conflictTarget.conflict.majorEndTime)}`
                : "—"}
            </p>
            <p className="admin-major-card__hint">
              本次周测：{conflictTarget.date} {conflictTarget.startTime}–
              {conflictTarget.endTime}
            </p>
            <p className="admin-major-card__hint">
              暂停范围：{SCOPE_LABEL[weeklyConflictPolicy.scope]}
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--primary"
                onClick={forceRunOccurrence}
              >
                本周仍然进行
              </button>
              <button className="admin-btn" onClick={keepSuppressed}>
                保持暂停
              </button>
            </div>
          </div>
        </div>
      )}
      {rescheduleTarget && (
        <div
          className="admin-modal-overlay"
          {...backdropProps(() => setRescheduleTarget(null))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">临时调课（仅此一次）</h2>
            {rescheduleError && (
              <div className="admin-error">{rescheduleError}</div>
            )}
            <div className="admin-form">
              <label className="admin-label">
                名称
                <input
                  className="admin-input"
                  value={rescheduleTarget.name}
                  onChange={(e) =>
                    setRescheduleTarget(
                      (p) => p && { ...p, name: e.target.value },
                    )
                  }
                />
              </label>
              <label className="admin-label">
                调整至日期
                <DateTimeField
                  className="admin-date-time-field"
                  value={rescheduleTarget.date}
                  onChange={(value) => setRescheduleTarget((p) => p && { ...p, date: value })}
                  mode="date"
                  title="选择调整日期"
                  showFieldPreview={false}
                />
              </label>
              <div className="admin-major-endtime">
                <span>时间设置</span>
                <button type="button" className="admin-major-endtime__trigger" onClick={() => setRescheduleTimeOpen(true)}>
                  <strong>{rescheduleTarget.startTime} - {rescheduleTarget.endTime}</strong>
                  <small>一次设置本次调课的开始与结束时间</small>
                </button>
              </div>
              <p className="admin-major-card__hint">
                仅调整这一次实例，不影响周期规则本身。
              </p>
              <div className="admin-form-actions">
                <button
                  className="admin-btn admin-btn--primary"
                  onClick={commitReschedule}
                >
                  确认并保存
                </button>
                <button
                  className="admin-btn admin-btn--ghost"
                  onClick={() => {
                    setRescheduleTarget(null);
                    setRescheduleError("");
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {rescheduleTarget && <TimeRangePickerModal
        open={rescheduleTimeOpen}
        startValue={rescheduleTarget.startTime}
        endValue={rescheduleTarget.endTime}
        subject={rescheduleTarget.name || "临时调课"}
        contextLabel={rescheduleTarget.date}
        allowCrossDay={false}
        onPreviewChange={(startTime, endTime) => {
          setRescheduleTarget((value) => value ? { ...value, startTime, endTime } : value);
        }}
        onPreviewCancel={(startTime, endTime) => {
          setRescheduleTarget((value) => value ? { ...value, startTime, endTime } : value);
        }}
        onCancel={() => setRescheduleTimeOpen(false)}
        onConfirm={(startTime, endTime) => {
          setRescheduleTarget((value) => value ? { ...value, startTime, endTime } : value);
          setRescheduleTimeOpen(false);
        }}
      />}
      {printPickerOpen && (
        <div
          className="admin-modal-overlay"
          {...backdropProps(() => setPrintPickerOpen(false))}
        >
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">批量预览与下载 PDF</h2>
            <AdminWorkflowClose onClick={() => { setPrintPickerOpen(false); setPrintClassIds([]); }} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps active={printPickerStep} steps={[{ label: "选择班级", hint: "勾选需要导出的范围" }, { label: "确认文档", hint: "核对页数和排版" }]} summary={<><span>导出范围</span><strong>{printSchedules.length} 个班级</strong><span>每班一周一张 A4</span></>} />
              <div className="admin-workflow-content" key={printPickerStep}>
                {printPickerStep === 0 && <div className="admin-workflow-pane"><p className="admin-modal__body">选择需要导出的班级。</p><ClassMultiPicker options={pickerOptions} gradeId={selectedGradeId} selectedIds={printClassIds} onChange={setPrintClassIds} /></div>}
                {printPickerStep === 1 && <div className="admin-workflow-pane"><div className="admin-workflow-review"><span>班级数量<strong>{printSchedules.length} 个</strong></span><span>文档结构<strong>按班级分组</strong></span><span>分页规则<strong>每个班级一周一张 A4 页面</strong></span></div></div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={() => printPickerStep ? setPrintPickerStep(0) : setPrintPickerOpen(false)}>{printPickerStep ? "上一步" : "取消"}</button>
              {printPickerStep === 0 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={!printSchedules.length} onClick={() => setPrintPickerStep(1)}>下一步，确认文档</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => { setPrintPickerOpen(false); setPrintOpen(true); }}>预览 {printSchedules.length} 个班级</button>}
            </div>
          </div>
        </div>
      )}
      {printOpen && (
        <SchedulePrintPreview
          entries={preview}
          gradeName={
            classOptions
              .find((item) => item.id === selectedClassId)
              ?.label.split(" · ")[0] || "当前年级"
          }
          className={selectedClassName}
          schedules={printClassIds.length ? printSchedules : undefined}
          onClose={() => {
            setPrintOpen(false);
            setPrintClassIds([]);
          }}
        />
      )}
    </>
  );
}
