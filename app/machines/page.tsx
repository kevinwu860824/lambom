"use client";

import * as XLSX from "xlsx-js-style";
import { zipSync } from "fflate";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, Download, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
import {
  fetchAllBomItems,
  fetchFidsByMachine,
  fetchFullBomTreeItems,
  fetchMachineGroups,
  fetchZbomSectionNames,
  fetchZbomSectionOptions,
  withRetry,
  type BomEntry,
  type MachineGroup,
  type ZbomOption,
  buildBomTree,
  type BomTreeNode,
} from "@/lib/bom";
import { useEmployeeGroup } from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { EditableField } from "@/components/editable-field";
import { FidDownloaderPanel } from "@/components/fid-downloader-panel";
import { LanguageSwitcher } from "@/components/language-switcher";
import { RequireGroupPrompt } from "@/components/require-group";

const zh: Record<string, string> = {
  "Edit Machine / Subpart Names": "編輯機台 / 子件名稱",
  "Press Enter or click confirm after editing to save immediately.":
    "編輯後按 Enter 或點擊確認即可立即儲存。",
  "Done editing": "完成編輯",
  "Edit machines/subparts": "編輯機台 / 子件",
  "Back to Comparison Tool": "返回比對工具",
  "Delete failed:": "刪除失敗:",
  "Loading…": "載入中…",
  "No machine data yet": "尚無機台資料",
  "{count} subpart(s)": "{count} 個子件",
  "Machine Name": "機台名稱",
  "Delete machine": "刪除機台",
  Subparts: "子件",
  "Delete subpart": "刪除子件",
  'Delete machine "{name}"? This will also delete its {count} subpart(s) and all detail data — this cannot be undone.':
    "刪除機台「{name}」？這將同時刪除其 {count} 個子件與所有詳細資料,此操作無法復原。",
  'Delete subpart "{name}"? This will delete all its detail data — this cannot be undone.':
    "刪除子件「{name}」？這將刪除其所有詳細資料,此操作無法復原。",
  "Full BOM": "完整 BOM",
  Modules: "Modules",
  ZBOM: "ZBOM",
  "Download selected": "下載所選資料",
  "Downloading…": "下載中…",
  "Select at least one data type": "請至少選擇一種資料類型",
  "FID is not available for this machine": "找不到此機台的 FID",
};

type MachineDownloadSelection = {
  fullBom: boolean;
  modules: boolean;
  zbom: boolean;
};

const defaultDownloadSelection: MachineDownloadSelection = {
  fullBom: true,
  modules: true,
  zbom: true,
};

function safeFilenamePart(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_");
}

function workbookBytes(sheets: { name: string; rows: (string | number)[][] }[]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
  }
  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(output);
}

function bomRows(items: { part_no: string; description: string | null; qty: number | string | null; uom: string | null }[]) {
  return [
    ["Part No.", "Description", "Qty", "Unit"],
    ...items.map((item) => [item.part_no, item.description ?? "", item.qty ?? "", item.uom ?? ""]),
  ];
}

function zbomRows(options: ZbomOption[]) {
  return [
    ["Section", "Option Type", "Option Selection"],
    ...options.map((option) => [option.section, option.optionType, option.optionSelection ?? ""]),
  ];
}

function fullBomText(items: Parameters<typeof buildBomTree>[0]): string {
  const lines: string[] = [];
  function appendNode(node: BomTreeNode, depth: number) {
    const item = node.item;
    const details = [item.part_no, item.description ?? "", `${item.qty ?? "-"} ${item.uom ?? ""}`.trim()]
      .filter(Boolean)
      .join(" | ");
    lines.push(`${"  ".repeat(depth)}${depth > 0 ? "|-- " : ""}${details}`);
    for (const child of node.children) appendNode(child, depth + 1);
  }
  for (const root of buildBomTree(items)) appendNode(root, 0);
  return `${lines.join("\n")}\n`;
}

