const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  chooseFolder: (defaultPath) => ipcRenderer.invoke("dialog:choose-folder", defaultPath),
  chooseInputImage: (defaultPath) => ipcRenderer.invoke("dialog:choose-input-image", defaultPath),
  chooseLogoImage: (defaultPath, multiple) => ipcRenderer.invoke("dialog:choose-image", defaultPath, multiple),
  listImages: (folderPath) => ipcRenderer.invoke("fs:list-images", folderPath),
  getImageThumbnail: (filePath) => ipcRenderer.invoke("fs:image-thumbnail", filePath),

  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),

  generatePreview: (imagePath, config) =>
    ipcRenderer.invoke("processing:preview", { imagePath, config }),

  startBatch: (images, config) => ipcRenderer.invoke("processing:start-batch", { images, config }),
  cancelBatch: () => ipcRenderer.invoke("processing:cancel-batch"),
  openOutputFolder: (folderPath) => ipcRenderer.invoke("shell:open-path", folderPath),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),

  onProgress: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on("processing:progress", listener);
    return () => ipcRenderer.removeListener("processing:progress", listener);
  }
});