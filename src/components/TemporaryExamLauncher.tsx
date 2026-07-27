import React, { useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Play,
  Plus,
  TimerReset,
} from "lucide-react";
import type { ExamItem } from "../types";
import {
  endTemporaryExam,
  extendTemporaryExam,
  getTemporaryExam,
  saveTemporaryExam,
  toggleTemporaryExamPause,
} from "../services/temporaryExam";
import { notify } from "../services/notify";
import { getAppSettings } from "../utils/appSettings";
import { classDisplayName } from "../utils/classSettings";
import { confirmDialog } from "../services/appDialog";
import { DateTimeField } from "./touch-datetime-picker";
import SubjectIcon from "./SubjectIcon";
import TimeRangePickerModal from "./TimeRangePickerModal";

const COMMON_SUBJECTS = [
  "语文",
  "数学",
  "英语",
  "物理",
  "化学",
  "生物",
  "政治",
  "历史",
  "地理",
];
const DURATION_PRESETS = [45, 60, 75, 90, 120, 150];
const DELAY_PRESETS = [5, 10, 15, 30];
const isoLocal = (value: number) =>
  new Date(value - new Date(value).getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19);
const dateKey = (value: number) => isoLocal(value).slice(0, 10);
const timeKey = (value: number) => isoLocal(value).slice(11, 16);
const parseLocal = (date: string, time: string) =>
  new Date(`${date}T${time}:00`).getTime();
