"use client";

import { useRef, useState } from "react";
import { UploadCloud, X as XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { parseCsvBom, parseTxtBom, parseXlsxBom, type ParsedBom } from "@/lib/bom-parse";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface FileEntry {
  file: File;
  status: "parsing" | "parsed" | "error" | "uploading" | "uploaded";
  parsed?: ParsedBom;
  error?: string;
}

export function UploadBomDialog({
  existingMachines,
  onUploaded,
}: {
  existingMachines: string[];
  onUploaded: () => void;
}) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }

  const [open, setOpen] = useState(false);
  const [machineName, setMachineName] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setMachineName("");
    setFiles([]);
    setSubmitError(null);
  }

  async function handleFiles(newFiles: File[]) {
    setFiles((prev) => {
      const byName = new Map(prev.map((e) => [e.file.name, e] as const));
      for (const file of newFiles) {
        byName.set(file.name, { file, status: "parsing" });
      }
      return Array.from(byName.values());
    });

    for (const file of newFiles) {
      try {
        const lowerName = file.name.toLowerCase();
        let result: ParsedBom;
        if (lowerName.endsWith(".txt")) {
          result = parseTxtBom(await file.text());
        } else if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
          result = parseXlsxBom(await file.arrayBuffer());
        } else if (lowerName.endsWith(".csv")) {
          result = parseCsvBom(await file.text());
        } else {
          throw new Error("僅支援 .txt、.xlsx/.xls 或 .csv 檔案");
        }
        setFiles((prev) =>
          prev.map((e) => (e.file === file ? { ...e, status: "parsed", parsed: result } : e))
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setFiles((prev) =>
          prev.map((e) => (e.file === file ? { ...e, status: "error", error: message } : e))
        );
      }
    }
  }

  function removeFile(file: File) {
    setFiles((prev) => prev.filter((e) => e.file !== file));
  }

  async function uploadOne(sourceFile: string, parsed: ParsedBom, trimmedMachineName: string) {
    const supabase = getSupabase();

    const { data: existing, error: findError } = await supabase
      .from("bom_machines")
      .select("id")
      .eq("machine_name", trimmedMachineName)
      .eq("source_file", sourceFile)
      .maybeSingle();

    if (findError) throw new Error(findError.message);

    let bomId: number;

    if (existing) {
      bomId = existing.id;
      const { error: updateError } = await supabase
        .from("bom_machines")
        .update({
          root_part_no: parsed.rootPartNo,
          root_description: parsed.rootDescription,
        })
        .eq("id", bomId);
      if (updateError) throw new Error(updateError.message);

      const { error: deleteError } = await supabase.from("bom_items").delete().eq("bom_id", bomId);
      if (deleteError) throw new Error(deleteError.message);
    } else {
      const { data: inserted, error: insertMachineError } = await supabase
        .from("bom_machines")
        .insert({
          machine_name: trimmedMachineName,
          source_file: sourceFile,
          root_part_no: parsed.rootPartNo,
          root_description: parsed.rootDescription,
        })
        .select("id")
        .single();
      if (insertMachineError) throw new Error(insertMachineError.message);
      bomId = inserted.id;
    }

    const rows = parsed.items.map((item) => ({ ...item, bom_id: bomId }));
    for (const batch of chunk(rows, 500)) {
      const { error: insertItemsError } = await supabase.from("bom_items").insert(batch);
      if (insertItemsError) throw new Error(insertItemsError.message);
    }
  }

  async function handleSubmit() {
    const trimmedMachineName = machineName.trim();
    const toUpload = files.filter((e) => e.parsed && e.status !== "uploaded");
    if (!trimmedMachineName || toUpload.length === 0) return;

    setSubmitting(true);
    setSubmitError(null);

    let failureCount = 0;

    for (const entry of toUpload) {
      setFiles((prev) =>
        prev.map((e) => (e.file === entry.file ? { ...e, status: "uploading" } : e))
      );
      try {
        await uploadOne(entry.file.name, entry.parsed!, trimmedMachineName);
        setFiles((prev) =>
          prev.map((e) => (e.file === entry.file ? { ...e, status: "uploaded" } : e))
        );
      } catch (err) {
        failureCount++;
        const message = err instanceof Error ? err.message : String(err);
        setFiles((prev) =>
          prev.map((e) => (e.file === entry.file ? { ...e, status: "error", error: message } : e))
        );
      }
    }

    setSubmitting(false);
    onUploaded();

    if (failureCount === 0) {
      setOpen(false);
      resetForm();
    } else {
      setSubmitError(`${failureCount} 個檔案上傳失敗,請檢查後重試(成功的部分不會重傳)。`);
    }
  }

  const uploadableCount = files.filter((e) => e.parsed && e.status !== "uploaded").length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button>上傳 BOM</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>上傳 BOM</DialogTitle>
          <DialogDescription>
            支援 .txt(樹狀縮排報表)、.xlsx/.xls 或 .csv(原始 SAP 匯出)檔案,可一次選取多個檔案。同機台 + 同檔名會覆蓋舊資料。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="machine-name">機台名稱</Label>
            <Input
              id="machine-name"
              list="existing-machines"
              value={machineName}
              onChange={(e) => setMachineName(e.target.value)}
              placeholder="選擇現有機台或輸入新機台名稱"
              disabled={submitting}
            />
            <datalist id="existing-machines">
              {existingMachines.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!submitting) setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              if (submitting) return;
              const dropped = Array.from(e.dataTransfer.files ?? []);
              if (dropped.length > 0) handleFiles(dropped);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors",
              isDragOver ? "border-primary bg-primary/10" : "border-border",
              submitting && "pointer-events-none opacity-50"
            )}
          >
            <UploadCloud className="text-muted-foreground h-8 w-8" />
            <p className="text-sm font-medium">拖曳檔案到這裡</p>
            <p className="text-muted-foreground text-xs">
              或點擊選擇檔案,可一次選取多個(.txt / .xlsx / .xls / .csv)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.xlsx,.xls,.csv"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                if (picked.length > 0) handleFiles(picked);
                e.target.value = "";
              }}
              disabled={submitting}
              className="hidden"
            />
          </div>

          {files.length > 0 && (
            <div className="grid gap-2">
              {files.map((entry) => (
                <div key={entry.file.name} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{entry.file.name}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      {entry.status === "parsing" && (
                        <span className="text-muted-foreground text-xs">解析中…</span>
                      )}
                      {entry.status === "parsed" && (
                        <Badge variant="secondary">明細 {entry.parsed!.items.length} 項</Badge>
                      )}
                      {entry.status === "uploading" && (
                        <span className="text-muted-foreground text-xs">上傳中…</span>
                      )}
                      {entry.status === "uploaded" && (
                        <span className="text-xs text-emerald-600">已上傳</span>
                      )}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        disabled={submitting}
                        onClick={() => removeFile(entry.file)}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {entry.status === "parsed" && (
                    <p className="text-muted-foreground mt-1 truncate text-xs">
                      {entry.parsed!.rootPartNo} — {entry.parsed!.rootDescription}
                    </p>
                  )}
                  {entry.status === "error" && (
                    <p className="text-destructive mt-1 text-xs">{entry.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {submitError && <p className="text-destructive text-sm">{submitError}</p>}
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!machineName.trim() || uploadableCount === 0 || submitting}
          >
            {submitting
              ? "上傳中…"
              : uploadableCount > 1
                ? `確認上傳(${uploadableCount} 個檔案)`
                : "確認上傳"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
