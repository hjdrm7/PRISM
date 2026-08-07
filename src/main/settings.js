const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

const DEFAULT_SETTINGS = {
  inputFolder: "",
  outputFolder: "",
  logo1Path: "",
  logo2Path: "",
  logoScalePercent: 12,
  logoOpacityPercent: 100,
  enhancementIntensity: 60,
  jpegQuality: 97,
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
