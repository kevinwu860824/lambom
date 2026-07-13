"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  aggregateByPartNo,
  compareBoms,
  fetchAllBomItems,
  fetchMachineGroups,
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UploadBomDialog } from "@/components/upload-bom-dialog";
import { EditMachinesDialog } from "@/components/edit-machines-dialog";
import { DescriptionSearch } from "@/components/description-search";
import { KeyPartsPanel } from "@/components/key-parts-panel";
import { exportCompareToExcel } from "@/lib/export-excel";
import type { AggregatedItem, BomSummary } from "@/lib/bom";

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
  const [subpartsA, setSubpartsA] = useState<Set<string>>(new Set());
  const [machineB, setMachineB] = useState("");
  const [subpartsB, setSubpartsB] = useState<Set<string>>(new Set());

  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [summaryA, setSummaryA] = useState<BomSummary | null>(null);
  const [summaryB, setSummaryB] = useState<BomSummary | null>(null);
  const [resultFilter, setResultFilter] = useState("");

  function matchesResultFilter(item: AggregatedItem, keyword: string): boolean {
    const terms = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    const haystack = `${item.part_no} ${item.description ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  function subpartsFor(machine: string): BomEntry[] {
    return machineGroups.find((g) => g.machine === machine)?.subparts ?? [];
  }

  async function ensureBomItemsLoaded(bom: BomEntry | null) {
    if (!bom) return null;
    if (bom.itemsLoaded) return bom;

    bom.items = await fetchAllBomItems(getSupabase(), bom.bomId, bom.source_file);
    bom.itemsLoaded = true;
    return bom;
  }

  async function combineAndLoad(machine: string, entries: BomEntry[]): Promise<BomEntry | null> {
    if (entries.length === 0) return null;

    const loaded = await Promise.all(entries.map((e) => ensureBomItemsLoaded(e)));
    const valid = loaded.filter((e): e is BomEntry => e !== null);
    if (valid.length === 0) return null;

    return {
      bomId: -1,
      source_file: valid.map((e) => e.source_file).join("、"),
      machine,
      items: valid.flatMap((e) => e.items),
      itemsLoaded: true,
    };
  }

  async function runCompare(
    machineAName: string,
    entriesA: BomEntry[],
    machineBName: string,
    entriesB: BomEntry[]
  ) {
    setCompareLoading(true);
    setCompareError(null);

    try {
      const [bomA, bomB] = await Promise.all([
        combineAndLoad(machineAName, entriesA),
        combineAndLoad(machineBName, entriesB),
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

  async function loadData() {
    const { machineGroups: groups, bomData } = await fetchMachineGroups(getSupabase());
    bomDataRef.current = bomData;
    setMachineGroups(groups);

    const groupA = groups[0] ?? null;
    const groupB = groups[1] ?? groups[0] ?? null;
    const machineAName = groupA?.machine ?? "";
    const machineBName = groupB?.machine ?? "";
    const entriesA = groupA?.subparts ?? [];
    const entriesB = groupB?.subparts ?? [];

    setMachineA(machineAName);
    setSubpartsA(new Set(entriesA.map((s) => s.source_file)));
    setMachineB(machineBName);
    setSubpartsB(new Set(entriesB.map((s) => s.source_file)));

    setInitLoading(false);
    await runCompare(machineAName, entriesA, machineBName, entriesB);
  }

  useEffect(() => {
    loadData().catch((err) => {
      setInitError(`載入 Supabase 失敗:${err instanceof Error ? err.message : String(err)}`);
      setInitLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUploaded() {
    setInitLoading(true);
    setInitError(null);
    loadData().catch((err) => {
      setInitError(`載入 Supabase 失敗:${err instanceof Error ? err.message : String(err)}`);
      setInitLoading(false);
    });
  }

  function handleMachineAChange(machine: string) {
    setMachineA(machine);
    setSubpartsA(new Set(subpartsFor(machine).map((s) => s.source_file)));
  }

  function handleMachineBChange(machine: string) {
    setMachineB(machine);
    setSubpartsB(new Set(subpartsFor(machine).map((s) => s.source_file)));
  }

  function toggleSubpartA(sourceFile: string) {
    setSubpartsA((prev) => {
      const next = new Set(prev);
      if (next.has(sourceFile)) next.delete(sourceFile);
      else next.add(sourceFile);
      return next;
    });
  }

  function toggleSubpartB(sourceFile: string) {
    setSubpartsB((prev) => {
      const next = new Set(prev);
      if (next.has(sourceFile)) next.delete(sourceFile);
      else next.add(sourceFile);
      return next;
    });
  }

  function toggleAllSubpartsA() {
    const all = subpartsFor(machineA).map((s) => s.source_file);
    setSubpartsA((prev) => (prev.size === all.length ? new Set() : new Set(all)));
  }

  function toggleAllSubpartsB() {
    const all = subpartsFor(machineB).map((s) => s.source_file);
    setSubpartsB((prev) => (prev.size === all.length ? new Set() : new Set(all)));
  }

  function handleCompareClick() {
    const entriesA = subpartsFor(machineA).filter((e) => subpartsA.has(e.source_file));
    const entriesB = subpartsFor(machineB).filter((e) => subpartsB.has(e.source_file));
    runCompare(machineA, entriesA, machineB, entriesB);
  }

  const qtyMismatchCount = result?.common.filter((item) => !item.qtyMatch).length ?? 0;
  const filteredOnlyA = result?.onlyA.filter((item) => matchesResultFilter(item, resultFilter)) ?? [];
  const filteredOnlyB = result?.onlyB.filter((item) => matchesResultFilter(item, resultFilter)) ?? [];

  function handleExportClick() {
    if (!summaryA || !summaryB || !result) return;
    exportCompareToExcel(summaryA, summaryB, result, filteredOnlyA, filteredOnlyB);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1600px] px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">BOM 比對工具</h1>
            <p className="mt-1 text-sm text-white/70">
              從多份機台 BOM 中選擇兩份進行差異比對。
            </p>
          </div>
          <div className="flex items-start gap-2">
            <EditMachinesDialog machineGroups={machineGroups} onChanged={handleUploaded} />
            <UploadBomDialog
              existingMachines={machineGroups.map((g) => g.machine)}
              onUploaded={handleUploaded}
            />
          </div>
        </div>

        {initError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">{initError}</CardContent>
          </Card>
        )}

        <DescriptionSearch />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>選擇比對對象</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <MachineSelectGroup
                label="A"
                machine={machineA}
                selectedSubparts={subpartsA}
                machineGroups={machineGroups}
                subparts={subpartsFor(machineA)}
                disabled={initLoading}
                onMachineChange={handleMachineAChange}
                onToggleSubpart={toggleSubpartA}
                onToggleAll={toggleAllSubpartsA}
              />
              <MachineSelectGroup
                label="B"
                machine={machineB}
                selectedSubparts={subpartsB}
                machineGroups={machineGroups}
                subparts={subpartsFor(machineB)}
                disabled={initLoading}
                onMachineChange={handleMachineBChange}
                onToggleSubpart={toggleSubpartB}
                onToggleAll={toggleAllSubpartsB}
              />
            </div>
            <Button
              className="mt-4"
              onClick={handleCompareClick}
              disabled={
                initLoading ||
                compareLoading ||
                !machineA ||
                !machineB ||
                subpartsA.size === 0 ||
                subpartsB.size === 0
              }
            >
              {compareLoading ? "比對中…" : "開始比對"}
            </Button>
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

        {result && (
          <div className="mb-4 flex gap-2">
            <Input
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              placeholder="搜尋僅存在於 A/B 的料號或描述,可用空白分隔多個關鍵字(全部都要符合)"
            />
            <Button variant="outline" onClick={handleExportClick} className="shrink-0">
              <Download className="h-4 w-4" />
              下載 Excel
            </Button>
          </div>
        )}

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <PartTable title="僅存在於 A" items={filteredOnlyA} />
          <PartTable title="僅存在於 B" items={filteredOnlyB} />
        </div>

        <KeyPartsPanel
          machineA={machineA}
          subpartsA={subpartsA}
          machineB={machineB}
          subpartsB={subpartsB}
          subpartsFor={subpartsFor}
          combineAndLoad={combineAndLoad}
        />
      </div>
    </div>
  );
}

function MachineSelectGroup({
  label,
  machine,
  selectedSubparts,
  machineGroups,
  subparts,
  disabled,
  onMachineChange,
  onToggleSubpart,
  onToggleAll,
}: {
  label: string;
  machine: string;
  selectedSubparts: Set<string>;
  machineGroups: MachineGroup[];
  subparts: BomEntry[];
  disabled: boolean;
  onMachineChange: (value: string) => void;
  onToggleSubpart: (sourceFile: string) => void;
  onToggleAll: () => void;
}) {
  const allState: boolean | "indeterminate" =
    selectedSubparts.size === 0
      ? false
      : selectedSubparts.size === subparts.length
        ? true
        : "indeterminate";

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
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              disabled={disabled}
              className="h-9 w-full justify-between font-normal"
            >
              <span className="truncate">
                {subparts.length === 0
                  ? "尚無子項"
                  : selectedSubparts.size === 0
                    ? "未選擇子項"
                    : selectedSubparts.size === subparts.length
                      ? "全部子項"
                      : `已選 ${selectedSubparts.size}/${subparts.length} 個子項`}
              </span>
              <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
            <label className="flex items-center gap-2 border-b pb-1.5 text-sm font-medium">
              <Checkbox checked={allState} onCheckedChange={onToggleAll} disabled={disabled} />
              全部子項
            </label>
            <div className="mt-1.5 grid max-h-56 gap-1 overflow-y-auto">
              {subparts.map((entry) => (
                <label
                  key={entry.source_file}
                  className="hover:bg-accent flex items-center gap-2 rounded px-1 py-1 text-sm"
                >
                  <Checkbox
                    checked={selectedSubparts.has(entry.source_file)}
                    onCheckedChange={() => onToggleSubpart(entry.source_file)}
                    disabled={disabled}
                  />
                  {entry.source_file}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
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
