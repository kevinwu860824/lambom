import type { createClient } from "@/lib/supabase";
import type { ParsedBom } from "@/lib/bom-parse";

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

export interface KeyPartInfo {
  customName: string;
  subparts: string[];
}

export interface KeyPartDisplayRow {
  item: AggregatedItem;
  keyPartInfo: KeyPartInfo | null;
  renameText: string | null;
}

// Shared by the on-screen Only in A/B tables and the Excel export, so both
// always agree on ordering/highlighting: suspected-renamed rows first, then
// plain key parts, then everything else. `renameRank`, when given, orders the
// renamed group to match the position of the key part it corresponds to on
// the other side (see app/page.tsx's renameRankB), instead of alphabetically.
export function buildKeyPartDisplayRows(
  items: AggregatedItem[],
  keyPartInfo: Map<string, KeyPartInfo>,
  renameInfo: Map<string, string>,
  renameRank?: Map<string, number>
): KeyPartDisplayRow[] {
  return items
    .map((item) => ({
      item,
      keyPartInfo: keyPartInfo.get(item.part_no) ?? null,
      renameText: renameInfo.get(item.part_no) ?? null,
    }))
    .sort((a, b) => {
      const scoreA = a.renameText ? 2 : a.keyPartInfo ? 1 : 0;
      const scoreB = b.renameText ? 2 : b.keyPartInfo ? 1 : 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      if (scoreA === 2 && renameRank) {
        const rankA = renameRank.get(a.item.part_no) ?? Number.MAX_SAFE_INTEGER;
        const rankB = renameRank.get(b.item.part_no) ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
      }
      return a.item.part_no.localeCompare(b.item.part_no);
    });
}

