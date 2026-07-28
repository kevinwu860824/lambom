"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { Download, FileSpreadsheet, Plus, Square, Upload, X as XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { parseModulesWorkbook } from "@/lib/bom-parse";
import { autoMatchKeyParts, lookupMachineForFid, saveMachineForFid, uploadBomEntry } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FidDownloaderApi {
  start: (params: {
    fid?: string;
    mode: "tool" | "modules";
    so?: string;
  }) => Promise<{ ok: boolean; resultPath: string | null }>;
  onLog: (callback: (line: string) => void) => () => void;
  openFolder: (filePath: string) => Promise<void>;
  readFile: (filePath: string) => Promise<ArrayBuffer>;
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
  modulesResultPath?: string | null;
}

/**
 * Only does anything inside the lambom desktop (Electron) shell, which
 * exposes window.fidDownloader via a preload script — on the public web
 * deployment (same code, opened in a regular browser) that API doesn't
 * exist, so this renders nothing.
 *
 * The "Machine No." field is used directly as the Supabase upload machine
 * name (machine_name) — no lookup or prompt needed. SO can no longer be
 * entered manually; it's always resolved from FID via VA03 automatically
 * (if a FID's BOM has been revised, VA03 may return multiple results — the
 * bottom-most one is picked, using dynamic column detection since the
 * column position isn't fixed across searches).
 *
 * Each "Add" pushes FID + Machine No. onto the queue; "Download" processes
 * it sequentially — every item downloads the Full BOM (IB53, saved to the
 * downloads folder as a reference only) and Modules (ZOOBOM_CE_FMT); once
 * Modules is downloaded it's automatically cleaned up, uploaded to
 * Supabase, and run through key-part auto-matching. One item failing
 * doesn't stop the batch — it moves on to the next.
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
      const mapped = await lookupMachineForFid(getSupabase(), trimmedFid);
      if (mapped) setMachineNo(mapped);
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

  async function uploadModulesToMachine(resultPath: string, machineName: string) {
    const supabase = getSupabase();
    setLog((prev) => `${prev}Reading file...\n`);
    const buffer = await window.fidDownloader!.readFile(resultPath);
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

    if (successCount > 0) {
      try {
        const count = await autoMatchKeyParts(supabase, machineName);
        setLog((prev) => `${prev}Auto-matched ${count} key part(s).\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLog((prev) => `${prev}[Error] Key part auto-matching failed: ${message}\n`);
      }
      onUploaded?.();
    }

    setLog((prev) => `${prev}Upload complete: ${successCount} succeeded, ${failCount} failed.\n`);
    if (failCount > 0 && successCount === 0) {
      throw new Error("All module uploads failed");
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
        setLog((prev) => `${prev}--- Full BOM ---\n`);
        const toolResult = await window.fidDownloader.start({ fid: item.fid, mode: "tool" });
        if (cancelRequestedRef.current) {
          setLog((prev) => `${prev}Cancelled.\n`);
          setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "cancelled" } : q)));
          break;
        }
        setLog((prev) =>
          toolResult.ok && toolResult.resultPath
            ? `${prev}Full BOM done: ${toolResult.resultPath}\n`
            : `${prev}[Error] Full BOM download failed, skipping ahead to Modules.\n`
        );

        setLog((prev) => `${prev}--- Modules ---\n`);
        const modulesResult = await window.fidDownloader.start({ fid: item.fid, mode: "modules" });
        if (cancelRequestedRef.current) {
          setLog((prev) => `${prev}Cancelled.\n`);
          setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "cancelled" } : q)));
          break;
        }
        if (!modulesResult.ok || !modulesResult.resultPath) {
          throw new Error("Modules download failed, check the messages above");
        }
        setLog((prev) => `${prev}Modules done: ${modulesResult.resultPath}\n`);

        await uploadModulesToMachine(modulesResult.resultPath, item.machineNo);

        try {
          await saveMachineForFid(getSupabase(), item.fid, item.machineNo);
        } catch {
          // A mapping-save failure doesn't affect this item's already-successful upload.
        }

        setQueue((prev) =>
          prev.map((q, idx) =>
            idx === i ? { ...q, status: "done", modulesResultPath: modulesResult.resultPath } : q
          )
        );
      } catch (err) {
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
                {item.status === "done" && item.modulesResultPath && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.fidDownloader?.openFolder(item.modulesResultPath!)}
                  >
                    Open Folder
                  </Button>
                )}
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
