import React from "react";
import LabeledSlider from "./LabeledSlider.jsx";

function FileRow({ label, value, onChoose, onClear }) {
  const filename = value ? value.split(/[/\\]/).pop() : "";
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs font-medium text-slate-300">{label}</label>
      <div className="flex items-center gap-2">
        <button
          onClick={onChoose}
          className="flex-1 truncate rounded-lg border border-base-700 bg-base-900 px-3 py-2 text-left text-xs text-slate-300 hover:border-accent/50"
          title={value}
        >
          {filename || "Choose file…"}
        </button>
        {value && (
          <button
            onClick={onClear}
            className="rounded-lg border border-base-700 px-2 py-2 text-xs text-base-500 hover:border-red-400 hover:text-red-400"
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export default function SettingsPanel({ config, setConfig, onChooseOutputFolder, onChooseLogo1, onChooseLogo2 }) {
  const set = (key) => (val) => setConfig((c) => ({ ...c, [key]: val }));

  return (
    <div className="space-y-1">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-base-500">Output</h3>

      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-slate-300">Output folder</label>
        <button
          onClick={onChooseOutputFolder}
          className="w-full truncate rounded-lg border border-base-700 bg-base-900 px-3 py-2 text-left text-xs text-slate-300 hover:border-accent/50"
          title={config.outputFolder}
        >
          {config.outputFolder || "Choose folder…"}
        </button>
      </div>

      <h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wide text-base-500">Logos</h3>
      <FileRow
        label="Logo 1 (PNG)"
        value={config.logo1Path}
        onChoose={onChooseLogo1}
        onClear={() => set("logo1Path")("")}
      />
      <FileRow
        label="Logo 2 (PNG)"
        value={config.logo2Path}
        onChoose={onChooseLogo2}
        onClear={() => set("logo2Path")("")}
      />

      <LabeledSlider label="Logo size" value={config.logoScalePercent} min={2} max={40} onChange={set("logoScalePercent")} />
      <LabeledSlider label="Logo opacity" value={config.logoOpacityPercent} min={0} max={100} onChange={set("logoOpacityPercent")} />

      <h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wide text-base-500">Enhancement</h3>
      <LabeledSlider
        label="Enhancement intensity"
        value={config.enhancementIntensity}
        min={0}
        max={100}
        onChange={set("enhancementIntensity")}
      />

      <h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wide text-base-500">If file exists</h3>
      <div className="mb-2 flex gap-1.5">
        {[
          { key: "rename", label: "Rename" },
          { key: "overwrite", label: "Overwrite" },
          { key: "skip", label: "Skip" }
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => set("collisionStrategy")(opt.key)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              config.collisionStrategy === opt.key
                ? "border-accent bg-accent/15 text-accent"
                : "border-base-700 text-slate-400 hover:border-base-600"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
