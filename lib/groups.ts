import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { withRetry } from "@/lib/bom";

type SupabaseClient = ReturnType<typeof createClient>;

export interface Group {
  id: number;
  name: string;
}

export interface GroupMember {
  employeeId: string;
  displayName: string | null;
}

export async function fetchGroups(supabase: SupabaseClient): Promise<Group[]> {
  const { data, error } = await withRetry(() =>
    supabase.from("groups").select("id,name").order("name")
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as Group[];
}

export async function addGroup(supabase: SupabaseClient, name: string): Promise<Group> {
  const { data, error } = await withRetry(() =>
    supabase.from("groups").insert({ name }).select("id,name").single()
  );
  if (error) throw new Error(error.message);
  return data as Group;
}

export async function deleteGroup(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await withRetry(() => supabase.from("groups").delete().eq("id", id));
  if (error) throw new Error(error.message);
}

/** Every group this employee belongs to — an employee can now belong to
 * more than one (group_members' primary key is (employee_id, group_id),
 * not employee_id alone), so this returns an array rather than assuming
 * exactly one. */
export async function resolveGroupsForEmployee(
  supabase: SupabaseClient,
  employeeId: string
): Promise<Group[]> {
  const { data, error } = await withRetry(() =>
    supabase.from("group_members").select("group_id,groups(id,name)").eq("employee_id", employeeId)
  );
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => {
      const group = (row as { groups: Group | Group[] | null }).groups;
      return Array.isArray(group) ? (group[0] ?? null) : group;
    })
    .filter((g): g is Group => g !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchAllowedMachineNames(
  supabase: SupabaseClient,
  groupId: number
): Promise<Set<string>> {
  const { data, error } = await withRetry(() =>
    supabase.from("group_machines").select("machine_name").eq("group_id", groupId)
  );
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.machine_name as string));
}

/** Records that `machineName` was downloaded under `groupId` — called once
 * per machine (not per module sheet) right after a successful SAP Modules
 * upload. Idempotent: re-downloading the same machine under the same group
 * is a no-op. */
export async function ensureMachineInGroup(
  supabase: SupabaseClient,
  groupId: number,
  machineName: string
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase.from("group_machines").upsert(
      { group_id: groupId, machine_name: machineName },
      { onConflict: "group_id,machine_name", ignoreDuplicates: true }
    )
  );
  if (error) throw new Error(error.message);
}

export async function fetchGroupMembers(supabase: SupabaseClient, groupId: number): Promise<GroupMember[]> {
  const { data, error } = await withRetry(() =>
    supabase
      .from("group_members")
      .select("employee_id,display_name")
      .eq("group_id", groupId)
      .order("employee_id")
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    employeeId: row.employee_id as string,
    displayName: row.display_name as string | null,
  }));
}

/** Adds an employee to a group — a no-op if they're already a member of
 * this specific group (upserts on the (employee_id, group_id) primary
 * key), and doesn't touch their membership in any other group, since an
 * employee can belong to more than one. */
export async function upsertGroupMember(
  supabase: SupabaseClient,
  employeeId: string,
  groupId: number,
  displayName?: string
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase
      .from("group_members")
      .upsert({ employee_id: employeeId, group_id: groupId, display_name: displayName ?? null })
  );
  if (error) throw new Error(error.message);
}

/** Removes an employee from one specific group — scoped by groupId (not
 * just employeeId) so removing them from one group doesn't also remove
 * any other group they belong to. */
export async function removeGroupMember(supabase: SupabaseClient, employeeId: string, groupId: number): Promise<void> {
  const { error } = await withRetry(() =>
    supabase.from("group_members").delete().eq("employee_id", employeeId).eq("group_id", groupId)
  );
  if (error) throw new Error(error.message);
}

/** Changes a member's employee_id itself (a plain UPDATE on the primary
 * key) — separate from upsertGroupMember, which only ever adds/moves by an
 * already-known employee_id and can't rename one in place. */
export async function renameGroupMember(
  supabase: SupabaseClient,
  oldEmployeeId: string,
  newEmployeeId: string
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase.from("group_members").update({ employee_id: newEmployeeId }).eq("employee_id", oldEmployeeId)
  );
  if (error) throw new Error(error.message);
}

