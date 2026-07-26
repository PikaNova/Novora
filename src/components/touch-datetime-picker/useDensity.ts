import type { Density } from "./types"

export type ResolvedDensity = "compact" | "sheet" | "panel"

// 自适应密度：
// - 显式传值优先（一体机构建里建议写死 "panel"）
// - 细指针（鼠标）-> compact 浮层
// - 粗指针（触摸）+ 窄屏 -> sheet 抽屉；否则 -> panel 大面板
export function resolveDensity(density?: Density): ResolvedDensity {
  if (density && density !== "auto") return density
  if (typeof window === "undefined") return "panel"
  const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)
  if (!coarse) return "compact"
  return window.innerWidth <= 520 ? "sheet" : "panel"
}
