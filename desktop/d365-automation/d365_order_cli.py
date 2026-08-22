r"""
D365 Spare Part Order Automation (CLI version)
-----------------------------------------------
Drives Microsoft Edge through the Dynamics 365 Field Service flow a service
engineer normally does by hand to order a spare part: create a Work Order,
add a Bookable Resource, add a Quality Escape (header + item), fill in the
Product/Delivery Instruction fields — then STOPS, leaving the browser open
for human review, before the "Upload to SAP" step that actually generates a
Sales Order (that step isn't implemented yet — see the module docstring
section "NOT YET IMPLEMENTED" below).

Same general shape as fid_downloader_cli.py (a plain stdout-logging CLI
built for the lambom Electron desktop app to spawn), but with two real
differences instead of copying that file's pattern verbatim:

1. **Playwright, not SAP GUI Scripting (win32com).** D365 is a web app, so
   this drives real Microsoft Edge via Playwright instead of automating a
   Windows desktop application.
2. **Long-lived, not fire-and-forget.** fid_downloader_cli.py runs once and
   exits. This tool has to leave a real, visible browser window open for a
   human to look at between "fill in the form" and "click submit" — which
   could be minutes apart — so after filling everything in, it prints a
   sentinel line and then BLOCKS reading a second command from stdin
   instead of exiting. It also pauses MID-fill, the same way, whenever a
   Customer Asset search needs a human to disambiguate. See "STDIN
   PROTOCOL" below.

Usage:
    d365_order_cli.exe
    (reads one line of JSON from stdin — the form payload, see "INPUT
    SCHEMA" below — then starts working; takes no command-line arguments)

STDIN PROTOCOL:
    Line 1 (sent immediately by the caller): the JSON form payload.
    ... tool fills in D365, printing progress lines as it goes ...

    If the Customer Asset (FID) search matches more than one record (e.g.
    a machine's chambers and transfer modules all sharing the same FID),
    the tool prints `ASSET_OPTIONS:<json array of option label strings>`
    and blocks, waiting to read ONE line of JSON from stdin:
        {"index": N}   -> which option (0-based) to select; fill continues

    Once everything is filled in and nothing has been submitted to SAP yet,
    the tool prints `READY_FOR_CONFIRM:<work_order_id>` and then blocks
    again, waiting to read a line of JSON from stdin:
        {"action": "cancel"}   -> close the browser, exit 0, don't touch SAP
        {"action": "confirm"}  -> NOT YET IMPLEMENTED (see below); for now
                                   this just logs a message telling the user
                                   to click "Upload to SAP" themselves in the
                                   still-open browser window, then exits 0
                                   WITHOUT closing the browser (so the
                                   window the user needs to click in is
                                   still there after this process exits).

INPUT SCHEMA (one line of JSON on stdin):
    {
      "workOrder": {
        "installation": str,          # e.g. "Non Installation"
        "description": str,
        "reportedProblemDetail": str,
        "serviceType": str,           # e.g. "Warranty Service (ZSM3)"
        "existingWorkOrderId": str,   # optional: reuse this Work Order GUID
                           # for iterative testing instead of
                           # creating a new Work Order
        "submitOnly": bool,           # only valid with existingWorkOrderId:
                           # submit that existing Work Order and
                           # wait for its SAP Service Order
        "qualityEscapeOnly": bool,    # only valid with existingWorkOrderId:
                           # add a Quality Escape after confirming
                           # the Work Order already has an SO
        "partsAndQualityItemOnly": bool, # only valid with existingWorkOrderId:
                          # add, validate, include, and submit
                          # one Part against an existing QE
        "qualityEscapeToPartOnly": bool, # only valid with existingWorkOrderId:
                          # create QE, then complete one Part
                          # against an existing SAP Service Order
        "completeExistingPartOnly": bool, # only valid with existingWorkOrderId:
                            # validate and complete an existing
                            # Pending Part without creating one
        "fid": str,                   # FID to search Customer Asset by, e.g. "255711"
                                       # — see "STDIN PROTOCOL" above if this
                                       # matches more than one record
        "e10AssetState": str,         # e.g. "Unscheduled Down Time"
        "e10AssetSubstatus": str      # e.g. "Repair"
      },
      "qualityEscape": {
        "customerTemperature": str,   # e.g. "Unknown"
        "wafersScrapped": str,        # e.g. "No"
        "customerTrackingType": str,  # "" = leave unset, matching the
                                       # recording (it was explicitly
                                       # opened then Escaped, not chosen)
        "safetyIssue": str,           # e.g. "No"
        "commitDate": str,            # e.g. "Minor Commit Date Missed"
        "problemDescription": str
      },
      "qualityEscapeItem": {
        "causingProblem": str,
        "deviation": str,
        "specification": str,
        "additionalNotes": str        # optional, "" if none
      },
      "product": {
        "partNo": str,
        "priorityCode": str,          # e.g. "P0"
        "deliveryDate": str,          # e.g. "2026/07/09" — the CALLER is
                                       # responsible for never defaulting
                                       # this to a hardcoded date; this tool
                                       # just types whatever it's given
        "deliveryTime": str,          # e.g. "AM 11:00"
        "location": str,              # e.g. "tsmc F22 P2 dock"
        "contactName": str,
        "contactPhone": str
      }
    }

Behavior:
- Progress messages are printed to stdout one line at a time (for the
  caller to display live), matching fid_downloader_cli.py's convention.
- The Work Order's real Dataverse GUID is logged as soon as it's known
  (`WORK_ORDER_ID:<guid>`) — every later step is just a sub-navigation from
  that same record, so this is the single most useful breadcrumb if
  anything later fails; the user can jump straight back to it by hand.
- Any failure prints `[Error] ...`, and DELIBERATELY DOES NOT close the
  browser — the user finishes the remaining steps by hand in the same
  window, using the same already-authenticated session, rather than losing
  all context. This matches this repo's existing philosophy for a
  low-volume, human-supervised tool (see desktop/README.md's own framing
  of "Cancel" for the SAP downloader) rather than trying to build
  resumability/idempotency for a tool used a handful of times a day.

NOT YET IMPLEMENTED — the "Upload to SAP" step:
    This is the step that actually creates a real Sales Order, and it's
    deliberately left unautomated in this first version because we don't
    yet have a reliable selector for it. The one reference recording of the
    full manual flow failed to capture this click (it's inside the same
    nested Power Apps canvas iframe automated elsewhere in this file via
    click_canvas_app_widget(), which visibly errored once during that
    recording with "此應用程式無法運作" — "this app isn't working"). See the
    project's plan file for the concrete next step (a follow-up, isolated
    recording of just this one click) before wiring this up for real.

KNOWN UNVERIFIED ASSUMPTIONS — read before relying on this in production:
    Nothing in this file has been run against the real D365 environment —
    it's a direct, best-effort translation of one `playwright codegen`
    recording into parameterized code. In particular:
    - The exact accessible names/roles used in `select_option()` and
      `fill_textbox()` calls throughout are taken verbatim from the
      recording; D365 form control IDs and even visible labels can vary
      by user role/security profile, so these may need adjustment.
    - How the Quality Escape Item record actually gets created/reached
      (create_quality_escape_item() below) is the least certain part of
      this whole file — the recording jumps to it via a hardcoded record
      GUID that obviously can't be reused, and it's genuinely unclear
      whether it's auto-created as a child of the Quality Escape header or
      needs an explicit "add new" action. Read that function's docstring.
    - Whether launching Playwright against a brand-new, dedicated Edge
      profile (rather than the user's actual daily-use profile) still gets
      silent, seamless Entra ID SSO on this specific device has not been
      verified — see launch_browser() below.
    Every one of these needs to be confirmed/fixed by actually running
    this on the target Windows machine and watching what happens, then
    reporting back exactly what broke — the same iterative process this
    repo's SAP GUI Scripting tools were originally built with.

Packaging into an exe (run on Windows) — see build.bat, which does this:
    pip install -r requirements.txt
    playwright install msedge
    pyinstaller --onefile --console --name d365_order_cli d365_order_cli.py
   (requirements.txt points at the real PyPI index directly for this —
   this company's internal pip mirror doesn't proxy playwright, confirmed
   2026-08-20: installing it against the default/company index fails with
   "Could not find a version that satisfies the requirement playwright".)
   (Keep console output — don't add --noconsole, since Electron needs to
   read stdout, and this tool also reads a second command from stdin.)
"""

