# lambom Desktop

Packages the lambom web app as a Windows desktop program (a real window, not a browser tab opened for you), and also bundles the SAP FID download tool (automation logic moved over from `fid_downloader_gui.py`).

Completely independent from the main lambom web project — it doesn't affect the Vercel deployment at all. This whole `desktop/` folder is only needed when you actually want to build the desktop version.

## What's in here

```
desktop/
  electron/          Electron desktop shell (window, preload bridge)
  sap-downloader/     fid_downloader_gui.py with the window UI stripped out, as a CLI
```

**The main window** loads the live production URL of the lambom web app directly (Next.js isn't bundled into the exe), so whenever you push to main and Vercel auto-deploys, the desktop app automatically shows the latest version too — no need to rebuild the exe.

**"SAP Download" isn't a separate window — it's a section embedded in the `/machines` (Edit Machines) page** (`components/fid-downloader-panel.tsx`), which detects whether it's running inside the desktop app via `window.fidDownloader` (injected by preload); opening the same URL in a regular browser shows nothing of this section at all.

The UI has two fields, "Machine No." + "FID" — fill them in and click "Add" to push onto the queue below (you can queue up several machines at once), then click "Download (N)" to process them one by one automatically, without needing to babysit each one. When you tab out of the FID field (blur), if "Machine No." is still empty, it automatically looks up this FID's previously-stored machine number from the `fid_machine_map` table and fills it in (still editable manually).

Besides adding items one at a time, you can also batch-import via Excel: "Excel Template" saves an xlsx with just "Machine No." and "FID" as column headers; fill in each row (column order doesn't matter, matching is done by header name not position) then use "Import Excel" to pick the file — every row gets appended to the end of the queue (rows missing either field are automatically skipped, without failing the whole import).

**SO can no longer be entered manually** — every item resolves its SO automatically from the FID via VA03 (see "Known Limitations" below for details). The "Machine No." field is directly the machine name (machine_name) used for the Supabase upload — no more lookup table or prompt needed.

Each item in the queue runs through, in order:

1. **Full BOM** (IB53) → `<FID>.xlsx`, saved only to the "Downloads" folder as a reference — it is **not** auto-uploaded, you still need to import it manually via "Upload BOM". A failure here doesn't stop this item, it moves straight on to the next step.
2. **Modules** (ZOOBOM_CE_FMT) → outputs `<SO>_modules.xlsx` for the auto-resolved SO. ZOOBOM_CE_FMT originally produces several files at once (filenames decided by SAP, with broken cell coordinates that only a lenient parser can read); the tool automatically reads them, merges them into a single xlsx with correct coordinates, and cleans up the raw files and intermediate files automatically.
3. **Auto-upload to Supabase**: each sheet (module) in the merged xlsx becomes its own subpart under that machine; once uploaded it automatically runs the existing "key part auto-matching," and saves this FID→Machine No. mapping into `fid_machine_map` (so the same FID auto-fills next time).

If one item fails (at any step), it doesn't stop the batch — processing continues to the next item in the queue; the failed one is marked "Failed" in the list, with details in the log below.

While processing, a "Cancel" button appears — clicking it immediately kills the currently running SAP download child process and stops processing the rest of the queue (already-completed items are unaffected). The running download child process is also automatically killed when the lambom window is closed or the app quits entirely, so it never lingers as an orphan process still operating SAP in the background.

## Configuring the production URL

Edit `electron/config.js` and replace `LAMBOM_URL` with lambom's actual Vercel production URL.

## Development / testing (the main window part also runs on macOS)

```bash
cd desktop/electron
npm install
npm start
```

This lets you test the window shell itself on a Mac (the main window, menu, SAP Download panel's display/log logic). But whether "SAP Download" actually works when clicked can only be verified on a Windows machine with SAP GUI installed, since `fid_downloader_cli.py`'s use of `win32com` is Windows-only COM automation that simply doesn't run on a Mac.

## Building a production exe on Windows

**Step 1: build the SAP download tool first**

```bat
cd desktop\sap-downloader
build.bat
```

This produces `desktop\sap-downloader\dist\fid_downloader_cli.exe`. You can test this step alone from the command line first, to confirm the SAP automation actually works, before moving on:

```bat
dist\fid_downloader_cli.exe 264059
```

(Replace 264059 with a real FID you want to test — once it finishes you should see `264059.xlsx` in the current folder, with the last line printing `RESULT_PATH:...`.)

To test Modules (requires a real SO):

```bat
dist\fid_downloader_cli.exe --mode modules --so R0542
```

Once finished you should see an `R0542_modules.xlsx` in the current folder, one sheet per module (the multiple raw files SAP produces have already been merged and cleaned up automatically).

**Step 2: build the Electron desktop app**

```bat
cd desktop\electron
npm install
npm run dist
```

The `electron-builder` config already specifies that the `fid_downloader_cli.exe` produced in the previous step gets bundled in too (`extraResources`); once done, you'll find an installer (`.exe` NSIS installer) in `desktop\electron\dist\`.

## Known limitations / possible future work

- There's no app icon yet — electron-builder will use its default icon. To use a custom one, drop a 256x256 .ico at `electron/build/icon.ico`, and add `"icon": "build/icon.ico"` under `build.win` in `package.json`.
- There's no code signing yet, so Windows SmartScreen may show a warning — the same situation as the current BOM Manager exe, which is generally acceptable for an internal tool.
- FID→SO resolution (`resolve_so_from_fid`): if a FID's BOM has been revised, VA03 may return more than one result, in which case the "bottom-most" one in the list is always picked. The list's "row" spacing (each additional result shifts down by 129) was derived from real cases and has been verified correct up to 5 results (FID 245828). The list's "column" position isn't always the same across searches (columns 3, 4, and 7 have all been observed for different FIDs), so the tool first scans a column range (starting at 2, excluding a decorative column 1 found during testing) to determine which column this search is using, rather than guessing a fixed value. If VA03's order field comes back empty after selecting, it raises an error immediately rather than continuing with an unverified SO value. If a wrong selection happens, check whether the log's printed result count / column / resolved SO are correct.
