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
    throw new Error(`Failed to load data: ${error.message}`);
  }

  if (!machines || machines.length === 0) {
    throw new Error("No BOM records found.");
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

async function fetchBomItemsPage<T>(
  supabase: SupabaseClient,
  bomId: number,
  afterId: number,
  pageSize: number,
  columns: string
): Promise<(T & { id: number })[]> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("bom_items")
      .select(`id,${columns}`)
      .eq("bom_id", bomId)
      .gt("id", afterId)
      .order("id", { ascending: true })
      .limit(pageSize)
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as (T & { id: number })[];
}

/**
 * Pages through bom_items via keyset pagination (id > lastSeenId, ordered
 * by id) rather than .range()'s offset-based pagination. A single machine's
 * row count can run into the tens of thousands (e.g. Full BOM items —
 * fetchFullBomTreeItems below shares this same concern), and OFFSET makes
 * Postgres walk past every already-seen row on each successive page, so
 * later pages get progressively slower and can eventually hit the
 * project's statement timeout on a large enough set. Keyset pagination
 * costs the same (index-assisted) amount of work on every page regardless
 * of how deep in the result set it is.
 */
async function fetchAllBomItemsRaw<T>(
  supabase: SupabaseClient,
  bomId: number,
  sourceFile: string,
  columns: string
): Promise<T[]> {
  const pageSize = 1000;
  const items: T[] = [];
  let afterId = 0;

  for (;;) {
    let data: (T & { id: number })[];
    try {
      data = await fetchBomItemsPage<T>(supabase, bomId, afterId, pageSize, columns);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load subpart (${sourceFile}): ${message}`);
    }

    if (data.length === 0) break;
    items.push(...data);
    afterId = data[data.length - 1].id;
    if (data.length < pageSize) break;
  }

  return items;
}

export async function fetchAllBomItems(
  supabase: SupabaseClient,
  bomId: number,
  sourceFile: string
): Promise<BomItem[]> {
  return fetchAllBomItemsRaw<BomItem>(supabase, bomId, sourceFile, "part_no,description,qty,uom");
}

export interface BomTreeItem {
  part_no: string;
  description: string | null;
  qty: BomItem["qty"];
  uom: string | null;
  level: number;
  parent_path: string;
  line_no: number;
}

/** Same rows as fetchAllBomItems, but including the hierarchy columns
 * (level/parent_path/line_no) needed to reconstruct the BOM's tree
 * structure — kept as a separate query since the flat comparison views
 * that use fetchAllBomItems don't need these extra columns. */
export async function fetchBomTreeItems(
  supabase: SupabaseClient,
  bomId: number,
  sourceFile: string
): Promise<BomTreeItem[]> {
  return fetchAllBomItemsRaw<BomTreeItem>(
    supabase,
    bomId,
    sourceFile,
    "part_no,description,qty,uom,level,parent_path,line_no"
  );
}

async function fetchFullBomTreeItemsPage(
  supabase: SupabaseClient,
  machineName: string,
  afterId: number,
  pageSize: number
): Promise<(BomTreeItem & { id: number })[]> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("full_bom_items")
      .select("id,part_no,description,qty,uom,level,parent_path,line_no")
      .eq("machine_name", machineName)
      .gt("id", afterId)
      .order("id", { ascending: true })
      .limit(pageSize)
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as (BomTreeItem & { id: number })[];
}

/**
 * Same shape as fetchBomTreeItems, but reading from full_bom_items
 * (machine_name-keyed, no bom_id/source_file) instead of bom_items. Uses
 * keyset pagination (id > lastSeenId) rather than .range()'s OFFSET —
 * verified against real production data (dozens of machines, 20k-26k+ rows
 * each): OFFSET pagination makes Postgres walk past every already-seen row
 * on each successive page, so later pages get progressively slower and can
 * hit the project's statement timeout ("canceling statement due to
 * statement timeout") on a set this size, where keyset pagination costs
 * the same index-assisted amount of work on every page regardless of depth.
 */
export async function fetchFullBomTreeItems(
  supabase: SupabaseClient,
  machineName: string,
  onPage?: (pageItems: BomTreeItem[], itemsSoFar: number) => void
): Promise<BomTreeItem[]> {
  const pageSize = 1000;
  const items: BomTreeItem[] = [];
  let afterId = 0;
  for (;;) {
    const data = await fetchFullBomTreeItemsPage(supabase, machineName, afterId, pageSize);
    if (data.length === 0) break;
    items.push(...data);
    onPage?.(data, items.length);
    afterId = data[data.length - 1].id;
    if (data.length < pageSize) break;
  }
  return items;
}

/** Same rows as fetchAllBomItems (part_no/description/qty/uom only, no
 * hierarchy columns), but for one machine's whole Full BOM instead of a
 * single module — used by the Comparison Tool's "Full BOM" mode. */
export async function fetchFullBomItems(supabase: SupabaseClient, machineName: string): Promise<BomItem[]> {
  const items = await fetchFullBomTreeItems(supabase, machineName);
  return items.map(({ part_no, description, qty, uom }) => ({ part_no, description, qty, uom }));
}

/** Just the part_no values for one machine's Full BOM (keyset-paginated,
 * same as fetchFullBomTreeItems) — used to check whether a given part
 * number exists anywhere in a machine's Full BOM without pulling the full
 * row shape for every item. */
export async function fetchFullBomPartNos(supabase: SupabaseClient, machineName: string): Promise<Set<string>> {
  const partNos = new Set<string>();
  const pageSize = 1000;
  let afterId = 0;
  for (;;) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("full_bom_items")
        .select("id,part_no")
        .eq("machine_name", machineName)
        .gt("id", afterId)
        .order("id", { ascending: true })
        .limit(pageSize)
    );
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) partNos.add(row.part_no as string);
    afterId = data[data.length - 1].id as number;
    if (data.length < pageSize) break;
  }
  return partNos;
}

export interface MachineBomLookup {
  fullBomPartNos: Set<string>;
  /** part_no -> every module (bom_machines.source_file) it appears in for
   * this machine — a part can legitimately show up in more than one
   * module. */
  modulePartNoSources: Map<string, string[]>;
}

/** Combines fetchFullBomPartNos with every module's (bom_machines row's)
 * part numbers for one machine, for validating/annotating a part number
 * against everything actually known about that machine's BOM. */
export async function fetchMachineBomLookup(supabase: SupabaseClient, machineName: string): Promise<MachineBomLookup> {
  const [fullBomPartNos, moduleRowsRes] = await Promise.all([
    fetchFullBomPartNos(supabase, machineName),
    supabase.from("bom_machines").select("id,source_file").eq("machine_name", machineName),
  ]);
  if (moduleRowsRes.error) throw new Error(moduleRowsRes.error.message);

  const modulePartNoSources = new Map<string, string[]>();
  for (const m of moduleRowsRes.data ?? []) {
    const sourceFile = m.source_file as string;
    const items = await fetchAllBomItems(supabase, m.id as number, sourceFile);
    for (const item of items) {
      const list = modulePartNoSources.get(item.part_no);
      if (list) {
        if (!list.includes(sourceFile)) list.push(sourceFile);
      } else {
        modulePartNoSources.set(item.part_no, [sourceFile]);
      }
    }
  }

  return { fullBomPartNos, modulePartNoSources };
}

/**
 * Distinct machine_name values in `table`, via an index-assisted "skip
 * scan": repeatedly ask for the single smallest machine_name greater than
 * the last one seen. A plain "select machine_name" over every row hits the
 * Supabase project's server-side rows-per-request cap before ever reaching
 * a second machine once one machine has enough rows (full_bom_items can
 * have tens of thousands for a single machine alone) — silently returning
 * an incomplete list — and paginating through every row to dedupe
 * client-side is correct but scales with total row count, which for a
 * table like that can mean many tens of requests just to list machines.
 * This instead costs exactly one request per distinct machine (each
 * cheap, since `order + gt + limit(1)` lets Postgres use the machine_name
 * index to jump straight to the next value), regardless of how many rows
 * any one machine has — both full_bom_items and zbom_options already have
 * a machine_name index.
 */
async function fetchDistinctMachineNames(supabase: SupabaseClient, table: string): Promise<string[]> {
  const names: string[] = [];
  let last: string | null = null;
  for (;;) {
    let query = supabase.from(table).select("machine_name").order("machine_name", { ascending: true }).limit(1);
    if (last !== null) query = query.gt("machine_name", last);
    const { data, error } = await withRetry(() => query);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    last = data[0].machine_name as string;
    names.push(last);
  }
  return names;
}

/** Names of every machine that has a stored Full BOM, for populating a
 * machine picker without fetching all the item rows first. Reads
 * bom_machines.has_full_bom (set by uploadFullBomEntry) rather than
 * scanning full_bom_items directly — full_bom_items can run to tens of
 * thousands of rows per machine, and even the index-assisted
 * fetchDistinctMachineNames skip-scan above still costs one request per
 * distinct machine there; bom_machines is small, so this is a single fast
 * indexed-boolean query instead. */
export async function fetchFullBomMachineNames(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("bom_machines")
    .select("machine_name")
    .eq("has_full_bom", true)
    .order("machine_name", { ascending: true });
  if (error) throw new Error(error.message);
  return Array.from(new Set((data ?? []).map((row) => row.machine_name as string)));
}

export interface BomTreeNode {
  item: BomTreeItem;
  path: string;
  children: BomTreeNode[];
}

/**
 * Reconstructs the BOM's tree structure from its flat row list.
 * `parent_path` on each item is the "/"-joined chain of ancestor part
 * numbers (set by every lib/bom-parse.ts parser) — grouping rows by that
 * value gives each node's children directly, and appending the node's own
 * part_no gives the path key its own children are grouped under. Siblings
 * are ordered by line_no (original file order) rather than alphabetically.
 */
export function buildBomTree(items: BomTreeItem[]): BomTreeNode[] {
  const byParentPath = new Map<string, BomTreeItem[]>();
  for (const item of items) {
    const list = byParentPath.get(item.parent_path);
    if (list) list.push(item);
    else byParentPath.set(item.parent_path, [item]);
  }
  for (const list of byParentPath.values()) {
    list.sort((a, b) => a.line_no - b.line_no);
  }

  function build(parentPath: string): BomTreeNode[] {
    const children = byParentPath.get(parentPath) ?? [];
    return children.map((item) => {
      const path = parentPath ? `${parentPath}/${item.part_no}` : item.part_no;
      return { item, path, children: build(path) };
    });
  }

  return build("");
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
 * panel's Modules auto-upload, so both paths always agree on
 * overwrite/insert semantics.
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

/**
 * Insert-or-overwrite one machine's Full BOM into full_bom_items — a
 * separate table from bom_machines/bom_items, since Full BOM is always a
 * single whole-machine explosion (no source_file/multiple-subparts concept
 * the way Modules has), and isn't meant to show up alongside Modules in the
 * Subparts list at all.
 */
export async function uploadFullBomEntry(
  supabase: SupabaseClient,
  machineName: string,
  parsed: ParsedBom
): Promise<void> {
  const { error: deleteError } = await withRetry(() =>
    supabase.from("full_bom_items").delete().eq("machine_name", machineName)
  );
  if (deleteError) throw new Error(deleteError.message);

  const rows = parsed.items.map((item) => ({ ...item, machine_name: machineName }));
  for (const batch of chunk(rows, 500)) {
    const { error: insertError } = await withRetry(() => supabase.from("full_bom_items").insert(batch));
    if (insertError) throw new Error(insertError.message);
  }

  // Lets fetchFullBomMachineNames read a small, fast, indexed flag on
  // bom_machines instead of scanning full_bom_items — a machine can have
  // several bom_machines rows (one per module subpart file), so this
  // updates all of them, not just one.
  const { error: flagError } = await withRetry(() =>
    supabase.from("bom_machines").update({ has_full_bom: true }).eq("machine_name", machineName)
  );
  if (flagError) throw new Error(flagError.message);
}

/**
 * machine_name -> fid, for display next to machine names (e.g. the Edit
 * Machine page). fid_machine_map is keyed by fid, not machine_name, so if a
 * machine was ever downloaded under more than one fid this picks whichever
 * was saved most recently.
 */
export async function fetchFidsByMachine(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("fid_machine_map")
    .select("machine_name,fid,created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.machine_name) map.set(row.machine_name, row.fid);
  }
  return map;
}

export interface FidEntry {
  machineName: string | null;
  so: string | null;
  po: string | null;
}

/** FID -> {machine name, SO, PO} cache (fid_machine_map), so the SAP
 * Download queue only ever needs to resolve a given FID's SO/PO once —
 * every later run for the same FID reads this instead of re-running the
 * VA03 search. */
export async function lookupFidEntry(supabase: SupabaseClient, fid: string): Promise<FidEntry | null> {
  const { data, error } = await supabase
    .from("fid_machine_map")
    .select("machine_name,so,po")
    .eq("fid", fid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { machineName: data.machine_name, so: data.so, po: data.po };
}

/**
 * Writes only the fields provided, leaving any existing cached fields for
 * this FID untouched (e.g. saving a resolved SO/PO doesn't need to know or
 * overwrite the machine name, and vice versa).
 *
 * This can't be a plain .upsert(): Postgres validates NOT NULL columns
 * (machine_name) against the candidate row before it even checks for a
 * conflict, so an upsert that omits machine_name fails with a "null value
 * violates not-null constraint" error even when a matching row already
 * exists. Selecting first and branching into a real .update() (which only
 * touches the columns given) avoids that entirely.
 */
export async function saveFidEntry(
  supabase: SupabaseClient,
  fid: string,
  entry: Partial<{ machineName: string; so: string; po: string }>
): Promise<void> {
  const patch: Record<string, string> = {};
  if (entry.machineName !== undefined) patch.machine_name = entry.machineName;
  if (entry.so !== undefined) patch.so = entry.so;
  if (entry.po !== undefined) patch.po = entry.po;

  const { data: existing, error: findError } = await supabase
    .from("fid_machine_map")
    .select("fid")
    .eq("fid", fid)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  if (existing) {
    const { error } = await supabase.from("fid_machine_map").update(patch).eq("fid", fid);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("fid_machine_map").insert({ fid, ...patch });
    if (error) throw new Error(error.message);
  }
}

export interface ZbomOption {
  section: string;
  optionType: string;
  optionSelection: string | null;
}

/** Insert-or-overwrite one machine's ZBOM configuration options —
 * overwrite semantics mirror uploadBomEntry: delete whatever this machine
 * had before, then insert the freshly-downloaded set. */
export async function uploadZbomEntry(
  supabase: SupabaseClient,
  machineName: string,
  options: ZbomOption[]
): Promise<void> {
  const { error: deleteError } = await withRetry(() =>
    supabase.from("zbom_options").delete().eq("machine_name", machineName)
  );
  if (deleteError) throw new Error(deleteError.message);

  const rows = options.map((opt) => ({
    machine_name: machineName,
    section: opt.section,
    option_type: opt.optionType,
    option_selection: opt.optionSelection,
  }));
  for (const batch of chunk(rows, 500)) {
    const { error: insertError } = await withRetry(() => supabase.from("zbom_options").insert(batch));
    if (insertError) throw new Error(insertError.message);
  }
}

export interface ZbomSection {
  section: string;
  options: ZbomOption[];
}

/** Names of every machine that has at least one stored ZBOM option, for
 * populating a machine picker without fetching all the option rows first. */
export async function fetchZbomMachineNames(supabase: SupabaseClient): Promise<string[]> {
  return fetchDistinctMachineNames(supabase, "zbom_options");
}

/** One machine's ZBOM options, grouped by section in the order they were
 * stored (insertion order via `id`). */
export async function fetchZbomOptions(supabase: SupabaseClient, machineName: string): Promise<ZbomSection[]> {
  const { data, error } = await supabase
    .from("zbom_options")
    .select("section,option_type,option_selection")
    .eq("machine_name", machineName)
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  const sections = new Map<string, ZbomOption[]>();
  for (const row of data ?? []) {
    const section = row.section as string;
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push({
      section,
      optionType: row.option_type as string,
      optionSelection: row.option_selection as string | null,
    });
  }
  return Array.from(sections.entries()).map(([section, options]) => ({ section, options }));
}

export interface DocumentPartPrefix {
  code: string;
  label: string;
  /** True if this code never has a dash after it in practice (e.g. "99999"
   * appears as a bare prefix like "99999123", not "99999-..."), so it has
   * to be matched via a plain string-prefix check instead of an exact
   * leading-segment match. */
  noDashSuffix?: boolean;
}

/** Leading-code line items (procedure & spec docs, schematics, drawings,
 * completed-assembly labels, EFEM config) that show up in BOMs alongside
 * real parts but aren't physical components — hidden by default in the
 * Comparison Tool and BOM Structure viewer, with a per-code checklist to
 * reveal any of them individually. */
export const DOCUMENT_PART_PREFIXES: DocumentPartPrefix[] = [
  { code: "74", label: "Procedures & Process Specs" },
  { code: "76", label: "Schematics Diagrams" },
  { code: "202", label: "Procedures" },
  { code: "210", label: "Schematic" },
  { code: "224", label: "Interconnect" },
  { code: "253", label: "Facility Drawing" },
  { code: "853", label: "Completed Assembly" },
  { code: "99999", label: "EFEM Config", noDashSuffix: true },
];

/**
 * Returns which DOCUMENT_PART_PREFIXES code a part number belongs to, or
 * null if it doesn't match any. Most codes are matched against the part
 * number's leading dash-delimited segment exactly (e.g. "857" in
 * "857-231719-001") — not a raw character prefix, so a real part number
 * that merely starts with the same digits (e.g. "7401234-56") isn't
 * mistaken for category "74". Codes flagged `noDashSuffix` (currently just
 * "99999") are matched with a plain startsWith instead, since they never
 * appear with a trailing dash to delimit them.
 */
export function documentPartCodeFor(partNo: string): string | null {
  const firstSegment = partNo.split("-")[0];
  for (const entry of DOCUMENT_PART_PREFIXES) {
    if (entry.noDashSuffix ? partNo.startsWith(entry.code) : firstSegment === entry.code) {
      return entry.code;
    }
  }
  return null;
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
