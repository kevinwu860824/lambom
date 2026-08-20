/**
 * Only usable inside the lambom desktop (Electron) shell, which exposes
 * window.d365Order via a preload script (desktop/electron/preload.js) — on
 * the public web deployment (same code, opened in a regular browser) that
 * API doesn't exist. Same pattern as window.fidDownloader/window.inventoryLookup
 * (lib/inventory-lookup.ts).
 *
 * Unlike those two, fill() here doesn't mean "done" — it resolves once the
 * D365 form is filled in and a real Edge window is sitting there waiting
 * for human review, not once everything is actually finished. The
 * automation process stays alive in the background until confirmSubmit()
 * or cancelD365Order() is called (or the whole desktop app quits) — see
 * desktop/d365-automation/d365_order_cli.py's module docstring for the
 * full protocol this is talking to.
 */

export interface D365OrderPayload {
  workOrder: {
    installation: string;
    description: string;
    reportedProblemDetail: string;
    serviceType: string;
    /** FID to search the Customer Asset lookup by — NOT a machine name.
     * Searching by FID returns one option per chamber/module (e.g. process
     * chambers and transfer modules can all share the same FID); if it
     * matches more than one, fillD365Form()'s in-progress automation pauses
     * and the D365OrderApi.onAssetOptions callback fires so the caller can
     * show a picker — see selectD365Asset() below. */
    fid: string;
    e10AssetState: string;
    e10AssetSubstatus: string;
  };
  qualityEscape: {
    customerTemperature: string;
    wafersScrapped: string;
    /** "" leaves the field unset, matching the reference recording. */
    customerTrackingType: string;
    safetyIssue: string;
    commitDate: string;
    problemDescription: string;
  };
  qualityEscapeItem: {
    causingProblem: string;
    deviation: string;
    specification: string;
    /** "" if none. */
    additionalNotes: string;
  };
  product: {
    partNo: string;
    priorityCode: string;
    /** Never pre-fill this with a hardcoded date — always blank until the user types one. */
    deliveryDate: string;
    deliveryTime: string;
    location: string;
    contactName: string;
    contactPhone: string;
  };
}

export interface D365OrderFillResult {
  ok: boolean;
  workOrderId: string | null;
}

export interface D365OrderApi {
  fill: (payload: D365OrderPayload) => Promise<D365OrderFillResult>;
  selectAsset: (index: number) => Promise<{ ok: boolean; error?: string }>;
  confirmSubmit: () => Promise<{ ok: boolean; error?: string }>;
  cancel: () => Promise<boolean>;
  onLog: (callback: (line: string) => void) => () => void;
  /** Fires mid-fill, while fillD365Form()'s promise is still pending, when
   * the Customer Asset (FID) search matched more than one record — each
   * string is one option's full label (as shown in D365's own suggestion
   * list). Call selectD365Asset() with the chosen index to let the
   * automation continue. */
  onAssetOptions: (callback: (options: string[]) => void) => () => void;
}

declare global {
  interface Window {
    d365Order?: D365OrderApi;
  }
}

export function isD365OrderAvailable(): boolean {
  return typeof window !== "undefined" && !!window.d365Order;
}

/** Drives Edge through the D365 form-filling sequence. Resolves once the
 * browser is sitting at the review checkpoint (nothing submitted to SAP
 * yet) — throws if the fill sequence itself fails partway through. */
export async function fillD365Form(payload: D365OrderPayload): Promise<D365OrderFillResult> {
  if (!window.d365Order) throw new Error("D365 order automation isn't available outside the desktop app");
  const result = await window.d365Order.fill(payload);
  if (!result.ok) throw new Error("Failed to fill the D365 form — check the log for details.");
  return result;
}

/** Answers a pending onAssetOptions prompt — resumes the in-progress
 * fillD365Form() call, which was paused waiting for this choice. */
export async function selectD365Asset(index: number): Promise<void> {
  if (!window.d365Order) throw new Error("D365 order automation isn't available outside the desktop app");
  const result = await window.d365Order.selectAsset(index);
  if (!result.ok) throw new Error(result.error || "Failed to select the Customer Asset option");
}

export function onD365OrderAssetOptions(callback: (options: string[]) => void): () => void {
  if (!window.d365Order) return () => {};
  return window.d365Order.onAssetOptions(callback);
}

/** v1: doesn't actually click "Upload to SAP" yet (not implemented — see
 * the CLI's module docstring) — just tells the still-open Edge window's
 * automation process that the user is ready, so it logs a reminder to
 * click the button by hand. */
export async function confirmD365Submit(): Promise<void> {
  if (!window.d365Order) throw new Error("D365 order automation isn't available outside the desktop app");
  const result = await window.d365Order.confirmSubmit();
  if (!result.ok) throw new Error(result.error || "Confirm failed");
}

/** Closes the automation browser without touching Upload to SAP. */
export async function cancelD365Order(): Promise<void> {
  if (!window.d365Order) return;
  await window.d365Order.cancel();
}

export function onD365OrderLog(callback: (line: string) => void): () => void {
  if (!window.d365Order) return () => {};
  return window.d365Order.onLog(callback);
}
