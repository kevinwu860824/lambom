r"""
FID BOM Downloader (CLI version)
---------------------------------
Same SAP automation logic as fid_downloader_gui.py (IB53 search + expand/
export + convert to Excel), the only difference being this one has no
tkinter window of its own — it's a pure command-line tool built for the
lambom desktop app (Electron) to call: Electron handles the window and
progress display, this tool handles actually driving SAP.

Usage:
    fid_downloader_cli.exe <FID> [--out-dir OUTPUT_DIR]                      (default tool mode, Full BOM)
    fid_downloader_cli.exe --mode modules --so <SO> [--out-dir OUTPUT_DIR]   (Module BOM, ZOOBOM_CE_FMT)
    fid_downloader_cli.exe <FID> --mode modules [--out-dir OUTPUT_DIR]      (Module BOM, leave SO blank to resolve it from FID)

Behavior:
- Progress messages are printed to stdout one line at a time (for the caller to display live).
- Both modes always produce exactly ONE clean xlsx in the end (intermediate
  files and raw multi-file output are cleaned up automatically): tool mode
  produces `<FID>.xlsx`; modules mode produces `<SO>_modules.xlsx`, split
  into sheets by module, with the coordinate issue already fixed. The last
  line on success is always `RESULT_PATH:<full path to the output xlsx>`,
  so the caller can extract the result file's location from this marker
  instead of guessing from other output.
- Any failure prints `[Error] ...` and exits with a non-zero exit code.

Prerequisites (same as fid_downloader_gui.py):
1. A Windows machine with SAP auto-login (SSO) — no manual login required.
2. Install packages first: pip install pywin32 openpyxl
3. SAP GUI Scripting must be enabled.
4. Replace SAP_PORTAL_URL with your own company Portal's "Open SAP" link.

Packaging into an exe (run on Windows):
    pip install pyinstaller
    pyinstaller --onefile --console --name fid_downloader_cli fid_downloader_cli.py
   (Keep console output — don't add --noconsole, since Electron needs to read stdout.)
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile

import win32com.client
import openpyxl

# When run as a child process by Electron, stdout/stderr aren't attached to a
# real console, so Windows falls back to a codepage like cp1252 that can't
# encode Chinese/CJK text by default, crashing with UnicodeEncodeError the
# moment such a log line is printed. Force utf-8, substituting a placeholder
# for characters that still can't be encoded, so it never crashes on this.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# The URL of the "Open SAP" link in the company Portal — opening it logs you
# into SAP automatically via SSO. This is YOUR personal navurl; whoever else
# uses this needs to swap in their own link.
SAP_PORTAL_URL = (
    "https://epp.fremont.lamrc.net/irj/portal"
    "?NavigationTarget=navurl://e9dc0731c19963b952ca3fbeceed6db3"
)
SAP_PROCESS_NAMES = ["saplogon.exe", "sapgui.exe"]


def log(msg):
    print(msg, flush=True)


# ---------- SAP automation logic (identical to fid_downloader_gui.py) ----------

def is_sap_process_running():
    """Check via tasklist whether any SAP-related process is running."""
    try:
        output = subprocess.check_output(
            ["tasklist"], text=True, errors="ignore",
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception:
        return False
    output_lower = output.lower()
    return any(name in output_lower for name in SAP_PROCESS_NAMES)


def kill_sap_processes():
    for name in SAP_PROCESS_NAMES:
        subprocess.run(
            ["taskkill", "/F", "/IM", name],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    time.sleep(2)


def launch_sap_logon():
    """Simulates what you'd normally do — click the company Portal link to open SAP: just open the URL and let the default browser + SSO handle it."""
    os.startfile(SAP_PORTAL_URL)


def try_connect_sap():
    """Try connecting and do a quick sanity check that it's actually usable; returns the session on success, None on failure."""
    try:
        sap_gui_auto = win32com.client.GetObject("SAPGUI")
        application = sap_gui_auto.GetScriptingEngine
        if application.Children.Count == 0:
            return None
        connection = application.Children(0)
        if connection.Children.Count == 0:
            return None
        session = connection.Children(0)
        _ = session.Info.SystemName  # quick check that the session actually responds
        return session
    except Exception:
        return None


