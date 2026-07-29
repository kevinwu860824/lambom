"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
import { fetchMachineGroups, type BomEntry, type MachineGroup } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EditableField } from "@/components/editable-field";
import { FidDownloaderPanel } from "@/components/fid-downloader-panel";

export default function MachinesPage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const [groups, setGroups] = useState<MachineGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());

  function toggleExpanded(machine: string) {
    setExpandedMachines((prev) => {
      const next = new Set(prev);
      if (next.has(machine)) next.delete(machine);
      else next.add(machine);
      return next;
    });
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const { machineGroups } = await fetchMachineGroups(getSupabase());
      setGroups(machineGroups);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function renameMachine(oldName: string, newName: string) {
    const supabase = getSupabase();
    const { error: renameError } = await supabase
      .from("bom_machines")
      .update({ machine_name: newName })
      .eq("machine_name", oldName);
    if (renameError) throw new Error(renameError.message);

    setGroups((prev) =>
      prev.map((g) =>
        g.machine === oldName
          ? { machine: newName, subparts: g.subparts.map((s) => ({ ...s, machine: newName })) }
          : g
      )
    );
  }

  async function renameSourceFile(bomId: number, newSourceFile: string) {
    const supabase = getSupabase();
    const { error: renameError } = await supabase
      .from("bom_machines")
      .update({ source_file: newSourceFile })
      .eq("id", bomId);
    if (renameError) throw new Error(renameError.message);

    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        subparts: g.subparts.map((s) => (s.bomId === bomId ? { ...s, source_file: newSourceFile } : s)),
      }))
    );
  }

  async function deleteMachine(group: MachineGroup) {
    if (
      !window.confirm(
        `Delete machine "${group.machine}"? This will also delete its ${group.subparts.length} subpart(s) and all detail data — this cannot be undone.`
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

      setGroups((prev) => prev.filter((g) => g.machine !== group.machine));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingKey(null);
    }
  }

  async function deleteSubpart(machineName: string, entry: BomEntry) {
    if (
      !window.confirm(
        `Delete subpart "${entry.source_file}"? This will delete all its detail data — this cannot be undone.`
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

      setGroups((prev) =>
        prev
          .map((g) =>
            g.machine === machineName
              ? { ...g, subparts: g.subparts.filter((s) => s.bomId !== entry.bomId) }
              : g
          )
          .filter((g) => g.subparts.length > 0)
      );
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Edit Machine / Subpart Names</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Press Enter or click confirm after editing to save immediately.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="outline"
              aria-label={editMode ? "Done editing" : "Edit machines/subparts"}
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? <Check className="h-4 w-4 text-emerald-600" /> : <Pencil className="h-4 w-4" />}
            </Button>
            <Link href="/" className="text-sm underline underline-offset-4">
              Back to Comparison Tool
            </Link>
          </div>
        </div>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        <FidDownloaderPanel existingMachines={groups.map((g) => g.machine)} onUploaded={loadData} />

        <Card>
          <CardContent className="grid gap-4">
            {deleteError && <p className="text-destructive text-sm">Delete failed: {deleteError}</p>}

            {loading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : groups.length === 0 ? (
              <p className="text-muted-foreground text-sm">No machine data yet</p>
            ) : (
              groups.map((group) => {
                const expanded = expandedMachines.has(group.machine);
                return (
                <div key={group.machine} className="rounded-md border">
                  <button
                    type="button"
                    className="hover:bg-accent flex w-full items-center gap-2 p-3 text-left"
                    onClick={() => toggleExpanded(group.machine)}
                  >
                    <ChevronDown
                      className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-180")}
                    />
                    <span className="flex-1 text-sm font-medium">{group.machine}</span>
                    <span className="text-muted-foreground text-xs">
                      {group.subparts.length} subpart(s)
                    </span>
                  </button>

                  {expanded && (
                    <div className="border-t p-3">
                      <Label className="mb-1.5">Machine Name</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          {editMode ? (
                            <EditableField
                              value={group.machine}
                              onSave={(newValue) => renameMachine(group.machine, newValue)}
                            />
                          ) : (
                            <p className="px-1.5 py-1 text-sm font-medium">{group.machine}</p>
                          )}
                        </div>
                        {editMode && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Delete machine"
                            disabled={deletingKey === `machine:${group.machine}`}
                            onClick={() => deleteMachine(group)}
                          >
                            <Trash2 className="text-destructive h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      <Label className="mt-4 mb-1.5 block">Subparts</Label>
                      <div className="grid gap-2 pl-2">
                        {group.subparts.map((entry) => (
                          <div key={entry.bomId} className="flex items-center gap-2">
                            <div className="flex-1">
                              {editMode ? (
                                <EditableField
                                  value={entry.source_file}
                                  onSave={(newValue) => renameSourceFile(entry.bomId, newValue)}
                                />
                              ) : (
                                <p className="text-muted-foreground px-1.5 py-1 text-sm">
                                  {entry.source_file}
                                </p>
                              )}
                            </div>
                            {editMode && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Delete subpart"
                                disabled={deletingKey === `subpart:${entry.bomId}`}
                                onClick={() => deleteSubpart(group.machine, entry)}
                              >
                                <Trash2 className="text-destructive h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
