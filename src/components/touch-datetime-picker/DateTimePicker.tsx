import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import { createPortal } from "react-dom"
import { TapButton } from "./TapButton"
import { SelectionPreview } from "./SelectionPreview"
import { resolveDensity } from "./useDensity"
import { clampParts, daysInMonth, pad2, MON, SUN } from "./utils"
import type { DateTimeParts, Field, DateTimePickerProps } from "./types"
import "./DateTimePicker.css"

const NEXT: Partial<Record<Field, Field>> = { year: "month", month: "day" }
function segmentsFor(mode: string, weekdayEnabled: boolean): Field[] {
  if (mode === "date") return ["year", "month", "day"]
  if (mode === "time") return ((weekdayEnabled ? ["weekday"] : []) as Field[]).concat(["hour", "minute"])
  return ["year", "month", "day", "hour", "minute"]
}

interface TimeWheelProps {
  label: string
  values: number[]
  value: number
  onChange: (value: number) => void
}

const TimeWheel = forwardRef<HTMLDivElement, TimeWheelProps>(function TimeWheel(
  { label, values, value, onChange },
  ref,
) {
  return (
    <div className="tdp-time-wheel">
      <span className="tdp-time-wheel__label">选择{label}</span>
      <div
        className="tdp-time-wheel__list"
        ref={ref}
        aria-label={`选择${label}`}
        onWheel={(event) => {
          event.stopPropagation()
          if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault()
        }}
        onScroll={(event) => {
          // Some Chromium builds still expose a horizontal scrollbar when a
          // selected wheel item has visual overflow. Keep this control purely
          // vertical even for a two-finger trackpad gesture.
          if (event.currentTarget.scrollLeft !== 0) event.currentTarget.scrollLeft = 0
          const index = Math.max(0, Math.min(values.length - 1, Math.round(event.currentTarget.scrollTop / 48)))
          const next = values[index]
          if (next !== value) onChange(next)
        }}
      >
        {values.map((item) => (
          <button
            type="button"
            key={item}
            className={item === value ? "is-selected" : ""}
            onClick={() => onChange(item)}
          >
            {pad2(item)}
          </button>
        ))}
      </div>
    </div>
  )
})