def ensure_sap_connected(max_wait_seconds=120):
    """
    Ensure SAP is connected and return a usable session:
      1. First test whether there's already a usable connection; use it directly if so
      2. Can't connect but an SAP process is running -> kill it and relaunch
      3. SAP isn't open at all -> launch it directly
      4. After launching, poll and wait for auto-login (SSO) + Scripting registration to complete
    """
    log("Testing current SAP connection...")
    session = try_connect_sap()
    if session is not None:
        log("Usable connection already exists, using it directly.")
        return session

    if is_sap_process_running():
        log("Detected an SAP process running but couldn't connect, killing and relaunching...")
        kill_sap_processes()
    else:
        log("SAP isn't currently open, preparing to launch...")

    log("Launching SAP Logon...")
    launch_sap_logon()

    log("Waiting for SAP auto-login and Scripting to become ready...")
    waited = 0
    interval = 2
    while waited < max_wait_seconds:
        time.sleep(interval)
        waited += interval
        session = try_connect_sap()
        if session is not None:
            log(f"SAP connected successfully (waited about {waited}s).")
            return session
        if waited % 10 == 0:
            log(f"Still waiting for login to complete... ({waited}s elapsed)")

    raise RuntimeError(f"Waited {max_wait_seconds}s and still couldn't connect to SAP — check whether auto-login completed properly.")


def open_ib53_with_fid(session, fid):
    session.findById("wnd[0]/tbar[0]/okcd").text = "/nIB53"
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(1)

    session.findById("wnd[0]/usr/subENTRANCE:SAPLIBOF_R3:0100/ctxtRIBOF-IBASE").text = "0"
    session.findById("wnd[0]/usr/subENTRANCE:SAPLIBOF_R3:0100/ctxtRIBOF-IBASE").caretPosition = 1
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(1)

    session.findById("wnd[0]/usr/subENTRANCE:SAPLIBOF_R3:0100/ctxtRIBOFO-EQUNO").setFocus()
    session.findById("wnd[0]/usr/subENTRANCE:SAPLIBOF_R3:0100/ctxtRIBOFO-EQUNO").caretPosition = 0
    session.findById("wnd[0]").sendVKey(4)  # F4 -> search help
    time.sleep(1)

    # Tab 5 = "F: Equipment by technical ID number"
    session.findById("wnd[1]/usr/tabsG_SELONETABSTRIP/tabpTAB005").select()
    session.findById(
        "wnd[1]/usr/tabsG_SELONETABSTRIP/tabpTAB005"
        "/ssubSUBSCR_PRESEL:SAPLSDH4:0220/sub:SAPLSDH4:0220/txtG_SELFLD_TAB-LOW[0,24]"
    ).text = fid

    session.findById("wnd[1]/tbar[0]/btn[0]").press()
    session.findById("wnd[1]/tbar[0]/btn[0]").press()
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(3)


def export_installed_base(session, save_path, filename):
    tree = session.findById("wnd[0]/shellcont/shell/shellcont[1]/shell[0]")
    tree.pressButton("IBOCX_AUFR")
    tree.pressContextButton("&PRINT_BACK")
    tree.selectContextMenuItem("&PRINT_PREV_ALL")

    session.findById("wnd[0]/mbar/menu[3]/menu[5]/menu[2]/menu[1]").select()

    session.findById(
        "wnd[1]/usr/subSUBSCREEN_STEPLOOP:SAPLSPO5:0150/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[1,0]"
    ).select()
    session.findById("wnd[1]/tbar[0]/btn[0]").press()

    session.findById("wnd[1]/usr/ctxtDY_PATH").text = save_path
    session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = filename
    session.findById("wnd[1]/tbar[0]/btn[0]").press()

    # After saving, press F3 3 times to go back to the base screen so the
    # session returns to a clean state (matching the verified Script
    # Recording), avoiding leftover screens interfering with the Modules run
    # that follows.
    session.findById("wnd[0]").sendVKey(3)
    session.findById("wnd[0]").sendVKey(3)
    session.findById("wnd[0]").sendVKey(3)