import json
import os
import re
import sys
import time
from datetime import datetime

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# When run as a child process by Electron, stdout/stderr aren't attached to a
# real console, so Windows falls back to a codepage like cp1252 that can't
# encode Chinese/CJK text by default, crashing with UnicodeEncodeError the
# moment such a log line is printed. Force utf-8, matching
# fid_downloader_cli.py's convention exactly.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")


BASE_URL = "https://lam-d365-servicespares-prd.crm.dynamics.com/main.aspx"
# Extracted from the reference recording — if the D365 environment changes
# (new app, new saved view), these need updating.
APP_ID = "f3923f03-8fa7-ec11-983f-0022480b1b3c"
WORK_ORDER_VIEW_ID = "57d4380b-c7ca-eb11-bacc-000d3a323e28"

# A dedicated Edge profile, separate from the user's everyday one, so this
# tool never fights over a locked profile directory with an already-open
# regular Edge window. Electron passes the real path via --user-data-dir
# (see main.js); this default only matters when running this file directly
# for local testing outside of the Electron app.
DEFAULT_USER_DATA_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "lambom-d365-order-profile"
)


def log(msg):
    print(msg, flush=True)


def read_stdin_json_line(prompt_context):
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError(f"stdin closed while waiting for {prompt_context} — caller disconnected?")
    return json.loads(line)


def record_url(etn, record_id):
    return f"{BASE_URL}?appid={APP_ID}&forceUCI=1&pagetype=entityrecord&etn={etn}&id={record_id}"


def list_url(etn, view_id):
    return f"{BASE_URL}?appid={APP_ID}&forceUCI=1&pagetype=entitylist&etn={etn}&viewid={view_id}&viewType=1039"


def extract_record_id(url):
    m = re.search(r"[?&]id=([0-9a-fA-F-]{36})", url)
    return m.group(1) if m else None


# ---------- Generic D365 form-field helpers ----------
#
# D365 model-driven forms render every field as a labeled combobox/textbox
# with a real accessible name, which is exactly what the reference
# recording's own locators (page.getByRole('combobox'/'textbox', {name}))
# already rely on — so these helpers just wrap that same pattern once
# instead of repeating it field-by-field, rather than inventing a different
# selection strategy.

def fill_textbox(page, label, value, exact=False, max_attempts=4):
    """CONFIRMED IN REAL TESTING (2026-08-20): D365's form re-renders parts
    of itself after a field changes (likely an onChange business-rule
    pipeline), which can detach a NEIGHBORING field's control from the DOM
    right as Playwright tries to click into it — a single un-retried
    attempt hit "element was detached from the DOM, retrying" for a full
    30s and gave up. Every attempt re-runs get_by_role() from scratch
    (never reuses a stale Locator reference) so it always grabs whatever
    the CURRENT DOM node is, and skips the separate .click() the recording
    did by hand — .fill() alone already waits for the element to be
    actionable and focuses it, so the extra click was just one more
    actionability-wait cycle that could itself hit the same detach race."""
    if value is None or value == "":
        return
    last_error = None
    for attempt in range(1, max_attempts + 1):
        try:
            page.get_by_role("textbox", name=label, exact=exact).fill(value, timeout=8000)
            return
        except Exception as e:
            last_error = e
            log(f"  fill '{label}': attempt {attempt}/{max_attempts} failed ({e.__class__.__name__}), retrying...")
            page.wait_for_timeout(1000)
    raise RuntimeError(f"Failed to fill '{label}' after {max_attempts} attempts: {last_error}")


