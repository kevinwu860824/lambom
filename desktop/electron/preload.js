const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fidDownloader", {
  start: (params) => ipcRenderer.invoke("fid-download:start", params),
  // Returns an unsubscribe function so the caller (a React useEffect) can
  // remove the listener on unmount, preventing listeners from piling up
  // when the user navigates in and out of this page multiple times.
  onLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("fid-download:log", listener);
    return () => ipcRenderer.removeListener("fid-download:log", listener);
  },
  openFolder: (filePath) => ipcRenderer.invoke("fid-download:open-folder", filePath),
  readFile: (filePath) => ipcRenderer.invoke("fid-download:read-file", filePath),
  deleteFile: (filePath) => ipcRenderer.invoke("fid-download:delete-file", filePath),
  cancel: () => ipcRenderer.invoke("fid-download:cancel"),
});

contextBridge.exposeInMainWorld("inventoryLookup", {
  lookup: (partNo) => ipcRenderer.invoke("inventory:lookup", { partNo }),
});

contextBridge.exposeInMainWorld("d365Order", {
  fill: (payload) => ipcRenderer.invoke("d365-order:fill", payload),
  confirmSubmit: () => ipcRenderer.invoke("d365-order:confirm-submit"),
  cancel: () => ipcRenderer.invoke("d365-order:cancel"),
  onLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("d365-order:log", listener);
    return () => ipcRenderer.removeListener("d365-order:log", listener);
  },
});
