/**
 * processor.js
 * Core image processing engine (Node/sharp) for ACCESS-PhotoProcessor.
 *
 * Two enhancement paths, chosen by config.enhancementFilter:
 *   - "smart" (Smart Enhance): a single fixed-intensity automatic
 *     pipeline — noise reduction goes BEFORE CLAHE so local-contrast
 *     enhancement doesn't amplify grain that denoising would otherwise
 *     smooth away, and sharpen goes LAST so it isn't softened by any step
 *     after it:
 *       1. Normalize (auto white-balance / levels stretch)
 *       2. Auto-exposure (pulls each photo's own mean brightness, measured
 *          AFTER normalize, toward mid-gray — dark photos lighten,
 *          bright/blown photos darken; this is intentionally the last
 *          brightness-affecting step so nothing downstream undoes it)
 *       3. Median filter (light noise reduction)
 *       4. CLAHE (local contrast)
 *       5. Saturation boost
 *       6. Sharpen (unsharp mask)
 *     There's no user-facing intensity slider for this anymore — it
 *     always runs at SMART_ENHANCE_INTENSITY — since the point of Smart
 *     Enhance is that PRISM decides, not the person.
 *   - "vivid" / "bw" (or any further manual tweaking on top of them):
 *     independent Hue, Saturation, Brightness/Value, Contrast, Exposure,
 *     Highlights, Shadows, and Sharpen controls. Picking Vivid or BW in
 *     the UI just seeds these sliders with preset values — from here on
 *     it's the same manual pipeline either way. See buildManualPipeline /
 *     buildToneCurveLUT below.
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png"];

function clampIntensity(intensity) {
  return Math.max(0, Math.min(100, intensity)) / 100;
}

// CLAHE's window size is what determines how "local" its contrast boost
// looks, but a fixed pixel size means the same window covers a wildly
// different fraction of the frame depending on source resolution — 32px is
// a tight, aggressive window on a 6000px-wide photo but a much broader,
// gentler one on a 1200px web export, so the same intensity setting looked
// grittier/more aggressive on big files. Deriving the window as a
// percentage of the shorter side (so portrait/landscape get an equivalent
// relative window regardless of orientation) makes CLAHE's visual strength
// track intensity consistently across resolutions instead of ambushing
// high-res photos with an effectively tinier window. Clamped to a sane
// min/max so tiny thumbnails don't get a degenerate near-zero window and
// huge panoramas don't get a window so large it stops being "local" at all.
const CLAHE_TILE_MIN = 16;
const CLAHE_TILE_MAX = 256;
function computeClaheTileSize(shortSide, subtleToStrongFactor) {
  // subtleToStrongFactor: 0 => subtlest window (larger % of frame),
  // 1 => strongest window (smaller % of frame). Mirrors the old 64->32
  // fixed-pixel range's proportions, just expressed relative to the frame.
  const percentOfShortSide = 0.045 - 0.02 * subtleToStrongFactor; // ~4.5% down to ~2.5%
  const raw = Math.round((shortSide || CLAHE_TILE_MAX) * percentOfShortSide);
  return Math.max(CLAHE_TILE_MIN, Math.min(CLAHE_TILE_MAX, raw));
}

/**
 * Marker written into every saved output's EXIF ImageDescription (see
 * saveProcessed) and checked on every batch input (see
 * hasAlreadyBeenEnhanced) so a re-run can tell "this is a source photo" from
 * "this is a file we already produced." Smart Enhance in particular isn't
 * idempotent — CLAHE and the unsharp mask both compound on their own prior
 * output, so re-running the pipeline on an already-enhanced image doesn't
 * just re-apply the same look, it stacks a second helping of local-contrast
 * boost and sharpening on top of the first, which is hard to visually undo.
 * A plain string search over the raw exif bytes is enough here — we don't
 * need a full EXIF parser (and its dependency) just to detect our own tag.
 */
const ENHANCED_MARKER = "ACCESS-PhotoProcessor:enhanced=1";

/**
 * True if `imagePath`'s EXIF ImageDescription already carries our
 * ENHANCED_MARKER, meaning this file is (or was derived from) a previous
 * run's output rather than an untouched source photo. Used to guard batch
 * re-runs from double-applying Smart Enhance (see ENHANCED_MARKER above).
 * Any read/metadata failure here is treated as "not marked" rather than
 * thrown — this is a best-effort safety net, not the primary error path
 * (buildProcessedImage's own metadata() call handles genuinely unreadable
 * files with a proper user-facing error).
 */
async function hasAlreadyBeenEnhanced(imagePath) {
  try {
    const meta = await sharp(imagePath).metadata();
    if (!meta.exif) return false;
    return meta.exif.includes(Buffer.from(ENHANCED_MARKER, "ascii"));
  } catch (err) {
    return false;
  }
}

/**
 * Measure a robust brightness value for `pipeline`'s CURRENT output (i.e.
 * whatever operations have already been chained onto it), as a trimmed
 * mean of per-pixel luminance between the 25th and 75th percentiles.
 *
 * A straight channel mean (sharp's .stats() "mean") is what auto-exposure
 * used to key off of, and it's easily dragged around by outlier regions —
 * a bright sky filling a third of the frame, or a dark background behind a
 * well-lit subject, shifts the mean even though the subject itself is
 * exposed fine. Trimming to the interquartile range discards exactly those
 * extremes (the brightest and darkest quarters of pixels) and averages
 * what's left, which tracks the bulk/subject of the frame far more
 * reliably. A plain median would also solve the outlier problem, but
 * throwing away only the top and bottom quartiles (rather than everything
 * but the single middle value) keeps a bit more of the midtone spread and
 * is less jumpy frame-to-frame on images with a big flat midtone region.
 *
 * Computed on a small downscaled copy purely for speed — luminance
 * distribution is a global statistic that doesn't need full resolution,
 * and resizing first keeps this cheap even on large source photos.
 */
// Reference noise std-dev (in 0-255 luminance levels) used to normalize the
// flat-region variance estimate below into a 0-1 noiseLevel. Chosen from
// rough real-world anchors: a tripod/low-ISO shot's flat regions (a wall,
// out-of-focus background, sky) typically sit at a std-dev of ~1-3; a
// noisy high-ISO phone shot commonly sits at ~10-15+ in the same kind of
// region. 15 puts that noisy-phone case at/near noiseLevel 1 (fully
// clamped) while still leaving headroom to distinguish clean vs. moderately
// noisy photos in between.
const NOISE_REF_STDDEV = 15;

/**
 * Median-filter only the chroma (color) information, leaving luma
 * (brightness/detail) untouched. A flat median() on RGB filters R/G/B
 * independently, which softens real edge detail (hair, texture, fine
 * structure) right along with the color speckle it's actually meant to
 * remove — because in RGB, luma-carried detail and chroma noise are mixed
 * into every channel. Most of the visibly objectionable noise in
 * phone/high-ISO photos is chroma speckle, not luma grain, so separating
 * the two and only median-filtering chroma kills the color noise while
 * keeping edges/texture sharp.
 *
 * Uses a YCbCr-style linear luma/chroma split (BT.601 coefficients) rather
 * than a perceptual space like Lab: it's a simple, exactly-invertible
 * linear transform we can do ourselves in one pass over the raw pixel
 * buffer, which sidesteps a real limitation of doing this through sharp's
 * own colourspace pipeline — sharp/libvips tags a raw 3-channel buffer's
 * interpretation from its channel count on ingestion, so round-tripping
 * through something like `.toColourspace('lab')` and back via a
 * raw-buffer join can't be reliably re-tagged as Lab before the return
 * conversion, risking a silently wrong color transform. A hand-rolled
 * YCbCr split has no such ambiguity.
 *
 * This necessarily buffers the full-resolution pixel data (two JS passes:
 * one to split, one to recombine after filtering Cb/Cr), unlike the
 * streamed sharp pipeline everywhere else in this file. That's an
 * accepted one-time cost during Smart Enhance, which isn't a hot path.
 */
