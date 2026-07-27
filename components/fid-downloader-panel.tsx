"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { parseModulesWorkbook } from "@/lib/bom-parse";
import { autoMatchKeyParts, lookupMachineForFid, saveMachineForFid, uploadBomEntry } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type FidDownloadMode = "tool" | "modules";

const MODE_LABELS: Record<FidDownloadMode, string> = {
  tool: "完整 BOM",
  modules: "Modules",
};

interface FidDownloaderApi {
  start: (params: {
    fid?: string;
    mode: FidDownloadMode;
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

interface ModeResult {
  mode: FidDownloadMode;
  ok: boolean;
  resultPath: string | null;
}

interface PendingUpload {
  resultPath: string;
  fid: string;
}

/**
 * Only does anything inside the lambom 桌面版(Electron) shell, which exposes
 * window.fidDownloader via a preload script — on the public web deployment
 * (same code, opened in a regular browser) that API doesn't exist, so this
 * renders nothing.
 *
 * 完整 BOM(IB53)用 FID 查詢;Modules(ZOOBOM_CE_FMT)用 SO 查詢 —— 兩者是
 * 不同的 SAP 識別碼。SO 留空的話,Modules 那步會自動用 FID 反查對應的 SO
 * (透過 VA03),所以正常只要填 FID 就好;SO 欄位是給你想手動指定特定版本
 * 時用的(同一個 FID 如果 BOM 改版過,自動反查不保證抓到你要的那個版本)。
 *
 * Modules 下載完成後會自動上傳到 Supabase(完整 BOM 不會,只當輔助參考,
 * 一樣要去「上傳 BOM」手動匯入)。上傳前用 fid_machine_map 表把 FID 對應到
 * 機台名稱;查不到就跳出欄位請你輸入一次,輸入後會記住這個對應,下次同一個
 * FID 就不用再問了。
 */
export function FidDownloaderPanel({
  existingMachines = [],
  onUploaded,
}: {
  existingMachines?: string[];
  onUploaded?: () => void;
}) {
  const [available, setAvailable] = useState(false);
  const [fid, setFid] = useState("");
  const [so, setSo] = useState("");
  const [log, setLog] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<ModeResult[]>([]);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [machineNameInput, setMachineNameInput] = useState("");
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

  async function startDownload() {
    const trimmedFid = fid.trim();
    const trimmedSo = so.trim();
    if ((!trimmedFid && !trimmedSo) || !window.fidDownloader) return;

    setDownloading(true);
    setResults([]);
    setLog("開始下載...\n");

    const newResults: ModeResult[] = [];

    if (trimmedFid) {
      setLog((prev) => `${prev}\n--- 完整 BOM(FID ${trimmedFid})---\n`);
      const { ok, resultPath } = await window.fidDownloader.start({
        fid: trimmedFid,
        mode: "tool",
      });
      newResults.push({ mode: "tool", ok, resultPath });
      setResults([...newResults]);
      setLog((prev) =>
        ok && resultPath
          ? `${prev}完整 BOM 完成:${resultPath}\n`
          : `${prev}[錯誤] 完整 BOM 下載失敗,請檢查上面的訊息。\n`
      );
    } else {
      setLog((prev) => `${prev}\n(沒有輸入 FID,跳過完整 BOM)\n`);
    }

    if (trimmedFid || trimmedSo) {
      const label = trimmedSo ? `SO ${trimmedSo}` : `FID ${trimmedFid} 反查 SO`;
      setLog((prev) => `${prev}\n--- Modules(${label})---\n`);
      const { ok, resultPath } = await window.fidDownloader.start({
        mode: "modules",
        fid: trimmedFid || undefined,
        so: trimmedSo || undefined,
      });
      newResults.push({ mode: "modules", ok, resultPath });
      setResults([...newResults]);
      setLog((prev) =>
        ok && resultPath
          ? `${prev}Modules 完成:${resultPath}\n`
          : `${prev}[錯誤] Modules 下載失敗,請檢查上面的訊息。\n`
      );
      if (ok && resultPath) {
        await startModulesUpload(resultPath, trimmedFid);
      }
    } else {
      setLog((prev) => `${prev}\n(沒有輸入 FID 或 SO,跳過 Modules)\n`);
    }

    setDownloading(false);
  }

  async function startModulesUpload(resultPath: string, fidForLookup: string) {
    setLog((prev) => `${prev}\n--- 自動上傳到 Supabase ---\n`);

    let machineName: string | null = null;
    if (fidForLookup) {
      try {
        machineName = await lookupMachineForFid(getSupabase(), fidForLookup);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLog((prev) => `${prev}[錯誤] 查詢 FID 對應機台失敗:${message}\n`);
        return;
      }
    }

    if (machineName) {
      setLog((prev) => `${prev}FID ${fidForLookup} 對應機台:${machineName}\n`);
      await uploadModulesToMachine(resultPath, machineName);
    } else {
      setLog(
        (prev) =>
          `${prev}${fidForLookup ? `FID ${fidForLookup} 還沒有對應的機台` : "沒有輸入 FID,無法自動對應機台"},請在下面輸入機台名稱後確認上傳。\n`
      );
      setPendingUpload({ resultPath, fid: fidForLookup });
    }
  }

  async function uploadModulesToMachine(resultPath: string, machineName: string) {
    if (!window.fidDownloader) return;
    const supabase = getSupabase();
    setUploading(true);
    try {
      setLog((prev) => `${prev}讀取檔案...\n`);
      const buffer = await window.fidDownloader.readFile(resultPath);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[錯誤] 上傳失敗:${message}\n`);
    } finally {
      setUploading(false);
    }
  }

  async function confirmPendingUpload() {
    if (!pendingUpload) return;
    const trimmedName = machineNameInput.trim();
    if (!trimmedName) return;

    if (pendingUpload.fid) {
      try {
        await saveMachineForFid(getSupabase(), pendingUpload.fid, trimmedName);
        setLog((prev) => `${prev}已記住 FID ${pendingUpload.fid} → ${trimmedName},下次會自動使用。\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLog((prev) => `${prev}[錯誤] 儲存 FID 對應失敗:${message}\n`);
      }
    }

    const { resultPath } = pendingUpload;
    setPendingUpload(null);
    setMachineNameInput("");
    await uploadModulesToMachine(resultPath, trimmedName);
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
            <Label className="text-xs">FID(完整 BOM)</Label>
            <Input
              value={fid}
              onChange={(e) => setFid(e.target.value)}
              placeholder="例如 264059"
              disabled={downloading || uploading}
              className="w-40"
              onKeyDown={(e) => {
                if (e.key === "Enter") startDownload();
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">SO(選填,留空會用 FID 反查)</Label>
            <Input
              value={so}
              onChange={(e) => setSo(e.target.value)}
              placeholder="例如 R0542"
              disabled={downloading || uploading}
              className="w-40"
              onKeyDown={(e) => {
                if (e.key === "Enter") startDownload();
              }}
            />
          </div>
          <Button
            onClick={startDownload}
            disabled={downloading || uploading || (!fid.trim() && !so.trim())}
          >
            <Download className="h-4 w-4" />
            {downloading ? "下載中…" : "下載"}
          </Button>
        </div>

        <div
          ref={logRef}
          className="h-48 overflow-y-auto rounded-md bg-neutral-900 p-2 font-mono text-xs whitespace-pre-wrap text-neutral-200"
        >
          {log}
        </div>

        {pendingUpload && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-amber-400/50 bg-amber-50 p-3 dark:bg-amber-950/30">
            <div className="grid gap-1.5">
              <Label className="text-xs">
                {pendingUpload.fid ? `這個 FID(${pendingUpload.fid})對應哪台機台?` : "這批 Modules 要上傳到哪台機台?"}
              </Label>
              <Input
                list="fid-downloader-existing-machines"
                value={machineNameInput}
                onChange={(e) => setMachineNameInput(e.target.value)}
                placeholder="選擇現有機台或輸入新機台名稱"
                disabled={uploading}
                className="w-56"
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmPendingUpload();
                }}
              />
              <datalist id="fid-downloader-existing-machines">
                {existingMachines.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <Button onClick={confirmPendingUpload} disabled={uploading || !machineNameInput.trim()}>
              {uploading ? "上傳中…" : "確認上傳"}
            </Button>
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-3 grid gap-2 text-sm">
            {results.map((r) => (
              <div key={r.mode} className="flex items-center gap-2">
                <span className={r.ok ? "" : "text-destructive"}>
                  {MODE_LABELS[r.mode]}:{r.ok && r.resultPath ? r.resultPath : "失敗"}
                </span>
                {r.ok && r.resultPath && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.fidDownloader?.openFolder(r.resultPath!)}
                  >
                    開啟所在資料夾
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