export function DateTimePicker(props: DateTimePickerProps) {
  const {
    value,
    onConfirm,
    onCancel,
    onChange,
    mode = "datetime",
    hourRange = [0, 23],
    yearRange,
    presets,
    weekStartsOn = 1,
    title,
    validate,
    autoAdvance = true,
    theme = "auto",
    initialField,
    confirmLabel,
    cancelLabel,
    weekday,
    preview,
    anchorRect,
    compactPlacement = "below",
  } = props

  const density = resolveDensity(props.density)
  const weekdayEnabled = mode === "time" && !!(weekday && weekday.enabled)
  const segs = useMemo(() => segmentsFor(mode, weekdayEnabled), [mode, weekdayEnabled])

  const [draft, setDraft] = useState<DateTimeParts>(() => {
    const d = clampParts(value)
    if (weekdayEnabled && typeof d.weekday !== "number") d.weekday = weekday?.value ?? 0
    return d
  })
  const [field, setField] = useState<Field>(
    initialField && segs.indexOf(initialField) >= 0 ? initialField : mode === "date" ? "day" : segs[mode === "datetime" ? 2 : 0],
  )
  const [yearCenter, setYearCenter] = useState(draft.year)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const hourWheelRef = useRef<HTMLDivElement | null>(null)
  const minuteWheelRef = useRef<HTMLDivElement | null>(null)
  const hourValues = useMemo(
    () => Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => hour >= hourRange[0] && hour <= hourRange[1]),
    [hourRange[0], hourRange[1]],
  )
  const minuteValues = useMemo(() => Array.from({ length: 60 }, (_, minute) => minute), [])

  useEffect(() => {
    onChange?.(draft)
  }, [draft, onChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onCancel])

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    if (field !== "hour" && field !== "minute") return
    const hourIndex = Math.max(0, hourValues.indexOf(draft.hour))
    const minuteIndex = Math.max(0, minuteValues.indexOf(draft.minute))
    const frame = window.requestAnimationFrame(() => {
      if (hourWheelRef.current) hourWheelRef.current.scrollTop = hourIndex * 48
      if (minuteWheelRef.current) minuteWheelRef.current.scrollTop = minuteIndex * 48
    })
    return () => window.cancelAnimationFrame(frame)
    // Reposition only on entry. Updating scrollTop while a user drags the
    // wheel cancels touch inertia and makes the picker appear to freeze.
  }, [field, hourValues, minuteValues])

  function dismissAfterPointerAction(callback: () => void) {
    // Closing a portal during pointerup can retarget the browser's trailing
    // click to the control underneath it. Consume that one compatibility click.
    const blockTrailingClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      document.removeEventListener("click", blockTrailingClick, true)
    }
    document.addEventListener("click", blockTrailingClick, true)
    window.setTimeout(() => document.removeEventListener("click", blockTrailingClick, true), 300)
    callback()
  }

  // Keep compact popovers inside the viewport. A tall calendar can no longer
  // extend past the bottom of a modal or the browser window.
  useLayoutEffect(() => {
    if (density !== "compact" || !anchorRect || !panelRef.current) return

    const placePanel = () => {
      const panel = panelRef.current
      if (!panel) return

      const edge = 8
      panel.style.maxHeight = `${Math.max(240, window.innerHeight - edge * 2)}px`
      const { height: panelHeight, width: panelWidth } = panel.getBoundingClientRect()
      const right = anchorRect.left + anchorRect.width
      const rightSpace = window.innerWidth - right - edge
      const leftSpace = anchorRect.left - edge
      const preferredLeft = compactPlacement === "right"
        ? rightSpace >= panelWidth || rightSpace >= leftSpace
          ? right + edge
          : anchorRect.left - panelWidth - edge
        : anchorRect.left
      const preferredTop = compactPlacement === "right"
        ? anchorRect.top + anchorRect.height / 2 - panelHeight / 2
        : anchorRect.top + anchorRect.height + edge
      const maxTop = Math.max(edge, window.innerHeight - panelHeight - edge)
      const maxLeft = Math.max(edge, window.innerWidth - panelWidth - edge)
      panel.style.left = `${Math.max(edge, Math.min(preferredLeft, maxLeft))}px`
      panel.style.top = `${Math.max(edge, Math.min(preferredTop, maxTop))}px`
    }

    placePanel()
    const frame = window.requestAnimationFrame(placePanel)
    window.addEventListener("resize", placePanel)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", placePanel)
    }
  }, [anchorRect, compactPlacement, density, draft.month, draft.year, error, field])

  function apply(next: DateTimeParts, adv?: Field) {
    const w = next.weekday
    const c = clampParts(next)
    if (typeof w === "number") c.weekday = w
    setError(null)
    if (autoAdvance && adv && NEXT[adv] && segs.indexOf(NEXT[adv] as Field) >= 0) setField(NEXT[adv] as Field)
    setDraft(c)
  }
  const patch = (p: Partial<DateTimeParts>, adv?: Field) => apply({ ...draft, ...p }, adv)

  function shiftMonth(delta: number) {
    const m0 = draft.month - 1 + delta
    const y = draft.year + Math.floor(m0 / 12)
    const m = ((m0 % 12) + 12) % 12 + 1
    if (yearRange && (y < yearRange[0] || y > yearRange[1])) return
    setYearCenter(y)
    patch({ year: y, month: m })
  }

  const readoutDefs: { k: Field; t: string; u?: string; colon?: boolean }[] = []
  if (weekdayEnabled)
    readoutDefs.push({ k: "weekday", t: "周" + MON[typeof draft.weekday === "number" ? draft.weekday : 0] })
  if (mode !== "time") {
    readoutDefs.push({ k: "year", t: String(draft.year), u: "年" })
    readoutDefs.push({ k: "month", t: pad2(draft.month), u: "月" })
    readoutDefs.push({ k: "day", t: pad2(draft.day), u: "日" })
  }
  if (mode !== "date") {
    readoutDefs.push({ k: "hour", t: pad2(draft.hour), colon: true })
    readoutDefs.push({ k: "minute", t: pad2(draft.minute) })
  }

  const isTimeSelection = field === "hour" || field === "minute"
  const nextField = (() => {
    if (isTimeSelection) return undefined
    const index = segs.indexOf(field)
    return index >= 0 ? segs[index + 1] : undefined
  })()

  function advanceField() {
    if (!nextField) return false
    setField(nextField)
    setError(null)
    return true
  }

  function renderBody(): ReactNode {
    if (field === "weekday") {
      const labels = weekStartsOn === 1 ? MON : SUN
      return (
        <div className="tdp-grid cols-7">
          {labels.map((lbl, idx) => {
            const canonical = weekStartsOn === 1 ? idx : (idx + 6) % 7
            return (
              <TapButton key={idx} selected={draft.weekday === canonical} onTap={() => patch({ weekday: canonical })}>
                {"周" + lbl}
              </TapButton>
            )
          })}
        </div>
      )
    }
    if (field === "year") {
      const years: number[] = []
      for (let y = yearCenter - 2; y <= yearCenter + 2; y++) {
        if (yearRange && (y < yearRange[0] || y > yearRange[1])) continue
        years.push(y)
      }
      return (
        <div className="tdp-nav-row">
          <TapButton className="tdp-nav" ariaLabel="前5年" onTap={() => setYearCenter(yearCenter - 5)}>
            {"‹"}
          </TapButton>
          <div className="tdp-grid cols-5">
            {years.map((y) => (
              <TapButton
                key={y}
                selected={y === draft.year}
                onTap={() => {
                  setYearCenter(y)
                  patch({ year: y }, "year")
                }}
              >
                {y}
              </TapButton>
            ))}
          </div>
          <TapButton className="tdp-nav" ariaLabel="后5年" onTap={() => setYearCenter(yearCenter + 5)}>
            {"›"}
          </TapButton>
        </div>
      )
    }
    if (field === "month") {
      return (
        <div className="tdp-grid cols-4">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <TapButton key={m} selected={m === draft.month} onTap={() => patch({ month: m }, "month")}>
              {m + " 月"}
            </TapButton>
          ))}
        </div>
      )
    }
    if (field === "day") {
      const total = daysInMonth(draft.year, draft.month)
      const js = new Date(draft.year, draft.month - 1, 1).getDay()
      const lead = weekStartsOn === 1 ? (js + 6) % 7 : js
      const cells: ReactNode[] = []
      for (let i = 0; i < lead; i++) cells.push(<span key={"b" + i} className="tdp-blank" />)
      for (let d = 1; d <= total; d++) {
        const w = new Date(draft.year, draft.month - 1, d).getDay()
        cells.push(
          <TapButton
            key={d}
            selected={d === draft.day}
            className={w === 0 || w === 6 ? "is-weekend" : undefined}
            onTap={() => patch({ day: d })}
          >
            {d}
          </TapButton>,
        )
      }
      return (
        <>
          <div className="tdp-month-bar">
            <TapButton className="tdp-nav" ariaLabel="上个月" onTap={() => shiftMonth(-1)}>
              {"‹"}
            </TapButton>
            <span className="tdp-month-label">{draft.year + " 年 " + draft.month + " 月"}</span>
            <TapButton className="tdp-nav" ariaLabel="下个月" onTap={() => shiftMonth(1)}>
              {"›"}
            </TapButton>
          </div>
          <div className="tdp-dow">
            {(weekStartsOn === 1 ? MON : SUN).map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="tdp-grid cols-7">{cells}</div>
        </>
      )
    }
    if (isTimeSelection) {
      return (
        <div className="tdp-time-wheels" aria-label="选择小时和分钟">
          <TimeWheel
            ref={hourWheelRef}
            label="时"
            values={hourValues}
            value={draft.hour}
            onChange={(hour) => {
              setField("hour")
              patch({ hour })
            }}
          />
          <span className="tdp-time-wheels__colon" aria-hidden="true">:</span>
          <TimeWheel
            ref={minuteWheelRef}
            label="分"
            values={minuteValues}
            value={draft.minute}
            onChange={(minute) => {
              setField("minute")
              patch({ minute })
            }}
          />
        </div>
      )
    }
    return null
  }

  const vw = typeof window !== "undefined" ? window.innerWidth : 360
  const pw = Math.min(320, vw - 16)
  const panelStyle: CSSProperties | undefined =
    density === "compact" && anchorRect
      ? {
          position: "absolute",
          width: pw,
          left: compactPlacement === "right"
            ? anchorRect.left + anchorRect.width + 8
            : Math.min(Math.max(8, anchorRect.left), vw - pw - 8),
          top: compactPlacement === "right"
            ? anchorRect.top + anchorRect.height / 2
            : anchorRect.top + anchorRect.height + 8,
        }
      : undefined

  const showPreview = preview !== false && (!preview || preview.show !== false)

  const node = (
    <div
      className="tdp-root"
      data-theme={theme}
      data-density={density}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) dismissAfterPointerAction(onCancel)
      }}
    >
      <div
        className="tdp-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || "选择日期和时间"}
        tabIndex={-1}
        style={panelStyle}
      >
        {title && <div className="tdp-title">{title}</div>}
        <div className="tdp-readout" aria-live="polite">
          {readoutDefs.map((s) => (
            <span key={s.k} className="tdp-seg-wrap">
              <TapButton
                className={"tdp-seg" + (field === s.k ? " is-active" : "")}
                ariaLabel={s.k + " " + s.t}
                onTap={() => {
                  if (field === s.k && advanceField()) return
                  setField(s.k)
                  setError(null)
                }}
              >
                {s.t}
              </TapButton>
              {s.u && <em className="tdp-unit">{s.u}</em>}
              {s.colon && <em className="tdp-unit tdp-colon">:</em>}
            </span>
          ))}
        </div>
        {showPreview && (
          <SelectionPreview value={draft} mode={mode} weekday={weekday} preview={preview || undefined} />
        )}
        {error && (
          <div className="tdp-error" role="alert">
            {"⚠ " + error}
          </div>
        )}
        <div className="tdp-body">{renderBody()}</div>
        <div className="tdp-footer">
          <TapButton className="tdp-cancel" onTap={() => dismissAfterPointerAction(onCancel)}>
            {cancelLabel || "取消"}
          </TapButton>
          <TapButton
            className="tdp-ok"
            onTap={() => {
              if (advanceField()) return
              const msg = validate ? validate(draft) : null
              if (msg) {
                setError(msg)
                return
              }
              dismissAfterPointerAction(() => onConfirm(draft))
            }}
          >
            {nextField ? "下一步" : confirmLabel || "确定"}
          </TapButton>
        </div>
      </div>
    </div>
  )

  return typeof document !== "undefined" ? createPortal(node, document.body) : node
}
