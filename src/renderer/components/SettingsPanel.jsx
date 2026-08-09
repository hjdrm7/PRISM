import React, { useState } from "react";
import LabeledSlider from "./LabeledSlider.jsx";
import AngleDial from "./AngleDial.jsx";
import { Layers, Sparkles, Download, X, Sun, Droplet, Wand2, RotateCcw, Save, Trash2 } from "lucide-react";

const MAX_LOGOS = 5;

// Preset slider values applied instantly when the person picks a one-click
// filter, so Vivid/BW visibly move the Tone/Color/Detail bars to show what
// changed rather than acting as an invisible black box. Smart Enhance has
// no preset — it leaves the bars alone and disables them, since decisions
// are made per-image on the backend instead of from a fixed set of numbers.
const FILTER_PRESETS = {
  vivid: {
    manualBrightness: 5,
    manualContrast: 15,
    manualExposure: 5,
    manualHighlights: -10,
    manualShadows: 10,
    manualHue: 0,
    manualSaturation: 35,
    manualSharpen: 20
  },
  bw: {
    manualBrightness: 0,
    manualContrast: 10,
    manualExposure: 0,
    manualHighlights: -5,
    manualShadows: 5,
    manualHue: 0,
    manualSaturation: -100,
    manualSharpen: 15
  }
};

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
          className="rounded-lg border border-base-700 px-2 py-2 text-base-500 hover:border-red-400 hover:text-red-400"
          title="Remove"
        >
          <X className="h-3.5 w-3.5" />
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

// A small On/Off toggle switch, used in place of a plain text badge so
// the current state and the "click to change it" affordance are both
// visible at a glance.
function SwitchPill({ on, onToggle, label }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-4 w-7 flex-shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-base-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-base-950 shadow transition-transform ${
          on ? "translate-x-3" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// A single tab in the horizontal section row. Sections behave like tabs
// (one open at a time) rather than independent accordions, so the row
// stays compact and content doesn't stack multiple panels at once. An
// icon + bottom-border indicator makes the active section unambiguous
// at a glance, rather than relying on a subtle background tint alone.
function SectionTab({ title, icon: Icon, badge, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-1.5 whitespace-nowrap pb-2.5 pr-1 pt-1 text-left transition-colors ${
        active ? "text-accent" : "text-base-500 hover:text-slate-300"
      }`}
      aria-expanded={active}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
      <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
      {badge && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            active ? "bg-accent/15 text-accent" : "bg-base-800 text-base-500"
          }`}
        >
          {badge}
        </span>
      )}
      {active && <span className="absolute -bottom-px left-0 right-0 h-[2px] rounded-full bg-accent" />}
    </button>
  );
}

