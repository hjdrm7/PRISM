import React, { useRef, useCallback } from "react";

/**
 * Small circular dial for picking an angle 0-360°. Kept in sync with the
 * linear "Shadow angle" slider next to it — both write to the same config
 * value. Angle convention matches processor.js: 0° = right, 90° = down
 * (screen-space Y-down), which is why we don't flip the sign of dy below.
 */
export default function AngleDial({ value, onChange, size = 56 }) {
  const svgRef = useRef(null);
  const dragging = useRef(false);

  const angleFromPoint = useCallback(
    (clientX, clientY) => {
      const el = svgRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      let deg = Math.atan2(dy, dx) * (180 / Math.PI);
      if (deg < 0) deg += 360;
      return Math.round(deg);
    },
    [value],
  );

  const onPointerDown = (e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(angleFromPoint(e.clientX, e.clientY));
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    onChange(angleFromPoint(e.clientX, e.clientY));
  };
  const stopDrag = () => {
    dragging.current = false;
  };

  const rad = (value * Math.PI) / 180;
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const hx = cx + Math.cos(rad) * r;
  const hy = cy + Math.sin(rad) * r;

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      className="flex-shrink-0 cursor-pointer touch-none select-none"
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="#1c2126"
        stroke="#31373d"
        strokeWidth="2"
      />
      <line
        x1={cx}
        y1={cy}
        x2={hx}
        y2={hy}
        stroke="#37e0c4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="2" fill="#31373d" />
      <circle
        cx={hx}
        cy={hy}
        r="5"
        fill="#37e0c4"
        stroke="#15181b"
        strokeWidth="1.5"
      />
    </svg>
  );
}
