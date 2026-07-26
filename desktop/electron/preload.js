const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fidDownloader", {
  start: (fid) => ipcRenderer.invoke("fid-download:start", fid),
  // 回傳取消訂閱函式,呼叫端(React useEffect)在卸載時可以清掉監聽器,
  // 避免使用者在網頁版裡多次進出這個頁面時,監聽器一直往上疊加。
  onLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("fid-download:log", listener);
    return () => ipcRenderer.removeListener("fid-download:log", listener);
  },
  openFolder: (filePath) => ipcRenderer.invoke("fid-download:open-folder", filePath),
});
