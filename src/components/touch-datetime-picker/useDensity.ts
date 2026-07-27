import type { Density } from "./types"

export type ResolvedDensity = "compact" | "sheet" | "panel"

// 自适应密度：显式传值优先；手机使用抽屉，其余视口使用锚点浮层。
export function resolveDensity(density?: Density): ResolvedDensity {
  if (density && density !== "auto") return density
  if (typeof window === "undefined") return "panel"
  // The available viewport is a more reliable distinction than pointer type:
  // touch-enabled Windows devices should still use the anchored desktop picker.
  return window.innerWidth <= 620 ? "sheet" : "compact"
}
