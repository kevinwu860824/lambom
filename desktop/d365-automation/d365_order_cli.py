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
   instead of exiting. See the "STDIN PROTOCOL" section below.

Usage:
    d365_order_cli.exe
    (reads one line of JSON from stdin — the form payload, see "INPUT
    SCHEMA" below — then starts working; takes no command-line arguments)

STDIN PROTOCOL:
    Line 1 (sent immediately by the caller): the JSON form payload.
    ... tool fills in D365, printing progress lines as it goes ...
    Once everything is filled in and nothing has been submitted to SAP yet,
    the tool prints `READY_FOR_CONFIRM:<work_order_id>` and then blocks,
    waiting to read a SECOND line of JSON from stdin:
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
        "customerAsset": str,         # search text, e.g. "255711"
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

    customer_asset = wo.get("customerAsset")
    if customer_asset:
        log(f"Searching Customer Asset for '{customer_asset}'...")
        asset_box = page.get_by_role("combobox", name="Customer Asset, Lookup")
        asset_box.click()
        asset_box.fill(customer_asset)
        # The recording clicked a specific labeled suggestion
        # (getByLabel('CCOXN1, 255711-VXT-6550-')) rather than a generic
        # role=option — D365 lookup flyouts sometimes render suggestions as
        # a plain listbox (role=option) and sometimes as custom
        # aria-labeled rows, so try the more standard role first and fall
        # back to a text-based match if that finds nothing. The search
        # itself is an async server round-trip, so wait for a suggestion
        # to actually appear instead of a blind sleep before giving up on
        # the primary strategy.
        try:
            option = page.get_by_role("option").filter(has_text=customer_asset).first
            option.wait_for(state="visible", timeout=8000)
            option.click(timeout=4000)
        except PlaywrightTimeoutError:
            log("  no role=option suggestion appeared — trying a text-based fallback...")
            candidates = page.get_by_text(customer_asset, exact=False)
            match_count = candidates.count()
            log(f"  text-based fallback found {match_count} match(es) on the page.")
            if match_count == 0:
                raise RuntimeError(
                    f"Couldn't find any suggestion for Customer Asset '{customer_asset}' — "
                    "check whether this asset number actually exists in D365, or whether the "
                    "lookup search is slower than expected."
                )
            if match_count > 1:
                log(f"  WARNING: {match_count} matches found, clicking the first one — this may not be the intended one.")
            candidates.first.click(timeout=4000)

        # CONFIRMED IN REAL TESTING (2026-08-20): a failed/wrong asset
        # selection here doesn't fail loudly on its own — instead a LATER,
        # unrelated field (SEMI E10 Asset State, which D365 likely only
        # shows once a valid asset is selected) fails to even be found at
        # all, which is a much more confusing error to debug. Verify right
        # here instead, so a bad selection fails at its actual source.
        page.wait_for_timeout(500)
        try:
            current_value = asset_box.input_value()
        except Exception:
            current_value = None
        log(f"  Customer Asset field now shows: {current_value!r}")
        if not current_value or customer_asset not in current_value:
            raise RuntimeError(
                f"Customer Asset selection looks wrong — field shows {current_value!r}, "
                f"expected it to contain '{customer_asset}'. Check the screenshot to see what "
                "was actually on screen."
            )

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

    # The recording fills no fields at all on this quick-create form — see
    # the module docstring's "KNOWN UNVERIFIED ASSUMPTIONS" for the caveat
    # that this may not always be true.
    page.locator('[id="OverflowButton_buttonid-2336_msdyn_workorder:bookings$button"]').click()
    page.get_by_role("menuitem", name="Add New Bookable Resource").click()
    page.get_by_role("menuitem", name="Save & Close Save and close").click()
    page.wait_for_timeout(1500)

    # The recording reloads and clicks "Discard changes" right after this —
    # read as clearing a leftover "unsaved changes" indicator on the parent
    # Work Order form after returning from the sub-record, not a real
    # data-discarding action (the Work Order was already saved in step 1).
    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")
    try:
        page.get_by_role("button", name="Discard changes").click(timeout=3000)
    except PlaywrightTimeoutError:
        log("  no 'Discard changes' prompt appeared — nothing to discard, continuing.")


# ---------- Step 3: Quality Escape (header) ----------

def add_quality_escape(page, wo_id, qe):
    log("Opening the Quality related section and adding a Quality Escape...")
    page.locator("#icon_more_tab_1").click()
    page.locator("#relatedEntityContainer").get_by_text("Quality", exact=True).click()
    page.get_by_role("menuitem", name="Add New Quality Escape Add a").click()

    log("Filling Quality Escape fields...")
    select_option(page, "Customer Temperature", qe.get("customerTemperature"))
    select_option(page, "Are Wafers Scrapped?", qe.get("wafersScrapped"), exact=True)
    select_option(page, "Customer Tracking Type", qe.get("customerTrackingType"))
    select_option(page, "Safety Issue?", qe.get("safetyIssue"))
    select_option(page, "Instl/Upgrd Commit Date", qe.get("commitDate"))
    fill_textbox(page, "Problem Description", qe.get("problemDescription"))

    # The recording shows no explicit "Save" click here before moving on to
    # the canvas widget + Quality Escape Item — this quick-create panel may
    # autosave per field, or there may be an implicit save this recording
    # doesn't show. Reload the Work Order (matching the recording) so
    # whatever state exists gets persisted/refreshed before continuing.
    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")
    click_canvas_app_widget(page)


# ---------- Step 4: Quality Escape Item ----------

def create_quality_escape_item(page, wo_id, qei):
    """LEAST CERTAIN PART OF THIS FILE — read before trusting it.

    The reference recording reaches the Quality Escape Item via a hardcoded
    record URL (a GUID that obviously can't be reused for a new record),
    immediately after clicking the canvas widget's "登入" button in
    add_quality_escape() above. This strongly suggests the Item record gets
    auto-created as a child of the Quality Escape header at that point
    (a common D365 pattern for header/detail entity pairs), but that's an
    inference, not something confirmed against the live system.

    This implementation's best-effort approach: after add_quality_escape()
    finishes, look for a Quality Escape Item related grid/link reachable
    from the same Work Order or Quality Escape record, and open the most
    recently created row. If that navigation path turns out to be wrong,
    this is the first place to fix once tested against real D365 — not a
    guess worth hardening further without that feedback.
    """
    log("Looking for the auto-created Quality Escape Item...")
    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")
    page.locator("#icon_more_tab_1").click()
    page.locator("#relatedEntityContainer").get_by_text("Quality", exact=True).click()
    page.wait_for_timeout(1000)

    # Best-effort: click the first/most-recent row in whatever "Quality
    # Escape Item" grid is showing. get_by_role("row") excludes the header
    # row by default in Playwright's accessibility mapping, so index 0 here
    # should be the first real data row, not a column-header row.
    first_row = page.get_by_role("row").first
    first_row.click()
    page.wait_for_timeout(1500)

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
    # Note: the recording's AI-writing-assist iframe ("aigenerator") arrow
    # clicks are deliberately NOT reproduced here — that's an optional
    # Power Apps text-assist feature, not a required step.


# ---------- Step 5: Product / Delivery Instruction ----------

def fill_product_and_delivery(page, wo_id, product):
    log("Returning to the Work Order to fill Product and Delivery Instruction...")
    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")

    part_no = product.get("partNo")
    if part_no:
        log(f"Filling Product lookup with '{part_no}'...")
        product_box = page.get_by_role("combobox", name="Product, Lookup")
        product_box.click()
        product_box.fill(part_no)
        page.wait_for_timeout(1200)
        # The recording shows no follow-up click here — unclear whether an
        # exact match auto-resolves on blur, or whether this is the same
        # kind of capture gap as the Upload-to-SAP click. Try clicking a
        # matching suggestion if one appears; if not, fall through — the
        # typed value may already be enough.
        try:
            page.get_by_role("option").filter(has_text=part_no).first.click(timeout=3000)
        except PlaywrightTimeoutError:
            log("  no suggestion flyout appeared for the Product field — assuming it auto-resolved on the typed value.")

    delivery_text = ",".join(
        part
        for part in [
            product.get("priorityCode", ""),
            f"{product.get('deliveryDate', '')} {product.get('deliveryTime', '')}".strip(),
            product.get("location", ""),
            product.get("contactName", ""),
            product.get("contactPhone", ""),
        ]
    )
    fill_textbox(page, "Delivery Instruction (", delivery_text)
    fill_textbox(page, "Delivery Instruction Detail (", delivery_text)

    page.goto(record_url("msdyn_workorder", wo_id))
    page.wait_for_load_state("domcontentloaded")
    click_canvas_app_widget(page)


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

            wo_id = create_work_order(page, payload.get("workOrder", {}))
            add_bookable_resource(page, wo_id)
            add_quality_escape(page, wo_id, payload.get("qualityEscape", {}))
            create_quality_escape_item(page, wo_id, payload.get("qualityEscapeItem", {}))
            fill_product_and_delivery(page, wo_id, payload.get("product", {}))

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
