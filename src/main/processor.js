/**
 * processor.js
 * Core image processing engine (Node/sharp) for ACCESS-PhotoProcessor.
 *
 * Two enhancement modes:
 *   - Auto: a single 0-100 `enhancementIntensity` slider scales a fixed
 *     pipeline — sharpen goes LAST, after noise reduction, so it doesn't
 *     amplify grain that denoising would otherwise smooth back out:
 *       1. Auto-exposure (pulls each photo's own mean brightness toward
 *          mid-gray — dark photos lighten, bright/blown photos darken)
 *       2. Normalize (auto white-balance / levels stretch)
 *       3. CLAHE (local contrast)
 *       4. Median filter (light noise reduction)
 *       5. Saturation boost
 *       6. Sharpen (unsharp mask)
 *   - Manual: independent Hue, Saturation, Brightness/Value, Contrast,
 *     Exposure, Highlights, Shadows, and Sharpen controls. See
 *     buildManualPipeline / buildToneCurveLUT below.
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png"];

function clampIntensity(intensity) {
  return Math.max(0, Math.min(100, intensity)) / 100;
}

/**
 * Build a sharp pipeline with the "Auto" enhancement steps applied,
 * scaled by a single 0-100 intensity value.
 */
async function buildAutoPipeline(image, intensity) {
  const factor = clampIntensity(intensity);
  if (factor === 0) return image;

  let pipeline = image;

  // 0. Auto-exposure — measure this specific photo's own average brightness
  // and pull it toward a mid-gray target, so dark photos lighten and
  // bright/washed-out photos come back down, instead of applying the same
  // fixed brightness to every image regardless of how it was shot.
  const stats = await image.stats();
  const rgbChannels = stats.channels.slice(0, 3);
  const meanLuminance =
    rgbChannels.length >= 3
      ? 0.2126 * rgbChannels[0].mean + 0.7152 * rgbChannels[1].mean + 0.0722 * rgbChannels[2].mean
      : rgbChannels[0].mean;

  const TARGET_MEAN = 128; // mid-gray target for a "well exposed" photo
  const MAX_SHIFT = 45; // cap how hard we'll push an extremely under/over-exposed photo
  const rawDelta = TARGET_MEAN - meanLuminance;
  const clampedDelta = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, rawDelta));
  const exposureShift = clampedDelta * factor; // scaled by the intensity slider

  if (Math.abs(exposureShift) > 0.5) {
    pipeline = pipeline.linear(1, exposureShift);
  }

  // 2. Normalize — auto-levels stretch, a reasonable stand-in for white balance.
  pipeline = pipeline.normalise({ lower: 1, upper: 99 });

  // 3. CLAHE — local contrast enhancement. Larger window = subtler effect.
  const claheWidth = Math.round(64 - 32 * factor); // 64 (subtle) down to 32 (stronger)
  pipeline = pipeline.clahe({
    width: Math.max(8, claheWidth),
    height: Math.max(8, claheWidth),
    maxSlope: 1 + Math.round(2 * factor)
  });

  // 4. Median filter — light noise reduction. Only apply above a threshold,
  //    since a median filter at low intensity does more harm than good.
  if (factor > 0.15) {
    pipeline = pipeline.median(3);
  }

  // 5. Saturation boost — up to +35%.
  const saturation = 1 + 0.35 * factor;
  pipeline = pipeline.modulate({ saturation });

  // 6. Sharpen — mild unsharp mask, scaled by intensity.
  const sharpenSigma = 0.8 + 1.2 * factor;
  const sharpenM1 = 0.3 + 0.7 * factor;
  pipeline = pipeline.sharpen({ sigma: sharpenSigma, m1: sharpenM1, m2: 0.2 });

  return pipeline;
}