export async function fetchGroupMachineNames(supabase: SupabaseClient, groupId: number): Promise<string[]> {
  const { data, error } = await withRetry(() =>
    supabase.from("group_machines").select("machine_name").eq("group_id", groupId).order("machine_name")
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.machine_name as string);
}

export async function removeMachineFromGroup(
  supabase: SupabaseClient,
  groupId: number,
  machineName: string
): Promise<void> {
  const { error } = await withRetry(() =>
    supabase.from("group_machines").delete().eq("group_id", groupId).eq("machine_name", machineName)
  );
  if (error) throw new Error(error.message);
}

const EMPLOYEE_ID_STORAGE_KEY = "lambom_employee_id";
const GROUP_ID_STORAGE_KEY = "lambom_selected_group_id";

/**
 * Reads/resolves the current employee's group(s) from localStorage,
 * mirroring the raw-localStorage pattern app/passdown/page.tsx uses for
 * "who am I" (see passdown_me) — shared here as a hook since many pages
 * need the exact same "read id -> resolve group(s) -> load allowed
 * machine names" sequence.
 *
 * An employee can belong to more than one group. `group` is whichever one
 * is currently active (persisted separately from employeeId, so it
 * survives navigating between pages) — `groups` is every group they
 * belong to, for a caller (the home page) to render a picker when there's
 * more than one. When the previously-selected group is no longer one of
 * theirs (or none was ever selected), the first group (alphabetically) is
 * used as the default without needing to persist that choice — only an
 * explicit setGroupId call writes to localStorage.
 */
export function useEmployeeGroup(): {
  employeeId: string | null;
  groups: Group[];
  group: Group | null;
  allowedMachines: Set<string> | null;
  loading: boolean;
  notFound: boolean;
  setEmployeeId: (id: string | null) => void;
  setGroupId: (id: number) => void;
  refresh: () => void;
} {
  const [employeeId, setEmployeeIdState] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupIdState] = useState<number | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [allowedMachines, setAllowedMachines] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setEmployeeIdState(localStorage.getItem(EMPLOYEE_ID_STORAGE_KEY));
    const savedGroupId = localStorage.getItem(GROUP_ID_STORAGE_KEY);
    setSelectedGroupIdState(savedGroupId ? Number(savedGroupId) : null);
  }, []);

  useEffect(() => {
    if (!employeeId) {
      setGroups([]);
      setAllowedMachines(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    const supabase = createClient();
    resolveGroupsForEmployee(supabase, employeeId)
      .then(async (resolved) => {
        if (cancelled) return;
        if (resolved.length === 0) {
          setGroups([]);
          setAllowedMachines(null);
          setNotFound(true);
          return;
        }
        setGroups(resolved);
        const active = resolved.find((g) => g.id === selectedGroupId) ?? resolved[0];
        const allowed = await fetchAllowedMachineNames(supabase, active.id);
        if (!cancelled) setAllowedMachines(allowed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, selectedGroupId, refreshTick]);

  const group = groups.find((g) => g.id === selectedGroupId) ?? groups[0] ?? null;

  const setEmployeeId = useCallback((id: string | null) => {
    if (id) localStorage.setItem(EMPLOYEE_ID_STORAGE_KEY, id);
    else localStorage.removeItem(EMPLOYEE_ID_STORAGE_KEY);
    setEmployeeIdState(id);
  }, []);

  // Only called when the user explicitly picks from the group dropdown —
  // the default (first group) above is never written to localStorage on
  // its own, so a second employee using the same browser without a saved
  // preference always sees their own default, not whatever the previous
  // person last picked.
  const setGroupId = useCallback((id: number) => {
    localStorage.setItem(GROUP_ID_STORAGE_KEY, String(id));
    setSelectedGroupIdState(id);
  }, []);

  // Re-resolves group(s) + allowed machines without touching localStorage —
  // needed after a SAP download adds a new machine to the current group, so
  // it shows up without the user having to re-enter their employee ID.
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  return { employeeId, groups, group, allowedMachines, loading, notFound, setEmployeeId, setGroupId, refresh };
}