def select_option(page, label, value, exact=True, max_attempts=4):
    """Opens a combobox by its accessible label and clicks the option with
    the given exact text. Leaves the field untouched if value is empty —
    this is how qualityEscape.customerTrackingType being "" reproduces the
    recording's own behavior of explicitly not choosing a value there.

    Same retry-with-fresh-locator treatment as fill_textbox() above, and
    for the same confirmed-real reason — a neighboring combobox can get
    detached/re-rendered mid-click just as easily as a textbox can."""
    if value is None or value == "":
        return
    last_error = None
    for attempt in range(1, max_attempts + 1):
        try:
            page.get_by_role("combobox", name=label).click(timeout=8000)
            page.get_by_role("option", name=value, exact=exact).click(timeout=8000)
            return
        except Exception as e:
            last_error = e
            log(f"  select '{label}'='{value}': attempt {attempt}/{max_attempts} failed ({e.__class__.__name__}), retrying...")
            page.wait_for_timeout(1000)
    raise RuntimeError(f"Failed to select '{value}' in '{label}' after {max_attempts} attempts: {last_error}")


def click_canvas_app_widget(page, button_name="登入", max_attempts=3):
    """Shared helper for the nested Power Apps canvas widget that shows up
    repeatedly in the reference recording
    (iframe[name="lam_/html/canvas_dialog.html"] -> #embeddedCanvasApp ->
    another content frame inside that). The recording shows this widget
    erroring out once with "此應用程式無法運作" (this app isn't working) — so
    unlike the rest of this file, this helper treats that specific failure
    as expected/transient and retries with a page reload, rather than
    surfacing it as a hard error on the first occurrence.

    Returns True if `button_name` was found and clicked, False if the
    widget never became usable after max_attempts (caller decides whether
    that's fatal for the step it's being used in)."""
    for attempt in range(1, max_attempts + 1):
        try:
            canvas_frame = (
                page.locator('iframe[name="lam_/html/canvas_dialog.html"]')
                .content_frame.locator("#embeddedCanvasApp")
                .content_frame
            )
        except Exception as e:
            log(f"  canvas widget: outer iframe not found yet (attempt {attempt}/{max_attempts}): {e}")
            page.wait_for_timeout(1500)
            continue

        try:
            error_locator = canvas_frame.get_by_text("此應用程式無法運作", exact=False)
            if error_locator.is_visible(timeout=2000):
                log(f"  canvas widget: hit the known transient error, reloading and retrying (attempt {attempt}/{max_attempts})...")
                page.reload()
                page.wait_for_timeout(2000)
                continue
        except Exception:
            pass  # error text not present — good, keep going

        try:
            canvas_frame.get_by_role("button", name=button_name).click(timeout=5000)
            return True
        except Exception as e:
            log(f"  canvas widget: '{button_name}' button not ready yet (attempt {attempt}/{max_attempts}): {e}")
            page.wait_for_timeout(1500)

    log(f"  canvas widget: gave up after {max_attempts} attempts.")
    return False


# ---------- Step 1: Work Order ----------

