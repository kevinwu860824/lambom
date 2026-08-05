"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx-js-style";
import { Check, Download, Pencil, Plus, Trash2, Upload, X as XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { chunk, fetchAllBomItems, normalizeDescription, type BomItem } from "@/lib/bom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FingerprintCell } from "@/components/fingerprint-cell";
import { EditableField } from "@/components/editable-field";
import { ColorPickerPopover, ColorSwatchTrigger } from "@/components/color-picker-popover";
import { CategoryEditPopover } from "@/components/category-edit-popover";

interface KeyPartSlot {
  id: number;
  tool_type: string;
  category: string;
  custom_name: string;
  sort_order: number;
  color: string | null;
}

interface CellValue {
  id: number;
  part_no: string;
}

const CATEGORY_COLORS = [
  "bg-blue-100",
  "bg-amber-100",
  "bg-emerald-100",
  "bg-violet-100",
  "bg-rose-100",
  "bg-cyan-100",
  "bg-lime-100",
  "bg-orange-100",
];

/** Deterministic color per category name, so it stays the same across reloads regardless of row order. */
function categoryColor(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

function cellKey(slotId: number, machineName: string): string {
  return `${slotId}::${machineName}`;
}

export default function FingerprintPage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const [toolTypes, setToolTypes] = useState<string[]>([]);
  const [selectedToolType, setSelectedToolType] = useState("");
  const [newToolType, setNewToolType] = useState("");

  const [allMachineNames, setAllMachineNames] = useState<string[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [slots, setSlots] = useState<KeyPartSlot[]>([]);
  const [cells, setCells] = useState<Map<string, CellValue>>(new Map());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  const [newRowCategory, setNewRowCategory] = useState("");
  const [newRowName, setNewRowName] = useState("");
  const [newRowColor, setNewRowColor] = useState<string | null>(null);
  const [addRowError, setAddRowError] = useState<string | null>(null);

  const [addMachineValue, setAddMachineValue] = useState("");
  const [addMachineError, setAddMachineError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadToolTypes();
    loadAllMachineNames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setEditMode(false);
    if (selectedToolType) {
      loadForToolType(selectedToolType);
    } else {
      setSlots([]);
      setMachines([]);
      setCells(new Map());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedToolType]);

  async function loadToolTypes() {
    const { data, error } = await getSupabase()
      .from("bom_machines")
      .select("tool_type")
      .not("tool_type", "is", null);
    if (error) {
      setError(error.message);
      return;
    }
    const unique = Array.from(
      new Set((data ?? []).map((r) => r.tool_type as string).filter(Boolean))
    ).sort();
    setToolTypes(unique);
  }

  async function loadAllMachineNames() {
    const { data, error } = await getSupabase().from("bom_machines").select("machine_name");
    if (error) {
      setError(error.message);
      return;
    }
    const unique = Array.from(new Set((data ?? []).map((r) => r.machine_name as string))).sort();
    setAllMachineNames(unique);
  }

  async function loadForToolType(toolType: string) {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();

      const [slotsRes, machinesRes] = await Promise.all([
        supabase
          .from("key_part_slots")
          .select("id,tool_type,category,custom_name,sort_order,color")
          .eq("tool_type", toolType),
        supabase.from("bom_machines").select("machine_name").eq("tool_type", toolType),
      ]);

      if (slotsRes.error) throw new Error(slotsRes.error.message);
      if (machinesRes.error) throw new Error(machinesRes.error.message);

      const machineNames = Array.from(
        new Set((machinesRes.data ?? []).map((r) => r.machine_name as string))
      ).sort();
      const slotRows = (slotsRes.data ?? []) as KeyPartSlot[];

      setMachines(machineNames);
      setSlots(slotRows);

      if (machineNames.length > 0 && slotRows.length > 0) {
        const { data: keyPartRows, error: keyPartsError } = await supabase
          .from("key_parts")
          .select("id,part_no,machine_name,slot_id")
          .in("machine_name", machineNames);
        if (keyPartsError) throw new Error(keyPartsError.message);

        const map = new Map<string, CellValue>();
        for (const row of keyPartRows ?? []) {
          if (row.slot_id == null) continue; // legacy rows not linked to a slot aren't shown here
          map.set(cellKey(row.slot_id as number, row.machine_name as string), {
            id: row.id as number,
            part_no: (row.part_no as string) ?? "",
          });
        }
        setCells(map);
      } else {
        setCells(new Map());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleCreateToolType() {
    const trimmed = newToolType.trim();
    if (!trimmed) return;
    if (!toolTypes.includes(trimmed)) setToolTypes((prev) => [...prev, trimmed].sort());
    setSelectedToolType(trimmed);
    setNewToolType("");
  }

  const groups = useMemo(() => {
    const byCategory = new Map<string, KeyPartSlot[]>();
    for (const slot of slots) {
      const list = byCategory.get(slot.category) ?? [];
      list.push(slot);
      byCategory.set(slot.category, list);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order);
    }
    return Array.from(byCategory.entries())
      .map(([category, rows]) => ({
        category,
        rows,
        color: rows.find((r) => r.color)?.color ?? null,
        minSortOrder: Math.min(...rows.map((r) => r.sort_order)),
      }))
      .sort((a, b) => a.minSortOrder - b.minSortOrder);
  }, [slots]);

  async function renameCategory(oldCategory: string, newCategory: string) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("key_part_slots")
      .update({ category: newCategory })
      .eq("tool_type", selectedToolType)
      .eq("category", oldCategory);
    if (error) throw new Error(error.message);
    setSlots((prev) =>
      prev.map((s) => (s.category === oldCategory ? { ...s, category: newCategory } : s))
    );
  }

  async function setCategoryColor(category: string, color: string | null) {
    const { error } = await getSupabase()
      .from("key_part_slots")
      .update({ color })
      .eq("tool_type", selectedToolType)
      .eq("category", category);
    if (error) throw new Error(error.message);
    setSlots((prev) => prev.map((s) => (s.category === category ? { ...s, color } : s)));
  }

  async function renameSlot(slot: KeyPartSlot, newCustomName: string) {
    if (
      slots.some(
        (s) => s.id !== slot.id && s.category === slot.category && s.custom_name === newCustomName
      )
    ) {
      throw new Error("There's already a slot with this name under this category");
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from("key_part_slots")
      .update({ custom_name: newCustomName })
      .eq("id", slot.id);
    if (error) throw new Error(error.message);

    const { error: cascadeError } = await supabase
      .from("key_parts")
      .update({ custom_name: newCustomName })
      .eq("slot_id", slot.id);
    if (cascadeError) throw new Error(cascadeError.message);

    setSlots((prev) => prev.map((s) => (s.id === slot.id ? { ...s, custom_name: newCustomName } : s)));
  }

  const existingCategories = Array.from(new Set(slots.map((s) => s.category)));

  /** Per slot, which machines' part_no differs from that row's majority value. */
  const mismatchesBySlot = useMemo(() => {
    const result = new Map<number, Set<string>>();
    for (const slot of slots) {
      const values: { machine: string; partNo: string }[] = [];
      for (const m of machines) {
        const partNo = cells.get(cellKey(slot.id, m))?.part_no;
        if (partNo) values.push({ machine: m, partNo });
      }
      if (values.length < 2) continue;

      const counts = new Map<string, number>();
      for (const { partNo } of values) {
        counts.set(partNo, (counts.get(partNo) ?? 0) + 1);
      }
      if (counts.size < 2) continue; // all identical, nothing to flag

      let majorityValue = values[0].partNo;
      let majorityCount = 0;
      for (const { partNo } of values) {
        const count = counts.get(partNo)!;
        if (count > majorityCount) {
          majorityCount = count;
          majorityValue = partNo;
        }
      }

      const mismatched = new Set<string>();
      for (const { machine, partNo } of values) {
        if (partNo !== majorityValue) mismatched.add(machine);
      }
      result.set(slot.id, mismatched);
    }
    return result;
  }, [slots, machines, cells]);

  async function addSlot() {
    const category = newRowCategory.trim();
    const customName = newRowName.trim();
    if (!category || !customName) {
      setAddRowError("Both category and slot name are required");
      return;
    }
    if (slots.some((s) => s.category === category && s.custom_name === customName)) {
      setAddRowError("There's already a slot with this name under this category");
      return;
    }

    setAddRowError(null);
    const nextSortOrder = slots.length > 0 ? Math.max(...slots.map((s) => s.sort_order)) + 10 : 0;
    // an existing category always keeps its own established color; the picker
    // here only decides the color for a brand-new category.
    const color = slots.find((s) => s.category === category)?.color ?? newRowColor;

    try {
      const { data, error } = await getSupabase()
        .from("key_part_slots")
        .insert({
          tool_type: selectedToolType,
          category,
          custom_name: customName,
          sort_order: nextSortOrder,
          color,
        })
        .select("id,tool_type,category,custom_name,sort_order,color")
        .single();
      if (error) throw new Error(error.message);

      setSlots((prev) => [...prev, data as KeyPartSlot]);
      setNewRowName("");
      setNewRowColor(null);
    } catch (err) {
      setAddRowError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteSlot(slot: KeyPartSlot) {
    if (
      !window.confirm(`Delete the row "${slot.custom_name}"? (Already-filled part numbers won't be deleted)`)
    )
      return;

    try {
      const { error } = await getSupabase().from("key_part_slots").delete().eq("id", slot.id);
      if (error) throw new Error(error.message);
      setSlots((prev) => prev.filter((s) => s.id !== slot.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * When a machine is added to a tool type, auto-fill any of its cells we
   * can confidently infer from what other machines in this SAME tool type
   * already have recorded: build a part_no/description -> slot lookup from
   * every other machine's existing key_parts rows in this tool type's
   * slots (skipping a key if different machines disagree on which slot it
   * belongs to), then check the new machine's own BOM for matches. Scoped
   * to this tool type's slots specifically (not lib/bom.ts's
   * autoMatchKeyParts, which matches system-wide by custom_name and could
   * pull in a slot_id from a different tool type that would never show up
   * in this table).
   */
  async function autoMatchNewMachine(machineName: string): Promise<number> {
    const supabase = getSupabase();
    const slotIds = slots.map((s) => s.id);
    if (slotIds.length === 0) return 0;

    const { data: existingRows, error: existingErr } = await supabase
      .from("key_parts")
      .select("part_no,description,slot_id,machine_name")
      .in("slot_id", slotIds);
    if (existingErr) throw new Error(existingErr.message);

    const AMBIGUOUS = "ambiguous" as const;
    const byPartNo = new Map<string, number | typeof AMBIGUOUS>();
    const byDescription = new Map<string, number | typeof AMBIGUOUS>();
    function record(map: Map<string, number | typeof AMBIGUOUS>, key: string, slotId: number) {
      if (!key) return;
      const existing = map.get(key);
      if (existing === undefined) map.set(key, slotId);
      else if (existing !== AMBIGUOUS && existing !== slotId) map.set(key, AMBIGUOUS);
    }
    for (const row of existingRows ?? []) {
      if (row.machine_name === machineName) continue;
      record(byPartNo, row.part_no as string, row.slot_id as number);
      record(byDescription, normalizeDescription(row.description as string | null), row.slot_id as number);
    }

    const { data: machineRows, error: machineErr } = await supabase
      .from("bom_machines")
      .select("id,source_file")
      .eq("machine_name", machineName);
    if (machineErr) throw new Error(machineErr.message);

    const allItems: BomItem[] = [];
    for (const m of machineRows ?? []) {
      allItems.push(...(await fetchAllBomItems(supabase, m.id as number, m.source_file as string)));
    }

    const filledSlotIds = new Set<number>();
    const toInsert: { part_no: string; custom_name: string; machine_name: string; slot_id: number }[] = [];
    for (const item of allItems) {
      let slotId = byPartNo.get(item.part_no);
      if (slotId === undefined || slotId === AMBIGUOUS) {
        slotId = byDescription.get(normalizeDescription(item.description));
      }
      if (slotId === undefined || slotId === AMBIGUOUS) continue;
      if (filledSlotIds.has(slotId)) continue; // first BOM match wins per slot
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) continue;
      filledSlotIds.add(slotId);
      toInsert.push({ part_no: item.part_no, custom_name: slot.custom_name, machine_name: machineName, slot_id: slotId });
    }

    if (toInsert.length === 0) return 0;
    const { error: insertErr } = await supabase.from("key_parts").insert(toInsert);
    if (insertErr) throw new Error(insertErr.message);
    return toInsert.length;
  }

  async function addMachine() {
    const name = addMachineValue.trim();
    if (!name) return;
    if (machines.includes(name)) {
      setAddMachineError("This machine is already in this tool type");
      return;
    }

    setAddMachineError(null);
    try {
      const { error } = await getSupabase()
        .from("bom_machines")
        .update({ tool_type: selectedToolType })
        .eq("machine_name", name);
      if (error) throw new Error(error.message);

      try {
        await autoMatchNewMachine(name);
      } catch (err) {
        // The machine was added successfully either way — auto-match is a
        // best-effort convenience on top of that, not a required step.
        console.error("Auto-match failed for newly added machine:", err);
      }

      setAddMachineValue("");
      await loadForToolType(selectedToolType);
      loadToolTypes();
    } catch (err) {
      setAddMachineError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeMachine(name: string) {
    if (
      !window.confirm(
        `Remove "${name}" from this tool type's table? (The machine itself and its uploaded BOM won't be deleted)`
      )
    )
      return;

    try {
      const { error } = await getSupabase()
        .from("bom_machines")
        .update({ tool_type: null })
        .eq("machine_name", name);
      if (error) throw new Error(error.message);
      setMachines((prev) => prev.filter((m) => m !== name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveCell(slot: KeyPartSlot, machineName: string, newValue: string) {
    const key = cellKey(slot.id, machineName);
    const existing = cells.get(key);
    const supabase = getSupabase();

    if (!newValue) {
      if (!existing) return;
      const { error } = await supabase.from("key_parts").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
      setCells((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      return;
    }

    if (existing) {
      const { error } = await supabase
        .from("key_parts")
        .update({ part_no: newValue })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      setCells((prev) => {
        const next = new Map(prev);
        next.set(key, { id: existing.id, part_no: newValue });
        return next;
      });
      return;
    }

    const { data, error } = await supabase
      .from("key_parts")
      .insert({
        part_no: newValue,
        custom_name: slot.custom_name,
        machine_name: machineName,
        slot_id: slot.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    setCells((prev) => {
      const next = new Map(prev);
      next.set(key, { id: data!.id as number, part_no: newValue });
      return next;
    });
  }

  function downloadTemplate() {
    const header = ["Category", "Slot Name", ...machines];
    const rows = groups.flatMap((group) =>
      group.rows.map((slot) => [
        slot.category,
        slot.custom_name,
        ...machines.map((m) => cells.get(cellKey(slot.id, m))?.part_no ?? ""),
      ])
    );
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    sheet["!cols"] = [{ wch: 16 }, { wch: 24 }, ...machines.map(() => ({ wch: 18 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Key Parts");
    XLSX.writeFile(wb, `${selectedToolType}_Key_Parts_Template.xlsx`);
  }

  /**
   * Bulk-import from a downloaded-and-filled-in template. (Category, Slot
   * Name) rows not already in this tool type are created automatically
   * (same as the "Add Row" form above). Machine columns are matched
   * against every machine that exists at all (not just ones already in
   * this tool type's table) — a matched machine not yet in this table is
   * auto-added to it (same as "Add Machine"), so typing a machine name
   * into the header of a manually-built template works, not just editing
   * a freshly-downloaded one. A header that matches no machine anywhere
   * (typo, or a machine with no BOM uploaded yet) is ignored rather than
   * erroring out the whole upload. A blank cell in the file leaves that
   * cell's existing value untouched — this is a fill-in/update operation,
   * not a full overwrite, so a partially-filled-in re-upload can't
   * accidentally wipe data.
   */
  async function handleTemplateFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      if (rows.length < 2) throw new Error("This file has no data rows besides the header");

      const header = rows[0].map((h) => (h ?? "").toString().trim());
      const categoryIdx = header.findIndex((h) => h.toLowerCase() === "category");
      const slotNameIdx = header.findIndex((h) => h.toLowerCase() === "slot name");
      if (categoryIdx === -1 || slotNameIdx === -1) {
        throw new Error('Required columns not found ("Category" / "Slot Name") — check the file format');
      }

      const machineCols = header
        .map((h, idx) => ({ h, idx }))
        .filter(({ h, idx }) => idx !== categoryIdx && idx !== slotNameIdx && allMachineNames.includes(h));
      if (machineCols.length === 0) {
        throw new Error(
          "No matching machine columns found — column headers must exactly match an existing machine name"
        );
      }

      const supabase = getSupabase();
      const dataRows = rows.slice(1).filter((r) => r.some((c) => (c ?? "").toString().trim() !== ""));

      // Pass 0: any matched machine not yet in this tool type's table gets
      // added to it first (same effect as "Add Machine"), so its column's
      // cell values have somewhere to attach to.
      const newMachineNames = machineCols.map((c) => c.h).filter((h) => !machines.includes(h));
      if (newMachineNames.length > 0) {
        const { error: addMachinesErr } = await supabase
          .from("bom_machines")
          .update({ tool_type: selectedToolType })
          .in("machine_name", newMachineNames);
        if (addMachinesErr) throw new Error(`Failed to add machine(s) to this tool type: ${addMachinesErr.message}`);
      }

      // Pass 1: ensure every (category, slot name) row exists, creating any that don't (same as "Add Row").
      const slotByKey = new Map<string, KeyPartSlot>();
      for (const s of slots) slotByKey.set(`${s.category}::${s.custom_name}`, s);
      let nextSortOrder = slots.length > 0 ? Math.max(...slots.map((s) => s.sort_order)) + 10 : 0;

      for (const row of dataRows) {
        const category = (row[categoryIdx] ?? "").toString().trim();
        const customName = (row[slotNameIdx] ?? "").toString().trim();
        if (!category || !customName) continue;
        const key = `${category}::${customName}`;
        if (slotByKey.has(key)) continue;

        const color = slots.find((s) => s.category === category)?.color ?? null;
        const { data, error } = await supabase
          .from("key_part_slots")
          .insert({
            tool_type: selectedToolType,
            category,
            custom_name: customName,
            sort_order: nextSortOrder,
            color,
          })
          .select("id,tool_type,category,custom_name,sort_order,color")
          .single();
        if (error) throw new Error(`Failed to create row "${category} / ${customName}": ${error.message}`);
        nextSortOrder += 10;
        slotByKey.set(key, data as KeyPartSlot);
      }

      // Pass 2: look up which (slot, machine) cells already exist, to tell insert from update.
      const allSlotIds = [...slotByKey.values()].map((s) => s.id);
      const { data: existingRows, error: existingErr } = await supabase
        .from("key_parts")
        .select("id,slot_id,machine_name")
        .in("slot_id", allSlotIds)
        .in(
          "machine_name",
          machineCols.map((c) => c.h)
        );
      if (existingErr) throw new Error(existingErr.message);
      const existingIdByKey = new Map<string, number>();
      for (const r of existingRows ?? []) {
        existingIdByKey.set(`${r.slot_id}::${r.machine_name}`, r.id as number);
      }

      // Pass 3: apply non-empty cells only — blank cells leave existing data untouched.
      const toInsert: { part_no: string; custom_name: string; machine_name: string; slot_id: number }[] = [];
      const toUpdate: { id: number; part_no: string }[] = [];

      for (const row of dataRows) {
        const category = (row[categoryIdx] ?? "").toString().trim();
        const customName = (row[slotNameIdx] ?? "").toString().trim();
        if (!category || !customName) continue;
        const slot = slotByKey.get(`${category}::${customName}`);
        if (!slot) continue;

        for (const { h: machineName, idx } of machineCols) {
          const value = (row[idx] ?? "").toString().trim();
          if (!value) continue;
          const existingId = existingIdByKey.get(`${slot.id}::${machineName}`);
          if (existingId) {
            toUpdate.push({ id: existingId, part_no: value });
          } else {
            toInsert.push({ part_no: value, custom_name: slot.custom_name, machine_name: machineName, slot_id: slot.id });
          }
        }
      }

      for (const batch of chunk(toInsert, 500)) {
        const { error } = await supabase.from("key_parts").insert(batch);
        if (error) throw new Error(error.message);
      }

      for (const batch of chunk(toUpdate, 20)) {
        const results = await Promise.all(
          batch.map((u) => supabase.from("key_parts").update({ part_no: u.part_no }).eq("id", u.id))
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
      }

      await loadForToolType(selectedToolType);
      loadToolTypes();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-[1800px] px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Key Parts Fingerprint</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              View/edit each machine&apos;s key part numbers by tool type — reads and writes directly to key_parts.
            </p>
          </div>
          <Link href="/" className="text-sm underline underline-offset-4">
            Back to Comparison Tool
          </Link>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Select Tool Type</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Tool Type</label>
              <Select value={selectedToolType} onValueChange={setSelectedToolType}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select tool type" />
                </SelectTrigger>
                <SelectContent>
                  {toolTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Or add a new tool type</label>
              <div className="flex gap-2">
                <Input
                  value={newToolType}
                  onChange={(e) => setNewToolType(e.target.value)}
                  placeholder="e.g. Core-Buffing OX"
                  className="w-56"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateToolType();
                  }}
                />
                <Button variant="outline" onClick={handleCreateToolType}>
                  Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        {!selectedToolType ? (
          <p className="text-muted-foreground text-sm italic">Select or add a tool type first.</p>
        ) : (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>{selectedToolType}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  list="fingerprint-all-machines"
                  value={addMachineValue}
                  onChange={(e) => setAddMachineValue(e.target.value)}
                  placeholder="Add a machine column (e.g. ACOXN1)"
                  className="w-52"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addMachine();
                  }}
                />
                <datalist id="fingerprint-all-machines">
                  {allMachineNames
                    .filter((m) => !machines.includes(m))
                    .map((m) => (
                      <option key={m} value={m} />
                    ))}
                </datalist>
                <Button size="sm" variant="outline" onClick={addMachine}>
                  <Plus className="h-4 w-4" />
                  Add Machine
                </Button>
                <Button size="sm" variant="outline" onClick={downloadTemplate}>
                  <Download className="h-4 w-4" />
                  Download Template
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => templateFileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? "Uploading…" : "Upload Template"}
                </Button>
                <input
                  ref={templateFileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleTemplateFile(file);
                    e.target.value = "";
                  }}
                />
              </div>
            </CardHeader>
            <CardContent>
              {addMachineError && <p className="text-destructive mb-3 text-sm">{addMachineError}</p>}
              {uploadError && <p className="text-destructive mb-3 text-sm">Template upload failed: {uploadError}</p>}

              <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border p-3">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">Category</label>
                  <Input
                    list="fingerprint-categories"
                    value={newRowCategory}
                    onChange={(e) => setNewRowCategory(e.target.value)}
                    placeholder="e.g. Front End"
                    className="w-40"
                  />
                  <datalist id="fingerprint-categories">
                    {existingCategories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">Slot Name</label>
                  <Input
                    value={newRowName}
                    onChange={(e) => setNewRowName(e.target.value)}
                    placeholder="e.g. PodLoader#1"
                    className="w-48"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addSlot();
                    }}
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">Color</label>
                  <ColorPickerPopover value={newRowColor} onChange={(c) => setNewRowColor(c)}>
                    <ColorSwatchTrigger color={newRowColor} />
                  </ColorPickerPopover>
                </div>
                <Button size="sm" onClick={addSlot}>
                  <Plus className="h-4 w-4" />
                  Add Row
                </Button>
                {addRowError && <p className="text-destructive text-xs">{addRowError}</p>}
                <p className="text-muted-foreground w-full text-xs">
                  Color only applies to a brand-new category; if the category already exists, its
                  existing color is kept (you can change it via the category color swatch in the
                  table below).
                </p>
              </div>

              {loading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : slots.length === 0 ? (
                <p className="text-muted-foreground text-sm italic">
                  This tool type has no rows yet — add one above.
                </p>
              ) : (
                <Table containerClassName="max-h-[70vh] overflow-y-auto">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="bg-card sticky top-0 z-10 w-10" />
                      <TableHead className="bg-card sticky top-0 z-10 min-w-[180px]">
                        <div className="flex items-center gap-2">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={editMode ? "Done editing" : "Edit whole table"}
                            onClick={() => setEditMode((v) => !v)}
                          >
                            {editMode ? (
                              <Check className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <Pencil className="h-4 w-4" />
                            )}
                          </Button>
                          Slot
                        </div>
                      </TableHead>
                      {machines.map((m) => (
                        <TableHead key={m} className="bg-card sticky top-0 z-10 min-w-[160px]">
                          <div className="flex items-center justify-between gap-1">
                            {m}
                            {editMode && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove machine ${m}`}
                                onClick={() => removeMachine(m)}
                              >
                                <XIcon className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableHead>
                      ))}
                      {machines.length === 0 && (
                        <TableHead className="bg-card sticky top-0 z-10 text-muted-foreground font-normal">
                          No machines yet — add one above
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) =>
                      group.rows.map((slot, i) => (
                        <TableRow key={slot.id}>
                          {i === 0 && (
                            <TableCell
                              rowSpan={group.rows.length}
                              className={cn(
                                "w-10 p-1 text-center align-middle",
                                !group.color && categoryColor(group.category)
                              )}
                              style={group.color ? { backgroundColor: group.color } : undefined}
                            >
                              <div className="flex flex-col items-center gap-1">
                                {editMode && (
                                  <CategoryEditPopover
                                    category={group.category}
                                    color={group.color}
                                    onRename={(newValue) => renameCategory(group.category, newValue)}
                                    onColorChange={(c) => setCategoryColor(group.category, c)}
                                  >
                                    <button
                                      type="button"
                                      aria-label={`Edit category "${group.category}"`}
                                      className="shrink-0 rounded p-0.5 hover:bg-black/10"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                  </CategoryEditPopover>
                                )}
                                <span className="text-xs font-semibold whitespace-normal [writing-mode:vertical-rl]">
                                  {group.category}
                                </span>
                              </div>
                            </TableCell>
                          )}
                          <TableCell className="font-medium whitespace-normal">
                            <div className="flex items-center gap-1">
                              <div className="min-w-0 flex-1">
                                {editMode ? (
                                  <EditableField
                                    value={slot.custom_name}
                                    onSave={(newValue) => renameSlot(slot, newValue)}
                                  />
                                ) : (
                                  <span className="px-1.5 text-sm">{slot.custom_name}</span>
                                )}
                              </div>
                              {editMode && (
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label="Delete this row"
                                  onClick={() => deleteSlot(slot)}
                                >
                                  <Trash2 className="text-destructive h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          {machines.map((m) => {
                            const cell = cells.get(cellKey(slot.id, m));
                            return (
                              <TableCell key={m} className="p-0">
                                <FingerprintCell
                                  value={cell?.part_no ?? ""}
                                  onSave={(newValue) => saveCell(slot, m, newValue)}
                                  mismatch={mismatchesBySlot.get(slot.id)?.has(m) ?? false}
                                  readOnly={!editMode}
                                />
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
