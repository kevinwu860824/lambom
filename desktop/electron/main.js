const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { LAMBOM_URL } = require("./config");

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "lambom",
    webPreferences: {
      contextIsolation: true,
      // 讓 lambom 網頁版(不管是這個 exe 載入的還是一般瀏覽器打開的同一個網址)
      // 都能透過 window.fidDownloader 呼叫這裡的功能。網頁版程式碼會先檢查
      // 這個 API 存不存在,不存在(一般瀏覽器情境)就不顯示 SAP 下載那個區塊。
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "工具",
      submenu: [
        { label: "重新整理", role: "reload" },
        { label: "結束", role: "quit" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.loadURL(LAMBOM_URL);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function getDownloaderExePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "fid_downloader_cli.exe");
  }
  return path.join(__dirname, "..", "sap-downloader", "dist", "fid_downloader_cli.exe");
}

ipcMain.handle("fid-download:start", async (event, { fid, mode, so }) => {
  const exePath = getDownloaderExePath();

  if (!fs.existsSync(exePath)) {
    event.sender.send(
      "fid-download:log",
      `[錯誤] 找不到下載工具:${exePath}(請先依 desktop/sap-downloader/README 把 Python 版包成 exe)`
    );
    return { ok: false, resultPath: null };
  }

  const outDir = app.getPath("downloads");

  const args = ["--out-dir", outDir, "--mode", mode];
  if (fid) args.unshift(fid);
  if (so) args.push("--so", so);

  return new Promise((resolve) => {
    const child = spawn(exePath, args);
    let resultPath = null;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        const match = line.match(/^RESULT_PATH:(.+)$/);
        if (match) {
          resultPath = match[1].trim();
          continue;
        }
        event.sender.send("fid-download:log", line);
      }
    });

    child.stderr.on("data", (chunk) => {
      event.sender.send("fid-download:log", `[stderr] ${chunk.toString("utf-8")}`);
    });

    child.on("error", (err) => {
      event.sender.send("fid-download:log", `[錯誤] 無法啟動下載工具:${err.message}`);
      resolve({ ok: false, resultPath: null });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0 && Boolean(resultPath), resultPath });
    });
  });
});

ipcMain.handle("fid-download:open-folder", async (_event, targetPath) => {
  shell.showItemInFolder(targetPath);
});

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