export function formatAggregatedMatches(matches: AggregatedItem[]): string {
  if (matches.length === 0) return "-";
  return matches
    .map((m) => `${m.part_no}${m.description ? `(${m.description})` : ""}`)
    .join(", ");
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
    throw new Error(`Failed to load from Supabase: ${error.message}`);
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

/**
 * Retries a Supabase read/write a couple of times with backoff. Covers
 * transient "canceling statement due to statement timeout" errors seen on
 * bom_items (500k+ rows, growing) when a query or insert touches cold,
 * un-cached table pages — the identical operation reliably succeeds a
 * moment later once Postgres' cache has warmed. Not meant to paper over
 * persistent errors: those still throw once attempts are exhausted.
 */
export async function withRetry<T extends { error: { message: string } | null }>(
  run: () => PromiseLike<T>,
  maxAttempts = 3
): Promise<T> {
  let last!: T;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await run();
    if (!last.error) return last;
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return last;
}

async function fetchBomItemsPage(
  supabase: SupabaseClient,
  bomId: number,
  from: number,
  pageSize: number
): Promise<BomItem[]> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("bom_items")
      .select("part_no,description,qty,uom")
      .eq("bom_id", bomId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1)
  );
  if (error) throw new Error(error.message);
  return data ?? [];
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
    let data: BomItem[];
    try {
      data = await fetchBomItemsPage(supabase, bomId, from, pageSize);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load subpart (${sourceFile}): ${message}`);
    }

    if (data.length === 0) break;
    items.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return items;
}

const AMBIGUOUS = "ambiguous" as const;
type Ambiguous = typeof AMBIGUOUS;

/**
 * Tracks, per lookup key (a part_no or a normalized description), whether
 * every existing machine that uses that key agrees on a custom_name and
 * (separately) on a slot_id. The two are tracked independently because the
 * same custom_name legitimately gets its own slot_id per tool_type (e.g. a
 * shared vendor part like "RPC" is its own row in three different
 * tool_types' key_part_slots) — that shouldn't block classifying the part,
 * only block guessing which tool_type's slot it belongs to.
 */
class KeyPartLookup {
  private names = new Map<string, string | Ambiguous>();
  private slots = new Map<string, number | null | Ambiguous>();

  record(key: string, customName: string, slotId: number | null) {
    if (!key) return;
    const existingName = this.names.get(key);
    if (existingName === undefined) this.names.set(key, customName);
    else if (existingName !== AMBIGUOUS && existingName !== customName) this.names.set(key, AMBIGUOUS);

    const existingSlot = this.slots.get(key);
    if (existingSlot === undefined) this.slots.set(key, slotId);
    else if (existingSlot !== AMBIGUOUS && existingSlot !== slotId) this.slots.set(key, AMBIGUOUS);
  }

  resolve(key: string): { custom_name: string; slot_id: number | null } | null {
    const name = this.names.get(key);
    if (name === undefined || name === AMBIGUOUS) return null;
    const slot = this.slots.get(key);
    return { custom_name: name, slot_id: slot === AMBIGUOUS ? null : (slot ?? null) };
  }
}

/**
 * After uploading a machine's BOM, treat every OTHER machine's existing
 * key_parts as the pool of already-known "important parts". Any item in
 * this machine's BOM whose part_no or (normalized) description matches one
 * of them gets auto-classified as a key part too, inheriting custom_name
 * (and slot_id when unambiguous, so it also shows up in the /fingerprint
 * matrix for free). Only fills gaps — never touches a custom_name the
 * machine already has — and skips any part_no/description that maps to a
 * conflicting custom_name across different existing machines rather than
 * guessing. Returns how many rows were inserted.
 */
export async function autoMatchKeyParts(
  supabase: SupabaseClient,
  machineName: string
): Promise<number> {
  const { data: existingRows, error: existingError } = await supabase
    .from("key_parts")
    .select("part_no,description,custom_name,machine_name,slot_id");
  if (existingError) throw new Error(existingError.message);

  const byPartNo = new KeyPartLookup();
  const byDescription = new KeyPartLookup();
  const ownCustomNames = new Set<string>();

  for (const row of existingRows ?? []) {
    if (row.machine_name === machineName) {
      ownCustomNames.add(row.custom_name as string);
      continue;
    }
    const customName = row.custom_name as string;
    const slotId = (row.slot_id as number | null) ?? null;
    byPartNo.record(row.part_no as string, customName, slotId);
    byDescription.record(normalizeDescription(row.description as string | null), customName, slotId);
  }

  const { data: machineRows, error: machineError } = await supabase
    .from("bom_machines")
    .select("id,source_file")
    .eq("machine_name", machineName);
  if (machineError) throw new Error(machineError.message);

  const allItems: BomItem[] = [];
  for (const m of machineRows ?? []) {
    allItems.push(...(await fetchAllBomItems(supabase, m.id as number, m.source_file as string)));
  }
  const aggregated = aggregateByPartNo(allItems);

  const toInsert: {
    part_no: string;
    description: string | null;
    custom_name: string;
    machine_name: string;
    slot_id: number | null;
  }[] = [];

  for (const item of aggregated.values()) {
    const matched = byPartNo.resolve(item.part_no) ?? byDescription.resolve(normalizeDescription(item.description));

    if (!matched || ownCustomNames.has(matched.custom_name)) continue;

    toInsert.push({
      part_no: item.part_no,
      description: item.description,
      custom_name: matched.custom_name,
      machine_name: machineName,
      slot_id: matched.slot_id,
    });
    ownCustomNames.add(matched.custom_name);
  }

  for (const batch of chunk(toInsert, 500)) {
    const { error } = await supabase.from("key_parts").insert(batch);
    if (error) throw new Error(error.message);
  }

  return toInsert.length;
}

/**
 * Insert-or-overwrite one (machine_name, source_file) BOM into bom_machines
 * + bom_items. Shared by the manual upload dialog and the SAP Download
 * panel's auto-upload, so both paths always agree on overwrite/insert semantics.
 */
export async function uploadBomEntry(
  supabase: SupabaseClient,
  sourceFile: string,
  parsed: ParsedBom,
  machineName: string
): Promise<void> {
  const { data: existing, error: findError } = await supabase
    .from("bom_machines")
    .select("id")
    .eq("machine_name", machineName)
    .eq("source_file", sourceFile)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  let bomId: number;

  if (existing) {
    bomId = existing.id;
    const { error: updateError } = await supabase
      .from("bom_machines")
      .update({
        root_part_no: parsed.rootPartNo,
        root_description: parsed.rootDescription,
      })
      .eq("id", bomId);
    if (updateError) throw new Error(updateError.message);

    const { error: deleteError } = await withRetry(() =>
      supabase.from("bom_items").delete().eq("bom_id", bomId)
    );
    if (deleteError) throw new Error(deleteError.message);
  } else {
    const { data: inserted, error: insertMachineError } = await supabase
      .from("bom_machines")
      .insert({
        machine_name: machineName,
        source_file: sourceFile,
        root_part_no: parsed.rootPartNo,
        root_description: parsed.rootDescription,
      })
      .select("id")
      .single();
    if (insertMachineError) throw new Error(insertMachineError.message);
    bomId = inserted.id;
  }

  const rows = parsed.items.map((item) => ({ ...item, bom_id: bomId }));
  for (const batch of chunk(rows, 500)) {
    const { error: insertItemsError } = await withRetry(() =>
      supabase.from("bom_items").insert(batch)
    );
    if (insertItemsError) throw new Error(insertItemsError.message);
  }
}

/** FID -> machine name mapping (fid_machine_map), so the SAP Download
 * auto-upload knows which machine to write to without manual entry every time. */
export async function lookupMachineForFid(
  supabase: SupabaseClient,
  fid: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("fid_machine_map")
    .select("machine_name")
    .eq("fid", fid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.machine_name ?? null;
}

export async function saveMachineForFid(
  supabase: SupabaseClient,
  fid: string,
  machineName: string
): Promise<void> {
  const { error } = await supabase
    .from("fid_machine_map")
    .upsert({ fid, machine_name: machineName }, { onConflict: "fid" });
  if (error) throw new Error(error.message);
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
