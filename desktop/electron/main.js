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

// The currently running D365 order automation child process, if any. Unlike
// activeChild above, this one is deliberately long-lived (see d365-order.js
// comments below) — it's spawned once per "Fill D365 Form" click and stays
// alive, browser window and all, until the user confirms/cancels or quits
// the app, not until the underlying work finishes.
let activeD365Order = null;

function killChildProcess(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    // taskkill /T also kills any child processes this one spawned (e.g. the
    // Edge browser process a D365 order automation run launched); /F forces
    // termination.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already exited, nothing to do.
    }
  }
}

function killActiveChild() {
  const child = activeChild;
  activeChild = null;
  killChildProcess(child);
}

function killActiveD365Order() {
  const state = activeD365Order;
  activeD365Order = null;
  if (state) killChildProcess(state.child);
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

  // Without this, window.open() calls from the page (e.g. the KM Matrix
  // link) fall through to Electron's default behavior — opening another
  // Electron BrowserWindow instead of the user's actual default browser.
  // Hand it off to the OS instead and don't open a window here at all.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

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

function getD365OrderExePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "d365_order_cli.exe");
  }
  return path.join(__dirname, "..", "d365-automation", "dist", "d365_order_cli.exe");
}

function getD365OrderUserDataDir() {
  // Persists across runs (unlike getScratchDir's temp folder below) — a
  // dedicated Edge profile that only this tool ever opens, on purpose, so
  // it never fights over a locked profile directory with the user's
  // regular, already-open Edge windows.
  const dir = path.join(app.getPath("userData"), "d365-order-profile");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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

// D365 spare-part order automation — unlike every handler above, this one
// spawns a LONG-LIVED child: after filling in the D365 form it deliberately
// doesn't exit, so the real Edge window it opened stays visible for the
// user to review before confirming or cancelling (see
// desktop/d365-automation/d365_order_cli.py's module docstring for the
// full stdin protocol this depends on). d365-order:fill's promise resolves
// early, as soon as the `READY_FOR_CONFIRM:` line appears — the process
// itself is still running at that point, tracked in activeD365Order so a
// later d365-order:confirm-submit/:cancel call can still talk to it.
ipcMain.handle("d365-order:fill", async (event, payload) => {
  const exePath = getD365OrderExePath();

  if (!fs.existsSync(exePath)) {
    event.sender.send(
      "d365-order:log",
      `[Error] D365 order tool not found: ${exePath} (build it first per desktop/d365-automation/build.bat)`
    );
    return { ok: false, workOrderId: null };
  }

  if (activeD365Order) {
    event.sender.send("d365-order:log", "[Error] A D365 order is already in progress — finish or cancel it first.");
    return { ok: false, workOrderId: null };
  }

  return new Promise((resolve) => {
    const child = spawn(exePath, [], {
      env: { ...process.env, D365_ORDER_USER_DATA_DIR: getD365OrderUserDataDir() },
    });
    const state = { child, resolveClose: null };
    activeD365Order = state;

    let workOrderId = null;
    let filled = false;
    let stdoutBuffer = "";

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf-8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop(); // keep a possibly-incomplete trailing line for the next chunk

      for (const line of lines) {
        if (!line) continue;

        const readyMatch = line.match(/^READY_FOR_CONFIRM:(.*)$/);
        if (readyMatch) {
          workOrderId = readyMatch[1].trim();
          if (!filled) {
            filled = true;
            resolve({ ok: true, workOrderId });
          }
          continue; // internal sentinel, not meant to show up in the visible log
        }

        // Mid-fill pause: the Customer Asset (FID) search matched more than
        // one record and the CLI is now blocked waiting for a {"index": N}
        // line on stdin (see d365_order_cli.py's module docstring) — forward
        // the option labels to the renderer so it can show a picker; the
        // eventual d365-order:select-asset call writes the user's choice
        // back to this same child's stdin.
        const assetOptionsMatch = line.match(/^ASSET_OPTIONS:(.*)$/);
        if (assetOptionsMatch) {
          try {
            const options = JSON.parse(assetOptionsMatch[1]);
            event.sender.send("d365-order:asset-options", options);
          } catch (err) {
            event.sender.send("d365-order:log", `[Error] Failed to parse ASSET_OPTIONS: ${err.message}`);
          }
          continue; // internal sentinel, not meant to show up in the visible log
        }

        const woMatch = line.match(/^WORK_ORDER_ID:(.*)$/);
        if (woMatch) {
          event.sender.send("d365-order:log", `Work Order created: ${woMatch[1].trim()}`);
          continue;
        }

        event.sender.send("d365-order:log", line);
      }
    });

    child.stderr.on("data", (chunk) => {
      event.sender.send("d365-order:log", `[stderr] ${chunk.toString("utf-8")}`);
    });

    child.on("error", (err) => {
      if (activeD365Order === state) activeD365Order = null;
      event.sender.send("d365-order:log", `[Error] Failed to start the D365 order tool: ${err.message}`);
      if (!filled) {
        filled = true;
        resolve({ ok: false, workOrderId: null });
      }
    });

    child.on("close", (code) => {
      if (activeD365Order === state) activeD365Order = null;
      if (!filled) {
        // Exited before ever reaching READY_FOR_CONFIRM — a real failure
        // during the fill sequence, not a normal confirm/cancel exit.
        filled = true;
        resolve({ ok: false, workOrderId: null });
      }
      if (state.resolveClose) state.resolveClose(code);
    });

    child.stdin.write(JSON.stringify(payload) + "\n");
  });
});

// Answers a mid-fill "which Customer Asset option?" pause (see the
// d365-order:asset-options event above) — writes the choice back to the
// same still-running child's stdin and lets it continue; the fill sequence
// resumes from there towards its own READY_FOR_CONFIRM.
ipcMain.handle("d365-order:select-asset", async (_event, index) => {
  if (!activeD365Order) {
    return { ok: false, error: "No D365 order is currently waiting for an asset selection." };
  }
  activeD365Order.child.stdin.write(JSON.stringify({ index }) + "\n");
  return { ok: true };
});

// v1: automated submission isn't implemented yet (see the CLI's module
// docstring) — the CLI just logs a message and hangs, keeping the browser
// open for the user to click "Upload to SAP" themselves. So this
// deliberately does NOT await the child closing (unlike :cancel below) —
// in v1 it never will, until the user quits the whole lambom app.
ipcMain.handle("d365-order:confirm-submit", async () => {
  if (!activeD365Order) {
    return { ok: false, error: "No D365 order is currently waiting for confirmation." };
  }
  activeD365Order.child.stdin.write(JSON.stringify({ action: "confirm" }) + "\n");
  return { ok: true };
});

ipcMain.handle("d365-order:cancel", async () => {
  if (!activeD365Order) return true;
  const state = activeD365Order;

  const closed = await new Promise((resolve) => {
    state.resolveClose = (code) => resolve(true);
    state.child.stdin.write(JSON.stringify({ action: "cancel" }) + "\n");
    // Fallback in case the CLI doesn't exit gracefully within a reasonable
    // time (e.g. it's wedged mid-Playwright-call) — force-kill rather than
    // leave the renderer's Cancel button hanging forever.
    setTimeout(() => {
      if (activeD365Order === state) {
        killChildProcess(state.child);
        activeD365Order = null;
      }
      resolve(false);
    }, 10000);
  });

  return closed;
});

app.whenReady().then(createMainWindow);

app.on("before-quit", () => {
  killActiveChild();
  killActiveD365Order();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
