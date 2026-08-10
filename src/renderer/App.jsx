import React, { useState, useEffect, useCallback, useRef } from "react";
import ImageQueue from "./components/ImageQueue.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import CompareSlider from "./components/CompareSlider.jsx";
import { CheckCircle2, AlertTriangle, StopCircle, X, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import logo from "./assets/prism-logo.png";
import logoType from "./assets/prism-typo.png";

const MAX_LOGOS = 10;

// Best-effort "directory of this path" for use as a picker's default
// location. Doesn't need to be fully correct for every edge case (UNC
// paths, trailing slashes, etc.) — worst case a stale/odd value just
// falls back to Electron's own default, same as passing nothing.
function dirOf(filePath) {
  if (!filePath) return "";
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx > 0 ? filePath.slice(0, idx) : "";
}

const DEFAULT_CONFIG = {
  inputFolder: "",
  inputMode: "folder", // "folder" | "image"
  outputFolder: "",
  outputFormat: "original", // "original" | "jpeg" | "png"
  lastImageFolder: "",
  lastLogoFolder: "",
  logos: [],
  logoPresets: [],
  logoPosition: "bottom-right",
  logoMarginPercent: 1.5,
  logoGapPercent: 12.5,
  logoScalePercent: 12,
  logoOpacityPercent: 100,
  logoShadow: false,
  logoShadowColor: "#000000",
  logoShadowOpacityPercent: 100,
  logoOutline: false,
  logoOutlineColor: "#ffffff",
  logoOutlineOpacityPercent: 100,
  logoOutlineSizePercent: 3.5,
  logoShadowDistancePercent: 5,
  logoShadowAngle: 135,
  enhancementFilter: "smart", // "smart" | "manual" | "vivid" | "bw"
  enhancementIntensity: 60, // used internally by Smart Enhance; no UI slider anymore
  customPresets: [], // user-saved manual presets: [{ name, values: { manualHue, manualSaturation, ... } }]
  manualTemperature: 0,
  manualTint: 0,
  manualHue: 0,
  manualVibrance: 0,
  manualSaturation: 0,
  manualBrightness: 0,
  manualContrast: 0,
  manualExposure: 0,
  manualHighlights: 0,
  manualShadows: 0,
  manualWhites: 0,
  manualBlacks: 0,
  manualInvert: false,
  manualSharpen: 0,
  manualClarity: 0,
  manualVignette: 0,
  jpegQuality: 97,
  filenameSuffix: "",
  collisionStrategy: "rename"
};

export default function App() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [preview, setPreview] = useState({ before: null, after: null });
  const [previewLoading, setPreviewLoading] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, filename: "" });
  const [status, setStatus] = useState("Ready.");
  const [summary, setSummary] = useState(null);
  const [toast, setToast] = useState(null); // { type: "error", message } — validation/preview errors only
  const [resultBanner, setResultBanner] = useState(null); // { type: "success" | "error" | "cancelled", message } — shown in the overlay card after a batch finishes
  const [updateInfo, setUpdateInfo] = useState(null); // { latestVersion, url } — set when a newer GitHub release exists
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [focusSection, setFocusSection] = useState(null); // briefly points SettingsPanel at a tab after a validation error

  // Keyboard shortcuts: [ / ] toggle the left/right panels, matching the
  // chevron buttons already in the UI. Ignored while typing in a text
  // field, number field, or color picker so it doesn't fire mid-edit
  // (e.g. typing a filename suffix that happens to contain "[").
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (e.key === "[") setLeftPanelOpen((o) => !o);
      if (e.key === "]") setRightPanelOpen((o) => !o);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const previewDebounce = useRef(null);
  // Preview requests are serialized: only one runs against the backend at a
  // time. If the user clicks through several images while a preview is
  // still processing, we don't queue every click — we keep only the most
  // recent request and drop the rest, so we never pile up sharp jobs for
  // images the user has already moved past (which was causing the lag).
  const previewRequestId = useRef(0);
  const previewInFlight = useRef(false);
  const pendingPreviewRequest = useRef(null);

  const toastTimer = useRef(null);
  const resultBannerTimer = useRef(null);
  const showToast = useCallback((type, message) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), type === "success" ? 4000 : 6000);
  }, []);
  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (resultBannerTimer.current) clearTimeout(resultBannerTimer.current);
  }, []);

  // Load saved settings on launch
  useEffect(() => {
    (async () => {
      const saved = await window.api.loadSettings();
      if (saved.inputMode === "single") saved.inputMode = "image"; // legacy value
      setConfig((c) => ({ ...c, ...saved }));
      if (saved.inputFolder) {
        const found = await window.api.listImages(saved.inputFolder);
        setImages(found);
      }
    })();
  }, []);

  // Check GitHub for a newer release once on launch. Silent on failure
  // (no network, rate-limited, etc.) since this is a nice-to-have, not
  // something that should ever interrupt or error out the app.
  useEffect(() => {
    (async () => {
      try {
        const result = await window.api.checkForUpdates();
        if (result?.ok && result.available) {
          setUpdateInfo({ latestVersion: result.latestVersion, url: result.url });
        }
      } catch {
        // ignore — update checks are best-effort
      }
    })();
  }, []);

  const onOpenReleasePage = useCallback(() => {
    if (updateInfo?.url) window.api.openExternal(updateInfo.url);
  }, [updateInfo]);

  // Save settings whenever config changes (debounced-ish via effect)
  useEffect(() => {
    window.api.saveSettings(config);
  }, [config]);

  // Progress listener — fires both when a worker starts a file ("processing")
  // and when it finishes (success/failed/skipped/cancelled), so the overlay
  // can show live activity between completions, not just jump at each done tick.
  useEffect(() => {
    const unsubscribe = window.api.onProgress(({ done, total, filename, status }) => {
      setProgress({ done, total, filename });
      setStatus(
        status === "processing"
          ? `Processing ${done + 1}/${total}: ${filename}`
          : `Processing ${done}/${total}: ${filename}`
      );
    });
    return unsubscribe;
  }, []);

  // Merge new paths into the existing queue, preserving order and
  // dropping duplicates — used by "image" mode, where the queue is meant
  // to accumulate images added across multiple browses/drops, potentially
  // from different folders.
  const appendImages = useCallback((additions) => {
    // Defensive: `additions` should always be an array of paths. If a
    // single path string ever slips through (e.g. an IPC handler
    // returning a bare string instead of an array), iterating it directly
    // would split it into individual characters — wrap it instead.
    const list = Array.isArray(additions) ? additions : additions ? [additions] : [];
    if (!list.length) return;
    setImages((prev) => {
      const seen = new Set(prev);
      const merged = [...prev];
      for (const p of list) {
        if (!seen.has(p)) {
          merged.push(p);
          seen.add(p);
        }
      }
      return merged;
    });
    setSelectedImage((prev) => prev || list[0]);
  }, []);

  // "Folder" mode: selecting a folder (or a lone file dropped while in
  // folder mode) replaces the whole queue with that folder's contents.
  const loadFolder = useCallback(async (targetPath) => {
    const found = await window.api.listImages(targetPath);
    setConfig((c) => ({ ...c, inputFolder: targetPath }));
    setImages(found);
    setSelectedImage(found[0] || null);
    if (!found.length) {
      showToast("error", "No supported JPG/JPEG/PNG image(s) were found at that location.");
    }
  }, [showToast]);

  const onChooseFolder = useCallback(async () => {
    // Defaults to whatever folder is currently loaded, so re-opening the
    // picker (e.g. to switch to a sibling folder) starts from there
    // instead of the OS default location every time.
    const folder = await window.api.chooseFolder(config.inputFolder || undefined);
    if (folder) await loadFolder(folder);
  }, [loadFolder, config.inputFolder]);

  // "Image" mode: the picker supports multi-select, and every choice is
  // added to the existing queue rather than replacing it, so images from
  // different folders can accumulate together.
  const onChooseImages = useCallback(async () => {
    const files = await window.api.chooseInputImage(config.lastImageFolder || undefined);
    if (files && files.length) {
      appendImages(files);
      setConfig((c) => ({ ...c, lastImageFolder: dirOf(files[0]) || c.lastImageFolder }));
    }
  }, [appendImages, config.lastImageFolder]);

  // Drag-and-drop can hand us any mix of files and/or folders. In folder
  // mode we only ever care about the first dropped path (folder or lone
  // file), matching the single-target browse flow. In image mode every
  // dropped path is resolved (a folder drop is expanded to its images)
  // and the results are appended to the queue.
  const onDropPaths = useCallback(
    async (paths) => {
      if (!paths || !paths.length) return;
      if (config.inputMode === "folder") {
        await loadFolder(paths[0]);
        return;
      }
      const resultLists = await Promise.all(paths.map((p) => window.api.listImages(p)));
      const combined = resultLists.flat();
      if (!combined.length) {
        showToast("error", "No supported JPG/JPEG/PNG image(s) were found at that location.");
        return;
      }
      appendImages(combined);
    },
    [config.inputMode, loadFolder, appendImages, showToast]
  );

  const onRemoveImage = useCallback((path) => {
    setImages((prev) => prev.filter((p) => p !== path));
    setSelectedImage((prev) => (prev === path ? null : prev));
  }, []);

  const onModeChange = useCallback((mode) => {
    // Switching modes clears the current selection so the queue view and
    // the toggle never disagree about what's loaded.
    setConfig((c) => ({ ...c, inputMode: mode, inputFolder: "" }));
    setImages([]);
    setSelectedImage(null);
  }, []);

  const onChooseOutputFolder = useCallback(async () => {
    // Defaults to the currently-set output folder, so re-picking (e.g. to
    // nudge it to a nearby subfolder) doesn't start back at square one.
    const folder = await window.api.chooseFolder(config.outputFolder || undefined);
    if (folder) setConfig((c) => ({ ...c, outputFolder: folder }));
  }, [config.outputFolder]);

  const onAddLogo = useCallback(async () => {
    const remaining = MAX_LOGOS - (config.logos?.length || 0);
    if (remaining <= 0) return;
    const files = await window.api.chooseLogoImage(config.lastLogoFolder || undefined, true);
    if (files && files.length) {
      // Respect the MAX_LOGOS cap even if the user selected more files
      // than there's room for — take as many as fit, in the order
      // the OS picker returned them.
      const toAdd = files.slice(0, remaining);
      const lastFile = toAdd[toAdd.length - 1];
      setConfig((c) => ({
        ...c,
        logos: [...(c.logos || []), ...toAdd],
        lastLogoFolder: dirOf(lastFile) || c.lastLogoFolder
      }));
    }
  }, [config.logos, config.lastLogoFolder]);

  const onChooseLogoAt = useCallback(
    async (index) => {
      const file = await window.api.chooseLogoImage(config.lastLogoFolder || undefined);
      if (!file) return;
      setConfig((c) => {
        const logos = [...(c.logos || [])];
        logos[index] = file;
        return { ...c, logos, lastLogoFolder: dirOf(file) || c.lastLogoFolder };
      });
    },
    [config.lastLogoFolder]
  );

  const onRemoveLogoAt = useCallback((index) => {
    setConfig((c) => {
      const logos = [...(c.logos || [])];
      logos.splice(index, 1);
      return { ...c, logos };
    });
  }, []);

  // Clears every watermark in one go, e.g. before starting a fresh set
  // instead of removing each LogoThumb one at a time.
  const onClearLogos = useCallback(() => {
    setConfig((c) => ({ ...c, logos: [] }));
  }, []);

  // Reorders a logo one slot toward the front (-1) or back (+1) of the
  // list. List order determines stacking order relative to the chosen
  // corner (see processor.js applyLogos), so this is the only way to
  // change which logo sits closest to the edge without removing and
  // re-adding it.
  const onMoveLogoAt = useCallback((index, direction) => {
    setConfig((c) => {
      const logos = [...(c.logos || [])];
      const target = index + direction;
      if (target < 0 || target >= logos.length) return c;
      [logos[index], logos[target]] = [logos[target], logos[index]];
      return { ...c, logos };
    });
  }, []);

  // Drag-and-drop reorder: pulls the dragged logo out of its old slot and
  // reinserts it at the drop slot, shifting everything between the two
  // positions rather than swapping just the two endpoints (unlike
  // onMoveLogoAt, which only swaps adjacent neighbors).
  const onReorderLogo = useCallback((fromIndex, toIndex) => {
    setConfig((c) => {
      const logos = [...(c.logos || [])];
      if (
        fromIndex < 0 ||
        fromIndex >= logos.length ||
        toIndex < 0 ||
        toIndex >= logos.length ||
        fromIndex === toIndex
      ) {
        return c;
      }
      const [moved] = logos.splice(fromIndex, 1);
      logos.splice(toIndex, 0, moved);
      return { ...c, logos };
    });
  }, []);

  // Runs a single preview job against the backend. If another job is
  // already in flight, we stash this one as "pending" and return — when
  // the in-flight job finishes it will pick up only the latest pending
  // request (never a backlog of every image the user clicked through).
  const executePreview = useCallback(async (imagePath, cfg, requestId) => {
    previewInFlight.current = true;
    setPreviewLoading(true);

    const result = await window.api.generatePreview(imagePath, cfg);

    // Only apply the result if nothing newer has been requested meanwhile.
    if (requestId === previewRequestId.current) {
      setPreviewLoading(false);
      if (result.ok) {
        setPreview({ before: result.originalDataUrl, after: result.processedDataUrl });
      } else {
        showToast("error", result.error);
      }
    }

    previewInFlight.current = false;

    if (pendingPreviewRequest.current) {
      const next = pendingPreviewRequest.current;
      pendingPreviewRequest.current = null;
      executePreview(next.imagePath, next.cfg, next.requestId);
    }
  }, [showToast]);

  const runPreview = useCallback(
    (imagePath, cfg) => {
      const requestId = ++previewRequestId.current;
      if (previewInFlight.current) {
        // A job is already running (e.g. for the previously-selected
        // image) — just remember this as the latest wanted job. Any
        // earlier pending request gets overwritten/dropped here.
        pendingPreviewRequest.current = { imagePath, cfg, requestId };
        return;
      }
      executePreview(imagePath, cfg, requestId);
    },
    [executePreview]
  );

  // Regenerate preview whenever selected image or relevant config changes
  useEffect(() => {
    if (!selectedImage) {
      setPreview({ before: null, after: null });
      return;
    }
    if (previewDebounce.current) clearTimeout(previewDebounce.current);

    // Preview generation now runs on a downscaled image (see
    // processor.js:processPreview), so the backend round-trip is much
    // cheaper than it used to be — shortened from 350ms so slider drags
    // feel more responsive without going so low that we spam requests
    // mid-drag.
    previewDebounce.current = setTimeout(() => {
      runPreview(selectedImage, config);
    }, 180);

    return () => clearTimeout(previewDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedImage,
    config.enhancementFilter,
    config.enhancementIntensity,
    config.manualTemperature,
    config.manualTint,
    config.manualHue,
    config.manualVibrance,
    config.manualSaturation,
    config.manualBrightness,
    config.manualContrast,
    config.manualExposure,
    config.manualHighlights,
    config.manualShadows,
    config.manualWhites,
    config.manualBlacks,
    config.manualInvert,
    config.manualSharpen,
    config.manualClarity,
    config.manualVignette,
    JSON.stringify(config.logos),
    config.logoPosition,
    config.logoMarginPercent,
    config.logoGapPercent,
    config.logoScalePercent,
    config.logoOpacityPercent,
    config.logoShadow,
    config.logoShadowColor,
    config.logoShadowOpacityPercent,
    config.logoOutline,
    config.logoOutlineColor,
    config.logoOutlineOpacityPercent,
    config.logoOutlineSizePercent,
    config.logoShadowDistancePercent,
    config.logoShadowAngle
  ]);

  const validate = () => {
    if (images.length === 0) return { message: "Please add at least one image to process.", section: null };
    if (!config.outputFolder) return { message: "Please select an output folder.", section: "output" };
    return null;
  };

  const startProcessing = async () => {
    const validationError = validate();
    if (validationError) {
      showToast("error", validationError.message);
      if (validationError.section) {
        setRightPanelOpen(true);
        setFocusSection(validationError.section);
      }
      return;
    }
    dismissToast();
    setSummary(null);
    setResultBanner(null);
    setCancelRequested(false);
    if (resultBannerTimer.current) clearTimeout(resultBannerTimer.current);
    setIsProcessing(true);
    setProgress({ done: 0, total: images.length, filename: "" });
    setStatus("Starting…");

    const result = await window.api.startBatch(images, config);

    // The "progress" IPC event can lag behind (or, for a very fast batch,
    // never arrive before) the startBatch promise resolving — most
    // noticeable on a single-image run that finishes before the event is
    // even processed, which left the overlay stuck showing "0/1". Sync
    // progress to the actual final tally here so it always reflects what
    // really happened, regardless of event timing.
    const finished = result.succeeded + result.failed + result.skipped;
    setProgress({ done: finished, total: result.total, filename: "" });
    setIsProcessing(false);
    setCancelRequested(false);
    setSummary(result);
    setStatus(
      result.cancelled
        ? "Cancelled."
        : `Done. ${result.succeeded} succeeded, ${result.skipped} skipped, ${result.failed} failed.`
    );

    // Morph the same overlay card into a result state instead of popping a
    // separate toast — it stays put briefly, then fades away. This always
    // fires, including on cancel: a batch that's small enough for every
    // image to already be dispatched to a worker finishes anyway even
    // after Stop is clicked, so without this the run would just complete
    // silently with no confirmation that anything happened.
    if (result.cancelled) {
      setResultBanner({
        type: "cancelled",
        message:
          finished > 0
            ? `Stopped after ${result.succeeded} of ${result.total} image${result.total === 1 ? "" : "s"}.`
            : "Stopped before any images were processed."
      });
    } else {
      setResultBanner({
        type: result.failed > 0 ? "error" : "success",
        message:
          result.failed > 0
            ? `Finished with issues: ${result.succeeded} succeeded, ${result.failed} failed${
                result.skipped ? `, ${result.skipped} skipped` : ""
              }.`
            : `${result.succeeded} image${result.succeeded === 1 ? "" : "s"} processed successfully${
                result.skipped ? ` (${result.skipped} skipped)` : ""
              }.`
      });
    }
    // Stays open until the user dismisses it via CLOSE — success, failure,
    // and cancellation all leave enough to read (counts, and up to 8 error
    // lines on failure) that it shouldn't disappear on its own.

    // Clear the queue once processing actually finishes, so the next run
    // starts clean. If the user cancelled partway through, leave the queue
    // in place — they'll likely want to resume/retry the remaining items.
    if (!result.cancelled) {
      setImages([]);
      setSelectedImage(null);
    }
  };

  const cancelProcessing = async () => {
    setCancelRequested(true);
    setStatus("Cancelling…");
    await window.api.cancelBatch();
  };

  const openOutputFolder = useCallback(() => {
    if (config.outputFolder) window.api.openOutputFolder(config.outputFolder);
  }, [config.outputFolder]);

  const copyErrors = useCallback(() => {
    if (!summary?.errors?.length) return;
    navigator.clipboard.writeText(summary.errors.join("\n")).then(
      () => showToast("success", "Errors copied to clipboard."),
      () => showToast("error", "Couldn't copy to clipboard.")
    );
  }, [summary, showToast]);

  return (
    <div className="relative flex h-full w-full flex-col bg-base-950">
      {/* Toast: validation / error / success notifications */}
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center">
          <div
            className={`pointer-events-auto flex max-w-sm items-center gap-2 rounded-xl2 border px-4 py-3 shadow-2xl backdrop-blur-sm ${
              toast.type === "success"
                ? "border-accent/40 bg-accent/15 text-accent"
                : "border-red-500/40 bg-red-500/15 text-red-300"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            )}
            <p className="flex-1 text-xs leading-snug">{toast.message}</p>
            <button
              onClick={dismissToast}
              className="flex-shrink-0 rounded-md px-1 text-current opacity-60 transition-opacity hover:opacity-100"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Title bar */}
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-base-800 bg-base-900 px-4">
        <img src={logo} className="h-6 w-6" alt="PRISM" />
        <img src={logoType} className="h-4" alt="PRISM-FONT" />

        {updateInfo && !updateDismissed && (
          <div className="ml-3 flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 py-1 pl-2.5 pr-1.5 text-xs">
            <Sparkles className="h-3 w-3 flex-shrink-0 text-accent" strokeWidth={2.25} />
            <button
              onClick={onOpenReleasePage}
              className="font-medium text-accent hover:underline"
              title="Open the release on GitHub"
            >
              v{updateInfo.latestVersion} available
            </button>
            <button
              onClick={() => setUpdateDismissed(true)}
              title="Dismiss"
              className="flex-shrink-0 rounded-md p-0.5 text-accent/70 opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: image queue */}
        <div
          className={`flex-shrink-0 overflow-hidden border-r border-base-800 bg-base-900 transition-all duration-200 ${
            leftPanelOpen ? "w-64" : "w-0 border-r-0"
          }`}
        >
          <div className="h-full w-64">
            <ImageQueue
              images={images}
              selectedImage={selectedImage}
              onSelect={setSelectedImage}
              onDropPaths={onDropPaths}
              onBrowse={config.inputMode === "image" ? onChooseImages : onChooseFolder}
              onRemoveImage={onRemoveImage}
              inputFolder={config.inputFolder}
              mode={config.inputMode}
              onModeChange={onModeChange}
            />
          </div>
        </div>

        <button
          onClick={() => setLeftPanelOpen((o) => !o)}
          title={leftPanelOpen ? "Hide queue panel" : "Show queue panel"}
          className="relative z-10 -ml-px flex h-10 w-5 flex-shrink-0 items-center justify-center self-center rounded-r-lg border border-l-0 border-base-800 bg-base-900 text-base-500 transition-colors hover:bg-base-800 hover:text-accent"
        >
          <ChevronLeft
            className={`h-3.5 w-3.5 transition-transform duration-200 ${leftPanelOpen ? "" : "rotate-180"}`}
          />
        </button>

        {/* Center: preview */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="relative min-h-0 flex-1">
            <CompareSlider beforeSrc={preview.before} afterSrc={preview.after} label="Processed" />
            {previewLoading && !isProcessing && (
              <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-6">
                <div className="flex items-center gap-1.5 rounded-full border border-base-700 bg-black/50 px-2.5 py-1 shadow-lg backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  <span className="text-xs font-medium text-slate-200">Rendering preview…</span>
                </div>
              </div>
            )}

            {(isProcessing || resultBanner) && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl2 bg-black/50 backdrop-blur-md">
                <div className="flex w-64 flex-col items-center gap-1 rounded-2xl border border-base-700 bg-base-900/95 px-6 py-7 text-center shadow-2xl">
                  {resultBanner ? (
                    <>
                      <span className="mb-2 text-accent">
                        {resultBanner.type === "success" ? (
                          <CheckCircle2 className="h-8 w-8" strokeWidth={1.75} />
                        ) : resultBanner.type === "cancelled" ? (
                          <StopCircle className="h-8 w-8 text-slate-400" strokeWidth={1.75} />
                        ) : (
                          <AlertTriangle className="h-8 w-8 text-yellow-400" strokeWidth={1.75} />
                        )}
                      </span>
                      <p className="text-sm font-semibold text-slate-100">
                        {resultBanner.type === "success"
                          ? "Done!"
                          : resultBanner.type === "cancelled"
                          ? "Cancelled"
                          : "Finished with issues"}
                      </p>
                      <p className="mb-4 text-xs text-slate-400">{resultBanner.message}</p>
                      <div className="flex items-center gap-2">
                        {resultBanner.type === "success" && config.outputFolder && (
                          <button
                            onClick={openOutputFolder}
                            className="rounded-full border border-accent/50 px-5 py-2 text-xs font-semibold tracking-wide text-accent transition-colors hover:bg-accent/15"
                          >
                            OPEN FOLDER
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (resultBannerTimer.current) clearTimeout(resultBannerTimer.current);
                            setResultBanner(null);
                          }}
                          className="rounded-full border border-slate-400/70 px-7 py-2 text-xs font-semibold tracking-wide text-slate-200 transition-colors hover:border-accent hover:text-accent"
                        >
                          CLOSE
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <img
                        src={logo}
                        alt=""
                        className="mb-2 h-10 w-10 animate-logo-flip"
                        style={{ animationPlayState: cancelRequested ? "paused" : "running" }}
                      />
                      <p className="text-sm font-semibold text-slate-100">{cancelRequested ? "Cancelling…" : "Hold on…"}</p>
                      {progress.total >= 2 && (
                        <p className="mt-1 text-sm font-semibold text-slate-200">
                          Image {Math.min(progress.done + 1, progress.total)} of {progress.total}
                        </p>
                      )}
                      <p className="text-xs text-slate-400">
                        {cancelRequested
                          ? "Finishing the current image, then stopping…"
                          : progress.total
                          ? progress.filename || "Doing the PRISM magic…"
                          : "Doing the PRISM magic…"}
                      </p>
                      {progress.total > 0 && (
                        <>
                          <p className="mt-1 text-lg font-bold text-accent">
                            {Math.round((progress.done / progress.total) * 100)}%
                          </p>
                          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-base-800">
                            <div
                              className="h-full rounded-full bg-accent transition-all duration-200"
                              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                            />
                          </div>
                        </>
                      )}
                      <button
                        onClick={cancelProcessing}
                        disabled={cancelRequested}
                        className="mt-3 rounded-full border border-slate-400/70 px-7 py-2 text-xs font-semibold tracking-wide text-slate-200 transition-colors hover:border-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        STOP
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {summary && summary.errors?.length > 0 && (
            <div className="mt-4 flex-shrink-0">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-yellow-300/80">
                  {summary.errors.length} error{summary.errors.length === 1 ? "" : "s"}
                </span>
                <button
                  onClick={copyErrors}
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-yellow-300/80 hover:text-yellow-200 hover:underline"
                >
                  Copy all
                </button>
              </div>
              <div className="max-h-24 overflow-y-auto rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                {summary.errors.slice(0, 8).map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
                {summary.errors.length > 8 && (
                  <div className="mt-1 text-yellow-300/70">+ {summary.errors.length - 8} more (see "Copy all")</div>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => setRightPanelOpen((o) => !o)}
          title={rightPanelOpen ? "Hide settings panel" : "Show settings panel"}
          className="relative z-10 -mr-px flex h-10 w-5 flex-shrink-0 items-center justify-center self-center rounded-l-lg border border-r-0 border-base-800 bg-base-900 text-base-500 transition-colors hover:bg-base-800 hover:text-accent"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform duration-200 ${rightPanelOpen ? "" : "rotate-180"}`}
          />
        </button>

        {/* Right: settings */}
        <div
          className={`flex-shrink-0 overflow-hidden border-l border-base-800 bg-base-900 transition-all duration-200 ${
            rightPanelOpen ? "w-[28rem]" : "w-0 border-l-0"
          }`}
        >
          <div className="flex h-full w-[28rem] flex-col">
            <div className="min-h-0 flex-1">
              <SettingsPanel
                config={config}
                setConfig={setConfig}
                onChooseOutputFolder={onChooseOutputFolder}
                onAddLogo={onAddLogo}
                onChooseLogoAt={onChooseLogoAt}
                onRemoveLogoAt={onRemoveLogoAt}
                onClearLogos={onClearLogos}
                onMoveLogoAt={onMoveLogoAt}
                onReorderLogo={onReorderLogo}
                focusSection={focusSection}
                onFocusSectionHandled={() => setFocusSection(null)}
              />
            </div>

            <div className="flex-shrink-0 border-t border-base-800 p-4">
              <button
                onClick={startProcessing}
                disabled={isProcessing}
                className="w-full rounded-xl2 bg-accent px-4 py-3 text-sm font-semibold text-base-950 transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isProcessing ? "Processing…" : "Start Processing"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}