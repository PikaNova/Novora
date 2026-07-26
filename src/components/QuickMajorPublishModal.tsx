import React, { useMemo, useState } from "react";
import { Clock3, X } from "lucide-react";
import type { MajorExam } from "../types";
import type { SchoolGrade } from "../types/school";

export interface QuickMajorPublishInput {
  name: string;
  targetGradeIds: string[];
  subject: string;
  startTime: string;
  durationMinutes: number;
  priorityOverSchedule: boolean;
}

interface Props {
  grades: SchoolGrade[];
  initialGradeIds: string[];
  allowSchoolWide: boolean;
  lockedClassName?: string;
  majors: MajorExam[];
  onClose: () => void;
  onPublish: (input: QuickMajorPublishInput) => void;
}

const SUBJECTS = [
  "语文",
  "数学",
  "英语",
  "物理",
  "化学",
  "生物",
  "政治",
  "历史",
  "地理",
  "其他",
];
const DELAYS = [
  { label: "立即开始", minutes: 0 },
  { label: "5 分钟后", minutes: 5 },
  { label: "10 分钟后", minutes: 10 },
  { label: "15 分钟后", minutes: 15 },
  { label: "30 分钟后", minutes: 30 },
];
const DURATIONS = [30, 45, 60, 90, 120];
const TIME_STEP_MS = 5 * 60_000;

function roundUpToFiveMinutes(time: number) {
  return Math.ceil(time / TIME_STEP_MS) * TIME_STEP_MS;
}

