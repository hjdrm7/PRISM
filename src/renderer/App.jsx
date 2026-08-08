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
  logoOutline: false,
  logoOutlineSizePercent: 3.5,
  logoShadowDistancePercent: 5,
  logoShadowAngle: 135,
  enhancementIntensity: 60,
  jpegQuality: 97,
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
  const [errorMsg, setErrorMsg] = useState(null);
  const [summary, setSummary] = useState(null);

  const previewDebounce = useRef(null);
  // Preview requests are serialized: only one runs against the backend at a
  // time. If the user clicks through several images while a preview is
  // still processing, we don't queue every click — we keep only the most
  // recent request and drop the rest, so we never pile up sharp jobs for
  // images the user has already moved past (which was causing the lag).
  const previewRequestId = useRef(0);
  const previewInFlight = useRef(false);
  const pendingPreviewRequest = useRef(null);

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
      setErrorMsg("No supported JPG/JPEG/PNG image(s) were found at that location.");
    }
  }, []);

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
        setErrorMsg("No supported JPG/JPEG/PNG image(s) were found at that location.");
        return;
      }
      appendImages(combined);
    },
    [config.inputMode, loadFolder, appendImages]
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
        setErrorMsg(result.error);
      }
    }

    previewInFlight.current = false;

    if (pendingPreviewRequest.current) {
      const next = pendingPreviewRequest.current;
      pendingPreviewRequest.current = null;
      executePreview(next.imagePath, next.cfg, next.requestId);
    }
  }, []);

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
    config.enhancementIntensity,
    JSON.stringify(config.logos),
    config.logoPosition,
    config.logoScalePercent,
    config.logoOpacityPercent,
    config.logoShadow,
    config.logoOutline,
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
      setErrorMsg(validationError);
      return;
    }
    setErrorMsg(null);
    setSummary(null);
    setIsProcessing(true);
    setProgress({ done: 0, total: images.length, filename: "" });
    setStatus("Starting…");

    const result = await window.api.startBatch(images, config);

    setIsProcessing(false);
    setSummary(result);
    setStatus(
      result.cancelled
        ? "Cancelled."
        : `Done. ${result.succeeded} succeeded, ${result.skipped} skipped, ${result.failed} failed.`
    );

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

  const progressPct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex h-full w-full flex-col bg-base-950">
      {/* Title bar */}
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-base-800 bg-base-900 px-4">
        <span className="text-lg">🆙</span>
        <span className="text-sm font-semibold tracking-wide text-slate-100">PRISM</span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: image queue */}
        <div className="w-64 flex-shrink-0 border-r border-base-800 bg-base-900">
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

        {/* Center: preview */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="relative min-h-0 flex-1">
            <CompareSlider beforeSrc={preview.before} afterSrc={preview.after} label="Processed" />
            {previewLoading && (
              <div className="absolute right-3 bottom-3 rounded-md bg-black/60 px-2 py-1 text-xs text-accent">
                Rendering preview…
              </div>
            )}
          </div>

          {/* Progress / status footer */}
          <div className="mt-4 flex-shrink-0 rounded-xl2 border border-base-800 bg-base-900 p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span>{status}</span>
              <span>{progress.total ? `${progress.done}/${progress.total}` : ""}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-base-800">
              <div
                className="h-full rounded-full bg-accent transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {errorMsg && (
              <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {errorMsg}
              </div>
            )}
            {summary && summary.errors?.length > 0 && (
              <div className="mt-3 max-h-24 overflow-y-auto rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                {summary.errors.slice(0, 8).map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: settings */}
        <div className="w-72 flex-shrink-0 overflow-y-auto border-l border-base-800 bg-base-900 p-4">
          <SettingsPanel
            config={config}
            setConfig={setConfig}
            onChooseOutputFolder={onChooseOutputFolder}
            onAddLogo={onAddLogo}
            onChooseLogoAt={onChooseLogoAt}
            onRemoveLogoAt={onRemoveLogoAt}
          />

          <div className="mt-6 space-y-2">
            {!isProcessing ? (
              <button
                onClick={startProcessing}
                className="w-full rounded-xl2 bg-accent px-4 py-3 text-sm font-semibold text-base-950 transition-colors hover:bg-accent-dark"
              >
                Start Processing
              </button>
            ) : (
              <button
                onClick={cancelProcessing}
                className="w-full rounded-xl2 border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/20"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}