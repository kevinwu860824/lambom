"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import {
  aggregateByPartNo,
  compareBoms,
  type BomEntry,
  type CompareResult,
  type MachineGroup,
} from "@/lib/bom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { AggregatedItem } from "@/lib/bom";

interface BomSummary {
  machine: string;
  source_file: string;
  itemCount: number;
  uniqueCount: number;
}

export default function Home() {
  // Created lazily on first use inside an effect/handler rather than during
  // render, so this never runs during Next.js's server-side prerender pass.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }

  const bomDataRef = useRef<BomEntry[]>([]);

  const [machineGroups, setMachineGroups] = useState<MachineGroup[]>([]);
  const [machineA, setMachineA] = useState("");
  const [subpartA, setSubpartA] = useState("");
  const [machineB, setMachineB] = useState("");
  const [subpartB, setSubpartB] = useState("");

  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [summaryA, setSummaryA] = useState<BomSummary | null>(null);
  const [summaryB, setSummaryB] = useState<BomSummary | null>(null);

  function subpartsFor(machine: string): BomEntry[] {
    return machineGroups.find((g) => g.machine === machine)?.subparts ?? [];
  }

  function getSelectedBom(machine: string, sourceFile: string): BomEntry | null {
    return (
      bomDataRef.current.find(
        (entry) => entry.machine === machine && entry.source_file === sourceFile
      ) ?? null
    );
  }

  async function fetchAllBomItems(bomId: number, sourceFile: string) {
    const pageSize = 1000;
    const items: BomEntry["items"] = [];
    let from = 0;

    // The Supabase project caps rows-per-request server-side (db-max-rows),
    // so a single request with a high .limit() is silently truncated.
    // Page through with .range() until a page comes back short.
    for (;;) {
      const { data, error } = await getSupabase()
        .from("bom_items")
        .select("part_no,description,qty,uom")
        .eq("bom_id", bomId)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        throw new Error(`載入子項失敗 (${sourceFile}):${error.message}`);
      }

      if (!data || data.length === 0) break;
      items.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return items;
  }

  async function ensureBomItemsLoaded(bom: BomEntry | null) {
    if (!bom) return null;
    if (bom.itemsLoaded) return bom;

    bom.items = await fetchAllBomItems(bom.bomId, bom.source_file);
    bom.itemsLoaded = true;
    return bom;
  }

  async function runCompare(bomAInput: BomEntry | null, bomBInput: BomEntry | null) {
    setCompareLoading(true);
    setCompareError(null);

    try {
      const [bomA, bomB] = await Promise.all([
        ensureBomItemsLoaded(bomAInput),
        ensureBomItemsLoaded(bomBInput),
      ]);

      if (!bomA || !bomB) {
        return;
      }

      setResult(compareBoms(bomA, bomB));
      setSummaryA({
        machine: bomA.machine,
        source_file: bomA.source_file,
        itemCount: bomA.items.length,
        uniqueCount: aggregateByPartNo(bomA.items).size,
      });
      setSummaryB({
        machine: bomB.machine,
        source_file: bomB.source_file,
        itemCount: bomB.items.length,
        uniqueCount: aggregateByPartNo(bomB.items).size,
      });
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setCompareLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const { data: machines, error } = await getSupabase()
        .from("bom_machines")
        .select("id,machine_name,source_file");

      if (cancelled) return;

      if (error) {
        setInitError(`載入 Supabase 失敗:${error.message}`);
        setInitLoading(false);
        return;
      }

      if (!machines || machines.length === 0) {
        setInitError("Supabase returned no BOM records.");
        setInitLoading(false);
        return;
      }

      const bomData: BomEntry[] = machines.map((machine) => ({
        bomId: machine.id,
        source_file: machine.source_file,
        machine: machine.machine_name,
        items: [],
        itemsLoaded: false,
      }));
      bomDataRef.current = bomData;

      const grouped = new Map<string, BomEntry[]>();
      bomData.forEach((entry) => {
        if (!grouped.has(entry.machine)) {
          grouped.set(entry.machine, []);
        }
        grouped.get(entry.machine)!.push(entry);
      });

      const groups: MachineGroup[] = Array.from(grouped.entries()).map(
        ([machine, subparts]) => ({ machine, subparts })
      );
      setMachineGroups(groups);

      const groupA = groups[0] ?? null;
      const groupB = groups[1] ?? groups[0] ?? null;
      const defaultBomA = groupA?.subparts[0] ?? null;
      const defaultBomB = groupB?.subparts[0] ?? null;

      setMachineA(groupA?.machine ?? "");
      setSubpartA(defaultBomA?.source_file ?? "");
      setMachineB(groupB?.machine ?? "");
      setSubpartB(defaultBomB?.source_file ?? "");

      setInitLoading(false);
      await runCompare(defaultBomA, defaultBomB);
    }

    loadData().catch((err) => {
      if (cancelled) return;
      setInitError(`載入 Supabase 失敗:${err instanceof Error ? err.message : String(err)}`);
      setInitLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMachineAChange(machine: string) {
    setMachineA(machine);
    setSubpartA(subpartsFor(machine)[0]?.source_file ?? "");
  }

  function handleMachineBChange(machine: string) {
    setMachineB(machine);
    setSubpartB(subpartsFor(machine)[0]?.source_file ?? "");
  }

  function handleCompareClick() {
    runCompare(getSelectedBom(machineA, subpartA), getSelectedBom(machineB, subpartB));
  }

  const qtyMismatchCount = result?.common.filter((item) => !item.qtyMatch).length ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">BOM 比對工具</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            從多份機台 BOM 中選擇兩份進行差異比對。
          </p>
        </div>

        {initError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">{initError}</CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>選擇比對對象</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <MachineSelectGroup
                label="A"
                machine={machineA}
                subpart={subpartA}
                machineGroups={machineGroups}
                subparts={subpartsFor(machineA)}
                disabled={initLoading}
                onMachineChange={handleMachineAChange}
                onSubpartChange={setSubpartA}
              />
              <MachineSelectGroup
                label="B"
                machine={machineB}
                subpart={subpartB}
                machineGroups={machineGroups}
                subparts={subpartsFor(machineB)}
                disabled={initLoading}
                onMachineChange={handleMachineBChange}
                onSubpartChange={setSubpartB}
              />
              <Button
                onClick={handleCompareClick}
                disabled={initLoading || compareLoading || !machineA || !machineB}
              >
                {compareLoading ? "比對中…" : "開始比對"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {compareError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">比對失敗:{compareError}</CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>比對摘要</CardTitle>
          </CardHeader>
          <CardContent>
            {compareLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : summaryA && summaryB && result ? (
              <div className="grid gap-2 text-sm">
                <p>
                  <span className="font-medium">{summaryA.machine}</span> / {summaryA.source_file}
                  :明細 {summaryA.itemCount} 項、唯一料號 {summaryA.uniqueCount} 項
                </p>
                <p>
                  <span className="font-medium">{summaryB.machine}</span> / {summaryB.source_file}
                  :明細 {summaryB.itemCount} 項、唯一料號 {summaryB.uniqueCount} 項
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="secondary">共同料號 {result.common.length}</Badge>
                  <Badge variant="outline">僅 A {result.onlyA.length}</Badge>
                  <Badge variant="outline">僅 B {result.onlyB.length}</Badge>
                  <Badge variant={qtyMismatchCount > 0 ? "destructive" : "secondary"}>
                    Qty 不一致 {qtyMismatchCount}
                  </Badge>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">尚無比對資料</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <PartTable title="僅存在於 A" items={result?.onlyA} />
          <PartTable title="僅存在於 B" items={result?.onlyB} />
        </div>
      </div>
    </div>
  );
}

function MachineSelectGroup({
  label,
  machine,
  subpart,
  machineGroups,
  subparts,
  disabled,
  onMachineChange,
  onSubpartChange,
}: {
  label: string;
  machine: string;
  subpart: string;
  machineGroups: MachineGroup[];
  subparts: BomEntry[];
  disabled: boolean;
  onMachineChange: (value: string) => void;
  onSubpartChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <label className="text-sm font-medium">機台 {label}</label>
        <Select value={machine} onValueChange={onMachineChange} disabled={disabled}>
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
        <label className="text-sm font-medium">子項 {label}</label>
        <Select value={subpart} onValueChange={onSubpartChange} disabled={disabled}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="選擇子項" />
          </SelectTrigger>
          <SelectContent>
            {subparts.map((entry) => (
              <SelectItem key={entry.source_file} value={entry.source_file}>
                {entry.source_file}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function PartTable({ title, items }: { title: string; items?: AggregatedItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!items || items.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">沒有資料</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>料號</TableHead>
                <TableHead>描述</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.part_no}>
                  <TableCell>{item.part_no}</TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.qty ?? "-"}</TableCell>
                  <TableCell>{item.uom ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
