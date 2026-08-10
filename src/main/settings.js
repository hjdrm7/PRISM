const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

const DEFAULT_SETTINGS = {
  inputFolder: "",
  inputMode: "folder", // "folder" | "single"
  outputFolder: "",
  outputFormat: "original", // "original" | "jpeg" | "png"
  lastImageFolder: "", // last folder browsed in Image Edit mode's file picker, used as the picker's default path next time
  lastLogoFolder: "", // last folder browsed when picking a watermark logo image, used as the picker's default path next time
  logos: [], // up to 10 logo file paths, right-to-left in list order
  logoPresets: [], // user-saved watermark sets: [{ name, logos: [path, ...] }], preserving stacking order
  logoPosition: "bottom-right", // "top-right" | "bottom-right" | "top-left" | "bottom-left" | "center"
  logoMarginPercent: 1.5, // distance from the corner to the watermark, as % of the image's shorter side; ignored when logoPosition is "center"
  logoGapPercent: 12.5, // spacing between multiple watermarks, as % of a single watermark's width
  logoScalePercent: 12,
  logoOpacityPercent: 100,
  logoShadow: false,
  logoShadowColor: "#000000",
  logoShadowOpacityPercent: 100,
  logoOutline: false,
  logoOutlineColor: "#ffffff",
  logoOutlineOpacityPercent: 100,
  logoOutlineSizePercent: 3.5, // outline ring thickness, as % of logo width
  logoShadowDistancePercent: 5, // shadow throw distance, as % of logo width
  logoShadowAngle: 135, // degrees; 0 = right, 90 = down, 135 = down-right
  enhancementFilter: "smart", // "smart" | "manual" | "vivid" | "bw"
  enhancementIntensity: 60, // used internally by Smart Enhance; no UI slider anymore
  customPresets: [], // user-saved manual presets: [{ name, values: { manualHue, manualSaturation, ... } }]
  manualTemperature: 0, // -100..100 (White Balance: blue <-> amber)
  manualTint: 0, // -100..100 (White Balance: green <-> magenta)
  manualBrightness: 0, // -100..100 (Value)
  manualContrast: 0, // -100..100
  manualHighlights: 0, // -100..100
  manualShadows: 0, // -100..100
  manualWhites: 0, // -100..100
  manualBlacks: 0, // -100..100
  manualHue: 0, // -180..180 degrees
  manualVibrance: 0, // -100..100
  manualSaturation: 0, // -100..100
  manualInvert: false,
  manualSharpen: 0, // 0..100 (Sharpness)
  manualClarity: 0, // -100..100
  manualVignette: 0, // -100..100
  manualExposure: 0, // -100..100 (kept for backward compatibility; no longer exposed in the UI)
  jpegQuality: 97,
  filenameSuffix: "", // free-text appended before the extension, e.g. "_edited"
  collisionStrategy: "rename" // "rename" | "overwrite" | "skip"
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    console.error("Could not save settings:", err);
  }
}

module.exports = { loadSettings, saveSettings, DEFAULT_SETTINGS };