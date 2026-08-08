/**
 * processor.js
 * Core image processing engine (Node/sharp) for ACCESS-PhotoProcessor.
 *
 * Enhancement order (same reasoning as the original plan — sharpen goes
 * LAST, after noise reduction, so it doesn't amplify grain that denoising
 * would otherwise smooth back out):
 *   1. Normalize (auto white-balance / levels stretch)
 *   2. CLAHE (local contrast)
 *   3. Median filter (light noise reduction)
 *   4. Saturation boost
 *   5. Sharpen (unsharp mask)
 *
 * Every step is scaled by a single 0-100 `enhancementIntensity` value.
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png"];

function clampIntensity(intensity) {
  return Math.max(0, Math.min(100, intensity)) / 100;
}

/**
 * Build a sharp pipeline with the enhancement steps applied, scaled by intensity.
 */
function buildEnhancedPipeline(image, intensity) {
  const factor = clampIntensity(intensity);
  if (factor === 0) return image;

  let pipeline = image;

  // 1. Normalize — auto-levels stretch, a reasonable stand-in for white balance.
  pipeline = pipeline.normalise({ lower: 1, upper: 99 });

  // 2. CLAHE — local contrast enhancement. Larger window = subtler effect.
  const claheWidth = Math.round(64 - 32 * factor); // 64 (subtle) down to 32 (stronger)
  pipeline = pipeline.clahe({
    width: Math.max(8, claheWidth),
    height: Math.max(8, claheWidth),
    maxSlope: 1 + Math.round(2 * factor)
  });

  // 3. Median filter — light noise reduction. Only apply above a threshold,
  //    since a median filter at low intensity does more harm than good.
  if (factor > 0.15) {
    pipeline = pipeline.median(3);
  }

  // 4. Saturation boost — up to +35%.
  const saturation = 1 + 0.35 * factor;
  pipeline = pipeline.modulate({ saturation });

  // 5. Sharpen — mild unsharp mask, scaled by intensity.
  const sharpenSigma = 0.8 + 1.2 * factor;
  const sharpenM1 = 0.3 + 0.7 * factor;
  pipeline = pipeline.sharpen({ sigma: sharpenSigma, m1: sharpenM1, m2: 0.2 });

  return pipeline;
}

/**
 * Build a flat-color silhouette of a logo: same alpha shape, solid RGB fill.
 * Uses sharp's "dest-in" blend to keep a solid-color layer only where the
 * logo's own alpha is opaque.
 */
async function makeSilhouette(logoPngBuffer, colorRgb, width, height) {
  const solid = await sharp({
    create: { width, height, channels: 4, background: { ...colorRgb, alpha: 1 } }
  })
    .png()
    .toBuffer();

  return sharp(solid).composite([{ input: logoPngBuffer, blend: "dest-in" }]).png().toBuffer();
}

/**
 * Add a black drop shadow and/or a white outline behind a logo (PNG buffer
 * with alpha). sharp has no built-in shadow/outline filter, so both are
 * built from silhouettes of the logo's own alpha shape:
 *   - Shadow: a blurred black silhouette, offset down-right, at reduced opacity.
 *   - Outline: a ring of solid-white silhouettes offset a few px in every
 *     direction, which fills in to a rim around the logo's edges.
 * The canvas is padded so neither effect gets clipped.
 */
async function applyLogoEffects(
  logoPngBuffer,
  { shadow, outline, outlineWidthPercent = 3.5, shadowDistancePercent = 5, shadowAngleDeg = 135 }
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
    const blackSilhouette = await makeSilhouette(logoPngBuffer, { r: 0, g: 0, b: 0 }, width, height);
    const blurredShadow = await sharp(blackSilhouette).blur(shadowBlur).png().toBuffer();
    layers.push({ input: blurredShadow, left: pad + shadowDx, top: pad + shadowDy });
  }

  if (outline) {
    const whiteSilhouette = await makeSilhouette(logoPngBuffer, { r: 255, g: 255, b: 255 }, width, height);
    const ringSteps = 16;
    for (let i = 0; i < ringSteps; i++) {
      const angle = (2 * Math.PI * i) / ringSteps;
      const dx = Math.round(Math.cos(angle) * outlineWidth);
      const dy = Math.round(Math.sin(angle) * outlineWidth);
      layers.push({ input: whiteSilhouette, left: pad + dx, top: pad + dy });
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
 * spacing, sized as a percentage of the base image width so results stay
 * consistent across mixed-resolution source photos.
 */
async function applyLogos(baseSharp, baseMeta, logoPaths, scalePercent, opacityPercent, effects = {}, position = "bottom-right") {
  const targetWidth = Math.max(1, Math.round(baseMeta.width * (scalePercent / 100)));
  const margin = Math.max(4, Math.round(baseMeta.width * 0.015));

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
 * Process a single image end-to-end and return a sharp instance ready to save.
 */
async function buildProcessedImage(imagePath, config) {
  const image = sharp(imagePath);
  const meta = await image.metadata();

  let pipeline = buildEnhancedPipeline(image, config.enhancementIntensity);

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
        shadowAngleDeg: config.logoShadowAngle
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
    .resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside" })
    .jpeg({ quality: 90 })
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
    .resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside" })
    .jpeg({ quality: 90 })
    .toBuffer();

  return {
    originalDataUrl: `data:image/jpeg;base64,${originalBuffer.toString("base64")}`,
    processedDataUrl: `data:image/jpeg;base64,${processedBuffer.toString("base64")}`
  };
}

/**
 * Process one image fully and save it, returning a status record.
 */
async function processOne(imagePath, config) {
  try {
    const { pipeline } = await buildProcessedImage(imagePath, config);
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

      const result = await processOne(imagePath, config);
      doneCount += 1;

      if (result.status === "success") succeeded += 1;
      else if (result.status === "skipped") skipped += 1;
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