def resolve_so_from_fid(session, fid):
    """
    Resolve the corresponding SO from a FID — open VA03, press F4 on the
    Sales Document field, switch to the "A: Sales document according to
    customer PO number" tab, search using the FID as a wildcard (<FID>*),
    select the "bottom-most" row in the results list, then read back VA03's
    order field (VBAK-VBELN) to confirm the selected SO (if a FID's BOM has
    been revised, the search may return more than one result — confirmed
    with the user that the bottom-most one should always be picked).

    This list's elements are addressed via lbl[row,col], where the row/col
    numbers are NOT a "which result number" sequence — they're internal
    screen coordinates. Verified against 4 real cases using SAP GUI's Script
    Recording and Playback:
      - FID 255678, 1 result only: the sole result is at lbl[1,3] (col 3)
      - FID 246845, 2 results: the top one is at lbl[1,4], the bottom one at
        lbl[130,4] (col 4)
      - FID 245828, 5 results: one of them is at lbl[1,7] (col 7)
    Initially assumed the "column" switched based on "single vs multiple
    results" (single uses 3, multiple uses 4), but 245828 is also multiple
    results yet uses column 7, disproving that assumption — the column is
    actually different for each search, with no fixed value, so it can't be
    guessed. Changed to:
      - Column: scan a range of columns at row 1 first to find which column
        this search's results actually use (whichever has text first). The
        scan range starts at 2, not 0 — testing showed that when FID 245828
        scanned to column 1, that column turned out to be unrelated to the
        data (possibly a leftover cursor-box artifact from the currently
        selected cell); selecting it left VA03 unable to read an SO. The 3
        real verified columns (3, 4, 7) are never below 3, so the floor was
        raised to 2 to exclude this kind of false positive.
      - Row: once the column is found, starting from row 1 and using that
        same column, step down by 129 per additional result (1, 130,
        259, ...) to find the bottom-most row — this spacing was derived
        from 246845's 2 real results (both the 1st and 2nd line up); 3+
        results hasn't actually been verified yet.
      - Safety net: if VA03's order field can't be read after selecting, it
        raises an error right away (never proceeds with an unverified SO
        value), so even if the column scan picks the wrong one, a wrong SO
        never ends up mixed into the Supabase data.
    """
    session.findById("wnd[0]/tbar[0]/okcd").text = "VA03"
    session.findById("wnd[0]/tbar[0]/btn[0]").press()
    session.findById("wnd[0]").sendVKey(4)
    time.sleep(1)

    session.findById(
        "wnd[1]/usr/tabsG_SELONETABSTRIP/tabpTAB001"
        "/ssubSUBSCR_PRESEL:SAPLSDH4:0220/sub:SAPLSDH4:0220/txtG_SELFLD_TAB-LOW[2,24]"
    ).text = f"{fid}*"
    session.findById("wnd[1]").sendVKey(0)

    ROW_STEP = 129
    COL_RANGE = range(2, 20)

    def label_text(row, col):
        try:
            label = session.findById(f"wnd[1]/usr/lbl[{row},{col}]")
        except Exception:
            return None
        text = (label.text or "").strip()
        return text if text else None

    # The results list takes time to query/render — not noticeable when
    # operating manually, but running automatically right after a Full BOM
    # export can occasionally be slower than a fixed 1-second sleep, causing
    # real results to be misjudged as an empty list. Changed to polling for
    # up to 5 seconds (scanning columns every 0.5s), instead of a fixed
    # 1-second sleep followed by a single check.
    col = None
    for _ in range(10):
        for c in COL_RANGE:
            if label_text(1, c) is not None:
                col = c
                break
        if col is not None:
            break
        time.sleep(0.5)

    if col is None:
        raise RuntimeError("Failed to resolve SO from FID — the search results list is empty, check the SAP screen.")

    last_row = 1
    count = 1
    while True:
        next_row = 1 + count * ROW_STEP
        if label_text(next_row, col) is None:
            break
        last_row = next_row
        count += 1

    log(f"Search found {count} result(s) (column {col}), selecting the bottom-most one.")
    target = session.findById(f"wnd[1]/usr/lbl[{last_row},{col}]")
    target.setFocus()
    target.caretPosition = 0
    session.findById("wnd[1]").sendVKey(2)

    time.sleep(1)

    so = (session.findById("wnd[0]/usr/ctxtVBAK-VBELN").text or "").strip()
    if not so:
        raise RuntimeError(
            "Failed to resolve SO from FID — VA03's order field came back empty; the screen "
            "may be stuck needing manual confirmation on some list, check the SAP screen."
        )

    log(f"Resolved SO from VA03: {so}")
    return so


