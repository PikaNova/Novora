import { useRef } from "react"
import type { ReactNode } from "react"

export interface TapButtonProps {
  onTap: () => void
  children: ReactNode
  className?: string
  selected?: boolean
  disabled?: boolean
  ariaLabel?: string
}

// 防误触按钮（规则 2 / 7 / 8 / 10）：
// - 在 pointerup 且指针仍落在元素内时才触发；滑出即取消
// - 键盘走独立通道；右键菜单被吞掉
// - 300ms 同点去抖，避免误触双击
export function TapButton({ onTap, children, className, selected, disabled, ariaLabel }: TapButtonProps) {
  const armed = useRef(false)
  const last = useRef(0)

  function fire() {
    const n = performance.now()
    if (n - last.current <= 300) return
    last.current = n
    onTap()
  }

  return (
    <button
      type="button"
      disabled={disabled}
      className={"tdp-btn" + (selected ? " is-selected" : "") + (className ? " " + className : "")}
      aria-pressed={selected || undefined}
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        armed.current = true
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* noop */
        }
      }}
      onPointerUp={(e) => {
        if (!armed.current) return
        armed.current = false
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) fire()
      }}
      onPointerCancel={() => {
        armed.current = false
      }}
      onLostPointerCapture={() => {
        armed.current = false
      }}
      onClick={() => {
        fire()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          fire()
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}