/**
 * Build a 256-entry lookup table mapping input level (0-255) to output
 * level, combining exposure, contrast, highlights, and shadows into a
 * single tone curve. Applied identically to R/G/B (not alpha) via raw
 * pixel remapping — sharp has no built-in per-tonal-range control, so
 * this is a lightweight approximation rather than a true zone-based
 * curve, but it's smooth and gives each slider an independent, visible
 * effect:
 *   - Exposure: a multiplicative (stops-based) brightness shift applied
 *     to the whole range first, like adjusting light captured.
 *   - Highlights / Shadows: additive shifts weighted toward the bright
 *     or dark end of the range respectively (t² / (1-t)²), so each
 *     mostly leaves the opposite end alone.
 *   - Contrast: a linear scale around the 128 midpoint, applied last.
 */
function buildToneCurveLUT({ exposure = 0, contrast = 0, highlights = 0, shadows = 0 }) {
  const lut = new Uint8ClampedArray(256);

  const exposureFactor = Math.pow(2, (exposure / 100) * 2); // -100..100 -> 0.25x..4x
  const contrastFactor = 1 + contrast / 100; // -100..100 -> 0..2x
  const highlightsAmount = (highlights / 100) * 80; // up to +-80 levels
  const shadowsAmount = (shadows / 100) * 80;

  for (let x = 0; x < 256; x++) {
    let y = x * exposureFactor;

    const t = x / 255;
    const highlightWeight = t * t;
    const shadowWeight = (1 - t) * (1 - t);
    y += highlightsAmount * highlightWeight;
    y += shadowsAmount * shadowWeight;

    y = 128 + (y - 128) * contrastFactor;

    lut[x] = Math.max(0, Math.min(255, Math.round(y)));
  }

  return lut;
}

/**
 * Build a sharp pipeline for "Manual" mode: tone curve (exposure,
 * contrast, highlights, shadows) via raw-pixel LUT remap, then hue,
 * saturation, and brightness/value via sharp's native (fast, high
 * quality) modulate, then an optional sharpen pass.
 */
async function buildManualPipeline(image, config) {
  const {
    manualExposure = 0,
    manualContrast = 0,
    manualHighlights = 0,
    manualShadows = 0,
    manualHue = 0,
    manualSaturation = 0,
    manualBrightness = 0,
    manualSharpen = 0
  } = config;

  let working = image;

  const needsToneCurve = manualExposure !== 0 || manualContrast !== 0 || manualHighlights !== 0 || manualShadows !== 0;

  if (needsToneCurve) {
    const lut = buildToneCurveLUT({
      exposure: manualExposure,
      contrast: manualContrast,
      highlights: manualHighlights,
      shadows: manualShadows
    });

    const { data, info } = await working.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;

    for (let i = 0; i < data.length; i += channels) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
      // alpha (data[i + 3]) left untouched
    }

    working = sharp(data, { raw: { width: info.width, height: info.height, channels } });
  }

  let pipeline = working;

  const hueDeg = Math.round(manualHue) % 360;
  const satMultiplier = Math.max(0, 1 + manualSaturation / 100);
  const brightnessMultiplier = Math.max(0, 1 + manualBrightness / 100);

  if (hueDeg !== 0 || manualSaturation !== 0 || manualBrightness !== 0) {
    pipeline = pipeline.modulate({
      hue: hueDeg,
      saturation: satMultiplier,
      brightness: brightnessMultiplier
    });
  }

  if (manualSharpen > 0) {
    const amount = Math.max(0, Math.min(100, manualSharpen)) / 100;
    const sigma = 0.5 + 1.5 * amount;
    const m1 = 0.2 + 0.8 * amount;
    pipeline = pipeline.sharpen({ sigma, m1, m2: 0.2 });
  }

  return pipeline;
}

/**
 * Dispatches to the Auto (single-intensity) or Manual (per-property)
 * enhancement pipeline based on config.enhancementMode. Anything other
 * than exactly "manual" (including undefined, for older saved configs)
 * falls back to Auto.
 */
async function buildEnhancedPipeline(image, config) {
  if (config.enhancementMode === "manual") {
    return buildManualPipeline(image, config);
  }
  return buildAutoPipeline(image, config.enhancementIntensity);
}

/**
 * Parse a "#rrggbb" hex color string (as produced by an <input type="color">)
 * into an {r,g,b} object. Falls back to the given default on anything
 * malformed or missing.
 */
