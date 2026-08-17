"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, ExternalLink, Home as HomeIcon, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { openKmMatrix } from "@/lib/km-matrix";
import { useTranslate } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  aggregateByPartNo,
  buildKeyPartDisplayRows,
  checkKeyParts,
  compareBoms,
  documentPartCodeFor,
  DOCUMENT_PART_PREFIXES,
  fetchAllBomItems,
  fetchBomTreeItems,
  fetchFullBomItems,
  fetchFullBomTreeItems,
  fetchMachineGroups,
  formatAggregatedMatches,
  type BomEntry,
  type BomItem,
  type BomTreeItem,
  type CompareResult,
  type KeyPart,
  type KeyPartInfo,
  type MachineGroup,
} from "@/lib/bom";
import { cn } from "@/lib/utils";
import { useEmployeeGroup } from "@/lib/groups";
import { DocumentPartsFilter } from "@/components/document-parts-filter";
import { InventoryLookupButton } from "@/components/inventory-lookup-button";
import { PartPositionDialog, type PartPositionTarget } from "@/components/part-position-dialog";
import { RequireGroupPrompt } from "@/components/require-group";
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
import { DescriptionSearch } from "@/components/description-search";
import { KeyPartsPanel } from "@/components/key-parts-panel";
import { exportCompareToExcel } from "@/lib/export-excel";
import type { AggregatedItem, BomSummary } from "@/lib/bom";

