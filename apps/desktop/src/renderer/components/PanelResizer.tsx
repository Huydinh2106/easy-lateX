import { useRef, useState } from "react";

interface PanelResizerProps {
  label: string;
  orientation: "vertical" | "horizontal";
  value: number;
  minimum: number;
  maximum: number;
  defaultValue: number;
  direction?: 1 | -1;
  className?: string;
  onChange(value: number, persist: boolean): void;
}

export function PanelResizer({ label, orientation, value, minimum, maximum, defaultValue, direction = 1, className = "", onChange }: PanelResizerProps) {
  const drag = useRef<{ pointerId: number; start: number; value: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const bound = (size: number) => Math.round(Math.max(minimum, Math.min(maximum, size)));

  return (
    <div
      className={`panel-resizer panel-resizer-${orientation} ${className}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      title={`${label} · Drag or use arrow keys · Double-click to reset`}
      data-dragging={dragging}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, start: orientation === "vertical" ? event.clientX : event.clientY, value, latest: value };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || event.pointerId !== active.pointerId) return;
        const coordinate = orientation === "vertical" ? event.clientX : event.clientY;
        active.latest = bound(active.value + (coordinate - active.start) * direction);
        onChange(active.latest, false);
      }}
      onLostPointerCapture={() => {
        const active = drag.current;
        drag.current = null;
        setDragging(false);
        if (active) onChange(active.latest, true);
      }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onDoubleClick={() => onChange(bound(defaultValue), true)}
      onKeyDown={(event) => {
        const decrease = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const increase = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        if (![decrease, increase, "Home", "End", "Enter"].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? 40 : 10;
        const next = event.key === "Home" ? minimum : event.key === "End" ? maximum : event.key === "Enter" ? defaultValue
          : value + (event.key === increase ? step : -step) * direction;
        onChange(bound(next), true);
      }}
    />
  );
}
