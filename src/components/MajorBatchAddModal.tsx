import { useEffect, useMemo, useState } from "react";
import { Check, Clock3 } from "lucide-react";
import type { ExamItem, MajorExam } from "../types";
import type { SchoolClass } from "../types/school";
import { subjectAppliesToClass } from "../types/school";
import { COMMON_EXAM_SUBJECTS, isTrackSubject, normalizeSubjectName } from "../data/subjects";
import type { MajorBatchSubjectGroup, MajorBatchTimeGroup, MajorBatchTimeSlot } from "../utils/appSettings";
import { APP_SETTINGS_CHANGED_EVENT, getAppSettings } from "../utils/appSettings";
import AdminModalPortal from "./AdminModalPortal";
import AdminWizardSteps, { AdminWorkflowClose } from "./AdminWizardSteps";
import HelpTip from "./HelpTip";
import SubjectIcon from "./SubjectIcon";
import TimeRangePickerModal from "./TimeRangePickerModal";
import { DateTimeField } from "./touch-datetime-picker";
import "../styles/major-batch-add-modal.css";

type BatchDraftItem = {
  id: string;
  name: string;
  date: string;
  start: string;
  end: string;
  enabled: boolean;
  allowCrossDay: boolean;
  targetClassIds?: string[];
};

type TemplateCategory = "gaokao" | "school" | "custom";

type SubjectTemplate = {
  id: string;
  name: string;
  description: string;
  subjects: string[];
  custom?: boolean;
  category: TemplateCategory;
  /** 该模板允许勾选的最大科目总数（例如 3+1+2 固定为 6 门）；不设置表示不限制。 */
  maxTotal?: number;
};

type DayPattern = {
  id: string;
  name: string;
  description: string;
  slots: MajorBatchTimeSlot[];
  custom?: boolean;
  category: TemplateCategory;
};

const GAOKAO_THREE_DAY_PATTERN_ID = "gaokao-three-day";
const GAOKAO_THREE_DAY_SUBJECTS_ID = "gaokao-three-day-subjects";
const NO_MATCHING_TRACK_CLASS_ID = "__no_matching_track_class__";

const CATEGORY_LABELS: Record<Exclude<TemplateCategory, "custom">, string> = {
  gaokao: "高考常用",
  school: "学校常规",
};

const SUBJECT_TEMPLATES: SubjectTemplate[] = [
  {
    id: GAOKAO_THREE_DAY_SUBJECTS_ID,
    name: "新高考三天常用（全科覆盖）",
    description: "9 科覆盖；物理/历史同场生成，按福建 2026 新高考时间表排成 8 场",
    subjects: ["语文", "数学", "物理", "历史", "外语", "化学", "地理", "思想政治", "生物"],
    category: "gaokao",
  },
  {
    id: "gaokao-3-1-2-physics",
    name: "3+1+2（物理方向）",
    description: "已默认选中语文/数学/外语/物理/化学共 5 门，请再从生物、思想政治、地理中任选 1 门凑满 6 门",
    subjects: ["语文", "数学", "外语", "物理", "化学"],
    category: "gaokao",
    maxTotal: 6,
  },
  {
    id: "gaokao-3-1-2-history",
    name: "3+1+2（历史方向）",
    description: "已默认选中语文/数学/外语/历史/思想政治共 5 门，请再从地理、生物、化学中任选 1 门凑满 6 门",
    subjects: ["语文", "数学", "外语", "历史", "思想政治"],
    category: "gaokao",
    maxTotal: 6,
  },
  {
    id: "gaokao-3-3-elective",
    name: "3+3 自选",
    description: "已默认选中语文/数学/外语共 3 门，请再从其余 6 门选考科目中任选 3 门凑满 6 门",
    subjects: ["语文", "数学", "外语"],
    category: "gaokao",
    maxTotal: 6,
  },
  {
    id: "senior-nine",
    name: "高中常规九科",
    description: "语文、数学、外语与六门选考科目",
    subjects: ["语文", "数学", "外语", "物理", "历史", "化学", "地理", "思想政治", "生物"],
    category: "school",
  },
  {
    id: "main-three",
    name: "语数外三科",
    description: "阶段练习和核心科目考试常用",
    subjects: ["语文", "数学", "外语"],
    category: "school",
  },
];

