import React, { useState, useCallback } from "react";

export default function ImageQueue({
  images,
  selectedImage,
  onSelect,
  onDropPaths,
  onBrowse,
  onRemoveImage,
  inputFolder,
  mode,
  onModeChange
}) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragActive(false);
      const items = e.dataTransfer.files;
      // Electron gives dropped items a `path` property. Collect every
      // dropped path (folder or file) — in "image" mode a user may drag
      // in several files at once, possibly from different folders.
      const droppedPaths = Array.from(items)
        .map((f) => f.path)
        .filter(Boolean);
      if (droppedPaths.length) onDropPaths(droppedPaths);
    },
    [onDropPaths]
  );

  const isImageMode = mode === "image";

  return (
    <div className="flex h-full flex-col">
      <div className="mx-3 mt-3 flex justify-center">
        <div className="relative inline-flex rounded-full border border-base-700 bg-base-950 p-0.5">
          <div
            className="absolute inset-y-0.5 w-[calc(50%-2px)] rounded-full bg-accent/15 shadow-sm transition-transform duration-200 ease-out"
            style={{ transform: isImageMode ? "translateX(calc(100% + 4px))" : "translateX(0)" }}
          />
          <button
            onClick={() => onModeChange("folder")}
            className={`relative z-10 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              !isImageMode ? "text-accent" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Folder Edit
          </button>
          <button
            onClick={() => onModeChange("image")}
            className={`relative z-10 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              isImageMode ? "text-accent" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Image Edit
          </button>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={onBrowse}
        className={`m-3 flex min-h-[168px] cursor-pointer flex-col items-center justify-center rounded-xl2 border-2 border-dashed border-base-700 px-4 py-6 text-center transition-colors hover:border-accent/60 ${
          dragActive ? "drop-zone-active" : ""
        }`}
      >
        <div className="mb-2 text-2xl">{isImageMode ? "🖼️" : "📁"}</div>
        <p className="text-sm font-medium text-slate-200">
          {isImageMode ? "Drop image(s) or click to add" : "Drop a folder or click to browse"}
        </p>
        {!isImageMode && inputFolder && (
          <p className="mt-1 truncate text-xs text-base-500" title={inputFolder}>
            {inputFolder}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between px-4 pb-2 text-xs uppercase tracking-wide text-base-500">
        <span>Queue</span>
        <span>{images.length} image{images.length === 1 ? "" : "s"}</span>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {images.length === 0 && (
          <p className="mt-6 text-center text-xs text-base-500">
            {isImageMode ? "No images added yet." : "No images loaded yet."}
          </p>
        )}
        {images.map((imgPath) => {
          const filename = imgPath.split(/[/\\]/).pop();
          const isSelected = imgPath === selectedImage;
          return (
            <div
              key={imgPath}
              className={`group flex w-full items-center gap-1 rounded-lg pr-1 text-left text-sm transition-colors ${
                isSelected ? "bg-accent/15 text-accent" : "text-slate-300 hover:bg-base-800"
              }`}
            >
              <button
                onClick={() => onSelect(imgPath)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                title={imgPath}
              >
                <span className="text-base-500">🖼️</span>
                <span className="truncate">{filename}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveImage(imgPath);
                }}
                title="Remove"
                className="flex-shrink-0 rounded-md px-1.5 py-1 text-xs text-base-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}