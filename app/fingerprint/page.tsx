"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx-js-style";
import { ArrowLeft, Check, Download, Loader2, Pencil, Plus, Trash2, Upload, X as XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  chunk,
  fetchAllBomItems,
  fetchBomTreeItems,
  fetchFullBomItems,
  fetchFullBomTreeItems,
  fetchMachineBomLookup,
  normalizeDescription,
  type BomItem,
  type BomTreeItem,
  type MachineBomLookup,
} from "@/lib/bom";
import { cn } from "@/lib/utils";
import { useEmployeeGroup } from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { PartPositionDialog, type PartPositionTarget } from "@/components/part-position-dialog";
import { RequireGroupPrompt } from "@/components/require-group";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  foundInModules: string[] | null;
}

/** One cell from an Excel template upload, classified against the target
 * machine's Full BOM + Modules data. */
interface ClassifiedCell {
  category: string;
  customName: string;
  slotId: number;
  machineName: string;
  partNo: string;
  foundInModules: string[] | null;
}

interface PendingUpload {
  foundCells: ClassifiedCell[];
  notFoundCells: ClassifiedCell[];
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

const zh: Record<string, string> = {
  "Back to Comparison Tool": "返回比對工具",
  "Key Parts Fingerprint": "關鍵零件指紋",
  "View/edit each machine's key part numbers by tool type — reads and writes directly to key_parts.":
    "依刀具類型檢視/編輯各機台的關鍵零件料號 — 直接讀寫 key_parts。",
  "Select Tool Type": "選擇刀具類型",
  "Tool Type": "刀具類型",
  "Select tool type": "選擇刀具類型",
  "Or add a new tool type": "或新增刀具類型",
  "e.g. Core-Buffing OX": "例如：Core-Buffing OX",
  Add: "新增",
  "Select or add a tool type first.": "請先選擇或新增刀具類型。",
  "Add a machine column (e.g. ACOXN1)": "新增機台欄位（例如：ACOXN1）",
  "Adding…": "新增中…",
  "Add Machine": "新增機台",
  "Download Template": "下載範本",
  "Uploading…": "上傳中…",
  "Upload Template": "上傳範本",
  Done: "完成",
  "Edit Table": "編輯表格",
  "Template upload failed:": "範本上傳失敗：",
  Category: "分類",
  "e.g. Front End": "例如：Front End",
  "Slot Name": "插槽名稱",
  "e.g. PodLoader#1": "例如：PodLoader#1",
  Color: "顏色",
  "Add Row": "新增列",
  "Color only applies to a brand-new category; if the category already exists, its existing color is kept (you can change it via the category color swatch in the table below).":
    "顏色只套用於全新分類；若分類已存在，會保留其原有顏色（可透過下方表格中的分類顏色色塊變更）。",
  "Loading…": "載入中…",
  "This tool type has no rows yet — add one above.": "此刀具類型尚無資料列 — 請於上方新增。",
  Slot: "插槽",
  "No machines yet — add one above": "尚無機台 — 請於上方新增",
  "Remove machine {machine}": "移除機台 {machine}",
  "Delete this row": "刪除此列",
  "Edit category \"{category}\"": "編輯分類「{category}」",
  "Some part numbers weren't found": "部分料號未找到",
  "{notFoundCount} part number(s) in this file don't appear in the target machine's Full BOM or Modules data at all — possibly a typo. {foundCount} other cell(s) were verified fine and aren't affected by this choice.":
    "此檔案中有 {notFoundCount} 筆料號完全不存在於目標機台的完整 BOM 或模組資料中 — 可能是打字錯誤。另外 {foundCount} 筆已驗證無誤，不受此選擇影響。",
  Machine: "機台",
  "Part No.": "料號",
  "Cancel Upload": "取消上傳",
  "Working…": "處理中…",
  "Skip These, Add the Rest": "略過這些，新增其餘",
  "Add All Anyway": "仍要全部新增",
  "Both category and slot name are required": "分類和插槽名稱皆為必填",
  "There's already a slot with this name under this category": "此分類下已有相同名稱的插槽",
  "This machine is already in this tool type": "此機台已經在這個刀具類型中",
  "Delete the row \"{name}\"? (Already-filled part numbers won't be deleted)":
    "刪除列「{name}」？（已填寫的料號不會被刪除）",
  "Remove \"{name}\" from this tool type's table? (The machine itself and its uploaded BOM won't be deleted)":
    "從此刀具類型的表格中移除「{name}」？（機台本身及其已上傳的 BOM 不會被刪除）",
  "\"{value}\" wasn't found in {machine}'s Full BOM or Modules data — it may be a typo. Save it anyway?":
    "在 {machine} 的完整 BOM 或模組資料中找不到「{value}」— 可能是打字錯誤。仍要儲存嗎？",
  "This file has no data rows besides the header": "此檔案除了標題列外沒有資料列",
  "Required columns not found (\"Category\" / \"Slot Name\") — check the file format":
    "找不到必要欄位（\"Category\" / \"Slot Name\"）— 請檢查檔案格式",
  "No matching machine columns found — column headers must exactly match an existing machine name":
    "找不到符合的機台欄位 — 欄位名稱必須與現有機台名稱完全一致",
  "Failed to add machine(s) to this tool type:": "新增機台至此刀具類型失敗：",
  "Failed to create row \"{row}\":": "建立列「{row}」失敗：",
};

export default function FingerprintPage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  // Caches each machine's Full BOM + Modules lookup for the lifetime of
  // this page (a machine's BOM data doesn't change while browsing/editing
  // this table), so editing several cells for the same machine in a row —
  // manually here, or via Excel upload — only fetches it once instead of
  // on every single edit.
  const machineLookupCacheRef = useRef<Map<string, Promise<MachineBomLookup>>>(new Map());
  function getMachineLookup(machineName: string): Promise<MachineBomLookup> {
    const cache = machineLookupCacheRef.current;
    let promise = cache.get(machineName);
    if (!promise) {
      promise = fetchMachineBomLookup(getSupabase(), machineName);
      cache.set(machineName, promise);
    }
    return promise;
  }

