"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface FidDownloaderApi {
  start: (fid: string) => Promise<{ ok: boolean; resultPath: string | null }>;
  onLog: (callback: (line: string) => void) => () => void;
  openFolder: (filePath: string) => Promise<void>;
}

declare global {
  interface Window {
    fidDownloader?: FidDownloaderApi;
  }
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
  const [resultPath, setResultPath] = useState<string | null>(null);
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
    setResultPath(null);
    setLog(`開始下載 FID ${trimmed} ...\n`);

    const { ok, resultPath: path } = await window.fidDownloader.start(trimmed);

    if (ok && path) {
      setLog((prev) => `${prev}完成!檔案位置:${path}\n`);
      setResultPath(path);
    } else {
      setLog((prev) => `${prev}[錯誤] 下載失敗,請檢查上面的訊息。\n`);
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
            {downloading ? "下載中…" : "下載"}
          </Button>
        </div>

        <div
          ref={logRef}
          className="h-48 overflow-y-auto rounded-md bg-neutral-900 p-2 font-mono text-xs whitespace-pre-wrap text-neutral-200"
        >
          {log}
        </div>

        {resultPath && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span>完成:{resultPath}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.fidDownloader?.openFolder(resultPath)}
            >
              開啟所在資料夾
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
