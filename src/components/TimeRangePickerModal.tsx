import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import { DateTimeField } from "./touch-datetime-picker";
import "../styles/time-range-picker.css";

type RangeMode = "time" | "datetime";

interface Props {
  open: boolean;
  mode?: RangeMode;
  title?: string;
  description?: string;
  startValue: string;
  endValue: string;
  subject?: string;
  contextLabel?: string;
  presets?: number[];
  allowCrossDay?: boolean;
  initialCrossDay?: boolean;
  onCancel: () => void;
  onConfirm: (startValue: string, endValue: string, endNextDay: boolean) => void;
}

const ITEM_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, value) => value);
const MINUTES = Array.from({ length: 60 }, (_, value) => value);

const pad = (value: number) => String(value).padStart(2, "0");

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function splitValue(value: string, mode: RangeMode, fallbackDate = today()) {
  if (mode === "time") {
    const [hour = "8", minute = "0"] = (value || "08:00").split(":");
    return { date: fallbackDate, hour: Number(hour) || 0, minute: Number(minute) || 0 };
  }
  const [date = fallbackDate, clock = "08:00"] = (value || `${fallbackDate}T08:00`).replace(" ", "T").split("T");
  const [hour = "8", minute = "0"] = clock.split(":");
  return { date, hour: Number(hour) || 0, minute: Number(minute) || 0 };
}

