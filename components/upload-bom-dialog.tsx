"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { parseExcelBom, parseTxtBom, type ParsedBom } from "@/lib/bom-parse";
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBom | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setMachineName("");
    setSelectedFile(null);
    setParsed(null);
    setParseError(null);
    setSubmitError(null);
  }

  async function handleFile(file: File) {
    setSelectedFile(file);
    setParsed(null);
    setParseError(null);
    setParsing(true);

    try {
      const lowerName = file.name.toLowerCase();
      let result: ParsedBom;
      if (lowerName.endsWith(".txt")) {
        result = parseTxtBom(await file.text());
      } else if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        result = parseExcelBom(await file.arrayBuffer());
      } else {
        throw new Error("僅支援 .txt 或 .xlsx/.xls 檔案");
      }
      setParsed(result);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit() {
    if (!selectedFile || !parsed || !machineName.trim()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const supabase = getSupabase();
      const sourceFile = selectedFile.name;
      const trimmedMachineName = machineName.trim();

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

        const { error: deleteError } = await supabase
          .from("bom_items")
          .delete()
          .eq("bom_id", bomId);
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

      setOpen(false);
      resetForm();
      onUploaded();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

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
            支援 .txt(樹狀縮排報表)或 .xlsx/.xls 檔案。同機台 + 同檔名會覆蓋舊資料。
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
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors",
              isDragOver ? "border-primary bg-primary/10" : "border-border",
              submitting && "pointer-events-none opacity-50"
            )}
          >
            <UploadCloud className="text-muted-foreground h-8 w-8" />
            {selectedFile ? (
              <p className="text-sm font-medium">{selectedFile.name}</p>
            ) : (
              <>
                <p className="text-sm font-medium">拖曳檔案到這裡</p>
                <p className="text-muted-foreground text-xs">或點擊選擇檔案(.txt / .xlsx / .xls)</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.xlsx,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              disabled={submitting}
              className="hidden"
            />
          </div>

          {parsing && <p className="text-muted-foreground text-sm">解析中…</p>}

          {parseError && (
            <p className="text-destructive text-sm">解析失敗:{parseError}</p>
          )}

          {parsed && (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">
                {parsed.rootPartNo}
                <span className="text-muted-foreground font-normal"> — {parsed.rootDescription}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="secondary">明細 {parsed.items.length} 項</Badge>
              </div>
            </div>
          )}

          {submitError && (
            <p className="text-destructive text-sm">上傳失敗:{submitError}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!parsed || !machineName.trim() || submitting || parsing}
          >
            {submitting ? "上傳中…" : "確認上傳"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
