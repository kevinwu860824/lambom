const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { LAMBOM_URL } = require("./config");

let mainWindow = null;

// The currently running SAP download child process (only ever one at a
// time). On Windows, Node's spawn() doesn't automatically kill the child
// process when the parent (this Electron app) exits — it can become an
// orphan process still operating SAP in the background. So it needs to be
// explicitly killed both when the window closes/app quits and when the
// user actively clicks "Cancel".
let activeChild = null;

function killActiveChild() {
  if (!activeChild || activeChild.killed || activeChild.exitCode !== null) return;
  const pid = activeChild.pid;
  activeChild = null;
  if (process.platform === "win32") {
    // taskkill /T also kills any child processes this one spawned; /F forces termination.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already exited, nothing to do.
    }
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "lambom",
    webPreferences: {
      contextIsolation: true,
      // Lets the lambom web app (whether loaded by this exe or opened at the
      // same URL in a regular browser) call these functions via
      // window.fidDownloader. The web app code checks whether this API
      // exists first, and hides the SAP Download section if it doesn't
      // (i.e. the regular-browser case).
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "Tools",
      submenu: [
        { label: "Reload", role: "reload" },
        { label: "Quit", role: "quit" },
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

function getInventoryLookupExePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "inventory_lookup_cli.exe");
  }
  return path.join(__dirname, "..", "sap-downloader", "dist", "inventory_lookup_cli.exe");
}

function getScratchDir() {
  // Deliberately NOT the user's visible Downloads folder — SAP export still
  // has to write a real file somewhere before we can read it, but once it's
  // parsed and uploaded there's nothing left for the user to see or manage
  // locally, so this stays in a hidden temp location instead.
  const dir = path.join(app.getPath("temp"), "lambom-sap-downloads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle("fid-download:start", async (event, { fid, mode, so }) => {
  const exePath = getDownloaderExePath();

  if (!fs.existsSync(exePath)) {
    event.sender.send(
      "fid-download:log",
      `[Error] Download tool not found: ${exePath} (first package the Python tool into an exe per desktop/sap-downloader/README)`
    );
    return { ok: false, resultPath: null };
  }

  const outDir = getScratchDir();

  const args = ["--out-dir", outDir, "--mode", mode];
  if (fid) args.unshift(fid);
  if (so) args.push("--so", so);

  return new Promise((resolve) => {
    const child = spawn(exePath, args);
    activeChild = child;
    let resultPath = null;
    let resolvedSo = null;
    let resolvedPo = null;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        const resultMatch = line.match(/^RESULT_PATH:(.+)$/);
        if (resultMatch) {
          resultPath = resultMatch[1].trim();
          continue;
        }
        const soMatch = line.match(/^RESOLVED_SO:(.*)$/);
        if (soMatch) {
          resolvedSo = soMatch[1].trim();
          continue;
        }
        const poMatch = line.match(/^RESOLVED_PO:(.*)$/);
        if (poMatch) {
          resolvedPo = poMatch[1].trim();
          continue;
        }
        event.sender.send("fid-download:log", line);
      }
    });

    child.stderr.on("data", (chunk) => {
      event.sender.send("fid-download:log", `[stderr] ${chunk.toString("utf-8")}`);
    });

    child.on("error", (err) => {
      if (activeChild === child) activeChild = null;
      event.sender.send("fid-download:log", `[Error] Failed to start the download tool: ${err.message}`);
      resolve({ ok: false, resultPath: null });
    });

    child.on("close", (code) => {
      if (activeChild === child) activeChild = null;
      resolve({ ok: code === 0, resultPath, so: resolvedSo, po: resolvedPo });
    });
  });
});

ipcMain.handle("fid-download:cancel", async () => {
  killActiveChild();
  return true;
});

ipcMain.handle("fid-download:open-folder", async (_event, targetPath) => {
  shell.showItemInFolder(targetPath);
});

ipcMain.handle("fid-download:read-file", async (_event, targetPath) => {
  const buffer = fs.readFileSync(targetPath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
});

ipcMain.handle("fid-download:delete-file", async (_event, targetPath) => {
  try {
    fs.unlinkSync(targetPath);
  } catch {
    // Best-effort cleanup only — a failure here shouldn't surface as an app error.
  }
});

// A single quick action (open SAP's stock overview for one part number, no
// file output) — unlike fid-download:start above, there's no queue/cancel
// machinery or live log streaming to the renderer, just collect
// stdout/stderr and resolve once the process exits.
ipcMain.handle("inventory:lookup", async (_event, { partNo }) => {
  const exePath = getInventoryLookupExePath();

  if (!fs.existsSync(exePath)) {
    return { ok: false, error: `Inventory lookup tool not found: ${exePath} (build it first per desktop/sap-downloader/README)` };
  }

  return new Promise((resolve) => {
    const child = spawn(exePath, [partNo]);
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      output += `[stderr] ${chunk.toString("utf-8")}`;
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: `Failed to start the inventory lookup tool: ${err.message}` });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      const errorLine = output.split(/\r?\n/).find((line) => line.startsWith("[Error]"));
      resolve({ ok: false, error: errorLine ?? output.trim() ?? `Exited with code ${code}` });
    });
  });
});

app.whenReady().then(createMainWindow);

app.on("before-quit", () => {
  killActiveChild();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
