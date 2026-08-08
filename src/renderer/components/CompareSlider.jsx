import React, { useRef, useState, useCallback, useEffect } from "react";

/**
 * Draggable before/after comparison slider, matching Upscayl's
 * signature preview interaction.
 *
 * Perf note: mousemove can fire far faster than the screen can repaint
 * (sometimes 100s of times/sec), and each one was triggering a React
 * state update + re-render, which is what made dragging feel laggy.
 * We now coalesce moves with requestAnimationFrame so we update state
 * at most once per rendered frame, and use pointer capture so a fast
 * drag that leaves the container doesn't drop/stutter the interaction.
 */
export default function CompareSlider({ beforeSrc, afterSrc, label }) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const rafId = useRef(null);
  const pendingClientX = useRef(null);

  const applyPosition = useCallback((clientX) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, pct)));
  }, []);

  const scheduleUpdate = useCallback(
    (clientX) => {
      pendingClientX.current = clientX;
      if (rafId.current != null) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (pendingClientX.current != null) applyPosition(pendingClientX.current);
      });
    },
    [applyPosition]
  );

  useEffect(() => {
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  const onPointerDown = (e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyPosition(e.clientX); // respond immediately on click, don't wait a frame
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    scheduleUpdate(e.clientX);
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
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