function hexToRgb(hex, fallback) {
  const match = typeof hex === "string" && /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return fallback;
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/**
 * Build a flat-color silhouette of a logo: same alpha shape, solid RGB fill.
 * Uses sharp's "dest-in" blend to keep a solid-color layer only where the
 * logo's own alpha is opaque. An optional opacity (0-1) further scales the
 * silhouette's alpha channel, e.g. to make a shadow or outline translucent.
 */
async function makeSilhouette(logoPngBuffer, colorRgb, width, height, opacity = 1) {
  const solid = await sharp({
    create: { width, height, channels: 4, background: { ...colorRgb, alpha: 1 } }
  })
    .png()
    .toBuffer();

  const silhouette = await sharp(solid).composite([{ input: logoPngBuffer, blend: "dest-in" }]).png().toBuffer();

  if (opacity >= 1) return silhouette;

  const { data, info } = await sharp(silhouette).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * opacity);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/**
 * Add a drop shadow and/or an outline behind a logo (PNG buffer with
 * alpha), each in a user-chosen color. sharp has no built-in shadow/outline
 * filter, so both are built from silhouettes of the logo's own alpha shape:
 *   - Shadow: a blurred silhouette, offset by angle/distance, at reduced opacity.
 *   - Outline: a ring of solid silhouettes offset a few px in every
 *     direction, which fills in to a rim around the logo's edges.
 * The canvas is padded so neither effect gets clipped.
 */
async function applyLogoEffects(
  logoPngBuffer,
  {
    shadow,
    outline,
    outlineWidthPercent = 3.5,
    shadowDistancePercent = 5,
    shadowAngleDeg = 135,
    shadowColor = "#000000",
    shadowOpacityPercent = 100,
    outlineColor = "#ffffff",
    outlineOpacityPercent = 100
  }
) {
  if (!shadow && !outline) return logoPngBuffer;

  const meta = await sharp(logoPngBuffer).metadata();
  const { width, height } = meta;

  const outlineWidth = outline ? Math.max(1, Math.round(width * (outlineWidthPercent / 100))) : 0;
  const shadowDistance = shadow ? Math.max(0, Math.round(width * (shadowDistancePercent / 100))) : 0;
  // Blur scales with distance so a bigger throw also reads as a softer shadow.
  const shadowBlur = shadow ? Math.max(2, Math.round(shadowDistance * 0.4)) : 0;

  const angleRad = ((shadowAngleDeg || 0) * Math.PI) / 180;
  const shadowDx = shadow ? Math.round(Math.cos(angleRad) * shadowDistance) : 0;
  const shadowDy = shadow ? Math.round(Math.sin(angleRad) * shadowDistance) : 0;

  // The shadow's angle is user-controlled and can point any direction, so
  // (unlike a fixed down-right offset) we can't pad one side only — pad
  // evenly by the worst-case reach so nothing clips regardless of angle.
  const shadowReach = shadow ? shadowDistance + shadowBlur * 2 : 0;
  const pad = outlineWidth + shadowReach;

  const canvasWidth = width + pad * 2;
  const canvasHeight = height + pad * 2;

  const layers = [];

  if (shadow) {
    const shadowRgb = hexToRgb(shadowColor, { r: 0, g: 0, b: 0 });
    const shadowSilhouette = await makeSilhouette(logoPngBuffer, shadowRgb, width, height, clampIntensity(shadowOpacityPercent));
    const blurredShadow = await sharp(shadowSilhouette).blur(shadowBlur).png().toBuffer();
    layers.push({ input: blurredShadow, left: pad + shadowDx, top: pad + shadowDy });
  }

  if (outline) {
    const outlineRgb = hexToRgb(outlineColor, { r: 255, g: 255, b: 255 });
    const outlineSilhouette = await makeSilhouette(logoPngBuffer, outlineRgb, width, height, clampIntensity(outlineOpacityPercent));
    const ringSteps = 16;
    for (let i = 0; i < ringSteps; i++) {
      const angle = (2 * Math.PI * i) / ringSteps;
      const dx = Math.round(Math.cos(angle) * outlineWidth);
      const dy = Math.round(Math.sin(angle) * outlineWidth);
      layers.push({ input: outlineSilhouette, left: pad + dx, top: pad + dy });
    }
  }

  layers.push({ input: logoPngBuffer, left: pad, top: pad });

  return sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite(layers)
    .png()
    .toBuffer();
}

/**
 * Fit a logo into a square box (side length = a percentage of base image
 * width) while preserving its own aspect ratio and alpha transparency —
 * so every logo occupies the same footprint regardless of its original
 * shape — then optionally apply a drop shadow and/or white outline, then
 * apply overall opacity.
 */
async function prepareLogo(logoPath, targetWidthPx, opacityPercent, effects = {}) {
  const opacity = clampIntensity(opacityPercent);
  const boxSize = Math.max(1, Math.round(targetWidthPx));

  // Fit each logo into an identical square box (same width AND height)
  // regardless of its original aspect ratio, so multiple watermarks read
  // as consistently sized. "contain" scales the logo down/up to fit
  // inside the box without cropping or distorting it — any leftover
  // space in the box is left transparent — so there's no stretching and
  // no quality loss beyond the resize itself (sharp uses a high-quality
  // Lanczos filter by default).
  let buffer = await sharp(logoPath)
    .resize({
      width: boxSize,
      height: boxSize,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .ensureAlpha()
    .png()
    .toBuffer();

  if (effects.shadow || effects.outline) {
    buffer = await applyLogoEffects(buffer, effects);
  }

  if (opacity < 1) {
    // Multiply the alpha channel by the opacity factor.
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    for (let i = 3; i < data.length; i += 4) {
      data[i] = Math.round(data[i] * opacity);
    }

    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }

  return buffer;
}

const MAX_LOGOS = 5;

/**
 * Composite up to MAX_LOGOS logos into the chosen corner with consistent
 * spacing, sized as a percentage of the base image's shorter side (not
 * always its width) so the logo comes out the same physical size whether
 * the source photo is landscape or portrait — using width alone would
 * make the logo shrink on portrait shots, since their width is the short
 * dimension.
 */
async function applyLogos(baseSharp, baseMeta, logoPaths, scalePercent, opacityPercent, effects = {}, position = "bottom-right") {
  const referenceDimension = Math.min(baseMeta.width, baseMeta.height);
  const targetWidth = Math.max(1, Math.round(referenceDimension * (scalePercent / 100)));
  const margin = Math.max(4, Math.round(referenceDimension * 0.015));

  const isRight = position === "top-right" || position === "bottom-right";
  const isBottom = position === "bottom-right" || position === "bottom-left";

  const list = (logoPaths || []).filter(Boolean).slice(0, MAX_LOGOS);
  // First logo in the list ends up closest to the chosen corner. Laying out
  // toward a right corner walks right-to-left (so the list needs reversing
  // to keep the first entry nearest the corner); laying out toward a left
  // corner walks left-to-right, where the list's natural order already
  // puts the first entry nearest the corner.
  const ordered = isRight ? [...list].reverse() : list;

  const composites = [];
  let xCursor = isRight ? baseMeta.width - margin : margin;

  for (const logoPath of ordered) {
    const logoBuffer = await prepareLogo(logoPath, targetWidth, opacityPercent, effects);
    const logoMeta = await sharp(logoBuffer).metadata();

    const x = isRight ? xCursor - logoMeta.width : xCursor;
    const y = isBottom ? baseMeta.height - margin - logoMeta.height : margin;

    composites.push({ input: logoBuffer, left: Math.max(0, x), top: Math.max(0, y) });
    xCursor = isRight ? x - margin : x + logoMeta.width + margin;
  }

  return composites.length ? baseSharp.composite(composites) : baseSharp;
}

/**
 * Strip characters that aren't safe in a filename (path separators, drive
 * separators, control chars, etc.) so a user-typed suffix can't escape the
 * output folder or produce an invalid path. Letters, numbers, spaces,
 * dashes, underscores, and dots are kept.
 */
function sanitizeFilenamePart(text) {
  if (!text) return "";
  return text.replace(/[\\/:*?"<>|]/g, "").trim();
}

/**
 * Decide the filename to save as, honoring the user's chosen output format
 * and an optional suffix appended right before the extension
 * (e.g. "photo.jpg" + "_edited" -> "photo_edited.jpg").
 */
function resolveOutputFilename(originalFilename, outputFormat, filenameSuffix) {
  const ext =
    !outputFormat || outputFormat === "original"
      ? path.extname(originalFilename)
      : outputFormat === "png"
      ? ".png"
      : ".jpg";
  const stem = path.basename(originalFilename, path.extname(originalFilename));
  const suffix = sanitizeFilenamePart(filenameSuffix);
  return `${stem}${suffix}${ext}`;
}

/**
 * Decide the final output path given a collision strategy.
 * Returns null if the file should be skipped.
 */
function resolveOutputPath(outputFolder, filename, collisionStrategy) {
  const outPath = path.join(outputFolder, filename);
  if (!fs.existsSync(outPath)) return outPath;

  if (collisionStrategy === "overwrite") return outPath;
  if (collisionStrategy === "skip") return null;

  // rename: filename_1.ext, filename_2.ext, ...
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let counter = 1;
  let candidate;
  do {
    candidate = path.join(outputFolder, `${stem}_${counter}${ext}`);
    counter += 1;
  } while (fs.existsSync(candidate));
  return candidate;
}

/**
 * sharp reports width/height from the raw file, but EXIF orientation tags
 * 5-8 mean the pixels are stored rotated 90°/270° from how the photo should
 * actually be displayed. Once we call .rotate() (auto-orient) on the image,
 * its real output dimensions are the swapped pair — this keeps logo sizing
 * and corner placement working off the correct (post-rotation) canvas.
 */
function getOrientedMeta(meta) {
  if (meta.orientation && meta.orientation >= 5 && meta.orientation <= 8) {
    return { ...meta, width: meta.height, height: meta.width };
  }
  return meta;
}

/**
 * Process a single image end-to-end and return a sharp instance ready to save.
 */
async function buildProcessedImage(imagePath, config) {
  const rawMeta = await sharp(imagePath).metadata();
  // .rotate() with no args auto-orients the pixels per the file's EXIF
  // Orientation tag and strips that tag from the output, so the saved
  // image displays correctly everywhere instead of relying on each
  // viewer to apply the rotation itself (which not all do).
  const image = sharp(imagePath).rotate();
  const meta = getOrientedMeta(rawMeta);

  let pipeline = await buildEnhancedPipeline(image, config);

  if (config.logos && config.logos.length) {
    // Need the enhanced pixels resolved before compositing, so buffer through.
    const enhancedBuffer = await pipeline.toBuffer();
    const enhancedSharp = sharp(enhancedBuffer);
    pipeline = await applyLogos(
      enhancedSharp,
      meta,
      config.logos,
      config.logoScalePercent,
      config.logoOpacityPercent,
      {
        shadow: !!config.logoShadow,
        outline: !!config.logoOutline,
        outlineWidthPercent: config.logoOutlineSizePercent,
        shadowDistancePercent: config.logoShadowDistancePercent,
        shadowAngleDeg: config.logoShadowAngle,
        shadowColor: config.logoShadowColor,
        shadowOpacityPercent: config.logoShadowOpacityPercent,
        outlineColor: config.logoOutlineColor,
        outlineOpacityPercent: config.logoOutlineOpacityPercent
      },
      config.logoPosition
    );
  }

  return { pipeline, meta };
}

async function saveProcessed(pipeline, outputPath, jpegQuality) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const ext = path.extname(outputPath).toLowerCase();

  if (ext === ".jpg" || ext === ".jpeg") {
    await pipeline.jpeg({ quality: Math.max(95, Math.min(100, jpegQuality)), chromaSubsampling: "4:4:4" }).toFile(outputPath);
  } else {
    await pipeline.png().toFile(outputPath);
  }
}

/**
 * Generate a preview pair (original + processed), downscaled for display,
 * returned as data URLs for the renderer.
 */
async function processPreview(imagePath, config) {
  const PREVIEW_MAX = 640;

  const originalBuffer = await sharp(imagePath)
    .rotate()
    .resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside" })
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer();

  const { pipeline } = await buildProcessedImage(imagePath, config);

  // IMPORTANT: sharp always performs .resize() before any .composite()
  // step, regardless of the order those calls appear in the chain. If we
  // resize and composite in a single pipeline here, the logo (positioned
  // and sized using the full-resolution image dimensions) gets composited
  // onto an already-downscaled canvas and ends up placed off-frame — which
  // is why logos were invisible in the preview. To fix this we resolve the
  // full-resolution processed image (with logos baked in) first, then
  // downscale that finished buffer as a separate step.
  const fullProcessedBuffer = await pipeline.toBuffer();
  const processedBuffer = await sharp(fullProcessedBuffer)
    .resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside", kernel: "lanczos3" })
    // 4:4:4 chroma keeps the logo's saturated edges crisp — the default
    // 4:2:0 subsampling halves color resolution and was the main source
    // of watermark blur in the preview (most visible on colored logos).
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();

  return {
    originalDataUrl: `data:image/jpeg;base64,${originalBuffer.toString("base64")}`,
    processedDataUrl: `data:image/jpeg;base64,${processedBuffer.toString("base64")}`
  };
}

/**
 * Process one image fully and save it, returning a status record.
 * If `controller` is cancelled, we skip the (slow) disk write even if the
 * enhancement pipeline for this image already ran — this is what makes
 * Stop actually take effect promptly instead of only between images. Since
 * every image in a batch that's no bigger than the worker pool gets
 * claimed by a worker in the same instant, checking cancellation only
 * between images would otherwise never fire on typical small batches.
 */
async function processOne(imagePath, config, controller) {
  try {
    const { pipeline } = await buildProcessedImage(imagePath, config);

    if (controller && controller.cancelled) {
      return { imagePath, status: "cancelled" };
    }

    const filename = resolveOutputFilename(path.basename(imagePath), config.outputFormat, config.filenameSuffix);
    const outputPath = resolveOutputPath(config.outputFolder, filename, config.collisionStrategy);

    if (!outputPath) {
      return { imagePath, status: "skipped" };
    }

    await saveProcessed(pipeline, outputPath, config.jpegQuality);
    return { imagePath, status: "success", outputPath };
  } catch (err) {
    return { imagePath, status: "failed", error: err.message };
  }
}

/**
 * Batch runner with a bounded concurrency pool (uses libvips' internal
 * threading via sharp, plus JS-level concurrency across files, to make use
 * of multiple CPU cores — Phase 13). Reports progress via callback and
 * supports cooperative cancellation via `controller.cancelled`.
 */
async function processBatch(images, config, concurrency, onProgress, controller) {
  fs.mkdirSync(config.outputFolder, { recursive: true });

  let succeeded = 0, failed = 0, skipped = 0;
  const errors = [];
  let doneCount = 0;
  const total = images.length;

  let cursor = 0;

  async function worker() {
    while (cursor < images.length) {
      if (controller.cancelled) return;

      const idx = cursor;
      cursor += 1;
      const imagePath = images[idx];

      // Ping immediately when a worker claims a file, not just when it
      // finishes — without this, a batch small enough to be fully
      // dispatched to the worker pool in one go (very common: every batch
      // up to `concurrency` images) sends no progress update at all until
      // everything wraps up near-simultaneously, so the bar just sits at
      // 0% and then jumps to 100%. This "started" ping gives the renderer
      // something to show the moment work actually begins on each image.
      onProgress(doneCount, total, path.basename(imagePath), "processing");

      const result = await processOne(imagePath, config, controller);
      doneCount += 1;

      if (result.status === "success") succeeded += 1;
      else if (result.status === "skipped" || result.status === "cancelled") skipped += 1;
      else {
        failed += 1;
        errors.push(`${path.basename(imagePath)}: ${result.error}`);
      }

      onProgress(doneCount, total, path.basename(imagePath), result.status);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  return {
    total,
    succeeded,
    failed,
    skipped,
    errors,
    cancelled: controller.cancelled
  };
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  processBatch,
  processPreview
};