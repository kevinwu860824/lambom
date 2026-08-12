/**
 * Only usable inside the lambom desktop (Electron) shell, which exposes
 * window.inventoryLookup via a preload script (desktop/electron/preload.js)
 * — on the public web deployment (same code, opened in a regular browser)
 * that API doesn't exist. Same pattern as window.fidDownloader
 * (components/fid-downloader-panel.tsx).
 */
export interface InventoryLookupApi {
  lookup: (partNo: string) => Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    inventoryLookup?: InventoryLookupApi;
  }
}

export function isInventoryLookupAvailable(): boolean {
  return typeof window !== "undefined" && !!window.inventoryLookup;
}

/** Drives the already-open SAP GUI to the stock overview screen for
 * `partNo`. Throws on failure (e.g. SAP not reachable, part not found). */
export async function lookupInventory(partNo: string): Promise<void> {
  if (!window.inventoryLookup) throw new Error("Inventory lookup isn't available outside the desktop app");
  const result = await window.inventoryLookup.lookup(partNo);
  if (!result.ok) throw new Error(result.error || "Inventory lookup failed");
}
