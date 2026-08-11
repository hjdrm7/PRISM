const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const sharp = require("sharp");
const { processBatch, processPreview, SUPPORTED_EXTENSIONS } = require("./processor");
const { loadSettings, saveSettings } = require("./settings");

let mainWindow = null;
let activeBatchController = null;

const isDev = process.env.NODE_ENV === "development";

function createWindow() {
  // The app has its own in-window title bar (PRISM logo + settings
  // button), so the native File/Edit/View/Window/Help menu bar is just
  // duplicate chrome — strip it globally (covers every window, including
  // any opened later) rather than per-window.
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#15181b",
    // Taskbar/dock/window-manager icon — separate from the in-app <img>
    // logo in the title bar (App.jsx), since this one is drawn by the OS
    // before the renderer even loads. Windows wants a multi-resolution
    // .ico (a single-size .png can render blank/blurry in the taskbar),
    // while macOS/Linux take .png directly.
    icon: path.join(__dirname, "../../build", process.platform === "win32" ? "icon.ico" : "icon.png"),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // Belt-and-suspenders on platforms/window-managers where the menu bar
  // can otherwise flash back in (e.g. briefly on Alt on Windows/Linux).
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// IPC: folder / file pickers
// ---------------------------------------------------------------------------

// `defaultPath` lets the renderer re-open a dialog pointed at the last
// folder the user actually used (e.g. the previous input/output/logo
// folder), instead of every picker starting back at the OS default each
// time. It's optional and simply omitted from the dialog options when
// there's nothing to default to yet (first run, or a path that no longer
// exists — Electron falls back to its own default in that case anyway).
ipcMain.handle("dialog:choose-folder", async (_evt, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    ...(defaultPath ? { defaultPath } : {})
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("dialog:choose-image", async (_evt, defaultPath, multiple) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "svg"] }
    ],
    ...(defaultPath ? { defaultPath } : {})
  });
  if (result.canceled || !result.filePaths.length) return multiple ? [] : null;

  // Verify every picked file actually decodes as an image right away,
  // instead of only discovering it's broken deep inside a later batch
  // run — where the failure gets misattributed to whatever photo
  // happened to be processing at the time, not the logo itself. Bad
  // files are dropped (with a single combined error box) rather than
  // failing the whole selection, so the good ones still go through.
  const valid = [];
  const invalid = [];
  for (const filePath of result.filePaths) {
    try {
      await sharp(filePath).metadata();
      valid.push(filePath);
    } catch (err) {
      invalid.push(path.basename(filePath));
    }
  }

  if (invalid.length) {
    const names = invalid.join(", ");
    const verb = invalid.length === 1 ? "isn't a readable image file" : "aren't readable image files";
    const followUp = valid.length
      ? "Skipping it and using the rest of your selection."
      : "Pick a different file.";
    dialog.showErrorBox(
      invalid.length === 1 ? "Couldn't use this image" : "Couldn't use some images",
      `${names} ${verb}. ${followUp}`
    );
  }

  if (multiple) return valid;
  return valid[0] || null;
});

ipcMain.handle("dialog:choose-input-image", async (_evt, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
    ...(defaultPath ? { defaultPath } : {})
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
});

// ---------------------------------------------------------------------------
// IPC: small base64 thumbnails for logo previews in the Watermarks panel.
// The renderer can't load these images via file:// (blocked cross-origin
// when the page itself is served from http://localhost in dev, and
// disabled by default under contextIsolation), so the main process reads
// the file and hands back a small data URL instead.
// ---------------------------------------------------------------------------

ipcMain.handle("fs:image-thumbnail", async (_evt, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const buffer = await sharp(filePath)
      .resize(64, 64, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (err) {
    return null;
  }
});

// ---------------------------------------------------------------------------
// IPC: built-in watermark presets
// ---------------------------------------------------------------------------

function getWatermarksDir() {
  if (app.isPackaged) {
    // In production, extraResources are placed in process.resourcesPath
    return path.join(process.resourcesPath, "Watermarks");
  }
  // In development, resolve to your local source folder
  return path.resolve(__dirname, "../renderer/assets/Watermarks");
}

ipcMain.handle("watermarks:list-presets", async () => {
  const presetsDir = getWatermarksDir();

  if (!fs.existsSync(presetsDir)) {
    console.error(
      "[PRISM] Watermark presets directory not found:",
      presetsDir
    );
    return [];
  }

  const files = fs.readdirSync(presetsDir, {
    withFileTypes: true
  });

  return files
    .filter((file) => {
      if (!file.isFile()) return false;

      const ext = path.extname(file.name).toLowerCase();

      return [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
    })
    .map((file) => {
      const ext = path.extname(file.name);

      return {
        name: path.basename(file.name, ext),
        fileName: file.name,
        path: path.join(presetsDir, file.name)
      };
    })
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base"
      })
    );
});