def create_work_order(page, wo):
    log("Navigating to the Work Orders list...")
    page.goto(list_url("msdyn_workorder", WORK_ORDER_VIEW_ID))

    log("Switching to 'My Active Work Orders - FSM' and creating a new one...")
    page.get_by_role("button", name="Active Work Orders - FSM").click()
    page.get_by_role("menuitemradio", name="My Active Work Orders - FSM").click()
    page.get_by_role("menuitem", name="New Create a new Work Order").click()

    log("Filling Work Order fields...")
    select_option(page, "Installation?", wo.get("installation"))
    fill_textbox(page, "Description", wo.get("description"))
    fill_textbox(page, "Reported Problem Detail", wo.get("reportedProblemDetail"))
    select_option(page, "Service Type", wo.get("serviceType"))

    fid = wo.get("fid")
    if fid:
        log(f"Searching Customer Asset for FID '{fid}'...")
        asset_box = page.get_by_role("combobox", name="Customer Asset, Lookup")
        asset_box.click()
        asset_box.fill(fid)

        # Per the user (2026-08-20): this field is normally searched by
        # FID, not a bare machine name — searching by FID returns one
        # option per chamber/module for a multi-chamber tool (e.g. process
        # chambers AND transfer modules can all show up as separate
        # matches for the same FID), a small precise set; searching by
        # machine name alone returns many more, unrelated options.
        #
        # CONFIRMED IN REAL TESTING (2026-08-20): role=option found ZERO
        # matches, even after waiting — the reference recording's own
        # selector for this exact widget was getByLabel('CCOXN1,
        # 255711-VXT-6550-'), not a role=option lookup, which means each
        # suggestion row carries a descriptive aria-label but may not
        # expose an ARIA "option" role at all. Match on the aria-label
        # attribute directly (a plain CSS attribute selector, independent
        # of ARIA role) instead of assuming a role.
        options = page.locator(f'[aria-label*="{fid}"]')
        try:
            options.first.wait_for(state="visible", timeout=15000)
        except PlaywrightTimeoutError:
            raise RuntimeError(
                f"No Customer Asset suggestion appeared for FID '{fid}' — check whether this FID "
                "exists in D365, or whether the lookup is slower than expected."
            )

        count = options.count()
        option_labels = [options.nth(i).get_attribute("aria-label") for i in range(count)]
        log(f"  found {count} matching option(s) for FID '{fid}': {option_labels}")

        if count == 1:
            chosen = options.first
        else:
            # More than one match (chambers, transfer modules, etc. all
            # share the same FID) — per the user (2026-08-20), don't guess
            # which one via a pre-typed hint; show the real options and let
            # them pick, the same way they'd see them in D365 itself.
            # ASSET_OPTIONS is a new sentinel (parsed by
            # desktop/electron/main.js) carrying the option labels as a
            # JSON array; the caller is expected to write back one line of
            # JSON, {"index": N}, choosing which one.
            log(f"ASSET_OPTIONS:{json.dumps(option_labels)}")
            selection = read_stdin_json_line("asset selection")
            index = selection.get("index")
            if not isinstance(index, int) or not (0 <= index < count):
                raise RuntimeError(
                    f"Invalid asset selection index {index!r} — expected an integer from 0 to {count - 1}."
                )
            chosen = options.nth(index)
            log(f"  selected option {index}: {option_labels[index]!r}")

        chosen.click(timeout=4000)

        # CONFIRMED IN REAL TESTING (2026-08-20): after a successful
        # selection, this field displays a completely different internal
        # system ID (e.g. "10185217"), NOT anything containing the FID —
        # an earlier version of this check assumed the FID would still
        # appear and raised a false-positive error on every run, even
        # though the screenshot from that same run showed the selection
        # had genuinely succeeded. Don't try to verify the exact displayed
        # value at all — log whatever's readable as a best-effort
        # diagnostic only, and let the next real dependency (SEMI E10
        # Asset State only appearing once a valid asset is selected) be
        # the actual signal of success, same as it already reliably is.
        page.wait_for_timeout(500)
        try:
            current_value = asset_box.evaluate("el => el.value ?? el.textContent ?? null")
        except Exception:
            current_value = None
        log(f"  Customer Asset field now shows: {current_value!r}")

    select_option(page, "SEMI E10 Asset State", wo.get("e10AssetState"))
    select_option(page, "SEMI E10 Asset Substatus", wo.get("e10AssetSubstatus"))

    log("Saving Work Order...")
    page.get_by_role("menuitem", name="Save (CTRL+S) Save this Work").click()
    # CONFIRMED IN REAL TESTING (2026-08-20): a fixed 2.5s wait was too
    # short — the URL still had no id= param yet (D365 was still saving,
    # likely running server-side validation/plugins), so reading the URL
    # immediately failed. Wait for the URL to actually gain an id= instead
    # of guessing a sleep duration.
    try:
        page.wait_for_url(re.compile(r"[?&]id=[0-9a-fA-F-]{36}"), timeout=30000)
    except PlaywrightTimeoutError:
        pass  # fall through to the explicit check below for a clearer error message

    wo_id = extract_record_id(page.url)
    if not wo_id:
        raise RuntimeError(f"Couldn't read the Work Order ID from the URL after saving (url was: {page.url}).")
    log(f"WORK_ORDER_ID:{wo_id}")
    return wo_id


# ---------- Step 2: Bookable Resource ----------

def add_bookable_resource(page, wo_id):
    log("Reloading the Work Order and adding a Bookable Resource...")
    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")

    # The Summary-page Bookings grid is virtualized and may not exist in
    # the DOM on an existing Work Order. The Tasks and Time tab exposes the
    # same action through stable accessible names instead.
    page.get_by_role("tab", name="Tasks and Time").click()
    page.get_by_role("menuitem", name="More commands for Bookable").click()
    page.get_by_role("menuitem", name="Add New Bookable Resource").click()
    booking_dialog_title = page.get_by_text("New Bookable Resource Booking", exact=True)
    booking_dialog_title.wait_for(state="visible", timeout=15000)
    page.get_by_role("menuitem", name="Save & Close Save and close").click()

    # Save & Close starts an asynchronous D365 save. Do not navigate the
    # underlying Work Order until the quick-create dialog has actually
    # closed; navigating immediately leaves the booking unsaved.
    try:
        booking_dialog_title.wait_for(state="hidden", timeout=30000)
    except PlaywrightTimeoutError as e:
        raise RuntimeError(
            "The New Bookable Resource Booking dialog did not close after Save & Close; "
            "the booking was not saved, so the automation stopped."
        ) from e

    # Depending on the D365 session, Save & Close either returns to the
    # Work Order with a pending parent save or directly to the Work Orders
    # list. The extra parent save is optional, not a precondition for
    # continuing.
    try:
        page.get_by_role("button", name="Save and continue").click(timeout=5000)
        log("  Saved the parent Work Order after creating the booking.")
    except PlaywrightTimeoutError:
        log("  Booking quick-create returned directly to the list; no parent save was needed.")

    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")
    page.get_by_role("tab", name="Summary").click()
    log("  Bookable Resource Booking created through Tasks and Time.")


# ---------- Step 3: Quality Escape (header) ----------

def open_quality_related(page):
    page.locator('[id^="icon_more_tab_"]:visible').click(timeout=15000)
    page.locator("#relatedEntityContainer").get_by_text("Quality", exact=True).click(timeout=15000)


def add_quality_escape(page, wo_id, qe):
    log("Opening the Quality related section and adding a Quality Escape...")
    open_quality_related(page)
    page.get_by_role("menuitem", name="Add New Quality Escape Add a").click()

    log("Filling Quality Escape fields...")
    select_option(page, "Customer Temperature", qe.get("customerTemperature"))
    select_option(page, "Are Wafers Scrapped?", qe.get("wafersScrapped"), exact=True)
    select_option(page, "Customer Tracking Type", qe.get("customerTrackingType"))
    select_option(page, "Safety Issue?", qe.get("safetyIssue"))
    select_option(page, "Instl/Upgrd Commit Date", qe.get("commitDate"))
    fill_textbox(page, "Problem Description", qe.get("problemDescription"))
    page.get_by_role("menuitem", name="Save & Close Save and close").click()
    try:
        page.wait_for_function(
            """() => /[?&]etn=lam_quality_escape&[\\s\\S]*[?&]id=[0-9a-fA-F-]{36}/.test(window.location.href)""",
            timeout=30000,
        )
    except PlaywrightTimeoutError as e:
        raise RuntimeError("Quality Escape did not save to a record URL after Save & Close; stopped before continuing.") from e
    log("  Quality Escape saved.")


