const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fidDownloader", {
  start: (fid) => ipcRenderer.invoke("fid-download:start", fid),
  onLog: (callback) => {
    ipcRenderer.on("fid-download:log", (_event, line) => callback(line));
  },
  openFolder: (filePath) => ipcRenderer.invoke("fid-download:open-folder", filePath),
});
