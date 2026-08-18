import React, { useState, useEffect } from "react";
import LabeledSlider from "./LabeledSlider.jsx";
import AngleDial from "./AngleDial.jsx";
import {
  Layers,
  Sparkles,
  Download,
  X,
  Sun,
  Droplet,
  Wand2,
  RotateCcw,
  Save,
  Trash2,
  ChevronLeft,
  ChevronRight,
  BookMarked,
  Lightbulb,
  Waves,
  GripVertical,
  Image as ImageIcon,
  Plus
} from "lucide-react";

const MAX_LOGOS = 10;

// Preset slider values applied instantly when the person picks a one-click
// filter, so Vivid/BW visibly move the Tone/Color/Detail bars to show what
// changed rather than acting as an invisible black box. Smart Enhance has
// no preset — it leaves the bars alone and disables them, since decisions
// are made per-image on the backend instead of from a fixed set of numbers.
const FILTER_PRESETS = {
  vivid: {
    manualTemperature: 0,
    manualTint: 0,
    manualBrightness: 5,
    manualContrast: 15,
    manualExposure: 5,
    manualHighlights: -10,
    manualShadows: 10,
    manualWhites: 5,
    manualBlacks: -5,
    manualHue: 0,
    manualVibrance: 25,
    manualSaturation: 35,
    manualInvert: false,
    manualSharpen: 20,
    manualClarity: 15,
    manualVignette: 0
  },
  bw: {
    manualTemperature: 0,
    manualTint: 0,
    manualBrightness: 0,
    manualContrast: 10,
    manualExposure: 0,
    manualHighlights: -5,
    manualShadows: 5,
    manualWhites: 0,
    manualBlacks: 0,
    manualHue: 0,
    manualVibrance: 0,
    manualSaturation: -100,
    manualInvert: false,
    manualSharpen: 15,
    manualClarity: 10,
    manualVignette: 0
  }
};

