import { useEffect, useRef } from "react";

export type ResizeHandleProps = { label: string; value: number; min: number; max: number; onValueChange: (value: number) => void; orientation?: "vertical" | "horizontal"; step?: number; reverse?: boolean; controls?: string; className?: string };
export function ResizeHandle({ label, value, min, max, onValueChange, orientation = "vertical", step = 10, reverse = false, controls, className = "" }: ResizeHandleProps) {
  const drag = useRef<{ pointerId: number; start: number; value: number } | null>(null);
  const latest = useRef({ value, min, max, onValueChange });
  latest.current = { value, min, max, onValueChange };
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  useEffect(() => () => { drag.current = null; }, []);
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={clamp(value)} aria-controls={controls}
    className={`aos-resize-handle aos-resize-handle--${orientation} ${className}`}
    onKeyDown={(event) => {
      let next: number | undefined;
      const increment = step * (event.shiftKey ? 5 : 1) * (reverse ? -1 : 1);
      if (event.key === "Home") next = min;
      if (event.key === "End") next = max;
      if (event.key === (orientation === "vertical" ? "ArrowRight" : "ArrowDown")) next = value + increment;
      if (event.key === (orientation === "vertical" ? "ArrowLeft" : "ArrowUp")) next = value - increment;
      if (next !== undefined) { event.preventDefault(); onValueChange(clamp(next)); }
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, start: orientation === "vertical" ? event.clientX : event.clientY, value };
    }}
    onPointerMove={(event) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      const delta = ((orientation === "vertical" ? event.clientX : event.clientY) - drag.current.start) * (reverse ? -1 : 1);
      const current = latest.current;
      current.onValueChange(Math.max(current.min, Math.min(current.max, drag.current.value + delta)));
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><span aria-hidden="true" /></div>;
}
export default ResizeHandle;