const DAY_PATTERNS: DayPattern[] = [
  {
    id: GAOKAO_THREE_DAY_PATTERN_ID,
    name: "新高考三天常用",
    description: "福建 2026：语数、物理/历史、外语、化地政生；9 科覆盖，8 场约 3 天",
    slots: [
      { start: "09:00", end: "11:30", dayOffset: 0 },
      { start: "15:00", end: "17:00", dayOffset: 0 },
      { start: "09:00", end: "10:15", dayOffset: 1 },
      { start: "15:00", end: "17:00", dayOffset: 1 },
      { start: "08:30", end: "09:45", dayOffset: 2 },
      { start: "11:00", end: "12:15", dayOffset: 2 },
      { start: "14:30", end: "15:45", dayOffset: 2 },
      { start: "17:00", end: "18:15", dayOffset: 2 },
    ],
    category: "gaokao",
  },
  {
    id: "gaokao-old-two-day",
    name: "老高考两天常用",
    description: "第一天语文、数学，第二天综合、外语",
    slots: [
      { start: "09:00", end: "11:30", dayOffset: 0 },
      { start: "15:00", end: "17:00", dayOffset: 0 },
      { start: "09:00", end: "11:30", dayOffset: 1 },
      { start: "15:00", end: "17:00", dayOffset: 1 },
    ],
    category: "gaokao",
  },
  {
    id: "two-am-two-pm",
    name: "上午 2 场 + 下午 2 场",
    description: "适合一天安排四门短时考试",
    slots: [
      { start: "08:30", end: "09:45" },
      { start: "10:15", end: "11:30" },
      { start: "14:30", end: "15:45" },
      { start: "16:15", end: "17:30" },
    ],
    category: "school",
  },
  {
    id: "two-per-day",
    name: "每天 2 场",
    description: "上午一场，下午一场",
    slots: [
      { start: "09:00", end: "11:00" },
      { start: "15:00", end: "17:00" },
    ],
    category: "school",
  },
  {
    id: "three-per-day",
    name: "每天 3 场",
    description: "上午两场，下午一场",
    slots: [
      { start: "08:30", end: "09:45" },
      { start: "10:15", end: "11:30" },
      { start: "15:00", end: "17:00" },
    ],
    category: "school",
  },
  {
    id: "one-am-two-pm",
    name: "上午 1 场 + 下午 2 场",
    description: "适合首科较长的安排",
    slots: [
      { start: "09:00", end: "11:30" },
      { start: "14:30", end: "15:45" },
      { start: "16:15", end: "17:30" },
    ],
    category: "school",
  },
];

const COMMON_SUBJECTS = COMMON_EXAM_SUBJECTS;

