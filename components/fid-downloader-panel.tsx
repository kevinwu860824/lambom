"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { Download, FileSpreadsheet, Plus, Square, Upload, X as XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { parseModulesWorkbook, parseXlsxBom, parseZbomWorkbook } from "@/lib/bom-parse";
import {
  autoMatchKeyParts,
  ensureMachineRecord,
  lookupFidEntry,
  saveFidEntry,
  uploadBomEntry,
  uploadFullBomEntry,
  uploadZbomEntry,
} from "@/lib/bom";
import { ensureMachineInGroup } from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const zh: Record<string, string> = {
  "SAP Download": "SAP 下載",
  "Machine No.": "機台編號",
  SO: "SO（選填）",
  "e.g. ACOXN1": "例如 ACOXN1",
  "e.g. E0458": "例如 E0458",
  "e.g. 264059": "例如 264059",
  Add: "新增",
  "Excel Template": "Excel 範本",
  "Import Excel": "匯入 Excel",
  "Running…": "執行中…",
  Done: "完成",
  "Partial failure": "部分失敗",
  Failed: "失敗",
  Cancelled: "已取消",
  "Please enter your employee ID on the home page first before downloading a new machine.":
    "請先回首頁輸入工號,才能下載新機台。",
  "Please enter your employee ID on the home page first, so the system knows which group to attribute the new machine to.":
    "請先回首頁輸入工號,系統才知道新機台要歸屬到哪個群組。",
  "Downloading…": "下載中…",
  "Download ({count})": "下載 ({count})",
  "Modules": "Modules",
  "Full BOM": "完整 BOM",
  "ZBOM": "ZBOM",
  "Select at least one download type": "請至少選擇一種下載類型",
  Cancel: "取消",
};

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

type QueueStatus = "queued" | "running" | "done" | "partial" | "error" | "cancelled";

interface QueueItem {
  id: string;
  fid: string;
  machineNo: string;
  so: string;
  downloads: DownloadSelection;
  status: QueueStatus;
  error?: string;
}

interface DownloadSelection {
  modules: boolean;
  fullBom: boolean;
  zbom: boolean;
}

type DownloadOutcome = "success" | "partial" | "failed";

const defaultDownloadSelection: DownloadSelection = {
  modules: true,
  fullBom: true,
  zbom: true,
};

class CancelledError extends Error {}

/**
 * Only does anything inside the lambom desktop (Electron) shell, which
 * exposes window.fidDownloader via a preload script — on the public web
 * deployment (same code, opened in a regular browser) that API doesn't
 * exist, so this renders nothing.
 *
 * Each selected download type is attempted independently. Modules and ZBOM
 * share an SO/PO lookup; if that lookup fails, those types are marked failed
 * while Full BOM can still run. The queue item is Done only if every selected
 * type succeeds, Partial if some succeed, and Failed if none succeed.
 * Downloaded files are deleted after successful uploads and retained when
 * parsing or upload fails so they can be recovered.
 */
