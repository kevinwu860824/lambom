import type { createClient } from "@/lib/supabase";
import { withRetry } from "@/lib/bom";

type SupabaseClient = ReturnType<typeof createClient>;

export type PassdownStatus = "up" | "down" | "monitor" | "other";
export type PassdownShift = "day" | "night";

export const STATUS_LABELS: Record<PassdownStatus, string> = {
  up: "Up",
  down: "Down",
  monitor: "Monitor",
  other: "Other",
};

export const SHIFT_LABELS: Record<PassdownShift, string> = {
  day: "Day",
  night: "Night",
};

export interface PassdownPerson {
  id: number;
  name: string;
  active: boolean;
}

export interface PassdownUpdate {
  id: number;
  entryId: number;
  personId: number | null;
  personName: string | null;
  shift: PassdownShift | null;
  note: string;
  createdAt: string;
}

export interface PassdownEntry {
  id: number;
  entryDate: string;
  toolId: string;
  product: string | null;
  module: string;
  status: PassdownStatus;
  problemStatement: string | null;
  remark: string | null;
  updatedById: number | null;
  updatedByName: string | null;
  updatedAt: string;
}

const ENTRY_COLUMNS =
  "id,entry_date,tool_id,product,module,status,problem_statement,remark,updated_by_id,updated_at,updated_by:passdown_people(name)";

interface EntryRow {
  id: number;
  entry_date: string;
  tool_id: string;
  product: string | null;
  module: string;
  status: PassdownStatus;
  problem_statement: string | null;
  remark: string | null;
  updated_by_id: number | null;
  updated_at: string;
  updated_by: { name: string } | { name: string }[] | null;
}

function mapEntryRow(row: EntryRow): PassdownEntry {
  const updatedBy = Array.isArray(row.updated_by) ? row.updated_by[0] : row.updated_by;
  return {
    id: row.id,
    entryDate: row.entry_date,
    toolId: row.tool_id,
    product: row.product,
    module: row.module,
    status: row.status,
    problemStatement: row.problem_statement,
    remark: row.remark,
    updatedById: row.updated_by_id,
    updatedByName: updatedBy?.name ?? null,
    updatedAt: row.updated_at,
  };
}

export async function fetchPeople(supabase: SupabaseClient): Promise<PassdownPerson[]> {
  const { data, error } = await withRetry(() =>
    supabase.from("passdown_people").select("id,name,active").eq("active", true).order("name")
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as PassdownPerson[];
}

export async function addPerson(supabase: SupabaseClient, name: string): Promise<PassdownPerson> {
  const { data, error } = await withRetry(() =>
    supabase.from("passdown_people").insert({ name }).select("id,name,active").single()
  );
  if (error) throw new Error(error.message);
  return data as PassdownPerson;
}

export async function setPersonActive(supabase: SupabaseClient, id: number, active: boolean): Promise<void> {
  const { error } = await withRetry(() => supabase.from("passdown_people").update({ active }).eq("id", id));
  if (error) throw new Error(error.message);
}

/** All entries for a single day, grouped by nothing in particular — callers
 * group by tool_id in the UI. This is the "today's board" query; it stays
 * fast without extra pagination because entry_date is the leading column of
 * passdown_entries_date_id_idx and a single day is only ~45 rows. */
export async function fetchEntriesForDate(supabase: SupabaseClient, entryDate: string): Promise<PassdownEntry[]> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("passdown_entries")
      .select(ENTRY_COLUMNS)
      .eq("entry_date", entryDate)
      .order("tool_id", { ascending: true })
      .order("module", { ascending: true })
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapEntryRow(row as unknown as EntryRow));
}

/** Bounded date-range history search, newest first. Not full keyset
 * pagination — searches here are always scoped to a specific tool and/or a
 * narrow date range, so a capped limit is enough; passdown_entries_date_id_idx
 * still makes the range scan itself fast. */
export async function fetchEntriesHistory(
  supabase: SupabaseClient,
  opts: { from: string; to: string; toolId?: string; limit?: number }
): Promise<PassdownEntry[]> {
  let query = supabase
    .from("passdown_entries")
    .select(ENTRY_COLUMNS)
    .gte("entry_date", opts.from)
    .lte("entry_date", opts.to)
    .order("entry_date", { ascending: false })
    .order("tool_id", { ascending: true })
    .limit(opts.limit ?? 500);
  if (opts.toolId) query = query.ilike("tool_id", opts.toolId);
  const { data, error } = await withRetry(() => query);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapEntryRow(row as unknown as EntryRow));
}

export interface UpsertEntryInput {
  entryDate: string;
  toolId: string;
  product: string | null;
  module: string;
  status: PassdownStatus;
  problemStatement: string | null;
  remark: string | null;
  updatedById: number | null;
}

/** Creates today's row for a tool+module, or overwrites the structured
 * fields (status/problem/remark) of the existing one — the
 * (entry_date, tool_id, module) unique constraint makes this a safe upsert
 * instead of ever creating duplicate rows for the same machine/day. Free-text
 * shift notes never go through this path; they're append-only via
 * addUpdate below, which is what actually prevents teammates from
 * clobbering each other's write-ups. */
export async function upsertEntry(supabase: SupabaseClient, input: UpsertEntryInput): Promise<PassdownEntry> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("passdown_entries")
      .upsert(
        {
          entry_date: input.entryDate,
          tool_id: input.toolId,
          product: input.product,
          module: input.module,
          status: input.status,
          problem_statement: input.problemStatement,
          remark: input.remark,
          updated_by_id: input.updatedById,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "entry_date,tool_id,module" }
      )
      .select(ENTRY_COLUMNS)
      .single()
  );
  if (error) throw new Error(error.message);
  return mapEntryRow(data as unknown as EntryRow);
}

const UPDATE_COLUMNS = "id,entry_id,person_id,shift,note,created_at,person:passdown_people(name)";

interface UpdateRow {
  id: number;
  entry_id: number;
  person_id: number | null;
  shift: PassdownShift | null;
  note: string;
  created_at: string;
  person: { name: string } | { name: string }[] | null;
}

function mapUpdateRow(row: UpdateRow): PassdownUpdate {
  const person = Array.isArray(row.person) ? row.person[0] : row.person;
  return {
    id: row.id,
    entryId: row.entry_id,
    personId: row.person_id,
    personName: person?.name ?? null,
    shift: row.shift,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function fetchUpdatesForEntries(
  supabase: SupabaseClient,
  entryIds: number[]
): Promise<PassdownUpdate[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await withRetry(() =>
    supabase
      .from("passdown_updates")
      .select(UPDATE_COLUMNS)
      .in("entry_id", entryIds)
      .order("created_at", { ascending: true })
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapUpdateRow(row as unknown as UpdateRow));
}

/** Appends one shift-handover note as a new row — never edits or removes
 * anyone else's note, which is the core fix for the old shared-Excel-cell
 * problem where two people's write-ups could overwrite each other. */
export async function addUpdate(
  supabase: SupabaseClient,
  input: { entryId: number; personId: number; shift: PassdownShift; note: string }
): Promise<PassdownUpdate> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("passdown_updates")
      .insert({
        entry_id: input.entryId,
        person_id: input.personId,
        shift: input.shift,
        note: input.note,
      })
      .select(UPDATE_COLUMNS)
      .single()
  );
  if (error) throw new Error(error.message);
  return mapUpdateRow(data as unknown as UpdateRow);
}
