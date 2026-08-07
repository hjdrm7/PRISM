import React, { useState, useCallback } from "react";

export default function ImageQueue({ images, selectedImage, onSelect, onDropFolder, onChooseFolder, inputFolder }) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragActive(false);
      const items = e.dataTransfer.files;
      if (items.length > 0) {
        // Electron gives dropped items a `path` property.
        const first = items[0];
        const droppedPath = first.path;
        if (droppedPath) onDropFolder(droppedPath);
      }
    },
    [onDropFolder]
  );

  return (
    <div className="flex h-full flex-col">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={onChooseFolder}
        className={`m-3 flex cursor-pointer flex-col items-center justify-center rounded-xl2 border-2 border-dashed border-base-700 px-4 py-6 text-center transition-colors hover:border-accent/60 ${
          dragActive ? "drop-zone-active" : ""
        }`}
      >
        <div className="mb-2 text-2xl">📁</div>
        <p className="text-sm font-medium text-slate-200">
          {inputFolder ? "Change folder" : "Drop a folder or click to browse"}
        </p>
        {inputFolder && <p className="mt-1 truncate text-xs text-base-500" title={inputFolder}>{inputFolder}</p>}
      </div>

      <div className="flex items-center justify-between px-4 pb-2 text-xs uppercase tracking-wide text-base-500">
        <span>Queue</span>
        <span>{images.length} image{images.length === 1 ? "" : "s"}</span>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {images.length === 0 && (
          <p className="mt-6 text-center text-xs text-base-500">No images loaded yet.</p>
        )}
        {images.map((imgPath) => {
          const filename = imgPath.split(/[/\\]/).pop();
          const isSelected = imgPath === selectedImage;
          return (
            <button
              key={imgPath}
              onClick={() => onSelect(imgPath)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                isSelected ? "bg-accent/15 text-accent" : "text-slate-300 hover:bg-base-800"
              }`}
              title={imgPath}
            >
              <span className="text-base-500">🖼️</span>
              <span className="truncate">{filename}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