// ---------------------------------------------------------------------------
// IPC: folder scanning (drag-drop of a folder path resolves here too)
// ---------------------------------------------------------------------------

ipcMain.handle("fs:list-images", async (_evt, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) return [];
  const stat = fs.statSync(targetPath);

  if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.includes(path.extname(e.name).toLowerCase()))
      .map((e) => path.join(targetPath, e.name))
      .sort();
  }

  if (stat.isFile() && SUPPORTED_EXTENSIONS.includes(path.extname(targetPath).toLowerCase())) {
    return [targetPath];
  }

  return [];
});

// ---------------------------------------------------------------------------
// IPC: settings persistence (Phase 11)
// ---------------------------------------------------------------------------

ipcMain.handle("settings:load", async () => loadSettings());
ipcMain.handle("settings:save", async (_evt, settings) => {
  saveSettings(settings);
  return true;
});

// ---------------------------------------------------------------------------
// IPC: single-image preview (Phase 12)
// ---------------------------------------------------------------------------

ipcMain.handle("processing:preview", async (_evt, { imagePath, config }) => {
  try {
    const { originalDataUrl, processedDataUrl } = await processPreview(imagePath, config);
    return { ok: true, originalDataUrl, processedDataUrl };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------------------
// IPC: batch processing (Phase 8/9/13) with progress + cancellation
// ---------------------------------------------------------------------------

ipcMain.handle("processing:start-batch", async (evt, { images, config }) => {
  const sender = evt.sender;
  const cores = Math.max(1, os.cpus().length - 1);

  activeBatchController = { cancelled: false };
  const controller = activeBatchController;

  const summary = await processBatch(images, config, cores, (done, total, filename, status) => {
    if (sender.isDestroyed()) return;
    sender.send("processing:progress", { done, total, filename, status });
  }, controller);

  activeBatchController = null;
  return summary;
});

ipcMain.handle("processing:cancel-batch", async () => {
  if (activeBatchController) activeBatchController.cancelled = true;
  return true;
});

// ---------------------------------------------------------------------------
// IPC: check GitHub for a newer release (Phase 14) — notification only,
// no auto-download/install. Runs on demand (renderer calls it once on
// startup) rather than polling in the background.
// ---------------------------------------------------------------------------

const https = require("https");
const GITHUB_REPO = "hjdrm7/PRISM";

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          // GitHub's API 403s requests with no User-Agent.
          "User-Agent": "PRISM-App",
          Accept: "application/vnd.github+json"
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub API returned ${res.statusCode}`));
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("Request timed out")));
  });
}

// Compares two "vX.Y.Z" / "X.Y.Z" version strings. Returns true if
// `latest` is strictly newer than `current`.
function isNewerVersion(latest, current) {
  const norm = (v) => v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = norm(latest);
  const b = norm(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

ipcMain.handle("updates:check", async () => {
  try {
    const release = await fetchLatestRelease();
    const latestTag = release.tag_name || "";
    const currentVersion = app.getVersion();
    const available = latestTag ? isNewerVersion(latestTag, currentVersion) : false;
    return {
      ok: true,
      available,
      currentVersion,
      latestVersion: latestTag.replace(/^v/i, ""),
      url: release.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("shell:open-external", async (_evt, url) => {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

// ---------------------------------------------------------------------------
// IPC: reveal the output folder in the OS file manager after a batch finishes
// ---------------------------------------------------------------------------

ipcMain.handle("shell:open-path", async (_evt, targetPath) => {
  if (!targetPath) return false;
  const err = await shell.openPath(targetPath);
  return !err;
});