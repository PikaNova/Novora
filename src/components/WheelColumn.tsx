import { forwardRef, useEffect, useRef } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";

interface WheelColumnProps {
  values: number[];
  value: number;
  onChange: (value: number) => void;
  className?: string;
  itemHeight?: number;
  formatValue?: (value: number) => string;
  ariaLabel?: string;
}

/** Shared vertical wheel behavior for every date/time flow. */
const WheelColumn = forwardRef<HTMLDivElement, WheelColumnProps>(function WheelColumn({
  values,
  value,
  onChange,
  className,
  itemHeight = 48,
  formatValue = (item) => String(item).padStart(2, "0"),
  ariaLabel,
}, forwardedRef) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef(value);
  const emittedValueRef = useRef<number | null>(null);
  const deltaRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  valueRef.current = value;

  const assignRef = (node: HTMLDivElement | null) => {
    listRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  useEffect(() => {
    if (emittedValueRef.current === value) {
      emittedValueRef.current = null;
      return;
    }
    const element = listRef.current;
    const index = values.indexOf(value);
    if (!element || index < 0) return;
    const target = index * itemHeight;
    if (Math.abs(element.scrollTop - target) > 1) element.scrollTop = target;
  }, [itemHeight, value, values]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  const select = (next: number, behavior: ScrollBehavior = "auto") => {
    const index = values.indexOf(next);
    if (index < 0) return;
    valueRef.current = next;
    emittedValueRef.current = next;
    onChange(next);
    listRef.current?.scrollTo({ top: index * itemHeight, behavior });
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.deltaY) return;
    const normalized = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    deltaRef.current += normalized;
    if (Math.abs(deltaRef.current) < 12) return;
    const direction = deltaRef.current > 0 ? 1 : -1;
    deltaRef.current = 0;
    const currentIndex = Math.max(0, values.indexOf(valueRef.current));
    const nextIndex = Math.max(0, Math.min(values.length - 1, currentIndex + direction));
    if (nextIndex !== currentIndex) select(values[nextIndex], "auto");
  };

  const handleScroll = (element: HTMLDivElement) => {
    if (element.scrollLeft !== 0) element.scrollLeft = 0;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      const index = Math.max(0, Math.min(values.length - 1, Math.round(element.scrollTop / itemHeight)));
      const next = values[index];
      if (next !== valueRef.current) {
        valueRef.current = next;
        emittedValueRef.current = next;
        onChange(next);
      }
    });
  };

  return <div
    ref={assignRef}
    className={className}
    aria-label={ariaLabel}
    onWheel={handleWheel}
    onScroll={(event) => handleScroll(event.currentTarget)}
  >
    {values.map((item) => <button
      type="button"
      key={item}
      className={item === value ? "is-selected" : ""}
      onClick={() => select(item, "smooth")}
    >{formatValue(item)}</button>)}
  </div>;
});

export default WheelColumn;
