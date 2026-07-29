import { useEffect, useMemo, useState } from "react";
import type { ExamItem, MajorExam } from "../types";
import type { MajorBatchSubjectGroup, MajorBatchTimeGroup, MajorBatchTimeSlot } from "../utils/appSettings";
import {
  APP_SETTINGS_CHANGED_EVENT,
  getAppSettings,
  updateMajorBatchSettings,
} from "../utils/appSettings";
import AdminModalPortal from "./AdminModalPortal";
import AdminWizardSteps, { AdminWorkflowClose } from "./AdminWizardSteps";
import SubjectIcon from "./SubjectIcon";

type BatchDraftItem = {
  id: string;
  name: string;
  date: string;
  start: string;
  end: string;
  enabled: boolean;
  allowCrossDay: boolean;
};

type SubjectTemplate = {
  id: string;
  name: string;
  description: string;
  subjects: string[];
  custom?: boolean;
};

type DayPattern = {
  id: string;
  name: string;
  description: string;
  slots: MajorBatchTimeSlot[];
  custom?: boolean;
};

const SUBJECT_TEMPLATES: SubjectTemplate[] = [
  {
    id: "senior-nine",
    name: "高中常规九科",
    description: "语文、数学、外语与六门选考科目",
    subjects: ["语文", "数学", "外语", "物理", "历史", "化学", "地理", "思想政治", "生物"],
  },
  {
    id: "main-three",
    name: "语数外三科",
    description: "阶段练习和核心科目考试常用",
    subjects: ["语文", "数学", "外语"],
  },
  {
    id: "gaokao-three-day-subjects",
    name: "新高考三天常用",
    description: "按语文、数学、物理/历史、外语及四门再选科目排序",
    subjects: ["语文", "数学", "物理/历史", "外语", "化学", "地理", "思想政治", "生物"],
  },
];

const DAY_PATTERNS: DayPattern[] = [
  {
    id: "gaokao-three-day",
    name: "新高考三天常用",
    description: "7日语数，8日首选/外语，9日四门再选；各省可在预览中微调",
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
  },
  {
    id: "two-per-day",
    name: "每天 2 场",
    description: "上午一场，下午一场",
    slots: [
      { start: "09:00", end: "11:00" },
      { start: "15:00", end: "17:00" },
    ],
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
  },
];

const COMMON_SUBJECTS = [
  "语文",
  "数学",
  "外语",
  "英语",
  "物理",
  "历史",
  "化学",
  "地理",
  "思想政治",
  "生物",
  "信息技术",
  "通用技术",
  "体育",
  "音乐",
  "美术",
];

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

