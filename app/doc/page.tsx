"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { UploadCloud } from "lucide-react";

const BUCKET = "doc";

function uploadFileWithProgress(
  bucket: string,
  path: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const url = `${supabaseUrl}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("Authorization", `Bearer ${anonKey}`);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = `上傳失敗 (HTTP ${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        message = body.message || body.error || message;
      } catch {
        // ignore parse errors, fall back to the generic message
      }
      reject(new Error(message));
    };

    xhr.onerror = () => reject(new Error("網路錯誤,上傳失敗"));

    xhr.send(file);
  });
}

interface StoredFile {
  name: string;
  url: string;
  size: number | null;
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocPage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }

  const [currentFile, setCurrentFile] = useState<StoredFile | null>(null);
  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refreshCurrentFile() {
    const { data, error } = await getSupabase()
      .storage.from(BUCKET)
      .list("", { limit: 100, sortBy: { column: "updated_at", order: "desc" } });

    if (error) throw new Error(error.message);

    const entry = data?.find((item) => item.id !== null) ?? null;
    if (!entry) {
      setCurrentFile(null);
      return;
    }

    const { data: urlData } = getSupabase().storage.from(BUCKET).getPublicUrl(entry.name);
    setCurrentFile({
      name: entry.name,
      url: urlData.publicUrl,
      size: entry.metadata?.size ?? null,
    });
  }

  useEffect(() => {
    let cancelled = false;

    refreshCurrentFile()
      .catch((err) => {
        if (cancelled) return;
        setInitError(`載入失敗:${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setInitLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReplace() {
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    setUploadSuccess(false);

    try {
      const { data: existing, error: listError } = await getSupabase()
        .storage.from(BUCKET)
        .list("", { limit: 100 });

      if (listError) throw new Error(listError.message);

      const oldNames = (existing ?? []).map((item) => item.name).filter(Boolean);
      if (oldNames.length > 0) {
        const { error: removeError } = await getSupabase().storage.from(BUCKET).remove(oldNames);
        if (removeError) throw new Error(removeError.message);
      }

      await uploadFileWithProgress(BUCKET, selectedFile.name, selectedFile, setUploadProgress);

      await refreshCurrentFile();
      setUploadSuccess(true);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">檔案取代</h1>
          <p className="mt-1 text-sm text-white/70">
            左邊是目前儲存的檔案,可點擊下載;右邊選擇新檔案上傳後會取代舊檔案。
          </p>
        </div>

        {initError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">{initError}</CardContent>
          </Card>
        )}

        {uploadError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">上傳失敗:{uploadError}</CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>目前檔案</CardTitle>
            </CardHeader>
            <CardContent>
              {initLoading ? (
                <p className="text-muted-foreground text-sm">載入中…</p>
              ) : currentFile ? (
                <div className="flex flex-col gap-2">
                  <a
                    href={currentFile.url}
                    download={currentFile.name}
                    className="text-primary text-sm font-medium underline underline-offset-4"
                  >
                    {currentFile.name}
                  </a>
                  {currentFile.size !== null && (
                    <p className="text-muted-foreground text-xs">{formatBytes(currentFile.size)}</p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm italic">尚無檔案</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>上傳新檔案</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!initLoading && !uploading) setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    if (initLoading || uploading) return;
                    const file = e.dataTransfer.files?.[0];
                    if (file) setSelectedFile(file);
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-10 text-center transition-colors",
                    isDragOver ? "border-primary bg-primary/10" : "border-border",
                    (initLoading || uploading) && "pointer-events-none opacity-50"
                  )}
                >
                  <UploadCloud className="text-muted-foreground h-8 w-8" />
                  {selectedFile ? (
                    <p className="text-sm font-medium">{selectedFile.name}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium">拖曳檔案到這裡</p>
                      <p className="text-muted-foreground text-xs">或點擊選擇檔案</p>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf,.doc,.docx"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                    disabled={initLoading || uploading}
                    className="hidden"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={handleReplace} disabled={!selectedFile || uploading}>
                    {uploading ? "上傳中…" : "取代"}
                  </Button>
                  {uploadSuccess && <span className="text-sm text-emerald-600">已更新</span>}
                </div>
                {uploading && (
                  <div className="flex items-center gap-3">
                    <Progress value={uploadProgress} className="flex-1" />
                    <span className="text-muted-foreground w-10 text-right text-xs">
                      {uploadProgress}%
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
