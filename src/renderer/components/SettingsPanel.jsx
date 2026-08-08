import React, { useState } from "react";
import LabeledSlider from "./LabeledSlider.jsx";

const MAX_LOGOS = 5;

function LogoRow({ index, value, onChoose, onRemove }) {
  const filename = value ? value.split(/[/\\]/).pop() : "";
  return (
    <div className="mb-3">
      <label className="mb-1.5 block text-xs font-medium text-slate-300">Watermark {index + 1}</label>
      <div className="flex items-center gap-2">
        <button
          onClick={onChoose}
          className="flex-1 truncate rounded-lg border border-base-700 bg-base-900 px-3 py-2 text-left text-xs text-slate-300 hover:border-accent/50"
          title={value}
        >
          {filename || "Choose file…"}
        </button>
        <button
          onClick={onRemove}
          className="rounded-lg border border-base-700 px-2 py-2 text-xs text-base-500 hover:border-red-400 hover:text-red-400"
          title="Remove"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// Wraps each settings group with a divider (skipped on the first section)
// and consistent spacing, so groups read as distinct blocks rather than
// running together.
function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-3.5 w-3.5 flex-shrink-0 text-base-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 7.5L10 12.5L15 7.5" />
    </svg>
  );
}

function Section({ title, first = false, right = null, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={first ? "pb-5" : "border-t border-base-800 py-5"}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
        >
          <Chevron open={open} />
          <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-base-500">{title}</h3>
        </button>
        {right}
      </div>
      {open && children}
    </div>
  );
}

export default function SettingsPanel({ config, setConfig, onChooseOutputFolder, onAddLogo, onChooseLogoAt, onRemoveLogoAt }) {
  const set = (key) => (val) => setConfig((c) => ({ ...c, [key]: val }));
  const logos = config.logos || [];

  return (
    <div>
      <Section
        title={`Watermarks (${logos.length}/${MAX_LOGOS})`}
        first
        right={
          <button
            onClick={onAddLogo}
            disabled={logos.length >= MAX_LOGOS}
            className="rounded-md border border-base-700 px-2 py-1 text-xs font-medium text-slate-300 hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Add
          </button>
        }
      >
        {logos.length === 0 && <p className="mb-3 text-xs text-base-500">No watermarks added yet.</p>}

        {logos.map((logoPath, index) => (
          <LogoRow
            key={index}
            index={index}
            value={logoPath}
            onChoose={() => onChooseLogoAt(index)}
            onRemove={() => onRemoveLogoAt(index)}
          />
        ))}

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-300">Position</label>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { key: "top-left", label: "Upper Left" },
              { key: "top-right", label: "Upper Right" },
              { key: "bottom-left", label: "Lower Left" },
              { key: "bottom-right", label: "Lower Right" }
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => set("logoPosition")(opt.key)}
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  (config.logoPosition || "bottom-right") === opt.key
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-base-700 text-slate-400 hover:border-base-600"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <LabeledSlider label="Watermark Size" value={config.logoScalePercent} min={2} max={40} onChange={set("logoScalePercent")} />
        <LabeledSlider label="Watermark Opacity" value={config.logoOpacityPercent} min={0} max={100} onChange={set("logoOpacityPercent")} />

        <label className="mb-1.5 block text-xs font-medium text-slate-300">Watermark Effects</label>
        <div className="mb-2 flex gap-1.5">
          <button
            onClick={() => set("logoShadow")(!config.logoShadow)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              config.logoShadow
                ? "border-accent bg-accent/15 text-accent"
                : "border-base-700 text-slate-400 hover:border-base-600"
            }`}
          >
            Black shadow
          </button>
          <button
            onClick={() => set("logoOutline")(!config.logoOutline)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              config.logoOutline
                ? "border-accent bg-accent/15 text-accent"
                : "border-base-700 text-slate-400 hover:border-base-600"
            }`}
          >
            White outline
          </button>
        </div>

        {config.logoOutline && (
          <LabeledSlider
            label="Outline size"
            value={config.logoOutlineSizePercent}
            min={1}
            max={20}
            step={0.5}
            onChange={set("logoOutlineSizePercent")}
          />
        )}

        {config.logoShadow && (
          <>
            <LabeledSlider
              label="Shadow distance"
              value={config.logoShadowDistancePercent}
              min={0}
              max={30}
              step={0.5}
              onChange={set("logoShadowDistancePercent")}
            />
            <LabeledSlider
              label="Shadow angle"
              value={config.logoShadowAngle}
              min={0}
              max={360}
              step={1}
              unit="°"
              onChange={set("logoShadowAngle")}
            />
          </>
        )}
      </Section>

      <Section title="Enhancement">
        <LabeledSlider
          label="Enhancement Intensity"
          value={config.enhancementIntensity}
          min={0}
          max={100}
          onChange={set("enhancementIntensity")}
        />
      </Section>

      <Section title="Output">
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-300">Output Folder</label>
          <button
            onClick={onChooseOutputFolder}
            className="w-full truncate rounded-lg border border-base-700 bg-base-900 px-3 py-2 text-left text-xs text-slate-300 hover:border-accent/50"
            title={config.outputFolder}
          >
            {config.outputFolder || "Choose folder…"}
          </button>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-300">Save as</label>
          <div className="flex gap-1.5">
            {[
              { key: "original", label: "Original" },
              { key: "jpeg", label: "JPEG" },
              { key: "png", label: "PNG" }
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => set("outputFormat")(opt.key)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  (config.outputFormat || "original") === opt.key
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-base-700 text-slate-400 hover:border-base-600"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-300">Append to filename</label>
          <input
            type="text"
            value={config.filenameSuffix || ""}
            onChange={(e) => set("filenameSuffix")(e.target.value)}
            placeholder="e.g. _edited, _v2, -01"
            maxLength={40}
            className="w-full rounded-lg border border-base-700 bg-base-900 px-3 py-2 text-xs text-slate-300 placeholder:text-base-600 focus:border-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-base-500">
            Added before the extension, e.g. photo{config.filenameSuffix || "_edited"}.jpg
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-300">If file exists</label>
          <div className="flex gap-1.5">
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
      </Section>
    </div>
  );
}