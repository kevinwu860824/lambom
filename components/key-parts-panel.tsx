"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  checkKeyParts,
  type BomEntry,
  type KeyPart,
  type KeyPartCheckResult,
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
import { cn } from "@/lib/utils";

const ALL_MACHINES = "__all__";

function formatMatches(matches: KeyPartCheckResult["matches"]): string {
  if (matches.length === 0) return "-";
  return matches
    .map((m) => `${m.part_no}${m.description ? `(${m.description})` : ""}`)
    .join("、");
}

function StatusBadge({ status }: { status: KeyPartCheckResult["status"] }) {
  if (status === "same") return <Badge variant="secondary">相同料號</Badge>;
  if (status === "renamed")
    return (
      <Badge variant="outline" className="border-amber-400 text-amber-700">
        料號可能變更
      </Badge>
    );
  return <Badge variant="destructive">找不到</Badge>;
}

export function KeyPartsPanel({
  machineA,
  subpartsA,
  machineB,
  subpartsB,
  subpartsFor,
  combineAndLoad,
}: {
  machineA: string;
  subpartsA: Set<string>;
  machineB: string;
  subpartsB: Set<string>;
  subpartsFor: (machine: string) => BomEntry[];
  combineAndLoad: (machine: string, entries: BomEntry[]) => Promise<BomEntry | null>;
}) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }

  const [expanded, setExpanded] = useState(false);

  const [keyParts, setKeyParts] = useState<KeyPart[]>([]);
  const [keyPartsLoading, setKeyPartsLoading] = useState(true);
  const [keyPartsError, setKeyPartsError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [machineFilter, setMachineFilter] = useState(ALL_MACHINES);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [checkLoading, setCheckLoading] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkedParts, setCheckedParts] = useState<KeyPart[] | null>(null);
  const [resultsA, setResultsA] = useState<KeyPartCheckResult[] | null>(null);
  const [resultsB, setResultsB] = useState<KeyPartCheckResult[] | null>(null);

  async function loadKeyParts() {
    setKeyPartsLoading(true);
    setKeyPartsError(null);
    try {
      const { data, error } = await getSupabase()
        .from("key_parts")
        .select("id,part_no,description,custom_name,machine_name,source_file")
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      setKeyParts(data ?? []);
    } catch (err) {
      setKeyPartsError(err instanceof Error ? err.message : String(err));
    } finally {
      setKeyPartsLoading(false);
    }
  }

  useEffect(() => {
    loadKeyParts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const machineOptions = Array.from(
    new Set(keyParts.map((p) => p.machine_name).filter((m): m is string => Boolean(m)))
  ).sort();

  const filteredKeyParts =
    machineFilter === ALL_MACHINES
      ? keyParts
      : keyParts.filter((p) => p.machine_name === machineFilter);

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === filteredKeyParts.length ? new Set() : new Set(filteredKeyParts.map((p) => p.id))
    );
  }

  async function handleCheck() {
    const selectedParts = keyParts.filter((p) => selectedIds.has(p.id));
    if (selectedParts.length === 0) return;

    setCheckLoading(true);
    setCheckError(null);

    try {
      const entriesA = subpartsFor(machineA).filter((e) => subpartsA.has(e.source_file));
      const entriesB = subpartsFor(machineB).filter((e) => subpartsB.has(e.source_file));

      const [bomA, bomB] = await Promise.all([
        combineAndLoad(machineA, entriesA),
        combineAndLoad(machineB, entriesB),
      ]);

      if (!bomA || !bomB) {
        setCheckError("請先在上方「選擇比對對象」選好機台 A / B 及子項");
        return;
      }

      setCheckedParts(selectedParts);
      setResultsA(checkKeyParts(selectedParts, bomA.items));
      setResultsB(checkKeyParts(selectedParts, bomB.items));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckLoading(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
        }}
        className="flex cursor-pointer select-none flex-row items-center justify-between"
      >
        <CardTitle>重要零件比對</CardTitle>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
        />
      </CardHeader>

      {expanded && (
        <CardContent>
          {keyPartsError && <p className="text-destructive mb-3 text-sm">{keyPartsError}</p>}

          {!keyPartsLoading && keyParts.length > 0 && (
            <div className="mb-4 grid max-w-xs gap-1.5">
              <label className="text-sm font-medium">機台篩選</label>
              <Select value={machineFilter} onValueChange={setMachineFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="選擇機台" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_MACHINES}>全部機台</SelectItem>
                  {machineOptions.map((machine) => (
                    <SelectItem key={machine} value={machine}>
                      {machine}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {keyPartsLoading ? (
            <p className="text-muted-foreground text-sm">載入中…</p>
          ) : keyParts.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">
              還沒有重要零件,先到上方的「料號/描述搜尋」結果列加入。
            </p>
          ) : filteredKeyParts.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">這台機台沒有標記過的重要零件。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        filteredKeyParts.length > 0 && selectedIds.size === filteredKeyParts.length
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>自訂名稱</TableHead>
                  <TableHead>來源機台</TableHead>
                  <TableHead>子項</TableHead>
                  <TableHead>料號</TableHead>
                  <TableHead>描述</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredKeyParts.map((part) => (
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
                    <TableCell>{part.machine_name ?? "-"}</TableCell>
                    <TableCell>{part.source_file ?? "-"}</TableCell>
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

          <div className="mt-4 flex items-center gap-3 border-t pt-4">
            <p className="text-muted-foreground text-sm">
              將對照上方已選的機台 A(<span className="font-medium">{machineA || "未選擇"}</span>)與機台
              B(<span className="font-medium">{machineB || "未選擇"}</span>)
            </p>
            <Button
              className="ml-auto shrink-0"
              onClick={handleCheck}
              disabled={
                checkLoading ||
                selectedIds.size === 0 ||
                !machineA ||
                !machineB ||
                subpartsA.size === 0 ||
                subpartsB.size === 0
              }
            >
              {checkLoading ? "檢查中…" : `開始檢查(${selectedIds.size})`}
            </Button>
          </div>

          {checkError && <p className="text-destructive mt-3 text-sm">{checkError}</p>}

          {checkedParts && resultsA && resultsB && (
            <div className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>自訂名稱</TableHead>
                    <TableHead>原料號</TableHead>
                    <TableHead>原描述</TableHead>
                    <TableHead>A 狀態</TableHead>
                    <TableHead>A 結果</TableHead>
                    <TableHead>B 狀態</TableHead>
                    <TableHead>B 結果</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checkedParts.map((keyPart, i) => {
                    const a = resultsA[i];
                    const b = resultsB[i];
                    return (
                      <TableRow key={keyPart.id}>
                        <TableCell className="whitespace-nowrap">{keyPart.custom_name}</TableCell>
                        <TableCell className="whitespace-nowrap">{keyPart.part_no}</TableCell>
                        <TableCell>{keyPart.description}</TableCell>
                        <TableCell>
                          <StatusBadge status={a.status} />
                        </TableCell>
                        <TableCell>{formatMatches(a.matches)}</TableCell>
                        <TableCell>
                          <StatusBadge status={b.status} />
                        </TableCell>
                        <TableCell>{formatMatches(b.matches)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
