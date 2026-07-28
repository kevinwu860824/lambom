"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Plus, X as XIcon } from "lucide-react";
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
}

declare global {
  interface Window {
    fidDownloader?: FidDownloaderApi;
  }
}

type QueueStatus = "queued" | "running" | "done" | "error";

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

  async function processQueue() {
    if (processing || queue.length === 0 || !window.fidDownloader) return;
    setProcessing(true);
    setLog((prev) => `${prev}\n開始處理佇列,共 ${queue.length} 台...\n`);

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "running" } : q)));
      setLog((prev) => `${prev}\n=== [${i + 1}/${queue.length}] ${item.machineNo}(FID ${item.fid})===\n`);

      try {
        setLog((prev) => `${prev}--- 完整 BOM ---\n`);
        const toolResult = await window.fidDownloader.start({ fid: item.fid, mode: "tool" });
        setLog((prev) =>
          toolResult.ok && toolResult.resultPath
            ? `${prev}完整 BOM 完成:${toolResult.resultPath}\n`
            : `${prev}[錯誤] 完整 BOM 下載失敗,略過,繼續 Modules。\n`
        );

        setLog((prev) => `${prev}--- Modules ---\n`);
        const modulesResult = await window.fidDownloader.start({ fid: item.fid, mode: "modules" });
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

    setLog((prev) => `${prev}\n全部處理完成。\n`);
    setProcessing(false);
  }

  if (!available) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>SAP 下載</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">機台編號</Label>
            <Input
              list="fid-downloader-existing-machines"
              value={machineNo}
              onChange={(e) => setMachineNo(e.target.value)}
              placeholder="例如 ACOXN1"
              disabled={processing}
              className="w-40"
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
          <div className="grid gap-1.5">
            <Label className="text-xs">FID</Label>
            <Input
              value={fid}
              onChange={(e) => setFid(e.target.value)}
              onBlur={handleFidBlur}
              placeholder="例如 264059"
              disabled={processing}
              className="w-40"
              onKeyDown={(e) => {
                if (e.key === "Enter") addToQueue();
              }}
            />
          </div>
          <Button onClick={addToQueue} disabled={processing || !machineNo.trim() || !fid.trim()}>
            <Plus className="h-4 w-4" />
            新增
          </Button>
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

        <Button onClick={processQueue} disabled={processing || queue.length === 0} className="mb-3">
          <Download className="h-4 w-4" />
          {processing ? "下載中…" : `下載(${queue.length} 台)`}
        </Button>

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
