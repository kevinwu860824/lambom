"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, X as XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
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

interface KeyPartSlot {
  id: number;
  tool_type: string;
  category: string;
  custom_name: string;
  sort_order: number;
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

  const [newRowCategory, setNewRowCategory] = useState("");
  const [newRowName, setNewRowName] = useState("");
  const [addRowError, setAddRowError] = useState<string | null>(null);

  const [addMachineValue, setAddMachineValue] = useState("");
  const [addMachineError, setAddMachineError] = useState<string | null>(null);

  useEffect(() => {
    loadToolTypes();
    loadAllMachineNames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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
          .select("id,tool_type,category,custom_name,sort_order")
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
        minSortOrder: Math.min(...rows.map((r) => r.sort_order)),
      }))
      .sort((a, b) => a.minSortOrder - b.minSortOrder);
  }, [slots]);

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
      setAddRowError("分類跟插槽名稱都要填");
      return;
    }
    if (slots.some((s) => s.category === category && s.custom_name === customName)) {
      setAddRowError("這個分類底下已經有同名的插槽了");
      return;
    }

    setAddRowError(null);
    const nextSortOrder = slots.length > 0 ? Math.max(...slots.map((s) => s.sort_order)) + 10 : 0;

    try {
      const { data, error } = await getSupabase()
        .from("key_part_slots")
        .insert({
          tool_type: selectedToolType,
          category,
          custom_name: customName,
          sort_order: nextSortOrder,
        })
        .select("id,tool_type,category,custom_name,sort_order")
        .single();
      if (error) throw new Error(error.message);

      setSlots((prev) => [...prev, data as KeyPartSlot]);
      setNewRowName("");
    } catch (err) {
      setAddRowError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteSlot(slot: KeyPartSlot) {
    if (
      !window.confirm(`確定要刪除「${slot.custom_name}」這一列嗎?(已填的料號資料不會被刪除)`)
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

  async function addMachine() {
    const name = addMachineValue.trim();
    if (!name) return;
    if (machines.includes(name)) {
      setAddMachineError("這台機台已經在這個機型裡了");
      return;
    }

    setAddMachineError(null);
    try {
      const { error } = await getSupabase()
        .from("bom_machines")
        .update({ tool_type: selectedToolType })
        .eq("machine_name", name);
      if (error) throw new Error(error.message);

      setMachines((prev) => [...prev, name].sort());
      setAddMachineValue("");
      loadToolTypes();
    } catch (err) {
      setAddMachineError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeMachine(name: string) {
    if (
      !window.confirm(
        `確定要把「${name}」從這個機型的表格中移除嗎?(機台本身跟已上傳的 BOM 不會被刪除)`
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

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-[1800px] px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">重要零件指紋表</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              依機型檢視/編輯每台機台的重要零件料號,資料直接讀寫 key_parts。
            </p>
          </div>
          <Link href="/" className="text-sm underline underline-offset-4">
            回到比對工具
          </Link>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>選擇機型</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">機型</label>
              <Select value={selectedToolType} onValueChange={setSelectedToolType}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="選擇機型" />
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
              <label className="text-sm font-medium">或新增機型</label>
              <div className="flex gap-2">
                <Input
                  value={newToolType}
                  onChange={(e) => setNewToolType(e.target.value)}
                  placeholder="例如 Core-Buffing OX"
                  className="w-56"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateToolType();
                  }}
                />
                <Button variant="outline" onClick={handleCreateToolType}>
                  新增
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        {!selectedToolType ? (
          <p className="text-muted-foreground text-sm italic">請先選擇或新增一個機型。</p>
        ) : (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>{selectedToolType}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  list="fingerprint-all-machines"
                  value={addMachineValue}
                  onChange={(e) => setAddMachineValue(e.target.value)}
                  placeholder="新增機台欄位(例如 ACOXN1)"
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
                  加入機台
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {addMachineError && <p className="text-destructive mb-3 text-sm">{addMachineError}</p>}

              <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border p-3">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">分類</label>
                  <Input
                    list="fingerprint-categories"
                    value={newRowCategory}
                    onChange={(e) => setNewRowCategory(e.target.value)}
                    placeholder="例如 Front End"
                    className="w-40"
                  />
                  <datalist id="fingerprint-categories">
                    {existingCategories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">插槽名稱</label>
                  <Input
                    value={newRowName}
                    onChange={(e) => setNewRowName(e.target.value)}
                    placeholder="例如 PodLoader#1"
                    className="w-48"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addSlot();
                    }}
                  />
                </div>
                <Button size="sm" onClick={addSlot}>
                  <Plus className="h-4 w-4" />
                  新增一列
                </Button>
                {addRowError && <p className="text-destructive text-xs">{addRowError}</p>}
              </div>

              {loading ? (
                <p className="text-muted-foreground text-sm">載入中…</p>
              ) : slots.length === 0 ? (
                <p className="text-muted-foreground text-sm italic">
                  這個機型還沒有任何列,先在上面新增一列。
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead className="min-w-[180px]">插槽</TableHead>
                        {machines.map((m) => (
                          <TableHead key={m} className="min-w-[160px]">
                            <div className="flex items-center justify-between gap-1">
                              {m}
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`移除機台 ${m}`}
                                onClick={() => removeMachine(m)}
                              >
                                <XIcon className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableHead>
                        ))}
                        {machines.length === 0 && (
                          <TableHead className="text-muted-foreground font-normal">
                            還沒有機台,先在上面加入
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
                                  "w-10 text-center align-middle text-xs font-semibold whitespace-normal [writing-mode:vertical-rl]",
                                  categoryColor(group.category)
                                )}
                              >
                                {group.category}
                              </TableCell>
                            )}
                            <TableCell className="font-medium whitespace-normal">
                              <div className="flex items-center justify-between gap-1">
                                {slot.custom_name}
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label="刪除這一列"
                                  onClick={() => deleteSlot(slot)}
                                >
                                  <Trash2 className="text-destructive h-3.5 w-3.5" />
                                </Button>
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
                                  />
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