# ---------- Step 4: Quality Escape Item ----------

def fill_quality_escape_item(page, qei, quality_escape_description):
    """Runs after Work Order Part validation, which exposes the Quality
    Escape Item requiring interaction in the Parts workflow."""
    log("Opening the Quality Escape Item requiring interaction...")
    quality_escape_link = page.get_by_role("link", name=quality_escape_description, exact=True).first
    for _ in range(8):
        if quality_escape_link.count() and quality_escape_link.is_visible():
            quality_escape_link.click(timeout=15000)
            break
        page.mouse.wheel(0, 800)
        page.wait_for_timeout(750)
    else:
        raise RuntimeError(
            f"Quality Escape Item link {quality_escape_description!r} did not appear after validation."
        )

    select_option(page, "Replaced/Removed Type", qei.get("replacedRemovedType"))
    select_option(page, "Module Type", qei.get("moduleType"))
    select_option(page, "Damage Code Group", qei.get("damageCodeGroup"))
    select_option(page, "Damage Code", qei.get("damageCode"))
    select_option(page, "Symptom Detail", qei.get("symptomDetail"))

    problem_description = (
        f"What (Object) is causing the problem? {qei.get('causingProblem', '')}\n"
        f"What is the deviation? {qei.get('deviation', '')}\n"
        f"What is it supposed to be (Specification)? {qei.get('specification', '')}\n"
        "If known\n"
        "     How much is the Deviation? (for those items working but not meeting a spec)\n"
        "     What troubleshooting was done? (A-B-A testing, power checks, calibrations, etc.)\n"
        "     For this FID, when in the process of running the recipe is the problem seen and at what frequency?"
    )
    additional_notes = qei.get("additionalNotes")
    if additional_notes:
        problem_description += f"\n\n{additional_notes}"

    log("Filling Quality Escape Item Problem Description...")
    fill_textbox(page, "Problem Description", problem_description)
    page.get_by_role("menuitem", name="Save & Close Save and close").click()
    log("  Quality Escape Item saved and closed.")


def select_pending_part(page, part_no):
    pending_parts = page.get_by_role("region", name="Work Order Parts - Pending")
    part_identifier = part_no.split("-", 1)[-1]
    part_row = pending_parts.get_by_role("row").filter(has_text=part_identifier).first
    part_row.get_by_role("gridcell", name="Select row").click(timeout=15000)
    return pending_parts


def click_ready_validate(page):
    validate_command = page.get_by_role("menuitem", name="Validate", exact=True)
    validate_command.wait_for(state="visible", timeout=30000)
    for attempt in range(1, 13):
        if validate_command.is_enabled():
            log(f"  Validate is enabled after {attempt * 5 - 5} seconds.")
            break
        page.wait_for_timeout(5000)
    else:
        raise RuntimeError("Validate did not become enabled within 60 seconds after selecting the Part.")

    # D365's validation handler finishes binding after the toolbar first
    # reports enabled, the same behavior observed for Submit-to-SAP.
    log("  Validate is enabled; waiting 15 seconds for the D365 command to settle...")
    page.wait_for_timeout(15000)
    validate_command = page.get_by_role("menuitem", name="Validate", exact=True)
    if not validate_command.is_enabled():
        raise RuntimeError("Validate became disabled while D365 was synchronizing the selected Part.")
    log(f"  Validate locator count: {validate_command.count()}")
    log(f"  Validate element: {validate_command.evaluate('(element) => element.outerHTML')}")
    validate_command.hover(timeout=15000)
    validate_command.click(timeout=15000)


def wait_for_part_validated(page, part_no):
    part_identifier = part_no.split("-", 1)[-1]
    valid_indicator = page.get_by_role("img", name="Valid")
    for attempt in range(1, 13):
        pending_parts = page.get_by_role("region", name="Work Order Parts - Pending")
        part_row = pending_parts.get_by_role("row").filter(has_text=part_identifier).first
        if valid_indicator.count() and valid_indicator.first.is_visible():
            log("  Work Order Part validation completed (Valid indicator is green).")
            return
        page.wait_for_timeout(5000)
        log(f"  Validation still pending after {attempt * 5} seconds.")
    raise RuntimeError(f"Part '{part_no}' did not reach Validation Status 'Validated' within 60 seconds.")


def include_and_submit_part(page, wo_id, part_no):
    log("Including the validated Work Order Part...")
    select_pending_part(page, part_no)
    page.get_by_role("menuitem", name="Include", exact=True).click()
    page.get_by_role("button", name="OK", exact=True).click()

    page.wait_for_timeout(1000)
    select_pending_part(page, part_no)
    page.get_by_role("menuitem", name="Submit", exact=True).click()
    page.wait_for_timeout(20000)

    for attempt in range(1, 13):
        pending_parts = page.get_by_role("region", name="Work Order Parts - Pending")
        pending_parts.get_by_label("Refresh").click(timeout=15000)
        page.wait_for_timeout(10000)
        ordered_parts = page.get_by_role("region", name="Work Order Parts - Ordered")
        if ordered_parts.get_by_text(part_no, exact=False).count():
            log(f"  Work Order Part '{part_no}' is now ordered.")
            return
        log(f"  Part not ordered after refresh {attempt}/12; waiting...")

    raise RuntimeError(f"Part '{part_no}' did not move to Work Order Parts - Ordered within 120 seconds.")


# ---------- Step 5: Work Order Part ----------

def format_delivery_datetime(date_value, time_value):
    if not date_value:
        return ""
    formatted_date = date_value.replace("-", "/")
    if not time_value:
        return formatted_date
    hour_text, minute_text = time_value.split(":", 1)
    hour = int(hour_text)
    period = "AM" if hour < 12 else "PM"
    display_hour = hour % 12 or 12
    return f"{formatted_date} {period} {display_hour:02d}:{minute_text}"


