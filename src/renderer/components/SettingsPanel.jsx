import React, { useState } from "react";
import LabeledSlider from "./LabeledSlider.jsx";
import AngleDial from "./AngleDial.jsx";

const MAX_LOGOS = 5;

function LogoRow({ index, value, onChoose, onRemove }) {
  const filename = value ? value.split(/[/\\]/).pop() : "";
  return (
    <div className="mb-3">
      <label className="mb-1.5 block text-xs font-medium text-slate-300">Logo {index + 1}</label>
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

// A single pill in the horizontal section-tab row. Sections behave like
// tabs (one open at a time) rather than independent accordions, so the
// row stays compact and content doesn't stack multiple panels at once.
function SectionTab({ title, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-left transition-colors ${
        active
          ? "border-accent/40 bg-accent/15 text-accent"
          : "border-base-700 bg-base-950 text-base-500 hover:text-slate-300"
      }`}
      aria-expanded={active}
    >
      <Chevron open={active} />
      <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
    </button>
  );
}

export default function SettingsPanel({ config, setConfig, onChooseOutputFolder, onAddLogo, onChooseLogoAt, onRemoveLogoAt }) {
  const set = (key) => (val) => setConfig((c) => ({ ...c, [key]: val }));
  const logos = config.logos || [];

  // Only one section is open at a time — the tab row stays put and the
  // content below swaps, rather than every section's content stacking.
  // Watermarks is open by default so the panel isn't empty on launch —
  // the person can still collapse it or switch to another section.
  const [activeSection, setActiveSection] = useState("watermarks");
  const toggleSection = (id) => setActiveSection((cur) => (cur === id ? null : id));

  // Shadow/outline options can be collapsed independently of their On/Off
  // toggle, so turning an effect on doesn't force its panel to stay open —
  // the person can hide the options while leaving the effect enabled.
  const [shadowExpanded, setShadowExpanded] = useState(true);
  const [outlineExpanded, setOutlineExpanded] = useState(true);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        <SectionTab
          title={`Watermarks (${logos.length}/${MAX_LOGOS})`}
          active={activeSection === "watermarks"}
          onClick={() => toggleSection("watermarks")}
        />
        <SectionTab
          title="Enhancement"
          active={activeSection === "enhancement"}
          onClick={() => toggleSection("enhancement")}
        />
        <SectionTab title="Output" active={activeSection === "output"} onClick={() => toggleSection("output")} />
      </div>

      {activeSection === "watermarks" && (
      <div className="pb-5">
        <div className="mb-3 flex justify-start">
          <button
            onClick={onAddLogo}
            disabled={logos.length >= MAX_LOGOS}
            className="rounded-md border border-base-700 px-2 py-1 text-xs font-medium text-slate-300 hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Add
          </button>
        </div>

        {logos.length === 0 && <p className="mb-3 text-xs text-base-500">No logos added yet.</p>}

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

        <LabeledSlider label="Logo size" value={config.logoScalePercent} min={2} max={40} onChange={set("logoScalePercent")} />
        <LabeledSlider label="Logo opacity" value={config.logoOpacityPercent} min={0} max={100} onChange={set("logoOpacityPercent")} />

        <div className="mb-3 rounded-xl2 border border-base-800 p-3">
          <div className="flex w-full items-center justify-between gap-2">
            <button
              onClick={() => set("logoShadow")(!config.logoShadow)}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <span className={`text-xs font-semibold ${config.logoShadow ? "text-accent" : "text-slate-300"}`}>Shadow</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  config.logoShadow ? "bg-accent/15 text-accent" : "bg-base-800 text-base-500"
                }`}
              >
                {config.logoShadow ? "On" : "Off"}
              </span>
            </button>
            {config.logoShadow && (
              <button
                onClick={() => setShadowExpanded((o) => !o)}
                className="flex-shrink-0 text-base-500 hover:text-accent"
                title={shadowExpanded ? "Hide shadow options" : "Show shadow options"}
                aria-expanded={shadowExpanded}
              >
                <Chevron open={shadowExpanded} />
              </button>
            )}
          </div>

          {config.logoShadow && shadowExpanded && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300">Shadow color</label>
                <input
                  type="color"
                  value={config.logoShadowColor || "#000000"}
                  onChange={(e) => set("logoShadowColor")(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-base-700 bg-base-900 p-0.5"
                />
              </div>

              <LabeledSlider
                label="Shadow distance"
                value={config.logoShadowDistancePercent}
                min={0}
                max={30}
                step={0.5}
                onChange={set("logoShadowDistancePercent")}
              />

              <LabeledSlider
                label="Shadow opacity"
                value={config.logoShadowOpacityPercent ?? 100}
                min={0}
                max={100}
                onChange={set("logoShadowOpacityPercent")}
              />

              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-slate-300">Shadow angle</label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={360}
                      step={1}
                      value={Math.round(config.logoShadowAngle)}
                      onChange={(e) => {
                        const num = Number(e.target.value);
                        if (!Number.isNaN(num)) set("logoShadowAngle")(Math.min(360, Math.max(0, num)));
                      }}
                      className="w-14 rounded-md border border-base-700 bg-base-900 px-1.5 py-0.5 text-right text-xs font-semibold text-accent focus:border-accent focus:outline-none"
                    />
                    <span className="text-xs font-semibold text-accent">°</span>
                  </div>
                  <AngleDial value={config.logoShadowAngle} onChange={set("logoShadowAngle")} size={56} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mb-1 rounded-xl2 border border-base-800 p-3">
          <div className="flex w-full items-center justify-between gap-2">
            <button
              onClick={() => set("logoOutline")(!config.logoOutline)}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <span className={`text-xs font-semibold ${config.logoOutline ? "text-accent" : "text-slate-300"}`}>Outline</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  config.logoOutline ? "bg-accent/15 text-accent" : "bg-base-800 text-base-500"
                }`}
              >
                {config.logoOutline ? "On" : "Off"}
              </span>
            </button>
            {config.logoOutline && (
              <button
                onClick={() => setOutlineExpanded((o) => !o)}
                className="flex-shrink-0 text-base-500 hover:text-accent"
                title={outlineExpanded ? "Hide outline options" : "Show outline options"}
                aria-expanded={outlineExpanded}
              >
                <Chevron open={outlineExpanded} />
              </button>
            )}
          </div>

          {config.logoOutline && outlineExpanded && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300">Outline color</label>
                <input
                  type="color"
                  value={config.logoOutlineColor || "#ffffff"}
                  onChange={(e) => set("logoOutlineColor")(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-base-700 bg-base-900 p-0.5"
                />
              </div>

              <LabeledSlider
                label="Outline size"
                value={config.logoOutlineSizePercent}
                min={1}
                max={20}
                step={0.5}
                onChange={set("logoOutlineSizePercent")}
              />

              <LabeledSlider
                label="Outline opacity"
                value={config.logoOutlineOpacityPercent ?? 100}
                min={0}
                max={100}
                onChange={set("logoOutlineOpacityPercent")}
              />
            </div>
          )}
        </div>
      </div>
      )}

      {activeSection === "enhancement" && (
      <div className="pb-5">
        <div className="mb-4 flex gap-1.5">
          {[
            { key: "auto", label: "Auto" },
            { key: "manual", label: "Manual" }
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => set("enhancementMode")(opt.key)}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                (config.enhancementMode || "auto") === opt.key
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-base-700 text-slate-400 hover:border-base-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {(config.enhancementMode || "auto") === "auto" ? (
          <>
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Filter</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { key: "natural", label: "Natural" },
                  { key: "vivid", label: "Vivid" },
                  { key: "bw", label: "B&W" }
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => set("enhancementFilter")(opt.key)}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                      (config.enhancementFilter || "natural") === opt.key
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-base-700 text-slate-400 hover:border-base-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <LabeledSlider
              label="Enhancement intensity"
              value={config.enhancementIntensity}
              min={0}
              max={100}
              onChange={set("enhancementIntensity")}
            />
          </>
        ) : (
          <>
            <LabeledSlider label="Hue" value={config.manualHue ?? 0} min={-180} max={180} unit="°" onChange={set("manualHue")} />
            <LabeledSlider
              label="Saturation"
              value={config.manualSaturation ?? 0}
              min={-100}
              max={100}
              onChange={set("manualSaturation")}
            />
            <LabeledSlider
              label="Brightness (Value)"
              value={config.manualBrightness ?? 0}
              min={-100}
              max={100}
              onChange={set("manualBrightness")}
            />
            <LabeledSlider
              label="Contrast"
              value={config.manualContrast ?? 0}
              min={-100}
              max={100}
              onChange={set("manualContrast")}
            />
            <LabeledSlider
              label="Exposure"
              value={config.manualExposure ?? 0}
              min={-100}
              max={100}
              onChange={set("manualExposure")}
            />
            <LabeledSlider
              label="Highlights"
              value={config.manualHighlights ?? 0}
              min={-100}
              max={100}
              onChange={set("manualHighlights")}
            />
            <LabeledSlider
              label="Shadows"
              value={config.manualShadows ?? 0}
              min={-100}
              max={100}
              onChange={set("manualShadows")}
            />
            <LabeledSlider
              label="Sharpen"
              value={config.manualSharpen ?? 0}
              min={0}
              max={100}
              onChange={set("manualSharpen")}
            />
          </>
        )}
      </div>
      )}

      {activeSection === "output" && (
      <div className="pb-5">
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
      </div>
      )}
    </div>
  );
}