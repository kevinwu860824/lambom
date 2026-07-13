import type { createClient } from "@/lib/supabase";

type SupabaseClient = ReturnType<typeof createClient>;

export interface BomItem {
  part_no: string;
  description: string | null;
  qty: number | string | null;
  uom: string | null;
}

export interface BomEntry {
  bomId: number;
  source_file: string;
  machine: string;
  items: BomItem[];
  itemsLoaded: boolean;
}

export interface MachineGroup {
  machine: string;
  subparts: BomEntry[];
}

export interface AggregatedItem {
  part_no: string;
  description: string | null;
  qty: number;
  uom: string;
}

export interface CommonItem {
  part_no: string;
  description: string | null;
  qtyA: number;
  qtyB: number;
  qtyDiff: number;
  uomA: string;
  uomB: string;
  qtyMatch: boolean;
}

export interface CompareResult {
  onlyA: AggregatedItem[];
  onlyB: AggregatedItem[];
  common: CommonItem[];
}

export interface BomSummary {
  machine: string;
  source_file: string;
  itemCount: number;
  uniqueCount: number;
}

export interface KeyPart {
  id: number;
  part_no: string;
  description: string | null;
  custom_name: string;
  machine_name: string | null;
  source_file: string | null;
}

export type KeyPartStatus = "same" | "renamed" | "missing";

export interface KeyPartCheckResult {
  keyPart: KeyPart;
  status: KeyPartStatus;
  matches: AggregatedItem[];
}

export function normalizeDescription(desc: string | null): string {
  return (desc ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function checkKeyParts(
  keyParts: KeyPart[],
  targetItems: BomItem[]
): KeyPartCheckResult[] {
  const byPartNo = aggregateByPartNo(targetItems);

  const byDescription = new Map<string, AggregatedItem[]>();
  for (const item of byPartNo.values()) {
    const key = normalizeDescription(item.description);
    if (!key) continue;
    if (!byDescription.has(key)) byDescription.set(key, []);
    byDescription.get(key)!.push(item);
  }

  return keyParts.map((keyPart) => {
    const exact = byPartNo.get(keyPart.part_no);
    if (exact) {
      return { keyPart, status: "same" as const, matches: [exact] };
    }

    const descKey = normalizeDescription(keyPart.description);
    const candidates = descKey ? (byDescription.get(descKey) ?? []) : [];
    if (candidates.length > 0) {
      return { keyPart, status: "renamed" as const, matches: candidates };
    }

    return { keyPart, status: "missing" as const, matches: [] };
  });
}

export async function fetchMachineGroups(supabase: SupabaseClient): Promise<{
  machineGroups: MachineGroup[];
  bomData: BomEntry[];
}> {
  const { data: machines, error } = await supabase
    .from("bom_machines")
    .select("id,machine_name,source_file");

  if (error) {
    throw new Error(`載入 Supabase 失敗:${error.message}`);
  }

  if (!machines || machines.length === 0) {
    throw new Error("Supabase returned no BOM records.");
  }

  const bomData: BomEntry[] = machines.map((machine) => ({
    bomId: machine.id,
    source_file: machine.source_file,
    machine: machine.machine_name,
    items: [],
    itemsLoaded: false,
  }));

  const grouped = new Map<string, BomEntry[]>();
  bomData.forEach((entry) => {
    if (!grouped.has(entry.machine)) {
      grouped.set(entry.machine, []);
    }
    grouped.get(entry.machine)!.push(entry);
  });

  const machineGroups: MachineGroup[] = Array.from(grouped.entries())
    .map(([machine, subparts]) => ({
      machine,
      subparts: subparts.sort((a, b) => a.source_file.localeCompare(b.source_file)),
    }))
    .sort((a, b) => a.machine.localeCompare(b.machine));

  return { machineGroups, bomData };
}

export async function fetchAllBomItems(
  supabase: SupabaseClient,
  bomId: number,
  sourceFile: string
): Promise<BomItem[]> {
  const pageSize = 1000;
  const items: BomItem[] = [];
  let from = 0;

  // The Supabase project caps rows-per-request server-side (db-max-rows),
  // so a single request with a high .limit() is silently truncated.
  // Page through with .range() until a page comes back short.
  for (;;) {
    const { data, error } = await supabase
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

export function toNumericQty(value: BomItem["qty"]): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function aggregateByPartNo(items: BomItem[]): Map<string, AggregatedItem> {
  const aggregated = new Map<string, AggregatedItem>();

  items.forEach((item) => {
    const partNo = item.part_no;
    if (!partNo) {
      return;
    }

    if (!aggregated.has(partNo)) {
      aggregated.set(partNo, {
        part_no: partNo,
        description: item.description,
        qty: 0,
        uom: item.uom ?? "",
      });
    }

    const target = aggregated.get(partNo)!;
    target.qty += toNumericQty(item.qty);

    if (!target.description && item.description) {
      target.description = item.description;
    }
    if (!target.uom && item.uom) {
      target.uom = item.uom;
    }
  });

  return aggregated;
}

export function compareBoms(bomA: BomEntry, bomB: BomEntry): CompareResult {
  const mapA = aggregateByPartNo(bomA.items);
  const mapB = aggregateByPartNo(bomB.items);

  const onlyA: AggregatedItem[] = [];
  const onlyB: AggregatedItem[] = [];
  const common: CommonItem[] = [];

  for (const [partNo, itemA] of mapA.entries()) {
    const itemB = mapB.get(partNo);
    if (!itemB) {
      onlyA.push(itemA);
    } else {
      common.push({
        part_no: partNo,
        description: itemA.description,
        qtyA: itemA.qty,
        qtyB: itemB.qty,
        qtyDiff: itemA.qty - itemB.qty,
        uomA: itemA.uom,
        uomB: itemB.uom,
        qtyMatch: itemA.qty === itemB.qty,
      });
    }
  }

  for (const [partNo, itemB] of mapB.entries()) {
    if (!mapA.has(partNo)) {
      onlyB.push(itemB);
    }
  }

  onlyA.sort((a, b) => a.part_no.localeCompare(b.part_no));
  onlyB.sort((a, b) => a.part_no.localeCompare(b.part_no));
  common.sort((a, b) => a.part_no.localeCompare(b.part_no));

  return { onlyA, onlyB, common };
}