def add_and_validate_work_order_part(page, wo_id, product):
    log("Opening Parts and creating a Work Order Product...")
    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")
    page.get_by_role("tab", name="Parts").click()

    pending_parts = page.get_by_role("region", name="Work Order Parts - Pending")
    pending_parts.get_by_label("New Work Order Product Create").click()

    part_no = product.get("partNo")
    if part_no:
        log(f"Selecting Product '{part_no}'...")
        product_box = page.get_by_role("combobox", name="Product, Lookup")
        product_box.click()
        product_box.fill(part_no)
        page.get_by_text(part_no.lstrip("0"), exact=False).first.click(timeout=15000)

    date_needed = product.get("deliveryDate")
    if date_needed:
        parsed_date = datetime.strptime(date_needed, "%Y-%m-%d")
        date_box = page.get_by_role("combobox", name="Date Needed")
        date_box.click()
        day_button = re.compile(rf"^{parsed_date.day}, {parsed_date.strftime('%B')},")
        page.get_by_role("button", name=day_button).click(timeout=15000)
        page.wait_for_timeout(500)
        expected_date = f"{parsed_date.month}/{parsed_date.day}/{parsed_date.year}"
        if not date_box.input_value():
            date_box.fill(expected_date)
            date_box.press("Tab")
        date_state = date_box.evaluate("(element) => ({ value: element.value, html: element.outerHTML })")
        log(f"  Date Needed control value: {date_state['value']!r}")
        log(f"  Date Needed control: {date_state['html']}")
        page.screenshot(path=os.path.join(os.environ.get("D365_ORDER_USER_DATA_DIR", DEFAULT_USER_DATA_DIR), "after-date-needed.png"))
        if expected_date not in date_state["value"]:
            raise RuntimeError(f"Date Needed was not accepted by D365 (expected {expected_date!r}).")

    delivery_text = ",".join(
        part
        for part in [
            product.get("priorityCode", ""),
            format_delivery_datetime(product.get("deliveryDate", ""), product.get("deliveryTime", "")),
            product.get("location", ""),
            product.get("contactName", ""),
            product.get("contactPhone", ""),
        ]
    )
    # The Work Order Product form virtualizes lower fields until they enter
    # the modal viewport, so scroll before resolving the Delivery controls.
    page.mouse.wheel(0, 900)
    page.wait_for_timeout(500)
    fill_textbox(page, "Delivery Instruction (", delivery_text)
    fill_textbox(page, "Delivery Instruction Detail (", delivery_text)
    page.get_by_role("menuitem", name="Save & Close Save and close").click()

    page.get_by_text("New Work Order Product", exact=True).first.wait_for(state="hidden", timeout=30000)
    pending_parts = page.get_by_role("region", name="Work Order Parts - Pending")
    part_identifier = part_no.split("-", 1)[-1]
    part_row = pending_parts.get_by_role("row").filter(has_text=part_identifier).first
    try:
        part_row.wait_for(state="visible", timeout=30000)
    except PlaywrightTimeoutError as e:
        raise RuntimeError(
            f"Work Order Part '{part_no}' did not appear in Pending after Save & Close; it was not saved."
        ) from e
    part_row.get_by_role("gridcell", name="Select row").click()
    click_ready_validate(page)
    try:
        page.get_by_role("button", name="Close", exact=True).click(timeout=5000)
    except PlaywrightTimeoutError:
        log("  Validate completed without a results dialog.")
    wait_for_part_validated(page, part_no)
    log("  Work Order Part saved and validated.")


def validate_existing_work_order_part(page, wo_id, part_no):
    log(f"Validating existing Pending Part '{part_no}'...")
    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")
    page.get_by_role("tab", name="Parts").click()
    select_pending_part(page, part_no)
    click_ready_validate(page)
    try:
        page.get_by_role("button", name="Close", exact=True).click(timeout=5000)
    except PlaywrightTimeoutError:
        log("  Validate completed without a results dialog.")
    wait_for_part_validated(page, part_no)
    log("  Existing Work Order Part validated.")

# ---------- Submit / SAP Service Order ----------

