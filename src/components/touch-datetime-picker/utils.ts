import type { DateTimeParts, Mode, Preset, PreviewConfig, PreviewItem, WeekdayConfig } from "./types"

export const MON = ["一", "二", "三", "四", "五", "六", "日"]
export const SUN = ["日", "一", "二", "三", "四", "五", "六"]

export function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// 规则 11：日期越界自动收敛（如 3/31 -> 2 月自动变 2/28）。
export function clampParts(v: DateTimeParts): DateTimeParts {
  const year = Math.trunc(v.year)
  const month = Math.min(12, Math.max(1, Math.trunc(v.month)))
  const day = Math.min(daysInMonth(year, month), Math.max(1, Math.trunc(v.day)))
  const o: DateTimeParts = {
    year,
    month,
    day,
    hour: Math.min(23, Math.max(0, Math.trunc(v.hour))),
    minute: Math.min(59, Math.max(0, Math.trunc(v.minute))),
  }
  if (typeof v.weekday === "number") o.weekday = ((Math.trunc(v.weekday) % 7) + 7) % 7
  return o
}

export function dateToParts(d: Date): DateTimeParts {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  }
}

export function partsToDate(v: DateTimeParts): Date {
  return new Date(v.year, v.month - 1, v.day, v.hour, v.minute)
}

// 与 <input type="datetime-local"> 完全相同的字符串契约："YYYY-MM-DDTHH:mm"。
export function partsToNaive(v: DateTimeParts): string {
  return `${v.year}-${pad2(v.month)}-${pad2(v.day)}T${pad2(v.hour)}:${pad2(v.minute)}`
}

export function parseNaive(s: string): DateTimeParts | null {
  if (!s || s.length < 16) return null
  const year = Number(s.slice(0, 4))
  const month = Number(s.slice(5, 7))
  const day = Number(s.slice(8, 10))
  const hour = Number(s.slice(11, 13))
  const minute = Number(s.slice(14, 16))
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null
  return clampParts({ year, month, day, hour, minute })
}

// 时区必读：入库请用带偏移的形式，不要 toISOString()（它会转成 UTC 造成 ±8 小时漂移）。
export function partsToOffsetISO(v: DateTimeParts, offset: string): string {
  return `${v.year}-${pad2(v.month)}-${pad2(v.day)}T${pad2(v.hour)}:${pad2(v.minute)}:00${offset}`
}

export function partsToNaiveDate(v: DateTimeParts): string {
  return `${v.year}-${pad2(v.month)}-${pad2(v.day)}`
}

export function weekdayCN(v: DateTimeParts): string {
  const w = new Date(v.year, v.month - 1, v.day).getDay()
  return "周" + MON[(w + 6) % 7]
}

export function formatDateCN(v: DateTimeParts): string {
  return `${v.year} 年 ${v.month} 月 ${v.day} 日`
}

export function formatParts(v: DateTimeParts): string {
  return `${v.year} 年 ${pad2(v.month)} 月 ${pad2(v.day)} 日 ${pad2(v.hour)}:${pad2(v.minute)}`
}

export function addDays(base: Date, n: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}

export function addMinutes(v: DateTimeParts, mins: number): DateTimeParts {
  const d = partsToDate(v)
  d.setMinutes(d.getMinutes() + mins)
  return dateToParts(d)
}

export function comparePartsAsc(a: DateTimeParts, b: DateTimeParts): number {
  return Number(partsToDate(a)) - Number(partsToDate(b))
}

export function rangesOverlap(
  aStart: DateTimeParts,
  aEnd: DateTimeParts,
  bStart: DateTimeParts,
  bEnd: DateTimeParts,
): boolean {
  return Number(partsToDate(aStart)) < Number(partsToDate(bEnd)) && Number(partsToDate(bStart)) < Number(partsToDate(aEnd))
}

export function snapMinute(minute: number, step: number): number {
  return (Math.round(minute / step) * step) % 60
}

export function relativeCN(v: DateTimeParts): string | null {
  const now = new Date()
  const t = partsToDate(v)
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const d1 = new Date(v.year, v.month - 1, v.day)
  const days = Math.round((Number(d1) - Number(d0)) / 86400000)
  if (days === 0) {
    const mins = Math.round((Number(t) - Number(now)) / 60000)
    if (Math.abs(mins) < 60) {
      if (mins === 0) return "就现在"
      return mins > 0 ? mins + " 分钟后" : -mins + " 分钟前"
    }
    const hrs = Math.round(mins / 60)
    return hrs > 0 ? "约 " + hrs + " 小时后" : "约 " + -hrs + " 小时前"
  }
  if (days === 1) return "明天"
  if (days === 2) return "后天"
  if (days === -1) return "昨天"
  return days > 0 ? days + " 天后" : -days + " 天前"
}

export const defaultPresets: Preset[] = [
  { label: "现在", resolve: (now) => dateToParts(now) },
  { label: "今天 08:00", resolve: (now) => ({ ...dateToParts(now), hour: 8, minute: 0 }) },
  { label: "明天 08:00", resolve: (now) => ({ ...dateToParts(addDays(now, 1)), hour: 8, minute: 0 }) },
  {
    label: "下周同天",
    resolve: (_now, cur) => ({ ...dateToParts(addDays(partsToDate(cur), 7)), hour: cur.hour, minute: cur.minute }),
  },
]

export interface PreviewContext {
  weekday?: WeekdayConfig
  preview?: PreviewConfig
}

// 实时预览：按场景增减 chip，自动过滤空值 —— 1 条或 5 条都保持协调。
export function buildPreviewItems(draft: DateTimeParts, mode: Mode, ctx: PreviewContext): PreviewItem[] {
  const pv = ctx.preview || {}
  if (typeof pv.render === "function") {
    const custom = pv.render(draft)
    if (Array.isArray(custom)) return custom.filter(Boolean)
  }
  const items: PreviewItem[] = []
  const weekdayEnabled = !!(ctx.weekday && ctx.weekday.enabled)
  if (mode === "time") {
    const lead = weekdayEnabled ? "周" + MON[typeof draft.weekday === "number" ? draft.weekday : 0] + " " : ""
    items.push({ tone: "primary", text: lead + pad2(draft.hour) + ":" + pad2(draft.minute) })
    if (pv.durationMin) {
      const total = draft.hour * 60 + draft.minute + pv.durationMin
      const end = addMinutes({ year: 2000, month: 1, day: 1, hour: draft.hour, minute: draft.minute }, pv.durationMin)
      items.push({
        tone: "dim",
        text: "至 " + (total >= 1440 ? "次日 " : "") + pad2(end.hour) + ":" + pad2(end.minute) + " · 共 " + pv.durationMin + " 分钟",
      })
    }
  } else {
    let main = formatDateCN(draft) + " " + weekdayCN(draft)
    if (mode === "datetime") main += " " + pad2(draft.hour) + ":" + pad2(draft.minute)
    items.push({ tone: "primary", text: main })
    if (pv.relative) {
      const r = relativeCN(draft)
      if (r) items.push({ tone: "dim", text: r })
    }
    if (pv.holiday) {
      const h = pv.holiday(draft)
      if (h) items.push({ tone: "warn", text: h })
    }
  }
  return items
}