const zh: Record<string, string> = {
  "BOM Comparison Tool": "BOM 比對工具",
  "Select two machine BOMs to compare their differences.": "選擇兩台機台的 BOM 進行差異比對。",
  "Key Parts Fingerprint": "關鍵零件指紋",
  "ZBOM Viewer": "ZBOM 檢視器",
  "BOM Structure": "BOM 結構",
  "Full BOM Structure": "完整 BOM 結構",
  "Edit machine names": "編輯機台名稱",
  "Back to Home": "回首頁",
  "Failed to load data:": "載入資料失敗:",
  "Compare using": "比對方式",
  Modules: "模組",
  "Full BOM": "完整 BOM",
  "Select Comparison Targets": "選擇比對目標",
  "Comparing…": "比對中…",
  "Start Comparison": "開始比對",
  "Comparison failed:": "比對失敗:",
  "Comparison Summary": "比對摘要",
  "/ {file}: {itemCount} detail items, {uniqueCount} unique parts":
    "/ {file}:{itemCount} 個明細項目,{uniqueCount} 個不重複料號",
  "No comparison data yet": "尚無比對資料",
  "Common Parts {n}": "共同料件 {n}",
  "A Only {n}": "僅 A 有 {n}",
  "B Only {n}": "僅 B 有 {n}",
  "Qty Mismatch {n}": "數量不符 {n}",
  "Only in A / B": "僅存在於 A / B",
  "Search part numbers or descriptions in Only A/B — separate multiple keywords with spaces (all must match)":
    "搜尋僅存在於 A/B 的料號或說明 — 可用空格分隔多個關鍵字(需全部符合)",
  "Download Excel": "下載 Excel",
  "Only in A": "僅 A 有",
  "Only in B": "僅 B 有",
  "No data": "無資料",
  "Part No.": "料號",
  Description: "說明",
  Qty: "數量",
  Unit: "單位",
  "Key Part": "關鍵零件",
  "Custom name:": "自訂名稱:",
  "Subparts:": "子件:",
  "Possibly renamed (machine {other})": "可能已重新命名(機台 {other})",
  "Machine {label}": "機台 {label}",
  "Select machine": "選擇機台",
  "Subpart {label}": "子件 {label}",
  "No subparts": "無子件",
  "No subparts selected": "未選取子件",
  "All subparts": "全部子件",
  "{selected}/{total} subparts selected": "已選取 {selected}/{total} 個子件",
};

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

  const { allowedMachines, employeeId, notFound, loading: groupLoading } = useEmployeeGroup();
  const t = useTranslate(zh);

  const [machineGroups, setMachineGroups] = useState<MachineGroup[]>([]);
  const [machineA, setMachineA] = useState("");
  const [subpartsA, setSubpartsA] = useState<Set<string>>(new Set());
  const [machineB, setMachineB] = useState("");
  const [subpartsB, setSubpartsB] = useState<Set<string>>(new Set());
  const [compareMode, setCompareMode] = useState<"modules" | "fullBom">("modules");

  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  // Which mode actually produced the currently-displayed result — kept
  // separate from the live `compareMode` toggle above, since the user can
  // flip that toggle after running a comparison without re-running it; the
  // "where is this part" dialog needs to know what's actually on screen.
  const [resultCompareMode, setResultCompareMode] = useState<"modules" | "fullBom">("modules");
  const [summaryA, setSummaryA] = useState<BomSummary | null>(null);
  const [summaryB, setSummaryB] = useState<BomSummary | null>(null);
  const [resultFilter, setResultFilter] = useState("");
  const [visibleDocumentCodes, setVisibleDocumentCodes] = useState<Set<string>>(new Set());
  const [resultsExpanded, setResultsExpanded] = useState(true);
  const [bomAItems, setBomAItems] = useState<BomItem[]>([]);
  const [bomBItems, setBomBItems] = useState<BomItem[]>([]);
  const [subpartMapA, setSubpartMapA] = useState<Map<string, string[]>>(new Map());
  const [subpartMapB, setSubpartMapB] = useState<Map<string, string[]>>(new Map());

  const [keyParts, setKeyParts] = useState<KeyPart[]>([]);
  const [keyPartsLoading, setKeyPartsLoading] = useState(true);
  const [keyPartsError, setKeyPartsError] = useState<string | null>(null);

  // "Where is this part?" dialog — opened by clicking a row in Only in A/B.
  // The fetch/match/render logic lives in the shared PartPositionDialog
  // component; this page just supplies page-lifetime-cached data getters
  // (each is a paginated fetch of potentially 20k+ rows, so worth caching
  // across repeated opens) and which target/mode to show.
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

  const getModules = useCallback(
    async (machine: string) =>
      (machineGroups.find((g) => g.machine === machine)?.subparts ?? []).map((entry) => ({
        bomId: entry.bomId,
        sourceFile: entry.source_file,
      })),
    [machineGroups]
  );

  const [positionTarget, setPositionTarget] = useState<PartPositionTarget | null>(null);

  function openPositionDialog(item: AggregatedItem, machine: string) {
    setPositionTarget({ partNo: item.part_no, description: item.description, machine });
  }

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

  function buildSubpartMap(entries: BomEntry[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    entries.forEach((entry) => {
      entry.items.forEach((item) => {
        const list = map.get(item.part_no);
        if (list) {
          if (!list.includes(entry.source_file)) list.push(entry.source_file);
        } else {
          map.set(item.part_no, [entry.source_file]);
        }
      });
    });
    return map;
  }

  async function combineAndLoad(machine: string, entries: BomEntry[]): Promise<BomEntry | null> {
    if (entries.length === 0) return null;

    const loaded = await Promise.all(entries.map((e) => ensureBomItemsLoaded(e)));
    const valid = loaded.filter((e): e is BomEntry => e !== null);
    if (valid.length === 0) return null;

    return {
      bomId: -1,
      source_file: valid.map((e) => e.source_file).join(", "),
      machine,
      items: valid.flatMap((e) => e.items),
      itemsLoaded: true,
    };
  }

  async function combineAndLoadFullBom(machine: string): Promise<BomEntry | null> {
    if (!machine) return null;
    const items = await fetchFullBomItems(getSupabase(), machine);
    if (items.length === 0) return null;

    return {
      bomId: -1,
      source_file: "Full BOM",
      machine,
      items,
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
      const [bomA, bomB] =
        compareMode === "fullBom"
          ? await Promise.all([combineAndLoadFullBom(machineAName), combineAndLoadFullBom(machineBName)])
          : await Promise.all([combineAndLoad(machineAName, entriesA), combineAndLoad(machineBName, entriesB)]);

      if (!bomA || !bomB) {
        return;
      }

      setBomAItems(bomA.items);
      setBomBItems(bomB.items);
      // Full BOM has no per-module breakdown, so there's nothing to show in
      // the "Subparts: ..." key-part detail column in that mode.
      setSubpartMapA(compareMode === "fullBom" ? new Map() : buildSubpartMap(entriesA));
      setSubpartMapB(compareMode === "fullBom" ? new Map() : buildSubpartMap(entriesB));
      setResult(compareBoms(bomA, bomB));
      setResultCompareMode(compareMode);
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

  async function loadData(allowed: Set<string>) {
    const { machineGroups: rawGroups, bomData: rawBomData } = await fetchMachineGroups(getSupabase());
    const groups = rawGroups.filter((g) => allowed.has(g.machine));
    const bomData = rawBomData.filter((e) => allowed.has(e.machine));
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

  async function loadKeyParts(allowedMachines: Set<string>) {
    setKeyPartsLoading(true);
    setKeyPartsError(null);
    try {
      const { data, error } = await getSupabase()
        .from("key_parts")
        .select("id,part_no,description,custom_name,machine_name,source_file")
        .in("machine_name", Array.from(allowedMachines))
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      setKeyParts(data ?? []);
    } catch (err) {
      setKeyPartsError(err instanceof Error ? err.message : String(err));
    } finally {
      setKeyPartsLoading(false);
    }
  }

  async function renameKeyPart(id: number, newName: string) {
    const { error } = await getSupabase()
      .from("key_parts")
      .update({ custom_name: newName })
      .eq("id", id);
    if (error) throw new Error(error.message);
    setKeyParts((prev) => prev.map((p) => (p.id === id ? { ...p, custom_name: newName } : p)));
  }

  async function deleteKeyPartRow(id: number) {
    const { error } = await getSupabase().from("key_parts").delete().eq("id", id);
    if (error) throw new Error(error.message);
    setKeyParts((prev) => prev.filter((p) => p.id !== id));
  }

  useEffect(() => {
    if (!allowedMachines) return;
    loadData(allowedMachines).catch((err) => {
      setInitError(`${t("Failed to load data:")} ${err instanceof Error ? err.message : String(err)}`);
      setInitLoading(false);
    });
    loadKeyParts(allowedMachines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedMachines]);

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
  function isVisible(item: AggregatedItem): boolean {
    if (!matchesResultFilter(item, resultFilter)) return false;
    const code = documentPartCodeFor(item.part_no);
    return code === null || visibleDocumentCodes.has(code);
  }
  const filteredOnlyA = result?.onlyA.filter(isVisible) ?? [];
  const filteredOnlyB = result?.onlyB.filter(isVisible) ?? [];

  function toggleDocumentCode(code: string) {
    setVisibleDocumentCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleAllDocumentCodes() {
    setVisibleDocumentCodes((prev) =>
      prev.size === DOCUMENT_PART_PREFIXES.length ? new Set() : new Set(DOCUMENT_PART_PREFIXES.map((p) => p.code))
    );
  }

  // Key parts: each machine's own key parts get sorted to the top and flagged
  // in "Only in A/B" (A shows which subpart it appears in + its custom name);
  // if the other side has an item with the same description but a different
  // part number, treat it as a possible rename and pin/flag it in red — even
  // when B has no key parts of its own, if one of A's key parts turns up a
  // suspected rename in B, that item still gets pinned/flagged on the B side
  // too (reverse detection).
  const keyPartsA = useMemo(
    () => keyParts.filter((k) => k.machine_name === machineA),
    [keyParts, machineA]
  );
  const keyPartsB = useMemo(
    () => keyParts.filter((k) => k.machine_name === machineB),
    [keyParts, machineB]
  );

  const keyPartInfoA = useMemo(() => {
    const map = new Map<string, { customName: string; subparts: string[] }>();
    keyPartsA.forEach((k) => {
      map.set(k.part_no, { customName: k.custom_name, subparts: subpartMapA.get(k.part_no) ?? [] });
    });
    return map;
  }, [keyPartsA, subpartMapA]);
  const keyPartInfoB = useMemo(() => {
    const map = new Map<string, { customName: string; subparts: string[] }>();
    keyPartsB.forEach((k) => {
      map.set(k.part_no, { customName: k.custom_name, subparts: subpartMapB.get(k.part_no) ?? [] });
    });
    return map;
  }, [keyPartsB, subpartMapB]);

  const renameCheckA = useMemo(
    () => (keyPartsA.length > 0 ? checkKeyParts(keyPartsA, bomBItems) : []),
    [keyPartsA, bomBItems]
  );
  const renameCheckB = useMemo(
    () => (keyPartsB.length > 0 ? checkKeyParts(keyPartsB, bomAItems) : []),
    [keyPartsB, bomAItems]
  );

  const renameInfoA = useMemo(() => {
    const map = new Map<string, string>();
    renameCheckA.forEach((r) => {
      if (r.status === "renamed") map.set(r.keyPart.part_no, formatAggregatedMatches(r.matches));
    });
    return map;
  }, [renameCheckA]);

  const renameInfoB = useMemo(() => {
    const map = new Map<string, string>();
    renameCheckB.forEach((r) => {
      if (r.status === "renamed") map.set(r.keyPart.part_no, formatAggregatedMatches(r.matches));
    });
    // Reverse direction: A's key parts that seem renamed in B should also
    // pin/flag on the B side, even when B has no key parts of its own.
    renameCheckA.forEach((r) => {
      if (r.status === "renamed") {
        r.matches.forEach((m) => {
          map.set(m.part_no, `Possibly A's key part "${r.keyPart.custom_name}" (original part no. ${r.keyPart.part_no})`);
        });
      }
    });
    return map;
  }, [renameCheckA, renameCheckB]);

  // B's ordering: after pinning to the top, sort by the rank of the A key
  // part each row maps to (not by B's own part number alphabetically), so
  // the two sides' suspected-matching rows line up as closely as possible.
  const renameRankB = useMemo(() => {
    const rankedA = renameCheckA
      .filter((r) => r.status === "renamed")
      .slice()
      .sort((a, b) => a.keyPart.part_no.localeCompare(b.keyPart.part_no));

    const map = new Map<string, number>();
    rankedA.forEach((r, rank) => {
      r.matches.forEach((m) => {
        if (!map.has(m.part_no)) map.set(m.part_no, rank);
      });
    });
    return map;
  }, [renameCheckA]);

  function handleExportClick() {
    if (!summaryA || !summaryB || !result) return;
    exportCompareToExcel(summaryA, summaryB, result, filteredOnlyA, filteredOnlyB, {
      keyPartInfoA,
      keyPartInfoB,
      renameInfoA,
      renameInfoB,
      renameRankB,
    });
  }

  if (groupLoading) {
    return <div className="min-h-screen bg-background" />;
  }
  if (!allowedMachines) {
    return (
      <div className="min-h-screen bg-background">
        <RequireGroupPrompt notFound={notFound} employeeId={employeeId} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1600px] px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("BOM Comparison Tool")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Select two machine BOMs to compare their differences.")}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Button variant="outline" asChild>
              <Link href="/fingerprint">{t("Key Parts Fingerprint")}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/zbom">{t("ZBOM Viewer")}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/tree">{t("BOM Structure")}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/full-bom">{t("Full BOM Structure")}</Link>
            </Button>
            <LanguageSwitcher />
            <Button variant="outline" size="icon" asChild>
              <Link href="/machines" aria-label={t("Edit machine names")}>
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" size="icon" asChild>
              <Link href="/" aria-label={t("Back to Home")}>
                <HomeIcon className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {initError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">{initError}</CardContent>
          </Card>
        )}

        <DescriptionSearch
          allowedMachines={allowedMachines}
          onKeyPartAdded={() => loadKeyParts(allowedMachines)}
        />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("Select Comparison Targets")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm font-medium">{t("Compare using")}</span>
              <div className="inline-flex rounded-md border p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={compareMode === "modules" ? "default" : "ghost"}
                  className="h-7"
                  onClick={() => setCompareMode("modules")}
                >
                  {t("Modules")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={compareMode === "fullBom" ? "default" : "ghost"}
                  className="h-7"
                  onClick={() => setCompareMode("fullBom")}
                >
                  {t("Full BOM")}
                </Button>
              </div>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <MachineSelectGroup
                label="A"
                machine={machineA}
                selectedSubparts={subpartsA}
                machineGroups={machineGroups}
                subparts={subpartsFor(machineA)}
                disabled={initLoading}
                hideSubparts={compareMode === "fullBom"}
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
                hideSubparts={compareMode === "fullBom"}
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
                (compareMode === "modules" && (subpartsA.size === 0 || subpartsB.size === 0))
              }
            >
              {compareLoading ? t("Comparing…") : t("Start Comparison")}
            </Button>
          </CardContent>
        </Card>

        {compareError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">
              {t("Comparison failed:")} {compareError}
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("Comparison Summary")}</CardTitle>
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
                  <span className="font-medium">{summaryA.machine}</span>{" "}
                  {t("/ {file}: {itemCount} detail items, {uniqueCount} unique parts")
                    .replace("{file}", summaryA.source_file)
                    .replace("{itemCount}", String(summaryA.itemCount))
                    .replace("{uniqueCount}", String(summaryA.uniqueCount))}
                </p>
                <p>
                  <span className="font-medium">{summaryB.machine}</span>{" "}
                  {t("/ {file}: {itemCount} detail items, {uniqueCount} unique parts")
                    .replace("{file}", summaryB.source_file)
                    .replace("{itemCount}", String(summaryB.itemCount))
                    .replace("{uniqueCount}", String(summaryB.uniqueCount))}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="secondary">{t("Common Parts {n}").replace("{n}", String(result.common.length))}</Badge>
                  <Badge variant="outline">{t("A Only {n}").replace("{n}", String(result.onlyA.length))}</Badge>
                  <Badge variant="outline">{t("B Only {n}").replace("{n}", String(result.onlyB.length))}</Badge>
                  <Badge variant={qtyMismatchCount > 0 ? "destructive" : "secondary"}>
                    {t("Qty Mismatch {n}").replace("{n}", String(qtyMismatchCount))}
                  </Badge>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">{t("No comparison data yet")}</p>
            )}
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader
            role="button"
            tabIndex={0}
            onClick={() => setResultsExpanded((e) => !e)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setResultsExpanded((v) => !v);
            }}
            className="flex cursor-pointer select-none flex-row items-center justify-between"
          >
            <CardTitle>{t("Only in A / B")}</CardTitle>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${resultsExpanded ? "rotate-180" : ""}`}
            />
          </CardHeader>

          {resultsExpanded && (
            <CardContent>
              {result && (
                <div className="mb-4 grid gap-2">
                  <div className="flex gap-2">
                    <Input
                      value={resultFilter}
                      onChange={(e) => setResultFilter(e.target.value)}
                      placeholder={t(
                        "Search part numbers or descriptions in Only A/B — separate multiple keywords with spaces (all must match)"
                      )}
                    />
                    <Button variant="outline" onClick={handleExportClick} className="shrink-0">
                      <Download className="h-4 w-4" />
                      {t("Download Excel")}
                    </Button>
                  </div>
                  <DocumentPartsFilter
                    visibleCodes={visibleDocumentCodes}
                    onToggle={toggleDocumentCode}
                    onToggleAll={toggleAllDocumentCodes}
                  />
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <PartTable
                  title={t("Only in A")}
                  items={filteredOnlyA}
                  keyPartInfo={keyPartInfoA}
                  renameInfo={renameInfoA}
                  otherSideLabel="B"
                  keyPartColumnVariant="detail"
                  machine={summaryA?.machine ?? ""}
                  onSelectPart={openPositionDialog}
                />
                <PartTable
                  title={t("Only in B")}
                  items={filteredOnlyB}
                  keyPartInfo={keyPartInfoB}
                  renameInfo={renameInfoB}
                  renameRank={renameRankB}
                  otherSideLabel="A"
                  keyPartColumnVariant="badge"
                  machine={summaryB?.machine ?? ""}
                  onSelectPart={openPositionDialog}
                />
              </div>
            </CardContent>
          )}
        </Card>

        <PartPositionDialog
          open={positionTarget !== null}
          onOpenChange={(open) => !open && setPositionTarget(null)}
          target={positionTarget}
          mode={resultCompareMode}
          getFullBomTree={getFullBomTree}
          getModules={getModules}
          getModuleTree={getModuleTree}
        />

        <KeyPartsPanel
          machineA={machineA}
          subpartsA={subpartsA}
          machineB={machineB}
          subpartsB={subpartsB}
          subpartsFor={subpartsFor}
          combineAndLoad={combineAndLoad}
          keyParts={keyParts}
          keyPartsLoading={keyPartsLoading}
          keyPartsError={keyPartsError}
          onRename={renameKeyPart}
          onDelete={deleteKeyPartRow}
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
  hideSubparts,
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
  /** Full BOM comparison mode has no per-module breakdown to pick from —
   * just hide the subpart picker and compare using the whole machine. */
  hideSubparts?: boolean;
  onMachineChange: (value: string) => void;
  onToggleSubpart: (sourceFile: string) => void;
  onToggleAll: () => void;
}) {
  const t = useTranslate(zh);
  const allState: boolean | "indeterminate" =
    selectedSubparts.size === 0
      ? false
      : selectedSubparts.size === subparts.length
        ? true
        : "indeterminate";

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <label className="text-sm font-medium">{t("Machine {label}").replace("{label}", label)}</label>
        <Select value={machine} onValueChange={onMachineChange} disabled={disabled}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("Select machine")} />
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
      {!hideSubparts && (
        <div className="grid gap-1.5">
          <label className="text-sm font-medium">{t("Subpart {label}").replace("{label}", label)}</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={disabled}
                className="h-9 w-full justify-between font-normal"
              >
                <span className="truncate">
                  {subparts.length === 0
                    ? t("No subparts")
                    : selectedSubparts.size === 0
                      ? t("No subparts selected")
                      : selectedSubparts.size === subparts.length
                        ? t("All subparts")
                        : t("{selected}/{total} subparts selected")
                            .replace("{selected}", String(selectedSubparts.size))
                            .replace("{total}", String(subparts.length))}
                </span>
                <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
              <label className="flex items-center gap-2 border-b pb-1.5 text-sm font-medium">
                <Checkbox checked={allState} onCheckedChange={onToggleAll} disabled={disabled} />
                {t("All subparts")}
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
      )}
    </div>
  );
}

function PartTable({
  title,
  items,
  keyPartInfo,
  renameInfo,
  renameRank,
  otherSideLabel,
  keyPartColumnVariant = "badge",
  machine,
  onSelectPart,
}: {
  title: string;
  items?: AggregatedItem[];
  keyPartInfo?: Map<string, KeyPartInfo>;
  renameInfo?: Map<string, string>;
  renameRank?: Map<string, number>;
  otherSideLabel?: string;
  keyPartColumnVariant?: "badge" | "detail";
  machine: string;
  onSelectPart: (item: AggregatedItem, machine: string) => void;
}) {
  const t = useTranslate(zh);
  const hasKeyPartColumn = (keyPartInfo?.size ?? 0) > 0 || (renameInfo?.size ?? 0) > 0;

  const rows = buildKeyPartDisplayRows(
    items ?? [],
    keyPartInfo ?? new Map(),
    renameInfo ?? new Map(),
    renameRank
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">{t("No data")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Part No.")}</TableHead>
                <TableHead>{t("Description")}</TableHead>
                <TableHead>{t("Qty")}</TableHead>
                <TableHead>{t("Unit")}</TableHead>
                {hasKeyPartColumn && <TableHead>{t("Key Part")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, keyPartInfo: info, renameText }) => (
                <TableRow
                  key={item.part_no}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectPart(item, machine)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelectPart(item, machine);
                  }}
                  className={cn(
                    "hover:bg-accent cursor-pointer",
                    renameText && "text-red-600 dark:text-red-400"
                  )}
                >
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span>{item.part_no}</span>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          openKmMatrix(item.part_no);
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                        KM
                      </Button>
                      <InventoryLookupButton partNo={item.part_no} />
                    </div>
                  </TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.qty ?? "-"}</TableCell>
                  <TableCell>{item.uom ?? ""}</TableCell>
                  {hasKeyPartColumn && (
                    <TableCell>
                      {keyPartColumnVariant === "detail" ? (
                        <div className="grid gap-0.5 text-xs">
                          {info && (
                            <>
                              <span className="font-medium">
                                {t("Custom name:")} {info.customName}
                              </span>
                              <span className="text-muted-foreground">
                                {t("Subparts:")} {info.subparts.length > 0 ? info.subparts.join(", ") : "-"}
                              </span>
                            </>
                          )}
                          {renameText && (
                            <>
                              <Badge variant="destructive" className="w-fit">
                                {t("Possibly renamed (machine {other})").replace("{other}", otherSideLabel ?? "")}
                              </Badge>
                              <span>{renameText}</span>
                            </>
                          )}
                          {!info && !renameText && <span className="text-muted-foreground">-</span>}
                        </div>
                      ) : renameText ? (
                        <div className="grid gap-0.5">
                          <Badge variant="destructive" className="w-fit">
                            {t("Possibly renamed (machine {other})").replace("{other}", otherSideLabel ?? "")}
                          </Badge>
                          <span className="text-xs">{renameText}</span>
                        </div>
                      ) : info ? (
                        <Badge variant="secondary" className="w-fit">
                          {t("Key Part")}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
