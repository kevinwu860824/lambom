r"""
ZBOM Observer — read-only diagnostic tool for the VA03 Configuration screen.
------------------------------------------------------------------------------
Not part of the lambom download pipeline itself — this exists purely to
gather real evidence about what SAP's Configuration screen actually reports
while a human manually clicks through it, without using SAP's own Record and
Playback (which the user found interferes with normal operation).

It attaches to an ALREADY-OPEN SAP session the exact same way
fid_downloader_cli.py does (win32com.client.GetObject("SAPGUI")) — this is
the same mechanism lambom's automation already uses successfully, not SAP's
built-in recorder, so it should not have the same interference problem.

It only ever *reads* control state (tree node keys, table contents, field
text) — it never calls press(), doubleClickNode(), sets .text, or sends any
other command to SAP. It's safe to run alongside a human manually operating
the same session.

Usage:
    1. Manually navigate to VA03 -> Item Overview -> Configuration for the SO
       you want to look at.
    2. Run this script: python zbom_observer.py   (or the equivalent via a
       plain `python.exe` if pywin32 is already installed — same
       prerequisites as fid_downloader_cli.py, no separate install needed).
    3. Manually click through the Configuration Structure tree / scroll the
       tables exactly as you normally would. The script polls every 0.7s and
       only prints a new line when something it's watching actually changes,
       so the output is a compact timeline of what happened, not a flood of
       identical repeated lines.
    4. Press Ctrl+C when done. A full log is also written to
       zbom_observer_<timestamp>.log in this same folder — send that file
       back for diagnosis.
"""

import datetime
import os
import sys
import time

import win32com.client

ZBOM_TABLE_ID = (
    "wnd[0]/usr/subCE_INSTANCE:SAPLCEI0:0105"
    "/subCHARACTERISTICS:SAPLCEI0:1400/tblSAPLCEI0CHARACTER_VALUES"
)
ZBOM_HEADER_ID = "wnd[0]/usr/subCE_INSTANCE:SAPLCEI0:0105/subHEADER:SAPMV45A:0460"
ZBOM_SECTION_LABEL_ID = "wnd[0]/usr/subCE_INSTANCE:SAPLCEI0:0105/subHEADER:SAPLCUKO:7035/txtRCUKO-IMAKTX"
TREE_ID = "wnd[0]/shellcont/shell"

POLL_SECONDS = 0.7

_log_file = None


def log(msg):
    line = f"[{datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3]}] {msg}"
    print(line, flush=True)
    if _log_file:
        _log_file.write(line + "\n")
        _log_file.flush()


def try_connect_sap():
    """Attach to whatever SAP session is already open — never launches or
    controls SAP. Same approach as fid_downloader_cli.py's try_connect_sap."""
    try:
        sap_gui_auto = win32com.client.GetObject("SAPGUI")
        application = sap_gui_auto.GetScriptingEngine
        if application.Children.Count == 0:
            return None
        connection = application.Children(0)
        if connection.Children.Count == 0:
            return None
        session = connection.Children(0)
        _ = session.Info.SystemName
        return session
    except Exception:
        return None


def safe_get(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def read_cell_text(session, row_idx, col_name, col_idx):
    for prefix in ("ctxt", "txt", "lbl"):
        try:
            cell = session.findById(f"{ZBOM_TABLE_ID}/{prefix}{col_name}[{col_idx},{row_idx}]")
            return cell.text
        except Exception:
            continue
    return None


def snapshot(session):
    """Reads everything relevant right now, read-only. Returns a plain dict
    so it's trivial to compare two snapshots for "did anything change"."""
    data = {}

    data["active_window"] = safe_get(lambda: session.ActiveWindow.Id)

    tree = safe_get(lambda: session.findById(TREE_ID))
    if tree is not None:
        node_keys = safe_get(lambda: list(tree.GetAllNodeKeys()), [])
        data["tree_node_count"] = len(node_keys)
        data["tree_node_keys"] = node_keys
        data["tree_selected_node"] = safe_get(lambda: tree.selectedNode, "<not readable>")
    else:
        data["tree_node_count"] = None
        data["tree_node_keys"] = None
        data["tree_selected_node"] = None

    data["section_label_field"] = safe_get(
        lambda: session.findById(ZBOM_SECTION_LABEL_ID).text.strip()
    )
    data["header_arktx_field"] = safe_get(
        lambda: session.findById(f"{ZBOM_HEADER_ID}/txtVBAP-ARKTX").text.strip()
    )

    table = safe_get(lambda: session.findById(ZBOM_TABLE_ID))
    if table is not None:
        data["table_visible_rows"] = safe_get(lambda: table.VisibleRowCount)
        data["table_row_count"] = safe_get(lambda: table.RowCount)
        col_count = safe_get(lambda: table.Columns.Count, 0)
        cols = safe_get(lambda: [table.Columns(c).Name for c in range(col_count)], [])
        data["table_columns"] = cols
        # First 3 visible rows' MNAME/MWERT, if those columns are present —
        # enough to tell whether the table's *content* actually changed
        # between two snapshots, not just its row/column counts.
        preview = []
        if "RCTMS-MNAME" in cols and "RCTMS-MWERT" in cols:
            name_idx = cols.index("RCTMS-MNAME")
            value_idx = cols.index("RCTMS-MWERT")
            for r in range(min(3, data.get("table_visible_rows") or 0)):
                name = read_cell_text(session, r, "RCTMS-MNAME", name_idx)
                value = read_cell_text(session, r, "RCTMS-MWERT", value_idx)
                preview.append((name, value))
        data["table_preview"] = preview
    else:
        data["table_visible_rows"] = None
        data["table_row_count"] = None
        data["table_columns"] = None
        data["table_preview"] = None

    return data


def describe_diff(prev, cur):
    """Only the fields that changed, human-readable — this is what actually
    gets logged on each poll, so the output reads as a timeline of real
    events instead of a wall of unchanged noise."""
    if prev is None:
        return "initial snapshot: " + summarize(cur)
    changes = []
    for key in cur:
        if cur[key] != prev.get(key):
            changes.append(f"{key}: {prev.get(key)!r} -> {cur[key]!r}")
    return "; ".join(changes) if changes else None


def summarize(data):
    return (
        f"active_window={data['active_window']!r} "
        f"tree_nodes={data['tree_node_count']} "
        f"selected={data['tree_selected_node']!r} "
        f"section_label={data['section_label_field']!r} "
        f"header_arktx={data['header_arktx_field']!r} "
        f"table_rows={data['table_row_count']}/{data['table_visible_rows']}visible "
        f"preview={data['table_preview']!r}"
    )


def main():
    global _log_file
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"zbom_observer_{timestamp}.log")
    _log_file = open(log_path, "w", encoding="utf-8")

    log(f"ZBOM Observer starting. Writing to {log_path}")
    log("Read-only — will not click/press/type anything into SAP.")
    log("Make sure you've already manually navigated to the Configuration screen, then start clicking through it.")
    log("Press Ctrl+C to stop.\n")

    session = try_connect_sap()
    if session is None:
        log("[Error] Could not attach to an existing SAP session. Open SAP and navigate to the Configuration screen first, then re-run this script.")
        return

    log("Attached to existing SAP session.")

    prev = None
    try:
        while True:
            cur = snapshot(session)
            diff = describe_diff(prev, cur)
            if diff:
                log(diff)
            prev = cur
            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        log("\nStopped by user.")
    finally:
        _log_file.close()
        log_stdout_only = f"Full log saved to {log_path}"
        print(log_stdout_only)


if __name__ == "__main__":
    main()
