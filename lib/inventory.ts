import type { createClient } from "@/lib/supabase";
import { withRetry } from "@/lib/bom";

type SupabaseClient = ReturnType<typeof createClient>;

export interface InventoryModel {
  id: number;
  name: string;
  bomData: string[];
}

/** machine_name -> which model's BOM list applies to it, for the "pick a
 * part" dropdown — machines themselves come from this project's existing
 * group system (useEmployeeGroup's allowedMachines), not a table this
 * module owns. */
export interface MachineModelLink {
  machineName: string;
  modelId: number;
}

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

// --- Models ---

export async function fetchModels(supabase: SupabaseClient): Promise<InventoryModel[]> {
  const { data, error } = await withRetry(() =>
    supabase.from("inv_machine_models").select("id,name,bom_data").order("name")
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as number,
    name: row.name as string,
    bomData: (row.bom_data as string[]) ?? [],
  }));
}

export async function addModel(supabase: SupabaseClient, name: string): Promise<void> {
  const { error } = await withRetry(() => supabase.from("inv_machine_models").insert({ name }));
  if (error) throw new Error(error.message);
}

export async function deleteModel(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await withRetry(() => supabase.from("inv_machine_models").delete().eq("id", id));
  if (error) throw new Error(error.message);
}

export async function setModelBomData(supabase: SupabaseClient, id: number, bomData: string[]): Promise<void> {
  const { error } = await withRetry(() =>
    supabase.from("inv_machine_models").update({ bom_data: bomData }).eq("id", id)
  );
  if (error) throw new Error(error.message);
}

// --- Machine -> model links ---

export async function fetchMachineModelLinks(supabase: SupabaseClient): Promise<MachineModelLink[]> {
  const { data, error } = await withRetry(() =>
    supabase.from("inv_machine_model_links").select("machine_name,model_id")
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    machineName: row.machine_name as string,
    modelId: row.model_id as number,
  }));
}

/** Assigns (or re-assigns) which model a machine uses, or removes the link
 * entirely when modelId is null — machine_name is the primary key, so this
 * is a plain upsert/delete rather than needing to know whether a link
 * already exists. */
export async function setMachineModelLink(
  supabase: SupabaseClient,
  machineName: string,
  modelId: number | null
): Promise<void> {
  if (modelId === null) {
    const { error } = await withRetry(() =>
      supabase.from("inv_machine_model_links").delete().eq("machine_name", machineName)
    );
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await withRetry(() =>
    supabase.from("inv_machine_model_links").upsert({ machine_name: machineName, model_id: modelId })
  );
  if (error) throw new Error(error.message);
}

// --- Logs ---

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
