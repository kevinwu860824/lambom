"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  aggregateByPartNo,
  fetchAllBomItems,
  fetchMachineGroups,
  type AggregatedItem,
  type BomEntry,
  type MachineGroup,
} from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EditableField } from "@/components/editable-field";

interface KeyPart {
  id: number;
  part_no: string;
  description: string | null;
  custom_name: string;
}

interface CheckResult {
  keyPart: KeyPart;
  status: "same" | "renamed" | "missing";
  matches: AggregatedItem[];
}

function normalizeDescription(desc: string | null): string {
  return (desc ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export default function KeyPartsPage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }

  const [keyParts, setKeyParts] = useState<KeyPart[]>([]);
  const [keyPartsLoading, setKeyPartsLoading] = useState(true);
  const [keyPartsError, setKeyPartsError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [machineGroups, setMachineGroups] = useState<MachineGroup[]>([]);
  const [machineLoading, setMachineLoading] = useState(true);
  const [machineError, setMachineError] = useState<string | null>(null);
  const [selectedMachine, setSelectedMachine] = useState("");
  const [selectedSubpart, setSelectedSubpart] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [results, setResults] = useState<CheckResult[] | null>(null);

  async function loadKeyParts() {
    setKeyPartsLoading(true);
    setKeyPartsError(null);
    try {
      const { data, error } = await getSupabase()
        .from("key_parts")
        .select("id,part_no,description,custom_name")
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      setKeyParts(data ?? []);
    } catch (err) {
      setKeyPartsError(err instanceof Error ? err.message : String(err));
    } finally {
      setKeyPartsLoading(false);
    }
  }

  async function loadMachines() {
    setMachineLoading(true);
    setMachineError(null);
    try {
      const { machineGroups: groups } = await fetchMachineGroups(getSupabase());
      setMachineGroups(groups);
      const firstGroup = groups[0] ?? null;
      setSelectedMachine(firstGroup?.machine ?? "");
      setSelectedSubpart(firstGroup?.subparts[0]?.source_file ?? "");
    } catch (err) {
      setMachineError(err instanceof Error ? err.message : String(err));
    } finally {
      setMachineLoading(false);
    }
  }

  useEffect(() => {
    loadKeyParts();
    loadMachines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function subpartsFor(machine: string): BomEntry[] {
    return machineGroups.find((g) => g.machine === machine)?.subparts ?? [];
  }

  function handleMachineChange(machine: string) {
    setSelectedMachine(machine);
    setSelectedSubpart(subpartsFor(machine)[0]?.source_file ?? "");
  }

  async function renameKeyPart(id: number, newName: string) {
    const { error } = await getSupabase()
      .from("key_parts")
      .update({ custom_name: newName })
      .eq("id", id);
    if (error) throw new Error(error.message);
    setKeyParts((prev) => prev.map((p) => (p.id === id ? { ...p, custom_name: newName } : p)));
  }

  async function deleteKeyPart(id: number) {
    if (!window.confirm("確定要刪除這個重要零件嗎?")) return;

    setDeletingId(id);
    try {
      const { error } = await getSupabase().from("key_parts").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setKeyParts((prev) => prev.filter((p) => p.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      setKeyPartsError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === keyParts.length ? new Set() : new Set(keyParts.map((p) => p.id))));
  }

  async function handleCompare() {
    const bomEntry = subpartsFor(selectedMachine).find((s) => s.source_file === selectedSubpart);
    if (!bomEntry || selectedIds.size === 0) return;

    setCompareLoading(true);
    setCompareError(null);
    setResults(null);

    try {
      const items = await fetchAllBomItems(getSupabase(), bomEntry.bomId, bomEntry.source_file);
      const byPartNo = aggregateByPartNo(items);

      const byDescription = new Map<string, AggregatedItem[]>();
      for (const item of byPartNo.values()) {
        const key = normalizeDescription(item.description);
        if (!key) continue;
        if (!byDescription.has(key)) byDescription.set(key, []);
        byDescription.get(key)!.push(item);
      }

      const selectedParts = keyParts.filter((p) => selectedIds.has(p.id));
      const rows: CheckResult[] = selectedParts.map((keyPart) => {
        const exact = byPartNo.get(keyPart.part_no);
        if (exact) {
          return { keyPart, status: "same", matches: [exact] };
        }

        const descKey = normalizeDescription(keyPart.description);
        const candidates = descKey ? (byDescription.get(descKey) ?? []) : [];
        if (candidates.length > 0) {
          return { keyPart, status: "renamed", matches: candidates };
        }

        return { keyPart, status: "missing", matches: [] };
      });

      setResults(rows);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompareLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1600px] px-4 py-8 md:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">重要零件追蹤</h1>
          <p className="mt-1 text-sm text-white/70">
            標記關鍵零件,之後只要挑選要檢查的項目,就能知道新機台裡是不是還用同一顆料號、或是被改了料號。
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>重要零件清單</CardTitle>
          </CardHeader>
          <CardContent>
            {keyPartsError && <p className="text-destructive mb-3 text-sm">{keyPartsError}</p>}
            {keyPartsLoading ? (
              <p className="text-muted-foreground text-sm">載入中…</p>
            ) : keyParts.length === 0 ? (
              <p className="text-muted-foreground text-sm italic">
                還沒有重要零件,先到首頁的「料號/描述搜尋」結果列加入。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={keyParts.length > 0 && selectedIds.size === keyParts.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>自訂名稱</TableHead>
                    <TableHead>料號</TableHead>
                    <TableHead>描述</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keyParts.map((part) => (
                    <TableRow key={part.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(part.id)}
                          onCheckedChange={() => toggleSelected(part.id)}
                        />
                      </TableCell>
                      <TableCell className="min-w-[200px]">
                        <EditableField
                          value={part.custom_name}
                          onSave={(newValue) => renameKeyPart(part.id, newValue)}
                        />
                      </TableCell>
                      <TableCell>{part.part_no}</TableCell>
                      <TableCell>{part.description}</TableCell>
                      <TableCell>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="刪除重要零件"
                          disabled={deletingId === part.id}
                          onClick={() => deleteKeyPart(part.id)}
                        >
                          <Trash2 className="text-destructive h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>比對新機台</CardTitle>
          </CardHeader>
          <CardContent>
            {machineError && <p className="text-destructive mb-3 text-sm">{machineError}</p>}
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">機台</label>
                <Select
                  value={selectedMachine}
                  onValueChange={handleMachineChange}
                  disabled={machineLoading}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="選擇機台" />
                  </SelectTrigger>
                  <SelectContent>
                    {machineGroups.map((group) => (
                      <SelectItem key={group.machine} value={group.machine}>
                        {group.machine}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">子項</label>
                <Select
                  value={selectedSubpart}
                  onValueChange={setSelectedSubpart}
                  disabled={machineLoading}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="選擇子項" />
                  </SelectTrigger>
                  <SelectContent>
                    {subpartsFor(selectedMachine).map((entry) => (
                      <SelectItem key={entry.source_file} value={entry.source_file}>
                        {entry.source_file}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleCompare}
                disabled={
                  machineLoading || compareLoading || selectedIds.size === 0 || !selectedSubpart
                }
              >
                {compareLoading ? "比對中…" : `開始比對(${selectedIds.size})`}
              </Button>
            </div>

            {compareError && <p className="text-destructive mt-4 text-sm">{compareError}</p>}

            {results && (
              <div className="mt-6 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>自訂名稱</TableHead>
                      <TableHead>原料號</TableHead>
                      <TableHead>原描述</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead>新機台料號</TableHead>
                      <TableHead>新機台描述</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((row) =>
                      row.matches.length > 0 ? (
                        row.matches.map((match, i) => (
                          <TableRow key={`${row.keyPart.id}-${i}`}>
                            {i === 0 && (
                              <>
                                <TableCell rowSpan={row.matches.length}>
                                  {row.keyPart.custom_name}
                                </TableCell>
                                <TableCell rowSpan={row.matches.length}>
                                  {row.keyPart.part_no}
                                </TableCell>
                                <TableCell rowSpan={row.matches.length}>
                                  {row.keyPart.description}
                                </TableCell>
                                <TableCell rowSpan={row.matches.length}>
                                  {row.status === "same" ? (
                                    <Badge variant="secondary">相同料號</Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="border-amber-400 text-amber-700"
                                    >
                                      料號可能變更
                                    </Badge>
                                  )}
                                </TableCell>
                              </>
                            )}
                            <TableCell>{match.part_no}</TableCell>
                            <TableCell>{match.description}</TableCell>
                            <TableCell>{match.qty}</TableCell>
                            <TableCell>{match.uom}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow key={row.keyPart.id}>
                          <TableCell>{row.keyPart.custom_name}</TableCell>
                          <TableCell>{row.keyPart.part_no}</TableCell>
                          <TableCell>{row.keyPart.description}</TableCell>
                          <TableCell>
                            <Badge variant="destructive">找不到</Badge>
                          </TableCell>
                          <TableCell>-</TableCell>
                          <TableCell>-</TableCell>
                          <TableCell>-</TableCell>
                          <TableCell>-</TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