const formatDateTime = (value: number) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}小时${remainder ? `${remainder}分钟` : ""}`;
};
const roundUpToFiveMinutes = (value: number) => Math.ceil(value / 300_000) * 300_000;
const nextFiveMinutes = () => roundUpToFiveMinutes(Date.now() + 5 * 60_000);
export default function TemporaryExamLauncher({
  formalItems,
  externalOpen = false,
  onExternalHandled,
}: {
  formalItems: ExamItem[];
  externalOpen?: boolean;
  onExternalHandled?: () => void;
}) {
  const current = getTemporaryExam();
  const settings = getAppSettings().exam;
  const boundClass = classDisplayName(
    settings.grades,
    settings.classes,
    settings.selectedClassId,
  );
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [subject, setSubject] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [customSubjectOpen, setCustomSubjectOpen] = useState(false);
  const [mode, setMode] = useState<"now" | "delay" | "specific">("now");
  const [delay, setDelay] = useState(10);
  const [duration, setDuration] = useState(45);
  const [specificDate, setSpecificDate] = useState(() =>
    dateKey(nextFiveMinutes()),
  );
  const [specificTime, setSpecificTime] = useState(() =>
    timeKey(nextFiveMinutes()),
  );
  const [timeRangeOpen, setTimeRangeOpen] = useState(false);
  const timeRangeSnapshotRef = useRef<null | { mode: "now" | "delay" | "specific"; delay: number; duration: number; specificDate: string; specificTime: string; crossDayConfirmed: boolean }>(null);
  const [crossDayConfirmed, setCrossDayConfirmed] = useState(false);
  const [priority, setPriority] = useState(false);
  const shouldOpen = open || externalOpen;
  const finalSubject = customSubjectOpen ? customSubject.trim() : subject;
  const startMs =
    mode === "now"
      ? Date.now()
      : mode === "delay"
        ? roundUpToFiveMinutes(Date.now() + delay * 60_000)
        : parseLocal(specificDate, specificTime);
  const endMs = startMs + Math.max(5, duration) * 60_000;
  const openTimeRange = () => {
    timeRangeSnapshotRef.current = { mode, delay, duration, specificDate, specificTime, crossDayConfirmed };
    setTimeRangeOpen(true);
  };
  const cancelTimeRange = () => {
    const snapshot = timeRangeSnapshotRef.current;
    if (snapshot) {
      setMode(snapshot.mode);
      setDelay(snapshot.delay);
      setDuration(snapshot.duration);
      setSpecificDate(snapshot.specificDate);
      setSpecificTime(snapshot.specificTime);
      setCrossDayConfirmed(snapshot.crossDayConfirmed);
    }
    setTimeRangeOpen(false);
  };
  const applyTimeRangeDraft = (startTime: string, endTime: string, endNextDay: boolean) => {
    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);
    let nextDuration = endHour * 60 + endMinute - startHour * 60 - startMinute;
    if (endNextDay || nextDuration <= 0) nextDuration += 1440;
    setSpecificDate(dateKey(startMs));
    setSpecificTime(startTime);
    setDuration(nextDuration);
    setCrossDayConfirmed(endNextDay);
    setMode("specific");
  };
  const conflicts = useMemo(
    () =>
      formalItems.filter(
        (item) =>
          item.enabled &&
          new Date(item.startTime).getTime() < endMs &&
          new Date(item.endTime).getTime() > startMs,
      ),
    [endMs, formalItems, startMs],
  );
  const close = () => {
    setOpen(false);
    setStep(0);
    setCrossDayConfirmed(false);
    onExternalHandled?.();
  };
  const chooseSubject = (value: string) => {
    setSubject(value);
    setCustomSubjectOpen(false);
    setCustomSubject("");
  };
  const next = () => {
    if (step === 0 && !finalSubject) {
      notify("error", "请先选择或填写考试科目。");
      return;
    }
    if (
      step === 1 &&
      (!Number.isFinite(startMs) ||
        startMs < Date.now() - 60_000 ||
        duration < 5 ||
        (dateKey(startMs) !== dateKey(endMs) && !crossDayConfirmed))
    ) {
      notify("error", dateKey(startMs) !== dateKey(endMs) && !crossDayConfirmed
        ? "本场考试会跨日，请在时间设置中勾选启用跨日考试。"
        : "请检查开始时间和考试时长。");
      return;
    }
    setStep((value) => Math.min(2, value + 1));
  };
  const create = async () => {
    if (
      !finalSubject ||
      !Number.isFinite(startMs) ||
      endMs <= startMs ||
      (dateKey(startMs) !== dateKey(endMs) && !crossDayConfirmed)
    ) {
      notify("error", "临时考试信息不完整，请返回检查。");
      return;
    }
    if (
      conflicts.length &&
      !(await confirmDialog({
        title: "临时考试时间冲突",
        message: `${conflicts.map((item) => item.name).join("、")} 与本次临时考试重叠。\n${priority ? "本设备将优先显示临时考试。" : "正式考试开始后将自动接管。"}`,
        tone: priority ? "danger" : "warning",
        confirmLabel: "确认创建",
      }))
    )
      return;
    saveTemporaryExam({
      id: `temp_${Date.now()}`,
      subject: finalSubject,
      startTime: isoLocal(startMs),
      endTime: isoLocal(endMs),
      priorityOverFormal: priority,
      status: startMs <= Date.now() ? "running" : "scheduled",
      createdAt: Date.now(),
    });
    notify("success", `${finalSubject} - 临时考试已创建，仅应用于当前设备。`);
    close();
  };

  return (
    <>
      <button className="temp-exam-fab" onClick={() => setOpen(true)}>
        <Play />
        {current && current.status !== "ended"
          ? "管理临时考试"
          : "快速开始考试"}
      </button>
      {shouldOpen && (
        <div className="temp-exam-overlay" role="dialog" aria-modal="true">
          <section className="temp-exam-panel">
            <header>
              <div>
                <span>当前设备{boundClass ? ` · ${boundClass}` : ""}</span>
                <h2>
                  {current && current.status !== "ended"
                    ? "管理临时考试"
                    : "快速开始考试"}
                </h2>
              </div>
              <button onClick={close} aria-label="关闭">
                ×
              </button>
            </header>
            {current && current.status !== "ended" ? (
              <div className="temp-exam-current">
                <TimerReset />
                <h3>{current.subject} - 临时考试</h3>
                <p>
                  {current.startTime.replace("T", " ")} 至{" "}
                  {current.endTime.replace("T", " ")}
                </p>
                <div>
                  <button
                    onClick={() => {
                      toggleTemporaryExamPause();
                      notify(
                        "warning",
                        current.status === "paused"
                          ? "临时考试已继续。"
                          : "临时考试已暂停。",
                      );
                      close();
                    }}
                  >
                    {current.status === "paused" ? "继续" : "暂停"}
                  </button>
                  <button
                    onClick={() => {
                      extendTemporaryExam(5);
                      notify("success", "临时考试已延长 5 分钟。");
                      close();
                    }}
                  >
                    增加 5 分钟
                  </button>
                  <button
                    className="is-danger"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: "提前结束临时考试",
                          message:
                            "确定提前结束当前临时考试？结束后无法恢复当前计时状态。",
                          tone: "danger",
                          confirmLabel: "提前结束",
                        })
                      ) {
                        endTemporaryExam();
                        notify("warning", "临时考试已提前结束。");
                        close();
                      }
                    }}
                  >
                    提前结束
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="temp-exam-progress">
                  {["选择科目", "设置时间", "确认选项"].map((label, index) => (
                    <div
                      key={label}
                      className={
                        index === step
                          ? "is-active"
                          : index < step
                            ? "is-done"
                            : ""
                      }
                    >
                      <i>{index < step ? <Check /> : index + 1}</i>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="temp-exam-wizard">
                  {step === 0 && (
                    <section className="temp-exam-step">
                      <div className="temp-exam-step__head">
                        <span>第一步</span>
                        <h3>选择考试科目</h3>
                        <p>选择常用科目，或填写其他科目名称。</p>
                      </div>
                      <div className="temp-subject-grid">
                        {COMMON_SUBJECTS.map((item) => (
                          <button
                            key={item}
                            className={
                              !customSubjectOpen && subject === item
                                ? "is-selected"
                                : ""
                            }
                            onClick={() => chooseSubject(item)}
                          >
                            <span><SubjectIcon subject={item} size={17} />{item}</span>
                            {!customSubjectOpen && subject === item && (
                              <Check />
                            )}
                          </button>
                        ))}
                        <button
                          className={customSubjectOpen ? "is-selected" : ""}
                          onClick={() => {
                            setCustomSubjectOpen(true);
                            setSubject("");
                          }}
                        >
                          <span><SubjectIcon subject="其他" size={17} />其他科目</span>
                        </button>
                      </div>
                      {customSubjectOpen && (
                        <label className="temp-custom-subject">
                          <span>科目名称</span>
                          <input
                            autoFocus
                            value={customSubject}
                            onChange={(event) =>
                              setCustomSubject(event.target.value)
                            }
                            maxLength={30}
                            placeholder="如：信息技术"
                          />
                        </label>
                      )}
                    </section>
                  )}
                  {step === 1 && (
                    <section className="temp-exam-step">
                      <div className="temp-exam-step__head">
                        <span>第二步</span>
                        <h3>设置考试时间</h3>
                        <p>开始方式与具体时间分开设置，避免误操作。</p>
                      </div>
                      <fieldset className="temp-mode-grid">
                        <legend>开始方式</legend>
                        <button
                          className={mode === "now" ? "is-active" : ""}
                          onClick={() => { setMode("now"); setCrossDayConfirmed(false); }}
                        >
                          立即开始
                        </button>
                        <button
                          className={mode === "delay" ? "is-active" : ""}
                          onClick={() => { setMode("delay"); setCrossDayConfirmed(false); }}
                        >
                          稍后开始
                        </button>
                        <button
                          className={mode === "specific" ? "is-active" : ""}
                          onClick={() => { setMode("specific"); setCrossDayConfirmed(false); }}
                        >
                          指定时间
                        </button>
                      </fieldset>
                      {mode === "now" && (
                        <div className="temp-preset temp-duration-presets">
                          <span>常用考试时长</span>
                          <div>
                            {DURATION_PRESETS.map((value) => (
                              <button
                                type="button"
                                key={value}
                                className={duration === value ? "is-active" : ""}
                                aria-pressed={duration === value}
                                onClick={() => {
                                  setDuration(value);
                                  setCrossDayConfirmed(false);
                                }}
                              >
                                {formatDuration(value)}
                              </button>
                            ))}
                          </div>
                          <small>以当前时间开始，并按所选时长自动计算结束时间。</small>
                        </div>
                      )}
                      {mode === "delay" && (
                        <div className="temp-preset">
                          <span>延迟时间</span>
                          <div>
                            {DELAY_PRESETS.map((value) => (
                              <button
                                key={value}
                                className={delay === value ? "is-active" : ""}
                                onClick={() => { setDelay(value); setCrossDayConfirmed(false); }}
                              >
                                {value} 分钟后
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {mode === "specific" && (
                        <div className="temp-specific-time">
                          <label>
                            <span>日期</span>
                            <DateTimeField
                              className="admin-date-time-field"
                              value={specificDate}
                              onChange={(value) => { setSpecificDate(value); setCrossDayConfirmed(false); }}
                              mode="date"
                              title="选择考试日期"
                              showFieldPreview={false}
                            />
                          </label>
                        </div>
                      )}
                      <div className="temp-time-setting">
                        <span>时间设置</span>
                        <button type="button" onClick={openTimeRange}>
                          <strong>{formatDateTime(startMs)} - {formatDateTime(endMs)}</strong>
                          <small>一次设置开始时间、结束时间和常用时长</small>
                        </button>
                      </div>
                      <div className="temp-time-summary">
                        <Clock3 />
                        <div>
                          <span>预计时间</span>
                          <strong>
                            {formatDateTime(startMs)} -{" "}
                            {formatDateTime(endMs)}
                          </strong>
                        </div>
                      </div>
                    </section>
                  )}
                  {step === 2 && (
                    <section className="temp-exam-step">
                      <div className="temp-exam-step__head">
                        <span>第三步</span>
                        <h3>确认临时考试</h3>
                        <p>临时考试只影响当前设备，不修改统一排期。</p>
                      </div>
                      <div className="temp-exam-summary">
                        <strong>{finalSubject}</strong>
                        <span>
                          {formatDateTime(startMs)} -{" "}
                          {formatDateTime(endMs)}
                        </span>
                        <small>{boundClass || "当前设备尚未绑定班级"}</small>
                      </div>
                      <fieldset className="temp-priority-options">
                        <legend>与正式考试的关系</legend>
                        <button
                          className={!priority ? "is-active" : ""}
                          onClick={() => setPriority(false)}
                        >
                          <i>{!priority && <Check />}</i>
                          <span>
                            <strong>不覆盖正式考试</strong>
                            <small>
                              正式考试开始时自动接管大屏，推荐使用。
                            </small>
                          </span>
                        </button>
                        <button
                          className={priority ? "is-danger is-active" : ""}
                          onClick={() => setPriority(true)}
                        >
                          <i>{priority && <Check />}</i>
                          <span>
                            <strong>临时考试优先</strong>
                            <small>发生冲突时，本设备仍显示临时考试。</small>
                          </span>
                        </button>
                      </fieldset>
                      {conflicts.length ? (
                        <div
                          className={`temp-exam-conflict${priority ? " is-priority" : ""}`}
                        >
                          <strong>检测到时间冲突</strong>
                          <span>
                            {conflicts.map((item) => item.name).join("、")}
                          </span>
                          <small>
                            {priority
                              ? "创建时将再次确认是否覆盖。"
                              : "正式考试开始后会自动接管。"}
                          </small>
                        </div>
                      ) : (
                        <div className="temp-exam-no-conflict">
                          <Check />
                          未发现正式考试冲突
                        </div>
                      )}
                    </section>
                  )}
                </div>
                <footer className="temp-exam-actions">
                  {step > 0 && (
                    <button onClick={() => setStep((value) => value - 1)}>
                      <ChevronLeft />
                      上一步
                    </button>
                  )}
                  <button
                    className="is-primary"
                    onClick={step < 2 ? next : create}
                  >
                    {step < 2 ? (
                      <>
                        下一步
                        <ChevronRight />
                      </>
                    ) : (
                      <>
                        <Plus />
                        {mode === "now"
                          ? "立即开始考试"
                          : mode === "delay"
                            ? `创建并在 ${delay} 分钟后开始`
                            : "创建定时考试"}
                      </>
                    )}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
      <TimeRangePickerModal
        open={timeRangeOpen}
        startValue={timeKey(startMs)}
        endValue={timeKey(endMs)}
        subject={finalSubject || "临时考试"}
        contextLabel={dateKey(startMs)}
        presets={DURATION_PRESETS}
        initialCrossDay={crossDayConfirmed}
        onPreviewChange={applyTimeRangeDraft}
        onCancel={cancelTimeRange}
        onConfirm={(startTime, endTime, endNextDay) => {
          applyTimeRangeDraft(startTime, endTime, endNextDay);
          setTimeRangeOpen(false);
        }}
      />
    </>
  );
}
