import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import { createPortal } from "react-dom"
import { TapButton } from "./TapButton"
import { SelectionPreview } from "./SelectionPreview"
import { resolveDensity } from "./useDensity"
import { clampParts, daysInMonth, pad2, defaultPresets, MON, SUN } from "./utils"
import type { DateTimeParts, Field, DateTimePickerProps } from "./types"
import "./DateTimePicker.css"

const NEXT: Partial<Record<Field, Field>> = { year: "month", month: "day" }

function segmentsFor(mode: string, weekdayEnabled: boolean): Field[] {
  if (mode === "date") return ["year", "month", "day"]
  if (mode === "time") return ((weekdayEnabled ? ["weekday"] : []) as Field[]).concat(["hour", "minute"])
  return ["year", "month", "day", "hour", "minute"]
}

export function DateTimePicker(props: DateTimePickerProps) {
  const {
    value,
    onConfirm,
    onCancel,
    onChange,
    mode = "datetime",
    hourRange = [0, 23],
    minuteStep = 5,
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
    initialField && segs.indexOf(initialField) >= 0 ? initialField : segs[mode === "datetime" ? 2 : 0],
  )
  const [yearCenter, setYearCenter] = useState(draft.year)
  const [fine, setFine] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

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

  // Keep compact popovers inside the viewport. A tall calendar can no longer
  // extend past the bottom of a modal or the browser window.
  useLayoutEffect(() => {
    if (density !== "compact" || !anchorRect || !panelRef.current) return

    const placePanel = () => {
      const panel = panelRef.current
      if (!panel) return

      const edge = 8
      panel.style.maxHeight = `${Math.max(240, window.innerHeight - edge * 2)}px`
      const panelHeight = panel.getBoundingClientRect().height
      const preferredTop = anchorRect.top + anchorRect.height + edge
      const maxTop = Math.max(edge, window.innerHeight - panelHeight - edge)
      panel.style.top = `${Math.max(edge, Math.min(preferredTop, maxTop))}px`
    }

    placePanel()
    const frame = window.requestAnimationFrame(placePanel)
    window.addEventListener("resize", placePanel)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", placePanel)
    }
  }, [anchorRect, density, draft.month, draft.year, error, field, fine])

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

  const activePresets = presets === false || mode === "time" ? [] : presets || defaultPresets

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
    if (field === "hour") {
      const hours: number[] = []
      for (let h = Math.max(0, hourRange[0]); h <= Math.min(23, hourRange[1]); h++) hours.push(h)
      return (
        <div className="tdp-grid cols-6">
          {hours.map((h) => (
            <TapButton key={h} selected={h === draft.hour} onTap={() => patch({ hour: h })}>
              {pad2(h)}
            </TapButton>
          ))}
        </div>
      )
    }
    // minute
    const list: number[] = []
    if (fine) {
      const base = Math.floor(draft.minute / minuteStep) * minuteStep
      for (let f = base; f < Math.min(base + minuteStep, 60); f++) list.push(f)
    } else {
      for (let m = 0; m < 60; m += minuteStep) list.push(m)
    }
    if (list.indexOf(draft.minute) === -1) {
      list.push(draft.minute)
      list.sort((a, b) => a - b)
    }
    return (
      <>
        <div className="tdp-grid cols-6">
          {list.map((v) => (
            <TapButton key={v} selected={v === draft.minute} onTap={() => patch({ minute: v })}>
              {pad2(v)}
            </TapButton>
          ))}
        </div>
        {minuteStep > 1 && (
          <TapButton className="tdp-fine" onTap={() => setFine(!fine)}>
            {fine ? "← 回到 " + minuteStep + " 分钟粒度" : "精确到 1 分钟"}
          </TapButton>
        )}
      </>
    )
  }

  const vw = typeof window !== "undefined" ? window.innerWidth : 360
  const pw = Math.min(320, vw - 16)
  const panelStyle: CSSProperties | undefined =
    density === "compact" && anchorRect
      ? {
          position: "absolute",
          width: pw,
          left: Math.min(Math.max(8, anchorRect.left), vw - pw - 8),
          top: anchorRect.top + anchorRect.height + 8,
        }
      : undefined

  const showPreview = preview !== false && (!preview || preview.show !== false)

  const node = (
    <div
      className="tdp-root"
      data-theme={theme}
      data-density={density}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
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
                  setField(s.k)
                  setFine(false)
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
        {activePresets.length > 0 && (
          <div className="tdp-presets">
            {activePresets.map((p, i) => (
              <TapButton
                key={i}
                className="tdp-preset"
                onTap={() => {
                  const w = draft.weekday
                  const nv = clampParts(p.resolve(new Date(), draft))
                  if (typeof w === "number") nv.weekday = w
                  setYearCenter(nv.year)
                  setError(null)
                  setDraft(nv)
                }}
              >
                {p.label}
              </TapButton>
            ))}
          </div>
        )}
        <div className="tdp-body">{renderBody()}</div>
        <div className="tdp-footer">
          <TapButton className="tdp-cancel" onTap={onCancel}>
            {cancelLabel || "取消"}
          </TapButton>
          <TapButton
            className="tdp-ok"
            onTap={() => {
              const msg = validate ? validate(draft) : null
              if (msg) {
                setError(msg)
                return
              }
              onConfirm(draft)
            }}
          >
            {confirmLabel || "确定"}
          </TapButton>
        </div>
      </div>
    </div>
  )

  return typeof document !== "undefined" ? createPortal(node, document.body) : node
}
