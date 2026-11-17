"use client";

import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { upsertCustomName } from "@/lib/bom";
import { useTranslate } from "@/lib/i18n";
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

const zh: Record<string, string> = {
  "Custom name": "自訂名稱",
  "Edit custom name": "編輯自訂名稱",
  "Give this part a name your group will recognize — searchable anywhere this part number is searched.":
    "幫這個料號取一個你們群組看得懂的名字——之後搜尋料號時打這個名字也找得到。",
  "e.g. Main Power Switch": "例如:主電源開關",
  "Saving…": "儲存中…",
  Save: "儲存",
  Cancel: "取消",
};

/**
 * Small pencil-icon button + dialog shared by every place a part number is
 * already resolved and shown to the user (BOM Structure Viewer, LamBOM's
 * Only-in-A/B tables, Inventory's found-in-Full-BOM banner) — writes to
 * part_custom_names, scoped to the current group, so a nickname set from
 * any one of those pages is immediately searchable from the others too.
 */
export function CustomNameButton({
  groupId,
  partNo,
  currentName,
  onSaved,
}: {
  groupId: number;
  partNo: string;
  currentName?: string | null;
  onSaved?: (customName: string) => void;
}) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const t = useTranslate(zh);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await upsertCustomName(getSupabase(), groupId, partNo, trimmed);
      setOpen(false);
      onSaved?.(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(currentName ?? "");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center"
          aria-label={t("Edit custom name")}
          onClick={(e) => e.stopPropagation()}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t("Edit custom name")}</DialogTitle>
          <DialogDescription>
            {t("Give this part a name your group will recognize — searchable anywhere this part number is searched.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="rounded-md border p-2 font-mono text-sm">{partNo}</div>
          <div className="grid gap-1.5">
            <Label htmlFor={`custom-name-${partNo}`}>{t("Custom name")}</Label>
            <Input
              id={`custom-name-${partNo}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("e.g. Main Power Switch")}
              disabled={saving}
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? t("Saving…") : t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
