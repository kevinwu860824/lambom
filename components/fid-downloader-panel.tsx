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
 * Only does anything inside the lambom 桌面版(Electron) shell, which exposes
 * window.fidDownloader via a preload script — on the public web deployment
 * (same code, opened in a regular browser) that API doesn't exist, so this
 * renders nothing.
 *
 * 「機台編號」欄位直接就是上傳 Supabase 用的機台名稱(machine_name),不用再
 * 查表或跳出來問。SO 已經不能手動指定了,一律用 FID 透過 VA03 自動反查
 * (同一個 FID 如果 BOM 改版過,VA03 反查可能選錯版本——目前固定選第一筆,
 * 之後真的發現抓錯再調整)。
 *
 * 每次「新增」把 FID+機台編號 加入佇列,按「下載」才會依序處理:每一筆都會
 * 下載完整 BOM(IB53,只存到下載資料夾,當輔助參考)跟 Modules
 * (ZOOBOM_CE_FMT),Modules 下載完會自動整理、上傳到 Supabase 並跑一次
 * 重要零件自動比對。其中一筆失敗不會中斷整批,會繼續處理下一筆。
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
      // 只是方便帶入,查不到或查詢失敗都不影響手動輸入。
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
    const sheet = XLSX.utils.aoa_to_sheet([["機台編號", "FID"]]);
    sheet["!cols"] = [{ wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, sheet, "SAP下載清單");
    XLSX.writeFile(wb, "SAP下載清單模板.xlsx");
  }

  async function importFromExcel(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      if (rows.length < 2) throw new Error("這個檔案沒有資料(除了標題列)");

      const header = rows[0].map((h) => (h ?? "").toString().trim());
      const machineCol = header.findIndex((h) => h.includes("機台"));
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

      if (newItems.length === 0) throw new Error("沒有找到有效的資料列(機台編號、FID 都要有值)");

      setQueue((prev) => [...prev, ...newItems]);
      setLog(
        (prev) =>
          `${prev}\n已從 Excel 匯入 ${newItems.length} 筆到佇列${skipped > 0 ? `(略過 ${skipped} 筆缺欄位的資料)` : ""}。\n`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}\n[錯誤] Excel 匯入失敗:${message}\n`);
    }
  }

  async function uploadModulesToMachine(resultPath: string, machineName: string) {
    const supabase = getSupabase();
    setLog((prev) => `${prev}讀取檔案...\n`);
    const buffer = await window.fidDownloader!.readFile(resultPath);
    const sheets = parseModulesWorkbook(buffer);
    setLog((prev) => `${prev}共 ${sheets.length} 個模組,開始上傳到機台「${machineName}」...\n`);

    let successCount = 0;
    let failCount = 0;
    for (const { sheetName, parsed } of sheets) {
      try {
        await uploadBomEntry(supabase, sheetName, parsed, machineName);
        successCount++;
        setLog((prev) => `${prev}  ${sheetName}:完成(${parsed.items.length} 項)\n`);
      } catch (err) {
        failCount++;
        const message = err instanceof Error ? err.message : String(err);
        setLog((prev) => `${prev}  ${sheetName}:失敗 - ${message}\n`);
      }
    }

    if (successCount > 0) {
      try {
        const count = await autoMatchKeyParts(supabase, machineName);
        setLog((prev) => `${prev}已自動比對到 ${count} 筆重要零件。\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLog((prev) => `${prev}[錯誤] 自動比對重要零件失敗:${message}\n`);
      }
      onUploaded?.();
    }

    setLog((prev) => `${prev}上傳完成:成功 ${successCount} 個,失敗 ${failCount} 個。\n`);
    if (failCount > 0 && successCount === 0) {
      throw new Error("所有模組上傳都失敗");
    }
  }

  function cancelQueue() {
    if (!processing) return;
    cancelRequestedRef.current = true;
    window.fidDownloader?.cancel();
    setLog((prev) => `${prev}\n已送出取消要求,正在中止目前這一筆(剩下的佇列不會繼續處理)...\n`);
  }

  async function processQueue() {
    if (processing || queue.length === 0 || !window.fidDownloader) return;
    setProcessing(true);
    cancelRequestedRef.current = false;
    setLog((prev) => `${prev}\n開始處理佇列,共 ${queue.length} 台...\n`);

    for (let i = 0; i < queue.length; i++) {
      if (cancelRequestedRef.current) break;

      const item = queue[i];
      setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "running" } : q)));
      setLog((prev) => `${prev}\n=== [${i + 1}/${queue.length}] ${item.machineNo}(FID ${item.fid})===\n`);

      try {
        setLog((prev) => `${prev}--- 完整 BOM ---\n`);
        const toolResult = await window.fidDownloader.start({ fid: item.fid, mode: "tool" });
        if (cancelRequestedRef.current) {
          setLog((prev) => `${prev}已取消。\n`);
          setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "cancelled" } : q)));
          break;
        }
        setLog((prev) =>
          toolResult.ok && toolResult.resultPath
            ? `${prev}完整 BOM 完成:${toolResult.resultPath}\n`
            : `${prev}[錯誤] 完整 BOM 下載失敗,略過,繼續 Modules。\n`
        );

        setLog((prev) => `${prev}--- Modules ---\n`);
        const modulesResult = await window.fidDownloader.start({ fid: item.fid, mode: "modules" });
        if (cancelRequestedRef.current) {
          setLog((prev) => `${prev}已取消。\n`);
          setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "cancelled" } : q)));
          break;
        }
        if (!modulesResult.ok || !modulesResult.resultPath) {
          throw new Error("Modules 下載失敗,請檢查上面的訊息");
        }
        setLog((prev) => `${prev}Modules 完成:${modulesResult.resultPath}\n`);

        await uploadModulesToMachine(modulesResult.resultPath, item.machineNo);

        try {
          await saveMachineForFid(getSupabase(), item.fid, item.machineNo);
        } catch {
          // 記錄對照表失敗不影響這筆已經上傳成功的資料。
        }

        setQueue((prev) =>
          prev.map((q, idx) =>
            idx === i ? { ...q, status: "done", modulesResultPath: modulesResult.resultPath } : q
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLog((prev) => `${prev}[錯誤] ${item.machineNo}(FID ${item.fid})失敗:${message}\n`);
        setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "error", error: message } : q)));
      }
    }

    const wasCancelled = cancelRequestedRef.current;
    setLog((prev) => `${prev}\n${wasCancelled ? "已取消,處理停止。" : "全部處理完成。"}\n`);
    cancelRequestedRef.current = false;
    setProcessing(false);
  }

  if (!available) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>SAP 下載</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-end gap-2 overflow-x-auto">
          <div className="grid shrink-0 gap-1.5">
            <Label className="text-xs">機台編號</Label>
            <Input
              list="fid-downloader-existing-machines"
              value={machineNo}
              onChange={(e) => setMachineNo(e.target.value)}
              placeholder="例如 ACOXN1"
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
              placeholder="例如 264059"
              disabled={processing}
              className="w-32"
              onKeyDown={(e) => {
                if (e.key === "Enter") addToQueue();
              }}
            />
          </div>
          <Button className="shrink-0" onClick={addToQueue} disabled={processing || !machineNo.trim() || !fid.trim()}>
            <Plus className="h-4 w-4" />
            新增
          </Button>
          <Button className="shrink-0" variant="outline" onClick={downloadTemplate} disabled={processing}>
            <FileSpreadsheet className="h-4 w-4" />
            Excel 範本
          </Button>
          <Button
            className="shrink-0"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={processing}
          >
            <Upload className="h-4 w-4" />
            匯入 Excel
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
                {item.status === "running" && <span className="text-xs text-blue-600">處理中…</span>}
                {item.status === "done" && <span className="text-xs text-emerald-600">完成</span>}
                {item.status === "error" && (
                  <span className="text-destructive text-xs" title={item.error}>
                    失敗
                  </span>
                )}
                {item.status === "cancelled" && <span className="text-muted-foreground text-xs">已取消</span>}
                {item.status === "done" && item.modulesResultPath && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.fidDownloader?.openFolder(item.modulesResultPath!)}
                  >
                    開啟資料夾
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
            {processing ? "下載中…" : `下載(${queue.length} 台)`}
          </Button>
          {processing && (
            <Button variant="destructive" onClick={cancelQueue}>
              <Square className="h-4 w-4" />
              取消
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
