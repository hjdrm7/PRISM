import React, { useState, useEffect, useCallback, useRef } from "react";
import ImageQueue from "./components/ImageQueue.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import CompareSlider from "./components/CompareSlider.jsx";

const MAX_LOGOS = 5;

const DEFAULT_CONFIG = {
  inputFolder: "",
  inputMode: "folder", // "folder" | "image"
  outputFolder: "",
  outputFormat: "original", // "original" | "jpeg" | "png"
  logos: [],
  logoPosition: "bottom-right",
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
  enhancementMode: "auto", // "auto" | "manual"
  enhancementIntensity: 60,
  manualHue: 0,
  manualSaturation: 0,
  manualBrightness: 0,
  manualContrast: 0,
  manualExposure: 0,
  manualHighlights: 0,
  manualShadows: 0,
  manualSharpen: 0,
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
  const [progress, setProgress] = useState({ done: 0, total: 0, filename: "" });
  const [status, setStatus] = useState("Ready.");
  const [summary, setSummary] = useState(null);
  const [toast, setToast] = useState(null); // { type: "error", message } — validation/preview errors only
  const [resultBanner, setResultBanner] = useState(null); // { type: "success" | "error", message } — shown in the overlay card after a batch finishes

  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

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

  // Save settings whenever config changes (debounced-ish via effect)
  useEffect(() => {
    window.api.saveSettings(config);
  }, [config]);

  // Progress listener
  useEffect(() => {
    const unsubscribe = window.api.onProgress(({ done, total, filename }) => {
      setProgress({ done, total, filename });
      setStatus(`Processing ${done}/${total}: ${filename}`);
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
    const folder = await window.api.chooseFolder();
    if (folder) await loadFolder(folder);
  }, [loadFolder]);

  // "Image" mode: the picker supports multi-select, and every choice is
  // added to the existing queue rather than replacing it, so images from
  // different folders can accumulate together.
  const onChooseImages = useCallback(async () => {
    const files = await window.api.chooseInputImage();
    if (files && files.length) appendImages(files);
  }, [appendImages]);

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
    const folder = await window.api.chooseFolder();
    if (folder) setConfig((c) => ({ ...c, outputFolder: folder }));
  }, []);

  const onAddLogo = useCallback(async () => {
    if ((config.logos?.length || 0) >= MAX_LOGOS) return;
    const file = await window.api.chooseLogoImage();
    if (file) setConfig((c) => ({ ...c, logos: [...(c.logos || []), file] }));
  }, [config.logos]);

  const onChooseLogoAt = useCallback(async (index) => {
    const file = await window.api.chooseLogoImage();
    if (!file) return;
    setConfig((c) => {
      const logos = [...(c.logos || [])];
      logos[index] = file;
      return { ...c, logos };
    });
  }, []);

  const onRemoveLogoAt = useCallback((index) => {
    setConfig((c) => {
      const logos = [...(c.logos || [])];
      logos.splice(index, 1);
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

    previewDebounce.current = setTimeout(() => {
      runPreview(selectedImage, config);
    }, 350);

    return () => clearTimeout(previewDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedImage,
    config.enhancementMode,
    config.enhancementIntensity,
    config.manualHue,
    config.manualSaturation,
    config.manualBrightness,
    config.manualContrast,
    config.manualExposure,
    config.manualHighlights,
    config.manualShadows,
    config.manualSharpen,
    JSON.stringify(config.logos),
    config.logoPosition,
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
    if (images.length === 0) return "Please add at least one image to process.";
    if (!config.outputFolder) return "Please select an output folder.";
    return null;
  };

  const startProcessing = async () => {
    const validationError = validate();
    if (validationError) {
      showToast("error", validationError);
      return;
    }
    dismissToast();
    setSummary(null);
    setResultBanner(null);
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
    setSummary(result);
    setStatus(
      result.cancelled
        ? "Cancelled."
        : `Done. ${result.succeeded} succeeded, ${result.skipped} skipped, ${result.failed} failed.`
    );

    if (!result.cancelled) {
      // Morph the same overlay card into a result state instead of popping
      // a separate success toast — it stays put briefly, then fades away.
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
      resultBannerTimer.current = setTimeout(() => setResultBanner(null), 4000);
    }

    // Clear the queue once processing actually finishes, so the next run
    // starts clean. If the user cancelled partway through, leave the queue
    // in place — they'll likely want to resume/retry the remaining items.
    if (!result.cancelled) {
      setImages([]);
      setSelectedImage(null);
    }
  };

  const cancelProcessing = async () => {
    setStatus("Cancelling…");
    await window.api.cancelBatch();
  };

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
            <span className="flex-shrink-0 text-sm">{toast.type === "success" ? "✅" : "⚠️"}</span>
            <p className="flex-1 text-xs leading-snug">{toast.message}</p>
            <button
              onClick={dismissToast}
              className="flex-shrink-0 rounded-md px-1 text-xs text-current opacity-60 transition-opacity hover:opacity-100"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Title bar */}
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-base-800 bg-base-900 px-4">
        <span className="text-lg">🆙</span>
        <span className="text-sm font-semibold tracking-wide text-slate-100">PRISM</span>
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
          className="relative z-10 -mx-3 flex h-9 w-9 flex-shrink-0 self-center items-center justify-center rounded-full border border-base-700 bg-base-800 text-slate-300 shadow-lg transition-colors hover:bg-base-700 hover:text-accent"
        >
          <svg
            viewBox="0 0 20 20"
            className={`h-4 w-4 transition-transform duration-200 ${leftPanelOpen ? "" : "rotate-180"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.5 5L7.5 10L12.5 15" />
          </svg>
        </button>

        {/* Center: preview */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="relative min-h-0 flex-1">
            <CompareSlider beforeSrc={preview.before} afterSrc={preview.after} label="Processed" />
            {previewLoading && !isProcessing && (
              <div className="absolute right-3 bottom-3 rounded-md bg-black/60 px-2 py-1 text-xs text-accent">
                Rendering preview…
              </div>
            )}

            {(isProcessing || resultBanner) && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl2 bg-black/50 backdrop-blur-md">
                <div className="flex w-64 flex-col items-center gap-1 rounded-2xl border border-base-700 bg-base-900/95 px-6 py-7 text-center shadow-2xl">
                  {resultBanner ? (
                    <>
                      <span className="mb-2 text-3xl">{resultBanner.type === "success" ? "✅" : "⚠️"}</span>
                      <p className="text-sm font-semibold text-slate-100">
                        {resultBanner.type === "success" ? "Done!" : "Finished with issues"}
                      </p>
                      <p className="mb-4 text-xs text-slate-400">{resultBanner.message}</p>
                      <button
                        onClick={() => {
                          if (resultBannerTimer.current) clearTimeout(resultBannerTimer.current);
                          setResultBanner(null);
                        }}
                        className="rounded-full border border-slate-400/70 px-7 py-2 text-xs font-semibold tracking-wide text-slate-200 transition-colors hover:border-accent hover:text-accent"
                      >
                        CLOSE
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="mb-2 text-3xl">🆙</span>
                      <p className="text-sm font-semibold text-slate-100">Hold on…</p>
                      {progress.total >= 2 && (
                        <p className="mt-1 text-sm font-semibold text-slate-200">
                          Image {Math.min(progress.done + 1, progress.total)} of {progress.total}
                        </p>
                      )}
                      <p className="text-xs text-slate-400">
                        {progress.total ? progress.filename || "Doing the PRISM magic…" : "Doing the PRISM magic…"}
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
                        className="mt-3 rounded-full border border-slate-400/70 px-7 py-2 text-xs font-semibold tracking-wide text-slate-200 transition-colors hover:border-red-400 hover:text-red-300"
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
              <div className="max-h-24 overflow-y-auto rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                {summary.errors.slice(0, 8).map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => setRightPanelOpen((o) => !o)}
          title={rightPanelOpen ? "Hide settings panel" : "Show settings panel"}
          className="relative z-10 -mx-3 flex h-9 w-9 flex-shrink-0 self-center items-center justify-center rounded-full border border-base-700 bg-base-800 text-slate-300 shadow-lg transition-colors hover:bg-base-700 hover:text-accent"
        >
          <svg
            viewBox="0 0 20 20"
            className={`h-4 w-4 transition-transform duration-200 ${rightPanelOpen ? "" : "rotate-180"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7.5 5L12.5 10L7.5 15" />
          </svg>
        </button>

        {/* Right: settings */}
        <div
          className={`flex-shrink-0 overflow-hidden border-l border-base-800 bg-base-900 transition-all duration-200 ${
            rightPanelOpen ? "w-72" : "w-0 border-l-0"
          }`}
        >
          <div className="h-full w-72 overflow-y-auto p-4">
            <SettingsPanel
              config={config}
              setConfig={setConfig}
              onChooseOutputFolder={onChooseOutputFolder}
              onAddLogo={onAddLogo}
              onChooseLogoAt={onChooseLogoAt}
              onRemoveLogoAt={onRemoveLogoAt}
            />

            <div className="mt-6 space-y-2">
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