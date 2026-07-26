import { useEffect, useRef, useState } from "react"
import { DateTimePicker } from "./DateTimePicker"
import { SelectionPreview } from "./SelectionPreview"
import { parseNaive, partsToNaive, partsToNaiveDate, formatDateCN, weekdayCN, pad2 } from "./utils"
import type { AnchorRect, CompactPlacement, DateTimeParts, Density, Field, Mode, PreviewConfig, WeekdayConfig } from "./types"
import "./DateTimeField.css"

export interface DateTimeFieldProps {
  // 与 <input type="datetime-local"> 相同的字符串契约："YYYY-MM-DDTHH:mm"
  value: string
  onChange: (v: string) => void
  mode?: Mode
  density?: Density
  placeholder?: string
  disabled?: boolean
  id?: string
  name?: string // 提供时渲染隐藏 input，兼容原生表单提交
  className?: string
  title?: string
  hourRange?: [number, number]
  minuteStep?: number
  yearRange?: [number, number]
  weekStartsOn?: 0 | 1
  weekday?: WeekdayConfig
  preview?: PreviewConfig | false
  theme?: "auto" | "light" | "dark"
  validate?: (v: DateTimeParts) => string | null
  showFieldPreview?: boolean // 框下实时预览，默认开
  compactPlacement?: CompactPlacement
  initialField?: Field
  openSignal?: number
}

function nowParts(): DateTimeParts {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }
}

function parseFieldValue(value: string, mode: Mode): DateTimeParts | null {
  if (!value) return null
  if (mode === "date") return parseNaive(`${value}T00:00`)
  if (mode === "time") {
    const today = nowParts()
    return parseNaive(`${today.year}-${pad2(today.month)}-${pad2(today.day)}T${value}`)
  }
  return parseNaive(value)
}

function serializeFieldValue(value: DateTimeParts, mode: Mode): string {
  if (mode === "date") return partsToNaiveDate(value)
  if (mode === "time") return `${pad2(value.hour)}:${pad2(value.minute)}`
  return partsToNaive(value)
}

function fieldText(v: DateTimeParts, mode: Mode): string {
  if (mode === "date") return formatDateCN(v) + " " + weekdayCN(v)
  if (mode === "time") return pad2(v.hour) + ":" + pad2(v.minute)
  return formatDateCN(v) + " " + pad2(v.hour) + ":" + pad2(v.minute)
}

export function DateTimeField(props: DateTimeFieldProps) {
  const {
    value,
    onChange,
    mode = "datetime",
    placeholder = "请选择",
    disabled,
    id,
    name,
    className,
    preview,
    showFieldPreview = true,
    openSignal,
  } = props

  const parsed = parseFieldValue(value, mode)
  const [open, setOpen] = useState(false)
  const [draftPreview, setDraftPreview] = useState<DateTimeParts | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const [rect, setRect] = useState<AnchorRect | undefined>(undefined)
  const lastOpenSignal = useRef<number | undefined>(undefined)

  const display = parsed ? fieldText(parsed, mode) : ""
  const previewValue = draftPreview ?? parsed

  function openPicker() {
    if (disabled) return
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    setDraftPreview(parsed ?? nowParts())
    setOpen(true)
  }

  useEffect(() => {
    if (!openSignal || lastOpenSignal.current === openSignal || disabled) return
    lastOpenSignal.current = openSignal
    openPicker()
  }, [disabled, openSignal, parsed])

  return (
    <div className={className}>
      <button
        type="button"
        ref={btnRef}
        id={id}
        disabled={disabled}
        className={"tdp-field" + (parsed ? "" : " is-empty")}
        onClick={openPicker}
      >
        <span className="tdp-field-text">{display || placeholder}</span>
        <span className="tdp-field-icon" aria-hidden="true">
          {mode === "time" ? "🕐" : mode === "date" ? "📆" : "📅"}
        </span>
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      {showFieldPreview && previewValue && preview !== false && (
        <SelectionPreview
          className="field-preview"
          value={previewValue}
          mode={mode}
          weekday={props.weekday}
          preview={preview || undefined}
        />
      )}
      {open && (
        <DateTimePicker
          value={parsed ?? nowParts()}
          mode={mode}
          density={props.density}
          theme={props.theme}
          title={props.title}
          hourRange={props.hourRange}
          minuteStep={props.minuteStep}
          yearRange={props.yearRange}
          weekStartsOn={props.weekStartsOn}
          weekday={props.weekday}
          preview={preview}
          validate={props.validate}
          anchorRect={rect}
          compactPlacement={props.compactPlacement}
          initialField={props.initialField}
          onChange={(v) => setDraftPreview(v)}
          onConfirm={(v) => {
            setOpen(false)
            setDraftPreview(v)
            onChange(serializeFieldValue(v, mode))
          }}
          onCancel={() => {
            setOpen(false)
            setDraftPreview(parsed)
          }}
        />
      )}
    </div>
  )
}