def download_module_bom(session, so, out_dir):
    """
    Module BOM download — the full flow has been recorded and verified
    line-by-line using SAP GUI's Script Recording and Playback:
      1. Type /nZOOBOM_CE_FMT as the transaction code, press Enter
      2. Enter the SO into the Sales Document field (S_VBELN-LOW)
      3. Press F4 on the Folder field (P_FOLDER), a folder-selection window
         pops up; specify the output folder using the same DY_PATH field as
         the Tool BOM export, then confirm
      4. Press Execute (tbar[1]/btn[8], F8) — ZOOBOM_CE_FMT automatically
         writes multiple Excel files directly into the folder just
         specified, with no further save dialog appearing
      5. Press F3 twice to go back

    Unlike Tool BOM, we don't know in advance how many files SAP will
    produce or their exact names (ZOOBOM_CE_FMT decides that itself), so
    newly-created files are detected via the "difference in folder contents
    before vs. after execution" rather than waiting for a single fixed
    filename.
    """
    os.makedirs(out_dir, exist_ok=True)
    before = set(os.listdir(out_dir))

    session.findById("wnd[0]/tbar[0]/okcd").text = "/nZOOBOM_CE_FMT"
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(1)

    session.findById("wnd[0]/usr/ctxtS_VBELN-LOW").text = so

    session.findById("wnd[0]/usr/ctxtP_FOLDER").setFocus()
    session.findById("wnd[0]/usr/ctxtP_FOLDER").caretPosition = 0
    session.findById("wnd[0]").sendVKey(4)  # F4 -> folder selection
    time.sleep(1)

    session.findById("wnd[1]/usr/ctxtDY_PATH").text = out_dir
    session.findById("wnd[1]/usr/ctxtDY_PATH").setFocus()
    session.findById("wnd[1]/usr/ctxtDY_PATH").caretPosition = len(out_dir)
    session.findById("wnd[1]/tbar[0]/btn[0]").press()
    time.sleep(1)

    session.findById("wnd[0]/tbar[1]/btn[8]").press()  # Execute (F8)
    time.sleep(3)

    session.findById("wnd[0]").sendVKey(3)
    session.findById("wnd[0]").sendVKey(3)

    log("Waiting for SAP to write the files...")
    new_files = []
    for _ in range(30):
        time.sleep(1)
        after = set(os.listdir(out_dir))
        new_files = sorted(after - before)
        if new_files:
            time.sleep(2)  # wait a bit longer to make sure files aren't still being written
            after = set(os.listdir(out_dir))
            new_files = sorted(after - before)
            break

    if not new_files:
        raise RuntimeError("Timed out waiting for new files — check whether the SAP screen is stuck, or whether the output folder is correct.")

    return [os.path.join(out_dir, name) for name in new_files]