export function FidDownloaderPanel({
  existingMachines = [],
  groupId,
}: {
  existingMachines?: string[];
  groupId: number | null;
}) {
  const t = useTranslate(zh);
  const [available, setAvailable] = useState(false);
  const [machineNo, setMachineNo] = useState("");
  const [fid, setFid] = useState("");
  const [so, setSo] = useState("");
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
      {
        id: `${Date.now()}-${Math.random()}`,
        fid: trimmedFid,
        machineNo: trimmedMachineNo,
        so: so.trim(),
        downloads: { ...defaultDownloadSelection },
        status: "queued",
      },
    ]);
    setMachineNo("");
    setFid("");
    setSo("");
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Machine No.", "FID", "SO"]]);
    sheet["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 16 }];
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
      const soCol = header.findIndex((h) => h.toUpperCase() === "SO" || h.toLowerCase().includes("sales order"));

      const newItems: QueueItem[] = [];
      let skipped = 0;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const machineNoValue = (row[machineCol === -1 ? 0 : machineCol] ?? "").toString().trim();
        const fidValue = (row[fidCol === -1 ? 1 : fidCol] ?? "").toString().trim();
        const soValue = soCol === -1 ? "" : (row[soCol] ?? "").toString().trim();
        if (!machineNoValue || !fidValue) {
          if (machineNoValue || fidValue) skipped++;
          continue;
        }
        newItems.push({
          id: `${Date.now()}-${Math.random()}`,
          fid: fidValue,
          machineNo: machineNoValue,
          so: soValue,
          downloads: { ...defaultDownloadSelection },
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

  function toggleDownload(itemId: string, key: keyof DownloadSelection) {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, downloads: { ...item.downloads, [key]: !item.downloads[key] } }
          : item
      )
    );
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
      await saveFidEntry(supabase, fidValue, { machineName });
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

    await saveFidEntry(supabase, fidValue, { machineName, so, po });

    return { so, po };
  }

  async function saveSuppliedSo(fidValue: string, machineName: string, suppliedSo: string): Promise<string> {
    const normalizedSo = suppliedSo.trim();
    if (!normalizedSo) return "";
    await saveFidEntry(getSupabase(), fidValue, { machineName, so: normalizedSo });
    setLog((prev) => `${prev}Using supplied SO ${normalizedSo}.\n`);
    return normalizedSo;
  }

  async function downloadFullBom(fidValue: string, machineName: string): Promise<DownloadOutcome> {
    setLog((prev) => `${prev}--- Full BOM ---\n`);
    const result = await window.fidDownloader!.start({ fid: fidValue, mode: "tool" });
    checkCancelled();
    if (!result.ok || !result.resultPath) {
      setLog((prev) => `${prev}[Error] Full BOM download failed, skipping ahead.\n`);
      return "failed";
    }
    setLog((prev) => `${prev}Full BOM file ready: ${result.resultPath}\n`);
    try {
      const buffer = await window.fidDownloader!.readFile(result.resultPath);
      const parsed = parseXlsxBom(buffer);
      await uploadFullBomEntry(getSupabase(), machineName, parsed);
      await deleteLocalFile(result.resultPath);
      setLog((prev) => `${prev}Full BOM uploaded (${parsed.items.length} items).\n`);
      return "success";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[Error] Full BOM upload failed: ${message} (kept local file: ${result.resultPath})\n`);
      return "failed";
    }
  }

  async function downloadModules(fidValue: string, so: string, machineName: string): Promise<DownloadOutcome> {
    setLog((prev) => `${prev}--- Modules ---\n`);
    const result = await window.fidDownloader!.start({ fid: fidValue, so, mode: "modules" });
    checkCancelled();
    if (!result.ok || !result.resultPath) {
      throw new Error("Modules download failed, check the messages above");
    }
    setLog((prev) => `${prev}Modules done: ${result.resultPath}\n`);

    const supabase = getSupabase();
    const buffer = await window.fidDownloader!.readFile(result.resultPath);
    let sheets: { sheetName: string; parsed: ReturnType<typeof parseModulesWorkbook>[number]["parsed"] }[];
    try {
      sheets = parseModulesWorkbook(buffer, (sheetName, error) => {
        setLog((prev) => `${prev}[Warning] Skipping non-BOM sheet "${sheetName}": ${error.message}\n`);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[Warning] Modules contains no valid BOM sheets: ${message}\n`);
      setLog((prev) => `${prev}Continuing with Full BOM and ZBOM.\n`);
      return "failed";
    }
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

    // groupId is guaranteed non-null here — processQueue refuses to start
    // otherwise, since an unattributed machine would be invisible to everyone.
    if (groupId != null) {
      try {
        await ensureMachineInGroup(supabase, groupId, machineName);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLog((prev) => `${prev}[Error] Failed to record group ownership: ${message}\n`);
      }
    }
    if (failCount === 0) {
      await deleteLocalFile(result.resultPath);
    } else {
      setLog((prev) => `${prev}[Warning] Kept the Modules workbook for recovery: ${result.resultPath}\n`);
    }
    setLog((prev) => `${prev}Modules upload complete: ${successCount} succeeded, ${failCount} failed.\n`);
    return failCount === 0 ? "success" : "partial";
  }

  async function downloadZbom(so: string, machineName: string): Promise<DownloadOutcome> {
    setLog((prev) => `${prev}--- ZBOM ---\n`);
    const result = await window.fidDownloader!.start({ so, mode: "zbom" });
    checkCancelled();
    if (!result.ok || !result.resultPath) {
      setLog((prev) => `${prev}[Error] ZBOM download failed, skipping.\n`);
      return "failed";
    }
    setLog((prev) => `${prev}ZBOM done: ${result.resultPath}\n`);
    try {
      const buffer = await window.fidDownloader!.readFile(result.resultPath);
      const options = parseZbomWorkbook(buffer);
      await uploadZbomEntry(getSupabase(), machineName, options);
      await ensureMachineRecord(getSupabase(), machineName);
      if (groupId != null) await ensureMachineInGroup(getSupabase(), groupId, machineName);
      await deleteLocalFile(result.resultPath);
      setLog((prev) => `${prev}ZBOM uploaded (${options.length} option(s)).\n`);
      return "success";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[Error] ZBOM upload failed: ${message} (kept local file: ${result.resultPath})\n`);
      return "failed";
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
    if (groupId == null) {
      setLog(
        (prev) =>
          `${prev}\n${t(
            "Please enter your employee ID on the home page first, so the system knows which group to attribute the new machine to."
          )}\n`
      );
      return;
    }
    setProcessing(true);
    cancelRequestedRef.current = false;
    setLog((prev) => `${prev}\nStarting queue, ${queue.length} total...\n`);

    for (let i = 0; i < queue.length; i++) {
      if (cancelRequestedRef.current) break;

      const item = queue[i];
      setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "running" } : q)));
      setLog((prev) => `${prev}\n=== [${i + 1}/${queue.length}] ${item.machineNo} (FID ${item.fid}) ===\n`);

      try {
        if (!item.downloads.modules && !item.downloads.fullBom && !item.downloads.zbom) {
          throw new Error("Select at least one download type");
        }

        let successCount = 0;
        const failedTypes: string[] = [];
        let so: string | null = null;
        if (item.downloads.modules || item.downloads.zbom) {
          try {
            so = item.so.trim()
              ? await saveSuppliedSo(item.fid, item.machineNo, item.so)
              : (await resolveSoPo(item.fid, item.machineNo)).so;
          } catch (err) {
            if (err instanceof CancelledError) throw err;
            const message = err instanceof Error ? err.message : String(err);
            failedTypes.push("SO/PO resolve");
            setLog((prev) => `${prev}[Error] Could not resolve SO/PO: ${message}\n`);
          }
        }

        if (item.downloads.modules) {
          if (!so) {
            failedTypes.push("Modules");
            setLog((prev) => `${prev}[Error] Modules skipped because SO/PO could not be resolved.\n`);
          } else {
            try {
              const outcome = await downloadModules(item.fid, so, item.machineNo);
              if (outcome !== "failed") successCount++;
              if (outcome !== "success") failedTypes.push("Modules");
            } catch (err) {
              if (err instanceof CancelledError) throw err;
              const message = err instanceof Error ? err.message : String(err);
              failedTypes.push("Modules");
              setLog((prev) => `${prev}[Error] Modules failed: ${message}\n`);
            }
          }
        }

        if (item.downloads.fullBom) {
          try {
            const outcome = await downloadFullBom(item.fid, item.machineNo);
            if (outcome === "success") successCount++;
            else failedTypes.push("Full BOM");
          } catch (err) {
            if (err instanceof CancelledError) throw err;
            const message = err instanceof Error ? err.message : String(err);
            failedTypes.push("Full BOM");
            setLog((prev) => `${prev}[Error] Full BOM failed: ${message}\n`);
          }
        }

        if (item.downloads.zbom) {
          if (!so) {
            failedTypes.push("ZBOM");
            setLog((prev) => `${prev}[Error] ZBOM skipped because SO/PO could not be resolved.\n`);
          } else {
            try {
              const outcome = await downloadZbom(so, item.machineNo);
              if (outcome === "success") successCount++;
              else failedTypes.push("ZBOM");
            } catch (err) {
              if (err instanceof CancelledError) throw err;
              const message = err instanceof Error ? err.message : String(err);
              failedTypes.push("ZBOM");
              setLog((prev) => `${prev}[Error] ZBOM failed: ${message}\n`);
            }
          }
        }

        if (failedTypes.length === 0) {
          setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "done", error: undefined } : q)));
        } else {
          const status: QueueStatus = successCount > 0 ? "partial" : "error";
          const error = `Failed: ${failedTypes.join(", ")}`;
          setLog((prev) => `${prev}[Warning] ${item.machineNo} completed with ${successCount} selected download(s) succeeded; ${error}.\n`);
          setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status, error } : q)));
        }
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
        <CardTitle>{t("SAP Download")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-end gap-2 overflow-x-auto">
          <div className="grid shrink-0 gap-1.5">
            <Label className="text-xs">{t("Machine No.")}</Label>
            <Input
              list="fid-downloader-existing-machines"
              value={machineNo}
              onChange={(e) => setMachineNo(e.target.value)}
              placeholder={t("e.g. ACOXN1")}
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
            <Label className="text-xs">{t("SO")}</Label>
            <Input
              value={so}
              onChange={(e) => setSo(e.target.value)}
              placeholder={t("e.g. E0458")}
              disabled={processing}
              className="w-32"
              onKeyDown={(e) => {
                if (e.key === "Enter") addToQueue();
              }}
            />
          </div>
          <div className="grid shrink-0 gap-1.5">
            <Label className="text-xs">FID</Label>
            <Input
              value={fid}
              onChange={(e) => setFid(e.target.value)}
              onBlur={handleFidBlur}
              placeholder={t("e.g. 264059")}
              disabled={processing}
              className="w-32"
              onKeyDown={(e) => {
                if (e.key === "Enter") addToQueue();
              }}
            />
          </div>
          <Button className="shrink-0" onClick={addToQueue} disabled={processing || !machineNo.trim() || !fid.trim()}>
            <Plus className="h-4 w-4" />
            {t("Add")}
          </Button>
          <Button className="shrink-0" variant="outline" onClick={downloadTemplate} disabled={processing}>
            <FileSpreadsheet className="h-4 w-4" />
            {t("Excel Template")}
          </Button>
          <Button
            className="shrink-0"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={processing}
          >
            <Upload className="h-4 w-4" />
            {t("Import Excel")}
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
              <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-sm">
                <span className="text-muted-foreground w-5 text-xs">{idx + 1}</span>
                <span className="min-w-48 flex-1 truncate">
                  {item.machineNo}
                  <span className="text-muted-foreground"> — FID {item.fid}{item.so ? ` — SO ${item.so}` : ""}</span>
                </span>
                <div className="flex items-center gap-3">
                  {([
                    ["modules", "Modules"],
                    ["fullBom", "Full BOM"],
                    ["zbom", "ZBOM"],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1.5 text-xs">
                      <Checkbox
                        checked={item.downloads[key]}
                        onCheckedChange={() => toggleDownload(item.id, key)}
                        disabled={processing || item.status !== "queued"}
                      />
                      {t(label)}
                    </label>
                  ))}
                </div>
                {item.status === "running" && <span className="text-xs text-blue-600">{t("Running…")}</span>}
                {item.status === "done" && <span className="text-xs text-emerald-600">{t("Done")}</span>}
                {item.status === "partial" && (
                  <span className="text-xs text-amber-600" title={item.error}>
                    {t("Partial failure")}
                  </span>
                )}
                {item.status === "error" && (
                  <span className="text-destructive text-xs" title={item.error}>
                    {t("Failed")}
                  </span>
                )}
                {item.status === "cancelled" && (
                  <span className="text-muted-foreground text-xs">{t("Cancelled")}</span>
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

        {groupId == null && (
          <p className="mb-2 text-sm text-destructive">
            {t("Please enter your employee ID on the home page first before downloading a new machine.")}
          </p>
        )}
        <div className="mb-3 flex items-center gap-2">
          <Button onClick={processQueue} disabled={processing || queue.length === 0 || groupId == null}>
            <Download className="h-4 w-4" />
            {processing ? t("Downloading…") : t("Download ({count})").replace("{count}", String(queue.length))}
          </Button>
          {processing && (
            <Button variant="destructive" onClick={cancelQueue}>
              <Square className="h-4 w-4" />
              {t("Cancel")}
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