function buildDraftItems(subjects: string[], startDate: string, pattern: DayPattern): BatchDraftItem[] {
  const explicitDays = pattern.slots.some((slot) => slotDayOffset(slot) > 0);
  const daySpan = explicitDays ? patternDaySpan(pattern) : 1;
  return subjects.map((subject, index) => {
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

function makeCustomSubjectId() {
  return `batch_subject_group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeCustomTimeId() {
  return `batch_time_group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeName(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function customSubjectToTemplate(item: MajorBatchSubjectGroup): SubjectTemplate {
  return {
    id: item.id,
    name: item.name,
    description: `${item.subjects.length} 个科目，已保存为常用组`,
    subjects: item.subjects,
    custom: true,
  };
}

function customTimeToPattern(item: MajorBatchTimeGroup): DayPattern {
  return {
    id: item.id,
    name: item.name,
    description: `${item.slots.length} 个场次，已保存为常用时间组`,
    slots: item.slots,
    custom: true,
  };
}

export default function MajorBatchAddModal({
  major,
  existingItems,
  onClose,
  onCommit,
}: {
  major: MajorExam;
  existingItems: ExamItem[];
  onClose: () => void;
  onCommit: (nextItems: ExamItem[]) => void;
}) {
  const [step, setStep] = useState(0);
  const [customSubjectGroups, setCustomSubjectGroups] = useState<MajorBatchSubjectGroup[]>(() => getAppSettings().majorBatch.subjectGroups);
  const [customTimeGroups, setCustomTimeGroups] = useState<MajorBatchTimeGroup[]>(() => getAppSettings().majorBatch.timeGroups);
  const [templateId, setTemplateId] = useState(SUBJECT_TEMPLATES[0].id);
  const [subjects, setSubjects] = useState(SUBJECT_TEMPLATES[0].subjects);
  const [customSubject, setCustomSubject] = useState("");
  const [subjectGroupName, setSubjectGroupName] = useState("");
  const [startDate, setStartDate] = useState(todayKey);
  const [patternId, setPatternId] = useState(DAY_PATTERNS[0].id);
  const [timeGroupName, setTimeGroupName] = useState("");
  const [draftItems, setDraftItems] = useState<BatchDraftItem[]>([]);
  const [error, setError] = useState("");

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

  const selectTemplate = (next: SubjectTemplate) => {
    setTemplateId(next.id);
    setSubjects(next.subjects);
    setError("");
  };

  const addCustomSubject = () => {
    const value = customSubject.trim();
    if (!value || subjects.includes(value)) return;
    setSubjects((items) => [...items, value]);
    setTemplateId("manual-subjects");
    setCustomSubject("");
  };

  const toggleSubject = (subject: string) => {
    setSubjects((items) => {
      setTemplateId("manual-subjects");
      return items.includes(subject) ? items.filter((item) => item !== subject) : [...items, subject];
    });
  };

  const saveSubjectGroup = () => {
    const cleanSubjects = [...new Set(subjects.map((item) => item.trim()).filter(Boolean))];
    if (!cleanSubjects.length) {
      setError("请至少选择一个科目后再保存常用组。");
      return;
    }
    const next: MajorBatchSubjectGroup = {
      id: makeCustomSubjectId(),
      name: normalizeName(subjectGroupName, `常用科目组 ${customSubjectGroups.length + 1}`),
      subjects: cleanSubjects,
      custom: true,
      updatedAt: Date.now(),
    };
    const nextGroups = [next, ...customSubjectGroups].slice(0, 24);
    updateMajorBatchSettings({ subjectGroups: nextGroups });
    setCustomSubjectGroups(nextGroups);
    setTemplateId(next.id);
    setSubjectGroupName("");
    setError("");
  };

  const deleteSubjectGroup = (id: string) => {
    const nextGroups = customSubjectGroups.filter((item) => item.id !== id);
    updateMajorBatchSettings({ subjectGroups: nextGroups });
    setCustomSubjectGroups(nextGroups);
    if (templateId === id) selectTemplate(SUBJECT_TEMPLATES[0]);
  };

  const saveTimeGroup = () => {
    if (!pattern.slots.length) return;
    const next: MajorBatchTimeGroup = {
      id: makeCustomTimeId(),
      name: normalizeName(timeGroupName, `常用时间组 ${customTimeGroups.length + 1}`),
      slots: pattern.slots.map((slot) => ({ ...slot, dayOffset: slotDayOffset(slot) })),
      custom: true,
      updatedAt: Date.now(),
    };
    const nextGroups = [next, ...customTimeGroups].slice(0, 24);
    updateMajorBatchSettings({ timeGroups: nextGroups });
    setCustomTimeGroups(nextGroups);
    setPatternId(next.id);
    setTimeGroupName("");
    setError("");
  };

  const deleteTimeGroup = (id: string) => {
    const nextGroups = customTimeGroups.filter((item) => item.id !== id);
    updateMajorBatchSettings({ timeGroups: nextGroups });
    setCustomTimeGroups(nextGroups);
    if (patternId === id) setPatternId(DAY_PATTERNS[0].id);
  };

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
    setDraftItems(buildDraftItems(subjects, startDate, pattern));
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
                  <div className="major-batch-template-grid">
                    {subjectTemplates.map((item) => (
                      <div key={item.id} className="major-batch-template-shell">
                        <button
                          type="button"
                          className={`quick-major-choice major-batch-template${templateId === item.id ? " is-selected" : ""}`}
                          onClick={() => selectTemplate(item)}
                        >
                          <strong>{item.name}</strong>
                          <span>{item.subjects.length} 个</span>
                          {item.custom && <em>自定义</em>}
                          <small>{item.description}</small>
                        </button>
                        {item.custom && (
                          <button className="major-batch-delete-preset" type="button" onClick={() => deleteSubjectGroup(item.id)}>
                            删除
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <section className="major-batch-subjects">
                    <div>
                      <strong>科目清单</strong>
                      <span>可在模板基础上增删，顺序即生成顺序</span>
                    </div>
                    <div className="quick-major-subjects">
                      {COMMON_SUBJECTS.map((subject) => (
                        <button
                          key={subject}
                          type="button"
                          className={subjects.includes(subject) ? "is-selected" : ""}
                          onClick={() => toggleSubject(subject)}
                        >
                          <SubjectIcon subject={subject} size={16} />
                          {subject}
                        </button>
                      ))}
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
                    <div className="major-batch-save-row">
                      <input
                        className="admin-input"
                        value={subjectGroupName}
                        onChange={(event) => setSubjectGroupName(event.target.value)}
                        placeholder="常用科目组名称"
                        maxLength={30}
                      />
                      <button className="admin-btn" type="button" onClick={saveSubjectGroup}>
                        保存为常用组
                      </button>
                    </div>
                  </section>
                </div>
              )}
              {step === 1 && (
                <div className="admin-workflow-pane">
                  <label className="admin-label">
                    起始日期
                    <input
                      className="admin-input"
                      type="date"
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                    />
                  </label>
                  <section className="major-batch-patterns">
                    <strong>时间安排模板</strong>
                    <div className="quick-major-choice-grid major-batch-pattern-grid">
                      {dayPatterns.map((item) => (
                        <div key={item.id} className="major-batch-template-shell">
                          <button
                            type="button"
                            className={`quick-major-choice${patternId === item.id ? " is-selected" : ""}`}
                            onClick={() => setPatternId(item.id)}
                          >
                            <strong>{item.name}</strong>
                            <span>
                              {item.slots.length} 场 · 约 {patternDaySpan(item)} 天
                            </span>
                            {item.custom && <em>自定义</em>}
                            <small>{item.description}</small>
                          </button>
                          {item.custom && (
                            <button className="major-batch-delete-preset" type="button" onClick={() => deleteTimeGroup(item.id)}>
                              删除
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="major-batch-save-row">
                      <input
                        className="admin-input"
                        value={timeGroupName}
                        onChange={(event) => setTimeGroupName(event.target.value)}
                        placeholder="常用时间组名称"
                        maxLength={30}
                      />
                      <button className="admin-btn" type="button" onClick={saveTimeGroup}>
                        保存当前时间组
                      </button>
                    </div>
                  </section>
                  <div className="admin-workflow-review">
                    <span>
                      将添加
                      <strong>{subjects.length} 场分考试</strong>
                    </span>
                    <span>
                      预计日期
                      <strong>
                        {fmtDate(startDate)} 起，约 {Math.ceil(subjects.length / pattern.slots.length) * patternDaySpan(pattern)} 天
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
                  <div className="major-batch-preview-summary">
                    <span>
                      总场次<strong>{validation.count}</strong>
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
                  <div className="major-batch-preview">
                    {groupedDraftItems.map((group) => (
                      <section key={group.date}>
                        <h3>{fmtDate(group.date)}</h3>
                        <div className="major-batch-preview-list">
                          {group.items.map((item) => {
                            const startIso = toLocalIso(item.date, item.start);
                            const endIso = toLocalIso(item.date, item.end, item.allowCrossDay && item.end <= item.start);
                            const messages = validation.errors.get(item.id) ?? [];
                            return (
                              <article key={item.id} className={messages.length ? "has-error" : ""}>
                                <label className="major-batch-preview__subject">
                                  科目
                                  <input
                                    className="admin-input"
                                    value={item.name}
                                    onChange={(event) => updateDraft(item.id, { name: event.target.value })}
                                  />
                                </label>
                                <label>
                                  日期
                                  <input
                                    className="admin-input"
                                    type="date"
                                    value={item.date}
                                    onChange={(event) => updateDraft(item.id, { date: event.target.value })}
                                  />
                                </label>
                                <label>
                                  开始
                                  <input
                                    className="admin-input"
                                    type="time"
                                    value={item.start}
                                    onChange={(event) => updateDraft(item.id, { start: event.target.value })}
                                  />
                                </label>
                                <label>
                                  结束
                                  <input
                                    className="admin-input"
                                    type="time"
                                    value={item.end}
                                    onChange={(event) => updateDraft(item.id, { end: event.target.value })}
                                  />
                                </label>
                                <div className="major-batch-preview__flags">
                                  <label className="major-batch-preview__check">
                                    <input
                                      type="checkbox"
                                      checked={item.allowCrossDay}
                                      onChange={(event) => updateDraft(item.id, { allowCrossDay: event.target.checked })}
                                    />
                                    跨日
                                  </label>
                                  <label className="major-batch-preview__check">
                                    <input
                                      type="checkbox"
                                      checked={item.enabled}
                                      onChange={(event) => updateDraft(item.id, { enabled: event.target.checked })}
                                    />
                                    启用
                                  </label>
                                </div>
                                <span className={messages.length ? "is-danger" : ""}>{messages.length ? "需处理" : durationText(startIso, endIso)}</span>
                                <button className="admin-item-btn admin-item-btn--delete" type="button" onClick={() => removeDraft(item.id)}>
                                  删除
                                </button>
                                {messages.length > 0 && <p>{messages.join("；")}</p>}
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
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
              <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" type="button" onClick={commit}>
                确认添加
              </button>
            )}
          </div>
        </section>
      </div>
    </AdminModalPortal>
  );
}
