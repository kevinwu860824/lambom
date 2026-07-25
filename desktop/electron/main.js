const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { LAMBOM_URL } = require("./config");

let mainWindow = null;
let fidWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "lambom",
    webPreferences: {
      contextIsolation: true,
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "工具",
      submenu: [
        { label: "SAP 下載", click: () => openFidDownloaderWindow() },
        { type: "separator" },
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

function openFidDownloaderWindow() {
  if (fidWindow) {
    fidWindow.focus();
    return;
  }

  fidWindow = new BrowserWindow({
    width: 560,
    height: 460,
    title: "SAP FID 下載",
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  fidWindow.setMenuBarVisibility(false);
  fidWindow.loadFile(path.join(__dirname, "fid-downloader.html"));

  fidWindow.on("closed", () => {
    fidWindow = null;
  });
}

function getDownloaderExePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "fid_downloader_cli.exe");
  }
  return path.join(__dirname, "..", "sap-downloader", "dist", "fid_downloader_cli.exe");
}

ipcMain.handle("fid-download:start", async (event, fid) => {
  const exePath = getDownloaderExePath();

  if (!fs.existsSync(exePath)) {
    event.sender.send(
      "fid-download:log",
      `[錯誤] 找不到下載工具:${exePath}(請先依 desktop/sap-downloader/README 把 Python 版包成 exe)`
    );
    return { ok: false, resultPath: null };
  }

  const outDir = app.getPath("downloads");

  return new Promise((resolve) => {
    const child = spawn(exePath, [fid, "--out-dir", outDir]);
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

ipcMain.handle("fid-download:open-folder", async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