# ---------- Module BOM raw file cleanup: coordinate fix + merge into one multi-sheet xlsx ----------
#
# Every module file produced directly by ZOOBOM_CE_FMT has broken cell
# coordinates (<c r="...">, e.g. a malformed r=" 11"-style value), which
# standard xlsx libraries (including openpyxl, used here) can't read
# directly — they raise an exception. Excel/Numbers desktop apps can open
# them fine because they're lenient, reading cells in "document order"
# instead of trusting the r= attribute — the functions below manually parse
# the xlsx's internal XML following that same logic (this is the same
# approach as lib/bom-parse.ts's readXlsxRowsLenient, just ported to
# Python); after reading out the clean data, openpyxl rewrites a fresh xlsx
# with correct coordinates, merging multiple module sheets together.


def decode_xml_entities(text):
    text = text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
    text = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), text)
    text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
    return text.replace("&amp;", "&")


def parse_shared_strings(xml_text):
    strings = []
    for m in re.finditer(r"<si>(.*?)</si>", xml_text, re.S):
        texts = re.findall(r"<t[^>]*>(.*?)</t>", m.group(1), re.S)
        strings.append(decode_xml_entities("".join(texts)))
    return strings


def parse_sheet_rows_lenient(xml_text, shared_strings):
    rows = []
    for row_match in re.finditer(r"<row\b[^>]*>(.*?)</row>", xml_text, re.S):
        cells = []
        for cell_match in re.finditer(r"<c\b([^>]*?)(?:/>|>(.*?)</c>)", row_match.group(1), re.S):
            attrs, inner = cell_match.group(1), cell_match.group(2) or ""
            type_match = re.search(r'\st="([^"]*)"', attrs)
            cell_type = type_match.group(1) if type_match else "n"
            if cell_type == "inlineStr":
                is_body = re.search(r"<is>(.*?)</is>", inner, re.S)
                texts = re.findall(r"<t[^>]*>(.*?)</t>", is_body.group(1), re.S) if is_body else []
                value = decode_xml_entities("".join(texts))
            else:
                v_match = re.search(r"<v>(.*?)</v>", inner, re.S)
                raw = v_match.group(1) if v_match else ""
                if cell_type == "s" and raw:
                    try:
                        idx = int(raw)
                        value = shared_strings[idx] if 0 <= idx < len(shared_strings) else ""
                    except ValueError:
                        value = ""
                else:
                    value = decode_xml_entities(raw) if raw else ""
            cells.append(value)
        rows.append(cells)
    return rows


def resolve_first_sheet_path(names, workbook_xml, rels_xml):
    fallback = "xl/worksheets/sheet1.xml"
    m = re.search(r'<sheet\b[^>]*\br:id="([^"]+)"', workbook_xml)
    if not m:
        return fallback
    m2 = re.search(
        rf'<Relationship\b[^>]*\bId="{re.escape(m.group(1))}"[^>]*\bTarget="([^"]+)"', rels_xml
    )
    if not m2:
        return fallback
    return f"xl/{re.sub(r'^/?xl/', '', m2.group(1))}"


