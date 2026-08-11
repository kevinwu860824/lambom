"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { Download, FileSpreadsheet, Plus, Square, Upload, X as XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { parseModulesWorkbook, parseXlsxBom, parseZbomWorkbook } from "@/lib/bom-parse";
import {
  autoMatchKeyParts,
  lookupFidEntry,
  saveFidEntry,
  uploadBomEntry,
  uploadFullBomEntry,
  uploadZbomEntry,
} from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FidDownloadMode = "tool" | "modules" | "zbom" | "resolve";

interface FidDownloaderApi {
  start: (params: {
    fid?: string;
    mode: FidDownloadMode;
    so?: string;
  }) => Promise<{ ok: boolean; resultPath: string | null; so?: string | null; po?: string | null }>;
  onLog: (callback: (line: string) => void) => () => void;
  openFolder: (filePath: string) => Promise<void>;
  readFile: (filePath: string) => Promise<ArrayBuffer>;
  deleteFile: (filePath: string) => Promise<void>;
  cancel: () => Promise<boolean>;
}

declare global {
  interface Window {
    fidDownloader?: FidDownloaderApi;
  }
}

type QueueStatus = "queued" | "running" | "done" | "error" | "cancelled";

interface QueueItem {
  id: string;
  fid: string;
  machineNo: string;
  status: QueueStatus;
  error?: string;
}

class CancelledError extends Error {}

/**
 * Only does anything inside the lambom desktop (Electron) shell, which
 * exposes window.fidDownloader via a preload script — on the public web
 * deployment (same code, opened in a regular browser) that API doesn't
 * exist, so this renders nothing.
 *
 * Each queue item runs through four steps, in order:
 *   1. Resolve SO/PO for the FID — checked against a cache first (so a given
 *      FID's SAP search only ever has to run once); on a cache miss it runs
 *      the CLI's "resolve" mode and saves the result back to the cache
 *      immediately. A failure here fails the whole item.
 *   2. Full BOM (IB53) — stored in its own table (full_bom_items), separate
 *      from Modules and not shown in the Subparts list at all.
 *      A failure here only logs a warning; the item continues.
 *   3. Modules (ZOOBOM_CE_FMT, using the SO from step 1) — each module sheet
 *      becomes its own subpart, then key-part auto-matching runs. A failure
 *      here fails the whole item (this is the core dataset).
 *   4. ZBOM (VA03 configuration options, using the SO from step 1) — stored
 *      for reference. A failure here only logs a warning.
 * Every step deletes its local file after a successful upload; if the
 * upload fails the file is left in place as a fallback and its path is
 * logged.
 */