function serialize(parts: ReturnType<typeof splitValue>, mode: RangeMode) {
  const clock = `${pad(parts.hour)}:${pad(parts.minute)}`;
  return mode === "time" ? clock : `${parts.date}T${clock}`;
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} 小时${rest ? ` ${rest} 分钟` : ""}`;
}

function addMinutes(value: string, minutes: number, mode: RangeMode) {
  const parts = splitValue(value, mode);
  if (mode === "datetime") {
    const date = new Date(`${parts.date}T${pad(parts.hour)}:${pad(parts.minute)}:00`);
    date.setMinutes(date.getMinutes() + minutes);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  const total = (parts.hour * 60 + parts.minute + minutes) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function rawRangeDuration(startValue: string, endValue: string, mode: RangeMode) {
  if (mode === "datetime") {
    const duration = Math.round((new Date(endValue).getTime() - new Date(startValue).getTime()) / 60_000);
    return Number.isFinite(duration) ? duration : 0;
  }
  const start = splitValue(startValue, mode);
  const end = splitValue(endValue, mode);
  const startMinutes = start.hour * 60 + start.minute;
  return end.hour * 60 + end.minute - startMinutes;
}

function nextDateLabel(value?: string) {
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const weekdayIndex = value ? weekdays.indexOf(value) : -1;
  if (weekdayIndex >= 0) return weekdays[(weekdayIndex + 1) % weekdays.length];
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "次日";
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function TimeRangePickerModal({
  open,
  mode = "time",
  title = "设置考试时间",
  description = "开始和结束时间在此一次完成",
  startValue,
  endValue,
  subject = "考试",
  contextLabel,
  presets = [45, 60, 75, 90, 120, 150],
  allowCrossDay = true,
  initialCrossDay = false,
  onCancel,
  onConfirm,
}: Props) {
  const [target, setTarget] = useState<"start" | "end">("start");
  const [draftStart, setDraftStart] = useState(startValue);
  const [draftEnd, setDraftEnd] = useState(endValue);
  const [crossDayEnabled, setCrossDayEnabled] = useState(initialCrossDay);
  const hourRef = useRef<HTMLDivElement | null>(null);
  const minuteRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !modalRef.current || window.innerWidth <= 620) return;
    const modal = modalRef.current;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const anchorElement = activeElement && activeElement !== document.body ? activeElement : null;

    const placeModal = () => {
      const edge = 10;
      const gap = 8;
      const anchor = anchorElement?.getBoundingClientRect();
      const { width, height } = modal.getBoundingClientRect();
      let left = (window.innerWidth - width) / 2;
      let top = (window.innerHeight - height) / 2;

      if (anchor) {
        const belowSpace = window.innerHeight - anchor.bottom - edge;
        const aboveSpace = anchor.top - edge;
        left = anchor.left + width <= window.innerWidth - edge ? anchor.left : anchor.right - width;
        top = belowSpace >= height || belowSpace >= aboveSpace
          ? anchor.bottom + gap
          : anchor.top - height - gap;
      }

      modal.style.transform = "none";
      modal.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`;
      modal.style.top = `${Math.max(edge, Math.min(top, window.innerHeight - height - edge))}px`;
    };

    placeModal();
    const frame = window.requestAnimationFrame(placeModal);
    window.addEventListener("resize", placeModal);
    window.addEventListener("scroll", placeModal, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", placeModal);
      window.removeEventListener("scroll", placeModal, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const start = startValue || (mode === "time" ? "08:00" : `${today()}T08:00`);
    setDraftStart(start);
    setDraftEnd(endValue || addMinutes(start, 60, mode));
    setCrossDayEnabled(initialCrossDay);
    setTarget("start");
  }, [endValue, initialCrossDay, mode, open, startValue]);

  const activeParts = splitValue(target === "start" ? draftStart : draftEnd, mode, splitValue(draftStart, mode).date);
  const rawDuration = useMemo(() => rawRangeDuration(draftStart, draftEnd, mode), [draftEnd, draftStart, mode]);
  const startDate = splitValue(draftStart, mode).date;
  const endDate = splitValue(draftEnd, mode, startDate).date;
  const datesDiffer = mode === "datetime" && startDate !== endDate;
  const duration = mode === "time" && crossDayEnabled ? rawDuration + 1440 : rawDuration;
  const validRange = duration > 0 && (mode === "time"
    ? crossDayEnabled || rawDuration > 0
    : crossDayEnabled ? endDate > startDate : !datesDiffer);
  const rangeError = validRange
    ? ""
    : mode === "datetime" && datesDiffer && !crossDayEnabled
      ? "开始和结束日期不同，请先勾选“启用跨日考试”。"
      : crossDayEnabled && mode === "datetime" && !datesDiffer
        ? "已启用跨日考试，请将结束日期设置为开始日期之后。"
        : rawDuration <= 0
          ? "结束时间必须晚于开始时间；如需跨日，请先启用跨日考试。"
          : "请重新确认开始日期、结束日期和时间。";

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (hourRef.current) hourRef.current.scrollTop = activeParts.hour * ITEM_HEIGHT;
      if (minuteRef.current) minuteRef.current.scrollTop = activeParts.minute * ITEM_HEIGHT;
    });
  }, [open, target]);

  if (!open) return null;

  const updatePart = (part: "hour" | "minute", value: number) => {
    const currentValue = target === "start" ? draftStart : draftEnd;
    const parts = splitValue(currentValue, mode, splitValue(draftStart, mode).date);
    const next = serialize({ ...parts, [part]: value }, mode);
    if (target === "start") setDraftStart(next);
    else setDraftEnd(next);
  };

  const updateDate = (date: string) => {
    const currentValue = target === "start" ? draftStart : draftEnd;
    const parts = splitValue(currentValue, mode);
    const next = serialize({ ...parts, date }, mode);
    if (target === "start") setDraftStart(next);
    else setDraftEnd(next);
  };

  const display = (value: string) => {
    const parts = splitValue(value, mode);
    return mode === "time" ? `${pad(parts.hour)}:${pad(parts.minute)}` : `${parts.date} ${pad(parts.hour)}:${pad(parts.minute)}`;
  };

  return (
    <div className="time-range-overlay" role="presentation" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <section ref={modalRef} className="time-range-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="time-range-head">
          <div><h2>{title}</h2><p>{description}</p></div>
          <button type="button" onClick={onCancel}>取消</button>
        </header>

        <div className="time-range-switch">
          {(["start", "end"] as const).map((value) => (
            <button type="button" key={value} className={target === value ? "is-selected" : ""} onClick={() => setTarget(value)}>
              <span>{value === "start" ? "开始时间" : "结束时间"}</span>
              <strong>{display(value === "start" ? draftStart : draftEnd)}</strong>
            </button>
          ))}
        </div>

        {mode === "datetime" && (
          <label className="time-range-date">
            <span>{target === "start" ? "开始日期" : "结束日期"}</span>
            <DateTimeField value={activeParts.date} onChange={updateDate} mode="date" title={`选择${target === "start" ? "开始" : "结束"}日期`} showFieldPreview={false} />
          </label>
        )}

        <section className="time-range-presets" aria-label="常用考试时长">
          <span>常用时长</span>
          <div>{presets.map((minutes) => <button type="button" key={minutes} className={validRange && duration === minutes ? "is-selected" : ""} onClick={() => { setDraftEnd(addMinutes(draftStart, minutes, mode)); setCrossDayEnabled(false); setTarget("end"); }}>{formatDuration(minutes)}</button>)}</div>
        </section>

        {allowCrossDay && (
          <section className={`time-range-cross-day${crossDayEnabled ? " is-enabled" : ""}`}>
            <label>
              <input type="checkbox" checked={crossDayEnabled} onChange={(event) => setCrossDayEnabled(event.target.checked)} />
              <span><strong>启用跨日考试</strong><small>仅当考试确实在次日结束时启用</small></span>
            </label>
            {crossDayEnabled && (
              <div className="time-range-cross-day__dates">
                <span><small>开始日期</small><strong>{mode === "datetime" ? startDate : contextLabel || "当天"}</strong></span>
                <span><small>结束日期</small><strong>{mode === "datetime" ? endDate : nextDateLabel(contextLabel)}</strong></span>
              </div>
            )}
          </section>
        )}

        <section className="time-range-wheel-panel">
          <div><strong>调整{target === "start" ? "开始" : "结束"}时间</strong><span>上下滚动小时和分钟</span></div>
          <div className="time-range-wheels">
            <div className="time-range-wheel"><span>时</span><div ref={hourRef} onWheel={(event) => { event.stopPropagation(); if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault(); }} onScroll={(event) => { if (event.currentTarget.scrollLeft) event.currentTarget.scrollLeft = 0; updatePart("hour", Math.max(0, Math.min(23, Math.round(event.currentTarget.scrollTop / ITEM_HEIGHT)))); }}>{HOURS.map((hour) => <button type="button" key={hour} className={activeParts.hour === hour ? "is-selected" : ""} onClick={() => updatePart("hour", hour)}>{pad(hour)}</button>)}</div></div>
            <b>:</b>
            <div className="time-range-wheel"><span>分</span><div ref={minuteRef} onWheel={(event) => { event.stopPropagation(); if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault(); }} onScroll={(event) => { if (event.currentTarget.scrollLeft) event.currentTarget.scrollLeft = 0; updatePart("minute", Math.max(0, Math.min(59, Math.round(event.currentTarget.scrollTop / ITEM_HEIGHT)))); }}>{MINUTES.map((minute) => <button type="button" key={minute} className={activeParts.minute === minute ? "is-selected" : ""} onClick={() => updatePart("minute", minute)}>{pad(minute)}</button>)}</div></div>
          </div>
        </section>

        {!validRange && <div className="time-range-error" role="alert">{rangeError}</div>}
        <section className={`time-range-summary${!validRange ? " is-error" : ""}`}>
          <Clock3 aria-hidden="true" />
          <div><span>考试预览</span><strong>{subject}</strong><p>{contextLabel ? `${contextLabel} · ` : ""}{display(draftStart)} - {display(draftEnd)} · {validRange ? `${formatDuration(duration)}${crossDayEnabled ? " · 跨日" : ""}` : "时间范围无效"}</p></div>
        </section>

        <footer><button type="button" onClick={onCancel}>取消</button><button type="button" className="is-primary" aria-disabled={!validRange} onClick={() => { if (validRange) onConfirm(draftStart, draftEnd, crossDayEnabled); }}>确认时间</button></footer>
      </section>
    </div>
  );
}
