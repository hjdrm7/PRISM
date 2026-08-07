const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { processBatch, processPreview, SUPPORTED_EXTENSIONS } = require("./processor");
const { loadSettings, saveSettings } = require("./settings");

let mainWindow = null;
let activeBatchController = null;

const isDev = process.env.NODE_ENV === "development";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#15181b",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

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

ipcMain.handle("dialog:choose-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("dialog:choose-image", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "PNG Images", extensions: ["png"] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ---------------------------------------------------------------------------
// IPC: folder scanning (drag-drop of a folder path resolves here too)
// ---------------------------------------------------------------------------

ipcMain.handle("fs:list-images", async (_evt, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) return [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.includes(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(folderPath, e.name))
    .sort();
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