export function FidDownloaderPanel({
  existingMachines = [],
  onUploaded,
}: {
  existingMachines?: string[];
  onUploaded?: () => void;
}) {
  const [available, setAvailable] = useState(false);
  const [machineNo, setMachineNo] = useState("");
  const [fid, setFid] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [log, setLog] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRequestedRef = useRef(false);

  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  useEffect(() => {
    if (!window.fidDownloader) return;
    setAvailable(true);
    const unsubscribe = window.fidDownloader.onLog((line) => {
      setLog((prev) => `${prev}${line}\n`);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function handleFidBlur() {
    const trimmedFid = fid.trim();
    if (!trimmedFid || machineNo.trim()) return;
    try {
      const entry = await lookupFidEntry(getSupabase(), trimmedFid);
      if (entry?.machineName) setMachineNo(entry.machineName);
    } catch {
      // Just a convenience auto-fill; a lookup miss or failure doesn't affect manual entry.
    }
  }

  function addToQueue() {
    const trimmedMachineNo = machineNo.trim();
    const trimmedFid = fid.trim();
    if (!trimmedMachineNo || !trimmedFid || processing) return;
    setQueue((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, fid: trimmedFid, machineNo: trimmedMachineNo, status: "queued" },
    ]);
    setMachineNo("");
    setFid("");
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Machine No.", "FID"]]);
    sheet["!cols"] = [{ wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, sheet, "SAP Download List");
    XLSX.writeFile(wb, "SAP_Download_List_Template.xlsx");
  }

  async function importFromExcel(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      if (rows.length < 2) throw new Error("This file has no data rows besides the header");

      const header = rows[0].map((h) => (h ?? "").toString().trim());
      const machineCol = header.findIndex((h) => h.toLowerCase().includes("machine"));
      const fidCol = header.findIndex((h) => h.toUpperCase().includes("FID"));

      const newItems: QueueItem[] = [];
      let skipped = 0;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const machineNoValue = (row[machineCol === -1 ? 0 : machineCol] ?? "").toString().trim();
        const fidValue = (row[fidCol === -1 ? 1 : fidCol] ?? "").toString().trim();
        if (!machineNoValue || !fidValue) {
          if (machineNoValue || fidValue) skipped++;
          continue;
        }
        newItems.push({
          id: `${Date.now()}-${Math.random()}`,
          fid: fidValue,
          machineNo: machineNoValue,
          status: "queued",
        });
      }

      if (newItems.length === 0) throw new Error("No valid data rows found (Machine No. and FID are both required)");

      setQueue((prev) => [...prev, ...newItems]);
      setLog(
        (prev) =>
          `${prev}\nImported ${newItems.length} row(s) from Excel into the queue${skipped > 0 ? ` (skipped ${skipped} row(s) missing a field)` : ""}.\n`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}\n[Error] Excel import failed: ${message}\n`);
    }
  }

  function checkCancelled() {
    if (cancelRequestedRef.current) throw new CancelledError();
  }

  async function deleteLocalFile(path: string) {
    try {
      await window.fidDownloader!.deleteFile(path);
    } catch {
      // Best-effort cleanup only.
    }
  }

  async function resolveSoPo(fidValue: string, machineName: string): Promise<{ so: string; po: string }> {
    const supabase = getSupabase();
    const cached = await lookupFidEntry(supabase, fidValue);
    if (cached?.so) {
      setLog((prev) => `${prev}Using cached SO ${cached.so}.\n`);
      return { so: cached.so, po: cached.po ?? "" };
    }

    setLog((prev) => `${prev}Resolving SO/PO...\n`);
    const result = await window.fidDownloader!.start({ fid: fidValue, mode: "resolve" });
    checkCancelled();
    if (!result.ok || !result.so) {
      throw new Error("Failed to resolve SO/PO, check the messages above");
    }
    const so = result.so;
    const po = result.po ?? "";
    setLog((prev) => `${prev}Resolved SO=${so} PO=${po || "(none)"}.\n`);

    try {
      await saveFidEntry(supabase, fidValue, { machineName, so, po });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[Error] Failed to cache the resolved SO/PO: ${message}\n`);
    }

    return { so, po };
  }

  async function downloadFullBom(fidValue: string, machineName: string) {
    setLog((prev) => `${prev}--- Full BOM ---\n`);
    const result = await window.fidDownloader!.start({ fid: fidValue, mode: "tool" });
    checkCancelled();
    if (!result.ok || !result.resultPath) {
      setLog((prev) => `${prev}[Error] Full BOM download failed, skipping ahead.\n`);
      return;
    }
    setLog((prev) => `${prev}Full BOM done: ${result.resultPath}\n`);
    try {
      const buffer = await window.fidDownloader!.readFile(result.resultPath);
      const parsed = parseXlsxBom(buffer);
      await uploadFullBomEntry(getSupabase(), machineName, parsed);
      await deleteLocalFile(result.resultPath);
      setLog((prev) => `${prev}Full BOM uploaded (${parsed.items.length} items).\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[Error] Full BOM upload failed: ${message} (kept local file: ${result.resultPath})\n`);
    }
  }

  async function downloadModules(fidValue: string, so: string, machineName: string) {
    setLog((prev) => `${prev}--- Modules ---\n`);
    const result = await window.fidDownloader!.start({ fid: fidValue, so, mode: "modules" });
    checkCancelled();
    if (!result.ok || !result.resultPath) {
      throw new Error("Modules download failed, check the messages above");
    }
    setLog((prev) => `${prev}Modules done: ${result.resultPath}\n`);

    const supabase = getSupabase();
    const buffer = await window.fidDownloader!.readFile(result.resultPath);
    const sheets = parseModulesWorkbook(buffer);
    setLog((prev) => `${prev}${sheets.length} module(s) found, uploading to machine "${machineName}"...\n`);

    let successCount = 0;
    let failCount = 0;
    for (const { sheetName, parsed } of sheets) {
      try {
        await uploadBomEntry(supabase, sheetName, parsed, machineName);
        successCount++;
        setLog((prev) => `${prev}  ${sheetName}: done (${parsed.items.length} items)\n`);
      } catch (err) {
        failCount++;
        const message = err instanceof Error ? err.message : String(err);
        setLog((prev) => `${prev}  ${sheetName}: failed - ${message}\n`);
      }
    }

    if (successCount === 0) {
      setLog((prev) => `${prev}[Error] All module uploads failed (kept local file: ${result.resultPath})\n`);
      throw new Error("All module uploads failed");
    }

    try {
      const count = await autoMatchKeyParts(supabase, machineName);
      setLog((prev) => `${prev}Auto-matched ${count} key part(s).\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[Error] Key part auto-matching failed: ${message}\n`);
    }
    onUploaded?.();

    await deleteLocalFile(result.resultPath);
    setLog((prev) => `${prev}Modules upload complete: ${successCount} succeeded, ${failCount} failed.\n`);
  }

  async function downloadZbom(so: string, machineName: string) {
    setLog((prev) => `${prev}--- ZBOM ---\n`);
    const result = await window.fidDownloader!.start({ so, mode: "zbom" });
    checkCancelled();
    if (!result.ok || !result.resultPath) {
      setLog((prev) => `${prev}[Error] ZBOM download failed, skipping.\n`);
      return;
    }
    setLog((prev) => `${prev}ZBOM done: ${result.resultPath}\n`);
    try {
      const buffer = await window.fidDownloader!.readFile(result.resultPath);
      const options = parseZbomWorkbook(buffer);
      await uploadZbomEntry(getSupabase(), machineName, options);
      await deleteLocalFile(result.resultPath);
      setLog((prev) => `${prev}ZBOM uploaded (${options.length} option(s)).\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[Error] ZBOM upload failed: ${message} (kept local file: ${result.resultPath})\n`);
    }
  }

  function cancelQueue() {
    if (!processing) return;
    cancelRequestedRef.current = true;
    window.fidDownloader?.cancel();
    setLog((prev) => `${prev}\nCancel requested, stopping the current item (remaining queue won't be processed)...\n`);
  }

  async function processQueue() {
    if (processing || queue.length === 0 || !window.fidDownloader) return;
    setProcessing(true);
    cancelRequestedRef.current = false;
    setLog((prev) => `${prev}\nStarting queue, ${queue.length} total...\n`);

    for (let i = 0; i < queue.length; i++) {
      if (cancelRequestedRef.current) break;

      const item = queue[i];
      setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "running" } : q)));
      setLog((prev) => `${prev}\n=== [${i + 1}/${queue.length}] ${item.machineNo} (FID ${item.fid}) ===\n`);

      try {
        // Modules runs before Full BOM: uploadFullBomEntry only UPDATEs
        // bom_machines.has_full_bom (not upsert), so on a machine's very
        // first run that row must already exist — created by Modules'
        // uploadBomEntry insert — or the flag update silently matches zero
        // rows and Full BOM never shows up in /full-bom despite the data
        // being uploaded successfully.
        const { so } = await resolveSoPo(item.fid, item.machineNo);
        await downloadModules(item.fid, so, item.machineNo);
        await downloadFullBom(item.fid, item.machineNo);
        await downloadZbom(so, item.machineNo);

        setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "done" } : q)));
      } catch (err) {
        if (err instanceof CancelledError) {
          setLog((prev) => `${prev}Cancelled.\n`);
          setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "cancelled" } : q)));
          break;
        }
        const message = err instanceof Error ? err.message : String(err);
        setLog((prev) => `${prev}[Error] ${item.machineNo} (FID ${item.fid}) failed: ${message}\n`);
        setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "error", error: message } : q)));
      }
    }

    const wasCancelled = cancelRequestedRef.current;
    setLog((prev) => `${prev}\n${wasCancelled ? "Cancelled, processing stopped." : "All items processed."}\n`);
    cancelRequestedRef.current = false;
    setProcessing(false);
  }

  if (!available) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>SAP Download</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-end gap-2 overflow-x-auto">
          <div className="grid shrink-0 gap-1.5">
            <Label className="text-xs">Machine No.</Label>
            <Input
              list="fid-downloader-existing-machines"
              value={machineNo}
              onChange={(e) => setMachineNo(e.target.value)}
              placeholder="e.g. ACOXN1"
              disabled={processing}
              className="w-32"
              onKeyDown={(e) => {
                if (e.key === "Enter") addToQueue();
              }}
            />
            <datalist id="fid-downloader-existing-machines">
              {existingMachines.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div className="grid shrink-0 gap-1.5">
            <Label className="text-xs">FID</Label>
            <Input
              value={fid}
              onChange={(e) => setFid(e.target.value)}
              onBlur={handleFidBlur}
              placeholder="e.g. 264059"
              disabled={processing}
              className="w-32"
              onKeyDown={(e) => {
                if (e.key === "Enter") addToQueue();
              }}
            />
          </div>
          <Button className="shrink-0" onClick={addToQueue} disabled={processing || !machineNo.trim() || !fid.trim()}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
          <Button className="shrink-0" variant="outline" onClick={downloadTemplate} disabled={processing}>
            <FileSpreadsheet className="h-4 w-4" />
            Excel Template
          </Button>
          <Button
            className="shrink-0"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={processing}
          >
            <Upload className="h-4 w-4" />
            Import Excel
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFromExcel(file);
              e.target.value = "";
            }}
          />
        </div>

        {queue.length > 0 && (
          <div className="mb-3 grid gap-1.5">
            {queue.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                <span className="text-muted-foreground w-5 text-xs">{idx + 1}</span>
                <span className="flex-1 truncate">
                  {item.machineNo}
                  <span className="text-muted-foreground"> — FID {item.fid}</span>
                </span>
                {item.status === "running" && <span className="text-xs text-blue-600">Running…</span>}
                {item.status === "done" && <span className="text-xs text-emerald-600">Done</span>}
                {item.status === "error" && (
                  <span className="text-destructive text-xs" title={item.error}>
                    Failed
                  </span>
                )}
                {item.status === "cancelled" && <span className="text-muted-foreground text-xs">Cancelled</span>}
                {item.status === "queued" && !processing && (
                  <Button size="icon-xs" variant="ghost" onClick={() => removeFromQueue(item.id)}>
                    <XIcon className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mb-3 flex items-center gap-2">
          <Button onClick={processQueue} disabled={processing || queue.length === 0}>
            <Download className="h-4 w-4" />
            {processing ? "Downloading…" : `Download (${queue.length})`}
          </Button>
          {processing && (
            <Button variant="destructive" onClick={cancelQueue}>
              <Square className="h-4 w-4" />
              Cancel
            </Button>
          )}
        </div>

        <div
          ref={logRef}
          className="h-48 overflow-y-auto rounded-md bg-neutral-900 p-2 font-mono text-xs whitespace-pre-wrap text-neutral-200"
        >
          {log}
        </div>
      </CardContent>
    </Card>
  );
}
