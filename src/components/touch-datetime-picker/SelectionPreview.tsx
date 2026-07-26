import { buildPreviewItems } from "./utils"
import type { DateTimeParts, Mode, PreviewConfig, WeekdayConfig } from "./types"

export interface SelectionPreviewProps {
  value: DateTimeParts
  mode: Mode
  weekday?: WeekdayConfig
  preview?: PreviewConfig
  className?: string
}

// 框下 / 面板内的实时选择展示。内容按场景自动增减并保持协调。
export function SelectionPreview({ value, mode, weekday, preview, className }: SelectionPreviewProps) {
  const items = buildPreviewItems(value, mode, { weekday, preview })
  if (!items.length) return null
  return (
    <div className={className ?? "tdp-preview"} aria-live="polite">
      {items.map((it, i) => (
        <span key={i} className={"tdp-preview-chip tone-" + (it.tone || "primary")}>
          {it.text}
        </span>
      ))}
    </div>
  )
}
