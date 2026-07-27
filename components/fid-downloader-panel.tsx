"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
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
 */
export function FidDownloaderPanel() {
  const [available, setAvailable] = useState(false);
  const [fid, setFid] = useState("");
  const [so, setSo] = useState("");
  const [log, setLog] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [results, setResults] = useState<ModeResult[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

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
    } else {
      setLog((prev) => `${prev}\n(沒有輸入 FID 或 SO,跳過 Modules)\n`);
    }

    setDownloading(false);
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
              disabled={downloading}
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
              disabled={downloading}
              className="w-40"
              onKeyDown={(e) => {
                if (e.key === "Enter") startDownload();
              }}
            />
          </div>
          <Button
            onClick={startDownload}
            disabled={downloading || (!fid.trim() && !so.trim())}
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