function localInputValue(time: number) {
  const date = new Date(time - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function displayTime(value: string) {
  return value ? value.replace("T", " ") : "未设置";
}

export default function QuickMajorPublishModal({
  grades,
  initialGradeIds,
  allowSchoolWide,
  lockedClassName,
  majors,
  onClose,
  onPublish,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState(
    `临时统一考试 · ${new Date().toLocaleDateString("zh-CN")}`,
  );
  const [targetGradeIds, setTargetGradeIds] =
    useState<string[]>(initialGradeIds);
  const [schoolWide, setSchoolWide] = useState(false);
  const [subject, setSubject] = useState("");
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [customStart, setCustomStart] = useState("");
  const [useCustomStart, setUseCustomStart] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [customDuration, setCustomDuration] = useState("");
  const [priorityOverSchedule, setPriorityOverSchedule] = useState(false);
  const [error, setError] = useState("");

  const startTime = useCustomStart
    ? customStart
    : localInputValue(delayMinutes === 0 ? Date.now() : roundUpToFiveMinutes(Date.now() + delayMinutes * 60_000));
  const finalDuration = customDuration
    ? Math.max(5, Math.min(720, Math.round((Number(customDuration) || durationMinutes) / 5) * 5))
    : durationMinutes;
  const previewEndTime = Number.isFinite(new Date(startTime).getTime())
    ? localInputValue(new Date(startTime).getTime() + finalDuration * 60_000)
    : "";
  const effectiveTargetGradeIds = schoolWide ? [] : targetGradeIds;
  const conflicts = useMemo(() => {
    const start = new Date(startTime).getTime();
    const end = start + finalDuration * 60_000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    return majors.filter((major) => {
      if (major.endedAt || !major.items.some((item) => item.enabled))
        return false;
      const applies =
        !effectiveTargetGradeIds.length ||
        !major.targetGradeIds?.length ||
        major.targetGradeIds.some((id) => effectiveTargetGradeIds.includes(id));
      return (
        applies &&
        major.items.some(
          (item) =>
            item.enabled &&
            start < new Date(item.endTime).getTime() &&
            end > new Date(item.startTime).getTime(),
        )
      );
    });
  }, [effectiveTargetGradeIds, finalDuration, majors, startTime]);

  const next = () => {
    setError("");
    if (step === 1) {
      if (!name.trim()) {
        setError("请填写本次统一考试名称。");
        return;
      }
      if (!schoolWide && !targetGradeIds.length) {
        setError("请至少选择一个年级，或选择全校统一。");
        return;
      }
    }
    if (step === 2) {
      if (!subject) {
        setError("请选择考试科目。");
        return;
      }
      if (!startTime || !Number.isFinite(new Date(startTime).getTime())) {
        setError("请设置有效的开始时间。");
        return;
      }
    }
    setStep((value) => Math.min(3, value + 1) as 1 | 2 | 3);
  };

  const publish = () => {
    if (!priorityOverSchedule && conflicts.length) {
      setError(
        "检测到与现有安排重叠。请确认保留原安排，或勾选本次临时统一考试优先。",
      );
      return;
    }
    onPublish({
      name: name.trim(),
      targetGradeIds: effectiveTargetGradeIds,
      subject,
      startTime,
      durationMinutes: finalDuration,
      priorityOverSchedule,
    });
  };

  return (
    <div className="admin-modal-overlay" role="presentation">
      <div
        className="admin-modal admin-modal--wide quick-major-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-major-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="quick-major-modal__head">
          <div>
            <span className="quick-major-modal__eyebrow">后台统一下发</span>
            <h2 id="quick-major-title" className="admin-modal__title">
              统一添加单科考试
            </h2>
          </div>
          <div className="quick-major-modal__head-actions">
            <span className="quick-major-modal__step">第 {step} / 3 步</span>
            <button type="button" className="quick-major-modal__close" onClick={onClose} aria-label="退出统一添加单科考试">
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="quick-major-modal__progress">
          <span style={{ width: `${(step / 3) * 100}%` }} />
        </div>
        {error && <div className="admin-error">{error}</div>}

        {step === 1 && (
          <div className="quick-major-modal__body">
            <label className="admin-label">
              考试名称
              <input
                className="admin-input"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="quick-major-modal__section">
              <strong>{lockedClassName ? "适用班级" : "适用年级"}</strong>
              <p>
                {lockedClassName
                  ? `本次考试仅下发到${lockedClassName}绑定的设备。`
                  : "统一考试会自动下发到所选年级中已绑定的全部看板。"}
              </p>
              {lockedClassName ? (
                <div className="quick-major-choice is-selected">
                  {lockedClassName}
                </div>
              ) : (
                <>
                  {allowSchoolWide && (
                    <button
                      type="button"
                      className={`quick-major-choice${schoolWide ? " is-selected" : ""}`}
                      onClick={() => setSchoolWide((value) => !value)}
                    >
                      全校统一<span>所有年级</span>
                    </button>
                  )}
                  <div className="quick-major-choice-grid">
                    {grades.map((grade) => (
                      <button
                        type="button"
                        key={grade.id}
                        className={`quick-major-choice${!schoolWide && targetGradeIds.includes(grade.id) ? " is-selected" : ""}`}
                        onClick={() => {
                          setSchoolWide(false);
                          setTargetGradeIds((ids) =>
                            ids.includes(grade.id)
                              ? ids.filter((id) => id !== grade.id)
                              : [...ids, grade.id],
                          );
                        }}
                      >
                        {grade.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="quick-major-modal__body">
            <div className="quick-major-modal__section">
              <strong>考试科目</strong>
              <div className="quick-major-subjects">
                {SUBJECTS.map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={subject === value ? "is-selected" : ""}
                    onClick={() => setSubject(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div className="quick-major-modal__section">
              <strong>开始方式</strong>
              <div className="quick-major-choice-grid">
                {DELAYS.map((option) => (
                  <button
                    type="button"
                    key={option.minutes}
                    className={`quick-major-choice${!useCustomStart && delayMinutes === option.minutes ? " is-selected" : ""}`}
                    onClick={() => {
                      setUseCustomStart(false);
                      setDelayMinutes(option.minutes);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`quick-major-choice${useCustomStart ? " is-selected" : ""}`}
                  onClick={() => setUseCustomStart(true)}
                >
                  指定时间
                </button>
              </div>
              {useCustomStart && (
                <input
                  className="admin-input"
                  type="datetime-local"
                  step="300"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
              )}
            </div>
            <div className="quick-major-modal__section">
              <strong>考试时长</strong>
              <div className="quick-major-choice-grid">
                {DURATIONS.map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={`quick-major-choice${!customDuration && durationMinutes === value ? " is-selected" : ""}`}
                    onClick={() => {
                      setCustomDuration("");
                      setDurationMinutes(value);
                    }}
                  >
                    {value} 分钟
                  </button>
                ))}
                <label className="quick-major-custom-duration">
                  自定义
                  <input
                    className="admin-input"
                    type="number"
                    min="5"
                    max="720"
                    step="5"
                    value={customDuration}
                    onChange={(event) => setCustomDuration(event.target.value)}
                    placeholder="分钟"
                  />
                </label>
              </div>
            </div>
            <section className="quick-major-live-preview" aria-live="polite">
              <Clock3 aria-hidden="true" />
              <div>
                <span>考试预览</span>
                <strong>{subject || "请先选择考试科目"}</strong>
                <p>{previewEndTime ? `${displayTime(startTime)} - ${displayTime(previewEndTime)}` : "请选择有效的开始时间"}</p>
                <small>{finalDuration} 分钟{useCustomStart || delayMinutes > 0 ? " · 已按 5 分钟刻度安排" : " · 立即开始"}</small>
              </div>
            </section>
          </div>
        )}

        {step === 3 && (
          <div className="quick-major-modal__body">
            <section className="quick-major-summary">
              <span>
                {schoolWide
                  ? "全校统一"
                  : grades
                      .filter((grade) =>
                        effectiveTargetGradeIds.includes(grade.id),
                      )
                      .map((grade) => grade.name)
                      .join("、")}
              </span>
              <strong>{name}</strong>
              <p>
                {subject} · {displayTime(startTime)} 开始 · {finalDuration} 分钟
              </p>
            </section>
            <section
              className={`quick-major-conflicts${conflicts.length ? " has-conflicts" : ""}`}
            >
              <strong>
                {conflicts.length
                  ? `发现 ${conflicts.length} 场可能冲突的现有大型考试`
                  : "未发现时间冲突"}
              </strong>
              {conflicts.length ? (
                <ul>
                  {conflicts.map((major) => (
                    <li key={major.id}>{major.name}</li>
                  ))}
                </ul>
              ) : (
                <p>将按照现有调度规则发布，不影响其他考试。</p>
              )}
            </section>
            {conflicts.length > 0 && (
              <label className="quick-major-priority">
                <input
                  type="checkbox"
                  checked={priorityOverSchedule}
                  onChange={(event) =>
                    setPriorityOverSchedule(event.target.checked)
                  }
                />
                <span>
                  <strong>本次临时统一考试优先</strong>
                  <small>
                    仅覆盖重叠时间内的正式大型考试；原安排不会被删除。
                  </small>
                </span>
              </label>
            )}
          </div>
        )}

        <div className="admin-modal__actions">
          <button
            className="admin-btn"
            onClick={
              step === 1
                ? onClose
                : () => {
                    setError("");
                    setStep((value) => (value - 1) as 1 | 2 | 3);
                  }
            }
          >
            {step === 1 ? "取消" : "上一步"}
          </button>
          {step < 3 ? (
            <button className="admin-btn admin-btn--primary" onClick={next}>
              下一步
            </button>
          ) : (
            <button className="admin-btn admin-btn--primary" onClick={publish}>
              添加并下发
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