def read_xlsx_rows_lenient(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        workbook_xml = z.read("xl/workbook.xml").decode("utf-8", "replace") if "xl/workbook.xml" in names else ""
        rels_xml = (
            z.read("xl/_rels/workbook.xml.rels").decode("utf-8", "replace")
            if "xl/_rels/workbook.xml.rels" in names
            else ""
        )
        sheet_path = resolve_first_sheet_path(names, workbook_xml, rels_xml)
        if sheet_path not in names:
            sheet_path = "xl/worksheets/sheet1.xml"
        sheet_xml = z.read(sheet_path).decode("utf-8", "replace")
        shared_strings = (
            parse_shared_strings(z.read("xl/sharedStrings.xml").decode("utf-8", "replace"))
            if "xl/sharedStrings.xml" in names
            else []
        )
    return parse_sheet_rows_lenient(sheet_xml, shared_strings)


def collapse_spaces(value):
    return re.sub(r"\s{2,}", " ", value or "").strip()


def parse_sap_field_rows(rows):
    """Converts raw SAP field-name (MATERIAL/DESCRIPTION/UOM/BOMLEVEL/
    GENE00...) row data into a clean Part Number/Description/Level/Path/
    Qty/Unit structure, following the same rules as lib/bom-parse.ts's
    parseSapFieldRows. Returns None if the format doesn't match, in which
    case the caller keeps the raw row data instead of discarding this
    module's content entirely."""
    if len(rows) < 2:
        return None

    header = [h.strip() for h in rows[0]]

    def col_index(name):
        return header.index(name) if name in header else -1

    material_idx = col_index("MATERIAL")
    description_idx = col_index("DESCRIPTION")
    uom_idx = col_index("UOM")
    bom_qty_idx = col_index("BOM_QTY")
    newbuild_qty_idx = col_index("NEWBUILD_QTY")
    level_idx = col_index("BOMLEVEL")

    genealogy_indices = sorted(
        (int(m.group(1)), idx)
        for idx, name in enumerate(header)
        for m in [re.match(r"^GENE(\d{2,})$", name)]
        if m
    )
    genealogy_indices = [idx for _, idx in genealogy_indices]

    if material_idx == -1 or level_idx == -1 or not genealogy_indices:
        return None

    items = []
    for r in range(1, len(rows)):
        fields = rows[r]
        if not fields or all(not c.strip() for c in fields):
            continue

        def get(idx, fields=fields):
            return fields[idx].strip() if 0 <= idx < len(fields) else ""

        part_no = get(material_idx)
        level_raw = get(level_idx)
        if not part_no or not level_raw.lstrip("-").isdigit():
            continue
        level = int(level_raw)

        description = collapse_spaces(get(description_idx))
        uom = get(uom_idx) or None
        qty_raw = get(bom_qty_idx) or get(newbuild_qty_idx)
        try:
            qty = float(qty_raw) if qty_raw else None
        except ValueError:
            qty = None

        genealogy = [get(idx) for idx in genealogy_indices]
        ancestors = [g for g in genealogy[:level] if g]

        items.append(
            {
                "part_no": part_no,
                "description": description or None,
                "level": level,
                "path": "/".join(ancestors),
                "qty": qty,
                "unit": uom,
            }
        )

    return items


def derive_sheet_name(path):
    """Extracts the module's short name (GB1) from the filename (e.g.
    "R0670_130 - GB1 --- LVL02 2026-...xlsx") to use as the sheet name.
    Falls back to the full filename (without extension) if it can't be
    extracted."""
    name_no_ext = os.path.splitext(os.path.basename(path))[0]
    left = name_no_ext.split(" --- ")[0]
    parts = left.split(" - ")
    return (parts[-1].strip() if len(parts) > 1 else name_no_ext)[:31]


def merge_module_files(file_paths, out_path):
    """Merges several raw module files (whose coordinates may be broken)
    into one clean multi-sheet xlsx, one sheet per module, with columns
    normalized to Part Number/Description/Level/Path/Qty/Unit."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    for path in file_paths:
        rows = read_xlsx_rows_lenient(path)
        items = parse_sap_field_rows(rows)
        ws = wb.create_sheet(title=derive_sheet_name(path))
        ws.append(["Part Number", "Description", "Level", "Path", "Qty", "Unit"])
        if items is not None:
            for item in items:
                ws.append(
                    [item["part_no"], item["description"], item["level"], item["path"], item["qty"], item["unit"]]
                )
        else:
            # Not the expected SAP field format — keep the raw row data rather than discarding this module entirely.
            for row in rows:
                ws.append(row)

    wb.save(out_path)


def parse_tab_export(txt_path):
    with open(txt_path, encoding="utf-8-sig", errors="replace") as f:
        lines = f.readlines()
    rows = []
    for line in lines:
        line = line.rstrip("\n")
        if not line.strip():
            continue
        tokens = [t.strip() for t in line.split("\t") if t.strip() != ""]
        if len(tokens) != 4:
            continue
        desc, record, qty, unit = tokens
        indent = len(line) - len(line.lstrip("\t"))
        rows.append((record, desc, indent, qty, unit))
    return rows


def write_bom_xlsx(rows, out_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "BOM"
    ws.append(["Part Number", "Description", "Indent(raw tab depth)", "Qty", "Unit"])
    for record, desc, indent, qty, unit in rows:
        try:
            qty_val = float(qty)
        except ValueError:
            qty_val = qty
        ws.append([record, desc, indent, qty_val, unit])
    wb.save(out_path)


# ---------- CLI entry point ----------

def run(fid, out_dir, mode="tool", so=None):
    if mode == "modules":
        if not so and not fid:
            raise RuntimeError("Module BOM download requires an SO or FID (if SO is omitted, it's auto-resolved from FID).")

        session = ensure_sap_connected()

        if not so:
            log(f"No SO given, resolving the corresponding SO from FID {fid}...")
            so = resolve_so_from_fid(session, fid)

        # module_dir is just a scratch folder for SAP to dump raw files into;
        # once merged and cleaned up it's deleted entirely — the caller gets
        # the final single clean xlsx.
        module_dir = os.path.join(out_dir, f"{so}_modules")
        log(f"Opening ZOOBOM_CE_FMT, running with SO {so}...")
        raw_files = download_module_bom(session, so, module_dir)

        log(f"Download complete, {len(raw_files)} raw file(s), merging into one clean xlsx...")
        merged_path = os.path.join(out_dir, f"{so}_modules.xlsx")
        merge_module_files(raw_files, merged_path)
        shutil.rmtree(module_dir, ignore_errors=True)

        log(f"Done! Merged into {merged_path} (raw files cleaned up).")
        return merged_path

    os.makedirs(out_dir, exist_ok=True)
    txt_name = f"{fid}.txt"
    xlsx_name = f"{fid}.xlsx"
    txt_path = os.path.join(out_dir, txt_name)

    session = ensure_sap_connected()

    log(f"Opening IB53, searching for the equipment with FID {fid}...")
    open_ib53_with_fid(session, fid)

    log("Expanding the structure and exporting...")
    export_installed_base(session, out_dir, txt_name)

    log("Waiting for SAP to write the file...")
    for _ in range(60):
        if os.path.exists(txt_path):
            break
        time.sleep(1)
    else:
        raise RuntimeError("Timed out waiting for the exported file — check whether the SAP screen is stuck.")

    log("Parsing and converting to Excel...")
    rows = parse_tab_export(txt_path)
    if not rows:
        raise RuntimeError("Parsed 0 rows of data — open the txt file and check its format.")

    xlsx_path = os.path.join(out_dir, xlsx_name)
    write_bom_xlsx(rows, xlsx_path)

    # The txt file is just an intermediate conversion artifact — once
    # converted it's no longer needed, so remove it and keep only the final xlsx.
    os.remove(txt_path)

    log(f"Done! {len(rows)} part number(s) total.")
    return xlsx_path


def main():
    parser = argparse.ArgumentParser(description="Download a BOM from SAP by FID/SO and convert it to xlsx")
    parser.add_argument("fid", nargs="?", default=None, help="The FID to look up (required for tool mode)")
    parser.add_argument("--out-dir", default=os.getcwd(), help="Output folder (defaults to the current working directory)")
    parser.add_argument(
        "--mode",
        choices=["tool", "modules"],
        default="tool",
        help="tool = Full BOM (IB53, default, requires FID); modules = split by module (ZOOBOM_CE_FMT, requires SO)",
    )
    parser.add_argument("--so", default=None, help="SO number (required for modules mode)")
    args = parser.parse_args()

    if args.mode == "tool" and not args.fid:
        log("[Error] tool mode requires a FID.")
        sys.exit(1)

    try:
        fid = args.fid.strip() if args.fid else None
        so = args.so.strip() if args.so else None
        xlsx_path = run(fid, args.out_dir, args.mode, so)
    except Exception as e:
        log(f"[Error] {e}")
        sys.exit(1)

    log(f"RESULT_PATH:{xlsx_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
