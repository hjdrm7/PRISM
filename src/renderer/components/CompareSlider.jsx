import React, { useRef, useState, useCallback } from "react";

/**
 * Draggable before/after comparison slider, matching Upscayl's
 * signature preview interaction.
 */
export default function CompareSlider({ beforeSrc, afterSrc, label }) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef(null);
  const dragging = useRef(false);

  const updateFromClientX = useCallback((clientX) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, pct)));
  }, []);

  const onPointerDown = (e) => {
    dragging.current = true;
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    updateFromClientX(e.clientX);
  };
  const stopDrag = () => {
    dragging.current = false;
  };

  if (!beforeSrc || !afterSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl2 border border-dashed border-base-700 text-base-500">
        <p className="text-sm">Select an image to preview before/after</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={onPointerDown}
      onMouseMove={onPointerMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      className="relative h-full w-full select-none overflow-hidden rounded-xl2 bg-base-900 shadow-2xl"
    >
      <img src={afterSrc} alt="Processed" className="pointer-events-none h-full w-full object-contain" draggable={false} />

      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img src={beforeSrc} alt="Original" className="h-full w-full object-contain" draggable={false} />
      </div>

      <div
        className="absolute inset-y-0 flex w-0.5 cursor-ew-resize items-center justify-center bg-accent"
        style={{ left: `${position}%` }}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-accent bg-base-900 shadow-lg">
          <span className="text-accent">⇔</span>
        </div>
      </div>

      <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-slate-200">
        Original
      </span>
      <span className="absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-accent">
        {label || "Processed"}
      </span>
    </div>
  );
}
