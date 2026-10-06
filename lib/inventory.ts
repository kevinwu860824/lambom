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