def submit_existing_work_order(page, wo_id, user_data_dir):
    """Submits an already-prepared Work Order and waits for D365 to replace
    the SAP Service Order placeholder (`---`) in the record header."""
    log("Opening the existing Work Order for SAP submission...")
    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")

    sap_order_header = page.locator("#headerControlsList_0")
    sap_order_header.wait_for(state="visible", timeout=30000)
    initial_value = (sap_order_header.inner_text() or "").strip().splitlines()[0].strip()
    if initial_value and initial_value != "---":
        raise RuntimeError(
            f"Work Order already has a SAP Service Order ({initial_value!r}); refusing to submit it again."
        )

    log("Waiting for Submit to become available...")
    submit_command = page.get_by_role("menuitem", name="Submit", exact=True)
    submit_command.wait_for(state="visible", timeout=30000)
    submit_command.scroll_into_view_if_needed(timeout=30000)
    for attempt in range(1, 13):
        if submit_command.is_enabled():
            log(f"  Submit is enabled after {attempt * 5 - 5} seconds.")
            break
        page.wait_for_timeout(5000)
    else:
        raise RuntimeError(
            "Submit did not become enabled within 60 seconds. Check whether the Work Order "
            "still has required fields or background processing in progress."
        )

    # D365 exposes the command as enabled before its custom Submit-to-SAP
    # handler is consistently ready. Let the form settle, then reacquire
    # the live toolbar button before issuing the single real submission.
    log("  Submit is enabled; waiting 15 seconds for the D365 command to settle...")
    page.wait_for_timeout(15000)
    submit_command = page.get_by_role("menuitem", name="Submit", exact=True)
    if not submit_command.is_enabled():
        raise RuntimeError("Submit became disabled while D365 was initializing; stopped without submitting.")

    log("Submitting the Work Order to SAP...")
    log(f"  Submit locator count: {submit_command.count()}")
    log(f"  Submit element: {submit_command.evaluate('(element) => element.outerHTML')}")
    submit_command.hover(timeout=15000)
    submit_command.click(timeout=15000)
    page.wait_for_timeout(1000)
    after_click_path = os.path.join(user_data_dir, "after-submit-click.png")
    page.screenshot(path=after_click_path)
    dialogs = page.get_by_role("dialog").all_inner_texts()
    log(f"  after Submit: {len(dialogs)} dialog(s) visible; screenshot saved to {after_click_path}")

    # The Submit-to-SAP progress surface is an overlay, not an ARIA dialog.
    # Wait for its whole lifecycle before refreshing the record underneath.
    # D365 renders the same text once as the visible progress message and
    # once as a screen-reader alert. Use the visible message's stable id to
    # avoid Playwright strict-mode ambiguity.
    submission_overlay = page.locator("#appProgressIndicatorMessage")
    try:
        submission_overlay.wait_for(state="visible", timeout=30000)
        log("  SAP submission overlay appeared; waiting for it to finish...")
        submission_overlay.wait_for(state="hidden", timeout=120000)
    except PlaywrightTimeoutError as e:
        raise RuntimeError(
            "D365 did not complete the 'Preparing work order for submission' overlay in time; "
            "check the Work Order manually before retrying."
        ) from e

    def read_visible_sap_order():
        # Refresh can recreate the form header with a different numeric DOM
        # id, but the visible SAP Service Order label remains stable. Find
        # the line directly before that label in its nearest header group.
        label = page.get_by_text("SAP Service Order", exact=True).first
        try:
            label.wait_for(state="visible", timeout=30000)
            return label.evaluate(
                """(element) => {
                    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
                        const lines = (node.innerText || '').split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
                        const labelIndex = lines.indexOf('SAP Service Order');
                        if (labelIndex > 0) return lines[labelIndex - 1];
                    }
                    return '';
                }"""
            ).strip()
        except PlaywrightTimeoutError:
            return ""

    # D365 does not automatically refresh this form after the SAP upload.
    # The Edge recording confirmed the Service Order becomes visible only
    # after More commands for Work Order -> Refresh. Poll that same action
    # for up to two minutes instead of watching the stale header DOM.
    for attempt in range(1, 13):
        page.wait_for_timeout(10000)
        page.get_by_role("menuitem", name="More commands for Work Order", exact=True).click(timeout=15000)
        page.get_by_role("menuitem", name="Refresh", exact=True).click(timeout=15000)
        page.wait_for_load_state("domcontentloaded")

        sap_order = read_visible_sap_order()
        if sap_order and sap_order != "---":
            log(f"SAP_SERVICE_ORDER:{sap_order}")
            return sap_order
        log(f"  SAP Service Order not visible after refresh {attempt}/12; waiting...")

    raise RuntimeError(
        "Submit did not produce a SAP Service Order within 120 seconds after refreshing the Work Order; "
        "check the D365 upload status manually before retrying."
    )


def get_existing_sap_service_order(page, wo_id):
    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")
    header = page.locator("#headerControlsList_0")
    header.wait_for(state="visible", timeout=30000)
    return (header.inner_text() or "").strip().splitlines()[0].strip()


# ---------- Browser launch ----------

def launch_browser(playwright, user_data_dir):
    """Launches the real, installed system Edge (not Playwright's bundled
    Chromium) via a dedicated, separate profile directory, so this never
    fights over a locked profile with the user's regular already-open Edge
    windows.

    UNVERIFIED: whether a brand-new profile on this device still gets
    silent Entra ID SSO the same way the user's daily-use profile does.
    If D365 redirects to a Microsoft login page instead of loading
    straight in, that assumption didn't hold — see the module docstring.
    """
    os.makedirs(user_data_dir, exist_ok=True)
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="msedge",
        headless=False,
        viewport=None,
    )
    page = context.pages[0] if context.pages else context.new_page()
    return context, page


def check_for_login_wall(page):
    """If the "silent SSO on a fresh profile" assumption doesn't hold, a
    Microsoft login page will load instead of the D365 app. Detect that
    explicitly and fail with a clear message, rather than let every
    subsequent get_by_role() call fail with a confusing timeout."""
    if "login.microsoftonline.com" in page.url or "login.live.com" in page.url:
        raise RuntimeError(
            "Hit a Microsoft login page instead of D365 loading directly — "
            "the 'fresh profile still gets silent SSO' assumption may not "
            "hold on this device. See the module docstring's 'KNOWN "
            "UNVERIFIED ASSUMPTIONS' section."
        )


# ---------- CLI entry point ----------

