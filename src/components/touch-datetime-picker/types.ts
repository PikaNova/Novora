// 核心数据模型：用「部件」而非 Date，避开时区与夏令时的隐式偏移。
// 只有在最终提交时才由 utils 里的 partsToNaive / partsToOffsetISO 序列化。
export interface DateTimeParts {
  year: number
  month: number // 1-12
  day: number
  hour: number // 0-23
  minute: number // 0-59
  weekday?: number // 仅 time 模式使用，0=周一 ... 6=周日
}

export type Field = "year" | "month" | "day" | "hour" | "minute" | "weekday"

// 选择内容：日期时间 / 仅日期 / 仅时间
export type Mode = "datetime" | "date" | "time"

// 呈现密度：auto 自动探测；compact 桌面浮层；sheet 手机抽屉；panel 一体机大面板
export type Density = "auto" | "compact" | "sheet" | "panel"

// compact desktop popover placement. Mobile sheet mode is unaffected.
export type CompactPlacement = "below" | "right"

export type PreviewTone = "primary" | "dim" | "warn"

export interface PreviewItem {
  tone?: PreviewTone
  text: string
}

export interface Preset {
  label: string
  resolve: (now: Date, current: DateTimeParts) => DateTimeParts
}

export interface WeekdayConfig {
  enabled: boolean
  value?: number // 0=周一 ... 6=周日
}

// 实时预览配置：可按场景增减信息，组件会自动过滤空值并保持布局协调。
export interface PreviewConfig {
  show?: boolean
  relative?: boolean // 显示「距今 X 天 / 几小时后」
  durationMin?: number // time 模式：显示结束时间 + 时长
  holiday?: (v: DateTimeParts) => string | null // date 模式：节假日 / 排除日提醒
  render?: (v: DateTimeParts) => PreviewItem[] | null // 完全自定义
}

export interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

export interface DateTimePickerProps {
  value: DateTimeParts
  onConfirm: (v: DateTimeParts) => void
  onCancel: () => void
  onChange?: (v: DateTimeParts) => void // 草稿实时变化（用于框下预览）
  mode?: Mode
  density?: Density
  hourRange?: [number, number]
  yearRange?: [number, number]
  presets?: Preset[] | false
  weekStartsOn?: 0 | 1
  title?: string
  validate?: (v: DateTimeParts) => string | null
  autoAdvance?: boolean
  theme?: "auto" | "light" | "dark"
  initialField?: Field
  confirmLabel?: string
  cancelLabel?: string
  weekday?: WeekdayConfig
  preview?: PreviewConfig | false
  anchorRect?: AnchorRect // compact 浮层定位锚点
  compactPlacement?: CompactPlacement
}
