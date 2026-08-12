r"""
Inventory Lookup (CLI version)
------------------------------
Attaches to an already-open, already-logged-in SAP GUI session (same
technique as fid_downloader_cli.py) and drives it to the stock overview
screen for one material number. No file output — the point is just for the
user to look at the SAP screen after clicking, not to download anything.

Usage:
    inventory_lookup_cli.exe <PART_NO>

Behavior:
- Progress messages are printed to stdout one line at a time.
- On success, exits 0 after the SAP screen shows the queried material.
- Any failure prints `[Error] ...` and exits with a non-zero exit code.

Prerequisites (same as fid_downloader_cli.py):
1. A Windows machine with SAP auto-login (SSO) — no manual login required.
2. Install packages first: pip install pywin32
3. SAP GUI Scripting must be enabled.
4. Replace SAP_PORTAL_URL with your own company Portal's "Open SAP" link.

Packaging into an exe (run on Windows):
    pip install pyinstaller
    pyinstaller --onefile --console --name inventory_lookup_cli inventory_lookup_cli.py
   (Keep console output — don't add --noconsole, since Electron needs to read stdout.)
"""

import argparse
import os
import subprocess
import sys
import time

import win32com.client
import win32gui
import win32con

# When run as a child process by Electron, stdout/stderr aren't attached to a
# real console, so Windows falls back to a codepage like cp1252 that can't
# encode Chinese/CJK text by default, crashing with UnicodeEncodeError the
# moment such a log line is printed. Force utf-8, substituting a placeholder
# for characters that still can't be encoded, so it never crashes on this.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# The URL of the "Open SAP" link in the company Portal — opening it logs you
# into SAP automatically via SSO. This is YOUR personal navurl; whoever else
# uses this needs to swap in their own link. Identical to fid_downloader_cli.py.
SAP_PORTAL_URL = (
    "https://epp.fremont.lamrc.net/irj/portal"
    "?NavigationTarget=navurl://e9dc0731c19963b952ca3fbeceed6db3"
)
SAP_PROCESS_NAMES = ["saplogon.exe", "sapgui.exe"]


def log(msg):
    print(msg, flush=True)


# ---------- SAP connection logic (identical to fid_downloader_cli.py) ----------

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


# ---------- Inventory lookup ----------

def current_screen_info(session):
    """Best-effort snapshot of what SAP is actually showing right now —
    appended to error messages below so a "control not found" failure says
    not just which step but what screen SAP was really on at that moment,
    instead of leaving that to be guessed at from the raw COM exception
    alone."""
    try:
        return f"(current transaction: {session.Info.Transaction!r}, window title: {session.findById('wnd[0]').text!r})"
    except Exception:
        return "(couldn't read current screen info either)"


def wait_for_element(session, element_id, timeout=15, interval=0.5):
    """
    Polls findById until the element becomes available, instead of a fixed
    sleep. A real test showed a fixed sleep after a screen transition is
    just a guess that can be wrong: the failure happened on a *freshly
    logged-in* session (relaunched seconds earlier after the previous SAP
    process couldn't be attached to) — the Easy Access screen was already
    showing (transaction S000) but its favorites tree apparently wasn't
    fully populated yet, and a warm/already-open session likely settles
    faster than a fresh login does, so no single fixed delay covers both.
    SAP GUI Scripting has no built-in "wait until ready" call, so this
    substitutes a short retry loop.
    """
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            return session.findById(element_id)
        except Exception as e:
            last_error = e
            time.sleep(interval)
    raise RuntimeError(f"Timed out after {timeout}s waiting for {element_id!r}: {last_error}")


def open_inventory_for_part(session, part_no):
    """
    Navigates to the stock overview screen and queries one material number.
    Based on a real recorded session (double-click the favorites-tree node
    "0000000125", type the material number, Enter, then F8/Execute) — the
    "/n" at the top is NOT from that recording, it's added here so this
    works reliably on repeat lookups: the favorites tree only exists on the
    SAP Easy Access initial screen, and without returning there first, a
    second lookup while SAP is still sitting on the previous query's result
    screen would fail to find the tree node at all.

    Each step is wrapped separately so a failure's error message says
    exactly which step it happened on and what SAP was actually showing at
    the time — the raw COM "control could not be found by id" exception
    alone doesn't say which findById call raised it.
    """
    try:
        log("Returning to the SAP Easy Access screen...")
        session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        session.findById("wnd[0]").sendVKey(0)
    except Exception as e:
        raise RuntimeError(f"Failed returning to Easy Access (/n): {e} {current_screen_info(session)}") from e

    try:
        log("Navigating to the stock overview screen...")
        tree = wait_for_element(session, "wnd[0]/usr/cntlIMAGE_CONTAINER/shellcont/shell/shellcont[0]/shell")
        tree.doubleClickNode("0000000125")
    except Exception as e:
        raise RuntimeError(
            f"Failed navigating to the stock overview screen (double-click favorites node): {e} {current_screen_info(session)}"
        ) from e

    try:
        log(f"Entering material number {part_no}...")
        field = wait_for_element(session, "wnd[0]/usr/ctxtMS_MATNR-LOW")
        field.text = part_no
        session.findById("wnd[0]").sendVKey(0)
    except Exception as e:
        raise RuntimeError(f"Failed entering the material number: {e} {current_screen_info(session)}") from e

    try:
        log("Executing...")
        session.findById("wnd[0]/tbar[1]/btn[8]").press()
    except Exception as e:
        raise RuntimeError(f"Failed pressing Execute (F8): {e} {current_screen_info(session)}") from e

    log("Done.")


def bring_sap_to_front():
    """
    Best-effort only — the user is looking at the browser when they click
    the icon, so without this the query result can pop up behind/minimized
    and go unnoticed. SAP GUI Scripting itself has no window-activate call,
    so this shells out to the Win32 API instead. Never raises: the lookup
    itself already succeeded by the time this runs, a focus failure
    shouldn't be reported as a failed lookup.
    """
    try:
        target = None

        def callback(hwnd, _):
            nonlocal target
            if target is not None or not win32gui.IsWindowVisible(hwnd):
                return
            if win32gui.GetClassName(hwnd) == "SAP_FRONTEND_SESSION":
                target = hwnd

        win32gui.EnumWindows(callback, None)
        if target is None:
            log("(Couldn't find the SAP window to bring to front — skipping.)")
            return
        win32gui.ShowWindow(target, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(target)
    except Exception as e:
        log(f"(Couldn't bring SAP to front: {e} — skipping.)")


def main():
    parser = argparse.ArgumentParser(description="Open SAP's stock overview screen for one material number")
    parser.add_argument("part_no", help="The material/part number to look up")
    args = parser.parse_args()

    part_no = args.part_no.strip()
    if not part_no:
        log("[Error] A part number is required.")
        sys.exit(1)

    try:
        session = ensure_sap_connected()
        open_inventory_for_part(session, part_no)
        bring_sap_to_front()
    except Exception as e:
        log(f"[Error] {e}")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
