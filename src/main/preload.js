const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  chooseFolder: () => ipcRenderer.invoke("dialog:choose-folder"),
  chooseInputImage: () => ipcRenderer.invoke("dialog:choose-input-image"),
  chooseLogoImage: () => ipcRenderer.invoke("dialog:choose-image"),
  listImages: (folderPath) => ipcRenderer.invoke("fs:list-images", folderPath),

  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),

  generatePreview: (imagePath, config) =>
    ipcRenderer.invoke("processing:preview", { imagePath, config }),

  startBatch: (images, config) => ipcRenderer.invoke("processing:start-batch", { images, config }),
  cancelBatch: () => ipcRenderer.invoke("processing:cancel-batch"),

  onProgress: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on("processing:progress", listener);
    return () => ipcRenderer.removeListener("processing:progress", listener);
  }
});