// Small labeled divider above a cluster of related sliders (Tone / Color /
// Detail), so the 8 manual-enhancement controls read as three scannable
// groups instead of one undifferentiated stack.
function SliderGroupHead({ icon: Icon, label }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <Icon className="h-3 w-3 text-base-500" strokeWidth={2.5} />
      <span className="text-[10px] font-bold uppercase tracking-wider text-base-500">{label}</span>
    </div>
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

  // Presets row (Vivid/BW plus any user-saved presets) is collapsed by
  // default so the enhancement tab leads with the mode/action row, not a
  // wall of preset chips. "Save as Preset" opens a small inline name
  // field rather than a native prompt() dialog, so it matches the rest
  // of the app's styling.
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");

  return (
    <div className="relative">
      <div className="mb-5 flex items-center gap-5 border-b border-base-800">
        <SectionTab
          title="Watermarks"
          icon={Layers}
          badge={`${logos.length}/${MAX_LOGOS}`}
          active={activeSection === "watermarks"}
          onClick={() => toggleSection("watermarks")}
        />
        <SectionTab
          title="Enhancement"
          icon={Sparkles}
          active={activeSection === "enhancement"}
          onClick={() => toggleSection("enhancement")}
        />
        <SectionTab
          title="Output"
          icon={Download}
          active={activeSection === "output"}
          onClick={() => toggleSection("output")}
        />
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
          {(() => {
            const corners = [
              { key: "top-left", label: "Upper Left", cls: "top-1.5 left-1.5" },
              { key: "top-right", label: "Upper Right", cls: "top-1.5 right-1.5" },
              { key: "center", label: "Center", cls: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" },
              { key: "bottom-left", label: "Lower Left", cls: "bottom-1.5 left-1.5" },
              { key: "bottom-right", label: "Lower Right", cls: "bottom-1.5 right-1.5" }
            ];
            const current = config.logoPosition || "bottom-right";
            return (
              <div className="flex items-center gap-4 rounded-xl2 border border-base-800 p-3">
                <div className="relative h-16 w-24 flex-shrink-0 rounded-lg border border-base-700 bg-base-950">
                  {corners.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => set("logoPosition")(c.key)}
                      title={c.label}
                      aria-label={c.label}
                      className={`absolute h-3.5 w-3.5 rounded-sm border transition-colors ${c.cls} ${
                        current === c.key
                          ? "border-accent bg-accent"
                          : "border-base-600 bg-base-800 hover:border-base-500"
                      }`}
                    />
                  ))}
                </div>
                <div className="text-xs font-medium text-slate-300">
                  {corners.find((c) => c.key === current)?.label}
                  <p className="mt-0.5 text-[11px] text-base-500">Click a corner to place the logo</p>
                </div>
              </div>
            );
          })()}
        </div>

        <LabeledSlider label="Logo size" value={config.logoScalePercent} min={2} max={40} onChange={set("logoScalePercent")} />
        <LabeledSlider label="Logo opacity" value={config.logoOpacityPercent} min={0} max={100} onChange={set("logoOpacityPercent")} />

        <div
          className={`mb-3 rounded-xl2 border border-base-800 p-3 transition-colors ${
            config.logoShadow ? "bg-base-900/40" : ""
          }`}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                onClick={() => setShadowExpanded((o) => !o)}
                className="text-xs font-semibold text-left"
              >
                <span className={config.logoShadow ? "text-accent" : "text-slate-300"}>Shadow</span>
              </button>
              <SwitchPill
                on={!!config.logoShadow}
                onToggle={() => set("logoShadow")(!config.logoShadow)}
                label="Toggle shadow"
              />
            </div>
            <button
              onClick={() => setShadowExpanded((o) => !o)}
              className="flex-shrink-0 text-base-500 hover:text-accent"
              title={shadowExpanded ? "Hide shadow options" : "Show shadow options"}
              aria-expanded={shadowExpanded}
            >
              <Chevron open={shadowExpanded} />
            </button>
          </div>

          {shadowExpanded && (
            <div
              className={`mt-3 space-y-3 rounded-lg bg-black/20 p-3 transition-opacity ${
                config.logoShadow ? "" : "pointer-events-none opacity-40"
              }`}
              aria-disabled={!config.logoShadow}
            >
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

        <div
          className={`mb-1 rounded-xl2 border border-base-800 p-3 transition-colors ${
            config.logoOutline ? "bg-base-900/40" : ""
          }`}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                onClick={() => setOutlineExpanded((o) => !o)}
                className="text-xs font-semibold text-left"
              >
                <span className={config.logoOutline ? "text-accent" : "text-slate-300"}>Outline</span>
              </button>
              <SwitchPill
                on={!!config.logoOutline}
                onToggle={() => set("logoOutline")(!config.logoOutline)}
                label="Toggle outline"
              />
            </div>
            <button
              onClick={() => setOutlineExpanded((o) => !o)}
              className="flex-shrink-0 text-base-500 hover:text-accent"
              title={outlineExpanded ? "Hide outline options" : "Show outline options"}
              aria-expanded={outlineExpanded}
            >
              <Chevron open={outlineExpanded} />
            </button>
          </div>

          {outlineExpanded && (
            <div
              className={`mt-3 space-y-3 rounded-lg bg-black/20 p-3 transition-opacity ${
                config.logoOutline ? "" : "pointer-events-none opacity-40"
              }`}
              aria-disabled={!config.logoOutline}
            >
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
        {(() => {
          const MANUAL_ZEROED = {
            manualBrightness: 0,
            manualContrast: 0,
            manualExposure: 0,
            manualHighlights: 0,
            manualShadows: 0,
            manualHue: 0,
            manualSaturation: 0,
            manualSharpen: 0
          };
          const customPresets = config.customPresets || [];

          const applyFilter = (key) => {
            setConfig((c) => ({
              ...c,
              enhancementFilter: key,
              // Explicitly set this on every switch, not just when picking
              // Vivid/BW: processor.js's dispatch also checks this legacy
              // field for backward compatibility with settings saved by an
              // older version of the app, and settings.js merges saved JSON
              // over the defaults, so a stale "manual" value from an old
              // settings.json would otherwise never get cleared and would
              // keep applying Vivid/BW's leftover manual values even after
              // switching to Smart Enhance.
              enhancementMode: key === "smart" ? "auto" : "manual",
              // Smart Enhance has no preset of its own and ignores these
              // fields when processing, but leaving the last manual values
              // in config still showed up in the (disabled) sliders when
              // switching back to Smart — reset them so the UI doesn't
              // look like leftover settings silently carried over.
              // "manual" has no preset of its own — it just switches into
              // manual mode and leaves whatever slider values are already
              // sitting in config untouched, so tweaking after Vivid/BW
              // (or a saved preset) doesn't get clobbered.
              ...(key === "smart" ? MANUAL_ZEROED : FILTER_PRESETS[key] || {})
            }));
          };

          const applyCustomPreset = (preset) => {
            setConfig((c) => ({
              ...c,
              enhancementFilter: "manual",
              enhancementMode: "manual",
              ...preset.values
            }));
          };

          const resetManual = () => {
            setConfig((c) => ({
              ...c,
              ...MANUAL_ZEROED
            }));
          };

          const currentFilter = config.enhancementFilter || "smart";
          const isSmart = currentFilter === "smart";

          const openSavePreset = () => {
            setPresetNameDraft("");
            setSavingPreset(true);
          };
          const cancelSavePreset = () => {
            setSavingPreset(false);
            setPresetNameDraft("");
          };
          const confirmSavePreset = () => {
            const name = presetNameDraft.trim();
            if (!name) return;
            const values = {
              manualBrightness: config.manualBrightness ?? 0,
              manualContrast: config.manualContrast ?? 0,
              manualExposure: config.manualExposure ?? 0,
              manualHighlights: config.manualHighlights ?? 0,
              manualShadows: config.manualShadows ?? 0,
              manualHue: config.manualHue ?? 0,
              manualSaturation: config.manualSaturation ?? 0,
              manualSharpen: config.manualSharpen ?? 0
            };
            setConfig((c) => ({
              ...c,
              customPresets: [...(c.customPresets || []), { name, values }]
            }));
            setSavingPreset(false);
            setPresetNameDraft("");
          };
          const removeCustomPreset = (index) => {
            setConfig((c) => ({
              ...c,
              customPresets: (c.customPresets || []).filter((_, i) => i !== index)
            }));
          };

          return (
            <>
              <div className="mb-3 flex gap-1.5">
                <button
                  onClick={() => applyFilter("smart")}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                    currentFilter === "smart"
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-base-700 text-slate-400 hover:border-base-600"
                  }`}
                >
                  Smart Enhance
                </button>
                <button
                  onClick={() => applyFilter("manual")}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                    currentFilter === "manual"
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-base-700 text-slate-400 hover:border-base-600"
                  }`}
                >
                  Manual
                </button>
                <button
                  onClick={openSavePreset}
                  disabled={isSmart}
                  title={isSmart ? "Switch to Manual to save current adjustments as a preset" : "Save current adjustments as a preset"}
                  className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-base-700 px-2 py-1.5 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Save className="h-3 w-3" strokeWidth={2.25} />
                  Save as Preset
                </button>
                <button
                  onClick={resetManual}
                  title="Reset tone, color, and detail adjustments"
                  className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-base-700 px-2 py-1.5 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200"
                >
                  <RotateCcw className="h-3 w-3" strokeWidth={2.25} />
                  Reset
                </button>
              </div>

              {savingPreset && (
                <div
                  className="absolute inset-0 z-50 flex justify-center bg-base-950/70 px-4 pt-4 backdrop-blur-sm"
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) cancelSavePreset();
                  }}
                >
                  <div className="h-fit w-80 rounded-2xl border border-base-700 bg-base-900/95 p-4 shadow-2xl">
                    <p className="mb-3 text-sm font-semibold text-slate-100">Save as Preset</p>
                    <input
                      type="text"
                      autoFocus
                      value={presetNameDraft}
                      onChange={(e) => setPresetNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmSavePreset();
                        if (e.key === "Escape") cancelSavePreset();
                      }}
                      placeholder="Preset name…"
                      maxLength={40}
                      className="w-full rounded-lg border border-accent/60 bg-base-950 px-3 py-2 text-sm text-slate-200 placeholder:text-base-600 focus:border-accent focus:outline-none"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        onClick={cancelSavePreset}
                        className="rounded-lg border border-base-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmSavePreset}
                        disabled={!presetNameDraft.trim()}
                        className="rounded-lg border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => setPresetsOpen((o) => !o)}
                className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-base-500 hover:text-slate-300"
                aria-expanded={presetsOpen}
              >
                Presets
                <Chevron open={presetsOpen} />
              </button>

              {presetsOpen && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => applyFilter("vivid")}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      currentFilter === "vivid"
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-base-700 text-slate-400 hover:border-base-600"
                    }`}
                  >
                    Vivid
                  </button>
                  <button
                    onClick={() => applyFilter("bw")}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      currentFilter === "bw"
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-base-700 text-slate-400 hover:border-base-600"
                    }`}
                  >
                    BW
                  </button>
                  {customPresets.map((preset, index) => (
                    <div
                      key={`${preset.name}-${index}`}
                      className="group flex items-center gap-0.5 rounded-lg border border-base-700 pl-2.5 pr-1 py-1 text-xs font-medium text-slate-400 hover:border-base-600"
                    >
                      <button onClick={() => applyCustomPreset(preset)} className="py-0.5 hover:text-slate-200" title={preset.name}>
                        {preset.name}
                      </button>
                      <button
                        onClick={() => removeCustomPreset(index)}
                        title="Delete preset"
                        className="flex-shrink-0 rounded-md p-1 text-base-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {customPresets.length === 0 && (
                    <p className="py-1 text-[11px] text-base-600">No saved presets yet.</p>
                  )}
                </div>
              )}

              {isSmart && (
                <p className="mb-3 text-[11px] text-base-500">
                  Smart Enhance makes image-specific adjustments automatically. Pick Manual, Vivid, or BW to fine-tune by hand.
                </p>
              )}

              <div className={`transition-opacity ${isSmart ? "pointer-events-none opacity-40" : ""}`} aria-disabled={isSmart}>
                <SliderGroupHead icon={Sun} label="Tone" />
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

                <div className="my-4 h-px bg-base-800" />
                <SliderGroupHead icon={Droplet} label="Color" />
                <LabeledSlider label="Hue" value={config.manualHue ?? 0} min={-180} max={180} unit="°" onChange={set("manualHue")} />
                <LabeledSlider
                  label="Saturation"
                  value={config.manualSaturation ?? 0}
                  min={-100}
                  max={100}
                  onChange={set("manualSaturation")}
                />

                <div className="my-4 h-px bg-base-800" />
                <SliderGroupHead icon={Wand2} label="Detail" />
                <LabeledSlider
                  label="Sharpen"
                  value={config.manualSharpen ?? 0}
                  min={0}
                  max={100}
                  onChange={set("manualSharpen")}
                />
              </div>
            </>
          );
        })()}
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