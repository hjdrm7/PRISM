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
  logos: [], // up to 5 logo file paths, right-to-left in list order
  logoPosition: "bottom-right", // "top-right" | "bottom-right" | "top-left" | "bottom-left"
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
  enhancementMode: "auto", // "auto" | "manual"
  enhancementIntensity: 60,
  manualHue: 0, // -180..180 degrees
  manualSaturation: 0, // -100..100
  manualBrightness: 0, // -100..100 (Value)
  manualContrast: 0, // -100..100
  manualExposure: 0, // -100..100
  manualHighlights: 0, // -100..100
  manualShadows: 0, // -100..100
  manualSharpen: 0, // 0..100
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