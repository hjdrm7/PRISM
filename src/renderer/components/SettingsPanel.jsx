import React, { useState, useEffect } from "react";
import LabeledSlider from "./LabeledSlider.jsx";
import AngleDial from "./AngleDial.jsx";
import { Layers, Sparkles, Download, X, Sun, Droplet, Wand2, RotateCcw, Save, Trash2, ChevronUp, ChevronDown, BookMarked } from "lucide-react";

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

function LogoRow({ index, value, onChoose, onRemove, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  const filename = value ? value.split(/[/\\]/).pop() : "";
  return (
    <div className="mb-3">
      <label className="mb-1.5 block text-xs font-medium text-slate-300">Logo {index + 1}</label>
      <div className="flex items-center gap-2">
        <div className="flex flex-shrink-0 flex-col">
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="Move up"
            className="rounded-t-md border border-b-0 border-base-700 px-1 py-0.5 text-base-500 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-base-500"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="Move down"
            className="rounded-b-md border border-base-700 px-1 py-0.5 text-base-500 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-base-500"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
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
function SectionTab({ title, icon: Icon, badge, active, onClick, pulse, dot }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-1.5 whitespace-nowrap pb-2.5 pr-1 pt-1 text-left transition-colors ${
        active ? "text-accent" : "text-base-500 hover:text-slate-300"
      } ${pulse ? "animate-pulse" : ""}`}
      aria-expanded={active}
    >
      <span className="relative">
        <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
        {dot && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" title="Configured" />
        )}
      </span>
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

export default function SettingsPanel({
  config,
  setConfig,
  onChooseOutputFolder,
  onAddLogo,
  onChooseLogoAt,
  onRemoveLogoAt,
  onMoveLogoAt,
  focusSection,
  onFocusSectionHandled
}) {
  const set = (key) => (val) => setConfig((c) => ({ ...c, [key]: val }));
  const logos = config.logos || [];

  // Only one section is open at a time — the tab row stays put and the
  // content below swaps, rather than every section's content stacking.
  // Watermarks is open by default so the panel isn't empty on launch —
  // the person can still collapse it or switch to another section.
  const [activeSection, setActiveSection] = useState("watermarks");
  const toggleSection = (id) => setActiveSection((cur) => (cur === id ? null : id));

  // When App.jsx points us at a section after a validation error (e.g.
  // "select an output folder" before starting a batch), jump the tab row
  // there and briefly pulse it so the person's eye lands on the right
  // control instead of just reading the toast and looking around.
  const [pulseSection, setPulseSection] = useState(null);
  useEffect(() => {
    if (!focusSection) return;
    setActiveSection(focusSection);
    setPulseSection(focusSection);
    const timer = setTimeout(() => setPulseSection(null), 1200);
    onFocusSectionHandled?.();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSection]);

  // Shadow/outline options can be collapsed independently of their On/Off
  // toggle, so turning an effect on doesn't force its panel to stay open —
  // the person can hide the options while leaving the effect enabled.
  const [shadowExpanded, setShadowExpanded] = useState(true);
  const [outlineExpanded, setOutlineExpanded] = useState(true);

  // Presets row (Vivid/BW plus any user-saved presets) gets its own boxed,
  // accent-tinted container and starts open, since presets are a primary
  // way to apply a look rather than a secondary/advanced option.
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  // Tracks which saved preset (by name) was most recently applied, purely
  // so the Presets row can highlight it like Vivid/BW/Smart highlight
  // themselves — this is a session-only convenience, not persisted.
  const [activeCustomPreset, setActiveCustomPreset] = useState(null);

  // Which of the three enhancement views (Smart / Presets / Manual) is
  // showing. Distinct from config.enhancementFilter/enhancementMode —
  // those describe what the processing pipeline actually does, this is
  // purely "what's on screen right now". Until the person clicks a tab
  // themselves, it tracks the underlying filter so the panel opens on
  // whatever's actually active; once they've clicked, it stays put (e.g.
  // browsing Presets doesn't get yanked back to Manual just because a
  // slider underneath hasn't changed).
  const [enhTab, setEnhTab] = useState(null);

  return (
    <div className="relative">
      <div className="mb-5 flex items-center gap-5 border-b border-base-800">
        <SectionTab
          title="Watermarks"
          icon={Layers}
          badge={`${logos.length}/${MAX_LOGOS}`}
          active={activeSection === "watermarks"}
          onClick={() => toggleSection("watermarks")}
          pulse={pulseSection === "watermarks"}
        />
        <SectionTab
          title="Enhancement"
          icon={Sparkles}
          active={activeSection === "enhancement"}
          onClick={() => toggleSection("enhancement")}
          pulse={pulseSection === "enhancement"}
        />
        <SectionTab
          title="Output"
          icon={Download}
          active={activeSection === "output"}
          onClick={() => toggleSection("output")}
          pulse={pulseSection === "output"}
          dot={!!config.outputFolder}
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
            onMoveUp={() => onMoveLogoAt(index, -1)}
            onMoveDown={() => onMoveLogoAt(index, 1)}
            canMoveUp={index > 0}
            canMoveDown={index < logos.length - 1}
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
            setActiveCustomPreset(null);
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
            setActiveCustomPreset(preset.name);
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
          const effectiveTab = enhTab || (isSmart ? "smart" : "manual");

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

          const MODE_TABS = [
            { key: "smart", label: "Smart Enhance", icon: Sparkles },
            { key: "presets", label: "Presets", icon: BookMarked },
            { key: "manual", label: "Manual", icon: Wand2 }
          ];

          const selectTab = (key) => {
            setEnhTab(key);
            // Smart and Manual are actual pipeline modes, so picking their
            // tab also switches processing — Presets is just a browser/
            // manager for looks and doesn't change anything by itself
            // until a specific preset inside it is clicked.
            if (key === "smart" || key === "manual") applyFilter(key);
          };

          return (
            <>
              <div className="mb-4 grid grid-cols-3 gap-1.5 overflow-hidden rounded-xl2 border border-base-800 bg-base-950 p-1">
                {MODE_TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => selectTab(key)}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition-colors ${
                      effectiveTab === key
                        ? "bg-accent/15 text-accent"
                        : "text-slate-400 hover:bg-base-800 hover:text-slate-200"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
                    {label}
                  </button>
                ))}
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

              {effectiveTab === "smart" && (
                <div className="flex flex-col items-center gap-2 rounded-xl2 border border-base-800 px-4 py-8 text-center">
                  <Sparkles className="h-6 w-6 text-accent" strokeWidth={1.75} />
                  <p className="text-sm font-semibold text-slate-100">PRISM decides, per photo</p>
                  <p className="max-w-[22rem] text-xs text-base-500">
                    Auto-exposure, white balance, local contrast, noise reduction, saturation, and sharpening are all
                    tuned automatically for each image — there's nothing to adjust here. Switch to Presets for a
                    one-click look, or Manual to fine-tune every value by hand.
                  </p>
                </div>
              )}

              {effectiveTab === "presets" && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs text-base-500">Apply a look, or save your current Manual adjustments as a new one.</p>
                    <button
                      onClick={openSavePreset}
                      disabled={isSmart}
                      title={isSmart ? "Switch to Manual to save current adjustments as a preset" : "Save current adjustments as a preset"}
                      className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-base-700 px-2 py-1 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Save className="h-3 w-3" strokeWidth={2.25} />
                      Save Current
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 rounded-xl2 border border-base-800 p-3">
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
                        className={`group flex items-center gap-0.5 rounded-lg border pl-2.5 pr-1 py-1 text-xs font-medium hover:border-base-600 ${
                          activeCustomPreset === preset.name
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-base-700 text-slate-400"
                        }`}
                      >
                        <button onClick={() => applyCustomPreset(preset)} className="py-0.5 hover:text-slate-200" title={preset.name}>
                          {preset.name}
                        </button>
                        <button
                          onClick={() => {
                            if (activeCustomPreset === preset.name) setActiveCustomPreset(null);
                            removeCustomPreset(index);
                          }}
                          title="Delete preset"
                          className="flex-shrink-0 rounded-md p-1 text-base-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {customPresets.length === 0 && (
                      <p className="py-1 text-[11px] text-base-600">No saved presets yet — adjust sliders in Manual, then "Save Current".</p>
                    )}
                  </div>

                  {(currentFilter === "vivid" || currentFilter === "bw" || activeCustomPreset) && (
                    <p className="mt-2 text-[11px] text-base-500">
                      Applied — switch to Manual to fine-tune these values further.
                    </p>
                  )}
                </div>
              )}

              {effectiveTab === "manual" && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs text-base-500">Tone, color, and detail — adjust freely.</p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={openSavePreset}
                        className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-base-700 px-2 py-1 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200"
                      >
                        <Save className="h-3 w-3" strokeWidth={2.25} />
                        Save as Preset
                      </button>
                      <button
                        onClick={resetManual}
                        title="Reset tone, color, and detail adjustments"
                        className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-base-700 px-2 py-1 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200"
                      >
                        <RotateCcw className="h-3 w-3" strokeWidth={2.25} />
                        Reset
                      </button>
                    </div>
                  </div>

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
              )}
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