import type { createClient } from "@/lib/supabase";
import { withRetry } from "@/lib/bom";

type SupabaseClient = ReturnType<typeof createClient>;

export interface InventoryModel {
  id: number;
  name: string;
  bomData: string[];
}

export interface PredefinedCode {
  id: number;
  modelId: number;
  code: string;
}

export interface InventoryMachine {
  id: number;
  code: string;
  name: string;
  modelId: number | null;
  modelName: string | null;
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
  machineId: number;
  machineCode: string;
  machineName: string;
  partName: string;
  status: InventoryLogStatus;
  isLoan: boolean;
  borrower: string | null;
  reporterEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
}

type ModelNameJoin = { name: string } | { name: string }[] | null;
function resolveModelName(join: ModelNameJoin): string | null {
  if (!join) return null;
  return Array.isArray(join) ? join[0]?.name ?? null : join.name;
}

type MachineJoin = { code: string; name: string } | { code: string; name: string }[] | null;
function resolveMachine(join: MachineJoin): { code: string; name: string } {
  const m = Array.isArray(join) ? join[0] : join;
  return { code: m?.code ?? "", name: m?.name ?? "" };
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

// --- Predefined codes (valid serial numbers reserved per model) ---

export async function fetchPredefinedCodes(supabase: SupabaseClient): Promise<PredefinedCode[]> {
  const { data, error } = await withRetry(() =>
    supabase.from("inv_predefined_codes").select("id,model_id,code").order("code")
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as number,
    modelId: row.model_id as number,
    code: row.code as string,
  }));
}

export async function addPredefinedCodes(supabase: SupabaseClient, modelId: number, codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  const { error } = await withRetry(() =>
    supabase.from("inv_predefined_codes").insert(codes.map((code) => ({ model_id: modelId, code })))
  );
  if (error) throw new Error(error.message);
}

export async function deletePredefinedCode(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await withRetry(() => supabase.from("inv_predefined_codes").delete().eq("id", id));
  if (error) throw new Error(error.message);
}

// --- Machines ---

export async function fetchMachines(supabase: SupabaseClient): Promise<InventoryMachine[]> {
  const { data, error } = await withRetry(() =>
    supabase.from("inv_machines").select("id,code,name,model_id,inv_machine_models(name)").order("code")
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as number,
    code: row.code as string,
    name: row.name as string,
    modelId: row.model_id as number | null,
    modelName: resolveModelName(row.inv_machine_models as ModelNameJoin),
  }));
}

export async function addMachine(
  supabase: SupabaseClient,
  input: { code: string; name: string; modelId: number | null }
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase.from("inv_machines").insert({ code: input.code, name: input.name, model_id: input.modelId })
  );
  if (error) throw new Error(error.message);
}

export async function updateMachine(
  supabase: SupabaseClient,
  id: number,
  input: { code: string; name: string; modelId: number | null }
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase
      .from("inv_machines")
      .update({ code: input.code, name: input.name, model_id: input.modelId })
      .eq("id", id)
  );
  if (error) throw new Error(error.message);
}

export async function deleteMachine(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await withRetry(() => supabase.from("inv_machines").delete().eq("id", id));
  if (error) throw new Error(error.message);
}

// --- Logs ---

export async function fetchLogs(supabase: SupabaseClient): Promise<InventoryLog[]> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("inv_logs")
      .select(
        "id,machine_id,part_name,status,is_loan,borrower,reporter_employee_id,created_at,updated_at,inv_machines(code,name)"
      )
      .order("created_at", { ascending: false })
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const machine = resolveMachine(row.inv_machines as MachineJoin);
    return {
      id: row.id as number,
      machineId: row.machine_id as number,
      machineCode: machine.code,
      machineName: machine.name,
      partName: row.part_name as string,
      status: row.status as InventoryLogStatus,
      isLoan: row.is_loan as boolean,
      borrower: row.borrower as string | null,
      reporterEmployeeId: row.reporter_employee_id as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  });
}

export async function createLog(
  supabase: SupabaseClient,
  input: {
    machineId: number;
    partName: string;
    isLoan: boolean;
    borrower: string | null;
    reporterEmployeeId: string | null;
  }
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase.from("inv_logs").insert({
      machine_id: input.machineId,
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