function makeDraftId() {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeExamId() {
  return `exam_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function todayKey() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function toLocalIso(date: string, time: string, nextDay = false) {
  const targetDate = nextDay ? addDays(date, 1) : date;
  return `${targetDate}T${time}`;
}

function fmtDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

function rangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return new Date(leftStart) < new Date(rightEnd) && new Date(leftEnd) > new Date(rightStart);
}

function slotDayOffset(slot: MajorBatchTimeSlot) {
  return Math.max(0, Math.round(Number(slot.dayOffset ?? 0)));
}

function patternDaySpan(pattern: DayPattern) {
  const maxOffset = pattern.slots.reduce((max, slot) => Math.max(max, slotDayOffset(slot)), 0);
  return maxOffset + 1;
}

function arrangedSubjectsForPattern(subjects: string[], pattern: DayPattern): string[] {
  if (pattern.id !== GAOKAO_THREE_DAY_PATTERN_ID) return subjects;
  const selected = new Set(subjects);
  const arranged: string[] = [];
  const pushIfSelected = (subject: string) => {
    if (selected.has(subject)) arranged.push(subject);
  };
  pushIfSelected("语文");
  pushIfSelected("数学");
  if (selected.has("物理") && selected.has("历史")) arranged.push("物理/历史");
  else if (selected.has("物理")) arranged.push("物理");
  else if (selected.has("历史")) arranged.push("历史");
  pushIfSelected("外语");
  pushIfSelected("化学");
  pushIfSelected("地理");
  pushIfSelected("思想政治");
  pushIfSelected("生物");
  const covered = new Set(["语文", "数学", "物理", "历史", "外语", "化学", "地理", "思想政治", "生物"]);
  for (const subject of subjects) {
    if (!covered.has(subject) && !arranged.includes(subject)) arranged.push(subject);
  }
  return arranged;
}

function buildDraftItems(subjects: string[], startDate: string, pattern: DayPattern): BatchDraftItem[] {
  const explicitDays = pattern.slots.some((slot) => slotDayOffset(slot) > 0);
  const daySpan = explicitDays ? patternDaySpan(pattern) : 1;
  const arrangedSubjects = arrangedSubjectsForPattern(subjects, pattern);
  return arrangedSubjects.map((subject, index) => {
    const slot = pattern.slots[index % pattern.slots.length];
    const cycleOffset = Math.floor(index / pattern.slots.length) * daySpan;
    const dayOffset = explicitDays ? cycleOffset + slotDayOffset(slot) : Math.floor(index / pattern.slots.length);
    return {
      id: makeDraftId(),
      name: subject,
      date: addDays(startDate, dayOffset),
      start: slot.start,
      end: slot.end,
      enabled: true,
      allowCrossDay: false,
    };
  });
}

function durationText(startIso: string, endIso: string) {
  const minutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return "时间无效";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
  }
  return `${minutes}分钟`;
}

function customSubjectToTemplate(item: MajorBatchSubjectGroup): SubjectTemplate {
  return {
    id: item.id,
    name: item.name,
    description: `${item.subjects.length} 个科目，已保存为常用组`,
    subjects: item.subjects,
    custom: true,
    category: "custom",
  };
}

function customTimeToPattern(item: MajorBatchTimeGroup): DayPattern {
  return {
    id: item.id,
    name: item.name,
    description: `${item.slots.length} 个场次，已保存为常用时间组`,
    slots: item.slots,
    custom: true,
    category: "custom",
  };
}

export default function MajorBatchAddModal({
  major,
  existingItems,
  classes,
  onClose,
  onCommit,
}: {
  major: MajorExam;
  existingItems: ExamItem[];
  classes: SchoolClass[];
  onClose: () => void;
  onCommit: (nextItems: ExamItem[]) => void;
}) {
  const [step, setStep] = useState(0);
  const [customSubjectGroups, setCustomSubjectGroups] = useState<MajorBatchSubjectGroup[]>(() => getAppSettings().majorBatch.subjectGroups);
  const [customTimeGroups, setCustomTimeGroups] = useState<MajorBatchTimeGroup[]>(() => getAppSettings().majorBatch.timeGroups);
  const [templateId, setTemplateId] = useState(SUBJECT_TEMPLATES[0].id);
  const [subjects, setSubjects] = useState(SUBJECT_TEMPLATES[0].subjects);
  const [subjectCap, setSubjectCap] = useState<number | null>(SUBJECT_TEMPLATES[0].maxTotal ?? null);
  const [customSubject, setCustomSubject] = useState("");
  const [startDate, setStartDate] = useState(todayKey);
  const [patternId, setPatternId] = useState(DAY_PATTERNS[0].id);
  const [draftItems, setDraftItems] = useState<BatchDraftItem[]>([]);
  const [error, setError] = useState("");
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [timeEditItemId, setTimeEditItemId] = useState<string | null>(null);
  const [overflowAck, setOverflowAck] = useState(false);

  useEffect(() => {
    const sync = () => {
      const settings = getAppSettings().majorBatch;
      setCustomSubjectGroups(settings.subjectGroups);
      setCustomTimeGroups(settings.timeGroups);
    };
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const subjectTemplates = useMemo(
    () => [...SUBJECT_TEMPLATES, ...customSubjectGroups.map(customSubjectToTemplate)],
    [customSubjectGroups],
  );
  const dayPatterns = useMemo(
    () => [...DAY_PATTERNS, ...customTimeGroups.map(customTimeToPattern)],
    [customTimeGroups],
  );
  const template = subjectTemplates.find((item) => item.id === templateId) ?? subjectTemplates[0];
  const pattern = dayPatterns.find((item) => item.id === patternId) ?? dayPatterns[0];
  const designDays = patternDaySpan(pattern);
  const arrangedSubjects = useMemo(() => arrangedSubjectsForPattern(subjects, pattern), [subjects, pattern]);
  const needsMoreSlots = arrangedSubjects.length > pattern.slots.length;
  const scopedClasses = useMemo(
    () =>
      classes.filter((item) => {
        if (!item.enabled) return false;
        if (major.targetClassIds?.length) return major.targetClassIds.includes(item.id);
        if (major.targetGradeIds?.length) return major.targetGradeIds.includes(item.gradeId);
        return true;
      }),
    [classes, major.targetClassIds, major.targetGradeIds],
  );
  const unsetTrackClassCount = scopedClasses.filter((item) => !item.track?.length).length;
  const autoTargetClassIdsForSubject = (subject: string) => {
    const normalized = normalizeSubjectName(subject);
    if (!isTrackSubject(normalized)) return undefined;
    const ids = scopedClasses
      .filter((item) => item.track?.length && subjectAppliesToClass(normalized, item))
      .map((item) => item.id);
    return ids.length ? ids : [NO_MATCHING_TRACK_CLASS_ID];
  };

  const validation = useMemo(() => {
    const errors = new Map<string, string[]>();
    const normalized = draftItems.map((item) => {
      const startIso = toLocalIso(item.date, item.start);
      const endNextDay = item.allowCrossDay && item.end <= item.start;
      const endIso = toLocalIso(item.date, item.end, endNextDay);
      return { item, startIso, endIso };
    });

    normalized.forEach(({ item, startIso, endIso }, index) => {
      const messages: string[] = [];
      if (!item.name.trim()) messages.push("科目名为空");
      if (!item.date || !item.start || !item.end) messages.push("时间未填完整");
      if (new Date(startIso) >= new Date(endIso)) messages.push("结束时间必须晚于开始时间");
      const existingOverlap = existingItems.some(
        (target) =>
          target.enabled &&
          item.enabled &&
          rangesOverlap(startIso, endIso, target.startTime, target.endTime),
      );
      if (existingOverlap) messages.push("与已有分考试重叠");
      const draftOverlap = normalized.some(
        (target, targetIndex) =>
          targetIndex !== index &&
          target.item.enabled &&
          item.enabled &&
          rangesOverlap(startIso, endIso, target.startIso, target.endIso),
      );
      if (draftOverlap) messages.push("与本次新增项目重叠");
      if (messages.length) errors.set(item.id, messages);
    });

    return {
      errors,
      ok: draftItems.length > 0 && errors.size === 0,
      count: draftItems.length,
      enabledCount: draftItems.filter((item) => item.enabled).length,
    };
  }, [draftItems, existingItems]);

  const groupedDraftItems = useMemo(() => {
    const dates = [...new Set(draftItems.map((item) => item.date))].sort();
    return dates.map((date) => ({
      date,
      items: draftItems
        .filter((item) => item.date === date)
        .sort((left, right) => left.start.localeCompare(right.start)),
    }));
  }, [draftItems]);

  const previewRange = useMemo(() => {
    const dates = [...new Set(draftItems.map((item) => item.date))].sort();
    if (!dates.length) return "未生成";
    if (dates.length === 1) return fmtDate(dates[0]);
    return `${fmtDate(dates[0])} - ${fmtDate(dates[dates.length - 1])}`;
  }, [draftItems]);

  const scheduledDays = groupedDraftItems.length;
  const overflowsDesign = draftItems.length > 0 && scheduledDays > designDays;
  const timeEditItem = draftItems.find((item) => item.id === timeEditItemId) ?? null;

  const selectTemplate = (next: SubjectTemplate) => {
    setTemplateId(next.id);
    setSubjects(next.subjects);
    setSubjectCap(next.maxTotal ?? null);
    setError("");
  };

  const addCustomSubject = () => {
    const value = customSubject.trim();
    if (!value || subjects.includes(value)) return;
    if (subjectCap && subjects.length >= subjectCap) {
      setError(`当前科目组最多选择 ${subjectCap} 门科目，请先取消一门再添加。`);
      return;
    }
    setSubjects((items) => [...items, value]);
    setTemplateId("manual-subjects");
    setCustomSubject("");
    setError("");
  };

  const toggleSubject = (subject: string) => {
    setSubjects((items) => {
      const selected = items.includes(subject);
      if (!selected && subjectCap && items.length >= subjectCap) {
        setError(`当前科目组最多选择 ${subjectCap} 门科目，请先取消一门再选择。`);
        return items;
      }
      setTemplateId("manual-subjects");
      setError("");
      return selected ? items.filter((item) => item !== subject) : [...items, subject];
    });
  };

  const toggleDateCollapsed = (date: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const renderTemplateCard = (item: SubjectTemplate, selected: boolean, onSelect: () => void) => (
    <button
      key={item.id}
      type="button"
      className={`quick-major-choice major-batch-template${selected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <strong>{item.name}</strong>
      <span>{item.id === GAOKAO_THREE_DAY_SUBJECTS_ID ? "9 科" : `${item.subjects.length} 个`}</span>
      {item.custom && <em>自定义</em>}
      <small>{item.description}</small>
    </button>
  );

  const renderPatternCard = (item: DayPattern, selected: boolean, onSelect: () => void) => (
    <button
      key={item.id}
      type="button"
      className={`quick-major-choice${selected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <strong>{item.name}</strong>
      <span>
        {item.id === GAOKAO_THREE_DAY_PATTERN_ID ? "9 科 · " : ""}
        {item.slots.length} 场 · 约 {patternDaySpan(item)} 天
      </span>
      {item.custom && <em>自定义</em>}
      <small>{item.description}</small>
    </button>
  );

  const generatePreview = () => {
    if (!subjects.length) {
      setError("请至少选择一个科目。");
      return;
    }
    if (!startDate) {
      setError("请先选择起始日期。");
      return;
    }
    setError("");
    setOverflowAck(false);
    setDraftItems(
      buildDraftItems(subjects, startDate, pattern).map((item) => ({
        ...item,
        name: normalizeSubjectName(item.name),
        targetClassIds: autoTargetClassIdsForSubject(item.name),
      })),
    );
    setStep(2);
  };

  const updateDraft = (id: string, patch: Partial<BatchDraftItem>) => {
    setDraftItems((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeDraft = (id: string) => {
    setDraftItems((items) => items.filter((item) => item.id !== id));
  };

  const appendDraft = () => {
    const base = draftItems[draftItems.length - 1];
    setDraftItems((items) => [
      ...items,
      {
        id: makeDraftId(),
        name: "",
        date: base?.date ?? startDate,
        start: base?.start ?? "08:30",
        end: base?.end ?? "09:30",
        enabled: true,
        allowCrossDay: false,
      },
    ]);
  };

  const commit = () => {
    if (!validation.ok) {
      setError("请先处理预览中标红的项目。");
      return;
    }
    if (overflowsDesign && !overflowAck) {
      setError("请先确认下方的场次顺延提醒后再添加。");
      return;
    }
    const maxOrder = existingItems.length ? Math.max(...existingItems.map((item) => item.order)) : -1;
    const nextItems: ExamItem[] = [
      ...existingItems,
      ...draftItems.map((item, index) => {
        const endNextDay = item.allowCrossDay && item.end <= item.start;
        return {
          id: makeExamId(),
          name: item.name.trim(),
          startTime: toLocalIso(item.date, item.start),
          endTime: toLocalIso(item.date, item.end, endNextDay),
          enabled: item.enabled,
          order: maxOrder + index + 1,
          targetClassIds: item.targetClassIds?.length ? item.targetClassIds : undefined,
        };
      }),
    ];
    onCommit(nextItems);
  };

  return (
    <AdminModalPortal>
      <div className="admin-modal-overlay" role="presentation">
        <section
          className="admin-modal admin-modal--wide admin-modal--workflow major-batch-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="major-batch-title"
        >
          <div className="admin-workflow-head">
            <span className="quick-major-modal__eyebrow">批量添加分考试</span>
            <h2 id="major-batch-title" className="admin-modal__title">
              {major.name}
            </h2>
          </div>
          <AdminWorkflowClose onClick={onClose} label="关闭批量添加分考试" />
          <div className="admin-workflow-layout">
            <AdminWizardSteps
              active={step}
              steps={[
                { label: "选择模板", hint: "确定科目组" },
                { label: "自动排布", hint: "选择日期和场次" },
                { label: "预览确认", hint: "检查后写入" },
              ]}
              summary={
                <>
                  <span>当前模板</span>
                  <strong>{template?.name ?? "手动科目组"}</strong>
                  <span>{subjects.length} 个科目</span>
                </>
              }
            />
            <div className="admin-workflow-content">
              {error && <div className="admin-error">{error}</div>}
              {step === 0 && (
                <div className="admin-workflow-pane">
                  <div className="admin-warning-banner">
                    批量添加会按班级选科自动细分选择性科目：语文、数学、外语默认下发到全部适用班级；物化地班级只会收到物理、化学、地理等命中的分考试。
                    {unsetTrackClassCount > 0 ? ` 当前范围内有 ${unsetTrackClassCount} 个班级未设置选科，选择性科目不会自动分发到这些班级。` : ""}
                  </div>
                  <div className="major-batch-template-groups">
                    <div className="major-batch-template-group">
                      <div className="major-batch-group-title">{CATEGORY_LABELS.gaokao}</div>
                      <div className="major-batch-template-grid">
                        {subjectTemplates
                          .filter((item) => item.category === "gaokao")
                          .map((item) => renderTemplateCard(item, templateId === item.id, () => selectTemplate(item)))}
                      </div>
                    </div>
                    {customSubjectGroups.length > 0 && (
                      <div className="major-batch-template-group">
                        <div className="major-batch-group-title">
                          我的自定义
                          <HelpTip title="我的自定义科目组">
                            保存的常用科目组会显示在这里，排在高考常用的下一项；如需新增、编辑或调整顺序，请前往「系统设置 → 批量预设管理」。
                          </HelpTip>
                        </div>
                        <div className="major-batch-template-grid">
                          {subjectTemplates
                            .filter((item) => item.category === "custom")
                            .map((item) => renderTemplateCard(item, templateId === item.id, () => selectTemplate(item)))}
                        </div>
                      </div>
                    )}
                    <div className="major-batch-template-group">
                      <div className="major-batch-group-title">{CATEGORY_LABELS.school}</div>
                      <div className="major-batch-template-grid">
                        {subjectTemplates
                          .filter((item) => item.category === "school")
                          .map((item) => renderTemplateCard(item, templateId === item.id, () => selectTemplate(item)))}
                      </div>
                    </div>
                  </div>
                  <section className="major-batch-subjects">
                    <div>
                      <strong>科目清单</strong>
                      <span>可在模板基础上增删，顺序即生成顺序</span>
                      <HelpTip title="科目顺序说明">
                        普通模板按下方编号顺序排布；新高考三天常用会按官方时间表自动归位，并将物理/历史合并为同一场。
                      </HelpTip>
                    </div>
                    {subjectCap && (
                      <p className={`major-batch-subject-hint${subjects.length >= subjectCap ? " is-ok" : ""}`}>
                        {subjects.length >= subjectCap
                          ? `已选满 ${subjectCap} 门科目`
                          : `还可选择 ${subjectCap - subjects.length} 门科目（本模板共需 ${subjectCap} 门）`}
                      </p>
                    )}
                    <div className="quick-major-subjects">
                      {COMMON_SUBJECTS.map((subject) => {
                        const selectedIndex = subjects.indexOf(subject);
                        const selected = selectedIndex !== -1;
                        const capReached = !selected && !!subjectCap && subjects.length >= subjectCap;
                        return (
                          <button
                            key={subject}
                            type="button"
                            className={`${selected ? "is-selected" : ""}${capReached ? " is-disabled" : ""}`.trim()}
                            disabled={capReached}
                            aria-disabled={capReached}
                            onClick={() => toggleSubject(subject)}
                          >
                            {selected && <span className="major-batch-subject-order">{selectedIndex + 1}</span>}
                            <SubjectIcon subject={subject} size={16} />
                            {subject}
                          </button>
                        );
                      })}
                    </div>
                    <div className="major-batch-custom-subject">
                      <input
                        className="admin-input"
                        value={customSubject}
                        onChange={(event) => setCustomSubject(event.target.value)}
                        placeholder="添加自定义科目名"
                        maxLength={40}
                      />
                      <button className="admin-btn" type="button" onClick={addCustomSubject}>
                        添加
                      </button>
                    </div>
                    <p className="major-batch-preset-hint">
                      需要新建自定义科目组？请前往「系统设置 → 批量预设管理」添加，添加后会自动显示在上方“我的自定义”分组中。
                    </p>
                  </section>
                </div>
              )}
              {step === 1 && (
                <div className="admin-workflow-pane">
                  <label className="admin-label">
                    起始日期
                    <DateTimeField
                      className="admin-date-time-field"
                      value={startDate}
                      onChange={setStartDate}
                      mode="date"
                      title="选择起始日期"
                      showFieldPreview={false}
                    />
                  </label>
                  <section className="major-batch-patterns">
                    <strong>时间安排模板</strong>
                    <div className="major-batch-template-group">
                      <div className="major-batch-group-title">{CATEGORY_LABELS.gaokao}</div>
                      <div className="quick-major-choice-grid major-batch-pattern-grid">
                        {dayPatterns
                          .filter((item) => item.category === "gaokao")
                          .map((item) => renderPatternCard(item, patternId === item.id, () => setPatternId(item.id)))}
                      </div>
                    </div>
                    {customTimeGroups.length > 0 && (
                      <div className="major-batch-template-group">
                        <div className="major-batch-group-title">
                          我的自定义
                          <HelpTip title="我的自定义时间组">
                            保存的常用时间组会显示在这里，排在高考常用的下一项；如需新增、编辑或调整顺序，请前往「系统设置 → 批量预设管理」。
                          </HelpTip>
                        </div>
                        <div className="quick-major-choice-grid major-batch-pattern-grid">
                          {dayPatterns
                            .filter((item) => item.category === "custom")
                            .map((item) => renderPatternCard(item, patternId === item.id, () => setPatternId(item.id)))}
                        </div>
                      </div>
                    )}
                    <div className="major-batch-template-group">
                      <div className="major-batch-group-title">{CATEGORY_LABELS.school}</div>
                      <div className="quick-major-choice-grid major-batch-pattern-grid">
                        {dayPatterns
                          .filter((item) => item.category === "school")
                          .map((item) => renderPatternCard(item, patternId === item.id, () => setPatternId(item.id)))}
                      </div>
                    </div>
                    <p className="major-batch-preset-hint">
                      需要新建自定义时间组？请前往「系统设置 → 批量预设管理」添加，添加后会自动显示在上方“我的自定义”分组中。
                    </p>
                  </section>
                  {needsMoreSlots && (
                    <div className="admin-warning-banner">
                      生成场次数（{arrangedSubjects.length}）超过「{pattern.name}」单轮场次数（{pattern.slots.length}），排布将顺延到第{" "}
                      {Math.ceil(arrangedSubjects.length / pattern.slots.length) * designDays} 天（模板设计为 {designDays} 天）。如需避免顺延，可选择场次更多的时间模板，或前往系统设置新增自定义时间组。
                    </div>
                  )}
                  <div className="admin-workflow-review">
                    <span>
                      将添加
                      <strong>{arrangedSubjects.length} 场分考试</strong>
                    </span>
                    <span>
                      科目覆盖
                      <strong>{subjects.length} 科{arrangedSubjects.length !== subjects.length ? ` · 合并为 ${arrangedSubjects.length} 场` : ""}</strong>
                    </span>
                    <span>
                      预计日期
                      <strong>
                        {fmtDate(startDate)} 起，约 {Math.ceil(arrangedSubjects.length / pattern.slots.length) * designDays} 天
                      </strong>
                    </span>
                    <span>
                      排布规则
                      <strong>{pattern.name}</strong>
                    </span>
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="admin-workflow-pane">
                  <div className="major-batch-preview-head">
                    <div>
                      <strong>预览结果</strong>
                      <span>
                        {validation.count} 场，{validation.errors.size ? `${validation.errors.size} 项需处理` : "校验通过"}
                      </span>
                    </div>
                    <button className="admin-btn" type="button" onClick={appendDraft}>
                      + 追加一场
                    </button>
                  </div>
                  {overflowsDesign && (
                    <div className="admin-warning-banner admin-warning-banner--callout">
                      <strong>⚠ 场次顺延提醒</strong>
                      <p>
                        科目数量超过「{pattern.name}」设计的 {designDays} 天场次容量，本次实际排布到了 {scheduledDays} 天。请确认日期安排符合预期后再添加。
                      </p>
                      <button
                        type="button"
                        className={`major-batch-preview__check major-batch-preview__check--ack${overflowAck ? " is-selected" : ""}`}
                        aria-pressed={overflowAck}
                        onClick={() => setOverflowAck((value) => !value)}
                      >
                        <span className="major-batch-checkmark" aria-hidden="true">
                          {overflowAck && <Check size={14} strokeWidth={3} />}
                        </span>
                        我已确认以上顺延排布无误
                      </button>
                    </div>
                  )}
                  <div className="major-batch-preview-summary">
                    <span>
                      总场次<strong>{validation.count}</strong>
                    </span>
                    <span>
                      科目覆盖<strong>{subjects.length} 科</strong>
                    </span>
                    <span>
                      启用<strong>{validation.enabledCount}</strong>
                    </span>
                    <span>
                      覆盖日期<strong>{previewRange}</strong>
                    </span>
                    <span className={validation.errors.size ? "is-danger" : "is-ok"}>
                      状态<strong>{validation.errors.size ? `${validation.errors.size} 项冲突` : "可添加"}</strong>
                    </span>
                  </div>
                  <div className="major-batch-preview major-batch-preview--cards">
                    {groupedDraftItems.map((group, groupIndex) => {
                      const dateHasError = group.items.some((item) => validation.errors.has(item.id));
                      const isCollapsed = collapsedDates.has(group.date) && !dateHasError;
                      return (
                        <section key={group.date} className={`major-batch-preview-card${isCollapsed ? " is-collapsed" : ""}`}>
                          <button
                            type="button"
                            className="major-batch-preview-card__head"
                            onClick={() => toggleDateCollapsed(group.date)}
                            aria-expanded={!isCollapsed}
                          >
                            <span className="major-batch-preview-card__day">第 {groupIndex + 1} 天</span>
                            <h3>{fmtDate(group.date)}</h3>
                            <span className="major-batch-preview-card__count">{group.items.length} 场</span>
                            {dateHasError && <span className="major-batch-preview-card__flag is-danger">需处理</span>}
                            <span className="major-batch-preview-card__chevron" aria-hidden="true">
                              {isCollapsed ? "▸" : "▾"}
                            </span>
                          </button>
                          {!isCollapsed && (
                            <div className="major-batch-preview-list major-batch-preview-list--cards">
                              {group.items.map((item) => {
                                const startIso = toLocalIso(item.date, item.start);
                                const endIso = toLocalIso(item.date, item.end, item.allowCrossDay && item.end <= item.start);
                                const messages = validation.errors.get(item.id) ?? [];
                                return (
                                  <article key={item.id} className={`major-batch-preview-item${messages.length ? " has-error" : ""}`}>
                                    <div className="major-batch-preview-item__subject">
                                      <SubjectIcon subject={item.name || "科目"} size={18} />
                                      <input
                                        className="admin-input major-batch-preview-item__name"
                                        value={item.name}
                                        onChange={(event) => updateDraft(item.id, { name: event.target.value })}
                                        placeholder="科目名称"
                                      />
                                      {!item.enabled && <span className="major-batch-preview-item__badge">已禁用</span>}
                                    </div>
                                    <div className="major-batch-preview-item__time">
                                      <label className="major-batch-preview-item__date">
                                        日期
                                        <DateTimeField
                                          className="admin-date-time-field"
                                          value={item.date}
                                          onChange={(date) => updateDraft(item.id, { date })}
                                          mode="date"
                                          title="修改考试日期"
                                          showFieldPreview={false}
                                        />
                                      </label>
                                      <button
                                        type="button"
                                        className="major-batch-preview-item__time-trigger"
                                        onClick={() => setTimeEditItemId(item.id)}
                                      >
                                        <Clock3 size={14} aria-hidden="true" />
                                        {item.start} – {item.end}
                                        {item.allowCrossDay && item.end <= item.start ? "（次日）" : ""}
                                      </button>
                                      <span className={`major-batch-preview-item__duration${messages.length ? " is-danger" : ""}`}>
                                        {messages.length ? "需处理" : durationText(startIso, endIso)}
                                      </span>
                                    </div>
                                    <div className="major-batch-preview-item__flags">
                                      <button
                                        type="button"
                                        className={`major-batch-preview__check${item.enabled ? " is-selected" : ""}`}
                                        aria-pressed={item.enabled}
                                        onClick={() => updateDraft(item.id, { enabled: !item.enabled })}
                                      >
                                        <span className="major-batch-checkmark" aria-hidden="true">
                                          {item.enabled && <Check size={14} strokeWidth={3} />}
                                        </span>
                                        启用
                                      </button>
                                      <button className="admin-item-btn admin-item-btn--delete" type="button" onClick={() => removeDraft(item.id)}>
                                        删除
                                      </button>
                                    </div>
                                    {messages.length > 0 && <p className="major-batch-preview-item__errors">{messages.join("；")}</p>}
                                  </article>
                                );
                              })}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                  {timeEditItem && (
                    <TimeRangePickerModal
                      open={!!timeEditItem}
                      mode="time"
                      title="设置考试时间"
                      startValue={timeEditItem.start}
                      endValue={timeEditItem.end}
                      subject={timeEditItem.name || "科目"}
                      allowCrossDay
                      initialCrossDay={timeEditItem.allowCrossDay}
                      onCancel={() => setTimeEditItemId(null)}
                      onConfirm={(start, end, crossDay) => {
                        updateDraft(timeEditItem.id, { start, end, allowCrossDay: crossDay });
                        setTimeEditItemId(null);
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="admin-modal__actions">
            <button
              className="admin-btn"
              type="button"
              onClick={() => {
                if (step === 0) onClose();
                else setStep((value) => value - 1);
              }}
            >
              {step === 0 ? "取消" : "上一步"}
            </button>
            {step < 1 && (
              <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" type="button" onClick={() => setStep(1)}>
                下一步
              </button>
            )}
            {step === 1 && (
              <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" type="button" onClick={generatePreview}>
                生成预览
              </button>
            )}
            {step === 2 && (
              <button
                className="admin-btn admin-btn--primary admin-workflow-actions-spacer"
                type="button"
                onClick={commit}
                disabled={overflowsDesign && !overflowAck}
              >
                确认添加
              </button>
            )}
          </div>
        </section>
      </div>
    </AdminModalPortal>
  );
}