function LogoThumb({
  index,
  value,
  onChoose,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDropTarget
}) {
  // file:// image loads are unreliable from the renderer (blocked
  // cross-origin when the page itself is served over http:// in dev, and
  // disallowed by default under contextIsolation), so the thumbnail is
  // fetched from the main process as a small base64 data URL instead.
  const [thumb, setThumb] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setThumb(null);
    if (value && window.api?.getImageThumbnail) {
      window.api.getImageThumbnail(value).then((dataUrl) => {
        if (!cancelled) setThumb(dataUrl);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={value}
      className={`group relative h-16 w-16 flex-shrink-0 cursor-grab touch-none rounded-lg transition-opacity active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <button
        onClick={onChoose}
        className={`flex h-full w-full items-center justify-center overflow-hidden rounded-lg border transition-colors ${
          isDropTarget ? "border-accent" : "border-base-700 hover:border-accent/50"
        }`}
        style={{
          backgroundImage:
            "conic-gradient(#2a2f35 90deg, transparent 90deg 180deg, #2a2f35 180deg 270deg, transparent 270deg)",
          backgroundSize: "8px 8px",
          backgroundColor: "#15181b"
        }}
      >
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : (
          <ImageIcon className="h-5 w-5 text-base-500" strokeWidth={1.75} />
        )}
      </button>

      {/* Order badge */}
      <span className="pointer-events-none absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-base-700 bg-base-900 text-[9px] font-semibold text-base-400">
        {index + 1}
      </span>

      {/* Remove + drag-handle + reorder arrows */}
      <button
        onClick={onRemove}
        title="Remove"
        className="absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full border border-base-700 bg-base-900 text-base-500 hover:border-red-400 hover:text-red-400 group-hover:flex"
      >
        <X className="h-2.5 w-2.5" />
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden items-center justify-between px-0.5 pb-0.5 group-hover:flex">
        <button
          onClick={onMoveUp}
          disabled={!canMoveUp}
          title="Move left"
          className="pointer-events-auto rounded bg-base-900/90 p-0.5 text-base-400 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        <GripVertical className="h-3 w-3 rotate-90 text-base-600" />
        <button
          onClick={onMoveDown}
          disabled={!canMoveDown}
          title="Move right"
          className="pointer-events-auto rounded bg-base-900/90 p-0.5 text-base-400 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

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

function SliderGroupHead({ icon: Icon, label, right }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-1.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-base-500" strokeWidth={2.5} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-base-500">{label}</span>
      </div>
      {right}
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
  onClearLogos,
  onMoveLogoAt,
  onReorderLogo,
  focusSection,
  onFocusSectionHandled
}) {
  const set = (key) => (val) => setConfig((c) => ({ ...c, [key]: val }));
  const logos = config.logos || [];

  const [activeSection, setActiveSection] = useState("watermarks");
  const toggleSection = (id) => setActiveSection((cur) => (cur === id ? null : id));

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

  const [shadowExpanded, setShadowExpanded] = useState(false);
  const [outlineExpanded, setOutlineExpanded] = useState(false);
  const [builtInWatermarksExpanded, setBuiltInWatermarksExpanded] = useState(false);

  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  const [savingPreset, setSavingPreset] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [activeCustomPreset, setActiveCustomPreset] = useState(null);

  const [savingLogoPreset, setSavingLogoPreset] = useState(false);
  const [logoPresetNameDraft, setLogoPresetNameDraft] = useState("");
  const [activeLogoPreset, setActiveLogoPreset] = useState(null);

  const [watermarkPresets, setWatermarkPresets] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadPresets = async () => {
      try {
        const presets = await window.api?.getWatermarkPresets?.();
        if (cancelled) return;

        const presetsWithThumbnails = await Promise.all(
          (presets || []).map(async (preset) => {
            const thumbnail = await window.api?.getImageThumbnail?.(preset.path);
            return {
              ...preset,
              thumbnail
            };
          })
        );

        if (!cancelled) {
          setWatermarkPresets(presetsWithThumbnails);
        }
      } catch (err) {
        console.error("[PRISM] Failed to load watermark presets:", err);
        if (!cancelled) {
          setWatermarkPresets([]);
        }
      }
    };

    loadPresets();

    return () => {
      cancelled = true;
    };
  }, []);

  const addWatermarkPreset = (preset) => {
    if (!preset?.path) return;

    setConfig((c) => {
      const current = c.logos || [];
      if (current.includes(preset.path)) return c;
      if (current.length >= MAX_LOGOS) return c;

      return {
        ...c,
        logos: [...current, preset.path]
      };
    });
  };

  const WATERMARK_DEFAULTS = {
    logoMarginPercent: 1.5,
    logoGapPercent: 12.5,
    logoScalePercent: 12,
    logoOpacityPercent: 100,
    logoShadow: false,
    logoShadowColor: "#000000",
    logoShadowOpacityPercent: 100,
    logoShadowDistancePercent: 5,
    logoShadowAngle: 135,
    logoOutline: false,
    logoOutlineColor: "#ffffff",
    logoOutlineOpacityPercent: 100,
    logoOutlineSizePercent: 3.5
  };
  const WATERMARK_ADJUSTMENT_KEYS = Object.keys(WATERMARK_DEFAULTS);
  const resetWatermarkAdjustments = () => {
    setConfig((c) => ({
      ...c,
      ...WATERMARK_DEFAULTS
    }));
  };
  const showWatermarkResetFooter = activeSection === "watermarks";

  const [enhTab, setEnhTab] = useState(null);

  const MANUAL_ZEROED = {
    manualTemperature: 0,
    manualTint: 0,
    manualBrightness: 0,
    manualContrast: 0,
    manualExposure: 0,
    manualHighlights: 0,
    manualShadows: 0,
    manualWhites: 0,
    manualBlacks: 0,
    manualHue: 0,
    manualVibrance: 0,
    manualSaturation: 0,
    manualInvert: false,
    manualSharpen: 0,
    manualClarity: 0,
    manualVignette: 0
  };
  const currentFilter = config.enhancementFilter || "smart";
  const isSmart = currentFilter === "smart";
  const effectiveTab = enhTab || (isSmart ? "smart" : "manual");
  const resetManual = () => {
    setConfig((c) => ({
      ...c,
      ...MANUAL_ZEROED
    }));
  };
  const showManualResetFooter = activeSection === "enhancement" && effectiveTab === "manual";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-5 border-b border-base-800 bg-base-900 px-4 pt-4">
        <SectionTab
          title="Watermarks"
          icon={Layers}
          badge={`${logos.length}/${MAX_LOGOS}`}
          active={activeSection === "watermarks"}
          onClick={() => toggleSection("watermarks")}
          pulse={pulseSection === "watermarks"}
        />
        <SectionTab
          title="Adjustments"
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

      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-5 [scrollbar-gutter:stable]">
        {activeSection === "watermarks" && (
          <div className="pb-5">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-300">Watermarks</label>
              {logos.length > 0 && (
                <button
                  onClick={onClearLogos}
                  title="Remove all watermarks"
                  className="text-[11px] font-medium text-base-500 hover:text-red-400"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="mb-4 flex flex-wrap gap-3">
              {logos.map((logoPath, index) => (
                <LogoThumb
                  key={index}
                  index={index}
                  value={logoPath}
                  onChoose={() => onChooseLogoAt(index)}
                  onRemove={() => onRemoveLogoAt(index)}
                  onMoveUp={() => onMoveLogoAt(index, -1)}
                  onMoveDown={() => onMoveLogoAt(index, 1)}
                  canMoveUp={index > 0}
                  canMoveDown={index < logos.length - 1}
                  isDragging={dragIndex === index}
                  isDropTarget={dropIndex === index && dragIndex !== null && dragIndex !== index}
                  onDragStart={(e) => {
                    setDragIndex(index);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(index));
                  }}
                  onDragOver={(e) => {
                    if (dragIndex === null || dragIndex === index) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropIndex(index);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragIndex !== index) onReorderLogo?.(dragIndex, index);
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                />
              ))}

              {logos.length < MAX_LOGOS && (
                <button
                  onClick={onAddLogo}
                  title="Add Watermark"
                  className="flex h-16 w-16 flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-base-700 text-base-500 hover:border-accent/60 hover:text-accent"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.25} />
                  <span className="text-[10px] font-medium">Add</span>
                </button>
              )}
            </div>

            {/* Built-in watermark presets */}
            <div className="mb-4">
              <div
                onClick={() => setBuiltInWatermarksExpanded((open) => !open)}
                role="button"
                tabIndex={0}
                aria-expanded={builtInWatermarksExpanded}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setBuiltInWatermarksExpanded((open) => !open);
                  }
                }}
                title={builtInWatermarksExpanded ? "Hide built-in watermarks" : "Show built-in watermarks"}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md"
              >
                <span
                  className={`leading-none text-xs font-semibold ${
                    builtInWatermarksExpanded ? "text-accent" : "text-slate-300"
                  }`}
                >
                  Built-in Watermarks
                </span>
                <span className="flex-shrink-0 text-base-500">
                  <Chevron open={builtInWatermarksExpanded} />
                </span>
              </div>

              {builtInWatermarksExpanded && (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {watermarkPresets.map((preset) => {
                    const selected = logos.includes(preset.path);
                    return (
                      <button
                        key={preset.path}
                        type="button"
                        onClick={() => addWatermarkPreset(preset)}
                        disabled={selected || logos.length >= MAX_LOGOS}
                        title={selected ? `${preset.name} selected` : `Add ${preset.name}`}
                        className={`flex h-20 flex-col items-center justify-center rounded-lg border bg-base-900 p-1 transition ${
                          selected ? "border-accent/60 opacity-50" : "border-base-700 hover:border-accent/60"
                        }`}
                      >
                        <div className="flex h-12 w-full items-center justify-center">
                          {preset.thumbnail ? (
                            <img
                              src={preset.thumbnail}
                              alt={preset.name}
                              className="max-h-11 max-w-full object-contain"
                              draggable={false}
                            />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-base-500" />
                          )}
                        </div>
                        <span className="mt-1 w-full truncate text-center text-[9px] text-base-300">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {(() => {
              const logoPresets = config.logoPresets || [];

              const openSaveLogoPreset = () => {
                setLogoPresetNameDraft("");
                setSavingLogoPreset(true);
              };
              const cancelSaveLogoPreset = () => {
                setSavingLogoPreset(false);
                setLogoPresetNameDraft("");
              };
              const confirmSaveLogoPreset = () => {
                const name = logoPresetNameDraft.trim();
                if (!name || logos.length === 0) return;
                const adjustments = {};
                for (const key of WATERMARK_ADJUSTMENT_KEYS) adjustments[key] = config[key];
                setConfig((c) => ({
                  ...c,
                  logoPresets: [...(c.logoPresets || []), { name, logos: [...(c.logos || [])], adjustments }]
                }));
                setActiveLogoPreset(name);
                setSavingLogoPreset(false);
                setLogoPresetNameDraft("");
              };
              const applyLogoPreset = (preset) => {
                setActiveLogoPreset(preset.name);
                setConfig((c) => ({ ...c, logos: [...preset.logos], ...(preset.adjustments || {}) }));
              };
              const removeLogoPreset = (index) => {
                setConfig((c) => ({
                  ...c,
                  logoPresets: (c.logoPresets || []).filter((_, i) => i !== index)
                }));
              };

              return (
                <div className="mb-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-xs font-medium text-slate-300">Watermark Presets</label>
                    <button
                      onClick={openSaveLogoPreset}
                      disabled={logos.length === 0}
                      title={logos.length === 0 ? "Add at least one watermark first" : "Save this set of watermarks and its order"}
                      className="flex items-center gap-1 rounded-lg border border-base-700 px-2 py-1 text-[11px] font-medium text-slate-400 hover:border-base-600 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Save className="h-3 w-3" strokeWidth={2.25} />
                      Save Current
                    </button>
                  </div>

                  {savingLogoPreset && (
                    <div
                      className="absolute inset-0 z-50 flex justify-center bg-base-950/70 px-4 pt-4 backdrop-blur-sm"
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) cancelSaveLogoPreset();
                      }}
                    >
                      <div className="h-fit w-80 rounded-2xl border border-base-700 bg-base-900/95 p-4 shadow-2xl">
                        <p className="mb-3 text-sm font-semibold text-slate-100">Save Watermark Preset</p>
                        <input
                          type="text"
                          autoFocus
                          value={logoPresetNameDraft}
                          onChange={(e) => setLogoPresetNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") confirmSaveLogoPreset();
                            if (e.key === "Escape") cancelSaveLogoPreset();
                          }}
                          placeholder="Preset name…"
                          maxLength={40}
                          className="w-full rounded-lg border border-accent/60 bg-base-950 px-3 py-2 text-sm text-slate-200 placeholder:text-base-600 focus:border-accent focus:outline-none"
                        />
                        <p className="mt-2 text-[11px] text-base-500">
                          Saves the {logos.length} current watermark{logos.length === 1 ? "" : "s"} and their stacking order.
                        </p>
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            onClick={cancelSaveLogoPreset}
                            className="rounded-lg border border-base-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={confirmSaveLogoPreset}
                            disabled={!logoPresetNameDraft.trim()}
                            className="rounded-lg border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {logoPresets.map((preset, index) => (
                      <div
                        key={`${preset.name}-${index}`}
                        className={`group flex items-center gap-0.5 rounded-full border pl-2.5 pr-1 py-1 text-xs font-medium hover:border-base-600 ${
                          activeLogoPreset === preset.name
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-base-700 text-slate-400"
                        }`}
                      >
                        <button
                          onClick={() => applyLogoPreset(preset)}
                          className="py-0.5 hover:text-slate-200"
                          title={`${preset.name} — ${preset.logos.length} watermark${preset.logos.length === 1 ? "" : "s"}`}
                        >
                          {preset.name}
                        </button>
                        <button
                          onClick={() => {
                            if (activeLogoPreset === preset.name) setActiveLogoPreset(null);
                            removeLogoPreset(index);
                          }}
                          title="Delete preset"
                          className="flex-shrink-0 rounded-md p-1 text-base-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {logoPresets.length === 0 && (
                      <p className="py-1 text-[11px] text-base-600">
                        No saved watermark presets yet — add watermarks above, then "Save Current".
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Position</label>
              {(() => {
                const corners = [
                  { key: "top-left", label: "Upper Left", cls: "top-1.5 left-1.5" },
                  { key: "top", label: "Top", cls: "top-1.5 left-1/2 -translate-x-1/2" },
                  { key: "top-right", label: "Upper Right", cls: "top-1.5 right-1.5" },
                  { key: "left", label: "Left", cls: "top-1/2 left-1.5 -translate-y-1/2" },
                  { key: "center", label: "Center", cls: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" },
                  { key: "right", label: "Right", cls: "top-1/2 right-1.5 -translate-y-1/2" },
                  { key: "bottom-left", label: "Lower Left", cls: "bottom-1.5 left-1.5" },
                  { key: "bottom", label: "Bottom", cls: "bottom-1.5 left-1/2 -translate-x-1/2" },
                  { key: "bottom-right", label: "Lower Right", cls: "bottom-1.5 right-1.5" }
                ];
                const current = config.logoPosition || "bottom-right";
                return (
                  <div className="flex items-center gap-4">
                    <div className="relative h-20 w-24 flex-shrink-0 rounded-lg border border-base-700 bg-base-950">
                      {corners.map((c) => (
                        <button
                          key={c.key}
                          onClick={() => set("logoPosition")(c.key)}
                          title={c.label}
                          aria-label={c.label}
                          className={`absolute h-5 w-5 rounded-sm border transition-colors ${c.cls} ${
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

            <div className={config.logoPosition === "center" ? "pointer-events-none opacity-40" : ""}>
              <LabeledSlider
                label="Distance from corner"
                value={config.logoMarginPercent}
                min={0}
                max={10}
                step={0.5}
                onChange={set("logoMarginPercent")}
              />
            </div>
            <div className={logos.length < 2 ? "pointer-events-none opacity-40" : ""}>
              <LabeledSlider
                label="Distance between watermarks"
                value={config.logoGapPercent}
                min={0}
                max={50}
                step={1}
                onChange={set("logoGapPercent")}
              />
            </div>
            <LabeledSlider label="Watermark size" value={config.logoScalePercent} min={2} max={40} onChange={set("logoScalePercent")} />
            <LabeledSlider label="Watermark opacity" value={config.logoOpacityPercent} min={0} max={100} onChange={set("logoOpacityPercent")} />

            <div className="my-4 h-px bg-base-800" />

            <div className="mb-3">
              <div
                onClick={() => setShadowExpanded((o) => !o)}
                role="button"
                tabIndex={0}
                aria-expanded={shadowExpanded}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setShadowExpanded((o) => !o);
                  }
                }}
                title={shadowExpanded ? "Hide shadow options" : "Show shadow options"}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className={`leading-none text-xs font-semibold ${config.logoShadow ? "text-accent" : "text-slate-300"}`}>
                    Shadow
                  </span>
                  <span
                    className="flex items-center"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <SwitchPill
                      on={!!config.logoShadow}
                      onToggle={() => set("logoShadow")(!config.logoShadow)}
                      label="Toggle shadow"
                    />
                  </span>
                </div>
                <span className="flex-shrink-0 text-base-500">
                  <Chevron open={shadowExpanded} />
                </span>
              </div>

              {shadowExpanded && (
                <div
                  className={`mt-3 space-y-3 transition-opacity ${
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

            <div className="my-4 h-px bg-base-800" />

            <div className="mb-1">
              <div
                onClick={() => setOutlineExpanded((o) => !o)}
                role="button"
                tabIndex={0}
                aria-expanded={outlineExpanded}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOutlineExpanded((o) => !o);
                  }
                }}
                title={outlineExpanded ? "Hide outline options" : "Show outline options"}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className={`leading-none text-xs font-semibold ${config.logoOutline ? "text-accent" : "text-slate-300"}`}>
                    Outline
                  </span>
                  <span
                    className="flex items-center"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <SwitchPill
                      on={!!config.logoOutline}
                      onToggle={() => set("logoOutline")(!config.logoOutline)}
                      label="Toggle outline"
                    />
                  </span>
                </div>
                <span className="flex-shrink-0 text-base-500">
                  <Chevron open={outlineExpanded} />
                </span>
              </div>

              {outlineExpanded && (
                <div
                  className={`mt-3 space-y-3 transition-opacity ${
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
                    max={10}
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
              const customPresets = config.customPresets || [];

              const applyFilter = (key) => {
                setActiveCustomPreset(null);
                setConfig((c) => ({
                  ...c,
                  enhancementFilter: key,
                  enhancementMode: key === "smart" ? "auto" : "manual",
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
                  manualTemperature: config.manualTemperature ?? 0,
                  manualTint: config.manualTint ?? 0,
                  manualBrightness: config.manualBrightness ?? 0,
                  manualContrast: config.manualContrast ?? 0,
                  manualExposure: config.manualExposure ?? 0,
                  manualHighlights: config.manualHighlights ?? 0,
                  manualShadows: config.manualShadows ?? 0,
                  manualWhites: config.manualWhites ?? 0,
                  manualBlacks: config.manualBlacks ?? 0,
                  manualHue: config.manualHue ?? 0,
                  manualVibrance: config.manualVibrance ?? 0,
                  manualSaturation: config.manualSaturation ?? 0,
                  manualInvert: config.manualInvert ?? false,
                  manualSharpen: config.manualSharpen ?? 0,
                  manualClarity: config.manualClarity ?? 0,
                  manualVignette: config.manualVignette ?? 0
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
                { key: "smart", label: "Smart Adjust", icon: Sparkles },
                { key: "presets", label: "Presets", icon: BookMarked },
                { key: "manual", label: "Manual", icon: Wand2 }
              ];

              const selectTab = (key) => {
                setEnhTab(key);
                if (key === "smart" || key === "manual") applyFilter(key);
              };

              return (
                <>
                  <div className="mb-4 grid grid-cols-3 gap-1.5 overflow-hidden rounded-full border border-base-800 bg-base-950 p-1">
                    {MODE_TABS.map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        onClick={() => selectTab(key)}
                        className={`flex items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-semibold transition-colors ${
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
                    <div className="flex flex-col items-center gap-2 rounded-2xl border border-base-800 px-4 py-8 text-center">
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
                      <div className="mb-3">
                        <p className="text-xs text-base-500">Apply a look, or save a new one.</p>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => applyFilter("vivid")}
                          className={`rounded-full border px-10 py-1.5 text-xs font-medium transition-colors ${
                            currentFilter === "vivid"
                              ? "border-accent bg-accent/15 text-accent"
                              : "border-base-700 text-slate-400 hover:border-base-600"
                          }`}
                        >
                          Vivid
                        </button>
                        <button
                          onClick={() => applyFilter("bw")}
                          className={`rounded-full border px-10 py-1.5 text-xs font-medium transition-colors ${
                            currentFilter === "bw"
                              ? "border-accent bg-accent/15 text-accent"
                              : "border-base-700 text-slate-400 hover:border-base-600"
                          }`}
                        >
                          B/W
                        </button>
                        {customPresets.map((preset, index) => (
                          <div
                            key={`${preset.name}-${index}`}
                            className={`group flex items-center gap-0.5 rounded-full border pl-2.5 pr-1 py-1 text-xs font-medium hover:border-base-600 ${
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
                        <button
                          onClick={openSavePreset}
                          className="flex w-[148px] flex-shrink-0 items-center justify-center gap-1 rounded-lg border border-base-700 px-2 py-1 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200"
                        >
                          <Save className="h-3 w-3" strokeWidth={2.25} />
                          Save as Preset
                        </button>
                      </div>

                      <SliderGroupHead icon={Lightbulb} label="White Balance" />
                      <LabeledSlider
                        label="Temperature"
                        value={config.manualTemperature ?? 0}
                        min={-100}
                        max={100}
                        onChange={set("manualTemperature")}
                      />
                      <LabeledSlider
                        label="Tint"
                        value={config.manualTint ?? 0}
                        min={-100}
                        max={100}
                        onChange={set("manualTint")}
                      />

                      <div className="my-4 h-px bg-base-800" />
                      <SliderGroupHead icon={Sun} label="Light" />
                      <LabeledSlider
                        label="Brightness"
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
                        label="Whites"
                        value={config.manualWhites ?? 0}
                        min={-100}
                        max={100}
                        onChange={set("manualWhites")}
                      />
                      <LabeledSlider
                        label="Blacks"
                        value={config.manualBlacks ?? 0}
                        min={-100}
                        max={100}
                        onChange={set("manualBlacks")}
                      />

                      <div className="my-4 h-px bg-base-800" />
                      <SliderGroupHead
                        icon={Droplet}
                        label="Color"
                        right={
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-base-500">Invert</span>
                            <SwitchPill
                              on={!!config.manualInvert}
                              onToggle={() => set("manualInvert")(!config.manualInvert)}
                              label="Toggle invert"
                            />
                          </div>
                        }
                      />
                      <LabeledSlider label="Hue" value={config.manualHue ?? 0} min={-180} max={180} unit="°" onChange={set("manualHue")} />
                      <LabeledSlider
                        label="Vibrance"
                        value={config.manualVibrance ?? 0}
                        min={-100}
                        max={100}
                        onChange={set("manualVibrance")}
                      />
                      <LabeledSlider
                        label="Saturation"
                        value={config.manualSaturation ?? 0}
                        min={-100}
                        max={100}
                        onChange={set("manualSaturation")}
                      />

                      <div className="my-4 h-px bg-base-800" />
                      <SliderGroupHead icon={Waves} label="Texture" />
                      <LabeledSlider
                        label="Sharpness"
                        value={config.manualSharpen ?? 0}
                        min={0}
                        max={100}
                        onChange={set("manualSharpen")}
                      />
                      <LabeledSlider
                        label="Clarity"
                        value={config.manualClarity ?? 0}
                        min={-100}
                        max={100}
                        onChange={set("manualClarity")}
                      />
                      <LabeledSlider
                        label="Vignette"
                        value={config.manualVignette ?? 0}
                        min={-100}
                        max={100}
                        onChange={set("manualVignette")}
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
                    className={`flex-1 rounded-full border px-2 py-1.5 text-xs font-medium transition-colors ${
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
                    className={`flex-1 rounded-full border px-2 py-1.5 text-xs font-medium transition-colors ${
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

      {showManualResetFooter && (
        <div className="flex-shrink-0 border-t border-base-800 bg-base-900 px-4 py-3">
          <button
            onClick={resetManual}
            title="Reset tone, color, and detail adjustments"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-base-700 px-2 py-2 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={2.25} />
            Reset
          </button>
        </div>
      )}

      {showWatermarkResetFooter && (
        <div className="flex-shrink-0 border-t border-base-800 bg-base-900 px-4 py-3">
          <button
            onClick={resetWatermarkAdjustments}
            title="Reset watermark placement and appearance to defaults"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-base-700 px-2 py-2 text-xs font-medium text-slate-400 hover:border-base-600 hover:text-slate-200"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={2.25} />
            Reset
          </button>
        </div>
      )}
    </div>
  );
}