// Gradient magnitude (Sobel, roughly on a 0-255*4 scale) above which a
// pixel is considered part of a real edge rather than flat/noisy texture,
// used by the edge-preserving luma pass below. Chosen so typical
// sensor-noise-level gradients (a few levels of speckle between
// neighbouring pixels) fall well under the threshold and get smoothed,
// while genuine edges (hair strands, fabric weave, outlines) — which
// produce much larger neighbour deltas — are recognized and left alone.
const EDGE_PRESERVE_GRADIENT_REF = 24;

/**
 * Sobel gradient magnitude of a single-channel byte buffer, same
 * width/height. Pure JS (no sharp round-trip) since this needs to stay
 * aligned pixel-for-pixel with the median-filtered buffer it's blended
 * against below, and it's already operating on an in-memory typed array.
 * Edges of the frame clamp to the nearest interior row/col rather than
 * wrapping or zero-padding, which would otherwise fabricate a fake
 * high-gradient border.
 */
function sobelMagnitude(channel, width, height) {
  const out = new Float32Array(width * height);
  for (let yy = 0; yy < height; yy++) {
    const y0 = Math.max(0, yy - 1);
    const y1 = Math.min(height - 1, yy + 1);
    for (let xx = 0; xx < width; xx++) {
      const x0 = Math.max(0, xx - 1);
      const x1 = Math.min(width - 1, xx + 1);

      const tl = channel[y0 * width + x0], tc = channel[y0 * width + xx], tr = channel[y0 * width + x1];
      const ml = channel[yy * width + x0], mr = channel[yy * width + x1];
      const bl = channel[y1 * width + x0], bc = channel[y1 * width + xx], br = channel[y1 * width + x1];

      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      out[yy * width + xx] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/**
 * Median-filter chroma (color) unconditionally, and OPTIONALLY apply an
 * edge-preserving smoothing pass to luma when `edgePreserveLuma` is set.
 *
 * Chroma: a flat median() on RGB filters R/G/B independently, which softens
 * real edge detail (hair, texture, fine structure) right along with the
 * color speckle it's actually meant to remove — because in RGB, luma-carried
 * detail and chroma noise are mixed into every channel. Most of the visibly
 * objectionable noise in phone/high-ISO photos is chroma speckle, not luma
 * grain, so separating the two and only median-filtering chroma kills the
 * color noise while keeping edges/texture sharp.
 *
 * Luma (only at higher measured noise levels — see NOISE_EDGE_PRESERVE_
 * THRESHOLD in buildAutoPipeline): a plain median at a wider kernel (5) also
 * starts visibly softening real detail — fine hair, fabric texture — right
 * along with the grain it's targeting, and that's most noticeable on
 * exactly the noisier source photos this branch handles. Rather than reach
 * for a true bilateral filter (sharp/libvips doesn't expose one directly,
 * and a from-scratch spatial+range-weighted bilateral over a full-res image
 * in JS is expensive), this blends the median-filtered luma with the
 * original per pixel, weighted by local Sobel gradient magnitude:
 * flat/low-gradient pixels (grain, smooth skin, sky) are pulled toward the
 * fully median-smoothed value, while high-gradient pixels (an edge, a hair
 * strand) are kept close to the original, unsmoothed value. That's a cheap,
 * local approximation of what a bilateral/edge-preserving filter buys you —
 * the denoise step stops fighting real detail, so the later sharpen step
 * isn't stuck re-adding detail this step never should have removed.
 *
 * Uses a YCbCr-style linear luma/chroma split (BT.601 coefficients) rather
 * than a perceptual space like Lab: it's a simple, exactly-invertible
 * linear transform we can do ourselves in one pass over the raw pixel
 * buffer, which sidesteps a real limitation of doing this through sharp's
 * own colourspace pipeline — sharp/libvips tags a raw 3-channel buffer's
 * interpretation from its channel count on ingestion, so round-tripping
 * through something like `.toColourspace('lab')` and back via a
 * raw-buffer join can't be reliably re-tagged as Lab before the return
 * conversion, risking a silently wrong color transform. A hand-rolled
 * YCbCr split has no such ambiguity.
 *
 * This necessarily buffers the full-resolution pixel data (two JS passes:
 * one to split, one to recombine after filtering Cb/Cr, plus one more for
 * the Sobel/blend when edgePreserveLuma is set), unlike the streamed sharp
 * pipeline everywhere else in this file. That's an accepted one-time cost
 * during Smart Enhance, which isn't a hot path.
 */
async function denoiseChromaOnly(pipeline, kernel, edgePreserveLuma) {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const hasAlpha = channels === 4;
  const pixelCount = width * height;

  const y = new Uint8ClampedArray(pixelCount);
  const cb = new Uint8ClampedArray(pixelCount);
  const cr = new Uint8ClampedArray(pixelCount);

  for (let p = 0, i = 0; p < pixelCount; p += 1, i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    y[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    cb[p] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    cr[p] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }

  // IMPORTANT: sharp/libvips silently promotes a single-channel ("b-w") raw
  // buffer to a 3-channel one once it's run through an operator like
  // .median() — the pixel data comes back 3x longer than expected. Without
  // forcing it back to single-channel via .toColourspace("b-w") before
  // .raw().toBuffer(), the code below ends up indexing that 3-channel
  // buffer as if it were still 1 channel (filteredCb[p] / filteredCr[p]),
  // reading misaligned/interleaved bytes as chroma. That's what was
  // producing the near-total desaturation plus periodic colored streaks:
  // the reconstructed Cb/Cr (and, when edgePreserveLuma, luma) values were
  // effectively garbage.
  const filterPromises = [
    sharp(Buffer.from(cb), { raw: { width, height, channels: 1 } })
      .median(kernel)
      .toColourspace("b-w")
      .raw()
      .toBuffer(),
    sharp(Buffer.from(cr), { raw: { width, height, channels: 1 } })
      .median(kernel)
      .toColourspace("b-w")
      .raw()
      .toBuffer()
  ];
  if (edgePreserveLuma) {
    filterPromises.push(
      sharp(Buffer.from(y), { raw: { width, height, channels: 1 } })
        .median(kernel)
        .toColourspace("b-w")
        .raw()
        .toBuffer()
    );
  }

  const [filteredCb, filteredCr, medianY] = await Promise.all(filterPromises);

  // Blend original vs. median-filtered luma per pixel by local edge
  // strength (see function doc above). Skipped entirely when
  // edgePreserveLuma is false, leaving luma untouched as before (matches
  // the pre-edge-preserving behavior for lower-noise photos).
  let finalY = y;
  if (edgePreserveLuma) {
    const gradient = sobelMagnitude(y, width, height);
    finalY = new Uint8ClampedArray(pixelCount);
    for (let p = 0; p < pixelCount; p++) {
      // edgeWeight: 0 on flat/noisy regions (fully smoothed), 1 on strong
      // edges (kept at the original, unsmoothed value).
      const edgeWeight = Math.max(0, Math.min(1, gradient[p] / EDGE_PRESERVE_GRADIENT_REF));
      finalY[p] = edgeWeight * y[p] + (1 - edgeWeight) * medianY[p];
    }
  }

  const out = Buffer.alloc(pixelCount * channels);
  for (let p = 0, i = 0; p < pixelCount; p += 1, i += channels) {
    const Y = finalY[p];
    const Cb = filteredCb[p] - 128;
    const Cr = filteredCr[p] - 128;
    out[i] = clampByte(Y + 1.402 * Cr);
    out[i + 1] = clampByte(Y - 0.344136 * Cb - 0.714136 * Cr);
    out[i + 2] = clampByte(Y + 1.772 * Cb);
    if (hasAlpha) out[i + 3] = data[i + 3];
  }

  return sharp(out, { raw: { width, height, channels } });
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

// Reference block std-dev used to normalize the *mid-range* block-variance
// estimate below into a 0-1 localContrastLevel. A photo with already-strong
// local contrast (well-lit, distinct subject separation) tends to have a
// median block std-dev in the ~20-30 range; a flat, low-contrast photo
// (overcast light, hazy, low dynamic range) sits closer to ~5-10.
const CONTRAST_REF_STDDEV = 25;

/**
 * Measure this pipeline's CURRENT output (i.e. whatever's already been
 * chained onto it) for two things in one pass over the same downscaled
 * sample, since both are read off the same decoded pixels:
 *
 *   - robustLuminance: a trimmed mean of per-pixel luminance between the
 *     25th and 75th percentiles, used for auto-exposure. A straight
 *     channel mean (sharp's .stats() "mean") is easily dragged around by
 *     outlier regions — a bright sky or dark background filling part of
 *     the frame reads the whole photo as over/under-exposed even when the
 *     subject itself is fine. Trimming the extremes before averaging
 *     targets the actual bulk of the frame instead.
 *
 *   - noiseLevel: a 0-1 estimate of sensor noise/grain, used to keep CLAHE
 *     and the median filter content-aware instead of applying the same
 *     fixed settings to every photo at a given intensity. Estimated from
 *     the variance within small local blocks, using a LOW percentile
 *     across those blocks rather than the overall variance: a block that
 *     falls in a flat/low-detail area of the photo (sky, wall, out-of-
 *     focus background) has essentially no real structure, so its
 *     variance is almost entirely noise, whereas high-variance blocks are
 *     usually real detail/edges, not grain. Taking a low percentile
 *     across all blocks biases the estimate toward those flat blocks
 *     without requiring segmentation to find them. A tripod/low-ISO photo
 *     will have very low variance even in its flattest patches (noiseLevel
 *     near 0); a noisy high-ISO/phone shot won't have any patch that flat
 *     (noiseLevel near 1).
 *
 * Computed on a small downscaled copy purely for speed — both are global
 * statistics that don't need full resolution, and resizing first keeps
 * this cheap even on large source photos.
 */
async function measureImageStats(pipeline) {
  const SAMPLE_MAX = 200; // downscale target for measurement only
  const { data, info } = await pipeline
    .clone()
    .resize({ width: SAMPLE_MAX, height: SAMPLE_MAX, fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const width = info.width;
  const height = info.height;
  const pixelCount = width * height;
  const luminances = new Float64Array(pixelCount);

  if (channels >= 3) {
    for (let i = 0, p = 0; p < pixelCount; i += 1, p += 1) {
      const base = i * channels;
      luminances[p] = 0.2126 * data[base] + 0.7152 * data[base + 1] + 0.0722 * data[base + 2];
    }
  } else {
    for (let i = 0, p = 0; p < pixelCount; i += 1, p += 1) {
      luminances[p] = data[i * channels];
    }
  }

  // --- Saturation estimate: mean HSL saturation across sampled pixels,
  // used to scale the saturation boost step below so it behaves like
  // vibrance rather than a flat percentage bump — muted/desaturated photos
  // get pushed closer to the full boost, already-vivid photos get much
  // less, so a flat +N% can't drive already-saturated regions into
  // clipping. Cheap to fold into the same pass over `data` used for
  // luminance above, before it's touched again below.
  let saturationLevel = 0;
  if (channels >= 3) {
    let satSum = 0;
    for (let i = 0, p = 0; p < pixelCount; i += 1, p += 1) {
      const base = i * channels;
      const r = data[base] / 255;
      const g = data[base + 1] / 255;
      const b = data[base + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max !== min) {
        const lightness = (max + min) / 2;
        satSum += lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
      }
    }
    saturationLevel = satSum / pixelCount;
  }

  // --- Noise estimate: variance within small blocks, low percentile across
  // blocks. Must run BEFORE the luminance array is sorted below, since it
  // needs the pixels in their original row-major/spatial order.
  const BLOCK = 8;
  const blocksX = Math.max(1, Math.floor(width / BLOCK));
  const blocksY = Math.max(1, Math.floor(height / BLOCK));
  const blockVariances = [];

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      const x0 = bx * BLOCK;
      const y0 = by * BLOCK;
      for (let y = y0; y < y0 + BLOCK; y++) {
        const rowOffset = y * width;
        for (let x = x0; x < x0 + BLOCK; x++) {
          const v = luminances[rowOffset + x];
          sum += v;
          sumSq += v * v;
          n++;
        }
      }
      const mean = sum / n;
      const variance = Math.max(0, sumSq / n - mean * mean);
      blockVariances.push(variance);
    }
  }

  blockVariances.sort((a, b) => a - b);
  const flatIdx = Math.max(0, Math.floor(blockVariances.length * 0.2));
  const flatVariance = blockVariances[flatIdx] || 0;
  const flatStdDev = Math.sqrt(flatVariance);
  const noiseLevel = Math.max(0, Math.min(1, flatStdDev / NOISE_REF_STDDEV));

  // Local contrast: median block variance (not the low-percentile one noise
  // uses) — flat/noise-only blocks get diluted out by the typical/detail
  // blocks that dominate the middle of the sorted distribution.
  const midIdx = Math.floor(blockVariances.length * 0.5);
  const midVariance = blockVariances[midIdx] || 0;
  const midStdDev = Math.sqrt(midVariance);
  const localContrastLevel = Math.max(0, Math.min(1, midStdDev / CONTRAST_REF_STDDEV));

  // --- Robust luminance: trimmed mean of the interquartile range.
  luminances.sort();

  const lowerIdx = Math.floor(pixelCount * 0.25);
  const upperIdx = Math.ceil(pixelCount * 0.75);
  let sum = 0;
  let count = 0;
  for (let p = lowerIdx; p < upperIdx; p++) {
    sum += luminances[p];
    count++;
  }

  // Degenerate/tiny-sample fallback (shouldn't happen at SAMPLE_MAX, but
  // guards against an empty slice on pathological inputs).
  const robustLuminance = count > 0 ? sum / count : luminances[Math.floor(pixelCount / 2)];

  return { robustLuminance, noiseLevel, localContrastLevel, saturationLevel };
}

// Smart Enhance no longer exposes an intensity slider in the UI — it's an
// automatic, per-image decision. Falls back to this fixed strength when
// config.enhancementIntensity isn't set (also used as-is for any config
// saved before the intensity slider was removed).
const SMART_ENHANCE_INTENSITY = 60;

/**
 * Build a sharp pipeline with the Smart Enhance steps applied, scaled by
 * a single 0-100 intensity value (see SMART_ENHANCE_INTENSITY — there's
 * no slider for this anymore, so callers pass the fixed constant).
 */
async function buildAutoPipeline(image, intensity, meta) {
  const factor = clampIntensity(intensity);
  if (factor === 0) return { pipeline: image, telemetry: null };

  let pipeline = image;
  const shortSide = meta && meta.width && meta.height ? Math.min(meta.width, meta.height) : undefined;

  // 1. Normalize — auto-levels stretch, a reasonable stand-in for white
  // balance. Runs FIRST, before exposure is measured/applied: normalise()
  // re-anchors the black/white points from percentiles of whatever it's
  // given, which would otherwise silently undo an exposure shift applied
  // before it (this used to run after exposure and was cancelling most of
  // the brightening on underexposed photos, leaving them still too dark).
  pipeline = pipeline.normalise({ lower: 1, upper: 99 });

  // 0. Auto-exposure — measure THIS pipeline's brightness (i.e. after
  // normalize, not the raw source) and pull it toward a mid-gray target, so
  // dark photos lighten and bright/washed-out photos come back down,
  // instead of applying the same fixed brightness to every image regardless
  // of how it was shot. Measuring/applying this last (of the
  // brightness-affecting steps) means it's the final word on exposure
  // instead of being overwritten by a later stage.
  //
  // Uses a robust (25th-75th percentile trimmed-mean) luminance rather than
  // the straight channel mean: a plain mean gets dragged around by outlier
  // regions — a bright sky or a dark background filling part of the frame —
  // and reads the whole photo as over/under-exposed even when the subject
  // itself is fine. Trimming the extremes before averaging targets the
  // actual bulk of the frame instead. This same pass also estimates the
  // photo's noise level, reused below to keep the median filter and CLAHE's
  // clip limit content-aware rather than fixed. See measureImageStats().
  const { robustLuminance, noiseLevel, localContrastLevel, saturationLevel } = await measureImageStats(pipeline);

  const TARGET_MEAN = 128; // mid-gray target for a "well exposed" photo
  const MAX_SHIFT = 45; // cap how hard we'll push an extremely under/over-exposed photo
  const rawDelta = TARGET_MEAN - robustLuminance;
  const clampedDelta = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, rawDelta));
  const exposureShift = clampedDelta * factor; // scaled by the intensity slider

  if (Math.abs(exposureShift) > 0.5) {
    pipeline = pipeline.linear(1, exposureShift);
  }

  // 4. Median filter — light noise reduction. Runs BEFORE CLAHE: CLAHE
  // amplifies local contrast, which amplifies sensor noise/grain right
  // along with it, so denoising has to happen first or the median filter
  // is stuck cleaning up noise that's already been exaggerated (this used
  // to run after CLAHE and was the source of the graininess — a light 3x3
  // median can't fully undo noise CLAHE already punched up, and saturation
  // + sharpen after that just made the leftover grain more visible).
  //
  // Both whether we bother and how strong a kernel we use now follow the
  // measured noiseLevel instead of a flat rule: a clean tripod/low-ISO shot
  // has nothing worth median-filtering (skipping it preserves real detail
  // that a median would otherwise soften for no benefit), while a noisy
  // high-ISO/phone shot needs a wider kernel than 3x3 to actually knock the
  // grain down before CLAHE gets to it. The old flat "factor > 0.15" gate
  // is kept as an outer bound — at very low enhancement intensity we still
  // don't want to touch the image regardless of noise.
  const NOISE_MEDIAN_THRESHOLD = 0.1; // below this, treat the photo as clean enough to skip
  // Above this, a flat median at the wider kernel starts visibly softening
  // real detail (fine hair, texture) right along with the grain — see
  // denoiseChromaOnly's doc comment. Past this point we switch luma from a
  // flat median to the gradient-weighted edge-preserving blend so the
  // sharpen step isn't left re-adding detail this step never should have
  // removed.
  const NOISE_EDGE_PRESERVE_THRESHOLD = 0.5;
  // Telemetry (see the ask that added this): captures "how hard did we push
  // it" per-photo so the adaptive thresholds above (NOISE_MEDIAN_THRESHOLD,
  // CLAHE_SKIP_THRESHOLD, the noiseLevel-driven damping curves, etc.) can
  // eventually be tuned from real batch data instead of the estimated
  // constants currently hardcoded. Populated as each stage runs/skips below;
  // returned alongside the pipeline rather than logged here directly, since
  // this function doesn't know whether it's building a preview or a batch
  // image (see callers for how it's surfaced).
  const medianApplied = factor > 0.15 && noiseLevel > NOISE_MEDIAN_THRESHOLD;
  let medianKernel = null;
  let edgePreserveLuma = false;
  if (medianApplied) {
    edgePreserveLuma = noiseLevel > NOISE_EDGE_PRESERVE_THRESHOLD;
    medianKernel = edgePreserveLuma ? 5 : 3;
    // Chroma always gets a plain median (color noise has no real "edges"
    // worth preserving); luma gets the same treatment at low noise, or the
    // edge-preserving blend above the threshold. See denoiseChromaOnly().
    pipeline = await denoiseChromaOnly(pipeline, medianKernel, edgePreserveLuma);
  }

  // 3. CLAHE — local contrast enhancement. Larger window = subtler effect.
  // Skipped when the photo already has strong local contrast: pushing CLAHE
  // on top of that mostly adds haloing/noise rather than visible
  // improvement, the same reasoning as the median skip above. The old flat
  // "factor > 0.15" gate is kept as an outer bound for the same reason it's
  // kept on the median step.
  const CLAHE_SKIP_THRESHOLD = 0.55; // above this, treat local contrast as already strong enough
  const claheApplied = factor > 0.15 && localContrastLevel < CLAHE_SKIP_THRESHOLD;
  let claheWidth = null;
  let claheMaxSlope = null;
  if (claheApplied) {
    // Tile size is a percentage of the shorter side (see
    // computeClaheTileSize) rather than a fixed pixel count, so the same
    // intensity looks equally strong regardless of source resolution.
    claheWidth = computeClaheTileSize(shortSide, factor);
    // maxSlope (the clip limit) scales with intensity as before (1..3), but
    // is now also pulled down by measured noise: a genuinely low-noise,
    // high-detail photo can take the full intensity-driven gain without
    // going grainy, while a noisy photo would have that same gain amplify
    // its grain right along with real local contrast. At noiseLevel 0 this
    // is unchanged from before; at noiseLevel 1 it's cut by half (floored at
    // 1, CLAHE's minimum/no-op clip limit).
    claheMaxSlope = Math.max(1, Math.round((1 + 2 * factor) * (1 - 0.5 * noiseLevel)));
    pipeline = pipeline.clahe({
      width: Math.max(8, claheWidth),
      height: Math.max(8, claheWidth),
      maxSlope: claheMaxSlope
    });
  }

  // 5. Saturation boost — vibrance-like rather than a flat +35%: scaled
  // down by the photo's own measured saturationLevel, so a muted/desaturated
  // photo gets pushed close to the full boost while an already-vivid photo
  // gets much less, instead of the same flat percentage risking clipping on
  // top of colors that are already saturated.
  const SATURATION_BOOST_MAX = 0.35;
  const saturationHeadroom = 1 - saturationLevel; // less boost as the photo is already more saturated
  const saturation = 1 + SATURATION_BOOST_MAX * factor * saturationHeadroom;
  pipeline = pipeline.modulate({ saturation });

  // 6. Sharpen — mild unsharp mask, scaled by intensity. Also damped by the
  // same noiseLevel used for the median/CLAHE steps above: a photo that
  // came in clean sharpens at full strength, but a noisy photo — even after
  // the median filter above — still has residual grain, and unsharp mask's
  // "flat area" amount (m1) is exactly the knob that amplifies fine texture
  // in low-detail regions, which is indistinguishable from grain to the
  // algorithm. Without this, a noisy photo gets its median-filtered grain
  // sharpened right back up. Two things move with noiseLevel:
  //   - m1 (flat-area sharpen strength) is scaled down, floored at 40% of
  //     its intensity-driven value — mirrors the CLAHE maxSlope damping
  //     above, same reasoning: don't remove the effect entirely, just don't
  //     let it push as hard on a photo whose flat regions are noisy.
  //   - x1 (the flat-vs-jagged threshold) is raised, so small brightness
  //     deltas — the size grain deltas typically are — fall under the
  //     threshold and get treated as "flat" (m1, now damped) rather than
  //     "jagged" (m2, left at full edge-sharpening strength). This is the
  //     standard unsharp-mask noise gate: raise the threshold so real edges
  //     (large deltas) still get the full m2 sharpen while noise doesn't.
  const sharpenSigma = 0.8 + 1.2 * factor;
  const sharpenM1 = (0.3 + 0.7 * factor) * (1 - 0.6 * noiseLevel);
  const sharpenX1 = 2 + 4 * noiseLevel; // sharp's default x1 is 2; noisier photos push this up
  pipeline = pipeline.sharpen({ sigma: sharpenSigma, m1: sharpenM1, m2: 0.2, x1: sharpenX1 });

  // See the medianApplied/claheApplied telemetry comment above — this is
  // the full "how hard did we push it" record for this image's Smart
  // Enhance pass. Rounded to keep log output readable; these are tuning
  // signals, not precision measurements.
  const telemetry = {
    noiseLevel: Math.round(noiseLevel * 1000) / 1000,
    localContrastLevel: Math.round(localContrastLevel * 1000) / 1000,
    saturationLevel: Math.round(saturationLevel * 1000) / 1000,
    intensity: Math.round(factor * 100),
    median: medianApplied ? { kernel: medianKernel, edgePreserveLuma } : { applied: false },
    clahe: claheApplied ? { width: claheWidth, maxSlope: claheMaxSlope } : { applied: false },
    sharpen: {
      sigma: Math.round(sharpenSigma * 1000) / 1000,
      m1: Math.round(sharpenM1 * 1000) / 1000,
      x1: Math.round(sharpenX1 * 1000) / 1000
    }
  };

  return { pipeline, telemetry };
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
function buildToneCurveLUT({ exposure = 0, contrast = 0, highlights = 0, shadows = 0, whites = 0, blacks = 0 }) {
  const lut = new Uint8ClampedArray(256);

  const exposureFactor = Math.pow(2, (exposure / 100) * 2); // -100..100 -> 0.25x..4x
  const contrastFactor = 1 + contrast / 100; // -100..100 -> 0..2x
  const highlightsAmount = (highlights / 100) * 80; // up to +-80 levels
  const shadowsAmount = (shadows / 100) * 80;
  // Whites/Blacks push the extreme ends of the range (near-white / near-black
  // levels) rather than the broader upper-mid/lower-mid range Highlights and
  // Shadows target — a steeper (t^4) weighting keeps each mostly clear of the
  // other pair's territory.
  const whitesAmount = (whites / 100) * 100;
  const blacksAmount = (blacks / 100) * 100;

  for (let x = 0; x < 256; x++) {
    let y = x * exposureFactor;

    const t = x / 255;
    const highlightWeight = t * t;
    const shadowWeight = (1 - t) * (1 - t);
    const whiteWeight = t * t * t * t;
    const blackWeight = (1 - t) * (1 - t) * (1 - t) * (1 - t);
    y += highlightsAmount * highlightWeight;
    y += shadowsAmount * shadowWeight;
    y += whitesAmount * whiteWeight;
    y += blacksAmount * blackWeight;

    y = 128 + (y - 128) * contrastFactor;

    lut[x] = Math.max(0, Math.min(255, Math.round(y)));
  }

  return lut;
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Build a sharp pipeline for "Manual" mode. Order of operations, matching
 * a typical raw-editor stack from bottom to top:
 *   1. White Balance (Temperature, Tint) + Light (Exposure, Contrast,
 *      Highlights, Shadows, Whites, Blacks) + Vignette — all folded into a
 *      single raw-pixel pass (tone curve is a per-channel LUT; temperature/
 *      tint/vignette need per-pixel or per-channel math a LUT alone can't
 *      express, so they're applied in the same loop rather than as separate
 *      sharp operations).
 *   2. Invert (sharp's native negate).
 *   3. Color (Hue, Vibrance, Saturation) + Light's Brightness (Value), via
 *      sharp's native (fast, high quality) modulate.
 *   4. Texture: Clarity (local contrast) then Sharpness (unsharp mask) —
 *      sharpen goes last so it isn't softened by any step after it.
 */
async function buildManualPipeline(image, config, meta) {
  const shortSide = meta && meta.width && meta.height ? Math.min(meta.width, meta.height) : undefined;
  const {
    manualTemperature = 0,
    manualTint = 0,
    manualExposure = 0,
    manualContrast = 0,
    manualHighlights = 0,
    manualShadows = 0,
    manualWhites = 0,
    manualBlacks = 0,
    manualHue = 0,
    manualVibrance = 0,
    manualSaturation = 0,
    manualBrightness = 0,
    manualInvert = false,
    manualSharpen = 0,
    manualClarity = 0,
    manualVignette = 0
  } = config;

  let working = image;

  const needsToneCurve =
    manualExposure !== 0 || manualContrast !== 0 || manualHighlights !== 0 || manualShadows !== 0 ||
    manualWhites !== 0 || manualBlacks !== 0;
  const needsWhiteBalance = manualTemperature !== 0 || manualTint !== 0;
  const needsVignette = manualVignette !== 0;

  if (needsToneCurve || needsWhiteBalance || needsVignette) {
    const lut = needsToneCurve
      ? buildToneCurveLUT({
          exposure: manualExposure,
          contrast: manualContrast,
          highlights: manualHighlights,
          shadows: manualShadows,
          whites: manualWhites,
          blacks: manualBlacks
        })
      : null;

    const { data, info } = await working.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const width = info.width;

    // Temperature: push red up / blue down for warmer, the reverse for
    // cooler. Tint: push green down / magenta (red+blue) up for one
    // direction, the reverse for the other — matches the amber<->blue and
    // green<->magenta axes shown in the White Balance sliders.
    const tempShift = (manualTemperature / 100) * 40; // +-40 levels
    const tintShift = (manualTint / 100) * 40;

    // Vignette: radial multiplier from image center to corner. Positive
    // darkens the edges, negative lightens them.
    const vignetteStrength = Math.max(-100, Math.min(100, manualVignette)) / 100;
    const cx = width / 2;
    const cy = info.height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy) || 1;

    let pixelIndex = 0;
    for (let i = 0; i < data.length; i += channels, pixelIndex++) {
      let r = lut ? lut[data[i]] : data[i];
      let g = lut ? lut[data[i + 1]] : data[i + 1];
      let b = lut ? lut[data[i + 2]] : data[i + 2];

      if (needsWhiteBalance) {
        r = r + tempShift - tintShift * 0.5;
        b = b - tempShift - tintShift * 0.5;
        g = g + tintShift;
      }

      if (needsVignette) {
        const x = pixelIndex % width;
        const y = (pixelIndex / width) | 0;
        const dx = x - cx;
        const dy = y - cy;
        const distT = Math.sqrt(dx * dx + dy * dy) / maxDist; // 0 center -> 1 corner
        const falloff = distT * distT;
        const factor = 1 - vignetteStrength * falloff * 0.85;
        r *= factor;
        g *= factor;
        b *= factor;
      }

      data[i] = clamp255(r);
      data[i + 1] = clamp255(g);
      data[i + 2] = clamp255(b);
      // alpha (data[i + 3]) left untouched
    }

    working = sharp(data, { raw: { width: info.width, height: info.height, channels } });
  }

  let pipeline = working;

  if (manualInvert) {
    pipeline = pipeline.negate({ alpha: false });
  }

  const hueDeg = Math.round(manualHue) % 360;
  // Vibrance is meant to boost muted colors more than already-saturated
  // ones, while Saturation applies evenly. sharp's modulate() only offers
  // one uniform saturation control, so as a practical approximation we
  // fold Vibrance in at reduced strength alongside Saturation rather than
  // giving it a fully independent, selectivity-aware implementation.
  const satMultiplier = Math.max(0, 1 + (manualSaturation + manualVibrance * 0.6) / 100);
  const brightnessMultiplier = Math.max(0, 1 + manualBrightness / 100);

  if (hueDeg !== 0 || manualSaturation !== 0 || manualVibrance !== 0 || manualBrightness !== 0) {
    pipeline = pipeline.modulate({
      hue: hueDeg,
      saturation: satMultiplier,
      brightness: brightnessMultiplier
    });
  }

  // Clarity: local (midtone) contrast. Positive uses CLAHE to punch up
  // local contrast; negative softens it slightly instead (there's no
  // built-in "un-CLAHE", so a gentle blur stands in for reduced clarity).
  if (manualClarity !== 0) {
    const amount = Math.max(-100, Math.min(100, manualClarity)) / 100;
    if (amount > 0) {
      const claheWidth = computeClaheTileSize(shortSide, amount);
      pipeline = pipeline.clahe({
        width: claheWidth,
        height: claheWidth,
        maxSlope: 1 + Math.round(2 * amount)
      });
    } else {
      pipeline = pipeline.blur(1 + Math.abs(amount) * 1.5);
    }
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
 * Dispatches to the Smart Enhance (fixed-intensity automatic) or manual
 * (per-property, includes Vivid/BW presets) pipeline based on
 * config.enhancementFilter.
 *
 * "vivid" / "bw" / "manual" all go through the manual pipeline — picking
 * Vivid or BW in the UI just seeds the manual sliders with preset values
 * (and picking a saved preset seeds them with the person's own saved
 * values), and "manual" is the bare mode with no seeding at all. From
 * there it's the same manual pipeline in every case, whether or not the
 * person nudges the sliders further. Everything else, including "smart",
 * undefined, and the old pre-Smart-Enhance "natural" value from configs
 * saved before this change, runs Smart Enhance.
 *
 * config.enhancementMode === "manual" is also honored, but ONLY when
 * enhancementFilter isn't explicitly "smart" — it exists purely for
 * backward compatibility with configs saved before enhancementFilter
 * existed at all. An explicit "smart" filter must always win: without
 * this guard, a stale enhancementMode: "manual" left over in a user's
 * settings.json from an older app version (nothing in the current UI
 * ever clears that field) would silently keep running the manual
 * pipeline — applying whatever Vivid/BW values happened to be sitting
 * in config — even after switching to Smart Enhance.
 */
async function buildEnhancedPipeline(image, config, meta) {
  const filter = config.enhancementFilter;
  const usesManualPipeline =
    filter === "vivid" || filter === "bw" || filter === "manual" || (filter !== "smart" && config.enhancementMode === "manual");

  if (usesManualPipeline) {
    // Manual pipeline has no adaptive noise/contrast-driven params — every
    // slider value comes straight from config, so there's nothing to log
    // for the "how hard did we push it" telemetry below.
    return { pipeline: await buildManualPipeline(image, config, meta), telemetry: null };
  }
  return buildAutoPipeline(image, config.enhancementIntensity ?? SMART_ENHANCE_INTENSITY, meta);
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

  const buffer = await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite(layers)
    .png()
    .toBuffer();

  // Report how much the canvas grew so callers can re-anchor placement on
  // the actual logo artwork (see `pad` usage in prepareLogo/applyLogos)
  // instead of the padded box — otherwise turning on a shadow/outline
  // would visibly push the watermark itself further from the corner and
  // widen the gaps between multiple watermarks, when only the shadow
  // should be spilling outward.
  return { buffer, pad };
}

/**
 * Fit a logo into a square box (side length = a percentage of base image
 * width) while preserving its own aspect ratio and alpha transparency —
 * so every logo occupies the same footprint regardless of its original
 * shape — then optionally apply a drop shadow and/or white outline, then
 * apply overall opacity.
 */
async function prepareLogo(logoPath, targetHeightPx, opacityPercent, effects = {}) {
  const opacity = clampIntensity(opacityPercent);
  const targetHeight = Math.max(1, Math.round(targetHeightPx));

  let buffer;

  try {
    // Resize by HEIGHT only.
    // Width is calculated automatically from the logo's original aspect ratio.
    // No trim and no containing box.
    buffer = await sharp(logoPath)
      .ensureAlpha()
      .resize({
        height: targetHeight,
        fit: "inside",
        withoutEnlargement: false
      })
      .ensureAlpha()
      .png()
      .toBuffer();
  } catch (err) {
    const name = path.basename(logoPath);
    throw new Error(
      `Logo "${name}" could not be read (${err.message}). Choose a different image file.`
    );
  }

  let pad = 0;

  if (effects.shadow || effects.outline) {
    ({ buffer, pad } = await applyLogoEffects(buffer, effects));
  }

  if (opacity < 1) {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    for (let i = 3; i < data.length; i += 4) {
      data[i] = Math.round(data[i] * opacity);
    }

    buffer = await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4
      }
    }).png().toBuffer();
  }

  return { buffer, pad };
}

const MAX_LOGOS = 10;

/**
 * Composite up to MAX_LOGOS logos into the chosen corner (or dead center)
 * with consistent spacing, sized as a percentage of the base image's
 * shorter side (not always its width) so the logo comes out the same
 * physical size whether the source photo is landscape or portrait — using
 * width alone would make the logo shrink on portrait shots, since their
 * width is the short dimension.
 */
async function applyLogos(baseSharp, baseMeta, logoPaths, scalePercent, opacityPercent, effects = {}, position = "bottom-right", marginPercent = 1.5, gapPercent = 12.5) {
  const referenceDimension = Math.min(baseMeta.width, baseMeta.height);
  const targetHeight = Math.max(
  1,
  Math.round(referenceDimension * (scalePercent / 100))
);
  // Edge margin (logo block to image border) stays tied to the base image
  // size, and is now user-adjustable via marginPercent (ignored for center
  // placement, which has no edge to measure from).
  const margin = Math.max(4, Math.round(referenceDimension * (marginPercent / 100)));
  // Gap *between* multiple logos is tied to the watermark's own width
  // instead, so the spacing scales with the watermark (bigger watermark ->
  // proportionally bigger gap) rather than staying a fixed sliver of the
  // photo regardless of how large the logos are. All logos share the same
  // targetWidth square box, so this stays consistent across the row.
  // User-adjustable via gapPercent (% of watermark width).
  const logoGap = Math.max(4, Math.round(targetHeight * (gapPercent / 100)));

  const isCenter = position === "center";
  const isRight = position === "top-right" || position === "bottom-right";
  const isBottom = position === "bottom-right" || position === "bottom-left";

  const list = (logoPaths || []).filter(Boolean).slice(0, MAX_LOGOS);
  // First logo in the list ends up closest to the chosen corner (or, for
  // center placement, leftmost in the centered row). Laying out toward a
  // right corner walks right-to-left (so the list needs reversing to keep
  // the first entry nearest the corner); laying out toward a left corner
  // or the center walks left-to-right, where the list's natural order
  // already puts the first entry first.
  const ordered = isRight ? [...list].reverse() : list;

  // Prepare every logo up front. Center placement needs each logo's
  // rendered width before it can know where the centered row should
  // start, so we can't position-as-we-go the way the corner layouts do.
  const prepared = [];
  for (const logoPath of ordered) {
    const { buffer: logoBuffer, pad } = await prepareLogo(logoPath, targetHeight, opacityPercent, effects);
    const logoMeta = await sharp(logoBuffer).metadata();
    // `logoMeta` describes the padded canvas (artwork + shadow/outline
    // bleed) when effects are on. `artWidth`/`artHeight` are the actual
    // watermark's own footprint (targetWidth square, minus the padding),
    // which is what margin/gap spacing should be measured against — the
    // shadow should spill past that footprint, not shift it.
    prepared.push({
      logoBuffer,
      logoMeta,
      pad,
      artWidth: logoMeta.width - pad * 2,
      artHeight: logoMeta.height - pad * 2
    });
  }

  const composites = [];

  if (isCenter) {
    const rowWidth =
      prepared.reduce((sum, p) => sum + p.artWidth, 0) + logoGap * Math.max(0, prepared.length - 1);
    let xCursor = Math.round((baseMeta.width - rowWidth) / 2);
    for (const { logoBuffer, artWidth, artHeight, pad } of prepared) {
      const y = Math.round((baseMeta.height - artHeight) / 2);
      composites.push({ input: logoBuffer, left: Math.max(0, xCursor - pad), top: Math.max(0, y - pad) });
      xCursor += artWidth + logoGap;
    }
  } else {
    let xCursor = isRight ? baseMeta.width - margin : margin;
    for (const { logoBuffer, artWidth, artHeight, pad } of prepared) {
      const x = isRight ? xCursor - artWidth : xCursor;
      const y = isBottom ? baseMeta.height - margin - artHeight : margin;
      composites.push({ input: logoBuffer, left: Math.max(0, x - pad), top: Math.max(0, y - pad) });
      xCursor = isRight ? x - logoGap : x + artWidth + logoGap;
    }
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
  let rawMeta;
  try {
    rawMeta = await sharp(imagePath).metadata();
  } catch (err) {
    // Distinguishes "this specific photo can't be decoded" (e.g. it's
    // actually RAW/HEIC under a .jpg extension, a CMYK JPEG libvips can't
    // read, or a corrupted file) from a watermark problem — both throw
    // the same generic libvips message otherwise, which made this look
    // watermark-related when it wasn't.
    throw new Error(
      `"${path.basename(imagePath)}" could not be read (${err.message}). It may be corrupted, RAW, HEIC, or a CMYK JPEG — try re-exporting it as a standard sRGB JPEG or PNG.`
    );
  }
  // .rotate() with no args auto-orients the pixels per the file's EXIF
  // Orientation tag and strips that tag from the output, so the saved
  // image displays correctly everywhere instead of relying on each
  // viewer to apply the rotation itself (which not all do).
  const image = sharp(imagePath).rotate();
  const meta = getOrientedMeta(rawMeta);

  let pipeline;
  let telemetry;
  try {
    ({ pipeline, telemetry } = await buildEnhancedPipeline(image, config, meta));
  } catch (err) {
    // metadata() above only reads the file header, so a header-valid but
    // body-corrupt (or genuinely unsupported) file only fails here, once
    // pixels are actually decoded — this is the failure that was showing
    // up as a bare, unattributed libvips error during batch runs.
    throw new Error(
      `"${path.basename(imagePath)}" could not be read (${err.message}). It may be corrupted, RAW, HEIC, or a CMYK JPEG — try re-exporting it as a standard sRGB JPEG or PNG.`
    );
  }

  if (config.logos && config.logos.length) {
    // Need the enhanced pixels resolved before compositing, so buffer through.
    // Must specify an explicit output format here: when the manual tone-curve
    // step (buildManualPipeline) has run, `pipeline`'s source is raw decoded
    // pixel data (sharp(data, {raw:...})) rather than an encoded file, and
    // calling toBuffer() with no format on that dumps unencoded raw bytes
    // instead of a real image — which then fails to re-decode below with a
    // generic "unsupported image format" error that looked like a bad logo
    // file but wasn't. PNG (lossless) keeps this intermediate step from
    // costing any quality before the final save re-encodes to the real
    // output format anyway.
    const enhancedBuffer = await pipeline.png().toBuffer();
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
      config.logoPosition,
      config.logoMarginPercent,
      config.logoGapPercent
    );
  }

  return { pipeline, meta, telemetry };
}

async function saveProcessed(pipeline, outputPath, jpegQuality) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const ext = path.extname(outputPath).toLowerCase();

  // Stamp the ENHANCED_MARKER into EXIF ImageDescription so a later batch
  // run over this same output (e.g. someone re-selecting the output folder
  // as input, or a re-run that accidentally sweeps up prior results) can be
  // detected and skipped instead of silently compounding CLAHE/sharpen a
  // second time — see hasAlreadyBeenEnhanced / ENHANCED_MARKER above.
  pipeline = pipeline.withMetadata({ exif: { IFD0: { ImageDescription: ENHANCED_MARKER } } });

  if (ext === ".jpg" || ext === ".jpeg") {
    await pipeline.jpeg({ quality: Math.max(95, Math.min(100, jpegQuality)), chromaSubsampling: "4:4:4" }).toFile(outputPath);
  } else {
    await pipeline.png().toFile(outputPath);
  }
}

/**
 * Generate a preview pair (original + processed), downscaled for display,
 * returned as data URLs for the renderer.
 *
 * Perf note: this used to run the ENTIRE enhancement pipeline (auto-expose
 * stats, normalise, CLAHE, median filter, sharpen, and/or the manual
 * raw-pixel tone-curve LUT loop) plus logo compositing at the source
 * image's full resolution, then downscale the finished result to preview
 * size afterward. Those per-pixel filters all scale with pixel count, so on
 * a typical 4000x3000+ photo that meant doing 20-40x more work than the
 * preview could ever show, on every slider tweak — this was the main
 * source of preview lag. We now downscale FIRST and run the enhancement
 * pipeline (and logo compositing) on the already-small image instead, which
 * gives a visually equivalent preview for a fraction of the compute.
 *
 * This downscale-first reordering is safe (unlike the full batch path in
 * buildProcessedImage, which must stay full-res -> composite -> save so the
 * output file is full quality): logo scale/position are both percentages of
 * the base canvas, so shrinking the canvas first and then compositing
 * against ITS dimensions still places the logo correctly, just smaller —
 * exactly what a preview should show anyway. The logo is still composited
 * only after the enhancement pipeline is fully resolved to pixels (see
 * below), so enhancement never applies to the watermark itself.
 */
// Mean-absolute-pixel-delta (0-255 scale, averaged across R/G/B) above which
// a preview's before/after is flagged as a likely "this photo got wrecked"
// case. Calibrated loosely: a well-behaved Smart Enhance pass (exposure
// pull, CLAHE, saturation, sharpen all at once) on a normally-exposed photo
// typically lands well under 30; something in the 45+ range is usually a
// sign auto-exposure or CLAHE overreacted to an unusual photo (near-black,
// blown-out, or otherwise pathological input) rather than normal enhancement
// variance. This is a QA tripwire, not a hard limit — flagged previews still
// render normally, this only adds a log/flag for review before a full batch
// run repeats the same mistake across many files.
const PREVIEW_DELTA_WARN_THRESHOLD = 45;

/**
 * Decode two same-format image buffers to raw RGB pixels and return the
 * mean absolute per-channel difference (0-255 scale) between them, as a
 * cheap perceptual "how much did this change" signal. Not a real perceptual
 * metric (no luminance weighting, no SSIM) — just a fast outlier tripwire
 * for the preview QA check below, where "way more different than a normal
 * enhance pass" matters more than precisely how different.
 */
async function computeMeanAbsDelta(bufferA, bufferB) {
  const [a, b] = await Promise.all([
    sharp(bufferA).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(bufferB).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);

  // Both buffers are derived from the same smallBuffer dimensions, so this
  // should always hold — but guard rather than assume, since a mismatch
  // (e.g. future logo-driven canvas resize) would otherwise silently
  // compare garbage or throw deep inside the loop below.
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels) {
    return null;
  }

  const channels = a.info.channels;
  const pixelCount = a.info.width * a.info.height;
  let sumAbsDiff = 0;

  for (let i = 0; i < pixelCount * channels; i++) {
    sumAbsDiff += Math.abs(a.data[i] - b.data[i]);
  }

  return sumAbsDiff / (pixelCount * channels);
}

async function processPreview(imagePath, config) {
  const PREVIEW_MAX = 640;

  // Auto-orient, then downscale once up front. This small buffer is reused
  // as the input to both the "before" thumbnail and the enhancement
  // pipeline below, instead of re-decoding/re-resizing the source twice.
  let smallBuffer;
  try {
    smallBuffer = await sharp(imagePath)
      .rotate()
      .resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside", kernel: "lanczos3" })
      .toBuffer();
  } catch (err) {
    throw new Error(
      `"${path.basename(imagePath)}" could not be read (${err.message}). It may be corrupted, RAW, HEIC, or a CMYK JPEG — try re-exporting it as a standard sRGB JPEG or PNG.`
    );
  }

  const originalBuffer = await sharp(smallBuffer)
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer();

  const smallMeta = await sharp(smallBuffer).metadata();

  let { pipeline, telemetry } = await buildEnhancedPipeline(sharp(smallBuffer), config, smallMeta);

  if (config.logos && config.logos.length) {
    // Resolve the enhancement pipeline to real, finished pixels before
    // compositing the logo — matching buildProcessedImage's full-res
    // path. Enhancement (exposure, contrast, saturation, sharpen, etc.)
    // must apply only to the photo, never to the watermark; compositing
    // onto a fully materialized buffer instead of a still-pending
    // operation chain makes that a guarantee rather than an assumption
    // about internal pipeline ordering.
    const enhancedBuffer = await pipeline.png().toBuffer();
    const enhancedSharp = sharp(enhancedBuffer);
    pipeline = await applyLogos(
      enhancedSharp,
      smallMeta,
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
      config.logoPosition,
      config.logoMarginPercent,
      config.logoGapPercent
    );
  }

  const processedBuffer = await pipeline
    // 4:4:4 chroma keeps the logo's saturated edges crisp — the default
    // 4:2:0 subsampling halves color resolution and was the main source
    // of watermark blur in the preview (most visible on colored logos).
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();

  // Before/after sanity check (QA tripwire): the preview path already has
  // both buffers decoded and full-pipeline-processed, so this is a cheap
  // add-on. It's meant to catch "this photo got wrecked" cases — usually an
  // unusual source photo (near-black, blown-out, extreme color cast) that
  // sends auto-exposure or CLAHE somewhere extreme — while the user is still
  // looking at one preview, rather than discovering it 200 photos into a
  // batch run. A null delta (dimension/channel mismatch) is treated as "not
  // flagged" rather than thrown, since this check should never be the thing
  // that breaks a preview.
  const perceptualDelta = await computeMeanAbsDelta(originalBuffer, processedBuffer).catch(() => null);
  const deltaFlagged = perceptualDelta !== null && perceptualDelta > PREVIEW_DELTA_WARN_THRESHOLD;

  if (deltaFlagged) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ACCESS-PhotoProcessor] Large before/after change in preview for "${path.basename(imagePath)}" (meanAbsDelta=${perceptualDelta.toFixed(1)}, threshold=${PREVIEW_DELTA_WARN_THRESHOLD}). ` +
        `Worth a manual look before batch-processing similar photos.` +
        // Dump the adaptive params alongside the delta itself (rather than
        // just the delta) — this is the "how hard did we push it" data the
        // thresholds above were only ever estimated from; a flagged photo's
        // noiseLevel/localContrastLevel and the median/CLAHE/sharpen params
        // they drove is exactly what's needed to tell "the adaptive logic
        // reacted correctly to a genuinely unusual photo" apart from "the
        // adaptive logic itself overreacted," and to eventually tune
        // NOISE_MEDIAN_THRESHOLD, CLAHE_SKIP_THRESHOLD, etc. from real data
        // instead of the current estimated constants. telemetry is null for
        // the manual pipeline (no adaptive params to report).
        (telemetry ? ` telemetry=${JSON.stringify(telemetry)}` : "")
    );
  }

  return {
    originalDataUrl: `data:image/jpeg;base64,${originalBuffer.toString("base64")}`,
    processedDataUrl: `data:image/jpeg;base64,${processedBuffer.toString("base64")}`,
    perceptualDelta,
    deltaFlagged,
    telemetry
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
    // Refuse to double-process a file that's already carrying our own
    // ENHANCED_MARKER (i.e. it's a prior run's output, not an untouched
    // source photo) — Smart Enhance's CLAHE + sharpen steps compound rather
    // than idempotently re-applying, so this would otherwise silently
    // over-process the image on every re-run. Reported back as "skipped"
    // (with a reason) rather than "failed", since nothing actually broke.
    if (await hasAlreadyBeenEnhanced(imagePath)) {
      return {
        imagePath,
        status: "skipped",
        reason: "already-enhanced",
        error: "Already processed by ACCESS-PhotoProcessor — skipped to avoid double-enhancing."
      };
    }

    const { pipeline, telemetry } = await buildProcessedImage(imagePath, config);

    // Per-photo "how hard did we push it" telemetry (noiseLevel,
    // localContrastLevel, and the resulting median/CLAHE/sharpen params —
    // see buildAutoPipeline). Logged for every Smart Enhance image in the
    // batch, not just flagged previews, so the adaptive thresholds can
    // eventually be tuned against which combinations actually correlate
    // with grainy-looking outputs, across a real batch rather than one
    // photo at a time. null for the manual pipeline, which has no adaptive
    // params to report.
    if (telemetry) {
      // eslint-disable-next-line no-console
      console.log(`[ACCESS-PhotoProcessor] telemetry "${path.basename(imagePath)}" ${JSON.stringify(telemetry)}`);
    }

    if (controller && controller.cancelled) {
      return { imagePath, status: "cancelled" };
    }

    const filename = resolveOutputFilename(path.basename(imagePath), config.outputFormat, config.filenameSuffix);
    const outputPath = resolveOutputPath(config.outputFolder, filename, config.collisionStrategy);

    if (!outputPath) {
      return { imagePath, status: "skipped" };
    }

    await saveProcessed(pipeline, outputPath, config.jpegQuality);
    return { imagePath, status: "success", outputPath, telemetry };
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
  const alreadyEnhancedSkips = [];
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
      else if (result.status === "skipped" || result.status === "cancelled") {
        skipped += 1;
        // Surface already-enhanced skips distinctly from ordinary
        // collision-strategy skips, since this one usually means the
        // input selection itself is wrong (pointed at a prior output
        // folder) rather than being an expected/benign skip.
        if (result.reason === "already-enhanced") {
          alreadyEnhancedSkips.push(path.basename(imagePath));
        }
      } else {
        failed += 1;
        errors.push(`${path.basename(imagePath)}: ${result.error}`);
      }

      onProgress(doneCount, total, path.basename(imagePath), result.status);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  if (alreadyEnhancedSkips.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ACCESS-PhotoProcessor] ${alreadyEnhancedSkips.length} file(s) skipped because they were already enhanced (likely re-running over a previous output folder): ${alreadyEnhancedSkips.join(", ")}`
    );
  }

  return {
    total,
    succeeded,
    failed,
    skipped,
    alreadyEnhancedSkips,
    errors,
    cancelled: controller.cancelled
  };
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  processBatch,
  processPreview
};