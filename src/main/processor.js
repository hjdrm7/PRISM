/**
 * processor.js
 * Core image processing engine (Node/sharp) for ACCESS-PhotoProcessor.
 *
 * Two enhancement paths, chosen by config.enhancementFilter:
 *   - "smart" (Smart Enhance): a single fixed-intensity automatic
 *     pipeline — sharpen goes LAST, after noise reduction, so it doesn't
 *     amplify grain that denoising would otherwise smooth back out:
 *       1. Auto-exposure (pulls each photo's own mean brightness toward
 *          mid-gray — dark photos lighten, bright/blown photos darken)
 *       2. Normalize (auto white-balance / levels stretch)
 *       3. CLAHE (local contrast)
 *       4. Median filter (light noise reduction)
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
async function buildManualPipeline(image, config) {
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
      const claheWidth = Math.max(8, Math.round(64 - 40 * amount));
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
async function buildEnhancedPipeline(image, config) {
  const filter = config.enhancementFilter;
  const usesManualPipeline =
    filter === "vivid" || filter === "bw" || filter === "manual" || (filter !== "smart" && config.enhancementMode === "manual");

  if (usesManualPipeline) {
    return buildManualPipeline(image, config);
  }
  return buildAutoPipeline(image, config.enhancementIntensity ?? SMART_ENHANCE_INTENSITY);
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
  try {
    pipeline = await buildEnhancedPipeline(image, config);
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

  let pipeline = await buildEnhancedPipeline(sharp(smallBuffer), config);

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