export default function MachinesPage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const { allowedMachines, employeeId, group, notFound, loading: groupLoading, refresh: refreshGroup } = useEmployeeGroup();
  const t = useTranslate(zh);

  const [groups, setGroups] = useState<MachineGroup[]>([]);
  const [fidsByMachine, setFidsByMachine] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());
  const [downloadSelections, setDownloadSelections] = useState<Map<string, MachineDownloadSelection>>(new Map());
  const [downloadingMachine, setDownloadingMachine] = useState<string | null>(null);

  function toggleExpanded(machine: string) {
    setExpandedMachines((prev) => {
      const next = new Set(prev);
      if (next.has(machine)) next.delete(machine);
      else next.add(machine);
      return next;
    });
  }

  function getDownloadSelection(machine: string): MachineDownloadSelection {
    return downloadSelections.get(machine) ?? defaultDownloadSelection;
  }

  function toggleDownloadSelection(machine: string, key: keyof MachineDownloadSelection) {
    setDownloadSelections((prev) => {
      const next = new Map(prev);
      const selection = { ...getDownloadSelection(machine) };
      selection[key] = !selection[key];
      next.set(machine, selection);
      return next;
    });
  }

  useEffect(() => {
    if (!allowedMachines) return;
    loadData(allowedMachines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedMachines]);

  async function loadData(allowed: Set<string>) {
    setLoading(true);
    setError(null);
    try {
      const { machineGroups } = await fetchMachineGroups(getSupabase());
      setGroups(machineGroups.filter((g) => allowed.has(g.machine)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }

    // Best-effort FID annotation next to machine names — not core data, so
    // a failure here shouldn't block the machine list from loading.
    try {
      setFidsByMachine(await fetchFidsByMachine(getSupabase()));
    } catch {
      // leave fidsByMachine empty; machine names just render without a FID
    }
  }

  async function downloadMachineData(machineGroup: MachineGroup) {
    const machineName = machineGroup.machine;
    const selection = getDownloadSelection(machineName);
    if (!selection.fullBom && !selection.modules && !selection.zbom) {
      setError(t("Select at least one data type"));
      return;
    }

    const fid = fidsByMachine.get(machineName);
    if (!fid) {
      setError(t("FID is not available for this machine"));
      return;
    }

    setError(null);
    setDownloadingMachine(machineName);
    try {
      const supabase = getSupabase();
      const files: Record<string, Uint8Array> = {};
      const folder = `${safeFilenamePart(machineName)}-${safeFilenamePart(fid)}`;

      if (selection.fullBom) {
        const items = await fetchFullBomTreeItems(supabase, machineName);
        files[`${folder}/${folder}-Full_BOM.txt`] = new TextEncoder().encode(
          `Machine: ${machineName}\nFID: ${fid}\n\n${fullBomText(items)}`
        );
      }

      if (selection.modules) {
        const sheets = await Promise.all(
          machineGroup.subparts.map(async (entry) => ({
            name: entry.source_file,
            rows: bomRows(await fetchAllBomItems(supabase, entry.bomId, entry.source_file)),
          }))
        );
        files[`${folder}/${folder}-Modules.xlsx`] = workbookBytes(sheets.length > 0 ? sheets : [{ name: "Modules", rows: [["No modules"]] }]);
      }

      if (selection.zbom) {
        const sections = await fetchZbomSectionNames(supabase, machineName);
        const options = (await Promise.all(sections.map((section) => fetchZbomSectionOptions(supabase, machineName, section)))).flat();
        files[`${folder}/${folder}-ZBOM.xlsx`] = workbookBytes([{ name: "ZBOM", rows: zbomRows(options) }]);
      }

      const archive = zipSync(files);
      const blob = new Blob([archive], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${folder}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingMachine(null);
    }
  }

  async function renameMachine(oldName: string, newName: string) {
    const supabase = getSupabase();
    const { error: renameError } = await withRetry(() =>
      supabase.from("bom_machines").update({ machine_name: newName }).eq("machine_name", oldName)
    );
    if (renameError) throw new Error(renameError.message);

    // Same machine_name-as-loose-string-key issue as deleteMachine — these
    // tables need to be repointed to the new name too, or their rows get
    // orphaned under a machine name that no longer exists anywhere. Each
    // touches every row for this machine at once (full_bom_items alone can
    // be tens of thousands), so — same as bom_items elsewhere — wrapped in
    // withRetry to ride out a transient "canceling statement due to
    // statement timeout" on a cold table page.
    const { error: keyPartsError } = await withRetry(() =>
      supabase.from("key_parts").update({ machine_name: newName }).eq("machine_name", oldName)
    );
    if (keyPartsError) throw new Error(keyPartsError.message);

    const { error: fullBomError } = await withRetry(() =>
      supabase.from("full_bom_items").update({ machine_name: newName }).eq("machine_name", oldName)
    );
    if (fullBomError) throw new Error(fullBomError.message);

    const { error: zbomError } = await withRetry(() =>
      supabase.from("zbom_options").update({ machine_name: newName }).eq("machine_name", oldName)
    );
    if (zbomError) throw new Error(zbomError.message);

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
        t(
          'Delete machine "{name}"? This will also delete its {count} subpart(s) and all detail data — this cannot be undone.'
        )
          .replace("{name}", group.machine)
          .replace("{count}", String(group.subparts.length))
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

      // key_parts/full_bom_items/zbom_options are all keyed by machine_name
      // directly (not by bom_id), so deleting bom_machines/bom_items above
      // doesn't cascade to them — without this they'd become orphaned rows
      // that keep showing up (e.g. in Key Parts Fingerprint) for a machine
      // that no longer exists.
      const { error: keyPartsError } = await supabase
        .from("key_parts")
        .delete()
        .eq("machine_name", group.machine);
      if (keyPartsError) throw new Error(keyPartsError.message);

      const { error: fullBomError } = await supabase
        .from("full_bom_items")
        .delete()
        .eq("machine_name", group.machine);
      if (fullBomError) throw new Error(fullBomError.message);

      const { error: zbomError } = await supabase
        .from("zbom_options")
        .delete()
        .eq("machine_name", group.machine);
      if (zbomError) throw new Error(zbomError.message);

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
        t('Delete subpart "{name}"? This will delete all its detail data — this cannot be undone.').replace(
          "{name}",
          entry.source_file
        )
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

  if (groupLoading) return null;
  if (!allowedMachines) {
    return (
      <div className="bg-background min-h-screen">
        <RequireGroupPrompt notFound={notFound} employeeId={employeeId} />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Edit Machine / Subpart Names")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Press Enter or click confirm after editing to save immediately.")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="outline"
              aria-label={editMode ? t("Done editing") : t("Edit machines/subparts")}
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? <Check className="h-4 w-4 text-emerald-600" /> : <Pencil className="h-4 w-4" />}
            </Button>
            <LanguageSwitcher />
            <Button variant="outline" size="icon" asChild aria-label={t("Back to Comparison Tool")}>
              <Link href="/lambom">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        <FidDownloaderPanel
          existingMachines={groups.map((g) => g.machine)}
          groupId={group?.id ?? null}
          onUploaded={refreshGroup}
        />

        <Card>
          <CardContent className="grid gap-4">
            {deleteError && (
              <p className="text-destructive text-sm">
                {t("Delete failed:")} {deleteError}
              </p>
            )}

            {loading ? (
              <p className="text-muted-foreground text-sm">{t("Loading…")}</p>
            ) : groups.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("No machine data yet")}</p>
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
                    <span className="flex-1 text-sm font-medium">
                      {group.machine}
                      {fidsByMachine.get(group.machine) && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          {fidsByMachine.get(group.machine)}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t("{count} subpart(s)").replace("{count}", String(group.subparts.length))}
                    </span>
                  </button>

                  {expanded && (
                    <div className="border-t p-3">
                      <Label className="mb-1.5">{t("Machine Name")}</Label>
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
                            aria-label={t("Delete machine")}
                            disabled={deletingKey === `machine:${group.machine}`}
                            onClick={() => deleteMachine(group)}
                          >
                            <Trash2 className="text-destructive h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      <Label className="mt-4 mb-1.5 block">{t("Download selected")}</Label>
                      <div className="flex flex-wrap items-center gap-4 pl-2">
                        {([
                          ["fullBom", "Full BOM"],
                          ["modules", "Modules"],
                          ["zbom", "ZBOM"],
                        ] as const).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={getDownloadSelection(group.machine)[key]}
                              onCheckedChange={() => toggleDownloadSelection(group.machine, key)}
                              disabled={downloadingMachine === group.machine}
                            />
                            {t(label)}
                          </label>
                        ))}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadMachineData(group)}
                          disabled={downloadingMachine === group.machine}
                        >
                          <Download className="h-3.5 w-3.5" />
                          {downloadingMachine === group.machine ? t("Downloading…") : t("Download selected")}
                        </Button>
                      </div>

                      <Label className="mt-4 mb-1.5 block">{t("Subparts")}</Label>
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
                                aria-label={t("Delete subpart")}
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
