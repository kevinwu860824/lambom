"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type FidDownloadMode = "tool" | "modules";

const MODE_LABELS: Record<FidDownloadMode, string> = {
  tool: "完整 BOM",
  modules: "Modules",
};

// 目前一次下載會依序跑這兩種模式(SAP GUI 是同一個 session,不能同時跑兩個
// 自動化流程,所以是「依序」而不是「同時」)。modules 目前尚未實作,會回報
// 清楚的錯誤,不影響 tool 那筆已經下載成功的結果。
const MODES: FidDownloadMode[] = ["tool", "modules"];

interface FidDownloaderApi {
  start: (
    fid: string,
    mode: FidDownloadMode
  ) => Promise<{ ok: boolean; resultPath: string | null }>;
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
 */
export function FidDownloaderPanel() {
  const [available, setAvailable] = useState(false);
  const [fid, setFid] = useState("");
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
    const trimmed = fid.trim();
    if (!trimmed || !window.fidDownloader) return;

    setDownloading(true);
    setResults([]);
    setLog(`開始下載 FID ${trimmed} ...\n`);

    const newResults: ModeResult[] = [];
    for (const mode of MODES) {
      setLog((prev) => `${prev}\n--- ${MODE_LABELS[mode]} ---\n`);
      const { ok, resultPath } = await window.fidDownloader.start(trimmed, mode);
      newResults.push({ mode, ok, resultPath });
      setResults([...newResults]);
      setLog((prev) =>
        ok && resultPath
          ? `${prev}${MODE_LABELS[mode]} 完成:${resultPath}\n`
          : `${prev}[錯誤] ${MODE_LABELS[mode]} 下載失敗,請檢查上面的訊息。\n`
      );
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
        <div className="mb-3 flex gap-2">
          <Input
            value={fid}
            onChange={(e) => setFid(e.target.value)}
            placeholder="輸入 FID,例如 264059"
            disabled={downloading}
            onKeyDown={(e) => {
              if (e.key === "Enter") startDownload();
            }}
          />
          <Button onClick={startDownload} disabled={downloading || !fid.trim()}>
            <Download className="h-4 w-4" />
            {downloading ? "下載中…" : "下載(完整 BOM + Modules)"}
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
