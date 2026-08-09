import React, { useState, useEffect } from "react";

export default function LabeledSlider({ label, value, min, max, step = 1, unit = "%", onChange }) {
  // The number input is edited as free text locally so the user can clear
  // it, type multiple digits, etc. without each keystroke being clamped
  // out from under them — it only gets clamped and committed on blur/Enter.
  const [textValue, setTextValue] = useState(String(value));

  useEffect(() => {
    setTextValue(String(value));
  }, [value]);

  const commit = (raw) => {
    const num = Number(raw);
    if (raw.trim() === "" || Number.isNaN(num)) {
      setTextValue(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, num));
    onChange(clamped);
    setTextValue(String(clamped));
  };

  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs font-medium text-slate-300">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full flex-1"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(e.target.value);
              e.currentTarget.blur();
            }
          }}
          className="w-14 flex-shrink-0 rounded-md border border-base-700 bg-base-900 px-1.5 py-0.5 text-center text-xs font-semibold text-accent focus:border-accent focus:outline-none"
        />
      </div>
    </div>
  );
}