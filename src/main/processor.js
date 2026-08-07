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
 * Resize a logo buffer to a target width (percentage of base image width)
 * while preserving aspect ratio and alpha transparency, then apply opacity.
 */
async function prepareLogo(logoPath, targetWidthPx, opacityPercent) {
  const opacity = clampIntensity(opacityPercent);

  let logoSharp = sharp(logoPath).resize({ width: Math.max(1, Math.round(targetWidthPx)) });

  if (opacity < 1) {
    // Multiply the alpha channel by the opacity factor.
    const { data, info } = await logoSharp
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    for (let i = 3; i < data.length; i += 4) {
      data[i] = Math.round(data[i] * opacity);
    }

    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }

  return logoSharp.ensureAlpha().png().toBuffer();
}

/**
 * Composite up to two logos into the bottom-right corner with consistent
 * spacing, sized as a percentage of the base image width so results stay
 * consistent across mixed-resolution source photos.
 */
async function applyLogos(baseSharp, baseMeta, logo1Path, logo2Path, scalePercent, opacityPercent) {
  const targetWidth = Math.max(1, Math.round(baseMeta.width * (scalePercent / 100)));
  const margin = Math.max(4, Math.round(baseMeta.width * 0.015));

  const composites = [];
  let xCursor = baseMeta.width - margin;

  const logoPaths = [logo2Path, logo1Path].filter(Boolean); // reversed so logo1 ends up rightmost

  for (const logoPath of logoPaths) {
    const logoBuffer = await prepareLogo(logoPath, targetWidth, opacityPercent);
    const logoMeta = await sharp(logoBuffer).metadata();
    const x = xCursor - logoMeta.width;
    const y = baseMeta.height - margin - logoMeta.height;
    composites.push({ input: logoBuffer, left: Math.max(0, x), top: Math.max(0, y) });
    xCursor = x - margin;
  }

  return composites.length ? baseSharp.composite(composites) : baseSharp;
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

  if (config.logo1Path || config.logo2Path) {
    // Need the enhanced pixels resolved before compositing, so buffer through.
    const enhancedBuffer = await pipeline.toBuffer();
    const enhancedSharp = sharp(enhancedBuffer);
    pipeline = await applyLogos(enhancedSharp, meta, config.logo1Path, config.logo2Path, config.logoScalePercent, config.logoOpacityPercent);
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
    const filename = path.basename(imagePath);
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