def run(payload, user_data_dir):
    with sync_playwright() as p:
        log("Launching Edge (dedicated automation profile)...")
        context, page = launch_browser(p, user_data_dir)
        try:
            log(f"Opening the Work Orders list ({list_url('msdyn_workorder', WORK_ORDER_VIEW_ID)})...")
            page.goto(list_url("msdyn_workorder", WORK_ORDER_VIEW_ID))
            page.wait_for_load_state("domcontentloaded")
            check_for_login_wall(page)

            work_order = payload.get("workOrder", {})
            existing_wo_id = work_order.get("existingWorkOrderId")
            if existing_wo_id:
                if not re.fullmatch(r"[0-9a-fA-F-]{36}", existing_wo_id):
                    raise RuntimeError("workOrder.existingWorkOrderId must be a valid Work Order GUID.")
                wo_id = existing_wo_id
                log(f"Reusing existing Work Order for this test: {wo_id}")
            else:
                wo_id = create_work_order(page, work_order)

            if work_order.get("submitOnly"):
                if not existing_wo_id:
                    raise RuntimeError("workOrder.submitOnly requires workOrder.existingWorkOrderId.")
                submit_existing_work_order(page, wo_id, user_data_dir)
                log("Submit-only test completed.")
                return

            if work_order.get("qualityEscapeOnly"):
                if not existing_wo_id:
                    raise RuntimeError("workOrder.qualityEscapeOnly requires workOrder.existingWorkOrderId.")
                sap_order = get_existing_sap_service_order(page, wo_id)
                if not sap_order or sap_order == "---":
                    raise RuntimeError("Work Order has no SAP Service Order yet; refusing to create a Quality Escape.")
                log(f"Existing SAP Service Order confirmed: {sap_order}")
                add_quality_escape(page, wo_id, payload.get("qualityEscape", {}))
                log("Quality Escape-only test completed.")
                return

            if work_order.get("partsAndQualityItemOnly"):
                if not existing_wo_id:
                    raise RuntimeError("workOrder.partsAndQualityItemOnly requires workOrder.existingWorkOrderId.")
                sap_order = get_existing_sap_service_order(page, wo_id)
                if not sap_order or sap_order == "---":
                    raise RuntimeError("Work Order has no SAP Service Order yet; refusing to create a Work Order Part.")
                log(f"Existing SAP Service Order confirmed: {sap_order}")
                product = payload.get("product", {})
                add_and_validate_work_order_part(page, wo_id, product)
                fill_quality_escape_item(page, payload.get("qualityEscapeItem", {}), payload.get("qualityEscape", {}).get("problemDescription", ""))
                include_and_submit_part(page, wo_id, product.get("partNo", ""))
                log("Parts and Quality Escape Item-only test completed.")
                return

            if work_order.get("qualityEscapeToPartOnly"):
                if not existing_wo_id:
                    raise RuntimeError("workOrder.qualityEscapeToPartOnly requires workOrder.existingWorkOrderId.")
                sap_order = get_existing_sap_service_order(page, wo_id)
                if not sap_order or sap_order == "---":
                    raise RuntimeError("Work Order has no SAP Service Order yet; refusing to create a Quality Escape.")
                log(f"Existing SAP Service Order confirmed: {sap_order}")
                quality_escape = payload.get("qualityEscape", {})
                product = payload.get("product", {})
                add_quality_escape(page, wo_id, quality_escape)
                add_and_validate_work_order_part(page, wo_id, product)
                fill_quality_escape_item(page, payload.get("qualityEscapeItem", {}), quality_escape.get("problemDescription", ""))
                include_and_submit_part(page, wo_id, product.get("partNo", ""))
                log("Quality Escape-to-Part test completed.")
                return

            if work_order.get("completeExistingPartOnly"):
                if not existing_wo_id:
                    raise RuntimeError("workOrder.completeExistingPartOnly requires workOrder.existingWorkOrderId.")
                sap_order = get_existing_sap_service_order(page, wo_id)
                if not sap_order or sap_order == "---":
                    raise RuntimeError("Work Order has no SAP Service Order yet; refusing to complete a Part.")
                product = payload.get("product", {})
                validate_existing_work_order_part(page, wo_id, product.get("partNo", ""))
                fill_quality_escape_item(page, payload.get("qualityEscapeItem", {}), payload.get("qualityEscape", {}).get("problemDescription", ""))
                include_and_submit_part(page, wo_id, product.get("partNo", ""))
                log("Existing Part completion test completed.")
                return

            add_bookable_resource(page, wo_id)
            submit_existing_work_order(page, wo_id, user_data_dir)
            add_quality_escape(page, wo_id, payload.get("qualityEscape", {}))
            product = payload.get("product", {})
            add_and_validate_work_order_part(page, wo_id, product)
            fill_quality_escape_item(page, payload.get("qualityEscapeItem", {}), payload.get("qualityEscape", {}).get("problemDescription", ""))
            include_and_submit_part(page, wo_id, product.get("partNo", ""))

            log(f"READY_FOR_CONFIRM:{wo_id}")

            command = read_stdin_json_line("confirm/cancel command")
            action = command.get("action")

            if action == "cancel":
                log("Received cancel — closing the browser without touching Upload to SAP.")
                context.close()
                return

            if action == "confirm":
                # NOT YET IMPLEMENTED — see module docstring. Deliberately
                # does NOT close the browser: the user still needs this
                # exact window to click Upload to SAP themselves.
                log(
                    "Automated submission isn't implemented yet — please click "
                    "'Upload to SAP' yourself in the still-open Edge window. "
                    "This window stays open until you close the lambom app."
                )
                # Deliberately hang here instead of returning: exiting this
                # function would fall out of the `with sync_playwright()`
                # block and risk tearing down the very persistent-context
                # browser the user still needs open. Electron's quit-time
                # cleanup (taskkill /T /F on this whole process tree) is
                # what actually closes this down — not a normal return.
                while True:
                    time.sleep(3600)

            log(f"[Error] Unrecognized command action: {action!r}")
            sys.exit(1)

        except Exception as e:
            log(f"[Error] {e}")
            try:
                screenshot_path = os.path.join(user_data_dir, "last-error.png")
                page.screenshot(path=screenshot_path)
                log(f"  screenshot saved to {screenshot_path}")
                log(f"  current URL: {page.url}")
            except Exception:
                pass
            # Deliberately not closing the browser/context on error — see
            # the module docstring's error-handling philosophy.
            sys.exit(1)


def main():
    log("Waiting for form data on stdin...")
    try:
        payload = read_stdin_json_line("the form payload")
    except Exception as e:
        log(f"[Error] Failed to read/parse the form payload from stdin: {e}")
        sys.exit(1)

    user_data_dir = os.environ.get("D365_ORDER_USER_DATA_DIR", DEFAULT_USER_DATA_DIR)
    run(payload, user_data_dir)


if __name__ == "__main__":
    main()