  // "Where is this part?" dialog — same PartPositionDialog the BOM
  // Comparison Tool uses for its Only in A/B rows, opened here from a
  // read-only cell's part number. Each getter is page-lifetime cached the
  // same way getMachineLookup above is, since Full BOM/module trees are
  // each a paginated fetch of potentially 20k+ rows.
  const fullBomTreeCacheRef = useRef<Map<string, Promise<BomTreeItem[]>>>(new Map());
  const getFullBomTree = useCallback((machine: string) => {
    let promise = fullBomTreeCacheRef.current.get(machine);
    if (!promise) {
      promise = fetchFullBomTreeItems(getSupabase(), machine);
      fullBomTreeCacheRef.current.set(machine, promise);
    }
    return promise;
  }, []);

  const moduleTreeCacheRef = useRef<Map<number, Promise<BomTreeItem[]>>>(new Map());
  const getModuleTree = useCallback((bomId: number, sourceFile: string) => {
    let promise = moduleTreeCacheRef.current.get(bomId);
    if (!promise) {
      promise = fetchBomTreeItems(getSupabase(), bomId, sourceFile);
      moduleTreeCacheRef.current.set(bomId, promise);
    }
    return promise;
  }, []);

  const moduleListCacheRef = useRef<Map<string, Promise<{ bomId: number; sourceFile: string }[]>>>(new Map());
  const getModules = useCallback(async (machine: string) => {
    let promise = moduleListCacheRef.current.get(machine);
    if (!promise) {
      promise = (async () => {
        const { data, error } = await getSupabase()
          .from("bom_machines")
          .select("id,source_file")
          .eq("machine_name", machine);
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({ bomId: r.id as number, sourceFile: r.source_file as string }));
      })();
      moduleListCacheRef.current.set(machine, promise);
    }
    return promise;
  }, []);

  const [positionTarget, setPositionTarget] = useState<PartPositionTarget | null>(null);
  function openPositionDialog(partNo: string, machine: string) {
    setPositionTarget({ partNo, description: null, machine });
  }

  const { allowedMachines, employeeId, notFound, loading: groupLoading } = useEmployeeGroup();
  const t = useTranslate(zh);

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
  const [addingMachine, setAddingMachine] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);
  // Set when an upload finds cells whose part number isn't in the target
  // machine's Full BOM or Modules at all — the upload pauses here and
  // waits for the user to choose how to proceed via the dialog below,
  // rather than silently writing unverified data.
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [applyingUpload, setApplyingUpload] = useState(false);

  useEffect(() => {
    if (!allowedMachines) return;
    loadToolTypes();
    loadAllMachineNames(allowedMachines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedMachines]);

  useEffect(() => {
    if (!allowedMachines) return;
    setEditMode(false);
    if (selectedToolType) {
      loadForToolType(selectedToolType, allowedMachines);
    } else {
      setSlots([]);
      setMachines([]);
      setCells(new Map());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedToolType, allowedMachines]);

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

  async function loadAllMachineNames(allowed: Set<string>) {
    const { data, error } = await getSupabase().from("bom_machines").select("machine_name");
    if (error) {
      setError(error.message);
      return;
    }
    const unique = Array.from(new Set((data ?? []).map((r) => r.machine_name as string)))
      .filter((name) => allowed.has(name))
      .sort();
    setAllMachineNames(unique);
  }

  async function loadForToolType(toolType: string, allowed: Set<string>) {
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
      )
        .filter((name) => allowed.has(name))
        .sort();
      const slotRows = (slotsRes.data ?? []) as KeyPartSlot[];

      setMachines(machineNames);
      setSlots(slotRows);

      if (machineNames.length > 0 && slotRows.length > 0) {
        const { data: keyPartRows, error: keyPartsError } = await supabase
          .from("key_parts")
          .select("id,part_no,machine_name,slot_id,found_in_modules")
          .in("machine_name", machineNames);
        if (keyPartsError) throw new Error(keyPartsError.message);

        const map = new Map<string, CellValue>();
        for (const row of keyPartRows ?? []) {
          if (row.slot_id == null) continue; // legacy rows not linked to a slot aren't shown here
          map.set(cellKey(row.slot_id as number, row.machine_name as string), {
            id: row.id as number,
            part_no: (row.part_no as string) ?? "",
            foundInModules: (row.found_in_modules as string[] | null) ?? null,
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
      throw new Error(t("There's already a slot with this name under this category"));
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
      setAddRowError(t("Both category and slot name are required"));
      return;
    }
    if (slots.some((s) => s.category === category && s.custom_name === customName)) {
      setAddRowError(t("There's already a slot with this name under this category"));
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
      !window.confirm(
        t("Delete the row \"{name}\"? (Already-filled part numbers won't be deleted)").replace(
          "{name}",
          slot.custom_name
        )
      )
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
   * already have recorded: build a part_no/description -> slot-ids lookup
   * from every other machine's existing key_parts rows in this tool type's
   * slots (a part_no can map to more than one slot — e.g. PodLoader#1-4
   * routinely share the same physical part number — so every slot it's
   * ever been recorded under is a candidate, not just a single "or give
   * up if inconsistent" value), then check the new machine's own BOM for
   * matches and fill every candidate slot. Scoped to this tool type's
   * slots specifically (not lib/bom.ts's autoMatchKeyParts, which matches
   * system-wide by custom_name and could pull in a slot_id from a
   * different tool type that would never show up in this table).
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

    // Tracks every slot_id a part_no/description has ever been recorded
    // under across other machines — a Set, not a single "or ambiguous"
    // value, because the same part legitimately gets assigned to more than
    // one slot in real data (e.g. PodLoader#1-4 are routinely the exact
    // same physical part number on every machine that has them). Treating
    // that as "ambiguous, don't guess" used to mean a part number known to
    // belong to 4 specific slots would never auto-fill any of them for a
    // newly added machine, even when every other machine that had it
    // consistently used the same 4 slots. Below, every slot_id ever seen
    // for a matched key gets filled (skipping ones already filled by an
    // earlier, more specific item) — worst case for a genuinely
    // machine-specific part that coincidentally shares a part_no/
    // description with something unrelated, this fills an extra slot that
    // the user can just correct inline, versus the previous guaranteed-blank.
    const byPartNo = new Map<string, Set<number>>();
    const byDescription = new Map<string, Set<number>>();
    function record(map: Map<string, Set<number>>, key: string, slotId: number) {
      if (!key) return;
      let set = map.get(key);
      if (!set) {
        set = new Set();
        map.set(key, set);
      }
      set.add(slotId);
    }
    // Slots this machine already has a key_parts row for — from an earlier
    // run of this same function, a manual edit, or lib/bom.ts's system-wide
    // autoMatchKeyParts (which runs automatically after every machine's SAP
    // Modules download, regardless of tool type, and can already have
    // written rows here before this machine was ever added to this tool
    // type's table). Seeds filledSlotIds below so this function never
    // inserts a second row for a slot that's already filled — without
    // this, re-adding a machine (or a slot this function's own multi-slot
    // matching above newly reaches) could create duplicate key_parts rows
    // for the same (machine, slot) pair.
    const alreadyFilledSlotIds = new Set<number>();
    for (const row of existingRows ?? []) {
      if (row.machine_name === machineName) {
        if (row.slot_id != null) alreadyFilledSlotIds.add(row.slot_id as number);
        continue;
      }
      record(byPartNo, row.part_no as string, row.slot_id as number);
      record(byDescription, normalizeDescription(row.description as string | null), row.slot_id as number);
    }

    const { data: machineRows, error: machineErr } = await supabase
      .from("bom_machines")
      .select("id,source_file")
      .eq("machine_name", machineName);
    if (machineErr) throw new Error(machineErr.message);

    // Modules first, then Full BOM appended after — a part matched via
    // Modules keeps priority for "first BOM match wins per slot" below
    // (preserves prior behavior for anything that already worked), Full
    // BOM only fills in parts Modules didn't have. Checking Modules alone
    // missed any part that only exists in the new machine's Full BOM (or a
    // machine with no Modules uploaded at all), leaving its cell blank
    // even though the part is genuinely present.
    const allItems: BomItem[] = [];
    for (const m of machineRows ?? []) {
      allItems.push(...(await fetchAllBomItems(supabase, m.id as number, m.source_file as string)));
    }
    allItems.push(...(await fetchFullBomItems(supabase, machineName)));

    const filledSlotIds = new Set<number>(alreadyFilledSlotIds);
    const toInsert: { part_no: string; custom_name: string; machine_name: string; slot_id: number }[] = [];
    for (const item of allItems) {
      let slotIds = byPartNo.get(item.part_no);
      if (!slotIds || slotIds.size === 0) {
        slotIds = byDescription.get(normalizeDescription(item.description));
      }
      if (!slotIds || slotIds.size === 0) continue;
      for (const slotId of slotIds) {
        if (filledSlotIds.has(slotId)) continue; // first BOM match wins per slot
        const slot = slots.find((s) => s.id === slotId);
        if (!slot) continue;
        filledSlotIds.add(slotId);
        toInsert.push({ part_no: item.part_no, custom_name: slot.custom_name, machine_name: machineName, slot_id: slotId });
      }
    }

    if (toInsert.length === 0) return 0;
    const { error: insertErr } = await supabase.from("key_parts").insert(toInsert);
    if (insertErr) throw new Error(insertErr.message);
    return toInsert.length;
  }

  async function addMachine() {
    if (addingMachine) return;
    const name = addMachineValue.trim();
    if (!name) return;
    if (machines.includes(name)) {
      setAddMachineError(t("This machine is already in this tool type"));
      return;
    }

    setAddMachineError(null);
    setAddingMachine(true);
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
      if (allowedMachines) await loadForToolType(selectedToolType, allowedMachines);
      loadToolTypes();
    } catch (err) {
      setAddMachineError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingMachine(false);
    }
  }

  async function removeMachine(name: string) {
    if (
      !window.confirm(
        t(
          "Remove \"{name}\" from this tool type's table? (The machine itself and its uploaded BOM won't be deleted)"
        ).replace("{name}", name)
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

    // Same validation as an Excel template upload, just for this one cell:
    // check the new value against the machine's actual Full BOM/Modules
    // data (cached per machine, see getMachineLookup above) before writing
    // anything. If it's not found anywhere, ask for confirmation instead of
    // silently saving a likely typo — declining leaves the cell unchanged.
    let foundInModules: string[] | null = null;
    try {
      const lookup = await getMachineLookup(machineName);
      const inFullBom = lookup.fullBomPartNos.has(newValue);
      const moduleSources = lookup.modulePartNoSources.get(newValue) ?? null;
      foundInModules = moduleSources && moduleSources.length > 0 ? moduleSources : null;
      if (!inFullBom && !foundInModules) {
        const proceed = window.confirm(
          t(
            "\"{value}\" wasn't found in {machine}'s Full BOM or Modules data — it may be a typo. Save it anyway?"
          )
            .replace("{value}", newValue)
            .replace("{machine}", machineName)
        );
        // Kept in English regardless of locale — the catch block below
        // matches this exact prefix via startsWith("Cancelled") to
        // distinguish a user's decline from an unrelated lookup failure.
        if (!proceed) throw new Error("Cancelled — not found in Full BOM or Modules");
      }
    } catch (err) {
      // A validation-lookup failure (e.g. network hiccup) shouldn't block
      // saving — fall back to saving without the found_in_modules info,
      // same as before this validation existed. A user-declined
      // confirmation is a real cancellation and must still abort, though.
      if (err instanceof Error && err.message.startsWith("Cancelled")) throw err;
    }

    if (existing) {
      const { error } = await supabase
        .from("key_parts")
        .update({ part_no: newValue, found_in_modules: foundInModules })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      setCells((prev) => {
        const next = new Map(prev);
        next.set(key, { id: existing.id, part_no: newValue, foundInModules });
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
        found_in_modules: foundInModules,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    setCells((prev) => {
      const next = new Map(prev);
      next.set(key, { id: data!.id as number, part_no: newValue, foundInModules });
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
   * Actually writes a set of classified cells to key_parts (insert-or-update,
   * same semantics as before: blank cells never reach here at all, so
   * existing data for cells not present in this batch is left untouched).
   * Shared by the no-issues-found fast path and both "proceed anyway"
   * choices from the not-found-parts dialog.
   */
  async function applyUploadPlan(cellsToApply: ClassifiedCell[]) {
    if (cellsToApply.length === 0) return;
    const supabase = getSupabase();

    const allSlotIds = Array.from(new Set(cellsToApply.map((c) => c.slotId)));
    const allMachineNamesInPlan = Array.from(new Set(cellsToApply.map((c) => c.machineName)));
    const { data: existingRows, error: existingErr } = await supabase
      .from("key_parts")
      .select("id,slot_id,machine_name")
      .in("slot_id", allSlotIds)
      .in("machine_name", allMachineNamesInPlan);
    if (existingErr) throw new Error(existingErr.message);
    const existingIdByKey = new Map<string, number>();
    for (const r of existingRows ?? []) {
      existingIdByKey.set(`${r.slot_id}::${r.machine_name}`, r.id as number);
    }

    const toInsert: {
      part_no: string;
      custom_name: string;
      machine_name: string;
      slot_id: number;
      found_in_modules: string[] | null;
    }[] = [];
    const toUpdate: { id: number; part_no: string; found_in_modules: string[] | null }[] = [];

    for (const c of cellsToApply) {
      const existingId = existingIdByKey.get(`${c.slotId}::${c.machineName}`);
      if (existingId) {
        toUpdate.push({ id: existingId, part_no: c.partNo, found_in_modules: c.foundInModules });
      } else {
        toInsert.push({
          part_no: c.partNo,
          custom_name: c.customName,
          machine_name: c.machineName,
          slot_id: c.slotId,
          found_in_modules: c.foundInModules,
        });
      }
    }

    for (const batch of chunk(toInsert, 500)) {
      const { error } = await supabase.from("key_parts").insert(batch);
      if (error) throw new Error(error.message);
    }

    for (const batch of chunk(toUpdate, 20)) {
      const results = await Promise.all(
        batch.map((u) =>
          supabase.from("key_parts").update({ part_no: u.part_no, found_in_modules: u.found_in_modules }).eq("id", u.id)
        )
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message);
    }

    if (allowedMachines) await loadForToolType(selectedToolType, allowedMachines);
    loadToolTypes();
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
   *
   * Every non-blank cell is validated against its machine's Full BOM and
   * Modules data: found in Modules (possibly more than one) gets recorded
   * so the table can show it; found only in Full BOM (or only in Modules)
   * still goes through as normal; found in neither pauses the whole upload
   * and shows a confirmation dialog instead of silently writing what's
   * likely a typo'd/wrong part number.
   */
  async function handleTemplateFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      if (rows.length < 2) throw new Error(t("This file has no data rows besides the header"));

      const header = rows[0].map((h) => (h ?? "").toString().trim());
      const categoryIdx = header.findIndex((h) => h.toLowerCase() === "category");
      const slotNameIdx = header.findIndex((h) => h.toLowerCase() === "slot name");
      if (categoryIdx === -1 || slotNameIdx === -1) {
        throw new Error(t("Required columns not found (\"Category\" / \"Slot Name\") — check the file format"));
      }

      const machineCols = header
        .map((h, idx) => ({ h, idx }))
        .filter(({ h, idx }) => idx !== categoryIdx && idx !== slotNameIdx && allMachineNames.includes(h));
      if (machineCols.length === 0) {
        throw new Error(
          t("No matching machine columns found — column headers must exactly match an existing machine name")
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
        if (addMachinesErr)
          throw new Error(`${t("Failed to add machine(s) to this tool type:")} ${addMachinesErr.message}`);
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
        if (error)
          throw new Error(
            `${t("Failed to create row \"{row}\":").replace("{row}", `${category} / ${customName}`)} ${error.message}`
          );
        nextSortOrder += 10;
        slotByKey.set(key, data as KeyPartSlot);
      }

      // Pass 2: validate every non-blank cell against its machine's Full
      // BOM + Modules data. One lookup per distinct machine (via the same
      // page-lifetime cache manual cell edits use), fetched in parallel,
      // reused across every cell for that machine.
      const involvedMachines = Array.from(new Set(machineCols.map((c) => c.h)));
      const lookupByMachine = new Map<string, MachineBomLookup>();
      await Promise.all(
        involvedMachines.map(async (m) => {
          lookupByMachine.set(m, await getMachineLookup(m));
        })
      );

      const foundCells: ClassifiedCell[] = [];
      const notFoundCells: ClassifiedCell[] = [];

      for (const row of dataRows) {
        const category = (row[categoryIdx] ?? "").toString().trim();
        const customName = (row[slotNameIdx] ?? "").toString().trim();
        if (!category || !customName) continue;
        const slot = slotByKey.get(`${category}::${customName}`);
        if (!slot) continue;

        for (const { h: machineName, idx } of machineCols) {
          const value = (row[idx] ?? "").toString().trim();
          if (!value) continue;

          const lookup = lookupByMachine.get(machineName);
          const inFullBom = lookup?.fullBomPartNos.has(value) ?? false;
          const moduleSources = lookup?.modulePartNoSources.get(value) ?? null;
          const foundInModules = moduleSources && moduleSources.length > 0 ? moduleSources : null;

          const entry: ClassifiedCell = {
            category,
            customName,
            slotId: slot.id,
            machineName,
            partNo: value,
            foundInModules,
          };
          if (inFullBom || foundInModules) foundCells.push(entry);
          else notFoundCells.push(entry);
        }
      }

      if (notFoundCells.length > 0) {
        // Pause here — applyUploadPlan runs later from the dialog's own
        // handlers once the user picks how to proceed.
        setPendingUpload({ foundCells, notFoundCells });
        return;
      }

      await applyUploadPlan(foundCells);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function confirmPendingUpload(includeNotFound: boolean) {
    if (!pendingUpload) return;
    setApplyingUpload(true);
    setUploadError(null);
    try {
      const cellsToApply = includeNotFound
        ? [...pendingUpload.foundCells, ...pendingUpload.notFoundCells]
        : pendingUpload.foundCells;
      await applyUploadPlan(cellsToApply);
      setPendingUpload(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingUpload(false);
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
      <div className="mx-auto max-w-[1800px] px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Key Parts Fingerprint")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("View/edit each machine's key part numbers by tool type — reads and writes directly to key_parts.")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Button variant="outline" size="icon" asChild aria-label={t("Back to Comparison Tool")}>
              <Link href="/lambom">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("Select Tool Type")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">{t("Tool Type")}</label>
              <Select value={selectedToolType} onValueChange={setSelectedToolType}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder={t("Select tool type")} />
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
              <label className="text-sm font-medium">{t("Or add a new tool type")}</label>
              <div className="flex gap-2">
                <Input
                  value={newToolType}
                  onChange={(e) => setNewToolType(e.target.value)}
                  placeholder={t("e.g. Core-Buffing OX")}
                  className="w-56"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateToolType();
                  }}
                />
                <Button variant="outline" onClick={handleCreateToolType}>
                  {t("Add")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        {!selectedToolType ? (
          <p className="text-muted-foreground text-sm italic">{t("Select or add a tool type first.")}</p>
        ) : (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>{selectedToolType}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  list="fingerprint-all-machines"
                  value={addMachineValue}
                  onChange={(e) => setAddMachineValue(e.target.value)}
                  placeholder={t("Add a machine column (e.g. ACOXN1)")}
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
                <Button size="sm" variant="outline" disabled={addingMachine} onClick={addMachine}>
                  {addingMachine ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {addingMachine ? t("Adding…") : t("Add Machine")}
                </Button>
                <Button size="sm" variant="outline" onClick={downloadTemplate}>
                  <Download className="h-4 w-4" />
                  {t("Download Template")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploading || pendingUpload !== null}
                  onClick={() => templateFileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? t("Uploading…") : t("Upload Template")}
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
                <Button size="sm" variant="outline" onClick={() => setEditMode((v) => !v)}>
                  {editMode ? <Check className="h-4 w-4 text-emerald-600" /> : <Pencil className="h-4 w-4" />}
                  {editMode ? t("Done") : t("Edit Table")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {addMachineError && <p className="text-destructive mb-3 text-sm">{addMachineError}</p>}
              {uploadError && (
                <p className="text-destructive mb-3 text-sm">
                  {t("Template upload failed:")} {uploadError}
                </p>
              )}

              <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border p-3">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">{t("Category")}</label>
                  <Input
                    list="fingerprint-categories"
                    value={newRowCategory}
                    onChange={(e) => setNewRowCategory(e.target.value)}
                    placeholder={t("e.g. Front End")}
                    className="w-40"
                  />
                  <datalist id="fingerprint-categories">
                    {existingCategories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">{t("Slot Name")}</label>
                  <Input
                    value={newRowName}
                    onChange={(e) => setNewRowName(e.target.value)}
                    placeholder={t("e.g. PodLoader#1")}
                    className="w-48"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addSlot();
                    }}
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">{t("Color")}</label>
                  <ColorPickerPopover value={newRowColor} onChange={(c) => setNewRowColor(c)}>
                    <ColorSwatchTrigger color={newRowColor} />
                  </ColorPickerPopover>
                </div>
                <Button size="sm" onClick={addSlot}>
                  <Plus className="h-4 w-4" />
                  {t("Add Row")}
                </Button>
                {addRowError && <p className="text-destructive text-xs">{addRowError}</p>}
                <p className="text-muted-foreground w-full text-xs">
                  {t(
                    "Color only applies to a brand-new category; if the category already exists, its existing color is kept (you can change it via the category color swatch in the table below)."
                  )}
                </p>
              </div>

              {loading ? (
                <p className="text-muted-foreground text-sm">{t("Loading…")}</p>
              ) : slots.length === 0 ? (
                <p className="text-muted-foreground text-sm italic">
                  {t("This tool type has no rows yet — add one above.")}
                </p>
              ) : (
                <Table containerClassName="max-h-[70vh] overflow-y-auto">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="bg-card sticky top-0 left-0 z-20 w-10 min-w-[40px] max-w-[40px]" />
                      <TableHead className="bg-card sticky top-0 left-10 z-20 min-w-[180px]">{t("Slot")}</TableHead>
                      {machines.map((m) => (
                        <TableHead key={m} className="bg-card sticky top-0 z-10 min-w-[160px]">
                          <div className="flex items-center justify-between gap-1">
                            {m}
                            {editMode && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t("Remove machine {machine}").replace("{machine}", m)}
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
                          {t("No machines yet — add one above")}
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) =>
                      group.rows.map((slot, i) => (
                        <TableRow key={slot.id}>
                          {/* rowSpan merges every row of this category into
                           * one cell, same as before — a sticky <td> with
                           * rowSpan turned out NOT to be the cause of an
                           * earlier "bleed-through" scare (that was just
                           * normal partial-column scroll visibility,
                           * confirmed by reproducing it at plain scroll
                           * positions regardless of rowSpan). Repeating this
                           * cell per row instead loses the vertically-
                           * centered label and adds a row border through
                           * the middle of each color block, so rowSpan is
                           * the right call here. */}
                          {i === 0 && (
                            <TableCell
                              rowSpan={group.rows.length}
                              className={cn(
                                "sticky left-0 z-10 w-10 min-w-[40px] max-w-[40px] p-1 text-center align-middle",
                                !group.color && categoryColor(group.category)
                              )}
                              style={group.color ? { backgroundColor: group.color } : undefined}
                            >
                              {/* Category cell backgrounds are always a light
                               * pastel shade regardless of light/dark mode,
                               * so the text/icon color is pinned to black
                               * here — dark mode's default light text was
                               * unreadable against them. */}
                              <div className="flex flex-col items-center gap-1 text-black">
                                {editMode && (
                                  <CategoryEditPopover
                                    category={group.category}
                                    color={group.color}
                                    onRename={(newValue) => renameCategory(group.category, newValue)}
                                    onColorChange={(c) => setCategoryColor(group.category, c)}
                                  >
                                    <button
                                      type="button"
                                      aria-label={t('Edit category "{category}"').replace(
                                        "{category}",
                                        group.category
                                      )}
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
                          <TableCell className="bg-card sticky left-10 z-10 font-medium whitespace-normal">
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
                                  aria-label={t("Delete this row")}
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
                                  foundInModules={cell?.foundInModules}
                                  onViewPosition={
                                    cell?.part_no ? () => openPositionDialog(cell.part_no, m) : undefined
                                  }
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

      <Dialog open={pendingUpload !== null} onOpenChange={(open) => !open && !applyingUpload && setPendingUpload(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Some part numbers weren't found")}</DialogTitle>
            <DialogDescription>
              {t(
                "{notFoundCount} part number(s) in this file don't appear in the target machine's Full BOM or Modules data at all — possibly a typo. {foundCount} other cell(s) were verified fine and aren't affected by this choice."
              )
                .replace("{notFoundCount}", String(pendingUpload?.notFoundCells.length ?? 0))
                .replace("{foundCount}", String(pendingUpload?.foundCells.length ?? 0))}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Machine")}</TableHead>
                  <TableHead>{t("Category")}</TableHead>
                  <TableHead>{t("Slot")}</TableHead>
                  <TableHead>{t("Part No.")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingUpload?.notFoundCells.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>{c.machineName}</TableCell>
                    <TableCell>{c.category}</TableCell>
                    <TableCell>{c.customName}</TableCell>
                    <TableCell className="font-mono text-xs">{c.partNo}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {uploadError && <p className="text-destructive text-sm">{uploadError}</p>}

          <DialogFooter>
            <Button variant="outline" disabled={applyingUpload} onClick={() => setPendingUpload(null)}>
              {t("Cancel Upload")}
            </Button>
            <Button variant="outline" disabled={applyingUpload} onClick={() => confirmPendingUpload(false)}>
              {applyingUpload ? t("Working…") : t("Skip These, Add the Rest")}
            </Button>
            <Button disabled={applyingUpload} onClick={() => confirmPendingUpload(true)}>
              {applyingUpload ? t("Working…") : t("Add All Anyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PartPositionDialog
        open={positionTarget !== null}
        onOpenChange={(open) => !open && setPositionTarget(null)}
        target={positionTarget}
        mode="both"
        getFullBomTree={getFullBomTree}
        getModules={getModules}
        getModuleTree={getModuleTree}
      />
    </div>
  );
}
