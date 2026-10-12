import type { createClient } from "@/lib/supabase";
import { withRetry } from "@/lib/bom";

type SupabaseClient = ReturnType<typeof createClient>;

export const INVENTORY_LOG_STATUSES = [
  "missing",
  "ordered",
  "arrived",
  "picked_up",
  "completed",
  "loaned",
  "returned",
] as const;
export type InventoryLogStatus = (typeof INVENTORY_LOG_STATUSES)[number];

export interface InventoryLog {
  id: number;
  machineName: string;
  partName: string;
  status: InventoryLogStatus;
  isLoan: boolean;
  borrower: string | null;
  reporterEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchLogs(supabase: SupabaseClient): Promise<InventoryLog[]> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("inv_logs")
      .select("id,machine_name,part_name,status,is_loan,borrower,reporter_employee_id,created_at,updated_at")
      .order("created_at", { ascending: false })
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as number,
    machineName: row.machine_name as string,
    partName: row.part_name as string,
    status: row.status as InventoryLogStatus,
    isLoan: row.is_loan as boolean,
    borrower: row.borrower as string | null,
    reporterEmployeeId: row.reporter_employee_id as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export async function createLog(
  supabase: SupabaseClient,
  input: {
    machineName: string;
    partName: string;
    isLoan: boolean;
    borrower: string | null;
    reporterEmployeeId: string | null;
  }
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase.from("inv_logs").insert({
      machine_name: input.machineName,
      part_name: input.partName,
      status: input.isLoan ? "loaned" : "missing",
      is_loan: input.isLoan,
      borrower: input.borrower,
      reporter_employee_id: input.reporterEmployeeId,
    })
  );
  if (error) throw new Error(error.message);
}

export async function updateLogStatus(
  supabase: SupabaseClient,
  id: number,
  status: InventoryLogStatus
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase
      .from("inv_logs")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
  );
  if (error) throw new Error(error.message);
}

// On-hand parts list (inv_stock) — separate from inv_logs, which tracks
// missing/loan requests rather than actual stock levels. See
// scripts/inventory-stock-schema.sql.
export interface StockItem {
  id: number;
  partNo: string;
  /** Which machine's Full BOM this entry was looked up/added against — ""
   * when not tied to a specific machine (same convention as
   * InventoryLog.machineName). */
  machineName: string;
  description: string | null;
  qty: number;
  note: string | null;
  updatedAt: string;
}

export async function fetchStock(supabase: SupabaseClient): Promise<StockItem[]> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("inv_stock")
      .select("id,part_no,machine_name,description,qty,note,updated_at")
      .order("part_no", { ascending: true })
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as number,
    partNo: row.part_no as string,
    machineName: row.machine_name as string,
    description: row.description as string | null,
    qty: row.qty as number,
    note: row.note as string | null,
    updatedAt: row.updated_at as string,
  }));
}

/** Insert-or-overwrite one part's stock row, keyed by (part_no,
 * machine_name) — editing an existing part+machine pair re-saves that same
 * row instead of accumulating duplicates. A part can legitimately have
 * separate rows under different machines (e.g. the same screw stocked
 * because of two different machines' orders). */
export async function upsertStockItem(
  supabase: SupabaseClient,
  input: { partNo: string; machineName: string; description: string | null; qty: number; note: string | null }
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase.from("inv_stock").upsert(
      {
        part_no: input.partNo,
        machine_name: input.machineName,
        description: input.description,
        qty: input.qty,
        note: input.note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "part_no,machine_name" }
    )
  );
  if (error) throw new Error(error.message);
}

export async function deleteStockItem(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await withRetry(() => supabase.from("inv_stock").delete().eq("id", id));
  if (error) throw new Error(error.message);
}
