"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, Check, X as XIcon, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { BomEntry, MachineGroup } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EditMachinesDialog({
  machineGroups,
  onChanged,
}: {
  machineGroups: MachineGroup[];
  onChanged: () => void;
}) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }

  const [open, setOpen] = useState(false);
  const [localGroups, setLocalGroups] = useState<MachineGroup[]>(machineGroups);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setLocalGroups(machineGroups);
      setDeleteError(null);
    }
  }

  async function renameMachine(oldName: string, newName: string) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("bom_machines")
      .update({ machine_name: newName })
      .eq("machine_name", oldName);

    if (error) throw new Error(error.message);

    setLocalGroups((prev) =>
      prev.map((g) =>
        g.machine === oldName
          ? {
              machine: newName,
              subparts: g.subparts.map((s) => ({ ...s, machine: newName })),
            }
          : g
      )
    );
    onChanged();
  }

  async function renameSourceFile(bomId: number, newSourceFile: string) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("bom_machines")
      .update({ source_file: newSourceFile })
      .eq("id", bomId);

    if (error) throw new Error(error.message);

    setLocalGroups((prev) =>
      prev.map((g) => ({
        ...g,
        subparts: g.subparts.map((s) =>
          s.bomId === bomId ? { ...s, source_file: newSourceFile } : s
        ),
      }))
    );
    onChanged();
  }

  async function deleteMachine(group: MachineGroup) {
    if (
      !window.confirm(
        `確定要刪除機台「${group.machine}」嗎?這會一併刪除底下 ${group.subparts.length} 個子項與所有明細資料,無法復原。`
      )
    ) {
      return;
    }

    setDeleteError(null);
    setDeletingKey(`machine:${group.machine}`);
    try {
      const supabase = getSupabase();
      const bomIds = group.subparts.map((s) => s.bomId);

      if (bomIds.length > 0) {
        const { error: itemsError } = await supabase.from("bom_items").delete().in("bom_id", bomIds);
        if (itemsError) throw new Error(itemsError.message);
      }

      const { error: machinesError } = await supabase
        .from("bom_machines")
        .delete()
        .eq("machine_name", group.machine);
      if (machinesError) throw new Error(machinesError.message);

      setLocalGroups((prev) => prev.filter((g) => g.machine !== group.machine));
      onChanged();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingKey(null);
    }
  }

  async function deleteSubpart(machineName: string, entry: BomEntry) {
    if (
      !window.confirm(
        `確定要刪除子項「${entry.source_file}」嗎?這會刪除該子項所有明細資料,無法復原。`
      )
    ) {
      return;
    }

    setDeleteError(null);
    setDeletingKey(`subpart:${entry.bomId}`);
    try {
      const supabase = getSupabase();
      const { error: itemsError } = await supabase
        .from("bom_items")
        .delete()
        .eq("bom_id", entry.bomId);
      if (itemsError) throw new Error(itemsError.message);

      const { error: machineError } = await supabase
        .from("bom_machines")
        .delete()
        .eq("id", entry.bomId);
      if (machineError) throw new Error(machineError.message);

      setLocalGroups((prev) =>
        prev
          .map((g) =>
            g.machine === machineName
              ? { ...g, subparts: g.subparts.filter((s) => s.bomId !== entry.bomId) }
              : g
          )
          .filter((g) => g.subparts.length > 0)
      );
      onChanged();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="編輯機台名稱">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>編輯機台 / 子項名稱</DialogTitle>
          <DialogDescription>改完按 Enter 或點確認就會立即更新到 Supabase。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {deleteError && <p className="text-destructive text-sm">刪除失敗:{deleteError}</p>}

          {localGroups.map((group) => (
            <div key={group.machine} className="rounded-md border p-3">
              <Label className="mb-1.5">機台名稱</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <EditableField
                    value={group.machine}
                    onSave={(newValue) => renameMachine(group.machine, newValue)}
                  />
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="刪除機台"
                  disabled={deletingKey === `machine:${group.machine}`}
                  onClick={() => deleteMachine(group)}
                >
                  <Trash2 className="text-destructive h-4 w-4" />
                </Button>
              </div>

              <Label className="mt-4 mb-1.5 block">子項(檔名)</Label>
              <div className="grid gap-2 pl-2">
                {group.subparts.map((entry) => (
                  <div key={entry.bomId} className="flex items-center gap-2">
                    <div className="flex-1">
                      <EditableField
                        value={entry.source_file}
                        onSave={(newValue) => renameSourceFile(entry.bomId, newValue)}
                      />
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="刪除子項"
                      disabled={deletingKey === `subpart:${entry.bomId}`}
                      onClick={() => deleteSubpart(group.machine, entry)}
                    >
                      <Trash2 className="text-destructive h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {localGroups.length === 0 && (
            <p className="text-muted-foreground text-sm">尚無機台資料</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditableField({
  value,
  onSave,
}: {
  value: string;
  onSave: (newValue: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const isDirty = draft.trim() !== value && draft.trim().length > 0;

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(trimmed);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          disabled={saving}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(value);
          }}
        />
        {isDirty && (
          <Button size="icon-sm" variant="outline" disabled={saving} onClick={commit}>
            <Check className="h-4 w-4" />
          </Button>
        )}
        {isDirty && (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={saving}
            onClick={() => setDraft(value)}
          >
            <XIcon className="h-4 w-4" />
          </Button>
        )}
        {saved && <span className="text-xs text-emerald-600">已儲存</span>}
      </div>
      {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
    </div>
  );
}
